import { describe, it, expect } from "vitest";
import {
  currencySymbol,
  currencyLocale,
  formatMoney,
  getTaxLabel,
} from "../lib/currency";

describe("currency helpers", () => {
  it("resolves correct symbols", () => {
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("AED")).toBe("د.إ");
    expect(currencySymbol(null)).toBe("₹");
  });

  it("resolves correct locales", () => {
    expect(currencyLocale("INR")).toBe("en-IN");
    expect(currencyLocale("USD")).toBe("en-US");
    expect(currencyLocale("GBP")).toBe("en-GB");
    expect(currencyLocale(null)).toBe("en-IN");
  });

  it("formats money accurately for INR and foreign currencies", () => {
    expect(formatMoney(1500, "INR")).toBe("₹1,500");
    expect(formatMoney(25.5, "USD")).toBe("$25.50");
    expect(formatMoney(100.99, "EUR")).toBe("€100,99");
    expect(formatMoney(NaN, "USD")).toBe("$0");
  });

  it("resolves tax labels by country code", () => {
    expect(getTaxLabel("IN")).toBe("GST");
    expect(getTaxLabel("US")).toBe("Sales Tax");
    expect(getTaxLabel("CA")).toBe("GST/HST");
    expect(getTaxLabel("GB")).toBe("VAT");
    expect(getTaxLabel("AE")).toBe("VAT");
    expect(getTaxLabel("UNKNOWN")).toBe("Tax");
  });
});
