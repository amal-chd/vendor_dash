import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  ClipboardCheck,
  AlertTriangle,
  CalendarClock,
  MoreHorizontal,
  CheckCircle2,
  MapPin,
  MessageSquare,
  KeyRound,
  ExternalLink,
  Eye,
  Utensils,
  Bike,
  Hotel,
  ChefHat,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ADMIN_QUEUES,
  ROLE_LABEL,
  stateMeta,
  bankStateMeta,
  type OnboardingState,
  type PartnerRole,
  type BankVerificationState,
  partnerDocKey,
  partnerEmail,
} from "@/lib/onboarding";
import { OnboardingPartnerSheet } from "@/components/admin/onboarding/OnboardingPartnerSheet";
import { OnboardingBackfillDialog } from "@/components/admin/onboarding/OnboardingBackfillDialog";
import { PartnerPrivateSealDialog } from "@/components/admin/onboarding/PartnerPrivateSealDialog";
import { AssignZoneDialog } from "@/components/admin/onboarding/AssignZoneDialog";
import { VendorContactDialog } from "@/components/admin/vendors/VendorContactDialog";
import { ResetPasswordDialog } from "@/components/admin/vendors/ResetPasswordDialog";
import { ZoneBadge } from "@/components/admin/zones/ZoneScopeBar";
import { usePartnerContacts } from "@/hooks/usePartnerPrivate";
import { useAdminScope } from "@/hooks/useAdminScope";
import { adminActionToast } from "@/lib/admin-ops";
import { Link, useSearchParams } from "react-router-dom";

export interface PartnerRow {
  id: string;
  role: PartnerRole;
  partnerId: string;
  name: string;
  email?: string;
  phone?: string;
  state: OnboardingState;
  steps: Record<string, boolean>;
  stepReviews: Record<string, { decision?: string; by?: string; reason?: string }>;
  businessStructure?: string;
  zoneId?: string | null;
  zoneName?: string | null;
  blockingReasons: string[];
  bankState: BankVerificationState;
  bankMessage?: string;
  documents: Record<string, { url?: string; expiresAt?: unknown; number?: string }>;
  expiringSoon: { id: string; label: string; expiresAt: number }[];
  riskFlags: string[];
  submittedAt?: number;
  raw: Record<string, unknown>;
}

const ROLE_COLLECTIONS: { role: PartnerRole; collection: string }[] = [
  { role: "vendor", collection: "restaurants" },
  { role: "rider", collection: "delivery_users" },
  { role: "host", collection: "hotels" },
  { role: "mess", collection: "mess_kitchens" },
];

/** Extra queues the state machine alone doesn't express. */
const DERIVED_QUEUES = [
  { key: "bank_pending", label: "Bank Pending" },
  { key: "expiring", label: "Documents Expiring" },
] as const;

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  const anyV = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof anyV.toMillis === "function") {
    try {
      return anyV.toMillis();
    } catch {
      return null;
    }
  }
  if (typeof anyV.toDate === "function") {
    try {
      return anyV.toDate().getTime();
    } catch {
      return null;
    }
  }
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : null;
}

const WARN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export default function OnboardingCommandCenter() {
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get("role") as PartnerRole | null;
  const initialQueue = searchParams.get("queue");
  const initialPartnerId = searchParams.get("partnerId");

  const { zones } = useAdminScope();
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<string>(initialQueue || "new");
  const [roleFilter, setRoleFilter] = useState<"all" | PartnerRole>(initialRole || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState<PartnerRow | null>(null);

  useEffect(() => {
    if (initialRole) setRoleFilter(initialRole);
    if (initialQueue) setQueue(initialQueue);
  }, [initialRole, initialQueue]);

  useEffect(() => {
    if (initialPartnerId && rows.length > 0 && !open) {
      const match = rows.find(
        (r) => r.partnerId === initialPartnerId || r.id === initialPartnerId || r.id.endsWith(`:${initialPartnerId}`)
      );
      if (match) setOpen(match);
    }
  }, [rows, initialPartnerId, open]);

  // Quick Action Dialogs
  const [assignZonePartner, setAssignZonePartner] = useState<PartnerRow | null>(null);
  const [contactPartner, setContactPartner] = useState<{ id: string; name: string; email?: string; phone?: string } | null>(null);
  const [resetPasswordPartner, setResetPasswordPartner] = useState<{ id: string; name: string; email?: string; phone?: string } | null>(null);

  useEffect(() => {
    const loaded: Record<string, PartnerRow[]> = {};
    const flush = () => {
      const allRows = Object.values(loaded).flat();
      const dedupedMap = new Map<string, PartnerRow>();

      const STATE_PROGRESS: Record<string, number> = {
        active: 10,
        ready_for_activation: 9,
        commercial_setup: 8,
        approved: 7,
        verification: 6,
        kyc_review: 5,
        submitted: 4,
        action_required: 3,
        incomplete: 2,
        started: 1,
      };

      const normPhone = (p?: string) => {
        if (!p) return null;
        const digits = p.replace(/\D/g, "");
        return digits.length >= 7 ? digits.slice(-10) : null;
      };
      const normEmail = (e?: string) => {
        if (!e) return null;
        const clean = e.trim().toLowerCase();
        return clean.includes("@") ? clean : null;
      };

      const byOwnerKey = new Map<string, PartnerRow>();
      const byNormalizedPhone = new Map<string, PartnerRow>();
      const byNormalizedEmail = new Map<string, PartnerRow>();
      const byPartnerId = new Map<string, PartnerRow>();

      for (const r of allRows) {
        const pPhone = normPhone(r.phone);
        const pEmail = normEmail(r.email);
        const ownerUid = (r.raw.ownerUid || r.raw.ownerId || r.raw.userId || r.raw.uid) as string | undefined;

        let existing: PartnerRow | undefined;
        if (ownerUid) existing = byOwnerKey.get(`${r.role}:${ownerUid}`);
        if (!existing && pPhone) existing = byNormalizedPhone.get(`${r.role}:${pPhone}`);
        if (!existing && pEmail) existing = byNormalizedEmail.get(`${r.role}:${pEmail}`);
        if (!existing) existing = byPartnerId.get(`${r.role}:${r.partnerId}`);

        if (!existing) {
          const canonical = { ...r };
          if (ownerUid) byOwnerKey.set(`${r.role}:${ownerUid}`, canonical);
          if (pPhone) byNormalizedPhone.set(`${r.role}:${pPhone}`, canonical);
          if (pEmail) byNormalizedEmail.set(`${r.role}:${pEmail}`, canonical);
          byPartnerId.set(`${r.role}:${r.partnerId}`, canonical);
          dedupedMap.set(canonical.id, canonical);
        } else {
          const existingScore = (STATE_PROGRESS[existing.state] ?? 0) * 100 + Object.keys(existing.steps).length;
          const currentScore = (STATE_PROGRESS[r.state] ?? 0) * 100 + Object.keys(r.steps).length;

          const mergedDocs = { ...existing.documents, ...r.documents };
          const mergedSteps = { ...existing.steps, ...r.steps };
          const mergedReviews = { ...existing.stepReviews, ...r.stepReviews };
          const mergedRiskFlags = Array.from(new Set([...existing.riskFlags, ...r.riskFlags]));
          const mergedBlockingReasons = Array.from(new Set([...existing.blockingReasons, ...r.blockingReasons]));

          let winner: PartnerRow;
          if (
            currentScore > existingScore ||
            (currentScore === existingScore && (r.submittedAt ?? 0) >= (existing.submittedAt ?? 0))
          ) {
            winner = {
              ...r,
              documents: mergedDocs,
              steps: mergedSteps,
              stepReviews: mergedReviews,
              riskFlags: mergedRiskFlags,
              blockingReasons: mergedBlockingReasons,
              email: r.email || existing.email,
              phone: r.phone || existing.phone,
              zoneId: r.zoneId || existing.zoneId,
              zoneName: r.zoneName || existing.zoneName,
            };
          } else {
            winner = {
              ...existing,
              documents: mergedDocs,
              steps: mergedSteps,
              stepReviews: mergedReviews,
              riskFlags: mergedRiskFlags,
              blockingReasons: mergedBlockingReasons,
              email: existing.email || r.email,
              phone: existing.phone || r.phone,
              zoneId: existing.zoneId || r.zoneId,
              zoneName: existing.zoneName || r.zoneName,
            };
          }

          if (existing.id !== winner.id) {
            dedupedMap.delete(existing.id);
          }
          dedupedMap.set(winner.id, winner);

          const wUid = (winner.raw.ownerUid || winner.raw.ownerId || winner.raw.userId || winner.raw.uid) as string | undefined;
          const wPhone = normPhone(winner.phone);
          const wEmail = normEmail(winner.email);
          if (ownerUid) byOwnerKey.set(`${r.role}:${ownerUid}`, winner);
          if (wUid) byOwnerKey.set(`${r.role}:${wUid}`, winner);
          if (pPhone) byNormalizedPhone.set(`${r.role}:${pPhone}`, winner);
          if (wPhone) byNormalizedPhone.set(`${r.role}:${wPhone}`, winner);
          if (pEmail) byNormalizedEmail.set(`${r.role}:${pEmail}`, winner);
          if (wEmail) byNormalizedEmail.set(`${r.role}:${wEmail}`, winner);
          byPartnerId.set(`${r.role}:${r.partnerId}`, winner);
          byPartnerId.set(`${r.role}:${existing.partnerId}`, winner);
        }
      }

      setRows(Array.from(dedupedMap.values()));
      setLoading(false);
    };

    const unsubs = ROLE_COLLECTIONS.map(({ role, collection: name }) =>
      onSnapshot(
        query(collection(db, name), limit(1500)),
        (snap) => {
          loaded[role] = snap.docs
            .map((d) => {
              const data = d.data() as Record<string, any>;
              if (data.isDeleted === true || data.deleted === true || data.archived === true) return null;
              if (role === "vendor" && data.parentId) return null;

              const ob = (data.onboarding ?? {}) as Record<string, any>;
              const bank = (data.bank ?? {}) as Record<string, any>;
              const documents = (data.documents ?? {}) as Record<string, any>;

              const expiringSoon: PartnerRow["expiringSoon"] = [];
              const now = Date.now();
              for (const [id, doc] of Object.entries(documents)) {
                const ms = toMillis((doc as { expiresAt?: unknown })?.expiresAt);
                if (ms !== null && ms >= now && ms <= now + WARN_WINDOW_MS) {
                  expiringSoon.push({ id, label: id, expiresAt: ms });
                }
              }

              return {
                id: `${role}:${d.id}`,
                role,
                partnerId: d.id,
                name: String(data.name ?? data.displayName ?? d.id),
                email: data.email ?? data.ownerEmail,
                phone: data.phone ?? data.ownerPhone,
                state: (ob.state ?? "started") as OnboardingState,
                steps: (ob.steps ?? {}) as Record<string, boolean>,
                stepReviews: (ob.stepReviews ?? {}) as PartnerRow["stepReviews"],
                businessStructure: ob.businessStructure ?? data.businessStructure,
                zoneId: ob.zoneId ?? data.zoneId ?? null,
                zoneName: data.zoneName ?? null,
                blockingReasons: Array.isArray(ob.blockingReasons)
                  ? ob.blockingReasons.map(String)
                  : [],
                bankState: (bank.verificationState ?? "not_added") as BankVerificationState,
                bankMessage: bank.verificationMessage,
                documents,
                expiringSoon,
                riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags.map(String) : [],
                submittedAt: toMillis(ob.submittedAt) ?? undefined,
                raw: data,
              } as PartnerRow;
            })
            .filter(Boolean) as PartnerRow[];
          flush();
        },
        (err) => {
          console.error(`[OnboardingCommandCenter] ${name} listener failed`, err);
          toast.error(`Couldn't load ${name}.`);
          loaded[role] = [];
          flush();
        },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const contacts = usePartnerContacts();
  const joinedRows = useMemo(
    () =>
      rows.map((r) => {
        const c = contacts[partnerDocKey(r.role, r.partnerId)];
        if (!c) return r;
        return { ...r, email: partnerEmail(c) || r.email, phone: r.phone || c.ownerPhone };
      }),
    [rows, contacts],
  );

  const openRow = useMemo(
    () => (open ? joinedRows.find((r) => r.id === open.id) ?? open : null),
    [open, joinedRows],
  );

  const matchesQueue = (r: PartnerRow, key: string): boolean => {
    if (key === "bank_pending") {
      return (
        r.bankState !== "verified" &&
        r.bankState !== "not_added" &&
        r.state !== "active"
      );
    }
    if (key === "expiring") return r.expiringSoon.length > 0;
    const q = ADMIN_QUEUES.find((x) => x.key === key);
    return q ? q.states.includes(r.state) : true;
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const q of ADMIN_QUEUES) c[q.key] = joinedRows.filter((r) => matchesQueue(r, q.key)).length;
    for (const q of DERIVED_QUEUES) c[q.key] = joinedRows.filter((r) => matchesQueue(r, q.key)).length;
    return c;
  }, [joinedRows]);

  const visible = useMemo(() => {
    let list = joinedRows.filter((r) => matchesQueue(r, queue));

    if (roleFilter !== "all") {
      list = list.filter((r) => r.role === roleFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.email && r.email.toLowerCase().includes(q)) ||
          (r.phone && r.phone.toLowerCase().includes(q)) ||
          r.partnerId.toLowerCase().includes(q) ||
          (r.zoneName && r.zoneName.toLowerCase().includes(q)) ||
          (r.businessStructure && r.businessStructure.toLowerCase().includes(q)),
      );
    }

    return list;
  }, [joinedRows, queue, roleFilter, searchQuery]);

  const handleQuickActivate = async (partner: PartnerRow) => {
    try {
      await adminActionToast(
        "transitionOnboarding",
        {
          role: partner.role,
          partnerId: partner.partnerId,
          to: "active",
          reason: "Activated from Onboarding table",
          overrideGates: false,
        },
        `${partner.name} activated successfully!`,
      );
    } catch (err) {
      console.error("Quick activate failed:", err);
    }
  };

  const columns: ColumnDef<PartnerRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Partner",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                {r.name}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5 truncate">
                <Badge variant="outline" className="text-[9px] px-1 py-0 uppercase">
                  {ROLE_LABEL[r.role]}
                </Badge>
                {r.phone && <span className="font-mono">{r.phone}</span>}
                {r.email && <span>· {r.email}</span>}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "state",
        header: "Stage",
        cell: ({ row }) => {
          const meta = stateMeta(row.original.state);
          return (
            <Badge variant="outline" className={cn("text-[10px] font-medium", meta.className)}>
              {meta.label}
            </Badge>
          );
        },
      },
      {
        id: "progress",
        header: "Progress",
        cell: ({ row }) => {
          const steps = Object.values(row.original.steps);
          const done = steps.filter(Boolean).length;
          const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
          return (
            <div className="w-28">
              <Progress value={pct} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground mt-1">
                {done}/{steps.length} steps ({pct}%)
              </p>
            </div>
          );
        },
      },
      {
        id: "bank",
        header: "Bank",
        cell: ({ row }) => {
          const meta = bankStateMeta(row.original.bankState);
          return (
            <Badge variant="outline" className={cn("text-[10px]", meta.className)}>
              {meta.label}
            </Badge>
          );
        },
      },
      {
        id: "zone",
        header: "Zone",
        cell: ({ row }) => {
          const zId = row.original.zoneId;
          const zName = row.original.zoneName || (zId ? zones.find((z) => z.id === zId)?.name : null);
          return zId ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAssignZonePartner(row.original);
              }}
              className="hover:opacity-80 transition-opacity text-left inline-flex items-center"
              title="Click to reassign service zone"
            >
              <ZoneBadge zoneId={zId} zoneName={zName} />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAssignZonePartner(row.original);
              }}
              className="text-xs text-amber-600 hover:text-amber-700 hover:underline flex items-center gap-1 font-medium"
            >
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Assign Zone
            </button>
          );
        },
      },
      {
        id: "flags",
        header: "Attention",
        cell: ({ row }) => {
          const r = row.original;
          const bits: string[] = [];
          if (r.blockingReasons.length) bits.push(r.blockingReasons[0]);
          if (r.riskFlags.length) bits.push(r.riskFlags[0]);
          if (r.expiringSoon.length)
            bits.push(`${r.expiringSoon.length} document(s) expiring`);
          if (!bits.length) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="max-w-[240px]">
              <p className="text-xs text-rose-600 line-clamp-2">{bits[0]}</p>
              {bits.length > 1 && (
                <p className="text-[10px] text-muted-foreground">
                  +{bits.length - 1} more issues
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const r = row.original;
          const canQuickActivate = r.state === "ready_for_activation";

          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {canQuickActivate ? (
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1 px-2.5"
                  onClick={() => handleQuickActivate(r)}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Activate
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs px-2.5"
                  onClick={() => setOpen(r)}
                >
                  Review
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">Partner Actions</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setOpen(r)}>
                    <Eye className="w-3.5 h-3.5 mr-2 text-primary" />
                    Review Details
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      setContactPartner({
                        id: r.partnerId,
                        name: r.name,
                        email: r.email,
                        phone: r.phone,
                      })
                    }
                  >
                    <MessageSquare className="w-3.5 h-3.5 mr-2 text-emerald-600" />
                    Contact Partner
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAssignZonePartner(r)}>
                    <MapPin className="w-3.5 h-3.5 mr-2 text-blue-500" />
                    Assign Service Zone
                  </DropdownMenuItem>

                  {r.role === "vendor" && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() =>
                          setResetPasswordPartner({
                            id: r.partnerId,
                            name: r.name,
                            email: r.email,
                            phone: r.phone,
                          })
                        }
                      >
                        <KeyRound className="w-3.5 h-3.5 mr-2 text-amber-500" />
                        Reset Password
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/admin/vendors/${r.partnerId}`} target="_blank">
                          <ExternalLink className="w-3.5 h-3.5 mr-2" />
                          Vendor 360
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [zones],
  );

  const allQueues = [
    ...ADMIN_QUEUES.map((q) => ({ key: q.key, label: q.label })),
    ...DERIVED_QUEUES.map((q) => ({ key: q.key, label: q.label })),
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Onboarding command center"
        description="Every partner application across Kada Dine, Delivery, Host and Mess in one unified cockpit. Review documents, verify bank accounts, assign service zones, and activate partners with automatic gate validation."
        icon={ClipboardCheck}
        actions={
          <div className="flex flex-wrap gap-2">
            <PartnerPrivateSealDialog />
            <OnboardingBackfillDialog />
          </div>
        }
        stats={[
          {
            label: "Needs review",
            value: loading ? "—" : String((counts.new ?? 0) + (counts.kyc ?? 0) + (counts.verification ?? 0)),
            onClick: () => setQueue("new"),
          },
          {
            label: "Action required",
            value: loading ? "—" : String(counts.action ?? 0),
            onClick: () => setQueue("action"),
          },
          {
            label: "Ready to activate",
            value: loading ? "—" : String(counts.ready ?? 0),
            onClick: () => setQueue("ready"),
          },
          {
            label: "Active",
            value: loading ? "—" : String(counts.active ?? 0),
            onClick: () => setQueue("active"),
          },
        ]}
      />

      {/* Role Filters + Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Role Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-muted/50 rounded-xl border border-border/60">
          <Button
            size="sm"
            variant={roleFilter === "all" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5 rounded-lg"
            onClick={() => setRoleFilter("all")}
          >
            All Roles
          </Button>
          <Button
            size="sm"
            variant={roleFilter === "vendor" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5 rounded-lg gap-1.5"
            onClick={() => setRoleFilter("vendor")}
          >
            <Utensils className="w-3.5 h-3.5" />
            Restaurants
          </Button>
          <Button
            size="sm"
            variant={roleFilter === "rider" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5 rounded-lg gap-1.5"
            onClick={() => setRoleFilter("rider")}
          >
            <Bike className="w-3.5 h-3.5" />
            Riders
          </Button>
          <Button
            size="sm"
            variant={roleFilter === "host" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5 rounded-lg gap-1.5"
            onClick={() => setRoleFilter("host")}
          >
            <Hotel className="w-3.5 h-3.5" />
            Hosts
          </Button>
          <Button
            size="sm"
            variant={roleFilter === "mess" ? "default" : "ghost"}
            className="h-7 text-xs px-2.5 rounded-lg gap-1.5"
            onClick={() => setRoleFilter("mess")}
          >
            <ChefHat className="w-3.5 h-3.5" />
            Mess
          </Button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-2.5" />
          <Input
            placeholder="Search name, phone, zone, ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-9 text-xs"
          />
        </div>
      </div>

      {/* Queue Tabs */}
      <div className="flex flex-wrap gap-2">
        {allQueues.map((q) => {
          const isDerived = q.key === "expiring" || q.key === "bank_pending";
          return (
            <Button
              key={q.key}
              size="sm"
              variant={queue === q.key ? "default" : "outline"}
              className="h-8 text-xs rounded-lg"
              onClick={() => setQueue(q.key)}
            >
              {q.key === "expiring" && <CalendarClock className="h-3.5 w-3.5 mr-1" />}
              {q.key === "action" && <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
              {q.label}
              <Badge
                variant="secondary"
                className={cn(
                  "ml-2 h-5 px-1.5 text-[10px]",
                  isDerived && (counts[q.key] ?? 0) > 0 && "bg-amber-500/15 text-amber-700",
                )}
              >
                {counts[q.key] ?? 0}
              </Badge>
            </Button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading applications…
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={visible}
          searchPlaceholder="Search table…"
          exportFilename={`onboarding-${queue}`}
          onRowClick={(r) => setOpen(r)}
        />
      )}

      {/* Partner Review Sheet */}
      <OnboardingPartnerSheet
        partner={openRow}
        onClose={() => setOpen(null)}
      />

      {/* Zone Assignment Modal */}
      {assignZonePartner && (
        <AssignZoneDialog
          open={!!assignZonePartner}
          onOpenChange={(v) => !v && setAssignZonePartner(null)}
          partner={{
            role: assignZonePartner.role,
            partnerId: assignZonePartner.partnerId,
            name: assignZonePartner.name,
            zoneId: assignZonePartner.zoneId,
            zoneName: assignZonePartner.zoneName,
          }}
        />
      )}

      {/* Contact Partner Modal */}
      {contactPartner && (
        <VendorContactDialog
          open={!!contactPartner}
          onOpenChange={(v) => !v && setContactPartner(null)}
          vendor={contactPartner}
        />
      )}

      {/* Reset Password Modal (for vendors) */}
      {resetPasswordPartner && (
        <ResetPasswordDialog
          open={!!resetPasswordPartner}
          onOpenChange={(v) => !v && setResetPasswordPartner(null)}
          vendor={resetPasswordPartner}
        />
      )}
    </div>
  );
}
