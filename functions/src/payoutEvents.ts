import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

/**
 * Webhook handler for RazorpayX payout.* events. Called by processRazorpayWebhook.
 * Advances the `payouts` ledger + the source settlement based on the terminal
 * payout status.
 *
 * Deliberately dependency-light (Firestore only, no Razorpay credentials) so the
 * webhook can import it WITHOUT pulling in payouts.ts's RAZORPAY_ACCOUNT_NUMBER
 * secret — the disbursal side (payouts.ts) can be deployed independently once
 * that secret is set.
 */
export async function handlePayoutEvent(
  eventType: string,
  payoutEntity: any,
): Promise<void> {
  const db = admin.firestore();
  const referenceId = String(payoutEntity?.reference_id ?? "");
  if (!referenceId) {
    logger.warn(`payout webhook ${eventType} without reference_id`, payoutEntity?.id);
    return;
  }
  const ledgerRef = db.collection("payouts").doc(referenceId);
  const ledgerSnap = await ledgerRef.get();
  if (!ledgerSnap.exists) {
    logger.warn(`payout webhook: no ledger for reference ${referenceId}`);
    return;
  }
  const ledger = ledgerSnap.data() ?? {};
  const status = String(payoutEntity.status ?? eventType.split(".")[1] ?? "");
  const utr = payoutEntity.utr ?? null;

  await ledgerRef.set(
    {
      status,
      utr,
      failureReason: payoutEntity.failure_reason ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const kind = String(ledger.kind ?? "");
  const sourcePath = String(ledger.sourcePath ?? "");
  if (!sourcePath) return;
  const sourceRef = db.doc(sourcePath);

  const succeeded = status === "processed";
  const failed = ["reversed", "failed", "cancelled", "rejected"].includes(status);

  if (succeeded) {
    const patch: Record<string, unknown> = {
      status: "paid",
      utrNumber: utr,
      payoutStatus: "processed",
      settledAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (kind === "rider") {
      // Advance the rider's paid-out ledger so their available balance drops.
      const amount = Number(ledger.amount ?? 0) || 0;
      const riderUid = String((await sourceRef.get()).data()?.riderUid ?? "");
      patch.paidAt = admin.firestore.FieldValue.serverTimestamp();
      patch.payoutPending = false;
      await sourceRef.set(patch, { merge: true });
      if (riderUid && amount > 0) {
        await db.collection("delivery_users").doc(riderUid).set(
          {
            paidOut: admin.firestore.FieldValue.increment(amount),
            payoutPending: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    } else {
      await sourceRef.set(patch, { merge: true });
    }
  } else if (failed) {
    const patch: Record<string, unknown> = {
      status: "pending",
      payoutStatus: status,
      payoutFailureReason: payoutEntity.failure_reason ?? status,
    };
    if (kind === "rider") patch.payoutPending = false;
    await sourceRef.set(patch, { merge: true });
  }
  // queued / pending / processing → leave source in `processing`, ledger updated.
}
