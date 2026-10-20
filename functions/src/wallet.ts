import * as admin from "firebase-admin";
import { assertModuleEnabled } from "./featureFlags";
import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { pricingRefusal } from "./orderPricing";
import { HOT_PATH } from "./options";
import { enforceRateLimit } from "./rateLimit";
import { pricingAudit, verifyCustomerOrderPricing } from "./orderPricingServer";

/**
 * Server-authoritative Kada wallet top-ups via Razorpay.
 *
 * The client must NOT credit `walletBalance` itself — it would be free money.
 * Instead:
 *   1. App calls `createWalletTopupOrder({ amount })` → we create a Razorpay
 *      order, record the intended amount in `wallet_topups/{razorpayOrderId}`,
 *      and return the order id + public key for checkout.
 *   2. App opens Razorpay checkout, the customer pays.
 *   3. App calls `verifyWalletTopup(...)`; we verify the HMAC signature, then
 *      credit the wallet by the SERVER-recorded amount (never the client's) in
 *      a transaction that is idempotent per top-up (double submits do nothing).
 *
 * Reuses the same Razorpay secrets as payments.ts.
 */
const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const MIN_TOPUP = 1;
const MAX_TOPUP = 100000;

export const createWalletTopupOrder = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to add money.");
    }
    await assertModuleEnabled("wallet", "Kada Money top-ups are paused right now.");
    // Each call creates a gateway order; a retry loop shouldn't hammer Razorpay.
    await enforceRateLimit(`wallet_topup_${uid}`, 20, 10 * 60_000);
    const amount = Number(request.data?.amount);
    if (!Number.isFinite(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
      throw new HttpsError("invalid-argument", "Invalid top-up amount.");
    }
    const rounded = Math.round(amount);

    let keyId = "";
    let keySecret = "";
    try {
      keyId = RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "";
      keySecret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
    } catch (_) {
      keyId = process.env.RAZORPAY_KEY_ID || "";
      keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    }

    if (!keyId || !keySecret) {
      throw new HttpsError(
        "failed-precondition",
        "Online payment gateway is not configured on the server. Please try again later."
      );
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: rounded * 100, // paise
        currency: "INR",
        receipt: `wallet_${uid.slice(0, 8)}_${Date.now()}`,
        notes: { 
          purpose: "wallet_topup", 
          uid,
          payment_context: "WALLET_TOPUP"
        },
      }),
    });

    if (!res.ok) {
      console.error("Razorpay wallet top-up order creation failed:", res.status, await res.text());
      throw new HttpsError("unavailable", "Couldn't start the top-up. Nothing was charged — please try again.");
    }
    const order = (await res.json()) as { id: string; amount: number; currency: string };

    // Record the authoritative amount so verify credits exactly this, once.
    await admin.firestore().collection("wallet_topups").doc(order.id).set({
      uid,
      amount: rounded,
      status: "created",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { razorpayOrderId: order.id, amount: order.amount, currency: order.currency, keyId };
  },
);

export const verifyWalletTopup = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to confirm payment.");
    }
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = request.data || {};
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new HttpsError("invalid-argument", "Missing payment verification fields.");
    }

    let keySecret = "";
    try {
      keySecret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
    } catch (_) {
      keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    }

    if (!keySecret) {
      throw new HttpsError(
        "failed-precondition",
        "Online payment gateway secret is missing."
      );
    }

    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    const valid =
      expected.length === String(razorpaySignature).length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpaySignature)));

    if (!valid) {
      throw new HttpsError("permission-denied", "Payment signature verification failed.");
    }

    let keyId = "";
    try {
      keyId = RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "";
    } catch (_) {
      keyId = process.env.RAZORPAY_KEY_ID || "";
    }
    const basic = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const payRes = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(String(razorpayPaymentId))}`,
      { headers: { Authorization: `Basic ${basic}` } },
    );
    if (!payRes.ok) {
      console.error("verifyWalletTopup: payment lookup failed", payRes.status, await payRes.text());
      throw new HttpsError(
        "unavailable",
        "Couldn't confirm this payment with Razorpay yet. If money was taken, the wallet will update automatically.",
      );
    }
    const payment = (await payRes.json()) as { status?: string; order_id?: string; amount?: number };
    if (payment.status !== "captured" && payment.status !== "authorized") {
      throw new HttpsError("failed-precondition", "This payment is not captured yet.");
    }
    if (String(payment.order_id ?? "") !== String(razorpayOrderId)) {
      throw new HttpsError("permission-denied", "This payment belongs to a different top-up.");
    }

    const db = admin.firestore();
    const topupRef = db.collection("wallet_topups").doc(String(razorpayOrderId));
    const userRef = db.collection("customer_users").doc(uid);

    const newBalance = await db.runTransaction(async (txn) => {
      const topupSnap = await txn.get(topupRef);
      if (!topupSnap.exists) {
        throw new HttpsError("not-found", "Top-up record not found.");
      }
      const topup = topupSnap.data() ?? {};
      if (topup.uid !== uid) {
        throw new HttpsError("permission-denied", "Not your top-up.");
      }
      // Idempotency: a payment already credited must never credit again.
      if (topup.status === "credited") {
        const bal = Number((await txn.get(userRef)).data()?.walletBalance) || 0;
        return bal;
      }
      const amount = Number(topup.amount) || 0;
      if (amount <= 0) {
        throw new HttpsError("failed-precondition", "Invalid recorded amount.");
      }
      if (Number(payment.amount) !== Math.round(amount * 100)) {
        throw new HttpsError("permission-denied", "The amount paid does not match this top-up.");
      }

      const userSnap = await txn.get(userRef);
      const prev = Number(userSnap.data()?.walletBalance) || 0;
      const next = prev + amount;

      txn.set(userRef, { walletBalance: next }, { merge: true });
      txn.set(
        userRef.collection("wallet_transactions").doc(),
        {
          type: "topup",
          amount,
          title: "Wallet top-up",
          description: `Added ₹${amount} via Razorpay`,
          balanceAfter: next,
          razorpayPaymentId: String(razorpayPaymentId),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      );
      txn.update(topupRef, {
        status: "credited",
        razorpayPaymentId: String(razorpayPaymentId),
        creditedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return next;
    });

    return { ok: true, newBalance };
  },
);

/**
 * Server-authoritative wallet payment for an order. The client creates the
 * order as `pending`, then calls this — we verify ownership + amount, debit the
 * wallet, mark the order paid, and write a ledger entry, all in one idempotent
 * transaction. The client never sets `paymentStatus: paid` or writes the
 * balance itself.
 */
export const payOrderWithWallet = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to pay.");
  }
  const orderId = String(request.data?.orderId || "");
  if (!orderId) {
    throw new HttpsError("invalid-argument", "orderId is required.");
  }
  await assertModuleEnabled("wallet", "Paying with Kada Money is paused right now. Please pay online.");

  const db = admin.firestore();
  const orderRef = db.collection("orders").doc(orderId);
  const userRef = db.collection("customer_users").doc(uid);

  // Debit only an order whose total covers the server-verified menu price.
  // The app writes `total` itself, so it used to be charged as-is.
  const pre = await orderRef.get();
  if (!pre.exists) {
    throw new HttpsError("not-found", "Order not found.");
  }
  const preData = pre.data() ?? {};
  if (preData.customerUid !== uid) {
    throw new HttpsError("permission-denied", "Not your order.");
  }
  const engineOrder = typeof (preData.pricing as { engineVersion?: unknown } | undefined)?.engineVersion === "string";
  if (preData.paymentStatus !== "paid" && !engineOrder) {
    const check = await verifyCustomerOrderPricing(preData);
    if (!check.ok) {
      await orderRef.update({
        pricingCheck: pricingAudit(check),
        status: "cancelled",
        cancelReason: "Payment not started: the order's prices didn't match the menu.",
        cancelledBy: "system",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new HttpsError("failed-precondition", pricingRefusal(check));
    }
    await orderRef.update({ pricingCheck: pricingAudit(check) });
  }

  const result = await db.runTransaction(async (txn) => {
    const orderSnap = await txn.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }
    const o = orderSnap.data() ?? {};
    if (o.customerUid !== uid) {
      throw new HttpsError("permission-denied", "Not your order.");
    }
    // Idempotent: never charge twice.
    if (o.paymentStatus === "paid") {
      const bal = Number((await txn.get(userRef)).data()?.walletBalance) || 0;
      return { alreadyPaid: true, newBalance: bal, amount: 0 };
    }
    if (["cancelled", "canceled", "rejected", "completed", "delivered"].includes(String(o.status ?? "").toLowerCase())) {
      throw new HttpsError("failed-precondition", "This order is no longer open for payment.");
    }
    if (Number(o.total ?? o.totalAmount ?? 0) !== Number(preData.total ?? preData.totalAmount ?? 0)) {
      throw new HttpsError("aborted", "The order changed while paying. Please try again.");
    }
    const amount = Number(o.total ?? o.totalAmount ?? 0) || 0;
    if (amount <= 0) {
      throw new HttpsError("failed-precondition", "Order amount is invalid.");
    }

    const userSnap = await txn.get(userRef);
    const balance = Number(userSnap.data()?.walletBalance) || 0;
    if (balance < amount) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient wallet balance. Add ₹${Math.ceil(amount - balance)} to pay.`
      );
    }
    const newBalance = balance - amount;

    txn.set(userRef, { walletBalance: newBalance }, { merge: true });
    txn.set(userRef.collection("wallet_transactions").doc(), {
      type: "order_payment",
      amount: -amount,
      title: "Order payment",
      description: `Paid ₹${amount} for order`,
      orderId,
      balanceAfter: newBalance,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    txn.update(orderRef, {
      paymentStatus: "paid",
      paymentMethod: "wallet",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { alreadyPaid: false, newBalance, amount };
  });

  return { ok: true, ...result };
});

/**
 * Credit a captured top-up to the customer's wallet, exactly once. Shared by
 * the webhook and the payment sweep (paymentSweep.ts); verifyWalletTopup does
 * the same under the caller's uid. The amount credited is the one recorded
 * when the top-up was created, never the gateway's word alone.
 */
export async function creditWalletTopup(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  capturedPaise: number,
): Promise<"credited" | "already_credited" | "missing"> {
  const db = admin.firestore();
  const topupRef = db.collection("wallet_topups").doc(razorpayOrderId);
  return db.runTransaction(async (txn) => {
    const snap = await txn.get(topupRef);
    if (!snap.exists) return "missing" as const;
    const topup = snap.data() ?? {};
    if (topup.status === "credited") return "already_credited" as const;
    const uid = String(topup.uid ?? "");
    const amount = Number(topup.amount) || 0;
    if (!uid || amount <= 0) return "missing" as const;
    if (Math.round(amount * 100) !== Number(capturedPaise)) {
      throw new Error(
        `Wallet top-up amount mismatch: expected ${Math.round(amount * 100)}, received ${capturedPaise}`,
      );
    }
    const userRef = db.collection("customer_users").doc(uid);
    const prev = Number((await txn.get(userRef)).data()?.walletBalance) || 0;
    const next = prev + amount;
    txn.set(userRef, { walletBalance: next }, { merge: true });
    txn.set(userRef.collection("wallet_transactions").doc(), {
      type: "topup",
      amount,
      title: "Wallet top-up",
      description: `Added ₹${amount} via Razorpay`,
      balanceAfter: next,
      razorpayPaymentId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    txn.update(topupRef, {
      status: "credited",
      razorpayPaymentId,
      creditedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return "credited" as const;
  });
}
