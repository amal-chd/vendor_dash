import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./refunds";
import { applyFoodOrderPayment } from "./paymentCapture";
import { applyStayPayment } from "./pricing/stayCallables";
import { creditWalletTopup } from "./wallet";
import { settleCodDeposit } from "./codReconciliation";
import { activateSubscription } from "./subscriptionBilling";
import { applyMessPayment } from "./mess";
import { capturePayment } from "./gateway";
import { recoverStuckRefunds } from "./refunds";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Payment sweep — asks Razorpay directly about anything still waiting.
 *
 * Money normally lands two ways: the app confirms right after checkout, and
 * Razorpay's webhook confirms anything the app missed. If the app was closed
 * AND the webhook is missing, misconfigured or delayed, a customer could pay
 * and get nothing. This sweep closes that gap without trusting either: every
 * few minutes it looks up the gateway orders behind every unconfirmed
 * payment and applies any captured payment through the same code the
 * webhook uses — so it is idempotent with both.
 *
 * Runs inside the existing 5-minute sweeper (expireUnpaidOnlineOrders), not
 * as its own function: every function reserves CPU quota.
 * ─────────────────────────────────────────────────────────────────────────
 */

const MIN_AGE_MS = 3 * 60_000; // leave live checkouts alone
const MAX_PER_KIND = 25; // bound gateway calls per run

interface GatewayPayment {
  id: string;
  amount: number;
  status: string;
  order_id: string;
}

function auth(): string | null {
  let keyId = "";
  let keySecret = "";
  try {
    keyId = RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "";
    keySecret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
  } catch {
    keyId = process.env.RAZORPAY_KEY_ID || "";
    keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  }
  return keyId && keySecret ? Buffer.from(`${keyId}:${keySecret}`).toString("base64") : null;
}

/**
 * Captured payments on a gateway order, or null if Razorpay couldn't be asked.
 * A payment still `authorized` (auto-capture off or delayed) is captured here
 * first — Razorpay voids uncaptured payments after a few days, which would
 * hand the customer's money back while we had already given them the goods.
 * A capture that is later found unusable (paid twice, order closed) is
 * refunded by the caller's apply step like any other stray payment.
 */
export async function capturedPayments(gatewayOrderId: string): Promise<GatewayPayment[] | null> {
  const basic = auth();
  if (!basic || !gatewayOrderId) return null;
  try {
    const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(gatewayOrderId)}/payments`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) {
      logger.warn("paymentSweep: gateway lookup failed", { gatewayOrderId, status: res.status });
      return null;
    }
    const body = (await res.json()) as { items?: (GatewayPayment & { currency?: string })[] };
    const out: GatewayPayment[] = [];
    for (const p of body.items ?? []) {
      if (p.status === "captured") out.push(p);
      else if (p.status === "authorized" && (await capturePayment(p.id, Number(p.amount), p.currency ?? "INR"))) {
        logger.info("paymentSweep: captured an authorized payment", { gatewayOrderId, paymentId: p.id });
        out.push({ ...p, status: "captured" });
      }
    }
    return out;
  } catch (e) {
    logger.warn("paymentSweep: gateway lookup error", { gatewayOrderId, e: String(e) });
    return null;
  }
}

const ageMs = (t: unknown) => (t instanceof admin.firestore.Timestamp ? Date.now() - t.toMillis() : 0);

/**
 * Apply any captured payment behind an unpaid food order. Returns true when the
 * order is now paid, so the caller must NOT expire it.
 */
export async function reconcileFoodOrder(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<boolean> {
  const o = doc.data();
  const ids = new Set<string>();
  const pending = o.pendingGatewayOrder as { id?: unknown } | undefined;
  if (typeof pending?.id === "string") ids.add(pending.id);
  for (const id of (Array.isArray(o.razorpayOrderIds) ? o.razorpayOrderIds : []).slice(-3)) ids.add(String(id));
  let paid = false;
  for (const gatewayOrderId of ids) {
    for (const p of (await capturedPayments(gatewayOrderId)) ?? []) {
      const { outcome } = await applyFoodOrderPayment({
        orderId: doc.id,
        razorpayOrderId: gatewayOrderId,
        paymentId: p.id,
        amountPaise: Number(p.amount) || 0,
        source: "sweep",
      });
      if (outcome === "paid" || outcome === "already_paid" || outcome === "paid_after_fulfilment") paid = true;
    }
  }
  if (paid) logger.info("paymentSweep: recovered an unconfirmed order payment", { orderId: doc.id });
  return paid;
}

/** Same for a Stay booking waiting on its payment. */
export async function reconcileStayBooking(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<boolean> {
  const b = doc.data();
  let paid = false;
  for (const gatewayOrderId of (Array.isArray(b.razorpayOrderIds) ? b.razorpayOrderIds : []).slice(-3)) {
    for (const p of (await capturedPayments(String(gatewayOrderId))) ?? []) {
      const outcome = await applyStayPayment({
        bookingId: doc.id,
        razorpayOrderId: String(gatewayOrderId),
        paymentId: p.id,
        amountPaise: Number(p.amount) || 0,
        source: "sweep",
      });
      if (outcome === "paid" || outcome === "already_paid") paid = true;
    }
  }
  return paid;
}

/**
 * Wallet top-ups, rider cash deposits and web subscriptions are each keyed by
 * their gateway order id, so one pass per collection covers them.
 */
async function sweepKeyed(
  collection: string,
  waitingStatus: string,
  apply: (gatewayOrderId: string, p: GatewayPayment) => Promise<unknown>,
): Promise<number> {
  const db = admin.firestore();
  const snap = await db.collection(collection).where("status", "==", waitingStatus).limit(100).get();
  let applied = 0;
  let checked = 0;
  for (const doc of snap.docs) {
    const age = ageMs(doc.get("createdAt"));
    if (age < MIN_AGE_MS) continue;
    if (checked++ >= MAX_PER_KIND) break;
    const captured = await capturedPayments(doc.id);
    if (captured === null) continue; // couldn't ask: try again next run
    if (captured.length === 0) {
      // Checkout abandoned. After 3 days nothing can still capture, so stop
      // asking Razorpay about it every five minutes.
      if (age > 3 * 86_400_000) await doc.ref.update({ status: "abandoned", abandonedAt: admin.firestore.FieldValue.serverTimestamp() });
      continue;
    }
    try {
      await apply(doc.id, captured[0]);
      applied++;
    } catch (e) {
      logger.error("paymentSweep: couldn't apply a captured payment", { collection, id: doc.id, e: String(e) });
    }
  }
  return applied;
}

/**
 * Mess subscriptions waiting on payment — including ones the hourly mess
 * sweeper already marked `abandoned`, since a UPI approval can land late.
 * Keyed by subscription id, so they don't fit sweepKeyed.
 */
async function sweepMessPayments(): Promise<number> {
  const db = admin.firestore();
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 3 * 86_400_000);
  const snap = await db
    .collection("mess_subscriptions")
    .where("status", "in", ["pending_payment", "abandoned"])
    .where("createdAt", ">=", since)
    .limit(100)
    .get();
  let applied = 0;
  let checked = 0;
  for (const doc of snap.docs) {
    const gatewayOrderId = String(doc.get("razorpayOrderId") ?? "");
    if (!gatewayOrderId || doc.get("paymentStatus") === "paid") continue;
    if (ageMs(doc.get("createdAt")) < MIN_AGE_MS) continue;
    if (checked++ >= MAX_PER_KIND) break;
    for (const p of (await capturedPayments(gatewayOrderId)) ?? []) {
      try {
        const outcome = await applyMessPayment({
          subscriptionId: doc.id,
          razorpayOrderId: gatewayOrderId,
          paymentId: p.id,
          amountPaise: Number(p.amount) || 0,
          source: "sweep",
        });
        if (outcome === "paid") applied++;
      } catch (e) {
        logger.error("paymentSweep: couldn't apply a mess payment", { id: doc.id, e: String(e) });
      }
    }
  }
  return applied;
}

/** Everything except food orders and Stay bookings, which the expiry pass handles. */
export async function sweepKeyedPayments(): Promise<void> {
  if (!auth()) return;
  const [topups, deposits, subs, mess, refunds] = await Promise.all([
    sweepKeyed("wallet_topups", "created", (id, p) => creditWalletTopup(id, p.id, Number(p.amount))),
    sweepKeyed("cod_deposits", "pending", (id, p) => settleCodDeposit(id, p.id)),
    sweepKeyed("subscription_orders", "pending", (id, p) => activateSubscription(id, p.id)),
    sweepMessPayments(),
    recoverStuckRefunds(),
  ]);
  if (topups + deposits + subs + mess + refunds > 0) {
    logger.info("paymentSweep: recovered unconfirmed payments", { topups, deposits, subs, mess, refunds });
  }
}
