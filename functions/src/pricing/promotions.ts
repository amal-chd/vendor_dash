/**
 * Promotions and coupons for the central pricing engine.
 *
 * A promotion is a `promotion` rule. With `params.code` it is a coupon the
 * customer enters; without, it applies automatically when eligible. Every
 * check is server-side: eligibility, limits, stacking and who funds it.
 *
 * Stacking is OFF unless a promotion says `stackable: true`, and two
 * promotions in the same `stackGroup` never combine. An entered coupon is
 * honoured first when eligible; otherwise the best automatic promotion wins.
 * Discounts are spread across lines exactly and never push a line below zero.
 *
 * Pure: no Firebase imports.
 */
import { allocate, applyBps, type Paise } from "./money";
import { applicableRules, isEffective, scopeMatches, type PricingRule, type ScopeContext } from "./rules";


export type WaivableFee = "platform_fee" | "small_order_fee" | "packaging";

export interface PromotionParams {
  code?: string;
  label?: string;
  type: "percent" | "fixed" | "free_delivery" | "fee_waiver";
  bps?: number;
  amountPaise?: number;
  maxDiscountPaise?: number;
  minCartPaise?: number;
  /** percent/fixed: whole cart (default), or only matching items/categories. */
  itemIds?: string[];
  categoryIds?: string[];
  waiveFees?: WaivableFee[];
  fundedBy?: "platform" | "vendor" | "split";
  /** For "split": the vendor's share in basis points. */
  vendorShareBps?: number;
  firstOrderOnly?: boolean;
  newCustomersOnly?: boolean;
  referralOnly?: boolean;
  /** Only for customers with an active Kada Gold membership. */
  goldOnly?: boolean;
  /**
   * What a percent discount is taken on when offers stack: "remaining" (after
   * earlier offers, the default) or "cart" (the undiscounted cart, as the Gold
   * benefit and legacy coupons always were). Never discounts more than is left.
   */
  basis?: "remaining" | "cart";
  usageLimit?: number;
  perCustomerLimit?: number;
  stackable?: boolean;
  stackGroup?: string;
  campaignSource?: string;
}

export interface PromoLine {
  lineId: string;
  menuItemId: string;
  categoryId: string;
  /** Line value available for discount (after item-level discounts). */
  netPaise: Paise;
}

export interface PromoContext {
  scope: ScopeContext;
  customer: { completedOrders: number; isNew: boolean; referred?: boolean; isGold?: boolean };
  couponCode: string | null;
  usage: { total: Record<string, number>; byCustomer: Record<string, number> };
  lines: PromoLine[];
  deliveryPaise: Paise;
  fees: Partial<Record<WaivableFee, Paise>>;
}

export interface AppliedPromotion {
  ruleId: string;
  version: number;
  code: string | null;
  label: string;
  type: PromotionParams["type"];
  campaignSource: string | null;
  /** Discount on item value, by line. */
  lineAllocations: Record<string, Paise>;
  itemDiscountPaise: Paise;
  deliveryWaivedPaise: Paise;
  feesWaived: Partial<Record<WaivableFee, Paise>>;
  totalPaise: Paise;
  vendorFundedPaise: Paise;
  platformFundedPaise: Paise;
}

export interface PromotionResult {
  applied: AppliedPromotion[];
  /** Set when the customer entered a code that couldn't be used, with why. */
  couponProblem: string | null;
}

const rupees = (p: Paise) => `₹${Math.ceil(p / 100)}`;
const norm = (c: unknown) => (c ?? "").toString().trim().toUpperCase();

function eligibleLines(p: PromotionParams, lines: readonly PromoLine[]): PromoLine[] {
  const items = p.itemIds ?? [];
  const cats = p.categoryIds ?? [];
  if (items.length === 0 && cats.length === 0) return [...lines];
  return lines.filter((l) => items.includes(l.menuItemId) || cats.includes(l.categoryId));
}

/** Why this promotion can't apply to this cart and customer, or null. */
export function ineligibility(rule: PricingRule<PromotionParams>, ctx: PromoContext): string | null {
  const p = rule.params;
  const cart = ctx.lines.reduce((s, l) => s + l.netPaise, 0);
  if (p.minCartPaise != null && cart < p.minCartPaise) {
    return `Add ${rupees(p.minCartPaise - cart)} more to use this offer.`;
  }
  if (p.firstOrderOnly && ctx.customer.completedOrders > 0) return "This offer is only for your first order.";
  if (p.newCustomersOnly && !ctx.customer.isNew) return "This offer is only for new customers.";
  if (p.referralOnly && !ctx.customer.referred) return "This offer is only for referred customers.";
  if (p.goldOnly && !ctx.customer.isGold) return "This offer is only for Kada Gold members.";
  if (p.usageLimit != null && (ctx.usage.total[rule.ruleId] ?? 0) >= p.usageLimit) {
    return "This offer has been fully claimed.";
  }
  if (p.perCustomerLimit != null && (ctx.usage.byCustomer[rule.ruleId] ?? 0) >= p.perCustomerLimit) {
    return "You've already used this offer the maximum number of times.";
  }
  if ((p.type === "percent" || p.type === "fixed") && eligibleLines(p, ctx.lines).length === 0) {
    return "None of the items in your cart qualify for this offer.";
  }
  if (p.type === "free_delivery" && ctx.deliveryPaise <= 0) return "Delivery is already free for this order.";
  return null;
}

function funding(total: Paise, p: PromotionParams): { vendor: Paise; platform: Paise } {
  const by = p.fundedBy ?? "platform";
  if (by === "vendor") return { vendor: total, platform: 0 };
  if (by === "split") {
    const vendor = applyBps(total, Math.min(10_000, Math.max(0, p.vendorShareBps ?? 5000)), "half_up");
    return { vendor, platform: total - vendor };
  }
  return { vendor: 0, platform: total };
}

/** The discount a promotion gives against what's still undiscounted. */
function evaluate(
  rule: PricingRule<PromotionParams>,
  ctx: PromoContext,
  remaining: Record<string, Paise>,
  deliveryLeft: Paise,
  feesLeft: Partial<Record<WaivableFee, Paise>>,
): AppliedPromotion {
  const p = rule.params;
  const lineAllocations: Record<string, Paise> = {};
  let itemDiscount = 0;
  let deliveryWaived = 0;
  const feesWaived: Partial<Record<WaivableFee, Paise>> = {};

  if (p.type === "percent" || p.type === "fixed") {
    const lines = eligibleLines(p, ctx.lines).filter((l) => (remaining[l.lineId] ?? 0) > 0);
    const base = lines.reduce((s, l) => s + remaining[l.lineId], 0);
    const percentOf = p.basis === "cart"
      ? eligibleLines(p, ctx.lines).reduce((s, l) => s + Math.max(0, l.netPaise), 0)
      : base;
    let want = p.type === "percent" ? applyBps(percentOf, p.bps ?? 0, "down") : p.amountPaise ?? 0;
    if (p.maxDiscountPaise != null) want = Math.min(want, p.maxDiscountPaise);
    want = Math.max(0, Math.min(want, base));
    const parts = allocate(want, lines.map((l) => remaining[l.lineId]));
    lines.forEach((l, i) => {
      const part = Math.min(parts[i], remaining[l.lineId]);
      if (part > 0) lineAllocations[l.lineId] = part;
      itemDiscount += part;
    });
  } else if (p.type === "free_delivery") {
    deliveryWaived = Math.min(deliveryLeft, p.maxDiscountPaise ?? deliveryLeft);
  } else if (p.type === "fee_waiver") {
    for (const fee of p.waiveFees ?? []) {
      const left = feesLeft[fee] ?? 0;
      if (left > 0) feesWaived[fee] = left;
    }
  }

  const feesTotal = Object.values(feesWaived).reduce((s, v) => s + (v ?? 0), 0);
  const total = itemDiscount + deliveryWaived + feesTotal;
  const f = funding(total, p);
  return {
    ruleId: rule.ruleId,
    version: rule.version,
    code: p.code ? norm(p.code) : null,
    label: p.label ?? rule.name,
    type: p.type,
    campaignSource: p.campaignSource ?? null,
    lineAllocations,
    itemDiscountPaise: itemDiscount,
    deliveryWaivedPaise: deliveryWaived,
    feesWaived,
    totalPaise: total,
    vendorFundedPaise: f.vendor,
    platformFundedPaise: f.platform,
  };
}

/** Explains an entered code that isn't usable, using ALL rules (incl. expired). */
function couponProblemFor(
  code: string,
  allRules: readonly PricingRule<PromotionParams>[],
  ctx: PromoContext,
): string {
  const same = allRules.filter((r) => r.kind === "promotion" && norm(r.params.code) === code);
  if (same.length === 0) return "This coupon code isn't valid.";
  const live = same.filter((r) => isEffective(r, ctx.scope.at));
  if (live.length === 0) {
    return same.some((r) => r.active && r.effectiveFrom > ctx.scope.at)
      ? "This coupon isn't active yet."
      : "This coupon has expired.";
  }
  const inScope = live.filter((r) => scopeMatches(r.scope, ctx.scope));
  if (inScope.length === 0) return "This coupon isn't valid for this restaurant, area or time.";
  return ineligibility(inScope[0], ctx) ?? "This coupon can't be combined with the offer already applied.";
}

export function resolvePromotions(
  rules: readonly PricingRule<PromotionParams>[],
  ctx: PromoContext,
): PromotionResult {
  const code = norm(ctx.couponCode);
  const candidates = applicableRules<PromotionParams>(rules, "promotion", ctx.scope).filter((r) => {
    const rc = norm(r.params.code);
    if (rc && rc !== code) return false; // coupons need their code
    return ineligibility(r, ctx) === null;
  });

  const remaining: Record<string, Paise> = {};
  for (const l of ctx.lines) remaining[l.lineId] = Math.max(0, l.netPaise);
  let deliveryLeft = Math.max(0, ctx.deliveryPaise);
  const feesLeft: Partial<Record<WaivableFee, Paise>> = { ...ctx.fees };

  // Value each candidate on the untouched cart to rank automatic offers.
  const valued = candidates.map((r) => ({ r, value: evaluate(r, ctx, { ...remaining }, deliveryLeft, { ...feesLeft }).totalPaise }));
  const coupon = code ? valued.find((v) => norm(v.r.params.code) === code) : undefined;
  const ordered = [
    ...(coupon ? [coupon] : []),
    ...valued
      .filter((v) => v !== coupon)
      .sort((a, b) => b.r.priority - a.r.priority || b.value - a.value || a.r.ruleId.localeCompare(b.r.ruleId)),
  ];

  const applied: AppliedPromotion[] = [];
  const groups = new Set<string>();
  for (const { r } of ordered) {
    const p = r.params;
    if (applied.length > 0) {
      const allStackable = applied.every((a) => rules.find((x) => x.ruleId === a.ruleId && x.version === a.version)?.params.stackable);
      if (!p.stackable || !allStackable) continue;
      if (p.stackGroup && groups.has(p.stackGroup)) continue;
    }
    const result = evaluate(r, ctx, remaining, deliveryLeft, feesLeft);
    if (result.totalPaise <= 0) continue;
    for (const [lineId, amt] of Object.entries(result.lineAllocations)) remaining[lineId] -= amt;
    deliveryLeft -= result.deliveryWaivedPaise;
    for (const [fee, amt] of Object.entries(result.feesWaived)) {
      feesLeft[fee as WaivableFee] = (feesLeft[fee as WaivableFee] ?? 0) - (amt ?? 0);
    }
    if (p.stackGroup) groups.add(p.stackGroup);
    applied.push(result);
  }

  const couponUsed = code ? applied.some((a) => a.code === code) : true;
  return {
    applied,
    couponProblem: code && !couponUsed ? couponProblemFor(code, rules, ctx) : null,
  };
}
