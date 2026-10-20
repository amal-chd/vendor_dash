import { describe, it, expect } from "vitest";
import { legacyFoodRules, legacyVendorRules } from "../src/pricing/legacy";
import { quoteFood, type FoodQuoteInput } from "../src/pricing/food";
import { planFoodRefund, refundHistoryOf, refundHistoryPatch } from "../src/pricing/refundPlan";

// Monday 2026-09-14, 16:00 IST: no peak surge.
const AT = Date.UTC(2026, 8, 14, 10, 30);

const rules = [
  ...legacyFoodRules({
    economics: { deliveryBaseFee: 25, deliveryPerKm: 7, freeDeliveryUnderKm: 3, freeDeliveryAbove: 0, platformFee: 5, riderBaseFee: 20, riderPerKm: 8 },
    zones: [],
    manualSurge: null,
    defaultCommissionPercent: 10,
    promos: [{ code: "KADA50", percent: 50, maxOff: 100, minSubtotal: 149, expiresAtMs: null }],
  }),
  ...legacyVendorRules({ id: "v1", enableTax: true, taxPercentage: 5, taxMethod: "exclusive", commissionPercent: null }),
];

function quote(over: Partial<FoodQuoteInput> = {}) {
  return quoteFood({
    at: AT,
    customer: { uid: "c1", completedOrders: 2, isNew: false, isGold: false, stateCode: "32" },
    vendor: { id: "v1", name: "Paragon", stateCode: "32", gstin: null, pricesIncludeTax: false, packagingPaise: null, commissionWaived: false },
    platform: { gstin: null, stateCode: "32" },
    fulfilment: "delivery",
    zoneId: null,
    distanceKm: 5,
    demand: null,
    weatherAlert: false,
    minOrderPaise: null,
    lines: [
      { lineId: "l1", menuItemId: "biryani", name: "Chicken Biryani", categoryId: "biryani", qty: 2, unitPaise: 22_000, modifiers: [] },
      { lineId: "l2", menuItemId: "lime", name: "Fresh Lime", categoryId: "drinks", qty: 1, unitPaise: 6_000, modifiers: [] },
    ],
    couponCode: null,
    tipPaise: 3_000,
    donationPaise: 500,
    promoUsage: { total: {}, byCustomer: {} },
    ...over,
  }, rules);
}

describe("refunds from the price snapshot", () => {
  const q = quote();

  it("a full refund returns the total and unwinds every party's share exactly", () => {
    const plan = planFoodRefund(q, { full: true });
    expect(plan.problems).toEqual([]);
    expect(plan.amountPaise).toBe(q.totals.totalPaise);
    expect(plan.tax.totalPaise).toBe(q.totals.taxPaise);
    expect(plan.vendorClawbackPaise).toBe(q.settlement.vendorPayoutPaise);
    expect(plan.commissionReversalPaise).toBe(q.settlement.commissionPaise + (q.settlement.commissionTax?.total ?? 0));
    expect(plan.riderTipPaise).toBe(3_000);
    expect(plan.donationPaise).toBe(500);
    // Kada funds what it earned plus the rider's (non-tip) pay it already owes.
    const s = q.settlement;
    expect(plan.platformCostPaise).toBe(
      s.platformRevenuePaise + (s.rider.totalPaise - s.rider.tipPaise) + (s.commissionTax?.total ?? 0),
    );
  });

  it("refunds one of two biryanis: half that line, with its GST and commission", () => {
    const line = q.lines.find((l) => l.lineId === "l1")!;
    const plan = planFoodRefund(q, { lines: [{ lineId: "l1", qty: 1 }] });
    expect(plan.problems).toEqual([]);
    expect(plan.amountPaise).toBe(Math.floor(line.customerPaysPaise / 2));
    expect(plan.tax.totalPaise).toBe(Math.floor(line.tax!.total / 2));
    expect(plan.tax.cgstPaise + plan.tax.sgstPaise).toBeLessThanOrEqual(plan.tax.totalPaise);
    expect(plan.commissionReversalPaise).toBeGreaterThan(0);
    expect(plan.vendorClawbackPaise).toBeLessThan(plan.amountPaise);
    expect(plan.rows).toEqual([{ key: "line:l1", label: "1 × Chicken Biryani", amountPaise: plan.amountPaise }]);
  });

  it("never refunds the same thing twice", () => {
    const first = planFoodRefund(q, { lines: [{ lineId: "l1", qty: 1 }], charges: ["delivery"], tip: true });
    const order = { refundAmount: first.amountPaise / 100, ...refundHistoryPatch({}, first) };
    const history = refundHistoryOf(order);
    expect(history.lineQty).toEqual({ l1: 1 });

    const again = planFoodRefund(q, { lines: [{ lineId: "l1", qty: 2 }], charges: ["delivery"], tip: true }, history);
    expect(again.problems).toContain("Only 1 of 2 × Chicken Biryani can still be refunded.");
    expect(again.problems).toContain("The delivery has already been refunded.");
    expect(again.problems).toContain("The tip has already been refunded.");

    const rest = planFoodRefund(q, { full: true }, history);
    expect(rest.problems).toEqual([]);
    expect(rest.amountPaise).toBe(q.totals.totalPaise - first.amountPaise);
    expect(rest.lines).toEqual([{ lineId: "l1", qty: 1 }, { lineId: "l2", qty: 1 }]);
    expect(planFoodRefund(q, { full: true }, refundHistoryOf({ refundAmount: q.totals.totalPaise / 100, ...refundHistoryPatch(order, rest) })).problems)
      .toContain("This order has already been fully refunded.");
  });

  it("a coupon discount stays reversed: the refund is what was actually paid", () => {
    const withCoupon = quote({ couponCode: "KADA50" });
    expect(withCoupon.totals.cartDiscountPaise).toBeGreaterThan(0);
    const plan = planFoodRefund(withCoupon, { lines: withCoupon.lines.map((l) => ({ lineId: l.lineId, qty: l.qty })) });
    const itemsPaid = withCoupon.lines.reduce((s, l) => s + l.customerPaysPaise, 0);
    expect(plan.amountPaise).toBe(itemsPaid);
    // Kada funded the coupon, so the restaurant still gives back its full item value.
    expect(plan.vendorClawbackPaise).toBeGreaterThan(plan.amountPaise - plan.tax.platformEcoPaise - plan.tax.platformOwnPaise - itemsPaid);
  });

  it("explains what can't be refunded", () => {
    const pickup = quote({ fulfilment: "pickup", tipPaise: 0, donationPaise: 0 });
    const plan = planFoodRefund(pickup, { charges: ["delivery"], tip: true, lines: [{ lineId: "nope", qty: 1 }] });
    expect(plan.problems).toEqual([
      "One of the selected items isn't on this order.",
      "The customer didn't pay a delivery on this order.",
      "There was no tip on this order.",
    ]);
    expect(planFoodRefund(pickup, {}).problems).toEqual(["Choose what to refund."]);
  });
});
