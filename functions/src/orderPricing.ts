/**
 * ─────────────────────────────────────────────────────────────────────────
 * Server-side order pricing: the floor a customer order must meet before
 * the platform takes money for it.
 *
 * Pure (no Firebase imports), so every rule is unit-tested. It mirrors the
 * customer app — CartItem.unitPrice, CartService.totals()/_discountFor,
 * Promo.fromMap, CheckoutController.goldDiscount/payable — and must change
 * together with it.
 *
 * Why this exists: the customer app writes subtotal, tax, discount, fees and
 * total into the order itself, and the payment callables charged that total.
 * A modified client could pay ₹1 for any basket, and the same number fed
 * vendor settlements and rider cash collection.
 *
 * Model: it computes the LOWEST total a legitimate client could have produced
 * (best allowed promo, server-verified Gold, delivery fee without surge) and
 * refuses orders below it. Surge, express surcharge, tip and donation can only
 * raise a total, so they never cause a false refusal.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type Doc = Record<string, unknown>;

/** Rupees the declared total may fall short by (rounding, float drift). */
export const PRICE_TOLERANCE = 1;

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (v ?? "").toString().trim();
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── Restaurant tax ──────────────────────────────────────────────────────────

export interface RestaurantTax {
  enableTax: boolean;
  taxPercentage: number;
  taxMethod: string; // "inclusive" | "exclusive"
  goldDiscountPercent: number;
}

/** Same defaults as the customer app's Restaurant.fromDoc. */
export function restaurantTaxOf(d: Doc): RestaurantTax {
  return {
    enableTax: d.enableTax === true,
    taxPercentage: num(d.taxPercentage, 5),
    taxMethod: str(d.taxMethod) || "exclusive",
    goldDiscountPercent: num(d.goldDiscountPercent, 0),
  };
}

// ── Time windows (happy hour) ───────────────────────────────────────────────

/** Minutes since midnight in India. Customers price items on IST phone clocks. */
export function istMinutesOfDay(at: Date): number {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function hm(s: string): number | null {
  const p = s.split(":");
  if (p.length !== 2) return null;
  const h = Number.parseInt(p[0], 10);
  const m = Number.parseInt(p[1], 10);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

/** Mirrors MenuItem._within: inclusive, and a window may cross midnight. */
export function withinWindow(from: unknown, to: unknown, minutes: number): boolean {
  const f = hm(str(from));
  const t = hm(str(to));
  if (f === null || t === null) return false;
  return f <= t ? minutes >= f && minutes <= t : minutes >= f || minutes <= t;
}

// ── Item lines ──────────────────────────────────────────────────────────────

interface NamedPrice {
  name: string;
  price: number;
}

function namedPrices(raw: unknown): NamedPrice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Doc => !!x && typeof x === "object")
    .map((x) => ({ name: str(x.name), price: num(x.price) }));
}

export interface PricedLine {
  menuItemId: string;
  name: string;
  qty: number;
  unit: number;
}

/**
 * Re-prices every line from the live menu. A chosen variant carries its own
 * price (it replaces the base); add-ons add on top; happy hour applies only to
 * the base price, evaluated at [pricedAt] on the IST clock.
 */
export function priceLines(
  lines: unknown[],
  menu: Record<string, Doc | undefined>,
  restaurantId: string,
  pricedAt: Date,
): { rawSubtotal: number; lines: PricedLine[]; problems: string[] } {
  const problems: string[] = [];
  const priced: PricedLine[] = [];
  const minutes = istMinutesOfDay(pricedAt);

  for (const raw of lines) {
    const line = (raw && typeof raw === "object" ? raw : {}) as Doc;
    const id = str(line.menuItemId);
    const label = str(line.name) || "An item";
    const qty = Math.trunc(num(line.qty ?? line.quantity, 1));
    if (qty < 1 || qty > 100) {
      problems.push(`${label} has an invalid quantity.`);
      continue;
    }
    const doc = id ? menu[id] : undefined;
    if (!doc) {
      problems.push(`${label} is no longer on the menu.`);
      continue;
    }
    const name = str(doc.name) || label;
    if (str(doc.restaurantId) && str(doc.restaurantId) !== restaurantId) {
      problems.push(`${name} isn't sold by this restaurant.`);
      continue;
    }
    if ((doc.isAvailable ?? doc.available ?? true) === false) {
      problems.push(`${name} is sold out.`);
      continue;
    }

    let base: number;
    const chosen = line.selectedVariant && typeof line.selectedVariant === "object"
      ? str((line.selectedVariant as Doc).name)
      : "";
    if (chosen) {
      const v = namedPrices(doc.variants).find((x) => x.name === chosen);
      if (!v) {
        problems.push(`${name}: the "${chosen}" option is no longer offered.`);
        continue;
      }
      base = v.price;
    } else {
      const happy = num(doc.happyHourPrice);
      base =
        happy > 0 && withinWindow(doc.happyFrom, doc.happyTo, minutes) ? happy : num(doc.price);
    }

    let addons = 0;
    let missingAddon = "";
    const offered = namedPrices(doc.addons);
    for (const a of namedPrices(line.selectedAddons)) {
      const match = offered.find((x) => x.name === a.name);
      if (!match) {
        missingAddon = a.name;
        break;
      }
      addons += match.price;
    }
    if (missingAddon) {
      problems.push(`${name}: the "${missingAddon}" add-on is no longer offered.`);
      continue;
    }

    priced.push({ menuItemId: id, name, qty, unit: base + addons });
  }

  const rawSubtotal = priced.reduce((s, l) => s + l.unit * l.qty, 0);
  return { rawSubtotal, lines: priced, problems };
}

/** Mirrors CartService.totals(): inclusive tax lives inside the item prices. */
export function taxBreakdown(
  rawSubtotal: number,
  r: RestaurantTax,
): { subtotal: number; tax: number; preDiscount: number } {
  if (!r.enableTax) return { subtotal: rawSubtotal, tax: 0, preDiscount: rawSubtotal };
  const pct = r.taxPercentage;
  if (r.taxMethod === "inclusive") {
    const base = rawSubtotal / (1 + pct / 100);
    return { subtotal: base, tax: rawSubtotal - base, preDiscount: rawSubtotal };
  }
  const tax = rawSubtotal * (pct / 100);
  return { subtotal: rawSubtotal, tax, preDiscount: rawSubtotal + tax };
}

// ── Promos ──────────────────────────────────────────────────────────────────

export interface PromoRule {
  code: string;
  percent: number;
  maxOff: number;
  minSubtotal: number;
  expiresAtMs: number | null;
}

/** Compiled into the customer app (CartService._promos). */
export const DEFAULT_PROMOS: readonly PromoRule[] = [
  { code: "KADA50", percent: 50, maxOff: 100, minSubtotal: 149, expiresAtMs: null },
  { code: "WELCOME", percent: 20, maxOff: 50, minSubtotal: 99, expiresAtMs: null },
  { code: "FLAT75", percent: 100, maxOff: 75, minSubtotal: 299, expiresAtMs: null },
];

function millisOf(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const maybe = v as { toMillis?: () => number };
  return typeof maybe.toMillis === "function" ? maybe.toMillis() : null;
}

/** Mirrors Promo.fromMap for an admin-managed `promos/{CODE}` document. */
export function promoFromDoc(id: string, d: Doc): PromoRule | null {
  const code = (str(d.code) || id).toUpperCase();
  if (!code) return null;
  const type = str(d.type).toLowerCase();
  const value = d.value == null ? null : Math.trunc(num(d.value));
  let percent: number;
  let maxOff: number;
  if (type === "flat" && value != null) {
    percent = 100;
    maxOff = value;
  } else if (type === "percent" && value != null) {
    percent = value;
    maxOff = d.maxOff == null ? value : Math.trunc(num(d.maxOff));
  } else {
    percent = Math.trunc(num(d.percent));
    maxOff = Math.trunc(num(d.maxOff));
  }
  if (percent <= 0 || maxOff <= 0) return null;
  return {
    code,
    percent,
    maxOff,
    minSubtotal: Math.trunc(num(d.minOrder ?? d.minSubtotal)),
    expiresAtMs: millisOf(d.expiresAt),
  };
}

/** Mirrors CartService._discountFor. */
export function promoDiscountFor(rawSubtotal: number, p: PromoRule): number {
  if (rawSubtotal < p.minSubtotal) return 0;
  return Math.min((rawSubtotal * p.percent) / 100, p.maxOff);
}

function usable(p: PromoRule, nowMs: number): boolean {
  return p.expiresAtMs == null || p.expiresAtMs >= nowMs;
}

// ── Gold ────────────────────────────────────────────────────────────────────

/** Mirrors CheckoutController.goldDiscount. */
export function goldDiscountFor(subtotal: number, r: RestaurantTax, isGold: boolean): number {
  if (!isGold) return 0;
  const partner = r.goldDiscountPercent > 0;
  const pct = partner ? r.goldDiscountPercent : 10;
  const cap = partner ? 200 : 100;
  return Math.min(Math.max((subtotal * pct) / 100, 0), cap);
}

// ── Delivery fee (base, without surge) ──────────────────────────────────────

export interface DeliveryEconomics {
  deliveryBaseFee: number;
  deliveryPerKm: number;
  freeDeliveryUnderKm: number;
  freeDeliveryAbove: number;
}

/** The distance/basket part of the delivery fee. Shared with calculateDeliveryFee. */
export function baseDeliveryFeeFor(input: {
  distanceKm: number;
  econ: DeliveryEconomics;
  isGoldVip: boolean;
  orderSubtotal: number;
}): { fee: number; breakdown: string } {
  const { distanceKm, econ, isGoldVip, orderSubtotal } = input;
  const km = Number(distanceKm.toFixed(2));
  const sub = Number.isFinite(orderSubtotal) ? orderSubtotal : 0;
  if (isGoldVip && sub >= 149) return { fee: 0, breakdown: "Free delivery (Kada Gold VIP)" };
  if (econ.freeDeliveryAbove > 0 && sub >= econ.freeDeliveryAbove) {
    return { fee: 0, breakdown: `Free delivery above ₹${econ.freeDeliveryAbove}` };
  }
  if (distanceKm <= econ.freeDeliveryUnderKm) {
    return { fee: 0, breakdown: `Free delivery (${km} km)` };
  }
  const extraKm = distanceKm - econ.freeDeliveryUnderKm;
  return {
    fee: Math.round(econ.deliveryBaseFee + extraKm * econ.deliveryPerKm),
    breakdown: `₹${econ.deliveryBaseFee} base + ₹${Math.round(extraKm * econ.deliveryPerKm)} (${km} km)`,
  };
}

// ── The check ───────────────────────────────────────────────────────────────

export interface PricingContext {
  restaurantId: string;
  menu: Record<string, Doc | undefined>;
  restaurant: RestaurantTax;
  /** Compiled defaults plus active admin promos. */
  promos: readonly PromoRule[];
  nowMs: number;
  /** When the order was created — happy hour is judged at that moment. */
  pricedAt: Date;
  /** Server-verified Kada Gold membership. */
  isGold: boolean;
  /** Lowest legitimate delivery fee: 0 for pickup, Gold, or an unlocatable drop. */
  deliveryFeeFloor: number;
  platformFee: number;
  /** Store availability; mirrors Restaurant.orderBlockReason in the app. */
  store?: { acceptingOrders: boolean; pausedUntilMs: number | null };
  /** A scheduled order's slot, which may fall after a pause. */
  scheduledForMs?: number | null;
}

/**
 * Why the store can't take this order now, or null. Offline refuses outright;
 * a pause allows only a slot after it. The app checked this, but the server
 * didn't, so an out-of-date or modified app could order from a closed store.
 */
export function storeBlockProblem(
  store: { acceptingOrders: boolean; pausedUntilMs: number | null },
  scheduledForMs: number | null,
  nowMs: number,
): string | null {
  if (!store.acceptingOrders) return "This restaurant is offline and isn't taking orders right now.";
  if (store.pausedUntilMs != null && store.pausedUntilMs > nowMs) {
    if (scheduledForMs != null && scheduledForMs > store.pausedUntilMs) return null;
    return "This restaurant is temporarily paused. Schedule for later or try again shortly.";
  }
  return null;
}

export interface PricingCheck {
  ok: boolean;
  problems: string[];
  floorTotal: number;
  declaredTotal: number;
  shortfall: number;
  rawSubtotal: number;
  maxDiscount: number;
}

export function checkOrderPricing(order: Doc, ctx: PricingContext): PricingCheck {
  const items = Array.isArray(order.items) ? order.items : [];
  const priced = priceLines(items, ctx.menu, ctx.restaurantId, ctx.pricedAt);
  const problems = [...priced.problems];
  if (items.length === 0) problems.push("The order has no items.");
  const closed = ctx.store ? storeBlockProblem(ctx.store, ctx.scheduledForMs ?? null, ctx.nowMs) : null;
  if (closed) problems.unshift(closed);

  const t = taxBreakdown(priced.rawSubtotal, ctx.restaurant);
  const live = ctx.promos.filter((p) => usable(p, ctx.nowMs));
  const code = str(order.promoCode).toUpperCase();
  let promoMax: number;
  if (code) {
    // A client that names its code gets exactly that code's discount.
    const p = live.find((x) => x.code === code);
    promoMax = p ? promoDiscountFor(priced.rawSubtotal, p) : 0;
  } else {
    // Older clients don't send the code: allow the best one that applies.
    promoMax = live.reduce((m, p) => Math.max(m, promoDiscountFor(priced.rawSubtotal, p)), 0);
  }
  const maxDiscount =
    Math.min(t.preDiscount, promoMax) + goldDiscountFor(t.subtotal, ctx.restaurant, ctx.isGold);

  const floorTotal = round2(
    Math.max(0, t.preDiscount - maxDiscount) +
      Math.max(0, num(order.tip)) +
      Math.max(0, num(order.donation)) +
      Math.max(0, ctx.deliveryFeeFloor) +
      Math.max(0, ctx.platformFee),
  );
  const declaredTotal = round2(num(order.total ?? order.totalAmount));
  const shortfall = round2(floorTotal - declaredTotal);

  return {
    ok: problems.length === 0 && shortfall <= PRICE_TOLERANCE,
    problems,
    floorTotal,
    declaredTotal,
    shortfall,
    rawSubtotal: round2(priced.rawSubtotal),
    maxDiscount: round2(maxDiscount),
  };
}

/** One operator-/customer-facing sentence for a refused order. */
export function pricingRefusal(check: PricingCheck): string {
  if (check.problems.length > 0) {
    return `${check.problems.slice(0, 3).join(" ")} Please review your cart. You have not been charged.`;
  }
  return "Prices have changed since you added these items. Please review your cart. You have not been charged.";
}
