import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  ExternalLink,
  ShieldAlert,
  History,
  Ban,
  Sparkles,
  Phone,
  Mail,
  MapPin,
  Building,
  KeyRound,
  MessageSquare,
  FileText,
  UserCheck,
  Eye,
  Copy,
  Clock,
  ArrowRight,
  ChefHat,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { adminActionToast } from "@/lib/admin-ops";
import {
  ROLE_COLLECTION,
  ROLE_LABEL,
  TIMELINE_GROUPS,
  ALLOWED_TRANSITIONS,
  DOCUMENT_CHECK_META,
  stateMeta,
  bankStateMeta,
  type DocumentCheckStatus,
  type OnboardingChecks,
  type OnboardingState,
  type StepRequirement,
} from "@/lib/onboarding";
import { usePartnerPrivate } from "@/hooks/usePartnerPrivate";
import type { PartnerRow } from "@/pages/admin/OnboardingCommandCenter";
import { DocumentPreviewDialog } from "@/components/admin/onboarding/DocumentPreviewDialog";
import { AssignZoneDialog } from "@/components/admin/onboarding/AssignZoneDialog";
import { VerifyBankDialog } from "@/components/admin/onboarding/VerifyBankDialog";
import { VendorContactDialog } from "@/components/admin/vendors/VendorContactDialog";
import { ZoneBadge } from "@/components/admin/zones/ZoneScopeBar";
import { ResetPasswordDialog } from "@/components/admin/vendors/ResetPasswordDialog";
import { Link } from "react-router-dom";

/** Readable names for fields the document reader extracts. */
const FIELD_LABELS: Record<string, string> = {
  panNumber: "PAN",
  name: "Name",
  holderType: "PAN type",
  gstin: "GSTIN",
  legalName: "Legal name",
  tradeName: "Trade name",
  licenceNumber: "Licence no.",
  kind: "Kind",
  businessName: "Business",
  accountLast4: "Account ending",
  ifsc: "IFSC",
  holder: "Holder",
  bankName: "Bank",
  idType: "ID type",
  idNumber: "ID number",
  registrationNumber: "Registration",
  ownerName: "Owner",
  policyNumber: "Policy no.",
  vehicleClasses: "Vehicle classes",
  address: "Address",
};

/** Check keys → what an ops reviewer reads. */
const CHECK_LABELS: Record<string, string> = {
  readable_clearly: "Read clearly",
  pan_format: "PAN format",
  pan_fits_business: "PAN type fits business",
  gstin_valid: "GSTIN checksum",
  gstin_matches_pan: "GSTIN matches PAN",
  gst_name_matches: "GST name matches",
  fssai_format: "FSSAI number format",
  fssai_licence_issued: "Licence issued (not just applied)",
  fssai_not_expired: "FSSAI not expired",
  holder_matches: "Holder name matches",
  account_matches: "Account matches bank details",
  ifsc_matches: "IFSC matches bank details",
  id_number_valid: "ID number valid",
  id_name_matches: "ID name matches",
  dl_format: "Licence format",
  dl_name_matches: "Licence name matches",
  dl_not_expired: "Licence not expired",
  rc_format: "Registration format",
  insurance_not_expired: "Insurance not expired",
};

interface TimelineEvent {
  id: string;
  from: string | null;
  to: string;
  actor: string;
  actorId?: string;
  reason?: string;
  at?: { toDate?: () => Date } | null;
}

type Requirement = StepRequirement;

export function OnboardingPartnerSheet({
  partner,
  onClose,
}: {
  partner: PartnerRow | null;
  onClose: () => void;
}) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reject, setReject] = useState<Requirement | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [transitionTo, setTransitionTo] = useState<OnboardingState | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [override, setOverride] = useState(false);

  // Modular Dialog states
  const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string; metadata?: Record<string, any> } | null>(null);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("kyc");

  const priv = usePartnerPrivate(partner?.role ?? "vendor", partner?.partnerId);

  useEffect(() => {
    if (!partner) {
      setRequirements([]);
      setBlockers([]);
      return;
    }
    let cancelled = false;
    setLoadingReqs(true);
    (async () => {
      try {
        const stateFn = httpsCallable(functions, "getOnboardingState");
        const res = await stateFn({
          role: partner.role,
          partnerId: partner.partnerId,
        });
        const d = res.data as { requirements?: Requirement[] };
        if (!cancelled) setRequirements(d.requirements ?? []);

        const blockFn = httpsCallable(functions, "getActivationBlockers");
        const b = await blockFn({
          role: partner.role,
          partnerId: partner.partnerId,
        });
        const bd = b.data as { blockers?: string[] };
        if (!cancelled) setBlockers(bd.blockers ?? []);
      } catch (e) {
        console.error("[OnboardingPartnerSheet] load failed", e);
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Couldn't load this application.",
          );
        }
      } finally {
        if (!cancelled) setLoadingReqs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partner?.id, partner?.state, partner?.bankState]);

  // Immutable timeline.
  useEffect(() => {
    if (!partner) return;
    const ref = collection(
      db,
      ROLE_COLLECTION[partner.role],
      partner.partnerId,
      "onboarding_events",
    );
    return onSnapshot(
      query(ref, orderBy("at", "desc"), limit(60)),
      (snap) =>
        setEvents(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TimelineEvent, "id">) })),
        ),
      (err) => {
        console.error("[OnboardingPartnerSheet] timeline listener failed", err);
        setEvents([]);
      },
    );
  }, [partner?.id]);

  const grouped = useMemo(() => {
    const map: Record<string, Requirement[]> = {};
    for (const r of requirements) (map[r.group] ??= []).push(r);
    return map;
  }, [requirements]);

  const pendingRequirements = useMemo(() => {
    if (!partner) return [];
    return requirements.filter((r) => partner.steps[r.id] !== true);
  }, [requirements, partner]);

  if (!partner) return null;

  const checks = (partner.raw.onboardingChecks ?? {}) as OnboardingChecks;
  const reviewReasons = checks.review?.reasons ?? [];
  const meta = stateMeta(partner.state);
  const bankMeta = bankStateMeta(partner.bankState);
  const legalNext = ALLOWED_TRANSITIONS[partner.state] ?? [];
  const canDirectActivate =
    (partner.state === "ready_for_activation" ||
      (partner.state === "approved" && blockers.length === 0 && pendingRequirements.length === 0)) &&
    partner.state !== "active";

  const reviewStep = async (
    step: Requirement,
    decision: "approved" | "rejected",
    reason?: string,
  ) => {
    setBusy(step.id);
    try {
      await adminActionToast(
        "reviewOnboardingStep",
        {
          role: partner.role,
          partnerId: partner.partnerId,
          stepId: step.id,
          decision,
          reason: reason ?? "",
        },
        decision === "approved"
          ? `${step.label} approved`
          : `${step.label} sent back for correction`,
      );
      setReject(null);
      setRejectReason("");
    } finally {
      setBusy(null);
    }
  };

  const handleApproveAllSteps = async () => {
    if (pendingRequirements.length === 0) {
      toast.info("All requirements are already completed!");
      return;
    }
    setBusy("approve_all");
    try {
      for (const req of pendingRequirements) {
        await adminActionToast(
          "reviewOnboardingStep",
          {
            role: partner.role,
            partnerId: partner.partnerId,
            stepId: req.id,
            decision: "approved",
            reason: "Fast-track approved by admin reviewer",
          },
          `Approved ${req.label}`,
        );
      }
      toast.success(`Approved all ${pendingRequirements.length} pending requirements!`);
    } catch (err: any) {
      console.error("Fast track error:", err);
    } finally {
      setBusy(null);
    }
  };

  const handleDirectActivate = async () => {
    setBusy("activate");
    try {
      await adminActionToast(
        "transitionOnboarding",
        {
          role: partner.role,
          partnerId: partner.partnerId,
          to: "active",
          reason: "Approved & activated via Onboarding Command Center",
          overrideGates: false,
        },
        `${partner.name} activated on the platform!`,
      );
    } catch (err: any) {
      console.error("Activate error:", err);
    } finally {
      setBusy(null);
    }
  };

  const doTransition = async () => {
    if (!transitionTo) return;
    const isOverride = override || (transitionTo === "active" && partner.state !== "ready_for_activation");
    if (isOverride && !transitionReason.trim()) {
      toast.error("Overriding the gates requires a written reason.");
      return;
    }
    setBusy("transition");
    try {
      await adminActionToast(
        "transitionOnboarding",
        {
          role: partner.role,
          partnerId: partner.partnerId,
          to: transitionTo,
          reason: transitionReason.trim() || `Moved to ${transitionTo} by admin`,
          overrideGates: isOverride,
        },
        `Moved to ${stateMeta(transitionTo).label}`,
      );
      setTransitionTo(null);
      setTransitionReason("");
      setOverride(false);
    } finally {
      setBusy(null);
    }
  };

  // Document list from raw partner
  const uploadedDocs = Object.entries(partner.documents || {}).map(([id, doc]) => ({
    id,
    label: id.replace(/_/g, " ").toUpperCase(),
    url: doc.url,
    expiresAt: doc.expiresAt,
    number: doc.number,
  }));

  return (
    <>
      <Sheet open={!!partner} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto p-0 flex flex-col">
          {/* ── Top Header ──────────────────────────────────────────────── */}
          <div className="p-6 border-b border-border/60 bg-muted/20 shrink-0 space-y-4">
            <SheetHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 border border-primary/20">
                    {partner.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="text-lg font-bold truncate">
                      {partner.name}
                    </SheetTitle>
                    <SheetDescription className="text-xs truncate flex items-center gap-2 mt-0.5">
                      <span>{ROLE_LABEL[partner.role]}</span>
                      <span>·</span>
                      <span className="font-mono">{partner.partnerId}</span>
                    </SheetDescription>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 shrink-0 justify-end">
                  <Badge variant="outline" className={cn("text-xs font-semibold", meta.className)}>
                    {meta.label}
                  </Badge>
                  <Badge variant="outline" className={cn("text-xs", bankMeta.className)}>
                    {bankMeta.label}
                  </Badge>
                </div>
              </div>
            </SheetHeader>

            {/* Quick Action Toolbar */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {canDirectActivate ? (
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm"
                  disabled={busy === "activate"}
                  onClick={handleDirectActivate}
                >
                  {busy === "activate" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Activate Partner
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-emerald-700 border-emerald-500/30 hover:bg-emerald-50 gap-1.5"
                  onClick={() => {
                    setTransitionTo("active");
                    setOverride(true);
                    setTransitionReason("");
                  }}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  Override & Activate
                </Button>
              )}

              {pendingRequirements.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-sky-700 border-sky-500/30 hover:bg-sky-50 gap-1.5"
                  disabled={busy === "approve_all"}
                  onClick={handleApproveAllSteps}
                >
                  {busy === "approve_all" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Approve All Steps ({pendingRequirements.length})
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setZoneModalOpen(true)}
              >
                <MapPin className="w-3.5 h-3.5 text-blue-500" />
                {partner.zoneId ? partner.zoneName || "Change Zone" : "Assign Zone"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setBankModalOpen(true)}
              >
                <Building className="w-3.5 h-3.5 text-purple-500" />
                Verify Bank
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => setContactModalOpen(true)}
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                Contact
              </Button>

              {partner.role === "vendor" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5 text-amber-600 border-amber-500/30 hover:bg-amber-50"
                    onClick={() => setResetPasswordOpen(true)}
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Reset Password
                  </Button>

                  <Link
                    to={`/admin/vendors/${partner.partnerId}`}
                    target="_blank"
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Vendor 360
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* ── Tabbed Body ─────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
              <TabsList className="grid grid-cols-5 w-full h-10 p-1 bg-muted/60">
                <TabsTrigger value="kyc" className="text-xs font-medium">
                  KYC Steps
                  {pendingRequirements.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-sky-500 text-white font-bold">
                      {pendingRequirements.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="profile" className="text-xs font-medium">
                  Profile
                </TabsTrigger>
                <TabsTrigger value="bank" className="text-xs font-medium">
                  Bank & Payouts
                </TabsTrigger>
                <TabsTrigger value="documents" className="text-xs font-medium">
                  Documents
                  {uploadedDocs.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-muted-foreground/30 font-bold">
                      {uploadedDocs.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs font-medium">
                  Timeline
                </TabsTrigger>
              </TabsList>

              {/* ── TAB 1: KYC Steps ─────────────────────────────────────── */}
              <TabsContent value="kyc" className="space-y-5 mt-0">
                {/* Blockers alert */}
                {blockers.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3.5 dark:bg-rose-500/10 dark:border-rose-500/30">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                      <div className="text-xs text-rose-900 space-y-1">
                        <p className="font-semibold text-rose-950">Active Activation Blockers</p>
                        {blockers.map((b, i) => (
                          <p key={i}>• {b}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Automation AI Verdict Alert */}
                {reviewReasons.length > 0 && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3.5 dark:bg-sky-500/10 dark:border-sky-500/30">
                    <div className="flex items-start gap-2.5">
                      <Sparkles className="h-4 w-4 text-sky-600 mt-0.5 shrink-0" />
                      <div className="text-xs text-sky-950 space-y-1">
                        <p className="font-semibold">
                          {checks.review?.needsPerson
                            ? "AI Verification Alert — Manual Review Recommended"
                            : "Waiting on Automated Checks"}
                        </p>
                        {reviewReasons.map((b, i) => (
                          <p key={i}>• {b}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Requirements Group List */}
                <div>
                  {loadingReqs ? (
                    <div className="flex items-center justify-center text-xs text-muted-foreground py-12">
                      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Resolving requirements & engine state…
                    </div>
                  ) : requirements.length === 0 ? (
                    <div className="rounded-xl border border-border/70 p-6 text-center text-xs text-muted-foreground">
                      No requirements resolved for this partner.
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {TIMELINE_GROUPS.filter((g) => grouped[g.key]?.length).map((g) => (
                        <div key={g.key} className="space-y-2">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <span>{g.label}</span>
                            <span className="text-[10px] font-normal lowercase">
                              {grouped[g.key].filter((r) => partner.steps[r.id] === true).length}/
                              {grouped[g.key].length} done
                            </span>
                          </p>
                          <div className="space-y-2">
                            {grouped[g.key].map((r) => {
                              const done = partner.steps[r.id] === true;
                              const review = partner.stepReviews[r.id];
                              const doc = partner.documents[r.id];
                              const rejected = review?.decision === "rejected";
                              const verdict = checks.documents?.[r.id];
                              const verdictMeta = verdict?.status
                                ? DOCUMENT_CHECK_META[verdict.status as DocumentCheckStatus]
                                : null;
                              const reading = priv?.verifications?.[r.id];
                              const fields = Object.entries(reading?.fields ?? {}).filter(
                                ([k, v]) => v && FIELD_LABELS[k],
                              );
                              const ranChecks = Object.entries(reading?.checks ?? {}).filter(
                                ([k, v]) => v !== null && v !== undefined && CHECK_LABELS[k],
                              );
                              const reviewable = done || verdict?.status === "needs_review" || !done;

                              return (
                                <div
                                  key={r.id}
                                  className={cn(
                                    "rounded-xl border p-3.5 transition-colors",
                                    rejected
                                      ? "border-rose-300 bg-rose-50/20 dark:bg-rose-500/10 dark:border-rose-500/30"
                                      : done
                                      ? "border-border/60 bg-muted/10"
                                      : "border-amber-300 bg-amber-50/20 dark:bg-amber-500/10 dark:border-amber-500/30"
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                      {rejected ? (
                                        <XCircle className="h-5 w-5 text-rose-500 mt-0.5 shrink-0" />
                                      ) : done ? (
                                        <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                                      ) : (
                                        <Circle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <p className="text-xs font-semibold text-foreground">
                                            {r.label}
                                          </p>
                                          {!r.mandatory && (
                                            <span className="text-[10px] text-muted-foreground">· optional</span>
                                          )}
                                          {verdictMeta && (
                                            <Badge
                                              variant="outline"
                                              className={cn("text-[9px] px-1.5 py-0", verdictMeta.className)}
                                            >
                                              {verdict?.provider === "admin"
                                                ? `${verdictMeta.label} by admin`
                                                : verdictMeta.label}
                                            </Badge>
                                          )}
                                        </div>

                                        {(verdict?.issues ?? []).map((issue, i) => (
                                          <p key={i} className="text-[11px] text-amber-700 mt-1">
                                            ⚠️ {issue}
                                          </p>
                                        ))}

                                        {/* Extracted fields */}
                                        {fields.length > 0 && (
                                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] p-2.5 rounded-lg bg-background/80 border border-border/50">
                                            {fields.map(([k, v]) => (
                                              <div key={k} className="truncate">
                                                <span className="text-muted-foreground mr-1.5">{FIELD_LABELS[k]}:</span>
                                                <span className="font-semibold text-foreground">{String(v).replace(/_/g, " ")}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {/* Ran consistency checks */}
                                        {ranChecks.length > 0 && (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {ranChecks.map(([k, v]) => (
                                              <span
                                                key={k}
                                                className={cn(
                                                  "text-[9px] rounded-md px-1.5 py-0.5 border font-medium",
                                                  v
                                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                                                    : "border-rose-500/20 bg-rose-500/10 text-rose-700",
                                                )}
                                              >
                                                {v ? "✓" : "✗"} {CHECK_LABELS[k]}
                                              </span>
                                            ))}
                                            {typeof reading?.confidence === "number" && (
                                              <span className="text-[9px] text-muted-foreground px-1 py-0.5">
                                                {Math.round(reading.confidence * 100)}% read confidence
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {/* Rejection comment */}
                                        {review?.reason && (
                                          <div className="mt-2 p-2 rounded-lg bg-rose-100/60 border border-rose-200 text-[11px] text-rose-900 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-300">
                                            <p className="font-semibold">Rejection note: {review.reason}</p>
                                            {review.by && <p className="text-[10px] text-rose-700">Reviewed by: {review.by}</p>}
                                          </div>
                                        )}

                                        {/* Document Preview Trigger */}
                                        {doc?.url && (
                                          <div className="mt-2 flex items-center gap-3">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 text-[11px] text-primary px-2 gap-1"
                                              onClick={() =>
                                                setPreviewDoc({
                                                  title: r.label,
                                                  url: doc.url!,
                                                  metadata: {
                                                    documentNumber: doc.number,
                                                    expiresAt: doc.expiresAt ? String(doc.expiresAt) : undefined,
                                                  },
                                                })
                                              }
                                            >
                                              <Eye className="w-3 h-3" />
                                              Preview Document
                                            </Button>
                                            <a
                                              href={doc.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-[11px] text-muted-foreground hover:underline inline-flex items-center gap-1"
                                            >
                                              Direct URL <ExternalLink className="h-2.5 w-2.5" />
                                            </a>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className={cn(
                                          "h-7 px-2.5 text-xs font-semibold gap-1",
                                          done
                                            ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"
                                            : "hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-500/30"
                                        )}
                                        disabled={busy === r.id}
                                        onClick={() => reviewStep(r, "approved")}
                                      >
                                        {busy === r.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                        )}
                                        {done ? "Re-Approve" : "Approve"}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-xs text-rose-600 border-rose-500/30 hover:bg-rose-50 gap-1"
                                        disabled={busy === r.id}
                                        onClick={() => setReject(r)}
                                      >
                                        <XCircle className="h-3 w-3 text-rose-500" />
                                        Reject
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── TAB 2: Profile & Operations ──────────────────────────── */}
              <TabsContent value="profile" className="space-y-4 mt-0">
                <div className="grid grid-cols-2 gap-3">
                  <Fact label="Partner / Store Name">
                    <p className="text-sm font-semibold">{partner.name}</p>
                  </Fact>
                  <Fact label="Platform Role">
                    <p className="text-sm font-semibold">{ROLE_LABEL[partner.role]}</p>
                  </Fact>
                  <Fact label="Partner ID">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{partner.partnerId}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText(partner.partnerId);
                          toast.success("Partner ID copied");
                        }}
                      >
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    </div>
                  </Fact>
                  <Fact label="Business Structure">
                    <p className="capitalize">{partner.businessStructure?.replace(/_/g, " ") || "Not Specified"}</p>
                  </Fact>
                  <Fact label="Contact Email">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{partner.email || "No email"}</span>
                      {partner.email && (
                        <a href={`mailto:${partner.email}`} className="text-primary hover:underline text-[10px]">
                          Send Email
                        </a>
                      )}
                    </div>
                  </Fact>
                  <Fact label="Contact Phone">
                    <div className="flex items-center justify-between">
                      <span className="truncate font-mono">{partner.phone || "No phone"}</span>
                      {partner.phone && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] text-emerald-600 px-1.5"
                            onClick={() => setContactModalOpen(true)}
                          >
                            WhatsApp
                          </Button>
                          <a href={`tel:${partner.phone}`} className="text-[10px] text-primary hover:underline">
                            Call
                          </a>
                        </div>
                      )}
                    </div>
                  </Fact>
                </div>

                <Separator />

                {partner.role === "mess" && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                        <ChefHat className="w-3.5 h-3.5" /> Mess Kitchen Configuration
                      </h4>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
                        <Link to={`/admin/mess?kitchenId=${partner.partnerId}`} target="_blank">
                          <ExternalLink className="w-3 h-3" />
                          Open in Mess Hub
                        </Link>
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <Fact label="Meals Served">
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(((partner.raw.mealsServed as string[]) || (partner.raw.messProfile as any)?.meals || ["lunch"]) as string[]).map((m: string) => (
                            <Badge key={m} variant="secondary" className="text-[10px] capitalize">
                              {m}
                            </Badge>
                          ))}
                        </div>
                      </Fact>
                      <Fact label="Diet Category">
                        <Badge variant="outline" className="text-[10px] capitalize mt-0.5">
                          {partner.raw.dietType === "veg" ? "Pure Veg" : partner.raw.dietType === "nonveg" ? "Non-Veg Only" : "Veg & Non-Veg"}
                        </Badge>
                      </Fact>
                      <Fact label="Fulfilment Modes">
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(((partner.raw.fulfilmentModes as string[]) || (partner.raw.messProfile as any)?.fulfilment || ["delivery"]) as string[]).map((f: string) => (
                            <Badge key={f} variant="outline" className="text-[10px] capitalize">
                              {f.replace(/_/g, " ")}
                            </Badge>
                          ))}
                        </div>
                      </Fact>
                      <Fact label="Platform Fee">
                        <p className="font-semibold text-emerald-600">
                          ₹{((partner.raw.feePerCustomerPerDayPaise ?? 300) / 100).toFixed(0)} / customer / day
                        </p>
                      </Fact>
                    </div>

                    {partner.raw.kitchenSummary && (
                      <div className="text-xs pt-1 border-t border-primary/10">
                        <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Kitchen Specialities</span>
                        <p className="mt-0.5 text-foreground">{String(partner.raw.kitchenSummary)}</p>
                      </div>
                    )}

                    {partner.raw.mealTimesSummary && (
                      <div className="text-xs pt-1 border-t border-primary/10">
                        <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Meal Schedule & Cut-offs</span>
                        <p className="mt-0.5 text-foreground">{String(partner.raw.mealTimesSummary)}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Service Zone Assignment */}
                <div className="rounded-xl border border-border/70 p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Service Zone & Geography
                      </h4>
                      <div className="mt-1 flex items-center gap-1.5">
                        <ZoneBadge zoneId={partner.zoneId} zoneName={partner.zoneName} />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1"
                      onClick={() => setZoneModalOpen(true)}
                    >
                      {partner.zoneId ? "Reassign Zone" : "Assign Zone"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Zone assignment determines which customers can order from this store and which riders will receive order fulfillment jobs.
                  </p>
                </div>

                {/* Risk Flags if any */}
                {partner.riskFlags.length > 0 && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
                    <p className="font-bold flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      Recorded Risk Flags ({partner.riskFlags.length})
                    </p>
                    {partner.riskFlags.map((f, i) => (
                      <p key={i}>• {f}</p>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ── TAB 3: Bank & Payouts ─────────────────────────────────── */}
              <TabsContent value="bank" className="space-y-4 mt-0">
                <div className="rounded-xl border border-border/70 p-4 space-y-4 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Settlement Bank Account
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={cn("text-xs", bankMeta.className)}>
                          {bankMeta.label}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
                      onClick={() => setBankModalOpen(true)}
                    >
                      <Building className="w-3.5 h-3.5" />
                      Review & Certify Bank
                    </Button>
                  </div>

                  {partner.bankMessage && (
                    <div className="p-2.5 rounded-lg bg-background border border-border text-xs text-muted-foreground">
                      {partner.bankMessage}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <Fact label="Account Number">
                      <p className="font-mono font-semibold">
                        {((partner.raw.bank as any)?.accountMasked) || ((partner.raw.bank as any)?.accountNumber) || "—"}
                      </p>
                    </Fact>
                    <Fact label="IFSC Code">
                      <p className="font-mono font-semibold">
                        {((partner.raw.bank as any)?.ifsc) || "—"}
                      </p>
                    </Fact>
                    <Fact label="Bank / Branch">
                      <p>{((partner.raw.bank as any)?.bankName) || ((partner.raw.bank as any)?.ifscBank) || "—"}</p>
                    </Fact>
                    <Fact label="Account Holder Name">
                      <p>{((partner.raw.bank as any)?.holderName) || ((partner.raw.bank as any)?.accountHolder) || "—"}</p>
                    </Fact>
                  </div>
                </div>
              </TabsContent>

              {/* ── TAB 4: Document Vault ────────────────────────────────── */}
              <TabsContent value="documents" className="space-y-4 mt-0">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Uploaded KYC & Verification Documents
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      {uploadedDocs.length} files on record
                    </span>
                  </div>

                  {uploadedDocs.length === 0 ? (
                    <div className="rounded-xl border border-border/70 p-8 text-center text-xs text-muted-foreground">
                      No documents uploaded yet by this partner.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {uploadedDocs.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-xl border border-border/70 p-3.5 space-y-2.5 bg-card hover:border-primary/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold truncate">{d.label}</p>
                                {d.number && (
                                  <p className="text-[10px] font-mono text-muted-foreground truncate">{d.number}</p>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] gap-1"
                              onClick={() =>
                                setPreviewDoc({
                                  title: d.label,
                                  url: d.url || "",
                                  metadata: {
                                    documentId: d.id,
                                    number: d.number,
                                    expiresAt: d.expiresAt ? String(d.expiresAt) : undefined,
                                  },
                                })
                              }
                              disabled={!d.url}
                            >
                              <Eye className="w-3 h-3" />
                              Preview
                            </Button>
                          </div>

                          {d.expiresAt && (
                            <div className="text-[10px] text-muted-foreground">
                              Expires: {new Date(d.expiresAt as any).toLocaleDateString("en-IN")}
                            </div>
                          )}

                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                            >
                              Download / Open Original <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">No file attached</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── TAB 5: Timeline & Stage Control ──────────────────────── */}
              <TabsContent value="history" className="space-y-5 mt-0">
                {/* Stage Transition Control */}
                <div className="rounded-xl border border-border/70 p-4 space-y-3 bg-muted/20">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    State Machine Stage Control
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {legalNext.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs font-semibold"
                        onClick={() => {
                          setTransitionTo(s);
                          setOverride(false);
                          setTransitionReason("");
                        }}
                      >
                        Move to {stateMeta(s).label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    State machine strictly guards operational transitions to guarantee legal compliance.
                  </p>
                </div>

                <Separator />

                {/* Audit Trail */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" /> Immutable Lifecycle Audit Trail
                  </h4>
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4">No events recorded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {events.map((e) => (
                        <div key={e.id} className="text-xs border-l-2 border-primary/40 pl-3 py-1 space-y-0.5">
                          <p className="font-semibold text-foreground">
                            {e.from ? `${stateMeta(e.from).label} → ` : ""}
                            {stateMeta(e.to).label}
                            <span className="text-muted-foreground font-normal text-[11px]">
                              {" "}· by {e.actor}
                              {e.actorId ? ` (${e.actorId})` : ""}
                            </span>
                          </p>
                          {e.reason && (
                            <p className="text-[11px] text-muted-foreground">{e.reason}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/70">
                            {e.at?.toDate ? e.at.toDate().toLocaleString("en-IN") : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Dialog: Reject Step ────────────────────────────────────────── */}
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Back for Correction</DialogTitle>
            <DialogDescription>
              “{reject?.label}” will be marked incomplete and the application moved to Action Required.
              The partner will see this reason in their app.
            </DialogDescription>
          </DialogHeader>

          {/* Quick reason presets */}
          <div className="flex flex-wrap gap-1.5 py-1">
            {[
              "Document image is blurry / unreadable",
              "Name mismatch with Aadhaar or PAN",
              "Certificate is expired — please renew",
              "Bank account details could not be verified",
              "Address proof missing valid pincode",
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                className="text-[10px] px-2 py-1 rounded border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setRejectReason(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Write clear instructions on what needs to be fixed..."
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || busy === reject?.id}
              onClick={() => reject && reviewStep(reject, "rejected", rejectReason.trim())}
            >
              {busy === reject?.id && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              Send Rejection Notice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Move Stage Transition ───────────────────────────────── */}
      <Dialog open={!!transitionTo} onOpenChange={(o) => !o && setTransitionTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Move to {transitionTo ? stateMeta(transitionTo).label : ""}
            </DialogTitle>
            <DialogDescription>
              {transitionTo ? stateMeta(transitionTo).description : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {transitionTo === "active" && (partner.state !== "ready_for_activation" || blockers.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1.5 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
                <div className="flex items-center gap-1.5 font-bold text-amber-950 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  {partner.state !== "ready_for_activation"
                    ? `Partner is currently in "${stateMeta(partner.state).label}"`
                    : `${blockers.length} gate(s) still failing`}
                </div>
                {partner.state !== "ready_for_activation" && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">
                    Activating now will legally advance the applicant to active via Admin Override.
                  </p>
                )}
                {blockers.length > 0 && (
                  <div className="space-y-0.5 pt-1">
                    <p className="font-semibold text-rose-700 dark:text-rose-400">Failing gates:</p>
                    {blockers.map((b, i) => (
                      <p key={i}>• {b}</p>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 pt-2 cursor-pointer font-semibold">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  <span>Confirm admin override to activate</span>
                </label>
              </div>
            )}
            <div>
              <Label className="text-xs">
                Audit Reason{override ? " (Required for gate override)" : " (Optional)"}
              </Label>
              <Textarea
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
                className="mt-1 text-xs"
                placeholder="Recorded in the partner's permanent history."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransitionTo(null)}>
              Cancel
            </Button>
            <Button onClick={doTransition} disabled={busy === "transition" || (override && !transitionReason.trim())}>
              {busy === "transition" && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Confirm Transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Document Preview Lightbox ───────────────────────────── */}
      {previewDoc && (
        <DocumentPreviewDialog
          open={!!previewDoc}
          onOpenChange={(open) => !open && setPreviewDoc(null)}
          title={previewDoc.title}
          url={previewDoc.url}
          metadata={previewDoc.metadata}
        />
      )}

      {/* ── Dialog: Assign Service Zone ─────────────────────────────────── */}
      <AssignZoneDialog
        open={zoneModalOpen}
        onOpenChange={setZoneModalOpen}
        partner={{
          role: partner.role,
          partnerId: partner.partnerId,
          name: partner.name,
          zoneId: partner.zoneId,
          zoneName: partner.zoneName,
        }}
      />

      {/* ── Dialog: Verify Bank Account ─────────────────────────────────── */}
      <VerifyBankDialog
        open={bankModalOpen}
        onOpenChange={setBankModalOpen}
        partner={{
          role: partner.role,
          partnerId: partner.partnerId,
          name: partner.name,
          bankState: partner.bankState,
          bankMessage: partner.bankMessage,
          raw: partner.raw,
        }}
      />

      {/* ── Dialog: Direct Contact ──────────────────────────────────────── */}
      <VendorContactDialog
        open={contactModalOpen}
        onOpenChange={setContactModalOpen}
        vendor={{
          id: partner.partnerId,
          name: partner.name,
          email: partner.email,
          phone: partner.phone,
        }}
      />

      {/* ── Dialog: Reset Password (for vendors) ────────────────────────── */}
      {partner.role === "vendor" && (
        <ResetPasswordDialog
          open={resetPasswordOpen}
          onOpenChange={setResetPasswordOpen}
          vendor={{
            id: partner.partnerId,
            name: partner.name,
            email: partner.email,
            phone: partner.phone,
          }}
        />
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 p-2.5 bg-card">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      <div className="text-xs font-medium">{children}</div>
    </div>
  );
}
