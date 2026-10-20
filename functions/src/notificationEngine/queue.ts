/**
 * Push notification queue
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { withCronHeartbeat } from "../cronHealth";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { COL, NotificationChannel, NotificationPriority, NotificationCategory } from "./types";
import { MAX_RETRY_ATTEMPTS, BACKOFF_MS } from "./constants";
import { deliverPush, deliverInApp, deliverEmail, deliverSms } from "./delivery";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

export interface EnqueueParams {
  userId: string;
  channels: NotificationChannel[];
  templateKey: string;
  eventData: any;
  priority: NotificationPriority;
  category: NotificationCategory;
  idempotencyKey: string;
}

/**
 * Enqueues a notification job idemptotently using the idempotencyKey as the doc ID.
 */
export async function enqueueNotification(params: EnqueueParams): Promise<void> {
  const docRef = db.collection(COL.NOTIFICATION_JOBS).doc(params.idempotencyKey);
  
  try {
    await docRef.create({
      ...params,
      status: 'pending',
      retryCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      nextRetryAt: FieldValue.serverTimestamp(),
    });
    logger.info(`Enqueued notification job: ${params.idempotencyKey}`);
  } catch (error: any) {
    if (error.code === 6) { // ALREADY_EXISTS
      logger.info(`Duplicate notification job skipped: ${params.idempotencyKey}`);
    } else {
      logger.error(`Error enqueueing notification job ${params.idempotencyKey}:`, error);
      throw error;
    }
  }
}

/**
 * Trigger to process notification jobs immediately upon creation.
 */
export const onNotificationJobCreated = onDocumentCreated(
  `${COL.NOTIFICATION_JOBS}/{jobId}`,
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const job = snapshot.data();
    if (job.status !== 'pending') return;
    
    await processJob(snapshot.id, job);
  }
);

/**
 * Scheduled job to sweep and retry failed or stuck notifications.
 */
export const retryFailedNotifications = onSchedule("every 5 minutes", withCronHeartbeat("retryFailedNotifications", 5, async (event) => {
  const now = new Date();
  
  const query = db.collection(COL.NOTIFICATION_JOBS)
    .where('status', 'in', ['pending', 'failed'])
    .where('nextRetryAt', '<=', now)
    .limit(100);

  const snapshot = await query.get();
  
  if (snapshot.empty) {
    return;
  }

  logger.info(`Retrying ${snapshot.size} notification jobs`);
  
  const promises = snapshot.docs.map(doc => processJob(doc.id, doc.data()));
  await Promise.allSettled(promises);
}));


async function processJob(jobId: string, jobData: any) {
  const jobRef = db.collection(COL.NOTIFICATION_JOBS).doc(jobId);
  
  try {
    await jobRef.update({ status: 'processing', updatedAt: FieldValue.serverTimestamp() });

    // This pipeline is a scaffold: template resolution was never implemented,
    // and the push branch below still uses a literal 'mock-token'. It is inert
    // today only by accident — every dispatch site emits a `system.*` event and
    // SYSTEM_RULES defines none of those, so getRuleForEvent returns null and
    // nothing is ever enqueued.
    //
    // Adding one rule would change that silently, and real customers would
    // receive "Notification for vendor_order_created" / "Data: {...}". Refuse
    // instead: the job is marked failed with a reason a human can read, which
    // is loud (the delivery shows up in the admin Failed list) and harmless.
    throw new Error(
      `Notification engine is not implemented: no template renderer for "${jobData.templateKey}". ` +
        `Refusing to send placeholder content. Real notifications go through notifyCustomer/notifyRider.`,
    );

    // eslint-disable-next-line no-unreachable
    const payload = {
        title: `Notification for ${jobData.templateKey}`,
        body: `Data: ${JSON.stringify(jobData.eventData)}`
    };

    // Route to respective channels
    const deliveryPromises: Promise<any>[] = [];
    
    if (jobData.channels.includes('push')) {
        // We'd fetch the user's FCM tokens here
        // For now, mock token
        const tokens = ['mock-token'];
        deliveryPromises.push(deliverPush(tokens, payload, jobId, jobData.userId));
    }
    
    if (jobData.channels.includes('in_app')) {
        deliveryPromises.push(deliverInApp(jobData.userId, payload));
    }
    
    if (jobData.channels.includes('email')) {
       // Using hypothetical email params
       deliveryPromises.push(deliverEmail({ to: jobData.userId, subject: payload.title, text: payload.body }));
    }
    
    if (jobData.channels.includes('sms')) {
       deliveryPromises.push(deliverSms('mock-phone', payload.body));
    }

    await Promise.all(deliveryPromises);

    await jobRef.update({ 
      status: 'completed', 
      completedAt: FieldValue.serverTimestamp() 
    });

  } catch (error: any) {
    const retryCount = (jobData.retryCount || 0) + 1;
    const nextRetryMs = BACKOFF_MS[retryCount] || BACKOFF_MS[BACKOFF_MS.length - 1];
    const nextRetryAt = new Date(Date.now() + nextRetryMs);

    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      await jobRef.update({ 
        status: 'dead_letter', 
        error: error.message,
        updatedAt: FieldValue.serverTimestamp()
      });
      logger.error(`Job ${jobId} moved to dead_letter after ${retryCount} retries.`);
    } else {
      await jobRef.update({ 
        status: 'failed', 
        retryCount,
        nextRetryAt,
        error: error.message,
        updatedAt: FieldValue.serverTimestamp()
      });
      logger.warn(`Job ${jobId} failed, will retry at ${nextRetryAt}. Attempt ${retryCount}`);
    }
  }
}
