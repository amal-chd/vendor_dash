/**
 * Builds the food engine's input from a customer's cart using only server
 * data: live menu prices, the restaurant, the customer's entitlements, the
 * zone and distance, promo usage. The client sends item ids, quantities and
 * option NAMES — never a price.
 */
import * as admin from "firebase-admin";
import { coord, haversineKm, platformEconomics } from "../delivery";
import { resolveZoneForPoint } from "../zones";
import { istMinutesOfDay, storeBlockProblem, withinWindow } from "../orderPricing";
import { readCatalog, commissionForMerchant } from "../planCatalog";
import { effectiveCommissionRate } from "../billingModel";
import { legacyVendorRules } from "./legacy";
import { loadRuleset } from "./store";
import { rupeesToPaise, type Paise } from "./money";
import { stateCodeOf } from "./states";
import type { FoodCartLine, FoodQuoteInput } from "./food";
import type { AnyRule } from "./rules";
import type { PromotionParams } from "./promotions";

export interface FoodCartItemRequest {
  menuItemId: string;
  qty: number;
  selectedVariant?: { name?: string } | null;
  selectedAddons?: { name?: string }[];
}

export interface FoodCartRequest {
  restaurantId: string;
  items: FoodCartItemRequest[];
  fulfilment: "delivery" | "pickup";
  /** Express delivery (CheckoutController deliverySpeed 0). */
  express?: boolean;
  drop: { lat: number; lng: number } | null;
  couponCode: string | null;
  tipPaise: Paise;
  donationPaise: Paise;
  at?: number;
}

type Doc = Record<string, unknown>;
const str = (v: unknown) => (v ?? "").toString().trim();
const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const slug = (v: unknown) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";

function namedPrices(raw: unknown): { name: string; pricePaise: Paise }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Doc => !!x && typeof x === "object")
    .map((x) => ({ name: str(x.name), pricePaise: rupeesToPaise(x.price) }));
}

function millis(v: unknown): number {
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}

/** Resolves each requested item against the live menu, in paise. */
export function resolveCartLines(
  items: readonly FoodCartItemRequest[],
  menu: Record<string, Doc | undefined>,
  restaurantId: string,
  at: number,
): { lines: FoodCartLine[]; problems: string[] } {
  const problems: string[] = [];
  const lines: FoodCartLine[] = [];
  const minutes = istMinutesOfDay(new Date(at));
  items.forEach((item, index) => {
    const doc = menu[item.menuItemId];
    if (!doc) {
      problems.push("An item in your cart is no longer on the menu.");
      return;
    }
    const name = str(doc.name) || "Item";
    if (str(doc.restaurantId) !== restaurantId) {
      problems.push(`${name} isn't sold by this restaurant.`);
      return;
    }
    if ((doc.isAvailable ?? doc.available ?? true) === false) {
      problems.push(`${name} is sold out.`);
      return;
    }
    const variantName = str(item.selectedVariant?.name);
    let unit: Paise;
    let label = name;
    if (variantName) {
      const v = namedPrices(doc.variants).find((x) => x.name === variantName);
      if (!v) {
        problems.push(`${name}: the "${variantName}" option is no longer offered.`);
        return;
      }
      unit = v.pricePaise;
      label = `${name} (${variantName})`;
    } else {
      const happy = rupeesToPaise(doc.happyHourPrice);
      unit = happy > 0 && withinWindow(doc.happyFrom, doc.happyTo, minutes) ? happy : rupeesToPaise(doc.price);
    }
    const offered = namedPrices(doc.addons);
    const modifiers: FoodCartLine["modifiers"] = [];
    for (const a of item.selectedAddons ?? []) {
      const match = offered.find((x) => x.name === str(a.name));
      if (!match) {
        problems.push(`${name}: the "${str(a.name)}" add-on is no longer offered.`);
        return;
      }
      modifiers.push({ name: match.name, unitPaise: match.pricePaise });
    }
    const packaging = doc.packagingPaise != null ? num(doc.packagingPaise) : doc.packagingCharge != null ? rupeesToPaise(doc.packagingCharge) : null;
    lines.push({
      lineId: `${index + 1}-${item.menuItemId}`,
      menuItemId: item.menuItemId,
      name: label,
      categoryId: slug(doc.categoryId ?? doc.category),
      qty: Math.trunc(num(item.qty, 1)),
      unitPaise: unit,
      modifiers,
      packagingPaise: packaging,
      taxCategoryId: str(doc.taxCategoryId) || null,
    });
  });
  return { lines, problems };
}

export async function buildFoodQuoteInput(
  uid: string | null,
  req: FoodCartRequest,
): Promise<{ input: FoodQuoteInput; rules: AnyRule[]; problems: string[]; context: { zoneId: string | null; restaurantName: string } }> {
  const db = admin.firestore();
  const at = req.at ?? Date.now();
  const ids = [...new Set(req.items.map((i) => str(i.menuItemId)).filter(Boolean))];

  // The zone lookup only needs the drop point, so it runs alongside the reads
  // instead of after them — one less round trip on every checkout quote.
  const zoneLookup =
    req.fulfilment === "delivery" && req.drop ? resolveZoneForPoint(req.drop).catch(() => null) : Promise.resolve(null);
  const [restaurantSnap, menuSnaps, userSnap, pastOrders, econ, platformSnap, catalog, baseRules, zoneMatch] = await Promise.all([
    db.collection("restaurants").doc(req.restaurantId).get(),
    ids.length ? db.getAll(...ids.map((id) => db.collection("menu").doc(id))) : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
    uid ? db.collection("customer_users").doc(uid).get().catch(() => null) : Promise.resolve(null),
    uid
      ? db.collection("orders").where("customerUid", "==", uid).where("status", "in", ["delivered", "completed"]).limit(3).get().catch(() => null)
      : Promise.resolve(null),
    platformEconomics(),
    db.collection("config").doc("platform").get().catch(() => null),
    readCatalog(),
    loadRuleset(),
    zoneLookup,
  ]);

  const problems: string[] = [];
  const r = (restaurantSnap.data() ?? {}) as Doc;
  if (!restaurantSnap.exists) problems.push("This restaurant is no longer available.");
  const menu: Record<string, Doc | undefined> = {};
  for (const s of menuSnaps) menu[s.id] = s.exists ? (s.data() as Doc) : undefined;
  const resolved = resolveCartLines(req.items, menu, req.restaurantId, at);
  problems.push(...resolved.problems);

  const closed = storeBlockProblem(
    { acceptingOrders: r.acceptingOrders !== false, pausedUntilMs: millis(r.pausedUntil) || null },
    null,
    at,
  );
  if (closed) problems.push(closed);

  // Zone, distance, minimum order.
  const origin = coord(r.location) ?? coord(r.coordinates);
  let zoneId: string | null = null;
  let distanceKm: number | null = null;
  let minOrderRupees = econ.minOrderValue;
  if (req.fulfilment === "delivery") {
    if (!req.drop) problems.push("Choose a delivery address on the map.");
    else {
      const match = zoneMatch;
      zoneId = match?.zone?.id ?? null;
      if (match?.zone) minOrderRupees = match.zone.economics.minOrderValue;
      if (origin) {
        distanceKm = haversineKm(origin.lat, origin.lng, req.drop.lat, req.drop.lng);
        const radius = Math.min(25, Math.max(1, match?.zone?.economics.maxDeliveryRadiusKm || econ.serviceRadiusKm || 15));
        if (distanceKm > radius) problems.push(`This restaurant delivers up to ${radius} km; your address is ${distanceKm.toFixed(1)} km away.`);
      } else {
        problems.push("This restaurant's location isn't set, so delivery can't be priced.");
      }
    }
  }
  if (econ.maintenanceMode) problems.push("Ordering is paused for maintenance.");

  // Commission: merchant → plan → default, then the billing model.
  const p = (platformSnap?.data() ?? {}) as Doc;
  const commission = commissionForMerchant(catalog, "dine", r, num(p.defaultCommissionPercent, 10));
  const billing = effectiveCommissionRate(r as Doc & { billingModel?: unknown }, commission.rate);

  const vendorState = stateCodeOf(r.stateCode ?? r.state ?? r.gstin ?? r.gstNumber);
  const u = (userSnap?.data() ?? {}) as Doc;
  const completedOrders = pastOrders?.size ?? 0;

  const vendorRules = legacyVendorRules({
    id: req.restaurantId,
    enableTax: r.enableTax === true,
    taxPercentage: num(r.taxPercentage, 5),
    taxMethod: str(r.taxMethod) || "exclusive",
    commissionPercent: billing.rate,
    goldDiscountPercent: num(r.goldDiscountPercent, 0),
  });
  const rules = [...baseRules, ...vendorRules];

  // Usage counters only for promotions that are limited.
  const limited = rules.filter(
    (x) => x.kind === "promotion" && ((x.params as PromotionParams).usageLimit != null || (x.params as PromotionParams).perCustomerLimit != null),
  );
  const usage = { total: {} as Record<string, number>, byCustomer: {} as Record<string, number> };
  if (limited.length) {
    const refs = limited.flatMap((x) => [
      db.collection("promo_usage").doc(x.ruleId),
      ...(uid ? [db.collection("promo_usage").doc(x.ruleId).collection("customers").doc(uid)] : []),
    ]);
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const count = num(s.data()?.count);
      if (s.ref.parent.id === "promo_usage") usage.total[s.id] = count;
      else usage.byCustomer[s.ref.parent.parent!.id] = count;
    }
  }

  const input: FoodQuoteInput = {
    at,
    customer: {
      uid: uid ?? "",
      completedOrders,
      isNew: completedOrders === 0,
      referred: str(u.referredBy) !== "",
      isGold: millis(u.goldUntil) > at,
      // Addresses don't carry a state yet: bill in the restaurant's state.
      stateCode: stateCodeOf(u.billingStateCode ?? u.billingState) || vendorState,
    },
    vendor: {
      id: req.restaurantId,
      name: str(r.name) || "Restaurant",
      stateCode: vendorState,
      gstin: str(r.gstin ?? r.gstNumber) || null,
      pricesIncludeTax: r.enableTax === true && str(r.taxMethod) === "inclusive",
      packagingPaise: r.packagingCharge != null ? rupeesToPaise(r.packagingCharge) : null,
      commissionWaived: false,
    },
    platform: { gstin: str(p.platformGstin) || null, stateCode: stateCodeOf(p.platformStateCode ?? p.platformGstin) || vendorState },
    fulfilment: req.fulfilment,
    express: req.fulfilment === "delivery" && req.express === true,
    zoneId,
    distanceKm,
    demand: null,
    weatherAlert: false,
    minOrderPaise: minOrderRupees > 0 ? rupeesToPaise(minOrderRupees) : null,
    lines: resolved.lines,
    couponCode: req.couponCode,
    tipPaise: Math.max(0, Math.trunc(req.tipPaise)),
    donationPaise: Math.max(0, Math.trunc(req.donationPaise)),
    promoUsage: usage,
  };
  return { input, rules, problems, context: { zoneId, restaurantName: input.vendor.name } };
}
