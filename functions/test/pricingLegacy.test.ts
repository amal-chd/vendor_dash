import { describe, it, expect } from "vitest";
import { legacyFoodRules, legacyVendorRules, type LegacyInputs } from "../src/pricing/legacy";
import { quoteFood, type FoodQuoteInput } from "../src/pricing/food";
import { stateCodeOf } from "../src/pricing/states";
import type { PricingRule } from "../src/pricing/rules";

// Monday 2026-09-14 at 12:30 IST (lunch peak) and 16:00 IST (no peak).
const LUNCH = Date.UTC(2026, 8, 14, 7, 0);
const AFTERNOON = Date.UTC(2026, 8, 14, 10, 30);

const legacy: LegacyInputs = {
  economics: { deliveryBaseFee: 25, deliveryPerKm: 7, freeDeliveryUnderKm: 3, freeDeliveryAbove: 0, platformFee: 5, riderBaseFee: 20, riderPerKm: 8 },
  zones: [{ id: "kochi", economics: { deliveryBaseFee: 30, deliveryPerKm: 8, freeDeliveryUnderKm: 2, freeDeliveryAbove: 999, platformFee: 3 }, surgeMultiplier: 1.4 }],
  manualSurge: null,
  defaultCommissionPercent: 10,
  promos: [
    { code: "KADA50", percent: 50, maxOff: 100, minSubtotal: 149, expiresAtMs: null },
    { code: "FLAT75", percent: 100, maxOff: 75, minSubtotal: 299, expiresAtMs: null },
  ],
};

function input(over: Partial<FoodQuoteInput> = {}): FoodQuoteInput {
  return {
    at: AFTERNOON,
    customer: { uid: "c1", completedOrders: 2, isNew: false, isGold: false, stateCode: "32" },
    vendor: { id: "v1", name: "Paragon", stateCode: "32", gstin: null, pricesIncludeTax: false, packagingPaise: null, commissionWaived: false },
    platform: { gstin: null, stateCode: "32" },
    fulfilment: "delivery",
    zoneId: null,
    distanceKm: 5,
    demand: null,
    weatherAlert: false,
    minOrderPaise: null,
    lines: [{ lineId: "l1", menuItemId: "biryani", name: "Biryani", categoryId: "biryani", qty: 2, unitPaise: 20_000, modifiers: [] }],
    couponCode: null,
    tipPaise: 0,
    donationPaise: 0,
    promoUsage: { total: {}, byCustomer: {} },
    ...over,
  };
}

const vendor = legacyVendorRules({ id: "v1", enableTax: true, taxPercentage: 5, taxMethod: "exclusive", commissionPercent: null });
const rulesFor = (inp: LegacyInputs = legacy, v: PricingRule[] = vendor) => [...legacyFoodRules(inp), ...v];

describe("the legacy adapter reproduces today's pricing", () => {
  it("charges the config delivery fee: free under 3 km, then base + per km", () => {
    expect(quoteFood(input(), rulesFor()).totals.deliveryPaise).toBe(2_500 + 2 * 700);
    expect(quoteFood(input({ distanceKm: 2.5 }), rulesFor()).totals.deliveryPaise).toBe(0);
  });

  it("adds the IST peak surge only in its window, and the zone multiplier on top", () => {
    expect(quoteFood(input(), rulesFor()).totals.surgePaise).toBe(0);
    expect(quoteFood(input({ at: LUNCH }), rulesFor()).totals.surgePaise).toBe(1_500);
    expect(quoteFood(input({ at: LUNCH, zoneId: "kochi" }), rulesFor()).totals.surgePaise).toBe(2_100);
  });

  it("lets a manual surge override the peak surge", () => {
    const manual = { ...legacy, manualSurge: { active: true, feeRupees: 40 } };
    expect(quoteFood(input({ at: LUNCH }), rulesFor(manual)).totals.surgePaise).toBe(4_000);
  });

  it("uses zone economics where a zone is configured", () => {
    const q = quoteFood(input({ zoneId: "kochi" }), rulesFor());
    expect(q.totals.deliveryPaise).toBe(3_000 + 3 * 800);
    expect(q.totals.platformFeePaise).toBe(300);
  });

  it("gives Gold members free delivery and no surge", () => {
    const q = quoteFood(input({ at: LUNCH, customer: { ...input().customer, isGold: true } }), rulesFor());
    expect(q.totals.deliveryPaise + q.totals.surgePaise).toBe(0);
  });

  it("applies the restaurant's own tax and leaves fees untaxed without warnings", () => {
    const q = quoteFood(input(), rulesFor());
    expect(q.totals.taxPaise).toBe(2_000); // 5% of ₹400
    expect(q.warnings).toEqual([]);
    expect(q.charges.find((c) => c.key === "platform_fee")?.tax?.total).toBe(0);
  });

  it("honours the compiled coupons, including flat ones", () => {
    expect(quoteFood(input({ couponCode: "KADA50" }), rulesFor()).totals.cartDiscountPaise).toBe(10_000);
    expect(quoteFood(input({ couponCode: "FLAT75" }), rulesFor()).totals.cartDiscountPaise).toBe(7_500);
  });

  it("takes the merchant's own commission over the default", () => {
    expect(quoteFood(input(), rulesFor()).settlement.commissionPaise).toBe(4_000);
    const negotiated = legacyVendorRules({ id: "v1", enableTax: false, taxPercentage: 0, taxMethod: "exclusive", commissionPercent: 7.5 });
    expect(quoteFood(input(), rulesFor(legacy, negotiated)).settlement.commissionPaise).toBe(3_000);
  });

  it("is overridden automatically by a published rule", () => {
    const published: PricingRule = {
      ruleId: "platform-fee-2026", version: 1, kind: "platform_fee", name: "Platform fee",
      active: true, priority: 0, effectiveFrom: 0, effectiveUntil: null, scope: { product: "food" },
      params: { mode: "fixed", amountPaise: 900 },
    };
    expect(quoteFood(input(), [...rulesFor(), published]).totals.platformFeePaise).toBe(900);
  });
});

describe("state codes", () => {
  it("resolves names, codes and GSTINs", () => {
    expect(stateCodeOf("Kerala")).toBe("32");
    expect(stateCodeOf(" tamil nadu ")).toBe("33");
    expect(stateCodeOf("NCT of Delhi")).toBe("07");
    expect(stateCodeOf("Orissa")).toBe("21");
    expect(stateCodeOf("32ABCDE1234F1Z5")).toBe("32");
    expect(stateCodeOf("7")).toBe("07");
    expect(stateCodeOf("682001")).toBe("");
    expect(stateCodeOf("Atlantis")).toBe("");
  });
});

describe("legacy adapter: Kada Gold discount and express delivery (CheckoutController parity)", () => {
  const gold = { uid: "c1", completedOrders: 2, isNew: false, isGold: true, stateCode: "32" };
  const untaxed = (goldDiscountPercent = 0) =>
    legacyVendorRules({ id: "v1", enableTax: false, taxPercentage: 0, taxMethod: "exclusive", commissionPercent: null, goldDiscountPercent });
  const tenBiryani = [{ lineId: "l1", menuItemId: "biryani", name: "Biryani", categoryId: "biryani", qty: 10, unitPaise: 20_000, modifiers: [] }];

  it("Gold members get 10% off the food subtotal, capped at ₹100", () => {
    expect(quoteFood(input({ customer: gold }), rulesFor(legacy, untaxed())).totals.cartDiscountPaise).toBe(4_000);
    expect(quoteFood(input({ customer: gold, lines: tenBiryani }), rulesFor(legacy, untaxed())).totals.cartDiscountPaise).toBe(10_000);
  });

  it("partner restaurants give their own percent, capped at ₹200, and fund it", () => {
    const q = quoteFood(input({ customer: gold }), rulesFor(legacy, untaxed(20)));
    expect(q.totals.cartDiscountPaise).toBe(8_000);
    expect(q.settlement.vendorFundedDiscountPaise).toBe(8_000);
    expect(quoteFood(input({ customer: gold, lines: tenBiryani }), rulesFor(legacy, untaxed(20))).totals.cartDiscountPaise).toBe(20_000);
  });

  it("stacks with a coupon, each taken on the undiscounted subtotal like the app", () => {
    // KADA50: 50% of ₹400 capped at ₹100, plus Gold 10% of ₹400 = ₹140 off.
    const q = quoteFood(input({ customer: gold, couponCode: "KADA50" }), rulesFor(legacy, untaxed()));
    expect(q.couponProblem).toBeNull();
    expect(q.totals.cartDiscountPaise).toBe(14_000);
  });

  it("non-members don't get the Gold discount", () => {
    expect(quoteFood(input(), rulesFor(legacy, untaxed())).totals.cartDiscountPaise).toBe(0);
  });

  it("express adds ₹19 to delivery, even when Gold makes delivery free", () => {
    // 5 km: ₹25 base + 2 km × ₹7 = ₹39.
    expect(quoteFood(input({ express: true }), rulesFor(legacy, untaxed())).totals.deliveryPaise).toBe(5_800);
    expect(quoteFood(input({ express: true, customer: gold }), rulesFor(legacy, untaxed())).totals.deliveryPaise).toBe(1_900);
    expect(quoteFood(input({ express: true, fulfilment: "pickup" }), rulesFor(legacy, untaxed())).totals.deliveryPaise).toBe(0);
  });
});
