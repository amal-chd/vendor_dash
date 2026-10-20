import { describe, it, expect } from "vitest";
import { resolveCartLines } from "../src/pricing/foodLoader";

// 12:30 IST.
const LUNCH = Date.UTC(2026, 8, 14, 7, 0);

const menu = {
  biryani: {
    restaurantId: "r1", name: "Biryani", price: 250, category: "Main Course",
    variants: [{ name: "Full", price: 320 }], addons: [{ name: "Raita", price: 30 }], packagingCharge: 5,
  },
  lassi: { restaurantId: "r1", name: "Lassi", price: 90, happyHourPrice: 60, happyFrom: "12:00", happyTo: "15:00", taxCategoryId: "beverages" },
  gone: { restaurantId: "r1", name: "Payasam", price: 70, isAvailable: false },
  other: { restaurantId: "r2", name: "Pizza", price: 300 },
};

describe("cart lines come from the live menu, in paise", () => {
  it("prices variants, add-ons and happy hour server-side; ignores client prices entirely", () => {
    const { lines, problems } = resolveCartLines(
      [
        { menuItemId: "biryani", qty: 2, selectedVariant: { name: "Full" }, selectedAddons: [{ name: "Raita" }] },
        { menuItemId: "lassi", qty: 1 },
      ],
      menu, "r1", LUNCH,
    );
    expect(problems).toEqual([]);
    expect(lines[0]).toMatchObject({ name: "Biryani (Full)", unitPaise: 32_000, qty: 2, categoryId: "main_course", packagingPaise: 500 });
    expect(lines[0].modifiers).toEqual([{ name: "Raita", unitPaise: 3_000 }]);
    expect(lines[1]).toMatchObject({ unitPaise: 6_000, taxCategoryId: "beverages" });
  });

  it("refuses sold-out, foreign, removed and unknown-option items", () => {
    const { lines, problems } = resolveCartLines(
      [
        { menuItemId: "gone", qty: 1 },
        { menuItemId: "other", qty: 1 },
        { menuItemId: "missing", qty: 1 },
        { menuItemId: "biryani", qty: 1, selectedVariant: { name: "Family" } },
        { menuItemId: "biryani", qty: 1, selectedAddons: [{ name: "Gold leaf" }] },
      ],
      menu, "r1", LUNCH,
    );
    expect(lines).toEqual([]);
    expect(problems).toHaveLength(5);
  });
});
