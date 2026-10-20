/**
 * ─────────────────────────────────────────────────────────────────────────
 * KYC / onboarding requirements engine.
 *
 * Requirements are DATA, not code branches. A step is mandatory for a given
 * (role, businessStructure, service) combination or it isn't — and admin can
 * override the defaults from `config/onboarding_requirements` without a
 * deploy. That matters because the rules genuinely differ:
 *
 *   - a sole proprietor has no incorporation certificate or partnership deed
 *   - a rider on a bicycle needs no RC / insurance / PUC
 *   - GST is mandatory only above the turnover threshold or for inter-state
 *   - a host that only lists rooms (no F&B) needs no FSSAI
 *
 * Hardcoding "every partner uploads every document" is what makes onboarding
 * abandonment high, so the engine resolves the ACTUAL required set per
 * applicant and the UI renders only that.
 *
 * `DEFAULT_REQUIREMENTS` below is the fallback baked into the deploy; the
 * Firestore doc, when present, is merged over it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { PartnerRole } from "./stateMachine";

/** A single onboarding step / document requirement. */
export interface StepRequirement {
  /** Stable id — used as the key in `onboarding.steps`. */
  id: string;
  /** Human label shown in the partner app + admin timeline. */
  label: string;
  /** Which phase of the journey this belongs to (for grouping in UI). */
  group:
    | "account"
    | "identity"
    | "business"
    | "location"
    | "compliance"
    | "banking"
    | "operations"
    | "commercial"
    | "agreement";
  /**
   * When false the applicant may skip it and still reach `active`. Optional
   * steps still get collected + reviewed, they just don't block activation.
   */
  mandatory: boolean;
  /** True when this step carries an uploaded document. */
  requiresDocument?: boolean;
  /** True when the document carries an expiry date we must track. */
  tracksExpiry?: boolean;
  /**
   * Only applies when the applicant's businessStructure is in this list.
   * Empty/absent = applies to all structures.
   */
  structures?: string[];
  /**
   * Only applies when one of these conditions holds. Evaluated against the
   * applicant's own submitted data by `resolveRequirements`.
   */
  condition?:
    | "gst_registered"
    | "motorised_vehicle"
    | "serves_food"
    | "accepts_payouts"
    /** Automatic bank verification (penny drop) is unavailable or failed. */
    | "bank_proof_needed"
    /** An automatic identity check (PAN / bank name match) didn't pass. */
    | "identity_check_needed";
  /** Partner-facing screen this step appears on, in journey order. */
  stage?: "business" | "documents" | "bank" | "setup" | "finish";
  /** One-line, plain-language help shown under the step. */
  hint?: string;
  /** The upload is read and checked automatically (documentChecks.ts). */
  autoVerify?: boolean;
  /** Completed by the system, never shown to the partner as a to-do. */
  automatic?: boolean;
}

/** Business structures we support, per role. */
export const BUSINESS_STRUCTURES = [
  "sole_proprietor",
  "partnership",
  "llp",
  "private_limited",
  "public_limited",
  "trust_society",
  "individual", // riders
] as const;

export type BusinessStructure = (typeof BUSINESS_STRUCTURES)[number];

/**
 * Documents that prove a business structure exists. Keyed by structure so a
 * sole proprietor is never asked for a partnership deed.
 */
export const STRUCTURE_PROOF: Record<string, StepRequirement | null> = {
  sole_proprietor: {
    id: "proof_proprietor",
    label: "Proprietorship proof (Udyam / Shop & Establishment)",
    group: "business",
    mandatory: true,
    requiresDocument: true,
  },
  partnership: {
    id: "proof_partnership_deed",
    label: "Partnership deed",
    group: "business",
    mandatory: true,
    requiresDocument: true,
  },
  llp: {
    id: "proof_llp_incorporation",
    label: "LLP incorporation certificate + LLP agreement",
    group: "business",
    mandatory: true,
    requiresDocument: true,
  },
  private_limited: {
    id: "proof_coi",
    label: "Certificate of Incorporation + MOA/AOA",
    group: "business",
    mandatory: true,
    requiresDocument: true,
  },
  public_limited: {
    id: "proof_coi",
    label: "Certificate of Incorporation + MOA/AOA",
    group: "business",
    mandatory: true,
    requiresDocument: true,
  },
  trust_society: {
    id: "proof_trust_deed",
    label: "Trust deed / Society registration certificate",
    group: "business",
    mandatory: true,
    requiresDocument: true,
  },
  individual: null, // riders prove identity, not entity
};

/**
 * ── Lean requirement sets ─────────────────────────────────────────────────
 * Modelled on how Swiggy / Zomato onboard partners: ask for the few documents
 * the law and payouts actually need, read them automatically, and only ask
 * for more when an automatic check fails.
 *
 *   - ONE PAN. A sole proprietor's personal PAN is their business PAN.
 *   - GST certificate only when GST registered.
 *   - Cancelled cheque only when automatic bank verification can't run/failed.
 *   - Owner ID only when a name check fails (riders always: rider safety).
 *   - Address and service zone come from the map pin — never typed.
 *   - Structure proofs (Udyam, deeds, COI), owner address proof, POS and the
 *     commercial model are no longer asked up front.
 *
 * Step ids that changed keep existing partners' progress via STEP_ALIASES.
 */

const ACCOUNT: StepRequirement = {
  id: "account", label: "Account created", group: "account", stage: "business", mandatory: true, automatic: true,
};

const MAP_LOCATION = (what: string): StepRequirement => ({
  id: "map_location", label: `${what} location`, group: "location", stage: "business", mandatory: true,
  hint: "Drop a pin on the map. We fill in the address and check we deliver there.",
});

const PAN: StepRequirement = {
  id: "pan", label: "PAN card", group: "identity", stage: "documents", mandatory: true,
  requiresDocument: true, autoVerify: true,
  hint: "Your business PAN. If you're a sole proprietor, your own PAN.",
};

const GST_STATUS: StepRequirement = {
  id: "gst_status", label: "GST registration", group: "compliance", stage: "documents", mandatory: true,
  hint: "Tell us whether you're GST registered. Not registered is fine.",
};

const GST_CERTIFICATE: StepRequirement = {
  id: "gst_certificate", label: "GST certificate", group: "compliance", stage: "documents", mandatory: true,
  requiresDocument: true, autoVerify: true, condition: "gst_registered",
  hint: "The certificate page that shows your GSTIN.",
};

const FSSAI = (condition?: StepRequirement["condition"]): StepRequirement => ({
  id: "fssai", label: "FSSAI licence", group: "compliance", stage: "documents", mandatory: true,
  requiresDocument: true, tracksExpiry: true, autoVerify: true,
  ...(condition ? { condition } : {}),
  hint: "Licence or registration. Still waiting for it? Upload the application.",
});

const OWNER_IDENTITY_IF_NEEDED: StepRequirement = {
  id: "owner_identity", label: "Owner ID", group: "identity", stage: "documents", mandatory: true,
  requiresDocument: true, autoVerify: true, condition: "identity_check_needed",
  hint: "Aadhaar, voter ID or passport. Needed because a name didn't match.",
};

const BANK_ACCOUNT: StepRequirement = {
  id: "bank_account", label: "Bank account", group: "banking", stage: "bank", mandatory: true,
  hint: "Where your payouts go. We verify it automatically.",
};

const BANK_PROOF_IF_NEEDED: StepRequirement = {
  id: "bank_proof", label: "Cancelled cheque or passbook", group: "banking", stage: "bank", mandatory: true,
  requiresDocument: true, autoVerify: true, condition: "bank_proof_needed",
  hint: "A photo showing your account number and IFSC confirms the account.",
};

const AGREEMENT_STEP: StepRequirement = {
  id: "agreement", label: "Partner agreement", group: "agreement", stage: "finish", mandatory: true,
};

/**
 * Baseline requirements per role. Merged with (and overridable by) the
 * `config/onboarding_requirements` Firestore document.
 */
export const DEFAULT_REQUIREMENTS: Record<PartnerRole, StepRequirement[]> = {
  // ── Kada Dine (vendor) ────────────────────────────────────────────────
  vendor: [
    ACCOUNT,
    { id: "shop_details", label: "Restaurant details", group: "business", stage: "business", mandatory: true,
      hint: "Name, cuisine and a phone number customers and riders can reach." },
    MAP_LOCATION("Restaurant"),
    { id: "operating_hours", label: "Opening hours", group: "operations", stage: "business", mandatory: true },
    PAN,
    FSSAI("serves_food"),
    GST_STATUS,
    GST_CERTIFICATE,
    OWNER_IDENTITY_IF_NEEDED,
    BANK_ACCOUNT,
    BANK_PROOF_IF_NEEDED,
    { id: "menu", label: "Menu", group: "operations", stage: "setup", mandatory: true,
      hint: "Add a few dishes, or snap your printed menu and we'll type it in." },
    AGREEMENT_STEP,
  ],

  // ── Kada Delivery (rider) ─────────────────────────────────────────────
  rider: [
    { ...ACCOUNT, label: "Account + OTP verified" },
    { id: "personal_details", label: "Your details", group: "identity", stage: "business", mandatory: true,
      hint: "Name, a clear profile photo and your vehicle." },
    { id: "owner_identity", label: "Aadhaar or other ID", group: "identity", stage: "documents", mandatory: true,
      requiresDocument: true, autoVerify: true, hint: "For customer and restaurant safety." },
    { ...PAN, hint: "Your own PAN card. Needed for your earnings." },
    { id: "driving_licence", label: "Driving licence", group: "compliance", stage: "documents", mandatory: true,
      requiresDocument: true, tracksExpiry: true, autoVerify: true, condition: "motorised_vehicle" },
    { id: "vehicle_rc", label: "Vehicle RC", group: "compliance", stage: "documents", mandatory: true,
      requiresDocument: true, autoVerify: true, condition: "motorised_vehicle",
      hint: "A family member's vehicle is fine." },
    { id: "vehicle_insurance", label: "Vehicle insurance", group: "compliance", stage: "documents", mandatory: false,
      requiresDocument: true, tracksExpiry: true, autoVerify: true, condition: "motorised_vehicle" },
    { id: "emergency_contact", label: "Emergency contact", group: "identity", stage: "business", mandatory: true },
    { ...BANK_ACCOUNT, hint: "Where your earnings go. We verify it automatically." },
    BANK_PROOF_IF_NEEDED,
    { id: "upi", label: "UPI ID", group: "banking", stage: "bank", mandatory: false },
    // Riders don't type an address: one tap resolves their zone from GPS.
    { id: "map_location", label: "Delivery area", group: "location", stage: "setup", mandatory: true,
      hint: "One tap. We use your current location to pick your zone." },
    { id: "training", label: "Quick training", group: "operations", stage: "setup", mandatory: true,
      hint: "Five short cards on picking up and delivering orders." },
    AGREEMENT_STEP,
  ],

  // ── Kada Host ─────────────────────────────────────────────────────────
  host: [
    ACCOUNT,
    { id: "property_details", label: "Property details", group: "business", stage: "business", mandatory: true,
      hint: "Name, type, rooms and whether you serve food." },
    { ...MAP_LOCATION("Property"), hint: "So guests can find you. One tap if you're at the property." },
    PAN,
    GST_STATUS,
    GST_CERTIFICATE,
    FSSAI("serves_food"),
    OWNER_IDENTITY_IF_NEEDED,
    BANK_ACCOUNT,
    BANK_PROOF_IF_NEEDED,
    AGREEMENT_STEP,
  ],

  // ── Kada Mess (monthly mess kitchens) ─────────────────────────────────
  // Kitchens sell monthly meal plans, not à-la-carte orders, so they owe a
  // weekly menu and meal cut-offs instead of a menu catalogue, opening hours
  // and POS setup. FSSAI has no condition: every mess prepares food.
  mess: [
    ACCOUNT,
    { id: "kitchen_details", label: "Kitchen details", group: "business", stage: "business", mandatory: true,
      hint: "Name, meals you serve and a contact number." },
    MAP_LOCATION("Kitchen"),
    { id: "meal_times", label: "Meal times and order cut-offs", group: "operations", stage: "business", mandatory: true },
    { id: "kitchen_photos", label: "Kitchen photos", group: "business", stage: "setup", mandatory: true, requiresDocument: true,
      hint: "Two or three clear photos of your kitchen." },
    PAN,
    FSSAI(),
    GST_STATUS,
    GST_CERTIFICATE,
    OWNER_IDENTITY_IF_NEEDED,
    BANK_ACCOUNT,
    BANK_PROOF_IF_NEEDED,
    { id: "weekly_menu", label: "Weekly menu", group: "operations", stage: "setup", mandatory: true, requiresDocument: true,
      hint: "A photo or PDF of this week's menu." },
    { ...AGREEMENT_STEP, label: "Partner agreement, including Kada's per-customer daily fee" },
  ],
};

/**
 * Old step ids that satisfy a new one, so partners mid-onboarding keep their
 * progress. Each inner list must be fully complete.
 */
export const STEP_ALIASES: Record<string, string[][]> = {
  pan: [["business_pan"], ["owner_pan"]],
  bank_account: [["bank_holder", "bank_account"]],
  shop_details: [["business_address", "shop_details"]],
  map_location: [["zone_assignment"]],
};

/** True when a step (or a legacy equivalent) is complete. */
export function isStepDone(id: string, completed: Record<string, boolean> | undefined): boolean {
  const done = completed ?? {};
  if (done[id] === true) return true;
  return (STEP_ALIASES[id] ?? []).some((group) => group.every((g) => done[g] === true));
}

/** Applicant facts the conditional requirements are evaluated against. */
export interface ApplicantContext {
  businessStructure?: string;
  /** Vendor/host declared GST registration. */
  gstRegistered?: boolean;
  /** Rider vehicle type — bicycle/on-foot need no DL/RC/insurance/PUC. */
  vehicleType?: string;
  /** Whether the partner prepares/sells food (drives FSSAI). */
  servesFood?: boolean;
  /** Whether the partner receives payouts (drives banking steps). */
  acceptsPayouts?: boolean;
  /** Automatic bank verification unavailable or failed → cheque needed. */
  bankProofNeeded?: boolean;
  /** A name/identity check failed → owner ID needed. */
  identityCheckNeeded?: boolean;
  /** The partner role, when a condition depends on it. */
  role?: PartnerRole;
}

/** Vehicle types that legally require licence / RC / insurance / PUC. */
const MOTORISED = ["bike", "motorcycle", "scooter", "car", "van", "auto", "e-bike", "ev_bike"];

export function isMotorised(vehicleType?: string): boolean {
  const v = (vehicleType ?? "").toLowerCase().trim();
  if (!v) return true; // unknown → assume motorised (fail safe, not open)
  if (["bicycle", "cycle", "foot", "on_foot", "walker"].includes(v)) return false;
  return MOTORISED.includes(v) || true; // any other declared vehicle → motorised
}

/** Evaluates a requirement's `condition` against the applicant's own facts. */
function conditionHolds(req: StepRequirement, ctx: ApplicantContext): boolean {
  if (!req.condition) return true;
  switch (req.condition) {
    case "gst_registered":
      return ctx.gstRegistered === true;
    case "motorised_vehicle":
      return isMotorised(ctx.vehicleType);
    case "serves_food":
      // Vendors serve food by definition; hosts only when they declare it.
      return ctx.role === "host" ? ctx.servesFood === true : ctx.servesFood !== false;
    case "accepts_payouts":
      return ctx.acceptsPayouts !== false;
    case "bank_proof_needed":
      return ctx.bankProofNeeded === true;
    case "identity_check_needed":
      return ctx.identityCheckNeeded === true;
    default:
      return true;
  }
}

/**
 * Resolves the ACTUAL requirement set for one applicant — the baseline for
 * their role, filtered by business structure and their declared conditions,
 * plus the structure-proof document for their entity type.
 *
 * `overrides` is the admin-managed `config/onboarding_requirements` document:
 *   { vendor: { fssai: { mandatory: false } }, rider: { upi: { mandatory: true } } }
 * Only the fields present are overlaid, so admin can relax or tighten a
 * single requirement without restating the whole set.
 */
export function resolveRequirements(
  role: PartnerRole,
  ctx: ApplicantContext,
  overrides?: Record<string, Record<string, Partial<StepRequirement>>>,
): StepRequirement[] {
  const base = DEFAULT_REQUIREMENTS[role] ?? [];
  const roleOverrides = overrides?.[role] ?? {};

  const resolved: StepRequirement[] = [];

  const withRole: ApplicantContext = { ...ctx, role };
  for (const req of base) {
    // Structure filter — skip requirements that don't apply to this entity.
    if (req.structures?.length) {
      const s = ctx.businessStructure ?? "";
      if (!req.structures.includes(s)) continue;
    }
    // Condition filter — skip requirements whose precondition doesn't hold.
    if (!conditionHolds(req, withRole)) continue;

    const override = roleOverrides[req.id];
    resolved.push(override ? { ...req, ...override } : req);
  }

  // Structure proofs (STRUCTURE_PROOF) are no longer asked up front. An admin
  // can still require one for a role through config/onboarding_requirements.
  for (const [id, override] of Object.entries(roleOverrides)) {
    if (resolved.some((r) => r.id === id)) continue;
    const proof = Object.values(STRUCTURE_PROOF).find((p) => p?.id === id);
    if (proof && (override as Partial<StepRequirement>).mandatory) resolved.push({ ...proof, ...override });
  }

  return resolved;
}

/** The mandatory subset — these are what gate activation. */
export function mandatorySteps(reqs: StepRequirement[]): StepRequirement[] {
  return reqs.filter((r) => r.mandatory);
}

/**
 * Which mandatory steps are still outstanding, given the partner's completion
 * map. This is the core question the activation gate asks.
 */
export function missingMandatorySteps(
  reqs: StepRequirement[],
  completed: Record<string, boolean> | undefined,
): StepRequirement[] {
  return mandatorySteps(reqs).filter((r) => !isStepDone(r.id, completed));
}

/** Completion percentage across mandatory steps — for progress UI. */
export function completionPercent(
  reqs: StepRequirement[],
  completed: Record<string, boolean> | undefined,
): number {
  const mandatory = mandatorySteps(reqs);
  if (mandatory.length === 0) return 100;
  const n = mandatory.filter((r) => isStepDone(r.id, completed)).length;
  return Math.round((n / mandatory.length) * 100);
}

/** Builds the applicant context from a raw partner document. */
export function applicantContextOf(
  data: Record<string, unknown>,
  ob: { businessStructure?: string } | undefined,
): ApplicantContext {
  const checks = (data.onboardingChecks ?? {}) as { bankProofNeeded?: unknown; identityCheckNeeded?: unknown };
  return {
    businessStructure: ob?.businessStructure ?? (data.businessStructure as string | undefined),
    gstRegistered: Boolean(data.gstRegistered ?? data.gst ?? data.taxId),
    vehicleType: data.vehicleType as string | undefined,
    servesFood: data.servesFood as boolean | undefined,
    acceptsPayouts: data.acceptsPayouts as boolean | undefined,
    bankProofNeeded: checks.bankProofNeeded === true,
    identityCheckNeeded: checks.identityCheckNeeded === true,
  };
}
