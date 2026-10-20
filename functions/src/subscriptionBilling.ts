import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { readCatalog, findPlan, type PlanProduct } from "./planCatalog";
import { refundStrayPayment, signatureMatches } from "./paymentCapture";
import { executeRazorpayRefund } from "./refunds";
import { uniqueReceipt } from "./gateway";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Razorpay subscription billing — the web replacement for in-app purchase.
 *
 * Kada Dine and Kada Host are B2B business software. Under App Review
 * guideline 3.1.3(e) (Enterprise Services) the subscription is sold on the
 * WEB and the mobile apps are pure clients that read entitlement — the same
 * model Square/Toast/Shopify POS use. The apps therefore carry no purchase
 * UI at all.
 *
 * The PRICE IS DECIDED SERVER-SIDE from `config/plan_catalog`. The client only
 * names a plan and a billing period; it can never supply an amount.
 * ─────────────────────────────────────────────────────────────────────────
 */

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

type BillingPeriod = "monthly" | "yearly";

/** Merchant collection for each product. */
function collectionFor(product: PlanProduct): string {
  return product === "stay" ? "hotels" : "restaurants";
}

/**
 * Price a plan for a billing period, in whole rupees.
 * Annual is charged as 12 × the effective monthly rate.
 */
export function priceFor(
  plan: { monthlyPrice: number | null; annualPrice: number | null },
  period: BillingPeriod,
): number | null {
  if (period === "yearly") {
    return plan.annualPrice === null ? null : Math.round(plan.annualPrice * 12);
  }
  return plan.monthlyPrice === null ? null : Math.round(plan.monthlyPrice);
}

/**
 * The signature proves Razorpay signed this payment id. It does not prove the
 * payment was captured, or that it was for the amount we priced. Ask Razorpay.
 */
async function assertCapturedPayment(args: {
  keyId: string;
  keySecret: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  expectedPaise: number;
}): Promise<void> {
  if (!args.keyId || !args.keySecret) {
    throw new HttpsError("failed-precondition", "Payments are not configured on the server.");
  }
  const auth = Buffer.from(`${args.keyId}:${args.keySecret}`).toString("base64");
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(args.razorpayPaymentId)}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) {
    logger.error("Subscription payment lookup failed", res.status, await res.text());
    throw new HttpsError(
      "unavailable",
      "Couldn't confirm this payment with Razorpay yet. If money was taken, the plan will activate automatically.",
    );
  }
  const payment = (await res.json()) as { status?: string; order_id?: string; amount?: number };
  const status = String(payment.status ?? "");
  if (status !== "captured" && status !== "authorized") {
    throw new HttpsError("failed-precondition", "This payment is not captured yet.");
  }
  if (String(payment.order_id ?? "") !== args.razorpayOrderId) {
    throw new HttpsError("permission-denied", "This payment belongs to a different order.");
  }
  if (Number(payment.amount) !== args.expectedPaise) {
    throw new HttpsError("permission-denied", "The amount paid does not match this plan.");
  }
}

/** Create a Razorpay order for a subscription purchase. Web only. */
export const createSubscriptionOrder = onCall(
  { secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET], maxInstances: 3 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

    // `confirm` activates straight after checkout instead of waiting on the
    // webhook (which still activates it if the browser closed first). Same
    // endpoint on purpose: every function reserves CPU quota.
    if (request.data?.confirm) {
      const c = request.data.confirm as Record<string, unknown>;
      const razorpayOrderId = String(c.razorpayOrderId ?? "");
      const razorpayPaymentId = String(c.razorpayPaymentId ?? "");
      const signature = String(c.razorpaySignature ?? "");
      let secret = "";
      try {
        secret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
      } catch {
        secret = process.env.RAZORPAY_KEY_SECRET || "";
      }
      if (!razorpayOrderId || !razorpayPaymentId || !secret || !signatureMatches(secret, razorpayOrderId, razorpayPaymentId, signature)) {
        throw new HttpsError("permission-denied", "Payment signature verification failed.");
      }
      const rec = (await admin.firestore().collection("subscription_orders").doc(razorpayOrderId).get()).data();
      if (!rec || String(rec.uid ?? "") !== uid) throw new HttpsError("permission-denied", "Not your purchase.");
      let keyId = "";
      try {
        keyId = RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "";
      } catch {
        keyId = process.env.RAZORPAY_KEY_ID || "";
      }
      await assertCapturedPayment({
        keyId,
        keySecret: secret,
        razorpayOrderId,
        razorpayPaymentId,
        expectedPaise: Math.round(Number(rec.amount) * 100),
      });
      await activateSubscription(razorpayOrderId, razorpayPaymentId);
      return { ok: true, activated: true };
    }

    // Cancel / resume. Plans are prepaid for a fixed period, so cancelling
    // never cuts off time already paid for: it stops the merchant from being
    // treated as a subscriber once the period ends (they fall back to
    // commission billing then). Resuming before that undoes it.
    if (request.data?.action === "cancel" || request.data?.action === "resume") {
      const product: PlanProduct = request.data?.product === "stay" ? "stay" : "dine";
      const ref = admin.firestore().collection(collectionFor(product)).doc(uid);
      const cur = (await ref.get()).data();
      if (!cur || cur.subscriptionStatus !== "active") {
        throw new HttpsError("failed-precondition", "There's no active subscription to change.");
      }
      const cancel = request.data.action === "cancel";
      await ref.set(
        {
          subscriptionCancelAtPeriodEnd: cancel,
          subscriptionCancelledAt: cancel ? admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true, cancelAtPeriodEnd: cancel };
    }

    const product: PlanProduct = (request.data?.product ?? "dine") === "stay" ? "stay" : "dine";
    const planId = (request.data?.planId ?? "").toString().trim();
    const period: BillingPeriod = request.data?.period === "yearly" ? "yearly" : "monthly";
    if (!planId) throw new HttpsError("invalid-argument", "planId is required.");

    // Price comes from the catalog — never from the client.
    const catalog = await readCatalog();
    const plan = findPlan(catalog, product, planId);
    if (!plan) throw new HttpsError("not-found", `Unknown plan "${planId}".`);
    if (!plan.active || !plan.visible) {
      throw new HttpsError("failed-precondition", `${plan.name} is not available.`);
    }
    const amount = priceFor(plan, period);
    if (amount === null || amount <= 0) {
      throw new HttpsError(
        "failed-precondition",
        `${plan.name} is sales-led — please contact the Kada team.`,
      );
    }

    let keyId = "";
    let keySecret = "";
    try {
      keyId = RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "";
      keySecret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
    } catch {
      keyId = process.env.RAZORPAY_KEY_ID || "";
      keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    }
    if (!keyId || !keySecret) {
      throw new HttpsError("failed-precondition", "Payments are not configured on the server.");
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amount * 100,
        currency: "INR",
        receipt: uniqueReceipt(`sub_${uid.slice(0, 8)}`),
        notes: {
          payment_context: "SUBSCRIPTION",
          uid,
          product,
          planId,
          period,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error("Subscription order creation failed:", text);
      throw new HttpsError("internal", "Could not start the payment. Please try again.");
    }
    const order = (await res.json()) as { id: string };

    // Record the authoritative intent BEFORE payment so the webhook activates
    // exactly what was priced here, not whatever a client later claims.
    await admin.firestore().collection("subscription_orders").doc(order.id).set({
      uid,
      product,
      planId,
      planName: plan.name,
      period,
      amount,
      status: "pending",
      razorpayOrderId: order.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { razorpayOrderId: order.id, amount, keyId, planName: plan.name, period };
  },
);

/**
 * Activate a subscription once its payment is captured. Called ONLY from the
 * signature-verified Razorpay webhook.
 *
 * Idempotent: a replayed webhook finds the order already activated and no-ops,
 * so a duplicate delivery can never extend a subscription twice.
 */
export async function activateSubscription(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<"paid" | "already_paid" | "duplicate" | "missing"> {
  const db = admin.firestore();
  const orderRef = db.collection("subscription_orders").doc(razorpayOrderId);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      logger.warn(`activateSubscription: no record for ${razorpayOrderId}`);
      return "missing" as const;
    }
    const o = snap.data() ?? {};
    if (o.status === "active" || o.status === "refunded") {
      // Same payment again (verify vs webhook vs sweep) → nothing to do. A
      // DIFFERENT payment on an order already used means the merchant paid
      // twice; that one goes back.
      return String(o.razorpayPaymentId ?? "") === razorpayPaymentId ? ("already_paid" as const) : ("duplicate" as const);
    }

    const uid = (o.uid ?? "").toString();
    const product: PlanProduct = o.product === "stay" ? "stay" : "dine";
    const period: BillingPeriod = o.period === "yearly" ? "yearly" : "monthly";
    if (!uid) return "missing" as const;

    const merchantRef = db.collection(collectionFor(product)).doc(uid);
    const merchantSnap = await tx.get(merchantRef);

    // Extend from the CURRENT expiry when still active, so paying early never
    // burns the remaining days the merchant already bought.
    const existingRaw = merchantSnap.data()?.subscriptionEndDate;
    const existingMs =
      existingRaw instanceof admin.firestore.Timestamp
        ? existingRaw.toMillis()
        : typeof existingRaw === "number"
          ? existingRaw
          : existingRaw
            ? Date.parse(String(existingRaw))
            : 0;
    const base = existingMs && existingMs > Date.now() ? existingMs : Date.now();
    const addMs = (period === "yearly" ? 365 : 30) * 86_400_000;
    const newEnd = new Date(base + addMs);

    tx.set(
      merchantRef,
      {
        subscriptionStatus: "active",
        subscriptionPlan: o.planId,
        subscriptionType: period,
        subscriptionEndDate: admin.firestore.Timestamp.fromDate(newEnd),
        subscriptionStartDate:
          merchantSnap.data()?.subscriptionStartDate ??
          admin.firestore.FieldValue.serverTimestamp(),
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        // Paying for a plan puts the merchant on the subscription billing model.
        billingModel: "subscription",
        // Paying again is a renewal: it clears a pending cancellation and any
        // grace window left from the previous period.
        subscriptionCancelAtPeriodEnd: false,
        subscriptionGraceEndDate: admin.firestore.FieldValue.delete(),
        lastSubscriptionOrderId: razorpayOrderId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      orderRef,
      {
        status: "active",
        razorpayPaymentId,
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        subscriptionEndDate: admin.firestore.Timestamp.fromDate(newEnd),
        // What this purchase added, so a refund can take exactly that back.
        previousEndDate: existingMs ? admin.firestore.Timestamp.fromMillis(existingMs) : null,
        addedDays: period === "yearly" ? 365 : 30,
      },
      { merge: true },
    );
    return "paid" as const;
  });

  if (outcome === "duplicate") {
    const rec = (await orderRef.get()).data() ?? {};
    await refundStrayPayment({
      paymentId: razorpayPaymentId,
      amountPaise: Math.round(Number(rec.amount ?? 0) * 100),
      kind: "subscription",
      relatedId: razorpayOrderId,
      outcome: "duplicate",
      source: "subscription",
    });
  } else if (outcome === "paid") {
    logger.info(`Subscription activated for order ${razorpayOrderId}`);
  }
  return outcome;
}

/**
 * Refund a subscription purchase (admin action) and take back exactly the
 * time it bought. Money goes through the shared two-phase refund engine;
 * entitlement is reversed in the same transaction that stages the refund, so
 * a merchant never keeps a refunded period.
 */
export async function refundSubscriptionOrder(args: {
  razorpayOrderId: string;
  reason: string;
  requestedBy: string;
}): Promise<{ refundId: string; status: string; error?: string }> {
  const db = admin.firestore();
  const orderRef = db.collection("subscription_orders").doc(args.razorpayOrderId);
  const refundId = `sub_${args.razorpayOrderId}`;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError("not-found", "Subscription purchase not found.");
    const o = snap.data() ?? {};
    if (o.status === "refunded") return; // staged before — the executor decides what is left
    if (o.status !== "active" || !o.razorpayPaymentId) {
      throw new HttpsError("failed-precondition", `Only a paid subscription can be refunded (this one is ${o.status ?? "unknown"}).`);
    }
    const product: PlanProduct = o.product === "stay" ? "stay" : "dine";
    const merchantRef = db.collection(collectionFor(product)).doc(String(o.uid));
    const m = (await tx.get(merchantRef)).data() ?? {};
    const endRaw = m.subscriptionEndDate;
    const endMs = endRaw instanceof admin.firestore.Timestamp ? endRaw.toMillis() : 0;
    const takeBackMs = (Number(o.addedDays) || (o.period === "yearly" ? 365 : 30)) * 86_400_000;
    const newEndMs = Math.max(Date.now(), endMs - takeBackMs);
    const lapsed = newEndMs <= Date.now();
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(
      merchantRef,
      {
        subscriptionEndDate: admin.firestore.Timestamp.fromMillis(newEndMs),
        ...(lapsed ? { subscriptionStatus: "expired" } : {}),
        updatedAt: now,
      },
      { merge: true },
    );
    tx.update(orderRef, { status: "refunded", refundId, refundReason: args.reason, refundedAt: now });
    tx.set(db.collection("platform_refunds").doc(refundId), {
      orderId: "",
      relatedKind: "subscription",
      relatedId: args.razorpayOrderId,
      merchantUid: String(o.uid),
      method: "original",
      status: "pending_execution",
      razorpayPaymentId: String(o.razorpayPaymentId),
      amountPaise: Math.round(Number(o.amount ?? 0) * 100),
      amount: Number(o.amount ?? 0),
      reason: args.reason,
      source: "admin",
      requestedBy: args.requestedBy,
      requestedByRole: "admin",
      createdAt: now,
    });
  });
  const exec = await executeRazorpayRefund(refundId);
  return { refundId, status: exec.status, ...(exec.error ? { error: exec.error } : {}) };
}

/** What the app/dashboard should show. Read-only entitlement. */
export const getSubscriptionStatus = onCall({ maxInstances: 3 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const product: PlanProduct = (request.data?.product ?? "dine") === "stay" ? "stay" : "dine";

  const snap = await admin.firestore().collection(collectionFor(product)).doc(uid).get();
  const d = snap.data() ?? {};
  const raw = d.subscriptionEndDate;
  const endMs =
    raw instanceof admin.firestore.Timestamp
      ? raw.toMillis()
      : typeof raw === "number"
        ? raw
        : raw
          ? Date.parse(String(raw))
          : 0;

  const status = (d.subscriptionStatus ?? "none").toString();
  // No trial mode: a merchant is active only on a paid, unexpired subscription.
  const active = status === "active" && (!endMs || endMs > Date.now());

  return {
    ok: true,
    active,
    status,
    plan: (d.subscriptionPlan ?? "").toString(),
    period: (d.subscriptionType ?? "").toString(),
    endsAt: endMs || null,
    billingModel: (d.billingModel ?? "commission").toString(),
    cancelAtPeriodEnd: d.subscriptionCancelAtPeriodEnd === true,
  };
});
