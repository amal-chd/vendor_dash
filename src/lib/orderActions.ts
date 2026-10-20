import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/**
 * The single web entry point for moving an order. Mirrors
 * vendor_mobile_app/lib/services/order_actions.dart.
 *
 * Every status change goes through `vendorTransitionOrder`, which validates the
 * move, is idempotent across devices and retries, records who did it, and
 * refunds the customer when a paid order is cancelled or rejected. Callers must
 * show success only when `ok` is true — never on the mere absence of an error.
 */
export type OrderActionOutcome =
  | "applied"
  | "alreadyApplied"
  | "refused"
  | "noPermission"
  | "uncertain";

export interface OrderActionResult {
  ok: boolean;
  outcome: OrderActionOutcome;
  /** Operator-facing sentence: what happened and what to do next. */
  message: string;
}

interface TransitionResponse {
  idempotent?: boolean;
  refund?: { amount?: number; status?: string } | null;
}

const SUCCESS: Record<string, string> = {
  confirmed: "Order accepted.",
  preparing: "Order accepted.",
  ready: "Marked ready.",
  ready_for_pickup: "Released for pickup.",
  completed: "Order completed.",
  cancelled: "Order cancelled.",
  rejected: "Order rejected.",
};

/**
 * A customer-app order paid online (Razorpay or wallet) whose payment hasn't
 * been confirmed. The app creates the order before the payment runs, so the
 * kitchen must not see it until paid. Mirrors isAwaitingOnlinePayment in
 * functions/src/vendorOrderRules.ts, which also holds alerts and dispatch.
 */
export function isAwaitingOnlinePayment(o: Record<string, unknown>): boolean {
  const src = String(o.orderSource ?? "").toLowerCase();
  const hasCustomer = Boolean(o.customerUid || o.userId || o.customerId);
  if (src === "pos" || src === "qr_menu" || (!src && !hasCustomer)) return false;
  const method = String(o.paymentMethod ?? "").toLowerCase();
  if (method !== "razorpay" && method !== "wallet") return false;
  if (String(o.paymentStatus ?? "").toLowerCase() === "paid") return false;
  const status = String(o.status ?? "").toLowerCase() || "new";
  return ["new", "pending", "placed", "scheduled", "draft"].includes(status);
}

/** Declining an order that was never accepted is a rejection, not a cancellation. */
export function cancelTargetFor(currentStatus: string | undefined): "rejected" | "cancelled" {
  const s = (currentStatus ?? "").toLowerCase();
  return ["", "new", "pending", "placed", "scheduled"].includes(s) ? "rejected" : "cancelled";
}

function refundSentence(refund: TransitionResponse["refund"]): string {
  const amount = refund?.amount ?? 0;
  if (!refund || amount <= 0) return "";
  if (refund.status === "completed") return ` ₹${amount} refunded to the customer.`;
  if (refund.status === "failed") {
    return ` The ₹${amount} refund could not be completed — Kada support has been alerted and will finish it.`;
  }
  return ` A ₹${amount} refund to the customer is being processed.`;
}

export async function transitionOrder(
  orderId: string,
  to: string,
  opts: { reason?: string; prepMinutes?: number; restaurantId?: string } = {},
): Promise<OrderActionResult> {
  try {
    const call = httpsCallable<Record<string, unknown>, TransitionResponse>(
      functions,
      "vendorTransitionOrder",
      { timeout: 20_000 },
    );
    const res = await call({
      orderId,
      to,
      ...(opts.restaurantId ? { restaurantId: opts.restaurantId } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.prepMinutes ? { prepMinutes: opts.prepMinutes } : {}),
    });
    return {
      ok: true,
      outcome: res.data?.idempotent ? "alreadyApplied" : "applied",
      message: (SUCCESS[to] ?? "Order updated.") + refundSentence(res.data?.refund),
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = (err.code ?? "").replace(/^functions\//, "");
    if (code === "failed-precondition" || code === "invalid-argument" || code === "not-found") {
      return {
        ok: false,
        outcome: "refused",
        message: err.message || "This order could not be updated. Nothing was changed.",
      };
    }
    if (code === "permission-denied" || code === "unauthenticated") {
      return {
        ok: false,
        outcome: "noPermission",
        message: err.message || "You don't have permission to do this. Ask the owner to update your access.",
      };
    }
    return {
      ok: false,
      outcome: "uncertain",
      message:
        "Couldn't reach Kada to confirm this. The order may not have changed — check its status, then try again.",
    };
  }
}
