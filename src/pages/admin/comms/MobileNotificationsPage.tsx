import { Suspense, lazy, useState } from "react";
import { Bell, Loader2, Send } from "lucide-react";
import { ChannelShell } from "./channelShell";
import { cn } from "@/lib/utils";

const NotificationOverview = lazy(() => import("@/components/admin/notifications/NotificationOverview"));
const NotificationsPage = lazy(() => import("@/pages/admin/NotificationsPage"));
const CampaignsPage = lazy(() => import("@/components/admin/notifications/CampaignsPage"));
const AiStudioPage = lazy(() => import("@/components/admin/notifications/AiStudioPage"));
const AutomationsPage = lazy(() => import("@/components/admin/notifications/AutomationsPage"));
const TemplatesPage = lazy(() => import("@/components/admin/notifications/TemplatesPage"));
const SegmentsPage = lazy(() => import("@/components/admin/notifications/SegmentsPage"));
const ScheduledPage = lazy(() => import("@/components/admin/notifications/ScheduledPage"));
const FailedPage = lazy(() => import("@/components/admin/notifications/FailedPage"));
const DevicesPage = lazy(() => import("@/components/admin/notifications/DevicesPage"));
const PreferencesPage = lazy(() => import("@/components/admin/notifications/PreferencesPage"));
const AnalyticsPage = lazy(() => import("@/components/admin/notifications/AnalyticsPage"));
const HealthPage = lazy(() => import("@/components/admin/notifications/HealthPage"));

const fb = (
  <div className="py-16 text-center">
    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
  </div>
);
const S = (el: React.ReactNode) => <Suspense fallback={fb}>{el}</Suspense>;

function SystemGroup() {
  const items = [
    { id: "scheduled", label: "Scheduled", el: <ScheduledPage /> },
    { id: "failed", label: "Failed", el: <FailedPage /> },
    { id: "devices", label: "Devices", el: <DevicesPage /> },
    { id: "preferences", label: "Preferences", el: <PreferencesPage /> },
    { id: "health", label: "Health", el: <HealthPage /> },
  ];
  const [sel, setSel] = useState("scheduled");
  const cur = items.find((i) => i.id === sel) || items[0];
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-full border bg-muted/40 p-1">
        {items.map((i) => (
          <button
            key={i.id}
            onClick={() => setSel(i.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
              sel === i.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {i.label}
          </button>
        ))}
      </div>
      {S(cur.el)}
    </div>
  );
}

export default function MobileNotificationsPage() {
  return (
    <ChannelShell
      embedded
      title="Mobile Notifications"
      subtitle="Compose, schedule, and track push + in-app alerts across Customer, Vendor, Delivery, and Host."
      icon={<Bell className="h-5 w-5" />}
      defaultTab="overview"
      tabs={[
        { key: "overview", label: "Overview", element: S(<NotificationOverview />) },
        { key: "send", label: "Send", icon: <Send className="h-3.5 w-3.5" />, element: S(<NotificationsPage />) },
        { key: "campaigns", label: "Campaigns", element: S(<CampaignsPage />) },
        { key: "create", label: "Write with AI", element: S(<AiStudioPage />) },
        { key: "audiences", label: "Audiences", element: S(<SegmentsPage />) },
        { key: "automations", label: "Automations", element: S(<AutomationsPage />) },
        { key: "templates", label: "Templates", element: S(<TemplatesPage />) },
        { key: "analytics", label: "Analytics", element: S(<AnalyticsPage />) },
        { key: "system", label: "System", element: <SystemGroup /> },
      ]}
    />
  );
}
