import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, AlertTriangle, CheckCircle2, TrendingDown, RefreshCw } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { FilterChips } from "@/components/admin/FilterChips";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { StatCards } from "@/components/admin/StatCards";

interface Refund {
  id: string;
  /** "stay" for a Kada Stay cancellation; absent/other = a food order refund. */
  kind?: string;
  bookingId?: string;
  hotelId?: string;
  hotelName?: string;
  orderId?: string;
  orderNumber?: string;
  restaurantName?: string;
  amount?: number;
  reason?: string;
  method?: string;
  status?: string;
  createdBy?: string;
  requestedBy?: string;
  error?: string;
  attempts?: number;
  createdAt?: { toDate?: () => Date };
}

interface ActionResult {
  refundStatus?: string;
  gatewayError?: string | null;
}

const rupees = (n?: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

/** Report what the gateway actually did — "approved" is not "refunded". */
function reportGatewayResult(amount: number | undefined, data: ActionResult | undefined, fallback: string) {
  const status = data?.refundStatus;
  if (status === "failed") {
    toast.error(`Refund of ${rupees(amount)} failed at the gateway: ${data?.gatewayError || "unknown error"}. It is listed under Failed for retry.`);
  } else if (status === "pending_execution" || status === "executing") {
    toast.info(`Refund of ${rupees(amount)} is still processing with the gateway.`);
  } else {
    toast.success(fallback);
  }
}

function when(r: Refund) {
  try {
    return r.createdAt?.toDate?.().toLocaleString("en-IN") ?? "—";
  } catch {
    return "—";
  }
}

export default function RefundsPage() {
  const { rows, loading } = useLiveCollection<Refund>("platform_refunds", { orderByField: "createdAt" });
  const [filter, setFilter] = useState("all");
  const [pendingApproval, setPendingApproval] = useState<Refund | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Refund | null>(null);
  const [retryTarget, setRetryTarget] = useState<Refund | null>(null);

  // Only money that actually reached customers counts as refunded; pending,
  // rejected and failed rows used to be summed in too.
  const sumOf = (status: string) =>
    rows.filter((r) => r.status === status).reduce((s, r) => s + Number(r.amount || 0), 0);
  const total = sumOf("completed");
  const pendingAmt = sumOf("pending_approval");
  // Money still owed to customers: a failed gateway refund AND one with no
  // gateway payment to reverse are both outstanding until somebody pays it.
  const failedRows = rows.filter((r) => r.status === "failed" || r.status === "manual_review");
  const failedAmt = failedRows.reduce((s, r) => s + Number(r.amount || 0), 0);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "all") return true;
      if (filter === "stay") return r.kind === "stay";
      if (filter === "wallet" || filter === "original") return (r.method || "") === filter;
      return (r.status || "").toLowerCase() === filter;
    });
  }, [rows, filter]);

  // Real maker-checker: approving/rejecting runs the server callable, which
  // enforces that the approver ≠ requester and only then moves the money.
  const approveRefund = async () => {
    if (!pendingApproval) return;
    const target = pendingApproval;
    setPendingApproval(null);
    try {
      const fn = httpsCallable<unknown, ActionResult>(functions, "adminPlatformAction");
      const res = await fn({ action: "approveRefund", payload: { refundId: target.id } });
      reportGatewayResult(target.amount, res.data, `Refund of ${rupees(target.amount)} approved and completed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve refund");
    }
  };

  const rejectRefund = async (reason: string) => {
    if (!rejectTarget) return;
    const target = rejectTarget;
    setRejectTarget(null);
    try {
      const fn = httpsCallable(functions, "adminPlatformAction");
      await fn({ action: "rejectRefund", payload: { refundId: target.id, reason } });
      toast.success("Refund request rejected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reject refund");
    }
  };

  const retryRefund = async () => {
    if (!retryTarget) return;
    const target = retryTarget;
    setRetryTarget(null);
    try {
      const fn = httpsCallable<unknown, ActionResult>(functions, "adminPlatformAction");
      const res = await fn({ action: "retryRefund", payload: { refundId: target.id } });
      reportGatewayResult(target.amount, res.data, `${rupees(target.amount)} refunded to the customer's original payment method`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not retry refund");
    }
  };

  const columns: ColumnDef<Refund>[] = useMemo(
    () => [
      {
        accessorKey: "orderNumber",
        header: "Source",
        cell: ({ row }) => {
          const r = row.original;
          // Stay cancellations land in this same queue. Sending their id into
          // the food order search found nothing, every time.
          if (r.kind === "stay") {
            return (
              <div className="min-w-0">
                <Link className="text-primary font-semibold hover:underline" to="/admin/stay?tab=bookings">
                  {r.bookingId ? r.bookingId.slice(0, 10) : r.id.slice(0, 10)}
                </Link>
                <div className="text-[11px] text-muted-foreground">Kada Stay booking</div>
              </div>
            );
          }
          const q = r.orderNumber || r.orderId || r.id;
          return (
            <Link className="text-primary font-semibold hover:underline" to={`/admin/orders?search=${encodeURIComponent(q)}`}>
              {r.orderNumber || r.id.slice(0, 8)}
            </Link>
          );
        },
      },
      {
        id: "partner",
        header: "Partner",
        accessorFn: (r) => r.restaurantName || r.hotelName || "",
        cell: ({ row }) => (
          <span>{row.original.restaurantName || row.original.hotelName || "—"}</span>
        ),
      },
      { accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="font-bold text-rose-600">₹{Math.round(row.original.amount || 0).toLocaleString("en-IN")}</span> },
      {
        accessorKey: "method",
        header: "Method",
        cell: ({ row }) => <Badge variant="outline">{row.original.method || "—"}</Badge>,
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ row }) => (
          <div className="max-w-xs">
            <div>{row.original.reason || "—"}</div>
            {row.original.status === "failed" && row.original.error && (
              <div className="text-xs text-rose-600 mt-0.5">{row.original.error}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const st = row.original.status || "";
          const tone =
            st === "pending_approval" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            : st === "failed" ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300"
            : st === "pending_execution" || st === "executing" ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
            : st === "completed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
            : st === "manual_review" ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
            : "";
          return (
            <Badge variant="outline" className={tone}>
              {st === "manual_review" ? "needs manual payout" : st || "—"}
            </Badge>
          );
        },
      },
      { id: "when", header: "When", cell: ({ row }) => <span className="text-xs text-muted-foreground whitespace-nowrap">{when(row.original)}</span> },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          if (row.original.status === "pending_approval") {
            return (
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => setPendingApproval(row.original)} className="bg-emerald-600 hover:bg-emerald-700 h-8">
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejectTarget(row.original)} className="h-8 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10">
                  Reject
                </Button>
              </div>
            );
          }
          if (row.original.status === "manual_review") {
            // There is no gateway payment to reverse (cash / pay-at-property, or
            // a booking with no payment id), so the queue can only flag it.
            return (
              <span className="text-xs text-muted-foreground">
                No gateway payment to reverse — pay the customer out directly.
              </span>
            );
          }
          if (row.original.status === "failed" && row.original.method === "original") {
            return (
              <Button size="sm" variant="outline" onClick={() => setRetryTarget(row.original)} className="h-8 text-rose-700 border-rose-200 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-500/30 dark:hover:bg-rose-500/10">
                Retry refund
              </Button>
            );
          }
          return null;
        }
      }
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Refund Management"
        description="Queue and approval workflows for customer refunds."
        icon={RotateCcw}
      />
      
      <StatCards
        stats={[
          { label: "Refunded", value: rupees(total), hint: "Returned to customers", icon: TrendingDown, tone: "text-rose-600", onClick: () => setFilter("completed"), active: filter === "completed" },
          { label: "Awaiting approval", value: rupees(pendingAmt), hint: "Above the ₹5,000 maker-checker limit", icon: AlertTriangle, tone: "text-amber-600", onClick: () => setFilter("pending_approval"), active: filter === "pending_approval" },
          // Failed refunds are money still owed.
          { label: "Owed to customers", value: rupees(failedAmt), hint: `${failedRows.length} failed refund${failedRows.length === 1 ? "" : "s"}`, icon: RefreshCw, tone: "text-rose-600", onClick: () => setFilter("failed"), active: filter === "failed" },
        ]}
      />

      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "All" },
          { id: "pending_approval", label: "Requires Approval" },
          { id: "failed", label: "Failed" },
          // Stay cancellations with no gateway payment to reverse land here and
          // had no way to be filtered for.
          { id: "manual_review", label: "Needs manual payout" },
          { id: "stay", label: "Kada Stay" },
          { id: "wallet", label: "Wallet" },
          { id: "original", label: "Original method" },
          { id: "completed", label: "Completed" },
        ]}
      />
      <DataTable columns={columns} data={visible} searchPlaceholder="Search order, restaurant, reason…" exportFilename="refunds-queue" />

      {pendingApproval && (
        <ConfirmationDialog
          open={!!pendingApproval}
          onOpenChange={(v) => !v && setPendingApproval(null)}
          title={`Approve refund of ₹${Math.round(pendingApproval.amount || 0).toLocaleString("en-IN")}?`}
          description={`Order ${pendingApproval.orderNumber || pendingApproval.orderId || pendingApproval.id} · ${pendingApproval.method === "wallet" ? "credited to customer wallet" : "returned to original payment method"}.`}
          consequences={[
            `₹${Math.round(pendingApproval.amount || 0).toLocaleString("en-IN")} will be refunded to the customer immediately.`,
            `Reason: ${pendingApproval.reason || "—"}`,
            `Requested by ${pendingApproval.requestedBy || pendingApproval.createdBy || "another admin"} — you must be a different admin to approve.`,
          ]}
          onConfirm={approveRefund}
          confirmLabel="Approve & process refund"
          confirmText="Approve & process refund"
          confirmVariant="default"
        />
      )}

      {retryTarget && (
        <ConfirmationDialog
          open={!!retryTarget}
          onOpenChange={(v) => !v && setRetryTarget(null)}
          title={`Retry refund of ${rupees(retryTarget.amount)}?`}
          description={`Order ${retryTarget.orderNumber || retryTarget.orderId || retryTarget.id} · back to the customer's original payment method.`}
          consequences={[
            `Last error: ${retryTarget.error || "—"}`,
            `Attempts so far: ${retryTarget.attempts ?? 1}. The same refund record is re-sent, so it cannot be paid twice.`,
          ]}
          onConfirm={retryRefund}
          confirmLabel="Retry refund"
          confirmText="Retry refund"
          confirmVariant="default"
        />
      )}

      {rejectTarget && (
        <ConfirmationDialog
          open={!!rejectTarget}
          onOpenChange={(v) => !v && setRejectTarget(null)}
          title="Reject refund request"
          description={`Reject the ₹${Math.round(rejectTarget.amount || 0).toLocaleString("en-IN")} refund for order ${rejectTarget.orderNumber || rejectTarget.orderId || rejectTarget.id}? No money will move.`}
          requireReason
          variant="destructive"
          confirmLabel="Reject refund"
          confirmText="Reject refund"
          onConfirm={(reason) => rejectRefund(reason || "Rejected by approver")}
        />
      )}
    </div>
  );
}
