import { describe, it, expect } from "vitest";
import {
  billingModelOf,
  effectiveCommissionRate,
  billingAudit,
  hasActiveSubscription,
} from "../src/billingModel";

const future = Date.now() + 30 * 86_400_000;
const past = Date.now() - 30 * 86_400_000;

describe("billing model resolution", () => {
  it("defaults to commission when the field is absent (preserves legacy behaviour)", () => {
    expect(billingModelOf(undefined)).toBe("commission");
    expect(billingModelOf({})).toBe("commission");
    expect(billingModelOf({ billingModel: "" })).toBe("commission");
  });
  it("only 'subscription' switches the model", () => {
    expect(billingModelOf({ billingModel: "subscription" })).toBe("subscription");
    expect(billingModelOf({ billingModel: "SUBSCRIPTION" })).toBe("subscription");
    expect(billingModelOf({ billingModel: "nonsense" })).toBe("commission");
  });
});

describe("effective commission rate", () => {
  it("charges the configured rate on the commission model", () => {
    const r = effectiveCommissionRate({ billingModel: "commission" }, 12);
    expect(r.rate).toBe(12);
    expect(r.waived).toBe(false);
    expect(r.lapsed).toBe(false);
  });

  it("waives commission for an ACTIVE subscription", () => {
    const r = effectiveCommissionRate(
      { billingModel: "subscription", subscriptionStatus: "active", subscriptionEndDate: future },
      12,
    );
    expect(r.rate).toBe(0);
    expect(r.waived).toBe(true);
  });

  it("charges commission when the subscription has LAPSED (no free ride)", () => {
    const r = effectiveCommissionRate(
      { billingModel: "subscription", subscriptionStatus: "active", subscriptionEndDate: past },
      12,
    );
    expect(r.rate).toBe(12);
    expect(r.waived).toBe(false);
    expect(r.lapsed).toBe(true);
  });

  it("charges commission when the subscription was cancelled/expired", () => {
    for (const status of ["expired", "cancelled", "blocked", ""]) {
      const r = effectiveCommissionRate(
        { billingModel: "subscription", subscriptionStatus: status },
        10,
      );
      expect(r.rate).toBe(10);
      expect(r.lapsed).toBe(true);
    }
  });

  it("does NOT treat a legacy trial as an active subscription (trials removed)", () => {
    const r = effectiveCommissionRate(
      { billingModel: "subscription", subscriptionStatus: "trial", trialEndDate: future },
      15,
    );
    expect(r.rate).toBe(15);
    expect(r.lapsed).toBe(true);
  });

  it("never returns a negative or NaN rate", () => {
    for (const rate of [0, 5, 100]) {
      const r = effectiveCommissionRate({ billingModel: "commission" }, rate);
      expect(Number.isFinite(r.rate)).toBe(true);
      expect(r.rate).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("settlement audit trail", () => {
  it("explains a waived (0%) settlement so it never looks like a bug", () => {
    const a = billingAudit("subscription", 12, true, false);
    expect(a.billingModel).toBe("subscription");
    expect(a.configuredCommissionRate).toBe(12);
    expect(a.commissionWaived).toBe(true);
    expect(String(a.commissionWaivedReason)).toContain("subscription");
  });
  it("explains a commission charge on a lapsed subscription", () => {
    const a = billingAudit("subscription", 12, false, true);
    expect(a.subscriptionLapsed).toBe(true);
    expect(String(a.commissionChargedReason)).toContain("not active");
    expect(a.commissionWaived).toBe(false);
  });
  it("stays quiet on a plain commission settlement", () => {
    const a = billingAudit("commission", 8, false, false);
    expect(a.commissionWaived).toBe(false);
    expect(a.subscriptionLapsed).toBeUndefined();
    expect(a.commissionWaivedReason).toBeUndefined();
  });
});

describe("subscription validity", () => {
  it("accepts an active paid subscription with a future expiry", () => {
    expect(hasActiveSubscription({ subscriptionStatus: "active", subscriptionEndDate: future })).toBe(true);
  });
  it("rejects a legacy trial status", () => {
    expect(hasActiveSubscription({ subscriptionStatus: "trial", trialEndDate: future })).toBe(false);
    expect(hasActiveSubscription({ subscriptionStatus: "trialing" })).toBe(false);
  });
  it("rejects a past expiry", () => {
    expect(hasActiveSubscription({ subscriptionStatus: "active", subscriptionEndDate: past })).toBe(false);
  });
  it("treats a legacy active record with no expiry as active", () => {
    expect(hasActiveSubscription({ subscriptionStatus: "active" })).toBe(true);
  });
  it("rejects missing/unknown state", () => {
    expect(hasActiveSubscription(undefined)).toBe(false);
    expect(hasActiveSubscription({})).toBe(false);
  });
});
