import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Landmark,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { adminActionToast } from "@/lib/admin-ops";
import {
  BANK_STATES,
  bankStateMeta,
  partnerDocKey,
  ROLE_LABEL,
  type BankVerificationState,
  type PartnerRole,
} from "@/lib/onboarding";
import { usePartnerPrivates } from "@/hooks/usePartnerPrivate";

interface BankRow {
  id: string;
  role: PartnerRole;
  partnerId: string;
  name: string;
  state: BankVerificationState;
  holder?: string;
  /** Full IFSC from the private record, else the public bank code. */
  ifsc?: string;
  accountMasked?: string;
  message?: string;
  /** Name the applicant typed vs our legal name. */
  typedNameMatched?: boolean;
  /** Name the BANK has registered, from the penny drop. */
  registeredName?: string;
  bankNameMatched?: boolean;
  grandfathered?: boolean;
  riskFlags?: string[];
  onboardingState?: string;
}

const ROLE_COLLECTIONS: { role: PartnerRole; collection: string }[] = [
  { role: "vendor", collection: "restaurants" },
  { role: "rider", collection: "delivery_users" },
  { role: "host", collection: "hotels" },
  { role: "mess", collection: "mess_kitchens" },
];

/** The queues ops works through, in priority order. */
const QUEUES: { key: string; label: string; states: BankVerificationState[] }[] = [
  { key: "action", label: "Needs Review", states: [BANK_STATES.ACTION_REQUIRED] },
  { key: "pending", label: "Pending Verification", states: [BANK_STATES.PENDING] },
  { key: "failed", label: "Failed", states: [BANK_STATES.FAILED] },
  { key: "verified", label: "Verified", states: [BANK_STATES.VERIFIED] },
  { key: "suspended", label: "Suspended", states: [BANK_STATES.SUSPENDED] },
  { key: "none", label: "Not Added", states: [BANK_STATES.NOT_ADDED] },
];

export default function BankVerificationPage() {
  const [rows, setRows] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState("action");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manual, setManual] = useState<BankRow | null>(null);
  const [manualState, setManualState] = useState<BankVerificationState>(
    BANK_STATES.VERIFIED,
  );
  const [manualReason, setManualReason] = useState("");
  const [acceptMismatch, setAcceptMismatch] = useState(false);

  useEffect(() => {
    const loaded: Record<string, BankRow[]> = {};
    const flush = () => {
      setRows(Object.values(loaded).flat());
      setLoading(false);
    };

    const unsubs = ROLE_COLLECTIONS.map(({ role, collection: name }) =>
      onSnapshot(
        query(collection(db, name), limit(1000)),
        (snap) => {
          loaded[role] = snap.docs
            .map((d) => {
              const data = d.data();
              const bank = data.bank ?? {};
              // Only surface partners that have reached the banking step —
              // a brand-new signup with no account isn't ops work yet.
              const hasBank = Boolean(bank.accountMasked || bank.verificationState);
              if (!hasBank) return null;
              // Names, full IFSC and the account live in partner_private and
              // are joined below.
              return {
                id: `${role}:${d.id}`,
                role,
                partnerId: d.id,
                name: String(data.name ?? data.displayName ?? d.id),
                state: (bank.verificationState ?? BANK_STATES.NOT_ADDED) as BankVerificationState,
                ifsc: bank.ifscBank ?? undefined,
                accountMasked: bank.accountMasked,
                message: bank.verificationMessage,
                typedNameMatched: bank.nameMatch?.matched,
                bankNameMatched: bank.bankNameMatch?.matched,
                grandfathered: bank.grandfathered === true,
                riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags : [],
                onboardingState: data.onboarding?.state,
              } as BankRow;
            })
            .filter(Boolean) as BankRow[];
          flush();
        },
        (err) => {
          console.error(`[BankVerification] ${name} listener failed`, err);
          loaded[role] = [];
          flush();
        },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  // Typed holder, bank-registered name and full IFSC live in partner_private
  // (finance-grade admins only) — the partner docs are publicly readable.
  const privates = usePartnerPrivates();
  const joinedRows = useMemo(
    () =>
      rows.map((r) => {
        const p = privates[partnerDocKey(r.role, r.partnerId)]?.bank;
        if (!p) return r;
        return {
          ...r,
          holder: p.holder,
          ifsc: p.ifsc ?? r.ifsc,
          registeredName: p.registeredName ?? undefined,
        };
      }),
    [rows, privates],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of QUEUES) {
      c[q.key] = joinedRows.filter((r) => q.states.includes(r.state)).length;
    }
    return c;
  }, [joinedRows]);

  const visible = useMemo(() => {
    const q = QUEUES.find((x) => x.key === queue);
    if (!q) return joinedRows;
    return joinedRows.filter((r) => q.states.includes(r.state));
  }, [joinedRows, queue]);

  const runPennyDrop = async (row: BankRow) => {
    setBusyId(row.id);
    try {
      const fn = httpsCallable(functions, "verifyBankAccount");
      const res = await fn({ role: row.role, partnerId: row.partnerId });
      const d = res.data as { started?: boolean; reason?: string };
      if (d.started) {
        toast.success("Penny drop sent — the result arrives shortly.");
      } else {
        toast.info(d.reason ?? "Verification could not be started.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed to start");
    } finally {
      setBusyId(null);
    }
  };

  const poll = async (row: BankRow) => {
    setBusyId(row.id);
    try {
      const fn = httpsCallable(functions, "pollBankValidation");
      const res = await fn({ role: row.role, partnerId: row.partnerId });
      const d = res.data as { state?: string; message?: string };
      toast.success(d.message ?? `Now: ${d.state}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check status");
    } finally {
      setBusyId(null);
    }
  };

  const submitManual = async () => {
    if (!manual) return;
    if (!manualReason.trim()) {
      toast.error("A written reason is required — this decides where money lands.");
      return;
    }
    setBusyId(manual.id);
    try {
      await adminActionToast(
        "setBankVerification",
        {
          role: manual.role,
          partnerId: manual.partnerId,
          state: manualState,
          message: manualReason.trim(),
          acceptMismatch,
        },
        `Bank marked ${manualState}`,
      );
      setManual(null);
      setManualReason("");
      setAcceptMismatch(false);
    } finally {
      setBusyId(null);
    }
  };

  const columns: ColumnDef<BankRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Partner",
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-sm">{row.original.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {ROLE_LABEL[row.original.role]}
              {row.original.onboardingState
                ? ` · ${row.original.onboardingState}`
                : ""}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "state",
        header: "Bank Status",
        cell: ({ row }) => {
          const meta = bankStateMeta(row.original.state);
          return (
            <div className="space-y-1">
              <Badge variant="outline" className={cn("text-[10px]", meta.className)}>
                {meta.label}
              </Badge>
              {row.original.grandfathered && (
                <p className="text-[10px] text-amber-600">
                  Grandfathered — never penny-dropped
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "account",
        header: "Account",
        cell: ({ row }) => (
          <div className="text-xs">
            <p className="font-mono">
              {row.original.accountMasked || "—"}
            </p>
            <p className="text-muted-foreground font-mono text-[10px]">
              {row.original.ifsc ?? ""}
            </p>
          </div>
        ),
      },
      {
        id: "names",
        header: "Name Match",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="text-xs space-y-0.5 max-w-[240px]">
              <p className="truncate">
                <span className="text-muted-foreground">Typed: </span>
                {r.holder ?? "—"}
                {r.typedNameMatched === false && (
                  <span className="text-rose-600"> ✕</span>
                )}
              </p>
              {r.registeredName && (
                <p className="truncate">
                  <span className="text-muted-foreground">Bank: </span>
                  {r.registeredName}
                  {r.bankNameMatched === false && (
                    <span className="text-rose-600"> ✕</span>
                  )}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "message",
        header: "Detail",
        cell: ({ row }) => (
          <div className="max-w-[280px]">
            <p className="text-xs text-muted-foreground line-clamp-2">
              {row.original.message ?? "—"}
            </p>
            {(row.original.riskFlags?.length ?? 0) > 0 && (
              <p className="text-[10px] text-rose-600 mt-0.5 line-clamp-1">
                ⚠ {row.original.riskFlags![0]}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const r = row.original;
          const busy = busyId === r.id;
          return (
            <div className="flex justify-end gap-1">
              {r.state !== BANK_STATES.VERIFIED && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() => runPennyDrop(r)}
                  title="Send a ₹1 penny drop to confirm the account and read its registered name"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5 mr-1" />
                  )}
                  Verify
                </Button>
              )}
              {r.state === BANK_STATES.PENDING && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={() => poll(r)}
                  title="Check the penny-drop result now"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() => {
                  setManual(r);
                  setManualState(
                    r.state === BANK_STATES.VERIFIED
                      ? BANK_STATES.SUSPENDED
                      : BANK_STATES.VERIFIED,
                  );
                }}
              >
                Override
              </Button>
            </div>
          );
        },
      },
    ],
    [busyId],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Bank verification"
        description="Every payout is blocked until banking is verified. A penny drop confirms the account is live and returns the name the bank has registered — that name, not the one the partner typed, is what must match the legal entity."
        icon={Landmark}
        stats={[
          { label: "Needs review", value: loading ? "—" : String(counts.action ?? 0) },
          { label: "Pending", value: loading ? "—" : String(counts.pending ?? 0) },
          { label: "Verified", value: loading ? "—" : String(counts.verified ?? 0) },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        {QUEUES.map((q) => (
          <Button
            key={q.key}
            size="sm"
            variant={queue === q.key ? "default" : "outline"}
            className="h-8 text-xs rounded-lg"
            onClick={() => setQueue(q.key)}
          >
            {q.label}
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
              {counts[q.key] ?? 0}
            </Badge>
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading banking records…
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={visible}
          searchPlaceholder="Search partners…"
          exportFilename="bank-verification"
        />
      )}

      <Dialog open={!!manual} onOpenChange={(o) => !o && setManual(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override bank status</DialogTitle>
            <DialogDescription>
              {manual?.name} — {manual && ROLE_LABEL[manual.role]}. This decides
              whether money may leave the platform to this account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>New status</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(
                  [
                    BANK_STATES.VERIFIED,
                    BANK_STATES.ACTION_REQUIRED,
                    BANK_STATES.FAILED,
                    BANK_STATES.SUSPENDED,
                    BANK_STATES.PENDING,
                  ] as BankVerificationState[]
                ).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={manualState === s ? "default" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => setManualState(s)}
                  >
                    {bankStateMeta(s).label}
                  </Button>
                ))}
              </div>
            </div>

            {manualState === BANK_STATES.VERIFIED &&
              (manual?.typedNameMatched === false ||
                manual?.bankNameMatched === false) && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-500/10 dark:border-amber-500/30">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-900">
                      <p className="font-semibold">Name mismatch on record.</p>
                      <p className="mt-0.5">
                        Verifying anyway records an explicit exception against
                        your account. Only do this if you have confirmed the
                        account belongs to this partner.
                      </p>
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acceptMismatch}
                          onChange={(e) => setAcceptMismatch(e.target.checked)}
                        />
                        <span>I have confirmed this account is theirs.</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

            <div>
              <Label>Reason (recorded in the audit trail)</Label>
              <Textarea
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="e.g. Confirmed on call with the owner; bank letter on file."
                className="mt-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManual(null)}>
              Cancel
            </Button>
            <Button onClick={submitManual} disabled={busyId === manual?.id}>
              {busyId === manual?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-2" />
              )}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
