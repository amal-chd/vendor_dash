import { describe, it, expect } from "vitest";
import {
  allocate,
  applyBps,
  divide,
  formatInr,
  mulDiv,
  roundToStep,
  rupeesToPaise,
} from "../src/pricing/money";
import {
  gstOnExclusive,
  gstOnInclusive,
  looksLikeGstin,
  normaliseStateCode,
  supplyNature,
  type TaxCategory,
} from "../src/pricing/tax";

describe("money in paise", () => {
  it("converts legacy rupees without float drift", () => {
    expect(rupeesToPaise(1.005)).toBe(101);
    expect(rupeesToPaise(199.99)).toBe(19999);
    expect(rupeesToPaise("12.5")).toBe(1250);
    expect(rupeesToPaise("abc")).toBe(0);
  });

  it("divides with explicit rounding modes, including negatives", () => {
    expect(divide(5, 2, "half_up")).toBe(3);
    expect(divide(5, 2, "half_even")).toBe(2);
    expect(divide(7, 2, "half_even")).toBe(4);
    expect(divide(5, 2, "down")).toBe(2);
    expect(divide(1, 3, "up")).toBe(1);
    expect(divide(-5, 2, "half_up")).toBe(-3);
  });

  it("applies basis points exactly, even for very large amounts", () => {
    expect(applyBps(10_000, 500)).toBe(500);
    expect(applyBps(333, 1800)).toBe(60); // 59.94 → 60
    expect(mulDiv(9_000_000_000_000, 1800, 10_000)).toBe(1_620_000_000_000);
  });

  it("allocates so parts always sum to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1001, [2500, 7500])).toEqual([250, 751]);
    expect(allocate(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
    expect(allocate(7, [0, 0])).toEqual([4, 3]);
    const parts = allocate(99_999, [123, 456, 789, 1011]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(99_999);
  });

  it("rounds to a rupee step", () => {
    expect(roundToStep(57_249, 100)).toBe(57_200);
    expect(roundToStep(57_250, 100)).toBe(57_300);
    expect(roundToStep(57_250, 100, "half_even")).toBe(57_200);
  });

  it("formats rupees for display", () => {
    expect(formatInr(57_200)).toBe("₹572.00");
    expect(formatInr(12_345_678)).toBe("₹1,23,456.78");
    expect(formatInr(-5_000)).toBe("−₹50.00");
  });
});

describe("GST", () => {
  const food: TaxCategory = { id: "restaurant_food", label: "Restaurant food", rateBps: 500, liability: "platform_eco" };
  const service: TaxCategory = { id: "platform_service", label: "Platform service", rateBps: 1800, liability: "supplier" };
  const exempt: TaxCategory = { id: "exempt", label: "Exempt", rateBps: 0, exempt: true, liability: "supplier" };

  it("splits intra-state GST into CGST and SGST", () => {
    const g = gstOnExclusive(50_000, food, "intra_state", "32");
    expect(g).toMatchObject({ taxable: 50_000, cgst: 1250, sgst: 1250, utgst: 0, igst: 0, total: 2500 });
  });

  it("charges IGST on inter-state supply", () => {
    const g = gstOnExclusive(50_000, food, "inter_state", "29");
    expect(g).toMatchObject({ cgst: 0, sgst: 0, igst: 2500, total: 2500 });
  });

  it("uses UTGST in a union territory without a legislature, SGST in Delhi", () => {
    expect(gstOnExclusive(10_000, service, "intra_state", "04")).toMatchObject({ cgst: 900, sgst: 0, utgst: 900 });
    expect(gstOnExclusive(10_000, service, "intra_state", "07")).toMatchObject({ cgst: 900, sgst: 900, utgst: 0 });
  });

  it("carves tax out of an inclusive price without changing the gross", () => {
    const g = gstOnInclusive(10_500, food, "intra_state", "32");
    expect(g.taxable).toBe(10_000);
    expect(g.total).toBe(500);
    expect(g.taxable + g.total).toBe(10_500);
    const odd = gstOnInclusive(10_001, service, "intra_state", "32");
    expect(odd.taxable + odd.total).toBe(10_001);
    expect(odd.cgst + odd.sgst).toBe(odd.total);
  });

  it("records exempt supplies with no tax", () => {
    expect(gstOnExclusive(20_000, exempt, "intra_state", "32")).toMatchObject({ taxable: 20_000, total: 0 });
  });

  it("works out supply nature from state codes and GSTINs", () => {
    expect(supplyNature("32AAAAA0000A1Z5", "32")).toBe("intra_state");
    expect(supplyNature("32", "29")).toBe("inter_state");
    expect(supplyNature("", "29")).toBe("intra_state");
    expect(supplyNature("", "29", "inter_state")).toBe("inter_state");
    expect(normaliseStateCode("7")).toBe("07");
  });

  it("recognises a GSTIN shape", () => {
    expect(looksLikeGstin("32ABCDE1234F1Z5")).toBe(true);
    expect(looksLikeGstin("not-a-gstin")).toBe(false);
  });
});
