/**
 * Types for the Notification Engine
 */
import { Timestamp } from "firebase-admin/firestore";

export const COL = {
  NOTIFICATIONS: "notifications",
  NOTIFICATION_TEMPLATES: "notification_templates",
  NOTIFICATION_CAMPAIGNS: "notification_campaigns",
  NOTIFICATION_DEVICES: "notification_devices",
  NOTIFICATION_PREFERENCES: "notification_preferences",
  NOTIFICATION_DELIVERIES: "notification_deliveries",
  NOTIFICATION_SEGMENTS: "notification_segments",
  NOTIFICATION_AUTOMATIONS: "notification_automations",
  NOTIFICATION_JOBS: "notification_jobs",
  AI_AUDIT_LOGS: "notification_ai_audit_logs",
} as const;

export type NotificationChannel = 'push' | 'in_app' | 'email' | 'sms';
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low';
export type NotificationCategory = 'transactional' | 'operational' | 'marketing';
export type AppTarget = 'customer' | 'vendor' | 'rider' | 'host' | 'admin' | 'web';
export type EntityType = 'customer' | 'vendor' | 'rider' | 'host' | 'admin';

export interface NotificationEvent {
  event: string;
  entityType: EntityType;
  entityId: string;
  actorId?: string;
  actorType?: EntityType;
  timestamp: Timestamp | number;
  data: Record<string, any>;
}

export interface NotificationTemplate {
  id?: string;
  key: string;
  title: string;
  body: string;
  variables: string[];
  channelVariants: Record<NotificationChannel, { title?: string; body: string; image?: string; cta?: string }>;
  languageVariants: Record<string, { title: string; body: string }>;
  status: 'draft' | 'published' | 'archived';
  versions?: { version: number; timestamp: Timestamp; createdBy: string; changes: string }[];
}

export interface NotificationCampaign {
  id?: string;
  name: string;
  objective?: string;
  audience: string; // segment id or 'all'
  apps?: AppTarget[];
  channels?: NotificationChannel[];
  language?: string;
  title?: string;
  body?: string;
  image?: string;
  deepLink?: string;
  cta?: string;
  priority?: NotificationPriority;
  schedule?: Timestamp;
  frequencyLimit?: { daily?: number; weekly?: number };
  status: 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'sending' | 'sent' | 'partially_sent' | 'failed' | 'cancelled';
  createdBy: string;
  approvedBy?: string;
  stats?: { sent: number; delivered: number; opened: number; clicked: number; failed: number };
}

export interface NotificationDevice {
  id?: string;
  userId: string;
  deviceId: string;
  app: AppTarget;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  fcmToken: string;
  browser?: string;
  osVersion?: string;
  appVersion?: string;
  deviceModel?: string;
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'undetermined';
  isActive: boolean;
  lastSeen: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface NotificationPreference {
  userId: string;
  categories: Record<NotificationCategory, Record<NotificationChannel, boolean>>;
  quietHours?: { from: number; to: number }; // 24-hour format
  timezone: string;
}

export interface NotificationDelivery {
  id: string;
  notificationId: string; // job id or individual delivery id
  campaignId?: string;
  userId: string;
  deviceId?: string;
  channel: NotificationChannel;
  provider: 'fcm' | 'sendgrid' | 'twilio' | 'firestore' | 'other';
  status: 'queued' | 'processing' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'failed' | 'cancelled';
  sentAt?: Timestamp;
  deliveredAt?: Timestamp;
  openedAt?: Timestamp;
  clickedAt?: Timestamp;
  failedAt?: Timestamp;
  error?: string;
  retryCount: number;
}

export interface NotificationSegmentCondition {
  field: string;
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';
  value: any;
}

export interface NotificationSegment {
  id?: string;
  name: string;
  description?: string;
  entityType: EntityType;
  conditions: NotificationSegmentCondition[];
  estimatedCount?: number;
  lastEvaluated?: Timestamp;
}

export interface NotificationAutomation {
  id?: string;
  name: string;
  trigger: string; // event type
  conditions: NotificationSegmentCondition[];
  action: { templateId?: string; channels: NotificationChannel[]; audience?: string };
  mode: 'manual' | 'assisted' | 'autonomous';
  isActive: boolean;
  lastRun?: Timestamp;
}

export interface DeepLink {
  entityType: EntityType;
  entityId: string;
  route: string;
  action?: string;
  app: AppTarget;
}

export interface AiGenerationRequest {
  prompt: string;
  context: Record<string, any>;
  objective: string;
  tone?: string;
  language?: string;
  maxLength?: number;
}

export interface AiGenerationResult {
  title: string;
  body: string;
  cta?: string;
  variablesUsed: string[];
}

export interface AiAuditLog {
  id?: string;
  requestPrompt: string;
  systemInstruction: string;
  rawResponse: string;
  validationResult: boolean;
  adminId: string;
  adminEmail: string;
  finalContent: string;
  model: string;
  timestamp: Timestamp;
}
