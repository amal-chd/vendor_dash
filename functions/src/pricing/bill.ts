/**
 * ─────────────────────────────────────────────────────────────────────────
 * Bills, as people read them — built from a food quote / price snapshot.
 *
 *   customerBill  Swiggy/Zomato-style "Bill details": item total, delivery
 *                 fee with distance, surge, platform and small-cart fees,
 *                 one "GST & restaurant charges" row with its breakdown,
 *                 each coupon by name, tip, donation, To pay, and what the
 *                 customer saved. Never shows commission or anyone's share.
 *   vendorBill    The restaurant's payout statement for one order: food
 *                 value, packaging, GST collected, commission and its GST,
 *                 anything the restaurant funded, and the payout.
 *
 * Both are presentation only: every amount comes from the quote, and each
 * bill proves its rows add up to the engine's own total before it is used.
 * A bill that doesn't add up returns null and callers fall back to
 * `quote.display`, so a formatting bug can never show a wrong amount.
 *
 * Pure: no Firebase imports.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { FoodQuote, TaxableKey } from "./food";

export interface BillRow {
  key: string;
  label: string;
  /** Signed: what this row adds to (or takes off) the total. */
  amountPaise: number;
  /** The price before a waiver or discount, shown struck through. */
  originalPaise?: number;
  /** Fully waived: render "FREE". */
  free?: boolean;
  /** Small caption under the label ("3.2 km", "Add ₹40 more to remove"). */
  note?: string;
  /** Longer explanation behind an ⓘ. */
  info?: string;
  /** Breakdown of this row. Already counted in amountPaise — never added again. */
  children?: BillRow[];
}

export interface CustomerBill {
  version: 1;
  rows: BillRow[];
  totalPaise: number;
  /** Discounts + waived fees. 0 when nothing was saved. */
  savingsPaise: number;
}

export interface VendorBill {
  version: 1;
  rows: BillRow[];
  payoutPaise: number;
  /** Informational lines that are already reflected above (not added). */
  memos: BillRow[];
}

const rupees = (paise: number) => {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r : r.toFixed(2)}`;
};

const pct = (bps: number) => {
  const v = bps / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
};

/** Which GST line a taxed component belongs to on the customer's bill. */
const TAX_GROUP: Record<TaxableKey, { key: string; label: string } | null> = {
  items: { key: "gst_food", label: "GST on food" },
  packaging: { key: "gst_packaging", label: "GST on packaging" },
  delivery: { key: "gst_delivery", label: "GST on delivery fee" },
  surge: { key: "gst_delivery", label: "GST on delivery fee" },
  platform_fee: { key: "gst_platform", label: "GST on platform fee" },
  small_order_fee: { key: "gst_platform", label: "GST on platform fee" },
  commission: null, // the restaurant's cost, never the customer's
};

const sum = (rows: BillRow[]) => rows.reduce((s, r) => s + r.amountPaise, 0);

export function customerBill(q: FoodQuote): CustomerBill | null {
  const t = q.totals;
  if (!t || !Number.isSafeInteger(t.totalPaise)) return null;
  const rows: BillRow[] = [];
  let savings = 0;

  // Items. Menu offers come off the item total (shown struck through); coupons
  // and campaign offers each get their own line below.
  const menuOff = t.itemDiscountPaise;
  const inclusiveTax = q.taxes.details.some((d) => d.inclusive && d.total > 0 && d.component === "items");
  rows.push({
    key: "items",
    label: "Item total",
    amountPaise: t.itemsGrossPaise - menuOff,
    ...(menuOff > 0 ? { originalPaise: t.itemsGrossPaise } : {}),
    ...(inclusiveTax ? { note: "Prices include GST" } : {}),
  });
  savings += menuOff;

  // Charges the customer pays (packaging is shown inside the GST row).
  const charge = (key: string) => q.charges.find((c) => c.key === key && c.fundedBy === "customer");
  const isDelivery = q.fulfilment === "delivery";
  const distance = q.hints?.distanceKm;

  const pushCharge = (key: "delivery" | "surge" | "platform_fee" | "small_order_fee", label: string, extra: Partial<BillRow> = {}) => {
    const c = charge(key);
    const gross = c?.grossPaise ?? 0;
    const waived = c?.waivedPaise ?? 0;
    if (gross <= 0 && !(key === "delivery" && isDelivery)) return;
    const net = gross - waived;
    savings += waived;
    rows.push({
      key,
      label,
      amountPaise: net,
      ...(waived > 0 ? { originalPaise: gross } : {}),
      ...(net === 0 ? { free: true } : {}),
      ...extra,
    });
  };

  if (isDelivery) {
    pushCharge("delivery", "Delivery fee", distance != null ? { note: `${distance.toFixed(1)} km` } : {});
  }
  pushCharge("surge", "Surge fee", { info: "Added while demand is high, so a delivery partner can reach you sooner." });
  pushCharge("platform_fee", "Platform fee", { info: "Helps us run Kada — app, support and secure payments." });
  const small = q.hints?.smallOrder;
  const shortBy = small ? small.belowPaise - small.basisPaise : 0;
  pushCharge("small_order_fee", "Small cart fee", shortBy > 0 ? { note: `Add ${rupees(shortBy)} more to remove` } : {});

  // GST & restaurant charges: packaging plus every GST not already inside a price.
  const children: BillRow[] = [];
  const pkg = charge("packaging");
  const pkgNet = (pkg?.grossPaise ?? 0) - (pkg?.waivedPaise ?? 0);
  if (pkg && pkg.grossPaise > 0) {
    savings += pkg.waivedPaise;
    children.push({
      key: "packaging",
      label: "Restaurant packaging",
      amountPaise: pkgNet,
      ...(pkg.waivedPaise > 0 ? { originalPaise: pkg.grossPaise } : {}),
      ...(pkgNet === 0 ? { free: true } : {}),
    });
  }
  const groups = new Map<string, BillRow & { rates: Set<number> }>();
  for (const d of q.taxes.details) {
    if (d.inclusive || d.total <= 0) continue;
    const g = TAX_GROUP[d.component];
    if (!g) continue;
    const row = groups.get(g.key) ?? { key: g.key, label: g.label, amountPaise: 0, rates: new Set<number>() };
    row.amountPaise += d.total;
    row.rates.add(d.rateBps);
    groups.set(g.key, row);
  }
  for (const { rates, ...row } of groups.values()) {
    children.push(rates.size === 1 ? { ...row, label: `${row.label} (${pct([...rates][0])})` } : row);
  }
  const gstTotal = sum(children);
  if (gstTotal > 0 || children.some((c) => c.free)) {
    rows.push({
      key: "gst_charges",
      label: pkgNet > 0 ? "GST & restaurant charges" : "GST",
      amountPaise: gstTotal,
      info: "GST is collected as required by law and paid to the government.",
      children,
    });
  }

  // Coupons and campaign offers, each by name.
  const promoRows = q.promotions
    .filter((p) => p.itemDiscountPaise > 0)
    .map((p) => ({
      key: `promo_${p.ruleId}`,
      label: p.code ? `Coupon · ${p.code}` : p.label || "Offer",
      amountPaise: -p.itemDiscountPaise,
    }));
  if (sum(promoRows) === -t.cartDiscountPaise) rows.push(...promoRows);
  else if (t.cartDiscountPaise > 0) rows.push({ key: "discount", label: "Offers", amountPaise: -t.cartDiscountPaise });
  savings += t.cartDiscountPaise;

  if (t.tipPaise > 0) rows.push({ key: "tip", label: "Delivery partner tip", amountPaise: t.tipPaise, note: "100% goes to your delivery partner" });
  if (t.donationPaise > 0) rows.push({ key: "donation", label: "Kada Cares donation", amountPaise: t.donationPaise });
  if (t.roundingPaise !== 0) rows.push({ key: "rounding", label: "Rounding", amountPaise: t.roundingPaise });

  // The bill must add up to what the engine charges, to the paisa.
  if (sum(rows) !== t.totalPaise) return null;
  return { version: 1, rows, totalPaise: t.totalPaise, savingsPaise: savings };
}

export function vendorBill(q: FoodQuote): VendorBill | null {
  const s = q.settlement;
  if (!s || !Number.isSafeInteger(s.vendorPayoutPaise)) return null;
  const rows: BillRow[] = [];
  const memos: BillRow[] = [];
  const platformFunded = s.vendorItemsValuePaise - q.lines.reduce((a, l) => a + (l.tax ? l.tax.taxable : l.netPaise), 0);

  rows.push({
    key: "food",
    label: "Food value",
    amountPaise: s.vendorItemsValuePaise,
    note: "After discounts you fund, before GST",
    ...(platformFunded > 0 ? { info: `Includes ${rupees(platformFunded)} of Kada-funded offers, paid to you in full.` } : {}),
  });
  if (s.packagingToVendorPaise > 0) rows.push({ key: "packaging", label: "Packaging charges", amountPaise: s.packagingToVendorPaise });
  if (s.vendorTaxCollectedPaise > 0) {
    rows.push({
      key: "gst_collected",
      label: "GST collected for you",
      amountPaise: s.vendorTaxCollectedPaise,
      info: "Collected from the customer; you file and pay it.",
    });
  }

  const fixed = s.commissionFixedPaise ?? 0;
  if (s.commissionPaise > 0) {
    const rate = s.commissionBps && !fixed ? ` (${pct(s.commissionBps)})` : "";
    rows.push({ key: "commission", label: `Kada commission${rate}`, amountPaise: -s.commissionPaise });
  } else if (s.commissionWaived) {
    rows.push({ key: "commission", label: "Kada commission", amountPaise: 0, free: true, note: "Waived — you're on a subscription plan" });
  }
  if (s.commissionTax && s.commissionTax.total > 0) {
    rows.push({ key: "commission_gst", label: `GST on commission (${pct(s.commissionTax.rateBps)})`, amountPaise: -s.commissionTax.total });
  }
  if (s.vendorFundedDeliveryPaise > 0) {
    rows.push({ key: "delivery_funded", label: "Free delivery you offered", amountPaise: -s.vendorFundedDeliveryPaise });
  }
  const waivers = s.vendorFundedWaiversPaise ?? Math.max(0, s.vendorFundedDiscountPaise - (s.vendorFundedItemsPaise ?? s.vendorFundedDiscountPaise));
  if (waivers > 0) rows.push({ key: "waivers_funded", label: "Fees you waived for the customer", amountPaise: -waivers });

  const items = s.vendorFundedItemsPaise ?? 0;
  if (items > 0) memos.push({ key: "offers_funded", label: "Your offers on this order", amountPaise: items, note: "Already taken off the food value" });

  if (sum(rows) !== s.vendorPayoutPaise) return null;
  return { version: 1, rows, payoutPaise: s.vendorPayoutPaise, memos };
}
