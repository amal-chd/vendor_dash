import { useEffect, useMemo, useState } from "react";
import {
  IndianRupee,
  Clock,
  Zap,
  AlertTriangle,
  Store,
  Truck,
  BedDouble,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards } from "@/components/admin/StatCards";
import { DataTable } from "@/components/admin/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { toast } from "sonner";
import {
  fetchPayoutConfig,
  disbursePayout,
  type PayoutConfig,
  type PayoutKind,
} from "@/lib/payouts";

const inr = (n?: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

// A settlement/request row normalised across the three payout sources.
interface UnifiedRow {
  id: string;
  kind: PayoutKind;
  name: string;
  amount: number;
  status: string;
  createdAt?: any;
  utr?: string;
}

interface LedgerRow {
  id: string;
  kind?: string;
  beneficiaryName?: string;
  amount?: number;
  status?: string;
  mode?: string;
  utr?: string;
  razorpayPayoutId?: string;
  error?: string;
}

const KIND_META: Record<PayoutKind, { label: string; icon: typeof Store; tone: string }> = {
  vendor: { label: "Vendor", icon: Store, tone: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30" },
  rider: { label: "Rider", icon: Truck, tone: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30" },
  host: { label: "Host", icon: BedDouble, tone: "text-violet-600 bg-violet-50 border-violet-200 dark:bg-violet-500/10 dark:border-violet-500/30" },
  mess: { label: "Mess", icon: Store, tone: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30" },
};

const STATUS_TONE: Record<string, string> = {
  pending: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30",
  processing: "text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30",
  queued: "text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30",
  processed: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30",
  paid: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30",
  reversed: "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30",
  failed: "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30",
  error: "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30",
};

function StatusPill({ status }: { status?: string }) {
  const s = (status || "pending").toLowerCase();
  const tone = STATUS_TONE[s] || "text-muted-foreground bg-muted border-border";
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${tone}`}>
      {s}
    </span>
  );
}

export default function PayoutRunsPage() {
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("pending");

  useEffect(() => {
    fetchPayoutConfig().then(setPayoutCfg).catch(() => setPayoutCfg(null));
  }, []);

  const vendors = useLiveCollection<any>("vendor_settlements", { orderByField: "createdAt" });
  const riders = useLiveCollection<any>("payout_requests", { orderByField: "createdAt" });
  const hosts = useLiveCollection<any>("host_settlements", { orderByField: "createdAt" });
  const ledger = useLiveCollection<LedgerRow>("payouts", { orderByField: "createdAt" });

  const rows: UnifiedRow[] = useMemo(() => {
    const v = vendors.rows.map((s) => ({
      id: s.id,
      kind: "vendor" as const,
      name: s.restaurantName || "Vendor",
      amount: Number(s.netPayout ?? 0),
      status: String(s.status ?? "pending"),
      createdAt: s.createdAt,
      utr: s.utrNumber,
    }));
    const r = riders.rows.map((s) => ({
      id: s.id,
      kind: "rider" as const,
      name: s.riderName || "Rider",
      amount: Number(s.amount ?? 0),
      status: String(s.status ?? "pending"),
      createdAt: s.createdAt,
      utr: s.utrNumber,
    }));
    const h = hosts.rows.map((s) => ({
      id: s.id,
      kind: "host" as const,
      name: s.hotelName || "Host",
      amount: Number(s.netPayout ?? 0),
      status: String(s.status ?? "pending"),
      createdAt: s.createdAt,
      utr: s.utrNumber,
    }));
    return [...v, ...r, ...h];
  }, [vendors.rows, riders.rows, hosts.rows]);

  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const processing = useMemo(
    () => rows.filter((r) => ["processing", "queued"].includes(r.status)),
    [rows],
  );
  const history = useMemo(() => rows.filter((r) => r.status === "paid"), [rows]);

  const pendingValue = pending.reduce((s, r) => s + r.amount, 0);
  const processingValue = processing.reduce((s, r) => s + r.amount, 0);
  const failedCount = ledger.rows.filter((l) =>
    ["failed", "reversed", "error"].includes(String(l.status)),
  ).length;

  const pay = async (row: UnifiedRow) => {
    if (!payoutCfg?.configured) {
      toast.error("RazorpayX isn't configured — set RAZORPAY_ACCOUNT_NUMBER to enable payouts.");
      return;
    }
    setPayingId(row.id);
    try {
      const res = await disbursePayout(row.kind, row.id);
      toast.success(`${KIND_META[row.kind].label} payout initiated (${inr(res.amount)}) — ${res.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payout failed");
    } finally {
      setPayingId(null);
    }
  };

  const payAllPending = async () => {
    if (!payoutCfg?.configured) {
      toast.error("RazorpayX isn't configured yet.");
      return;
    }
    if (!pending.length) return;
    toast.info(`Initiating ${pending.length} payouts…`);
    let ok = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        await disbursePayout(row.kind, row.id);
        ok++;
      } catch {
        failed++;
      }
    }
    if (ok) toast.success(`${ok} initiated${failed ? `, ${failed} failed` : ""}`);
    else toast.error(`All ${failed} failed`);
  };

  const kindCell = (kind: PayoutKind) => {
    const m = KIND_META[kind];
    const Icon = m.icon;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${m.tone}`}>
        <Icon className="h-3 w-3" /> {m.label}
      </span>
    );
  };

  const baseCols: ColumnDef<UnifiedRow>[] = useMemo(
    () => [
      { accessorKey: "name", header: "Beneficiary", cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
      { id: "kind", header: "Type", cell: ({ row }) => kindCell(row.original.kind) },
      { accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="font-bold text-emerald-600">{inr(row.original.amount)}</span> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} /> },
    ],
    [],
  );

  const pendingCols: ColumnDef<UnifiedRow>[] = useMemo(
    () => [
      ...baseCols,
      {
        id: "actions",
        header: () => <div className="text-right">Action</div>,
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              size="sm"
              className="h-8 bg-primary/90 hover:bg-primary"
              disabled={payingId === row.original.id || !payoutCfg?.configured}
              title={payoutCfg?.configured ? "Disburse via RazorpayX" : "RazorpayX not configured"}
              onClick={() => pay(row.original)}
            >
              <Zap className="h-3.5 w-3.5 mr-1" />
              {payingId === row.original.id ? "Paying…" : "Pay"}
            </Button>
          </div>
        ),
      },
    ],
    [baseCols, payingId, payoutCfg],
  );

  const historyCols: ColumnDef<UnifiedRow>[] = useMemo(
    () => [
      ...baseCols,
      { accessorKey: "utr", header: "UTR / Ref", cell: ({ row }) => <span className="font-mono text-xs">{row.original.utr || "—"}</span> },
    ],
    [baseCols],
  );

  const ledgerCols: ColumnDef<LedgerRow>[] = useMemo(
    () => [
      { accessorKey: "beneficiaryName", header: "Beneficiary", cell: ({ row }) => <span className="font-semibold">{row.original.beneficiaryName || "—"}</span> },
      { accessorKey: "kind", header: "Type", cell: ({ row }) => <span className="capitalize text-muted-foreground">{row.original.kind || "—"}</span> },
      { accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="font-bold">{inr(row.original.amount)}</span> },
      { accessorKey: "mode", header: "Mode", cell: ({ row }) => <Badge variant="outline" className="text-[10px]">{row.original.mode || "—"}</Badge> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} /> },
      { accessorKey: "utr", header: "UTR", cell: ({ row }) => <span className="font-mono text-xs">{row.original.utr || "—"}</span> },
      { accessorKey: "razorpayPayoutId", header: "Payout ID", cell: ({ row }) => <span className="font-mono text-[10px] text-muted-foreground">{row.original.razorpayPayoutId || "—"}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Payout Runs"
        description="One console for every money-out: vendor settlements, rider earnings and host payouts — disbursed to bank/UPI in one click via RazorpayX, tracked to completion."
        icon={IndianRupee}
        actions={
          pending.length > 0 && (
            <Button onClick={payAllPending} disabled={!payoutCfg?.configured} className="bg-emerald-600 hover:bg-emerald-700">
              <Zap className="h-4 w-4 mr-2" /> Pay all {pending.length} pending
            </Button>
          )
        }
      />

      {payoutCfg && !payoutCfg.configured && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-semibold">RazorpayX payouts not fully configured</p>
            <p className="text-amber-800/90">
              {payoutCfg.hasKeys
                ? "Razorpay keys are set, but RAZORPAY_ACCOUNT_NUMBER (the source account to pay from) is missing. Add it to enable one-click disbursals."
                : "Razorpay keys aren't set on the server. Payouts are disabled until keys and the source account number are configured."}
            </p>
          </div>
        </div>
      )}
      {payoutCfg?.configured && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300">
          <Zap className="h-4 w-4 text-emerald-500" />
          <span>RazorpayX payouts live{payoutCfg.live ? "" : " (test mode)"} · key {payoutCfg.keyIdMasked}.</span>
        </div>
      )}

      <StatCards
        stats={[
          { label: "Pending", value: inr(pendingValue), hint: `${pending.length} payout${pending.length === 1 ? "" : "s"} to run`, tone: "text-amber-600", icon: Clock, onClick: () => setActiveTab("pending"), active: activeTab === "pending" },
          { label: "Processing", value: inr(processingValue), hint: `${processing.length} with RazorpayX`, tone: "text-sky-600", icon: RefreshCw, onClick: () => setActiveTab("processing"), active: activeTab === "processing" },
          { label: "Paid", value: inr(history.reduce((s, r) => s + r.amount, 0)), hint: `${history.length} payouts`, tone: "text-emerald-600", icon: CheckCircle2, onClick: () => setActiveTab("history"), active: activeTab === "history" },
          { label: "Failed / reversed", value: failedCount, hint: "Needs a retry", tone: "text-rose-600", icon: AlertTriangle, onClick: () => setActiveTab("ledger"), active: activeTab === "ledger" },
        ]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending"><Clock className="mr-2 h-4 w-4" />Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="processing"><RefreshCw className="mr-2 h-4 w-4" />Processing ({processing.length})</TabsTrigger>
          <TabsTrigger value="history"><CheckCircle2 className="mr-2 h-4 w-4" />Paid ({history.length})</TabsTrigger>
          <TabsTrigger value="ledger"><IndianRupee className="mr-2 h-4 w-4" />RazorpayX Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="pt-4">
          <DataTable columns={pendingCols} data={pending} searchPlaceholder="Search beneficiaries…" exportFilename="pending-payouts" />
        </TabsContent>
        <TabsContent value="processing" className="pt-4">
          <DataTable columns={historyCols} data={processing} searchPlaceholder="Search…" exportFilename="processing-payouts" />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <DataTable columns={historyCols} data={history} searchPlaceholder="Search…" exportFilename="paid-payouts" />
        </TabsContent>
        <TabsContent value="ledger" className="pt-4">
          <DataTable columns={ledgerCols} data={ledger.rows} searchPlaceholder="Search payouts…" exportFilename="razorpayx-ledger" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
