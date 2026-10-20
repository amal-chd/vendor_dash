import { motion } from "framer-motion";
import {
  TrendingUp, ShoppingCart, Users, ChefHat, ArrowUpRight, ArrowDownRight,
  Calendar, Clock, Utensils, AlertTriangle, Package, BarChart3, QrCode,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useEffect, useState } from "react";
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp, getDocs } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../../lib/firebase";
import { useAuth } from "../../hooks/useAuth";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";
import { ExportHelper } from "@/lib/helpers";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const transition = { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const };

interface Order {
  id: string;
  orderNumber: string;
  table: string;
  total: number;
  status: string;
  timestamp: Timestamp | Date | null;
  items: Array<{ name: string; price: number; quantity: number }>;
}

interface InventoryItem {
  id: string;
  name: string;
  stock: number;
  min: number;
  status: string;
}

export default function DashboardOverview() {
  const { user, restaurantId , activeRestaurantId } = useAuth();
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryItem[]>([]);
  const [revenueData, setRevenueData] = useState<Array<{ day: string; revenue: number; orders: number }>>([]);
  const [popularItems, setPopularItems] = useState<Array<{ name: string; orders: number; revenue: string; trend: string; icon: string; color: string }>>([]);
  const { format, locale } = useCurrency();
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "week">("today");
  const [totalTablesCount, setTotalTablesCount] = useState(12);
  const [stats, setStats] = useState([
    { label: "Revenue Today", value: format(0), change: "0%", up: true, icon: TrendingUp, subtitle: "vs yesterday" },
    { label: "New Orders", value: "0", change: "Live", up: true, icon: ShoppingCart, subtitle: "waiting" },
    { label: "Occupied Tables", value: "0/12", change: "0%", up: true, icon: Users, subtitle: "dine-in" },
    { label: "Avg. Time", value: "14m", change: "-2.4m", up: true, icon: Clock, subtitle: "target: 15 mins" },
  ]);
  const [initialLoading, setInitialLoading] = useState(true);

  function getDateRange(range: "today" | "yesterday" | "week"): { start: Date; end: Date; label: string } {
    const now = new Date();
    if (range === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: "today" };
    } else if (range === "yesterday") {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: "yesterday" };
    } else {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: "last 7 days" };
    }
  }

  useEffect(() => {
    if (!user) return;

    const qTables = query(collection(db, "tables"), where("restaurantId", "==", activeRestaurantId));
    const unsubscribeTables = onSnapshot(qTables, (snapshot) => {
      setTotalTablesCount(snapshot.docs.length || 1);
    }, (err) => console.error("[DashboardOverview] qTables listener failed", err));

    // Scoped to last 30 days for the live dashboard (enough for KPIs + recent activity)
    const thirtyDaysAgo = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const qOrders = query(
      collection(db, "orders"),
      where("restaurantId", "==", activeRestaurantId),
      where("timestamp", ">=", thirtyDaysAgo),
      orderBy("timestamp", "desc"),
      limit(2000),
    );

    const unsubscribeOrders = onSnapshot(qOrders, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => {
        const data = doc.data() as Record<string, any>;
        const itemsRaw = Array.isArray(data.items) ? data.items : [];
        const items = itemsRaw.map((item: any) => {
          if (item && typeof item === "object") {
            return {
              name: String(item.name ?? "Item"),
              price: Number(item.price ?? 0) || 0,
              quantity: Number(item.quantity ?? item.qty ?? 1) || 1,
            };
          }
          return { name: String(item ?? "Item"), price: 0, quantity: 1 };
        });
        return {
          ...data,
          id: doc.id,
          orderNumber: data.orderNumber || doc.id.slice(-4).toUpperCase(),
          table: data.table ?? data.tableLabel ?? "Takeaway",
          total: Number(data.total ?? data.totalAmount ?? 0) || 0,
          status: String(data.status ?? "new"),
          timestamp: data.timestamp ?? null,
          items,
        } as Order;
      });
      setAllOrders(ordersData);
      setInitialLoading(false);
    }, (err) => console.error("[DashboardOverview] qOrders listener failed", err));

    const qInv = query(collection(db, "inventory"), where("restaurantId", "==", activeRestaurantId));
    const unsubscribeInv = onSnapshot(qInv, (snapshot) => {
      const invData = snapshot.docs.map(doc => {
        const data = doc.data();
        let status = 'ok';
        if (data.stock <= data.min * 0.5) status = 'critical';
        else if (data.stock <= data.min) status = 'low';
        return { id: doc.id, ...data, status } as InventoryItem;
      });
      setInventoryAlerts(invData.filter(i => i.status !== 'ok').slice(0, 3));
    }, (err) => console.error("[DashboardOverview] qInv listener failed", err));

    return () => {
      unsubscribeTables();
      unsubscribeOrders();
      unsubscribeInv();
    };
  }, [user, activeRestaurantId]);

  useEffect(() => {
    if (allOrders.length === 0) return;

    const { start: rangeStart, end: rangeEnd, label: rangeLabel } = getDateRange(dateRange);
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    const rangeOrders = allOrders.filter(o => {
      if (!o.timestamp) return false;
      const oDate = o.timestamp instanceof Timestamp ? o.timestamp.toDate() : new Date(o.timestamp as any);
      const oMs = oDate.getTime();
      return oMs >= rangeStartMs && oMs <= rangeEndMs;
    });

    setOrders(rangeOrders.slice(0, 8));

    const rangeRev = rangeOrders
      .filter(o => o.status.toLowerCase() === 'completed')
      .reduce((sum, o) => sum + (o.total || 0), 0);
    const activeTablesCount = new Set(
      rangeOrders
        .filter(o => !['completed', 'cancelled'].includes(o.status.toLowerCase()))
        .map(o => o.table)
    ).size;
    const kitchenQueueCount = rangeOrders
      .filter(o => ['new', 'preparing'].includes(o.status.toLowerCase()))
      .length;

    const revLabel = dateRange === "today" ? "Revenue Today" : dateRange === "yesterday" ? "Revenue Yesterday" : "Revenue (Week)";

    setStats(prev => [
      { label: revLabel, value: format(rangeRev), change: `${rangeOrders.length} orders`, up: rangeRev > 0, icon: TrendingUp, subtitle: rangeLabel },
      { label: "Orders", value: rangeOrders.length.toString(), change: kitchenQueueCount > 0 ? `${kitchenQueueCount} live` : "—", up: true, icon: ShoppingCart, subtitle: dateRange === "today" ? "placed today" : rangeLabel },
      { label: "Tables Used", value: `${activeTablesCount}/${totalTablesCount}`, change: `${Math.round((activeTablesCount / totalTablesCount) * 100)}%`, up: true, icon: Users, subtitle: "dine-in" },
      prev[3],
    ]);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const chartData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return { date: d, label: days[d.getDay()], revenue: 0, orders: 0 };
    });

    allOrders.forEach(o => {
      if (!o.timestamp) return;
      const oDate = o.timestamp instanceof Timestamp ? o.timestamp.toDate() : new Date(o.timestamp as any);
      const dayIdx = chartData.findIndex(d =>
        d.date.getDate() === oDate.getDate() && d.date.getMonth() === oDate.getMonth()
      );
      if (dayIdx !== -1) {
        chartData[dayIdx].revenue += (o.total || 0);
        chartData[dayIdx].orders += 1;
      }
    });
    setRevenueData(chartData.map(d => ({ day: d.label, revenue: d.revenue, orders: d.orders })));

    const itemCounts: Record<string, { count: number; revenue: number }> = {};
    rangeOrders
      .filter(o => !['cancelled'].includes(o.status?.toLowerCase?.() ?? ''))
      .forEach(o => {
        o.items?.forEach(item => {
          if (!itemCounts[item.name]) itemCounts[item.name] = { count: 0, revenue: 0 };
          itemCounts[item.name].count += (item.quantity || 1);
          itemCounts[item.name].revenue += (item.price * item.quantity || 0);
        });
      });

    const sortedItems = Object.entries(itemCounts)
      .map(([name, data]) => ({
        name, orders: data.count,
        revenue: format(data.revenue),
        trend: "+12%", icon: "🍽️", color: "bg-primary"
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5);

    setPopularItems(sortedItems);
  }, [dateRange, allOrders, totalTablesCount]);

  useEffect(() => {
    setStats((prev) => [
      prev[0], prev[1], prev[2],
      {
        label: "Stock Alerts", value: inventoryAlerts.length.toString(),
        change: inventoryAlerts.length > 0 ? "Restock" : "All clear",
        up: inventoryAlerts.length === 0, icon: AlertTriangle,
        subtitle: inventoryAlerts.length > 0 ? "items low" : "inventory ok"
      },
    ]);
  }, [inventoryAlerts.length]);

  const todayStr = new Date().toLocaleDateString(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const dateRangeOptions: { key: "today" | "yesterday" | "week"; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "7 Days" },
  ];

  const quickActions = [
    { label: "Open POS", icon: ShoppingCart, href: "/dashboard/pos", color: "text-blue-600", bg: "bg-blue-500/10" },
    { label: "Kitchen", icon: ChefHat, href: "/dashboard/kitchen", color: "text-amber-600", bg: "bg-amber-500/10" },
    { label: "Orders", icon: Utensils, href: "/dashboard/orders", color: "text-violet-600", bg: "bg-violet-500/10" },
    { label: "Reports", icon: BarChart3, href: "/dashboard/reports", color: "text-emerald-600", bg: "bg-emerald-500/10" },
  ];

  if (initialLoading) return <PageLoading stats={4} chart={true} rows={6} />;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mt-1">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {todayStr}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-xl bg-muted/40 p-1 border border-border/40">
            {dateRangeOptions.map(opt => (
              <button
                key={opt.key}
                onClick={() => setDateRange(opt.key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  dateRange === opt.key
                    ? "bg-white dark:bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <a
            href={`/menu?restaurantId=${activeRestaurantId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <QrCode className="w-3.5 h-3.5" />
            View Menu
            <ArrowUpRight className="w-3 h-3 opacity-70" />
          </a>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {quickActions.map((action, i) => (
          <motion.div
            key={action.href}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transition, delay: i * 0.05 }}
          >
            <Link
              to={action.href}
              className="flex items-center gap-3 p-3.5 rounded-2xl bg-card border border-border/40 hover:border-primary/30 hover:shadow-md transition-all group"
            >
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", action.bg)}>
                <action.icon className={cn("w-4 h-4", action.color)} />
              </div>
              <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                {action.label}
              </span>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            className="bg-card rounded-2xl p-4 sm:p-5 border border-border/40 hover:border-border/70 transition-colors"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transition, delay: i * 0.07 }}
          >
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs font-medium text-muted-foreground leading-snug">{stat.label}</span>
              <div className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 ml-2">
                <stat.icon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight leading-none">
              {stat.value}
            </div>
            <div className="flex items-center gap-1.5 mt-2.5">
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                stat.up ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-500"
              )}>
                {stat.up ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                {stat.change}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">{stat.subtitle}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left: Chart + Orders Table */}
        <div className="xl:col-span-2 space-y-5">
          {/* Revenue Chart */}
          <Card className="border border-border/40 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between px-5 sm:px-6 py-4 border-b border-border/30">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground">Revenue Trend</CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">Last 7 days</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-3 sm:px-5 py-4">
              <div className="h-[200px] sm:h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      dy={6}
                    />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                      content={({ active, payload }) => {
                        if (active && payload?.length) {
                          return (
                            <div className="bg-card border border-border rounded-xl px-3 py-2.5 shadow-lg">
                              <p className="text-[10px] text-muted-foreground mb-1">{payload[0].payload?.day}</p>
                              <p className="text-sm font-bold text-primary">{format(Number(payload[0].value || 0))}</p>
                              <p className="text-[10px] text-muted-foreground">{payload[0].payload?.orders} orders</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#revGrad)"
                      animationDuration={900}
                      dot={false}
                      activeDot={{ r: 4, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Recent Orders Table */}
          <Card className="border border-border/40 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between px-5 sm:px-6 py-4 border-b border-border/30">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground">Recent Orders</CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  {orders.length} orders {dateRange === "today" ? "today" : dateRange === "yesterday" ? "yesterday" : "this week"}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium rounded-lg gap-1.5 border-border/50"
                onClick={async () => {
                  if (!user) return;
                  try {
                    // Scope export to last 30 days to prevent loading full history
                    const thirtyDaysAgo = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    const q = query(
                      collection(db, "orders"),
                      where("restaurantId", "==", activeRestaurantId),
                      where("timestamp", ">=", thirtyDaysAgo),
                      orderBy("timestamp", "desc"),
                      limit(2000),
                    );
                    const snapshot = await getDocs(q);
                    const exportData = snapshot.docs.map(d => {
                      const o = d.data();
                      return {
                        id: d.id,
                        table: o.table,
                        total: o.total,
                        status: o.status,
                        date: o.timestamp instanceof Timestamp ? o.timestamp.toDate().toISOString() : o.timestamp,
                      };
                    });
                    ExportHelper.downloadCSV(exportData, `orders_${new Date().toISOString().split('T')[0]}.csv`);
                    toast.success("Export started");
                  } catch {
                    toast.error("Export failed");
                  }
                }}
              >
                Export CSV
              </Button>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[520px] lg:min-w-0">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/20">
                    <th className="px-5 py-3 text-[11px] font-medium text-muted-foreground">Order</th>
                    <th className="px-5 py-3 text-[11px] font-medium text-muted-foreground">Items</th>
                    <th className="px-5 py-3 text-[11px] font-medium text-muted-foreground">Table</th>
                    <th className="px-5 py-3 text-[11px] font-medium text-muted-foreground">Amount</th>
                    <th className="px-5 py-3 text-[11px] font-medium text-muted-foreground">Status</th>
                    <th className="px-5 py-3 text-[11px] font-medium text-muted-foreground text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {orders.map((order) => {
                    const ts = order.timestamp
                      ? (order.timestamp instanceof Timestamp
                          ? order.timestamp.toDate()
                          : new Date(order.timestamp as any))
                      : null;
                    const timeStr = ts
                      ? ts.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                      : '—';
                    return (
                      <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-3.5">
                          <span className="px-2 py-1 rounded-lg bg-muted text-[11px] font-semibold">
                            #{order.orderNumber}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">
                          {order.items?.reduce((s, item) => s + (item.quantity || 1), 0) || 0} items
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium">
                          {order.table ? `Table ${order.table}` : 'Takeaway'}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-semibold text-primary">
                          {format(order.total || 0)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn(
                            "px-2 py-0.5 rounded-md text-[11px] font-medium",
                            order.status?.toLowerCase() === 'completed'
                              ? "bg-emerald-500/10 text-emerald-600"
                              : ['preparing', 'ready'].includes(order.status?.toLowerCase())
                              ? "bg-amber-500/10 text-amber-600"
                              : "bg-blue-500/10 text-blue-600"
                          )}>
                            {order.status
                              ? order.status.charAt(0).toUpperCase() + order.status.slice(1)
                              : 'New'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-xs text-muted-foreground tabular-nums">
                          {timeStr}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {orders.length === 0 && (
                <div className="py-14 flex flex-col items-center text-center">
                  <Package className="w-8 h-8 text-muted-foreground/25 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">No orders yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Orders will appear here once customers place them
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          {/* Top Sellers */}
          <Card className="border border-border/40 shadow-sm rounded-2xl overflow-hidden">
            <CardHeader className="px-5 sm:px-6 py-4 border-b border-border/30">
              <CardTitle className="text-sm font-semibold text-foreground">Top Sellers</CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">By units sold</CardDescription>
            </CardHeader>
            <CardContent className="px-5 sm:px-6 py-4 space-y-4">
              {popularItems.length === 0 ? (
                <div className="py-8 flex flex-col items-center text-center">
                  <Utensils className="w-7 h-7 text-muted-foreground/25 mb-2" />
                  <p className="text-sm text-muted-foreground">No sales data yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Complete some orders to see top items
                  </p>
                </div>
              ) : (
                popularItems.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className="w-5 h-5 text-[11px] font-bold text-muted-foreground text-center flex-shrink-0 flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-medium text-foreground truncate pr-1">{item.name}</p>
                        <p className="text-xs font-semibold text-primary flex-shrink-0">{item.revenue}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-primary rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min((item.orders / (popularItems[0]?.orders || 1)) * 100, 100)}%` }}
                            transition={{ ...transition, delay: i * 0.07 + 0.2 }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
                          {item.orders} sold
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Stock Alerts */}
          {inventoryAlerts.length > 0 && (
            <Card className="border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900/40 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="px-5 sm:px-6 py-4 border-b border-amber-200/40 dark:border-amber-900/30">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <CardTitle className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    Stock Alerts
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-amber-600/70 mt-0.5">
                  {inventoryAlerts.length} item{inventoryAlerts.length > 1 ? 's' : ''} need restocking
                </CardDescription>
              </CardHeader>
              <CardContent className="px-5 sm:px-6 py-4 space-y-3">
                {inventoryAlerts.map(item => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.stock} remaining (min: {item.min})</p>
                    </div>
                    <span className={cn(
                      "ml-3 px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0",
                      item.status === 'critical'
                        ? "bg-rose-500/10 text-rose-600"
                        : "bg-amber-500/10 text-amber-600"
                    )}>
                      {item.status === 'critical' ? 'Critical' : 'Low'}
                    </span>
                  </div>
                ))}
                <Link
                  to="/dashboard/inventory"
                  className="block w-full text-center text-xs font-semibold text-primary hover:underline pt-1"
                >
                  Manage inventory →
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
