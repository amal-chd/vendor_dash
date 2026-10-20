import { describe, it, expect } from "vitest";
import {
  normalisePlan,
  findPlan,
  commissionForMerchant,
  DEFAULT_CATALOG,
  type PlanCatalog,
} from "../src/planCatalog";

describe("plan validation", () => {
  it("rejects a plan with no id", () => {
    expect(() => normalisePlan({ name: "X" }, 0)).toThrow();
  });

  it("rejects commission outside 0–100", () => {
    expect(() => normalisePlan({ id: "a", commissionPercent: -1 }, 0)).toThrow();
    expect(() => normalisePlan({ id: "a", commissionPercent: 101 }, 0)).toThrow();
  });

  it("rejects an annual per-month price ABOVE the monthly price", () => {
    // This slip would silently overcharge every annual subscriber.
    expect(() =>
      normalisePlan({ id: "a", monthlyPrice: 499, annualPrice: 599 }, 0),
    ).toThrow(/cannot exceed/);
  });

  it("accepts a normal discounted annual price", () => {
    const p = normalisePlan({ id: "a", monthlyPrice: 499, annualPrice: 399 }, 0);
    expect(p.monthlyPrice).toBe(499);
    expect(p.annualPrice).toBe(399);
  });

  it("treats Custom/null pricing as sales-led, not zero", () => {
    const p = normalisePlan({ id: "ent", monthlyPrice: "Custom", annualPrice: null }, 0);
    expect(p.monthlyPrice).toBeNull();
    expect(p.annualPrice).toBeNull();
  });

  it("never yields a negative price or outlet count", () => {
    const p = normalisePlan({ id: "a", monthlyPrice: -50, maxOutlets: -3 }, 0);
    expect(p.monthlyPrice).toBe(0);
    expect(p.maxOutlets).toBe(0);
  });

  it("defaults product to dine and only 'stay' switches it", () => {
    expect(normalisePlan({ id: "a" }, 0).product).toBe("dine");
    expect(normalisePlan({ id: "a", product: "stay" }, 0).product).toBe("stay");
    expect(normalisePlan({ id: "a", product: "nonsense" }, 0).product).toBe("dine");
  });
});

describe("seeded catalog covers both products", () => {
  it("ships Dine and Stay plans", () => {
    const dine = DEFAULT_CATALOG.plans.filter((p) => p.product === "dine");
    const stay = DEFAULT_CATALOG.plans.filter((p) => p.product === "stay");
    expect(dine.length).toBeGreaterThan(0);
    expect(stay.length).toBeGreaterThan(0);
  });

  it("every seeded plan passes its own validation", () => {
    for (const [i, p] of DEFAULT_CATALOG.plans.entries()) {
      expect(() => normalisePlan(p, i)).not.toThrow();
    }
  });

  it("preserves the prices that were already live", () => {
    const starter = findPlan(DEFAULT_CATALOG, "dine", "starter");
    expect(starter?.monthlyPrice).toBe(499);
    expect(starter?.annualPrice).toBe(399);
    const pro = findPlan(DEFAULT_CATALOG, "stay", "pro");
    expect(pro?.monthlyPrice).toBe(999);
    expect(pro?.annualPrice).toBe(799);
  });
});

describe("commission resolution precedence", () => {
  const cat: PlanCatalog = DEFAULT_CATALOG;

  it("a bespoke per-merchant rate always wins", () => {
    const r = commissionForMerchant(cat, "dine", { commissionRate: 2.5, subscriptionPlan: "growth" }, 10);
    expect(r.rate).toBe(2.5);
    expect(r.source).toBe("merchant");
  });

  it("falls back to the plan's commission", () => {
    const r = commissionForMerchant(cat, "dine", { subscriptionPlan: "growth" }, 10);
    expect(r.rate).toBe(4);
    expect(r.source).toBe("plan");
  });

  it("falls back to the platform default when the plan is unknown", () => {
    const r = commissionForMerchant(cat, "dine", { subscriptionPlan: "ghost" }, 7);
    expect(r.rate).toBe(7);
    expect(r.source).toBe("default");
  });

  it("uses the platform default for a merchant with no plan at all", () => {
    expect(commissionForMerchant(cat, "dine", {}, 6).rate).toBe(6);
    expect(commissionForMerchant(cat, "dine", undefined, 6).rate).toBe(6);
  });

  it("keeps Dine and Stay plan namespaces separate", () => {
    // "basic" is a Stay plan — it must not resolve under Dine.
    expect(findPlan(cat, "dine", "basic")).toBeNull();
    expect(findPlan(cat, "stay", "basic")).not.toBeNull();
  });

  it("respects an explicit 0% bespoke rate (not treated as missing)", () => {
    const r = commissionForMerchant(cat, "dine", { commissionRate: 0 }, 10);
    expect(r.rate).toBe(0);
    expect(r.source).toBe("merchant");
  });
});
