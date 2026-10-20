import { describe, it, expect } from "vitest";
import { messSettlementLine, dayKey } from "../src/mess";

// ─────────────────────────────────────────────────────────────────────────
// What a mess kitchen is owed for a period.
//
// The customer pays Kada for the whole plan up front, so the kitchen earns
// its plan value pro-rata for every day of that plan inside the period —
// including days the customer skipped, because the kitchen still held the
// capacity. Kada's per-customer-per-day fee is charged only on days actually
// served, so a skip costs the kitchen nothing.
// ─────────────────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** ₹3,000 for 30 days = ₹100/day, Kada takes ₹3 a day. */
const plan = { pricePaise: 300_000, durationDays: 30 };

describe("messSettlementLine", () => {
  it("pro-rates the plan over the days inside the period", () => {
    const line = messSettlementLine(
      { startDate: d("2026-09-01"), endDate: d("2026-10-01"), plan, platformFeePerDayPaise: 300 },
      d("2026-09-14"),
      d("2026-09-21"),
    );
    expect(line).not.toBeNull();
    expect(line!.coveredDays).toBe(7);
    expect(line!.servedDays).toBe(7);
    expect(line!.earnedPaise).toBe(70_000); // 7 × ₹100
    expect(line!.feePaise).toBe(2_100); // 7 × ₹3
  });

  it("clips to the subscription, not the period", () => {
    // Plan runs 3 days into a 7-day period; only those 3 days are earned.
    const line = messSettlementLine(
      { startDate: d("2026-09-14"), endDate: d("2026-09-17"), plan, platformFeePerDayPaise: 300 },
      d("2026-09-14"),
      d("2026-09-21"),
    );
    expect(line!.coveredDays).toBe(3);
    expect(line!.earnedPaise).toBe(30_000);
  });

  it("still pays the kitchen for a skipped day, but charges no fee on it", () => {
    const line = messSettlementLine(
      {
        startDate: d("2026-09-14"),
        endDate: d("2026-09-21"),
        plan,
        platformFeePerDayPaise: 300,
        skippedDays: [dayKey(d("2026-09-15")), dayKey(d("2026-09-16"))],
      },
      d("2026-09-14"),
      d("2026-09-21"),
    );
    expect(line!.coveredDays).toBe(7);
    expect(line!.servedDays).toBe(5);
    expect(line!.earnedPaise).toBe(70_000); // unchanged — capacity was held
    expect(line!.feePaise).toBe(1_500); // 5 × ₹3, not 7
  });

  it("ignores skips that fall outside the period", () => {
    const line = messSettlementLine(
      {
        startDate: d("2026-09-01"),
        endDate: d("2026-10-01"),
        plan,
        platformFeePerDayPaise: 300,
        skippedDays: [dayKey(d("2026-09-02")), dayKey(d("2026-09-28"))],
      },
      d("2026-09-14"),
      d("2026-09-21"),
    );
    expect(line!.servedDays).toBe(7);
    expect(line!.feePaise).toBe(2_100);
  });

  it("returns null when the subscription doesn't touch the period", () => {
    expect(
      messSettlementLine(
        { startDate: d("2026-08-01"), endDate: d("2026-08-31"), plan },
        d("2026-09-14"),
        d("2026-09-21"),
      ),
    ).toBeNull();
    // A plan that ends exactly when the period opens earns nothing more.
    expect(
      messSettlementLine(
        { startDate: d("2026-09-01"), endDate: d("2026-09-14"), plan },
        d("2026-09-14"),
        d("2026-09-21"),
      ),
    ).toBeNull();
  });

  it("never invents money when the plan or the fee is missing", () => {
    const line = messSettlementLine(
      { startDate: d("2026-09-14"), endDate: d("2026-09-21"), plan: null, amountPaise: 0 },
      d("2026-09-14"),
      d("2026-09-21"),
    );
    expect(line!.earnedPaise).toBe(0);
    expect(line!.feePaise).toBe(0); // no fee snapshotted → Kada takes nothing
  });

  it("falls back to the amount actually charged when the plan snapshot is thin", () => {
    const line = messSettlementLine(
      {
        startDate: d("2026-09-14"),
        endDate: d("2026-09-21"),
        plan: { durationDays: 7 },
        amountPaise: 70_000,
        platformFeePerDayPaise: 300,
      },
      d("2026-09-14"),
      d("2026-09-21"),
    );
    expect(line!.earnedPaise).toBe(70_000);
  });

  it("is safe with no dates at all", () => {
    expect(messSettlementLine({ plan }, d("2026-09-14"), d("2026-09-21"))).toBeNull();
  });
});
