import { useEffect, useState, useMemo, useCallback } from "react";
import {
  collection,
  onSnapshot,
  query,
  doc,
  updateDoc,
  setDoc,
  addDoc,
  deleteDoc,
  getDocs,
  where,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import { DataTable } from "@/components/admin/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import {
  CreditCard,
  TrendingUp,
  BarChart3,
  Settings,
  CheckCircle2,
  Clock,
  XCircle,
  IndianRupee,
  MoreHorizontal,
  Plus,
  Trash2,
  ShieldCheck,
  Building2,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanConfiguration } from "@/components/admin/PlanConfiguration";
import { SubscriptionPurchases } from "@/components/admin/SubscriptionPurchases";
import { StatCards, type StatItem } from "@/components/admin/StatCards";
import { EntityDrawer } from "@/components/admin/core/EntityDrawer";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Capability } from "@/constants/plans";

import { usePricing } from "@/hooks/usePricing";
import { cn } from "@/lib/utils";
import { PLANS } from "@/constants/plans";

// ─── Types ───────────────────────────────────────────────────────────────────

type MerchantKind = "vendor" | "host";

interface VendorSubscription {
  id: string;
  /** Which product this merchant belongs to — Kada Dine or Kada Host. */
  kind: MerchantKind;
  /**
   * Commission vs subscription are ALTERNATIVES (see functions/src/billingModel.ts).
   * A commission merchant has no subscription to manage, so surfacing this here
   * stops the page treating every merchant as a subscriber.
   */
  billingModel: "commission" | "subscription";
  restaurantName: string;
  subscriptionType: "monthly" | "yearly" | string;
  subscriptionStatus: "active" | "trial" | "paused" | "expired" | "pending";
  subscriptionEndDate?: string;
  subscriptionStartDate?: string;
  customPlanPrice?: number;
  createdAt?: any;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const statusConfig: Record<
  string,
  { label: string; icon: React.ElementType; badgeClass: string }
> = {
  active: {
    label: "Active",
    icon: CheckCircle2,
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800",
  },
  // Legacy status from the pre-Razorpay trial era. Kept so old merchant docs
  // still render a sensible badge; nothing in the product creates it.
  trial: {
    label: "Trial (legacy)",
    icon: Clock,
    badgeClass:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    badgeClass:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800",
  },
  paused: {
    label: "Paused",
    icon: XCircle,
    badgeClass:
      "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800",
  },
  expired: {
    label: "Expired",
    icon: XCircle,
    badgeClass:
      "bg-muted text-muted-foreground border-border",
  },
};

const planTypeConfig: Record<string, { label: string; class: string }> = {
  monthly: {
    label: "Monthly",
    class:
      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-800",
  },
  yearly: {
    label: "Yearly",
    class:
      "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-400 dark:border-indigo-800",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatINR(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getMonthLabel(date: Date) {
  return date.toLocaleString("default", { month: "short", year: "2-digit" });
}

function buildMRRChart(subscriptions: VendorSubscription[], plans: typeof PLANS) {
  const now = new Date();
  const months: { label: string; date: Date }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: getMonthLabel(d), date: d });
  }

  return months.map(({ label, date }) => {
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const relevant = subscriptions.filter((s) => {
      const start = s.subscriptionStartDate
        ? new Date(s.subscriptionStartDate)
        : s.createdAt
        ? new Date(typeof s.createdAt === "string" ? s.createdAt : s.createdAt?.toDate?.() ?? s.createdAt)
        : null;
      if (!start) return false;
      return start <= monthEnd && s.subscriptionStatus === "active";
    });

    const growthPlan = plans.find(p => p.id === "growth");
    const defaultMonthly = typeof growthPlan?.monthlyPrice === "number" ? growthPlan.monthlyPrice : 499;
    const defaultYearly = typeof growthPlan?.annualPrice === "number" ? growthPlan.annualPrice : 399;

    let mrr = 0;
    for (const s of relevant) {
      if (s.subscriptionType === "custom" && s.customPlanPrice) {
        mrr += s.customPlanPrice;
      } else if (s.subscriptionType === "monthly") {
        mrr += defaultMonthly;
      } else if (s.subscriptionType === "yearly") {
        mrr += defaultYearly;
      }
    }

    return { label, mrr };
  });
}

// ─── Plan Config Card (REMOVED) ──────────────────────────────────────────────
// This edited `config/pricing` — a second pricing source that competed with
// the plan catalog. Pricing is now edited only via <PlanConfiguration />,
// which writes the single source of truth at `config/plan_catalog`.

// ─── Extend Trial Dialog ──────────────────────────────────────────────────────

// ExtendTrialDialog removed — trials are no longer part of the product.

// ─── Custom Plan Manager ─────────────────────────────────────────────────────

const ALL_CAPABILITIES: { id: Capability; label: string }[] = [
  { id: "qr_ordering", label: "QR Menu Ordering" },
  { id: "gst_billing", label: "GST Billing & KOT" },
  { id: "pos_sync", label: "POS Sync" },
  { id: "multi_device", label: "Multi Device" },
  { id: "inventory_tracking", label: "Inventory Tracking" },
  { id: "predictive_kds", label: "Kitchen Display (KDS)" },
  { id: "cdp", label: "CRM & Customer Database" },
  { id: "aggregator_integration", label: "Aggregator Webhook" },
  { id: "marketing_automation", label: "Native Promotions" },
  { id: "pnl_reports", label: "P&L Reports" },
  { id: "multi_outlet", label: "Multi-Outlet Management" },
  { id: "staff_management", label: "Staff Management" },
  { id: "expense_tracking", label: "Expense Tracking" },
  { id: "loyalty", label: "Loyalty Points" },
  { id: "custom_api", label: "Custom API & Webhooks" },
  { id: "priority_support", label: "Priority Support" },
  { id: "vpc_isolation", label: "Private Cloud (VPC)" },
];

interface CustomPlan {
  id: string;
  restaurantId: string;
  restaurantName: string;
  planName: string;
  monthlyPrice: number;
  annualPrice: number;
  monthlyPriceUSD: number;
  annualPriceUSD: number;
  capabilities: Capability[];
  notes: string;
  createdAt: string;
}

function CustomPlanManager({
  subscriptions,
  customPlans,
}: {
  subscriptions: VendorSubscription[];
  customPlans: CustomPlan[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{planId: string, restaurantId: string} | null>(null);

  // Form state
  const [form, setForm] = useState({
    restaurantId: "",
    restaurantName: "",
    planName: "Enterprise Custom",
    monthlyPrice: 1499,
    annualPrice: 1199,
    monthlyPriceUSD: 19.99,
    annualPriceUSD: 15.99,
    notes: "",
    capabilities: [
      "qr_ordering", "gst_billing", "pos_sync", "multi_device",
      "inventory_tracking", "predictive_kds", "cdp", "aggregator_integration",
      "pnl_reports", "multi_outlet", "staff_management", "expense_tracking",
      "loyalty", "priority_support",
    ] as Capability[],
  });

  // NOTE: declared in the parent below as well — see visibleSubscriptions.
  const filteredRestaurants = subscriptions.filter(s =>
    s.restaurantName.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 6);

  const toggleCapability = (cap: Capability) => {
    setForm(prev => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter(c => c !== cap)
        : [...prev.capabilities, cap],
    }));
  };

  const handleSave = async () => {
    if (!form.restaurantId) {
      toast.error("Please select a restaurant first");
      return;
    }
    if (!form.planName.trim()) {
      toast.error("Plan name is required");
      return;
    }
    setSaving(true);
    try {
      const planData = {
        restaurantId: form.restaurantId,
        restaurantName: form.restaurantName,
        planName: form.planName,
        monthlyPrice: form.monthlyPrice,
        annualPrice: form.annualPrice,
        monthlyPriceUSD: form.monthlyPriceUSD,
        annualPriceUSD: form.annualPriceUSD,
        capabilities: form.capabilities,
        notes: form.notes,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, "custom_plans", form.restaurantId), planData, { merge: true });

      await updateDoc(doc(db, "restaurants", form.restaurantId), {
        subscriptionType: "custom",
        subscriptionStatus: "active",
        customPlanId: form.restaurantId,
        customPlanName: form.planName,
        customPlanPrice: form.monthlyPrice,
        isBlocked: false,
      });

      await setDoc(doc(db, "config", "custom_plans"), {
        [form.restaurantId]: {
          capabilities: form.capabilities,
          planName: form.planName,
          monthlyPrice: form.monthlyPrice,
          annualPrice: form.annualPrice,
        },
      }, { merge: true });

      toast.success(`Custom plan "${form.planName}" assigned to ${form.restaurantName}`);
      setShowForm(false);
      setSearch("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save custom plan");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteDoc(doc(db, "custom_plans", deleteConfirm.planId));
      await updateDoc(doc(db, "restaurants", deleteConfirm.restaurantId), {
        subscriptionType: "yearly",
        customPlanId: null,
        customPlanName: null,
      });
      toast.success("Custom plan removed");
    } catch {
      toast.error("Failed to remove custom plan");
    } finally {
      setDeleteConfirm(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" />
            Custom Enterprise Plans
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create bespoke plans for specific restaurant groups or franchise accounts.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm(true)}
          className="h-8 text-xs gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          New Custom Plan
        </Button>
      </div>

      <EntityDrawer
        open={showForm}
        onOpenChange={setShowForm}
        icon={ShieldCheck}
        title="Create Custom Plan"
        subtitle="Configure enterprise plan details"
        actions={
          <>
            <Button variant="outline" onClick={() => { setShowForm(false); setSearch(""); }}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.restaurantId}>
              {saving ? "Saving…" : "Save & Assign Plan"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select Restaurant</Label>
            <input
              type="text"
              placeholder="Search restaurant name…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setForm(prev => ({ ...prev, restaurantId: "", restaurantName: "" }));
              }}
              className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            {search.length > 0 && form.restaurantId === "" && (
              <div className="rounded-lg border border-border bg-card shadow-md overflow-hidden">
                {filteredRestaurants.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-3">No restaurants found</p>
                ) : (
                  filteredRestaurants.map(r => (
                    <button
                      key={r.id}
                      className="w-full text-left px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
                      onClick={() => {
                        setForm(prev => ({ ...prev, restaurantId: r.id, restaurantName: r.restaurantName }));
                        setSearch(r.restaurantName);
                      }}
                    >
                      {r.restaurantName}
                      <span className="ml-2 text-[10px] text-muted-foreground">{r.subscriptionStatus}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {form.restaurantId && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 font-semibold mt-2">
                <CheckCircle2 className="h-3.5 w-3.5" /> Assigned to: {form.restaurantName}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Plan Name</Label>
            <input
              type="text"
              value={form.planName}
              onChange={(e) => setForm(prev => ({ ...prev, planName: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              placeholder="e.g. Enterprise Plus, Hotel Chain Plan"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Monthly ₹", key: "monthlyPrice", step: 1, isFloat: false },
              { label: "Annual ₹/mo", key: "annualPrice", step: 1, isFloat: false },
              { label: "Monthly $", key: "monthlyPriceUSD", step: 0.01, isFloat: true },
              { label: "Annual $/mo", key: "annualPriceUSD", step: 0.01, isFloat: true },
            ].map(f => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-[10px] font-medium text-muted-foreground">{f.label}</Label>
                <input
                  type="number"
                  step={f.step}
                  value={form[f.key as keyof typeof form] as number}
                  onChange={(e) => setForm(prev => ({
                    ...prev,
                    [f.key]: f.isFloat ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0,
                  }))}
                  className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm font-semibold outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Included Capabilities</Label>
            <div className="grid grid-cols-2 gap-2.5 p-4 rounded-xl bg-muted/30 border border-border/60">
              {ALL_CAPABILITIES.map((cap) => (
                <label key={cap.id} className="flex items-center gap-2 cursor-pointer group">
                  <Checkbox
                    checked={form.capabilities.includes(cap.id)}
                    onCheckedChange={() => toggleCapability(cap.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                    {cap.label}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {form.capabilities.length} of {ALL_CAPABILITIES.length} capabilities selected
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Internal Notes (optional)</Label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder="e.g. 3-month prepaid deal, contacted on 20 May 2026"
            />
          </div>
        </div>
      </EntityDrawer>

      <ConfirmationDialog
        open={!!deleteConfirm}
        onOpenChange={(o) => !o && setDeleteConfirm(null)}
        title="Remove Custom Plan"
        description="Are you sure you want to remove this custom plan?"
        consequences={[
          "The restaurant will revert to the standard Enterprise yearly plan",
          "Custom pricing will be removed",
        ]}
        confirmLabel="Remove Plan"
        onConfirm={handleDelete}
      />

      {customPlans.length > 0 ? (
        <div className="space-y-2">
          {customPlans.map((cp) => (
            <div
              key={cp.id}
              className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{cp.restaurantName}</span>
                  <Badge className="text-[9px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800">
                    {cp.planName}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  ₹{cp.monthlyPrice}/mo · ₹{cp.annualPrice}/mo annual · {cp.capabilities.length} capabilities
                </p>
                {cp.notes && <p className="text-[10px] text-muted-foreground/70 italic">{cp.notes}</p>}
              </div>
              <Button aria-label="Delete"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteConfirm({ planId: cp.id, restaurantId: cp.restaurantId })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 py-8 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No custom plans yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Click "New Custom Plan" to create one for a specific restaurant</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingHub() {
  const { plans } = usePricing({ includeHidden: true });
  const [subscriptions, setSubscriptions] = useState<VendorSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [customPlans, setCustomPlans] = useState<CustomPlan[]>([]);
  const [kindFilter, setKindFilter] = useState<"all" | MerchantKind>("all");

  // ── Firestore Listeners ───────────────────────────────────────────────────

  useEffect(() => {
    const toIso = (val: any): string | undefined => {
      if (!val) return undefined;
      if (typeof val === "string") return val;
      if (val.toDate) return val.toDate().toISOString();
      return undefined;
    };
    // One mapper for both merchant products so a Kada Host subscription can
    // never drift from a Kada Dine one.
    const mapMerchant = (d: any, kind: MerchantKind): VendorSubscription => {
      const data = d.data();
      return {
        id: d.id,
        kind,
        billingModel:
          String(data.billingModel ?? "").toLowerCase() === "subscription"
            ? "subscription"
            : "commission",
        restaurantName:
          data.name || data.propertyName || (kind === "host" ? "Unnamed property" : "Unknown Tenant"),
        subscriptionType: data.subscriptionType || "monthly",
        subscriptionStatus: data.subscriptionStatus || "pending",
        subscriptionEndDate: toIso(
          data.subscriptionEndDate || data.subscriptionExpiry || data.trialExpiry || data.trialEndDate
        ),
        subscriptionStartDate: toIso(data.subscriptionStartDate),
        createdAt: toIso(data.createdAt),
        customPlanPrice: data.customPlanPrice,
      } as VendorSubscription & { customPlanPrice?: number };
    };

    let vendorRows: VendorSubscription[] = [];
    let hostRows: VendorSubscription[] = [];
    const publish = () => {
      setSubscriptions([...vendorRows, ...hostRows]);
      setLoading(false);
    };

    const q = query(collection(db, "restaurants"), limit(2000));
    const unsubRestaurants = onSnapshot(q, (snapshot) => {
      vendorRows = snapshot.docs
        .filter((d) => !d.data().isDeleted)
        .map((d) => mapMerchant(d, "vendor"));
      publish();
    }, (err) => {
      console.error("PlansPage: restaurants listener failed", err);
      setLoading(false);
    });

    // Kada Host properties — previously absent entirely, so host plans could
    // not be seen or managed from this page at all.
    const unsubHotels = onSnapshot(query(collection(db, "hotels"), limit(2000)), (snapshot) => {
      hostRows = snapshot.docs
        .filter((d) => !d.data().isDeleted)
        .map((d) => mapMerchant(d, "host"));
      publish();
    }, (err) => {
      console.error("PlansPage: hotels listener failed", err);
    });

    const unsubCustom = onSnapshot(collection(db, "custom_plans"), (snap) => {
      setCustomPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as CustomPlan)));
    }, (err) => console.error("[PlansPage] custom_plans listener failed", err));

    return () => {
      unsubRestaurants();
      unsubHotels();
      unsubCustom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const updateStatus = useCallback(async (id: string, status: string) => {
    try {
      const payload: any = { subscriptionStatus: status };
      if (status === "active" || status === "trial") {
        payload.isBlocked = false;
      }
      await updateDoc(doc(db, "restaurants", id), payload);
      toast.success(`Status updated to ${status}`);
    } catch {
      toast.error("Failed to update status");
    }
  }, []);

  // ── KPI Metrics ───────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const activeSubs = subscriptions.filter((s) => s.subscriptionStatus === "active");
    const monthlyActive = activeSubs.filter((s) => s.subscriptionType === "monthly").length;
    const yearlyActive = activeSubs.filter((s) => s.subscriptionType === "yearly").length;
    
    const growthPlan = plans.find(p => p.id === "growth");
    const defaultMonthly = typeof growthPlan?.monthlyPrice === "number" ? growthPlan.monthlyPrice : 499;
    const defaultYearly = typeof growthPlan?.annualPrice === "number" ? growthPlan.annualPrice : 399;
    
    let mrr = 0;
    for (const s of activeSubs) {
      if (s.subscriptionType === "custom") {
        const cp = customPlans.find(c => c.id === s.id);
        if (cp) mrr += cp.monthlyPrice;
      } else if (s.subscriptionType === "monthly") {
        mrr += defaultMonthly;
      } else if (s.subscriptionType === "yearly") {
        mrr += defaultYearly;
      }
    }
    
    const arr = mrr * 12;
    return { monthlyActive, yearlyActive, mrr, arr };
  }, [subscriptions, plans, customPlans]);

  // ── Revenue Chart Data ────────────────────────────────────────────────────

  const chartData = useMemo(() => buildMRRChart(subscriptions, plans), [subscriptions, plans]);

  // ── Table Columns ─────────────────────────────────────────────────────────

  const columns: ColumnDef<VendorSubscription>[] = useMemo(
    () => [
      {
        accessorKey: "restaurantName",
        header: "Merchant",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-sm text-foreground">
              {row.getValue("restaurantName")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {row.original.kind === "host" ? "Kada Host" : "Kada Dine"}
            </span>
          </div>
        ),
      },
      {
        id: "billingModel",
        header: "Billing",
        cell: ({ row }) => {
          const m = row.original.billingModel;
          // A commission merchant has no subscription to manage — showing this
          // stops an operator reading "expired" as a problem when the merchant
          // simply never had a plan.
          return m === "subscription" ? (
            <Badge variant="outline" className="text-[10px] font-medium border-indigo-200 text-indigo-700 bg-indigo-50 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-300">
              Subscription
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">
              Commission
            </Badge>
          );
        },
      },
      {
        accessorKey: "subscriptionType",
        header: "Plan",
        cell: ({ row }) => {
          const type = row.getValue("subscriptionType") as string;
          const cfg = planTypeConfig[type] ?? planTypeConfig.monthly;
          return (
            <Badge
              variant="outline"
              className={cn("text-[10px] font-medium capitalize", cfg.class)}
            >
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "subscriptionStatus",
        header: "Status",
        cell: ({ row }) => {
          const key = row.getValue("subscriptionStatus") as string;
          const cfg = statusConfig[key] ?? statusConfig.pending;
          const Icon = cfg.icon;
          return (
            <Badge
              variant="outline"
              className={cn("text-[10px] font-medium gap-1", cfg.badgeClass)}
            >
              <Icon className="h-3 w-3" />
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "subscriptionEndDate",
        header: "Expiry",
        cell: ({ row }) => {
          const val = row.getValue("subscriptionEndDate") as string | undefined;
          if (!val) return <span className="text-xs text-muted-foreground italic">—</span>;
          const d = new Date(val);
          const isExpired = d < new Date();
          return (
            <span
              className={cn(
                "text-xs font-medium",
                isExpired ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const sub = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="More actions" variant="ghost" size="icon" className="h-7 w-7 rounded-lg">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-lg">
                <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">
                  Override Status
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={() => updateStatus(sub.id, "active")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-500" />
                  Mark Active
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={() => updateStatus(sub.id, "paused")}
                >
                  <XCircle className="h-3.5 w-3.5 mr-2 text-orange-500" />
                  Mark Paused
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs cursor-pointer text-destructive focus:text-destructive"
                  onClick={() => updateStatus(sub.id, "expired")}
                >
                  <XCircle className="h-3.5 w-3.5 mr-2" />
                  Mark Expired
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [updateStatus]
  );

  const renderMobileCard = useCallback((sub: VendorSubscription) => {
    const typeCfg = planTypeConfig[sub.subscriptionType] ?? planTypeConfig.monthly;
    const statCfg = statusConfig[sub.subscriptionStatus] ?? statusConfig.pending;
    const StatIcon = statCfg.icon;

    const expiryDate = sub.subscriptionEndDate ? new Date(sub.subscriptionEndDate) : null;
    const isExpired = expiryDate && expiryDate < new Date();

    return (
      <div className="bg-card rounded-xl border border-border/60 p-4 shadow-sm space-y-3 relative group">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 pr-2">
            <h4 className="font-bold text-sm leading-tight text-foreground truncate">{sub.restaurantName}</h4>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={cn("text-[9px] font-medium capitalize", typeCfg.class)}>
                {typeCfg.label}
              </Badge>
              <Badge variant="outline" className={cn("text-[9px] font-medium gap-1", statCfg.badgeClass)}>
                <StatIcon className="h-3 w-3" />
                {statCfg.label}
              </Badge>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="More actions" variant="ghost" size="icon" className="h-8 w-8 rounded-lg shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl shadow-lg">
              <DropdownMenuLabel className="text-[10px] font-medium text-muted-foreground">Override Status</DropdownMenuLabel>
              <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => updateStatus(sub.id, "active")}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-500" /> Mark Active
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs cursor-pointer" onClick={() => updateStatus(sub.id, "paused")}>
                <XCircle className="h-3.5 w-3.5 mr-2 text-orange-500" /> Mark Paused
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs cursor-pointer text-destructive focus:text-destructive" onClick={() => updateStatus(sub.id, "expired")}>
                <XCircle className="h-3.5 w-3.5 mr-2" /> Mark Expired
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex justify-between items-center bg-muted/30 p-2.5 rounded-lg border border-border/40 text-xs">
          <span className="text-muted-foreground font-medium">Expiry Date</span>
          {expiryDate ? (
            <span className={cn("font-semibold", isExpired ? "text-destructive" : "text-foreground")}>
              {expiryDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          ) : (
             <span className="italic text-muted-foreground">—</span>
          )}
        </div>
      </div>
    );
  }, [updateStatus]);

  // ── Loading State ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const visibleSubscriptions =
    kindFilter === "all"
      ? subscriptions
      : subscriptions.filter((s) => s.kind === kindFilter);

  return (
    <div className="space-y-8 p-6">
      {/* ── SECTION 1: KPIs (reporting — what already happened) ───────── */}
      <AdminPageHeader
        title="Billing Hub"
        description="Manage plans, subscriptions, and revenue metrics."
        stats={[
          {
            title: "Monthly Active Plans",
            value: String(kpis.monthlyActive),
            hint: "Active monthly subscribers",
            icon: CreditCard,
            tone: "text-violet-500",
            trend: kpis.monthlyActive > 0 ? { value: kpis.monthlyActive, label: "Growing", isPositive: true } : undefined,
          },
          {
            title: "Annual Active Plans",
            value: String(kpis.yearlyActive),
            hint: "Active yearly subscribers",
            icon: BarChart3,
            tone: "text-indigo-500",
            trend: kpis.yearlyActive > 0 ? { value: kpis.yearlyActive, label: "Growing", isPositive: true } : undefined,
          },
          {
            title: "MRR",
            value: formatINR(kpis.mrr),
            hint: "Monthly recurring revenue",
            icon: IndianRupee,
            tone: "text-emerald-500",
            trend: kpis.mrr > 0 ? { value: 0, label: "Growing", isPositive: true } : undefined, // simplified trend
          },
          {
            title: "ARR",
            value: formatINR(kpis.arr),
            hint: "Annual run rate",
            icon: TrendingUp,
            tone: "text-blue-500",
            trend: kpis.arr > 0 ? { value: 0, label: "Growing", isPositive: true } : undefined,
          }
        ]}
      />

      {/* ── Workspace tabs ────────────────────────────────────────────────
          The page was a flat stack of eight stacked sections; an operator
          had to scroll past pricing config to reach the merchant list.
          Split by intent: report → configure → operate. */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configuration">Plan Configuration</TabsTrigger>
          <TabsTrigger value="merchants">Merchants</TabsTrigger>
          <TabsTrigger value="custom">Custom Plans</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
        {/* ── Revenue Chart ─────────────────────────────────────────────────── */}
        <Card className="rounded-xl border border-border/60 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              MRR — Last 6 Months
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Monthly recurring revenue from active subscriptions
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "10px",
                    fontSize: "12px",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                  }}
                  formatter={(value: number) => [formatINR(value), "MRR"]}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                />
                <Area
                  type="monotone"
                  dataKey="mrr"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#mrrGradient)"
                  dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: "#6366f1" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* The legacy per-plan editor lived here. It wrote to `config/pricing`,
            a SECOND pricing source competing with the catalog — the exact
            duplicate-pricing problem this consolidation removes. Pricing is now
            edited only in the Plan Configuration tab (config/plan_catalog).
            `config/pricing` is still read as a read-only fallback in
            usePricing, so historical overrides keep working. */}

        </TabsContent>

        <TabsContent value="configuration" className="space-y-6 mt-6">
        <PlanConfiguration />

        </TabsContent>

        <TabsContent value="merchants" className="space-y-6 mt-6">
        {/* ── Subscriptions Table ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Subscriptions</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {visibleSubscriptions.length} of {subscriptions.length} merchants
                {" · "}
                {subscriptions.filter((s) => s.billingModel === "subscription").length} on a plan
                {" · "}
                {subscriptions.filter((s) => s.billingModel === "commission").length} on commission
              </p>
            </div>
            {/* Kada Dine vs Kada Host — this page previously showed vendors only,
                so host plans were unmanageable from the admin panel. */}
            <div className="flex rounded-lg border overflow-hidden shrink-0">
              {([
                { id: "all", label: `All (${subscriptions.length})` },
                { id: "vendor", label: `Kada Dine (${subscriptions.filter((s) => s.kind === "vendor").length})` },
                { id: "host", label: `Kada Host (${subscriptions.filter((s) => s.kind === "host").length})` },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setKindFilter(t.id)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    kindFilter === t.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={visibleSubscriptions}
            searchKey="restaurantName"
            renderMobileCard={renderMobileCard}
          />
        </div>

        </TabsContent>

        <TabsContent value="custom" className="space-y-6 mt-6">
        {/* ── Custom Plan Manager ───────────────────────────────────────────── */}
        <CustomPlanManager subscriptions={subscriptions} customPlans={customPlans} />

        </TabsContent>

        <TabsContent value="purchases" className="space-y-6 mt-6">
          <SubscriptionPurchases />
        </TabsContent>

      </Tabs>
    </div>
  );
}
