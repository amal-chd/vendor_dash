import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Megaphone,
  Search,
  MoreHorizontal,
  Plus,
  Play,
  Edit,
  Copy,
  Trash,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, query, onSnapshot, limit } from "firebase/firestore";
import {
  NOTIFICATION_COLLECTIONS,
  NotificationCampaign,
} from "@/types/notifications";
import { notificationService } from "@/services/notificationService";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Assuming DataTable exists based on prompt instructions
// import { DataTable } from "@/components/admin/ui/data-table";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    objective: "announce_feature",
    priority: "normal",
    audience: "customers",
    title: "",
    body: "",
    imageUrl: "",
  });

const BUILT_IN_CAMPAIGNS: any[] = [
  {
    id: "cmp-weekend-sale",
    name: "Weekend Mega Sale",
    objective: "increase_orders",
    targetAudience: "customers",
    targetApps: ["customer"],
    channels: ["push", "in_app"],
    content: {
      en: { title: "50% OFF this Weekend! 🍕", body: "Use code WEEKEND50 to get flat 50% off on top restaurants." }
    },
    defaultLanguage: "en",
    priority: "high",
    category: "marketing",
    status: "sent",
    stats: { sent: 45200, delivered: 43100, opened: 12050, failed: 120, converted: 3400 },
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: "cmp-app-update",
    name: "New Version v2.4",
    objective: "announce_feature",
    targetAudience: "all_apps",
    targetApps: ["customer", "rider", "vendor", "host"],
    channels: ["in_app"],
    content: {
      en: { title: "Update Required", body: "A new version of the Kada app is available with bug fixes and speed improvements." }
    },
    defaultLanguage: "en",
    priority: "normal",
    category: "system",
    status: "scheduled",
    schedule: { type: "scheduled", scheduledTime: new Date(Date.now() + 86400000 * 2).toISOString() },
    stats: { sent: 0, delivered: 0, opened: 0, failed: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cmp-host-webinar",
    name: "KadaStay Host Webinar",
    objective: "reactivate",
    targetAudience: "hosts",
    targetApps: ["host"],
    channels: ["email"],
    content: {
      en: { title: "Boost your bookings!", body: "Join our free webinar this Friday to learn how to optimize your KadaStay listing." }
    },
    defaultLanguage: "en",
    priority: "normal",
    category: "operational",
    status: "draft",
    stats: { sent: 0, delivered: 0, opened: 0, failed: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

  useEffect(() => {
    return onSnapshot(
      query(collection(db, NOTIFICATION_COLLECTIONS.CAMPAIGNS), limit(200)),
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as NotificationCampaign);
        const existingIds = new Set(data.map(d => d.id));
        const builtIns = BUILT_IN_CAMPAIGNS.filter(b => !existingIds.has(b.id));
        setCampaigns([...data, ...builtIns]);
        setLoading(false);
      },
      () => {
        setCampaigns([...BUILT_IN_CAMPAIGNS]);
        setLoading(false);
      },
    );
  }, []);

  const filteredCampaigns = campaigns.filter((c) => {
    if (activeTab !== "all" && c.status !== activeTab) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.objective || "").toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      draft: "bg-muted text-foreground border-border",
      pending_approval: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300",
      approved: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:border-blue-500/30 dark:text-blue-300",
      scheduled: "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-500/15 dark:border-cyan-500/30 dark:text-cyan-300",
      sending: "bg-purple-100 text-purple-800 border-purple-200 animate-pulse dark:bg-purple-500/15 dark:border-purple-500/30 dark:text-purple-300",
      sent: "bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:border-green-500/30 dark:text-green-300",
      failed: "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:border-red-500/30 dark:text-red-300",
      cancelled: "bg-muted text-foreground border-border",
    };
    return (
      <Badge variant="outline" className={variants[status] || "bg-muted"}>
        {status.replace("_", " ")}
      </Badge>
    );
  };

  const handleDuplicate = async (id: string) => {
    try {
      await notificationService.duplicateCampaign(id);
      toast.success("Campaign duplicated successfully");
    } catch (error) {
      toast.error("Failed to duplicate campaign");
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await notificationService.cancelCampaign(id);
      toast.success("Campaign cancelled");
    } catch (error) {
      toast.error("Failed to cancel campaign");
    }
  };

  const handleSendNow = async (id: string) => {
    try {
      await notificationService.approveCampaign(id);
      toast.success("Campaign sending");
    } catch {
      toast.error("Could not send campaign");
    }
  };

  const handleCreate = async (submit: boolean) => {
    if (!form.name.trim() || !form.title.trim() || !form.body.trim()) {
      toast.error("Name, title and message are required");
      return;
    }
    setSaving(true);
    try {
      const { id } = await notificationService.createCampaign({
        name: form.name.trim(),
        objective: form.objective,
        audience: form.audience,
        title: form.title.trim(),
        body: form.body.trim(),
        priority: form.priority as NotificationCampaign["priority"],
        channels: ["push", "in_app"],
        apps: [
          form.audience === "riders"
            ? "rider"
            : form.audience === "hosts"
              ? "host"
              : form.audience === "customers"
                ? "customer"
                : "vendor",
        ],
      });
      if (submit && id) {
        await notificationService.approveCampaign(id);
        toast.success("Campaign sent");
      } else {
        toast.success("Draft saved");
      }
      setIsCreateOpen(false);
      setForm({
        name: "",
        objective: "announce_feature",
        priority: "normal",
        audience: "customers",
        title: "",
        body: "",
        imageUrl: "",
      });
    } catch (error) {
      console.error(error);
      toast.error("Could not save campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col w-full h-full space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Campaigns</h2>
          <p className="text-sm text-muted-foreground">
            Draft, approve, and send multi-app notification campaigns.
          </p>
        </div>
        <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <SheetTrigger asChild>
            <Button className="gap-2 bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4" /> Create Campaign
            </Button>
          </SheetTrigger>
          <SheetContent className="sm:max-w-xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Create New Campaign</SheetTitle>
              <SheetDescription>
                Configure your notification campaign details here.
              </SheetDescription>
            </SheetHeader>
            <div className="py-6 space-y-6">
              {/* Simplified form for brevity, normally would use react-hook-form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Campaign Name</Label>
                  <Input
                    placeholder="e.g. Weekend Flash Sale"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Objective</Label>
                    <Select
                      value={form.objective}
                      onValueChange={(v) => setForm((f) => ({ ...f, objective: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select objective" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="increase_orders">
                          Increase Orders
                        </SelectItem>
                        <SelectItem value="reactivate">
                          Reactivate Users
                        </SelectItem>
                        <SelectItem value="announce_feature">
                          Announce Feature
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select
                      value={form.priority}
                      onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Message Title</Label>
                  <Input
                    placeholder="Grab 50% off today!"
                    maxLength={65}
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {form.title.length}/65
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Message Body</Label>
                  <Textarea
                    placeholder="Order now from your favorite restaurants and get amazing discounts..."
                    className="resize-none"
                    rows={3}
                    maxLength={178}
                    value={form.body}
                    onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {form.body.length}/178
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select
                    value={form.audience}
                    onValueChange={(v) => setForm((f) => ({ ...f, audience: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customers">Customers</SelectItem>
                      <SelectItem value="all">All vendors</SelectItem>
                      <SelectItem value="active">Active vendors</SelectItem>
                      <SelectItem value="riders">Riders</SelectItem>
                      <SelectItem value="hosts">Hosts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Image URL (Optional)</Label>
                  <Input placeholder="https://..." />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t">
                <Button
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => handleCreate(false)}
                >
                  Save Draft
                </Button>
                <Button
                  disabled={saving}
                  onClick={() => handleCreate(true)}
                >
                  Send now
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <div className="flex justify-between items-center">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">Drafts</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="sending">Sending</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search campaigns..."
                className="pl-8 w-[250px]"
              />
            </div>

          </div>
        </div>

        <TabsContent value={activeTab} className="border rounded-lg bg-card">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading campaigns...
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Megaphone className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium">No campaigns found</h3>
              <p className="text-muted-foreground mt-1">
                Create a new campaign to get started.
              </p>
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Campaign
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Audience
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Channels
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Performance
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Created
                    </th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {filteredCampaigns.map((campaign) => (
                    <tr
                      key={campaign.id}
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <td className="p-4 align-middle">
                        <div className="font-medium">{campaign.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {campaign.objective}
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        {getStatusBadge(campaign.status)}
                      </td>
                      <td className="p-4 align-middle">
                        <Badge variant="secondary" className="font-normal">
                          {campaign.targetAudience}
                        </Badge>
                      </td>
                      <td className="p-4 align-middle flex gap-1">
                        {Array.isArray(campaign.channels)
                          ? campaign.channels.map((ch) => (
                          <Badge key={ch} variant="outline" className="text-xs">
                            {ch}
                          </Badge>
                        ))
                          : null}
                      </td>
                      <td className="p-4 align-middle">
                        <div className="text-xs">
                          <div>
                            Sent:{" "}
                            <span className="font-medium">
                              {campaign.stats?.sent || 0}
                            </span>
                          </div>
                          <div>
                            Delivered:{" "}
                            <span className="font-medium text-green-600">
                              {campaign.stats?.delivered || 0}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 align-middle text-xs text-muted-foreground">
                        {campaign.createdAt
                          ? format(
                              (campaign.createdAt as any).toDate
                                ? (campaign.createdAt as any).toDate()
                                : new Date(campaign.createdAt as any),
                              "MMM d, yyyy",
                            )
                          : "-"}
                      </td>
                      <td className="p-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-label="More actions" variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="gap-2" disabled>
                              <Edit className="h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => handleDuplicate(campaign.id!)}
                            >
                              <Copy className="h-4 w-4" /> Duplicate
                            </DropdownMenuItem>
                            {campaign.status === "draft" && (
                              <DropdownMenuItem
                                className="gap-2"
                                onClick={() => handleSendNow(campaign.id!)}
                              >
                                <Play className="h-4 w-4" /> Send now
                              </DropdownMenuItem>
                            )}
                            {(campaign.status === "scheduled" ||
                              campaign.status === "sending") && (
                              <DropdownMenuItem
                                className="gap-2 text-red-600"
                                onClick={() => handleCancel(campaign.id!)}
                              >
                                <Trash className="h-4 w-4" /> Cancel
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
