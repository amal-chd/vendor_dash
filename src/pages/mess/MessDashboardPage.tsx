import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChefHat,
  Calendar,
  Users,
  UtensilsCrossed,
  Wallet,
  ImageIcon,
  Clock,
  MapPin,
  Phone,
  MessageSquare,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Filter,
  Search,
  Sparkles,
  ArrowUpRight,
  ExternalLink,
  ShieldCheck,
  Building2,
  LogOut,
  RefreshCw,
  Sliders,
  DollarSign,
  Sun,
  Sunset,
  Moon,
  Check,
  X,
  PackageCheck,
  Truck,
  Bike,
  Flame,
  Award,
} from "lucide-react";
import { collection, doc, onSnapshot, query, where, updateDoc, setDoc, addDoc, serverTimestamp, getDocs, orderBy, limit } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { signOutWeb } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { KitchenPhotos } from "@/components/mess/KitchenPhotos";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────
export interface MessPlan {
  id: string;
  name: string;
  durationDays: number;
  pricePaise: number;
  meals: string[]; // "breakfast" | "lunch" | "dinner"
  vegOnly: boolean;
  active: boolean;
  description?: string;
  createdAt?: any;
}

export interface MessSubscription {
  id: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerArea?: string;
  roomOrFlat?: string;
  planName?: string;
  meals?: string[];
  vegOnly?: boolean;
  startDate?: any;
  endDate?: any;
  skippedDays?: string[];
  status: "active" | "paused" | "expired" | "cancelled";
  deliveryStatus?: "pending" | "ready" | "out_for_delivery" | "delivered";
  dietPreference?: "veg" | "nonveg";
  pricePaise?: number;
  kitchenId: string;
}

export interface MessSettlement {
  id: string;
  periodStart: string;
  periodEnd: string;
  daysServed: number;
  planEarningsPaise: number;
  kadaFeePaise: number;
  netPayoutPaise: number;
  status: "paid" | "processing" | "pending";
  payoutDate?: string;
  reference?: string;
}

export interface WeeklyMenuItem {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  special?: string;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export default function MessDashboardPage() {
  const { user, isMess } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"today" | "subscribers" | "plans" | "menu" | "money" | "settings">("today");

  // Data states
  const [kitchenData, setKitchenData] = useState<any>(null);
  const [subscriptions, setSubscriptions] = useState<MessSubscription[]>([]);
  const [plans, setPlans] = useState<MessPlan[]>([]);
  const [settlements, setSettlements] = useState<MessSettlement[]>([]);
  const [weeklyMenu, setWeeklyMenu] = useState<Record<string, WeeklyMenuItem>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [mealFilter, setMealFilter] = useState<string>("all");
  const [dietFilter, setDietFilter] = useState<string>("all");

  // Plan editor modal state
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MessPlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [planDuration, setPlanDuration] = useState("30");
  const [planPrice, setPlanPrice] = useState("");
  const [planMeals, setPlanMeals] = useState<string[]>(["lunch"]);
  const [planVegOnly, setPlanVegOnly] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  // Helper date key
  const todayKey = useMemo(() => {
    const now = new Date();
    // India offset
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
  }, []);

  const dayOfWeekToday = useMemo(() => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[new Date().getDay()];
  }, []);

  // ── 1. Listen to Mess Kitchen document ──────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "mess_kitchens", user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setKitchenData(data);
        if (data.weeklyMenu) {
          setWeeklyMenu(data.weeklyMenu);
        }
      }
      setLoading(false);
    }, (err) => {
      console.error("Failed to load mess kitchen data:", err);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  // ── 2. Listen to Subscriptions ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "mess_subscriptions"),
      where("kitchenId", "==", user.uid),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: MessSubscription[] = snap.docs.map((d) => {
        const val = d.data();
        return {
          id: d.id,
          customerName: val.customer?.name || val.customerName || "Subscriber",
          customerPhone: val.customer?.phone || val.customerPhone || "",
          customerAddress: val.customer?.address || val.address || "",
          customerArea: val.customer?.area || val.area || "",
          roomOrFlat: val.customer?.roomOrFlat || val.roomOrFlat || "",
          planName: val.plan?.name || val.planName || "Monthly Meal Plan",
          meals: val.plan?.meals || val.meals || ["lunch"],
          vegOnly: val.plan?.vegOnly ?? val.vegOnly ?? false,
          startDate: val.startDate,
          endDate: val.endDate,
          skippedDays: val.skippedDays || [],
          status: val.status || "active",
          deliveryStatus: val.deliveryStatus || "pending",
          dietPreference: val.dietPreference || (val.plan?.vegOnly ? "veg" : "nonveg"),
          pricePaise: val.plan?.pricePaise || val.pricePaise || 0,
          kitchenId: val.kitchenId,
        };
      });
      setSubscriptions(list);
    }, (err) => {
      console.error("Failed to load subscriptions:", err);
    });

    return () => unsub();
  }, [user]);

  // ── 3. Listen to Plans ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "mess_kitchens", user.uid, "plans"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: MessPlan[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || "Meal Plan",
            durationDays: Number(data.durationDays) || 30,
            pricePaise: Number(data.pricePaise) || 0,
            meals: data.meals || ["lunch"],
            vegOnly: Boolean(data.vegOnly),
            active: data.active !== false,
            description: data.description || "",
            createdAt: data.createdAt,
          };
        });
        setPlans(list);
      },
      (err) => console.error("[MessDashboardPage] plans listener failed", err),
    );

    return () => unsub();
  }, [user]);

  // ── 4. Listen to Settlements ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "mess_settlements"),
      where("kitchenId", "==", user.uid),
      limit(60)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: MessSettlement[] = snap.docs.map((d) => {
          const val = d.data();
          const paise = (key: string, rupKey: string) => {
            if (val[key] != null) return Number(val[key]);
            return Math.round((Number(val[rupKey]) || 0) * 100);
          };
          return {
            id: d.id,
            periodStart: val.periodStart || "",
            periodEnd: val.periodEnd || "",
            daysServed: Number(val.daysServed) || 0,
            planEarningsPaise: paise("planEarningsPaise", "planEarnings"),
            kadaFeePaise: paise("kadaFeePaise", "kadaFee"),
            netPayoutPaise: paise("netPayoutPaise", "netPayout"),
            status: val.status || "paid",
            payoutDate: val.payoutDate,
            reference: val.reference,
          };
        });
        // Sort newest period first
        list.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
        setSettlements(list);
      },
      (err) => console.error("[MessDashboardPage] settlements listener failed", err),
    );

    return () => unsub();
  }, [user]);

  // ── Computed Headcounts for Today ────────────────────────────────────────
  const todaySubscribers = useMemo(() => {
    return subscriptions.filter((s) => {
      if (s.status !== "active") return false;
      // Check skipped today
      const isSkipped = s.skippedDays?.includes(todayKey);
      return !isSkipped;
    });
  }, [subscriptions, todayKey]);

  const todaySkippedCount = useMemo(() => {
    return subscriptions.filter((s) => s.status === "active" && s.skippedDays?.includes(todayKey)).length;
  }, [subscriptions, todayKey]);

  const mealHeadcounts = useMemo(() => {
    let breakfast = 0;
    let lunch = 0;
    let dinner = 0;
    let veg = 0;
    let nonveg = 0;

    todaySubscribers.forEach((s) => {
      if (s.meals?.includes("breakfast")) breakfast++;
      if (s.meals?.includes("lunch")) lunch++;
      if (s.meals?.includes("dinner")) dinner++;

      if (s.vegOnly || s.dietPreference === "veg") {
        veg++;
      } else {
        nonveg++;
      }
    });

    return { breakfast, lunch, dinner, total: breakfast + lunch + dinner, veg, nonveg };
  }, [todaySubscribers]);

  // Filtered subscribers for Today roster
  const filteredTodayRoster = useMemo(() => {
    return subscriptions.filter((s) => {
      if (s.status !== "active") return false;

      // Filter by meal
      if (mealFilter !== "all" && !s.meals?.includes(mealFilter)) {
        return false;
      }
      // Filter by diet
      if (dietFilter === "veg" && !(s.vegOnly || s.dietPreference === "veg")) {
        return false;
      }
      if (dietFilter === "nonveg" && (s.vegOnly || s.dietPreference === "veg")) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = s.customerName?.toLowerCase().includes(q);
        const phoneMatch = s.customerPhone?.includes(q);
        const addressMatch = s.customerAddress?.toLowerCase().includes(q) || s.customerArea?.toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !addressMatch) return false;
      }

      return true;
    });
  }, [subscriptions, mealFilter, dietFilter, searchQuery]);

  // ── Plan Management Handlers ────────────────────────────────────────────
  const openNewPlanModal = () => {
    setEditingPlan(null);
    setPlanName("");
    setPlanDuration("30");
    setPlanPrice("");
    setPlanMeals(["lunch"]);
    setPlanVegOnly(false);
    setPlanModalOpen(true);
  };

  const openEditPlanModal = (p: MessPlan) => {
    setEditingPlan(p);
    setPlanName(p.name);
    setPlanDuration(String(p.durationDays));
    setPlanPrice(String(Math.round(p.pricePaise / 100)));
    setPlanMeals(p.meals);
    setPlanVegOnly(p.vegOnly);
    setPlanModalOpen(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!planName.trim()) return toast.error("Please enter a plan name.");
    const price = Number(planPrice);
    if (!price || price < 100) return toast.error("Price must be at least ₹100.");
    const duration = Number(planDuration);
    if (!duration || duration < 1 || duration > 31) return toast.error("Duration must be between 1 and 31 days.");
    if (planMeals.length === 0) return toast.error("Select at least one meal.");

    setSavingPlan(true);
    try {
      const planData = {
        name: planName.trim(),
        durationDays: duration,
        pricePaise: Math.round(price * 100),
        meals: planMeals,
        vegOnly: planVegOnly,
        active: editingPlan ? editingPlan.active : true,
        updatedAt: serverTimestamp(),
      };

      if (editingPlan) {
        await updateDoc(doc(db, "mess_kitchens", user.uid, "plans", editingPlan.id), planData);
        toast.success("Meal plan updated!");
      } else {
        await addDoc(collection(db, "mess_kitchens", user.uid, "plans"), {
          ...planData,
          createdAt: serverTimestamp(),
        });
        toast.success("New meal plan added!");
      }
      setPlanModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save meal plan.");
    } finally {
      setSavingPlan(false);
    }
  };

  const handleTogglePlan = async (planId: string, currentActive: boolean) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "mess_kitchens", user.uid, "plans", planId), {
        active: !currentActive,
      });
      toast.success(currentActive ? "Plan paused" : "Plan activated!");
    } catch (err: any) {
      toast.error("Failed to update status.");
    }
  };

  // ── Delivery Status Toggle for Today ────────────────────────────────────
  const handleUpdateDeliveryStatus = async (
    subId: string,
    currentStatus: "pending" | "ready" | "out_for_delivery" | "delivered"
  ) => {
    const nextStatusMap: Record<string, "pending" | "ready" | "out_for_delivery" | "delivered"> = {
      pending: "ready",
      ready: "out_for_delivery",
      out_for_delivery: "delivered",
      delivered: "pending",
    };
    const next = nextStatusMap[currentStatus] || "ready";
    try {
      await updateDoc(doc(db, "mess_subscriptions", subId), {
        deliveryStatus: next,
      });
      toast.success(`Updated status to: ${next.replace(/_/g, " ")}`);
    } catch (err) {
      toast.error("Could not update status.");
    }
  };

  // ── Weekly Menu Save Handler ────────────────────────────────────────────
  const handleSaveWeeklyMenu = async (day: string, field: "breakfast" | "lunch" | "dinner" | "special", val: string) => {
    if (!user) return;
    const updated = {
      ...weeklyMenu,
      [day]: {
        ...(weeklyMenu[day] || {}),
        [field]: val,
      },
    };
    setWeeklyMenu(updated);
    try {
      await setDoc(doc(db, "mess_kitchens", user.uid), { weeklyMenu: updated }, { merge: true });
    } catch {
      // Background auto-save
    }
  };

  const onboardingState = kitchenData?.onboarding?.state || "started";
  const isApproved = ["approved", "active"].includes(onboardingState);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-slate-950/80 backdrop-blur-xl px-4 lg:px-8 py-3.5">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/10">
              <ChefHat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-lg tracking-tight text-white">
                  {kitchenData?.name || "Kada Mess Kitchen"}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border",
                    isApproved
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : "bg-amber-500/15 border-amber-500/30 text-amber-400"
                  )}
                >
                  {isApproved ? "Live Kitchen" : "Verification in Progress"}
                </Badge>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span>Kada Mess Dashboard</span>
                <span>•</span>
                <span className="text-emerald-400 font-semibold">{todaySubscribers.length} active plates today</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              to="/setup?type=mess"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>KYC & Setup</span>
            </Link>
            <button
              onClick={() => {
                signOutWeb();
                navigate("/login");
              }}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Status Banner (if not active yet) ──────────────────────────────── */}
      {!isApproved && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-xs text-amber-300">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Your kitchen documents are under review. You can set up meal plans, schedules, and test subscriptions in the meantime.
              </span>
            </div>
            <Link
              to="/setup?type=mess"
              className="font-black text-amber-400 underline hover:text-amber-300 shrink-0"
            >
              View KYC Status →
            </Link>
          </div>
        </div>
      )}

      {/* ── Main Container ────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* KPI Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          {/* Stat 1: Today Plates */}
          <Card className="bg-white/[0.03] border-white/[0.08] text-white">
            <CardContent className="p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <UtensilsCrossed className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Meals Today</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black tracking-tight">{mealHeadcounts.total}</span>
                  <span className="text-xs text-slate-400 font-medium">plates</span>
                </div>
                <p className="text-[10px] text-emerald-400 font-bold mt-0.5">
                  {mealHeadcounts.veg} Veg · {mealHeadcounts.nonveg} Non-Veg
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Stat 2: Active Subscribers */}
          <Card className="bg-white/[0.03] border-white/[0.08] text-white">
            <CardContent className="p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Subscribers</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black tracking-tight">
                    {subscriptions.filter((s) => s.status === "active").length}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">active</span>
                </div>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  Across {plans.filter((p) => p.active).length} published plans
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Stat 3: Paused / Skipped */}
          <Card className="bg-white/[0.03] border-white/[0.08] text-white">
            <CardContent className="p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Skipped Today</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black tracking-tight text-amber-400">{todaySkippedCount}</span>
                  <span className="text-xs text-slate-400 font-medium">paused</span>
                </div>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">Zero food waste recorded</p>
              </div>
            </CardContent>
          </Card>

          {/* Stat 4: Next Settlement */}
          <Card className="bg-white/[0.03] border-white/[0.08] text-white">
            <CardContent className="p-4 flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Net Settlements</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black tracking-tight">
                    ₹{((settlements[0]?.netPayoutPaise || 0) / 100).toLocaleString("en-IN")}
                  </span>
                </div>
                <p className="text-[10px] text-purple-400 font-bold mt-0.5">
                  Weekly direct bank payouts
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tab Navigation Navigation Bar */}
        <div className="flex items-center border-b border-white/[0.08] gap-1 overflow-x-auto pb-1 scrollbar-none">
          {[
            { id: "today", label: "Today's Kitchen Run", icon: UtensilsCrossed, badge: mealHeadcounts.total },
            { id: "subscribers", label: "Subscribers", icon: Users, badge: subscriptions.length },
            { id: "plans", label: "Meal Plans", icon: Award, badge: plans.length },
            { id: "menu", label: "Weekly Menu Schedule", icon: Calendar },
            { id: "money", label: "Earnings & Settlements", icon: Wallet },
            { id: "settings", label: "Kitchen Photos", icon: ImageIcon },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-black transition-all relative shrink-0",
                  active
                    ? "text-emerald-400 bg-white/[0.06]"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                )}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={cn(
                      "px-1.5 py-0.2 rounded-full text-[10px] font-bold",
                      active ? "bg-emerald-500 text-slate-950 font-black" : "bg-white/10 text-slate-300"
                    )}
                  >
                    {tab.badge}
                  </span>
                )}
                {active && (
                  <motion.div
                    layoutId="activeMessTab"
                    className="absolute bottom-0 left-2 right-2 h-0.5 bg-emerald-400 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* ── TAB 1: Today's Kitchen Run ────────────────────────────────────── */}
        {activeTab === "today" && (
          <div className="space-y-5">
            {/* Meal Headcount Overview Strip */}
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2.5">
                  <Sun className="w-4 h-4 text-amber-400" />
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400">Breakfast</span>
                    <p className="text-base font-black text-white">{mealHeadcounts.breakfast} plates</p>
                  </div>
                </div>
                <div className="h-6 w-px bg-white/10" />
                <div className="flex items-center gap-2.5">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400">Lunch</span>
                    <p className="text-base font-black text-white">{mealHeadcounts.lunch} plates</p>
                  </div>
                </div>
                <div className="h-6 w-px bg-white/10" />
                <div className="flex items-center gap-2.5">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400">Dinner</span>
                    <p className="text-base font-black text-white">{mealHeadcounts.dinner} plates</p>
                  </div>
                </div>
              </div>

              {/* Today's Menu Highlight */}
              {weeklyMenu[dayOfWeekToday] && (
                <div className="text-right text-xs text-slate-400">
                  <span className="text-[10px] uppercase font-bold text-emerald-400">Today's Special ({dayOfWeekToday}): </span>
                  <span className="font-semibold text-white">
                    {weeklyMenu[dayOfWeekToday].special || weeklyMenu[dayOfWeekToday].lunch || "Homely Meal"}
                  </span>
                </div>
              )}
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search customer, phone, room or hostel..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 text-xs font-semibold rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto">
                {/* Meal filter pills */}
                <div className="inline-flex items-center rounded-xl bg-white/[0.04] p-1 border border-white/10 text-xs">
                  {["all", "breakfast", "lunch", "dinner"].map((m) => (
                    <button
                      key={m}
                      onClick={() => setMealFilter(m)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg font-bold capitalize transition-all",
                        mealFilter === m ? "bg-emerald-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {/* Diet filter pills */}
                <div className="inline-flex items-center rounded-xl bg-white/[0.04] p-1 border border-white/10 text-xs">
                  {["all", "veg", "nonveg"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setDietFilter(d)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg font-bold capitalize transition-all",
                        dietFilter === d ? "bg-white text-slate-950 shadow" : "text-slate-400 hover:text-white"
                      )}
                    >
                      {d === "veg" ? "Pure Veg" : d === "nonveg" ? "Non-Veg" : "All Diets"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Roster Cards / Table */}
            {filteredTodayRoster.length === 0 ? (
              <div className="p-12 text-center rounded-3xl border border-white/10 bg-white/[0.02]">
                <UtensilsCrossed className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="font-bold text-base text-white">No active meals to prepare</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Either everyone has skipped today or no subscriptions match the current filter.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredTodayRoster.map((sub) => {
                  const isSkippedToday = sub.skippedDays?.includes(todayKey);
                  const isVeg = sub.vegOnly || sub.dietPreference === "veg";

                  return (
                    <div
                      key={sub.id}
                      className={cn(
                        "p-4 rounded-2xl border transition-all flex flex-col justify-between",
                        isSkippedToday
                          ? "bg-amber-500/[0.04] border-amber-500/20 opacity-75"
                          : "bg-white/[0.03] border-white/[0.08] hover:border-white/20"
                      )}
                    >
                      <div>
                        {/* Top row */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-sm text-white">{sub.customerName}</span>
                              <span
                                className={cn(
                                  "w-2.5 h-2.5 rounded-full",
                                  isVeg ? "bg-emerald-400 border border-emerald-300" : "bg-rose-400 border border-rose-300"
                                )}
                                title={isVeg ? "Pure Veg" : "Non-Veg"}
                              />
                            </div>
                            <span className="text-[11px] text-slate-400">{sub.planName}</span>
                          </div>

                          {isSkippedToday ? (
                            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] font-black uppercase">
                              Skipped Today
                            </Badge>
                          ) : (
                            <Badge
                              className={cn(
                                "text-[10px] font-black uppercase tracking-wider",
                                sub.deliveryStatus === "delivered"
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                  : sub.deliveryStatus === "out_for_delivery"
                                  ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                                  : "bg-white/10 text-slate-300 border-white/10"
                              )}
                            >
                              {sub.deliveryStatus ? sub.deliveryStatus.replace(/_/g, " ") : "Pending Prep"}
                            </Badge>
                          )}
                        </div>

                        {/* Address & details */}
                        <div className="space-y-1 text-xs text-slate-300 mt-2">
                          {sub.customerAddress && (
                            <div className="flex items-start gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                              <span className="line-clamp-2">
                                {sub.roomOrFlat ? `${sub.roomOrFlat}, ` : ""}
                                {sub.customerAddress}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Meals:</span>
                            <span className="text-[11px] font-bold text-emerald-400 uppercase">
                              {sub.meals?.join(" · ")}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Bottom actions */}
                      <div className="mt-4 pt-3 border-t border-white/[0.08] flex items-center justify-between gap-2">
                        {sub.customerPhone ? (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`tel:${sub.customerPhone}`}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition-colors"
                              title="Call customer"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                            <a
                              href={`https://wa.me/${sub.customerPhone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                              title="WhatsApp"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ) : (
                          <span />
                        )}

                        {!isSkippedToday && (
                          <button
                            type="button"
                            onClick={() => handleUpdateDeliveryStatus(sub.id, sub.deliveryStatus || "pending")}
                            className={cn(
                              "text-xs font-black px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5",
                              sub.deliveryStatus === "delivered"
                                ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                                : sub.deliveryStatus === "out_for_delivery"
                                ? "bg-blue-600 text-white hover:bg-blue-500"
                                : "bg-white/10 text-white hover:bg-white/20"
                            )}
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            <span>
                              {sub.deliveryStatus === "delivered"
                                ? "Delivered ✓"
                                : sub.deliveryStatus === "out_for_delivery"
                                ? "Out for Delivery"
                                : "Mark Ready"}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: Subscribers Hub ────────────────────────────────────────── */}
        {activeTab === "subscribers" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-base text-white">Subscriber Directory</h3>
                <p className="text-xs text-slate-400">
                  Manage customer meal subscriptions, pause dates and contacts.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter subscribers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 text-xs font-semibold rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>

            {subscriptions.length === 0 ? (
              <div className="p-12 text-center rounded-3xl border border-white/10 bg-white/[0.02]">
                <Users className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="font-bold text-base text-white">No subscribers yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  When customers subscribe to your meal plans from the Kada app, they will appear right here.
                </p>
              </div>
            ) : (
              <div className="border border-white/10 rounded-2xl overflow-hidden bg-white/[0.02]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.04] text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-white/[0.08]">
                      <tr>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Plan</th>
                        <th className="px-4 py-3">Diet</th>
                        <th className="px-4 py-3">Meals</th>
                        <th className="px-4 py-3">Address</th>
                        <th className="px-4 py-3">Skips</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] text-slate-200 font-medium">
                      {subscriptions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 font-bold text-white">
                            <div>{sub.customerName}</div>
                            <div className="text-[11px] text-slate-400 font-normal">{sub.customerPhone}</div>
                          </td>
                          <td className="px-4 py-3 font-semibold">{sub.planName}</td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-black uppercase",
                                sub.vegOnly || sub.dietPreference === "veg"
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              )}
                            >
                              {sub.vegOnly || sub.dietPreference === "veg" ? "Veg" : "Non-Veg"}
                            </span>
                          </td>
                          <td className="px-4 py-3 uppercase text-[10px] font-bold text-slate-300">
                            {sub.meals?.join(", ")}
                          </td>
                          <td className="px-4 py-3 max-w-[200px] truncate text-slate-400">
                            {sub.customerAddress || "—"}
                          </td>
                          <td className="px-4 py-3 text-amber-400 font-bold">
                            {sub.skippedDays?.length || 0} days
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={cn(
                                "text-[10px] uppercase font-black",
                                sub.status === "active"
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                  : "bg-white/10 text-slate-400 border-white/10"
                              )}
                            >
                              {sub.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {sub.customerPhone && (
                              <div className="inline-flex items-center gap-1.5">
                                <a
                                  href={`tel:${sub.customerPhone}`}
                                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300"
                                  title="Call"
                                >
                                  <Phone className="w-3.5 h-3.5" />
                                </a>
                                <a
                                  href={`https://wa.me/${sub.customerPhone.replace(/\D/g, "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400"
                                  title="WhatsApp"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: Meal Plans ────────────────────────────────────────────── */}
        {activeTab === "plans" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-white">Your Meal Plans</h3>
                <p className="text-xs text-slate-400">
                  Customers in your area can browse and subscribe to these plans directly on Kada.
                </p>
              </div>

              <Button
                onClick={openNewPlanModal}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs gap-1.5 rounded-xl"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Plan</span>
              </Button>
            </div>

            {plans.length === 0 ? (
              <div className="p-12 text-center rounded-3xl border border-white/10 bg-white/[0.02]">
                <Award className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="font-bold text-base text-white">No meal plans created yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 mb-4">
                  Add your first meal plan (e.g. Monthly Lunch, 30 days, ₹2,800) so customers can subscribe.
                </p>
                <Button
                  onClick={openNewPlanModal}
                  className="bg-emerald-500 text-slate-950 font-black text-xs rounded-xl"
                >
                  Create Your First Plan
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {plans.map((p) => {
                  const priceRupees = Math.round(p.pricePaise / 100);
                  const pricePerDay = Math.round(priceRupees / (p.durationDays || 30));

                  return (
                    <div
                      key={p.id}
                      className="p-5 rounded-3xl border border-white/10 bg-white/[0.03] flex flex-col justify-between space-y-4 hover:border-white/20 transition-colors"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="font-black text-base text-white">{p.name}</h4>
                          <Switch
                            checked={p.active}
                            onCheckedChange={() => handleTogglePlan(p.id, p.active)}
                            aria-label="Toggle plan active"
                          />
                        </div>

                        <div className="flex items-center gap-2 mb-3">
                          <span
                            className={cn(
                              "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                              p.vegOnly
                                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                                : "bg-white/10 border-white/15 text-slate-300"
                            )}
                          >
                            {p.vegOnly ? "Pure Veg" : "Veg & Non-Veg"}
                          </span>
                          <span className="text-xs text-slate-400 font-semibold">
                            {p.meals.map((m) => m[0].toUpperCase() + m.substring(1)).join(" · ")}
                          </span>
                        </div>

                        <div className="flex items-baseline gap-1.5 my-3">
                          <span className="text-3xl font-black text-white">₹{priceRupees.toLocaleString("en-IN")}</span>
                          <span className="text-xs text-slate-400 font-medium">/ {p.durationDays} days</span>
                        </div>

                        <p className="text-[11px] text-emerald-400 font-bold">
                          ≈ ₹{pricePerDay} per meal day
                        </p>
                      </div>

                      <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between">
                        <span
                          className={cn(
                            "text-[11px] font-bold uppercase",
                            p.active ? "text-emerald-400" : "text-slate-500"
                          )}
                        >
                          {p.active ? "● Live on Kada" : "Paused"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditPlanModal(p)}
                          className="text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 rounded-lg gap-1"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: Weekly Menu Schedule ─────────────────────────────────── */}
        {activeTab === "settings" && user && (
          <div className="space-y-4 max-w-xl">
            <div>
              <h3 className="font-bold text-base text-white">Kitchen photos</h3>
              <p className="text-xs text-slate-400">
                Your logo and cover photo appear on Kada Mess and your kitchen page. Use your real kitchen and food.
              </p>
            </div>
            <KitchenPhotos
              kitchenId={user.uid}
              logoUrl={kitchenData?.logoUrl}
              coverImage={kitchenData?.coverImage}
            />
          </div>
        )}

        {activeTab === "menu" && (
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-base text-white">Weekly Kitchen Menu (What's Cooking)</h3>
              <p className="text-xs text-slate-400">
                Keep your weekly meal schedule updated so your subscribers know what delicious food is being prepared each day.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {DAYS_OF_WEEK.map((day) => {
                const isToday = day === dayOfWeekToday;
                const menu = weeklyMenu[day] || {};

                return (
                  <div
                    key={day}
                    className={cn(
                      "p-4 rounded-2xl border transition-all space-y-3",
                      isToday
                        ? "bg-emerald-500/[0.06] border-emerald-500/30"
                        : "bg-white/[0.03] border-white/10"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-black text-sm text-white flex items-center gap-2">
                        <span>{day}</span>
                        {isToday && (
                          <Badge className="bg-emerald-500 text-slate-950 font-black text-[9px] uppercase px-1.5 py-0">
                            Today
                          </Badge>
                        )}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <Label className="text-[10px] font-black uppercase text-amber-400 tracking-wider">Breakfast</Label>
                        <input
                          type="text"
                          placeholder="e.g. Idli, Sambar & Coconut Chutney"
                          value={menu.breakfast || ""}
                          onChange={(e) => handleSaveWeeklyMenu(day, "breakfast", e.target.value)}
                          className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg bg-white/[0.04] border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] font-black uppercase text-orange-400 tracking-wider">Lunch</Label>
                        <input
                          type="text"
                          placeholder="e.g. Rice, Sambar, Thoran, Fish Curry / Aviyal"
                          value={menu.lunch || ""}
                          onChange={(e) => handleSaveWeeklyMenu(day, "lunch", e.target.value)}
                          className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg bg-white/[0.04] border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] font-black uppercase text-indigo-400 tracking-wider">Dinner</Label>
                        <input
                          type="text"
                          placeholder="e.g. Chapati with Chicken Curry / Veg Kurma"
                          value={menu.dinner || ""}
                          onChange={(e) => handleSaveWeeklyMenu(day, "dinner", e.target.value)}
                          className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg bg-white/[0.04] border border-white/10 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TAB 5: Settlements & Money ────────────────────────────────────── */}
        {activeTab === "money" && (
          <div className="space-y-5">
            <div>
              <h3 className="font-bold text-base text-white">Earnings & Weekly Settlements</h3>
              <p className="text-xs text-slate-400">
                Kada calculates your net payouts every week based on actual meals served, deducting the transparent platform fee of ₹3 per customer/day.
              </p>
            </div>

            {/* Fee Transparency Box */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 text-xs flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-black text-white text-sm">Transparent Kada Partner Fee</p>
                  <p className="text-slate-300">
                    Exactly ₹3 per customer per day served. No hidden percentages, and zero commission deducted on days a customer pauses/skips.
                  </p>
                </div>
              </div>
            </div>

            {/* Settlements History Table */}
            {settlements.length === 0 ? (
              <div className="p-12 text-center rounded-3xl border border-white/10 bg-white/[0.02]">
                <Wallet className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="font-bold text-base text-white">No settlements yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Settlements are processed weekly after customer subscriptions begin serving meals.
                </p>
              </div>
            ) : (
              <div className="border border-white/10 rounded-2xl overflow-hidden bg-white/[0.02]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.04] text-slate-400 font-bold uppercase tracking-wider text-[10px] border-b border-white/[0.08]">
                      <tr>
                        <th className="px-4 py-3">Settlement Period</th>
                        <th className="px-4 py-3">Days Served</th>
                        <th className="px-4 py-3">Gross Earnings</th>
                        <th className="px-4 py-3">Kada Fee</th>
                        <th className="px-4 py-3">Net Payout</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] text-slate-200 font-medium">
                      {settlements.map((s) => (
                        <tr key={s.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 font-bold text-white">
                            {s.periodStart} to {s.periodEnd}
                          </td>
                          <td className="px-4 py-3">{s.daysServed} days</td>
                          <td className="px-4 py-3 font-semibold">
                            ₹{(s.planEarningsPaise / 100).toLocaleString("en-IN")}
                          </td>
                          <td className="px-4 py-3 text-rose-400 font-semibold">
                            -₹{(s.kadaFeePaise / 100).toLocaleString("en-IN")}
                          </td>
                          <td className="px-4 py-3 text-emerald-400 font-black text-sm">
                            ₹{(s.netPayoutPaise / 100).toLocaleString("en-IN")}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={cn(
                                "text-[10px] uppercase font-black",
                                s.status === "paid"
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                  : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                              )}
                            >
                              {s.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── CREATE / EDIT PLAN MODAL ────────────────────────────────────── */}
      <Dialog open={planModalOpen} onOpenChange={setPlanModalOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-white">
              {editingPlan ? "Edit Meal Plan" : "Create New Meal Plan"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Set plan name, duration, included meals, and subscription price.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSavePlan} className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-slate-300 font-bold">Plan Name *</Label>
              <Input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="e.g. Monthly Executive Lunch"
                className="bg-white/[0.04] border-white/10 text-white placeholder:text-slate-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 font-bold">Duration (Days) *</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={planDuration}
                  onChange={(e) => setPlanDuration(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 font-bold">Total Price (₹) *</Label>
                <Input
                  type="number"
                  min="100"
                  step="10"
                  placeholder="e.g. 2800"
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                  className="bg-white/[0.04] border-white/10 text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-slate-300 font-bold">Meals Included *</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "breakfast", label: "Breakfast" },
                  { id: "lunch", label: "Lunch" },
                  { id: "dinner", label: "Dinner" },
                ].map((m) => {
                  const selected = planMeals.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setPlanMeals((prev) =>
                          prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]
                        )
                      }
                      className={cn(
                        "py-2 px-3 rounded-xl border text-xs font-bold transition-all",
                        selected
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                          : "bg-white/[0.02] border-white/10 text-slate-400"
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/10">
              <div>
                <Label className="text-white font-bold block">Pure Veg Only</Label>
                <span className="text-[11px] text-slate-400">Mark if this plan only serves vegetarian meals</span>
              </div>
              <Switch checked={planVegOnly} onCheckedChange={setPlanVegOnly} />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPlanModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingPlan}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black"
              >
                {savingPlan ? "Saving..." : editingPlan ? "Update Plan" : "Publish Plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
