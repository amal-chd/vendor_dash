import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { isOrderHeld } from "./vendorOrderRules";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { assertAdmin } from "./admin_operations";

/**
 * Kada Cares donation pipeline.
 *
 *  Capture  — a customer opts into a donation at checkout; it's added to the
 *             order total they pay and stored as `donation` + `donationCause`.
 *  Ledger   — onOrderDonation records each donation server-side (clients never
 *             write the donations ledger directly). Idempotent by orderId.
 *  Disburse — disburseDonations (admin) sweeps a cause's collected donations
 *             into a disbursement record and marks them disbursed.
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// A donation rides along on an order; when the order is created we mirror it
// into the donations ledger exactly once (doc id = orderId).
export const onOrderDonation = onDocumentCreated(
  { document: "orders/{orderId}", maxInstances: 1 },
  async (event) => {
    const order = event.data?.data();
    if (!order) return;
    // A held order (unpaid, or not yet priced) isn't real: its donation used to
    // be booked as collected even if the payment never happened. It's recorded
    // when the order goes live (onOrderPaymentConfirmed).
    if (isOrderHeld(order)) return;
    await recordOrderDonation(event.params.orderId, order);
  },
);

/** Mirrors an order's donation into the ledger exactly once (doc id = orderId). */
export async function recordOrderDonation(orderId: string, order: FirebaseFirestore.DocumentData): Promise<void> {
  const amount = Math.round(num(order.donation) * 100) / 100;
  if (amount <= 0) return;
  await admin.firestore().collection("donations").doc(orderId).set(
    {
      orderId,
      uid: String(order.customerUid ?? order.customerId ?? order.uid ?? ""),
      customerName: String(order.customerName ?? ""),
      amount,
      cause: String(order.donationCause ?? "Kada Cares"),
      status: "collected",
      disbursementId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// Admin sweeps all collected donations for a cause into one disbursement.
export const disburseDonations = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();
  const cause = String((request.data as { cause?: unknown })?.cause ?? "").trim();
  const note = String((request.data as { note?: unknown })?.note ?? "").trim();
  if (!cause) throw new HttpsError("invalid-argument", "Choose a cause to disburse.");

  // Status-only query (single-field index) then filter the cause in JS — avoids
  // needing a composite index. Cap keeps us under the 500-op batch limit.
  const snap = await db
    .collection("donations")
    .where("status", "==", "collected")
    .limit(1000)
    .get();

  const ids: string[] = [];
  let total = 0;
  for (const d of snap.docs) {
    if (String(d.data().cause ?? "Kada Cares") !== cause) continue;
    ids.push(d.id);
    total += num(d.data().amount);
    if (ids.length >= 480) break;
  }
  if (ids.length === 0) {
    throw new HttpsError("failed-precondition", "No collected donations for this cause.");
  }
  total = Math.round(total * 100) / 100;

  const disbRef = db.collection("donation_disbursements").doc();
  const batch = db.batch();
  batch.set(disbRef, {
    id: disbRef.id,
    cause,
    amount: total,
    count: ids.length,
    note,
    disbursedBy: request.auth?.token?.email ?? "admin",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const disbursedAt = admin.firestore.FieldValue.serverTimestamp();
  ids.forEach((id) =>
    batch.update(db.collection("donations").doc(id), {
      status: "disbursed",
      disbursementId: disbRef.id,
      disbursedAt,
    }),
  );
  await batch.commit();

  return { ok: true, cause, amount: total, count: ids.length, disbursementId: disbRef.id };
});
