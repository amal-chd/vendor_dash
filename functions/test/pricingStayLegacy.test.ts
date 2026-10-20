import { describe, it, expect } from "vitest";
import { quoteStay, type StayQuoteInput } from "../src/pricing/stay";
import { legacyFoodRules, legacyHostRules, legacyStayRules } from "../src/pricing/legacy";

const AT = Date.UTC(2026, 8, 14, 7, 0);

// The global "legacy_untaxed" category lives with the food adapter; the live
// ruleset always carries both.
const base = legacyFoodRules({
  economics: { deliveryBaseFee: 0, deliveryPerKm: 0, freeDeliveryUnderKm: 0, freeDeliveryAbove: 0, platformFee: 0, riderBaseFee: 0, riderPerKm: 0 },
  zones: [],
  manualSurge: null,
  defaultCommissionPercent: 10,
  promos: [],
}).filter((r) => r.kind === "tax_category");

const liveStay = legacyStayRules({ serviceFeeBps: 1200, defaultCleaningRupees: 450, defaultCommissionPercent: 15 });

function input(over: Partial<StayQuoteInput["room"]> = {}): StayQuoteInput {
  return {
    at: AT,
    property: { id: "h1", hostId: "h1", name: "Munnar Hills", stateCode: "32", gstin: null, zoneId: null },
    room: { id: "r1", name: "Deluxe", baseNightlyPaise: 200_000, maxGuests: 2, includedGuests: 2, extraGuestNightlyPaise: null, cleaningFeePaise: null, ...over },
    nightlyOverrides: {},
    checkIn: "2026-10-01",
    checkOut: "2026-10-03",
    guests: 2,
    customer: { uid: "c1", completedStays: 0, isNew: true, stateCode: "32" },
    platform: { gstin: null, stateCode: "32" },
    couponCode: null,
    promoUsage: { total: {}, byCustomer: {} },
    hostCommissionWaived: false,
  };
}

describe("legacy stay adapter reproduces calculatePricing", () => {
  it("2 nights at ₹2,000: ₹450 default cleaning + 12% service fee = ₹4,930", () => {
    const q = quoteStay(input(), [...base, ...liveStay]);
    expect(q.problems).toEqual([]);
    expect(q.roomSubtotalPaise).toBe(400_000);
    expect(q.cleaningFeePaise).toBe(45_000);
    expect(q.serviceFeePaise).toBe(48_000);
    expect(q.totals.taxPaise).toBe(0);
    expect(q.totals.totalPaise).toBe(493_000);
    expect(q.host.netPayoutPaise + q.platformRevenuePaise + q.taxLiability.platformEcoPaise + q.taxLiability.platformOwnPaise).toBe(q.totals.totalPaise);
  });

  it("a room's own cleaning fee replaces the ₹450 default", () => {
    const q = quoteStay(input({ cleaningFeePaise: 30_000 }), [...base, ...liveStay]);
    expect(q.cleaningFeePaise).toBe(30_000);
    expect(q.totals.totalPaise).toBe(478_000);
  });

  it("the property's resolved commission wins over the platform default", () => {
    const q = quoteStay(input(), [...base, ...liveStay, ...legacyHostRules({ id: "h1", commissionPercent: 8 })]);
    expect(q.ruleVersions["legacy-host-commission-h1"]).toBe(1);
    expect(q.ruleVersions["legacy-stay-commission"]).toBeUndefined();
    const defaultQ = quoteStay(input(), [...base, ...liveStay]);
    expect(q.host.netPayoutPaise).toBeGreaterThan(defaultQ.host.netPayoutPaise);
  });

  it("no host commission rule when the property has none resolved", () => {
    expect(legacyHostRules({ id: "h1", commissionPercent: null })).toEqual([]);
  });
});
