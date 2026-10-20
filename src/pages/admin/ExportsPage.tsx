import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatCards } from "@/components/admin/StatCards";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  Download,
  Building2,
  CreditCard,
  MessageSquare,
  FileCheck2,
  CalendarClock,
  Loader2,
  CheckCircle2,
  ShoppingCart,
  Wallet,
  Bike,
  Users,
  Gift,
  Hotel,
  ScrollText,
  Search,
  FileSpreadsheet,
  Database,
  Clock,
  AlertTriangle,
  Shield,
  Receipt,
  Package,
  Star,
  Megaphone,
} from "lucide-react";
import { collection, getDocs, query, limit, orderBy, where, addDoc, WhereFilterOp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ─── Types ───────────────────────────────────────────────────────────────────── */

interface ExportConfig {
  id: string;
  label: string;
  description: string;
  collection: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  category: string;
  fields: string[];
  orderByField?: string;
  limitCount?: number;
  whereClauses?: { field: string; op: WhereFilterOp; value: any }[];
}

/* ─── Export Configurations ────────────────────────────────────────────────────── */

const EXPORT_CONFIGS: ExportConfig[] = [
  // ── Vendors & Restaurants ──
  {
    id: "tenants",
    label: "All Restaurants",
    description: "Complete list of all restaurant tenants with subscription details, contact info, and onboarding status",
    collection: "restaurants",
    icon: Building2,
    color: "text-primary",
    bgColor: "bg-primary/10",
    category: "Vendors",
    fields: ["name", "email", "phone", "state", "district", "city", "address", "gstNumber", "fssaiNumber", "subscriptionStatus", "subscriptionType", "subscriptionEndDate", "commissionRate", "isBlocked", "createdAt"],
    limitCount: 5000,
  },
  {
    id: "subscriptions",
    label: "Active Subscriptions",
    description: "Currently active and trial subscriptions with billing cycle and plan type",
    collection: "restaurants",
    icon: CreditCard,
    color: "text-emerald-600",
    bgColor: "bg-emerald-500/10",
    category: "Vendors",
    fields: ["name", "email", "phone", "subscriptionType", "subscriptionStatus", "subscriptionEndDate", "createdAt"],
    limitCount: 5000,
    whereClauses: [{ field: "subscriptionStatus", op: "in", value: ["active", "trial"] }],
  },

  // ── Orders ──
  {
    id: "orders",
    label: "All Orders",
    description: "Complete order history with amounts, status, payment method, and customer info",
    collection: "orders",
    icon: ShoppingCart,
    color: "text-blue-600",
    bgColor: "bg-blue-500/10",
    category: "Orders",
    fields: ["orderNumber", "restaurantId", "customerName", "customerPhone", "type", "status", "total", "subtotal", "deliveryFee", "discount", "paymentMethod", "paymentStatus", "createdAt"],
    limitCount: 5000,
  },

  // ── Finance ──
  {
    id: "settlements",
    label: "Vendor Settlements",
    description: "All settlement cycles with gross sales, deductions, TDS/TCS, and net payout amounts",
    collection: "vendor_settlements",
    icon: Wallet,
    color: "text-green-600",
    bgColor: "bg-green-500/10",
    category: "Finance",
    fields: ["restaurantName", "restaurantId", "periodStart", "periodEnd", "orderCount", "grossSales", "refundOffsets", "commissionRate", "commissionAmount", "gatewayFee", "tdsAmount", "tcsAmount", "adDeductions", "adjustmentsTotal", "netPayout", "status", "generatedBy", "createdAt"],
    limitCount: 5000,
  },
  {
    id: "payout_requests",
    label: "Rider Payout Requests",
    description: "Rider payout withdrawal requests with UPI ID, amounts, and processing status",
    collection: "payout_requests",
    icon: Receipt,
    color: "text-teal-600",
    bgColor: "bg-teal-500/10",
    category: "Finance",
    fields: ["riderUid", "riderName", "amount", "upiId", "status", "createdAt", "paidAt", "settledBy"],
    limitCount: 2000,
  },

  // ── Delivery ──
  {
    id: "riders",
    label: "Delivery Riders",
    description: "All registered riders with vehicle details, earnings, KYC documents, and approval status",
    collection: "delivery_users",
    icon: Bike,
    color: "text-orange-600",
    bgColor: "bg-orange-500/10",
    category: "Delivery",
    fields: ["name", "phone", "email", "vehicleType", "vehicleNumber", "aadhaarNumber", "panNumber", "status", "isOnline", "lifetimeDeliveries", "paidOut", "cashInHand", "createdAt"],
    limitCount: 5000,
  },

  // ── Customers ──
  {
    id: "consumers",
    label: "Platform Customers",
    description: "All registered customers with contact info, order counts, and lifetime value",
    collection: "consumers",
    icon: Users,
    color: "text-indigo-600",
    bgColor: "bg-indigo-500/10",
    category: "Customers",
    fields: ["name", "email", "phone", "orderCount", "totalSpent", "lastOrderAt", "createdAt"],
    limitCount: 5000,
  },

  // ── Gift Cards ──
  {
    id: "gift_cards",
    label: "Gift Cards",
    description: "All issued gift cards with codes, balances, redemption status, and expiry dates",
    collection: "gift_cards",
    icon: Gift,
    color: "text-fuchsia-600",
    bgColor: "bg-fuchsia-500/10",
    category: "Gift Cards",
    fields: ["code", "pin", "initialBalance", "balance", "status", "purchaserName", "purchaserEmail", "recipientName", "recipientEmail", "redeemedBy", "createdAt", "expiresAt"],
    limitCount: 5000,
  },

  // ── KadaStay ──
  {
    id: "stay_bookings",
    label: "Stay Bookings",
    description: "All KadaStay reservations with property, guest, dates, and payment details",
    collection: "stay_bookings",
    icon: Hotel,
    color: "text-cyan-600",
    bgColor: "bg-cyan-500/10",
    category: "KadaStay",
    fields: ["propertyName", "guestName", "guestEmail", "guestPhone", "checkIn", "checkOut", "guests", "totalAmount", "status", "paymentStatus", "createdAt"],
    limitCount: 2000,
  },

  // ── Support ──
  {
    id: "support",
    label: "Support Tickets",
    description: "All support tickets with subject, priority, resolution time, and status",
    collection: "support_tickets",
    icon: MessageSquare,
    color: "text-sky-600",
    bgColor: "bg-sky-500/10",
    category: "Support",
    fields: ["restaurantName", "subject", "category", "priority", "status", "assignedTo", "createdAt", "resolvedAt"],
    orderByField: "createdAt",
    limitCount: 2000,
  },

  // ── Sales ──
  {
    id: "demos",
    label: "Demo Requests / Leads",
    description: "All sales leads and demo bookings with restaurant name, revenue, city, and funnel status",
    collection: "demo_requests",
    icon: CalendarClock,
    color: "text-amber-600",
    bgColor: "bg-amber-500/10",
    category: "Sales",
    fields: ["restaurantName", "ownerName", "email", "phone", "city", "monthlyRevenue", "outlets", "currentPos", "status", "source", "createdAt"],
    limitCount: 2000,
  },

  // ── Compliance ──
  {
    id: "kyc",
    label: "KYC Documents",
    description: "Identity and compliance documents submitted by restaurants during onboarding",
    collection: "kyc_documents",
    icon: FileCheck2,
    color: "text-violet-600",
    bgColor: "bg-violet-500/10",
    category: "Compliance",
    fields: ["restaurantName", "restaurantId", "documentType", "documentNumber", "status", "submittedAt", "verifiedAt"],
    limitCount: 2000,
  },

  // ── Notifications ──
  {
    id: "broadcasts",
    label: "Broadcast History",
    description: "All push notification broadcasts sent with audience, delivery count, and timestamp",
    collection: "admin_notifications",
    icon: Megaphone,
    color: "text-rose-600",
    bgColor: "bg-rose-500/10",
    category: "Communications",
    fields: ["title", "body", "audience", "recipientCount", "pushed", "status", "sentAt"],
    limitCount: 1000,
  },

  // ── Audit ──
  {
    id: "audit",
    label: "Activity / Audit Log",
    description: "Immutable audit trail of all admin actions — who did what, when, and to which entity",
    collection: "audit_events",
    icon: ScrollText,
    color: "text-muted-foreground",
    bgColor: "bg-slate-500/10",
    category: "Security",
    fields: ["action", "entity", "entityId", "description", "actorEmail", "reason", "timestamp"],
    limitCount: 5000,
  },

  // ── Reviews ──
  {
    id: "reviews",
    label: "Customer Reviews",
    description: "All customer reviews and ratings submitted across platform restaurants",
    collection: "stay_reviews",
    icon: Star,
    color: "text-yellow-600",
    bgColor: "bg-yellow-500/10",
    category: "Reviews",
    fields: ["propertyName", "guestName", "rating", "comment", "createdAt"],
    limitCount: 2000,
  },
];

const CATEGORY_ORDER = ["Vendors", "Orders", "Finance", "Delivery", "Customers", "Gift Cards", "KadaStay", "Support", "Sales", "Compliance", "Communications", "Security", "Reviews"];

/* ─── Helpers ─────────────────────────────────────────────────────────────────── */

const formatValue = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "object" && "toDate" in (val as object)) {
    return (val as { toDate: () => Date }).toDate().toLocaleString("en-IN");
  }
  if (val instanceof Date) return val.toLocaleString("en-IN");
  if (Array.isArray(val)) return val.join("; ");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
};

/* ─── Component ───────────────────────────────────────────────────────────────── */

export default function ExportsPage() {
  const { user } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [exportLog, setExportLog] = useState<{ id: string; label: string; count: number; time: string }[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  // ── Group configs by category ──
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = EXPORT_CONFIGS.filter((c) => {
      if (activeCategory !== "all" && c.category !== activeCategory) return false;
      if (q && !c.label.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q) && !c.category.toLowerCase().includes(q)) return false;
      return true;
    });
    const map = new Map<string, ExportConfig[]>();
    filtered.forEach((c) => {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    });
    return [...map.entries()].sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [search, activeCategory]);

  const categories = useMemo(() => {
    const cats = new Set(EXPORT_CONFIGS.map((c) => c.category));
    return [...cats].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }, []);

  const handleExport = async (config: ExportConfig) => {
    setDownloading(config.id);
    try {
      let snapshot;
      try {
        const constraints: any[] = [];
        if (config.whereClauses) {
          config.whereClauses.forEach((c) => constraints.push(where(c.field, c.op, c.value)));
        }
        if (config.orderByField) {
          constraints.push(orderBy(config.orderByField, "desc"));
        }
        constraints.push(limit(config.limitCount || 2000));
        snapshot = await getDocs(query(collection(db, config.collection), ...constraints));
      } catch {
        const fallback: any[] = [];
        if (config.whereClauses) {
          config.whereClauses.forEach((c) => fallback.push(where(c.field, c.op, c.value)));
        }
        fallback.push(limit(config.limitCount || 2000));
        snapshot = await getDocs(query(collection(db, config.collection), ...fallback));
      }

      // Build CSV with all available fields (not just predefined)
      const allDocs = snapshot.docs.map((doc) => doc.data());
      const headers = config.fields;
      const rows = allDocs.map((data) => headers.map((field) => formatValue(data[field])));

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      // BOM for Excel compatibility
      const bom = "\uFEFF";
      const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kada-${config.id}-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Log the export
      await addDoc(collection(db, "admin_logs"), {
        action: "export_data",
        description: `Exported ${snapshot.size} records of ${config.label}`,
        entity: config.collection,
        adminEmail: user?.email || "Unknown Admin",
        performedBy: user?.uid || "unknown",
        timestamp: new Date(),
      }).catch(() => {});

      setCompleted((prev) => new Set([...prev, config.id]));
      setExportLog((prev) => [
        { id: config.id, label: config.label, count: snapshot.size, time: new Date().toLocaleTimeString("en-IN") },
        ...prev,
      ]);
      toast.success(`${config.label} — ${snapshot.size} records exported`);

      setTimeout(() => {
        setCompleted((prev) => {
          const next = new Set(prev);
          next.delete(config.id);
          return next;
        });
      }, 4000);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error(`Failed to export ${config.label}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleExportAll = async () => {
    for (const config of EXPORT_CONFIGS) {
      await handleExport(config);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Data exports"
        description={`${EXPORT_CONFIGS.length} datasets — vendors, orders, settlements, riders, customers and more — as CSV files that open cleanly in Excel.`}
        icon={Database}
        actions={
          <Button onClick={handleExportAll} disabled={!!downloading} variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export All
          </Button>
        }
      />

      {/* ── Category Filter Bar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setActiveCategory("all")}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all shrink-0",
              activeCategory === "all"
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-card text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground",
            )}
          >
            All ({EXPORT_CONFIGS.length})
          </button>
          {categories.map((cat) => {
            const count = EXPORT_CONFIGS.filter((c) => c.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all shrink-0",
                  activeCategory === cat
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-card text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground",
                )}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
        <Input
          placeholder="Search exports…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 ml-auto"
        />
      </div>

      {/* ── Export Cards by Category ── */}
      {grouped.map(([category, configs]) => (
        <div key={category} className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{category}</h2>
            <div className="flex-1 h-px bg-border/60" />
            <Badge variant="secondary" className="text-[10px]">{configs.length} exports</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {configs.map((config) => {
              const Icon = config.icon;
              const isDownloading = downloading === config.id;
              const isDone = completed.has(config.id);
              return (
                <Card
                  key={config.id}
                  className={cn(
                    "border-border/60 hover:border-border transition-all group cursor-pointer",
                    isDone && "border-emerald-500/40 bg-emerald-500/5",
                  )}
                  onClick={() => !downloading && handleExport(config)}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center transition-colors", config.bgColor)}>
                          <Icon className={cn("h-5 w-5", config.color)} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{config.label}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{config.collection}</p>
                        </div>
                      </div>
                      {isDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0 mt-1" />
                      ) : isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-1" />
                      ) : (
                        <Download className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary shrink-0 mt-1 transition-colors" />
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">{config.description}</p>

                    <div className="flex flex-wrap gap-1">
                      {config.fields.slice(0, 5).map((field) => (
                        <Badge key={field} variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                          {field}
                        </Badge>
                      ))}
                      {config.fields.length > 5 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          +{config.fields.length - 5}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-border/40">
                      <span className="text-[10px] text-muted-foreground">
                        Up to {(config.limitCount || 2000).toLocaleString("en-IN")} records
                      </span>
                      <span className="text-[10px] font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        Click to export →
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {grouped.length === 0 && (
        <Card className="border-border/60">
          <CardContent className="py-16 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No exports match your search.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Session Export History ── */}
      {exportLog.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Export History (this session)
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{exportLog.length} exports</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {exportLog.map((log, i) => (
                <div key={`${log.id}-${i}`} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/40 text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="font-medium">{log.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{log.count.toLocaleString("en-IN")} records</span>
                    <span className="tabular-nums">{log.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Info Footer ── */}
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Export Guidelines & Compliance</p>
              <p>All exports are UTF-8 CSV with BOM for Excel / Google Sheets compatibility.</p>
              <p>Exports are capped at 5,000 records per download. For larger dumps, contact engineering.</p>
              <p>Every export action is recorded in the Activity Log with your admin email and timestamp.</p>
              <p>Exported data may contain PII. Handle in accordance with your data protection policy.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
