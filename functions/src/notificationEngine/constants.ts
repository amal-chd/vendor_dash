/**
 * Configuration Constants for Notification Engine
 */
import { NotificationCategory, AppTarget, EntityType } from "./types";

export const FREQUENCY_LIMITS = {
  marketing_push: {
    daily: 3,
    weekly: 8,
    minGapMinutes: 240, // 4 hours
  },
} as const;

export const QUIET_HOURS = {
  from: 22, // 10 PM
  to: 7,    // 7 AM
} as const;

export const ESSENTIAL_CATEGORIES: NotificationCategory[] = [
  'transactional',
];

export const SUPPORTED_LANGUAGES = ['en', 'ml', 'ta', 'hi', 'kn'] as const;

export const MAX_FCM_BATCH_SIZE = 500;
export const MAX_RETRY_ATTEMPTS = 4;
export const BACKOFF_MS = [0, 60_000, 300_000, 1_800_000]; // 0s, 1m, 5m, 30m

export const DEEP_LINK_ROUTES: Record<AppTarget, Record<string, string>> = {
  customer: {
    order_status: '/orders/:id',
    restaurant_menu: '/restaurant/:id',
    home: '/home',
  },
  vendor: {
    new_order: '/orders/active/:id',
    dashboard: '/dashboard',
    menu_management: '/menu',
  },
  rider: {
    new_delivery: '/deliveries/active/:id',
    earnings: '/earnings',
  },
  host: {
    dashboard: '/dashboard',
    waitlist: '/waitlist',
  },
  admin: {
    dashboard: '/admin',
  },
  web: {
    home: '/',
  },
};

// Event types to roles mapping
export const EVENT_NOTIFICATION_MAP: Record<string, EntityType[]> = {
  'order.created': ['vendor'],
  'order.accepted': ['customer'],
  'order.ready': ['customer', 'rider'],
  'order.picked_up': ['customer'],
  'order.delivered': ['customer'],
  'order.cancelled': ['customer', 'vendor'],
  'vendor.approved': ['vendor'],
  'rider.approved': ['rider'],
  'rider.delivery_completed': ['customer'],
};

// Built-in Segment Definitions
export const BUILT_IN_SEGMENTS = {
  active_customers: {
    id: 'active_customers',
    name: 'Active Customers',
    entityType: 'customer' as EntityType,
    conditions: [
      { field: 'lastActive', operator: '>=', value: '30_days_ago' }
    ]
  },
  new_customers: {
    id: 'new_customers',
    name: 'New Customers',
    entityType: 'customer' as EntityType,
    conditions: [
      { field: 'createdAt', operator: '>=', value: '7_days_ago' }
    ]
  },
  active_vendors: {
    id: 'active_vendors',
    name: 'Active Vendors',
    entityType: 'vendor' as EntityType,
    conditions: [
      { field: 'isActive', operator: '==', value: true }
    ]
  }
};
