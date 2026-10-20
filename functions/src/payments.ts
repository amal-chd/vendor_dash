import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { pricingRefusal } from "./orderPricing";
import { enforceRateLimit } from "./rateLimit";
import { HOT_PATH } from "./options";
import { pricingAudit, verifyCustomerOrderPricing } from "./orderPricingServer";
import { applyFoodOrderPayment, signatureMatches, strayPaymentMessage } from "./paymentCapture";
import { uniqueReceipt } from "./gateway";

/**
 * Razorpay payment functions for the customer delivery app.
 *
 * Flow:
 *   1. App calls `createRazorpayOrder({ orderId })` → we price the order
 *      server-side, create (or reuse) a Razorpay order and return its id +
 *      the public key for checkout.
 *   2. App opens Razorpay checkout (razorpay_flutter) with that order id.
 *   3. On success the app calls `verifyRazorpayPayment(...)`; we verify the
 *      HMAC signature server-side and only then mark the Firestore order paid
 *      (paymentCapture.ts — shared with the webhook, which covers apps that
 *      closed before confirming).
 *
 * Secrets (set with `firebase functions:secrets:set`):
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
 */
const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const CLOSED_STATUSES = ["cancelled", "canceled", "rejected", "completed", "delivered"];

interface GatewayOrder {
  amount?: number;
  notes?: Record<string, unknown>;
}

export const createRazorpayOrder = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to pay.");
    }
    // Each call may create a gateway order; a retry loop shouldn't hammer Razorpay.
    await enforceRateLimit(`pay_create_${request.auth.uid}`, 20, 10 * 60_000);
    // Food orders only. This used to accept any `context`, an app-chosen
    // amount and app-chosen `notes` spread over the server's own — so a
    // modified app could relabel a payment for the webhook. Wallet top-ups,
    // Stay, subscriptions and COD deposits each have their own server-priced
    // endpoint.
    const orderId = String(request.data?.orderId ?? "").trim();
    if (!orderId) {
      throw new HttpsError("invalid-argument", "orderId is required.");
    }
    const orderRef = admin.firestore().collection("orders").doc(orderId);

    // A food order is charged what the SERVER verifies it is worth, never the
    // amount the app sends: the app used to pass its own total, so a modified
    // client could pay ₹1 for any basket. See orderPricing.ts.
    const snap = await orderRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const o = snap.data() ?? {};
    if (o.customerUid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "Not your order.");
    }
    if (o.paymentStatus === "paid") {
      throw new HttpsError("failed-precondition", "This order is already paid.", { reason: "already_paid" });
    }
    if (CLOSED_STATUSES.includes(String(o.status ?? "").toLowerCase())) {
      throw new HttpsError("failed-precondition", "This order is no longer open for payment.", { reason: "closed" });
    }
    // Orders placed through placeFoodOrder carry the engine's snapshot, which
    // only the server writes (rules keep it off-limits to clients). Charge it
    // as-is; the legacy floor check is for orders the app wrote itself.
    const snapshot = o.pricing as { engineVersion?: unknown; totals?: { totalPaise?: unknown } } | undefined;
    const snapshotTotal = Number(snapshot?.totals?.totalPaise);
    const engineOrder = typeof snapshot?.engineVersion === "string" && Number.isSafeInteger(snapshotTotal) && snapshotTotal > 0;
    const check = engineOrder ? null : await verifyCustomerOrderPricing(o);
    if (check && !check.ok) {
      // An online order that can't be paid must not stay live for the
      // kitchen and rider dispatch.
      await orderRef.update({
        pricingCheck: pricingAudit(check),
        status: "cancelled",
        cancelReason: "Payment not started: the order's prices didn't match the menu.",
        cancelledBy: "system",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new HttpsError("failed-precondition", pricingRefusal(check));
    }
    if (check) await orderRef.update({ pricingCheck: pricingAudit(check) });
    const chargePaise = check ? Math.round(check.declaredTotal * 100) : snapshotTotal;

    if (!Number.isSafeInteger(chargePaise) || chargePaise <= 0) {
      throw new HttpsError("invalid-argument", "Invalid amount.");
    }

    const { keyId, keySecret } = gatewayKeys();
    if (!keyId || !keySecret) {
      throw new HttpsError(
        "failed-precondition",
        "Online payment gateway is not configured on the server. Please choose Cash on Delivery or Pay with Wallet."
      );
    }
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    // Reuse the gateway order from an earlier attempt while it is still open.
    // Razorpay accepts only one successful payment per gateway order, so a
    // customer who retries after a slow UPI approval can't be charged twice.
    const pending = o.pendingGatewayOrder as { id?: unknown; amountPaise?: unknown } | undefined;
    if (pending && typeof pending.id === "string" && Number(pending.amountPaise) === chargePaise) {
      const existing = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(pending.id)}`, {
        headers: { Authorization: `Basic ${auth}` },
      })
        .then(async (r) => (r.ok ? ((await r.json()) as { id: string; amount: number; currency: string; status?: string }) : null))
        .catch(() => null);
      if (existing?.status === "paid") {
        throw new HttpsError(
          "failed-precondition",
          "We've already received a payment for this order and are confirming it. Check the order in a minute.",
          { reason: "payment_confirming" },
        );
      }
      if (existing && (existing.status === "created" || existing.status === "attempted")) {
        return { razorpayOrderId: existing.id, amount: existing.amount, currency: existing.currency, keyId };
      }
    }

    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: chargePaise,
        currency: "INR",
        // Unique per attempt: Razorpay rejects a reused receipt, which made
        // every retry after the first gateway order fail.
        receipt: uniqueReceipt(orderId),
        // Every note is server-decided: the webhook routes money by them.
        notes: {
          firestoreOrderId: orderId,
          uid: request.auth.uid,
          payment_context: "FOOD_ORDER",
          // Readable in the Razorpay dashboard and settlement reports, so a
          // payment can be matched to its order and restaurant without our admin.
          order_number: String(o.orderNumber ?? "").slice(0, 40),
          restaurant_id: String(o.restaurantId ?? "").slice(0, 128),
          restaurant: String(o.restaurantName ?? "").slice(0, 120),
        },
      }),
    });

    if (!res.ok) {
      console.error("Razorpay order creation failed:", res.status, await res.text());
      throw new HttpsError("unavailable", "Couldn't start the payment. Nothing was charged — please try again.");
    }
    const order = (await res.json()) as { id: string; amount: number; currency: string };
    // Bind the gateway order to this order for reconciliation, support and reuse.
    await orderRef.update({
      razorpayOrderIds: admin.firestore.FieldValue.arrayUnion(order.id),
      pendingGatewayOrder: { id: order.id, amountPaise: order.amount },
    });
    return { razorpayOrderId: order.id, amount: order.amount, currency: order.currency, keyId };
  },
);

export const verifyRazorpayPayment = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in to confirm payment.");
    }
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = request.data || {};
    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new HttpsError("invalid-argument", "Missing payment verification fields.");
    }

    const { keyId, keySecret } = gatewayKeys();
    if (!keySecret) {
      throw new HttpsError("failed-precondition", "Online payment gateway secret is missing.");
    }
    if (!signatureMatches(keySecret, String(razorpayOrderId), String(razorpayPaymentId), String(razorpaySignature))) {
      throw new HttpsError("permission-denied", "Payment signature verification failed.");
    }

    // Only the customer who owns the order may confirm it.
    const snap = await admin.firestore().collection("orders").doc(String(orderId)).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }
    if (snap.data()?.customerUid !== request.auth.uid) {
      throw new HttpsError("permission-denied", "Not your order.");
    }

    // The signature proves a payment happened on `razorpayOrderId`, not that
    // the gateway order was for THIS order or its amount. A ₹1 gateway order,
    // or another order's payment, used to mark any order paid. Ask Razorpay
    // what the gateway order was created for.
    let gatewayOrder: GatewayOrder | null = null;
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const res = await fetch(
        `https://api.razorpay.com/v1/orders/${encodeURIComponent(String(razorpayOrderId))}`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (res.ok) {
        gatewayOrder = (await res.json()) as GatewayOrder;
      } else {
        console.error("verifyRazorpayPayment: gateway order lookup failed", res.status, await res.text());
      }
    } catch (e) {
      console.error("verifyRazorpayPayment: gateway order lookup error", e);
    }
    if (!gatewayOrder) {
      throw new HttpsError(
        "unavailable",
        "Couldn't confirm this payment with the gateway yet. If money was taken, the order will be confirmed automatically within a few minutes.",
      );
    }
    if (String(gatewayOrder.notes?.firestoreOrderId ?? "") !== String(orderId)) {
      throw new HttpsError("permission-denied", "This payment belongs to a different order.");
    }

    // Idempotent and shared with the webhook: a retry, or the webhook getting
    // there first, changes nothing. Money the order can't use is refunded.
    const { outcome } = await applyFoodOrderPayment({
      orderId: String(orderId),
      razorpayOrderId: String(razorpayOrderId),
      paymentId: String(razorpayPaymentId),
      amountPaise: Number(gatewayOrder.amount) || 0,
      source: "app",
    });

    if (outcome === "closed" || outcome === "underpaid" || outcome === "missing") {
      throw new HttpsError(
        "failed-precondition",
        strayPaymentMessage(outcome, Number(gatewayOrder.amount) || 0),
        { reason: "refunded", outcome },
      );
    }
    return {
      ok: true,
      status: outcome,
      // Paid twice: the order is paid, and the extra payment is on its way back.
      ...(outcome === "duplicate" ? { notice: strayPaymentMessage(outcome, Number(gatewayOrder.amount) || 0) } : {}),
    };
  },
);

function gatewayKeys(): { keyId: string; keySecret: string } {
  try {
    return {
      keyId: RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "",
      keySecret: RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "",
    };
  } catch (_) {
    return { keyId: process.env.RAZORPAY_KEY_ID || "", keySecret: process.env.RAZORPAY_KEY_SECRET || "" };
  }
}
