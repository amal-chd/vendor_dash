import { describe, it, expect } from "vitest";
import { parseQty, isCompletedStatus } from "../src/operations";

// parseQty guards the inventory-deduction math (deducted = recipeQty * orderQty).
// A wrong fallback here silently corrupts stock levels, so pin the edge cases.
describe("parseQty", () => {
  it("returns finite numbers unchanged (including 0 and decimals)", () => {
    expect(parseQty(5)).toBe(5);
    expect(parseQty(0)).toBe(0);
    expect(parseQty(2.5)).toBe(2.5);
  });

  it("falls back to 1 for non-finite numbers", () => {
    expect(parseQty(NaN)).toBe(1);
    expect(parseQty(Infinity)).toBe(1);
    expect(parseQty(-Infinity)).toBe(1);
  });

  it("parses integer strings in base 10", () => {
    expect(parseQty("3")).toBe(3);
    expect(parseQty("10")).toBe(10);
    expect(parseQty("007")).toBe(7); // no accidental octal
  });

  it("truncates decimal strings via parseInt", () => {
    expect(parseQty("2.9")).toBe(2);
  });

  it("takes the leading integer of mixed strings", () => {
    expect(parseQty("10kg")).toBe(10);
  });

  it("falls back to 1 for unparseable / empty / undefined input", () => {
    expect(parseQty("abc")).toBe(1);
    expect(parseQty("")).toBe(1);
    expect(parseQty(undefined)).toBe(1);
  });
});

// isCompletedStatus decides whether an order triggers loyalty/stock side effects.
describe("isCompletedStatus", () => {
  it("is true for completed synonyms, case-insensitively", () => {
    expect(isCompletedStatus("completed")).toBe(true);
    expect(isCompletedStatus("Completed")).toBe(true);
    expect(isCompletedStatus("DONE")).toBe(true);
    expect(isCompletedStatus("delivered")).toBe(true);
  });

  it("is false for non-terminal or unknown statuses", () => {
    expect(isCompletedStatus("pending")).toBe(false);
    expect(isCompletedStatus("preparing")).toBe(false);
    expect(isCompletedStatus("")).toBe(false);
    expect(isCompletedStatus(null)).toBe(false);
    expect(isCompletedStatus(undefined)).toBe(false);
    expect(isCompletedStatus(123)).toBe(false);
  });
});
