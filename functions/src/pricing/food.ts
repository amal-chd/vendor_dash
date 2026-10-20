/**
 * ─────────────────────────────────────────────────────────────────────────
 * Food order pricing: the ONE authoritative calculation.
 *
 * Customer checkout, the vendor's order view, rider earnings, admin views,
 * settlements and the pricing simulator all read the quote this produces.
 * No app computes an authoritative price.
 *
 * Everything is integer paise and driven by versioned rules (pricing/rules.ts):
 * packaging, delivery, capped surge, platform and small-order fees, GST per
 * component, promotions and coupons, rounding, commission, rider earnings.
 * The pipeline order is itself a rule, validated against legal constraints.
 *
 * The quote is also the order's permanent PRICE SNAPSHOT: it records every
 * line, charge, waiver, tax split and the exact rule versions used, so later
 * rule changes never alter a historical order.
 *
 * Accounting identity (enforced by tests):
 *   customer total = vendor payout + rider earning + platform revenue
 *                    + platform tax liability + donation
 * ─────────────────────────────────────────────────────────────────────────
 */
import { applyBps, clampPaise, mulDiv, roundToStep, type Bps, type Paise, type RoundingMode } from "./money";
import {
  gstOnExclusive,
  gstOnInclusive,
  supplyNature,
  type GstBreakup,
  type SupplyNature,
  type TaxCategory,
} from "./tax";
import {
  DEFAULT_PIPELINE,
  applicableRules,
  validatePipeline,
  winningRule,
  type AnyRule,
  type PipelineStep,
  type PricingRule,
  type ScopeContext,
} from "./rules";
import { resolvePromotions, type AppliedPromotion, type PromotionParams, type WaivableFee } from "./promotions";

export const FOOD_ENGINE_VERSION = "food-2026.09.14";

export type ChargeKey = "packaging" | "delivery" | "surge" | "platform_fee" | "small_order_fee";
export type TaxableKey = "items" | ChargeKey | "commission";

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface FoodCartLine {
  lineId: string;
  menuItemId: string;
  name: string;
  categoryId: string;
  qty: number;
  /** Base unit price resolved from the live menu (variant / happy hour). */
  unitPaise: Paise;
  modifiers: { name: string; unitPaise: Paise }[];
  /** The menu item's own discount, if any. */
  itemDiscountBps?: Bps;
  /** Item-level packaging per unit, from the menu. */
  packagingPaise?: Paise | null;
  /** Item-level tax category override, from the menu. */
  taxCategoryId?: string | null;
}

export interface FoodQuoteInput {
  at: number;
  customer: {
    uid: string;
    completedOrders: number;
    isNew: boolean;
    referred?: boolean;
    isGold: boolean;
    stateCode: string;
  };
  vendor: {
    id: string;
    name: string;
    stateCode: string;
    gstin: string | null;
    pricesIncludeTax: boolean;
    packagingPaise: Paise | null;
    /** Subscription-billed merchants pay no commission. */
    commissionWaived: boolean;
  };
  platform: { gstin: string | null; stateCode: string };
  fulfilment: "delivery" | "pickup";
  /** Express delivery chosen at checkout: adds the delivery rule's express charge. */
  express?: boolean;
  zoneId: string | null;
  distanceKm: number | null;
  demand: { activeOrders: number; availableRiders: number } | null;
  /** Operational flag (e.g. heavy rain) set per zone by Operations. */
  weatherAlert: boolean;
  minOrderPaise: Paise | null;
  lines: FoodCartLine[];
  couponCode: string | null;
  tipPaise: Paise;
  donationPaise: Paise;
  promoUsage: { total: Record<string, number>; byCustomer: Record<string, number> };
}

// ── Rule params ─────────────────────────────────────────────────────────────

export interface PackagingParams {
  mode: "per_order" | "per_item" | "per_quantity" | "percent";
  amountPaise?: Paise;
  bps?: Bps;
  maxPaise?: Paise;
  /** Honour item-level packaging from the menu when present. */
  useItemLevel?: boolean;
  /** Honour the vendor's own default packaging charge, capped. */
  useVendorDefault?: boolean;
  vendorMaxPaise?: Paise;
}

export interface DeliveryFeeParams {
  basePaise: Paise;
  perKmPaise: Paise;
  freeUnderMeters?: number;
  minFeePaise?: Paise;
  maxFeePaise?: Paise;
  freeAbovePaise?: Paise;
  longDistanceOverMeters?: number;
  longDistanceSurchargePaise?: Paise;
  specialAreaSurchargePaise?: Paise;
  goldFree?: boolean;
  /** Added for express delivery, after the free-delivery and Gold waivers. */
  expressPaise?: Paise;
  fundedBy?: "customer" | "vendor" | "platform";
}

export interface SurgeParams {
  multiplierBps?: Bps;
  flatPaise?: Paise;
  maxMultiplierBps: Bps;
  maxAddPaise: Paise;
  /** Orders per available rider (×100) at or above which a multiplier applies. */
  demandTiers?: { minOrdersPerRiderX100: number; multiplierBps: Bps }[];
  weatherAddPaise?: Paise;
  applyWhenDeliveryFree?: boolean;
  /** Kada Gold members pay no surge. */
  goldWaived?: boolean;
  /** Share of the surge passed to the rider (default 100%). */
  riderShareBps?: Bps;
}

export interface PlatformFeeParams {
  mode: "fixed" | "percent" | "tiered";
  amountPaise?: Paise;
  bps?: Bps;
  tiers?: { upToPaise: Paise | null; amountPaise?: Paise; bps?: Bps }[];
  minPaise?: Paise;
  maxPaise?: Paise;
  goldWaived?: boolean;
}

export interface SmallOrderFeeParams {
  belowPaise: Paise;
  amountPaise: Paise;
}

export interface CommissionParams {
  bps?: Bps;
  fixedPaise?: Paise;
  minPaise?: Paise;
  maxPaise?: Paise;
  includePackaging?: boolean;
}

export interface RiderEarningParams {
  basePaise: Paise;
  perKmPaise: Paise;
  minPaise?: Paise;
  incentivePaise?: Paise;
  longDistanceOverMeters?: number;
  longDistanceBonusPaise?: Paise;
}

export interface TaxAssignmentParams {
  component: TaxableKey;
  taxCategoryId: string;
  inclusive?: boolean;
  supplier?: "vendor" | "platform";
  placeOfSupply?: "supplier_state" | "customer_state";
}

export interface RoundingParams {
  lineMode?: RoundingMode;
  taxMode?: RoundingMode;
  finalStepPaise?: number;
  finalMode?: RoundingMode;
}

// ── Output (the price snapshot) ─────────────────────────────────────────────

export interface TaxDetail extends GstBreakup {
  taxCategoryId: string;
  liability: TaxCategory["liability"];
  supplier: "vendor" | "platform";
  inclusive: boolean;
  placeOfSupplyState: string;
}

export interface QuoteLine {
  lineId: string;
  menuItemId: string;
  name: string;
  categoryId: string;
  qty: number;
  unitPaise: Paise;
  modifierUnitPaise: Paise;
  grossPaise: Paise;
  itemDiscountPaise: Paise;
  cartDiscountPaise: Paise;
  netPaise: Paise;
  tax: TaxDetail | null;
  customerPaysPaise: Paise;
}

export interface QuoteCharge {
  key: ChargeKey;
  label: string;
  grossPaise: Paise;
  waivedPaise: Paise;
  netPaise: Paise;
  fundedBy: "customer" | "vendor" | "platform";
  tax: TaxDetail | null;
  customerPaysPaise: Paise;
  ruleId: string | null;
}

export interface FoodTotals {
  itemsGrossPaise: Paise;
  itemDiscountPaise: Paise;
  cartDiscountPaise: Paise;
  packagingPaise: Paise;
  deliveryPaise: Paise;
  surgePaise: Paise;
  platformFeePaise: Paise;
  smallOrderFeePaise: Paise;
  taxPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  utgstPaise: Paise;
  igstPaise: Paise;
  tipPaise: Paise;
  donationPaise: Paise;
  roundingPaise: Paise;
  totalPaise: Paise;
}

export interface FoodSettlement {
  vendorItemsValuePaise: Paise;
  packagingToVendorPaise: Paise;
  vendorTaxCollectedPaise: Paise;
  commissionPaise: Paise;
  commissionTax: TaxDetail | null;
  vendorFundedDiscountPaise: Paise;
  vendorFundedDeliveryPaise: Paise;
  vendorPayoutPaise: Paise;
  rider: {
    basePaise: Paise;
    distancePaise: Paise;
    surgeSharePaise: Paise;
    incentivePaise: Paise;
    tipPaise: Paise;
    totalPaise: Paise;
  };
  platformFundedDiscountPaise: Paise;
  platformRevenuePaise: Paise;
  taxLiability: { vendorPaise: Paise; platformEcoPaise: Paise; platformOwnPaise: Paise };
  /** Explanatory detail for the restaurant's payout statement (pricing/bill.ts). */
  commissionBps?: Bps | null;
  commissionFixedPaise?: Paise;
  commissionWaived?: boolean;
  vendorFundedItemsPaise?: Paise;
  vendorFundedWaiversPaise?: Paise;
}

export interface DisplayRow {
  key: string;
  label: string;
  amountPaise: Paise;
}

export interface FoodQuote {
  engineVersion: string;
  currency: "INR";
  quotedAt: number;
  fulfilment: "delivery" | "pickup";
  lines: QuoteLine[];
  charges: QuoteCharge[];
  promotions: AppliedPromotion[];
  couponProblem: string | null;
  taxes: {
    details: (TaxDetail & { component: TaxableKey; lineId: string | null })[];
    sellerGstin: string | null;
    platformGstin: string | null;
    customerStateCode: string;
    vendorStateCode: string;
  };
  totals: FoodTotals;
  display: DisplayRow[];
  settlement: FoodSettlement;
  ruleVersions: Record<string, number>;
  problems: string[];
  warnings: string[];
  /** Facts the customer bill explains (distance, small-cart threshold). Never amounts. */
  hints?: {
    distanceKm: number | null;
    smallOrder: { belowPaise: Paise; basisPaise: Paise } | null;
  };
}

const CHARGE_LABELS: Record<ChargeKey, string> = {
  packaging: "Packaging",
  delivery: "Delivery fee",
  surge: "Surge",
  platform_fee: "Platform fee",
  small_order_fee: "Small order fee",
};

const STEP_OF: Record<ChargeKey, PipelineStep> = {
  packaging: "packaging",
  delivery: "delivery",
  surge: "surge",
  platform_fee: "platform_fee",
  small_order_fee: "small_order_fee",
};

// ── Engine ──────────────────────────────────────────────────────────────────

export function quoteFood(input: FoodQuoteInput, rules: readonly AnyRule[]): FoodQuote {
  const problems: string[] = [];
  const warnings: string[] = [];
  const ruleVersions: Record<string, number> = {};
  const use = (r: AnyRule | null | undefined) => {
    if (r) ruleVersions[r.ruleId] = r.version;
    return r ?? null;
  };

  const categoryIds = [...new Set(input.lines.map((l) => l.categoryId).filter(Boolean))];
  const base: ScopeContext = {
    product: "food",
    at: input.at,
    zoneId: input.zoneId,
    vendorId: input.vendor.id,
    categoryIds,
    orderPaise: null,
  };
  const withOrder = (orderPaise: Paise): ScopeContext => ({ ...base, orderPaise });
  const winner = <P>(kind: PricingRule["kind"], ctx: ScopeContext) =>
    use(winningRule<P>(rules, kind, ctx) as unknown as PricingRule) as PricingRule<P> | null;

  // Rounding + pipeline
  const roundingRule = winner<RoundingParams>("rounding", base);
  const rounding = {
    lineMode: roundingRule?.params.lineMode ?? "half_up",
    taxMode: roundingRule?.params.taxMode ?? "half_up",
    finalStepPaise: roundingRule?.params.finalStepPaise ?? 0,
    finalMode: roundingRule?.params.finalMode ?? "half_up",
  } as Required<RoundingParams>;

  let steps: readonly PipelineStep[] = DEFAULT_PIPELINE;
  const pipelineRule = winningRule<{ steps: string[] }>(rules, "pipeline", base);
  if (pipelineRule) {
    const issues = validatePipeline(pipelineRule.params.steps ?? []);
    if (issues.length === 0) {
      steps = pipelineRule.params.steps as PipelineStep[];
      use(pipelineRule);
    } else {
      warnings.push(`Pipeline rule "${pipelineRule.ruleId}" is invalid and was ignored: ${issues.join(" ")}`);
    }
  }
  const beforeCartDiscount = (s: PipelineStep) => steps.indexOf(s) < steps.indexOf("cart_discounts");

  // Tax categories
  const taxCategories = new Map<string, TaxCategory>();
  for (const r of applicableRules<TaxCategory>(rules, "tax_category", base)) {
    if (!taxCategories.has(r.params.id)) {
      taxCategories.set(r.params.id, r.params);
      use(r);
    }
  }

  // ── Items, modifiers, item discounts ──────────────────────────────────────
  const lines: QuoteLine[] = [];
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > 100) {
      problems.push(`${l.name}: quantity must be between 1 and 100.`);
      continue;
    }
    if (!Number.isSafeInteger(l.unitPaise) || l.unitPaise < 0) {
      problems.push(`${l.name}: price is invalid.`);
      continue;
    }
    const modifierUnit = l.modifiers.reduce((s, m) => s + Math.max(0, m.unitPaise), 0);
    const gross = (l.unitPaise + modifierUnit) * l.qty;
    const itemDiscount = l.itemDiscountBps ? Math.min(gross, applyBps(gross, l.itemDiscountBps, rounding.lineMode)) : 0;
    lines.push({
      lineId: l.lineId,
      menuItemId: l.menuItemId,
      name: l.name,
      categoryId: l.categoryId,
      qty: l.qty,
      unitPaise: l.unitPaise,
      modifierUnitPaise: modifierUnit,
      grossPaise: gross,
      itemDiscountPaise: itemDiscount,
      cartDiscountPaise: 0,
      netPaise: gross - itemDiscount,
      tax: null,
      customerPaysPaise: 0,
    });
  }
  if (input.lines.length === 0) problems.push("The cart is empty.");

  const itemsGross = lines.reduce((s, l) => s + l.grossPaise, 0);
  const itemDiscount = lines.reduce((s, l) => s + l.itemDiscountPaise, 0);
  const itemsNetPre = itemsGross - itemDiscount;
  if (input.minOrderPaise != null && itemsNetPre < input.minOrderPaise) {
    problems.push(`Add ₹${Math.ceil((input.minOrderPaise - itemsNetPre) / 100)} more to reach the minimum order.`);
  }

  // ── Charges (computed from a basis; pre- or post-cart-discount by position) ─
  const isDelivery = input.fulfilment === "delivery";
  const meters = input.distanceKm != null && Number.isFinite(input.distanceKm) ? Math.max(0, Math.round(input.distanceKm * 1000)) : null;

  function packaging(basis: Paise): { gross: Paise; rule: PricingRule<PackagingParams> | null } {
    const rule = winningRule<PackagingParams>(rules, "packaging", withOrder(basis));
    if (!rule) return { gross: 0, rule: null };
    const p = rule.params;
    let amount = 0;
    const itemLevel = lines.reduce((s, l) => {
      const src = input.lines.find((x) => x.lineId === l.lineId);
      return s + (src?.packagingPaise ?? 0) * l.qty;
    }, 0);
    if (p.useItemLevel && itemLevel > 0) amount = itemLevel;
    else if (p.useVendorDefault && input.vendor.packagingPaise != null) {
      amount = clampPaise(input.vendor.packagingPaise, 0, p.vendorMaxPaise ?? null);
    } else if (p.mode === "per_order") amount = p.amountPaise ?? 0;
    else if (p.mode === "per_item") amount = (p.amountPaise ?? 0) * lines.length;
    else if (p.mode === "per_quantity") amount = (p.amountPaise ?? 0) * lines.reduce((s, l) => s + l.qty, 0);
    else if (p.mode === "percent") amount = applyBps(basis, p.bps ?? 0, rounding.lineMode);
    return { gross: clampPaise(amount, 0, p.maxPaise ?? null), rule };
  }

  function delivery(basis: Paise): { gross: Paise; baseForSurge: Paise; fundedBy: QuoteCharge["fundedBy"]; rule: PricingRule<DeliveryFeeParams> | null } {
    if (!isDelivery) return { gross: 0, baseForSurge: 0, fundedBy: "customer", rule: null };
    const rule = winningRule<DeliveryFeeParams>(rules, "delivery_fee", withOrder(basis));
    if (!rule) return { gross: 0, baseForSurge: 0, fundedBy: "customer", rule: null };
    const p = rule.params;
    const m = meters ?? 0;
    const extra = Math.max(0, m - (p.freeUnderMeters ?? 0));
    let fee = p.basePaise + mulDiv(extra, p.perKmPaise, 1000, rounding.lineMode);
    if (p.freeUnderMeters != null && m <= p.freeUnderMeters) fee = 0;
    if (p.longDistanceOverMeters != null && m > p.longDistanceOverMeters) fee += p.longDistanceSurchargePaise ?? 0;
    fee += p.specialAreaSurchargePaise ?? 0;
    const baseForSurge = fee;
    if (p.freeAbovePaise != null && basis >= p.freeAbovePaise) fee = 0;
    if (p.goldFree && input.customer.isGold) fee = 0;
    if (fee > 0) fee = clampPaise(fee, p.minFeePaise ?? null, p.maxFeePaise ?? null);
    if (input.express && (p.expressPaise ?? 0) > 0) fee += p.expressPaise ?? 0;
    return { gross: fee, baseForSurge, fundedBy: p.fundedBy ?? "customer", rule };
  }

  function surge(deliveryGross: Paise, baseForSurge: Paise, basis: Paise): { gross: Paise; rule: PricingRule<SurgeParams> | null } {
    if (!isDelivery) return { gross: 0, rule: null };
    const rule = winningRule<SurgeParams>(rules, "surge", withOrder(basis));
    if (!rule) return { gross: 0, rule: null };
    const p = rule.params;
    if (p.goldWaived && input.customer.isGold) return { gross: 0, rule };
    if (deliveryGross === 0 && !p.applyWhenDeliveryFree) return { gross: 0, rule };
    let mult = p.multiplierBps ?? 10_000;
    if (p.demandTiers && input.demand) {
      const ratio = input.demand.availableRiders > 0
        ? Math.floor((input.demand.activeOrders * 100) / input.demand.availableRiders)
        : Number.MAX_SAFE_INTEGER;
      for (const t of p.demandTiers) if (ratio >= t.minOrdersPerRiderX100) mult = Math.max(mult, t.multiplierBps);
    }
    mult = Math.min(Math.max(mult, 10_000), p.maxMultiplierBps);
    let amount = mulDiv(baseForSurge, mult - 10_000, 10_000, rounding.lineMode) + (p.flatPaise ?? 0);
    if (input.weatherAlert) amount += p.weatherAddPaise ?? 0;
    return { gross: clampPaise(amount, 0, p.maxAddPaise), rule };
  }

  function platformFee(basis: Paise): { gross: Paise; rule: PricingRule<PlatformFeeParams> | null } {
    const rule = winningRule<PlatformFeeParams>(rules, "platform_fee", withOrder(basis));
    if (!rule) return { gross: 0, rule: null };
    const p = rule.params;
    if (p.goldWaived && input.customer.isGold) return { gross: 0, rule };
    let fee = 0;
    if (p.mode === "fixed") fee = p.amountPaise ?? 0;
    else if (p.mode === "percent") fee = applyBps(basis, p.bps ?? 0, rounding.lineMode);
    else {
      const tier = (p.tiers ?? []).find((t) => t.upToPaise == null || basis <= t.upToPaise);
      if (tier) fee = (tier.amountPaise ?? 0) + applyBps(basis, tier.bps ?? 0, rounding.lineMode);
    }
    return { gross: clampPaise(fee, p.minPaise ?? null, p.maxPaise ?? null), rule };
  }

  function smallOrderFee(basis: Paise): { gross: Paise; rule: PricingRule<SmallOrderFeeParams> | null } {
    const rule = winningRule<SmallOrderFeeParams>(rules, "small_order_fee", withOrder(basis));
    if (!rule) return { gross: 0, rule: null };
    return { gross: basis < rule.params.belowPaise ? rule.params.amountPaise : 0, rule };
  }

  // Phase A: provisional charges on the pre-discount basis, for promotion context.
  const provDelivery = delivery(itemsNetPre);
  const provision = {
    packaging: packaging(itemsNetPre).gross,
    platform_fee: platformFee(itemsNetPre).gross,
    small_order_fee: smallOrderFee(itemsNetPre).gross,
  };

  const promo = resolvePromotions(rules as unknown as PricingRule<PromotionParams>[], {
    scope: withOrder(itemsNetPre),
    customer: {
      completedOrders: input.customer.completedOrders,
      isNew: input.customer.isNew,
      referred: input.customer.referred,
      isGold: input.customer.isGold,
    },
    couponCode: input.couponCode,
    usage: input.promoUsage,
    lines: lines.map((l) => ({ lineId: l.lineId, menuItemId: l.menuItemId, categoryId: l.categoryId, netPaise: l.netPaise })),
    deliveryPaise: provDelivery.fundedBy === "customer" ? provDelivery.gross : 0,
    fees: provision,
  });
  for (const a of promo.applied) {
    use(rules.find((r) => r.ruleId === a.ruleId && r.version === a.version));
    for (const [lineId, amt] of Object.entries(a.lineAllocations)) {
      const line = lines.find((l) => l.lineId === lineId);
      if (line) {
        line.cartDiscountPaise += amt;
        line.netPaise -= amt;
      }
    }
  }
  const cartDiscount = lines.reduce((s, l) => s + l.cartDiscountPaise, 0);
  const itemsNetPost = itemsNetPre - cartDiscount;
  const basisFor = (k: ChargeKey) => (beforeCartDiscount(STEP_OF[k]) ? itemsNetPre : itemsNetPost);

  // Phase B: final charges on their positional basis, then waivers.
  const dlv = delivery(basisFor("delivery"));
  const computed: Record<ChargeKey, { gross: Paise; rule: PricingRule | null; fundedBy: QuoteCharge["fundedBy"] }> = {
    packaging: { ...packaging(basisFor("packaging")), fundedBy: "customer" } as never,
    delivery: { gross: dlv.gross, rule: dlv.rule as never, fundedBy: dlv.fundedBy },
    surge: { ...surge(dlv.gross, dlv.baseForSurge, basisFor("surge")), fundedBy: "customer" } as never,
    platform_fee: { ...platformFee(basisFor("platform_fee")), fundedBy: "customer" } as never,
    small_order_fee: { ...smallOrderFee(basisFor("small_order_fee")), fundedBy: "customer" } as never,
  };

  const waived: Record<ChargeKey, Paise> = { packaging: 0, delivery: 0, surge: 0, platform_fee: 0, small_order_fee: 0 };
  let vendorFundedWaivers = 0;
  let platformFundedWaivers = 0;
  let vendorFundedItems = 0;
  let platformFundedItems = 0;
  for (const a of promo.applied) {
    const share = (amt: Paise) => (a.totalPaise > 0 ? mulDiv(amt, a.vendorFundedPaise, a.totalPaise, "half_up") : 0);
    const itemVendor = share(a.itemDiscountPaise);
    vendorFundedItems += itemVendor;
    platformFundedItems += a.itemDiscountPaise - itemVendor;

    const add = (key: ChargeKey, want: Paise) => {
      const room = computed[key].fundedBy === "customer" ? computed[key].gross - waived[key] : 0;
      const got = Math.max(0, Math.min(want, room));
      waived[key] += got;
      const v = share(got);
      vendorFundedWaivers += v;
      platformFundedWaivers += got - v;
    };
    add("delivery", a.deliveryWaivedPaise);
    for (const [fee, amt] of Object.entries(a.feesWaived)) add(fee as WaivableFee, amt ?? 0);
  }

  // ── Taxes ─────────────────────────────────────────────────────────────────
  const assignments = applicableRules<TaxAssignmentParams>(rules, "tax_assignment", base);
  const assignmentFor = (component: TaxableKey, categoryId?: string) => {
    const pool = categoryId
      ? applicableRules<TaxAssignmentParams>(rules, "tax_assignment", { ...base, categoryIds: [categoryId] })
      : assignments;
    return pool.find((r) => r.params.component === component) ?? null;
  };

  const taxDetails: FoodQuote["taxes"]["details"] = [];
  function taxOn(
    component: TaxableKey,
    amount: Paise,
    lineId: string | null,
    categoryId?: string,
    overrideCategoryId?: string | null,
    forceInclusive = false,
  ): TaxDetail | null {
    if (amount <= 0) return null;
    const a = assignmentFor(component, categoryId);
    use(a);
    const catId = overrideCategoryId ?? a?.params.taxCategoryId ?? null;
    const cat = catId ? taxCategories.get(catId) : undefined;
    if (!cat) {
      warnings.push(`No tax rule covers ${component}${lineId ? ` (${lineId})` : ""}; it was treated as untaxed.`);
      return null;
    }
    const supplier = a?.params.supplier ?? (component === "items" || component === "packaging" ? "vendor" : "platform");
    const supplierState = supplier === "vendor" ? input.vendor.stateCode : input.platform.stateCode;
    const place = (a?.params.placeOfSupply ?? "supplier_state") === "customer_state" ? input.customer.stateCode : supplierState;
    const nature: SupplyNature = supplyNature(supplierState, place);
    const inclusive = forceInclusive || a?.params.inclusive === true;
    const breakup = inclusive
      ? gstOnInclusive(amount, cat, nature, place, rounding.taxMode)
      : gstOnExclusive(amount, cat, nature, place, rounding.taxMode);
    const detail: TaxDetail = { ...breakup, taxCategoryId: cat.id, liability: cat.liability, supplier, inclusive, placeOfSupplyState: place };
    if (component !== "commission") taxDetails.push({ ...detail, component, lineId });
    return detail;
  }

  for (const l of lines) {
    const src = input.lines.find((x) => x.lineId === l.lineId);
    l.tax = taxOn("items", l.netPaise, l.lineId, l.categoryId, src?.taxCategoryId ?? null, input.vendor.pricesIncludeTax);
    l.customerPaysPaise = l.netPaise + (l.tax && !l.tax.inclusive ? l.tax.total : 0);
  }

  const charges: QuoteCharge[] = (Object.keys(CHARGE_LABELS) as ChargeKey[])
    .filter((k) => computed[k].gross > 0 || waived[k] > 0)
    .map((k) => {
      const c = computed[k];
      use(c.rule);
      const net = c.fundedBy === "customer" ? c.gross - waived[k] : 0;
      const tax = taxOn(k, net, null);
      return {
        key: k,
        label: CHARGE_LABELS[k],
        grossPaise: c.gross,
        waivedPaise: waived[k],
        netPaise: net,
        fundedBy: c.fundedBy,
        tax,
        customerPaysPaise: net + (tax && !tax.inclusive ? tax.total : 0),
        ruleId: c.rule?.ruleId ?? null,
      };
    });

  // ── Totals + rounding ─────────────────────────────────────────────────────
  const tip = Math.max(0, input.tipPaise);
  const donation = Math.max(0, input.donationPaise);
  const allTax = taxDetails;
  const sumTax = (f: keyof GstBreakup) => allTax.reduce((s, t) => s + (t[f] as number), 0);
  const beforeRounding =
    lines.reduce((s, l) => s + l.customerPaysPaise, 0) + charges.reduce((s, c) => s + c.customerPaysPaise, 0) + tip + donation;
  const total = roundToStep(beforeRounding, rounding.finalStepPaise, rounding.finalMode);
  const roundingAdj = total - beforeRounding;
  const chargeNet = (k: ChargeKey) => charges.find((c) => c.key === k)?.netPaise ?? 0;

  const totals: FoodTotals = {
    itemsGrossPaise: itemsGross,
    itemDiscountPaise: itemDiscount,
    cartDiscountPaise: cartDiscount,
    packagingPaise: chargeNet("packaging"),
    deliveryPaise: chargeNet("delivery"),
    surgePaise: chargeNet("surge"),
    platformFeePaise: chargeNet("platform_fee"),
    smallOrderFeePaise: chargeNet("small_order_fee"),
    taxPaise: sumTax("total"),
    cgstPaise: sumTax("cgst"),
    sgstPaise: sumTax("sgst"),
    utgstPaise: sumTax("utgst"),
    igstPaise: sumTax("igst"),
    tipPaise: tip,
    donationPaise: donation,
    roundingPaise: roundingAdj,
    totalPaise: total,
  };

  // ── Settlement ────────────────────────────────────────────────────────────
  const taxable = (t: TaxDetail | null, amount: Paise) => (t ? t.taxable : amount);
  const itemsTaxable = lines.reduce((s, l) => s + taxable(l.tax, l.netPaise), 0);
  const vendorItemsValue = itemsTaxable + platformFundedItems;

  const pkg = charges.find((c) => c.key === "packaging");
  const pkgToVendor = pkg && (pkg.tax?.supplier ?? "vendor") === "vendor" ? taxable(pkg.tax, pkg.netPaise) : 0;

  let vendorTax = 0;
  let ecoTax = 0;
  let platformOwnTax = 0;
  for (const t of allTax) {
    if (t.liability === "platform_eco") ecoTax += t.total;
    else if (t.supplier === "vendor") vendorTax += t.total;
    else platformOwnTax += t.total;
  }

  const commissionRule = input.vendor.commissionWaived
    ? null
    : winner<CommissionParams>("commission", withOrder(itemsNetPost));
  let commission = 0;
  if (commissionRule) {
    const p = commissionRule.params;
    const basis = vendorItemsValue + (p.includePackaging ? pkgToVendor : 0);
    commission = clampPaise(applyBps(basis, p.bps ?? 0, rounding.lineMode) + (p.fixedPaise ?? 0), p.minPaise ?? null, p.maxPaise ?? null);
    commission = Math.min(commission, basis);
  }
  const commissionTax = commission > 0 ? taxOn("commission", commission, null) : null;
  if (commissionTax) platformOwnTax += commissionTax.total;

  const vendorFundedDelivery = computed.delivery.fundedBy === "vendor" ? computed.delivery.gross : 0;
  const platformFundedDelivery = computed.delivery.fundedBy === "platform" ? computed.delivery.gross : 0;
  const vendorPayout =
    vendorItemsValue + pkgToVendor + vendorTax - commission - (commissionTax?.total ?? 0) - vendorFundedDelivery - vendorFundedWaivers;

  let riderBase = 0;
  let riderDistance = 0;
  let riderIncentive = 0;
  let riderSurge = 0;
  if (isDelivery) {
    const rr = winner<RiderEarningParams>("rider_earning", withOrder(itemsNetPost));
    if (rr) {
      riderBase = rr.params.basePaise;
      riderDistance = mulDiv(meters ?? 0, rr.params.perKmPaise, 1000, rounding.lineMode);
      riderIncentive = rr.params.incentivePaise ?? 0;
      if (rr.params.longDistanceOverMeters != null && (meters ?? 0) > rr.params.longDistanceOverMeters) {
        riderIncentive += rr.params.longDistanceBonusPaise ?? 0;
      }
      const min = rr.params.minPaise ?? 0;
      if (riderBase + riderDistance + riderIncentive < min) riderBase += min - (riderBase + riderDistance + riderIncentive);
    }
    const surgeCharge = computed.surge;
    const shareBps = (surgeCharge.rule as PricingRule<SurgeParams> | null)?.params.riderShareBps ?? 10_000;
    riderSurge = applyBps(chargeNet("surge") + waived.surge, shareBps, "down");
  }
  const riderNoTip = riderBase + riderDistance + riderIncentive + riderSurge;

  const platformSideTaxable = charges
    .filter((c) => c.key !== "packaging" || pkgToVendor === 0)
    .reduce((s, c) => s + taxable(c.tax, c.netPaise), 0);
  const platformRevenue =
    platformSideTaxable + commission + vendorFundedDelivery + vendorFundedWaivers - riderNoTip - platformFundedItems - platformFundedDelivery + roundingAdj;

  const settlement: FoodSettlement = {
    vendorItemsValuePaise: vendorItemsValue,
    packagingToVendorPaise: pkgToVendor,
    vendorTaxCollectedPaise: vendorTax,
    commissionPaise: commission,
    commissionTax,
    vendorFundedDiscountPaise: vendorFundedItems + vendorFundedWaivers,
    vendorFundedDeliveryPaise: vendorFundedDelivery,
    vendorPayoutPaise: vendorPayout,
    rider: {
      basePaise: riderBase,
      distancePaise: riderDistance,
      surgeSharePaise: riderSurge,
      incentivePaise: riderIncentive,
      tipPaise: tip,
      totalPaise: riderNoTip + tip,
    },
    platformFundedDiscountPaise: platformFundedItems + platformFundedWaivers,
    platformRevenuePaise: platformRevenue,
    taxLiability: { vendorPaise: vendorTax, platformEcoPaise: ecoTax, platformOwnPaise: platformOwnTax },
    commissionBps: commissionRule?.params.bps ?? null,
    commissionFixedPaise: commissionRule?.params.fixedPaise ?? 0,
    commissionWaived: input.vendor.commissionWaived,
    vendorFundedItemsPaise: vendorFundedItems,
    vendorFundedWaiversPaise: vendorFundedWaivers,
  };

  // ── Customer-facing breakdown (never exposes commission) ──────────────────
  const display: DisplayRow[] = [{ key: "subtotal", label: "Item total", amountPaise: itemsGross }];
  if (itemDiscount + cartDiscount > 0) display.push({ key: "discount", label: "Discounts", amountPaise: -(itemDiscount + cartDiscount) });
  for (const c of charges) {
    if (c.fundedBy !== "customer") continue;
    display.push({ key: c.key, label: c.label, amountPaise: c.grossPaise });
    if (c.waivedPaise > 0) display.push({ key: `${c.key}_waiver`, label: `${c.label} waived`, amountPaise: -c.waivedPaise });
  }
  const exclusiveTax = allTax.filter((t) => !t.inclusive).reduce((s, t) => s + t.total, 0);
  if (exclusiveTax > 0) display.push({ key: "tax", label: "Taxes", amountPaise: exclusiveTax });
  if (tip > 0) display.push({ key: "tip", label: "Delivery partner tip", amountPaise: tip });
  if (donation > 0) display.push({ key: "donation", label: "Donation", amountPaise: donation });
  if (roundingAdj !== 0) display.push({ key: "rounding", label: "Rounding", amountPaise: roundingAdj });
  display.push({ key: "total", label: "To pay", amountPaise: total });

  return {
    engineVersion: FOOD_ENGINE_VERSION,
    currency: "INR",
    quotedAt: input.at,
    fulfilment: input.fulfilment,
    lines,
    charges,
    promotions: promo.applied,
    couponProblem: promo.couponProblem,
    taxes: {
      details: taxDetails,
      sellerGstin: input.vendor.gstin,
      platformGstin: input.platform.gstin,
      customerStateCode: input.customer.stateCode,
      vendorStateCode: input.vendor.stateCode,
    },
    totals,
    display,
    settlement,
    ruleVersions,
    problems,
    warnings: [...new Set(warnings)],
    hints: {
      distanceKm: isDelivery && meters != null ? Math.round(meters / 100) / 10 : null,
      smallOrder:
        computed.small_order_fee.gross > 0 && computed.small_order_fee.rule
          ? {
              belowPaise: (computed.small_order_fee.rule as unknown as PricingRule<SmallOrderFeeParams>).params.belowPaise,
              basisPaise: basisFor("small_order_fee"),
            }
          : null,
    },
  };
}
