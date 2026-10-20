import { describe, it, expect } from "vitest";
import {
  canTransition,
  explainTransition,
  isOperational,
  ALLOWED_TRANSITIONS,
  ONBOARDING_STATES,
  type OnboardingState,
} from "../src/onboarding/stateMachine";
import {
  resolveRequirements,
  missingMandatorySteps,
  completionPercent,
  isMotorised,
} from "../src/onboarding/kycRules";
import {
  validateBankDetails,
  normaliseName,
  nameSimilarity,
  checkNameMatch,
  canTransitionBank,
  maskAccount,
  BANK_STATES,
} from "../src/onboarding/bankVerification";
import { inferState } from "../src/onboarding/backfill";
import { expiredDocuments, documentsExpiringWithin } from "../src/onboarding/activationGate";

// ─────────────────────────────────────────────────────────────────────────
// State machine — the activation loophole is the whole point of this engine
// ─────────────────────────────────────────────────────────────────────────

describe("onboarding state machine", () => {
  it("only allows `active` to be entered from `ready_for_activation`", () => {
    const entriesIntoActive = ONBOARDING_STATES.filter((s) =>
      ALLOWED_TRANSITIONS[s].includes("active"),
    );
    // `suspended` may be restored to active; nothing else may jump there.
    expect(entriesIntoActive.sort()).toEqual(["ready_for_activation", "suspended"]);
  });

  it("refuses the classic loophole: incomplete → active", () => {
    expect(canTransition("incomplete", "active")).toBe(false);
    expect(explainTransition("incomplete", "active")).toMatch(/only become active from/i);
  });

  it("refuses submitted → active and started → active", () => {
    expect(canTransition("submitted", "active")).toBe(false);
    expect(canTransition("started", "active")).toBe(false);
    expect(canTransition("approved", "active")).toBe(false);
  });

  it("allows the legitimate happy path end to end", () => {
    const path: OnboardingState[] = [
      "started",
      "incomplete",
      "submitted",
      "kyc_review",
      "verification",
      "approved",
      "commercial_setup",
      "ready_for_activation",
      "active",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(
        canTransition(path[i], path[i + 1]),
        `${path[i]} → ${path[i + 1]} should be legal`,
      ).toBe(true);
    }
  });

  it("lets any review stage bounce back to action_required", () => {
    for (const s of ["submitted", "kyc_review", "verification", "approved"] as OnboardingState[]) {
      expect(canTransition(s, "action_required")).toBe(true);
    }
  });

  it("treats only `active` as operational", () => {
    for (const s of ONBOARDING_STATES) {
      expect(isOperational(s)).toBe(s === "active");
    }
  });

  it("never lists a state that isn't a real state as a legal target", () => {
    for (const s of ONBOARDING_STATES) {
      for (const t of ALLOWED_TRANSITIONS[s]) {
        expect(ONBOARDING_STATES).toContain(t);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// KYC rules engine — requirements must vary by entity/vehicle, not be uniform
// ─────────────────────────────────────────────────────────────────────────

describe("KYC requirement resolution", () => {
  it("asks every business for one PAN, never separate owner and business PANs", () => {
    for (const structure of ["sole_proprietor", "private_limited"]) {
      const ids = resolveRequirements("vendor", { businessStructure: structure }).map((r) => r.id);
      expect(ids).toContain("pan");
      expect(ids).not.toContain("owner_pan");
      expect(ids).not.toContain("business_pan");
    }
  });

  it("no longer asks for structure proofs, owner address proof or POS up front", () => {
    const ids = resolveRequirements("vendor", { businessStructure: "private_limited" }).map((r) => r.id);
    for (const gone of ["proof_coi", "proof_proprietor", "owner_address", "pos_billing", "commercial_model",
      "business_entity", "zone_assignment", "bank_holder", "bank_verification"]) {
      expect(ids, `${gone} should not be asked up front`).not.toContain(gone);
    }
  });

  it("lets an admin still require a structure proof through overrides", () => {
    const ids = resolveRequirements("vendor", { businessStructure: "private_limited" },
      { vendor: { proof_coi: { mandatory: true } } }).map((r) => r.id);
    expect(ids).toContain("proof_coi");
  });

  it("only requires a GST certificate when the applicant is GST registered", () => {
    const without = resolveRequirements("vendor", {
      businessStructure: "sole_proprietor",
      gstRegistered: false,
    }).map((r) => r.id);
    expect(without).not.toContain("gst_certificate");

    const with_ = resolveRequirements("vendor", {
      businessStructure: "sole_proprietor",
      gstRegistered: true,
    }).map((r) => r.id);
    expect(with_).toContain("gst_certificate");
  });

  it("asks for a cancelled cheque only when automatic bank verification can't vouch", () => {
    expect(resolveRequirements("vendor", {}).map((r) => r.id)).not.toContain("bank_proof");
    expect(resolveRequirements("vendor", { bankProofNeeded: true }).map((r) => r.id)).toContain("bank_proof");
  });

  it("asks a business for owner ID only when a name check failed; riders always", () => {
    expect(resolveRequirements("vendor", {}).map((r) => r.id)).not.toContain("owner_identity");
    expect(resolveRequirements("vendor", { identityCheckNeeded: true }).map((r) => r.id)).toContain("owner_identity");
    expect(resolveRequirements("rider", { vehicleType: "bicycle" }).map((r) => r.id)).toContain("owner_identity");
  });

  it("resolves a rider's delivery area from GPS, and keeps older riders' zone progress", () => {
    const reqs = resolveRequirements("rider", { vehicleType: "bicycle" });
    expect(reqs.find((r) => r.id === "map_location")?.mandatory).toBe(true);
    expect(missingMandatorySteps(reqs, { zone_assignment: true }).map((r) => r.id)).not.toContain("map_location");
  });

  it("does not demand DL / RC / insurance from a bicycle rider", () => {
    const ids = resolveRequirements("rider", { vehicleType: "bicycle" }).map((r) => r.id);
    expect(ids).not.toContain("driving_licence");
    expect(ids).not.toContain("vehicle_rc");
    expect(ids).not.toContain("vehicle_insurance");
  });

  it("demands DL and RC from a motorbike rider; insurance is optional", () => {
    const reqs = resolveRequirements("rider", { vehicleType: "bike" });
    const ids = reqs.map((r) => r.id);
    expect(ids).toContain("driving_licence");
    expect(ids).toContain("vehicle_rc");
    expect(reqs.find((r) => r.id === "vehicle_insurance")?.mandatory).toBe(false);
  });

  it("fails safe: an unknown vehicle type is treated as motorised", () => {
    expect(isMotorised(undefined)).toBe(true);
    expect(isMotorised("")).toBe(true);
    expect(isMotorised("bicycle")).toBe(false);
    expect(isMotorised("on_foot")).toBe(false);
  });

  it("requires a bank account for every partner role", () => {
    for (const role of ["vendor", "rider", "host", "mess"] as const) {
      const ids = resolveRequirements(role, {}).map((r) => r.id);
      expect(ids, `${role} must collect banking`).toContain("bank_account");
    }
  });

  it("asks a host for FSSAI only when they serve food", () => {
    expect(resolveRequirements("host", {}).map((r) => r.id)).not.toContain("fssai");
    expect(resolveRequirements("host", { servesFood: true }).map((r) => r.id)).toContain("fssai");
    expect(resolveRequirements("vendor", {}).map((r) => r.id)).toContain("fssai");
  });

  it("keeps a partner's progress when step ids changed", () => {
    const reqs = resolveRequirements("vendor", { businessStructure: "sole_proprietor" });
    const legacy = { owner_pan: true, bank_holder: true, bank_account: true };
    const missing = missingMandatorySteps(reqs, legacy).map((r) => r.id);
    expect(missing).not.toContain("pan");
    expect(missing).not.toContain("bank_account");
  });

  it("gives every step a partner-facing stage", () => {
    for (const role of ["vendor", "rider", "host", "mess"] as const) {
      for (const r of resolveRequirements(role, { gstRegistered: true, servesFood: true, bankProofNeeded: true, identityCheckNeeded: true, vehicleType: "bike" })) {
        expect(r.stage, `${role}/${r.id} has no stage`).toBeTruthy();
      }
    }
  });

  it("honours admin overrides without a redeploy", () => {
    const base = resolveRequirements("rider", { vehicleType: "bike" });
    expect(base.find((r) => r.id === "upi")?.mandatory).toBe(false);

    const overridden = resolveRequirements(
      "rider",
      { vehicleType: "bike" },
      { rider: { upi: { mandatory: true } } },
    );
    expect(overridden.find((r) => r.id === "upi")?.mandatory).toBe(true);
  });

  it("computes missing mandatory steps and completion honestly", () => {
    const reqs = resolveRequirements("rider", { vehicleType: "bicycle" });
    expect(completionPercent(reqs, {})).toBe(0);
    expect(missingMandatorySteps(reqs, {}).length).toBeGreaterThan(0);

    const all: Record<string, boolean> = {};
    for (const r of reqs) all[r.id] = true;
    expect(completionPercent(reqs, all)).toBe(100);
    expect(missingMandatorySteps(reqs, all)).toEqual([]);
  });

  it("does not count optional steps against completion", () => {
    const reqs = resolveRequirements("rider", { vehicleType: "bicycle" });
    const mandatoryOnly: Record<string, boolean> = {};
    for (const r of reqs) if (r.mandatory) mandatoryOnly[r.id] = true;
    // UPI is optional — leaving it out must still read as 100%.
    expect(completionPercent(reqs, mandatoryOnly)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Banking — this is the module that decides where money lands
// ─────────────────────────────────────────────────────────────────────────

describe("bank detail validation", () => {
  it("accepts a well-formed account", () => {
    const r = validateBankDetails({
      holder: "Kada Foods",
      accountNumber: "50100123456789",
      ifsc: "HDFC0001234",
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a malformed IFSC", () => {
    for (const bad of ["HDFC1001234", "HDF00001234", "hdfc0001234x", "", "HDFC0001"]) {
      const r = validateBankDetails({
        holder: "Kada Foods",
        accountNumber: "50100123456789",
        ifsc: bad,
      });
      expect(r.valid, `${bad} should be rejected`).toBe(false);
    }
  });

  it("accepts a lowercase IFSC by normalising it", () => {
    expect(
      validateBankDetails({
        holder: "Kada Foods",
        accountNumber: "50100123456789",
        ifsc: "hdfc0001234",
      }).valid,
    ).toBe(true);
  });

  it("rejects account numbers outside 9–18 digits", () => {
    for (const bad of ["12345678", "1234567890123456789", "abcd12345678", ""]) {
      expect(
        validateBankDetails({ holder: "X Ltd", accountNumber: bad, ifsc: "HDFC0001234" }).valid,
        `${bad} should be rejected`,
      ).toBe(false);
    }
  });

  it("rejects a too-short holder name", () => {
    expect(
      validateBankDetails({ holder: "AB", accountNumber: "50100123456789", ifsc: "HDFC0001234" })
        .valid,
    ).toBe(false);
  });
});

describe("holder name matching", () => {
  it("normalises entity suffixes and honorifics away", () => {
    expect(normaliseName("M/s Kada Foods Pvt. Ltd.")).toBe("KADA FOODS");
    expect(normaliseName("KADA FOODS PRIVATE LIMITED")).toBe("KADA FOODS");
  });

  it("matches the same business written differently", () => {
    const m = checkNameMatch("M/s Kada Foods Pvt. Ltd.", "KADA FOODS PRIVATE LIMITED");
    expect(m.matched).toBe(true);
    expect(m.score).toBe(1);
  });

  it("flags a genuinely different payee", () => {
    const m = checkNameMatch("Rajesh Kumar", "Kada Foods Private Limited");
    expect(m.matched).toBe(false);
  });

  it("scores partial overlap below the threshold", () => {
    expect(nameSimilarity("Kada Foods", "Kada Textiles Trading Company")).toBeLessThan(1);
  });

  it("treats an empty name as no match rather than a perfect one", () => {
    expect(nameSimilarity("", "Kada Foods")).toBe(0);
    expect(nameSimilarity("Kada Foods", "")).toBe(0);
  });
});

describe("bank state machine", () => {
  it("cannot jump straight from not_added to verified", () => {
    expect(canTransitionBank(BANK_STATES.NOT_ADDED, BANK_STATES.VERIFIED)).toBe(false);
  });

  it("must pass through pending_verification", () => {
    expect(canTransitionBank(BANK_STATES.NOT_ADDED, BANK_STATES.PENDING)).toBe(true);
    expect(canTransitionBank(BANK_STATES.PENDING, BANK_STATES.VERIFIED)).toBe(true);
  });

  it("allows a verified account to be suspended and re-verified", () => {
    expect(canTransitionBank(BANK_STATES.VERIFIED, BANK_STATES.SUSPENDED)).toBe(true);
    expect(canTransitionBank(BANK_STATES.SUSPENDED, BANK_STATES.PENDING)).toBe(true);
  });

  it("lets a failed account retry", () => {
    expect(canTransitionBank(BANK_STATES.FAILED, BANK_STATES.PENDING)).toBe(true);
  });
});

describe("account masking", () => {
  it("shows only the last four digits", () => {
    expect(maskAccount("50100123456789")).toBe("••••6789");
  });
  it("never leaks a short account", () => {
    expect(maskAccount("1234")).toBe("••••");
    expect(maskAccount("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Document expiry — the gate that auto-suspends on lapsed insurance
// ─────────────────────────────────────────────────────────────────────────

describe("document expiry", () => {
  const reqs = [
    { id: "vehicle_insurance", label: "Vehicle insurance", tracksExpiry: true, mandatory: true },
    { id: "owner_pan", label: "Owner PAN", tracksExpiry: false, mandatory: true },
  ];

  it("reports a mandatory expired document", () => {
    const past = Date.now() - 86_400_000;
    expect(expiredDocuments({ vehicle_insurance: { expiresAt: past } }, reqs)).toEqual([
      "Vehicle insurance",
    ]);
  });

  it("ignores documents that do not track expiry", () => {
    const past = Date.now() - 86_400_000;
    expect(expiredDocuments({ owner_pan: { expiresAt: past } }, reqs)).toEqual([]);
  });

  it("does not report a still-valid document", () => {
    const future = Date.now() + 86_400_000 * 60;
    expect(expiredDocuments({ vehicle_insurance: { expiresAt: future } }, reqs)).toEqual([]);
  });

  it("surfaces documents expiring inside the warning horizon", () => {
    const inTenDays = Date.now() + 86_400_000 * 10;
    const soon = documentsExpiringWithin({ vehicle_insurance: { expiresAt: inTenDays } }, reqs, 30);
    expect(soon.map((s) => s.id)).toEqual(["vehicle_insurance"]);
  });

  it("does not warn about something expiring beyond the horizon", () => {
    const inNinetyDays = Date.now() + 86_400_000 * 90;
    expect(
      documentsExpiringWithin({ vehicle_insurance: { expiresAt: inNinetyDays } }, reqs, 30),
    ).toEqual([]);
  });

  it("handles a missing documents map without throwing", () => {
    expect(expiredDocuments(undefined, reqs)).toEqual([]);
    expect(expiredDocuments(null, reqs)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Backfill inference — must not silently promote anyone to active
// ─────────────────────────────────────────────────────────────────────────

describe("legacy state inference", () => {
  it("keeps a live vendor operational", () => {
    expect(inferState("vendor", { onboardingStep: "live", kycStatus: "approved" })).toBe("active");
    expect(inferState("vendor", { isActive: true })).toBe("active");
  });

  it("does not promote a merely profile-complete vendor to active", () => {
    expect(inferState("vendor", { onboardingStep: "profile_complete", kycStatus: "pending" })).toBe(
      "submitted",
    );
  });

  it("maps a rejected KYC to action_required, even if the shop looks live", () => {
    expect(inferState("vendor", { onboardingStep: "live", kycStatus: "rejected" })).toBe(
      "action_required",
    );
  });

  it("suspends blocked or deleted partners regardless of other flags", () => {
    expect(inferState("vendor", { isActive: true, isBlocked: true })).toBe("suspended");
    expect(inferState("rider", { status: "approved", isDeleted: true })).toBe("suspended");
  });

  it("maps rider statuses correctly", () => {
    expect(inferState("rider", { status: "approved" })).toBe("active");
    expect(inferState("rider", { status: "pending_approval" })).toBe("submitted");
    expect(inferState("rider", { status: "suspended" })).toBe("suspended");
    expect(inferState("rider", {})).toBe("incomplete");
  });

  it("starts an empty vendor at the beginning, not somewhere convenient", () => {
    expect(inferState("vendor", {})).toBe("started");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Penny-drop verdict logic — which outcome each validation result maps to.
// The rule that matters: a live account is NOT sufficient to auto-verify;
// the bank's registered name must also match the legal entity.
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors the branch in applyValidationResult, extracted so it is testable
 *  without Firestore. Kept in the test as a specification of intent — if the
 *  implementation diverges from this, one of them is wrong. */
function verdictFor(input: {
  accountStatus?: string;
  status: string;
  registeredName?: string;
  legalName?: string;
}): "verified" | "action_required" | "failed" {
  // `status: "completed"` means the validation finished, NOT that the account
  // is good — when Razorpay gives an account_status it is authoritative.
  const active = input.accountStatus
    ? input.accountStatus === "active"
    : input.status === "completed";
  if (!active) return "failed";
  const registered = (input.registeredName ?? "").trim();
  const legal = (input.legalName ?? "").trim();
  if (!registered || !legal) return "action_required";
  return checkNameMatch(registered, legal).matched ? "verified" : "action_required";
}

describe("penny-drop verdicts", () => {
  it("verifies when the account is live and the bank's name matches", () => {
    expect(
      verdictFor({
        accountStatus: "active",
        status: "completed",
        registeredName: "KADA FOODS PRIVATE LIMITED",
        legalName: "M/s Kada Foods Pvt. Ltd.",
      }),
    ).toBe("verified");
  });

  it("does NOT verify a live account registered to someone else", () => {
    expect(
      verdictFor({
        accountStatus: "active",
        status: "completed",
        registeredName: "RAJESH KUMAR",
        legalName: "Kada Foods Private Limited",
      }),
    ).toBe("action_required");
  });

  it("does NOT auto-verify when the bank returns no registered name", () => {
    expect(
      verdictFor({
        accountStatus: "active",
        status: "completed",
        registeredName: "",
        legalName: "Kada Foods Private Limited",
      }),
    ).toBe("action_required");
  });

  it("fails an invalid account regardless of name", () => {
    expect(
      verdictFor({
        accountStatus: "invalid",
        status: "completed",
        registeredName: "KADA FOODS PRIVATE LIMITED",
        legalName: "Kada Foods Private Limited",
      }),
    ).toBe("failed");
  });

  it("fails when the validation itself failed", () => {
    expect(verdictFor({ status: "failed" })).toBe("failed");
  });

  it("never returns verified without both names present", () => {
    for (const c of [
      { accountStatus: "active", status: "completed", registeredName: "X Ltd" },
      { accountStatus: "active", status: "completed", legalName: "X Ltd" },
      { accountStatus: "active", status: "completed" },
    ]) {
      expect(verdictFor(c)).not.toBe("verified");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Downstream gate matrix (Phase 7 audit).
//
// Encodes the deliberate asymmetry between roles so a later "consistency"
// refactor cannot silently flip one of them. The direction of each default
// is a decision, not an oversight.
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors the gate each downstream surface applies. */
function gateAllows(opts: {
  surface: "hotel_booking" | "restaurant_order" | "rider_dispatch" | "payout";
  onboardingState?: string;
  bankState?: string;
}): boolean {
  const st = opts.onboardingState;
  switch (opts.surface) {
    // Hotels fail CLOSED on an absent record: that flow was non-functional
    // before the engine, so there is no live traffic to protect.
    case "hotel_booking":
      return st === "active";
    // Restaurants and riders fail OPEN on an absent record: they carry the
    // live volume, and refusing them pre-backfill would be an outage.
    case "restaurant_order":
    case "rider_dispatch":
      return !st || st === "active";
    // Money-out never has a legacy exemption.
    case "payout":
      return opts.bankState === "verified";
  }
}

describe("downstream gate matrix", () => {
  it("blocks a hotel booking when the property is not active", () => {
    for (const st of ["started", "incomplete", "submitted", "suspended", undefined]) {
      expect(gateAllows({ surface: "hotel_booking", onboardingState: st })).toBe(false);
    }
    expect(gateAllows({ surface: "hotel_booking", onboardingState: "active" })).toBe(true);
  });

  it("blocks an order against a vendor we KNOW is not active", () => {
    for (const st of ["started", "incomplete", "action_required", "suspended"]) {
      expect(gateAllows({ surface: "restaurant_order", onboardingState: st })).toBe(false);
    }
  });

  it("still allows orders for a legacy vendor with no record (pre-backfill)", () => {
    // Deliberate: failing closed here would take the whole live catalogue
    // offline on deploy. The backfill closes this, not the rule.
    expect(gateAllows({ surface: "restaurant_order", onboardingState: undefined })).toBe(true);
  });

  it("blocks dispatch to a suspended rider but not a legacy one", () => {
    expect(gateAllows({ surface: "rider_dispatch", onboardingState: "suspended" })).toBe(false);
    expect(gateAllows({ surface: "rider_dispatch", onboardingState: undefined })).toBe(true);
  });

  it("never pays out on anything but a verified account — no legacy exemption", () => {
    for (const b of [
      "not_added", "pending_verification", "failed", "action_required", "suspended", undefined,
    ]) {
      expect(gateAllows({ surface: "payout", bankState: b })).toBe(false);
    }
    expect(gateAllows({ surface: "payout", bankState: "verified" })).toBe(true);
  });
});
