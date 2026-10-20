/**
 * Refunds computed from an order's price snapshot, line by line.
 *
 * A refund used to be a single rupee amount typed by an admin, subtracted
 * from the restaurant's settlement basis whole. The snapshot says exactly what
 * the customer paid for each item (after discounts, with its GST), each
 * charge, the tip and the donation, and who was owed what — so a refund can be
 * planned the same way: which lines (and how many), which charges, tip,
 * donation. The plan reverses the matching GST, the restaurant's share, the
 * commission Kada keeps on it, and says what Kada itself funds.
 *
 * Earlier refunds are respected (quantities, charges, the running total), so
 * nothing can be refunded twice. Pure: no Firebase imports.
 */
import { mulDiv, type Paise } from "./money";
import type { ChargeKey, FoodQuote, TaxDetail } from "./food";

export interface FoodRefundRequest {
  /** Everything still refundable. */
  full?: boolean;
  lines?: { lineId: string; qty: number }[];
  charges?: ChargeKey[];
  tip?: boolean;
  donation?: boolean;
}

export interface FoodRefundHistory {
  refundedPaise: Paise;
  lineQty: Record<string, number>;
  charges: string[];
  tipRefunded: boolean;
  donationRefunded: boolean;
}

export const NO_REFUNDS: FoodRefundHistory = { refundedPaise: 0, lineQty: {}, charges: [], tipRefunded: false, donationRefunded: false };

export interface FoodRefundPlan {
  amountPaise: Paise;
  /** Customer-facing breakdown. */
  rows: { key: string; label: string; amountPaise: Paise }[];
  lines: { lineId: string; qty: number }[];
  charges: ChargeKey[];
  tip: boolean;
  donation: boolean;
  tax: {
    cgstPaise: Paise;
    sgstPaise: Paise;
    utgstPaise: Paise;
    igstPaise: Paise;
    totalPaise: Paise;
    /** GST the restaurant collected and no longer owes. */
    vendorPaise: Paise;
    /** GST Kada no longer owes under section 9(5). */
    platformEcoPaise: Paise;
    /** GST on Kada's own fees that is reversed. */
    platformOwnPaise: Paise;
  };
  /** Taken back from the restaurant's payout: its share of what's refunded, net of commission returned. */
  vendorClawbackPaise: Paise;
  /** Commission (with its GST) Kada gives back on the refunded items. */
  commissionReversalPaise: Paise;
  riderTipPaise: Paise;
  donationPaise: Paise;
  /** What Kada itself funds. */
  platformCostPaise: Paise;
  problems: string[];
  warnings: string[];
}

const share = (amount: Paise, part: number, whole: number): Paise =>
  whole > 0 && part > 0 ? mulDiv(amount, part, whole, "down") : 0;

export function planFoodRefund(
  q: FoodQuote,
  req: FoodRefundRequest,
  history: FoodRefundHistory = NO_REFUNDS,
): FoodRefundPlan {
  const problems: string[] = [];
  const warnings: string[] = [];
  const rows: FoodRefundPlan["rows"] = [];
  const tax = { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 0, totalPaise: 0, vendorPaise: 0, platformEcoPaise: 0, platformOwnPaise: 0 };
  let amount = 0;
  let vendorPart = 0; // restaurant's share of refunded value, before commission
  let vendorItemValue = 0; // the part commission was charged on
  const s = q.settlement;

  const reverseTax = (t: TaxDetail | null, part: number, whole: number) => {
    if (!t) return;
    tax.cgstPaise += share(t.cgst, part, whole);
    tax.sgstPaise += share(t.sgst, part, whole);
    tax.utgstPaise += share(t.utgst, part, whole);
    tax.igstPaise += share(t.igst, part, whole);
    const total = share(t.total, part, whole);
    tax.totalPaise += total;
    if (t.liability === "platform_eco") tax.platformEcoPaise += total;
    else if (t.supplier === "vendor") tax.vendorPaise += total;
    else tax.platformOwnPaise += total;
  };

  const remainingQty = (lineId: string) => {
    const line = q.lines.find((l) => l.lineId === lineId);
    return line ? line.qty - (history.lineQty[lineId] ?? 0) : 0;
  };
  const refundableCharges = q.charges.filter((c) => c.customerPaysPaise > 0 && !history.charges.includes(c.key));

  const wantLines = req.full
    ? q.lines.map((l) => ({ lineId: l.lineId, qty: remainingQty(l.lineId) })).filter((l) => l.qty > 0)
    : req.lines ?? [];
  const wantCharges = req.full ? refundableCharges.map((c) => c.key) : [...new Set(req.charges ?? [])];
  const wantTip = req.full ? !history.tipRefunded && q.totals.tipPaise > 0 : req.tip === true;
  const wantDonation = req.full ? !history.donationRefunded && q.totals.donationPaise > 0 : req.donation === true;

  // Kada-funded share of each line's cart discount: the restaurant is still owed it.
  const platformFundedByLine: Record<string, Paise> = {};
  for (const p of q.promotions) {
    const itemPlatform = share(p.platformFundedPaise, p.itemDiscountPaise, p.totalPaise);
    for (const [lineId, alloc] of Object.entries(p.lineAllocations)) {
      platformFundedByLine[lineId] = (platformFundedByLine[lineId] ?? 0) + share(itemPlatform, alloc, p.itemDiscountPaise);
    }
  }

  const planned: FoodRefundPlan["lines"] = [];
  for (const want of wantLines) {
    const line = q.lines.find((l) => l.lineId === want.lineId);
    const qty = Math.trunc(Number(want.qty));
    if (!line) {
      problems.push("One of the selected items isn't on this order.");
      continue;
    }
    if (!(qty >= 1)) {
      problems.push(`Choose how many ${line.name} to refund.`);
      continue;
    }
    const left = remainingQty(line.lineId);
    if (qty > left) {
      problems.push(left > 0 ? `Only ${left} of ${line.qty} × ${line.name} can still be refunded.` : `${line.name} has already been refunded.`);
      continue;
    }
    const paid = share(line.customerPaysPaise, qty, line.qty);
    amount += paid;
    rows.push({ key: `line:${line.lineId}`, label: `${qty} × ${line.name}`, amountPaise: paid });
    reverseTax(line.tax, qty, line.qty);
    const value = share((line.tax ? line.tax.taxable : line.netPaise) + (platformFundedByLine[line.lineId] ?? 0), qty, line.qty);
    vendorItemValue += value;
    vendorPart += value;
    if (line.tax && line.tax.liability !== "platform_eco" && line.tax.supplier === "vendor") {
      vendorPart += share(line.tax.total, qty, line.qty);
    }
    planned.push({ lineId: line.lineId, qty });
  }

  const plannedCharges: ChargeKey[] = [];
  for (const key of wantCharges) {
    const c = refundableCharges.find((x) => x.key === key);
    if (!c) {
      problems.push(history.charges.includes(key) ? `The ${key.replace(/_/g, " ")} has already been refunded.` : `The customer didn't pay a ${key.replace(/_/g, " ")} on this order.`);
      continue;
    }
    amount += c.customerPaysPaise;
    rows.push({ key: `charge:${c.key}`, label: c.label, amountPaise: c.customerPaysPaise });
    reverseTax(c.tax, 1, 1);
    if (c.key === "packaging" && s.packagingToVendorPaise > 0) {
      vendorPart += s.packagingToVendorPaise;
      if (c.tax && c.tax.liability !== "platform_eco" && c.tax.supplier === "vendor") vendorPart += c.tax.total;
    }
    plannedCharges.push(c.key);
  }

  let riderTip = 0;
  if (wantTip) {
    if (history.tipRefunded || q.totals.tipPaise <= 0) problems.push(history.tipRefunded ? "The tip has already been refunded." : "There was no tip on this order.");
    else {
      riderTip = q.totals.tipPaise;
      amount += riderTip;
      rows.push({ key: "tip", label: "Rider tip", amountPaise: riderTip });
    }
  }

  let donation = 0;
  if (wantDonation) {
    if (history.donationRefunded || q.totals.donationPaise <= 0) problems.push(history.donationRefunded ? "The donation has already been refunded." : "There was no donation on this order.");
    else {
      donation = q.totals.donationPaise;
      amount += donation;
      rows.push({ key: "donation", label: "Kada Cares donation", amountPaise: donation });
    }
  }

  // A full refund returns exactly what's left, including final rounding.
  const everythingLeft =
    q.lines.every((l) => remainingQty(l.lineId) === (planned.find((p) => p.lineId === l.lineId)?.qty ?? 0)) &&
    refundableCharges.every((c) => plannedCharges.includes(c.key)) &&
    (history.tipRefunded || q.totals.tipPaise <= 0 || riderTip > 0) &&
    (history.donationRefunded || q.totals.donationPaise <= 0 || donation > 0);
  if (everythingLeft && q.totals.roundingPaise !== 0 && amount > 0) {
    amount += q.totals.roundingPaise;
    rows.push({ key: "rounding", label: "Rounding", amountPaise: q.totals.roundingPaise });
  }

  const commissionTotal = s.commissionPaise + (s.commissionTax?.total ?? 0);
  const commissionReversal = Math.min(commissionTotal, share(commissionTotal, vendorItemValue, s.vendorItemsValuePaise));

  const remaining = q.totals.totalPaise - history.refundedPaise;
  if (remaining <= 0) problems.push("This order has already been fully refunded.");
  else if (amount > remaining) {
    warnings.push(`Limited to ₹${(remaining / 100).toFixed(2)}, what's left after earlier refunds.`);
    amount = remaining;
  }
  if (amount <= 0 && problems.length === 0) problems.push("Choose what to refund.");

  const vendorClawback = Math.max(0, vendorPart - commissionReversal);
  return {
    amountPaise: Math.max(0, amount),
    rows,
    lines: planned,
    charges: plannedCharges,
    tip: riderTip > 0,
    donation: donation > 0,
    tax,
    vendorClawbackPaise: vendorClawback,
    commissionReversalPaise: commissionReversal,
    riderTipPaise: riderTip,
    donationPaise: donation,
    platformCostPaise: Math.max(0, amount) - vendorClawback - riderTip - donation - tax.platformEcoPaise - tax.platformOwnPaise,
    problems,
    warnings,
  };
}

const CHARGE_KEYS: readonly string[] = ["packaging", "delivery", "surge", "platform_fee", "small_order_fee"];

/** A refund request from a callable payload, bounded and typed. */
export function sanitizeRefundRequest(data: Record<string, unknown>): FoodRefundRequest {
  const lines = Array.isArray(data.lines)
    ? data.lines.slice(0, 100).map((l) => {
        const x = (l ?? {}) as Record<string, unknown>;
        return { lineId: String(x.lineId ?? "").slice(0, 200), qty: Math.trunc(Number(x.qty) || 0) };
      })
    : undefined;
  const charges = Array.isArray(data.charges)
    ? data.charges.map(String).filter((c): c is ChargeKey => CHARGE_KEYS.includes(c))
    : undefined;
  return { full: data.full === true, lines, charges, tip: data.tip === true, donation: data.donation === true };
}

/** Whether a payload asks for an itemised refund rather than a plain amount. */
export function isItemisedRefund(data: Record<string, unknown>): boolean {
  return Array.isArray(data.lines) || Array.isArray(data.charges) || data.tip === true || data.donation === true || data.full === true;
}

/** The refund history an order carries, as written by applying earlier plans. */
export function refundHistoryOf(order: Record<string, unknown>): FoodRefundHistory {
  const lineQty = (order.refundedLineQty ?? {}) as Record<string, unknown>;
  return {
    refundedPaise: Math.round((Number(order.refundAmount) || 0) * 100),
    lineQty: Object.fromEntries(Object.entries(lineQty).map(([k, v]) => [k, Math.max(0, Math.trunc(Number(v) || 0))])),
    charges: Array.isArray(order.refundedCharges) ? order.refundedCharges.map(String) : [],
    tipRefunded: order.refundedTip === true,
    donationRefunded: order.refundedDonation === true,
  };
}

/** Order fields that record a plan as applied, merged onto what's already there. */
export function refundHistoryPatch(order: Record<string, unknown>, plan: FoodRefundPlan): Record<string, unknown> {
  const h = refundHistoryOf(order);
  const lineQty = { ...h.lineQty };
  for (const l of plan.lines) lineQty[l.lineId] = (lineQty[l.lineId] ?? 0) + l.qty;
  return {
    refundedLineQty: lineQty,
    refundedCharges: [...new Set([...h.charges, ...plan.charges])],
    refundedTip: h.tipRefunded || plan.tip,
    refundedDonation: h.donationRefunded || plan.donation,
    refundVendorClawbackPaise: (Number(order.refundVendorClawbackPaise) || 0) + plan.vendorClawbackPaise,
    refundCommissionReversalPaise: (Number(order.refundCommissionReversalPaise) || 0) + plan.commissionReversalPaise,
  };
}
