import { describe, it, expect } from "vitest";
import { quoteFood, type FoodQuote, type FoodQuoteInput } from "../src/pricing/food";
import type { PricingRule, RuleKind } from "../src/pricing/rules";
import { customerBill, vendorBill, type BillRow } from "../src/pricing/bill";

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


const total = (rows: BillRow[]) => rows.reduce((s, r) => s + r.amountPaise, 0);

/** Both bills exist and add up to the engine's own numbers, to the paisa. */
function bills(q: FoodQuote) {
  const c = customerBill(q);
  const v = vendorBill(q);
  expect(c, "customer bill must add up").not.toBeNull();
  expect(v, "vendor bill must add up").not.toBeNull();
  expect(total(c!.rows)).toBe(q.totals.totalPaise);
  expect(total(v!.rows)).toBe(q.settlement.vendorPayoutPaise);
  for (const row of c!.rows) if (row.children?.length) expect(total(row.children)).toBe(row.amountPaise);
  return { c: c!, v: v! };
}
const row = (rows: BillRow[], key: string) => rows.find((r) => r.key === key);

describe("customer bill", () => {
  it("reads like a delivery app bill: distance, fees, one GST row with its parts", () => {
    const { c } = bills(quoteFood(input(), baseRules()));
    expect(c.rows.map((r) => r.key)).toEqual(["items", "delivery", "platform_fee", "gst_charges"]);
    expect(row(c.rows, "delivery")!.note).toBe("5.0 km");
    const gst = row(c.rows, "gst_charges")!;
    expect(gst.label).toBe("GST & restaurant charges");
    expect(gst.children!.map((x) => x.key)).toEqual(["packaging", "gst_food", "gst_packaging", "gst_delivery", "gst_platform"]);
    expect(gst.children!.find((x) => x.key === "gst_food")!.label).toBe("GST on food (5%)");
    expect(gst.children!.find((x) => x.key === "gst_platform")!.label).toBe("GST on platform fee (18%)");
    expect(c.savingsPaise).toBe(0);
    // Never exposes anyone's share.
    expect(JSON.stringify(c)).not.toMatch(/commission|payout|rider/i);
  });

  it("names the coupon and shows free delivery struck through, and counts the savings", () => {
    const rules = [
      ...baseRules(),
      r("promotion", { code: "SAVE20", type: "percent", bps: 2000, maxDiscountPaise: 10_000, stackable: true }),
      r("promotion", { type: "free_delivery", fundedBy: "vendor", stackable: true }),
    ];
    const q = quoteFood(input({ couponCode: "save20" }), rules);
    const { c } = bills(q);
    const coupon = c.rows.find((x) => x.label === "Coupon · SAVE20")!;
    expect(coupon.amountPaise).toBeLessThan(0);
    // Vendor-funded free delivery isn't a customer charge at all.
    const delivery = row(c.rows, "delivery")!;
    expect(delivery.free).toBe(true);
    expect(delivery.originalPaise).toBeGreaterThan(0);
    // Saved = the coupon plus the delivery fee that was waived.
    expect(c.savingsPaise).toBe(-coupon.amountPaise + delivery.originalPaise!);
  });

  it("says prices include GST and adds no food GST for a tax-inclusive menu", () => {
    const { c } = bills(quoteFood(input({ vendor: { ...input().vendor, pricesIncludeTax: true } }), baseRules()));
    expect(row(c.rows, "items")!.note).toBe("Prices include GST");
    expect(row(c.rows, "gst_charges")!.children!.some((x) => x.key === "gst_food")).toBe(false);
  });

  it("explains surge and tells the customer how much more removes the small-cart fee", () => {
    const rules = [
      ...baseRules().filter((x) => x.kind !== "platform_fee"),
      r("surge", { multiplierBps: 12_500, maxMultiplierBps: 15_000, maxAddPaise: 1_000 }),
      r("small_order_fee", { belowPaise: 15_000, amountPaise: 2_000 }),
    ];
    const q = quoteFood(input({ lines: [{ lineId: "l1", menuItemId: "tea", name: "Tea", categoryId: "drinks", qty: 1, unitPaise: 4_000, modifiers: [] }] }), rules);
    const { c } = bills(q);
    expect(row(c.rows, "surge")!.info).toBeTruthy();
    expect(row(c.rows, "small_order_fee")!.note).toBe("Add ₹110 more to remove");
  });

  it("shows no delivery fee for pickup, and keeps tip, donation and rounding", () => {
    const pickup = bills(quoteFood(input({ fulfilment: "pickup" }), baseRules())).c;
    expect(row(pickup.rows, "delivery")).toBeUndefined();
    const extras = bills(quoteFood(input({ tipPaise: 3_000, donationPaise: 100 }), [...baseRules(), r("rounding", { finalStepPaise: 100 })])).c;
    expect(row(extras.rows, "tip")!.amountPaise).toBe(3_000);
    expect(row(extras.rows, "donation")!.amountPaise).toBe(100);
  });

  it("uses IGST labels unchanged for an out-of-state customer and still adds up", () => {
    bills(quoteFood(input({ customer: { ...input().customer, stateCode: "29" } }), baseRules()));
  });

  it("refuses to produce a bill that doesn't add up", () => {
    const q = quoteFood(input(), baseRules());
    const broken = { ...q, totals: { ...q.totals, totalPaise: q.totals.totalPaise + 1 } };
    expect(customerBill(broken)).toBeNull();
  });
});

describe("restaurant payout statement", () => {
  it("shows food value, packaging, GST, commission at its rate and GST on it", () => {
    const { v } = bills(quoteFood(input(), baseRules()));
    expect(v.rows.map((x) => x.key)).toEqual(["food", "packaging", "commission", "commission_gst"]);
    expect(row(v.rows, "commission")!.label).toBe("Kada commission (20%)");
    expect(row(v.rows, "commission_gst")!.label).toBe("GST on commission (18%)");
  });

  it("shows free delivery the restaurant funded as a deduction", () => {
    const rules = [...baseRules(), r("promotion", { type: "free_delivery", fundedBy: "vendor", stackable: true })];
    const { v } = bills(quoteFood(input(), rules));
    expect(v.rows.some((x) => x.amountPaise < 0 && /delivery|waived/i.test(x.label))).toBe(true);
  });

  it("marks commission waived for a subscription merchant", () => {
    const { v } = bills(quoteFood(input({ vendor: { ...input().vendor, commissionWaived: true } }), baseRules()));
    expect(row(v.rows, "commission")!.free).toBe(true);
    expect(row(v.rows, "commission_gst")).toBeUndefined();
  });
});
