import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  Volume2,
  VolumeX,
  CheckCheck,
  AlertOctagon,
  AlertTriangle,
  Info,
  ArrowRight,
  ShieldCheck,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import type { AdminAlert } from "@/types/adminNotifications";

function formatRelativeTime(ts: number) {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return "Today";
}

export function AdminNotificationCenter() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "critical" | "ops" | "finance" | "support">("all");

  const {
    alerts,
    summary,
    soundEnabled,
    toggleSound,
    readIds,
    markAsRead,
    markAllAsRead,
  } = useAdminNotifications();

  // Filter alerts by active tab
  const filteredAlerts = useMemo(() => {
    switch (activeTab) {
      case "critical":
        return alerts.filter((a) => a.severity === "critical");
      case "ops":
        return alerts.filter((a) => a.category === "operations");
      case "finance":
        return alerts.filter((a) => a.category === "finance" || a.category === "partners" || a.category === "quality");
      case "support":
        return alerts.filter((a) => a.category === "support");
      case "all":
      default:
        return alerts;
    }
  }, [alerts, activeTab]);

  const hasUnread = summary.unread > 0;
  const hasCritical = summary.critical > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open notifications"
          className="relative h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <Bell className={cn("w-4 h-4", hasCritical && "text-rose-500 animate-wiggle")} />
          {hasUnread && (
            <span
              className={cn(
                "absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full text-[9px] font-black border-2 border-background",
                hasCritical
                  ? "bg-rose-500 text-white animate-pulse"
                  : summary.warning > 0
                  ? "bg-amber-500 text-white"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {summary.unread > 99 ? "99+" : summary.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] sm:w-[420px] p-0 shadow-2xl rounded-xl border border-border/70 overflow-hidden bg-background"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground">Alerts & Notifications</span>
            {hasUnread && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-bold bg-primary/15 text-primary">
                {summary.unread} new
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Audio chime toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
              onClick={toggleSound}
              title={soundEnabled ? "Mute alert chime" : "Enable alert chime"}
            >
              {soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-primary" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </Button>

            {/* Mark all as read */}
            {hasUnread && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground font-medium flex items-center gap-1"
                onClick={() => markAllAsRead(alerts)}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark read</span>
              </Button>
            )}
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border/40 bg-muted/10 overflow-x-auto no-scrollbar">
          {[
            { id: "all", label: "All", count: alerts.length },
            { id: "critical", label: "Critical", count: summary.critical, alert: summary.critical > 0 },
            { id: "ops", label: "Ops", count: summary.workspaces.orders },
            { id: "finance", label: "Finance & KYC", count: summary.workspaces.finance + summary.workspaces.vendors + summary.workspaces.quality },
            { id: "support", label: "Support", count: summary.workspaces.support },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                tab.alert && activeTab !== tab.id && "text-rose-500 font-semibold"
              )}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={cn(
                    "text-[10px] px-1 rounded-full font-bold leading-none py-0.5",
                    activeTab === tab.id
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : tab.alert
                      ? "bg-rose-500/15 text-rose-600"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Alert List */}
        <ScrollArea className="max-h-[380px] overflow-y-auto divide-y divide-border/40">
          {filteredAlerts.length === 0 ? (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">All systems nominal</p>
              <p className="text-xs text-muted-foreground max-w-[240px]">
                No pending operational alerts in this view.
              </p>
            </div>
          ) : (
            filteredAlerts.map((alert: AdminAlert) => {
              const isUnread = !readIds.has(alert.id);
              return (
                <div
                  key={alert.id}
                  className={cn(
                    "p-3.5 flex items-start gap-3 transition-colors group relative hover:bg-muted/40",
                    isUnread && "bg-muted/15"
                  )}
                >
                  {/* Severity icon */}
                  <div
                    className={cn(
                      "w-7 h-7 rounded-lg shrink-0 flex items-center justify-center mt-0.5",
                      alert.severity === "critical"
                        ? "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                        : alert.severity === "warning"
                        ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                        : "bg-sky-500/10 text-sky-600 border border-sky-500/20"
                    )}
                  >
                    {alert.severity === "critical" ? (
                      <AlertOctagon className="w-4 h-4" />
                    ) : alert.severity === "warning" ? (
                      <AlertTriangle className="w-4 h-4" />
                    ) : (
                      <Info className="w-4 h-4" />
                    )}
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 justify-between">
                      <p className={cn("text-xs font-semibold truncate", isUnread ? "text-foreground" : "text-muted-foreground")}>
                        {alert.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground/70 shrink-0 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatRelativeTime(alert.timestamp)}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {alert.message}
                    </p>

                    <div className="flex items-center gap-2 pt-1">
                      <Link
                        to={alert.href}
                        onClick={() => {
                          markAsRead(alert.id);
                          setOpen(false);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        <span>Resolve</span>
                        <ArrowRight className="w-3 h-3" />
                      </Link>

                      {isUnread && (
                        <button
                          type="button"
                          onClick={() => markAsRead(alert.id)}
                          className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border/60 bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            {summary.critical > 0 && (
              <span className="text-rose-600 font-semibold">{summary.critical} critical</span>
            )}
            {summary.warning > 0 && (
              <span>{summary.warning} warning</span>
            )}
            {summary.info > 0 && (
              <span>{summary.info} pending</span>
            )}
          </div>

          <Link
            to="/admin"
            onClick={() => setOpen(false)}
            className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
          >
            <span>Platform Overview</span>
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
