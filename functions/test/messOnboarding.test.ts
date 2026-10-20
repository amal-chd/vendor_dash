import { describe, it, expect } from "vitest";
import { PARTNER_ROLES, ROLE_COLLECTION } from "../src/onboarding/stateMachine";
import { resolveRequirements, missingMandatorySteps } from "../src/onboarding/kycRules";
import { ownerUidsOf, planPartnerSeal } from "../src/onboarding/partnerPrivate";

// ─────────────────────────────────────────────────────────────────────────
// Kada Mess — a separate partner type that signs in through Kada Dine
// ─────────────────────────────────────────────────────────────────────────

const ids = (ctx: Parameters<typeof resolveRequirements>[1]) =>
  resolveRequirements("mess", ctx).map((r) => r.id);

describe("Kada Mess partner role", () => {
  it("is its own role, backed by mess_kitchens", () => {
    expect(PARTNER_ROLES).toContain("mess");
    expect(ROLE_COLLECTION.mess).toBe("mess_kitchens");
    // Distinct collections per role: a kitchen can never be read or activated
    // through the restaurant record.
    expect(new Set(Object.values(ROLE_COLLECTION)).size).toBe(PARTNER_ROLES.length);
  });

  it("always requires FSSAI with expiry tracking, even if food is declared off", () => {
    const fssai = resolveRequirements("mess", { businessStructure: "sole_proprietor", servesFood: false })
      .find((r) => r.id === "fssai");
    expect(fssai).toMatchObject({ mandatory: true, requiresDocument: true, tracksExpiry: true });
  });

  it("asks for a weekly menu and meal cut-offs, not a restaurant menu, hours or POS", () => {
    const got = ids({ businessStructure: "sole_proprietor" });
    expect(got).toEqual(expect.arrayContaining(["kitchen_details", "kitchen_photos", "meal_times", "weekly_menu"]));
    for (const restaurantOnly of ["menu", "operating_hours", "pos_billing", "shop_details"]) {
      expect(got).not.toContain(restaurantOnly);
    }
  });

  it("owes PAN, location, banking and the agreement — lean, like a restaurant", () => {
    expect(ids({ businessStructure: "private_limited" })).toEqual(expect.arrayContaining([
      "pan", "map_location", "bank_account", "agreement",
    ]));
    for (const gone of ["owner_pan", "owner_address", "business_pan", "proof_coi", "zone_assignment", "bank_verification"]) {
      expect(ids({ businessStructure: "private_limited" })).not.toContain(gone);
    }
  });

  it("never asks a kitchen for vehicle documents", () => {
    const got = ids({ businessStructure: "sole_proprietor", vehicleType: "bike" });
    for (const riderOnly of ["driving_licence", "vehicle_rc", "vehicle_insurance", "vehicle_puc", "training"]) {
      expect(got).not.toContain(riderOnly);
    }
  });

  it("only asks for a GST certificate when the kitchen is GST registered", () => {
    expect(ids({ businessStructure: "sole_proprietor", gstRegistered: false })).not.toContain("gst_certificate");
    expect(ids({ businessStructure: "sole_proprietor", gstRegistered: true })).toContain("gst_certificate");
  });

  it("cannot be activated on the account step alone", () => {
    const reqs = resolveRequirements("mess", { businessStructure: "sole_proprietor" });
    const missing = missingMandatorySteps(reqs, { account: true }).map((r) => r.id);
    expect(missing).not.toContain("account");
    expect(missing).toEqual(expect.arrayContaining(["fssai", "bank_account", "weekly_menu", "agreement"]));
  });

  it("lets only the kitchen's own login read its private record", () => {
    expect(ownerUidsOf("mess", "k1", { ownerId: "someone-else", parentId: "x" })).toEqual(["k1"]);
  });

  it("moves owner email and bank details off the public kitchen doc", () => {
    const plan = planPartnerSeal("mess", {
      name: "Amma's Mess",
      ownerEmail: "owner@example.in",
      bank: { accountNumber: "123456789012", ifsc: "SBIN0001234", holderName: "Amma Foods" },
    });
    expect(plan.needed).toBe(true);
    expect(plan.contactPatch.ownerEmail).toBe("owner@example.in");
    expect(JSON.stringify(plan.publicSet)).not.toContain("123456789012");
    expect([...plan.moved, ...plan.publicDelete].join(" ")).toContain("bank");
  });
});
