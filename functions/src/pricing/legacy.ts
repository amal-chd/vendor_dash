/**
 * The legacy adapter: today's live pricing, expressed as rules.
 *
 * Before the central engine, prices came from `config/platform`, zone
 * economics, a hard-coded IST peak surge, a manual surge switch in
 * `settings/delivery`, the plan/merchant commission, the `promos` collection
 * plus three coupons compiled into the customer app, and a tax rate each
 * RESTAURANT set for itself. Fees carried no GST.
 *
 * These rules sit at a very low priority, so the engine reproduces current
 * behaviour exactly until Finance / Operations / Marketing publish real rules
 * in the Pricing admin, which then win automatically. Nothing is written to
 * Firestore: the adapter is rebuilt from live config on every load.
 *
 * Pure: no Firebase imports.
 */
import { rupeesToPaise, type Paise } from "./money";
import type { PricingRule, RuleScope } from "./rules";

export const LEGACY_PRIORITY = -1000;

export interface LegacyEconomics {
  deliveryBaseFee: number;
  deliveryPerKm: number;
  freeDeliveryUnderKm: number;
  freeDeliveryAbove: number;
  platformFee: number;
  riderBaseFee: number;
  riderPerKm: number;
}

export interface LegacyZone {
  id: string;
  economics: Pick<LegacyEconomics, "deliveryBaseFee" | "deliveryPerKm" | "freeDeliveryUnderKm" | "freeDeliveryAbove" | "platformFee">;
  surgeMultiplier?: number;
}

export interface LegacyPromo {
  code: string;
  percent: number;
  maxOff: number;
  minSubtotal: number;
  expiresAtMs: number | null;
}

export interface LegacyInputs {
  economics: LegacyEconomics;
  zones: LegacyZone[];
  manualSurge: { active: boolean; feeRupees: number } | null;
  defaultCommissionPercent: number;
  promos: LegacyPromo[];
}

export interface LegacyVendor {
  id: string;
  enableTax: boolean;
  taxPercentage: number;
  taxMethod: string;
  /** Resolved merchant → plan → default commission, or null to use the default rule. */
  commissionPercent: number | null;
  /** Kada Gold partner discount percent; 0/absent means the standard 10% (capped ₹100). */
  goldDiscountPercent?: number;
}

function rule(
  ruleId: string,
  kind: PricingRule["kind"],
  name: string,
  params: Record<string, unknown>,
  scope: RuleScope = {},
  priorityBump = 0,
  effectiveUntil: number | null = null,
): PricingRule {
  return {
    ruleId,
    version: 1,
    kind,
    name: `Legacy: ${name}`,
    active: true,
    priority: LEGACY_PRIORITY + priorityBump,
    effectiveFrom: 0,
    effectiveUntil,
    scope,
    params,
  };
}

const km = (v: number) => Math.round(Math.max(0, v) * 1000);

function deliveryParams(e: LegacyZone["economics"]) {
  return {
    basePaise: rupeesToPaise(e.deliveryBaseFee),
    perKmPaise: rupeesToPaise(e.deliveryPerKm),
    freeUnderMeters: km(e.freeDeliveryUnderKm),
    ...(e.freeDeliveryAbove > 0 ? { freeAbovePaise: rupeesToPaise(e.freeDeliveryAbove) } : {}),
    // The app gave Kada Gold members free delivery.
    goldFree: true,
    // CheckoutController's ₹19 express surcharge (charged to Gold members too).
    expressPaise: 1900,
  };
}

/** The IST peak surge calculateDeliveryFee applied when no manual surge was on. */
const PEAK_WINDOWS: { id: string; name: string; from: string; to: string; rupees: number }[] = [
  { id: "lunch", name: "Peak lunch rush", from: "12:00", to: "14:59", rupees: 15 },
  { id: "dinner", name: "Peak dinner hours", from: "19:00", to: "22:59", rupees: 20 },
  { id: "late", name: "Late-night delivery", from: "23:00", to: "04:59", rupees: 25 },
];

function surgeParams(flat: Paise) {
  // Legacy surge was a flat amount; the cap equals it so it can never grow.
  return { flatPaise: flat, maxMultiplierBps: 10_000, maxAddPaise: flat, applyWhenDeliveryFree: true, goldWaived: true };
}

export function legacyFoodRules(inp: LegacyInputs): PricingRule[] {
  const rules: PricingRule[] = [];
  const food: RuleScope = { product: "food" };

  // Fees carried no GST: record them as exempt so nothing is silently untaxed.
  rules.push(rule("legacy-untaxed", "tax_category", "untaxed fees", { id: "legacy_untaxed", label: "Not taxed (legacy)", rateBps: 0, exempt: true, liability: "supplier" }));
  for (const component of ["packaging", "delivery", "surge", "platform_fee", "small_order_fee", "commission"]) {
    rules.push(rule(`legacy-untaxed-${component.replace(/_/g, "-")}`, "tax_assignment", `${component} untaxed`, {
      component, taxCategoryId: "legacy_untaxed", supplier: component === "packaging" ? "vendor" : "platform",
    }, food));
  }

  rules.push(rule("legacy-delivery", "delivery_fee", "delivery fee", deliveryParams(inp.economics), food));
  rules.push(rule("legacy-platform-fee", "platform_fee", "platform fee", { mode: "fixed", amountPaise: rupeesToPaise(inp.economics.platformFee) }, food));
  rules.push(rule("legacy-rider", "rider_earning", "rider pay", { basePaise: rupeesToPaise(inp.economics.riderBaseFee), perKmPaise: rupeesToPaise(inp.economics.riderPerKm) }, food));
  rules.push(rule("legacy-commission", "commission", "default commission", { bps: Math.round(inp.defaultCommissionPercent * 100) }, food));

  for (const z of inp.zones) {
    const zone: RuleScope = { product: "food", zoneIds: [z.id] };
    rules.push(rule(`legacy-delivery-${z.id}`, "delivery_fee", `delivery fee (${z.id})`, deliveryParams(z.economics), zone));
    rules.push(rule(`legacy-platform-fee-${z.id}`, "platform_fee", `platform fee (${z.id})`, { mode: "fixed", amountPaise: rupeesToPaise(z.economics.platformFee) }, zone));
  }

  const surgeFor = (idSuffix: string, name: string, rupees: number, extraScope: RuleScope, bump: number) => {
    rules.push(rule(`legacy-surge-${idSuffix}`, "surge", name, surgeParams(rupeesToPaise(rupees)), { product: "food", ...extraScope }, bump));
    for (const z of inp.zones) {
      const m = z.surgeMultiplier ?? 1;
      if (m > 1) {
        rules.push(rule(`legacy-surge-${idSuffix}-${z.id}`, "surge", `${name} (${z.id})`,
          surgeParams(rupeesToPaise(Math.round(rupees * m))), { product: "food", zoneIds: [z.id], ...extraScope }, bump));
      }
    }
  };
  for (const w of PEAK_WINDOWS) surgeFor(w.id, w.name, w.rupees, { timeWindows: [{ from: w.from, to: w.to }] }, 0);
  if (inp.manualSurge?.active && inp.manualSurge.feeRupees > 0) {
    surgeFor("manual", "manual surge", inp.manualSurge.feeRupees, {}, 10);
  }

  for (const p of inp.promos) {
    const flat = p.percent >= 100;
    rules.push(rule(`legacy-promo-${p.code.toLowerCase()}`, "promotion", `coupon ${p.code}`, {
      code: p.code,
      label: p.code,
      type: flat ? "fixed" : "percent",
      ...(flat ? { amountPaise: rupeesToPaise(p.maxOff) } : { bps: Math.round(p.percent * 100), maxDiscountPaise: rupeesToPaise(p.maxOff) }),
      minCartPaise: rupeesToPaise(p.minSubtotal),
      fundedBy: "platform",
      // The app took the coupon on the food subtotal and stacked it with Gold.
      basis: "cart",
      stackable: true,
      stackGroup: "coupon",
    }, food, 0, p.expiresAtMs));
  }
  return rules;
}

/** Per-restaurant legacy rules: the tax rate the restaurant set, and its commission. */
export function legacyVendorRules(v: LegacyVendor): PricingRule[] {
  const scope: RuleScope = { product: "food", vendorIds: [v.id] };
  const rules: PricingRule[] = [];
  if (v.enableTax && v.taxPercentage > 0) {
    const bps = Math.round(v.taxPercentage * 100);
    const catId = `legacy_vendor_tax_${bps}`;
    rules.push(rule(`legacy-vtax-${bps}-${v.id}`, "tax_category", `restaurant tax ${v.taxPercentage}%`,
      { id: catId, label: `Restaurant tax ${v.taxPercentage}%`, rateBps: bps, liability: "supplier" }, scope));
    rules.push(rule(`legacy-vtax-items-${v.id}`, "tax_assignment", "restaurant items tax",
      { component: "items", taxCategoryId: catId, supplier: "vendor", inclusive: v.taxMethod === "inclusive" }, scope, 1));
  } else {
    rules.push(rule(`legacy-vtax-items-${v.id}`, "tax_assignment", "restaurant items untaxed",
      { component: "items", taxCategoryId: "legacy_untaxed", supplier: "vendor" }, scope, 1));
  }
  if (v.commissionPercent != null) {
    rules.push(rule(`legacy-commission-${v.id}`, "commission", "merchant commission", { bps: Math.round(v.commissionPercent * 100) }, scope, 1));
  }
  // Kada Gold (CheckoutController.goldDiscount): partner restaurants give their
  // own percent capped at ₹200 and fund it; everywhere else Kada gives 10%
  // capped at ₹100. On the food subtotal, stacking with a coupon.
  const partner = (v.goldDiscountPercent ?? 0) > 0;
  rules.push(rule(`legacy-gold-${v.id}`, "promotion", "Kada Gold discount", {
    label: "Kada Gold discount",
    type: "percent",
    bps: Math.round((partner ? v.goldDiscountPercent! : 10) * 100),
    maxDiscountPaise: partner ? 20_000 : 10_000,
    goldOnly: true,
    basis: "cart",
    stackable: true,
    stackGroup: "gold",
    fundedBy: partner ? "vendor" : "platform",
  }, scope));
  return rules;
}

/**
 * Kada Stay today (calculatePricing): a 12% service fee on the room total, a
 * ₹450 cleaning fee when the room sets none, no GST, and host commission from
 * the plan catalog (default 15%).
 */
export function legacyStayRules(opts: { serviceFeeBps: number; defaultCleaningRupees: number; defaultCommissionPercent: number }): PricingRule[] {
  const stay: RuleScope = { product: "stay" };
  const rules: PricingRule[] = [
    rule("legacy-stay-service-fee", "stay_fee", "stay service fee", { fee: "service", bps: opts.serviceFeeBps }, stay),
    rule("legacy-stay-cleaning", "stay_fee", "default cleaning fee", { fee: "cleaning", amountPaise: rupeesToPaise(opts.defaultCleaningRupees) }, stay),
    rule("legacy-stay-commission", "stay_commission", "default host commission", { bps: Math.round(opts.defaultCommissionPercent * 100) }, stay),
  ];
  for (const component of ["stay_room", "stay_cleaning", "stay_service_fee", "stay_commission"]) {
    rules.push(rule(`legacy-untaxed-${component.replace(/_/g, "-")}`, "tax_assignment", `${component} untaxed`, {
      component,
      taxCategoryId: "legacy_untaxed",
      supplier: component === "stay_room" || component === "stay_cleaning" ? "host" : "platform",
    }, stay));
  }
  return rules;
}

/** A property's resolved commission (merchant → plan → default, after billing model). */
export function legacyHostRules(h: { id: string; commissionPercent: number | null }): PricingRule[] {
  if (h.commissionPercent == null) return [];
  return [
    rule(`legacy-host-commission-${h.id}`, "stay_commission", "host commission", { bps: Math.round(h.commissionPercent * 100) },
      { product: "stay", propertyIds: [h.id] }, 1),
  ];
}
