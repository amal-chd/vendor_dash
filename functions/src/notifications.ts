import * as admin from "firebase-admin";
import { processNotificationEvent } from "./notificationEngine/engine";

export type NotificationSeverity = "info" | "success" | "warning" | "high";

export interface SendNotificationPayload {
  restaurantId: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  source: string;
  metadata?: Record<string, any>;
}

/**
 * Enterprise Notification Core Service.
 * Safely writes to the Firestore notification log AND broadcasts via FCM.
 */
export async function sendSystemNotification(payload: SendNotificationPayload): Promise<void> {
  const { restaurantId, title, message, severity, source, metadata } = payload;

  // 1. Write to legacy Firestore notification center (for In-App Bell UI)
  try {
    await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("notifications")
      .add({
        title,
        message,
        restaurantId,
        source,
        severity,
        read: false,
        metadata: metadata || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error("Failed to write to Firestore notifications collection:", error);
  }

  // 2. Dispatch to the new Notification Engine for advanced routing & rules
  try {
    await processNotificationEvent({
      event: `system.${source}`,
      entityType: 'vendor',
      entityId: restaurantId,
      timestamp: Date.now(),
      data: {
        title,
        message,
        severity,
        metadata,
      }
    });
  } catch (error) {
    console.error("Failed to process notification via Notification Engine:", error);
  }
}
