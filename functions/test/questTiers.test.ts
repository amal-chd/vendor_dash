import { describe, it, expect } from "vitest";
import { awardedTodayFrom, parseQuestTiers, tiersToAward } from "../src/questTiers";

const ladder = parseQuestTiers({ questTiers: [{ trips: 15, bonus: 250 }, { trips: 8, bonus: 150 }, { trips: 20, bonus: 300 }] });

describe("parseQuestTiers", () => {
  it("sorts configured rungs", () => {
    expect(ladder.map((t) => t.trips)).toEqual([8, 15, 20]);
  });
  it("matches the rider app's legacy 40/75/100 ladder", () => {
    // quest_tier.dart: target 8, bonus 150 → (3,30) (6,83) (8,150)
    expect(parseQuestTiers({ questTarget: 8, questBonus: 150 })).toEqual([
      { trips: 3, bonus: 30 },
      { trips: 6, bonus: 83 },
      { trips: 8, bonus: 150 },
    ]);
  });
});

describe("tiersToAward", () => {
  it("pays the first rung at 8 trips (used to pay nothing until 20)", () => {
    expect(tiersToAward(ladder, 8, [])).toEqual([{ trips: 8, bonus: 150 }]);
  });
  it("pays each rung once a day; all three sum to what the app promises", () => {
    let paid: number[] = [];
    let total = 0;
    for (let n = 1; n <= 25; n++) {
      const due = tiersToAward(ladder, n, paid);
      paid = [...paid, ...due.map((t) => t.trips)];
      total += due.reduce((s, t) => s + t.bonus, 0);
    }
    expect(total).toBe(700);
  });
});

describe("awardedTodayFrom", () => {
  it("treats a legacy single-bonus payout today as every rung paid", () => {
    expect(awardedTodayFrom({ questAwardedDate: "2026-10-13" }, "2026-10-13", ladder)).toEqual([8, 15, 20]);
  });
  it("ignores yesterday", () => {
    expect(awardedTodayFrom({ questTiersAwardedDate: "2026-10-12", questTiersAwarded: [8] }, "2026-10-13", ladder)).toEqual([]);
  });
});

import { resolveModule } from "../src/featureFlags";

describe("resolveModule (same precedence as the customer app)", () => {
  it("feature_flags wins over config/platform", () => {
    expect(resolveModule("cashOnDelivery", { cashOnDelivery: true }, { codEnabled: false })).toBe(true);
    expect(resolveModule("wallet", { wallet: false }, { walletEnabled: true })).toBe(false);
  });
  it("falls back to the legacy platform field, then on", () => {
    expect(resolveModule("kadaGold", {}, { goldEnabled: false })).toBe(false);
    expect(resolveModule("giftCards", undefined, undefined)).toBe(true);
  });
});
