import { Timestamp } from "firebase/firestore";

export type AppTarget =
  "customer" | "vendor" | "rider" | "host" | "admin" | "web";
export type NotificationChannel =
  "push" | "in_app" | "email" | "sms" | "whatsapp";
export type NotificationPriority = "low" | "normal" | "high" | "critical";
export type NotificationCategory =
  "transactional" | "marketing" | "system" | "support" | "operational";

export type CampaignStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";
export type AutomationMode = "manual" | "assisted" | "autonomous";

export interface DeepLink {
  route: string;
  params?: Record<string, string>;
  fallbackUrl?: string;
}

export interface NotificationContent {
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: DeepLink | string;
  actionUrl?: string;
  ctaText?: string;
}

export interface NotificationCampaign {
  id?: string;
  name: string;
  objective: string;
  targetAudience: string;
  targetApps: AppTarget[];
  channels: NotificationChannel[];
  content: Record<string, NotificationContent>; // language -> content
  defaultLanguage: string;
  priority: NotificationPriority;
  category: NotificationCategory;
  schedule?: {
    type: "now" | "scheduled" | "recurring";
    scheduledTime?: Timestamp | Date | null;
    cronExpression?: string;
  };
  limits?: {
    frequencyCap?: number;
    ttl?: number;
  };
  status: CampaignStatus;
  stats: CampaignStats;
  createdBy: string;
  approvedBy?: string;
  createdAt: Timestamp | Date | any;
  updatedAt: Timestamp | Date | any;
}

export interface CampaignStats {
  sent: number;
  delivered: number;
  opened: number;
  failed: number;
  converted?: number;
}

export interface NotificationDelivery {
  id: string;
  campaignId?: string;
  recipientId: string;
  targetApp: AppTarget;
  channel: NotificationChannel;
  title: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error?: string;
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
}

export interface OverviewMetrics {
  sentToday: number;
  delivered: number;
  failed: number;
  activeDevices: number;
  scheduled: number;
  pushCtr: number;
  sentTrend: number;
  deliveryRate: number;
}

export interface NotificationAutomation {
  id?: string;
  name: string;
  description: string;
  triggerType: "event" | "schedule";
  event?: string;
  conditions: any[]; // Simplified for now
  action: {
    templateId?: string;
    channel: NotificationChannel;
    priority: NotificationPriority;
    delayMinutes?: number;
  };
  mode: AutomationMode;
  isActive: boolean;
  stats: {
    runsToday: number;
    totalRuns: number;
    successRate: number;
    lastRunAt?: Timestamp | Date;
  };
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
}

export interface AiGenerationRequest {
  prompt: string;
  objective?: string;
  audience?: string;
  targetApps?: AppTarget[];
  channels?: NotificationChannel[];
  tone?: string;
  language?: string;
}

export interface AiGenerationResult {
  title: string;
  body: string;
  ctaText?: string;
  deepLink?: string;
  recommendedTime?: string;
  reasoning?: string;
  audienceSize?: number;
  targetApp: AppTarget;
  audience: string;
  channels: NotificationChannel[];
  language: string;
}

export interface AiAuditLog {
  id: string;
  timestamp: Timestamp | Date;
  adminId: string;
  promptSummary: string;
  status: "validated" | "failed" | "rejected";
  model: string;
  fullPrompt: string;
  fullResponse: any;
  validationResult?: any;
}

export interface SystemHealthStatus {
  status: "healthy" | "degraded" | "down";
  fcmStatus: "healthy" | "degraded" | "down";
  emailStatus: "healthy" | "degraded" | "down";
  queueLength: number;
  lastChecked: Timestamp | Date;
}

export const NOTIFICATION_COLLECTIONS = {
  CAMPAIGNS: "notification_campaigns",
  TEMPLATES: "notification_templates",
  DELIVERIES: "notification_deliveries",
  DEVICES: "notification_devices",
  PREFERENCES: "notification_preferences",
  SEGMENTS: "notification_segments",
  AUTOMATIONS: "notification_automations",
  AI_AUDIT_LOGS: "notification_ai_audit_logs",
};
