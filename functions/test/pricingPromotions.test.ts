import { describe, it, expect } from "vitest";
import { resolvePromotions, type PromoContext, type PromotionParams } from "../src/pricing/promotions";
import type { PricingRule } from "../src/pricing/rules";

const AT = Date.UTC(2026, 8, 14, 7, 0);

function promo(ruleId: string, params: PromotionParams, over: Partial<PricingRule<PromotionParams>> = {}): PricingRule<PromotionParams> {
  return {
    ruleId,
    version: 1,
    kind: "promotion",
    name: ruleId,
    active: true,
    priority: 0,
    effectiveFrom: AT - 86_400_000,
    effectiveUntil: null,
    scope: { product: "food" },
    params,
    ...over,
  };
}

function ctx(over: Partial<PromoContext> = {}): PromoContext {
  return {
    scope: { product: "food", at: AT, zoneId: "kochi", vendorId: "v1", categoryIds: ["biryani", "drinks"], orderPaise: 60_000 },
    customer: { completedOrders: 3, isNew: false },
    couponCode: null,
    usage: { total: {}, byCustomer: {} },
    lines: [
      { lineId: "l1", menuItemId: "biryani", categoryId: "biryani", netPaise: 40_000 },
      { lineId: "l2", menuItemId: "lassi", categoryId: "drinks", netPaise: 20_000 },
    ],
    deliveryPaise: 4_000,
    fees: { platform_fee: 1_000, packaging: 2_000 },
    ...over,
  };
}

describe("coupons", () => {
  const save = promo("save20", { code: "SAVE20", type: "percent", bps: 2000, maxDiscountPaise: 10_000, minCartPaise: 30_000 });

  it("applies a valid coupon with its cap, spread across lines exactly", () => {
    const r = resolvePromotions([save], ctx({ couponCode: "save20" }));
    expect(r.couponProblem).toBeNull();
    expect(r.applied[0].itemDiscountPaise).toBe(10_000); // 20% of ₹600 = ₹120, capped at ₹100
    const alloc = r.applied[0].lineAllocations;
    expect(alloc.l1 + alloc.l2).toBe(10_000);
  });

  it("explains why a coupon can't be used", () => {
    expect(resolvePromotions([save], ctx({ couponCode: "NOPE" })).couponProblem).toMatch(/isn't valid/);
    const expired = promo("old", { code: "OLD", type: "fixed", amountPaise: 5000 }, { effectiveUntil: AT - 1 });
    expect(resolvePromotions([expired], ctx({ couponCode: "OLD" })).couponProblem).toMatch(/expired/);
    const small = ctx({ couponCode: "SAVE20", lines: [{ lineId: "l1", menuItemId: "x", categoryId: "c", netPaise: 25_000 }] });
    expect(resolvePromotions([save], small).couponProblem).toMatch(/Add ₹50 more/);
    const elsewhere = promo("kochionly", { code: "KOCHI", type: "fixed", amountPaise: 5000 }, { scope: { zoneIds: ["tvm"] } });
    expect(resolvePromotions([elsewhere], ctx({ couponCode: "KOCHI" })).couponProblem).toMatch(/this restaurant, area or time/);
  });

  it("enforces first-order and per-customer limits", () => {
    const welcome = promo("welcome", { code: "WELCOME", type: "fixed", amountPaise: 5000, firstOrderOnly: true });
    expect(resolvePromotions([welcome], ctx({ couponCode: "WELCOME" })).couponProblem).toMatch(/first order/);
    const once = promo("once", { code: "ONCE", type: "fixed", amountPaise: 5000, perCustomerLimit: 1 });
    expect(resolvePromotions([once], ctx({ couponCode: "ONCE", usage: { total: {}, byCustomer: { once: 1 } } })).couponProblem).toMatch(/maximum number of times/);
  });
});

describe("automatic promotions and stacking", () => {
  it("never stacks unless both offers allow it; picks the better one", () => {
    const a = promo("flat50", { type: "fixed", amountPaise: 5000 });
    const b = promo("ten", { type: "percent", bps: 1000, maxDiscountPaise: 20_000 });
    const r = resolvePromotions([a, b], ctx());
    expect(r.applied.map((x) => x.ruleId)).toEqual(["ten"]); // ₹60 beats ₹50
  });

  it("stacks stackable offers but not two from the same group", () => {
    const a = promo("dlv", { type: "free_delivery", stackable: true, stackGroup: "delivery" });
    const b = promo("dlv2", { type: "free_delivery", stackable: true, stackGroup: "delivery" });
    const c = promo("pct", { type: "percent", bps: 1000, maxDiscountPaise: 3000, stackable: true });
    const r = resolvePromotions([a, b, c], ctx());
    expect(r.applied.map((x) => x.type).sort()).toEqual(["free_delivery", "percent"]);
    expect(r.applied.find((x) => x.type === "free_delivery")?.deliveryWaivedPaise).toBe(4000);
  });

  it("honours an entered coupon first, then adds only stackable automatic offers", () => {
    const coupon = promo("c", { code: "C", type: "fixed", amountPaise: 2000, stackable: true });
    const auto = promo("auto", { type: "fixed", amountPaise: 9000 });
    expect(resolvePromotions([coupon, auto], ctx({ couponCode: "C" })).applied.map((x) => x.ruleId)).toEqual(["c"]);
  });

  it("targets categories, waives fees and never discounts a line below zero", () => {
    const drinks = promo("drinks", { type: "fixed", amountPaise: 99_999, categoryIds: ["drinks"], stackable: true });
    const waiver = promo("nofee", { type: "fee_waiver", waiveFees: ["platform_fee"], stackable: true });
    const r = resolvePromotions([drinks, waiver], ctx());
    const d = r.applied.find((x) => x.ruleId === "drinks")!;
    expect(d.lineAllocations).toEqual({ l2: 20_000 });
    expect(r.applied.find((x) => x.ruleId === "nofee")?.feesWaived).toEqual({ platform_fee: 1000 });
  });
});

describe("funding", () => {
  it("splits cost between vendor and platform", () => {
    const split = promo("split", { type: "fixed", amountPaise: 10_000, fundedBy: "split", vendorShareBps: 3000 });
    const a = resolvePromotions([split], ctx()).applied[0];
    expect(a.vendorFundedPaise).toBe(3000);
    expect(a.platformFundedPaise).toBe(7000);
    const vendor = promo("v", { type: "fixed", amountPaise: 4000, fundedBy: "vendor" });
    expect(resolvePromotions([vendor], ctx()).applied[0]).toMatchObject({ vendorFundedPaise: 4000, platformFundedPaise: 0 });
  });
});
