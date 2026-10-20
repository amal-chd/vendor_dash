import * as admin from "firebase-admin";
import { withCronHeartbeat } from "./cronHealth";
import { expireUnpaidStayBookings } from "./pricing/stayCallables";
import { reconcileFoodOrder, reconcileStayBooking, sweepKeyedPayments } from "./paymentSweep";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { pricingRefusal } from "./orderPricing";
import { enforceRateLimit } from "./rateLimit";
import { HOT_PATH } from "./options";
import { pricingAudit, verifyCustomerOrderPricing } from "./orderPricingServer";
import { logger } from "firebase-functions";
import { writeEvent } from "./deliveryLifecycle";
import {
  customerCancelProblem,
  isAwaitingOnlinePayment,
  isAwaitingOrderVetting,
  isTerminalStatus,
  normaliseStatus,
  refundAmountRupees,
} from "./vendorOrderRules";
import {
  executeRazorpayRefund,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  stageCancellationRefund,
  type RefundOutcome,
} from "./refunds";

function str(v: unknown, max: number): string {
  return (v ?? "").toString().trim().slice(0, max);
}

/**
 * A customer cancels their own order, until the restaurant accepts it.
 *
 * Replaces a direct Firestore write that the rules always refused (the app
 * also sent cancelledAt/cancelledBy), and that, had it worked, would have
 * cancelled a paid order and refunded nobody. Idempotent, recorded on the
 * order timeline, and refunds exactly like a restaurant cancellation.
 */
export const customerCancelOrder = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to cancel an order.");
    await enforceRateLimit(`customer_cancel_${uid}`, 20, 10 * 60_000);
    const orderId = str(request.data?.orderId, 128);
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");
    const reason = str(request.data?.reason, 200) || "Cancelled by customer";
    return cancelOrderForCustomer(uid, orderId, reason);
  },
);

/**
 * THE customer cancellation path — window check, status write, refund staging
 * and the audit event. Kada Assist cancels through this too, so a cancellation
 * asked for in chat behaves exactly like the button on the order.
 */
export async function cancelOrderForCustomer(
  uid: string,
  orderId: string,
  reason: string,
): Promise<{
  ok: true;
  status: "cancelled";
  from: string;
  idempotent: boolean;
  refund: RefundOutcome | null;
}> {
  {
    const db = admin.firestore();
    const ref = db.collection("orders").doc(orderId);

    const result = await db.runTransaction(async (tx) => {
      // ── ALL reads first ─────────────────────────────────────────────────
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "This order no longer exists.");
      const o = snap.data() ?? {};
      if (String(o.customerUid ?? "") !== uid) {
        throw new HttpsError("permission-denied", "This isn't your order.");
      }
      const from = normaliseStatus(o.status) || "new";
      if (from === "cancelled" || from === "canceled") {
        return { idempotent: true, from, refund: null as RefundOutcome | null };
      }
      const problem = customerCancelProblem(o);
      if (problem) throw new HttpsError("failed-precondition", problem, { currentStatus: from });

      const refundAmt = refundAmountRupees(o);
      const refundId = `customer_${orderId}`;
      const existingRefund =
        refundAmt > 0 ? (await tx.get(db.collection("platform_refunds").doc(refundId))).data() : undefined;

      // ── Writes ──────────────────────────────────────────────────────────
      const now = admin.firestore.FieldValue.serverTimestamp();
      const patch: Record<string, unknown> = {
        status: "cancelled",
        updatedAt: now,
        cancelReason: reason,
        cancelledAt: now,
        cancelledBy: uid,
        cancelledByRole: "customer",
        lastStatusActor: { uid, role: "customer", staffId: null },
      };

      let refund: RefundOutcome | null = null;
      if (refundAmt > 0 && existingRefund?.status !== "completed") {
        const staged = stageCancellationRefund({
          tx,
          order: o,
          orderId,
          refundId,
          amount: refundAmt,
          reason,
          ledgerReason: `Customer cancelled: ${reason}`,
          source: "customer_cancel",
          requestedBy: uid,
          requestedByRole: "customer",
        });
        Object.assign(patch, staged.patch);
        refund = staged.refund;
      }

      tx.set(ref, patch, { merge: true });
      writeEvent(tx, orderId, `customer_${orderId}_cancelled`, {
        type: "ORDER_CANCELLED",
        actorId: uid,
        actorRole: "customer",
        from,
        to: "cancelled",
        metadata: { reason, refundAmount: refund?.amount ?? null, refundStatus: refund?.status ?? null },
      });
      return { idempotent: false, from, refund };
    });

    let refund = result.refund;
    if (refund?.status === "pending_execution") {
      // Never throws: a failed gateway call is recorded and surfaced to ops.
      const exec = await executeRazorpayRefund(refund.refundId);
      refund = { ...refund, status: exec.status };
    }

    logger.info("customerCancelOrder", {
      orderId,
      from: result.from,
      idempotent: result.idempotent,
      refundStatus: refund?.status ?? null,
    });

    return { ok: true as const, status: "cancelled" as const, from: result.from, idempotent: result.idempotent, refund };
  }
}

/** Minutes an online order may wait for its payment before it's closed. */
const UNPAID_ORDER_TTL_MIN = 15;

/**
 * Closes customer orders whose online payment never completed. Such an order
 * is held from the kitchen and riders (isAwaitingOnlinePayment); without this
 * it would sit as "placed" in the customer's history forever. A payment that
 * lands afterwards still records against the order, and verifyRazorpayPayment
 * raises a refund alert for ops ("paid_after_close").
 */
export const expireUnpaidOnlineOrders = onSchedule(
  // The keys let the sweep ask Razorpay whether a waiting payment was
  // actually captured before anything is expired (paymentSweep.ts).
  { schedule: "every 5 minutes", secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  withCronHeartbeat("expireUnpaidOnlineOrders", 5, async () => {
  const db = admin.firestore();
  const now = Date.now();
  // Uses the existing orderSource + timestamp index.
  const snap = await db
    .collection("orders")
    .where("orderSource", "==", "delivery_app")
    .where("timestamp", ">=", admin.firestore.Timestamp.fromMillis(now - 6 * 3_600_000))
    // From 3 minutes old: younger orders are usually still in checkout.
    .where("timestamp", "<=", admin.firestore.Timestamp.fromMillis(now - 3 * 60_000))
    .limit(500)
    .get();

  let expired = 0;
  for (const doc of snap.docs) {
    if (!isAwaitingOnlinePayment(doc.data())) continue;
    // Paid but never confirmed (app closed, webhook missing or late): apply
    // the payment instead of expiring an order the customer paid for.
    if (await reconcileFoodOrder(doc).catch(() => false)) continue;
    const placedAt = doc.get("timestamp") as admin.firestore.Timestamp | undefined;
    if (!placedAt || now - placedAt.toMillis() < UNPAID_ORDER_TTL_MIN * 60_000) continue;
    const closed = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(doc.ref)).data() ?? {};
      if (!isAwaitingOnlinePayment(cur)) return false; // paid or moved on meanwhile
      const at = admin.firestore.FieldValue.serverTimestamp();
      tx.update(doc.ref, {
        status: "cancelled",
        cancelReason: "Payment wasn't completed, so the order wasn't placed.",
        cancelledAt: at,
        cancelledBy: "system",
        cancelledByRole: "system",
        updatedAt: at,
      });
      writeEvent(tx, doc.id, `expired_${doc.id}`, {
        type: "ORDER_CANCELLED",
        actorId: "system",
        actorRole: "system",
        from: normaliseStatus(cur.status) || "new",
        to: "cancelled",
        metadata: { reason: "payment_not_completed", ttlMinutes: UNPAID_ORDER_TTL_MIN },
      });
      return true;
    });
    if (closed) expired++;
  }
  if (expired > 0) logger.info("expireUnpaidOnlineOrders", { expired, scanned: snap.size });

  // Stay bookings waiting on an online payment get the same treatment.
  await expireUnpaidStayBookings(reconcileStayBooking).catch((e) => logger.error("expireUnpaidStayBookings failed", e));
  // Wallet top-ups, rider cash deposits and web subscriptions.
  await sweepKeyedPayments().catch((e) => logger.error("sweepKeyedPayments failed", e));
  },
));

/**
 * Prices a cash-on-delivery customer order before it goes live. Online orders
 * are priced when paid (createRazorpayOrder / payOrderWithWallet); COD orders
 * had no check at all, so a modified app could set any total for the rider to
 * collect and the vendor to be settled on. Writing `pricingCheck.ok` releases
 * the order (onOrderPaymentConfirmed alerts the kitchen and starts delivery).
 * A refused order is cancelled before the kitchen hears of it. If the check
 * itself fails, the order is released and flagged rather than lost.
 */
export const vetCustomerOrder = onDocumentCreated(
  { document: "orders/{orderId}", maxInstances: 5 },
  async (event) => {
    const order = event.data?.data();
    if (!order || !isAwaitingOrderVetting(order)) return;
    const ref = event.data!.ref;
    const orderId = event.params.orderId;
    const db = admin.firestore();

    try {
      const check = await verifyCustomerOrderPricing(order);
      if (check.ok) {
        await ref.update({ pricingCheck: pricingAudit(check) });
        return;
      }
      await db.runTransaction(async (tx) => {
        const cur = (await tx.get(ref)).data() ?? {};
        if (isTerminalStatus(cur.status)) return;
        const at = admin.firestore.FieldValue.serverTimestamp();
        tx.update(ref, {
          pricingCheck: pricingAudit(check),
          status: "cancelled",
          cancelReason: pricingRefusal(check),
          cancelledAt: at,
          cancelledBy: "system",
          cancelledByRole: "system",
          updatedAt: at,
        });
        writeEvent(tx, orderId, `vetting_${orderId}`, {
          type: "ORDER_CANCELLED",
          actorId: "system",
          actorRole: "system",
          from: normaliseStatus(cur.status) || "new",
          to: "cancelled",
          metadata: { reason: "pricing_check_failed", shortfall: check.shortfall, problems: check.problems.slice(0, 5) },
        });
      });
      logger.warn("vetCustomerOrder refused", { orderId, shortfall: check.shortfall, problems: check.problems });
    } catch (e) {
      logger.error("vetCustomerOrder failed; releasing unverified", { orderId, error: String(e) });
      await ref
        .update({
          pricingCheck: {
            ok: true,
            unverified: true,
            error: String(e).slice(0, 300),
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        })
        .catch((err) => logger.error("vetCustomerOrder: could not release order", { orderId, error: String(err) }));
    }
  },
);
