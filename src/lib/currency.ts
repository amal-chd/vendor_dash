/**
 * Centralized currency formatting. Restaurants set their currency in
 * onboarding/Settings (`currency` field on `restaurants/{uid}`), but the
 * dashboard previously hardcoded "₹" everywhere — a USD/EUR restaurant
 * still saw rupees on every total. Use the hook + helpers below to read
 * the active currency once and format consistently.
 */

const SYMBOLS: Record<string, string> = {
  "Indian Rupee (INR)": "₹",
  INR: "₹",
  "US Dollar (USD)": "$",
  USD: "$",
  "Euro (EUR)": "€",
  EUR: "€",
  "British Pound (GBP)": "£",
  GBP: "£",
  "UAE Dirham (AED)": "د.إ",
  AED: "د.إ",
  "Singapore Dollar (SGD)": "S$",
  SGD: "S$",
  "Canadian Dollar (CAD)": "CA$",
  CAD: "CA$",
  "Australian Dollar (AUD)": "A$",
  AUD: "A$",
  "Saudi Riyal (SAR)": "﷼",
  SAR: "﷼",
  "Qatari Riyal (QAR)": "﷼",
  QAR: "﷼",
  "Malaysian Ringgit (MYR)": "RM",
  MYR: "RM",
  "South African Rand (ZAR)": "R",
  ZAR: "R"
};

const LOCALES: Record<string, string> = {
  "Indian Rupee (INR)": "en-IN",
  INR: "en-IN",
  "US Dollar (USD)": "en-US",
  USD: "en-US",
  "Euro (EUR)": "de-DE",
  EUR: "de-DE",
  "British Pound (GBP)": "en-GB",
  GBP: "en-GB",
  "UAE Dirham (AED)": "ar-AE",
  AED: "ar-AE",
  "Singapore Dollar (SGD)": "en-SG",
  SGD: "en-SG",
  "Canadian Dollar (CAD)": "en-CA",
  CAD: "en-CA",
  "Australian Dollar (AUD)": "en-AU",
  AUD: "en-AU",
  "Saudi Riyal (SAR)": "ar-SA",
  SAR: "ar-SA",
  "Qatari Riyal (QAR)": "ar-QA",
  QAR: "ar-QA",
  "Malaysian Ringgit (MYR)": "ms-MY",
  MYR: "ms-MY",
  "South African Rand (ZAR)": "en-ZA",
  ZAR: "en-ZA"
};

export function currencySymbol(currency?: string | null): string {
  if (!currency) return "₹";
  return SYMBOLS[currency] ?? "₹";
}

export function currencyLocale(currency?: string | null): string {
  if (!currency) return "en-IN";
  return LOCALES[currency] ?? "en-IN";
}

/**
 * Format an amount with the restaurant's currency symbol + locale-aware
 * grouping. `minimumFractionDigits` defaults to 0 (matching the existing
 * ₹0-decimal display on the dashboard) but can be raised to 2 for USD/EUR
 * contexts where cents matter.
 */
export function formatMoney(
  amount: number,
  currency?: string | null,
  options?: { decimals?: number },
): string {
  const isINR = currency === "INR" || currency === "Indian Rupee (INR)" || !currency;
  const decimals = options?.decimals ?? (isINR ? 0 : 2);
  const locale = currencyLocale(currency);
  const symbol = currencySymbol(currency);
  if (!Number.isFinite(amount)) return `${symbol}0`;
  const formatted = amount.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted}`;
}

export function getTaxLabel(countryCode?: string | null): string {
  const code = (countryCode || "").toUpperCase();
  switch (code) {
    case "IN":
    case "AU":
    case "NZ":
    case "SG":
    case "MY":
      return "GST";
    case "US":
      return "Sales Tax";
    case "CA":
      return "GST/HST";
    case "GB":
    case "UK":
    case "AE":
    case "SA":
    case "ZA":
    case "QA":
      return "VAT";
    default:
      return "Tax";
  }
}

import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export function useCurrency() {
  const { activeRestaurantId } = useAuth();
  const [currencyCode, setCurrencyCode] = useState<string>("INR");
  const [country, setCountry] = useState<string>("IN");
  const [customTaxLabel, setCustomTaxLabel] = useState<string | null>(null);
  const [taxMethod, setTaxMethod] = useState<string>("exclusive");

  useEffect(() => {
    if (!activeRestaurantId) return;
    const fetchCurrency = async () => {
      const snap = await getDoc(doc(db, "restaurants", activeRestaurantId));
      if (snap.exists()) {
        const data = snap.data();
        if (data.currencyCode || data.currency) setCurrencyCode(data.currencyCode || data.currency);
        if (data.country) setCountry(data.country);
        setCustomTaxLabel(data.taxLabel || null);
        setTaxMethod(data.taxMethod || "exclusive");
      }
    };
    fetchCurrency();
  }, [activeRestaurantId]);

  const format = (amount: number, options?: { decimals?: number }) => {
    return formatMoney(amount, currencyCode, options);
  };

  const symbol = currencySymbol(currencyCode);
  const defaultTaxLabel = getTaxLabel(country);
  const taxLabel = customTaxLabel || defaultTaxLabel;
  const isGST = taxLabel === "GST";
  const locale = currencyLocale(currencyCode);

  return { format, currencyCode, symbol, country, taxLabel, isGST, locale, taxMethod };
}

/* ──────────────────────────────────────────────────────────────────────
 * Locale / date / time formatting
 * ──────────────────────────────────────────────────────────────────── */

const TIMEZONES: Record<string, string> = {
  IN: "Asia/Kolkata",
  US: "America/New_York",
  GB: "Europe/London",
  UK: "Europe/London",
  CA: "America/Toronto",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  SG: "Asia/Singapore",
  MY: "Asia/Kuala_Lumpur",
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  QA: "Asia/Qatar",
  ZA: "Africa/Johannesburg",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
};

function tzForCountry(country?: string | null): string {
  if (!country) return "Asia/Kolkata";
  return TIMEZONES[country.toUpperCase()] ?? "Asia/Kolkata";
}

/**
 * Locale-aware date / time formatting that reads the restaurant's country
 * + currency settings. Mirrors useCurrency so any timestamp shown in the
 * dashboard renders in the operator's timezone with their locale's
 * conventions (e.g. dd/mm/yyyy for IN, mm/dd/yyyy for US, 24h for EU).
 */
export function useLocale() {
  const { activeRestaurantId } = useAuth();
  const [currencyCode, setCurrencyCode] = useState<string>("INR");
  const [country, setCountry] = useState<string>("IN");
  const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRestaurantId) return;
    (async () => {
      const snap = await getDoc(doc(db, "restaurants", activeRestaurantId));
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.currencyCode || data.currency) {
        setCurrencyCode(data.currencyCode || data.currency);
      }
      if (data.country) setCountry(data.country);
      if (data.timezone) setTimezoneOverride(data.timezone);
    })();
  }, [activeRestaurantId]);

  const locale = currencyLocale(currencyCode);
  const timezone = timezoneOverride || tzForCountry(country);

  const toDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    const anyVal = value as { toDate?: () => Date; seconds?: number };
    if (anyVal?.toDate) return anyVal.toDate();
    if (typeof anyVal?.seconds === "number") return new Date(anyVal.seconds * 1000);
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  const formatDate = (value: unknown, opts?: Intl.DateTimeFormatOptions) => {
    const d = toDate(value);
    if (!d) return "—";
    return d.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone,
      ...opts,
    });
  };

  const formatTime = (value: unknown, opts?: Intl.DateTimeFormatOptions) => {
    const d = toDate(value);
    if (!d) return "—";
    return d.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
      ...opts,
    });
  };

  const formatDateTime = (value: unknown, opts?: Intl.DateTimeFormatOptions) => {
    const d = toDate(value);
    if (!d) return "—";
    return d.toLocaleString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
      ...opts,
    });
  };

  const formatNumber = (value: number, opts?: Intl.NumberFormatOptions) => {
    if (!Number.isFinite(value)) return "0";
    return value.toLocaleString(locale, opts);
  };

  /** "2 minutes ago", "3 hours ago" — relative to now, locale-aware. */
  const formatRelative = (value: unknown) => {
    const d = toDate(value);
    if (!d) return "—";
    const diffMs = d.getTime() - Date.now();
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const abs = Math.abs(diffMs);
    if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), "second");
    if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
    if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
    if (abs < 30 * 86_400_000) return rtf.format(Math.round(diffMs / 86_400_000), "day");
    return formatDate(d);
  };

  return {
    locale,
    timezone,
    country,
    formatDate,
    formatTime,
    formatDateTime,
    formatNumber,
    formatRelative,
  };
}
