/**
 * ─────────────────────────────────────────────────────────────────────────
 * Refund execution through the payment gateway.
 *
 * Before this module NOTHING in the codebase called Razorpay's refund API.
 * Refunds with method "original" were written as `status: "completed"` while
 * no money moved, and a restaurant rejecting a paid order refunded nobody.
 *
 * Model: the caller records a `platform_refunds/{refundId}` doc in
 * `pending_execution` inside its own transaction (so the order change and the
 * refund intent commit together). This module then claims that doc
 * atomically and calls the gateway exactly once. External HTTP cannot run
 * inside a Firestore transaction, hence the two-phase shape.
 *
 * Idempotency: the claim moves pending_execution/failed → executing in a
 * transaction, so two concurrent callers can never both hit the gateway.
 * Razorpay also refuses to refund more than was captured, which is a second
 * backstop against a double refund.
 * ─────────────────────────────────────────────────────────────────────────
 */
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { normaliseStatus, toPaise } from "./vendorOrderRules";

// Same secrets payments.ts uses; both are already set in Secret Manager.
export const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
export const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

function creds(): { keyId: string; keySecret: string } {
  try {
    return {
      keyId: RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "",
      keySecret: RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "",
    };
  } catch {
    return {
      keyId: process.env.RAZORPAY_KEY_ID || "",
      keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    };
  }
}

export interface RefundExecution {
  status: string;
  razorpayRefundId?: string;
  error?: string;
}

async function markFailed(
  refundId: string,
  orderId: string,
  message: string,
): Promise<RefundExecution> {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(
    db.collection("platform_refunds").doc(refundId),
    { status: "failed", error: message.slice(0, 500), failedAt: now },
    { merge: true },
  );
  if (orderId) {
    batch.set(
      db.collection("orders").doc(orderId),
      { refundStatus: "failed", updatedAt: now },
      { merge: true },
    );
  }
  // A failed refund is money owed to a customer — ops must see it.
  batch.set(db.collection("admin_notifications").doc(`refund_failed_${refundId}`), {
    type: "refund_failed",
    title: "Customer refund failed",
    message: `Refund ${refundId} for order ${orderId || "?"} failed: ${message}`.slice(0, 500),
    orderId: orderId || null,
    refundId,
    read: false,
    createdAt: now,
  });
  await batch.commit();
  logger.error("Razorpay refund failed", { refundId, orderId, message });
  return { status: "failed", error: message };
}

export async function executeRazorpayRefund(refundId: string): Promise<RefundExecution> {
  const db = admin.firestore();
  const refundRef = db.collection("platform_refunds").doc(refundId);

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(refundRef);
    if (!snap.exists) return { proceed: false as const, status: "missing" };
    const r = snap.data() ?? {};
    if (r.status === "completed") {
      return { proceed: false as const, status: "completed", razorpayRefundId: r.razorpayRefundId };
    }
    if (r.status !== "pending_execution" && r.status !== "failed") {
      return { proceed: false as const, status: String(r.status ?? "unknown") };
    }
    tx.update(refundRef, {
      status: "executing",
      executingAt: admin.firestore.FieldValue.serverTimestamp(),
      attempts: admin.firestore.FieldValue.increment(1),
    });
    return { proceed: true as const, r };
  });

  if (!claim.proceed) {
    return { status: claim.status, razorpayRefundId: (claim as { razorpayRefundId?: string }).razorpayRefundId };
  }

  const r = claim.r;
  const orderId = String(r.orderId ?? "");
  const paymentId = String(r.razorpayPaymentId ?? "");
  const amountPaise = Number(r.amountPaise);
  if (!paymentId || !Number.isFinite(amountPaise) || amountPaise <= 0) {
    return markFailed(refundId, orderId, "Refund record is missing the payment id or amount.");
  }

  const { keyId, keySecret } = creds();
  if (!keyId || !keySecret) {
    return markFailed(refundId, orderId, "Payment gateway keys are not configured on the server.");
  }

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    // A retry (a failed attempt, or an execution interrupted mid-call) may
    // follow a request Razorpay actually accepted — the timeout hid the reply.
    // Adopt that refund instead of sending a second one.
    if (Number(r.attempts ?? 0) >= 1) {
      const prior = await findGatewayRefund(auth, paymentId, refundId);
      if (prior) {
        logger.warn("Adopted a refund the gateway already made", { refundId, razorpayRefundId: prior.id });
        return markCompleted(refundId, orderId, r, prior);
      }
    }
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountPaise,
          speed: "normal",
          receipt: refundId.slice(0, 40),
          notes: { kada_order_id: orderId, kada_refund_id: refundId },
        }),
      },
    );
    const text = await res.text();
    let json: Record<string, any> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const msg = json?.error?.description || text || `HTTP ${res.status}`;
      return markFailed(refundId, orderId, `Razorpay: ${msg}`);
    }

    return markCompleted(refundId, orderId, r, json);
  } catch (e) {
    return markFailed(refundId, orderId, e instanceof Error ? e.message : String(e));
  }
}

/** The gateway refund already created for this refund record, if any. */
async function findGatewayRefund(
  auth: string,
  paymentId: string,
  refundId: string,
): Promise<Record<string, any> | null> {
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  // Can't tell: refuse to resend blind. The caller marks it failed and the
  // next attempt asks again.
  if (!res.ok) throw new Error(`Couldn't check existing refunds (HTTP ${res.status}).`);
  const body = (await res.json()) as { items?: Record<string, any>[] };
  return (
    (body.items ?? []).find(
      (x) => x?.notes?.kada_refund_id === refundId || x?.receipt === refundId.slice(0, 40),
    ) ?? null
  );
}

async function markCompleted(
  refundId: string,
  orderId: string,
  r: FirebaseFirestore.DocumentData,
  json: Record<string, any>,
): Promise<RefundExecution> {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(
    db.collection("platform_refunds").doc(refundId),
    {
      // "completed" = the gateway accepted the refund. Its own lifecycle
      // (pending → processed / failed) arrives as refund.* webhooks and is
      // kept in gatewayStatus.
      status: "completed",
      razorpayRefundId: json.id ?? null,
      gatewayStatus: json.status ?? null,
      error: admin.firestore.FieldValue.delete(),
      completedAt: now,
    },
    { merge: true },
  );
  if (orderId) {
    batch.set(
      db.collection("orders").doc(orderId),
      {
        // A partial admin refund must not relabel the order fully refunded.
        refundStatus: r.onSuccessRefundStatus === "partial" ? "partial" : "refunded",
        razorpayRefundId: json.id ?? null,
        refundedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  await batch.commit();
  logger.info("Razorpay refund executed", { refundId, orderId, razorpayRefundId: json.id });
  return { status: "completed", razorpayRefundId: json.id };
}

/**
 * Refunds left in `executing` — the function died between claiming the record
 * and recording the gateway's answer. Run from the 5-minute payment sweep:
 * after 15 minutes the record is released and re-executed, and the
 * already-refunded check above stops a second refund if the first one landed.
 */
export async function recoverStuckRefunds(): Promise<number> {
  const db = admin.firestore();
  const cutoff = Date.now() - 15 * 60_000;
  const snap = await db.collection("platform_refunds").where("status", "==", "executing").limit(50).get();
  let recovered = 0;
  for (const doc of snap.docs) {
    const at = doc.get("executingAt");
    if (!(at instanceof admin.firestore.Timestamp) || at.toMillis() > cutoff) continue;
    const released = await db.runTransaction(async (tx) => {
      const cur = await tx.get(doc.ref);
      if (cur.get("status") !== "executing") return false;
      tx.update(doc.ref, { status: "failed", error: "Interrupted while executing; re-checking with the gateway." });
      return true;
    });
    if (!released) continue;
    const out = await executeRazorpayRefund(doc.id);
    if (out.status === "completed") recovered++;
  }
  return recovered;
}

/**
 * refund.processed / refund.failed webhooks. Our record says "completed" once
 * Razorpay accepts a refund; this keeps the gateway's later verdict on it, and
 * turns a refund the bank bounced back into a failed one ops can retry.
 */
export async function applyRefundEvent(eventType: string, refund: Record<string, any>): Promise<void> {
  const refundId = String(refund?.notes?.kada_refund_id ?? "");
  if (!refundId) return; // a refund made from the Razorpay dashboard, not by Kada
  const db = admin.firestore();
  const ref = db.collection("platform_refunds").doc(refundId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const now = admin.firestore.FieldValue.serverTimestamp();
  if (eventType === "refund.failed") {
    await markFailed(refundId, String(snap.get("orderId") ?? ""), "The bank or gateway rejected the refund after it was accepted.");
    return;
  }
  await ref.set(
    {
      razorpayRefundId: refund.id ?? snap.get("razorpayRefundId") ?? null,
      gatewayStatus: refund.status ?? (eventType === "refund.processed" ? "processed" : null),
      ...(eventType === "refund.processed" ? { gatewayProcessedAt: now } : {}),
      ...(refund.acquirer_data?.arn ? { arn: String(refund.acquirer_data.arn) } : {}),
    },
    { merge: true },
  );
}

export interface RefundOutcome {
  refundId: string;
  amount: number;
  method: string;
  status: string;
}

/**
 * Stages the refund for a cancelled or rejected platform-paid order inside the
 * caller's transaction, and returns the order fields to merge. Wallet money is
 * credited back atomically; a Razorpay payment is recorded as
 * `pending_execution` for executeRazorpayRefund to run after commit; any other
 * method is queued for a human and never silently dropped. Shared by the
 * restaurant (vendorTransitionOrder) and customer (customerCancelOrder) paths.
 * The caller must finish all its transaction reads before calling this.
 */
export function stageCancellationRefund(args: {
  tx: FirebaseFirestore.Transaction;
  order: FirebaseFirestore.DocumentData;
  orderId: string;
  refundId: string;
  amount: number;
  /** Shown to the customer on their wallet ledger. */
  reason: string;
  /** Recorded on the refund doc and in ops alerts, e.g. "Restaurant rejected: …". */
  ledgerReason: string;
  source: string;
  requestedBy: string;
  requestedByRole: string;
}): { patch: Record<string, unknown>; refund: RefundOutcome } {
  const { tx, order: o, orderId, refundId, amount, reason, ledgerReason } = args;
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const refundRef = db.collection("platform_refunds").doc(refundId);
  const method = normaliseStatus(o.paymentMethod);
  const customerUid = String(o.customerUid ?? "");
  const totalRefunded = Math.round((Number(o.refundAmount) || 0) * 100) / 100 + amount;
  const base = {
    orderId,
    orderNumber: o.orderNumber ?? null,
    restaurantId: o.restaurantId ?? null,
    restaurantName: o.restaurantName ?? null,
    customerUid: customerUid || null,
    amount,
    reason: ledgerReason,
    source: args.source,
    requestedBy: args.requestedBy,
    requestedByRole: args.requestedByRole,
    createdAt: now,
  };

  if (method === "wallet" && customerUid) {
    // Wallet money never left the platform: credit it back atomically.
    const userRef = db.collection("customer_users").doc(customerUid);
    tx.set(
      userRef,
      { walletBalance: admin.firestore.FieldValue.increment(amount), updatedAt: now },
      { merge: true },
    );
    tx.set(userRef.collection("wallet_transactions").doc(`refund_${orderId}`), {
      type: "credit",
      amount,
      title: "Order refund",
      description: `Refund for order ${o.orderNumber ?? orderId}: ${reason}`,
      orderId,
      createdAt: now,
    });
    tx.set(refundRef, { ...base, method: "wallet", status: "completed", completedAt: now });
    return {
      patch: {
        refundStatus: "refunded",
        refundAmount: totalRefunded,
        refundMethod: "wallet",
        refundReason: reason,
        refundedAt: now,
      },
      refund: { refundId, amount, method: "wallet", status: "completed" },
    };
  }

  if (method === "razorpay" && o.razorpayPaymentId) {
    // The gateway call happens after commit (HTTP can't run in a transaction).
    tx.set(refundRef, {
      ...base,
      method: "original",
      status: "pending_execution",
      razorpayPaymentId: String(o.razorpayPaymentId),
      amountPaise: toPaise(amount),
    });
    return {
      patch: {
        refundStatus: "processing",
        refundAmount: totalRefunded,
        refundMethod: "original",
        refundReason: reason,
      },
      refund: { refundId, amount, method: "original", status: "pending_execution" },
    };
  }

  // Paid, but by a method we can't reverse automatically: queue for a human.
  tx.set(refundRef, { ...base, method: method || "unknown", status: "needs_manual_review" });
  tx.set(db.collection("admin_notifications").doc(`refund_review_${refundId}`), {
    type: "refund_needs_review",
    title: "Refund needs manual action",
    message: `Order ${o.orderNumber ?? orderId} (${ledgerReason}) was paid via "${method || "unknown"}".`,
    orderId,
    refundId,
    read: false,
    createdAt: now,
  });
  return {
    patch: { refundStatus: "pending_manual", refundAmount: totalRefunded, refundReason: reason },
    refund: { refundId, amount, method: method || "unknown", status: "needs_manual_review" },
  };
}
