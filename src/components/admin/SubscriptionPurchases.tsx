import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/admin/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Every web subscription purchase (`subscription_orders`, written only by
 * functions/src/subscriptionBilling.ts) with its gateway state, and a refund
 * that also takes back the time the purchase bought.
 */
interface Purchase {
  id: string;
  uid?: string;
  product?: string;
  planName?: string;
  period?: string;
  amount?: number;
  status?: string;
  razorpayPaymentId?: string;
  refundId?: string;
  lastPaymentFailure?: { reason?: string };
  createdAt?: { toDate?: () => Date };
  subscriptionEndDate?: { toDate?: () => Date };
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  refunded: "bg-slate-500/10 text-foreground/90 border-slate-500/30",
  abandoned: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

export function SubscriptionPurchases() {
  const [rows, setRows] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Purchase | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "subscription_orders"), orderBy("createdAt", "desc"), limit(300)),
        (snap) => {
          setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Purchase));
          setLoading(false);
        },
        (err) => {
          console.error(err);
          toast.error("Could not load subscription purchases");
          setLoading(false);
        },
      ),
    [],
  );

  const refund = async () => {
    if (!target || !reason.trim()) return;
    setBusy(true);
    try {
      const fn = httpsCallable(functions, "adminPlatformAction");
      const res = await fn({ action: "refundSubscription", payload: { razorpayOrderId: target.id, reason: reason.trim() } });
      const out = res.data as { refundStatus?: string; gatewayError?: string | null };
      if (out.refundStatus === "completed") toast.success("Refund sent and subscription time taken back");
      else toast.error(`Refund ${out.refundStatus ?? "failed"}${out.gatewayError ? `: ${out.gatewayError}` : ""} — retry it from Refunds`);
      setTarget(null);
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refund failed");
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnDef<Purchase>[] = useMemo(
    () => [
      { id: "date", header: "Date", cell: ({ row }) => row.original.createdAt?.toDate?.()?.toLocaleString("en-IN") ?? "—" },
      { id: "merchant", header: "Merchant", cell: ({ row }) => <span className="font-mono text-xs">{row.original.uid?.slice(0, 10) ?? "—"}</span> },
      { id: "product", header: "Product", cell: ({ row }) => (row.original.product === "stay" ? "Kada Host" : "Kada Dine") },
      { id: "plan", header: "Plan", cell: ({ row }) => `${row.original.planName ?? "—"} · ${row.original.period ?? ""}` },
      { id: "amount", header: "Amount", cell: ({ row }) => `₹${Number(row.original.amount ?? 0).toLocaleString("en-IN")}` },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline" className={STATUS_TONE[row.original.status ?? ""] ?? ""}>
            {row.original.status ?? "—"}
          </Badge>
        ),
      },
      { accessorKey: "razorpayPaymentId", header: "Payment" },
      { id: "failure", header: "Last failure", cell: ({ row }) => row.original.lastPaymentFailure?.reason ?? "" },
      {
        id: "actions",
        cell: ({ row }) =>
          row.original.status === "active" ? (
            <Button size="sm" variant="outline" onClick={() => setTarget(row.original)}>
              Refund
            </Button>
          ) : null,
      },
    ],
    [],
  );

  const paid = rows.filter((r) => r.status === "active" || r.status === "refunded");
  const revenue = rows.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {loading ? "Loading…" : `${paid.length} paid purchases · ₹${revenue.toLocaleString("en-IN")} retained · ${rows.filter((r) => r.status === "pending").length} awaiting payment`}
      </p>
      <DataTable columns={columns} data={rows} searchPlaceholder="Search merchant, plan, payment…" exportFilename="subscription-purchases" />

      <Dialog open={!!target} onOpenChange={(o) => !o && !busy && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund subscription purchase</DialogTitle>
            <DialogDescription>
              Refunds ₹{Number(target?.amount ?? 0).toLocaleString("en-IN")} to the original payment method and removes the{" "}
              {target?.period === "yearly" ? "365" : "30"} days this purchase added. If nothing paid is left, the merchant falls back to
              commission billing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sub-refund-reason">Reason (kept in the audit log)</Label>
            <Input id="sub-refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={refund} disabled={busy || !reason.trim()}>
              {busy ? "Refunding…" : "Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
