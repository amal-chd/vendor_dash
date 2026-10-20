/**
 * Versioned pricing rules: the data every price, fee, tax, discount,
 * commission and earning is computed from.
 *
 * - A rule has a stable `ruleId` and immutable `version`s. Publishing never
 *   edits a version: it creates version n+1 and closes version n's
 *   `effectiveUntil`. Historical orders reference the exact versions used.
 * - Scope narrows where a rule applies (product, zone, vendor, category,
 *   property, order value, IST day/time).
 * - Among matching rules of a kind, higher priority wins, then the more
 *   specific scope (vendor > category > zone > global), then the newer version.
 *
 * Pure: no Firebase imports. Loading from Firestore lives in pricing/store.ts.
 */
import { istMinutesOfDay, withinWindow } from "../orderPricing";
import { ROUNDING_MODES } from "./money";

export const RULE_KINDS = [
  "tax_category",
  "tax_assignment",
  "packaging",
  "delivery_fee",
  "surge",
  "platform_fee",
  "small_order_fee",
  "commission",
  "rider_earning",
  "promotion",
  "rounding",
  "pipeline",
  "stay_rate",
  "stay_fee",
  "stay_commission",
  "refund_policy",
  "settlement",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type Product = "food" | "stay";

export interface TimeWindow {
  from: string; // "HH:MM" IST
  to: string;
}

export interface RuleScope {
  product?: Product;
  zoneIds?: string[];
  vendorIds?: string[];
  propertyIds?: string[];
  categoryIds?: string[];
  minOrderPaise?: number;
  maxOrderPaise?: number;
  /** 0 = Sunday … 6 = Saturday, IST. */
  daysOfWeek?: number[];
  timeWindows?: TimeWindow[];
}

export interface PricingRule<P = Record<string, unknown>> {
  ruleId: string;
  version: number;
  kind: RuleKind;
  name: string;
  active: boolean;
  priority: number;
  effectiveFrom: number; // epoch ms
  effectiveUntil: number | null;
  scope: RuleScope;
  params: P;
}

export interface ScopeContext {
  product: Product;
  at: number;
  zoneId?: string | null;
  vendorId?: string | null;
  propertyId?: string | null;
  categoryIds?: readonly string[];
  orderPaise?: number | null;
}

const IST_OFFSET_MS = 330 * 60_000;

export function istDayOfWeek(at: number): number {
  return new Date(at + IST_OFFSET_MS).getUTCDay();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRule = PricingRule<any>;

export function isEffective(rule: AnyRule, at: number): boolean {
  return rule.active && rule.effectiveFrom <= at && (rule.effectiveUntil == null || at < rule.effectiveUntil);
}

const hasAny = (list: readonly string[] | undefined) => Array.isArray(list) && list.length > 0;

export function scopeMatches(scope: RuleScope, ctx: ScopeContext): boolean {
  if (scope.product && scope.product !== ctx.product) return false;
  if (hasAny(scope.zoneIds) && !(ctx.zoneId && scope.zoneIds!.includes(ctx.zoneId))) return false;
  if (hasAny(scope.vendorIds) && !(ctx.vendorId && scope.vendorIds!.includes(ctx.vendorId))) return false;
  if (hasAny(scope.propertyIds) && !(ctx.propertyId && scope.propertyIds!.includes(ctx.propertyId))) return false;
  if (hasAny(scope.categoryIds) && !(ctx.categoryIds ?? []).some((c) => scope.categoryIds!.includes(c))) return false;
  if (scope.minOrderPaise != null && (ctx.orderPaise == null || ctx.orderPaise < scope.minOrderPaise)) return false;
  if (scope.maxOrderPaise != null && (ctx.orderPaise == null || ctx.orderPaise > scope.maxOrderPaise)) return false;
  if (hasAny(scope.daysOfWeek as unknown as string[]) && !scope.daysOfWeek!.includes(istDayOfWeek(ctx.at))) return false;
  if (hasAny(scope.timeWindows as unknown as string[])) {
    const minutes = istMinutesOfDay(new Date(ctx.at));
    if (!scope.timeWindows!.some((w) => withinWindow(w.from, w.to, minutes))) return false;
  }
  return true;
}

/** Vendor/property > category > zone > global. */
export function specificity(scope: RuleScope): number {
  return (
    (hasAny(scope.vendorIds) || hasAny(scope.propertyIds) ? 8 : 0) +
    (hasAny(scope.categoryIds) ? 4 : 0) +
    (hasAny(scope.zoneIds) ? 2 : 0)
  );
}

/**
 * Every effective, in-scope rule of [kind], best first. Only one version per
 * ruleId can be effective at a moment; if data ever overlaps, the newest wins.
 */
export function applicableRules<P = Record<string, unknown>>(
  rules: readonly AnyRule[],
  kind: RuleKind,
  ctx: ScopeContext,
): PricingRule<P>[] {
  const byId = new Map<string, PricingRule<P>>();
  for (const r of rules) {
    if (r.kind !== kind || !isEffective(r, ctx.at) || !scopeMatches(r.scope, ctx)) continue;
    const prev = byId.get(r.ruleId);
    if (!prev || r.version > prev.version) byId.set(r.ruleId, r as PricingRule<P>);
  }
  return [...byId.values()].sort(
    (a, b) =>
      b.priority - a.priority ||
      specificity(b.scope) - specificity(a.scope) ||
      b.version - a.version ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function winningRule<P = Record<string, unknown>>(
  rules: readonly AnyRule[],
  kind: RuleKind,
  ctx: ScopeContext,
): PricingRule<P> | null {
  return applicableRules<P>(rules, kind, ctx)[0] ?? null;
}

/**
 * Publishing a change: version n+1 starts at [effectiveFrom]; the currently
 * open version is closed at that moment. Nothing existing is modified except
 * that close, so every past quote still resolves to what it used.
 */
export function publishVersion(
  history: readonly PricingRule[],
  draft: Omit<PricingRule, "version">,
): { next: PricingRule; closed: PricingRule | null } {
  const versions = history.filter((r) => r.ruleId === draft.ruleId).sort((a, b) => b.version - a.version);
  const latest = versions[0] ?? null;
  const next: PricingRule = { ...draft, version: (latest?.version ?? 0) + 1 };
  let closed: PricingRule | null = null;
  if (latest && (latest.effectiveUntil == null || latest.effectiveUntil > draft.effectiveFrom)) {
    closed = { ...latest, effectiveUntil: Math.max(latest.effectiveFrom, draft.effectiveFrom) };
  }
  return { next, closed };
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export const PIPELINE_STEPS = [
  "items",
  "modifiers",
  "item_discounts",
  "cart_discounts",
  "packaging",
  "delivery",
  "surge",
  "platform_fee",
  "small_order_fee",
  "taxes",
  "rounding",
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export const DEFAULT_PIPELINE: readonly PipelineStep[] = PIPELINE_STEPS;

const CHARGE_STEPS: readonly PipelineStep[] = [
  "items", "modifiers", "packaging", "delivery", "surge", "platform_fee", "small_order_fee",
];

/**
 * The order is configurable, within fixed constraints: items → modifiers →
 * item discounts → cart discounts stay in sequence; every charge is computed
 * before taxes; rounding is last. The position of a fee relative to the cart
 * discount decides whether its percentage basis is pre- or post-discount.
 */
export function validatePipeline(steps: readonly string[]): string[] {
  const problems: string[] = [];
  const known = new Set<string>(PIPELINE_STEPS);
  for (const s of steps) if (!known.has(s)) problems.push(`Unknown pipeline step "${s}".`);
  for (const s of PIPELINE_STEPS) {
    const n = steps.filter((x) => x === s).length;
    if (n !== 1) problems.push(`Pipeline must contain "${s}" exactly once (found ${n}).`);
  }
  if (problems.length) return problems;
  const at = (s: PipelineStep) => steps.indexOf(s);
  if (!(at("items") < at("modifiers") && at("modifiers") < at("item_discounts") && at("item_discounts") < at("cart_discounts"))) {
    problems.push("Items, modifiers, item discounts and cart discounts must run in that order.");
  }
  for (const c of CHARGE_STEPS) {
    if (at(c) > at("taxes")) problems.push(`"${c}" must be calculated before taxes.`);
  }
  if (at("rounding") !== steps.length - 1) problems.push("Rounding must be the last step.");
  return problems;
}

// ── Validation ──────────────────────────────────────────────────────────────

const isInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
const nonNeg = (v: unknown) => isInt(v) && (v as number) >= 0;
const optNonNeg = (v: unknown) => v == null || nonNeg(v);

type Params = Record<string, unknown>;

const PARAM_VALIDATORS: Partial<Record<RuleKind, (p: Params) => string[]>> = {
  tax_category: (p) => [
    ...(typeof p.id === "string" && p.id ? [] : ["Tax category needs an id."]),
    ...(nonNeg(p.rateBps) && (p.rateBps as number) <= 4000 ? [] : ["GST rate must be 0–40% (in basis points)."]),
    ...(p.liability === "supplier" || p.liability === "platform_eco" ? [] : ["Tax liability must be supplier or platform_eco."]),
  ],
  surge: (p) => [
    // Uncontrolled surge is not allowed: both caps are mandatory.
    ...(isInt(p.maxMultiplierBps) && (p.maxMultiplierBps as number) >= 10_000 && (p.maxMultiplierBps as number) <= 30_000
      ? [] : ["Surge needs a maximum multiplier between 1.00× and 3.00×."]),
    ...(nonNeg(p.maxAddPaise) ? [] : ["Surge needs a maximum additional amount."]),
    ...(optNonNeg(p.flatPaise) ? [] : ["Surge flat amount must be a non-negative number of paise."]),
    ...(p.multiplierBps == null || (isInt(p.multiplierBps) && (p.multiplierBps as number) >= 10_000)
      ? [] : ["Surge multiplier can't be below 1.00×."]),
  ],
  platform_fee: (p) => [
    ...(["fixed", "percent", "tiered"].includes(p.mode as string) ? [] : ["Platform fee mode must be fixed, percent or tiered."]),
    ...(optNonNeg(p.minPaise) && optNonNeg(p.maxPaise) ? [] : ["Platform fee limits must be non-negative paise."]),
    ...(p.minPaise != null && p.maxPaise != null && (p.minPaise as number) > (p.maxPaise as number)
      ? ["Platform fee minimum can't exceed its maximum."] : []),
  ],
  commission: (p) => [
    ...(p.bps == null || (nonNeg(p.bps) && (p.bps as number) <= 10_000) ? [] : ["Commission rate must be 0–100%."]),
    ...(optNonNeg(p.fixedPaise) && optNonNeg(p.minPaise) && optNonNeg(p.maxPaise) ? [] : ["Commission amounts must be non-negative paise."]),
  ],
  promotion: (p) => [
    ...(["percent", "fixed", "free_delivery", "fee_waiver"].includes(p.type as string) ? [] : ["Promotion type must be percent, fixed, free_delivery or fee_waiver."]),
    ...(p.type === "percent" && !nonNeg(p.maxDiscountPaise) ? ["A percentage promotion needs a maximum discount."] : []),
    ...(["platform", "vendor", "split"].includes((p.fundedBy as string) ?? "platform") ? [] : ["Promotion funding must be platform, vendor or split."]),
  ],
  rounding: (p) => [
    ...([p.lineMode, p.taxMode, p.finalMode].every((m) => m == null || ROUNDING_MODES.includes(m as never))
      ? [] : ["Unknown rounding mode."]),
    ...(p.finalStepPaise == null || [0, 1, 50, 100].includes(p.finalStepPaise as number) ? [] : ["Final rounding step must be 0, 1, 50 or 100 paise."]),
  ],
  pipeline: (p) => validatePipeline(Array.isArray(p.steps) ? (p.steps as string[]) : []),
};

export function validateRule(rule: Omit<PricingRule, "version"> & { version?: number }): string[] {
  const problems: string[] = [];
  if (!rule.ruleId || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(rule.ruleId)) {
    problems.push("Rule id must be 3–80 lowercase letters, digits, _ or -.");
  }
  if (!RULE_KINDS.includes(rule.kind)) problems.push(`Unknown rule kind "${rule.kind}".`);
  if (!rule.name || rule.name.trim().length < 3) problems.push("Give the rule a name.");
  if (!isInt(rule.priority)) problems.push("Priority must be a whole number.");
  if (!isInt(rule.effectiveFrom)) problems.push("Effective-from date is required.");
  if (rule.effectiveUntil != null && !(isInt(rule.effectiveUntil) && rule.effectiveUntil > rule.effectiveFrom)) {
    problems.push("Effective-until must be after effective-from.");
  }
  const s = rule.scope ?? {};
  if (s.minOrderPaise != null && s.maxOrderPaise != null && s.minOrderPaise > s.maxOrderPaise) {
    problems.push("Scope minimum order can't exceed maximum order.");
  }
  for (const w of s.timeWindows ?? []) {
    if (!/^\d{2}:\d{2}$/.test(w.from) || !/^\d{2}:\d{2}$/.test(w.to)) problems.push("Time windows use HH:MM (IST).");
  }
  const v = PARAM_VALIDATORS[rule.kind];
  if (v) problems.push(...v((rule.params ?? {}) as Params));
  return problems;
}
