/**
 * Email queue. Producers call `enqueueEmail` (never the provider directly), so
 * user-facing API paths never wait on delivery. The queue doc id IS the
 * idempotency key — `.create()` throws on a duplicate, so the same business
 * event can never send twice. A Firestore trigger processes each event; a
 * scheduled function retries transient failures with exponential backoff.
 */

import * as admin from "firebase-admin";
import { withCronHeartbeat } from "../cronHealth";
import { defineSecret } from "firebase-functions/params";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { COL, EmailCategory, EmailEvent, UserType } from "./types";
import { deliverEvent } from "./send";

export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
export const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
export const COMMS_TOKEN_SECRET = defineSecret("COMMS_TOKEN_SECRET");
export const COMMS_SECRETS = [RESEND_API_KEY, GMAIL_APP_PASSWORD, COMMS_TOKEN_SECRET];

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [0, 60_000, 300_000, 1_800_000]; // 0, 1m, 5m, 30m

export interface EnqueueParams {
  eventId: string; // idempotency key, e.g. "order_123_order_confirmation"
  type: string;
  category: EmailCategory;
  to: string;
  userId?: string;
  userType?: UserType;
  templateKey: string;
  data?: Record<string, unknown>;
  campaignId?: string;
}

/** Idempotently enqueue an email. Returns false if this event already exists. */
export async function enqueueEmail(params: EnqueueParams): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(COL.events).doc(params.eventId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    await ref.create({
      eventId: params.eventId,
      type: params.type,
      category: params.category,
      to: params.to,
      userId: params.userId || null,
      userType: params.userType || null,
      templateKey: params.templateKey,
      data: params.data || {},
      campaignId: params.campaignId || null,
      status: "queued",
      attemptCount: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: Date.now(),
      createdAt: now,
      updatedAt: now,
    });
    return true;
  } catch (e) {
    // ALREADY_EXISTS → idempotent no-op.
    if ((e as { code?: number }).code === 6) return false;
    throw e;
  }
}

/** Claim + process a single event. Safe to call from trigger or retry sweep. */
async function processEvent(eventId: string): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection(COL.events).doc(eventId);

  // Atomically claim: only process if queued and due.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const ev = snap.data() as EmailEvent;
    if (ev.status !== "queued") return null;
    if ((ev.nextAttemptAt || 0) > Date.now()) return null;
    tx.update(ref, {
      status: "processing",
      attemptCount: (ev.attemptCount || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ...ev, attemptCount: (ev.attemptCount || 0) + 1 } as EmailEvent;
  });
  if (!claimed) return;

  let outcome;
  try {
    outcome = await deliverEvent(claimed);
  } catch (e) {
    outcome = { ok: false, provider: "none", error: String(e), permanent: false } as const;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  if (outcome.ok) {
    await ref.update({ status: "sent", sentAt: now, updatedAt: now, lastError: null });
    return;
  }
  if ("skipped" in outcome && outcome.skipped) {
    await ref.update({ status: "skipped", reason: outcome.reason || null, updatedAt: now });
    return;
  }
  // Failure — retry unless permanent or out of attempts.
  const attempts = claimed.attemptCount;
  if (outcome.permanent || attempts >= (claimed.maxAttempts || MAX_ATTEMPTS)) {
    await ref.update({ status: "failed", lastError: outcome.error || "failed", updatedAt: now });
  } else {
    const delay = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    await ref.update({
      status: "queued",
      nextAttemptAt: Date.now() + delay,
      lastError: outcome.error || "retrying",
      updatedAt: now,
    });
  }
}

/** Worker — fires as soon as an event is enqueued. */
export const onEmailEventCreated = onDocumentCreated(
  { document: `${COL.events}/{eventId}`, secrets: COMMS_SECRETS },
  async (event) => {
    await processEvent(event.params.eventId as string);
  }
);

/** Retry sweep — picks up transient failures + any stuck processing events. */
export const retryFailedEmails = onSchedule(
  { schedule: "every 5 minutes", secrets: COMMS_SECRETS },
  withCronHeartbeat("retryFailedEmails", 5, async () => {
    const db = admin.firestore();
    const due = await db
      .collection(COL.events)
      .where("status", "==", "queued")
      .where("nextAttemptAt", "<=", Date.now())
      .limit(100)
      .get();
    for (const doc of due.docs) {
      await processEvent(doc.id).catch((e) => console.error("retry failed", doc.id, e));
    }
    // Rescue events stuck "processing" > 15 min (function crash / restart).
    const stuckCutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 15 * 60_000);
    const stuck = await db
      .collection(COL.events)
      .where("status", "==", "processing")
      .where("updatedAt", "<=", stuckCutoff)
      .limit(50)
      .get();
    for (const doc of stuck.docs) {
      await doc.ref
        .update({ status: "queued", nextAttemptAt: Date.now() })
        .catch(() => {});
    }
  }
));
