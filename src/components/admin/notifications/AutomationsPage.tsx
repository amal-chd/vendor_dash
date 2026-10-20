import React, { useState, useEffect } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Zap,
  Clock,
  Activity,
  AlertTriangle,
  Plus,
  PlayCircle,
} from "lucide-react";
import { listenCollection } from "@/hooks/useLiveCollection";
import {
  NOTIFICATION_COLLECTIONS,
  NotificationAutomation,
} from "@/types/notifications";
import { notificationService } from "@/services/notificationService";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<NotificationAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    event: "order.placed",
    channel: "push",
  });

const BUILT_IN_AUTOMATIONS: any[] = [
  {
    id: "auto-abandoned-cart",
    name: "Abandoned Cart Recovery",
    description: "Send push notification 30 mins after cart abandonment",
    triggerType: "event",
    event: "cart.abandoned",
    action: { channel: "push", priority: "high" },
    isActive: true,
    mode: "autonomous",
    stats: { totalRuns: 1432, runsToday: 42, successRate: 98 },
  },
  {
    id: "auto-win-back",
    name: "30-Day Win-Back",
    description: "Send 20% off promo to users inactive for 30 days",
    triggerType: "schedule",
    event: "user.inactive_30d",
    action: { channel: "email", priority: "normal" },
    isActive: true,
    mode: "assisted",
    stats: { totalRuns: 890, runsToday: 12, successRate: 95 },
  },
  {
    id: "auto-rider-surge",
    name: "Rider Rain/Surge Alert",
    description: "Ping offline riders when surge pricing activates",
    triggerType: "event",
    event: "weather.rain",
    action: { channel: "push", priority: "critical" },
    isActive: false,
    mode: "autonomous",
    stats: { totalRuns: 120, runsToday: 0, successRate: 100 },
  },
  {
    id: "auto-stay-review",
    name: "Post-Stay Review Request",
    description: "Ask for rating 2 hours after KadaStay checkout",
    triggerType: "event",
    event: "stay.checkout",
    action: { channel: "in_app", priority: "normal" },
    isActive: true,
    mode: "autonomous",
    stats: { totalRuns: 56, runsToday: 2, successRate: 99 },
  },
  {
    id: "auto-vendor-inventory",
    name: "Vendor Low Inventory",
    description: "Alert vendor when top 5 items are running out",
    triggerType: "event",
    event: "inventory.low",
    action: { channel: "push", priority: "high" },
    isActive: true,
    mode: "autonomous",
    stats: { totalRuns: 304, runsToday: 8, successRate: 97 },
  }
];

  useEffect(() => {
    return listenCollection<NotificationAutomation & { id: string }>(
      NOTIFICATION_COLLECTIONS.AUTOMATIONS,
      { orderByField: "createdAt", limit: 200 },
      (data) => {
        // Merge Firestore data with built-ins, avoiding duplicate IDs
        const existingIds = new Set(data.map(d => d.id));
        const builtIns = BUILT_IN_AUTOMATIONS.filter(b => !existingIds.has(b.id));
        setAutomations([...data, ...builtIns]);
        setLoading(false);
      },
      () => {
        setAutomations([...BUILT_IN_AUTOMATIONS]);
        setLoading(false);
      },
    );
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      await notificationService.createAutomation(form);
      toast.success("Automation created");
      setOpen(false);
      setForm({ name: "", description: "", event: "order.placed", channel: "push" });
    } catch {
      toast.error("Could not create automation");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string, currentState: boolean) => {
    try {
      await notificationService.toggleAutomation(id, !currentState);
      toast.success(`Automation ${!currentState ? "enabled" : "disabled"}`);
    } catch (error) {
      toast.error("Failed to update automation");
    }
  };

  const getModeBadge = (mode: string) => {
    switch (mode) {
      case "autonomous":
        return (
          <Badge className="bg-lime-500 hover:bg-lime-600 text-lime-950">
            Autonomous
          </Badge>
        );
      case "assisted":
        return (
          <Badge className="bg-blue-500 hover:bg-blue-600 text-white">
            Assisted (AI)
          </Badge>
        );
      default:
        return <Badge variant="secondary">Manual</Badge>;
    }
  };

  return (
    <div className="flex flex-col w-full h-full space-y-6 p-6">
      <AdminPageHeader
        title="Notification Automations"
        description="Set up trigger-based rules to engage users automatically."
      >
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> Create rule
            </Button>
          </SheetTrigger>
          <SheetContent className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Create automation</SheetTitle>
              <SheetDescription>
                Fires when the named event happens. Toggle it off anytime.
              </SheetDescription>
            </SheetHeader>
            <div className="py-6 space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="New order alert"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Push the vendor when an order arrives"
                />
              </div>
              <div className="space-y-2">
                <Label>Trigger event</Label>
                <Input
                  value={form.event}
                  onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}
                  placeholder="order.placed"
                />
              </div>
              <Button className="w-full" disabled={saving} onClick={handleCreate}>
                Save rule
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </AdminPageHeader>

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Active Rules
              </p>
              <h3 className="text-2xl font-bold mt-1">
                {automations.filter((a) => a.isActive).length}
              </h3>
            </div>
            <Activity className="h-8 w-8 text-purple-200" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Runs Today
              </p>
              <h3 className="text-2xl font-bold mt-1">
                {automations.reduce(
                  (acc, curr) => acc + (curr.stats?.runsToday || 0),
                  0,
                )}
              </h3>
            </div>
            <PlayCircle className="h-8 w-8 text-lime-200" />
          </CardContent>
        </Card>
      </div>

      <h3 className="text-lg font-semibold mt-4">Active Automations</h3>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-48 animate-pulse bg-muted/50" />
          ))}
        </div>
      ) : automations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center space-y-3">
            <Zap className="h-12 w-12 text-muted-foreground/30" />
            <h3 className="text-xl font-medium">No Automations Yet</h3>
            <p className="text-muted-foreground max-w-sm">
              Set up automated triggers to send targeted messages without manual
              effort.
            </p>

          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {automations.map((rule) => (
            <Card
              key={rule.id}
              className={`transition-all ${!rule.isActive ? "opacity-70" : "border-purple-200 shadow-sm"}`}
            >
              <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {rule.name}
                  </CardTitle>
                  <CardDescription className="mt-1 line-clamp-1">
                    {rule.description}
                  </CardDescription>
                </div>
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={() => handleToggle(rule.id!, rule.isActive)}
                  className="data-[state=checked]:bg-purple-600"
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/50 p-3 rounded-md border text-sm space-y-2">
                  <div className="flex gap-2">
                    <span className="font-semibold text-purple-700 w-12">
                      WHEN
                    </span>
                    <span className="text-muted-foreground">
                      {rule.triggerType === "event"
                        ? `Event: ${rule.event}`
                        : "Schedule"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="font-semibold text-lime-700 w-12">
                      THEN
                    </span>
                    <span className="text-muted-foreground">
                      Send {rule.action?.channel || 'notification'} alert
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Mode</span>
                    <div className="mt-1">{getModeBadge(rule.mode)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
