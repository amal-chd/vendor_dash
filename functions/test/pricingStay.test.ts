import { describe, it, expect } from "vitest";
import { quoteStay, type StayQuote, type StayQuoteInput } from "../src/pricing/stay";
import type { PricingRule, RuleKind } from "../src/pricing/rules";

const AT = Date.UTC(2026, 8, 14, 7, 0);
let n = 0;
function r(kind: RuleKind, params: Record<string, unknown>, over: Partial<PricingRule> = {}): PricingRule {
  n += 1;
  return {
    ruleId: `stay-${kind.replace(/_/g, "-")}-${n}`,
    version: 1, kind, name: kind, active: true, priority: 0,
    effectiveFrom: AT - 365 * 86_400_000, effectiveUntil: null,
    scope: { product: "stay" }, params, ...over,
  };
}

function rules(): PricingRule[] {
  return [
    // Accommodation GST by per-night tariff: up to ₹7,500 → 5%, above → 18%.
    r("tax_category", { id: "accommodation", label: "Accommodation", rateBps: 0, slabs: [{ upToPaise: 750_000, rateBps: 500 }, { upToPaise: null, rateBps: 1800 }], liability: "platform_eco" }),
    r("tax_category", { id: "platform_service", label: "Platform service", rateBps: 1800, liability: "supplier" }),
    r("tax_assignment", { component: "stay_room", taxCategoryId: "accommodation", supplier: "host" }),
    r("tax_assignment", { component: "stay_cleaning", taxCategoryId: "accommodation", supplier: "host" }),
    r("tax_assignment", { component: "stay_service_fee", taxCategoryId: "platform_service", supplier: "platform", placeOfSupply: "customer_state" }),
    r("tax_assignment", { component: "stay_commission", taxCategoryId: "platform_service", supplier: "platform" }),
    // Weekend nights (Fri/Sat) +20%.
    r("stay_rate", { adjustBps: 2000 }, { scope: { product: "stay", daysOfWeek: [5, 6] } }),
    r("stay_fee", { fee: "service", bps: 1000, minPaise: 10_000, maxPaise: 150_000 }),
    r("stay_commission", { bps: 1500, paymentFeeBps: 200 }),
  ];
}

function input(over: Partial<StayQuoteInput> = {}): StayQuoteInput {
  return {
    at: AT,
    property: { id: "h1", hostId: "h1", name: "Backwater Villa", stateCode: "32", gstin: "32ABCDE1234F1Z5", zoneId: "alleppey" },
    room: { id: "deluxe", name: "Deluxe", baseNightlyPaise: 400_000, maxGuests: 4, includedGuests: 2, extraGuestNightlyPaise: 50_000, cleaningFeePaise: 45_000 },
    nightlyOverrides: {},
    // Thu 2026-09-17 → Sun 2026-09-20: Thu, Fri, Sat nights.
    checkIn: "2026-09-17",
    checkOut: "2026-09-20",
    guests: 3,
    customer: { uid: "c1", completedStays: 1, isNew: false, stateCode: "32" },
    platform: { gstin: "32AAACK0000A1Z9", stateCode: "32" },
    couponCode: null,
    promoUsage: { total: {}, byCustomer: {} },
    hostCommissionWaived: false,
    ...over,
  };
}

function expectBalanced(q: StayQuote) {
  expect(q.host.netPayoutPaise + q.platformRevenuePaise + q.taxLiability.platformEcoPaise + q.taxLiability.platformOwnPaise).toBe(q.totals.totalPaise);
  expect(q.display[q.display.length - 1].amountPaise).toBe(q.totals.totalPaise);
  expect(q.host.display[q.host.display.length - 1].amountPaise).toBe(q.host.netPayoutPaise);
}

describe("stay pricing", () => {
  const q = quoteStay(input(), rules());

  it("prices nights with weekend rules and extra guests", () => {
    expect(q.problems).toEqual([]);
    expect(q.nightCount).toBe(3);
    expect(q.nights.map((x) => x.ratePaise)).toEqual([400_000, 480_000, 480_000]);
    expect(q.extraGuestSubtotalPaise).toBe(3 * 50_000);
    expect(q.cleaningFeePaise).toBe(45_000);
    expect(q.serviceFeePaise).toBe(150_000); // 10% of ₹15,100 = ₹1,510, capped at ₹1,500
  });

  it("taxes accommodation by tariff slab and the service fee at 18%", () => {
    const room = q.taxes.find((t) => t.component === "stay_room")!;
    expect(room.rateBps).toBe(500); // avg ₹5,033/night
    const service = q.taxes.find((t) => t.component === "stay_service_fee")!;
    expect(service.total).toBe(27_000);
    expectBalanced(q);
  });

  it("uses the higher slab for a premium room", () => {
    const premium = quoteStay(input({ room: { ...input().room, baseNightlyPaise: 900_000 } }), rules());
    expect(premium.taxes.find((t) => t.component === "stay_room")!.rateBps).toBe(1800);
    expectBalanced(premium);
  });

  it("shows the host gross, commission, payment fee and net payout", () => {
    const labels = q.host.display.map((d) => d.key);
    expect(labels).toEqual(["gross", "commission", "payment_fee", "net"]);
    expect(q.host.commissionPaise).toBe(Math.round((1_510_000 + 45_000) * 0.15));
  });

  it("honours host date overrides and seasonal rules", () => {
    const seasonal = [...rules(), r("stay_rate", { overridePaise: 700_000, dateFrom: "2026-09-18", dateTo: "2026-09-18" }, { priority: 10 })];
    const s = quoteStay(input({ nightlyOverrides: { "2026-09-17": 350_000 } }), seasonal);
    expect(s.nights.map((x) => x.ratePaise)).toEqual([350_000, 700_000, 480_000]);
    expectBalanced(s);
  });

  it("applies a host-funded coupon and still balances", () => {
    const withCoupon = [...rules(), r("promotion", { code: "MONSOON", type: "percent", bps: 1000, maxDiscountPaise: 100_000, fundedBy: "vendor" }, { scope: { product: "stay" } })];
    const c = quoteStay(input({ couponCode: "monsoon" }), withCoupon);
    expect(c.couponProblem).toBeNull();
    expect(c.discountPaise).toBe(100_000);
    expect(c.host.hostFundedDiscountPaise).toBe(100_000);
    expectBalanced(c);
  });

  it("refuses bad dates, too many guests and over-long stays", () => {
    expect(quoteStay(input({ checkOut: "2026-09-17" }), rules()).problems.join(" ")).toMatch(/after check-in/);
    expect(quoteStay(input({ guests: 6 }), rules()).problems.join(" ")).toMatch(/up to 4 guests/);
    expect(quoteStay(input({ checkOut: "2026-11-30" }), rules()).problems.join(" ")).toMatch(/30 nights/);
  });
});
