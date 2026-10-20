import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileCheck2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { callableError, fmtWhen, inr, pricingAdmin } from "./pricingShared";

interface Run {
  id: string;
  at: number | null;
  trigger: string;
  days: number;
  ordersChecked: number;
  issues: number;
  high: number;
  byCode: Record<string, number>;
}

interface Issue {
  id: string;
  orderId: string;
  orderNumber: string | null;
  code: string;
  severity: "high" | "medium";
  message: string;
  expectedPaise: number | null;
  actualPaise: number | null;
}

const CODE_LABELS: Record<string, string> = {
  split_mismatch: "Split doesn't add up",
  order_total_mismatch: "Order total ≠ snapshot",
  payment_not_recorded: "Payment not recorded",
  payment_amount_mismatch: "Payment ≠ price",
  over_refunded: "Over-refunded",
  unpaid_in_progress: "Unpaid order in progress",
  rider_pay_mismatch: "Rider pay ≠ snapshot",
};

const FINANCE_ROLES = ["super_admin", "platform_admin", "finance_manager"];

export default function PricingReconciliationPage() {
  const { role } = usePermissions();
  const [runs, setRuns] = useState<Run[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pricingAdmin<{ runs: Run[]; issues: Issue[] }>("reconciliationReport", {});
      setRuns(res.runs);
      setIssues([...res.issues].sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === "high" ? -1 : 1)));
    } catch (e) {
      toast.error(callableError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow(days: number) {
    setRunning(true);
    try {
      const r = await pricingAdmin<{ ordersChecked: number; issues: number; high: number }>("runReconciliation", { days });
      toast.success(`Checked ${r.ordersChecked} orders: ${r.issues} issues (${r.high} serious).`);
      await load();
    } catch (e) {
      toast.error(callableError(e));
    } finally {
      setRunning(false);
    }
  }

  const latest = runs[0];

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Price checks"
        description="Every morning, orders priced by the engine are checked against what actually happened: payments captured, order totals, refunds, rider pay and the money split."
        icon={FileCheck2}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            {role && FINANCE_ROLES.includes(role) && (
              <Button size="sm" onClick={() => runNow(7)} disabled={running}>
                <Play className="mr-1 h-4 w-4" /> {running ? "Checking…" : "Check last 7 days"}
              </Button>
            )}
          </div>
        }
      />

      {latest ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Last check", value: fmtWhen(latest.at) },
            { label: "Orders checked", value: latest.ordersChecked.toLocaleString("en-IN") },
            { label: "Issues", value: latest.issues.toLocaleString("en-IN") },
            { label: "Serious", value: latest.high.toLocaleString("en-IN") },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-card p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      ) : (
        !loading && <p className="text-sm text-muted-foreground">No check has run yet. The first scheduled check runs at 03:00 IST.</p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Check</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>What's wrong</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Actual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && latest && issues.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Everything matched in the latest check.</TableCell></TableRow>
            )}
            {issues.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Badge variant={i.severity === "high" ? "destructive" : "secondary"}>{i.severity === "high" ? "Serious" : "Check"}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">{CODE_LABELS[i.code] ?? i.code}</TableCell>
                <TableCell>
                  <Link className="text-primary hover:underline" to={`/admin/orders/${i.orderId}`}>
                    {i.orderNumber ? `#${i.orderNumber}` : i.orderId.slice(-6)}
                  </Link>
                </TableCell>
                <TableCell className="max-w-md text-sm">{i.message}</TableCell>
                <TableCell className="text-right tabular-nums">{i.expectedPaise == null ? "—" : inr(i.expectedPaise)}</TableCell>
                <TableCell className="text-right tabular-nums">{i.actualPaise == null ? "—" : inr(i.actualPaise)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
