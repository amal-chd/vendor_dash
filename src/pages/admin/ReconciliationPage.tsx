import { useEffect, useMemo, useState, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import {
  CheckCircle2,
  AlertCircle,
  Landmark,
  RefreshCw,
  Wallet,
  Receipt,
  ArrowRightLeft,
  Clock,
} from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import { Section } from "@/components/admin/entity360";
import { DataTable } from "@/components/admin/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { functions } from "@/lib/firebase";
import { toast } from "sonner";

const inr = (n?: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

interface ReconReport {
  ok: boolean;
  rangeDays: number;
  internal: { collected: number; count: number };
  gateway: { settledToBank: number; fees: number; tax: number; settlementCount: number };
  float: { unsettled: number; count: number };
  variance: number;
  lastSyncAt: number | null;
}

interface GatewaySettlement {
  id: string;
  settlementId?: string;
  amount?: number;
  fees?: number;
  tax?: number;
  utr?: string;
  status?: string;
  createdAt?: any;
}

const fmtDate = (v: any): string => {
  const ms = typeof v?.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null;
  return ms ? new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
};

export default function ReconciliationPage() {
  const [report, setReport] = useState<ReconReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [days, setDays] = useState(90);

  const settlements = useLiveCollection<GatewaySettlement>("gateway_settlements", {
    orderByField: "createdAt",
    orderDir: "desc",
  });

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable(functions, "getReconciliationReport");
      const res = await fn({ days });
      setReport(res.data as ReconReport);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load reconciliation report");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const sync = async () => {
    setSyncing(true);
    try {
      const fn = httpsCallable(functions, "syncGatewaySettlements");
      const res = await fn({});
      const d = res.data as { settlements: number; reconRows: number };
      toast.success(`Synced ${d.settlements} settlements & ${d.reconRows} recon rows from Razorpay`);
      await loadReport();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const stats: StatItem[] = useMemo(() => {
    const r = report;
    const variance = r?.variance ?? 0;
    const varianceOk = Math.abs(variance) < 1;
    return [
      {
        label: "Collected (ledger)",
        value: loading ? "…" : inr(r?.internal.collected),
        hint: `${r?.internal.count ?? 0} payments`,
        icon: <Wallet className="w-5 h-5 text-blue-500" />,
      },
      {
        label: "Settled to bank",
        value: loading ? "…" : inr(r?.gateway.settledToBank),
        hint: `${r?.gateway.settlementCount ?? 0} settlements`,
        icon: <Landmark className="w-5 h-5 text-emerald-500" />,
      },
      {
        label: "Gateway fees + GST",
        value: loading ? "…" : inr((r?.gateway.fees ?? 0) + (r?.gateway.tax ?? 0)),
        hint: "Razorpay charges",
        tone: "text-rose-600",
        icon: <Receipt className="w-5 h-5 text-rose-500" />,
      },
      {
        label: "Unsettled float",
        value: loading ? "…" : inr(r?.float.unsettled),
        hint: `${r?.float.count ?? 0} in transit to bank`,
        tone: "text-amber-600",
        icon: <Clock className="w-5 h-5 text-amber-500" />,
      },
    ];
  }, [report, loading]);

  const variance = report?.variance ?? 0;
  const varianceReconciled = Math.abs(variance) < 1;

  const cols: ColumnDef<GatewaySettlement>[] = useMemo(
    () => [
      { accessorKey: "settlementId", header: "Settlement ID", cell: ({ row }) => <span className="font-mono text-xs">{row.original.settlementId}</span> },
      { accessorKey: "amount", header: "Net to Bank", cell: ({ row }) => <span className="font-bold text-emerald-600">{inr(row.original.amount)}</span> },
      { accessorKey: "fees", header: "Fees", cell: ({ row }) => <span className="text-rose-600">-{inr(row.original.fees)}</span> },
      { accessorKey: "tax", header: "GST", cell: ({ row }) => <span className="text-rose-600">-{inr(row.original.tax)}</span> },
      { accessorKey: "utr", header: "Bank UTR", cell: ({ row }) => <span className="font-mono text-xs">{row.original.utr || "—"}</span> },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30">
            {row.original.status || "processed"}
          </Badge>
        ),
      },
      { id: "date", header: "Settled On", cell: ({ row }) => <span className="text-muted-foreground">{fmtDate(row.original.createdAt)}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Reconciliation"
        description="Traces every rupee from customer payment → Razorpay settlement → your bank account. Collected-vs-settled, gateway fees, and the float still in transit — synced live from Razorpay."
        icon={ArrowRightLeft}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 12 months</option>
            </select>
            <Button onClick={sync} disabled={syncing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync from Razorpay"}
            </Button>
          </div>
        }
      />

      {/* Reconciliation verdict banner */}
      <div
        className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
          varianceReconciled
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        } dark:bg-emerald-500/10 dark:bg-amber-500/10 dark:border-emerald-500/30 dark:border-amber-500/30 dark:text-emerald-300 dark:text-amber-300`}
      >
        {varianceReconciled ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        ) : (
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
        )}
        <div>
          <p className="font-semibold">
            {varianceReconciled
              ? "Books reconciled — collected equals settled + float"
              : `Variance of ${inr(Math.abs(variance))} between ledger and gateway`}
          </p>
          <p className="opacity-90">
            Collected {inr(report?.internal.collected)} = Settled {inr(report?.gateway.settledToBank)} + In-transit{" "}
            {inr(report?.float.unsettled)}
            {report?.lastSyncAt
              ? ` · last synced ${new Date(report.lastSyncAt).toLocaleString("en-IN")}`
              : " · not synced yet — click “Sync from Razorpay”"}
          </p>
        </div>
      </div>

      <StatCards items={stats} />

      <Section title="Gateway settlements → bank">
        {settlements.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            <Landmark className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <p className="font-medium">No settlements synced yet</p>
            <p className="text-sm">Click “Sync from Razorpay” to pull your settlement history and bank UTRs.</p>
          </div>
        ) : (
          <DataTable columns={cols} data={settlements.rows} searchPlaceholder="Search settlements / UTR…" exportFilename="gateway-settlements" />
        )}
      </Section>

      <SealOrderFinance />
    </div>
  );
}

/**
 * One-off: older orders carry the money split (commission, rider pay, Kada's
 * revenue) on the customer-readable order. Moves it to orders/{id}/finance
 * (adminPlatformAction → sealOrderFinance), 200 orders at a time.
 */
function SealOrderFinance() {
  const [state, setState] = useState<{ busy: boolean; remaining: number | null; moved: number }>({ busy: false, remaining: null, moved: 0 });
  const run = async (apply: boolean) => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const fn = httpsCallable(functions, "adminPlatformAction");
      const res = await fn({ action: "sealOrderFinance", payload: { apply } });
      const out = res.data as { matched: number; moved: number; remaining: number };
      setState((s) => ({ busy: false, remaining: out.remaining, moved: s.moved + out.moved }));
      if (apply) toast.success(`Moved ${out.moved} orders${out.remaining ? " — run again for the rest" : " — all done"}`);
    } catch (e) {
      setState((s) => ({ ...s, busy: false }));
      toast.error(e instanceof Error ? e.message : "Couldn't check orders");
    }
  };
  return (
    <Section title="Order money split privacy">
      <div className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          Older orders still store the restaurant's commission, rider pay and Kada's revenue where the customer can read them. New orders
          don't. {state.remaining == null ? "" : state.remaining === 0 ? "None left — all moved." : `${state.remaining}${state.remaining >= 200 ? "+" : ""} still to move.`}
          {state.moved > 0 && ` ${state.moved} moved this session.`}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" disabled={state.busy} onClick={() => run(false)}>
            Check
          </Button>
          <Button disabled={state.busy || state.remaining === 0} onClick={() => run(true)}>
            {state.busy ? "Working…" : "Move next 200"}
          </Button>
        </div>
      </div>
    </Section>
  );
}
