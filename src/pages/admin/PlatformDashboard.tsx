import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  collection,
  getCountFromServer,
  onSnapshot,
  query,
  limit,
  Timestamp,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { usePricing } from "@/hooks/usePricing";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Building2,
  Hotel,
  CreditCard,
  HeartHandshake,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Activity,
  Ban,
  Bike,
  CheckCircle2,
  AlertCircle,
  Gauge,
  RefreshCw,
  ShoppingBag,
  Users,
  Wallet,
  PackageSearch,
  UserCheck,
  ChefHat,
  Truck,
  XCircle,
  RotateCcw,
  Store,
  Utensils,
  Calendar as CalendarIcon,
  CalendarRange,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useCurrency } from "@/lib/currency";
import { isOnlineOrder } from "@/lib/orderChannels";
import { AttentionRequired } from "@/components/admin/AttentionRequired";
import { StatCards } from "@/components/admin/StatCards";
import { OpsAlerts } from "@/components/admin/ops/OpsAlerts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TimeRangePreset = "today" | "yesterday" | "7d" | "30d" | "this_month" | "all" | "custom";

interface Restaurant {
  id: string;
  subscriptionStatus?: string;
  subscriptionType?: "monthly" | "yearly" | "custom" | string;
  /** Plan id written by the web checkout; planTier is the older admin field. */
  subscriptionPlan?: string;
  planTier?: string;
  billingModel?: "commission" | "subscription";
  isOutlet?: boolean;
  subscriptionEndDate?: any;
  customPlanPrice?: number;
  isBlocked?: boolean;
  isVerified?: boolean;
  countryCode?: string;
  dialCode?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezone?: string;
  locale?: string;
  taxConfiguration?: any[];
  district?: string;
  city?: string;
  createdAt?: { toDate: () => Date } | string | number | null;
  isDeleted?: boolean;
}

interface AdminLog {
  id: string;
  action?: string;
  description?: string;
  performedBy?: string;
  adminEmail?: string;
  timestamp?: { toDate: () => Date } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeAgo(timestamp: { toDate: () => Date } | null | undefined): string {
  if (!timestamp) return "just now";
  try {
    const date = timestamp.toDate();
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  } catch {
    return "just now";
  }
}

function formatCurrency(amt: number, symbol: string, locale: string): string {
  if (locale === "en-IN") {
    if (amt >= 100000) return `${symbol}${(amt / 100000).toFixed(1)}L`;
    if (amt >= 1000) return `${symbol}${(amt / 1000).toFixed(1)}K`;
  } else {
    if (amt >= 1000000) return `${symbol}${(amt / 1000000).toFixed(1)}M`;
    if (amt >= 1000) return `${symbol}${(amt / 1000).toFixed(1)}K`;
  }
  return `${symbol}${amt.toLocaleString(locale)}`;
}

function getMonthLabel(date: Date, locale: string): string {
  return date.toLocaleString(locale, { month: "short", year: "2-digit" });
}

const MONTHS_TO_SHOW = 6;
const MIX_COLORS = {
  subscribed: "#10b981", // emerald-500
  commission: "#14b8a6", // teal-500
  pending: "#38bdf8",    // sky-400
  lapsed: "#f59e0b",     // amber-500
  trial: "#a78bfa",      // violet-400 — legacy docs only
};

/** Subscribed means paid up today — an "active" doc past its end date is not. */
function isSubscribedNow(r: Restaurant): boolean {
  if (r.isBlocked || r.subscriptionStatus !== "active") return false;
  const end: any = r.subscriptionEndDate;
  const ms = end?.toMillis ? end.toMillis() : end?.seconds ? end.seconds * 1000 : end ? new Date(end).getTime() : NaN;
  return !Number.isFinite(ms) || ms > Date.now();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Activity rows are written by many code paths; some store a readable
 * description, others only a machine action like
 * "adminPlatformAction:transitionOnboarding". Show the latter as words.
 */
function humanizeLog(log: AdminLog): string {
  const raw = (log.description || log.action || "").trim();
  if (!raw) return "Admin action performed";
  if (/\s/.test(raw)) return raw; // already a sentence
  const action = raw.includes(":") ? raw.split(":").pop()! : raw;
  const words = action
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ─── Top-list card (Most Popular Restaurants / Foods / Customers) ─────────────
function TopListCard({
  title,
  icon: Icon,
  rows,
  suffix,
  empty,
  onView,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  rows: { name: string; count: number }[];
  suffix: string;
  empty: string;
  onView?: () => void;
}) {
  return (
    <Card className="border-border/40 rounded-2xl">
      <CardHeader className="pb-2 border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {title}
          </CardTitle>
          {onView && (
            <button onClick={onView} className="shrink-0 whitespace-nowrap text-xs font-medium text-primary hover:underline">
              View all
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8 font-medium">{empty}</p>
        ) : (
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div key={r.name} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-muted/40">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-muted text-[11px] font-bold text-muted-foreground shrink-0">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">{r.name}</span>
                <span className="text-xs font-bold text-foreground shrink-0">
                  {r.count} <span className="font-medium text-muted-foreground">{suffix}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Order lifecycle buckets for the pulse KPIs.
const LIVE_STATUSES = new Set([
  "new", "pending", "confirmed", "accepted", "preparing", "cooking",
  "in_progress", "inprogress", "ready", "prepared", "assigned",
  "out_for_delivery", "dispatched", "on_the_way", "picked_up",
]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "rejected"]);

interface MarketOrder {
  status?: string;
  deliveryStatus?: string;
  paymentStatus?: string;
  total?: number;
  restaurantName?: string;
  customerName?: string;
  riderName?: string;
  deliveryPartnerName?: string;
  items?: Array<{ name?: string; title?: string; quantity?: number; qty?: number }>;
  timestamp?: any;
  /** Acquisition channel — used to exclude walk-in/QR from marketplace metrics. */
  orderSource?: string;
}

export default function PlatformDashboard() {
  const { plans } = usePricing();
  const { symbol, locale } = useCurrency();
  const navigate = useNavigate();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [escalatedChats, setEscalatedChats] = useState(0);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Time range filter state ────────────────────────────────────────────────
  const [timeRange, setTimeRange] = useState<TimeRangePreset>("today");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [tempStart, setTempStart] = useState<string>("");
  const [tempEnd, setTempEnd] = useState<string>("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  // ── Real-time: restaurants ─────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, "restaurants"), limit(2000));
    return onSnapshot(
      q,
      (snap) => {
        setRestaurants(
          snap.docs.filter((d) => !d.data().isDeleted).map((d) => ({ id: d.id, ...(d.data() as Omit<Restaurant, "id">) }))
        );
        setLastUpdated(new Date());
        setLoadingRestaurants(false);
      },
      (err) => {
        console.error("restaurants snapshot error:", err);
        setLoadingRestaurants(false);
      }
    );
  }, []);

  // ── Compute date bounds for selected time range ───────────────────────────
  const dateBounds = useMemo(() => {
    const now = new Date();
    if (timeRange === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (timeRange === "yesterday") {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (timeRange === "7d") {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (timeRange === "30d") {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (timeRange === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (timeRange === "custom" && customStart && customEnd) {
      const start = new Date(`${customStart}T00:00:00`);
      const end = new Date(`${customEnd}T23:59:59.999`);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        return { start, end };
      }
    }
    if (timeRange === "all") {
      return null;
    }
    const defaultStart = new Date(now);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(now);
    defaultEnd.setHours(23, 59, 59, 999);
    return { start: defaultStart, end: defaultEnd };
  }, [timeRange, customStart, customEnd]);

  // Display label for subheadings and active indicators
  const rangeDisplayLabel = useMemo(() => {
    if (timeRange === "all") return "All Time";
    if (timeRange === "today") return "Today";
    if (timeRange === "yesterday") return "Yesterday";
    if (timeRange === "7d") return "Last 7 Days";
    if (timeRange === "30d") return "Last 30 Days";
    if (timeRange === "this_month") return "This Month";
    if (dateBounds) {
      const s = dateBounds.start.toLocaleDateString(locale, { month: "short", day: "numeric" });
      const e = dateBounds.end.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
      return `${s} – ${e}`;
    }
    return "Custom Range";
  }, [timeRange, dateBounds, locale]);

  // ── Real-time: filtered marketplace orders (pulse KPIs) ───────────────────
  const [periodOrders, setPeriodOrders] = useState<MarketOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ridersOnline, setRidersOnline] = useState<number | null>(null);
  const [ridersTotal, setRidersTotal] = useState<number | null>(null);
  const [customersCount, setCustomersCount] = useState<number | null>(null);
  const [hotelsCount, setHotelsCount] = useState<number | null>(null);

  useEffect(() => {
    setLoadingOrders(true);
    let q;
    if (dateBounds) {
      q = query(
        collection(db, "orders"),
        where("timestamp", ">=", Timestamp.fromDate(dateBounds.start)),
        where("timestamp", "<=", Timestamp.fromDate(dateBounds.end)),
        limit(4000)
      );
    } else {
      q = query(collection(db, "orders"), limit(4000));
    }

    return onSnapshot(
      q,
      (snap) => {
        setPeriodOrders(snap.docs.map((d) => d.data() as MarketOrder));
        setLastUpdated(new Date());
        setLoadingOrders(false);
        setIsRefreshing(false);
      },
      (err) => {
        console.error("orders snapshot error:", err);
        setLoadingOrders(false);
        setIsRefreshing(false);
      }
    );
  }, [dateBounds]);

  // One-shot aggregate counts (cheap server-side count, no doc reads).
  useEffect(() => {
    getCountFromServer(
      query(collection(db, "delivery_users"), where("isOnline", "==", true))
    )
      .then((s) => setRidersOnline(s.data().count))
      .catch((err) => console.error("riders count error:", err));
    getCountFromServer(collection(db, "customer_users"))
      .then((s) => setCustomersCount(s.data().count))
      .catch((err) => console.error("customers count error:", err));
    getCountFromServer(collection(db, "delivery_users"))
      .then((s) => setRidersTotal(s.data().count))
      .catch((err) => console.error("riders total count error:", err));
    getCountFromServer(collection(db, "hotels"))
      .then((s) => setHotelsCount(s.data().count))
      .catch((err) => console.error("hotels count error:", err));
  }, []);

  // ── User-mix donut (customers / stores / riders) ───────────────────────────
  const userStats = useMemo(() => {
    const c = customersCount ?? 0;
    const st = restaurants.length;
    const r = ridersTotal ?? 0;
    const h = hotelsCount ?? 0;
    const data = [
      { name: "Customers", value: c, color: "#0d9488" },
      { name: "Vendor outlets", value: st, color: "#6366f1" },
      { name: "Riders", value: r, color: "#f97316" },
      { name: "Stay properties", value: h, color: "#f59e0b" },
    ].filter((d) => d.value > 0);
    return { data, total: c + st + r + h };
  }, [customersCount, restaurants.length, ridersTotal, hotelsCount]);

  // Marketplace-only slice. Platform GMV, order counts and every headline
  // metric MUST exclude walk-in POS (`orderSource: pos`) and QR-menu orders —
  // those are the vendor's own in-store revenue that just flows through
  // Kada's POS, and folding them into GMV corrupts commission, take-rate and
  // growth reporting. See src/lib/orderChannels.ts for the canonical
  // classification.
  const marketplaceOrders = useMemo(
    () => periodOrders.filter(isOnlineOrder),
    [periodOrders],
  );

  const pulse = useMemo(() => {
    const count = marketplaceOrders.length;
    let gmv = 0;
    let live = 0;
    let cancelled = 0;
    for (const o of marketplaceOrders) {
      const st = (o.status ?? "").toLowerCase();
      if (LIVE_STATUSES.has(st)) live++;
      if (CANCELLED_STATUSES.has(st)) cancelled++;
      if (typeof o.total === "number") gmv += o.total;
    }
    return {
      live,
      count,
      gmv,
      aov: count > 0 ? gmv / count : 0,
      cancelRate: count > 0 ? (cancelled / count) * 100 : 0,
    };
  }, [marketplaceOrders]);

  // ── 6amMart-style order-status grid (period operational snapshot) ──────────
  // Marketplace only — the vendor's in-store POS lifecycle is a different
  // pipeline (immediate cash / QR) and shouldn't dilute delivered / cooking
  // / out-for-delivery counts.
  const orderStatus = useMemo(() => {
    const s = {
      unassigned: 0, accepted: 0, cooking: 0, out: 0,
      delivered: 0, canceled: 0, refunded: 0, failed: 0,
    };
    for (const o of marketplaceOrders) {
      const st = (o.status ?? "").toLowerCase();
      const ds = (o.deliveryStatus ?? "").toLowerCase();
      const ps = (o.paymentStatus ?? "").toLowerCase();
      // Orthogonal flags.
      if (ps === "failed") s.failed++;
      if (st === "refunded" || ps === "refunded") s.refunded++;
      // Mutually-exclusive lifecycle bucket.
      if (CANCELLED_STATUSES.has(st) || ds === "cancelled") s.canceled++;
      else if (st === "completed" || ds === "delivered") s.delivered++;
      else if (["out_for_delivery", "picked_up", "on_the_way", "dispatched"].includes(ds)) s.out++;
      else if (["accepted", "assigned"].includes(ds)) s.accepted++;
      else if (["preparing", "cooking", "confirmed", "ready", "prepared"].includes(st)) s.cooking++;
      else s.unassigned++;
    }
    return s;
  }, [marketplaceOrders]);

  // ── Top performers (selected period) ───────────────────────────────────────
  // Marketplace only — "Top Customers" listing walk-in guests would leak PII
  // for a demographic the marketplace never actually acquired, and "Top
  // Riders" is meaningless for walk-in orders that never get dispatched.
  const topLists = useMemo(() => {
    const rest: Record<string, number> = {};
    const cust: Record<string, number> = {};
    const rider: Record<string, number> = {};
    const food: Record<string, number> = {};
    for (const o of marketplaceOrders) {
      if (o.restaurantName) rest[o.restaurantName] = (rest[o.restaurantName] || 0) + 1;
      if (o.customerName && o.customerName !== "Guest")
        cust[o.customerName] = (cust[o.customerName] || 0) + 1;
      const rn = o.riderName || o.deliveryPartnerName;
      if (rn) rider[rn] = (rider[rn] || 0) + 1;
      for (const it of o.items ?? []) {
        const nm = it.name || it.title;
        const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
        if (nm) food[nm] = (food[nm] || 0) + qty;
      }
    }
    const top = (m: Record<string, number>) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, count]) => ({ name, count }));
    return { restaurants: top(rest), customers: top(cust), riders: top(rider), foods: top(food) };
  }, [marketplaceOrders]);

  // ── Real-time: Kada Assist chats waiting on a human ─────────────────────
  // support_threads is the one support system (the old support_tickets flow
  // was folded into it), so this is the number the support team works from.
  useEffect(() => {
    const q = query(
      collection(db, "support_threads"),
      where("status", "==", "escalated"),
      limit(500)
    );
    return onSnapshot(
      q,
      (snap) => {
        setEscalatedChats(snap.size);
        setLoadingTickets(false);
      },
      (err) => {
        console.error("support threads snapshot error:", err);
        setLoadingTickets(false);
      }
    );
  }, []);

  // ── Real-time: admin activity logs ────────────────────────────────────────
  useEffect(() => {
    return listenCollection<AdminLog>(
      "admin_logs",
      { orderByField: "timestamp", limit: 20 },
      (rows) => {
        setLogs(rows);
        setLoadingLogs(false);
      },
      () => setLoadingLogs(false),
    );
  }, []);

  // ── Derived KPIs ───────────────────────────────────────────────────────────
  // Brands, not outlet docs — the same count the Vendors directory shows.
  const vendors = useMemo(() => restaurants.filter((r) => !r.isOutlet), [restaurants]);

  const kpis = useMemo(() => {
    const totalVendors = vendors.length;
    const outlets = restaurants.length - vendors.length;
    const subscribed = vendors.filter(isSubscribedNow);

    // MRR at each vendor's own plan and cadence. annualPrice is the effective
    // per-month price when billed yearly (functions/src/planCatalog.ts).
    const priceOf = (planId: string, cadence: "monthly" | "yearly") => {
      const plan = plans.find((p) => p.id === planId);
      const v = cadence === "yearly" ? plan?.annualPrice : plan?.monthlyPrice;
      return typeof v === "number" ? v : 0;
    };
    let mrr = 0;
    for (const r of subscribed) {
      if (r.subscriptionType === "custom") mrr += r.customPlanPrice || 0;
      else mrr += priceOf(r.subscriptionPlan || r.planTier || "starter", r.subscriptionType === "yearly" ? "yearly" : "monthly");
    }

    return { totalVendors, outlets, activeSubscriptions: subscribed.length, mrr };
  }, [vendors, restaurants.length, plans]);

  // ── Tenant growth chart data (last 6 months) ───────────────────────────────
  const tenantGrowthData = useMemo(() => {
    const now = new Date();
    const buckets: Record<string, number> = {};

    for (let i = MONTHS_TO_SHOW - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets[getMonthLabel(d, locale)] = 0;
    }

    restaurants.forEach((r) => {
      let date: Date | null = null;
      if (r.createdAt) {
        if (typeof (r.createdAt as any).toDate === "function") {
          date = (r.createdAt as any).toDate();
        } else if (typeof r.createdAt === "string" || typeof r.createdAt === "number") {
          date = new Date(r.createdAt);
        }
      }
      if (!date || isNaN(date.getTime())) return;
      const label = getMonthLabel(date, locale);
      if (label in buckets) {
        buckets[label] = (buckets[label] || 0) + 1;
      }
    });

    return Object.entries(buckets).map(([month, count]) => ({ month, signups: count }));
  }, [restaurants, locale]);

  // ── Billing mix pie data ───────────────────────────────────────────────────
  // Same buckets as the Vendors directory tabs.
  const subscriptionMixData = useMemo(() => {
    const counts = { subscribed: 0, commission: 0, pending: 0, lapsed: 0, trial: 0 };
    vendors.forEach((r) => {
      if (r.isBlocked) return;
      const st = r.subscriptionStatus;
      if (isSubscribedNow(r)) counts.subscribed++;
      else if (st === "trial") counts.trial++;
      else if (r.billingModel !== "subscription" && st !== "active" && st !== "grace_period") counts.commission++;
      else if (!st || st === "pending") counts.pending++;
      else counts.lapsed++;
    });
    return [
      { name: "Subscribed", value: counts.subscribed, color: MIX_COLORS.subscribed },
      { name: "Commission", value: counts.commission, color: MIX_COLORS.commission },
      { name: "Pending", value: counts.pending, color: MIX_COLORS.pending },
      { name: "Lapsed", value: counts.lapsed, color: MIX_COLORS.lapsed },
      { name: "Trial (legacy)", value: counts.trial, color: MIX_COLORS.trial },
    ].filter((d) => d.value > 0);
  }, [vendors]);

  // ── Top 5 locations ────────────────────────────────────────────────────────
  const topLocations = useMemo(() => {
    const map: Record<string, number> = {};
    restaurants.forEach((r) => {
      const loc = r.district || r.city || "Unknown";
      map[loc] = (map[loc] || 0) + 1;
    });
    const total = restaurants.length || 1;
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }));
  }, [restaurants]);

  const loading = loadingRestaurants || loadingTickets;

  // ── Last updated display ───────────────────────────────────────────────────
  const lastUpdatedStr = lastUpdated.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="space-y-6 pb-8">
      {/* ── Page Header & Time Selector ───────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-2 border-b border-border/40">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              Dashboard
            </h1>
            <Button size="sm" onClick={() => navigate("/admin/orders?tab=live")} className="gap-1.5 h-7 text-xs rounded-full px-3 shadow-sm">
              <Activity className="h-3.5 w-3.5" />
              Live Operations
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live marketplace health, partners and support. The period selector applies to order figures.
          </p>
        </div>

        {/* Time Selector Controls + Last updated */}
        <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap xl:shrink-0">
          {/* Preset Buttons */}
          <div className="inline-flex items-center p-1 bg-muted/60 border border-border/40 rounded-xl shadow-xs">
            {(
              [
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "7d", label: "7D" },
                { id: "30d", label: "30D" },
                { id: "this_month", label: "This Month" },
                { id: "all", label: "All" },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setTimeRange(preset.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  timeRange === preset.id
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range Popover */}
          <Popover open={isCustomOpen} onOpenChange={setIsCustomOpen}>
            <PopoverTrigger asChild>
              <Button
                variant={timeRange === "custom" ? "default" : "outline"}
                size="sm"
                className={`h-9 px-3 text-xs gap-1.5 rounded-xl border-border/40 font-medium ${
                  timeRange === "custom" ? "" : "text-muted-foreground hover:text-foreground bg-muted/30"
                }`}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                <span>{timeRange === "custom" ? rangeDisplayLabel : "Custom"}</span>
                <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-4 rounded-2xl space-y-4 shadow-xl border-border/60">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Select Custom Date Range</span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="custom-start" className="text-xs font-medium text-muted-foreground">
                    Start Date
                  </Label>
                  <Input
                    id="custom-start"
                    type="date"
                    value={tempStart || customStart}
                    onChange={(e) => setTempStart(e.target.value)}
                    className="h-9 text-xs rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="custom-end" className="text-xs font-medium text-muted-foreground">
                    End Date
                  </Label>
                  <Input
                    id="custom-end"
                    type="date"
                    value={tempEnd || customEnd}
                    onChange={(e) => setTempEnd(e.target.value)}
                    className="h-9 text-xs rounded-lg"
                  />
                </div>
              </div>

              {/* Quick Preset Shortcuts inside Popover */}
              <div className="pt-2 border-t border-border/40">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Quick Shortcuts
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const start = new Date(now);
                      start.setDate(start.getDate() - 14);
                      const sStr = start.toISOString().split("T")[0];
                      const eStr = now.toISOString().split("T")[0];
                      setTempStart(sStr);
                      setTempEnd(eStr);
                    }}
                    className="px-2 py-1 text-[11px] font-medium bg-muted/60 hover:bg-muted rounded-md text-foreground text-center transition-colors"
                  >
                    Last 14D
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const start = new Date(now);
                      start.setDate(start.getDate() - 60);
                      const sStr = start.toISOString().split("T")[0];
                      const eStr = now.toISOString().split("T")[0];
                      setTempStart(sStr);
                      setTempEnd(eStr);
                    }}
                    className="px-2 py-1 text-[11px] font-medium bg-muted/60 hover:bg-muted rounded-md text-foreground text-center transition-colors"
                  >
                    Last 60D
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      const start = new Date(now);
                      start.setDate(start.getDate() - 90);
                      const sStr = start.toISOString().split("T")[0];
                      const eStr = now.toISOString().split("T")[0];
                      setTempStart(sStr);
                      setTempEnd(eStr);
                    }}
                    className="px-2 py-1 text-[11px] font-medium bg-muted/60 hover:bg-muted rounded-md text-foreground text-center transition-colors"
                  >
                    Last 90D
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTempStart("");
                    setTempEnd("");
                    setCustomStart("");
                    setCustomEnd("");
                    setTimeRange("today");
                    setIsCustomOpen(false);
                  }}
                  className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (tempStart && tempEnd) {
                      setCustomStart(tempStart);
                      setCustomEnd(tempEnd);
                      setTimeRange("custom");
                      setIsCustomOpen(false);
                    }
                  }}
                  disabled={!tempStart || !tempEnd}
                  className="h-8 text-xs font-semibold px-4"
                >
                  Apply Range
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Active Window & Refresh */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 border border-border/40 rounded-xl px-3 py-1.5">
            <button
              type="button"
              onClick={() => {
                setIsRefreshing(true);
                setLastUpdated(new Date());
                setTimeout(() => setIsRefreshing(false), 500);
              }}
              title="Refresh data"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing || loadingOrders ? "animate-spin text-primary" : ""}`} />
              <span className="text-[11px]">{lastUpdatedStr}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Attention Required — actionable operational alerts (Command Center) ─ */}
      {/* Server-detected failures — stalled orders, failed payment webhooks,
          unzoned vendors, cash build-ups. Precomputed every 30 minutes. */}
      <OpsAlerts />

      <AttentionRequired />

      {/* ── Marketplace pulse — every card drills down ───────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Marketplace · {rangeDisplayLabel}
        </h2>
        <StatCards
          loading={loadingOrders}
          items={[
            {
              label: "Orders",
              value: pulse.count.toLocaleString(locale),
              hint: "Online orders only",
              icon: ShoppingBag,
              onClick: () => navigate("/admin/orders"),
            },
            {
              label: "GMV",
              value: formatCurrency(pulse.gmv, symbol, locale),
              hint: "Excludes walk-in and QR",
              icon: Wallet,
              tone: "text-emerald-600",
              onClick: () => navigate("/admin/analytics"),
            },
            {
              label: "Avg order value",
              value: formatCurrency(pulse.aov, symbol, locale),
              icon: Gauge,
              onClick: () => navigate("/admin/analytics"),
            },
            {
              label: "Cancel rate",
              value: `${pulse.cancelRate.toFixed(1)}%`,
              hint: `${orderStatus.canceled.toLocaleString(locale)} cancelled`,
              icon: Ban,
              tone: pulse.cancelRate > 10 ? "text-rose-600" : "text-amber-600",
              onClick: () => navigate("/admin/orders?status=cancelled"),
            },
            {
              label: "Live now",
              value: pulse.live.toLocaleString(locale),
              hint: "Preparing or on the way",
              icon: Activity,
              tone: "text-primary",
              onClick: () => navigate("/admin/orders?tab=live"),
            },
            {
              label: "Riders online",
              value: ridersOnline === null ? "—" : ridersOnline.toLocaleString(locale),
              hint: ridersTotal === null ? undefined : `of ${ridersTotal.toLocaleString(locale)} riders`,
              icon: Bike,
              tone: "text-emerald-600",
              onClick: () => navigate("/admin/delivery"),
            },
          ]}
        />
      </section>

      {/* ── Order lifecycle (period) — mutually exclusive stages + two flags ──── */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Order status · {rangeDisplayLabel}
        </h2>
        <StatCards
          loading={loadingOrders}
          items={[
            { label: "New / unassigned", value: orderStatus.unassigned.toLocaleString(locale), icon: PackageSearch, tone: "text-amber-600", onClick: () => navigate("/admin/orders?tab=live") },
            { label: "Preparing", value: orderStatus.cooking.toLocaleString(locale), icon: ChefHat, tone: "text-orange-600", onClick: () => navigate("/admin/orders?tab=live") },
            { label: "Rider assigned", value: orderStatus.accepted.toLocaleString(locale), icon: UserCheck, tone: "text-sky-600", onClick: () => navigate("/admin/orders?tab=live") },
            { label: "Out for delivery", value: orderStatus.out.toLocaleString(locale), icon: Truck, tone: "text-indigo-600", onClick: () => navigate("/admin/orders?tab=live") },
            { label: "Delivered", value: orderStatus.delivered.toLocaleString(locale), icon: CheckCircle2, tone: "text-emerald-600", onClick: () => navigate("/admin/orders?status=completed") },
            { label: "Cancelled", value: orderStatus.canceled.toLocaleString(locale), icon: XCircle, tone: "text-rose-600", onClick: () => navigate("/admin/orders?status=cancelled") },
            { label: "Refunded", value: orderStatus.refunded.toLocaleString(locale), icon: RotateCcw, tone: "text-fuchsia-600", onClick: () => navigate("/admin/orders?status=refunded") },
            { label: "Payment failed", value: orderStatus.failed.toLocaleString(locale), icon: AlertCircle, tone: "text-red-600", onClick: () => navigate("/admin/orders") },
          ]}
        />
      </section>

      {/* ── Top performers + user mix (period) ───────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <TopListCard title="Top restaurants" icon={Store} rows={topLists.restaurants} suffix="orders" empty={`No orders for ${rangeDisplayLabel.toLowerCase()}`} onView={() => navigate("/admin/vendors")} />
        <TopListCard title="Top dishes" icon={Utensils} rows={topLists.foods} suffix="sold" empty={`No items sold for ${rangeDisplayLabel.toLowerCase()}`} />
        <TopListCard title="Top customers" icon={Users} rows={topLists.customers} suffix="orders" empty={`No customer orders for ${rangeDisplayLabel.toLowerCase()}`} onView={() => navigate("/admin/customers")} />
        {/* User statistics donut */}
        <Card className="border-border/40 rounded-2xl">
          <CardHeader className="pb-2 border-b border-border/40">
            <CardTitle className="text-sm font-medium text-foreground">Accounts</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="relative">
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={userStats.data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={2} stroke="none">
                    {userStats.data.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-bold text-foreground leading-none">{userStats.total.toLocaleString(locale)}</span>
                <span className="text-[10px] text-muted-foreground">Total Users</span>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {userStats.data.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    {d.name}
                  </span>
                  <span className="font-semibold text-foreground">{d.value.toLocaleString(locale)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Partners & support (not period-scoped) ───────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Partners &amp; support · right now
        </h2>
        <StatCards
          loading={loading}
          items={[
            {
              label: "Vendors",
              value: kpis.totalVendors.toLocaleString(locale),
              hint: kpis.outlets ? `+ ${kpis.outlets.toLocaleString(locale)} outlet${kpis.outlets === 1 ? "" : "s"}` : undefined,
              icon: Building2,
              onClick: () => navigate("/admin/vendors"),
            },
            {
              label: "Subscribed",
              value: kpis.activeSubscriptions.toLocaleString(locale),
              hint: "Paid plan, not expired",
              icon: HeartHandshake,
              tone: "text-emerald-600",
              onClick: () => navigate("/admin/vendors?filter=active"),
            },
            {
              label: "MRR",
              value: formatCurrency(kpis.mrr, symbol, locale),
              hint: "Subscriptions at each vendor's plan",
              icon: CreditCard,
              tone: "text-emerald-600",
              onClick: () => navigate("/admin/vendors?tab=plans"),
            },
            {
              label: "Stay properties",
              value: hotelsCount === null ? "—" : hotelsCount.toLocaleString(locale),
              icon: Hotel,
              onClick: () => navigate("/admin/stay?tab=properties"),
            },
            {
              label: "Customers",
              value: customersCount === null ? "—" : customersCount.toLocaleString(locale),
              hint: "App accounts",
              icon: Users,
              onClick: () => navigate("/admin/customers"),
            },
            {
              label: "Escalated chats",
              value: escalatedChats.toLocaleString(locale),
              hint: "Kada Assist, waiting on a human",
              icon: MessageSquare,
              tone: "text-rose-600",
              onClick: () => navigate("/admin/support?tab=chats"),
            },
          ]}
        />
      </section>

      {/* ── Main content grid: charts (3 cols) + activity feed (1 col) ──────── */}
      <div className="grid grid-cols-1 gap-6">
        {/* ── Charts column (Full Width) ─────────────────────────────────────────────── */}
        <div className="col-span-full space-y-6">
          {/* Tenant Growth AreaChart */}
          <Card className="border-border/40 rounded-2xl">
            <CardHeader className="pb-2 border-b border-border/40">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium text-foreground">
                    Vendor sign-ups
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    New vendor and outlet accounts per month
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs font-normal">
                  Last 6 months
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              {loadingRestaurants ? (
                <Skeleton className="h-56 w-full rounded-xl" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart
                    data={tenantGrowthData}
                    margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
                  >
                    <defs>
                      <linearGradient id="colorSignups" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor="hsl(var(--primary))"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="95%"
                          stopColor="hsl(var(--primary))"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      opacity={0.4}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "10px",
                        fontSize: "12px",
                        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
                      itemStyle={{ color: "hsl(var(--primary))" }}
                      cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="signups"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#colorSignups)"
                      name="New Signups"
                      dot={{ fill: "hsl(var(--primary))", r: 3 }}
                      activeDot={{ r: 5, fill: "hsl(var(--primary))" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Subscription Mix + Top Locations row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Subscription Mix PieChart */}
            <Card className="border-border/40 rounded-2xl">
              <CardHeader className="pb-2 border-b border-border/40">
                <CardTitle className="text-sm font-medium text-foreground">
                  Billing mix
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How vendors pay — same buckets as the Vendors directory
                </p>
              </CardHeader>
              <CardContent className="p-6 pt-4">
                {loadingRestaurants ? (
                  <Skeleton className="h-48 w-full rounded-xl" />
                ) : subscriptionMixData.length === 0 ? (
                  <div className="h-48 flex items-center justify-center">
                    <p className="text-sm text-muted-foreground">No data yet</p>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                      <PieChart width={160} height={160}>
                        <Pie
                          data={subscriptionMixData}
                          cx="50%"
                          cy="50%"
                          innerRadius={46}
                          outerRadius={72}
                          dataKey="value"
                          strokeWidth={2}
                          stroke="hsl(var(--card))"
                        >
                          {subscriptionMixData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "10px",
                            fontSize: "12px",
                          }}
                        />
                      </PieChart>
                    <div className="space-y-2 flex-1">
                      {subscriptionMixData.map((item) => (
                        <div
                          key={item.name}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ background: item.color }}
                            />
                            <span className="text-muted-foreground text-xs">
                              {item.name}
                            </span>
                          </div>
                          <span className="font-medium text-foreground text-xs tabular-nums">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Locations */}
            <Card className="border-border/40 rounded-2xl">
              <CardHeader className="pb-2 border-b border-border/40">
                <CardTitle className="text-sm font-medium text-foreground">
                  Top Locations
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Vendors by city / district
                </p>
              </CardHeader>
              <CardContent className="p-6 pt-4 space-y-3">
                {loadingRestaurants ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-lg" />
                  ))
                ) : topLocations.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No location data
                  </p>
                ) : (
                  topLocations.map(({ name, count, pct }, i) => (
                    <div key={name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-muted-foreground w-4 tabular-nums">
                            {i + 1}
                          </span>
                          <span className="text-xs font-medium text-foreground truncate max-w-[120px]">
                            {name}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {count}
                        </span>
                      </div>
                      <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-primary/70 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>


        </div>

        </div>
          {/* ── Recent Activity ───────────────────────────────────────────────────── */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Recent Activity
        </p>
        <Card className="border-border/40 rounded-2xl">
          <CardContent className="p-4">
            {loadingLogs ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex gap-3 items-start p-3 border border-border/20 rounded-xl">
                    <Skeleton className="h-2 w-2 rounded-full mt-1.5 shrink-0" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No recent activity</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {logs.slice(0, 15).map((log) => (
                  <div key={log.id} className="flex gap-3 items-start p-3 rounded-xl bg-muted/20 hover:bg-muted/40 transition-colors border border-border/30">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-primary/60 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground font-medium leading-snug line-clamp-2">
                        {humanizeLog(log)}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                          {log.performedBy || log.adminEmail || "System"}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 shrink-0 font-mono">
                          {getTimeAgo(log.timestamp ?? null)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
