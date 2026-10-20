import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { adminActionToast } from "@/lib/admin-ops";
import { callableError, inr, pricingAdmin } from "./pricingShared";
import type { FoodSnapshot } from "./PricingWaterfall";

interface OrderLike {
  pricing: FoodSnapshot;
  paymentMethod?: string;
  razorpayPaymentId?: string;
  refundedLineQty?: Record<string, number>;
  refundedCharges?: string[];
  refundedTip?: boolean;
  refundedDonation?: boolean;
}

interface Plan {
  amountPaise: number;
  rows: { key: string; label: string; amountPaise: number }[];
  tax: { totalPaise: number; vendorPaise: number; platformEcoPaise: number; platformOwnPaise: number };
  vendorClawbackPaise: number;
  commissionReversalPaise: number;
  riderTipPaise: number;
  donationPaise: number;
  platformCostPaise: number;
  problems: string[];
  warnings: string[];
}

/**
 * Refund specific items, charges, the tip or the donation of a pricing-engine
 * order. The server plans it from the order's price snapshot (amount, GST
 * reversed, restaurant clawback, commission returned) before any money moves.
 */
export function ItemisedRefundDialog({ orderId, order }: { orderId: string; order: OrderLike }) {
  const q = order.pricing;
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [charges, setCharges] = useState<string[]>([]);
  const [tip, setTip] = useState(false);
  const [donation, setDonation] = useState(false);
  const [method, setMethod] = useState<"wallet" | "original">(order.razorpayPaymentId ? "original" : "wallet");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const lines: { lineId: string; name: string; qty: number; customerPaysPaise: number }[] = q?.lines ?? [];
  const chargeList: { key: string; label: string; customerPaysPaise: number }[] = (q?.charges ?? []).filter(
    (c: { customerPaysPaise: number }) => c.customerPaysPaise > 0,
  );
  const left = (lineId: string, total: number) => total - (order.refundedLineQty?.[lineId] ?? 0);

  const request = useMemo(
    () => ({
      lines: Object.entries(qty).filter(([, n]) => n > 0).map(([lineId, n]) => ({ lineId, qty: n })),
      charges,
      tip,
      donation,
    }),
    [qty, charges, tip, donation],
  );
  const nothingChosen = request.lines.length === 0 && charges.length === 0 && !tip && !donation;

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPlan(null);
  };

  async function preview() {
    setBusy(true);
    try {
      setPlan(await pricingAdmin<Plan>("planRefund", { orderId, ...request }));
    } catch (e) {
      toast.error(callableError(e));
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    if (!plan || plan.problems.length) return;
    if (reason.trim().length < 5) {
      toast.error("Give a reason for the refund (at least 5 characters).");
      return;
    }
    setBusy(true);
    try {
      // `amount` pins the previewed total: the server re-plans and ignores it
      // for itemised requests, but it can never widen a refund.
      await adminActionToast(
        "refundOrder",
        { orderId, method, reason: reason.trim(), amount: plan.amountPaise / 100, ...request },
        `Refund of ${inr(plan.amountPaise)} started`,
      );
      setOpen(false);
      setPlan(null);
      setQty({});
      setCharges([]);
      setTip(false);
      setDonation(false);
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ListChecks className="mr-1 h-4 w-4" /> Refund items
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Refund items</DialogTitle>
          <DialogDescription>Pick what to refund. The amount comes from the price the customer actually paid, including discounts and GST.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            {lines.map((l) => {
              const max = left(l.lineId, l.qty);
              return (
                <div key={l.lineId} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.qty} ordered · {inr(l.customerPaysPaise)} paid{max < l.qty ? ` · ${l.qty - max} already refunded` : ""}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={max}
                    disabled={max <= 0}
                    className="w-20"
                    value={qty[l.lineId] ?? 0}
                    onChange={(e) => change(setQty)({ ...qty, [l.lineId]: Math.max(0, Math.min(max, Math.trunc(Number(e.target.value) || 0))) })}
                  />
                </div>
              );
            })}
          </div>

          {(chargeList.length > 0 || q?.totals?.tipPaise > 0 || q?.totals?.donationPaise > 0) && (
            <div className="space-y-2 border-t pt-3">
              {chargeList.map((c) => {
                const done = order.refundedCharges?.includes(c.key);
                return (
                  <label key={c.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" disabled={done} checked={charges.includes(c.key)}
                        onChange={(e) => change(setCharges)(e.target.checked ? [...charges, c.key] : charges.filter((x) => x !== c.key))} />
                      {c.label}{done ? " (refunded)" : ""}
                    </span>
                    <span className="tabular-nums">{inr(c.customerPaysPaise)}</span>
                  </label>
                );
              })}
              {q?.totals?.tipPaise > 0 && (
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" disabled={order.refundedTip} checked={tip} onChange={(e) => change(setTip)(e.target.checked)} />
                    Rider tip{order.refundedTip ? " (refunded)" : ""}
                  </span>
                  <span className="tabular-nums">{inr(q.totals.tipPaise)}</span>
                </label>
              )}
              {q?.totals?.donationPaise > 0 && (
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" disabled={order.refundedDonation} checked={donation} onChange={(e) => change(setDonation)(e.target.checked)} />
                    Kada Cares donation{order.refundedDonation ? " (refunded)" : ""}
                  </span>
                  <span className="tabular-nums">{inr(q.totals.donationPaise)}</span>
                </label>
              )}
            </div>
          )}

          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Refund to</Label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value as "wallet" | "original")}>
                <option value="wallet">Kada wallet</option>
                <option value="original" disabled={!order.razorpayPaymentId}>Original payment method</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Reason (kept in the audit log)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two biryanis arrived cold; refunding one and the delivery fee." />
            </div>
          </div>

          {plan && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              {plan.rows.map((r) => (
                <div key={r.key} className="flex justify-between"><span>{r.label}</span><span className="tabular-nums">{inr(r.amountPaise)}</span></div>
              ))}
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Refund to customer</span><span className="tabular-nums">{inr(plan.amountPaise)}</span></div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
                <span>Taken back from restaurant</span><span className="text-right tabular-nums">{inr(plan.vendorClawbackPaise)}</span>
                <span>Commission returned</span><span className="text-right tabular-nums">{inr(plan.commissionReversalPaise)}</span>
                <span>GST reversed</span><span className="text-right tabular-nums">{inr(plan.tax.totalPaise)}</span>
                {plan.riderTipPaise > 0 && (<><span>Tip taken back from rider</span><span className="text-right tabular-nums">{inr(plan.riderTipPaise)}</span></>)}
                <span>Kada funds</span><span className="text-right tabular-nums">{inr(plan.platformCostPaise)}</span>
              </div>
              {[...plan.problems, ...plan.warnings].map((p) => (
                <p key={p} className={plan.problems.includes(p) ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>{p}</p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy || nothingChosen} onClick={preview}>Preview</Button>
          <Button variant="destructive" disabled={busy || !plan || plan.problems.length > 0} onClick={refund}>
            {plan ? `Refund ${inr(plan.amountPaise)}` : "Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
