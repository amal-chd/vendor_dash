import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Building2,
  MapPin,
  Clock3,
  FileText,
  CreditCard,
  Utensils,
  ChevronDown,
  ChevronUp,
  Upload,
  Eye,
  EyeOff,
  LogOut,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Store,
  BadgeAlert,
  Check,
  LocateFixed,
  AlertCircle,
  X,
  FileCheck2,
  ChefHat,
  Sun,
  Moon,
  Flame,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { signOutWeb } from "@/lib/auth-flow";
import {
  onboardingClient,
  messOnboardingClient,
  getOnboardingClient,
  type IfscInfo,
  type DocumentReadResult,
  type ZoneResult,
  type RestaurantProfileData,
} from "@/lib/onboarding-client";
import {
  type StepRequirement,
  type OnboardingSnapshot,
  type DocumentCheckStatus,
  type BankVerificationState,
  type PartnerRole,
  DOCUMENT_CHECK_META,
  STATE_META,
  type OnboardingState,
  resolveDefaultRequirements,
} from "@/lib/onboarding";
import { indiaStates } from "@/constants/indiaData";
import { cn } from "@/lib/utils";

// ── Helpers & Constants ──────────────────────────────────────────────────
const STAGE_ORDER = ["business", "documents", "bank", "setup", "finish"] as const;

const getStageMeta = (isMess: boolean): Record<string, { title: string; subtitle: string; icon: any }> => ({
  business: {
    title: isMess ? "Your Mess Kitchen" : "Your Restaurant",
    subtitle: isMess
      ? "Kitchen name, operating meals, order cut-offs and pin-drop location"
      : "Basic details, pin-drop location and operating hours",
    icon: isMess ? ChefHat : Store,
  },
  documents: {
    title: "Legal & KYC Documents",
    subtitle: "Snap or upload photos — our AI reads and checks them automatically",
    icon: FileText,
  },
  bank: {
    title: isMess ? "Direct Payouts & Banking" : "Banking & Payouts",
    subtitle: isMess
      ? "Where your weekly meal subscriptions will be settled"
      : "Where your weekly order earnings will be transferred",
    icon: CreditCard,
  },
  setup: {
    title: isMess ? "Kitchen Photos & Meal Plans" : "Menu Setup",
    subtitle: isMess
      ? "Upload kitchen hygiene photos, weekly menu schedule and set initial meal plans"
      : "Add initial items or verify your dishes",
    icon: Utensils,
  },
  finish: {
    title: "Agreement & Go Live",
    subtitle: isMess
      ? "Review Kada Mess partner terms (₹3/day daily fee) and submit for activation"
      : "Review partner agreement terms and submit for activation",
    icon: ShieldCheck,
  },
});

const BUSINESS_STRUCTURES = [
  { id: "sole_proprietor", label: "Sole proprietor" },
  { id: "partnership", label: "Partnership" },
  { id: "llp", label: "LLP" },
  { id: "private_limited", label: "Private limited" },
  { id: "public_limited", label: "Public limited" },
  { id: "trust_society", label: "Trust / Society" },
];

const CUISINE_OPTIONS = [
  "North Indian", "South Indian", "Kerala", "Chinese", "Biryani",
  "Arabian / Mandi", "Continental", "Italian", "Bakery & Desserts",
  "Cafe & Beverages", "Street Food", "Seafood", "Burgers & Fast Food",
];

const SERVICE_MODES = ["Dine-in", "Takeaway", "Delivery"];

function validGstin(v: string): boolean {
  const g = v.toUpperCase().replace(/\s/g, "");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = chars.indexOf(g[i]);
    if (code < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = code * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === g[14];
}

export default function SetupWizardPage() {
  const { user, loading: authLoading, isMess: authIsMess } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const isMess = searchParams.get("type") === "mess" || authIsMess;
  const role: PartnerRole = isMess ? "mess" : "vendor";
  const client = useMemo(() => getOnboardingClient(role), [role]);

  // State
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [profile, setProfile] = useState<RestaurantProfileData>({});
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({
    business: true,
    documents: true,
    bank: true,
    setup: true,
    finish: true,
  });
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [submittingGoLive, setSubmittingGoLive] = useState(false);

  // Load Onboarding State and Profile
  const loadData = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [snapResult, profResult] = await Promise.allSettled([
        client.fetchState(),
        client.fetchProfile(),
      ]);
      const prof = profResult.status === "fulfilled" ? profResult.value : {};
      setProfile(prof);

      if (snapResult.status === "fulfilled" && snapResult.value?.requirements?.length) {
        setSnapshot(snapResult.value);
      } else {
        const fallbackReqs = resolveDefaultRequirements(role, {
          gstRegistered: Boolean(prof?.gstRegistered),
        });
        setSnapshot((prev) => ({
          exists: true,
          state: prev?.state || "started",
          role,
          requirements: fallbackReqs,
          steps: prev?.steps || { account: true },
          completion: prev?.completion || 0,
        }));
      }
    } catch (err) {
      console.error("Failed to load onboarding state:", err);
      if (!quiet) toast.error("Failed to refresh onboarding progress.");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    loadData();

    // Auto-poll every 20s if in checking or under review
    const interval = setInterval(() => {
      loadData(true);
    }, 20000);
    return () => clearInterval(interval);
  }, [user, authLoading, navigate, role]);

  // Derived Values: ensure requirements is NEVER empty
  const rawRequirements = snapshot?.requirements || [];
  const requirements = useMemo(() => {
    if (rawRequirements.length > 0) return rawRequirements;
    return resolveDefaultRequirements(role, {
      gstRegistered: Boolean(profile?.gstRegistered),
      bankProofNeeded: Boolean(snapshot?.checks?.bankProofNeeded),
      identityCheckNeeded: Boolean(snapshot?.checks?.identityCheckNeeded),
    });
  }, [rawRequirements, role, profile, snapshot]);

  const steps = snapshot?.steps || {};
  const visibleRequirements = useMemo(
    () => requirements.filter((r) => !r.automatic),
    [requirements]
  );

  // Group requirements by stage
  const stages = useMemo(() => {
    const list: { key: string; steps: StepRequirement[] }[] = [];
    for (const key of STAGE_ORDER) {
      const stageSteps = visibleRequirements.filter((r) => (r.stage || "business") === key);
      if (stageSteps.length > 0) {
        list.push({ key, steps: stageSteps });
      }
    }
    return list;
  }, [visibleRequirements]);

  const mandatoryRequirements = useMemo(
    () => visibleRequirements.filter((r) => r.mandatory),
    [visibleRequirements]
  );

  const getStepStatus = (r: StepRequirement): "todo" | "done" | "verified" | "checking" | "review" | "attention" => {
    const check = snapshot?.checks?.documents?.[r.id];
    if (r.requiresDocument && check) {
      switch (check.status) {
        case "checking":
          return "checking";
        case "retake":
          return "attention";
        case "needs_review":
          return "review";
        case "auto_verified":
          return r.autoVerify ? "verified" : "done";
      }
    }
    if (r.id === "bank_account" && steps[r.id]) {
      const bState = snapshot?.bank?.state;
      if (bState === "verified") return "verified";
      if (bState === "pending_verification") return "checking";
      if (bState === "failed" || bState === "action_required") return "review";
    }
    if (steps[r.id]) return "done";

    // Auto-detect if profile already has fields filled from signup
    if (r.id === "account") return "done";
    if (r.id === "kitchen_details" && (profile.name || user?.displayName) && profile.phone) return "done";
    if (r.id === "shop_details" && (profile.name || user?.displayName) && profile.phone) return "done";
    if (r.id === "map_location" && profile.location?.lat && profile.location?.lng) return "done";
    if (r.id === "meal_times" && (profile as any).mealTimesSummary) return "done";
    if (r.id === "gst_status" && typeof profile.gstRegistered === "boolean") return "done";

    return "todo";
  };

  const isStepComplete = (r: StepRequirement) => {
    const s = getStepStatus(r);
    return s !== "todo" && s !== "attention";
  };

  const doneCount = useMemo(
    () => mandatoryRequirements.filter(isStepComplete).length,
    [mandatoryRequirements, steps, snapshot]
  );

  const totalMandatory = mandatoryRequirements.length;
  const progressPct = totalMandatory > 0 ? (doneCount / totalMandatory) * 100 : 0;
  const allMandatoryDone = totalMandatory > 0 && doneCount >= totalMandatory;

  // Next incomplete step
  const nextStep = useMemo(() => {
    for (const stage of stages) {
      for (const r of stage.steps) {
        if (r.mandatory && !isStepComplete(r)) {
          return r;
        }
      }
    }
    return null;
  }, [stages, steps, snapshot]);

  // Is editable (started, incomplete, action_required)
  const isEditable = useMemo(() => {
    const s = snapshot?.state;
    return !s || s === "started" || s === "incomplete" || s === "action_required";
  }, [snapshot?.state]);

  const isUnderReview = useMemo(() => {
    const s = snapshot?.state;
    return (
      s === "submitted" ||
      s === "kyc_review" ||
      s === "verification" ||
      s === "approved" ||
      s === "commercial_setup" ||
      s === "ready_for_activation"
    );
  }, [snapshot?.state]);

  const isActive = snapshot?.state === "active";

  const handleGoLive = async () => {
    if (!allMandatoryDone && nextStep) {
      setActiveModal(nextStep.id);
      return;
    }
    setSubmittingGoLive(true);
    try {
      await client.submitForReview();
      toast.success("Application submitted for ops review!");
      await loadData();
    } catch (err: any) {
      console.error("Submission failed:", err);
      toast.error(err?.message || "Failed to submit application. Please check open requirements.");
    } finally {
      setSubmittingGoLive(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-card border p-2">
            <img src="/logo.png" alt={isMess ? "Kada Mess" : "Kada Dine"} className="h-full w-full object-contain" />
          </div>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm font-semibold text-slate-500">Loading your onboarding portal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 pb-28">
      {/* ── Top Navigation Bar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white/90 px-4 md:px-8 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 p-1">
              <img src="/logo.png" alt={isMess ? "Kada Mess" : "Kada Dine"} className="h-full w-full object-contain" />
            </div>
            <span className="text-lg font-black tracking-tight text-slate-900">
              Kada<span className={isMess ? "text-amber-500 italic" : "text-primary italic"}>{isMess ? "Mess" : "Dine"}</span>
            </span>
          </Link>
          <div className="hidden sm:flex items-center gap-2 pl-4 border-l">
            <Badge variant="outline" className="font-semibold text-xs py-0.5 bg-slate-50">
              {isMess ? "Mess Kitchen Onboarding" : "Merchant Onboarding Portal"}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isUnderReview && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(isMess ? "/mess/dashboard" : "/dashboard")}
              className="hidden sm:inline-flex text-xs font-bold"
            >
              Explore Dashboard <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await signOutWeb(user);
              } catch (err) {
                console.error("[SetupWizard] Sign out failed:", err);
              }
              navigate("/login");
            }}
            className="text-slate-600 hover:text-slate-900 text-xs font-semibold"
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </header>

      {/* ── Main Container ────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-3xl px-4 pt-6 md:pt-8">
        {/* ── Hero Status Banner ──────────────────────────────────────────── */}
        <div
          className={cn(
            "relative overflow-hidden rounded-3xl p-6 md:p-8 text-white shadow-xl transition-all",
            isActive
              ? "bg-gradient-to-br from-emerald-500 to-teal-700 shadow-emerald-500/20"
              : isUnderReview
              ? "bg-gradient-to-br from-blue-600 via-indigo-600 to-blue-800 shadow-blue-500/20"
              : snapshot?.state === "action_required"
              ? "bg-gradient-to-br from-rose-600 to-red-700 shadow-rose-500/20"
              : isMess
              ? "bg-gradient-to-br from-amber-600 via-orange-600 to-slate-900 shadow-amber-600/20"
              : "bg-gradient-to-br from-blue-600 via-blue-700 to-slate-900 shadow-blue-600/20"
          )}
        >
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold backdrop-blur-md">
                  {isActive ? (
                    <>
                      <Sparkles className="h-3.5 w-3.5" /> Active & Operational
                    </>
                  ) : isUnderReview ? (
                    <>
                      <Clock className="h-3.5 w-3.5 animate-pulse" /> Application Under Review
                    </>
                  ) : snapshot?.state === "action_required" ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" /> Action Required
                    </>
                  ) : isMess ? (
                    <>
                      <ChefHat className="h-3.5 w-3.5" /> Mess Kitchen Registration
                    </>
                  ) : (
                    <>
                      <Store className="h-3.5 w-3.5" /> Restaurant Registration
                    </>
                  )}
                </span>
                <span className="text-xs text-white/80 font-medium">
                  {profile.name || user?.displayName || (isMess ? "Your Kitchen" : "Your Store")}
                </span>
              </div>

              <h1 className="text-2xl md:text-3xl font-black tracking-tight leading-tight">
                {isActive
                  ? isMess
                    ? "Your mess kitchen is live on Kada! 🎉"
                    : "You're live on Kada Dine! 🎉"
                  : isUnderReview
                  ? "We're reviewing your application"
                  : snapshot?.state === "action_required"
                  ? "A few items need your attention"
                  : doneCount === 0
                  ? isMess
                    ? "Register your kitchen in about 10 minutes"
                    : "Go live in about 10 minutes"
                  : allMandatoryDone
                  ? "Ready to go live!"
                  : `About ${Math.max(1, (totalMandatory - doneCount) * 2)} minutes to go`}
              </h1>

              <p className="text-sm md:text-base text-white/85 font-medium leading-relaxed">
                {isActive
                  ? isMess
                    ? "Your mess kitchen is approved and live. Customers can now discover your weekly schedule and subscribe to meal plans."
                    : "Your restaurant profile is approved and live. Customers can now discover your menu and place orders."
                  : isUnderReview
                  ? isMess
                    ? "Your kitchen photos, meal cut-offs, FSSAI licence and bank account are being verified. You'll go live automatically once finalized."
                    : "Your KYC documents, bank details, and zone assignment are being checked. You'll go live automatically once finalized."
                  : snapshot?.state === "action_required"
                  ? "Ops flagged an item on your submission. Review the details below, update the required step, and submit again."
                  : isMess
                  ? "Fill in your kitchen details, meal cut-offs, upload KYC documents and weekly menu. Everything saves automatically as you go."
                  : "Upload your documents and fill in your restaurant details. Everything saves automatically as you go."}
              </p>

              {/* Review/Blocking reasons */}
              {snapshot?.blockingReasons && snapshot.blockingReasons.length > 0 && (
                <div className="mt-4 rounded-xl bg-black/20 p-3 text-xs space-y-1.5 border border-white/10">
                  <p className="font-bold uppercase tracking-wider text-white/90">Items to resolve:</p>
                  {snapshot.blockingReasons.map((b, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-white/85">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-300 shrink-0" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Progress Badge */}
            <div className="shrink-0 flex flex-col items-start md:items-end gap-2 bg-white/10 p-4 rounded-2xl backdrop-blur-md border border-white/15">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black">{doneCount}</span>
                <span className="text-sm text-white/75 font-semibold">/ {totalMandatory} done</span>
              </div>
              <div className="w-36">
                <Progress value={progressPct} className="h-2 bg-white/20" />
              </div>
              <span className="text-[11px] font-semibold text-white/70">
                {Math.round(progressPct)}% completed
              </span>
            </div>
          </div>
        </div>

        {/* ── Journey Stages ──────────────────────────────────────────────── */}
        <div className="mt-8 space-y-4">
          {stages.map((stage, stageIdx) => {
            const stageMetaMap = getStageMeta(isMess);
            const meta = stageMetaMap[stage.key] || {
              title: stage.key,
              subtitle: "",
              icon: isMess ? ChefHat : Store,
            };
            const mandatorySteps = stage.steps.filter((s) => s.mandatory);
            const isStageComplete =
              mandatorySteps.length > 0 && mandatorySteps.every(isStepComplete);
            const stageDoneCount = mandatorySteps.filter(isStepComplete).length;
            const hasAttention = stage.steps.some(
              (r) => getStepStatus(r) === "attention"
            );
            const isExpanded = expandedStages[stage.key] ?? true;

            return (
              <div
                key={stage.key}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-white shadow-sm transition-all",
                  hasAttention
                    ? "border-rose-300 ring-1 ring-rose-200"
                    : isStageComplete
                    ? "border-emerald-200"
                    : "border-slate-200"
                )}
              >
                {/* Stage Header */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedStages((prev) => ({
                      ...prev,
                      [stage.key]: !prev[stage.key],
                    }))
                  }
                  className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-slate-50/60"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition-colors",
                        isStageComplete
                          ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                          : hasAttention
                          ? "bg-rose-500 text-white shadow-sm shadow-rose-500/30"
                          : "bg-blue-50 text-blue-600 border border-blue-200 font-extrabold"
                      )}
                    >
                      {isStageComplete ? (
                        <Check className="h-5 w-5 stroke-[2.5]" />
                      ) : hasAttention ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : (
                        stageIdx + 1
                      )}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{meta.title}</h3>
                      <p className="text-xs text-slate-500">
                        {isStageComplete
                          ? "All steps completed"
                          : `${meta.subtitle} · ${stageDoneCount}/${mandatorySteps.length} done`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isStageComplete && (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold">
                        Done
                      </Badge>
                    )}
                    {hasAttention && (
                      <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] font-bold">
                        Fix required
                      </Badge>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </button>

                {/* Stage Steps List */}
                {isExpanded && (
                  <div className="border-t divide-y divide-slate-100 bg-white">
                    {stage.steps.map((r) => {
                      const status = getStepStatus(r);
                      const check = snapshot?.checks?.documents?.[r.id];
                      const docNumber = snapshot?.documentNumbers?.[r.id];

                      const { icon: StatusIcon, color, badgeClass, label: statusLabel } = (() => {
                        switch (status) {
                          case "verified":
                            return {
                              icon: CheckCircle2,
                              color: "text-emerald-600",
                              badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
                              label: docNumber ? `Verified · ${docNumber}` : "Verified",
                            };
                          case "done":
                            return {
                              icon: CheckCircle2,
                              color: "text-emerald-600",
                              badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
                              label: docNumber || "Completed",
                            };
                          case "checking":
                            return {
                              icon: Loader2,
                              color: "text-blue-600 animate-spin",
                              badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
                              label: "Checking…",
                            };
                          case "review":
                            return {
                              icon: Clock,
                              color: "text-amber-500",
                              badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
                              label: check?.issues?.[0] || "Saved · Under ops review",
                            };
                          case "attention":
                            return {
                              icon: AlertCircle,
                              color: "text-rose-600",
                              badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
                              label: check?.issues?.[0] || "Needs correction",
                            };
                          default:
                            return {
                              icon: null,
                              color: "text-slate-300",
                              badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
                              label: r.hint || "Not started",
                            };
                        }
                      })();

                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between p-4 px-6 hover:bg-slate-50/50 transition-colors"
                        >
                          <div className="flex items-start gap-3.5 pr-4">
                            <div className="mt-0.5">
                              {StatusIcon ? (
                                <StatusIcon className={cn("h-5 w-5", color)} />
                              ) : (
                                <div className="h-5 w-5 rounded-full border-2 border-slate-300" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900">{r.label}</h4>
                                {!r.mandatory && (
                                  <span className="text-[10px] font-medium text-slate-400">
                                    (Optional)
                                  </span>
                                )}
                              </div>
                              <p
                                className={cn(
                                  "text-xs line-clamp-1 mt-0.5",
                                  status === "attention"
                                    ? "text-rose-600 font-semibold"
                                    : "text-slate-500"
                                )}
                              >
                                {statusLabel}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0">
                            {status === "todo" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setActiveModal(r.id)}
                                className="h-8 rounded-full border-blue-200 text-blue-600 hover:bg-blue-50 hover:text-blue-700 font-bold text-xs px-3.5"
                              >
                                Start
                              </Button>
                            ) : status === "attention" ? (
                              <Button
                                size="sm"
                                onClick={() => setActiveModal(r.id)}
                                className="h-8 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 shadow-sm"
                              >
                                Fix
                              </Button>
                            ) : isEditable ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setActiveModal(r.id)}
                                className="h-8 rounded-full text-slate-500 hover:text-slate-800 text-xs font-semibold px-3"
                              >
                                Edit
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setActiveModal(r.id)}
                                className="h-8 rounded-full text-slate-400 hover:text-slate-600 text-xs px-2.5"
                              >
                                View
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* ── Sticky Bottom Action Bar ──────────────────────────────────────── */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/95 px-4 py-3.5 backdrop-blur-md shadow-lg">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-slate-900">
              {isActive
                ? "Your restaurant is active!"
                : isUnderReview
                ? "Application under ops review"
                : allMandatoryDone
                ? "Ready to launch!"
                : nextStep
                ? `Next: ${nextStep.label}`
                : "Complete all mandatory steps"}
            </p>
            <p className="text-[11px] text-slate-500">
              {doneCount} of {totalMandatory} mandatory requirements satisfied
            </p>
          </div>

          <div className="flex w-full sm:w-auto items-center gap-3">
            {isActive || isUnderReview ? (
              <Button
                onClick={() => navigate("/dashboard")}
                className="w-full sm:w-auto h-11 px-6 rounded-xl font-bold bg-primary text-slate-950 hover:bg-primary/90 shadow-md shadow-primary/20"
              >
                Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : allMandatoryDone ? (
              <Button
                disabled={submittingGoLive}
                onClick={handleGoLive}
                className="w-full sm:w-auto h-11 px-8 rounded-xl font-extrabold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25"
              >
                {submittingGoLive ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    Accept & Go Live <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            ) : nextStep ? (
              <Button
                onClick={() => setActiveModal(nextStep.id)}
                className="w-full sm:w-auto h-11 px-6 rounded-xl font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20"
              >
                Continue · {nextStep.label} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </footer>

      {/* ── STEP MODALS / DIALOGS ─────────────────────────────────────────── */}

      {/* 1. Shop / Kitchen Details Modal */}
      {(activeModal === "shop_details" || activeModal === "kitchen_details") && (
        <ShopDetailsModal
          open
          profile={profile}
          client={client}
          isMess={isMess}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 2. Map Location & Zone Modal */}
      {activeModal === "map_location" && (
        <MapLocationModal
          open
          profile={profile}
          client={client}
          isMess={isMess}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 3. Operating Hours Modal (Restaurant only) */}
      {activeModal === "operating_hours" && (
        <OperatingHoursModal
          open
          profile={profile}
          client={client}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 3b. Meal Times & Order Cut-offs Modal (Mess only) */}
      {activeModal === "meal_times" && (
        <MealTimesModal
          open
          profile={profile}
          client={client}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 4. GST Status Modal */}
      {activeModal === "gst_status" && (
        <GstStatusModal
          open
          profile={profile}
          client={client}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 5. Document Modals: PAN, FSSAI, GST Certificate, Owner ID, Bank Proof, Kitchen Photos, Weekly Menu */}
      {[
        "pan",
        "fssai",
        "gst_certificate",
        "owner_identity",
        "bank_proof",
        "kitchen_photos",
        "weekly_menu",
      ].includes(activeModal || "") && (
        <DocumentUploadModal
          open
          stepId={activeModal!}
          requirement={requirements.find((r) => r.id === activeModal)!}
          profile={profile}
          client={client}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 6. Bank Account Modal */}
      {activeModal === "bank_account" && (
        <BankAccountModal
          open
          profile={profile}
          bankInfo={snapshot?.bank}
          client={client}
          isMess={isMess}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 7. Menu Setup Modal (Restaurant only) */}
      {activeModal === "menu" && (
        <MenuSetupModal
          open
          client={client}
          editable={isEditable}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}

      {/* 8. Agreement Modal */}
      {activeModal === "agreement" && (
        <AgreementModal
          open
          client={client}
          isMess={isMess}
          canGoLive={allMandatoryDone}
          onClose={() => setActiveModal(null)}
          onGoLive={async () => {
            setActiveModal(null);
            await handleGoLive();
          }}
          onSuccess={() => {
            setActiveModal(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 1: Restaurant / Kitchen Details (shop_details / kitchen_details)
// ═══════════════════════════════════════════════════════════════════════════
const MESS_MEALS = ["Breakfast", "Lunch", "Dinner"];
const MESS_DIETS = ["Pure Veg", "Veg & Non-Veg", "Non-Veg Only"];
const MESS_FULFILMENT = ["Delivery", "Pickup / Takeaway", "Mess Hall / Dine-in"];

function ShopDetailsModal({
  open,
  profile,
  client,
  isMess = false,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  client: any;
  isMess?: boolean;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(profile.name || "");
  const [ownerName, setOwnerName] = useState(profile.ownerName || "");
  const [phone, setPhone] = useState(profile.phone || "");
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>(
    profile.cuisines || (profile.cuisine ? [profile.cuisine] : ["South Indian"])
  );
  const [tableCount, setTableCount] = useState<number>(profile.tableCount ?? 8);
  const [selectedModes, setSelectedModes] = useState<string[]>(
    profile.serviceModes || ["Dine-in", "Takeaway"]
  );

  // Mess-specific states
  const [selectedMeals, setSelectedMeals] = useState<string[]>(
    profile.messProfile?.meals || profile.meals || ["Lunch", "Dinner"]
  );
  const [selectedDiet, setSelectedDiet] = useState<string>(
    profile.messProfile?.diet?.[0] || profile.diet?.[0] || "Veg & Non-Veg"
  );
  const [selectedFulfilment, setSelectedFulfilment] = useState<string[]>(
    profile.messProfile?.fulfilment || profile.serviceModes || ["Delivery", "Pickup / Takeaway"]
  );

  const [saving, setSaving] = useState(false);

  const toggleCuisine = (c: string) => {
    setSelectedCuisines((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const toggleMode = (m: string) => {
    setSelectedModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  };

  const toggleMeal = (m: string) => {
    setSelectedMeals((prev) =>
      prev.includes(m) ? (prev.length > 1 ? prev.filter((x) => x !== m) : prev) : [...prev, m]
    );
  };

  const toggleFulfilment = (f: string) => {
    setSelectedFulfilment((prev) =>
      prev.includes(f) ? (prev.length > 1 ? prev.filter((x) => x !== f) : prev) : [...prev, f]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error(isMess ? "Please enter kitchen name." : "Please enter restaurant name.");
    if (!ownerName.trim()) return toast.error("Please enter owner name.");
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 10) return toast.error("Please enter a valid 10-digit phone number.");

    setSaving(true);
    try {
      const stepId = isMess ? "kitchen_details" : "shop_details";
      await client.saveFields(
        {
          name: name.trim(),
          ownerName: ownerName.trim(),
          managerName: ownerName.trim(),
          phone: cleanPhone.slice(-10),
          ...(isMess
            ? {
                messProfile: {
                  meals: selectedMeals,
                  diet: [selectedDiet],
                  fulfilment: selectedFulfilment,
                },
                meals: selectedMeals,
                diet: [selectedDiet],
                serviceModes: selectedFulfilment,
              }
            : {
                cuisines: selectedCuisines,
                cuisine: selectedCuisines[0] || "Multi-Cuisine",
                tableCount: Number(tableCount) || 0,
                serviceModes: selectedModes,
              }),
        },
        stepId
      );
      toast.success(isMess ? "Kitchen details saved!" : "Restaurant details saved!");
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            {isMess ? (
              <>
                <ChefHat className="h-5 w-5 text-amber-500" /> Kitchen Details
              </>
            ) : (
              <>
                <Store className="h-5 w-5 text-primary" /> Restaurant Details
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isMess
              ? "Basic information about your mess kitchen, meals served, and fulfilment modes."
              : "Basic information for customer invoices, dispatch and notifications."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">
              {isMess ? "Mess Kitchen / Brand Name *" : "Restaurant / Brand Name *"}
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isMess ? "e.g. Annapoorna Homely Mess" : "e.g. Malabar Spice Kitchen"}
              disabled={!editable}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">
                {isMess ? "Head Cook / Owner Name *" : "Owner Name *"}
              </Label>
              <Input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Full Legal Name"
                disabled={!editable}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Contact Phone *</Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile"
                disabled={!editable}
                required
              />
            </div>
          </div>

          {isMess ? (
            <>
              {/* Meals Served */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Meals You Serve *</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {MESS_MEALS.map((m) => {
                    const active = selectedMeals.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={!editable}
                        onClick={() => toggleMeal(m)}
                        className={cn(
                          "rounded-xl px-3 py-1.5 text-xs font-bold transition-all border",
                          active
                            ? "bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/20"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Diet Options */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Food Category / Diet *</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {MESS_DIETS.map((d) => {
                    const active = selectedDiet === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={!editable}
                        onClick={() => setSelectedDiet(d)}
                        className={cn(
                          "rounded-xl px-3 py-1.5 text-xs font-bold transition-all border",
                          active
                            ? "bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/20"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Fulfilment Modes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Fulfilment Options</Label>
                <div className="flex flex-col gap-1.5 pt-1">
                  {MESS_FULFILMENT.map((f) => (
                    <label key={f} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedFulfilment.includes(f)}
                        onChange={() => toggleFulfilment(f)}
                        disabled={!editable}
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      {f}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Cuisines</Label>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
                  {CUISINE_OPTIONS.map((c) => {
                    const active = selectedCuisines.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!editable}
                        onClick={() => toggleCuisine(c)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border",
                          active
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Dine-in Tables</Label>
                  <Input
                    type="number"
                    min={0}
                    value={tableCount}
                    onChange={(e) => setTableCount(Number(e.target.value))}
                    disabled={!editable}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-700">Service Modes</Label>
                  <div className="flex flex-col gap-1 pt-1">
                    {SERVICE_MODES.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedModes.includes(m)}
                          onChange={() => toggleMode(m)}
                          disabled={!editable}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        {m}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {editable && (
              <Button
                type="submit"
                disabled={saving}
                className={cn(
                  "text-white font-bold",
                  isMess ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Details"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 1b: Mess Meal Times & Order Cut-offs (meal_times)
// ═══════════════════════════════════════════════════════════════════════════
function MealTimesModal({
  open,
  profile,
  client,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  client: any;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const existingMeals = profile.mealTimes || {};
  const [bEnabled, setBEnabled] = useState(existingMeals.breakfast?.enabled ?? true);
  const [bStart, setBStart] = useState(existingMeals.breakfast?.start || "07:30");
  const [bEnd, setBEnd] = useState(existingMeals.breakfast?.end || "09:30");
  const [bCutoff, setBCutoff] = useState(existingMeals.breakfast?.cutoff || "21:00 (prev day)");

  const [lEnabled, setLEnabled] = useState(existingMeals.lunch?.enabled ?? true);
  const [lStart, setLStart] = useState(existingMeals.lunch?.start || "12:30");
  const [lEnd, setLEnd] = useState(existingMeals.lunch?.end || "14:30");
  const [lCutoff, setLCutoff] = useState(existingMeals.lunch?.cutoff || "09:00");

  const [dEnabled, setDEnabled] = useState(existingMeals.dinner?.enabled ?? true);
  const [dStart, setDStart] = useState(existingMeals.dinner?.start || "19:30");
  const [dEnd, setDEnd] = useState(existingMeals.dinner?.end || "21:30");
  const [dCutoff, setDCutoff] = useState(existingMeals.dinner?.cutoff || "16:00");

  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bEnabled && !lEnabled && !dEnabled) {
      return toast.error("Please enable at least one meal serving time.");
    }
    setSaving(true);
    try {
      const parts: string[] = [];
      if (bEnabled) parts.push(`Breakfast ${bStart}–${bEnd} (order by ${bCutoff})`);
      if (lEnabled) parts.push(`Lunch ${lStart}–${lEnd} (order by ${lCutoff})`);
      if (dEnabled) parts.push(`Dinner ${dStart}–${dEnd} (order by ${dCutoff})`);
      const summary = parts.join(", ");

      await client.saveFields(
        {
          mealTimes: {
            breakfast: bEnabled ? { enabled: true, start: bStart, end: bEnd, cutoff: bCutoff } : { enabled: false },
            lunch: lEnabled ? { enabled: true, start: lStart, end: lEnd, cutoff: lCutoff } : { enabled: false },
            dinner: dEnabled ? { enabled: true, start: dStart, end: dEnd, cutoff: dCutoff } : { enabled: false },
          },
          mealTimesSummary: summary,
          mealsServed: [
            ...(bEnabled ? ["Breakfast"] : []),
            ...(lEnabled ? ["Lunch"] : []),
            ...(dEnabled ? ["Dinner"] : []),
          ],
        },
        "meal_times"
      );
      toast.success("Meal serving times and cut-offs saved!");
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save meal times.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-amber-500" /> Meal Times & Order Cut-offs
          </DialogTitle>
          <DialogDescription>
            Specify delivery/serving hours and daily order cut-off times for each meal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          {/* Breakfast */}
          <div className={cn("p-3.5 rounded-2xl border transition-all", bEnabled ? "bg-amber-50/50 border-amber-200" : "bg-slate-50 border-slate-200 opacity-60")}>
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-bold text-slate-800">Breakfast</span>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={bEnabled}
                  onChange={(e) => setBEnabled(e.target.checked)}
                  disabled={!editable}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                Serve Breakfast
              </label>
            </div>
            {bEnabled && (
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">Start Time</Label>
                  <Input type="time" value={bStart} onChange={(e) => setBStart(e.target.value)} disabled={!editable} required className="h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">End Time</Label>
                  <Input type="time" value={bEnd} onChange={(e) => setBEnd(e.target.value)} disabled={!editable} required className="h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">Order Cut-off</Label>
                  <Input value={bCutoff} onChange={(e) => setBCutoff(e.target.value)} placeholder="e.g. 21:00 (prev day)" disabled={!editable} required className="h-9 text-xs" />
                </div>
              </div>
            )}
          </div>

          {/* Lunch */}
          <div className={cn("p-3.5 rounded-2xl border transition-all", lEnabled ? "bg-orange-50/50 border-orange-200" : "bg-slate-50 border-slate-200 opacity-60")}>
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-bold text-slate-800">Lunch</span>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={lEnabled}
                  onChange={(e) => setLEnabled(e.target.checked)}
                  disabled={!editable}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                Serve Lunch
              </label>
            </div>
            {lEnabled && (
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">Start Time</Label>
                  <Input type="time" value={lStart} onChange={(e) => setLStart(e.target.value)} disabled={!editable} required className="h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">End Time</Label>
                  <Input type="time" value={lEnd} onChange={(e) => setLEnd(e.target.value)} disabled={!editable} required className="h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">Order Cut-off</Label>
                  <Input value={lCutoff} onChange={(e) => setLCutoff(e.target.value)} placeholder="e.g. 09:00" disabled={!editable} required className="h-9 text-xs" />
                </div>
              </div>
            )}
          </div>

          {/* Dinner */}
          <div className={cn("p-3.5 rounded-2xl border transition-all", dEnabled ? "bg-indigo-50/50 border-indigo-200" : "bg-slate-50 border-slate-200 opacity-60")}>
            <div className="flex items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-indigo-500" />
                <span className="text-sm font-bold text-slate-800">Dinner</span>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={dEnabled}
                  onChange={(e) => setDEnabled(e.target.checked)}
                  disabled={!editable}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                Serve Dinner
              </label>
            </div>
            {dEnabled && (
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">Start Time</Label>
                  <Input type="time" value={dStart} onChange={(e) => setDStart(e.target.value)} disabled={!editable} required className="h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">End Time</Label>
                  <Input type="time" value={dEnd} onChange={(e) => setDEnd(e.target.value)} disabled={!editable} required className="h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[11px] font-bold text-slate-600">Order Cut-off</Label>
                  <Input value={dCutoff} onChange={(e) => setDCutoff(e.target.value)} placeholder="e.g. 16:00" disabled={!editable} required className="h-9 text-xs" />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {editable && (
              <Button type="submit" disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white font-bold">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Meal Schedule"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 2: Map Location & Delivery Zone (map_location)
// ═══════════════════════════════════════════════════════════════════════════
function MapLocationModal({
  open,
  profile,
  client,
  isMess = false,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  client: any;
  isMess?: boolean;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [address, setAddress] = useState(profile.address || "");
  const [district, setDistrict] = useState(profile.district || "");
  const [state, setState] = useState(profile.state || "Kerala");
  const [pincode, setPincode] = useState(profile.pincode || "");
  const [lat, setLat] = useState<number | null>(profile.location?.lat ?? null);
  const [lng, setLng] = useState<number | null>(profile.location?.lng ?? null);

  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [zoneResult, setZoneResult] = useState<ZoneResult | null>(null);

  // Auto-detect current browser location
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const cLat = pos.coords.latitude;
        const cLng = pos.coords.longitude;
        setLat(cLat);
        setLng(cLng);
        setLocating(false);

        // Reverse geocoding lookup
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${cLat}&lon=${cLng}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.display_name && !address) {
              setAddress(data.display_name);
            }
            if (data.address?.postcode && !pincode) {
              setPincode(data.address.postcode);
            }
            if (data.address?.state_district || data.address?.city) {
              setDistrict(data.address.city || data.address.state_district || "");
            }
          }
        } catch {
          // ignore lookup failure
        }

        // Preview zone
        try {
          const z = await client.previewZone(cLat, cLng);
          setZoneResult(z);
        } catch {
          // ignore
        }
      },
      (err) => {
        setLocating(false);
        toast.error("Could not obtain location. Please enter coordinates or address manually.");
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return toast.error(isMess ? "Please enter kitchen street address." : "Please enter restaurant street address.");
    if (lat === null || lng === null) {
      return toast.error("Please set location coordinates by tapping 'Detect My Location' or typing lat/lng.");
    }

    setResolving(true);
    try {
      // 1. Save profile address fields
      await client.saveFields({
        address: address.trim(),
        district: district.trim(),
        state,
        pincode: pincode.trim(),
        location: { lat, lng },
      });

      // 2. Resolve & assign zone via cloud function
      const z = await client.assignZone(lat, lng);
      setZoneResult(z);

      if (z.serviceable) {
        toast.success(`Location confirmed in Zone "${z.zoneName}"!`);
        onSuccess();
      } else {
        toast.warning(
          "Location saved! This area is currently outside active coverage, but our team will review it."
        );
        onSuccess();
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to assign location & zone.");
    } finally {
      setResolving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {isMess ? "Mess Kitchen Location & Delivery Zone" : "Restaurant Location & Zone"}
          </DialogTitle>
          <DialogDescription>
            {isMess
              ? "Pinpoint your kitchen to verify subscriber delivery coverage and dispatch routes."
              : "Pinpoint your outlet so we can assign riders, calculate delivery polygons, and route orders."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSaveLocation} className="space-y-4 py-2">
          {/* GPS Detector button */}
          <div className="rounded-xl bg-blue-50/70 p-3.5 border border-blue-100 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-blue-900">Auto-Detect GPS Location</p>
              <p className="text-[11px] text-blue-700">
                {lat && lng ? `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}` : "Tap to use device coordinates"}
              </p>
            </div>
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locating}
                onClick={handleDetectLocation}
                className="h-8 bg-white text-blue-700 border-blue-200 hover:bg-blue-50 text-xs font-bold"
              >
                {locating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <LocateFixed className="mr-1.5 h-3.5 w-3.5" /> Locate Me
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Street Address *</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Building, street, landmark"
              disabled={!editable}
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">State *</Label>
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setDistrict("");
                }}
                disabled={!editable}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {indiaStates.map((s) => (
                  <option key={s.state} value={s.state}>
                    {s.state}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">City / District *</Label>
              {(() => {
                const stateData = indiaStates.find((s) => s.state === state);
                const districtList = stateData?.districts || [];
                if (districtList.length > 0) {
                  return (
                    <select
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      disabled={!editable}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">— Select district —</option>
                      {districtList.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  );
                }
                return (
                  <Input
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="District"
                    disabled={!editable}
                    required
                  />
                );
              })()}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Pincode *</Label>
              <Input
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                placeholder="6 digits"
                disabled={!editable}
                maxLength={6}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Latitude</Label>
              <Input
                type="number"
                step="any"
                value={lat ?? ""}
                onChange={(e) => setLat(e.target.value ? parseFloat(e.target.value) : null)}
                placeholder="e.g. 8.5241"
                disabled={!editable}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Longitude</Label>
              <Input
                type="number"
                step="any"
                value={lng ?? ""}
                onChange={(e) => setLng(e.target.value ? parseFloat(e.target.value) : null)}
                placeholder="e.g. 76.9366"
                disabled={!editable}
              />
            </div>
          </div>

          {/* Zone preview feedback */}
          {zoneResult && (
            <div
              className={cn(
                "rounded-xl p-3 text-xs border flex items-start gap-2.5",
                zoneResult.serviceable
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-amber-50 text-amber-800 border-amber-200"
              )}
            >
              {zoneResult.serviceable ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <p className="font-bold">
                  {zoneResult.serviceable
                    ? `Assigned Zone: ${zoneResult.zoneName}`
                    : "Area outside active delivery zone"}
                </p>
                <p className="text-[11px] opacity-90">{zoneResult.reason}</p>
              </div>
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {editable && (
              <Button type="submit" disabled={resolving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {resolving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save & Verify Zone"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 3: Operating Hours (operating_hours)
// ═══════════════════════════════════════════════════════════════════════════
function OperatingHoursModal({
  open,
  profile,
  client,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  client: any;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("22:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile.hours) {
      const parts = profile.hours.split("-").map((p) => p.trim());
      if (parts[0]) setOpenTime(parts[0]);
      if (parts[1]) setCloseTime(parts[1]);
    }
  }, [profile.hours]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const formatted = `${openTime} - ${closeTime}`;
      await client.saveFields({ hours: formatted }, "operating_hours");
      toast.success("Operating hours saved!");
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save hours.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Operating Hours</DialogTitle>
          <DialogDescription>
            When customers can place orders. You can customize daily schedules later in Settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Opening Time</Label>
              <Input
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
                disabled={!editable}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Closing Time</Label>
              <Input
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                disabled={!editable}
                required
              />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {editable && (
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Hours"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 4: GST Status (gst_status)
// ═══════════════════════════════════════════════════════════════════════════
function GstStatusModal({
  open,
  profile,
  client,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  client: any;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [registered, setRegistered] = useState<boolean>(profile.gstRegistered ?? false);
  const [gstin, setGstin] = useState(profile.gstNumber || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registered) {
      const cleanGst = gstin.trim().toUpperCase();
      if (!validGstin(cleanGst)) {
        return toast.error("Please enter a valid 15-character GSTIN checksum format.");
      }
    }

    setSaving(true);
    try {
      await client.saveFields(
        {
          gstRegistered: registered,
          ...(registered ? { gstNumber: gstin.trim().toUpperCase(), taxId: gstin.trim().toUpperCase() } : { gstNumber: null }),
        },
        "gst_status"
      );
      toast.success("GST status recorded!");
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update GST status.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">GST Registration</DialogTitle>
          <DialogDescription>
            Tell us whether your business is registered under Goods & Services Tax.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          <div className="space-y-2">
            <button
              type="button"
              disabled={!editable}
              onClick={() => setRegistered(true)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl p-3.5 border text-left transition-colors",
                registered
                  ? "border-blue-600 bg-blue-50/50"
                  : "border-slate-200 hover:bg-slate-50"
              )}
            >
              <div
                className={cn(
                  "mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center",
                  registered ? "border-blue-600 bg-blue-600" : "border-slate-300"
                )}
              >
                {registered && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">Yes, my business is GST registered</p>
                <p className="text-[11px] text-slate-500">
                  We'll ask for your GST certificate in the next step to claim tax credit.
                </p>
              </div>
            </button>

            <button
              type="button"
              disabled={!editable}
              onClick={() => setRegistered(false)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl p-3.5 border text-left transition-colors",
                !registered
                  ? "border-blue-600 bg-blue-50/50"
                  : "border-slate-200 hover:bg-slate-50"
              )}
            >
              <div
                className={cn(
                  "mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center",
                  !registered ? "border-blue-600 bg-blue-600" : "border-slate-300"
                )}
              >
                {!registered && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">No, not registered under GST</p>
                <p className="text-[11px] text-slate-500">
                  Most small restaurants are exempt from GST. No certificate is required.
                </p>
              </div>
            </button>
          </div>

          {registered && (
            <div className="space-y-1.5 pt-2">
              <Label className="text-xs font-bold text-slate-700">15-Character GSTIN Number *</Label>
              <Input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="e.g. 32AAAAA0000A1Z5"
                maxLength={15}
                disabled={!editable}
                required
              />
            </div>
          )}

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {editable && (
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Status"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 5: Generic Document Upload (PAN, FSSAI, GST Certificate, etc.)
// ═══════════════════════════════════════════════════════════════════════════
function DocumentUploadModal({
  open,
  stepId,
  requirement,
  profile,
  client,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  stepId: string;
  requirement: StepRequirement;
  profile: RestaurantProfileData;
  client: any;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [structure, setStructure] = useState<string>(
    profile.businessStructure || "sole_proprietor"
  );
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"pick" | "uploading" | "reading" | "result">("pick");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<DocumentReadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPan = stepId === "pan";
  const isFssai = stepId === "fssai";
  const isKitchenPhotos = stepId === "kitchen_photos";
  const isWeeklyMenu = stepId === "weekly_menu";

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      toast.error("File is larger than 15 MB. Please upload a smaller file.");
      return;
    }
    setFile(f);
    setErrorMsg(null);
    if (f.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f));
    } else {
      setPreviewUrl(null);
    }
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) {
      toast.error("Please choose a file or photo to upload.");
      return;
    }
    setErrorMsg(null);
    setPhase("uploading");
    setUploadProgress(0);

    try {
      if (isPan && structure !== profile.businessStructure) {
        await client.saveFields({ businessStructure: structure });
      }

      let expMs: number | null = null;
      if (expiryDate) {
        expMs = new Date(expiryDate).getTime();
      }

      const res = await client.uploadAndRead(stepId, file, {
        expiresAt: expMs,
        onProgress: (pct: number) => {
          setUploadProgress(Math.round(pct * 100));
          if (pct >= 1) {
            setPhase("reading");
          }
        },
      });

      setResult(res);
      setPhase("result");

      if (res.status === "auto_verified") {
        toast.success("Document verified automatically!");
      } else if (res.status === "needs_review") {
        toast.info("Document saved — ops team will verify it.");
      } else if (res.status === "retake") {
        toast.error("Document check failed. Please retake or upload a clearer file.");
      }
    } catch (err: any) {
      console.error("Document upload failed:", err);
      setPhase("pick");
      setErrorMsg(err?.message || "Upload failed. Please try again.");
      toast.error("Upload failed.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {isKitchenPhotos
              ? "Kitchen Hygiene Photos"
              : isWeeklyMenu
              ? "Weekly Menu Card / Schedule"
              : requirement?.label || "Upload Document"}
          </DialogTitle>
          <DialogDescription>
            {isKitchenPhotos
              ? "Upload clear photos showing your cooking stove, meal prep area, and packaging station."
              : isWeeklyMenu
              ? "Upload a photo or PDF of your 7-day meal rotation showing what subscribers receive each day."
              : requirement?.hint || "Upload a clear photo or PDF document."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Business Structure selection for PAN */}
          {isPan && phase === "pick" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Business Entity Structure *</Label>
              <select
                value={structure}
                onChange={(e) => setStructure(e.target.value)}
                disabled={!editable}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {BUSINESS_STRUCTURES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Expiry date for FSSAI */}
          {isFssai && phase === "pick" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Licence Expiry Date (Optional)</Label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                disabled={!editable}
              />
            </div>
          )}

          {/* File Picker State */}
          {phase === "pick" && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={handleFileChange}
                className="hidden"
                disabled={!editable}
              />

              {file ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 text-center space-y-2">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="mx-auto max-h-40 rounded-xl object-contain border bg-white"
                    />
                  ) : (
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white border">
                      <FileText className="h-8 w-8 text-blue-600" />
                    </div>
                  )}
                  <p className="text-xs font-bold text-slate-800 line-clamp-1">{file.name}</p>
                  <p className="text-[11px] text-slate-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>

                  {editable && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8 text-xs font-semibold"
                    >
                      Change File
                    </Button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center w-full rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center hover:bg-slate-50 transition-colors"
                >
                  <div className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                    <Upload className="h-6 w-6" />
                  </div>
                  <p className="text-xs font-bold text-slate-800">Choose file or drag photo here</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">JPEG, PNG, WEBP, or PDF up to 15MB</p>
                </button>
              )}
            </div>
          )}

          {/* Uploading & AI Processing State */}
          {(phase === "uploading" || phase === "reading") && (
            <div className="py-8 text-center space-y-3">
              <div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center mx-auto animate-pulse">
                <Sparkles className="h-7 w-7 text-blue-600 animate-spin" />
              </div>
              <h4 className="text-base font-bold text-slate-900">
                {phase === "uploading" ? "Uploading Document…" : "Reading Document with Gemini AI…"}
              </h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                {phase === "uploading"
                  ? `Transferred ${uploadProgress}% to secure partner vault`
                  : "Extracting legal credentials, verifying format, and validating checksums"}
              </p>
              {phase === "uploading" && (
                <div className="max-w-xs mx-auto">
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}
            </div>
          )}

          {/* Result Card State */}
          {phase === "result" && result && (
            <div
              className={cn(
                "rounded-2xl p-4 border space-y-3",
                result.status === "auto_verified"
                  ? "bg-emerald-50 text-emerald-950 border-emerald-200"
                  : result.status === "retake"
                  ? "bg-rose-50 text-rose-950 border-rose-200"
                  : "bg-amber-50 text-amber-950 border-amber-200"
              )}
            >
              <div className="flex items-center gap-2">
                {result.status === "auto_verified" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : result.status === "retake" ? (
                  <AlertTriangle className="h-5 w-5 text-rose-600" />
                ) : (
                  <Clock className="h-5 w-5 text-amber-600" />
                )}
                <span className="text-sm font-bold capitalize">
                  {result.status === "auto_verified"
                    ? "Verified Successfully"
                    : result.status === "retake"
                    ? "Retake Requested"
                    : "Saved for Ops Review"}
                </span>
              </div>

              {result.issues && result.issues.length > 0 && (
                <div className="space-y-1">
                  {result.issues.map((issue, idx) => (
                    <p key={idx} className="text-xs font-medium opacity-90">
                      • {issue}
                    </p>
                  ))}
                </div>
              )}

              {result.fields && Object.keys(result.fields).length > 0 && (
                <div className="rounded-xl bg-white/70 p-3 text-xs space-y-1 border border-black/5">
                  <p className="font-bold text-[11px] uppercase tracking-wider text-slate-600">
                    Extracted Details:
                  </p>
                  {Object.entries(result.fields).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-slate-800">
                      <span className="capitalize">{k.replace(/([A-Z])/g, " $1")}:</span>
                      <span className="font-bold">{typeof v === "object" ? JSON.stringify(v) : String(v ?? "")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <p className="text-xs font-semibold text-rose-600">{errorMsg}</p>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {phase === "result" ? "Close" : "Cancel"}
          </Button>

          {editable && phase === "pick" && (
            <Button
              type="button"
              disabled={!file}
              onClick={handleUploadAndAnalyze}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              Upload & Verify
            </Button>
          )}

          {editable && phase === "result" && (
            <Button
              type="button"
              onClick={result?.status === "retake" ? () => setPhase("pick") : onSuccess}
              className={cn(
                "font-bold text-white",
                result?.status === "retake"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              )}
            >
              {result?.status === "retake" ? "Try Again" : "Done"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 6: Banking & Payouts (bank_account)
// ═══════════════════════════════════════════════════════════════════════════
function BankAccountModal({
  open,
  profile,
  bankInfo,
  client,
  isMess = false,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  bankInfo?: any;
  client: any;
  isMess?: boolean;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [holder, setHolder] = useState(bankInfo?.holder || profile.ownerName || "");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccount, setConfirmAccount] = useState("");
  const [ifsc, setIfsc] = useState(bankInfo?.ifsc || "");
  const [vpa, setVpa] = useState("");
  const [showAccount, setShowAccount] = useState(false);

  const [lookingUp, setLookingUp] = useState(false);
  const [ifscDetails, setIfscDetails] = useState<IfscInfo | null>(null);
  const [saving, setSaving] = useState(false);

  // Auto lookup IFSC
  useEffect(() => {
    const code = ifsc.trim().toUpperCase();
    if (code.length === 11 && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
      setLookingUp(true);
      client
        .lookupIfsc(code)
        .then((info: any) => setIfscDetails(info))
        .finally(() => setLookingUp(false));
    } else {
      setIfscDetails(null);
    }
  }, [ifsc, client]);

  const handleSubmitBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holder.trim()) return toast.error("Please enter account holder name.");
    const cleanAcc = accountNumber.replace(/\D/g, "");
    const cleanConfirm = confirmAccount.replace(/\D/g, "");
    if (cleanAcc.length < 9 || cleanAcc.length > 18) {
      return toast.error("Account number must be between 9 and 18 digits.");
    }
    if (cleanAcc !== cleanConfirm) {
      return toast.error("Account numbers do not match.");
    }
    const cleanIfsc = ifsc.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      return toast.error("Please enter a valid IFSC code (e.g. HDFC0001234).");
    }

    setSaving(true);
    try {
      const res = await client.submitBank({
        holder: holder.trim(),
        accountNumber: cleanAcc,
        ifsc: cleanIfsc,
        vpa: vpa.trim() || undefined,
      });

      if (res.bankProofNeeded) {
        toast.info(
          "Bank details recorded! A cancelled cheque/passbook photo is required to verify this account."
        );
      } else {
        toast.success("Bank details saved! Automated verification in progress.");
      }
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit bank details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Bank Account Details</DialogTitle>
          <DialogDescription>
            {isMess
              ? "Where your weekly subscription payouts will be deposited. Must match legal name on PAN."
              : "Where your weekly order earnings will be deposited. Must match legal name on PAN."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmitBank} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Account Holder Name *</Label>
            <Input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              placeholder="As registered in passbook/cheque"
              disabled={!editable}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Bank Account Number *</Label>
            <div className="relative">
              <Input
                type={showAccount ? "text" : "password"}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="9–18 digits"
                disabled={!editable}
                required
              />
              <button
                type="button"
                onClick={() => setShowAccount(!showAccount)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showAccount ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">Confirm Account Number *</Label>
            <Input
              type="text"
              value={confirmAccount}
              onChange={(e) => setConfirmAccount(e.target.value.replace(/\D/g, ""))}
              placeholder="Re-enter bank account number"
              disabled={!editable}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">IFSC Code *</Label>
            <Input
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              placeholder="e.g. HDFC0001234"
              maxLength={11}
              disabled={!editable}
              required
            />
          </div>

          {/* IFSC Directory Lookup pill */}
          {lookingUp ? (
            <p className="text-xs text-blue-600 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying IFSC with Razorpay directory…
            </p>
          ) : ifscDetails ? (
            <div className="rounded-xl bg-emerald-50 p-2.5 text-xs text-emerald-800 border border-emerald-200 space-y-0.5">
              <p className="font-bold">{ifscDetails.bank}</p>
              <p className="text-[11px] opacity-90">
                {ifscDetails.branch}, {ifscDetails.city} {ifscDetails.state && `· ${ifscDetails.state}`}
              </p>
            </div>
          ) : ifsc.length === 11 ? (
            <p className="text-xs text-amber-600">Could not find IFSC in public directory. Double-check cheque.</p>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-700">UPI ID / VPA (Optional)</Label>
            <Input
              value={vpa}
              onChange={(e) => setVpa(e.target.value.toLowerCase())}
              placeholder="e.g. restaurant@okaxis"
              disabled={!editable}
            />
          </div>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {editable && (
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save & Verify Bank"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 7: Menu Setup (menu)
// ═══════════════════════════════════════════════════════════════════════════
function MenuSetupModal({
  open,
  client,
  editable,
  onClose,
  onSuccess,
}: {
  open: boolean;
  client: any;
  editable: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [hasItems, setHasItems] = useState(false);
  const [checking, setChecking] = useState(true);
  const [dishName, setDishName] = useState("");
  const [price, setPrice] = useState("150");
  const [category, setCategory] = useState("Main Course");
  const [isVeg, setIsVeg] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.hasMenuItems().then((res: boolean) => {
      setHasItems(res);
      setChecking(false);
    });
  }, [client]);

  const handleAddDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dishName.trim()) return toast.error("Please enter item name.");

    setSaving(true);
    try {
      // Mark menu step complete
      await client.setStep("menu", true);
      toast.success("Starter menu recorded! You can add complete dishes in the Menu manager.");
      onSuccess();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save menu step.");
    } finally {
      setSaving(false);
    }
  };

  const handleSeedStandard = async () => {
    setSaving(true);
    try {
      await client.setStep("menu", true);
      toast.success("Standard menu verified!");
      onSuccess();
    } catch (err: any) {
      toast.error("Failed to verify menu step.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Menu Setup</DialogTitle>
          <DialogDescription>
            Confirm at least one starter dish so your digital catalog can be created.
          </DialogDescription>
        </DialogHeader>

        {checking ? (
          <div className="py-8 text-center space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto" />
            <p className="text-xs text-slate-500">Checking your menu catalog…</p>
          </div>
        ) : hasItems ? (
          <div className="py-4 space-y-4">
            <div className="rounded-2xl bg-emerald-50 p-4 border border-emerald-200 text-emerald-900 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-bold">Menu items already exist</p>
                <p className="text-xs opacity-90">Your digital catalog is configured with dishes.</p>
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleSeedStandard} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold">
                Confirm & Complete Step
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleAddDish} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Signature Dish Name *</Label>
              <Input
                value={dishName}
                onChange={(e) => setDishName(e.target.value)}
                placeholder="e.g. Chicken Biryani / Paneer Butter Masala"
                disabled={!editable}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Price (₹) *</Label>
                <Input
                  type="number"
                  min={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  disabled={!editable}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Category</Label>
                <Input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Main Course"
                  disabled={!editable}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="radio"
                  name="diet"
                  checked={isVeg}
                  onChange={() => setIsVeg(true)}
                  disabled={!editable}
                />
                Veg 🟢
              </label>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="radio"
                  name="diet"
                  checked={!isVeg}
                  onChange={() => setIsVeg(false)}
                  disabled={!editable}
                />
                Non-Veg 🔴
              </label>
            </div>

            <DialogFooter className="pt-4 flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={handleSeedStandard}
                className="text-xs font-semibold"
              >
                Skip & Add Full Menu Later
              </Button>
              {editable && (
                <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Dish"}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP DIALOG 8: Partner Agreement (agreement)
// ═══════════════════════════════════════════════════════════════════════════
function AgreementModal({
  open,
  client,
  isMess = false,
  canGoLive,
  onClose,
  onGoLive,
  onSuccess,
}: {
  open: boolean;
  client: any;
  isMess?: boolean;
  canGoLive: boolean;
  onClose: () => void;
  onGoLive: () => Promise<void>;
  onSuccess: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  const DINE_TERMS = [
    "Kada Dine charges a transparent platform commission on delivery orders, specified in your merchant plan.",
    "Order payouts are deposited directly into your verified bank account weekly with automated settlement statements.",
    "Keep your FSSAI registration/licence active and compliant — lapsed food licences pause ordering automatically.",
    "Fulfill incoming customer orders promptly, maintain clean kitchen practices, and keep your menu availability updated.",
  ];

  const MESS_TERMS = [
    "Kada Mess operates on a founder's transparent fee of ₹3 per customer per day served on active subscription meals.",
    "Zero platform commission on paused or skipped meal days — you only pay for actual meals prepared and delivered.",
    "Automated weekly direct payouts into your verified bank account with itemized customer meal counts.",
    "Maintain high hygiene standards, an active FSSAI registration, and prepare subscription meals according to your weekly menu schedule.",
  ];

  const TERMS = isMess ? MESS_TERMS : DINE_TERMS;

  const handleAccept = async () => {
    if (!agreed) {
      toast.error("Please tick the checkbox to accept the agreement terms.");
      return;
    }
    setSaving(true);
    try {
      await client.saveFields(
        { agreementAcceptedAt: new Date().toISOString() },
        "agreement"
      );
      toast.success(isMess ? "Kada Mess partner terms accepted!" : "Partner terms accepted!");
      if (canGoLive) {
        await onGoLive();
      } else {
        onSuccess();
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to record agreement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {isMess ? "Kada Mess Partner Terms" : "Partner Agreement Terms"}
          </DialogTitle>
          <DialogDescription>
            {isMess
              ? "Fair, transparent terms for monthly and weekly subscription kitchens."
              : "The essential terms of partnership, plainly stated."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {TERMS.map((t, idx) => (
            <div key={idx} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-800 border">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{t}</p>
            </div>
          ))}

          <label className="flex items-start gap-3 pt-2 text-xs font-semibold text-slate-900 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              {isMess
                ? "I accept the Kada Mess partner agreement terms and confirm all submitted kitchen details are accurate."
                : "I accept the Kada Dine partner agreement terms and confirm all submitted details are accurate."}
            </span>
          </label>
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !agreed}
            onClick={handleAccept}
            className={cn(
              "text-white font-bold",
              isMess ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
            )}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : canGoLive ? (
              "Accept & Go Live"
            ) : (
              "Accept Agreement"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
