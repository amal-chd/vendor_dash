import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROMOS,
  baseDeliveryFeeFor,
  checkOrderPricing,
  goldDiscountFor,
  istMinutesOfDay,
  priceLines,
  promoFromDoc,
  restaurantTaxOf,
  storeBlockProblem,
  taxBreakdown,
  withinWindow,
  type PricingContext,
} from "../src/orderPricing";

/**
 * Locks server pricing to the customer app's arithmetic
 * (CartItem.unitPrice, CartService.totals, CheckoutController.payable).
 * A false refusal loses an honest order; a false pass lets someone underpay.
 */

// 12:30 IST on 2026-09-14.
const LUNCH = new Date("2026-09-14T07:00:00Z");

const menu = {
  dosa: { restaurantId: "r1", name: "Masala Dosa", price: 120, isAvailable: true },
  biryani: {
    restaurantId: "r1",
    name: "Biryani",
    price: 250,
    variants: [
      { name: "Half", price: 180 },
      { name: "Full", price: 320 },
    ],
    addons: [{ name: "Raita", price: 30 }],
  },
  lassi: { restaurantId: "r1", name: "Lassi", price: 90, happyHourPrice: 60, happyFrom: "12:00", happyTo: "15:00" },
  soldOut: { restaurantId: "r1", name: "Payasam", price: 70, isAvailable: false },
  foreign: { restaurantId: "r2", name: "Pizza", price: 300 },
};

const noTax = restaurantTaxOf({});

function ctx(over: Partial<PricingContext> = {}): PricingContext {
  return {
    restaurantId: "r1",
    menu,
    restaurant: noTax,
    promos: [],
    nowMs: LUNCH.getTime(),
    pricedAt: LUNCH,
    isGold: false,
    deliveryFeeFloor: 0,
    platformFee: 0,
    ...over,
  };
}

describe("item pricing mirrors the customer app", () => {
  it("uses the variant's own price and adds add-ons on top", () => {
    const r = priceLines(
      [{ menuItemId: "biryani", qty: 2, selectedVariant: { name: "Full" }, selectedAddons: [{ name: "Raita" }] }],
      menu, "r1", LUNCH,
    );
    expect(r.problems).toEqual([]);
    expect(r.rawSubtotal).toBe((320 + 30) * 2);
  });

  it("applies happy hour on the IST clock only inside the window", () => {
    expect(priceLines([{ menuItemId: "lassi", qty: 1 }], menu, "r1", LUNCH).rawSubtotal).toBe(60);
    const evening = new Date("2026-09-14T13:30:00Z"); // 19:00 IST
    expect(priceLines([{ menuItemId: "lassi", qty: 1 }], menu, "r1", evening).rawSubtotal).toBe(90);
  });

  it("handles windows that cross midnight", () => {
    expect(withinWindow("22:00", "02:00", 23 * 60)).toBe(true);
    expect(withinWindow("22:00", "02:00", 60)).toBe(true);
    expect(withinWindow("22:00", "02:00", 12 * 60)).toBe(false);
    expect(istMinutesOfDay(LUNCH)).toBe(12 * 60 + 30);
  });

  it("refuses sold-out, removed, foreign and unknown-option lines", () => {
    const r = priceLines(
      [
        { menuItemId: "soldOut", qty: 1 },
        { menuItemId: "gone", name: "Old Special", qty: 1 },
        { menuItemId: "foreign", qty: 1 },
        { menuItemId: "biryani", qty: 1, selectedVariant: { name: "Family" } },
        { menuItemId: "biryani", qty: 1, selectedAddons: [{ name: "Gold leaf" }] },
        { menuItemId: "dosa", qty: 0 },
      ],
      menu, "r1", LUNCH,
    );
    expect(r.problems).toHaveLength(6);
    expect(r.problems.join(" ")).toMatch(/sold out/);
    expect(r.problems.join(" ")).toMatch(/no longer on the menu/);
  });
});

describe("tax mirrors CartService.totals", () => {
  it("adds exclusive tax on top", () => {
    const t = taxBreakdown(200, restaurantTaxOf({ enableTax: true, taxPercentage: 5 }));
    expect(t.tax).toBeCloseTo(10);
    expect(t.preDiscount).toBeCloseTo(210);
  });

  it("carves inclusive tax out of the price without raising the total", () => {
    const t = taxBreakdown(210, restaurantTaxOf({ enableTax: true, taxPercentage: 5, taxMethod: "inclusive" }));
    expect(t.subtotal).toBeCloseTo(200);
    expect(t.preDiscount).toBe(210);
  });
});

describe("promos and Gold", () => {
  it("parses admin promo docs the way the app does", () => {
    expect(promoFromDoc("save40", { type: "flat", value: 40, minOrder: 199 })).toMatchObject({
      code: "SAVE40", percent: 100, maxOff: 40, minSubtotal: 199,
    });
    expect(promoFromDoc("x", { type: "percent", value: 0 })).toBeNull();
  });

  it("caps Gold at ₹100, or ₹200 at partner restaurants", () => {
    expect(goldDiscountFor(2000, noTax, true)).toBe(100);
    expect(goldDiscountFor(2000, restaurantTaxOf({ goldDiscountPercent: 15 }), true)).toBe(200);
    expect(goldDiscountFor(2000, noTax, false)).toBe(0);
  });
});

describe("delivery base fee (shared with calculateDeliveryFee)", () => {
  const econ = { deliveryBaseFee: 25, deliveryPerKm: 7, freeDeliveryUnderKm: 3, freeDeliveryAbove: 0 };
  it("is free under the free radius and charged per km beyond it", () => {
    expect(baseDeliveryFeeFor({ distanceKm: 2, econ, isGoldVip: false, orderSubtotal: 100 }).fee).toBe(0);
    expect(baseDeliveryFeeFor({ distanceKm: 5, econ, isGoldVip: false, orderSubtotal: 100 }).fee).toBe(39);
  });
  it("is free for Gold VIPs from ₹149", () => {
    expect(baseDeliveryFeeFor({ distanceKm: 8, econ, isGoldVip: true, orderSubtotal: 149 }).fee).toBe(0);
  });
});

describe("order total floor", () => {
  const honest = {
    items: [{ menuItemId: "dosa", qty: 2 }, { menuItemId: "lassi", qty: 1 }],
    tip: 20,
    donation: 5,
    total: 120 * 2 + 60 + 20 + 5 + 39 + 10,
  };

  it("accepts an honest order", () => {
    const c = checkOrderPricing(honest, ctx({ deliveryFeeFloor: 39, platformFee: 10 }));
    expect(c.ok).toBe(true);
    expect(c.floorTotal).toBe(374);
  });

  it("refuses an order that declares ₹1 for a full basket", () => {
    const c = checkOrderPricing({ ...honest, total: 1 }, ctx({ deliveryFeeFloor: 39, platformFee: 10 }));
    expect(c.ok).toBe(false);
    expect(c.shortfall).toBeGreaterThan(300);
  });

  it("allows the best compiled promo when an older client omits the code", () => {
    const order = { items: [{ menuItemId: "biryani", qty: 1, selectedVariant: { name: "Full" } }], total: 320 - 100 };
    expect(checkOrderPricing(order, ctx({ promos: DEFAULT_PROMOS })).ok).toBe(true);
    expect(checkOrderPricing({ ...order, total: 320 - 160 }, ctx({ promos: DEFAULT_PROMOS })).ok).toBe(false);
  });

  it("gives a named code exactly its own discount", () => {
    const order = { items: [{ menuItemId: "biryani", qty: 1, selectedVariant: { name: "Full" } }], promoCode: "welcome", total: 320 - 100 };
    expect(checkOrderPricing(order, ctx({ promos: DEFAULT_PROMOS })).ok).toBe(false);
    expect(checkOrderPricing({ ...order, total: 320 - 50 }, ctx({ promos: DEFAULT_PROMOS })).ok).toBe(true);
  });

  it("ignores expired admin promos", () => {
    const expired = { code: "BIG", percent: 100, maxOff: 300, minSubtotal: 0, expiresAtMs: LUNCH.getTime() - 1 };
    const order = { items: [{ menuItemId: "dosa", qty: 1 }], total: 0 };
    expect(checkOrderPricing(order, ctx({ promos: [expired] })).ok).toBe(false);
  });

  it("stacks server-verified Gold with a promo", () => {
    const order = { items: [{ menuItemId: "biryani", qty: 3, selectedVariant: { name: "Full" } }], total: 960 - 100 - 96 };
    expect(checkOrderPricing(order, ctx({ promos: DEFAULT_PROMOS, isGold: true })).ok).toBe(true);
    expect(checkOrderPricing(order, ctx({ promos: DEFAULT_PROMOS, isGold: false })).ok).toBe(false);
  });

  it("tolerates ₹1 of rounding but not more", () => {
    const order = { items: [{ menuItemId: "dosa", qty: 1 }], total: 119.2 };
    expect(checkOrderPricing(order, ctx()).ok).toBe(true);
    expect(checkOrderPricing({ ...order, total: 118.5 }, ctx()).ok).toBe(false);
  });

  it("never refuses a client that paid more (surge, express, a bigger tip)", () => {
    expect(checkOrderPricing({ ...honest, total: honest.total + 44 }, ctx({ deliveryFeeFloor: 39, platformFee: 10 })).ok).toBe(true);
  });

  it("refuses an order with no items", () => {
    expect(checkOrderPricing({ items: [], total: 0 }, ctx()).ok).toBe(false);
  });
});

describe("store availability", () => {
  const now = LUNCH.getTime();
  it("refuses an offline store", () => {
    expect(storeBlockProblem({ acceptingOrders: false, pausedUntilMs: null }, null, now)).toMatch(/offline/);
    const c = checkOrderPricing(
      { items: [{ menuItemId: "dosa", qty: 1 }], total: 120 },
      ctx({ store: { acceptingOrders: false, pausedUntilMs: null } }),
    );
    expect(c.ok).toBe(false);
  });

  it("refuses a paused store unless the slot is after the pause", () => {
    expect(storeBlockProblem({ acceptingOrders: true, pausedUntilMs: now + 600_000 }, null, now)).toMatch(/paused/);
    expect(storeBlockProblem({ acceptingOrders: true, pausedUntilMs: now + 600_000 }, now + 3_600_000, now)).toBeNull();
  });

  it("allows an open store or an expired pause", () => {
    expect(storeBlockProblem({ acceptingOrders: true, pausedUntilMs: null }, null, now)).toBeNull();
    expect(storeBlockProblem({ acceptingOrders: true, pausedUntilMs: now - 1 }, null, now)).toBeNull();
  });
});
