import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Gift, Loader2, Save } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { DataTable } from "@/components/admin/ui/data-table";
import { FilterChips } from "@/components/admin/FilterChips";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { db, functions } from "@/lib/firebase";
import { formatMoney } from "@/lib/currency";

/**
 * Referrals — one program per department (customer, restaurant, mess
 * kitchen, rider, host). The server (functions/src/referrals.ts) owns every
 * state change; this page reads the ledger live and acts only through the
 * audited callables: upsertReferralProgram, approveReferralReward,
 * reverseReferralReward, markReferralPayoutPaid.
 */

type Dept = "customer" | "vendor" | "mess" | "rider" | "host";
const DEPTS: { id: Dept; label: string; noun: string }[] = [
  { id: "customer", label: "Customers", noun: "customer" },
  { id: "vendor", label: "Restaurants", noun: "restaurant" },
  { id: "mess", label: "Mess kitchens", noun: "kitchen" },
  { id: "rider", label: "Riders", noun: "rider" },
  { id: "host", label: "Stay hosts", noun: "host" },
];
const deptLabel = (t?: string) => DEPTS.find((d) => d.id === (t || "customer"))?.label ?? t ?? "—";

type Ts = { toDate?: () => Date; toMillis?: () => number };

interface Referral {
  id: string;
  referrerUid?: string;
  refereeUid?: string;
  refereeName?: string;
  code?: string;
  participantType?: Dept;
  programId?: string;
  status?: string;
  referrerReward?: number;
  refereeReward?: number;
  rewardType?: string;
  progress?: number;
  target?: number;
  fraudScore?: number;
  fraudFlags?: string[];
  qualifyingActionId?: string;
  reversalReason?: string;
  approvedBy?: string;
  createdAt?: Ts;
  qualifiedAt?: Ts;
  rewardedAt?: Ts;
  reversedAt?: Ts;
  expiresAt?: Ts;
}

interface Payout {
  id: string;
  uid?: string;
  participantType?: Dept;
  role?: "referrer" | "referee";
  amount?: number;
  referralId?: string;
  status?: "pending" | "paid" | "cancelled";
  reference?: string;
  recoveryRequired?: boolean;
  createdAt?: Ts;
  paidAt?: Ts;
}

interface FraudSignal {
  id: string;
  referrerUid?: string;
  refereeUid?: string;
  participantType?: string;
  score?: number;
  flags?: string[];
  createdAt?: Ts;
}

interface Program {
  participantType: Dept;
  name: string;
  active: boolean;
  referrerReward: number;
  refereeReward: number;
  rewardType: "wallet_credit" | "payout";
  qualifyingAction: string;
  qualifyingTarget: number;
  minOrderValue: number;
  maxRewardsPerUser: number;
  expiryDays: number;
  applyWindowDays: number;
  reviewThreshold: number;
  terms: string;
  saved?: boolean;
}

const when = (ts?: Ts) => {
  try {
    return ts?.toDate?.().toLocaleDateString("en-IN") ?? "—";
  } catch {
    return "—";
  }
};
const dateTime = (ts?: Ts) => {
  try {
    return ts?.toDate?.().toLocaleString("en-IN") ?? "—";
  } catch {
    return "—";
  }
};

const uidCell = (uid?: string, type?: string) => {
  if (!uid) return <span className="text-muted-foreground">—</span>;
  if ((type || "customer") === "customer") {
    return (
      <Link className="text-primary font-mono text-xs hover:underline" to={`/admin/consumers?search=${encodeURIComponent(uid)}`}>
        {uid.slice(0, 10)}…
      </Link>
    );
  }
  return (
    <button
      type="button"
      title="Copy id"
      className="font-mono text-xs text-primary hover:underline"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(uid);
        toast.success("Id copied");
      }}
    >
      {uid.slice(0, 10)}…
    </button>
  );
};

const STATUS_TONE: Record<string, string> = {
  rewarded: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300",
  pending: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300",
  qualified: "border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300",
  reversed: "border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300",
  expired: "border-muted text-muted-foreground",
  paid: "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300",
  cancelled: "border-muted text-muted-foreground",
};
const statusBadge = (s?: string) => {
  const v = s || "pending";
  const label = v === "qualified" ? "needs review" : v === "pending" ? "in progress" : v;
  return <Badge variant="outline" className={`${STATUS_TONE[v] ?? ""} capitalize`}>{label}</Badge>;
};

const callable = <T,>(name: string) => httpsCallable<unknown, T>(functions, name);
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function ReferralsPage() {
  const { rows: referrals, loading: loadingReferrals } = useLiveCollection<Referral>("referrals", { orderByField: "createdAt", limit: 1000 });
  const { rows: payouts } = useLiveCollection<Payout>("referral_payouts", { orderByField: "createdAt", limit: 500 });
  const { rows: signals } = useLiveCollection<FraudSignal>("referral_fraud_signals", { orderByField: "createdAt", limit: 300 });

  const [dept, setDept] = useState<"all" | Dept>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Referral | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<Payout | null>(null);

  // Global switch: config/feature_flags.referrals === false pauses every program.
  const [globalOn, setGlobalOn] = useState<boolean | null>(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, "config", "feature_flags"),
        (s) => setGlobalOn(s.data()?.referrals !== false),
        () => setGlobalOn(null),
      ),
    [],
  );

  const inDept = useCallback(
    <T extends { participantType?: string }>(rows: T[]) =>
      dept === "all" ? rows : rows.filter((r) => (r.participantType || "customer") === dept),
    [dept],
  );
  const deptReferrals = useMemo(() => inDept(referrals), [inDept, referrals]);
  const deptPayouts = useMemo(() => inDept(payouts), [inDept, payouts]);
  const reviewQueue = useMemo(() => deptReferrals.filter((r) => r.status === "qualified"), [deptReferrals]);
  const ledger = useMemo(
    () => deptReferrals.filter((r) => statusFilter === "all" || (r.status || "pending") === statusFilter),
    [deptReferrals, statusFilter],
  );

  const count = (s: string) => deptReferrals.filter((r) => (r.status || "pending") === s).length;
  const rewardedCount = count("rewarded");
  const conversion = deptReferrals.length ? ((rewardedCount / deptReferrals.length) * 100).toFixed(1) : "0";
  const rewardsIssued = deptReferrals
    .filter((r) => r.status === "rewarded")
    .reduce((s, r) => s + (r.referrerReward || 0) + (r.refereeReward || 0), 0);
  const payoutsOwed = deptPayouts.filter((p) => p.status === "pending").reduce((s, p) => s + (p.amount || 0), 0);

  // ── Actions ────────────────────────────────────────────────────────────────
  const approve = async (r: Referral) => {
    setBusy(true);
    try {
      await callable("approveReferralReward")({ referralId: r.id });
      toast.success("Reward approved and paid");
      setSelected(null);
    } catch (e) {
      toast.error(errMsg(e, "Approval failed"));
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (rows: Referral[], kind: "approve" | "reverse") => {
    const targets = rows.filter((r) =>
      kind === "approve" ? r.status === "qualified" : ["pending", "qualified", "rewarded"].includes(r.status || "pending"),
    );
    if (!targets.length) {
      toast.error(kind === "approve" ? "Select referrals that need review." : "Nothing selected can be reversed.");
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const r of targets) {
      try {
        if (kind === "approve") await callable("approveReferralReward")({ referralId: r.id });
        else await callable("reverseReferralReward")({ referralId: r.id, reason: "Bulk reversal by admin" });
        ok++;
      } catch {
        /* counted below */
      }
    }
    setBusy(false);
    const failed = targets.length - ok;
    if (ok) toast.success(`${kind === "approve" ? "Approved" : "Reversed"} ${ok}${failed ? `, ${failed} failed` : ""}`);
    else toast.error(`All ${failed} failed`);
  };

  const markPaid = async (reference: string) => {
    if (!paying || !reference.trim()) return;
    setBusy(true);
    try {
      await callable("markReferralPayoutPaid")({ payoutId: paying.id, reference: reference.trim() });
      toast.success("Payout marked paid — the partner has been notified");
      setPaying(null);
    } catch (e) {
      toast.error(errMsg(e, "Could not mark paid"));
    } finally {
      setBusy(false);
    }
  };

  // ── Columns ────────────────────────────────────────────────────────────────
  const ledgerColumns: ColumnDef<Referral>[] = useMemo(
    () => [
      { accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-mono font-semibold">{row.original.code || "—"}</span> },
      { id: "dept", header: "Department", cell: ({ row }) => <Badge variant="secondary">{deptLabel(row.original.participantType)}</Badge> },
      { id: "referrer", header: "Referrer", cell: ({ row }) => uidCell(row.original.referrerUid, row.original.participantType) },
      {
        id: "referee",
        header: "Referee",
        cell: ({ row }) => (
          <div className="flex flex-col">
            {row.original.refereeName && <span className="text-xs font-medium">{row.original.refereeName}</span>}
            {uidCell(row.original.refereeUid, row.original.participantType)}
          </div>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => statusBadge(row.original.status) },
      {
        id: "progress",
        header: "Progress",
        cell: ({ row }) => {
          const t = Math.max(1, row.original.target || 1);
          const p = Math.min(t, row.original.progress || 0);
          return (
            <div className="w-24">
              <div className="h-1.5 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(p / t) * 100}%` }} />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">{p}/{t}</span>
            </div>
          );
        },
      },
      {
        id: "rewards",
        header: "Rewards",
        cell: ({ row }) => (
          <span className="tabular-nums text-xs">
            {formatMoney(row.original.referrerReward || 0)} + {formatMoney(row.original.refereeReward || 0)}
          </span>
        ),
      },
      {
        accessorKey: "fraudScore",
        header: "Risk",
        cell: ({ row }) => {
          const s = row.original.fraudScore || 0;
          return <span className={s >= 80 ? "text-rose-600 font-bold" : s >= 40 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>{s}</span>;
        },
      },
      { id: "created", header: "Created", cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{when(row.original.createdAt)}</span> },
    ],
    [],
  );

  const payoutColumns: ColumnDef<Payout>[] = useMemo(
    () => [
      { id: "dept", header: "Department", cell: ({ row }) => <Badge variant="secondary">{deptLabel(row.original.participantType)}</Badge> },
      { id: "uid", header: "Partner", cell: ({ row }) => uidCell(row.original.uid, row.original.participantType) },
      { id: "role", header: "For", cell: ({ row }) => <span className="text-xs">{row.original.role === "referee" ? "Joining bonus" : "Referral reward"}</span> },
      { id: "amount", header: "Amount", cell: ({ row }) => <span className="font-semibold tabular-nums">{formatMoney(row.original.amount || 0)}</span> },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {statusBadge(row.original.status)}
            {row.original.recoveryRequired && <Badge variant="destructive">recover</Badge>}
          </div>
        ),
      },
      { id: "ref", header: "Reference", cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference || "—"}</span> },
      { id: "created", header: "Created", cell: ({ row }) => <span className="text-xs text-muted-foreground">{when(row.original.createdAt)}</span> },
      {
        id: "act",
        header: "",
        cell: ({ row }) =>
          row.original.status === "pending" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setPaying(row.original);
              }}
            >
              Mark paid
            </Button>
          ) : null,
      },
    ],
    [],
  );

  const fraudColumns: ColumnDef<FraudSignal>[] = useMemo(
    () => [
      { id: "dept", header: "Department", cell: ({ row }) => <Badge variant="secondary">{deptLabel(row.original.participantType)}</Badge> },
      { id: "referrer", header: "Referrer", cell: ({ row }) => uidCell(row.original.referrerUid, row.original.participantType) },
      { id: "referee", header: "Referee", cell: ({ row }) => uidCell(row.original.refereeUid, row.original.participantType) },
      {
        accessorKey: "score",
        header: "Score",
        cell: ({ row }) => {
          const s = row.original.score || 0;
          return <Badge variant="outline" className={s >= 80 ? "border-rose-500 text-rose-700" : s >= 40 ? "border-amber-500 text-amber-700" : ""}>{s}</Badge>;
        },
      },
      { id: "flags", header: "Flags", cell: ({ row }) => <div className="max-w-[260px] truncate text-xs text-muted-foreground">{(row.original.flags || []).join(", ").replace(/_/g, " ")}</div> },
      { id: "created", header: "Date", cell: ({ row }) => <span className="text-xs text-muted-foreground">{when(row.original.createdAt)}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Referrals"
        description="One referral program per department. Rewards pay automatically when a referee hits their goal; risky ones wait for review here."
        icon={Gift}
      />

      {globalOn === false && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="py-3 text-sm">
            Referrals are switched off globally (<span className="font-mono">config/feature_flags.referrals</span>). Apps show
            "paused" for every department until it is turned back on in Platform Settings.
          </CardContent>
        </Card>
      )}

      <FilterChips
        value={dept}
        onChange={(v: string) => setDept(v as "all" | Dept)}
        options={[{ id: "all", label: "All departments" }, ...DEPTS.map((d) => ({ id: d.id, label: d.label }))]}
      />

      <StatCards
        stats={[
          { label: "Referrals", value: loadingReferrals ? "—" : deptReferrals.length },
          { label: "In progress", value: count("pending"), tone: "text-amber-600" },
          { label: "Needs review", value: reviewQueue.length, tone: reviewQueue.length ? "text-blue-600" : undefined },
          { label: "Conversion", value: `${conversion}%`, tone: "text-emerald-600", hint: `${rewardedCount} rewarded` },
          { label: "Rewards issued", value: formatMoney(rewardsIssued) },
          { label: "Payouts owed", value: formatMoney(payoutsOwed), tone: payoutsOwed ? "text-rose-600" : undefined },
        ]}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="review">Review queue{reviewQueue.length ? ` (${reviewQueue.length})` : ""}</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="fraud">Fraud & risk</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            {DEPTS.map((d) => {
              const rows = referrals.filter((r) => (r.participantType || "customer") === d.id);
              const rewarded = rows.filter((r) => r.status === "rewarded").length;
              const owed = payouts.filter((p) => p.participantType === d.id && p.status === "pending").reduce((s, p) => s + (p.amount || 0), 0);
              return (
                <Card key={d.id} className="cursor-pointer hover:border-primary/50" onClick={() => setDept(d.id)}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{d.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Referrals</span><span className="font-semibold">{rows.length}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">In progress</span><span>{rows.filter((r) => (r.status || "pending") === "pending").length}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Rewarded</span><span>{rewarded}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Conversion</span><span>{rows.length ? `${((rewarded / rows.length) * 100).toFixed(0)}%` : "—"}</span></div>
                    {d.id !== "customer" && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Owed</span><span className={owed ? "text-rose-600 font-semibold" : ""}>{formatMoney(owed)}</span></div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="review" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            These referees reached their goal but scored as risky (same phone, email, bank account or unusual velocity). Approve to pay both
            sides, or reverse with a reason.
          </p>
          <DataTable
            columns={ledgerColumns}
            data={reviewQueue}
            searchPlaceholder="Search code or id…"
            exportFilename="referrals_review"
            onRowClick={(r) => setSelected(r)}
            bulkActions={[
              { label: "Approve selected", onSelected: (rows) => bulk(rows as Referral[], "approve") },
              { label: "Reverse selected", onSelected: (rows) => bulk(rows as Referral[], "reverse"), destructive: true },
            ]}
          />
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4">
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { id: "all", label: "All" },
              { id: "pending", label: "In progress" },
              { id: "qualified", label: "Needs review" },
              { id: "rewarded", label: "Rewarded" },
              { id: "expired", label: "Expired" },
              { id: "reversed", label: "Reversed" },
            ]}
          />
          <DataTable
            columns={ledgerColumns}
            data={ledger}
            searchPlaceholder="Search code or id…"
            exportFilename="referrals_ledger"
            onRowClick={(r) => setSelected(r)}
            bulkActions={[{ label: "Reverse selected", onSelected: (rows) => bulk(rows as Referral[], "reverse"), destructive: true }]}
          />
        </TabsContent>

        <TabsContent value="payouts" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Partner rewards (restaurants, kitchens, riders, hosts) are paid by ops. Send the money with the partner's settlement, then mark it
            paid here with the UTR — the partner sees it in their app instantly.
          </p>
          <DataTable columns={payoutColumns} data={deptPayouts} searchPlaceholder="Search partner id…" exportFilename="referral_payouts" />
        </TabsContent>

        <TabsContent value="programs">
          <ProgramEditor focus={dept === "all" ? undefined : dept} />
        </TabsContent>

        <TabsContent value="fraud">
          <DataTable columns={fraudColumns} data={inDept(signals)} searchPlaceholder="Search…" exportFilename="referral_fraud_signals" />
        </TabsContent>
      </Tabs>

      {selected && (
        <EntityDrawer
          open={!!selected}
          onOpenChange={(o) => !o && setSelected(null)}
          icon={Gift}
          title={`Referral ${selected.code ?? ""}`}
          subtitle={`${deptLabel(selected.participantType)} · ${selected.programId || "default program"}`}
          status={selected.status || "pending"}
          statusTone={
            (selected.status === "rewarded" ? "positive" : selected.status === "qualified" ? "caution" : selected.status === "reversed" ? "critical" : "neutral") as never
          }
          metrics={[
            { label: "Referrer", value: formatMoney(selected.referrerReward || 0) },
            { label: "Referee", value: formatMoney(selected.refereeReward || 0) },
            { label: "Progress", value: `${selected.progress || 0}/${selected.target || 1}` },
            { label: "Risk", value: selected.fraudScore || 0 },
          ]}
          actions={
            <>
              {selected.status === "qualified" && (
                <Button size="sm" disabled={busy} onClick={() => approve(selected)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve & pay"}
                </Button>
              )}
              {["pending", "qualified", "rewarded"].includes(selected.status || "pending") && (
                <Button variant="destructive" size="sm" onClick={() => setReverseOpen(true)}>
                  {selected.status === "rewarded" ? "Reverse rewards" : "Cancel referral"}
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="font-semibold">Timeline</h3>
              <Row k="Created" v={dateTime(selected.createdAt)} />
              <Row k="Goal deadline" v={dateTime(selected.expiresAt)} />
              <Row k="Goal reached" v={dateTime(selected.qualifiedAt)} />
              <Row k="Rewarded" v={dateTime(selected.rewardedAt)} />
              {selected.reversedAt && <Row k="Reversed" v={`${dateTime(selected.reversedAt)} — ${selected.reversalReason ?? ""}`} />}
            </section>
            <section className="space-y-2">
              <h3 className="font-semibold">People</h3>
              <Row k="Referrer" v={uidCell(selected.referrerUid, selected.participantType)} />
              <Row k="Referee" v={<>{selected.refereeName ? `${selected.refereeName} · ` : ""}{uidCell(selected.refereeUid, selected.participantType)}</>} />
              <Row k="Paid as" v={selected.rewardType === "payout" || (selected.participantType && selected.participantType !== "customer") ? "Payout (ops)" : "Wallet credit"} />
            </section>
            {(selected.fraudFlags || []).length > 0 && (
              <section className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3">
                <h3 className="font-semibold text-rose-700 dark:text-rose-300 mb-1">Risk signals</h3>
                <ul className="list-disc pl-4 text-xs text-rose-700 dark:text-rose-300">
                  {selected.fraudFlags!.map((f) => <li key={f}>{f.replace(/_/g, " ")}</li>)}
                </ul>
              </section>
            )}
          </div>
        </EntityDrawer>
      )}

      {selected && (
        <ConfirmationDialog
          open={reverseOpen}
          onOpenChange={setReverseOpen}
          title={selected.status === "rewarded" ? "Reverse referral rewards" : "Cancel referral"}
          description={`Referral ${selected.code ?? selected.id} (${deptLabel(selected.participantType)})`}
          consequences={
            selected.status === "rewarded"
              ? selected.participantType && selected.participantType !== "customer"
                ? ["Unpaid payouts are cancelled.", "Payouts already sent are flagged for recovery.", "Both sides are notified."]
                : [
                    `${formatMoney(selected.referrerReward || 0)} is taken back from the referrer's wallet.`,
                    `${formatMoney(selected.refereeReward || 0)} is taken back from the referee's wallet.`,
                    "Both sides are notified.",
                  ]
              : ["Nothing has been paid yet; the referral simply stops counting progress."]
          }
          requireReason
          confirmLabel="Confirm"
          onConfirm={async (reason) => {
            try {
              await callable("reverseReferralReward")({ referralId: selected.id, reason: reason || "Reversed by admin" });
              toast.success("Done");
              setSelected(null);
            } catch (e) {
              toast.error(errMsg(e, "Reversal failed"));
            } finally {
              setReverseOpen(false);
            }
          }}
        />
      )}

      <ConfirmationDialog
        open={!!paying}
        onOpenChange={(o) => !o && setPaying(null)}
        title="Mark referral payout paid"
        description={paying ? `${formatMoney(paying.amount || 0)} to ${deptLabel(paying.participantType)} partner ${paying.uid?.slice(0, 10) ?? ""}…` : ""}
        consequences={["Only do this after the money has actually been sent.", "The partner is notified with the reference."]}
        requireReason
        reasonLabel="UTR / settlement reference"
        loading={busy}
        confirmLabel="Mark paid"
        onConfirm={(reference) => markPaid(reference ?? "")}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

const ACTION_LABEL: Record<Dept, string> = {
  customer: "First completed order, mess plan or stay",
  vendor: "Completed food orders",
  mess: "Paid meal-plan subscriptions",
  rider: "Completed deliveries",
  host: "Checked-out stays",
};

/** Edits every department's program through upsertReferralProgram. */
function ProgramEditor({ focus }: { focus?: Dept }) {
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [saving, setSaving] = useState<Dept | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await callable<{ programs: Program[] }>("listReferralPrograms")({});
      setPrograms(res.data.programs);
    } catch (e) {
      toast.error(errMsg(e, "Couldn't load programs"));
      setPrograms([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = (t: Dept, p: Partial<Program>) =>
    setPrograms((all) => (all ?? []).map((x) => (x.participantType === t ? { ...x, ...p } : x)));

  const save = async (p: Program) => {
    setSaving(p.participantType);
    try {
      const res = await callable<{ program: Program }>("upsertReferralProgram")(p);
      patch(p.participantType, { ...res.data.program, saved: true });
      toast.success(`${deptLabel(p.participantType)} program saved — apps pick it up within a minute`);
    } catch (e) {
      toast.error(errMsg(e, "Save failed"));
    } finally {
      setSaving(null);
    }
  };

  if (!programs) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading programs…
      </div>
    );
  }

  const shown = focus ? programs.filter((p) => p.participantType === focus) : programs;
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {shown.map((p) => (
        <Card key={p.participantType}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{deptLabel(p.participantType)}</CardTitle>
                <CardDescription>
                  {ACTION_LABEL[p.participantType]} · paid as {p.rewardType === "payout" ? "ops payout" : "wallet credit"}
                  {!p.saved && " · using defaults"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{p.active ? "Live" : "Paused"}</span>
                <Switch checked={p.active} onCheckedChange={(v) => patch(p.participantType, { active: v })} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={p.name} onChange={(e) => patch(p.participantType, { name: e.target.value })} /></Field>
              <Field label={`Goal (${ACTION_LABEL[p.participantType].toLowerCase()})`}>
                <Input type="number" min={1} value={p.qualifyingTarget} onChange={(e) => patch(p.participantType, { qualifyingTarget: num(e.target.value) })} />
              </Field>
              <Field label="Referrer reward (₹)">
                <Input type="number" min={0} value={p.referrerReward} onChange={(e) => patch(p.participantType, { referrerReward: num(e.target.value) })} />
              </Field>
              <Field label="Referee reward (₹)">
                <Input type="number" min={0} value={p.refereeReward} onChange={(e) => patch(p.participantType, { refereeReward: num(e.target.value) })} />
              </Field>
              <Field label="Days to reach goal">
                <Input type="number" min={1} value={p.expiryDays} onChange={(e) => patch(p.participantType, { expiryDays: num(e.target.value) })} />
              </Field>
              <Field label="Days after joining to apply a code">
                <Input type="number" min={1} value={p.applyWindowDays} onChange={(e) => patch(p.participantType, { applyWindowDays: num(e.target.value) })} />
              </Field>
              <Field label="Max rewards per referrer">
                <Input type="number" min={0} value={p.maxRewardsPerUser} onChange={(e) => patch(p.participantType, { maxRewardsPerUser: num(e.target.value) })} />
              </Field>
              <Field label="Hold for review at risk score ≥">
                <Input type="number" min={1} value={p.reviewThreshold} onChange={(e) => patch(p.participantType, { reviewThreshold: num(e.target.value) })} />
              </Field>
              {p.participantType === "customer" && (
                <Field label="Minimum order value (₹)">
                  <Input type="number" min={0} value={p.minOrderValue} onChange={(e) => patch(p.participantType, { minOrderValue: num(e.target.value) })} />
                </Field>
              )}
            </div>
            <Field label="Terms shown in the app">
              <Textarea rows={2} value={p.terms} onChange={(e) => patch(p.participantType, { terms: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" disabled={saving === p.participantType} onClick={() => save(p)}>
                {saving === p.participantType ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                Save {deptLabel(p.participantType).toLowerCase()} program
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
