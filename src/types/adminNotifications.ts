export type AlertSeverity = "critical" | "warning" | "info";

export type AlertCategory =
  | "operations"
  | "finance"
  | "support"
  | "partners"
  | "quality";

export interface AdminAlert {
  id: string;
  type:
    | "incident"
    | "delayed_delivery"
    | "payment_failure"
    | "support_escalated"
    | "pending_settlement"
    | "pending_refund"
    | "partner_onboarding"
    | "bank_verification"
    | "system";
  title: string;
  message: string;
  severity: AlertSeverity;
  category: AlertCategory;
  href: string;
  timestamp: number;
  count?: number;
  amount?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceAlertCounts {
  orders: number;
  vendors: number;
  delivery: number;
  finance: number;
  stay: number;
  support: number;
  quality: number;
}

export interface AdminItemCounts {
  escalatedChats: number;
  pendingSettlements: number;
  settlementAmount: number;
  pendingRefunds: number;
  openIncidents: number;
  delayedDeliveries: number;
  paymentFailures: number;
  vendorOnboarding: number;
  riderOnboarding: number;
  hostOnboarding: number;
  bankActionCount: number;
}

export interface NotificationSummary {
  total: number;
  unread: number;
  critical: number;
  warning: number;
  info: number;
  workspaces: WorkspaceAlertCounts;
}

