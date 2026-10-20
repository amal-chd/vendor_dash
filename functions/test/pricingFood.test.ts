import { describe, it, expect } from "vitest";
import { quoteFood, type FoodQuote, type FoodQuoteInput } from "../src/pricing/food";
import type { PricingRule, RuleKind } from "../src/pricing/rules";

// Monday 2026-09-14, 12:30 IST.
const AT = Date.UTC(2026, 8, 14, 7, 0);
const DAY = 86_400_000;

let seq = 0;
function r(kind: RuleKind, params: Record<string, unknown>, over: Partial<PricingRule> = {}): PricingRule {
  seq += 1;
  return {
    ruleId: `${kind.replace(/_/g, "-")}-${seq}`,
    version: 1,
    kind,
    name: `${kind} rule`,
    active: true,
    priority: 0,
    effectiveFrom: AT - DAY,
    effectiveUntil: null,
    scope: { product: "food" },
    params,
    ...over,
  };
}

/** A realistic Kerala setup: food GST under the e-commerce operator, 18% on platform services. */
function baseRules(): PricingRule[] {
  return [
    r("tax_category", { id: "restaurant_food", label: "Restaurant service", rateBps: 500, hsnSac: "996331", liability: "platform_eco" }),
    r("tax_category", { id: "platform_service", label: "Platform service", rateBps: 1800, hsnSac: "998599", liability: "supplier" }),
    r("tax_assignment", { component: "items", taxCategoryId: "restaurant_food", supplier: "vendor" }),
    r("tax_assignment", { component: "packaging", taxCategoryId: "restaurant_food", supplier: "vendor" }),
    r("tax_assignment", { component: "delivery", taxCategoryId: "platform_service", supplier: "platform", placeOfSupply: "customer_state" }),
    r("tax_assignment", { component: "surge", taxCategoryId: "platform_service", supplier: "platform", placeOfSupply: "customer_state" }),
    r("tax_assignment", { component: "platform_fee", taxCategoryId: "platform_service", supplier: "platform", placeOfSupply: "customer_state" }),
    r("tax_assignment", { component: "commission", taxCategoryId: "platform_service", supplier: "platform" }),
    r("packaging", { mode: "per_order", amountPaise: 1000 }),
    r("delivery_fee", { basePaise: 2500, perKmPaise: 700, freeUnderMeters: 0 }),
    r("platform_fee", { mode: "fixed", amountPaise: 1000 }),
    r("commission", { bps: 2000 }),
    r("rider_earning", { basePaise: 2000, perKmPaise: 800 }),
  ];
}

function input(over: Partial<FoodQuoteInput> = {}): FoodQuoteInput {
  return {
    at: AT,
    customer: { uid: "c1", completedOrders: 4, isNew: false, isGold: false, stateCode: "32" },
    vendor: { id: "v1", name: "Paragon", stateCode: "32", gstin: "32ABCDE1234F1Z5", pricesIncludeTax: false, packagingPaise: null, commissionWaived: false },
    platform: { gstin: "32AAACK0000A1Z9", stateCode: "32" },
    fulfilment: "delivery",
    zoneId: "kochi",
    distanceKm: 5,
    demand: null,
    weatherAlert: false,
    minOrderPaise: null,
    lines: [
      { lineId: "l1", menuItemId: "biryani", name: "Chicken Biryani", categoryId: "biryani", qty: 2, unitPaise: 25_000, modifiers: [{ name: "Raita", unitPaise: 3_000 }] },
      { lineId: "l2", menuItemId: "lassi", name: "Lassi", categoryId: "drinks", qty: 1, unitPaise: 9_000, modifiers: [] },
    ],
    couponCode: null,
    tipPaise: 0,
    donationPaise: 0,
    promoUsage: { total: {}, byCustomer: {} },
    ...over,
  };
}

/** Every paisa the customer pays is accounted for exactly once. */
function expectBalanced(q: FoodQuote) {
  const s = q.settlement;
  const accounted =
    s.vendorPayoutPaise + s.rider.totalPaise + s.platformRevenuePaise +
    s.taxLiability.platformEcoPaise + s.taxLiability.platformOwnPaise + q.totals.donationPaise;
  expect(accounted).toBe(q.totals.totalPaise);
  // Components add up to the total too.
  const parts =
    q.lines.reduce((a, l) => a + l.customerPaysPaise, 0) +
    q.charges.reduce((a, c) => a + c.customerPaysPaise, 0) +
    q.totals.tipPaise + q.totals.donationPaise + q.totals.roundingPaise;
  expect(parts).toBe(q.totals.totalPaise);
  // The display ends on the same total.
  expect(q.display[q.display.length - 1].amountPaise).toBe(q.totals.totalPaise);
}

describe("a realistic Kerala delivery order", () => {
  const q = quoteFood(input(), baseRules());

  it("prices items, modifiers, packaging, delivery and platform fee in paise", () => {
    expect(q.problems).toEqual([]);
    expect(q.totals.itemsGrossPaise).toBe(2 * (25_000 + 3_000) + 9_000); // ₹650
    expect(q.totals.packagingPaise).toBe(1_000);
    expect(q.totals.deliveryPaise).toBe(2_500 + 5 * 700); // ₹60
    expect(q.totals.platformFeePaise).toBe(1_000);
  });

  it("taxes each component with its own GST treatment, split CGST/SGST", () => {
    // Food + packaging at 5% on ₹660 = ₹33; delivery + platform fee at 18% on ₹70 = ₹12.60.
    expect(q.totals.taxPaise).toBe(3_300 + 1_260);
    expect(q.totals.cgstPaise + q.totals.sgstPaise).toBe(q.totals.taxPaise);
    expect(q.totals.igstPaise).toBe(0);
    expect(q.totals.totalPaise).toBe(65_000 + 1_000 + 6_000 + 1_000 + 4_560);
    expect(q.taxes.sellerGstin).toBe("32ABCDE1234F1Z5");
  });

  it("settles commission (with its GST), rider pay and vendor payout, balanced to the paisa", () => {
    const s = q.settlement;
    expect(s.commissionPaise).toBe(13_000); // 20% of ₹650
    expect(s.commissionTax?.total).toBe(2_340); // 18% GST on commission
    expect(s.rider.totalPaise).toBe(2_000 + 5 * 800);
    expect(s.taxLiability.platformEcoPaise).toBe(3_300); // food GST collected by the platform
    expect(s.vendorPayoutPaise).toBe(65_000 + 1_000 - 13_000 - 2_340);
    expectBalanced(q);
  });

  it("never shows commission to the customer and records rule versions", () => {
    expect(q.display.map((d) => d.key)).not.toContain("commission");
    expect(Object.keys(q.ruleVersions).length).toBeGreaterThan(8);
  });
});

describe("promotions inside the pipeline", () => {
  it("applies a platform-funded coupon and a vendor-funded free delivery, still balanced", () => {
    const rules = [
      ...baseRules(),
      r("promotion", { code: "SAVE20", type: "percent", bps: 2000, maxDiscountPaise: 10_000, stackable: true }),
      r("promotion", { type: "free_delivery", fundedBy: "vendor", stackable: true }),
    ];
    const q = quoteFood(input({ couponCode: "save20" }), rules);
    expect(q.couponProblem).toBeNull();
    expect(q.totals.cartDiscountPaise).toBe(10_000);
    expect(q.charges.find((c) => c.key === "delivery")?.waivedPaise).toBe(6_000);
    expect(q.totals.deliveryPaise).toBe(0);
    expect(q.settlement.vendorFundedDiscountPaise).toBe(6_000);
    expect(q.settlement.platformFundedDiscountPaise).toBe(10_000);
    expectBalanced(q);
  });

  it("reports a bad coupon without failing the quote", () => {
    const q = quoteFood(input({ couponCode: "NOPE" }), baseRules());
    expect(q.couponProblem).toMatch(/isn't valid/);
    expect(q.problems).toEqual([]);
  });
});

describe("tax variants", () => {
  it("carves GST out of tax-inclusive menu prices without changing what the customer pays for food", () => {
    const q = quoteFood(input({ vendor: { ...input().vendor, pricesIncludeTax: true } }), baseRules());
    const food = q.lines.reduce((a, l) => a + l.customerPaysPaise, 0);
    expect(food).toBe(65_000);
    expect(q.lines.every((l) => l.tax?.inclusive)).toBe(true);
    expectBalanced(q);
  });

  it("charges IGST on platform services for a customer in another state", () => {
    const q = quoteFood(input({ customer: { ...input().customer, stateCode: "29" } }), baseRules());
    const fee = q.charges.find((c) => c.key === "platform_fee")!;
    expect(fee.tax?.igst).toBe(180);
    expect(fee.tax?.cgst).toBe(0);
    // Restaurant service is still intra-state (supplier's state).
    expect(q.lines[0].tax?.igst).toBe(0);
    expectBalanced(q);
  });

  it("warns instead of silently taxing a component nobody configured", () => {
    const rules = baseRules().filter((x) => !(x.kind === "tax_assignment" && (x.params as { component: string }).component === "packaging"));
    expect(quoteFood(input(), rules).warnings.join(" ")).toMatch(/packaging/);
  });
});

describe("surge is always capped", () => {
  it("adds multiplier-based surge on the delivery base, capped at the maximum amount", () => {
    const rules = [...baseRules(), r("surge", { multiplierBps: 12_500, maxMultiplierBps: 15_000, maxAddPaise: 1_000 })];
    const q = quoteFood(input(), rules);
    expect(q.totals.surgePaise).toBe(1_000); // 25% of ₹60 = ₹15, capped at ₹10
    expect(q.settlement.rider.surgeSharePaise).toBe(1_000);
    expectBalanced(q);
  });

  it("raises the multiplier from demand but never past its cap", () => {
    const rules = [
      ...baseRules(),
      r("surge", { maxMultiplierBps: 13_000, maxAddPaise: 5_000, demandTiers: [{ minOrdersPerRiderX100: 300, multiplierBps: 20_000 }] }),
    ];
    const q = quoteFood(input({ demand: { activeOrders: 40, availableRiders: 10 } }), rules);
    expect(q.totals.surgePaise).toBe(1_800); // capped at 1.3× of ₹60
  });
});

describe("fees", () => {
  it("uses a tiered platform fee with limits and a small-order fee", () => {
    const rules = [
      ...baseRules().filter((x) => x.kind !== "platform_fee"),
      r("platform_fee", { mode: "tiered", tiers: [{ upToPaise: 20_000, amountPaise: 500 }, { upToPaise: null, bps: 200 }], minPaise: 500, maxPaise: 2_500 }),
      r("small_order_fee", { belowPaise: 15_000, amountPaise: 2_000 }),
    ];
    const small = quoteFood(input({ lines: [{ lineId: "l1", menuItemId: "tea", name: "Tea", categoryId: "drinks", qty: 1, unitPaise: 4_000, modifiers: [] }] }), rules);
    expect(small.totals.platformFeePaise).toBe(500);
    expect(small.totals.smallOrderFeePaise).toBe(2_000);
    const big = quoteFood(input(), rules);
    expect(big.totals.platformFeePaise).toBe(1_300); // 2% of ₹650
    expect(big.totals.smallOrderFeePaise).toBe(0);
    expectBalanced(big);
  });

  it("takes a percentage fee's basis from its position relative to the cart discount", () => {
    const promoRule = r("promotion", { type: "fixed", amountPaise: 15_000 });
    const pct = r("platform_fee", { mode: "percent", bps: 1000 });
    const withoutFee = baseRules().filter((x) => x.kind !== "platform_fee");
    const after = quoteFood(input(), [...withoutFee, promoRule, pct]);
    expect(after.totals.platformFeePaise).toBe(5_000); // 10% of ₹500
    const reordered = r("pipeline", {
      steps: ["items", "modifiers", "item_discounts", "platform_fee", "cart_discounts", "packaging", "delivery", "surge", "small_order_fee", "taxes", "rounding"],
    });
    const before = quoteFood(input(), [...withoutFee, promoRule, pct, reordered]);
    expect(before.totals.platformFeePaise).toBe(6_500); // 10% of ₹650
    expectBalanced(before);
  });

  it("uses item-level and vendor packaging when the rule allows it", () => {
    const rules = [...baseRules().filter((x) => x.kind !== "packaging"), r("packaging", { mode: "per_order", amountPaise: 1_000, useVendorDefault: true, vendorMaxPaise: 2_000 })];
    const q = quoteFood(input({ vendor: { ...input().vendor, packagingPaise: 5_000 } }), rules);
    expect(q.totals.packagingPaise).toBe(2_000);
  });
});

describe("fulfilment, rounding, history and blocks", () => {
  it("charges no delivery, surge or rider for pickup", () => {
    const q = quoteFood(input({ fulfilment: "pickup" }), [...baseRules(), r("surge", { multiplierBps: 15_000, maxMultiplierBps: 15_000, maxAddPaise: 5_000 })]);
    expect(q.totals.deliveryPaise + q.totals.surgePaise).toBe(0);
    expect(q.settlement.rider.totalPaise).toBe(0);
    expectBalanced(q);
  });

  it("rounds the final total to the rupee and keeps the books balanced", () => {
    const q = quoteFood(input({ tipPaise: 3_000, donationPaise: 100 }), [...baseRules(), r("rounding", { finalStepPaise: 100 })]);
    expect(q.totals.totalPaise % 100).toBe(0);
    expect(q.totals.roundingPaise).not.toBe(0);
    expect(q.settlement.rider.tipPaise).toBe(3_000);
    expectBalanced(q);
  });

  it("prices a historical moment with the rule version that was live then", () => {
    const v1 = r("platform_fee", { mode: "fixed", amountPaise: 1_000 }, { ruleId: "fee", version: 1, effectiveUntil: AT });
    const v2 = r("platform_fee", { mode: "fixed", amountPaise: 2_500 }, { ruleId: "fee", version: 2, effectiveFrom: AT });
    const rules = [...baseRules().filter((x) => x.kind !== "platform_fee"), v1, v2];
    expect(quoteFood(input({ at: AT - 1 }), rules).totals.platformFeePaise).toBe(1_000);
    const now = quoteFood(input(), rules);
    expect(now.totals.platformFeePaise).toBe(2_500);
    expect(now.ruleVersions.fee).toBe(2);
  });

  it("charges a subscription merchant no commission", () => {
    const q = quoteFood(input({ vendor: { ...input().vendor, commissionWaived: true } }), baseRules());
    expect(q.settlement.commissionPaise).toBe(0);
    expectBalanced(q);
  });

  it("blocks an order below the minimum or with a bad quantity", () => {
    expect(quoteFood(input({ minOrderPaise: 100_000 }), baseRules()).problems.join(" ")).toMatch(/minimum order/);
    const bad = input({ lines: [{ lineId: "x", menuItemId: "x", name: "Dosa", categoryId: "c", qty: 0, unitPaise: 100, modifiers: [] }] });
    expect(quoteFood(bad, baseRules()).problems.join(" ")).toMatch(/quantity/);
  });
});
