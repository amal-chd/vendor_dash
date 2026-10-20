import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  DollarSign, TrendingUp, TrendingDown, Plus, Trash2,
  BarChart3, PieChart as PieIcon, CalendarDays, ArrowUpRight,
  ArrowDownRight, Receipt, Wallet, Activity
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { db } from "@/lib/firebase";
import {
  collection, query, where, onSnapshot, limit,
  addDoc, deleteDoc, doc, serverTimestamp,
  orderBy, Timestamp
} from "firebase/firestore";
import { toast } from "sonner";
import { useCurrency } from "@/lib/currency";
import { PageLoading } from "@/components/dashboard/PageLoading";

// ─── Types ────────────────────────────────────────────────────────────────────

type Expense = {
  id: string;
  restaurantId: string;
  category: string;
  amount: number;
  description: string;
  date: string;           // ISO date string YYYY-MM-DD
  paymentMode: string;
  createdAt: Timestamp | null;
};

type Order = {
  id: string;
  total?: number;
  totalAmount?: number;
  subtotal?: number;
  tax?: number;
  status: string;
  timestamp: Timestamp | null;
  paymentMethod?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  "Rent", "Salary", "Inventory", "Utilities",
  "Marketing", "Maintenance", "Equipment", "Other"
];

const PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer"];

const COMPLETED_STATUSES = ["completed", "paid", "done", "delivered", "served"];

const CATEGORY_COLORS: Record<string, string> = {
  Rent:        "#6366f1",
  Salary:      "#f59e0b",
  Inventory:   "#10b981",
  Utilities:   "#3b82f6",
  Marketing:   "#ec4899",
  Maintenance: "#f97316",
  Equipment:   "#8b5cf6",
  Other:       "#64748b",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === "string" || typeof v === "number") {
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isoToDate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

function pctChange(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prev) / prev) * 100);
}

/** Robustly read an order's revenue across all Firestore field-name variants */
function orderRevenue(o: Order): number {
  return (
    Number(o.total) ||
    Number(o.totalAmount) ||
    (Number(o.subtotal ?? 0) + Number(o.tax ?? 0)) ||
    0
  );
}

// Build a map of ISO-date → income for the last N days
function buildDailyIncome(orders: Order[], days: number, locale: string = "en-US"): { date: string; income: number }[] {
  const now = new Date();
  const map: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    map[d.toISOString().split("T")[0]] = 0;
  }
  for (const o of orders) {
    if (!COMPLETED_STATUSES.includes((o.status || "").toLowerCase())) continue;
    const d = toDate(o.timestamp);
    if (!d) continue;
    const key = d.toISOString().split("T")[0];
    if (key in map) map[key] = (map[key] || 0) + orderRevenue(o);
  }
  return Object.entries(map).map(([date, income]) => ({
    date: new Date(date + "T00:00:00").toLocaleDateString(locale, { day: "numeric", month: "short" }),
    income
  }));
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, pct, color = "primary", icon: Icon
}: {
  label: string; value: string; sub?: string;
  pct?: number; color?: string; icon: React.ElementType;
}) {
  const isPrimary = color === "primary";
  return (
    <Card className={cn(
      "rounded-xl border-none shadow-xl overflow-hidden relative group",
      isPrimary ? "bg-primary text-white" : "bg-card"
    )}>
      <div className="p-5 relative z-10">
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center mb-3",
          isPrimary ? "bg-white/20" : `bg-${color}-500/10`
        )}>
          <Icon className={cn("w-4 h-4", isPrimary ? "text-white" : `text-${color}-500`)} />
        </div>
        <p className={cn("text-[10px] font-semibold uppercase mb-1", isPrimary ? "opacity-60" : "")}>
          {label}
        </p>
        <h3 className={cn("text-xl font-semibold", !isPrimary && "text-foreground")}>{value}</h3>
        {(sub || pct !== undefined) && (
          <div className="flex items-center gap-2 mt-1">
            {sub && <p className={cn("text-[10px]", isPrimary ? "opacity-50" : "text-muted-foreground")}>{sub}</p>}
            {pct !== undefined && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[10px] font-semibold",
                pct >= 0 ? "text-emerald-500" : "text-red-500"
              )}>
                {pct >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(pct)}%
              </span>
            )}
          </div>
        )}
      </div>
      {isPrimary && (
        <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-white/5 rounded-full blur-3xl group-hover:scale-150 transition-transform" />
      )}
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { user, restaurantId , activeRestaurantId } = useAuth();
  const { format, symbol, locale } = useCurrency();

  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("All");

  // Selected month for P&L (default = current month)
  const nowYM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(nowYM);

  // New expense form
  const blankExpense = {
    category: "Rent", amount: 0, description: "",
    date: new Date().toISOString().split("T")[0], paymentMode: "Cash"
  };
  const [newExpense, setNewExpense] = useState({ ...blankExpense });

  // ── Firestore ──

  useEffect(() => {
    if (!user) return;

    const [plYearStr, plMonthStr] = selectedMonth.split("-");
    const selectedStart = new Date(Number(plYearStr), Number(plMonthStr) - 1, 1);
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    
    const queryStart = selectedStart < thirtyDaysAgo ? selectedStart : thirtyDaysAgo;

    const qOrders = query(
      collection(db, "orders"),
      where("restaurantId", "==", activeRestaurantId),
      where("timestamp", ">=", queryStart),
      orderBy("timestamp", "desc"),
      limit(3000),
    );
    const unsubOrders = onSnapshot(qOrders, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
      setLoadingOrders(false);
    }, (err) => console.error("[ExpensesPage] qOrders listener failed", err));

    // No orderBy on the server query — newly-written docs use serverTimestamp()
    // which is null in the local snapshot until the server resolves it, and
    // `orderBy("createdAt", "desc")` can momentarily filter such docs out.
    // Sort client-side so writes appear instantly in realtime.
    const qExpenses = query(
      collection(db, "expenses"),
      where("restaurantId", "==", activeRestaurantId),
      limit(500),
    );
    const unsubExpenses = onSnapshot(
      qExpenses,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense));
        rows.sort((a, b) => {
          const av =
            (a as any).createdAt?.toMillis?.() ??
            (a.date ? Date.parse(a.date) : 0);
          const bv =
            (b as any).createdAt?.toMillis?.() ??
            (b.date ? Date.parse(b.date) : 0);
          return bv - av;
        });
        setExpenses(rows);
        setLoadingExpenses(false);
      },
      (err) => {
        console.error("Expenses sync failed:", err);
        toast.error(
          (err as any)?.code === "failed-precondition"
            ? "Expenses index still building — try again in a minute."
            : "Couldn't sync expenses. Check your connection.",
        );
        setLoadingExpenses(false);
      },
    );

    return () => { unsubOrders(); unsubExpenses(); };
  }, [user, activeRestaurantId]);

  // ── Income Calculations ──

  const completedOrders = useMemo(
    () => orders.filter(o => COMPLETED_STATUSES.includes((o.status || "").toLowerCase())),
    [orders]
  );

  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const nowMonth = useMemo(() => new Date().getMonth(), []);
  const nowYear  = useMemo(() => new Date().getFullYear(), []);
  const weekStartMs = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d.getTime();
  }, []);

  const todayIncome = useMemo(() =>
    completedOrders
      .filter(o => {
        const d = toDate(o.timestamp);
        return d && d.toISOString().split("T")[0] === todayStr;
      })
      .reduce((s, o) => s + orderRevenue(o), 0),
    [completedOrders, todayStr]
  );

  const weekIncome = useMemo(() =>
    completedOrders
      .filter(o => { const d = toDate(o.timestamp); return d && d.getTime() >= weekStartMs; })
      .reduce((s, o) => s + orderRevenue(o), 0),
    [completedOrders, weekStartMs]
  );

  const monthIncome = useMemo(() =>
    completedOrders
      .filter(o => {
        const d = toDate(o.timestamp);
        return d && d.getMonth() === nowMonth && d.getFullYear() === nowYear;
      })
      .reduce((s, o) => s + orderRevenue(o), 0),
    [completedOrders, nowMonth, nowYear]
  );

  const prevMonthIncome = useMemo(() => {
    const prevMonth = nowMonth === 0 ? 11 : nowMonth - 1;
    const prevYear  = nowMonth === 0 ? nowYear - 1 : nowYear;
    return completedOrders
      .filter(o => {
        const d = toDate(o.timestamp);
        return d && d.getMonth() === prevMonth && d.getFullYear() === prevYear;
      })
      .reduce((s, o) => s + orderRevenue(o), 0);
  }, [completedOrders, nowMonth, nowYear]);

  // Income chart (last 30 days)
  const incomeChartData = useMemo(() => buildDailyIncome(completedOrders, 30, locale), [completedOrders, locale]);

  // Income by payment method
  const incomeByPayment = useMemo(() => {
    const map: Record<string, number> = {};
    completedOrders.forEach(o => {
      const pm = o.paymentMethod || "Other";
      map[pm] = (map[pm] || 0) + orderRevenue(o);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [completedOrders]);

  // ── Expense Calculations ──

  const filteredExpenses = useMemo(() =>
    expenses.filter(e => categoryFilter === "All" || e.category === categoryFilter),
    [expenses, categoryFilter]
  );

  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + (e.amount || 0), 0), [expenses]);

  // P&L for selected month
  const [plYear, plMonth] = selectedMonth.split("-").map(Number);

  const plIncome = useMemo(() =>
    completedOrders
      .filter(o => {
        const d = toDate(o.timestamp);
        return d && d.getFullYear() === plYear && d.getMonth() === plMonth - 1;
      })
      .reduce((s, o) => s + orderRevenue(o), 0),
    [completedOrders, plYear, plMonth]
  );

  const plExpenses = useMemo(() =>
    expenses
      .filter(e => {
        const d = isoToDate(e.date);
        return d.getFullYear() === plYear && d.getMonth() === plMonth - 1;
      })
      .reduce((s, e) => s + (e.amount || 0), 0),
    [expenses, plYear, plMonth]
  );

  const plProfit = plIncome - plExpenses;
  const plMargin = plIncome > 0 ? Math.round((plProfit / plIncome) * 100) : 0;

  // Expense breakdown by category for P&L month
  const expensePieData = useMemo(() => {
    const map: Record<string, number> = {};
    expenses
      .filter(e => {
        const d = isoToDate(e.date);
        return d.getFullYear() === plYear && d.getMonth() === plMonth - 1;
      })
      .forEach(e => { map[e.category] = (map[e.category] || 0) + (e.amount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [expenses, plYear, plMonth]);

  // ── Actions ──

  const handleAddExpense = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!user) return;
    if (newExpense.amount <= 0) { toast.error("Amount must be > 0"); return; }
    try {
      await addDoc(collection(db, "expenses"), {
        ...newExpense,
        amount: Number(newExpense.amount),
        restaurantId: activeRestaurantId,
        outletId: activeRestaurantId !== restaurantId ? activeRestaurantId : null,
        createdAt: serverTimestamp(),
      });
      toast.success("Expense recorded");
      setAddOpen(false);
      setNewExpense({ ...blankExpense });
    } catch (err: any) {
      console.error("Add expense failed:", err);
      const code = err?.code === "permission-denied"
        ? "You don't have permission to add expenses. Please refresh and try again."
        : (err?.message || "Failed to save expense");
      toast.error(code);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("Delete this expense?")) return;
    try {
      await deleteDoc(doc(db, "expenses", id));
      toast.success("Expense deleted");
    } catch (err: any) {
      console.error("Delete expense failed:", err);
      toast.error(err?.message || "Failed to delete");
    }
  };

  // ── Render ──

  if (loadingOrders && loadingExpenses) {
    return <PageLoading stats={4} chart={true} rows={6} />;
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-[1.25rem] bg-primary flex items-center justify-center shadow-xl shadow-primary/20">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Expenses & Income</h1>
            <p className="text-sm text-muted-foreground mt-0.5">P&amp;L tracking and financial overview</p>
          </div>
        </div>
        <Button
          className="rounded-xl font-semibold uppercase text-[10px] bg-primary text-white h-12 shadow-lg shadow-primary/20 w-fit"
          onClick={() => { setNewExpense({ ...blankExpense }); setAddOpen(true); }}
        >
          <Plus className="w-4 h-4 mr-2" /> Add Expense
        </Button>
      </div>

      {/* ── Income Summary ── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">Income Overview</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Today's Income" value={format(todayIncome)}
            sub="completed orders" icon={TrendingUp} color="primary"
          />
          <StatCard
            label="This Week" value={format(weekIncome)}
            sub="Mon – today" icon={Activity} color="blue"
          />
          <StatCard
            label="This Month" value={format(monthIncome)}
            pct={pctChange(monthIncome, prevMonthIncome)} icon={BarChart3} color="emerald"
          />
          <StatCard
            label="Total Expenses" value={format(totalExpenses)}
            sub={`${expenses.length} entries`} icon={Receipt} color="red"
          />
        </div>
      </div>

      {/* ── Income Trend Chart ── */}
      <Card className="rounded-xl border-none shadow-xl bg-card">
        <CardHeader className="p-6 pb-4">
          <CardTitle className="text-sm font-semibold">Income Trend</CardTitle>
          <CardDescription className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40">Last 30 days · completed orders</CardDescription>
        </CardHeader>
        <CardContent className="px-2 pb-6">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={incomeChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={v => `${symbol}${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
              <RechartsTooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
                formatter={(v: number) => [format(v), "Income"]}
              />
              <Area type="monotone" dataKey="income" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#incomeGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Income by Payment Method ── */}
      {incomeByPayment.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-1 rounded-xl border-none shadow-xl bg-card">
            <CardHeader className="p-6 pb-4">
              <CardTitle className="text-sm font-semibold">Income by Payment</CardTitle>
              <CardDescription className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40">All time</CardDescription>
            </CardHeader>
            <CardContent className="pb-6">
              <div className="space-y-3">
                {incomeByPayment.map((pm, i) => {
                  const total = incomeByPayment.reduce((s, p) => s + p.value, 0);
                  const pct = total > 0 ? Math.round((pm.value / total) * 100) : 0;
                  const hue = `hsl(${(i * 60 + 220) % 360}, 70%, 60%)`;
                  return (
                    <div key={pm.name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold">{pm.name}</span>
                        <span className="text-muted-foreground">{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: hue }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── P&L Summary ── */}
          <Card className="md:col-span-2 rounded-xl border-none shadow-xl bg-card">
            <CardHeader className="p-6 pb-4 flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-sm font-semibold">P&amp;L Summary</CardTitle>
                <CardDescription className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40">Income vs Expenses</CardDescription>
              </div>
              <Input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="rounded-xl h-10 w-40 bg-muted/20 border-none text-xs font-semibold"
              />
            </CardHeader>
            <CardContent className="pb-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-500/5 rounded-xl p-4 text-center">
                  <p className="text-[9px] font-semibold uppercase text-emerald-600 opacity-70 mb-1">Income</p>
                  <p className="text-base font-semibold text-emerald-600">{format(plIncome)}</p>
                </div>
                <div className="bg-red-500/5 rounded-xl p-4 text-center">
                  <p className="text-[9px] font-semibold uppercase text-red-500 opacity-70 mb-1">Expenses</p>
                  <p className="text-base font-semibold text-red-500">{format(plExpenses)}</p>
                </div>
                <div className={cn("rounded-xl p-4 text-center", plProfit >= 0 ? "bg-primary/5" : "bg-red-500/5")}>
                  <p className={cn("text-[9px] font-semibold uppercase opacity-70 mb-1", plProfit >= 0 ? "text-primary" : "text-red-500")}>
                    Net Profit
                  </p>
                  <p className={cn("text-base font-semibold", plProfit >= 0 ? "text-primary" : "text-red-500")}>
                    {format(plProfit)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-muted/20 rounded-xl px-4 py-3">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Profit margin:</span>
                <span className={cn("text-sm font-semibold", plMargin >= 0 ? "text-primary" : "text-red-500")}>
                  {plMargin}%
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Expense Pie Chart & Table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pie Chart */}
        <Card className="rounded-xl border-none shadow-xl bg-card">
          <CardHeader className="p-6 pb-2">
            <CardTitle className="text-sm font-semibold">Expense Breakdown</CardTitle>
            <CardDescription className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40">
              {new Date(selectedMonth + "-01").toLocaleString(locale, { month: "long", year: "numeric" })}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            {expensePieData.length === 0 ? (
              <div className="py-12 text-center opacity-20">
                <PieIcon className="w-10 h-10 mx-auto mb-2" />
                <p className="text-xs font-semibold uppercase">No expenses this month</p>
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={expensePieData}
                      cx="50%" cy="50%"
                      innerRadius={50} outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {expensePieData.map(entry => (
                        <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || "#64748b"} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
                      formatter={(v: number) => [format(v), ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-2">
                  {expensePieData.map(entry => (
                    <div key={entry.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORY_COLORS[entry.name] || "#64748b" }} />
                        <span className="text-muted-foreground">{entry.name}</span>
                      </div>
                      <span className="font-semibold">{format(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Expense Table */}
        <Card className="lg:col-span-2 rounded-xl border-none shadow-xl bg-card overflow-hidden">
          <CardHeader className="p-6 pb-4 border-b border-border/5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-sm font-semibold">All Expenses</CardTitle>
                <CardDescription className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-40">{filteredExpenses.length} entries</CardDescription>
              </div>
            </div>
            {/* Category filter pills */}
            <div className="flex flex-wrap gap-2 pt-3">
              {["All", ...EXPENSE_CATEGORIES].map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-colors border",
                    categoryFilter === cat
                      ? "bg-primary text-white border-primary"
                      : "bg-muted/30 text-muted-foreground border-border/20 hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </CardHeader>
          <div className="overflow-y-auto max-h-[420px]">
            {filteredExpenses.length === 0 ? (
              <div className="py-20 text-center opacity-20 space-y-2">
                <Receipt className="w-12 h-12 mx-auto" />
                <p className="text-xs font-semibold uppercase">No expenses found</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="bg-muted/20 border-b border-border/5">
                    {["Date", "Category", "Description", "Amount", "Payment", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-[9px] font-semibold uppercase text-left opacity-30">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/5">
                  {filteredExpenses.map(exp => (
                    <motion.tr
                      key={exp.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="group hover:bg-muted/10 transition-colors"
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {isoToDate(exp.date).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[9px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
                          style={{
                            background: `${CATEGORY_COLORS[exp.category] || "#64748b"}20`,
                            color: CATEGORY_COLORS[exp.category] || "#64748b"
                          }}
                        >
                          {exp.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground max-w-[160px] truncate">{exp.description || "—"}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-500">- {format(exp.amount)}</td>
                      <td className="px-4 py-3">
                        <span className="text-[9px] font-semibold uppercase tracking-widest bg-muted/40 px-2 py-1 rounded-full">
                          {exp.paymentMode}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                          onClick={() => handleDeleteExpense(exp.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {/* ── Add Expense Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Add Expense</DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase opacity-40">Record a new business expense</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddExpense} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase opacity-40">Category</Label>
                <select
                  value={newExpense.category}
                  onChange={e => setNewExpense({ ...newExpense, category: e.target.value })}
                  className="w-full rounded-xl h-11 bg-muted/20 border-none px-3 text-sm font-medium text-foreground"
                >
                  {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase opacity-40">Amount ({symbol})</Label>
                <Input
                  type="number" min="1" value={newExpense.amount || ""}
                  onChange={e => setNewExpense({ ...newExpense, amount: Number(e.target.value) })}
                  className="rounded-xl h-11 bg-muted/20 border-none" placeholder="0" required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase opacity-40">Description</Label>
              <Input
                value={newExpense.description}
                onChange={e => setNewExpense({ ...newExpense, description: e.target.value })}
                className="rounded-xl h-11 bg-muted/20 border-none"
                placeholder="e.g. Monthly electricity bill"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase opacity-40">Date</Label>
                <Input
                  type="date" value={newExpense.date}
                  onChange={e => setNewExpense({ ...newExpense, date: e.target.value })}
                  className="rounded-xl h-11 bg-muted/20 border-none text-sm" required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase opacity-40">Payment Mode</Label>
                <select
                  value={newExpense.paymentMode}
                  onChange={e => setNewExpense({ ...newExpense, paymentMode: e.target.value })}
                  className="w-full rounded-xl h-11 bg-muted/20 border-none px-3 text-sm font-medium text-foreground"
                >
                  {PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-12 rounded-2xl bg-primary text-white font-semibold uppercase tracking-widest shadow-xl shadow-primary/20"
            >
              Save Expense
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
