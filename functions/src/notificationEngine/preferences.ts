/**
 * User preference management
 */
import { getFirestore } from "firebase-admin/firestore";
import { COL, NotificationPreference, NotificationCategory, NotificationChannel } from "./types";
import { ESSENTIAL_CATEGORIES, QUIET_HOURS } from "./constants";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

/**
 * Fetches user preferences. Returns default if not found.
 */
export async function getPreferences(userId: string): Promise<NotificationPreference> {
  try {
    const doc = await db.collection(COL.NOTIFICATION_PREFERENCES).doc(userId).get();
    
    if (doc.exists) {
      return doc.data() as NotificationPreference;
    }
    
    // Default preferences
    return {
      userId,
      categories: {
        transactional: { push: true, in_app: true, email: true, sms: true },
        operational: { push: true, in_app: true, email: false, sms: false },
        marketing: { push: true, in_app: true, email: true, sms: false },
      },
      quietHours: QUIET_HOURS,
      timezone: 'Asia/Kolkata', // Default timezone
    };
  } catch (error) {
    logger.error(`Error fetching preferences for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Updates user preferences.
 */
export async function setPreferences(userId: string, prefs: Partial<NotificationPreference>): Promise<void> {
  try {
    await db.collection(COL.NOTIFICATION_PREFERENCES).doc(userId).set(prefs, { merge: true });
  } catch (error) {
    logger.error(`Error setting preferences for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Checks if a user allows a specific notification type on a specific channel.
 */
export async function isNotificationAllowed(userId: string, category: NotificationCategory, channel: NotificationChannel): Promise<boolean> {
  // Essential notifications always allowed
  if (ESSENTIAL_CATEGORIES.includes(category)) {
    return true;
  }

  const prefs = await getPreferences(userId);
  
  if (prefs.categories && prefs.categories[category] && prefs.categories[category][channel] !== undefined) {
      return prefs.categories[category][channel];
  }
  
  // Default to true if not explicitly set
  return true;
}

/**
 * Checks if it is currently quiet hours for the user.
 */
export async function isQuietHours(userId: string): Promise<boolean> {
   const prefs = await getPreferences(userId);
   
   if (!prefs.quietHours) return false;
   
   const { from, to } = prefs.quietHours;
   
   // Get current hour in user's timezone (simplified, assumes server timezone matches or uses UTC)
   // In a real app, use moment-timezone or Intl to get the hour in prefs.timezone
   const currentHour = new Date().getHours(); 
   
   if (from > to) {
       // Overnight, e.g., 22 to 7
       return currentHour >= from || currentHour < to;
   } else {
       // Same day, e.g., 14 to 16
       return currentHour >= from && currentHour < to;
   }
}
