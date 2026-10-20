import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deliveriesSoFarToday,
  earningsFields,
  istPeriods,
  samePeriods,
  strayEarningsFields,
  totalsFromLedger,
} from "../src/riderEarnings";

// 2026-09-19 is a Saturday. 23:00 IST on the 19th = 17:30 UTC.
const at = (iso: string) => new Date(iso);

describe("IST periods", () => {
  it("uses the Indian calendar day, not UTC", () => {
    expect(istPeriods(at("2026-09-19T18:40:00Z")).day).toBe("2026-09-20"); // 00:10 IST next day
    expect(istPeriods(at("2026-09-19T18:20:00Z")).day).toBe("2026-09-19"); // 23:50 IST
  });

  it("starts weeks on Monday and months on the 1st", () => {
    const p = istPeriods(at("2026-09-19T06:00:00Z"));
    expect(p.week).toBe("2026-09-14");
    expect(p.month).toBe("2026-09");
    expect(istPeriods(at("2026-09-13T06:00:00Z")).week).toBe("2026-09-07"); // Sunday belongs to the previous week
  });
});

describe("writing earnings", () => {
  it("writes a NESTED earnings map, never dotted top-level keys", () => {
    const f = earningsFields({}, 50, at("2026-09-19T06:00:00Z"));
    expect(Object.keys(f).some((k) => k.startsWith("earnings."))).toBe(false);
    expect(Object.keys(f.earnings as object)).toEqual(expect.arrayContaining(["lifetime", "today", "week", "month"]));
  });

  it("starts today's buckets from zero on a new day instead of adding to yesterday", () => {
    const now = at("2026-09-19T06:00:00Z");
    const yesterday = { earningsPeriod: istPeriods(at("2026-09-18T06:00:00Z")) };
    const f = earningsFields(yesterday, 50, now, { tip: 10 }) as any;
    expect(f.earnings.today).toBe(50); // absolute, not an increment
    expect(f.deliveriesToday).toBe(1);
    expect(f.tipsToday).toBe(10);
    expect(typeof f.earnings.week).not.toBe("number"); // same week → increment
    expect(f.earningsPeriod.day).toBe("2026-09-19");
  });

  it("never counts yesterday's trips toward today's quest", () => {
    const now = at("2026-09-19T06:00:00Z");
    expect(deliveriesSoFarToday({ deliveriesToday: 7, earningsPeriod: istPeriods(at("2026-09-18T06:00:00Z")) }, now)).toBe(0);
    expect(deliveriesSoFarToday({ deliveriesToday: 7 }, now)).toBe(0); // legacy, never-reset counter
    expect(deliveriesSoFarToday({ deliveriesToday: 3, earningsPeriod: istPeriods(now) }, now)).toBe(3);
    expect(samePeriods(undefined, istPeriods(now))).toEqual({ day: false, week: false, month: false });
  });

  it("finds the stray fields the old writers created", () => {
    expect(strayEarningsFields({ earnings: {}, "earnings.today": 5, "earnings.lifetime": 9, cashInHand: 1 }).sort())
      .toEqual(["earnings.lifetime", "earnings.today"]);
  });
});

describe("rebuilding from the ledger", () => {
  it("sums lifetime, today, week and month; counts trips (not quest bonuses) and tips", () => {
    const now = at("2026-09-19T12:00:00Z");
    const t = totalsFromLedger(
      [
        { id: "o1", total: 60, tip: 10, createdAt: at("2026-09-19T05:00:00Z") }, // today
        { id: "quest_2026-09-19", total: 150, tip: 0, createdAt: at("2026-09-19T09:00:00Z") }, // today, bonus
        { id: "o2", total: 40, tip: 0, createdAt: at("2026-09-15T05:00:00Z") }, // this week
        { id: "o3", total: 30, tip: 0, createdAt: at("2026-09-02T05:00:00Z") }, // this month
        { id: "o4", total: 20, tip: 0, createdAt: at("2026-08-20T05:00:00Z") }, // earlier
        { id: "o5", total: 5, tip: 0, createdAt: null }, // no timestamp: lifetime only
      ],
      now,
    );
    expect(t.lifetime).toBe(305);
    expect(t.today).toBe(210);
    expect(t.week).toBe(250);
    expect(t.month).toBe(280);
    expect(t.deliveriesToday).toBe(1);
    expect(t.tipsToday).toBe(10);
  });
});

describe("no writer uses dotted earnings keys in set()", () => {
  for (const file of ["delivery.ts", "operations.ts", "fixEarnings.ts"]) {
    it(file, () => {
      const src = readFileSync(join(__dirname, "..", "src", file), "utf8");
      // Dotted keys are fine in update() (reset jobs); never as increments in set().
      expect(src).not.toMatch(/"earnings\.(today|week|month|lifetime)":\s*(admin\.firestore\.)?FieldValue\.increment/);
    });
  }

  it("the repair callable is admin-only", () => {
    const src = readFileSync(join(__dirname, "..", "src", "fixEarnings.ts"), "utf8");
    expect(src).toMatch(/assertAdmin\(request\)/);
  });
});
