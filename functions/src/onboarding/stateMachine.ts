/**
 * ─────────────────────────────────────────────────────────────────────────
 * Onboarding state machine — the SINGLE source of truth for partner
 * lifecycle across Kada Dine (vendor), Kada Delivery (rider), Kada Host and
 * Kada Mess (monthly mess kitchens).
 *
 * Before this module each app invented its own status vocabulary:
 *   - restaurants:    onboardingStep ∈ {registered, setup_started,
 *                     profile_complete, menu_added, live} + kycStatus +
 *                     isVerified + isActive + subscriptionStatus (5 fields,
 *                     no transition rules, admin could set any of them freely)
 *   - delivery_users: status ∈ {pending_approval, approved, ...} (1 flag,
 *                     no KYC/bank/expiry awareness)
 *   - hotels:         nothing at all — the doc was created live on signup
 *
 * That made "is this partner allowed to operate?" unanswerable, and every
 * downstream surface guessed differently. This module replaces all of it
 * with one explicit machine plus `canTransition` guards, so an illegal jump
 * (e.g. incomplete → active) is rejected at the choke point rather than
 * silently written.
 *
 * The state lives at `<collection>/{id}.onboarding`, NOT as loose top-level
 * fields, so a partial write can never leave a partner half-transitioned.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Canonical lifecycle states, in progression order. */
export const ONBOARDING_STATES = [
  "started",            // account created, nothing submitted
  "incomplete",         // some steps saved, mandatory gates still open
  "submitted",          // applicant declares done; queued for review
  "kyc_review",         // ops actively reviewing identity/business docs
  "verification",       // automated checks running (bank, PAN, duplicates)
  "action_required",    // something failed; applicant must fix + resubmit
  "approved",           // KYC + docs cleared; not yet commercially set up
  "commercial_setup",   // choosing/paying plan, or commission config
  "ready_for_activation", // every gate green; awaiting final admin flip
  "active",             // operational — may receive orders / bookings / offers
  "suspended",          // was active, now halted (expiry, risk, manual)
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** The partner roles this engine governs. */
export const PARTNER_ROLES = ["vendor", "rider", "host", "mess"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

/**
 * Firestore collection backing each role. Mess kitchens sign in through the
 * Kada Dine app but are their own partner type, never a restaurant.
 */
export const ROLE_COLLECTION: Record<PartnerRole, string> = {
  vendor: "restaurants",
  rider: "delivery_users",
  host: "hotels",
  mess: "mess_kitchens",
};

/**
 * Legal transitions. Anything not listed here is refused.
 *
 * Design notes:
 *  - `action_required` is reachable from every review state, because any
 *    reviewer at any stage may bounce the application back.
 *  - `suspended` is reachable from `active` AND from the late pre-activation
 *    states, so a partner caught by an expiry sweep mid-setup still halts.
 *  - There is no edge into `active` except from `ready_for_activation`.
 *    That single-entry design is what makes the activation gate meaningful.
 */
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

/** States from which the partner may perform live business operations. */
export const OPERATIONAL_STATES: readonly OnboardingState[] = ["active"];

/** States that mean "the applicant still has work to do". */
export const APPLICANT_ACTION_STATES: readonly OnboardingState[] = [
  "started",
  "incomplete",
  "action_required",
];

/** States that mean "ops has work to do". */
export const OPS_QUEUE_STATES: readonly OnboardingState[] = [
  "submitted",
  "kyc_review",
  "verification",
  "ready_for_activation",
];

export function isOnboardingState(v: unknown): v is OnboardingState {
  return ONBOARDING_STATES.includes(v as OnboardingState);
}

/** True when `to` is a legal next state from `from`. */
export function canTransition(from: OnboardingState, to: OnboardingState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Explains a refused transition, for the error surfaced to the admin. Kept
 * separate from `canTransition` so the guard stays a cheap boolean.
 */
export function explainTransition(
  from: OnboardingState,
  to: OnboardingState,
): string {
  if (canTransition(from, to)) return "";
  const legal = ALLOWED_TRANSITIONS[from] ?? [];
  if (to === "active" && from !== "ready_for_activation") {
    return (
      `Cannot activate from "${from}". A partner may only become active from ` +
      `"ready_for_activation", which requires every mandatory gate to pass. ` +
      `Legal next states from "${from}": ${legal.join(", ") || "none"}.`
    );
  }
  return (
    `Illegal transition "${from}" → "${to}". ` +
    `Legal next states: ${legal.join(", ") || "none"}.`
  );
}

/** True when the partner may run live business operations. */
export function isOperational(state: OnboardingState): boolean {
  return OPERATIONAL_STATES.includes(state);
}

/**
 * Shape stored at `<collection>/{id}.onboarding`. Every field is written
 * server-side only — clients submit step data, never the state itself.
 */
export interface OnboardingRecord {
  state: OnboardingState;
  role: PartnerRole;
  /** Business structure — drives which KYC documents are mandatory. */
  businessStructure?: string;
  /** Per-step completion map: stepId → true once its data passes validation. */
  steps: Record<string, boolean>;
  /** Per-step admin decision: stepId → "approved" | "rejected". */
  stepReviews?: Record<string, { decision: string; by: string; at: unknown; reason?: string }>;
  /** Resolved zone + market, set once coordinates are captured. */
  zoneId?: string | null;
  marketId?: string | null;
  /** Set when an admin overrides an out-of-service-area placement. */
  zoneOverrideBy?: string | null;
  /** Why the partner is in action_required / suspended. */
  blockingReasons?: string[];
  submittedAt?: unknown;
  approvedAt?: unknown;
  activatedAt?: unknown;
  suspendedAt?: unknown;
  updatedAt?: unknown;
}

/** A single immutable entry in the partner's onboarding timeline. */
export interface OnboardingEvent {
  partnerId: string;
  role: PartnerRole;
  from: OnboardingState | null;
  to: OnboardingState;
  /** "admin" | "system" | "applicant" */
  actor: string;
  actorId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  at: unknown;
}

/** Sub-collection under the partner doc holding the immutable timeline. */
export const ONBOARDING_EVENTS_SUBCOLLECTION = "onboarding_events";
