import { describe, it, expect } from "vitest";
import {
  refundQuote,
  DEFAULT_CANCELLATION_POLICY,
  type CancellationPolicy,
} from "../src/stayCancellation";

// ─────────────────────────────────────────────────────────────────────────
// What a guest gets back when they cancel a stay.
//
// The tiers themselves are config (config/stay_policies); these tests pin the
// LADDER BEHAVIOUR, which must hold whatever numbers ops puts in: the first
// threshold that still fits wins, a started stay refunds nothing, and a refund
// never exceeds what was actually taken.
// ─────────────────────────────────────────────────────────────────────────

const policy = DEFAULT_CANCELLATION_POLICY;
const paid = 500_000; // ₹5,000
const now = new Date("2026-09-26T10:00:00.000Z");
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("refundQuote", () => {
  it("gives everything back outside the Flexible window", () => {
    const q = refundQuote({ policyName: "Flexible", policy, checkIn: inHours(30), paidPaise: paid, now });
    expect(q.refundPercent).toBe(100);
    expect(q.refundPaise).toBe(paid);
  });

  it("gives nothing back inside the Flexible window", () => {
    const q = refundQuote({ policyName: "Flexible", policy, checkIn: inHours(5), paidPaise: paid, now });
    expect(q.refundPercent).toBe(0);
    expect(q.refundPaise).toBe(0);
    expect(q.reason).toContain("non-refundable");
  });

  it("walks down the Moderate ladder", () => {
    // 6 days out → full; 2 days out → half; 6 hours out → nothing.
    expect(refundQuote({ policyName: "Moderate", policy, checkIn: inHours(144), paidPaise: paid, now }).refundPercent).toBe(100);
    expect(refundQuote({ policyName: "Moderate", policy, checkIn: inHours(48), paidPaise: paid, now }).refundPercent).toBe(50);
    expect(refundQuote({ policyName: "Moderate", policy, checkIn: inHours(6), paidPaise: paid, now }).refundPercent).toBe(0);
  });

  it("treats the threshold itself as inside the tier", () => {
    // Exactly 120 hours out is still the 100% tier, not the one below it.
    const q = refundQuote({ policyName: "Moderate", policy, checkIn: inHours(120), paidPaise: paid, now });
    expect(q.refundPercent).toBe(100);
  });

  it("refuses any refund once the stay has started", () => {
    const q = refundQuote({ policyName: "Flexible", policy, checkIn: inHours(-1), paidPaise: paid, now });
    expect(q.refundPaise).toBe(0);
    expect(q.hoursToCheckIn).toBeLessThan(0);
    expect(q.reason).toContain("already started");
  });

  it("falls back to the default policy when the listing names an unknown one", () => {
    const q = refundQuote({ policyName: "Whatever", policy, checkIn: inHours(144), paidPaise: paid, now });
    expect(q.policy).toBe(policy.defaultPolicy);
  });

  it("falls back to the default policy when the listing names none", () => {
    const q = refundQuote({ policyName: null, policy, checkIn: inHours(144), paidPaise: paid, now });
    expect(q.policy).toBe(policy.defaultPolicy);
  });

  it("rounds a part refund DOWN so it can never exceed what was paid", () => {
    // ₹100.01 at 50% is ₹50.005 — the extra paisa stays with the platform.
    const q = refundQuote({ policyName: "Moderate", policy, checkIn: inHours(48), paidPaise: 10_001, now });
    expect(q.refundPaise).toBe(5_000);
  });

  it("refunds nothing on an unpaid booking, and says so", () => {
    const q = refundQuote({ policyName: "Flexible", policy, checkIn: inHours(2), paidPaise: 0, now });
    expect(q.refundPaise).toBe(0);
    expect(q.reason).toContain("Nothing was charged");
  });

  it("honours a config ladder written in any order", () => {
    const custom: CancellationPolicy = {
      defaultPolicy: "Custom",
      tiers: {
        // Deliberately shortest-notice first.
        Custom: [
          { hoursBefore: 12, refundPercent: 25 },
          { hoursBefore: 72, refundPercent: 90 },
        ],
      },
    };
    expect(refundQuote({ policyName: "Custom", policy: custom, checkIn: inHours(100), paidPaise: paid, now }).refundPercent).toBe(90);
    expect(refundQuote({ policyName: "Custom", policy: custom, checkIn: inHours(24), paidPaise: paid, now }).refundPercent).toBe(25);
    expect(refundQuote({ policyName: "Custom", policy: custom, checkIn: inHours(2), paidPaise: paid, now }).refundPercent).toBe(0);
  });
});
