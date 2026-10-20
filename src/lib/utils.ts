import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
