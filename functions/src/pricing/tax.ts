/**
 * GST engine for the central pricing engine.
 *
 * Tax treatment is DATA, never code: each priced component (food, packaging,
 * delivery, platform fee, stay nights, cleaning…) carries a tax category that
 * Finance configures: its GST rate, HSN/SAC, whether it is exempt, and who owes
 * the tax (the supplier, or the platform as an e-commerce operator collecting
 * on the supplier's behalf). This module only applies that configuration.
 *
 * Nothing here decides legal treatment. Default categories are seeded for
 * Finance to review and publish (see pricing/defaults.ts).
 */
import { allocate, mulDiv, type Bps, type Paise, type RoundingMode } from "./money";

/**
 * GST state codes of union territories WITHOUT a legislature, where the state
 * share is UTGST rather than SGST: Chandigarh (04), Dadra & Nagar Haveli and
 * Daman & Diu (25/26), Lakshadweep (31), Andaman & Nicobar Islands (35),
 * Ladakh (38). Delhi, Puducherry and J&K have legislatures and use SGST.
 */
export const UT_WITHOUT_LEGISLATURE: ReadonlySet<string> = new Set(["04", "25", "26", "31", "35", "38"]);

/** Two-digit GST state code, or "" when unknown. Accepts "7", "07", "07AAAA…" (a GSTIN). */
export function normaliseStateCode(v: unknown): string {
  const s = (v ?? "").toString().trim();
  const m = /^(\d{1,2})/.exec(s);
  if (!m) return "";
  return m[1].padStart(2, "0");
}

export type SupplyNature = "intra_state" | "inter_state";

/**
 * Intra-state when the supplier's state and the place of supply match,
 * inter-state when both are known and differ. When either is unknown the
 * configured fallback applies (Finance decides; default intra-state).
 */
export function supplyNature(
  supplierState: string,
  placeOfSupplyState: string,
  fallback: SupplyNature = "intra_state",
): SupplyNature {
  const a = normaliseStateCode(supplierState);
  const b = normaliseStateCode(placeOfSupplyState);
  if (!a || !b) return fallback;
  return a === b ? "intra_state" : "inter_state";
}

export interface TaxSlab {
  /** Upper bound of the per-unit value (e.g. per-night tariff); null = no limit. */
  upToPaise: Paise | null;
  rateBps: Bps;
}

export interface TaxCategory {
  id: string;
  label: string;
  /** Total GST rate in basis points (5% = 500). */
  rateBps: Bps;
  /**
   * Optional value-based slabs (e.g. hotel rooms taxed by per-night tariff).
   * When present, the rate is chosen by the unit value; rateBps is ignored.
   */
  slabs?: TaxSlab[];
  hsnSac?: string;
  /** Exempt / nil-rated: the taxable value is recorded, no tax is charged. */
  exempt?: boolean;
  /**
   * Who owes this tax: the supplier itself, or the platform as e-commerce
   * operator collecting on the supplier's behalf (e.g. section 9(5) supplies).
   */
  liability: "supplier" | "platform_eco";
}

export interface GstBreakup {
  taxable: Paise;
  rateBps: Bps;
  cgst: Paise;
  sgst: Paise;
  utgst: Paise;
  igst: Paise;
  total: Paise;
  nature: SupplyNature;
}

const ZERO_BREAKUP = (taxable: Paise, rateBps: Bps, nature: SupplyNature): GstBreakup => ({
  taxable, rateBps, cgst: 0, sgst: 0, utgst: 0, igst: 0, total: 0, nature,
});

/** Splits a known tax amount into its components so they sum exactly. */
function splitTax(tax: Paise, taxable: Paise, rateBps: Bps, nature: SupplyNature, placeState: string): GstBreakup {
  if (tax === 0) return ZERO_BREAKUP(taxable, rateBps, nature);
  if (nature === "inter_state") {
    return { taxable, rateBps, cgst: 0, sgst: 0, utgst: 0, igst: tax, total: tax, nature };
  }
  const [central, state] = allocate(tax, [1, 1]);
  const ut = UT_WITHOUT_LEGISLATURE.has(normaliseStateCode(placeState));
  return {
    taxable,
    rateBps,
    cgst: central,
    sgst: ut ? 0 : state,
    utgst: ut ? state : 0,
    igst: 0,
    total: tax,
    nature,
  };
}

/**
 * GST on a tax-EXCLUSIVE amount. Intra-state computes CGST and SGST/UTGST
 * separately at half the rate each (as invoiced); inter-state is one IGST.
 */
export function gstOnExclusive(
  taxable: Paise,
  category: TaxCategory,
  nature: SupplyNature,
  placeState: string,
  mode: RoundingMode = "half_up",
): GstBreakup {
  if (category.exempt || category.rateBps <= 0 || taxable === 0) {
    return ZERO_BREAKUP(taxable, category.exempt ? 0 : category.rateBps, nature);
  }
  if (nature === "inter_state") {
    return splitTax(mulDiv(taxable, category.rateBps, 10_000, mode), taxable, category.rateBps, nature, placeState);
  }
  const half = mulDiv(taxable, category.rateBps, 20_000, mode);
  const ut = UT_WITHOUT_LEGISLATURE.has(normaliseStateCode(placeState));
  return {
    taxable,
    rateBps: category.rateBps,
    cgst: half,
    sgst: ut ? 0 : half,
    utgst: ut ? half : 0,
    igst: 0,
    total: half * 2,
    nature,
  };
}

/**
 * GST carved out of a tax-INCLUSIVE amount. The gross never changes:
 * taxable = gross × 10000 / (10000 + rate), tax = gross − taxable, and the tax
 * is split so its parts sum exactly.
 */
export function gstOnInclusive(
  gross: Paise,
  category: TaxCategory,
  nature: SupplyNature,
  placeState: string,
  mode: RoundingMode = "half_up",
): GstBreakup {
  if (category.exempt || category.rateBps <= 0 || gross === 0) {
    return ZERO_BREAKUP(gross, category.exempt ? 0 : category.rateBps, nature);
  }
  const taxable = mulDiv(gross, 10_000, 10_000 + category.rateBps, mode);
  return splitTax(gross - taxable, taxable, category.rateBps, nature, placeState);
}

/** The category with its rate resolved for a unit value (slab-based categories). */
export function categoryAtValue(category: TaxCategory, unitValuePaise: Paise): TaxCategory {
  if (!category.slabs || category.slabs.length === 0) return category;
  const ordered = [...category.slabs].sort((a, b) =>
    a.upToPaise == null ? 1 : b.upToPaise == null ? -1 : a.upToPaise - b.upToPaise,
  );
  const slab = ordered.find((s) => s.upToPaise == null || unitValuePaise <= s.upToPaise) ?? ordered[ordered.length - 1];
  return { ...category, rateBps: slab.rateBps };
}

/** Adds breakups together (for invoice totals per rate or per supplier). */
export function sumBreakups(parts: readonly GstBreakup[]): Omit<GstBreakup, "rateBps" | "nature"> {
  return parts.reduce(
    (acc, p) => ({
      taxable: acc.taxable + p.taxable,
      cgst: acc.cgst + p.cgst,
      sgst: acc.sgst + p.sgst,
      utgst: acc.utgst + p.utgst,
      igst: acc.igst + p.igst,
      total: acc.total + p.total,
    }),
    { taxable: 0, cgst: 0, sgst: 0, utgst: 0, igst: 0, total: 0 },
  );
}

/** Loose GSTIN shape check (15 chars: state code, PAN, entity, Z, checksum). */
export function looksLikeGstin(v: unknown): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test((v ?? "").toString().trim().toUpperCase());
}
