import { Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, LayoutGrid, ShoppingCart, UtensilsCrossed, Grid3X3,
  ChefHat, Monitor, Package, Users, UserCircle, Megaphone,
  BarChart3, Settings, Wallet,
  LogOut, Store, Building2, PlugZap, PanelLeftClose, PanelLeftOpen,
  Calendar, CreditCard
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { StandardHeader } from "./StandardHeader";
import { BottomNav } from "./BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { auth } from "@/lib/firebase";
import { signOutWeb } from "@/lib/auth-flow";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/hooks/useNotifications";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect } from "react";

import { AlertCircle, Lock, ShieldAlert, Sparkles, Star, Zap, Rocket, Check, ArrowRight, BadgeCheck, Shield, Clock, AlertTriangle } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { OutletSwitcher } from "./dashboard/OutletSwitcher";
import { useSubscription } from "@/hooks/useSubscription";
import { startSubscriptionCheckout } from "@/lib/subscriptionCheckout";
import { SupportChatWidget } from "@/components/SupportChatWidget";
import { usePricing } from "@/hooks/usePricing";
import { Capability } from "@/constants/plans";

const PATH_CAPABILITY_MAP: Record<string, Capability> = {
  "/dashboard/kitchen": "predictive_kds",
  "/dashboard/customers": "cdp",
  "/dashboard/marketing": "marketing_automation",
  "/dashboard/integrations": "aggregator_integration",
  "/dashboard/expenses": "expense_tracking",
};

const STAFF_ROLE_ACCESS: Record<string, string[]> = {
  Kitchen: ["/dashboard/kitchen", "/dashboard/inventory"],
  Waiter: ["/dashboard/orders", "/dashboard/menu", "/dashboard/tables", "/dashboard/reservations"],
  Cashier: ["/dashboard/orders", "/dashboard/menu", "/dashboard/tables", "/dashboard/reservations", "/dashboard/pos", "/dashboard/expenses"],
  Manager: ["/dashboard", "/dashboard/orders", "/dashboard/menu", "/dashboard/tables", "/dashboard/reservations", "/dashboard/kitchen", "/dashboard/pos", "/dashboard/inventory", "/dashboard/staff", "/dashboard/customers", "/dashboard/reports", "/dashboard/expenses", "/dashboard/pricing"],
  Admin: ["/dashboard", "/dashboard/orders", "/dashboard/menu", "/dashboard/tables", "/dashboard/reservations", "/dashboard/kitchen", "/dashboard/pos", "/dashboard/inventory", "/dashboard/staff", "/dashboard/customers", "/dashboard/marketing", "/dashboard/integrations", "/dashboard/reports", "/dashboard/expenses", "/dashboard/settings", "/dashboard/pricing"],
};

const getNavGroups = (features: Record<string, boolean>, isOutlet: boolean = false, teamRole: string | null = null) => {
  const allowedPaths = teamRole ? (STAFF_ROLE_ACCESS[teamRole] || []) : null;

  const rawGroups = [
    {
      label: "Explore",
      items: [
        { label: "Home", icon: LayoutDashboard, path: "/dashboard" },
        { label: "Orders", icon: ShoppingCart, path: "/dashboard/orders" },
        { label: "Menu", icon: UtensilsCrossed, path: "/dashboard/menu" },
        { label: "Tables", icon: Grid3X3, path: "/dashboard/tables" },
        { label: "Reservations", icon: Calendar, path: "/dashboard/reservations" },
      ]
    },
    {
      label: "Operating",
      items: [
        ...(features.kds !== false ? [{ label: "Kitchen", icon: ChefHat, path: "/dashboard/kitchen" }] : []),
        { label: "Sell / POS", icon: Monitor, path: "/dashboard/pos" },
        { label: "Stock", icon: Package, path: "/dashboard/inventory" },
      ]
    },
    {
      label: "Cloud Kitchen",
      items: [
        ...(isOutlet ? [] : [{ label: "Outlets", icon: Building2, path: "/dashboard/outlets" }]),
        { label: "Kada Mess Kitchen", icon: ChefHat, path: "/mess/dashboard" },
      ]
    },
    {
      label: "Manage",
      items: [
        { label: "Team", icon: Users, path: "/dashboard/staff" },
        { label: "Guests", icon: UserCircle, path: "/dashboard/customers" },
        ...(features.marketing !== false ? [{ label: "Marketing", icon: Megaphone, path: "/dashboard/marketing" }] : []),
        { label: "Channels", icon: PlugZap, path: "/dashboard/integrations" },
        { label: "Reports", icon: BarChart3, path: "/dashboard/reports" },
        { label: "Expenses", icon: Wallet, path: "/dashboard/expenses" },
        { label: "Plans & Pricing", icon: CreditCard, path: "/dashboard/pricing" },
        { label: "Settings", icon: Settings, path: "/dashboard/settings" },
      ]
    },
  ];

  if (!allowedPaths) return rawGroups;

  return rawGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => allowedPaths.includes(item.path))
    }))
    .filter(group => group.items.length > 0);
};

// ── Subscription Expired Screen ────────────────────────────────────────────
function SubscriptionExpiredScreen({ onLogout }: { onLogout: () => void }) {
  const { plans } = usePricing();
  const [isAnnual, setIsAnnual] = useState(true);
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);

  // Renewal happens here on the web via Razorpay. The price is never sent from
  // the browser — `createSubscriptionOrder` reads it from the plan catalog
  // server-side, and entitlement is granted by the signature-verified webhook.
  const renew = async (planId: string) => {
    setCheckoutPlanId(planId);
    try {
      const err = await startSubscriptionCheckout({
        product: "dine",
        planId,
        period: isAnnual ? "yearly" : "monthly",
      });
      if (err && !err.startsWith("Payment received")) toast.error(err);
      else toast.success(err ?? "Payment received — restoring your access…");
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setCheckoutPlanId(null);
    }
  };

  const displayablePlans = plans.filter(p => p.monthlyPrice !== "Custom");

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto">
      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-blue-500/5 blur-3xl" />
      </div>

      <div className="min-h-screen flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center overflow-hidden p-0.5">
              <img src="/logo.png" alt="Kada Dine" className="w-full h-full object-contain" />
            </div>
            <span className="font-black text-lg tracking-tight text-white">Kada<span className="text-primary italic">Dine</span></span>
          </div>
          <button
            onClick={onLogout}
            className="text-xs font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors px-4 py-2 rounded-xl hover:bg-white/5"
          >
            Log Out
          </button>
        </div>

        {/* Hero */}
        <div className="text-center px-4 pt-12 pb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-rose-400 mb-6">
            <Lock className="h-3.5 w-3.5" />
            Subscription Ended
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-[1.08] mb-4">
            Your plan has <span className="text-primary">expired.</span>
          </h1>
          <p className="text-slate-400 text-lg font-medium max-w-xl mx-auto mb-8">
            Pick a plan below to restore full access. Your data is safe — nothing has been deleted.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1.5 gap-1 mb-10">
            <button
              onClick={() => setIsAnnual(false)}
              className={cn(
                "rounded-full px-5 py-2 text-sm font-bold transition-colors duration-200",
                !isAnnual ? "bg-white text-slate-950 shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={cn(
                "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition-colors duration-200",
                isAnnual ? "bg-white text-slate-950 shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              Annual
              <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider", isAnnual ? "bg-emerald-500 text-white" : "bg-emerald-500/20 text-emerald-400")}>
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="px-4 pb-8 max-w-4xl mx-auto w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
            {displayablePlans.map((plan, i) => {
              const isPopular = !!plan.popular;
              const price = isAnnual ? plan.annualPrice : plan.monthlyPrice;
              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.08 }}
                  className={cn(
                    "relative flex flex-col rounded-3xl border transition-all duration-300 h-full",
                    isPopular
                      ? "bg-white text-slate-950 border-white shadow-2xl shadow-white/10"
                      : "bg-white/[0.04] text-white border-white/10 hover:border-white/20"
                  )}
                >
                  {isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950 shadow-lg shadow-primary/30">
                      <Star className="h-3 w-3 fill-slate-950" /> Most Popular
                    </div>
                  )}
                  <div className="p-7 flex-1 flex flex-col">
                    <div className="mb-5">
                      <div className="flex items-center gap-2 mb-2">
                        {plan.id === "starter" && <Zap className="h-4 w-4 text-amber-400" />}
                        {plan.id === "growth" && <Rocket className="h-4 w-4 text-primary" />}
                        <span className={cn("text-xs font-black uppercase tracking-[0.18em]", isPopular ? "text-slate-500" : "text-slate-400")}>
                          {plan.name}
                        </span>
                      </div>
                      <p className={cn("text-sm font-medium", isPopular ? "text-slate-500" : "text-slate-400")}>
                        {plan.tagline}
                      </p>
                    </div>

                    <div className="mb-5 flex items-baseline gap-1">
                      <span className={cn("text-xl font-black", isPopular ? "text-slate-400" : "text-slate-500")}>₹</span>
                      <span className={cn("text-5xl font-black tracking-tighter leading-none", isPopular ? "text-slate-950" : "text-white")}>
                        {(price as number).toLocaleString("en-IN")}
                      </span>
                      <span className={cn("text-sm font-semibold ml-1", isPopular ? "text-slate-500" : "text-slate-400")}>
                        /mo{isAnnual && ", billed annually"}
                      </span>
                    </div>

                    <div className={cn("h-px mb-5", isPopular ? "bg-slate-200" : "bg-white/10")} />

                    <ul className="space-y-3 flex-1">
                      {plan.features.slice(0, 5).map((f) => (
                        <li key={f} className="flex items-start gap-3 text-sm leading-tight">
                          <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", isPopular ? "bg-slate-950 text-white" : "bg-white/10 text-white")}>
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                          </span>
                          <span className={cn("font-medium", isPopular ? "text-slate-700" : "text-slate-300")}>{f}</span>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      disabled={checkoutPlanId !== null}
                      onClick={() => renew(plan.id)}
                      className={cn(
                        "mt-6 w-full h-11 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed",
                        isPopular
                          ? "bg-slate-950 text-white hover:bg-slate-800"
                          : "bg-white text-slate-950 hover:bg-white/90"
                      )}
                    >
                      {checkoutPlanId === plan.id ? "Opening checkout…" : <><ArrowRight className="h-3.5 w-3.5" /> Renew {plan.name}</>}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Trust signals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            {[
              { icon: BadgeCheck, label: "Data Safe", sub: "Nothing deleted" },
              { icon: Shield, label: "Zero Lock-in", sub: "Cancel anytime" },
              { icon: Zap, label: "Instant Restore", sub: "Access in seconds" },
              { icon: Sparkles, label: "All Features", sub: "No restrictions" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
                  <item.icon className="h-4.5 w-4.5 text-primary" />
                </div>
                <p className="text-[11px] font-black uppercase tracking-widest text-white">{item.label}</p>
                <p className="text-[10px] font-medium text-slate-500">{item.sub}</p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-10 text-center space-y-2">
            <p className="text-slate-500 text-sm font-medium">
              Secure payment by Razorpay. Your Kada Dine mobile app unlocks
              automatically once payment is confirmed.
            </p>
            <p className="text-slate-600 text-xs font-medium">
              Need an invoice or a custom plan? Contact Kada support.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}



export default function DashboardLayout() {
  useNotifications();

  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const { hasCapability, plan } = useSubscription();
  // Always use restaurantId (not user.uid) so outlet sub-accounts read the
  // parent restaurant document and get the correct subscription status.
  const { user, restaurantId, primaryOutletId, isStaffOutlet, billingAccountId, teamRole, isMess } = useAuth();
  const [restaurantData, setRestaurantData] = useState<any>(null);
  const [dataError, setDataError] = useState(false);
  const [isRenewalOpen, setIsRenewalOpen] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  useEffect(() => {
    if (isMess && !location.pathname.startsWith("/mess")) {
      navigate("/mess/dashboard", { replace: true });
    }
  }, [isMess, location.pathname, navigate]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "platform_features"), (snap) => {
      if (snap.exists()) {
        setFeatures(snap.data() as Record<string, boolean>);
      }
    }, (error) => {
      console.error("Failed to load platform features:", error);
    });
    return () => unsub();
  }, []);



  useEffect(() => {
    if (!user) return;
    
    // If we are in 'global' view, we check the primary account's subscription.
    // Outlets always check their parent's billing account to ensure all branches
    // stay synced to the same subscription plan.
    const activeId = billingAccountId || user.uid;

    const unsub = onSnapshot(doc(db, "restaurants", activeId), (snap) => {
      if (snap.exists()) {
        setRestaurantData(snap.data());
        setDataError(false);
      } else {
        setDataError(true);
      }
    }, (error) => {
      console.error("DashboardLayout sub check failed:", error);
      setDataError(true);
    });

    return () => unsub();
  }, [user, restaurantId, primaryOutletId]);

  const isActive = (path: string) => {
    if (path === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(path);
  };

  useEffect(() => {
    if (!teamRole) return;
    const allowedPaths = STAFF_ROLE_ACCESS[teamRole] || [];
    
    // Check if current path matches any allowed path prefix.
    // E.g., if allowed is "/dashboard/settings", it allows "/dashboard/settings?tab=..."
    // If allowed is "/dashboard", it allows exactly "/dashboard".
    const isAllowed = allowedPaths.some(p => 
      p === "/dashboard" ? location.pathname === "/dashboard" : location.pathname.startsWith(p)
    );

    if (!isAllowed && allowedPaths.length > 0) {
      navigate(allowedPaths[0], { replace: true });
      toast.error(`Your role (${teamRole}) doesn't have access to this page.`);
    }
  }, [location.pathname, teamRole, navigate]);

  const checkSubscription = () => {
    if (dataError) return { status: 'blocked', daysLeft: 0 };
    // Default to 'pending' (not 'active') while the Firestore snapshot is still
    // loading — prevents blocked/expired accounts from briefly accessing the dashboard.
    if (!restaurantData) return { status: 'pending', daysLeft: 0 };

    if (restaurantData.isBlocked || restaurantData.isDeleted) {
      return { status: 'blocked', daysLeft: 0 };
    }

    // Two billing models. A COMMISSION merchant pays per order and never buys
    // a plan, so subscription status must not gate them — this check used to
    // lock every commission merchant out of the dashboard. Absent field ⇒
    // commission (functions/src/billingModel.ts).
    if (restaurantData.billingModel !== 'subscription') {
      return { status: 'active', daysLeft: 30 };
    }

    // Subscription merchants: a paid plan, or the server's grace window
    // (hotelSubscriptionExpiryCron moves active → grace_period → expired).
    // No trial tier.
    const currentStatus = restaurantData.subscriptionStatus;
    if (currentStatus === 'grace_period') {
      return { status: 'warning', daysLeft: 0 };
    }
    if (currentStatus !== 'active') {
      return { status: 'blocked', daysLeft: 0 };
    }

    const parseDate = (val: any): Date | null => {
      if (!val) return null;
      if (typeof val === 'object' && 'seconds' in val) {
        return new Date(val.seconds * 1000);
      }
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    const endDate = parseDate(restaurantData.subscriptionEndDate);

    // Marked active but with no end date recorded — treat as active rather than
    // locking a paying merchant out over a missing field. The webhook always
    // writes one, so this is a data-repair case, not a normal state.
    if (!endDate) {
      return { status: 'active', daysLeft: 30 };
    }

    const now = new Date();
    const diffDays = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      // Subscription end date has passed. If the Firestore status is still
      // 'active', the store renewal webhook may not have fired yet. Allow a
      // 3-day grace window for processing before blocking.
      if (currentStatus === 'active' && diffDays > -3) {
        return { status: 'warning', daysLeft: 0 };
      }
      return { status: 'blocked', daysLeft: 0 };
    }
    if (diffDays <= 7) return { status: 'warning', daysLeft: diffDays };

    return { status: 'active', daysLeft: diffDays };
  };

  const { status, daysLeft } = checkSubscription();

  // Renewal lives on the billing tab, which now runs the real Razorpay
  // checkout rather than pointing at an app store.
  const goToBilling = () => navigate("/dashboard/settings?tab=billing");

  const SidebarContent = ({ collapsed }: { collapsed?: boolean }) => {
    const { user, isStaffOutlet, activeRestaurantId, restaurantId } = useAuth();
    const navigate = useNavigate();
    const isOutletView = isStaffOutlet || (activeRestaurantId && restaurantId && activeRestaurantId !== restaurantId);

    // Logging out used to `await signOutWeb(user)` and only then navigate, so
    // if the sign-out threw, the navigation never happened: the operator stayed
    // on an authenticated dashboard after asking to leave, with nothing said.
    // Leaving is the safer failure, so we always navigate — and say so when the
    // session could not be ended, since it may still be valid on this device.
    const signOutAndLeave = async () => {
      try {
        await signOutWeb(user);
      } catch (e) {
        console.error("[DashboardLayout] sign-out failed", e);
        toast.error("Couldn't end your session cleanly — close this browser to be sure.");
      } finally {
        navigate("/login");
      }
    };

    return (
      <>
        <div className="h-16 flex items-center px-5 shrink-0 justify-between relative">
          {!collapsed && (
            <Link to="/dashboard" className="flex items-center gap-2.5 font-semibold text-foreground">
              <div className="w-8 h-8 rounded-xl bg-white p-0.5 flex items-center justify-center shadow-sm border overflow-hidden">
                <img loading="lazy" src="/logo.png" alt="Kada Dine" className="w-full h-full object-contain" />
              </div>
              <span className="text-sm font-black tracking-tight uppercase italic">Kada <span className="text-primary not-italic">Dine</span></span>
            </Link>
          )}
          {collapsed && (
            <Link to="/dashboard" className="flex items-center justify-center w-full">
              <div className="w-8 h-8 rounded-xl bg-white p-0.5 flex items-center justify-center shadow-sm border overflow-hidden">
                <img loading="lazy" src="/logo.png" alt="Kada Dine" className="w-full h-full object-contain" />
              </div>
            </Link>
          )}

          {/* Explicit mobile close button to prevent any header overlap complaints */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:bg-muted/80 rounded-xl"
            aria-label="Close Sidebar"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {!collapsed && (
          <div className="px-4 pb-2">
            <OutletSwitcher />
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
          {getNavGroups(features, !!isOutletView, teamRole).map(group => (
            <div key={group.label} className="mb-1">
              {!collapsed && (
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 py-2 mt-2">{group.label}</p>
              )}
              {collapsed && <div className="h-4 mt-2" />}
              <ul className="space-y-0.5">
                {group.items.map(item => {
                  const capability = PATH_CAPABILITY_MAP[item.path];
                  const isLocked = capability ? !hasCapability(capability) : false;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        onClick={() => setSidebarOpen(false)}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex items-center transition-all duration-150 relative overflow-hidden",
                          collapsed ? "justify-center h-10 w-10 mx-auto rounded-xl" : "gap-3 px-3 py-2 rounded-xl text-[13px] font-medium",
                          isActive(item.path)
                            ? "bg-accent text-accent-foreground shadow-card"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {!collapsed && (
                          <span className="flex-1 flex items-center justify-between">
                            {item.label}
                            {isLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground/60" />}
                          </span>
                        )}
                        {collapsed && isLocked && (
                          <div className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                        )}
                        {isActive(item.path) && (
                          <motion.div
                            layoutId="activeNav"
                            className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-full"
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="p-4 mt-auto border-t border-border/50">
          {!collapsed ? (
            <>
              <div className="p-3 rounded-xl bg-muted/40 backdrop-blur-md mb-3 border border-border/10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-black text-primary">
                    {(restaurantData?.name?.[0] || user?.email?.[0] || 'R').toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-foreground truncate">{restaurantData?.name || user?.email?.split('@')[0] || 'Restaurant'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-50">
                        {plan?.name ? `${plan.name} Plan` : 'Plan'}
                      </p>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-black uppercase tracking-tighter">
                        {daysLeft} Days Left
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={signOutAndLeave}
                className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-semibold text-destructive hover:bg-destructive/10 transition-all duration-200"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Log Out
              </button>
            </>
          ) : (
            <button
              onClick={signOutAndLeave}
              title="Log Out"
              className="flex w-10 h-10 mx-auto items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 transition-all duration-200"
            >
              <LogOut className="w-4 h-4 shrink-0" />
            </button>
          )}
        </div>
      </>
    );
  };

  if (status === 'pending') {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-background">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
          <div className="w-6 h-6 rounded-lg bg-primary animate-bounce" />
        </div>
      </div>
    );
  }

  if (status === 'blocked') {
    return <SubscriptionExpiredScreen onLogout={async () => { await signOutWeb(user); navigate("/login"); }} />;
  }

  return (
    <div className="page-shell h-[100dvh] bg-background flex w-full premium-grid overflow-hidden">


      {/* Desktop sidebar */}
      <motion.aside 
        animate={{ width: isDesktopCollapsed ? 80 : 256 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="hidden lg:flex bg-card backdrop-blur-xl border-r border-border flex-col shrink-0 h-full relative z-50"
      >
        <SidebarContent collapsed={isDesktopCollapsed} />
      </motion.aside>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              className="absolute left-0 top-0 bottom-0 w-[256px] bg-card backdrop-blur-xl flex flex-col shadow-hero border-r border-border"
              initial={{ x: -256 }}
              animate={{ x: 0 }}
              exit={{ x: -256 }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            >
              <SidebarContent />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        <StandardHeader
          logo={
            <button
              onClick={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
              className="hidden lg:flex items-center justify-center p-2 rounded-xl text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-all mr-2 ml-1"
              title="Toggle sidebar"
            >
              {isDesktopCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
            </button>
          }
          actions={
            <div className="flex items-center gap-2 shrink-0">
              {['thekada@gmail.com', 'thekadaapp@gmail.com'].includes(user?.email?.toLowerCase() || '') && (
                <Link to="/portal-select">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-xl border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 text-xs font-bold"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Admin Gateway</span>
                  </Button>
                </Link>
              )}
              <div className="lg:hidden flex items-center shrink-0">
                <OutletSwitcher className="w-[125px] sm:w-[160px] h-9 text-[10px] px-2 font-bold shadow-none border-border/50 bg-muted/30" />
              </div>
            </div>
          }
          onMenuClick={() => setSidebarOpen(true)}
          showMenuButton={true}
          showSearch={true}
          searchPlaceholder="Search..."
          showNotifications={true}
          userAvatar={
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
              {(restaurantData?.name?.[0] || user?.email?.charAt(0) || 'R').toUpperCase()}
            </div>
          }
          userName={restaurantData?.name || user?.email?.split('@')[0] || 'Restaurant'}
        />
        
        {restaurantData?.onboarding?.state &&
          ['submitted', 'kyc_review', 'verification', 'approved', 'commercial_setup', 'ready_for_activation'].includes(restaurantData.onboarding.state) && (
            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="mx-4 md:mx-8 mt-4 p-3 md:p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                  <Clock className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground flex items-center gap-2">
                    Application Under Review
                    <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-300">
                      KYC Verification
                    </Badge>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Our operations team is verifying your documents and delivery zone. You can explore the dashboard and set up dishes while we finalize your account.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/setup")}
                className="shrink-0 rounded-xl text-xs font-bold border-blue-200 text-blue-600 hover:bg-blue-50"
              >
                View Status <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </motion.div>
          )}

        {restaurantData?.onboarding?.state === 'action_required' && (
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mx-4 md:mx-8 mt-4 p-3 md:p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-600 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-rose-700 dark:text-rose-400">
                  Action Required on Onboarding
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Ops requested corrections on your submission. Please update the flagged items to proceed.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => navigate("/setup")}
              className="shrink-0 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
            >
              Fix Items <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </motion.div>
        )}

        {status === 'warning' && (
          <motion.div 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="mx-4 md:mx-8 mt-4 p-3 md:p-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3 group"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-black text-foreground uppercase tracking-tight">Plan Ending Soon</p>
                <p className="text-xs font-bold text-muted-foreground">{daysLeft} days left to renew.</p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={goToBilling}
              className="rounded-xl font-bold uppercase tracking-widest text-[10px] px-6"
            >
              Renew Now
            </Button>
          </motion.div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-24 lg:pb-8">
          <Outlet />
        </main>

        {/* Bottom Navigation for Mobile */}
        <BottomNav onMenuClick={() => setSidebarOpen(true)} features={features} />
        <SupportChatWidget />
      </div>
    </div>
  );
}
