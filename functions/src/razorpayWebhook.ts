import * as admin from "firebase-admin";
import { applyStayPayment } from "./pricing/stayCallables";
import { applyFoodOrderPayment } from "./paymentCapture";
import { creditWalletTopup } from "./wallet";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./refunds";
import * as crypto from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { handlePayoutEvent } from "./payoutEvents";
import { activateSubscription } from "./subscriptionBilling";
import { settleCodDeposit } from "./codReconciliation";
import { HOT_PATH } from "./options";
import { applyMessPayment } from "./mess";
import { applyRefundEvent } from "./refunds";
import { capturePayment } from "./gateway";

const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");

/** The id a webhook delivery is de-duplicated on (see the receiver below). */
export function webhookEventId(header: string | string[] | undefined, payload: any, rawBody: string): string {
  const fromHeader = Array.isArray(header) ? header[0] : header;
  return String(
    fromHeader ||
      payload?.id ||
      `body_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 40)}`,
  );
}

// 1. HTTP Endpoint: Validates signature and pushes to Firestore queue (razorpay_webhook_events)
export const razorpayWebhook = onRequest(
  { ...HOT_PATH, secrets: [RAZORPAY_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      let secret = "";
      try {
        secret = RAZORPAY_WEBHOOK_SECRET.value() || process.env.RAZORPAY_WEBHOOK_SECRET || "";
      } catch (_) {
        secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
      }

      if (!secret) {
        console.error("RAZORPAY_WEBHOOK_SECRET is not configured.");
        res.status(500).send("Webhook secret not configured.");
        return;
      }

      const signature = req.headers["x-razorpay-signature"] as string;
      if (!signature) {
        res.status(401).send("Missing webhook signature header.");
        return;
      }

      const rawBody = req.rawBody?.toString() || JSON.stringify(req.body);
      
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const isValid =
        expectedSignature.length === signature.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

      if (!isValid) {
        console.warn("Invalid webhook signature attempt.");
        res.status(401).send("Invalid signature");
        return;
      }

      const payload = req.body;
      const eventType = payload.event;
      // Razorpay sends the event's unique id ONLY in the x-razorpay-event-id
      // header — the JSON body has no top-level `id`. Reading `payload.id`
      // rejected every real event with a 400 (so nothing was ever queued and
      // Razorpay eventually disables the endpoint). The body hash is a last
      // resort so a delivery is never dropped for lacking an id.
      const razorpayEventId = webhookEventId(req.headers["x-razorpay-event-id"], payload, rawBody);

      const eventRef = admin.firestore().collection("razorpay_webhook_events").doc(String(razorpayEventId));

      const paymentEntity = payload.payload?.payment?.entity || {};
      const orderEntity = payload.payload?.order?.entity || {};
      const payoutEntity = payload.payload?.payout?.entity || {};
      const refundEntity = payload.payload?.refund?.entity || {};

      // create() is atomic: two simultaneous redeliveries of one event can't
      // both queue it (a read-then-write could).
      try {
        await eventRef.create({
        razorpay_event_id: razorpayEventId,
        event_type: eventType,
        payment_id: paymentEntity.id || refundEntity.payment_id || null,
        refund_id: refundEntity.id || null,
        payout_id: payoutEntity.id || null,
        reference_id: payoutEntity.reference_id || null,
        razorpay_order_id: paymentEntity.order_id || orderEntity.id || null,
        kada_order_id: paymentEntity.notes?.firestoreOrderId || orderEntity.notes?.firestoreOrderId || null,
        payment_context: paymentEntity.notes?.payment_context || orderEntity.notes?.payment_context || 'UNKNOWN',
        amount: paymentEntity.amount || refundEntity.amount || payoutEntity.amount || 0,
        currency: paymentEntity.currency || refundEntity.currency || payoutEntity.currency || 'INR',
        signature_valid: true,
        processing_status: 'pending',
        attempt_count: 0,
        payload: payload,
        received_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e: any) {
        if (e?.code === 6 || /already exists/i.test(String(e?.message))) {
          res.status(200).send("Idempotent acknowledgment");
          return;
        }
        throw e;
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);

// 2. Queue Processor: Triggered when a new webhook event is stored
export const processRazorpayWebhook = onDocumentCreated(
  // The key secrets let this processor refund a payment that can't be used
  // (paid twice, or arrived after the order closed) — see paymentCapture.ts.
  {
    document: "razorpay_webhook_events/{eventId}",
    maxInstances: 5,
    retry: true,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await processWebhookEvent(snap.ref);
  }
);

/**
 * Process one stored webhook event. Used by the queue trigger above and by
 * the admin "Retry" action (adminPlatformAction → replayWebhookEvent) — the
 * trigger fires only on create, so flipping a failed event back to pending
 * from the browser never re-ran it. Every handler is idempotent, so a replay
 * of an already-applied event changes nothing.
 */
export async function processWebhookEvent(
  eventRef: admin.firestore.DocumentReference,
  opts: { force?: boolean } = {},
): Promise<void> {
  {
    const snap = await eventRef.get();
    if (!snap.exists) return;
    const eventData = snap.data() ?? {};
    if (eventData.processing_status === 'processed' && !opts.force) return;

    await eventRef.update({ 
      processing_status: 'processing',
      processing_started_at: admin.firestore.FieldValue.serverTimestamp(),
      attempt_count: admin.firestore.FieldValue.increment(1)
    });

    try {
      const eventType = eventData.event_type;
      const paymentEntity = eventData.payload?.payload?.payment?.entity;
      const payoutEntity = eventData.payload?.payload?.payout?.entity;

      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        if (paymentEntity) {
          await handlePaymentCaptured(eventData, paymentEntity);
        }
      } else if (eventType === 'payment.authorized') {
        // Normally the account auto-captures. If it doesn't, an authorized
        // payment is voided back to the customer after a few days while we
        // may already have delivered — so capture it; the payment.captured
        // event that follows applies it (and refunds it if it can't be used).
        if (paymentEntity?.id && paymentEntity.status === 'authorized') {
          await capturePayment(String(paymentEntity.id), Number(paymentEntity.amount), paymentEntity.currency || 'INR');
        }
      } else if (typeof eventType === 'string' && eventType.startsWith('refund.')) {
        const refundEntity = eventData.payload?.payload?.refund?.entity;
        if (refundEntity) await applyRefundEvent(eventType, refundEntity);
      } else if (eventType === 'payment.failed') {
        if (paymentEntity) {
          await handlePaymentFailed(eventData, paymentEntity);
        }
      } else if (typeof eventType === 'string' && eventType.startsWith('payout.')) {
        // Money-OUT: RazorpayX payout lifecycle (processed/reversed/failed/…).
        if (payoutEntity) {
          await handlePayoutEvent(eventType, payoutEntity);
        }
      } else if (
        typeof eventType === 'string' &&
        eventType.startsWith('fund_account.validation.')
      ) {
        // Penny-drop verification result. This is what promotes a partner's
        // banking to `verified` (or flags a name mismatch for review) — the
        // gate that decides whether any payout may leave the platform.
        const validationEntity =
          eventData.payload?.payload?.fund_account_validation?.entity;
        if (validationEntity) {
          // Lazy import — bankValidation declares RazorpayX secrets at module
          // scope, and a static import makes them required deploy params for
          // the entire codebase. Runtime-only keeps the webhook deployable
          // before the source-account secret is configured.
          const { handleValidationWebhook } = await import("./onboarding/bankValidation");
          await handleValidationWebhook(eventType, validationEntity);
        }
      }
      
      await eventRef.update({
        processing_status: 'processed',
        processed_at: admin.firestore.FieldValue.serverTimestamp(),
      });

    } catch (error: any) {
      console.error(`Error processing webhook ${eventRef.id}:`, error);
      await eventRef.update({
        processing_status: 'failed',
        error_message: error.message || String(error),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw error;
    }
  }
}

async function handlePaymentCaptured(eventData: any, paymentEntity: any) {
  const context = eventData.payment_context || paymentEntity.notes?.payment_context || 'UNKNOWN';
  const kadaOrderId = eventData.kada_order_id || paymentEntity.notes?.firestoreOrderId;
  const db = admin.firestore();

  // Idempotency + completeness: record the money-in transaction for EVERY
  // captured payment (subscriptions, ads, etc. included), not only order/topup
  // payments. Without this, revenue whose payment carries no kada_order_id was
  // invisible to the transactions ledger and to finance reconciliation.
  const transactionRef = db.collection("transactions").doc(paymentEntity.id);
  const txSnap = await transactionRef.get();
  if (txSnap.exists) {
    return; // already recorded this payment
  }

  let outcome: string | null = null;
  if (context === 'FOOD_ORDER' && kadaOrderId) {
    // Same routine as the app's verify call, so the two can't disagree. It
    // never throws on a mismatch: a payment the order can't use is refunded
    // (retrying the event forever used to be the only outcome).
    const res = await applyFoodOrderPayment({
      orderId: String(kadaOrderId),
      razorpayOrderId: String(paymentEntity.order_id),
      paymentId: String(paymentEntity.id),
      amountPaise: Number(paymentEntity.amount) || 0,
      source: "webhook",
    });
    outcome = res.outcome;
  } else if (context === 'SUBSCRIPTION') {
    // Web subscription purchase (the Razorpay replacement for IAP). The order
    // id carries the server-priced plan; activation is idempotent.
    outcome = await activateSubscription(String(paymentEntity.order_id), String(paymentEntity.id));
  } else if (context === 'STAY_BOOKING' && paymentEntity.notes?.stayBookingId) {
    // Confirms a Stay booking when the app never returned to verify it; a
    // payment the booking can't use is refunded automatically.
    outcome = await applyStayPayment({
      bookingId: String(paymentEntity.notes.stayBookingId),
      razorpayOrderId: String(paymentEntity.order_id),
      paymentId: String(paymentEntity.id),
      amountPaise: Number(paymentEntity.amount) || 0,
      source: "webhook",
    });
  } else if (context === 'MESS_SUBSCRIPTION' && paymentEntity.notes?.messSubscriptionId) {
    // Mess plan bought in the customer app. Without this branch a customer
    // whose app closed after paying was never given the plan — the hourly
    // mess sweeper marked it "abandoned" while their money sat with us.
    outcome = await applyMessPayment({
      subscriptionId: String(paymentEntity.notes.messSubscriptionId),
      razorpayOrderId: String(paymentEntity.order_id),
      paymentId: String(paymentEntity.id),
      amountPaise: Number(paymentEntity.amount) || 0,
      source: "webhook",
    });
  } else if (context === 'COD_DEPOSIT') {
    // Rider depositing collected cash back to the platform.
    await settleCodDeposit(String(paymentEntity.order_id), String(paymentEntity.id));
  } else if (context === 'WALLET_TOPUP' && paymentEntity.order_id) {
    // Top-ups are keyed by the GATEWAY order id (createWalletTopupOrder never
    // sets firestoreOrderId). This branch used to require firestoreOrderId,
    // so it never ran: a customer who closed the app before confirming paid
    // and was never credited.
    await creditWalletTopup(String(paymentEntity.order_id), String(paymentEntity.id), Number(paymentEntity.amount));
  }

  await transactionRef.set({
    transaction_id: paymentEntity.id,
    razorpay_order_id: paymentEntity.order_id ?? null,
    kada_order_id: kadaOrderId ?? null,
    customer_id: paymentEntity.notes?.uid || null,
    payment_context: context,
    gross_amount: paymentEntity.amount / 100,
    fee: (paymentEntity.fee ?? 0) / 100,
    tax: (paymentEntity.tax ?? 0) / 100,
    currency: paymentEntity.currency,
    status: 'captured',
    method: paymentEntity.method,
    email: paymentEntity.email ?? null,
    contact: paymentEntity.contact ?? null,
    description: paymentEntity.description ?? null,
    // `mapped: false` = money recorded but not tied to an order/topup (e.g. a
    // subscription payment). Queryable so ops can attribute it later; the
    // revenue is never lost from the ledger regardless.
    mapped: !!kadaOrderId || ['WALLET_TOPUP', 'COD_DEPOSIT', 'SUBSCRIPTION', 'MESS_SUBSCRIPTION', 'STAY_BOOKING'].includes(context),
    outcome,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handlePaymentFailed(eventData: any, paymentEntity: any) {
  const context = eventData.payment_context || paymentEntity.notes?.payment_context || 'FOOD_ORDER';
  const notes = paymentEntity.notes ?? {};
  const db = admin.firestore();
  // Where the failure is shown: the thing the payment was for.
  let ref: admin.firestore.DocumentReference | null = null;
  if (context === 'FOOD_ORDER' && (eventData.kada_order_id || notes.firestoreOrderId)) {
    ref = db.collection("orders").doc(String(eventData.kada_order_id || notes.firestoreOrderId));
  } else if (context === 'SUBSCRIPTION' && paymentEntity.order_id) {
    ref = db.collection("subscription_orders").doc(String(paymentEntity.order_id));
  } else if (context === 'MESS_SUBSCRIPTION' && notes.messSubscriptionId) {
    ref = db.collection("mess_subscriptions").doc(String(notes.messSubscriptionId));
  } else if (context === 'STAY_BOOKING' && notes.stayBookingId) {
    ref = db.collection("stay_bookings").doc(String(notes.stayBookingId));
  } else if (context === 'WALLET_TOPUP' && paymentEntity.order_id) {
    ref = db.collection("wallet_topups").doc(String(paymentEntity.order_id));
  } else if (context === 'COD_DEPOSIT' && paymentEntity.order_id) {
    ref = db.collection("cod_deposits").doc(String(paymentEntity.order_id));
  }
  console.log(`Payment failed: ${paymentEntity.id} (${context}) → ${ref?.path ?? "unmapped"}`);
  if (!ref) return;
  const target = ref;
  // Give support the gateway's reason ("UPI request expired", "bank declined")
  // when a customer or merchant asks why their payment didn't go through. A
  // failed attempt never changes status — the customer can simply retry.
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(target)).data();
    if (!cur || cur.paymentStatus === "paid") return;
    tx.update(target, {
      lastPaymentFailure: {
        razorpayPaymentId: String(paymentEntity.id ?? ""),
        code: String(paymentEntity.error_code ?? ""),
        reason: String(paymentEntity.error_description ?? paymentEntity.error_reason ?? "").slice(0, 300),
        method: String(paymentEntity.method ?? ""),
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
      paymentFailureCount: admin.firestore.FieldValue.increment(1),
    });
  });
}
