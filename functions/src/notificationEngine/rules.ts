/**
 * Rule engine for notifications
 */
import { NotificationChannel, NotificationPriority, NotificationCategory, EntityType } from "./types";

export interface NotificationRule {
  recipients: EntityType[]; // Who to notify (roles)
  channels: NotificationChannel[];
  templateKey: string;
  priority: NotificationPriority;
  category: NotificationCategory;
}

export const SYSTEM_RULES: Record<string, NotificationRule> = {
  'order.created': {
    recipients: ['vendor'],
    channels: ['push', 'in_app'],
    templateKey: 'vendor_order_created',
    priority: 'high',
    category: 'transactional',
  },
  'order.delivered': {
    recipients: ['customer'],
    channels: ['push', 'email'],
    templateKey: 'customer_order_delivered',
    priority: 'normal',
    category: 'transactional',
  },
  'vendor.approved': {
    recipients: ['vendor'],
    channels: ['push', 'email'],
    templateKey: 'vendor_approved',
    priority: 'high',
    category: 'transactional',
  },
  'rider.delivery_completed': {
    recipients: ['customer'],
    channels: ['push'],
    templateKey: 'customer_delivery_completed',
    priority: 'normal',
    category: 'transactional',
  },
  // Add more default rules as needed
};

/**
 * Get the applicable rule for a given event.
 * Currently returns hardcoded system rules, but can be extended to fetch from Firestore.
 */
export async function getRuleForEvent(event: string): Promise<NotificationRule | null> {
  // In a full implementation, you could check Firestore for custom rules first
  // const customRule = await fetchCustomRuleFromFirestore(event);
  // if (customRule) return customRule;

  return SYSTEM_RULES[event] || null;
}
