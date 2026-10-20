/**
 * ─────────────────────────────────────────────────────────────────────────
 * Kada Stay pricing: the same financial architecture as food.
 *
 * Nightly rates (base, date overrides, weekend / seasonal rules), extra-guest
 * charges, cleaning and service fees, promotions and coupons, GST (including
 * tariff slabs for accommodation), rounding, host commission and payment
 * fees. The quote is the booking's permanent price snapshot.
 *
 * Accounting identity (enforced by tests):
 *   customer total = host payout + platform revenue + platform tax liability
 * ─────────────────────────────────────────────────────────────────────────
 */
import { applyBps, clampPaise, roundToStep, type Bps, type Paise, type RoundingMode } from "./money";
import { categoryAtValue, gstOnExclusive, gstOnInclusive, supplyNature, type TaxCategory } from "./tax";
import { applicableRules, winningRule, type AnyRule, type PricingRule, type ScopeContext } from "./rules";
import { resolvePromotions, type AppliedPromotion, type PromotionParams } from "./promotions";
import type { DisplayRow, TaxDetail } from "./food";

export const STAY_ENGINE_VERSION = "stay-2026.09.14";
export const MAX_NIGHTS = 30;
const DAY_MS = 86_400_000;

export type StayComponent = "stay_room" | "stay_cleaning" | "stay_service_fee" | "stay_commission";

export interface StayRateParams {
  /** Replace the nightly rate outright. */
  overridePaise?: Paise;
  /** Or adjust it (+2000 = +20%, −1500 = −15%). */
  adjustBps?: number;
  /** Seasonal window, inclusive "YYYY-MM-DD". Omit for weekday/weekend rules (use scope.daysOfWeek). */
  dateFrom?: string;
  dateTo?: string;
}

export interface StayFeeParams {
  fee: "cleaning" | "service" | "extra_guest";
  amountPaise?: Paise;
  bps?: Bps;
  perNight?: boolean;
  minPaise?: Paise;
  maxPaise?: Paise;
}

export interface StayCommissionParams {
  bps?: Bps;
  fixedPaise?: Paise;
  minPaise?: Paise;
  maxPaise?: Paise;
  /** Payment-gateway cost recovered from the host, on the customer total. */
  paymentFeeBps?: Bps;
}

export interface StayTaxAssignmentParams {
  component: StayComponent;
  taxCategoryId: string;
  inclusive?: boolean;
  supplier?: "host" | "platform";
  placeOfSupply?: "property_state" | "customer_state";
}

export interface StayQuoteInput {
  at: number;
  property: { id: string; hostId: string; name: string; stateCode: string; gstin: string | null; zoneId: string | null };
  room: {
    id: string;
    name: string;
    baseNightlyPaise: Paise;
    maxGuests: number;
    includedGuests: number;
    extraGuestNightlyPaise: Paise | null;
    cleaningFeePaise: Paise | null;
  };
  /** Host-set prices for specific dates ("YYYY-MM-DD" → paise). */
  nightlyOverrides: Record<string, Paise>;
  checkIn: string;
  checkOut: string;
  guests: number;
  customer: { uid: string; completedStays: number; isNew: boolean; stateCode: string };
  platform: { gstin: string | null; stateCode: string };
  couponCode: string | null;
  promoUsage: { total: Record<string, number>; byCustomer: Record<string, number> };
  hostCommissionWaived: boolean;
}

export interface StayNight {
  date: string;
  basePaise: Paise;
  ratePaise: Paise;
  extraGuestPaise: Paise;
  rateRuleId: string | null;
}

export interface StayQuote {
  engineVersion: string;
  currency: "INR";
  quotedAt: number;
  nights: StayNight[];
  nightCount: number;
  roomSubtotalPaise: Paise;
  extraGuestSubtotalPaise: Paise;
  discountPaise: Paise;
  cleaningFeePaise: Paise;
  serviceFeePaise: Paise;
  serviceFeeWaivedPaise: Paise;
  promotions: AppliedPromotion[];
  couponProblem: string | null;
  taxes: (TaxDetail & { component: StayComponent })[];
  totals: { taxPaise: Paise; cgstPaise: Paise; sgstPaise: Paise; utgstPaise: Paise; igstPaise: Paise; roundingPaise: Paise; totalPaise: Paise };
  display: DisplayRow[];
  host: {
    grossBookingPaise: Paise;
    commissionPaise: Paise;
    commissionTax: TaxDetail | null;
    paymentFeePaise: Paise;
    hostFundedDiscountPaise: Paise;
    netPayoutPaise: Paise;
    display: DisplayRow[];
  };
  platformFundedDiscountPaise: Paise;
  platformRevenuePaise: Paise;
  taxLiability: { hostPaise: Paise; platformEcoPaise: Paise; platformOwnPaise: Paise };
  ruleVersions: Record<string, number>;
  problems: string[];
  warnings: string[];
}

function parseDate(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Noon IST on a calendar date, so day-of-week scopes see that date. */
const noonIst = (ms: number) => ms + 6.5 * 3_600_000;

export function quoteStay(input: StayQuoteInput, rules: readonly AnyRule[]): StayQuote {
  const problems: string[] = [];
  const warnings: string[] = [];
  const ruleVersions: Record<string, number> = {};
  const use = (r: AnyRule | null | undefined) => {
    if (r) ruleVersions[r.ruleId] = r.version;
    return r ?? null;
  };

  const base: ScopeContext = {
    product: "stay",
    at: input.at,
    zoneId: input.property.zoneId,
    propertyId: input.property.id,
    categoryIds: [input.room.id],
    orderPaise: null,
  };
  const roundingRule = use(winningRule<{ taxMode?: RoundingMode; lineMode?: RoundingMode; finalStepPaise?: number; finalMode?: RoundingMode }>(rules, "rounding", base));
  const lineMode = roundingRule?.params.lineMode ?? "half_up";
  const taxMode = roundingRule?.params.taxMode ?? "half_up";

  // ── Dates and guests ──────────────────────────────────────────────────────
  const inMs = parseDate(input.checkIn);
  const outMs = parseDate(input.checkOut);
  let nightCount = 0;
  if (inMs == null || outMs == null) problems.push("Choose valid check-in and check-out dates.");
  else {
    nightCount = Math.round((outMs - inMs) / DAY_MS);
    if (nightCount <= 0) problems.push("Check-out must be after check-in.");
    if (nightCount > MAX_NIGHTS) problems.push(`Stays can be booked for up to ${MAX_NIGHTS} nights.`);
  }
  if (!Number.isSafeInteger(input.guests) || input.guests < 1) problems.push("Add at least one guest.");
  if (input.guests > input.room.maxGuests) problems.push(`This room fits up to ${input.room.maxGuests} guests.`);
  const validNights = problems.length === 0 ? nightCount : 0;

  const feeRule = (fee: StayFeeParams["fee"], ctx: ScopeContext) =>
    applicableRules<StayFeeParams>(rules, "stay_fee", ctx).find((r) => r.params.fee === fee) ?? null;

  // ── Nights ────────────────────────────────────────────────────────────────
  const nights: StayNight[] = [];
  const extraGuests = Math.max(0, input.guests - input.room.includedGuests);
  for (let i = 0; i < validNights; i++) {
    const dayMs = inMs! + i * DAY_MS;
    const date = fmtDate(dayMs);
    const ctx: ScopeContext = { ...base, at: noonIst(dayMs) };
    const basePrice = input.nightlyOverrides[date] ?? input.room.baseNightlyPaise;
    const rateRule = applicableRules<StayRateParams>(rules, "stay_rate", ctx).find((r) => {
      const from = r.params.dateFrom ? parseDate(r.params.dateFrom) : null;
      const to = r.params.dateTo ? parseDate(r.params.dateTo) : null;
      return (from == null || dayMs >= from) && (to == null || dayMs <= to);
    }) ?? null;
    use(rateRule);
    let rate = basePrice;
    if (rateRule?.params.overridePaise != null) rate = rateRule.params.overridePaise;
    else if (rateRule?.params.adjustBps) rate = basePrice + applyBps(basePrice, rateRule.params.adjustBps, lineMode);
    rate = Math.max(0, rate);

    let extra = 0;
    if (extraGuests > 0) {
      const perGuest = input.room.extraGuestNightlyPaise ?? use(feeRule("extra_guest", ctx))?.params.amountPaise ?? 0;
      extra = perGuest * extraGuests;
    }
    nights.push({ date, basePaise: basePrice, ratePaise: rate, extraGuestPaise: extra, rateRuleId: rateRule?.ruleId ?? null });
  }
  const roomSubtotal = nights.reduce((s, n) => s + n.ratePaise, 0);
  const extraSubtotal = nights.reduce((s, n) => s + n.extraGuestPaise, 0);
  const stayValue = roomSubtotal + extraSubtotal;
  const withValue = (v: Paise): ScopeContext => ({ ...base, orderPaise: v });

  // ── Cleaning + service fee ────────────────────────────────────────────────
  let cleaning = 0;
  if (validNights > 0) {
    if (input.room.cleaningFeePaise != null) cleaning = input.room.cleaningFeePaise;
    else {
      const cr = use(feeRule("cleaning", withValue(stayValue)));
      if (cr) cleaning = (cr.params.amountPaise ?? 0) * (cr.params.perNight ? validNights : 1);
    }
  }
  const serviceFor = (basis: Paise) => {
    const sr = feeRule("service", withValue(basis));
    if (!sr || validNights === 0) return { fee: 0, rule: null as PricingRule<StayFeeParams> | null };
    const p = sr.params;
    const fee = (p.amountPaise ?? 0) * (p.perNight ? validNights : 1) + applyBps(basis, p.bps ?? 0, lineMode);
    return { fee: clampPaise(fee, p.minPaise ?? null, p.maxPaise ?? null), rule: sr };
  };

  // ── Promotions ────────────────────────────────────────────────────────────
  const promo = resolvePromotions(rules as unknown as PricingRule<PromotionParams>[], {
    scope: withValue(stayValue),
    customer: { completedOrders: input.customer.completedStays, isNew: input.customer.isNew },
    couponCode: input.couponCode,
    usage: input.promoUsage,
    lines: validNights > 0 ? [{ lineId: "stay", menuItemId: input.room.id, categoryId: "stay", netPaise: stayValue }] : [],
    deliveryPaise: 0,
    fees: { platform_fee: serviceFor(stayValue).fee },
  });
  let discount = 0;
  let hostFundedItems = 0;
  let platformFundedItems = 0;
  let serviceWaiveWanted = 0;
  let hostFundedWaivers = 0;
  for (const a of promo.applied) {
    use(rules.find((r) => r.ruleId === a.ruleId && r.version === a.version));
    discount += a.itemDiscountPaise;
    const share = (amt: Paise) => (a.totalPaise > 0 ? Math.round((amt * a.vendorFundedPaise) / a.totalPaise) : 0);
    hostFundedItems += share(a.itemDiscountPaise);
    platformFundedItems += a.itemDiscountPaise - share(a.itemDiscountPaise);
    const w = a.feesWaived.platform_fee ?? 0;
    serviceWaiveWanted += w;
    hostFundedWaivers += share(w);
  }
  const stayNet = stayValue - discount;
  const service = serviceFor(stayNet);
  use(service.rule);
  const serviceWaived = Math.min(service.fee, serviceWaiveWanted);
  if (serviceWaived < serviceWaiveWanted) hostFundedWaivers = Math.min(hostFundedWaivers, serviceWaived);
  const serviceNet = service.fee - serviceWaived;

  // ── Taxes ─────────────────────────────────────────────────────────────────
  const categories = new Map<string, TaxCategory>();
  for (const r of applicableRules<TaxCategory>(rules, "tax_category", base)) {
    if (!categories.has(r.params.id)) {
      categories.set(r.params.id, r.params);
      use(r);
    }
  }
  const taxes: StayQuote["taxes"] = [];
  const taxOn = (component: StayComponent, amount: Paise, unitValue: Paise): TaxDetail | null => {
    if (amount <= 0) return null;
    const a = applicableRules<StayTaxAssignmentParams>(rules, "tax_assignment", base).find((r) => r.params.component === component) ?? null;
    use(a);
    const cat0 = a ? categories.get(a.params.taxCategoryId) : undefined;
    if (!cat0) {
      warnings.push(`No tax rule covers ${component}; it was treated as untaxed.`);
      return null;
    }
    const cat = categoryAtValue(cat0, unitValue);
    const supplierIsHost = (a!.params.supplier ?? (component === "stay_service_fee" || component === "stay_commission" ? "platform" : "host")) === "host";
    const supplierState = supplierIsHost ? input.property.stateCode : input.platform.stateCode;
    const place = (a!.params.placeOfSupply ?? "property_state") === "customer_state" ? input.customer.stateCode : input.property.stateCode;
    const nature = supplyNature(supplierState, place);
    const breakup = a!.params.inclusive
      ? gstOnInclusive(amount, cat, nature, place, taxMode)
      : gstOnExclusive(amount, cat, nature, place, taxMode);
    const detail: TaxDetail = {
      ...breakup,
      taxCategoryId: cat.id,
      liability: cat.liability,
      supplier: supplierIsHost ? "vendor" : "platform",
      inclusive: a!.params.inclusive === true,
      placeOfSupplyState: place,
    };
    if (component !== "stay_commission") taxes.push({ ...detail, component });
    return detail;
  };

  // Accommodation GST slabs follow the average per-night tariff.
  const perNight = validNights > 0 ? Math.floor(stayNet / validNights) : 0;
  const roomTax = taxOn("stay_room", stayNet, perNight);
  const cleaningTax = taxOn("stay_cleaning", cleaning, perNight);
  const serviceTax = taxOn("stay_service_fee", serviceNet, serviceNet);
  const pays = (amount: Paise, t: TaxDetail | null) => amount + (t && !t.inclusive ? t.total : 0);
  const taxable = (amount: Paise, t: TaxDetail | null) => (t ? t.taxable : amount);

  const beforeRounding = pays(stayNet, roomTax) + pays(cleaning, cleaningTax) + pays(serviceNet, serviceTax);
  const total = roundToStep(beforeRounding, roundingRule?.params.finalStepPaise ?? 0, roundingRule?.params.finalMode ?? "half_up");
  const rounding = total - beforeRounding;
  const sumTax = (f: "total" | "cgst" | "sgst" | "utgst" | "igst") => taxes.reduce((s, t) => s + t[f], 0);

  // ── Host settlement ───────────────────────────────────────────────────────
  let hostTax = 0;
  let ecoTax = 0;
  let platformOwnTax = 0;
  for (const t of taxes) {
    if (t.liability === "platform_eco") ecoTax += t.total;
    else if (t.supplier === "vendor") hostTax += t.total;
    else platformOwnTax += t.total;
  }
  const hostGross = taxable(stayNet, roomTax) + taxable(cleaning, cleaningTax) + platformFundedItems;
  const commissionRule = input.hostCommissionWaived ? null : use(winningRule<StayCommissionParams>(rules, "stay_commission", withValue(stayNet)));
  let commission = 0;
  if (commissionRule) {
    const p = commissionRule.params;
    commission = Math.min(hostGross, clampPaise(applyBps(hostGross, p.bps ?? 0, lineMode) + (p.fixedPaise ?? 0), p.minPaise ?? null, p.maxPaise ?? null));
  }
  const commissionTax = commission > 0 ? taxOn("stay_commission", commission, commission) : null;
  if (commissionTax) platformOwnTax += commissionTax.total;
  const paymentFee = applyBps(total, commissionRule?.params.paymentFeeBps ?? 0, lineMode);
  const netPayout = hostGross + hostTax - commission - (commissionTax?.total ?? 0) - paymentFee - hostFundedWaivers;
  const platformRevenue = taxable(serviceNet, serviceTax) + commission + paymentFee + hostFundedWaivers - platformFundedItems + rounding;

  // ── Displays ──────────────────────────────────────────────────────────────
  const display: DisplayRow[] = [
    { key: "room", label: `${validNights} night${validNights === 1 ? "" : "s"}`, amountPaise: roomSubtotal },
  ];
  if (extraSubtotal > 0) display.push({ key: "extra_guest", label: "Extra guests", amountPaise: extraSubtotal });
  if (discount > 0) display.push({ key: "discount", label: "Discounts", amountPaise: -discount });
  if (cleaning > 0) display.push({ key: "cleaning", label: "Cleaning fee", amountPaise: cleaning });
  if (service.fee > 0) display.push({ key: "service_fee", label: "Service fee", amountPaise: service.fee });
  if (serviceWaived > 0) display.push({ key: "service_fee_waiver", label: "Service fee waived", amountPaise: -serviceWaived });
  const exclTax = taxes.filter((t) => !t.inclusive).reduce((s, t) => s + t.total, 0);
  if (exclTax > 0) display.push({ key: "tax", label: "Taxes", amountPaise: exclTax });
  if (rounding !== 0) display.push({ key: "rounding", label: "Rounding", amountPaise: rounding });
  display.push({ key: "total", label: "Total", amountPaise: total });

  const hostDisplay: DisplayRow[] = [
    { key: "gross", label: "Gross booking", amountPaise: hostGross + hostTax },
    { key: "commission", label: "Platform commission", amountPaise: -(commission + (commissionTax?.total ?? 0)) },
  ];
  if (paymentFee > 0) hostDisplay.push({ key: "payment_fee", label: "Payment processing", amountPaise: -paymentFee });
  if (hostFundedWaivers > 0) hostDisplay.push({ key: "adjustments", label: "Promotions you funded", amountPaise: -hostFundedWaivers });
  hostDisplay.push({ key: "net", label: "Net payout", amountPaise: netPayout });

  return {
    engineVersion: STAY_ENGINE_VERSION,
    currency: "INR",
    quotedAt: input.at,
    nights,
    nightCount: validNights,
    roomSubtotalPaise: roomSubtotal,
    extraGuestSubtotalPaise: extraSubtotal,
    discountPaise: discount,
    cleaningFeePaise: cleaning,
    serviceFeePaise: service.fee,
    serviceFeeWaivedPaise: serviceWaived,
    promotions: promo.applied,
    couponProblem: promo.couponProblem,
    taxes,
    totals: {
      taxPaise: sumTax("total"),
      cgstPaise: sumTax("cgst"),
      sgstPaise: sumTax("sgst"),
      utgstPaise: sumTax("utgst"),
      igstPaise: sumTax("igst"),
      roundingPaise: rounding,
      totalPaise: total,
    },
    display,
    host: {
      grossBookingPaise: hostGross + hostTax,
      commissionPaise: commission,
      commissionTax,
      paymentFeePaise: paymentFee,
      hostFundedDiscountPaise: hostFundedItems + hostFundedWaivers,
      netPayoutPaise: netPayout,
      display: hostDisplay,
    },
    platformFundedDiscountPaise: platformFundedItems,
    platformRevenuePaise: platformRevenue,
    taxLiability: { hostPaise: hostTax, platformEcoPaise: ecoTax, platformOwnPaise: platformOwnTax },
    ruleVersions,
    problems,
    warnings: [...new Set(warnings)],
  };
}
