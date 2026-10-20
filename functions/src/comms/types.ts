/**
 * Kada Communications — shared types & config for the centralized email/comms
 * platform. This module is the single server-side entry point for all outbound
 * email; nothing else in the codebase should talk to an email provider directly.
 *
 * Design: canonical user records (customer_users / delivery_users / restaurants
 * / hotels) stay the source of truth. We layer a `communicationProfiles/{uid}`
 * record (consent, channels, engagement) on top — never duplicating PII we can
 * link to. All privileged operations run here in Cloud Functions.
 */

export const COL = {
  profiles: "communicationProfiles",
  templates: "emailTemplates",
  events: "emailEvents", // the queue
  logs: "emailLogs",
  suppressions: "emailSuppressions",
  campaigns: "emailCampaigns",
  segments: "emailSegments",
  audit: "communicationAuditLogs",
  settings: "communicationSettings", // single doc: "email"
} as const;

/** Public web base for tokenized preference/unsubscribe links. */
export const WEB_BASE_URL = "https://thekada.in";
export const PREFERENCES_PATH = "/email/preferences"; // + /{token}

export type UserType =
  | "CUSTOMER"
  | "VENDOR"
  | "DELIVERY_PARTNER"
  | "HOST"
  | "RESTAURANT_STAFF"
  | "ADMIN"
  | "SUPPORT_AGENT"
  | "LEAD"
  | "SUBSCRIBER";

/** Channel/category of an email — drives consent + suppression semantics. */
export type EmailCategory =
  | "authentication" // always sent (security)
  | "orders" // transactional
  | "payments"
  | "billing"
  | "vendor"
  | "rider"
  | "host"
  | "support"
  | "subscriptions"
  | "announcements"
  | "marketing"; // requires marketing consent + honours unsubscribe

/** Categories that are essential and bypass marketing consent (never spam). */
export const ESSENTIAL_CATEGORIES: EmailCategory[] = [
  "authentication",
  "orders",
  "payments",
  "billing",
  "support",
  "subscriptions",
];

export function isMarketingCategory(c: EmailCategory): boolean {
  return c === "marketing" || c === "announcements";
}

export type EmailStatus = "active" | "invalid" | "suppressed" | "unknown";

export interface EmailEvent {
  eventId: string; // idempotency key, e.g. "order_123_order_confirmation"
  type: string; // business event, e.g. ORDER_CONFIRMATION
  category: EmailCategory;
  to: string;
  userId?: string;
  userType?: UserType;
  templateKey: string;
  data: Record<string, unknown>;
  campaignId?: string;
  status:
    | "queued"
    | "processing"
    | "sent"
    | "failed"
    | "suppressed"
    | "skipped";
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: number; // epoch ms
  lastError?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface EmailProviderResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  /** true when the failure is permanent (bad address, rejected) — do not retry. */
  permanent?: boolean;
}
