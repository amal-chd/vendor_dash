/**
 * Delivery provider abstraction
 */
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COL, NotificationDelivery, NotificationChannel } from "./types";
import { MAX_FCM_BATCH_SIZE } from "./constants";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

/**
 * Sends a push notification via FCM.
 */
export async function deliverPush(tokens: string[], payload: any, notificationId?: string, userId?: string): Promise<void> {
  if (!tokens || tokens.length === 0) return;

  const messaging = getMessaging();
  
  // If multiple tokens, batch them
  if (tokens.length > 1) {
    await deliverPushBatch(tokens, payload);
    return;
  }

  const message = {
    token: tokens[0],
    notification: {
      title: payload.title,
      body: payload.body,
      imageUrl: payload.image,
    },
    data: payload.data || {},
  };

  try {
    await messaging.send(message);
    if (userId && notificationId) {
       await logDelivery({
         id: `${notificationId}_${Date.now()}`,
         notificationId,
         userId,
         channel: 'push',
         provider: 'fcm',
         status: 'delivered',
         deliveredAt: FieldValue.serverTimestamp() as any,
         retryCount: 0
       });
    }
  } catch (error: any) {
    logger.error("Error sending push notification:", error);
    
    // Handle invalid tokens
    if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
        logger.info(`Invalid FCM token: ${tokens[0]}. Should be removed from database.`);
        // Note: In a real app, remove the token from notification_devices
    }
    
    throw error;
  }
}

/**
 * Sends push notifications in batches using sendEachForMulticast.
 */
export async function deliverPushBatch(tokens: string[], payload: any): Promise<void> {
  const messaging = getMessaging();
  
  // Chunk into MAX_FCM_BATCH_SIZE
  for (let i = 0; i < tokens.length; i += MAX_FCM_BATCH_SIZE) {
    const chunk = tokens.slice(i, i + MAX_FCM_BATCH_SIZE);
    const message = {
      tokens: chunk,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.image,
      },
      data: payload.data || {},
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      
      // Cleanup invalid tokens based on response.responses
      response.responses.forEach((res, idx) => {
         if (!res.success && res.error) {
             const errorCode = res.error.code;
             if (errorCode === 'messaging/invalid-registration-token' || errorCode === 'messaging/registration-token-not-registered') {
                  const invalidToken = chunk[idx];
                  logger.info(`Invalid FCM token in batch: ${invalidToken}`);
                  // Note: Clean up invalid token in DB
             }
         }
      });
      
    } catch (error) {
      logger.error("Error sending batch push notification:", error);
      throw error;
    }
  }
}

/**
 * Delivers an in-app notification by saving it to Firestore.
 */
export async function deliverInApp(userId: string, notification: any, collectionName: string = 'notifications'): Promise<void> {
   try {
       // Based on instructions: existing notifications go to restaurants/{id}/notifications for vendors
       // Using a generic collection or user-specific subcollection based on design
       const docRef = db.collection('customer_users').doc(userId).collection(collectionName).doc();
       await docRef.set({
           ...notification,
           createdAt: FieldValue.serverTimestamp(),
           read: false
       });
   } catch (error) {
       logger.error(`Error delivering in-app notification for user ${userId}:`, error);
       throw error;
   }
}

/**
 * Delegates to existing comms/queue.ts enqueueEmail pattern (simulated here)
 */
export async function deliverEmail(params: any): Promise<void> {
   try {
       logger.info(`Mock delivering email to ${params.to}`);
       // In real implementation: import { enqueueEmail } from '../comms/queue'; await enqueueEmail(params);
   } catch (error) {
       logger.error("Error delivering email:", error);
       throw error;
   }
}

/**
 * Stub for future SMS provider
 */
export async function deliverSms(phone: string, message: string): Promise<void> {
    logger.info(`Mock delivering SMS to ${phone}: ${message}`);
}

/**
 * Logs a delivery to the notification_deliveries collection
 */
export async function logDelivery(delivery: NotificationDelivery): Promise<void> {
    try {
        await db.collection(COL.NOTIFICATION_DELIVERIES).doc(delivery.id).set(delivery);
    } catch (error) {
        logger.error(`Error logging delivery ${delivery.id}:`, error);
    }
}
