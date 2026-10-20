import { describe, it, expect } from "vitest";
import {
  DEFAULT_PIPELINE,
  applicableRules,
  publishVersion,
  scopeMatches,
  validatePipeline,
  validateRule,
  winningRule,
  type PricingRule,
} from "../src/pricing/rules";

// Monday 2026-09-14, 12:30 IST.
const AT = Date.UTC(2026, 8, 14, 7, 0);

function rule(over: Partial<PricingRule> & Pick<PricingRule, "ruleId">): PricingRule {
  return {
    version: 1,
    kind: "platform_fee",
    name: "Rule",
    active: true,
    priority: 0,
    effectiveFrom: AT - 86_400_000,
    effectiveUntil: null,
    scope: {},
    params: { mode: "fixed", amountPaise: 1000 },
    ...over,
  };
}

const ctx = { product: "food" as const, at: AT, zoneId: "kochi", vendorId: "v1", categoryIds: ["biryani"], orderPaise: 50_000 };

describe("rule scope", () => {
  it("matches zone, vendor, category, order value and IST day/time", () => {
    expect(scopeMatches({ zoneIds: ["kochi"] }, ctx)).toBe(true);
    expect(scopeMatches({ zoneIds: ["tvm"] }, ctx)).toBe(false);
    expect(scopeMatches({ vendorIds: ["v2"] }, ctx)).toBe(false);
    expect(scopeMatches({ categoryIds: ["biryani", "pizza"] }, ctx)).toBe(true);
    expect(scopeMatches({ minOrderPaise: 60_000 }, ctx)).toBe(false);
    expect(scopeMatches({ daysOfWeek: [1] }, ctx)).toBe(true); // Monday
    expect(scopeMatches({ daysOfWeek: [0, 6] }, ctx)).toBe(false);
    expect(scopeMatches({ timeWindows: [{ from: "12:00", to: "15:00" }] }, ctx)).toBe(true);
    expect(scopeMatches({ timeWindows: [{ from: "19:00", to: "23:00" }] }, ctx)).toBe(false);
    expect(scopeMatches({ product: "stay" }, ctx)).toBe(false);
  });
});

describe("rule resolution", () => {
  it("ignores inactive, future and expired rules", () => {
    const rules = [
      rule({ ruleId: "off", active: false }),
      rule({ ruleId: "future", effectiveFrom: AT + 1 }),
      rule({ ruleId: "expired", effectiveUntil: AT }),
      rule({ ruleId: "live" }),
    ];
    expect(applicableRules(rules, "platform_fee", ctx).map((r) => r.ruleId)).toEqual(["live"]);
  });

  it("prefers priority, then the more specific scope", () => {
    const rules = [
      rule({ ruleId: "global" }),
      rule({ ruleId: "zone", scope: { zoneIds: ["kochi"] } }),
      rule({ ruleId: "vendor", scope: { vendorIds: ["v1"] } }),
      rule({ ruleId: "promo-override", priority: 10 }),
    ];
    expect(applicableRules(rules, "platform_fee", ctx).map((r) => r.ruleId)).toEqual([
      "promo-override", "vendor", "zone", "global",
    ]);
    expect(winningRule(rules.slice(0, 3), "platform_fee", ctx)?.ruleId).toBe("vendor");
  });

  it("uses the newest effective version of a rule", () => {
    const rules = [rule({ ruleId: "fee", version: 1 }), rule({ ruleId: "fee", version: 2, params: { amountPaise: 2000 } })];
    const r = applicableRules(rules, "platform_fee", ctx);
    expect(r).toHaveLength(1);
    expect(r[0].version).toBe(2);
  });
});

describe("versioning never rewrites history", () => {
  it("closes the open version at the new one's start", () => {
    const v1 = rule({ ruleId: "fee", version: 1, effectiveFrom: AT - 10_000 });
    const { next, closed } = publishVersion([v1], { ...v1, params: { amountPaise: 1500 }, effectiveFrom: AT });
    expect(next.version).toBe(2);
    expect(closed?.effectiveUntil).toBe(AT);
    // A quote from before the change still resolves to version 1.
    const before = { ...ctx, at: AT - 1 };
    expect(winningRule([closed!, next], "platform_fee", before)?.version).toBe(1);
    expect(winningRule([closed!, next], "platform_fee", ctx)?.version).toBe(2);
  });
});

describe("validation", () => {
  it("refuses an uncapped surge", () => {
    expect(validateRule(rule({ ruleId: "surge", kind: "surge", params: { multiplierBps: 12_500 } })).join(" ")).toMatch(/maximum multiplier/);
    expect(validateRule(rule({ ruleId: "surge", kind: "surge", params: { multiplierBps: 12_500, maxMultiplierBps: 15_000, maxAddPaise: 3000 } }))).toEqual([]);
  });

  it("refuses a percentage promotion without a cap and a GST rate out of range", () => {
    expect(validateRule(rule({ ruleId: "promo", kind: "promotion", params: { type: "percent", bps: 5000 } })).join(" ")).toMatch(/maximum discount/);
    expect(validateRule(rule({ ruleId: "gst", kind: "tax_category", params: { id: "x", rateBps: 9000, liability: "supplier" } })).join(" ")).toMatch(/0–40%/);
  });

  it("checks rule identity and dates", () => {
    expect(validateRule(rule({ ruleId: "Bad Id" })).join(" ")).toMatch(/Rule id/);
    expect(validateRule(rule({ ruleId: "dates", effectiveUntil: AT - 2 * 86_400_000 })).join(" ")).toMatch(/after effective-from/);
  });

  it("allows reordering fees but keeps legal constraints", () => {
    expect(validatePipeline(DEFAULT_PIPELINE)).toEqual([]);
    const feesBeforeDiscount = ["items", "modifiers", "packaging", "item_discounts", "cart_discounts", "delivery", "surge", "platform_fee", "small_order_fee", "taxes", "rounding"];
    expect(validatePipeline(feesBeforeDiscount)).toEqual([]);
    expect(validatePipeline(["items", "modifiers", "item_discounts", "cart_discounts", "taxes", "packaging", "delivery", "surge", "platform_fee", "small_order_fee", "rounding"]).join(" ")).toMatch(/before taxes/);
    expect(validatePipeline([...DEFAULT_PIPELINE.slice(0, -2), "rounding", "taxes"]).join(" ")).toMatch(/last step/);
  });
});
