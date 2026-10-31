/**
 * Client-side mirror of functions/src/onboarding/* — types, labels and the
 * transition table the admin console renders from.
 *
 * The console must never re-derive whether a partner can be activated; it
 * calls `getActivationBlockers` and shows what the engine says. These
 * constants exist only for LABELS and for disabling illegal buttons before
 * the round-trip, so the UI and the enforcement path can never disagree
 * about what is allowed — the server is still authoritative.
 */

export const ONBOARDING_STATES = [
  "started",
  "incomplete",
  "submitted",
  "kyc_review",
  "verification",
  "action_required",
  "approved",
  "commercial_setup",
  "ready_for_activation",
  "active",
  "suspended",
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const PARTNER_ROLES = ["vendor", "rider", "host", "mess"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const ROLE_LABEL: Record<PartnerRole, string> = {
  vendor: "Kada Dine",
  rider: "Kada Delivery",
  host: "Kada Host",
  mess: "Kada Mess",
};

export const ROLE_COLLECTION: Record<PartnerRole, string> = {
  vendor: "restaurants",
  rider: "delivery_users",
  host: "hotels",
  mess: "mess_kitchens",
};

/** Mirrors ALLOWED_TRANSITIONS in functions/src/onboarding/stateMachine.ts. */
export const ALLOWED_TRANSITIONS: Record<OnboardingState, OnboardingState[]> = {
  started: ["incomplete", "submitted"],
  incomplete: ["incomplete", "submitted"],
  submitted: ["kyc_review", "action_required", "incomplete"],
  kyc_review: ["verification", "action_required", "approved"],
  verification: ["approved", "action_required", "kyc_review"],
  action_required: ["incomplete", "submitted"],
  approved: ["commercial_setup", "action_required", "suspended"],
  commercial_setup: ["ready_for_activation", "action_required", "suspended"],
  ready_for_activation: ["active", "action_required", "suspended"],
  active: ["suspended", "action_required"],
  suspended: ["action_required", "ready_for_activation", "active"],
};

/** States that mean "ops has work to do" — mirrors OPS_QUEUE_STATES on the server. */
export const OPS_QUEUE_STATES: OnboardingState[] = [
  "submitted",
  "kyc_review",
  "verification",
  "ready_for_activation",
];

export function canTransition(from: OnboardingState, to: OnboardingState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export interface StateMeta {
  label: string;
  /** Who the ball is with. */
  owner: "applicant" | "ops" | "none";
  tone: "neutral" | "info" | "warning" | "danger" | "success";
  className: string;
  description: string;
}

export const STATE_META: Record<OnboardingState, StateMeta> = {
  started: {
    label: "Started",
    owner: "applicant",
    tone: "neutral",
    className: "bg-slate-500/10 text-slate-600 border-slate-500/20",
    description: "Account created, nothing submitted yet.",
  },
  incomplete: {
    label: "Incomplete",
    owner: "applicant",
    tone: "warning",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    description: "Some steps saved; mandatory gates still open.",
  },
  submitted: {
    label: "Submitted",
    owner: "ops",
    tone: "info",
    className: "bg-sky-500/10 text-sky-600 border-sky-500/20",
    description: "Applicant declared done; queued for review.",
  },
  kyc_review: {
    label: "KYC Review",
    owner: "ops",
    tone: "info",
    className: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
    description: "Ops reviewing identity and business documents.",
  },
  verification: {
    label: "Verification",
    owner: "ops",
    tone: "info",
    className: "bg-violet-500/10 text-violet-600 border-violet-500/20",
    description: "Automated checks running — bank, PAN, duplicates.",
  },
  action_required: {
    label: "Action Required",
    owner: "applicant",
    tone: "danger",
    className: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    description: "Something failed; applicant must fix and resubmit.",
  },
  approved: {
    label: "Approved",
    owner: "ops",
    tone: "success",
    className: "bg-teal-500/10 text-teal-600 border-teal-500/20",
    description: "KYC cleared; commercial setup not yet done.",
  },
  commercial_setup: {
    label: "Commercial Setup",
    owner: "applicant",
    tone: "info",
    className: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
    description: "Choosing / paying for plan, or commission configuration.",
  },
  ready_for_activation: {
    label: "Ready for Activation",
    owner: "ops",
    tone: "success",
    className: "bg-lime-500/10 text-lime-700 border-lime-500/20",
    description: "Every gate green; awaiting the final admin flip.",
  },
  active: {
    label: "Active",
    owner: "none",
    tone: "success",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    description: "Operational — receiving orders / bookings / offers.",
  },
  suspended: {
    label: "Suspended",
    owner: "ops",
    tone: "danger",
    className: "bg-red-600/10 text-red-700 border-red-600/20",
    description: "Halted — expiry, risk flag, or manual suspension.",
  },
};

/** Bank verification states — mirrors onboarding/bankVerification.ts. */
export const BANK_STATES = {
  NOT_ADDED: "not_added",
  PENDING: "pending_verification",
  VERIFIED: "verified",
  FAILED: "failed",
  ACTION_REQUIRED: "action_required",
  SUSPENDED: "suspended",
} as const;

export type BankVerificationState =
  (typeof BANK_STATES)[keyof typeof BANK_STATES];

export const BANK_STATE_META: Record<BankVerificationState, { label: string; className: string }> = {
  not_added: { label: "Not Added", className: "bg-slate-500/10 text-slate-600 border-slate-500/20" },
  pending_verification: { label: "Pending Verification", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  verified: { label: "Verified", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  failed: { label: "Failed", className: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
  action_required: { label: "Action Required", className: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  suspended: { label: "Suspended", className: "bg-red-600/10 text-red-700 border-red-600/20" },
};

/** The admin command-center queues, in the order the console shows them. */
export const ADMIN_QUEUES = [
  { key: "new", label: "New Applications", states: ["submitted"] as OnboardingState[] },
  { key: "incomplete", label: "Incomplete", states: ["started", "incomplete"] as OnboardingState[] },
  { key: "kyc", label: "KYC Pending", states: ["kyc_review"] as OnboardingState[] },
  { key: "verification", label: "Verification", states: ["verification"] as OnboardingState[] },
  { key: "action", label: "Action Required", states: ["action_required"] as OnboardingState[] },
  { key: "commercial", label: "Commercial Setup", states: ["approved", "commercial_setup"] as OnboardingState[] },
  { key: "ready", label: "Ready for Activation", states: ["ready_for_activation"] as OnboardingState[] },
  { key: "active", label: "Active", states: ["active"] as OnboardingState[] },
  { key: "suspended", label: "Suspended", states: ["suspended"] as OnboardingState[] },
] as const;

/** The unified timeline groups, in journey order. */
export const TIMELINE_GROUPS = [
  { key: "account", label: "Registration" },
  { key: "identity", label: "KYC" },
  { key: "business", label: "Business" },
  { key: "compliance", label: "Documents" },
  { key: "location", label: "Zone" },
  { key: "banking", label: "Bank" },
  { key: "operations", label: "Operations" },
  { key: "commercial", label: "Commercial Model" },
  { key: "agreement", label: "Agreement" },
] as const;

/** Requirement shape returned by `getOnboardingState`. */
export interface StepRequirement {
  id: string;
  label: string;
  group: string;
  mandatory: boolean;
  requiresDocument?: boolean;
  tracksExpiry?: boolean;
  /** Journey screen in the partner apps: business, documents, bank, setup, finish. */
  stage?: string;
  hint?: string;
  /** The upload is read and checked automatically. */
  autoVerify?: boolean;
  /** Completed by the system; partner apps never show it as a to-do. */
  automatic?: boolean;
}

export interface ApplicantContext {
  gstRegistered?: boolean;
  bankProofNeeded?: boolean;
  identityCheckNeeded?: boolean;
}

export const DEFAULT_REQUIREMENTS: Record<PartnerRole, StepRequirement[]> = {
  vendor: [
    { id: "account", label: "Account created", group: "account", stage: "business", mandatory: true, automatic: true },
    { id: "shop_details", label: "Restaurant details", group: "business", stage: "business", mandatory: true,
      hint: "Name, cuisine and a phone number customers and riders can reach." },
    { id: "map_location", label: "Restaurant location", group: "location", stage: "business", mandatory: true,
      hint: "Drop a pin on your entrance so riders find the pickup point." },
    { id: "operating_hours", label: "Opening hours", group: "operations", stage: "business", mandatory: true },
    { id: "pan", label: "PAN card", group: "identity", stage: "documents", mandatory: true, requiresDocument: true, autoVerify: true,
      hint: "Business PAN, or proprietor's personal PAN." },
    { id: "fssai", label: "FSSAI licence", group: "compliance", stage: "documents", mandatory: true,
      requiresDocument: true, tracksExpiry: true, autoVerify: true,
      hint: "Licence or registration. Still waiting for it? Upload the application." },
    { id: "gst_status", label: "GST registration status", group: "compliance", stage: "documents", mandatory: true,
      hint: "Tell us whether you're registered under GST." },
    { id: "gst_certificate", label: "GST certificate", group: "compliance", stage: "documents", mandatory: true,
      requiresDocument: true, autoVerify: true,
      hint: "The certificate page that shows your GSTIN." },
    { id: "owner_identity", label: "Owner ID", group: "identity", stage: "documents", mandatory: true,
      requiresDocument: true, autoVerify: true,
      hint: "Aadhaar, voter ID or passport. Needed because a name didn't match." },
    { id: "bank_account", label: "Bank account", group: "banking", stage: "bank", mandatory: true,
      hint: "Where your payouts go. We verify it automatically." },
    { id: "bank_proof", label: "Cancelled cheque or passbook", group: "banking", stage: "bank", mandatory: true,
      requiresDocument: true, autoVerify: true,
      hint: "A photo showing your account number and IFSC confirms the account." },
    { id: "menu", label: "Menu", group: "operations", stage: "setup", mandatory: true,
      hint: "Add a few dishes, or snap your printed menu and we'll type it in." },
    { id: "agreement", label: "Partner agreement", group: "agreement", stage: "finish", mandatory: true },
  ],
  mess: [
    { id: "account", label: "Account created", group: "account", stage: "business", mandatory: true, automatic: true },
    { id: "kitchen_details", label: "Kitchen details", group: "business", stage: "business", mandatory: true,
      hint: "Name, meals you serve and a contact number." },
    { id: "map_location", label: "Kitchen location", group: "location", stage: "business", mandatory: true,
      hint: "Drop a pin on your kitchen so delivery and pickup can reach you." },
    { id: "meal_times", label: "Meal times and order cut-offs", group: "operations", stage: "business", mandatory: true,
      hint: "Set hours and order cut-off times for Breakfast, Lunch and Dinner." },
    { id: "kitchen_photos", label: "Kitchen photos", group: "business", stage: "setup", mandatory: true, requiresDocument: true,
      hint: "Two or three clear photos of your kitchen." },
    { id: "pan", label: "PAN card", group: "identity", stage: "documents", mandatory: true, requiresDocument: true, autoVerify: true,
      hint: "Business PAN, or kitchen owner's PAN." },
    { id: "fssai", label: "FSSAI licence", group: "compliance", stage: "documents", mandatory: true,
      requiresDocument: true, tracksExpiry: true, autoVerify: true,
      hint: "Licence or registration. Still waiting for it? Upload the application." },
    { id: "gst_status", label: "GST registration status", group: "compliance", stage: "documents", mandatory: true,
      hint: "Tell us whether you're registered under GST." },
    { id: "gst_certificate", label: "GST certificate", group: "compliance", stage: "documents", mandatory: true,
      requiresDocument: true, autoVerify: true,
      hint: "The certificate page that shows your GSTIN." },
    { id: "owner_identity", label: "Owner ID", group: "identity", stage: "documents", mandatory: true,
      requiresDocument: true, autoVerify: true,
      hint: "Aadhaar, voter ID or passport. Needed because a name didn't match." },
    { id: "bank_account", label: "Bank account", group: "banking", stage: "bank", mandatory: true,
      hint: "Where your weekly subscriptions will be settled." },
    { id: "bank_proof", label: "Cancelled cheque or passbook", group: "banking", stage: "bank", mandatory: true,
      requiresDocument: true, autoVerify: true,
      hint: "A photo showing your account number and IFSC confirms the account." },
    { id: "weekly_menu", label: "Weekly menu", group: "operations", stage: "setup", mandatory: true, requiresDocument: true,
      hint: "A photo or PDF of this week's meal schedule." },
    { id: "agreement", label: "Partner agreement, including Kada's per-customer daily fee", group: "agreement", stage: "finish", mandatory: true },
  ],
  rider: [],
  host: [],
};

export function resolveDefaultRequirements(
  role: PartnerRole,
  context: ApplicantContext = {}
): StepRequirement[] {
  const base = DEFAULT_REQUIREMENTS[role] || DEFAULT_REQUIREMENTS.vendor;
  return base.filter((r) => {
    if (r.id === "gst_certificate" && !context.gstRegistered) return false;
    if (r.id === "bank_proof" && !context.bankProofNeeded) return false;
    if (r.id === "owner_identity" && !context.identityCheckNeeded) return false;
    return true;
  });
}

/** Automatic verdict on one uploaded document (mirrors functions/src/onboarding/documentChecks.ts). */
export type DocumentCheckStatus = "checking" | "auto_verified" | "needs_review" | "retake";

export const DOCUMENT_CHECK_META: Record<DocumentCheckStatus, { label: string; className: string }> = {
  checking: { label: "Checking", className: "bg-sky-500/10 text-sky-600 border-sky-500/20" },
  auto_verified: { label: "Verified", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  needs_review: { label: "Needs review", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  retake: { label: "Retake asked", className: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
};

/** Public, engine-owned `onboardingChecks` on the partner doc. */
export interface OnboardingChecks {
  documents?: Record<string, { status?: DocumentCheckStatus; issues?: string[]; provider?: string; reviewedBy?: string }>;
  review?: { reasons?: string[]; needsPerson?: boolean } | null;
  bankProofNeeded?: boolean;
  identityCheckNeeded?: boolean;
}

/** What the reader extracted, kept in partner_private (admin-only). */
export interface DocumentVerification {
  status?: DocumentCheckStatus;
  issues?: string[];
  fields?: Record<string, string | null>;
  checks?: Record<string, boolean | null>;
  documentNumber?: string | null;
  documentKind?: string | null;
  confidence?: number | null;
  provider?: string;
}

export interface OnboardingSnapshot {
  exists: boolean;
  partnerId?: string;
  state: OnboardingState | null;
  role?: PartnerRole;
  businessStructure?: string | null;
  steps?: Record<string, boolean>;
  documentNumbers?: Record<string, string>;
  requirements?: StepRequirement[];
  completion?: number;
  missing?: { id: string; label: string; group: string }[];
  zoneId?: string | null;
  marketId?: string | null;
  blockingReasons?: string[];
  bank?: {
    state: BankVerificationState;
    holder?: string | null;
    accountMasked?: string;
    ifsc?: string | null;
    message?: string | null;
    nameMatch?: { score: number; matched: boolean; comparedTo: string } | null;
  };
  documentsExpiringSoon?: { id: string; label: string; expiresAt: number }[];
  checks?: OnboardingChecks;
}

export function stateMeta(state: unknown): StateMeta {
  const s = String(state ?? "") as OnboardingState;
  return STATE_META[s] ?? STATE_META.started;
}

export function bankStateMeta(state: unknown) {
  const s = String(state ?? "not_added") as BankVerificationState;
  return BANK_STATE_META[s] ?? BANK_STATE_META.not_added;
}

// ─── Partner private store ────────────────────────────────────────────────
// Mirrors functions/src/onboarding/partnerPrivate.ts. restaurants/hotels are
// publicly readable, so full bank details, PAN and owner contact live in these
// admin-only collections, keyed `${role}_${partnerId}`.

export const PARTNER_PRIVATE_COLLECTION = "partner_private";
export const PARTNER_CONTACT_COLLECTION = "partner_contact";

export function partnerDocKey(role: PartnerRole, partnerId: string): string {
  return `${role}_${partnerId}`;
}

/** partner_private — finance-grade admins (and the owner) only. */
export interface PartnerPrivate {
  role?: PartnerRole;
  partnerId?: string;
  bank?: {
    holder?: string;
    accountNumber?: string;
    ifsc?: string;
    vpa?: string;
    registeredName?: string | null;
    verificationDetail?: string;
  };
  identity?: { pan?: string };
  /** Per document step: what the automatic reader extracted and concluded. */
  verifications?: Record<string, DocumentVerification>;
}

/** partner_contact — any admin (and the owner). */
export interface PartnerContact {
  role?: PartnerRole;
  partnerId?: string;
  email?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  outletEmail?: string;
  hostEmail?: string;
}

/** Best contact email: the private record, then legacy public fields not yet sealed. */
export function partnerEmail(
  contact?: PartnerContact | null,
  pub?: { email?: string; ownerEmail?: string } | null,
): string {
  return (
    contact?.email ||
    contact?.ownerEmail ||
    contact?.outletEmail ||
    contact?.hostEmail ||
    pub?.email ||
    pub?.ownerEmail ||
    ""
  );
}

/** "••••6789 · HDFC" from the PUBLIC bank summary — never the full account. */
export function publicBankLabel(bank: unknown): string {
  const b = (bank ?? {}) as { accountMasked?: string; ifscBank?: string | null };
  return [b.accountMasked, b.ifscBank].filter(Boolean).join(" · ");
}
