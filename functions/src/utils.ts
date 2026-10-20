import * as admin from "firebase-admin";

const LOCALES: Record<string, string> = {
  "INR": "en-IN",
  "USD": "en-US",
  "EUR": "de-DE",
  "GBP": "en-GB",
  "AED": "ar-AE",
  "SGD": "en-SG",
  "CAD": "en-CA",
  "AUD": "en-AU",
  "SAR": "ar-SA",
  "QAR": "ar-QA",
  "MYR": "ms-MY",
  "ZAR": "en-ZA"
};

const SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "د.إ",
  SGD: "S$",
  CAD: "CA$",
  AUD: "A$",
  SAR: "﷼",
  QAR: "﷼",
  MYR: "RM",
  ZAR: "R"
};

export function getTimezoneOffset(timeZone: string, date: Date = new Date()): number {
  try {
    const tzFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false
    });
    const utcFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false
    });
    
    const tzParts = tzFormatter.formatToParts(date);
    const utcParts = utcFormatter.formatToParts(date);
    
    const getVal = (parts: Intl.DateTimeFormatPart[], type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);
    
    const tzYear = getVal(tzParts, "year");
    const tzMonth = getVal(tzParts, "month");
    const tzDay = getVal(tzParts, "day");
    const tzHour = getVal(tzParts, "hour");
    const tzMinute = getVal(tzParts, "minute");
    
    const utcYear = getVal(utcParts, "year");
    const utcMonth = getVal(utcParts, "month");
    const utcDay = getVal(utcParts, "day");
    const utcHour = getVal(utcParts, "hour");
    const utcMinute = getVal(utcParts, "minute");
    
    const tzMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute);
    const utcMs = Date.UTC(utcYear, utcMonth - 1, utcDay, utcHour, utcMinute);
    
    return tzMs - utcMs;
  } catch (err) {
    return 330 * 60 * 1000; // Default to Asia/Kolkata (+5:30) offset
  }
}

export function getRestaurantLocalDetails(date: Date, timeZone: string) {
  const offset = getTimezoneOffset(timeZone, date);
  const localTime = new Date(date.getTime() + offset);
  
  const yyyy = localTime.getUTCFullYear();
  const mm = String(localTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(localTime.getUTCDate()).padStart(2, "0");
  const dateString = `${yyyy}-${mm}-${dd}`;
  const hour = localTime.getUTCHours();
  
  return { hour, dateString };
}

export function getRestaurantDayRangeUtc(dateString: string, timeZone: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  
  const localMidnightMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const estUtcDate = new Date(localMidnightMs);
  const offset = getTimezoneOffset(timeZone, estUtcDate);
  
  const startUtc = new Date(localMidnightMs - offset);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  
  return { startUtc, endUtc };
}

export function formatMoney(amount: number, currencyCode?: string | null): string {
  const code = (currencyCode || "INR").toUpperCase();
  const symbol = SYMBOLS[code] ?? "₹";
  const locale = LOCALES[code] ?? "en-IN";
  const isINR = code === "INR";
  const decimals = isINR ? 0 : 2;
  const v = Number(amount) || 0;
  
  return `${symbol}${v.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

export function _getCurrencyCode(currencyName: string): string {
  const match = currencyName.match(/\(([^)]+)\)/);
  return match ? match[1] : currencyName;
}
