import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { logger } from "firebase-functions";
import { executeRazorpayRefund } from "./refunds";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Applying a captured Razorpay payment to what it paid for.
 *
 * Two paths report the same payment: the app (verifyRazorpayPayment /
 * verifyStayPayment, right after checkout) and Razorpay's webhook (minutes
 * later, or the only report if the app was closed). Both call in here, so
 * they can't disagree about what a payment means.
 *
 * A payment that can't be applied is money the customer is owed — it is
 * refunded automatically instead of waiting in an ops inbox:
 *   - the order was cancelled first (e.g. expired while UPI was pending),
 *   - the order was already paid by another payment (paid twice),
 *   - the payment is short of the order total,
 *   - the order no longer exists.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Razorpay's checkout signature: HMAC-SHA256 of "order_id|payment_id". */
export function signatureMatches(secret: string, gatewayOrderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(`${gatewayOrderId}|${paymentId}`).digest("hex");
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

/** Closed before payment: the customer gets nothing, so the money goes back. */
const CANCELLED = ["cancelled", "canceled", "rejected", "expired"];
/** Already fulfilled: the customer got the food, so a late payment is kept. */
const FULFILLED = ["completed", "delivered"];

export type FoodPaymentOutcome =
  | "paid" // applied now
  | "already_paid" // this same payment was applied before (retry / webhook race)
  | "paid_after_fulfilment" // unusual, but the food was delivered: keep it
  | "duplicate" // order already paid by a different payment → refund
  | "closed" // order cancelled before the money arrived → refund
  | "underpaid" // payment short of the total → refund
  | "missing"; // no such order → refund

export const STRAY_OUTCOMES: ReadonlySet<string> = new Set(["duplicate", "closed", "underpaid", "missing"]);

/** What the order must be paid, in paise. The engine snapshot wins over legacy rupee fields. */
export function expectedOrderPaise(o: Record<string, any>): number {
  const snap = Number(o?.pricing?.totals?.totalPaise);
  if (typeof o?.pricing?.engineVersion === "string" && Number.isSafeInteger(snap) && snap > 0) return snap;
  return Math.round(Number(o?.total ?? o?.totalAmount ?? 0) * 100);
}

/** Pure decision, so the rules are testable without Firestore. */
export function decideFoodPayment(
  order: Record<string, any> | null | undefined,
  payment: { paymentId: string; amountPaise: number },
): FoodPaymentOutcome {
  if (!order) return "missing";
  const status = String(order.status ?? "").toLowerCase();
  if (String(order.paymentStatus ?? "").toLowerCase() === "paid") {
    return String(order.razorpayPaymentId ?? "") === payment.paymentId ? "already_paid" : "duplicate";
  }
  if (CANCELLED.includes(status)) return "closed";
  // ₹1 tolerance for rupee/paise rounding on legacy orders.
  if (payment.amountPaise < expectedOrderPaise(order) - 100) return "underpaid";
  if (FULFILLED.includes(status)) return "paid_after_fulfilment";
  return "paid";
}

const REFUND_REASON: Record<string, string> = {
  duplicate: "You paid twice for the same order.",
  closed: "The order was closed before your payment reached us.",
  underpaid: "The payment didn't match the order total.",
  missing: "We couldn't find the order this payment was for.",
};

/** Customer-facing explanation for a payment that was sent back. */
export function strayPaymentMessage(outcome: string, amountPaise: number): string {
  const rupees = (amountPaise / 100).toFixed(2).replace(/\.00$/, "");
  return `${REFUND_REASON[outcome] ?? "This payment couldn't be used."} We've refunded ₹${rupees} to your original payment method — it usually reaches you in 5–7 working days.`;
}

const STRAY_KIND_LABEL: Record<string, string> = {
  food_order: "Order",
  stay_booking: "Stay booking",
  mess_subscription: "Mess subscription",
  subscription: "Merchant subscription order",
};

/**
 * Refund a payment that isn't attached to anything, through the same
 * two-phase engine as every other refund (platform_refunds + executeRazorpayRefund).
 * Keyed by payment id, so the app and the webhook can both ask and only one
 * refund is ever created. `orderId` on the refund doc stays empty on purpose:
 * the refund engine would otherwise stamp the ORDER as refunded, which is wrong
 * when the order itself was paid by a different payment.
 */
export async function refundStrayPayment(args: {
  paymentId: string;
  amountPaise: number;
  kind: "food_order" | "stay_booking" | "mess_subscription" | "subscription";
  relatedId: string;
  outcome: string;
  source: string;
}): Promise<string> {
  const db = admin.firestore();
  const refundId = `stray_${args.paymentId}`;
  const ref = db.collection("platform_refunds").doc(refundId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    await ref.create({
      orderId: "",
      relatedKind: args.kind,
      relatedId: args.relatedId,
      method: "original",
      status: "pending_execution",
      razorpayPaymentId: args.paymentId,
      amountPaise: args.amountPaise,
      amount: args.amountPaise / 100,
      reason: REFUND_REASON[args.outcome] ?? args.outcome,
      outcome: args.outcome,
      source: args.source,
      requestedBy: "system",
      requestedByRole: "system",
      createdAt: now,
    });
  } catch (e: any) {
    // Already created by the other path (app vs webhook): fall through and
    // let the engine's claim decide whether anything is left to do.
    if (e?.code !== 6 && !/already exists/i.test(String(e?.message))) throw e;
  }
  const result = await executeRazorpayRefund(refundId);
  // Ops see every automatic refund, not just failed ones.
  await db.collection("admin_notifications").doc(`stray_payment_${args.paymentId}`).set(
    {
      type: result.status === "completed" ? "stray_payment_refunded" : "payment_needs_refund",
      title: result.status === "completed" ? "Stray payment refunded automatically" : "Stray payment needs a refund",
      message:
        `${STRAY_KIND_LABEL[args.kind] ?? "Order"} ${args.relatedId}: payment ${args.paymentId} ` +
        `(₹${(args.amountPaise / 100).toFixed(2)}) — ${REFUND_REASON[args.outcome] ?? args.outcome} ` +
        `Refund ${result.status}${result.error ? `: ${result.error}` : ""}.`,
      relatedId: args.relatedId,
      razorpayPaymentId: args.paymentId,
      refundId,
      read: false,
      createdAt: now,
    },
    { merge: true },
  );
  logger.warn("Stray payment refunded", { ...args, refundStatus: result.status });
  return refundId;
}

/**
 * Apply a captured payment to a customer food order, exactly once. Safe to call
 * from both the app's verify call and the webhook, in any order.
 */
export async function applyFoodOrderPayment(args: {
  orderId: string;
  razorpayOrderId: string;
  paymentId: string;
  amountPaise: number;
  source: "app" | "webhook" | "sweep";
}): Promise<{ outcome: FoodPaymentOutcome; refundId?: string }> {
  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(args.orderId);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    const o = snap.exists ? snap.data() ?? {} : null;
    const decision = decideFoodPayment(o, { paymentId: args.paymentId, amountPaise: args.amountPaise });
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (decision === "paid" || decision === "paid_after_fulfilment") {
      const updates: Record<string, unknown> = {
        paymentStatus: "paid",
        paymentMethod: "razorpay",
        razorpayPaymentId: args.paymentId,
        razorpayOrderId: args.razorpayOrderId,
        paidAmountPaise: args.amountPaise,
        paidVia: args.source,
        paidAt: now,
      };
      // An order waiting in draft for online payment goes live only once paid.
      if (o?.status === "draft") updates.status = "new";
      if (decision === "paid_after_fulfilment") updates.paidAfterFulfilment = true;
      tx.update(orderRef, updates as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    } else if (o && STRAY_OUTCOMES.has(decision)) {
      // Keep a trace on the order so support can answer "where's my money?".
      tx.update(orderRef, {
        strayPayments: admin.firestore.FieldValue.arrayUnion({
          razorpayPaymentId: args.paymentId,
          amountPaise: args.amountPaise,
          outcome: decision,
          refundId: `stray_${args.paymentId}`,
        }),
      });
    }
    return decision;
  });

  if (STRAY_OUTCOMES.has(outcome)) {
    const refundId = await refundStrayPayment({
      paymentId: args.paymentId,
      amountPaise: args.amountPaise,
      kind: "food_order",
      relatedId: args.orderId,
      outcome,
      source: args.source,
    });
    return { outcome, refundId };
  }
  return { outcome };
}
