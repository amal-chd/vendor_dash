import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Zap,
  Rocket,
  Building2,
  Check,
  X,
  HelpCircle,
  ShieldCheck,
  Star,
  Sparkles,
  ArrowRight,
  Clock,
  Loader2,
  AlertTriangle,
  Receipt,
  Headphones,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  PhoneCall,
  Calendar,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { usePricing } from "@/hooks/usePricing";
import {
  startSubscriptionCheckout,
  setSubscriptionCancellation,
} from "@/lib/subscriptionCheckout";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import type { Plan } from "@/constants/plans";

// ── Comparison Matrix Categories ──────────────────────────────────────────
interface FeatureRow {
  name: string;
  starter: boolean | string;
  growth: boolean | string;
  enterprise: boolean | string;
  tooltip?: string;
}

interface FeatureSection {
  category: string;
  features: FeatureRow[];
}

const COMPARISON_MATRIX: FeatureSection[] = [
  {
    category: "POS & Billing",
    features: [
      { name: "QR Digital Table Menu", starter: true, growth: true, enterprise: true },
      { name: "GST Invoicing & KOT Printing", starter: true, growth: true, enterprise: true },
      { name: "Simultaneous Device Terminals", starter: "Up to 3", growth: "Unlimited", enterprise: "Unlimited" },
      { name: "Offline POS Resiliency", starter: true, growth: true, enterprise: true },
      { name: "Table & Floor Management", starter: true, growth: true, enterprise: true },
      { name: "Dine-in Reservations", starter: true, growth: true, enterprise: true },
    ],
  },
  {
    category: "Kitchen & Operations",
    features: [
      { name: "Live Kitchen Order Display", starter: true, growth: true, enterprise: true },
      { name: "Predictive KDS with Timers", starter: false, growth: true, enterprise: true, tooltip: "Real-time ticket prep timers and alerts" },
      { name: "Station-wise KOT Routing", starter: false, growth: true, enterprise: true },
    ],
  },
  {
    category: "Inventory & Outlets",
    features: [
      { name: "Outlets Included", starter: "1 Outlet", growth: "Up to 5 Outlets", enterprise: "Unlimited (>5)" },
      { name: "Ingredient-Level Inventory", starter: true, growth: true, enterprise: true },
      { name: "Low-Stock Auto Alerts", starter: false, growth: true, enterprise: true },
      { name: "Centralized Multi-Outlet Catalog", starter: false, growth: true, enterprise: true },
      { name: "Inter-Branch Stock Transfers", starter: false, growth: false, enterprise: true },
    ],
  },
  {
    category: "Analytics & Growth",
    features: [
      { name: "Daily Sales & Tax Reports", starter: true, growth: true, enterprise: true },
      { name: "Customer Database & CRM", starter: false, growth: true, enterprise: true },
      { name: "Loyalty Points & Rewards", starter: false, growth: true, enterprise: true },
      { name: "Marketing Automation & SMS", starter: false, growth: true, enterprise: true },
      { name: "Aggregator Integration (Zomato/Swiggy)", starter: false, growth: true, enterprise: true },
      { name: "Custom API & Webhooks", starter: false, growth: false, enterprise: true },
    ],
  },
  {
    category: "Support & Infrastructure",
    features: [
      { name: "Support Channels", starter: "Email & Chat", growth: "24/7 Priority Chat", enterprise: "Dedicated Manager" },
      { name: "Dedicated Training & Onboarding", starter: false, growth: true, enterprise: true },
      { name: "Private VPC & 99.9% SLA", starter: false, growth: false, enterprise: true },
    ],
  },
];

// ── FAQs ──────────────────────────────────────────────────────────────────
const FAQS = [
  {
    q: "How does Razorpay billing work?",
    a: "We process payments securely through Razorpay supporting UPI (GPay, PhonePe, Paytm), Credit/Debit cards, and NetBanking. Once payment succeeds, your account is activated automatically within seconds.",
  },
  {
    q: "Are prices synced with the official catalog?",
    a: "Yes! Pricing is synchronized in real-time with the administrative Plan Catalog. Any adjustments or seasonal offers set by the platform reflect here instantly.",
  },
  {
    q: "Can I upgrade or switch plans at any time?",
    a: "Absolutely. When upgrading, your new tier capabilities unlock immediately and remaining subscription time is factored in.",
  },
  {
    q: "What happens if my subscription ends?",
    a: "Your data, menus, and order history are always preserved safely. You receive a grace period to renew, or you can operate seamlessly on the platform's default per-order commission model without disruption.",
  },
  {
    q: "Do I receive a tax invoice for business deductions?",
    a: "Yes. An official GST-compliant tax invoice with your restaurant's GSTIN is generated automatically for every subscription transaction and can be downloaded from Settings.",
  },
];

export default function PlansPricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Pricing & Subscription state
  const { plans: catalogPlans, loading: pricingLoading } = usePricing({ product: "dine" });
  const {
    plan: currentPlan,
    status: subStatus,
    daysLeft,
    endDate,
    isExpired,
    billingModel,
    cancelAtPeriodEnd,
    loading: subLoading,
  } = useSubscription();

  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("annual");
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Enterprise Contact Dialog
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
  const [leadForm, setLeadForm] = useState({
    name: "",
    phone: "",
    email: user?.email || "",
    outlets: "5-10",
    notes: "",
  });
  const [sendingLead, setSendingLead] = useState(false);

  // Razorpay Checkout Handler
  const handleSubscribe = async (plan: Plan) => {
    if (plan.monthlyPrice === "Custom") {
      setEnterpriseOpen(true);
      return;
    }

    setCheckoutPlanId(plan.id);
    try {
      const err = await startSubscriptionCheckout({
        product: "dine",
        planId: plan.id,
        period: billingPeriod === "annual" ? "yearly" : "monthly",
        prefill: {
          email: user?.email || undefined,
          name: user?.displayName || undefined,
        },
      });

      if (err && !err.startsWith("Payment received")) {
        toast.error(err);
      } else {
        toast.success(err ?? "Payment received! Your plan activates in a few seconds.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to initiate payment checkout.");
    } finally {
      setCheckoutPlanId(null);
    }
  };

  // Toggle Cancel at Period End
  const handleToggleCancel = async () => {
    setCancelBusy(true);
    try {
      const err = await setSubscriptionCancellation("dine", !cancelAtPeriodEnd);
      if (err) {
        toast.error(err);
      } else {
        toast.success(
          cancelAtPeriodEnd
            ? "Auto-renewal resumed. Your subscription will renew normally."
            : "Auto-renewal stopped. You can continue using your plan until the end of the period."
        );
      }
    } finally {
      setCancelBusy(false);
    }
  };

  // Submit Enterprise Inquiry
  const handleEnterpriseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.name || !leadForm.phone) {
      toast.error("Please provide your name and phone number.");
      return;
    }
    setSendingLead(true);
    try {
      await addDoc(collection(db, "enterprise_leads"), {
        ...leadForm,
        userId: user?.uid || null,
        product: "dine",
        createdAt: serverTimestamp(),
      });
      toast.success("Thank you! An enterprise account specialist will reach out shortly.");
      setEnterpriseOpen(false);
    } catch {
      toast.error("Failed to submit inquiry. Please try again or email thekadaapp@gmail.com.");
    } finally {
      setSendingLead(false);
    }
  };

  // Loading skeleton
  if (pricingLoading || subLoading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-semibold text-muted-foreground">Loading plan catalog & pricing…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12 max-w-6xl mx-auto pb-16">
      {/* ── Active Subscription Status Banner (if enrolled) ──────────────── */}
      {subStatus === "active" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-5 md:p-6 backdrop-blur-sm"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-500/20">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-foreground">
                    Active Plan: <span className="text-emerald-600 uppercase tracking-wide">{currentPlan.name}</span>
                  </h3>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-300 text-[10px]">
                    Active
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {daysLeft !== null && daysLeft > 0
                    ? `${daysLeft} days remaining in current billing cycle.`
                    : "Active monthly subscription."}
                  {endDate && ` Renews / Expires: ${new Date(endDate).toLocaleDateString("en-IN")}.`}
                </p>
                {cancelAtPeriodEnd && (
                  <p className="text-[11px] font-bold text-rose-600">
                    Auto-renewal is paused. Plan ends on {endDate ? new Date(endDate).toLocaleDateString("en-IN") : "period end"}.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                disabled={cancelBusy}
                onClick={handleToggleCancel}
                className={cn(
                  "text-xs font-bold rounded-xl h-9",
                  cancelAtPeriodEnd ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "text-muted-foreground"
                )}
              >
                {cancelBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : cancelAtPeriodEnd ? (
                  "Resume Renewal"
                ) : (
                  "Cancel Auto-Renew"
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Page Header & Pitch ─────────────────────────────────────────── */}
      <div className="text-center space-y-4 max-w-2xl mx-auto pt-4">
        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs py-1 px-3.5 font-bold uppercase tracking-wider">
          <Sparkles className="h-3 w-3 mr-1.5" /> Direct Razorpay Integration
        </Badge>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight text-foreground leading-[1.15]">
          Predictable pricing. <br className="hidden sm:block" />
          <span className="text-primary">Zero surprise commission.</span>
        </h1>
        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
          Scale your restaurant or multi-outlet franchise with flat monthly plans. Powered by Razorpay with instant digital billing.
        </p>

        {/* ── Billing Cycle Switcher ─────────────────────────────────────── */}
        <div className="pt-3 flex justify-center">
          <div className="inline-flex items-center rounded-2xl border border-border bg-muted/40 p-1.5 gap-1 shadow-sm">
            <button
              type="button"
              onClick={() => setBillingPeriod("monthly")}
              className={cn(
                "rounded-xl px-5 py-2 text-xs font-bold transition-all",
                billingPeriod === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => setBillingPeriod("annual")}
              className={cn(
                "rounded-xl px-5 py-2 text-xs font-bold transition-all flex items-center gap-1.5",
                billingPeriod === "annual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span>Annual Billing</span>
              <span className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] px-2 py-0.5 font-extrabold uppercase tracking-wider">
                Save ~20%
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Plan Cards Grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {catalogPlans.map((p, i) => {
          const isPopular = !!p.popular;
          const isCurrent = currentPlan?.id === p.id && subStatus === "active";
          const isCustom = p.monthlyPrice === "Custom";
          const price = billingPeriod === "annual" ? p.annualPrice : p.monthlyPrice;

          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.08 }}
              className={cn(
                "relative flex flex-col rounded-3xl border p-7 transition-all duration-300 h-full",
                isPopular
                  ? "bg-card border-primary/50 shadow-xl shadow-primary/5 ring-2 ring-primary/20"
                  : "bg-card border-border shadow-sm hover:border-border/80 hover:shadow-md"
              )}
            >
              {isPopular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-[10px] font-black uppercase tracking-wider text-primary-foreground shadow-md">
                  <Star className="h-3 w-3 fill-current" /> Most Popular
                </div>
              )}

              {isCurrent && (
                <div className="absolute -top-3.5 right-6 flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold text-white shadow-md">
                  <Check className="h-3 w-3" /> Active Plan
                </div>
              )}

              {/* Header */}
              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-8 w-8 rounded-xl flex items-center justify-center shrink-0",
                      p.id === "starter"
                        ? "bg-amber-500/10 text-amber-600"
                        : p.id === "growth"
                        ? "bg-primary/10 text-primary"
                        : "bg-blue-500/10 text-blue-600"
                    )}
                  >
                    {p.id === "starter" ? (
                      <Zap className="h-4 w-4" />
                    ) : p.id === "growth" ? (
                      <Rocket className="h-4 w-4" />
                    ) : (
                      <Building2 className="h-4 w-4" />
                    )}
                  </div>
                  <h3 className="text-base font-extrabold text-foreground uppercase tracking-wider">
                    {p.name}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground min-h-[32px] line-clamp-2">
                  {p.tagline}
                </p>
              </div>

              {/* Price */}
              <div className="mb-6 space-y-1">
                <div className="flex items-baseline gap-1">
                  {isCustom ? (
                    <span className="text-3xl font-black text-foreground">Custom Pricing</span>
                  ) : (
                    <>
                      <span className="text-2xl font-bold text-muted-foreground">₹</span>
                      <span className="text-4xl md:text-5xl font-black text-foreground tracking-tight">
                        {Number(price).toLocaleString("en-IN")}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        / month
                      </span>
                    </>
                  )}
                </div>
                {!isCustom && (
                  <p className="text-[11px] text-muted-foreground font-medium">
                    Billed {billingPeriod === "annual" ? "annually" : "monthly"}{" "}
                    {billingPeriod === "annual" && (
                      <span className="text-emerald-600 font-bold">
                        (Save ₹{((Number(p.monthlyPrice) - Number(p.annualPrice)) * 12).toLocaleString("en-IN")}/yr)
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="h-px bg-border/60 mb-6" />

              {/* Feature List */}
              <div className="space-y-3 flex-1 mb-8">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Included capabilities:
                </p>
                <ul className="space-y-2.5">
                  {p.features.map((feat, fIdx) => (
                    <li key={fIdx} className="flex items-start gap-2.5 text-xs text-foreground/90">
                      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </div>
                      <span className="leading-tight">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Button */}
              <div className="mt-auto pt-2">
                {isCurrent ? (
                  <div className="w-full h-11 rounded-2xl flex items-center justify-center gap-2 border-2 border-emerald-500/30 bg-emerald-500/5 text-emerald-700 font-bold text-xs">
                    <Check className="h-4 w-4" /> Current Active Plan
                  </div>
                ) : isCustom ? (
                  <Button
                    onClick={() => setEnterpriseOpen(true)}
                    variant="outline"
                    className="w-full h-11 rounded-2xl font-bold text-xs"
                  >
                    Contact Enterprise Sales <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    disabled={checkoutPlanId !== null}
                    onClick={() => handleSubscribe(p)}
                    className={cn(
                      "w-full h-11 rounded-2xl font-bold text-xs shadow-md transition-all",
                      isPopular
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20"
                        : "bg-slate-900 text-white hover:bg-slate-800"
                    )}
                  >
                    {checkoutPlanId === p.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Launching Razorpay…
                      </>
                    ) : (
                      <>
                        {isExpired
                          ? "Renew Subscription"
                          : currentPlan
                          ? `Switch to ${p.name}`
                          : `Choose ${p.name}`}{" "}
                        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Feature Comparison Matrix ───────────────────────────────────── */}
      <div className="space-y-6 pt-6">
        <div className="text-center space-y-1.5">
          <h2 className="text-2xl md:text-3xl font-black text-foreground">
            Detailed Feature Breakdown
          </h2>
          <p className="text-xs md:text-sm text-muted-foreground">
            Compare capabilities side-by-side across all merchant tiers.
          </p>
        </div>

        <div className="rounded-3xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground font-bold">
                  <th className="p-4 pl-6 min-w-[200px]">Feature</th>
                  <th className="p-4 text-center min-w-[130px]">Starter</th>
                  <th className="p-4 text-center min-w-[130px] bg-primary/5 text-primary">Growth</th>
                  <th className="p-4 text-center min-w-[130px]">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {COMPARISON_MATRIX.map((sec, sIdx) => (
                  <React.Fragment key={sIdx}>
                    <tr className="bg-muted/20">
                      <td
                        colSpan={4}
                        className="py-2.5 px-6 font-extrabold uppercase tracking-wider text-[11px] text-muted-foreground"
                      >
                        {sec.category}
                      </td>
                    </tr>
                    {sec.features.map((feat, fIdx) => (
                      <tr key={fIdx} className="hover:bg-muted/10 transition-colors">
                        <td className="p-4 pl-6 font-medium text-foreground">
                          {feat.name}
                          {feat.tooltip && (
                            <span className="block text-[10px] text-muted-foreground font-normal">
                              {feat.tooltip}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {typeof feat.starter === "boolean" ? (
                            feat.starter ? (
                              <Check className="h-4 w-4 text-emerald-600 mx-auto" />
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )
                          ) : (
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {feat.starter}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-center bg-primary/5">
                          {typeof feat.growth === "boolean" ? (
                            feat.growth ? (
                              <Check className="h-4 w-4 text-primary mx-auto stroke-[2.5]" />
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )
                          ) : (
                            <span className="font-bold text-primary">{feat.growth}</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {typeof feat.enterprise === "boolean" ? (
                            feat.enterprise ? (
                              <Check className="h-4 w-4 text-emerald-600 mx-auto" />
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )
                          ) : (
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                              {feat.enterprise}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── FAQ Section ─────────────────────────────────────────────────── */}
      <div className="space-y-6 pt-4 max-w-3xl mx-auto">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-black text-foreground">Frequently Asked Questions</h2>
          <p className="text-xs text-muted-foreground">Everything you need to know about plans and billing.</p>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-2xl border border-border bg-card overflow-hidden transition-all shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="flex w-full items-center justify-between p-4 text-left font-bold text-sm text-foreground hover:bg-muted/30 transition-colors"
                >
                  <span>{faq.q}</span>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 text-xs text-muted-foreground leading-relaxed border-t border-border/40">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Enterprise Inquiry Dialog ────────────────────────────────────── */}
      <Dialog open={enterpriseOpen} onOpenChange={setEnterpriseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" /> Enterprise Plan Inquiry
            </DialogTitle>
            <DialogDescription>
              Tailored solutions for franchises, multi-chain kitchens, and hotel groups.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEnterpriseSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Contact Person Name *</Label>
              <Input
                value={leadForm.name}
                onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })}
                placeholder="Full Name"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Phone Number *</Label>
                <Input
                  type="tel"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
                  placeholder="10-digit mobile"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Outlets Count</Label>
                <select
                  value={leadForm.outlets}
                  onChange={(e) => setLeadForm({ ...leadForm, outlets: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="5-10">5–10 outlets</option>
                  <option value="11-25">11–25 outlets</option>
                  <option value="25+">25+ outlets</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Email Address</Label>
              <Input
                type="email"
                value={leadForm.email}
                onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
                placeholder="official@company.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Special Requirements (Optional)</Label>
              <Textarea
                rows={3}
                value={leadForm.notes}
                onChange={(e) => setLeadForm({ ...leadForm, notes: e.target.value })}
                placeholder="e.g. ERP integration, custom white-label app, dedicated database"
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setEnterpriseOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sendingLead} className="bg-primary text-primary-foreground font-bold">
                {sendingLead ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Submit Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
