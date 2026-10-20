import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { confirmDialog, promptDialog } from "@/components/admin/core/asyncDialogs";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, query, doc, updateDoc, where, getDocs, limit } from "firebase/firestore";
import { listenCollection } from "@/hooks/useLiveCollection";
import { useAdminScope } from "@/hooks/useAdminScope";
import { ZoneBadge } from "@/components/admin/zones/ZoneScopeBar";
import { HealthChip } from "@/components/admin/ops/OpsAlerts";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { publicBankLabel } from "@/lib/onboarding";
import { toast } from "sonner";
import { Loader2, Bike, ShieldCheck, ExternalLink, MoreHorizontal, Wallet, Zap, Trophy, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DeliveryBrandLockup } from "@/components/admin/delivery/DeliveryBrandLockup";
import { RiderEarningsRepair } from "@/components/admin/delivery/RiderEarningsRepair";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { HealthScore } from "@/components/admin/core/HealthScore";

type RiderStatus = "pending_approval" | "approved" | "rejected" | "suspended";

interface Rider {
  id: string;
  /** Server-resolved home zone, from the rider's registered base location. */
  zoneId?: string | null;
  zoneName?: string | null;
  marketId?: string | null;
  name?: string;
  phone?: string;
  email?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  aadhaarNumber?: string;
  panNumber?: string;
  /** Public summary only — full details live in partner_private. */
  bank?: { accountMasked?: string; ifscBank?: string | null };
  status?: RiderStatus;
  isOnline?: boolean;
  cashInHand?: number;
  lifetimeDeliveries?: number;
  earnings?: { today?: number; week?: number; lifetime?: number };
  paidOut?: number;
  payoutPending?: boolean;
  documents?: Record<string, string>;
  createdAt?: any;
}

const inr = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

const statusClasses = (s?: RiderStatus) =>
  s === "approved" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" :
  s === "rejected" ? "bg-rose-500/10 border-rose-500/20 text-rose-600" :
  s === "suspended" ? "bg-slate-500/10 border-slate-500/20 text-muted-foreground" :
  "bg-amber-500/10 border-amber-500/20 text-amber-600";

const statusLabel = (s?: RiderStatus) =>
  s === "pending_approval" ? "pending" : (s || "pending");

/**
 * Government ids are shown masked in lists — the full Aadhaar/PAN sat in every
 * table row and screenshot. Verification uses the KYC documents, not the list.
 */
function maskId(v: string): string {
  const t = String(v).replace(/\s+/g, "");
  return t.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, t.length - 4))}${t.slice(-4)}`;
}

export default function FleetPage() {
  const { user } = useAuth();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [permError, setPermError] = useState(false);
  // Surge + daily quest are edited in Platform Settings; shown here read-only.
  const [deliveryCfg, setDeliveryCfg] = useState<{ surgeActive: boolean; surgeFee: number; questTotal: number; questTop: number }>({
    surgeActive: false, surgeFee: 0, questTotal: 0, questTop: 0,
  });
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [activeTab, setActiveTab] = useState<string>("All");
  const { matches: inScope, isAll: allAreas } = useAdminScope();
  const { rows: healthRows } = useLiveCollection<any>("rider_health", { limit: 2000 });
  const healthById = useMemo(() => new Map<string, any>(healthRows.map((h) => [h.id, h])), [healthRows]);
  // One phone on several rider accounts usually means re-signups or test
  // accounts — and splits one person's cash and earnings across them.
  const phoneCounts = useMemo(() => {
    const m = new Map<string, number>();
    riders.forEach((r) => {
      const k = String(r.phone || "").replace(/\D/g, "").slice(-10);
      if (k.length === 10) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [riders]);

  useEffect(() => {
    const unsub = listenCollection<Rider>(
      "delivery_users",
      { orderByField: "createdAt", limit: 500 },
      (next) => {
        setRiders(next);
        setPermError(false);
        setLoading(false);
      },
      (err) => {
        console.error("Fleet load failed:", err);
        const isPermission = err.message.includes("permission");
        if (isPermission) {
          setPermError(true);
          toast.error("Permission denied — only platform admins can view the rider fleet.");
        } else {
          toast.error("Failed to load riders");
        }
        setLoading(false);
      },
    );

    const unsubSurge = onSnapshot(doc(db, "settings", "delivery"), (snap) => {
      const d = snap.data() ?? {};
      const tiers = Array.isArray(d.questTiers) ? (d.questTiers as { trips: number; bonus: number }[]) : [];
      setDeliveryCfg({
        surgeActive: d.surgeActive === true,
        surgeFee: Number(d.surgeFee) || 0,
        questTotal: tiers.reduce((s, t) => s + (Number(t.bonus) || 0), 0) || Number(d.questBonus) || 0,
        questTop: tiers.length ? Math.max(...tiers.map((t) => Number(t.trips) || 0)) : Number(d.questTarget) || 0,
      });
    }, (err) => console.error("FleetPage: delivery settings listener error:", err));

    return () => {
      unsub();
      unsubSurge();
    };
  }, []);


  const runAction = async (
    fn: "approveRider" | "rejectRider" | "suspendRider" | "settleRiderCash",
    uid: string,
    reason?: string,
  ) => {
    try {
      const callable = httpsCallable(functions, fn);
      const res: any = await callable({ uid, ...(reason ? { reason } : {}) });
      if (fn === "settleRiderCash") {
        toast.success(`Settled ${inr(res?.data?.settled)} cash`);
      } else {
        toast.success(`Rider ${res?.data?.status ?? "updated"}`);
      }
    } catch (e: any) {
      console.error(`${fn} failed`, e);
      toast.error(e?.message ?? "Action failed");
    }
  };

  const reject = async (uid: string) => {
    const reason = await promptDialog({
      title: "Reject this rider's application?",
      description: "They see this reason in the Kada Delivery app and can reapply.",
      label: "Reason",
      placeholder: "e.g. Driving licence photo is unreadable",
      multiline: true,
      confirmLabel: "Reject application",
      destructive: true,
    });
    if (reason === null) return;
    runAction("rejectRider", uid, reason);
  };
  const suspend = async (uid: string) => {
    const reason = await promptDialog({
      title: "Suspend this rider?",
      description: "They go offline immediately and can't take deliveries until approved again.",
      label: "Reason",
      multiline: true,
      confirmLabel: "Suspend rider",
      destructive: true,
    });
    if (reason === null) return;
    runAction("suspendRider", uid, reason);
  };
  const settle = async (r: Rider) => {
    if ((r.cashInHand || 0) <= 0) { toast.info("No cash to settle"); return; }
    if (
      await confirmDialog({
        title: `Collected ${inr(r.cashInHand)} from ${r.name}?`,
        description: "Their cash-in-hand resets to ₹0. Only confirm once the cash is with you.",
        confirmLabel: "Mark collected",
      })
    ) {
      runAction("settleRiderCash", r.id);
    }
  };

  // One callable per rider, reported by outcome rather than all-or-nothing.
  const runBulkRiderAction = async (
    rows: Rider[],
    fn: "approveRider" | "suspendRider",
    reason: string | undefined,
    verb: string,
  ) => {
    const callable = httpsCallable(functions, fn);
    const results = await Promise.allSettled(rows.map((r) => callable({ uid: r.id, ...(reason ? { reason } : {}) })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) toast.success(`${rows.length} rider${rows.length === 1 ? "" : "s"} ${verb}`);
    else toast.error(`${rows.length - failed} ${verb}, ${failed} refused — check those riders and retry.`);
  };

  // Settle a rider's pending online-earnings payout: find their pending
  // `payout_requests` doc and mark it paid via the callable.
  const settlePayout = async (r: Rider) => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "payout_requests"),
          where("riderUid", "==", r.id),
          where("status", "==", "pending"),
          limit(1),
        ),
      );
      if (snap.empty) { toast.info("No pending payout request"); return; }
      const reqDoc = snap.docs[0];
      const amount = reqDoc.data().amount as number;
      const upiId = reqDoc.data().upiId as string;
      if (
        !(await confirmDialog({
          title: `Paid ${inr(amount)} to ${r.name}?`,
          description: `Confirm you sent the money to UPI ${upiId}. The payout request is marked paid.`,
          confirmLabel: "Mark paid",
        }))
      )
        return;
      const callable = httpsCallable(functions, "settleRiderPayout");
      const res: any = await callable({ requestId: reqDoc.id });
      toast.success(`Paid out ${inr(res?.data?.paid ?? amount)}`);
    } catch (e: any) {
      console.error("settleRiderPayout failed", e);
      toast.error(e?.message ?? "Payout failed");
    }
  };

  const columns: ColumnDef<Rider>[] = useMemo(() => [
    {
      accessorKey: "name",
      header: "Rider",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex gap-4 items-start">
            <div className={cn("h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 border shadow-sm", statusClasses(r.status))}>
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link to={`/admin/delivery/${r.id}`} className="font-semibold text-foreground uppercase tracking-tight text-sm hover:text-primary transition-colors">{r.name || "Unnamed"}</Link>
                {r.isOnline && <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" title="Online" />}
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mt-1">
                {[r.vehicleType, r.vehicleNumber].filter(Boolean).join(" • ") || "—"}
              </p>
              <p className="text-[10px] font-bold text-muted-foreground">{r.phone || r.email || ""}</p>
              {(phoneCounts.get(String(r.phone || "").replace(/\D/g, "").slice(-10)) ?? 0) > 1 && (
                <p className="text-[10px] font-bold text-amber-600">
                  Same phone on {phoneCounts.get(String(r.phone || "").replace(/\D/g, "").slice(-10))} rider accounts
                </p>
              )}
              {r.aadhaarNumber && <p className="text-[10px] font-bold text-muted-foreground mt-0.5">Aadhaar: {maskId(r.aadhaarNumber)}</p>}
              {r.panNumber && <p className="text-[10px] font-bold text-muted-foreground">PAN: {maskId(r.panNumber)}</p>}
              {r.bank?.accountMasked && (
                <p className="text-[10px] font-bold text-muted-foreground">Bank: {publicBankLabel(r.bank)}</p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: "health",
      header: "Health",
      cell: ({ row }) => {
        const h = healthById.get(row.original.id);
        return <HealthChip score={h?.score} band={h?.band} signals={h?.signals} />;
      },
    },
    {
      id: "zone",
      header: "Zone",
      cell: ({ row }) => (
        <ZoneBadge zoneId={row.original.zoneId} zoneName={row.original.zoneName} />
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant="outline" className={cn("rounded-lg font-semibold uppercase text-[9px] tracking-wide px-2.5 py-1", statusClasses(row.original.status))}>
          {statusLabel(row.original.status)}
        </Badge>
      ),
    },
    {
      accessorKey: "lifetimeDeliveries",
      header: "Deliveries",
      cell: ({ row }) => (
        <span className="text-xs font-black tracking-widest">{row.original.lifetimeDeliveries || 0}</span>
      ),
    },
    {
      accessorKey: "earnings",
      header: "Earnings",
      cell: ({ row }) => (
        <div className="text-xs">
          <p className="font-black">{inr(lifetimeEarned(row.original))}</p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase">lifetime</p>
        </div>
      ),
    },
    {
      accessorKey: "cashInHand",
      header: "Cash owed",
      cell: ({ row }) => {
        const c = row.original.cashInHand || 0;
        return (
          <span className={cn("text-xs font-black", c > 0 ? "text-amber-600" : "text-muted-foreground")}>{inr(c)}</span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const r = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[180px] rounded-xl shadow-xl">
              <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fleet actions</DropdownMenuLabel>
              {r.documents && Object.entries(r.documents).map(([k, url]) => (
                <DropdownMenuItem key={k} asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold uppercase tracking-wider cursor-pointer">
                    View {k} <ExternalLink className="ml-2 h-3 w-3" />
                  </a>
                </DropdownMenuItem>
              ))}
              {(!r.documents || Object.keys(r.documents).length === 0) && (
                <DropdownMenuItem disabled className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  No KYC documents
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {r.status !== "approved" && (
                <DropdownMenuItem onClick={() => runAction("approveRider", r.id)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-emerald-600">Approve</DropdownMenuItem>
              )}
              {r.status !== "rejected" && (
                <DropdownMenuItem onClick={() => reject(r.id)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-rose-600">Reject</DropdownMenuItem>
              )}
              {r.status !== "suspended" && (
                <DropdownMenuItem onClick={() => suspend(r.id)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-muted-foreground">Suspend</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => settle(r)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-amber-600">Settle cash</DropdownMenuItem>
              {r.payoutPending && <DropdownMenuItem onClick={() => settlePayout(r)} className="text-[11px] font-bold uppercase tracking-wider cursor-pointer text-blue-600">Settle Payout</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  // healthById/phoneCounts change rarely; an empty dep list froze the Health
  // column on its first (empty) render, so it always showed "—". The action
  // handlers stay out on purpose: they read live state when called.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [healthById, phoneCounts]);

  const renderMobileCard = (r: Rider) => (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-sm space-y-3">
      <div className="flex items-start gap-4">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border", statusClasses(r.status))}>
          <Bike className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm uppercase tracking-tight text-foreground truncate pr-2">{r.name || "Unnamed"}</span>
            <Badge variant="outline" className={cn("text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5", statusClasses(r.status))}>{statusLabel(r.status)}</Badge>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">{[r.vehicleType, r.vehicleNumber].filter(Boolean).join(" • ") || "—"}</p>
          <p className="text-[10px] font-bold text-muted-foreground">{r.phone || r.email || ""}</p>
          {r.aadhaarNumber && <p className="text-[10px] font-bold text-muted-foreground mt-0.5">Aadhaar: {maskId(r.aadhaarNumber)}</p>}
          {r.panNumber && <p className="text-[10px] font-bold text-muted-foreground">PAN: {maskId(r.panNumber)}</p>}
          {r.bank?.accountMasked && <p className="text-[10px] font-bold text-muted-foreground">Bank: {publicBankLabel(r.bank)}</p>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs bg-muted/30 p-2.5 rounded-lg">
        <div><span className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Trips</span><span className="font-semibold">{r.lifetimeDeliveries || 0}</span></div>
        <div><span className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Earned</span><span className="font-semibold">{inr(lifetimeEarned(r))}</span></div>
        <div><span className="block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Cash</span><span className="font-semibold">{inr(r.cashInHand)}</span></div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pt-1">
        {r.status !== "approved" && <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600 border-emerald-500/30" onClick={() => runAction("approveRider", r.id)}>Approve</Button>}
        {r.status !== "rejected" && <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest text-rose-600 border-rose-500/30" onClick={() => reject(r.id)}>Reject</Button>}
        {r.status !== "suspended" && <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-slate-500/30" onClick={() => suspend(r.id)}>Suspend</Button>}
        {(r.cashInHand || 0) > 0 && <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest text-amber-600 border-amber-500/30" onClick={() => settle(r)}>Settle</Button>}
        {r.payoutPending && <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest text-blue-600 border-blue-500/30" onClick={() => settlePayout(r)}>Pay Out</Button>}
      </div>
    </div>
  );

  const counts = {
    pending: riders.filter((r) => r.status === "pending_approval").length,
    approved: riders.filter((r) => r.status === "approved").length,
    online: riders.filter((r) => r.isOnline).length,
    cashOwed: riders.reduce((s, r) => s + (r.cashInHand || 0), 0),
  };

  const filteredRiders = useMemo(() => {
    // Console-wide city/zone scope first, so a fleet view scoped to one zone
    // shows that zone's riders under every tab.
    const inArea = allAreas ? riders : riders.filter(inScope);
    if (activeTab === "Online Now") return inArea.filter(r => r.isOnline);
    if (activeTab === "Pending KYC") return inArea.filter(r => r.status === "pending_approval");
    if (activeTab === "Low Ratings") return inArea.filter(r => false);
    if (activeTab === "High Incidents") return inArea.filter(r => false);
    return inArea;
  }, [riders, activeTab, inScope, allAreas]);

  if (loading) {
    return (
      <PageSkeleton />
    );
  }

  if (permError || (riders.length === 0 && !loading)) {
    const adminEmails = ["thekada@gmail.com", "thekadaapp@gmail.com"];
    const isAdminEmail = user?.email && adminEmails.includes(user.email);
    return (
      <div className="space-y-6">
        <DeliveryBrandLockup
          title="Delivery Fleet"
          subtitle="0 Riders"
        />
        <Card className="rounded-2xl border-2 border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 px-8 text-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-amber-500/15 flex items-center justify-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
            <div className="space-y-2 max-w-md">
              <h2 className="text-lg font-black tracking-tight">
                {permError ? "Permission Denied" : "No Riders Found"}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {permError ? (
                  <>Only platform admin accounts can access the Delivery Fleet. You are currently signed in as <strong className="text-foreground">{user?.email || "unknown"}</strong>.  Sign in with one of the admin accounts below:</>
                ) : isAdminEmail ? (
                  <>No delivery riders have signed up yet. When a rider creates an account in the <strong>Kada Delivery</strong> app, they'll appear here for KYC review and approval.</>
                ) : (
                  <>The rider fleet requires admin access. You are signed in as <strong className="text-foreground">{user?.email || "unknown"}</strong>. Sign in with one of the admin accounts below:</>
                )}
              </p>
              {!isAdminEmail && (
                <div className="flex flex-col items-center gap-1.5 pt-2">
                  {adminEmails.map((e) => (
                    <Badge key={e} variant="outline" className="rounded-lg font-bold text-xs px-3 py-1.5 border-border">
                      {e}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <DeliveryBrandLockup
          title="Delivery Fleet"
          subtitle={`${riders.length} Riders`}
        />
        <RiderEarningsRepair />
      </div>

      {/* Surge + daily quest moved to Platform Settings (one place for
          platform-wide switches); ops still see their live state here. */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-xs font-bold">
        <span className={cn("flex items-center gap-1.5", deliveryCfg.surgeActive ? "text-amber-600" : "text-muted-foreground")}>
          <Zap className="h-3.5 w-3.5" />
          {deliveryCfg.surgeActive ? `Surge override on (+₹${deliveryCfg.surgeFee})` : "Surge: automatic peak hours"}
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Trophy className="h-3.5 w-3.5" />
          Daily quest: up to ₹{deliveryCfg.questTotal.toLocaleString("en-IN")} at {deliveryCfg.questTop} trips
        </span>
        <Link to="/admin/settings?tab=platform" className="ml-auto text-primary hover:underline">
          Edit in Platform Settings →
        </Link>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <div className="rounded-3xl bg-amber-500/10 p-6 border border-amber-500/20 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Pending Review</span>
          <span className="text-3xl font-black tracking-tighter text-amber-600">{counts.pending}</span>
        </div>
        <div className="rounded-3xl bg-emerald-500/10 p-6 border border-emerald-500/20 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Approved</span>
          <span className="text-3xl font-black tracking-tighter text-emerald-600">{counts.approved}</span>
        </div>
        <div className="rounded-3xl bg-sky-500/10 p-6 border border-sky-500/20 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">Online Now</span>
          <span className="text-3xl font-black tracking-tighter text-sky-600">{counts.online}</span>
        </div>
        <div className="rounded-3xl bg-fuchsia-500/10 p-6 border border-fuchsia-500/20 shadow-sm flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-600">Cash Owed</span>
          <span className="text-3xl font-black tracking-tighter text-fuchsia-600">{inr(counts.cashOwed)}</span>
        </div>
      </div>

      <Card className="rounded-2xl border-border/40 shadow-card overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border/40 pb-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rider Roster</CardTitle>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-amber-500">
              <ShieldCheck className="h-3 w-3" />
              {counts.pending} Action Needed
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {["All", "Online Now", "Pending KYC", "Low Ratings", "High Incidents"].map((tab) => (
              <Badge 
                key={tab} 
                variant={activeTab === tab ? "default" : "outline"}
                className={cn("cursor-pointer shrink-0 rounded-full px-3 py-1", activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable 
            columns={columns} 
            data={filteredRiders} 
            searchKey="name" 
            renderMobileCard={renderMobileCard} 
            onRowClick={(r) => setSelectedRider(r)}
            bulkActions={[
              // Bulk actions go through the same callables as the per-rider
              // buttons. They used to write `status` straight to the rider doc,
              // and "Activate" wrote "active" — a status the server never sets
              // (approval is "approved"), leaving riders in an unknown state.
              {
                label: "Suspend selected",
                destructive: true,
                icon: XCircle,
                onSelected: async (rows) => {
                  const reason = await promptDialog({
                    title: `Suspend ${rows.length} rider${rows.length === 1 ? "" : "s"}?`,
                    description: "They go offline immediately and can't take deliveries until approved again.",
                    label: "Reason",
                    multiline: true,
                    confirmLabel: "Suspend riders",
                    destructive: true,
                  });
                  if (reason === null) return;
                  await runBulkRiderAction(rows, "suspendRider", reason, "suspended");
                }
              },
              {
                label: "Approve selected",
                icon: CheckCircle2,
                onSelected: async (rows) => {
                  if (
                    !(await confirmDialog({
                      title: `Approve ${rows.length} rider${rows.length === 1 ? "" : "s"}?`,
                      description: "Approved riders can go online and receive delivery offers.",
                      confirmLabel: "Approve riders",
                    }))
                  )
                    return;
                  await runBulkRiderAction(rows, "approveRider", undefined, "approved");
                }
              }
            ]} 
          />
        </CardContent>
      </Card>

      {counts.cashOwed > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
          <Wallet className="h-3.5 w-3.5" /> Settle cash after collecting COD floats from riders during reconciliation.
        </p>
      )}

      {selectedRider && (
        <EntityDrawer
          open={!!selectedRider}
          onOpenChange={(open) => !open && setSelectedRider(null)}
          title={selectedRider.name || "Unknown Rider"}
          subtitle={selectedRider.phone || ""}
          icon={Bike}
          status={selectedRider.isOnline ? "ONLINE" : selectedRider.status?.toUpperCase() || "PENDING"}
          statusTone={selectedRider.isOnline ? "success" : selectedRider.status === "suspended" ? "danger" : "neutral"}
          detailPath={`/admin/delivery/${selectedRider.id}`}
          metrics={[
            { label: "Deliveries", value: selectedRider.lifetimeDeliveries || 0 },
            { label: "Cash owed", value: inr(selectedRider.cashInHand) },
          ]}
        >
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Quick Actions</h3>
            <div className="flex gap-2">
              {selectedRider.status !== "approved" && <Button onClick={() => runAction("approveRider", selectedRider.id)}>Approve</Button>}
              {selectedRider.status !== "rejected" && <Button variant="destructive" onClick={() => reject(selectedRider.id)}>Reject</Button>}
              {(selectedRider.cashInHand || 0) > 0 && <Button variant="outline" onClick={() => settle(selectedRider)}>Settle Cash</Button>}
            </div>
            <div className="mt-4 p-4 rounded-xl border bg-muted/20">
              <h3 className="font-semibold text-sm mb-2">Health Score</h3>
              {/* Real score from the health feed; this used to be hard-coded
                  from status (92 approved / 60 pending / 30 suspended). */}
              {typeof healthById.get(selectedRider.id)?.score === "number" ? (
                <HealthScore score={healthById.get(selectedRider.id)!.score as number} />
              ) : (
                <p className="text-xs text-muted-foreground">Not enough delivery history to score yet.</p>
              )}
            </div>
          </div>
        </EntityDrawer>
      )}
    </div>
  );
}

/**
 * Lifetime rider earnings. Older earnings were written to a stray top-level
 * "earnings.lifetime" field (a backend bug, now fixed); until the repair runs,
 * the real total is nested + stray. Exact before and after the repair.
 */
function lifetimeEarned(r: unknown): number {
  const d = (r ?? {}) as { earnings?: { lifetime?: number }; ["earnings.lifetime"]?: number };
  return (Number(d.earnings?.lifetime) || 0) + (Number(d["earnings.lifetime"]) || 0);
}
