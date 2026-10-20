import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { signatureMatches } from "./paymentCapture";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * COD cash reconciliation for delivery partners.
 *
 * A rider collecting cash-on-delivery holds platform money. Previously
 * `cashInHand` only ever incremented, and the admin action blind-zeroed it —
 * no deposit record, no verification, no partial deposits, no audit trail.
 * Cash could not be reconciled.
 *
 * The rider now deposits collected cash back to Kada via Razorpay (UPI/card),
 * reusing the proven money-in rails:
 *   1. createCodDepositOrder → Razorpay order tagged COD_DEPOSIT + a pending
 *      `cod_deposits/{razorpayOrderId}` record holding the SERVER-decided amount.
 *   2. Rider pays in the app.
 *   3. The signature-verified webhook settles it: decrements `cashInHand` by the
 *      recorded amount and marks the deposit settled — atomically and exactly
 *      once, so a replayed webhook can never double-credit.
 *
 * The client never decides how much is owed and never writes `cashInHand`.
 * ─────────────────────────────────────────────────────────────────────────
 */

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const MIN_DEPOSIT = 1;

/** Rider starts a COD cash deposit. Amount is capped at what they actually owe. */
export const createCodDepositOrder = onCall(
  { secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET], maxInstances: 3 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

    // `confirm` settles a deposit straight after checkout, so the rider sees
    // their balance drop at once instead of waiting on the webhook (which
    // still settles it if the app closed first). Folded into this endpoint
    // rather than a new function: every function reserves CPU quota.
    if (request.data?.confirm) {
      return confirmCodDeposit(uid, request.data.confirm as Record<string, unknown>);
    }

    const db = admin.firestore();
    const riderRef = db.collection("delivery_users").doc(uid);
    const riderSnap = await riderRef.get();
    if (!riderSnap.exists) throw new HttpsError("not-found", "Rider profile not found.");

    const owed = Math.floor(Number(riderSnap.data()?.cashInHand ?? 0) || 0);
    if (owed < MIN_DEPOSIT) {
      throw new HttpsError("failed-precondition", "You have no cash to deposit.");
    }
    // A rider may settle partially, but never more than they actually hold —
    // the server decides the ceiling, not the client.
    const requested = Math.floor(Number(request.data?.amount ?? owed) || owed);
    const amount = Math.max(MIN_DEPOSIT, Math.min(requested, owed));

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
        amount: amount * 100, // paise
        currency: "INR",
        receipt: `cod_${uid.slice(0, 8)}_${Date.now()}`,
        notes: { purpose: "cod_deposit", uid, payment_context: "COD_DEPOSIT" },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error("COD deposit order creation failed:", text);
      throw new HttpsError("internal", "Could not start the deposit. Please try again.");
    }
    const order = (await res.json()) as { id: string };

    // Record the authoritative amount BEFORE payment, so the webhook settles
    // exactly this and never trusts a client-supplied number.
    await db.collection("cod_deposits").doc(order.id).set({
      riderUid: uid,
      riderName: (riderSnap.data()?.name ?? "Rider").toString(),
      amount,
      cashInHandAtRequest: owed,
      status: "pending",
      razorpayOrderId: order.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { razorpayOrderId: order.id, amount, keyId, owed };
  },
);

async function confirmCodDeposit(uid: string, c: Record<string, unknown>) {
  const razorpayOrderId = String(c.razorpayOrderId ?? "");
  const razorpayPaymentId = String(c.razorpayPaymentId ?? "");
  const signature = String(c.razorpaySignature ?? "");
  if (!razorpayOrderId || !razorpayPaymentId || !signature) {
    throw new HttpsError("invalid-argument", "Missing payment confirmation fields.");
  }
  let keySecret = "";
  try {
    keySecret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
  } catch {
    keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  }
  if (!keySecret || !signatureMatches(keySecret, razorpayOrderId, razorpayPaymentId, signature)) {
    throw new HttpsError("permission-denied", "Payment signature verification failed.");
  }
  const dep = (await admin.firestore().collection("cod_deposits").doc(razorpayOrderId).get()).data();
  if (!dep) throw new HttpsError("not-found", "Deposit not found.");
  if (String(dep.riderUid ?? "") !== uid) throw new HttpsError("permission-denied", "Not your deposit.");
  await settleCodDeposit(razorpayOrderId, razorpayPaymentId);
  const after = (await admin.firestore().collection("cod_deposits").doc(razorpayOrderId).get()).data() ?? {};
  return { ok: true, settled: after.status === "settled", cashInHandAfter: Number(after.cashInHandAfter ?? 0) };
}

/**
 * Settle a COD deposit once its payment is captured. Called from the
 * signature-verified Razorpay webhook, or from `confirm` after the signature
 * is checked — never on a client's word alone.
 * Idempotent: a replayed webhook finds the deposit already settled and no-ops.
 */
export async function settleCodDeposit(
  razorpayOrderId: string,
  razorpayPaymentId: string,
): Promise<void> {
  const db = admin.firestore();
  const depRef = db.collection("cod_deposits").doc(razorpayOrderId);

  await db.runTransaction(async (tx) => {
    const depSnap = await tx.get(depRef);
    if (!depSnap.exists) {
      logger.warn(`settleCodDeposit: no deposit record for ${razorpayOrderId}`);
      return;
    }
    const dep = depSnap.data() ?? {};
    if (dep.status === "settled") return; // already applied — idempotent

    const riderUid = (dep.riderUid ?? "").toString();
    const amount = Number(dep.amount ?? 0) || 0;
    if (!riderUid || amount <= 0) return;

    const riderRef = db.collection("delivery_users").doc(riderUid);
    const riderSnap = await tx.get(riderRef);
    const currentCash = Number(riderSnap.data()?.cashInHand ?? 0) || 0;
    // Never drive the balance negative if the ledger drifted.
    const applied = Math.min(amount, Math.max(0, currentCash));
    const excess = Math.round((amount - applied) * 100) / 100;
    if (excess > 0) {
      // The rider paid more than they now owe (an admin settled their cash
      // meanwhile). That money is theirs: ops must return or credit it.
      tx.set(db.collection("admin_notifications").doc(`cod_excess_${razorpayOrderId}`), {
        type: "cod_deposit_excess",
        title: "Rider deposited more cash than they owed",
        message: `${String(dep.riderName ?? "Rider")} paid ₹${amount} but only ₹${applied} was outstanding. Return or credit ₹${excess}.`,
        riderUid,
        razorpayOrderId,
        razorpayPaymentId,
        excess,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    tx.set(
      riderRef,
      {
        cashInHand: Math.max(0, currentCash - applied),
        codDepositedLifetime: admin.firestore.FieldValue.increment(applied),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      depRef,
      {
        status: "settled",
        razorpayPaymentId,
        appliedAmount: applied,
        excessAmount: excess,
        cashInHandAfter: Math.max(0, currentCash - applied),
        settledAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
  logger.info(`COD deposit ${razorpayOrderId} settled`);
}

/**
 * Admin: COD reconciliation position — cash collected vs deposited vs
 * outstanding, per rider. The number ops actually needs to chase cash.
 */
export const getCodReconciliation = onCall(async (request) => {
  const email = request.auth?.token?.email as string | undefined;
  const isAdmin =
    ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email ?? "") ||
    request.auth?.token?.platformAdmin === true;
  if (!isAdmin) throw new HttpsError("permission-denied", "Admins only.");

  const db = admin.firestore();
  const riders = await db
    .collection("delivery_users")
    .where("cashInHand", ">", 0)
    .limit(500)
    .get();

  let outstanding = 0;
  const rows = riders.docs.map((d) => {
    const r = d.data();
    const cash = Number(r.cashInHand ?? 0) || 0;
    outstanding += cash;
    return {
      riderUid: d.id,
      riderName: (r.name ?? "Rider").toString(),
      phone: (r.phone ?? "").toString(),
      cashInHand: cash,
      depositedLifetime: Number(r.codDepositedLifetime ?? 0) || 0,
      lastUpdated: r.updatedAt?.toMillis?.() ?? null,
    };
  });
  rows.sort((a, b) => b.cashInHand - a.cashInHand);

  const recent = await db
    .collection("cod_deposits")
    .where("status", "==", "settled")
    .orderBy("settledAt", "desc")
    .limit(50)
    .get();

  return {
    ok: true,
    outstanding,
    riderCount: rows.length,
    riders: rows,
    recentDeposits: recent.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        riderName: (x.riderName ?? "").toString(),
        amount: Number(x.appliedAmount ?? x.amount ?? 0) || 0,
        settledAt: x.settledAt?.toMillis?.() ?? null,
      };
    }),
  };
});
