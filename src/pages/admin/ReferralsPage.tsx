import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Gift, ShieldAlert, AlertTriangle, Settings, Activity, FileText } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { FilterChips } from "@/components/admin/FilterChips";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { toast } from "sonner";
import { formatMoney } from "@/lib/currency";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Referral {
  id: string;
  referrerUid?: string;
  refereeUid?: string;
  code?: string;
  participantType?: string;
  programId?: string;
  status?: string;
  referrerReward?: number;
  refereeReward?: number;
  fraudScore?: number;
  fraudFlags?: string[];
  qualifyingActionId?: string;
  qualifyingAction?: string;
  reversalReason?: string;
  approvedBy?: string;
  reversedBy?: string;
  createdAt?: { toDate?: () => Date };
  rewardedAt?: { toDate?: () => Date };
  reversedAt?: { toDate?: () => Date };
}

interface ReferralFraudSignal {
  id: string;
  referrerUid?: string;
  refereeUid?: string;
  type?: string;
  score?: number;
  flags?: string[];
  createdAt?: { toDate?: () => Date };
}

interface ReferralProgram {
  id: string;
  participantType?: string;
  referrerReward?: number;
  refereeReward?: number;
  qualifyingAction?: string;
  isActive?: boolean;
  maxReferralsPerUser?: number;
}

interface LoyaltyConfig {
  id: string;
  [key: string]: any;
}

function when(ts?: { toDate?: () => Date }) {
  try {
    return ts?.toDate?.().toLocaleDateString("en-IN") ?? "—";
  } catch {
    return "—";
  }
}

function dateTime(ts?: { toDate?: () => Date }) {
  try {
    return ts?.toDate?.().toLocaleString("en-IN") ?? "—";
  } catch {
    return "—";
  }
}

const uidLink = (uid?: string) =>
  uid ? (
    <Link className="text-primary font-mono text-xs hover:underline" to={`/admin/consumers?search=${encodeURIComponent(uid)}`}>
      {uid.slice(0, 10)}…
    </Link>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

export default function ReferralsPage() {
  const { rows: referrals, loading: loadingReferrals } = useLiveCollection<Referral>("referrals", { orderByField: "createdAt" });
  const { rows: signals, loading: loadingSignals } = useLiveCollection<ReferralFraudSignal>("referral_fraud_signals", { orderByField: "createdAt" });
  const { rows: programs, loading: loadingPrograms } = useLiveCollection<ReferralProgram>("referral_programs");
  const { rows: loyaltyConfigs } = useLiveCollection<LoyaltyConfig>("config");

  const [filter, setFilter] = useState("all");
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // --- REAL ADMIN ACTIONS (server callables, audited backend-side) ---
  const approveReferral = async (referralId: string) => {
    const fn = httpsCallable(functions, "approveReferralReward");
    await fn({ referralId });
  };
  const reverseReferral = async (referralId: string, reason: string) => {
    const fn = httpsCallable(functions, "reverseReferralReward");
    await fn({ referralId, reason });
  };

  // Bulk-approve qualified referrals; each is processed independently so one
  // failure doesn't abort the run. The live listener updates rows on success.
  const bulkApprove = async (rows: Referral[]) => {
    const targets = rows.filter((r) => r.id);
    if (!targets.length) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const r of targets) {
      try {
        await approveReferral(r.id);
        ok++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (ok) toast.success(`Approved ${ok} referral reward${ok > 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}`);
    else toast.error(`All ${failed} approvals failed`);
  };

  const bulkReverse = async (rows: Referral[]) => {
    const targets = rows.filter((r) => r.id && r.status === "rewarded");
    if (!targets.length) {
      toast.error("Select rewarded referrals to reverse.");
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (const r of targets) {
      try {
        await reverseReferral(r.id, "Bulk reversal by admin");
        ok++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (ok) toast.success(`Reversed ${ok} referral${ok > 1 ? "s" : ""}${failed ? `, ${failed} failed` : ""}`);
    else toast.error(`All ${failed} reversals failed`);
  };

  // --- STATS ---
  const totalReferrals = referrals.length;
  const rewarded = referrals.filter((r) => (r.status || "") === "rewarded").length;
  const conversionRate = totalReferrals > 0 ? ((rewarded / totalReferrals) * 100).toFixed(1) : "0";
  const creditsPaid = referrals.reduce((sum, r) => {
    if (r.status === "rewarded") {
      return sum + (r.referrerReward || 0) + (r.refereeReward || 0);
    }
    return sum;
  }, 0);
  // Same rule as the ledger's Pending filter: no status yet means pending.
  const pendingReview = referrals.filter((r) => (r.status || "pending") === "pending").length;
  const highFraudFlags = signals.filter(s => (s.score || 0) > 80).length;
  const activePrograms = programs.filter(p => p.isActive).length;

  const visibleReferrals = useMemo(
    () => referrals.filter((r) => (filter === "all" ? true : (r.status || "pending") === filter)),
    [referrals, filter]
  );

  // --- STATUS DIST & PARTICIPANT BREAKDOWN ---
  const participantCounts = referrals.reduce((acc, r) => {
    const type = r.participantType || "customer";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statusCounts = referrals.reduce((acc, r) => {
    const status = r.status || "pending";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topReferrers = useMemo(() => {
    const counts = referrals.reduce((acc, r) => {
      if (r.referrerUid) {
        acc[r.referrerUid] = (acc[r.referrerUid] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [referrals]);

  // --- COLUMNS ---
  const ledgerColumns: ColumnDef<Referral>[] = useMemo(
    () => [
      { accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-mono font-semibold">{row.original.code || "—"}</span> },
      { id: "referrer", header: "Referrer", cell: ({ row }) => uidLink(row.original.referrerUid) },
      { id: "referee", header: "Referee", cell: ({ row }) => uidLink(row.original.refereeUid) },
      {
        accessorKey: "participantType",
        header: "Type",
        cell: ({ row }) => <Badge variant="secondary" className="capitalize">{row.original.participantType || "customer"}</Badge>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status || "pending";
          let colorClass = "border-muted text-muted-foreground";
          if (s === "rewarded") colorClass = "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300";
          if (s === "pending") colorClass = "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300";
          if (s === "reversed" || s === "failed") colorClass = "border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300";
          if (s === "qualified") colorClass = "border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-300";
          return <Badge variant="outline" className={colorClass + " capitalize"}>{s}</Badge>;
        },
      },
      {
        id: "referrerReward",
        header: "Referrer Rwd",
        cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.referrerReward || 0)}</span>,
      },
      {
        id: "refereeReward",
        header: "Referee Rwd",
        cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.refereeReward || 0)}</span>,
      },
      {
        accessorKey: "fraudScore",
        header: "Fraud Score",
        cell: ({ row }) => {
          const score = row.original.fraudScore || 0;
          return (
            <span className={score > 70 ? "text-rose-600 font-bold" : score > 40 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
              {score}
            </span>
          );
        },
      },
      { id: "created", header: "Created", cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{when(row.original.createdAt)}</span> },
      { id: "rewardedAt", header: "Rewarded", cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{when(row.original.rewardedAt)}</span> },
    ],
    []
  );

  const fraudColumns: ColumnDef<ReferralFraudSignal>[] = useMemo(
    () => [
      { id: "referrer", header: "Referrer", cell: ({ row }) => uidLink(row.original.referrerUid) },
      { id: "referee", header: "Referee", cell: ({ row }) => uidLink(row.original.refereeUid) },
      { accessorKey: "type", header: "Type", cell: ({ row }) => <span className="capitalize">{row.original.type || "—"}</span> },
      {
        accessorKey: "score",
        header: "Score",
        cell: ({ row }) => {
          const score = row.original.score || 0;
          return (
            <Badge variant="outline" className={score > 80 ? "border-rose-500 text-rose-700 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300" : score > 50 ? "border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300" : ""}>
              {score}
            </Badge>
          );
        },
      },
      { id: "flags", header: "Flags", cell: ({ row }) => <div className="max-w-[200px] truncate text-xs text-muted-foreground">{(row.original.flags || []).join(", ")}</div> },
      { id: "created", header: "Date", cell: ({ row }) => <span className="text-xs text-muted-foreground">{when(row.original.createdAt)}</span> },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Referrals"
        description="Invites, rewards and fraud checks across customers, vendors, riders and hosts."
        icon={Gift}
      />

      <StatCards
        stats={[
          { label: "Referrals", value: totalReferrals, loading: loadingReferrals },
          { label: "Conversion", value: `${conversionRate}%`, hint: `${rewarded} rewarded`, tone: "text-emerald-600" },
          { label: "Credits paid", value: formatMoney(creditsPaid), hint: "Referrer + referee rewards" },
          { label: "Pending review", value: pendingReview, hint: "Approve or reverse in Ledger", tone: "text-amber-600" },
          { label: "Fraud flags", value: highFraudFlags, hint: "Risk score above 80", tone: "text-rose-600" },
          { label: "Active programs", value: activePrograms, tone: "text-blue-600" },
        ]}
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="fraud">Fraud & Risk</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">By Participant</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(participantCounts).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="capitalize text-sm font-medium">{type}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                  {Object.keys(participantCounts).length === 0 && <span className="text-sm text-muted-foreground">No data</span>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <span className="capitalize text-sm font-medium">{status}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                  {Object.keys(statusCounts).length === 0 && <span className="text-sm text-muted-foreground">No data</span>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Top Referrers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {topReferrers.map(([uid, count]) => (
                    <div key={uid} className="flex items-center justify-between">
                      {uidLink(uid)}
                      <span className="font-semibold text-sm">{count}</span>
                    </div>
                  ))}
                  {topReferrers.length === 0 && <span className="text-sm text-muted-foreground">No referrers</span>}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4">
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: "All" },
              { id: "pending", label: "Pending" },
              { id: "qualified", label: "Qualified" },
              { id: "rewarded", label: "Rewarded" },
              { id: "reversed", label: "Reversed" },
              { id: "failed", label: "Failed" },
            ]}
          />
          <DataTable
            columns={ledgerColumns}
            data={visibleReferrals}
            searchPlaceholder="Search code or user id…"
            exportFilename="referrals_ledger"
            onRowClick={(row) => {
              setSelectedReferral(row);
              setDrawerOpen(true);
            }}
            bulkActions={[
              { label: "Approve Selected", onSelected: (rows) => bulkApprove(rows as Referral[]) },
              { label: "Reverse Selected", onSelected: (rows) => bulkReverse(rows as Referral[]), destructive: true },
            ]}
          />
        </TabsContent>

        <TabsContent value="programs" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {programs.map((p) => (
              <Card key={p.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="capitalize">{p.participantType || "Unknown"} Program</CardTitle>
                      <CardDescription className="mt-1 font-mono text-xs text-muted-foreground">{p.id}</CardDescription>
                    </div>
                    <Badge variant={p.isActive ? "default" : "secondary"}>
                      {p.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Referrer Reward</p>
                      <p className="font-semibold">{formatMoney(p.referrerReward || 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Referee Reward</p>
                      <p className="font-semibold">{formatMoney(p.refereeReward || 0)}</p>
                    </div>
                    <div className="col-span-2 mt-1">
                      <p className="text-muted-foreground text-xs">Qualifying Action</p>
                      <p className="font-medium">{p.qualifyingAction || "—"}</p>
                    </div>
                    {p.maxReferralsPerUser && (
                      <div className="col-span-2 mt-1">
                        <p className="text-muted-foreground text-xs">Max Referrals Per User</p>
                        <p className="font-medium">{p.maxReferralsPerUser}</p>
                      </div>
                    )}
                  </div>

                </CardContent>
              </Card>
            ))}
            {programs.length === 0 && !loadingPrograms && (
              <p className="text-sm text-muted-foreground">No referral programs found.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="fraud">
          <DataTable
            columns={fraudColumns}
            data={signals}
            searchPlaceholder="Search fraud signals…"
            exportFilename="referrals_fraud_signals"
          />
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Global Referral Settings</CardTitle>
                <CardDescription>System-wide thresholds and toggles.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Feature Flag (Global Enable)</span>
                  <Badge variant="outline">Enabled</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Max Daily Credits per User</span>
                  <span className="text-sm font-semibold">{formatMoney(1000)}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Loyalty Integration</CardTitle>
                <CardDescription>Fallback rewards and limits.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Default Referrer Reward</span>
                  <span className="text-sm font-semibold">{formatMoney(50)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Default Referee Reward</span>
                  <span className="text-sm font-semibold">{formatMoney(50)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Drawer for Referral Details */}
      {selectedReferral && (
        <EntityDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          icon={Gift}
          title={`Referral ${selectedReferral.code}`}
          subtitle={`Program: ${selectedReferral.programId || "Default"}`}
          status={selectedReferral.status || "pending"}
          statusTone={(selectedReferral.status === "rewarded" ? "positive" : selectedReferral.status === "pending" ? "caution" : selectedReferral.status === "reversed" ? "critical" : "neutral") as any}
          metrics={[
            { label: "Referrer Rwd", value: formatMoney(selectedReferral.referrerReward || 0) },
            { label: "Referee Rwd", value: formatMoney(selectedReferral.refereeReward || 0) },
            { label: "Fraud Score", value: selectedReferral.fraudScore || "0" },
          ]}
          actions={
            <>
              {selectedReferral.status === "rewarded" && (
                <Button variant="destructive" size="sm" onClick={() => setReverseDialogOpen(true)}>
                  Reverse Rewards
                </Button>
              )}
              {selectedReferral.status === "pending" && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await approveReferral(selectedReferral.id);
                      toast.success("Referral reward approved");
                      setDrawerOpen(false);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Approval failed");
                    }
                  }}
                >
                  Approve Qualification
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-sm mb-3">Lifecycle Timeline</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Created At</span>
                  <span>{dateTime(selectedReferral.createdAt)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Rewarded At</span>
                  <span>{dateTime(selectedReferral.rewardedAt)}</span>
                </div>
                {selectedReferral.reversedAt && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Reversed At</span>
                    <span>{dateTime(selectedReferral.reversedAt)}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-sm mb-3">Participants</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Referrer</span>
                  <span>{uidLink(selectedReferral.referrerUid)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Referee</span>
                  <span>{uidLink(selectedReferral.refereeUid)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Type</span>
                  <span className="capitalize">{selectedReferral.participantType || "Customer"}</span>
                </div>
              </div>
            </div>

            {(selectedReferral.fraudFlags || []).length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-3 text-rose-600">Fraud Signals</h3>
                <div className="bg-rose-50 border border-rose-100 rounded-md p-3 dark:bg-rose-500/10 dark:border-rose-500/30">
                  <ul className="list-disc pl-4 space-y-1">
                    {selectedReferral.fraudFlags?.map((flag, i) => (
                      <li key={i} className="text-xs text-rose-700">{flag}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </EntityDrawer>
      )}

      {/* Dialog for Reversal */}
      {selectedReferral && (
        <ConfirmationDialog
          open={reverseDialogOpen}
          onOpenChange={setReverseDialogOpen}
          title="Reverse Referral Rewards"
          description={`Are you sure you want to reverse the rewards for referral code ${selectedReferral.code}?`}
          consequences={[
            `Referrer will have ${formatMoney(selectedReferral.referrerReward || 0)} deducted from their wallet.`,
            `Referee will have ${formatMoney(selectedReferral.refereeReward || 0)} deducted from their wallet.`,
            "Status will be changed to 'reversed'.",
          ]}
          requireReason={true}
          confirmLabel="Reverse Rewards"
          onConfirm={async (reason) => {
            try {
              await reverseReferral(selectedReferral.id, reason || "Reversed by admin");
              toast.success("Referral rewards reversed");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Reversal failed");
            } finally {
              setReverseDialogOpen(false);
              setDrawerOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}
