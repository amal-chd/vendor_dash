import { StatCards } from "@/components/admin/StatCards";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, limit, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isOnlineOrder } from "@/lib/orderChannels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  BarChart3,
  Globe,
  TrendingUp,
  TrendingDown,
  Users,
  Loader2,
  CalendarDays,
  Activity,
  ShieldX,
  Percent,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Restaurant {
  subscriptionStatus?: "active" | "trial" | "paused" | "expired" | "pending";
  subscriptionType?: "monthly" | "yearly" | "trial";
  isBlocked?: boolean;
  countryCode?: string;
  dialCode?: string;
  currencyCode?: string;
  currencySymbol?: string;
  timezone?: string;
  locale?: string;
  taxConfiguration?: any[];
  createdAt?: { seconds: number; nanoseconds: number } | string | number | null;
  subscriptionStartDate?: { seconds: number; nanoseconds: number } | string | number | null;
  subscriptionEndDate?: { seconds: number; nanoseconds: number } | string | number | null;
  isDeleted?: boolean;
  isOutlet?: boolean;
  parentId?: string;
  district?: string;
  city?: string;
  state?: string;
  id?: string;
}

type DateRange = "today" | "7d" | "30d" | "all";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(val: Restaurant["createdAt"]): Date | null {
  if (!val) return null;
  if (typeof val === "object" && "seconds" in val) {
    return new Date(val.seconds * 1000);
  }
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? null : d;
}

function getMonthLabel(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(label: string): string {
  const [year, month] = label.split("-");
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleString("default", { month: "short", year: "2-digit" });
}

function groupByMonth(restaurants: Restaurant[]): { label: string; total: number; active: number }[] {
  const map = new Map<string, { total: number; active: number }>();

  restaurants.forEach((r) => {
    const d = toDate(r.createdAt);
    if (!d) return;
    const key = getMonthLabel(d);
    const prev = map.get(key) ?? { total: 0, active: 0 };
    map.set(key, {
      total: prev.total + 1,
      active: prev.active + (r.subscriptionStatus === "active" ? 1 : 0),
    });
  });

  const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));

  let runningTotal = 0;
  let runningActive = 0;
  return sorted.map(([label, { total, active }]) => {
    runningTotal += total;
    runningActive += active;
    return { label: formatMonthLabel(label), total: runningTotal, active: runningActive };
  });
}

function filterByRange(restaurants: Restaurant[], range: DateRange): Restaurant[] {
  if (range === "all") return restaurants;
  const now = new Date();
  const cutoff = new Date();
  if (range === "today") cutoff.setHours(0, 0, 0, 0);
  else if (range === "7d") cutoff.setDate(now.getDate() - 7);
  else if (range === "30d") cutoff.setDate(now.getDate() - 30);

  return restaurants.filter((r) => {
    const d = toDate(r.createdAt);
    return d ? d >= cutoff : false;
  });
}

function calcAvgDuration(restaurants: Restaurant[]): string {
  const durations: number[] = [];
  restaurants.forEach((r) => {
    const start = toDate(r.subscriptionStartDate ?? r.createdAt);
    const end = toDate(r.subscriptionEndDate);
    if (start) {
      const durationEnd = end && end > start ? end : new Date();
      const days = (durationEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      durations.push(days);
    }
  });
  if (!durations.length) return "—";
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  if (avg >= 365) return `${(avg / 365).toFixed(1)}y`;
  return `${Math.round(avg)}d`;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const PIE_COLORS: Record<string, string> = {
  active:  "#10b981", // emerald-500
  trial:   "#f59e0b", // amber-500
  paused:  "#f43f5e", // rose-500
  expired: "#6b7280", // gray-500
};

const BAR_COLORS = [
  "#10b981", "#34d399", "#6ee7b7", "#a7f3d0",
  "#059669", "#047857", "#065f46", "#064e3b",
  "#0d9488", "#0f766e",
];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function CustomAreaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="text-xs">
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-xs text-emerald-500 font-bold">{payload[0]?.value} tenants</p>
    </div>
  );
}

function CustomPieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg text-sm">
      <p className="font-semibold capitalize">{name}</p>
      <p className="text-xs text-muted-foreground">{value} tenants</p>
    </div>
  );
}

// ─── Skeleton Loaders ─────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <Card className="rounded-xl border-border/40">
      <CardContent className="p-6 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
    </div>
  );
}

// ─── Range Button ─────────────────────────────────────────────────────────────

function RangeBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className={`text-xs h-8 px-3 rounded-lg transition-all ${
        active ? "" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface OrderRow {
  total: number;
  status: string;
  deliveryStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  date: Date | null;
  /** Acquisition channel — used to exclude walk-in/QR from marketplace metrics. */
  orderSource: string;
}

export default function AnalyticsPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>("all");

  const [totalLocations, setTotalLocations] = useState(0);

  // ── Orders (last 30 days) for revenue & operations analytics ───────────────
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  useEffect(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, "orders"),
      where("timestamp", ">=", Timestamp.fromDate(start)),
      limit(5000)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setOrders(
          snap.docs.map((d) => {
            const x = d.data() as Record<string, unknown>;
            const ts = x.timestamp as { toDate?: () => Date } | undefined;
            return {
              total: typeof x.total === "number" ? x.total : 0,
              status: String(x.status ?? ""),
              deliveryStatus: String(x.deliveryStatus ?? ""),
              paymentStatus: String(x.paymentStatus ?? ""),
              paymentMethod: String(x.paymentMethod ?? ""),
              date: ts?.toDate ? ts.toDate() : null,
              orderSource: String(x.orderSource ?? ""),
            };
          })
        );
        setOrdersLoading(false);
      },
      (err) => {
        console.error("[AnalyticsPage] orders listener failed", err);
        setOrdersLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Real-time Firestore listener
  useEffect(() => {
    const q = query(collection(db, "restaurants"), limit(2000));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rawDocs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Restaurant))
          .filter((d) => !d.isDeleted);
        
        setTotalLocations(rawDocs.length);

        const parentMap = new Map<string, Restaurant>();
        const outletsList: Restaurant[] = [];

        rawDocs.forEach((r) => {
          if (r.isOutlet && r.parentId) {
            outletsList.push(r);
          } else {
            parentMap.set(r.id!, r);
          }
        });

        // Link outlets (only needed if we chart outlets, but we just use parents for most stats)
        outletsList.forEach((outlet) => {
          const parent = parentMap.get(outlet.parentId!);
          if (parent) {
            outlet.subscriptionStatus = parent.subscriptionStatus;
            outlet.subscriptionType = parent.subscriptionType;
            outlet.subscriptionEndDate = parent.subscriptionEndDate;
            outlet.subscriptionStartDate = parent.subscriptionStartDate;
            outlet.isBlocked = parent.isBlocked;
          }
        });

        // Analytics are based on unique businesses (parents)
        setRestaurants(Array.from(parentMap.values()));
        setLoading(false);
      },
      (err) => {
        console.error("[AnalyticsPage] restaurants listener failed", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Filtered dataset for charts and KPIs
  const filtered = useMemo(() => filterByRange(restaurants, range), [restaurants, range]);

  // Counts (Filtered)
  const total = filtered.length;
  const activeCount  = useMemo(() => filtered.filter((r) => r.subscriptionStatus === "active").length, [filtered]);
  const trialCount   = useMemo(() => filtered.filter((r) => r.subscriptionStatus === "trial").length, [filtered]);
  const pausedCount  = useMemo(() => filtered.filter((r) => r.subscriptionStatus === "paused").length, [filtered]);
  const expiredCount = useMemo(() => filtered.filter((r) => r.subscriptionStatus === "expired").length, [filtered]);
  const blockedCount = useMemo(() => filtered.filter((r) => r.isBlocked === true).length, [filtered]);
  const yearlyCount  = useMemo(() => filtered.filter((r) => r.subscriptionType === "yearly").length, [filtered]);
  const monthlyCount = useMemo(() => filtered.filter((r) => r.subscriptionType === "monthly").length, [filtered]);

  const activeRate = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  const yearlyPct  = total > 0 ? Math.round((yearlyCount / total) * 100) : 0;
  const monthlyPct = total > 0 ? Math.round((monthlyCount / total) * 100) : 0;

  const conversionDenominator = activeCount + trialCount + expiredCount;
  const trialConversionRate = conversionDenominator > 0
    ? Math.round((activeCount / conversionDenominator) * 100)
    : 0;

  const avgDuration = useMemo(() => calcAvgDuration(filtered), [filtered]);

  // Growth chart data — always use full dataset to show cumulative curve; filtered shows context
  const growthData = useMemo(() => groupByMonth(restaurants), [restaurants]);

  // Top 10 cities/districts
  const cityData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => {
      const city = r.district || r.city || "Other";
      map[city] = (map[city] ?? 0) + 1;
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [filtered]);

  // Marketplace-only slice. Analytics headline metrics (Revenue, Orders, AOV,
  // Delivered Rate, revenue-by-day, hour-of-day, payment mix) all measure the
  // online business — walk-in POS and QR-menu orders are the vendor's own
  // in-store revenue that just flows through Kada's POS. See
  // src/lib/orderChannels.ts for the canonical classification.
  const marketplaceOrders = useMemo(
    () => orders.filter(isOnlineOrder),
    [orders],
  );

  // ── Orders & revenue analytics (last 30 days) ──────────────────────────────
  const orderKpis = useMemo(() => {
    let gmv = 0, delivered = 0, cancelled = 0;
    for (const o of marketplaceOrders) {
      gmv += o.total;
      const st = o.status.toLowerCase();
      const ds = o.deliveryStatus.toLowerCase();
      if (st === "completed" || ds === "delivered") delivered++;
      if (["cancelled", "canceled", "rejected"].includes(st)) cancelled++;
    }
    const count = marketplaceOrders.length;
    return {
      gmv, count,
      aov: count > 0 ? gmv / count : 0,
      deliveredRate: count > 0 ? (delivered / count) * 100 : 0,
      cancelRate: count > 0 ? (cancelled / count) * 100 : 0,
    };
  }, [marketplaceOrders]);

  const revenueByDay = useMemo(() => {
    const buckets: Record<string, { revenue: number; orders: number }> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      buckets[`${d.getMonth() + 1}/${d.getDate()}`] = { revenue: 0, orders: 0 };
    }
    for (const o of marketplaceOrders) {
      if (!o.date) continue;
      const key = `${o.date.getMonth() + 1}/${o.date.getDate()}`;
      if (buckets[key]) { buckets[key].revenue += o.total; buckets[key].orders += 1; }
    }
    return Object.entries(buckets).map(([day, v]) => ({ day, revenue: Math.round(v.revenue), orders: v.orders }));
  }, [marketplaceOrders]);

  const ordersByHour = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}`, orders: 0 }));
    for (const o of marketplaceOrders) {
      if (o.date) hours[o.date.getHours()].orders += 1;
    }
    return hours;
  }, [marketplaceOrders]);

  const paymentSplit = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of marketplaceOrders) {
      const pm = (o.paymentMethod || "other").toLowerCase();
      const label = pm === "cod" ? "Cash on Delivery" : pm === "razorpay" ? "Online (Razorpay)" : pm === "wallet" ? "Kada Wallet" : "Other";
      m[label] = (m[label] || 0) + 1;
    }
    const colors: Record<string, string> = { "Cash on Delivery": "#f59e0b", "Online (Razorpay)": "#2563eb", "Kada Wallet": "#0d9488", "Other": "#94a3b8" };
    return Object.entries(m).map(([name, value]) => ({ name, value, color: colors[name] ?? "#94a3b8" }));
  }, [marketplaceOrders]);

  // Subscription mix for donut
  const pieData = useMemo(() => {
    const entries: { name: string; value: number }[] = [
      { name: "active",  value: activeCount },
      { name: "trial",   value: trialCount },
      { name: "paused",  value: pausedCount },
      { name: "expired", value: expiredCount },
    ];
    return entries.filter((e) => e.value > 0);
  }, [activeCount, trialCount, pausedCount, expiredCount]);

  // Top states table
  const stateData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((r) => {
      const s = r.state?.trim();
      if (s) map[s] = (map[s] ?? 0) + 1;
    });
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([state, count]) => ({ state, count }));
  }, [filtered]);

  const maxStateCount = stateData[0]?.count ?? 1;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6 pb-10">

      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Business analytics</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Platform-wide growth & subscription insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <div className="flex gap-1.5">
            {(["today", "7d", "30d", "all"] as DateRange[]).map((r) => (
              <RangeBtn
                key={r}
                label={r === "all" ? "All Time" : r === "today" ? "Today" : r.toUpperCase()}
                active={range === r}
                onClick={() => setRange(r)}
              />
            ))}
          </div>
        </div>
      </div>

      <Tabs defaultValue="executive" className="space-y-6">

        <TabsContent value="executive" className="space-y-6">

      {/* ── Vendor base (selected range) ── */}
      <StatCards
        loading={loading}
        items={[
          { label: "Vendors", value: total, hint: `${totalLocations} physical locations`, icon: Users },
          { label: "Subscribed", value: `${activeRate}%`, hint: `${activeCount} on a paid plan`, icon: Activity, tone: "text-emerald-600" },
          {
            label: "Lapsed",
            value: pausedCount + expiredCount,
            hint: `${total > 0 ? Math.round(((pausedCount + expiredCount) / total) * 100) : 0}% paused or expired`,
            icon: TrendingDown,
            tone: "text-amber-600",
          },
          {
            label: "Billed yearly",
            value: yearlyCount + monthlyCount > 0 ? `${Math.round((yearlyCount / (yearlyCount + monthlyCount)) * 100)}%` : "—",
            hint: `${yearlyCount} yearly · ${monthlyCount} monthly plans`,
            icon: BarChart3,
            tone: "text-blue-600",
          },
        ]}
      />

      {/* ── Orders & Revenue (last 30 days) ── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Orders &amp; Revenue · Last 30 days
          </h2>
        </div>

        <StatCards
          loading={ordersLoading}
          items={[
            { label: "Online GMV", value: `₹${Math.round(orderKpis.gmv).toLocaleString("en-IN")}`, hint: "Excludes walk-in and QR", tone: "text-emerald-600" },
            { label: "Orders", value: orderKpis.count.toLocaleString("en-IN"), tone: "text-sky-600" },
            { label: "Avg order value", value: `₹${Math.round(orderKpis.aov).toLocaleString("en-IN")}`, tone: "text-indigo-600" },
            { label: "Delivered", value: `${orderKpis.deliveredRate.toFixed(1)}%`, hint: "Of orders placed", tone: "text-emerald-600" },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Revenue trend */}
          <Card className="lg:col-span-2 rounded-xl border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Daily Revenue
              </CardTitle>
              <p className="text-xs text-muted-foreground">Gross order value per day</p>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <ChartSkeleton />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={revenueByDay} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={4} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`} />
                    <Area type="monotone" dataKey="revenue" stroke="#0d9488" strokeWidth={2} fill="url(#gradRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Payment method split */}
          <Card className="rounded-xl border-border/50 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Payment Methods
              </CardTitle>
              <p className="text-xs text-muted-foreground">How customers pay</p>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <ChartSkeleton />
              ) : paymentSplit.length === 0 ? (
                <div className="flex items-center justify-center h-56 text-sm text-muted-foreground">No orders yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={paymentSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
                        {paymentSplit.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1.5">
                    {paymentSplit.map((d) => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                          {d.name}
                        </span>
                        <span className="font-semibold text-foreground">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Orders by hour of day */}
        <Card className="rounded-xl border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" /> Orders by Hour of Day
            </CardTitle>
            <p className="text-xs text-muted-foreground">When demand peaks — plan staffing &amp; riders</p>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <ChartSkeleton />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ordersByHour} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [`${v} orders`, ""]} labelFormatter={(h) => `${h}:00 – ${h}:59`} />
                  <Bar dataKey="orders" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Growth Chart + Geo Bar ── */}
      <div className="grid gap-6 lg:grid-cols-5">

        {/* Growth Area Chart — col-span 3 */}
        <Card className="lg:col-span-3 rounded-xl border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Cumulative Growth
            </CardTitle>
            <p className="text-xs text-muted-foreground">Total & active tenants over time</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : growthData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                No date data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={growthData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradActive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    dy={6}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip content={<CustomAreaTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Total Growth"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2.5}
                    fill="url(#gradTotal)"
                  />
                  <Area
                    type="monotone"
                    dataKey="active"
                    name="Active Only"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#gradActive)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Geographic Distribution — col-span 2 */}
        <Card className="lg:col-span-2 rounded-xl border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Top Cities / Districts
            </CardTitle>
            <p className="text-xs text-muted-foreground">By tenant count (top 10)</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton />
            ) : cityData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                No location data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={cityData}
                  layout="vertical"
                  margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    width={90}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Bar dataKey="count" name="Tenants" radius={[0, 6, 6, 0]}>
                    {cityData.map((_, idx) => (
                      <Cell key={idx} fill={BAR_COLORS[idx % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Donut Chart + KPI Cards ── */}
      <div className="grid gap-6 lg:grid-cols-5">

        {/* Subscription Mix Donut — col-span 2 */}
        <Card className="lg:col-span-2 rounded-xl border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Percent className="h-4 w-4 text-primary" />
              Subscription Mix
            </CardTitle>
            <p className="text-xs text-muted-foreground">Status distribution across all tenants</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ChartSkeleton height={260} />
            ) : pieData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                No data
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, idx) => (
                        <Cell
                          key={idx}
                          fill={PIE_COLORS[entry.name] ?? "#94a3b8"}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Custom legend */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 w-full">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: PIE_COLORS[entry.name] ?? "#94a3b8" }}
                      />
                      <span className="text-xs text-muted-foreground capitalize">{entry.name}</span>
                      <span className="text-xs font-semibold text-foreground ml-auto">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPI Grid — col-span 3 */}
        <div className="lg:col-span-3 grid grid-cols-2 gap-4 content-start">
          {/* Yearly Adoption */}
          <Card className="rounded-xl border-border/50 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-blue-500/10">
                  <Globe className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">Yearly Adoption</p>
              </div>
              {loading ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <p className="text-2xl font-bold tracking-tight">{yearlyPct}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{yearlyCount} of {total} tenants</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Monthly Adoption */}
          <Card className="rounded-xl border-border/50 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-violet-500/10">
                  <CalendarDays className="h-3.5 w-3.5 text-violet-500" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">Monthly Adoption</p>
              </div>
              {loading ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <p className="text-2xl font-bold tracking-tight">{monthlyPct}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{monthlyCount} of {total} tenants</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Avg Subscription Duration */}
          <Card className="rounded-xl border-border/50 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-emerald-500/10">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">Avg Sub. Duration</p>
              </div>
              {loading ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <p className="text-2xl font-bold tracking-tight">{avgDuration}</p>
                  <p className="text-xs text-muted-foreground mt-1">Estimated from dates</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Trial Conversion */}
          <Card className="rounded-xl border-border/50 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-amber-500/10">
                  <Activity className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">Paid Share</p>
              </div>
              {loading ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <p className="text-2xl font-bold tracking-tight text-emerald-600">{trialConversionRate}%</p>
                  <p className="text-xs text-muted-foreground mt-1">Active / (Active + Legacy trial + Expired)</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Blocked / Suspended */}
          <Card className="rounded-xl border-border/50 shadow-sm col-span-2">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-red-500/10">
                    <ShieldX className="h-3.5 w-3.5 text-red-500" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">Blocked / Suspended</p>
                </div>
                {!loading && (
                  <Badge variant="destructive" className="text-xs">
                    {blockedCount} tenant{blockedCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              {loading ? (
                <Skeleton className="h-8 w-20 mt-3" />
              ) : (
                <div className="mt-3 flex items-end gap-3">
                  <p className="text-2xl font-bold tracking-tight text-red-600">{blockedCount}</p>
                  <p className="text-xs text-muted-foreground mb-1">
                    {pausedCount} paused · {expiredCount} expired
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Top States Table ── */}
      <Card className="rounded-xl border-border/50 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Top States
          </CardTitle>
          <p className="text-xs text-muted-foreground">Tenant distribution by state</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : stateData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No state data available</p>
          ) : (
            <div className="space-y-2 overflow-x-auto">
              <div className="min-w-[600px] space-y-2">
                {/* Header */}
                <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span className="col-span-1">#</span>
                  <span className="col-span-4">State</span>
                  <span className="col-span-2 text-right">Tenants</span>
                  <span className="col-span-5">Distribution</span>
                </div>
                {/* Rows */}
                {stateData.map(({ state, count }, idx) => {
                  const pct = Math.round((count / maxStateCount) * 100);
                  return (
                    <div
                      key={state}
                      className="grid grid-cols-12 gap-3 items-center px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors"
                    >
                      <span className="col-span-1 text-xs font-medium text-muted-foreground">
                        {idx + 1}
                      </span>
                      <span className="col-span-4 text-sm font-medium text-foreground truncate">
                        {state}
                      </span>
                      <span className="col-span-2 text-sm font-semibold text-right">
                        {count}
                      </span>
                      <div className="col-span-5 flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    
        </TabsContent>
        
      </Tabs>
</div>
  );
}
