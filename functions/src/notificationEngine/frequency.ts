/**
 * Frequency limit enforcement
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COL, NotificationChannel, NotificationCategory } from "./types";
import { FREQUENCY_LIMITS, ESSENTIAL_CATEGORIES } from "./constants";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

/**
 * Checks if a user has exceeded their frequency limits for a given channel and category.
 */
export async function checkFrequencyLimit(userId: string, channel: NotificationChannel, category: NotificationCategory): Promise<boolean> {
  // Transactional notifications are not rate-limited
  if (ESSENTIAL_CATEGORIES.includes(category)) {
    return true;
  }

  // Only check limits for marketing push notifications for now
  if (category === 'marketing' && channel === 'push') {
      const limits = FREQUENCY_LIMITS.marketing_push;
      const now = new Date();
      
      // Calculate timestamps
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday as start
      startOfWeek.setHours(0, 0, 0, 0);
      
      const minGapTime = new Date(now.getTime() - (limits.minGapMinutes * 60000));

      try {
         // Query recent deliveries
         const recentDeliveriesSnapshot = await db.collection(COL.NOTIFICATION_DELIVERIES)
             .where('userId', '==', userId)
             .where('channel', '==', channel)
             .where('category', '==', category)
             .where('sentAt', '>=', startOfWeek) // Get all within the week
             .orderBy('sentAt', 'desc')
             .get();

         if (recentDeliveriesSnapshot.empty) {
             return true; // No recent deliveries
         }
         
         let dailyCount = 0;
         const weeklyCount = recentDeliveriesSnapshot.size;
         const mostRecent = recentDeliveriesSnapshot.docs[0].data().sentAt.toDate();

         recentDeliveriesSnapshot.forEach(doc => {
             const sentAt = doc.data().sentAt.toDate();
             if (sentAt >= startOfDay) {
                 dailyCount++;
             }
         });
         
         // Enforce limits
         if (limits.minGapMinutes && mostRecent > minGapTime) {
             logger.info(`Frequency check failed: min gap not met for user ${userId}`);
             return false;
         }
         
         if (limits.daily && dailyCount >= limits.daily) {
             logger.info(`Frequency check failed: daily limit reached for user ${userId}`);
             return false;
         }
         
         if (limits.weekly && weeklyCount >= limits.weekly) {
             logger.info(`Frequency check failed: weekly limit reached for user ${userId}`);
             return false;
         }
         
         return true;

      } catch (error) {
          logger.error(`Error checking frequency limit for user ${userId}:`, error);
          // Default to allowing if we fail to check, to prevent blocking
          return true;
      }
  }

  // Other categories/channels have no limits by default
  return true;
}

/**
 * Records a notification sent to update frequency counters.
 * This is a lightweight tracker separate from the main logDelivery to specifically track categories.
 */
export async function recordNotificationSent(userId: string, channel: NotificationChannel, category: NotificationCategory): Promise<void> {
   if (ESSENTIAL_CATEGORIES.includes(category)) {
      return; // No need to track essential for frequency
   }
   
   try {
       // We write a minimal record to NOTIFICATION_DELIVERIES or a dedicated stats collection.
       // The actual delivery payload logging happens in delivery.ts.
       // This is just to ensure the checkFrequencyLimit query works based on intent to send.
       await db.collection(COL.NOTIFICATION_DELIVERIES).add({
           userId,
           channel,
           category,
           status: 'processing', // Initial status
           sentAt: FieldValue.serverTimestamp()
       });
   } catch (error) {
       logger.error(`Error recording notification sent for user ${userId}:`, error);
   }
}
