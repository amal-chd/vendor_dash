import { useState, useMemo, useEffect } from "react";
import {
  Users,
  Send,
  Download,
  Plus,
  Search,
  Filter,
  Megaphone,
  Crown,
  UserCheck,
  UserX,
  Sparkles,
  ShoppingBag,
  TrendingUp,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Eye,
  Trash2,
  Copy,
  Calendar,
  Layers,
  ArrowRight,
  Phone,
  Mail,
  RefreshCw,
  SlidersHorizontal,
  Target,
  Flame,
  Radio,
} from "lucide-react";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  city?: string;
  walletBalance?: number;
  goldUntil?: unknown;
  isGold?: boolean;
  createdAt?: unknown;
  lastOrderAt?: unknown;
  totalOrders?: number;
  totalSpend?: number;
  isBanned?: boolean;
}

interface OrderRecord {
  id: string;
  customerUid?: string;
  customerName?: string;
  customerPhone?: string;
  total?: number;
  status?: string;
  timestamp?: unknown;
  createdAt?: unknown;
  restaurantName?: string;
}

interface DeliveryRider {
  id: string;
  name?: string;
  phone?: string;
  isOnline?: boolean;
  status?: string;
  lifetimeDeliveries?: number;
  city?: string;
}

interface Venue {
  id: string;
  name?: string;
  city?: string;
  rating?: number;
  orderCount?: number;
}

interface CustomSegment {
  id: string;
  name: string;
  description: string;
  entityType: "customers" | "riders" | "vendors";
  minOrders?: number;
  maxOrders?: number;
  minSpend?: number;
  daysInactive?: number;
  city?: string;
  isGoldOnly?: boolean;
  createdAt?: unknown;
}

interface CampaignRecord {
  id: string;
  name: string;
  segmentName: string;
  channel: "push" | "sms" | "whatsapp" | "in_app";
  title: string;
  message: string;
  promoCode?: string;
  targetCount: number;
  deliveredCount?: number;
  failedCount?: number;
  conversionCount: number;
  status: "active" | "sending" | "delivered" | "partial" | "failed" | "completed" | "scheduled";
  createdAt?: unknown;
}

const formatINR = (n?: number) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

const toDate = (ts: unknown): Date | null => {
  if (!ts) return null;
  try {
    const t = ts as { toDate?: () => Date };
    if (typeof t.toDate === "function") return t.toDate();
    if (typeof ts === "number") return new Date(ts);
    if (typeof ts === "string") return new Date(ts);
    return null;
  } catch {
    return null;
  }
};

const getDaysSince = (ts: unknown): number => {
  const d = toDate(ts);
  if (!d) return 999;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
};

export default function CRMPage() {
  // ── Live Firestore Collections ────────────────────────────────────────────
  const { rows: customers, loading: customersLoading } = useLiveCollection<Customer>("customer_users", {
    limit: 1000,
  });

  const { rows: orders, loading: ordersLoading } = useLiveCollection<OrderRecord>("orders", {
    limit: 1000,
  });

  const { rows: riders } = useLiveCollection<DeliveryRider>("delivery_users", { limit: 500 });
  const { rows: restaurants } = useLiveCollection<Venue>("restaurants", { limit: 400 });

  const { rows: customSegments } = useLiveCollection<CustomSegment>("crm_segments", {
    limit: 100,
  });

  const { rows: campaigns } = useLiveCollection<CampaignRecord>("crm_campaigns", {
    orderByField: "createdAt",
    orderDir: "desc",
    limit: 100,
  });

  // ── State ─────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("segments");
  const [selectedSegmentForCampaign, setSelectedSegmentForCampaign] = useState<{
    id: string;
    name: string;
    count: number;
    userIds: string[];
  } | null>(null);

  const [inspectingSegmentUsers, setInspectingSegmentUsers] = useState<{
    name: string;
    users: Customer[];
  } | null>(null);

  // New Custom Segment Form
  const [segmentDraft, setSegmentDraft] = useState<{
    name: string;
    description: string;
    entityType: "customers" | "riders" | "vendors";
    minOrders: string;
    minSpend: string;
    daysInactive: string;
    city: string;
    isGoldOnly: boolean;
  }>({
    name: "",
    description: "",
    entityType: "customers",
    minOrders: "3",
    minSpend: "1000",
    daysInactive: "0",
    city: "all",
    isGoldOnly: false,
  });

  // New Campaign Form
  const [campaignDraft, setCampaignDraft] = useState<{
    name: string;
    channel: "push" | "sms" | "whatsapp" | "in_app";
    title: string;
    message: string;
    promoCode: string;
    deepLink: string;
  }>({
    name: "",
    channel: "push",
    title: "",
    message: "",
    promoCode: "SAVE20",
    deepLink: "/menu",
  });

  const [savingSegment, setSavingSegment] = useState(false);
  const [launchingCampaign, setLaunchingCampaign] = useState(false);

  // ── Compute Customer Metrics Aggregations ─────────────────────────────────
  const enrichedCustomers = useMemo(() => {
    // Map customer Uid -> Total Spend, Order Count, Last Order Date
    const statsMap = new Map<
      string,
      { totalSpend: number; totalOrders: number; lastOrderTs: unknown }
    >();

    orders.forEach((o) => {
      const uid = o.customerUid;
      if (!uid) return;
      const stat = statsMap.get(uid) ?? {
        totalSpend: 0,
        totalOrders: 0,
        lastOrderTs: o.timestamp || o.createdAt,
      };
      stat.totalOrders += 1;
      stat.totalSpend += Number(o.total || 0);

      const orderD = toDate(o.timestamp || o.createdAt);
      const existingD = toDate(stat.lastOrderTs);
      if (orderD && (!existingD || orderD.getTime() > existingD.getTime())) {
        stat.lastOrderTs = o.timestamp || o.createdAt;
      }
      statsMap.set(uid, stat);
    });

    return customers.map((c) => {
      const st = statsMap.get(c.id);
      const ordersCount = c.totalOrders ?? st?.totalOrders ?? 0;
      const spend = c.totalSpend ?? st?.totalSpend ?? 0;
      const lastOrder = c.lastOrderAt ?? st?.lastOrderTs ?? c.createdAt;

      const isGold = Boolean(
        c.isGold || (c.goldUntil && toDate(c.goldUntil) && toDate(c.goldUntil)!.getTime() > Date.now()),
      );

      return {
        ...c,
        name: c.name || c.displayName || "Diner",
        totalOrders: ordersCount,
        totalSpend: spend,
        lastOrderAt: lastOrder,
        isGold,
      };
    });
  }, [customers, orders]);

  // ── Pre-Built Smart Segments Calculation ──────────────────────────────────
  const smartSegments = useMemo(() => {
    const totalUsers = enrichedCustomers.length;

    // 1. High-Value VIPs (Spend >= 2500 or >= 5 orders)
    const vipList = enrichedCustomers.filter((c) => c.totalSpend >= 2500 || c.totalOrders >= 5);

    // 2. Churn Risk (Ordered before, but no orders in last 30 days)
    const churnList = enrichedCustomers.filter(
      (c) => c.totalOrders > 0 && getDaysSince(c.lastOrderAt) >= 30,
    );

    // 3. New Registrations (Created in last 7 days with <= 1 order)
    const newList = enrichedCustomers.filter(
      (c) => getDaysSince(c.createdAt) <= 7 && c.totalOrders <= 1,
    );

    // 4. Gold & Loyalty Champions
    const goldList = enrichedCustomers.filter((c) => c.isGold);

    // 5. Active Loyal Riders
    const topRiders = riders.filter((r) => (r.lifetimeDeliveries || 0) >= 50);

    // 6. Top Venue Partners
    const topVenues = restaurants.filter((r) => (r.rating || 0) >= 4.5);

    return [
      {
        id: "SEG-VIP",
        name: "High-Value VIP Customers",
        description: "Frequent diners with lifetime spend > ₹2,500 or 5+ completed orders.",
        count: vipList.length,
        users: vipList,
        icon: <Crown className="w-5 h-5 text-amber-500" />,
        badge: "Revenue Drivers",
        badgeVariant: "default" as const,
      },
      {
        id: "SEG-CHURN",
        name: "Dormant / Churn Risk",
        description: "Customers who placed orders previously but have been inactive for 30+ days.",
        count: churnList.length,
        users: churnList,
        icon: <AlertCircle className="w-5 h-5 text-rose-500" />,
        badge: "Win-Back Target",
        badgeVariant: "destructive" as const,
      },
      {
        id: "SEG-NEW",
        name: "New Registrations (7 Days)",
        description: "Fresh accounts created in the last week with 0 or 1 order placed.",
        count: newList.length,
        users: newList,
        icon: <Sparkles className="w-5 h-5 text-purple-500" />,
        badge: "Onboarding Loop",
        badgeVariant: "secondary" as const,
      },
      {
        id: "SEG-GOLD",
        name: "Kada Gold Members",
        description: "Active subscription holders with premium delivery and cashback perks.",
        count: goldList.length,
        users: goldList,
        icon: <Flame className="w-5 h-5 text-amber-500" />,
        badge: "Subscribers",
        badgeVariant: "default" as const,
      },
      {
        id: "SEG-RIDERS",
        name: "Top Performing Delivery Fleet",
        description: "Riders with 50+ successful lifetime deliveries and active ratings.",
        count: topRiders.length,
        users: [],
        icon: <Users className="w-5 h-5 text-primary" />,
        badge: "Logistics",
        badgeVariant: "secondary" as const,
      },
      {
        id: "SEG-VENUES",
        name: "Top-Rated Restaurant Partners",
        description: "Venues with customer ratings >= 4.5 and high order fulfillment.",
        count: topVenues.length,
        users: [],
        icon: <ShoppingBag className="w-5 h-5 text-emerald-500" />,
        badge: "Marketplace",
        badgeVariant: "secondary" as const,
      },
    ];
  }, [enrichedCustomers, riders, restaurants]);

  // ── Custom Segment Live Preview Count ─────────────────────────────────────
  const previewMatchingUsers = useMemo(() => {
    if (segmentDraft.entityType !== "customers") return [];

    const minOrders = Number(segmentDraft.minOrders) || 0;
    const minSpend = Number(segmentDraft.minSpend) || 0;
    const daysInactive = Number(segmentDraft.daysInactive) || 0;
    const city = segmentDraft.city.toLowerCase();
    const isGoldOnly = segmentDraft.isGoldOnly;

    return enrichedCustomers.filter((c) => {
      if (c.totalOrders < minOrders) return false;
      if (c.totalSpend < minSpend) return false;
      if (daysInactive > 0 && getDaysSince(c.lastOrderAt) < daysInactive) return false;
      if (city !== "all" && (c.city || "").toLowerCase() !== city) return false;
      if (isGoldOnly && !c.isGold) return false;
      return true;
    });
  }, [enrichedCustomers, segmentDraft]);

  // ── KPIs Strip ────────────────────────────────────────────────────────────
  const kpis: StatItem[] = useMemo(() => {
    const totalDiners = enrichedCustomers.length;
    const activeThisMonth = enrichedCustomers.filter(
      (c) => getDaysSince(c.lastOrderAt) <= 30 && c.totalOrders > 0,
    ).length;
    const totalVIPs = enrichedCustomers.filter((c) => c.totalSpend >= 2500).length;
    const campaignsCount = campaigns.length;

    return [
      {
        title: "Customer profiles",
        value: totalDiners.toLocaleString("en-IN"),
        icon: Users,
        loading: customersLoading,
      },
      {
        title: "Active (30 days)",
        value: activeThisMonth.toLocaleString("en-IN"),
        hint: totalDiners ? `${Math.round((activeThisMonth / totalDiners) * 100)}% ordered this month` : undefined,
        icon: TrendingUp,
        tone: "text-emerald-600",
        loading: customersLoading,
      },
      {
        title: "VIPs",
        value: totalVIPs.toLocaleString("en-IN"),
        hint: "Lifetime spend ₹2,500+",
        icon: Crown,
        tone: "text-amber-600",
        loading: customersLoading,
      },
      {
        title: "Campaigns sent",
        value: campaignsCount.toLocaleString("en-IN"),
        icon: Megaphone,
        tone: "text-indigo-600",
      },
    ];
  }, [customersLoading, enrichedCustomers, campaigns]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSaveCustomSegment = async () => {
    if (!segmentDraft.name.trim()) {
      toast.error("Please enter a segment name");
      return;
    }

    setSavingSegment(true);
    try {
      await addDoc(collection(db, "crm_segments"), {
        name: segmentDraft.name.trim(),
        description: segmentDraft.description.trim() || "Custom filtered user segment",
        entityType: segmentDraft.entityType,
        minOrders: Number(segmentDraft.minOrders) || 0,
        minSpend: Number(segmentDraft.minSpend) || 0,
        daysInactive: Number(segmentDraft.daysInactive) || 0,
        city: segmentDraft.city,
        isGoldOnly: segmentDraft.isGoldOnly,
        createdAt: serverTimestamp(),
      });

      toast.success(`Segment "${segmentDraft.name}" saved!`);
      setSegmentDraft({
        name: "",
        description: "",
        entityType: "customers",
        minOrders: "3",
        minSpend: "1000",
        daysInactive: "0",
        city: "all",
        isGoldOnly: false,
      });
      setActiveTab("segments");
    } catch (err: unknown) {
      toast.error(`Failed to save segment: ${(err as Error).message}`);
    } finally {
      setSavingSegment(false);
    }
  };

  const handleDeleteSegment = async (id: string, name: string) => {
    try {
      await deleteDoc(doc(db, "crm_segments", id));
      toast.success(`Deleted segment "${name}"`);
    } catch (err: unknown) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const handleLaunchCampaign = async () => {
    if (!selectedSegmentForCampaign) return;
    if (!campaignDraft.name.trim() || !campaignDraft.title.trim() || !campaignDraft.message.trim()) {
      toast.error("Please complete campaign name, title, and message");
      return;
    }
    const uids = selectedSegmentForCampaign.userIds || [];
    if (uids.length === 0) {
      toast.error("This segment has no matching users — nothing to send.");
      return;
    }

    setLaunchingCampaign(true);
    const title = campaignDraft.title.trim();
    const body = campaignDraft.message.trim();
    const promoCode = campaignDraft.promoCode?.trim() || null;
    const deepLink = campaignDraft.deepLink || "/menu";

    try {
      // 1. Record the campaign for the analytics/history tab.
      const campaignRef = await addDoc(collection(db, "crm_campaigns"), {
        name: campaignDraft.name.trim(),
        segmentName: selectedSegmentForCampaign.name,
        channel: campaignDraft.channel,
        title,
        message: body,
        promoCode,
        deepLink,
        targetCount: uids.length,
        deliveredCount: 0,
        failedCount: 0,
        conversionCount: 0,
        status: "sending",
        createdAt: serverTimestamp(),
      });

      // 2. Actually deliver — write a real in-app notification doc under each
      // customer's own /notifications subcollection (the same feed the
      // customer app's notification bell reads). Firestore batches cap at
      // 500 writes, so chunk. Push over FCM would need per-user tokens +
      // a Cloud Function, so this stays in-app-only until that ships.
      let delivered = 0;
      let failed = 0;
      const CHUNK = 400; // conservative under the 500-write cap
      for (let i = 0; i < uids.length; i += CHUNK) {
        const chunk = uids.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        chunk.forEach((uid) => {
          const notifRef = doc(collection(db, "customer_users", uid, "notifications"));
          batch.set(notifRef, {
            title,
            body,
            type: "promo",
            promoCode,
            deepLink,
            campaignId: campaignRef.id,
            read: false,
            timestamp: serverTimestamp(),
          });
        });
        try {
          await batch.commit();
          delivered += chunk.length;
        } catch (batchErr) {
          console.error(`[CRM] campaign batch ${i}-${i + chunk.length} failed`, batchErr);
          failed += chunk.length;
        }
      }

      // 3. Update campaign doc with the real delivery result.
      await setDoc(
        doc(db, "crm_campaigns", campaignRef.id),
        {
          deliveredCount: delivered,
          failedCount: failed,
          status: failed === 0 ? "delivered" : delivered === 0 ? "failed" : "partial",
        },
        { merge: true },
      );

      if (failed === 0) {
        toast.success(`Campaign "${campaignDraft.name}" delivered to ${delivered} customer${delivered === 1 ? "" : "s"}.`);
      } else if (delivered === 0) {
        toast.error(`Campaign "${campaignDraft.name}" failed — 0/${uids.length} delivered.`);
      } else {
        toast.warning(`Campaign "${campaignDraft.name}" partially delivered: ${delivered}/${uids.length}.`);
      }

      setSelectedSegmentForCampaign(null);
      setCampaignDraft({
        name: "",
        channel: "push",
        title: "",
        message: "",
        promoCode: "SAVE20",
        deepLink: "/menu",
      });
      setActiveTab("campaigns");
    } catch (err: unknown) {
      toast.error(`Campaign launch failed: ${(err as Error).message}`);
    } finally {
      setLaunchingCampaign(false);
    }
  };

  const handleExportSegmentCSV = (segmentName: string, userList: Customer[]) => {
    if (!userList.length) {
      toast.info("No customer profiles to export in this segment.");
      return;
    }

    const headers = [
      "Customer ID",
      "Name",
      "Phone",
      "Email",
      "City",
      "Total Orders",
      "Total Spend (INR)",
      "Gold Member",
      "Days Since Last Order",
    ];

    const rows = userList.map((c) => [
      `"${c.id}"`,
      `"${(c.name || "").replace(/"/g, '""')}"`,
      `"${c.phone || ""}"`,
      `"${c.email || ""}"`,
      `"${c.city || "Kerala"}"`,
      c.totalOrders ?? 0,
      c.totalSpend ?? 0,
      c.isGold ? "Yes" : "No",
      getDaysSince(c.lastOrderAt),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `kada_segment_${segmentName.toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${userList.length} customer records for "${segmentName}"`);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <AdminPageHeader
        title="CRM & Customer Growth Segments"
        description="Automated customer lifecycle segmentation, high-AOV retargeting, and multi-channel campaign dispatch."
        badge="Growth Engine"
      />

      {/* ── Stats Strip ────────────────────────────────────────────────────── */}
      <StatCards items={kpis} />

      {/* ── Navigation Tabs ────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md h-auto p-1 bg-muted/60">
          <TabsTrigger value="segments" className="text-xs py-2">
            <Layers className="w-3.5 h-3.5 mr-1.5" />
            Smart Segments
          </TabsTrigger>
          <TabsTrigger value="builder" className="text-xs py-2">
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            Custom Builder
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs py-2">
            <Megaphone className="w-3.5 h-3.5 mr-1.5 text-primary" />
            Campaigns ({campaigns.length})
          </TabsTrigger>
        </TabsList>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 1: SMART PRE-BUILT & CUSTOM SAVED SEGMENTS
        ═════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="segments" className="space-y-6">
          {/* Pre-Built Smart Segments */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Automated Platform Segments
                </h3>
                <p className="text-xs text-muted-foreground">
                  Real-time calculated customer clusters based on live spending, order frequency, and recency.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setActiveTab("builder")}
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Build Custom Segment
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {smartSegments.map((segment) => (
                <div
                  key={segment.id}
                  className="border border-border/60 rounded-xl p-5 bg-card hover:border-primary/50 transition-all flex flex-col justify-between shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-muted/60">{segment.icon}</div>
                        <h4 className="font-semibold text-sm text-foreground line-clamp-1">
                          {segment.name}
                        </h4>
                      </div>
                      <Badge variant={segment.badgeVariant} className="text-[10px] px-1.5">
                        {segment.badge}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2 min-h-[32px]">
                      {segment.description}
                    </p>

                    <div className="flex items-center justify-between py-3 border-y border-border/40 my-3">
                      <div>
                        <span className="text-[11px] text-muted-foreground block">Audience Size</span>
                        <span className="font-bold text-lg text-foreground">
                          {customersLoading ? "—" : segment.count.toLocaleString("en-IN")}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[11px] text-muted-foreground block">Status</span>
                        <span className="text-xs font-semibold text-emerald-500">Live Sync</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 text-xs h-8 gap-1.5"
                      onClick={() => {
                        setSelectedSegmentForCampaign({
                          id: segment.id,
                          name: segment.name,
                          count: segment.count,
                          userIds: segment.users.map((u) => u.id).filter(Boolean),
                        });
                        setCampaignDraft((prev) => ({
                          ...prev,
                          name: `${segment.name} Push Promo`,
                          title: `Exclusive for you, Foodie! 🔥`,
                          message: `Special treat! Enjoy ₹100 off on your next order with code SAVE100. Order now!`,
                        }));
                      }}
                    >
                      <Megaphone className="w-3.5 h-3.5" />
                      Launch Campaign
                    </Button>

                    {segment.users.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5"
                        onClick={() =>
                          setInspectingSegmentUsers({
                            name: segment.name,
                            users: segment.users,
                          })
                        }
                        title="View Users List"
                      >
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={() => handleExportSegmentCSV(segment.name, segment.users)}
                      title="Export CSV"
                    >
                      <Download className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Saved Segments from Firestore */}
          {customSegments.length > 0 && (
            <div className="pt-4 border-t border-border/60">
              <h3 className="text-base font-semibold text-foreground mb-3">Custom Saved Segments</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customSegments.map((seg) => (
                  <div
                    key={seg.id}
                    className="border border-border/60 rounded-xl p-4 bg-card flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        <h4 className="font-semibold text-sm text-foreground">{seg.name}</h4>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {seg.entityType}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {seg.description}
                      </p>
                      <div className="text-[11px] text-muted-foreground pt-2 space-y-0.5">
                        {seg.minOrders ? <p>• Min Orders: {seg.minOrders}</p> : null}
                        {seg.minSpend ? <p>• Min Spend: ₹{seg.minSpend}</p> : null}
                        {seg.city && seg.city !== "all" ? <p>• City: {seg.city}</p> : null}
                        {seg.isGoldOnly ? <p>• Gold Members Only</p> : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                      <Button
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => {
                          // Re-run the saved segment's filter rules against the
                          // live customer pool so we send to real users, not a
                          // hardcoded placeholder count.
                          const matched = enrichedCustomers.filter((c) => {
                            if (seg.entityType && seg.entityType !== "customers") return false;
                            if ((seg.minOrders || 0) > 0 && c.totalOrders < (seg.minOrders || 0)) return false;
                            if ((seg.minSpend || 0) > 0 && c.totalSpend < (seg.minSpend || 0)) return false;
                            if ((seg.daysInactive || 0) > 0 && getDaysSince(c.lastOrderAt) < (seg.daysInactive || 0)) return false;
                            if (seg.city && seg.city !== "all" && (c.city || "").toLowerCase() !== seg.city.toLowerCase()) return false;
                            if (seg.isGoldOnly && !c.isGold) return false;
                            return true;
                          });
                          setSelectedSegmentForCampaign({
                            id: seg.id,
                            name: seg.name,
                            count: matched.length,
                            userIds: matched.map((u) => u.id).filter(Boolean),
                          });
                        }}
                      >
                        <Megaphone className="w-3 h-3 mr-1" />
                        Campaign
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-rose-500"
                        onClick={() => handleDeleteSegment(seg.id, seg.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 2: CUSTOM SEGMENT QUERY BUILDER
        ═════════════════════════════════════════════ */}
        <TabsContent value="builder" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Form: Conditions (7 cols) */}
            <div className="lg:col-span-7">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-primary" />
                    Segment Filter Engine
                  </CardTitle>
                  <CardDescription>
                    Define visual rule conditions to segment customers, delivery riders, or venues.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Segment Name *</Label>
                      <Input
                        value={segmentDraft.name}
                        onChange={(e) =>
                          setSegmentDraft({ ...segmentDraft, name: e.target.value })
                        }
                        placeholder="e.g. Kochi Biryani Enthusiasts"
                        className="text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Target Entity Type</Label>
                      <Select
                        value={segmentDraft.entityType}
                        onValueChange={(val: "customers" | "riders" | "vendors") =>
                          setSegmentDraft({ ...segmentDraft, entityType: val })
                        }
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customers">Customers (Diners)</SelectItem>
                          <SelectItem value="riders">Delivery Riders</SelectItem>
                          <SelectItem value="vendors">Restaurant Partners</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Description</Label>
                    <Input
                      value={segmentDraft.description}
                      onChange={(e) =>
                        setSegmentDraft({ ...segmentDraft, description: e.target.value })
                      }
                      placeholder="Brief note about the marketing objective..."
                      className="text-xs"
                    />
                  </div>

                  {/* Filter Conditions Box */}
                  <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
                    <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-primary" />
                      Rule Criteria
                    </h4>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          Minimum Orders Placed
                        </Label>
                        <Input
                          type="number"
                          value={segmentDraft.minOrders}
                          onChange={(e) =>
                            setSegmentDraft({ ...segmentDraft, minOrders: e.target.value })
                          }
                          placeholder="e.g. 3"
                          className="text-xs h-8"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          Minimum Lifetime Spend (₹)
                        </Label>
                        <Input
                          type="number"
                          value={segmentDraft.minSpend}
                          onChange={(e) =>
                            setSegmentDraft({ ...segmentDraft, minSpend: e.target.value })
                          }
                          placeholder="e.g. 1000"
                          className="text-xs h-8"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          Days Inactive (Dormant)
                        </Label>
                        <Input
                          type="number"
                          value={segmentDraft.daysInactive}
                          onChange={(e) =>
                            setSegmentDraft({ ...segmentDraft, daysInactive: e.target.value })
                          }
                          placeholder="e.g. 30"
                          className="text-xs h-8"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">City Filter</Label>
                        <Select
                          value={segmentDraft.city}
                          onValueChange={(val) => setSegmentDraft({ ...segmentDraft, city: val })}
                        >
                          <SelectTrigger className="text-xs h-8">
                            <SelectValue placeholder="All Cities" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Cities</SelectItem>
                            <SelectItem value="kochi">Kochi</SelectItem>
                            <SelectItem value="calicut">Calicut</SelectItem>
                            <SelectItem value="trivandrum">Trivandrum</SelectItem>
                            <SelectItem value="thrissur">Thrissur</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={handleSaveCustomSegment}
                    disabled={savingSegment}
                    className="w-full text-xs"
                  >
                    {savingSegment ? "Saving Segment..." : "Save Custom Segment to Platform"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel: Live Matches Preview (5 cols) */}
            <div className="lg:col-span-5">
              <Card className="h-full flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-emerald-500" />
                      Live Audience Preview
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {previewMatchingUsers.length} Matches
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Users qualifying under currently selected filter parameters.
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex-1 space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {previewMatchingUsers.slice(0, 15).map((u) => (
                    <div
                      key={u.id}
                      className="p-2.5 rounded-lg border border-border/40 bg-muted/20 flex justify-between items-center text-xs"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{u.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {u.phone || "No phone"} · {u.city || "Kerala"}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-primary">{formatINR(u.totalSpend)}</span>
                        <p className="text-[10px] text-muted-foreground">{u.totalOrders} orders</p>
                      </div>
                    </div>
                  ))}

                  {previewMatchingUsers.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-12">
                      No matching user records found with these filters.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ═════════════════════════════════════════════════════════════════════
            TAB 3: RECENT CAMPAIGNS & ANALYTICS
        ═════════════════════════════════════════════ */}
        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Executed Growth Campaigns</CardTitle>
                <CardDescription>
                  Real-time broadcast history, conversion rates, and promotional coupon redemptions.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent>
              {campaigns.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border/60">
                  <Megaphone className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  <p className="text-sm font-medium">No campaigns launched yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pick a smart segment and launch your first targeted promotional broadcast!
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4 text-xs"
                    onClick={() => setActiveTab("segments")}
                  >
                    Explore Segments →
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-muted-foreground bg-muted/30">
                        <th className="p-3 font-semibold">Campaign</th>
                        <th className="p-3 font-semibold">Target Audience</th>
                        <th className="p-3 font-semibold">Channel</th>
                        <th className="p-3 font-semibold">Promo Code</th>
                        <th className="p-3 font-semibold text-right">Targeted</th>
                        <th className="p-3 font-semibold text-right">Converted</th>
                        <th className="p-3 font-semibold">Status</th>
                        <th className="p-3 font-semibold text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {campaigns.map((camp) => (
                        <tr key={camp.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3">
                            <p className="font-semibold text-foreground">{camp.name}</p>
                            <p className="text-[11px] text-muted-foreground line-clamp-1">
                              {camp.title}
                            </p>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-[10px]">
                              {camp.segmentName}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <span className="capitalize font-medium text-foreground">
                              {camp.channel}
                            </span>
                          </td>
                          <td className="p-3 font-mono font-semibold text-primary">
                            {camp.promoCode || "—"}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {camp.targetCount?.toLocaleString("en-IN") || "—"}
                          </td>
                          <td className="p-3 text-right text-emerald-600 font-bold">
                            {camp.conversionCount || 0}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={camp.status === "active" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {camp.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            {toDate(camp.createdAt)?.toLocaleDateString("en-IN") || "Recent"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 1: LAUNCH CAMPAIGN DIALOG
      ═════════════════════════════════════════════ */}
      <Dialog
        open={!!selectedSegmentForCampaign}
        onOpenChange={(open) => !open && setSelectedSegmentForCampaign(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-primary" />
              Launch Campaign to "{selectedSegmentForCampaign?.name}"
            </DialogTitle>
            <DialogDescription>
              Targeting {selectedSegmentForCampaign?.count} qualifying users across delivery channels.
            </DialogDescription>
          </DialogHeader>

          {selectedSegmentForCampaign && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Campaign Name *</Label>
                  <Input
                    value={campaignDraft.name}
                    onChange={(e) => setCampaignDraft({ ...campaignDraft, name: e.target.value })}
                    placeholder="e.g. Weekend Flash Offer"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Channel</Label>
                  <Select
                    value={campaignDraft.channel}
                    onValueChange={(val: "push" | "sms" | "whatsapp" | "in_app") =>
                      setCampaignDraft({ ...campaignDraft, channel: val })
                    }
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="push">Push Notification</SelectItem>
                      <SelectItem value="in_app">In-App Banner</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp Direct</SelectItem>
                      <SelectItem value="sms">SMS Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Notification Title *</Label>
                <Input
                  value={campaignDraft.title}
                  onChange={(e) => setCampaignDraft({ ...campaignDraft, title: e.target.value })}
                  placeholder="e.g. 50% Off On Your Favorite Biryani! 🍗"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Message Body *</Label>
                <Textarea
                  value={campaignDraft.message}
                  onChange={(e) => setCampaignDraft({ ...campaignDraft, message: e.target.value })}
                  placeholder="Enter compelling promotional copy..."
                  className="text-xs min-h-[70px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Promo Code (Optional)</Label>
                  <Input
                    value={campaignDraft.promoCode}
                    onChange={(e) =>
                      setCampaignDraft({ ...campaignDraft, promoCode: e.target.value })
                    }
                    placeholder="e.g. SAVE20"
                    className="text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Deep Link</Label>
                  <Input
                    value={campaignDraft.deepLink}
                    onChange={(e) =>
                      setCampaignDraft({ ...campaignDraft, deepLink: e.target.value })
                    }
                    placeholder="/menu"
                    className="text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedSegmentForCampaign(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleLaunchCampaign} disabled={launchingCampaign}>
              {launchingCampaign ? "Launching Broadcast..." : "Launch Campaign Broadcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════════
          MODAL 2: INSPECT USERS IN SEGMENT
      ═════════════════════════════════════════════ */}
      <Dialog
        open={!!inspectingSegmentUsers}
        onOpenChange={(open) => !open && setInspectingSegmentUsers(null)}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Audience: {inspectingSegmentUsers?.name} ({inspectingSegmentUsers?.users.length} Users)
            </DialogTitle>
          </DialogHeader>

          {inspectingSegmentUsers && (
            <div className="space-y-2 py-2">
              <div className="divide-y divide-border/40 max-h-[400px] overflow-y-auto border rounded-lg p-2">
                {inspectingSegmentUsers.users.map((user) => (
                  <div key={user.id} className="py-2 flex justify-between items-center text-xs">
                    <div>
                      <p className="font-semibold text-foreground">{user.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Phone: {user.phone || "—"} · Email: {user.email || "—"} · City:{" "}
                        {user.city || "Kerala"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-primary">{formatINR(user.totalSpend)}</p>
                      <p className="text-[10px] text-muted-foreground">{user.totalOrders} orders</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (inspectingSegmentUsers) {
                  handleExportSegmentCSV(
                    inspectingSegmentUsers.name,
                    inspectingSegmentUsers.users,
                  );
                }
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Download CSV
            </Button>
            <Button size="sm" onClick={() => setInspectingSegmentUsers(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
