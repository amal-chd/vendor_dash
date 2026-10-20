import { describe, it, expect } from "vitest";
import { randomDigits } from "../src/giftcards";

// randomDigits mints gift-card codes. It must always return exactly n decimal
// digits — a short or non-numeric code would break redemption / collide.
describe("randomDigits", () => {
  it("returns exactly n characters", () => {
    for (const n of [1, 4, 6, 12, 16, 32]) {
      expect(randomDigits(n)).toHaveLength(n);
    }
  });

  it("returns only decimal digits 0-9", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomDigits(16)).toMatch(/^[0-9]+$/);
    }
  });

  it("produces varied output (no constant/degenerate codes)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(randomDigits(16));
    // 200 draws from a 10^16 space should essentially never collide.
    expect(seen.size).toBe(200);
  });
});
