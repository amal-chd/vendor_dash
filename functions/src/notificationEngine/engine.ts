/**
 * Central notification orchestrator
 */
import { NotificationEvent, NotificationChannel, EntityType, NotificationPriority, NotificationCategory } from "./types";
import { getRuleForEvent } from "./rules";
import { getPreferences, isNotificationAllowed, isQuietHours } from "./preferences";
import { checkFrequencyLimit, recordNotificationSent } from "./frequency";
import { enqueueNotification } from "./queue";
import { ESSENTIAL_CATEGORIES } from "./constants";
import * as logger from "firebase-functions/logger";

/**
 * Main entry point for processing an event and routing notifications.
 * @param event The notification event to process
 */
export async function processNotificationEvent(event: NotificationEvent): Promise<void> {
  try {
    logger.info(`Processing notification event: ${event.event}`, { eventId: event.entityId });

    // 1. Look up rules for the event type
    const rule = await getRuleForEvent(event.event);
    if (!rule) {
      logger.info(`No notification rule found for event: ${event.event}`);
      return;
    }

    // 2. Resolve recipients based on rule and event data
    const recipientIds = await resolveRecipients(event, rule.recipients);

    if (recipientIds.length === 0) {
      logger.info(`No recipients resolved for event: ${event.event}`);
      return;
    }

    // 3. For each recipient, process delivery
    const promises = recipientIds.map(async (userId) => {
      try {
        await processUserDelivery(userId, event, rule);
      } catch (error) {
        logger.error(`Error processing delivery for user ${userId}:`, error);
      }
    });

    await Promise.all(promises);
    logger.info(`Successfully processed event: ${event.event} for ${recipientIds.length} recipients`);

  } catch (error) {
    logger.error(`Failed to process notification event: ${event.event}`, error);
    throw error;
  }
}

/**
 * Processes delivery for a specific user, checking preferences, frequency, etc.
 */
async function processUserDelivery(userId: string, event: NotificationEvent, rule: { channels: NotificationChannel[], category: NotificationCategory, templateKey: string, priority: NotificationPriority }) {
  // 1. Check Preferences
  const isEssential = ESSENTIAL_CATEGORIES.includes(rule.category);
  
  if (!isEssential) {
    const isQuiet = await isQuietHours(userId);
    if (isQuiet) {
       logger.info(`Skipping non-essential notification for ${userId} due to quiet hours`);
       return;
    }
  }

  // Determine allowed channels based on user preferences
  const allowedChannels: NotificationChannel[] = [];
  for (const channel of rule.channels) {
    const allowed = await isNotificationAllowed(userId, rule.category, channel);
    if (allowed) {
      // 2. Check Frequency Limits for marketing
      const underLimit = await checkFrequencyLimit(userId, channel, rule.category);
      if (underLimit) {
        allowedChannels.push(channel);
      } else {
        logger.info(`Rate limit exceeded for user ${userId}, channel ${channel}, category ${rule.category}`);
      }
    }
  }

  if (allowedChannels.length === 0) {
    logger.info(`No allowed channels for user ${userId} for category ${rule.category}`);
    return;
  }

  // 3. Route to delivery channels via Queue
  // Enqueue job for delivery processing
  await enqueueNotification({
    userId,
    channels: allowedChannels,
    templateKey: rule.templateKey,
    eventData: event.data,
    priority: rule.priority,
    category: rule.category,
    idempotencyKey: `${event.event}_${event.entityId}_${userId}` // Unique key per event-entity-user
  });
  
  // 4. Update frequency counters
  for (const channel of allowedChannels) {
     await recordNotificationSent(userId, channel, rule.category);
  }
}

/**
 * Resolves user IDs based on entity types from the event.
 */
async function resolveRecipients(event: NotificationEvent, targetEntities: EntityType[]): Promise<string[]> {
  const userIds: Set<string> = new Set();
  
  // Basic implementation: if event has entityId and entityType matches target, add it.
  // In a real app, you'd fetch the related user IDs (e.g. get vendorId from order document)
  if (targetEntities.includes(event.entityType) && event.entityId) {
     // Assumption: entityId is the user ID for these purposes, or can be mapped
     userIds.add(event.entityId);
  }
  
  // For 'order', you'd typically query the order doc to get customerId, vendorId, riderId
  if (event.event.startsWith('order.') && event.data) {
     if (targetEntities.includes('customer') && event.data.customerId) userIds.add(event.data.customerId);
     if (targetEntities.includes('vendor') && event.data.restaurantId) userIds.add(event.data.restaurantId);
     if (targetEntities.includes('rider') && event.data.riderId) userIds.add(event.data.riderId);
  }

  return Array.from(userIds);
}
