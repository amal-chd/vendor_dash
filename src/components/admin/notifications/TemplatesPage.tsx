import React, { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Search,
  Layers,
  Languages,
  Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notificationService } from "@/services/notificationService";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Template {
  id: string;
  name: string;
  key: string;
  status: "draft" | "published" | "archived";
  channels: string[];
  languages: string[];
  variables: string[];
  updatedAt: any;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ key: "", name: "", title: "", body: "" });

const BUILT_IN_TEMPLATES: any[] = [
  {
    id: "tpl-flash-sale",
    name: "Flash Sale Promo",
    key: "promo.flash_sale",
    status: "published",
    channels: ["push", "in_app"],
    languages: ["en", "ml"],
    variables: ["discount", "restaurantName"],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl-happy-hour",
    name: "Happy Hour Alert",
    key: "promo.happy_hour",
    status: "published",
    channels: ["push"],
    languages: ["en"],
    variables: ["startTime", "endTime"],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl-order-out",
    name: "Order Out for Delivery",
    key: "order.out_for_delivery",
    status: "published",
    channels: ["push"],
    languages: ["en", "ml", "hi"],
    variables: ["riderName", "eta"],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl-rider-surge",
    name: "Rider Surge Pricing",
    key: "rider.surge_active",
    status: "published",
    channels: ["push", "sms"],
    languages: ["en", "ml"],
    variables: ["zoneName", "multiplier"],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl-vendor-report",
    name: "Vendor Weekly Report",
    key: "vendor.weekly_report",
    status: "published",
    channels: ["email"],
    languages: ["en"],
    variables: ["totalSales", "orderCount"],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "tpl-welcome",
    name: "Welcome to Kada",
    key: "user.welcome",
    status: "published",
    channels: ["push", "email"],
    languages: ["en", "ml", "hi"],
    variables: ["userName"],
    updatedAt: new Date().toISOString(),
  }
];

  useEffect(() => {
    const q = query(
      collection(db, "notification_templates"),
      orderBy("updatedAt", "desc"),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(
          (doc) => ({ id: doc.id, ...doc.data() }) as Template,
        );
        const existingIds = new Set(data.map(d => d.id));
        const builtIns = BUILT_IN_TEMPLATES.filter(b => !existingIds.has(b.id));
        setTemplates([...data, ...builtIns]);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setTemplates([...BUILT_IN_TEMPLATES]);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, []);

  const handleCreate = async () => {
    if (!form.key.trim() || !form.title.trim() || !form.body.trim()) {
      toast.error("Key, title and body are required");
      return;
    }
    setSaving(true);
    try {
      await notificationService.createTemplate({
        key: form.key.trim(),
        title: form.title.trim(),
        body: form.body.trim(),
        name: form.name.trim() || form.title.trim(),
      });
      toast.success("Template created");
      setOpen(false);
      setForm({ key: "", name: "", title: "", body: "" });
    } catch (e) {
      console.error(e);
      toast.error("Could not create template");
    } finally {
      setSaving(false);
    }
  };

  const filtered = templates.filter(
    (t) =>
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.key?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-7xl space-y-6">
      <AdminPageHeader
        title="Notification Templates"
        description="Manage reusable message templates for all your notifications."
      />

      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Template
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 border-dashed">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No templates yet</h3>
          <p className="text-muted-foreground text-center max-w-sm mb-4">
            Create your first notification template to standardize your
            messaging across all channels.
          </p>
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Create Template
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((template) => (
            <Card
              key={template.id}
              className="hover:shadow-md transition-all cursor-pointer"
            >
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-semibold text-lg">
                      {template.name || "Unnamed Template"}
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono">
                      {template.key}
                    </p>
                  </div>
                  <Badge
                    variant={
                      template.status === "published"
                        ? "default"
                        : template.status === "draft"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {template.status || "draft"}
                  </Badge>
                </div>

                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    <span>
                      Channels: {template.channels?.join(", ") || "None"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Languages className="h-4 w-4" />
                    <span>
                      Languages: {template.languages?.join(", ") || "en"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>
                      Updated:{" "}
                      {template.updatedAt?.toDate?.().toLocaleDateString() ||
                        "Unknown"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Key</Label>
              <Input
                value={form.key}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                placeholder="order_ready"
              />
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Order ready"
              />
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Body</Label>
              <Textarea
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={handleCreate}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
