import { describe, it, expect } from "vitest";
import { windowDecision } from "../src/rateLimit";

describe("fixed-window rate limit", () => {
  const MIN = 60_000;

  it("allows calls up to the limit, then refuses with a retry time", () => {
    let state = undefined as { count: number; windowStartMs: number } | undefined;
    for (let i = 0; i < 3; i++) {
      const d = windowDecision(state, 1_000, 3, MIN);
      expect(d.allowed).toBe(true);
      state = d.next;
    }
    const refused = windowDecision(state, 31_000, 3, MIN);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSec).toBe(30);
  });

  it("starts a fresh window once the old one has passed", () => {
    const d = windowDecision({ count: 3, windowStartMs: 0 }, MIN, 3, MIN);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ count: 1, windowStartMs: MIN });
  });

  it("recovers from a window stamped in the future (clock skew)", () => {
    expect(windowDecision({ count: 9, windowStartMs: 10 * MIN }, MIN, 3, MIN).allowed).toBe(true);
  });
});
