/**
 * Loads everything the pricing check needs for one customer order and runs it.
 * The rules themselves live in orderPricing.ts (pure, unit-tested); this file
 * only gathers live data: menu items, restaurant tax, promos, the customer's
 * Gold membership, the delivery zone and distance.
 */
import * as admin from "firebase-admin";
import { coord, haversineKm, platformEconomics } from "./delivery";
import { resolveZoneForPoint } from "./zones";
import {
  DEFAULT_PROMOS,
  baseDeliveryFeeFor,
  checkOrderPricing,
  priceLines,
  promoFromDoc,
  restaurantTaxOf,
  taxBreakdown,
  type Doc,
  type PricingCheck,
  type PromoRule,
} from "./orderPricing";

export interface VerifiedPricing extends PricingCheck {
  /** False when the drop point or restaurant couldn't be located (fee floor 0). */
  feeVerified: boolean;
}

function millisOf(v: unknown): number {
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}

function dateOf(v: unknown): Date | null {
  const t = v as { toDate?: () => Date } | null;
  return t && typeof t.toDate === "function" ? t.toDate() : null;
}

export async function verifyCustomerOrderPricing(order: Doc): Promise<VerifiedPricing> {
  const db = admin.firestore();
  const restaurantId = String(order.restaurantId ?? "").trim();
  if (!restaurantId) {
    return {
      ok: false,
      problems: ["The order has no restaurant."],
      floorTotal: 0,
      declaredTotal: Number(order.total) || 0,
      shortfall: 0,
      rawSubtotal: 0,
      maxDiscount: 0,
      feeVerified: false,
    };
  }

  const items = Array.isArray(order.items) ? (order.items as Doc[]) : [];
  const ids = [...new Set(items.map((i) => String(i?.menuItemId ?? "").trim()).filter(Boolean))];
  const uid = String(order.customerUid ?? "").trim();
  const kind = String(order.type ?? order.channel ?? "").toLowerCase();
  const isPickup = kind === "takeaway" || kind === "pickup";
  const drop = coord((order.deliveryAddress as Doc | undefined)?.gps);
  // Happy hour is judged when the order was placed, not when payment lands.
  const pricedAt = dateOf(order.timestamp) ?? new Date();

  const [restaurantSnap, menuSnaps, promoSnap, userSnap, econ, zoneMatch] = await Promise.all([
    db.collection("restaurants").doc(restaurantId).get(),
    ids.length
      ? db.getAll(...ids.map((id) => db.collection("menu").doc(id)))
      : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
    db.collection("promos").where("active", "==", true).get().catch(() => null),
    uid ? db.collection("customer_users").doc(uid).get().catch(() => null) : Promise.resolve(null),
    platformEconomics(),
    drop && !isPickup ? resolveZoneForPoint(drop).catch(() => null) : Promise.resolve(null),
  ]);

  const rData = restaurantSnap.data() ?? {};
  const tax = restaurantTaxOf(rData);
  const menu: Record<string, Doc | undefined> = {};
  for (const s of menuSnaps) menu[s.id] = s.exists ? (s.data() as Doc) : undefined;

  // Same precedence as the app: admin promos override compiled ones by code.
  const byCode = new Map<string, PromoRule>(DEFAULT_PROMOS.map((p) => [p.code, p]));
  for (const d of promoSnap?.docs ?? []) {
    const p = promoFromDoc(d.id, d.data());
    if (p) byCode.set(p.code, p);
  }

  // The app treats Gold as active whenever goldUntil is in the future.
  const isGold = millisOf(userSnap?.data()?.goldUntil) > Date.now();

  const zone = zoneMatch?.zone ?? null;
  const feeEcon = zone
    ? {
        deliveryBaseFee: zone.economics.deliveryBaseFee,
        deliveryPerKm: zone.economics.deliveryPerKm,
        freeDeliveryUnderKm: zone.economics.freeDeliveryUnderKm,
        freeDeliveryAbove: zone.economics.freeDeliveryAbove,
      }
    : econ;
  // The app charges the global platform fee; a zone may set a lower one.
  const platformFee = Math.min(econ.platformFee, zone ? zone.economics.platformFee : econ.platformFee);

  // Pickup and Gold pay no delivery fee in the app. Otherwise hold the order to
  // the distance fee (surge excluded, so a changed surge can't refuse it).
  let deliveryFeeFloor = 0;
  let feeVerified = isPickup || isGold;
  const origin = coord(rData.location) ?? coord(rData.coordinates);
  if (!isPickup && !isGold && drop && origin) {
    const priced = priceLines(items, menu, restaurantId, pricedAt);
    deliveryFeeFloor = baseDeliveryFeeFor({
      distanceKm: haversineKm(origin.lat, origin.lng, drop.lat, drop.lng),
      econ: feeEcon,
      isGoldVip: false,
      orderSubtotal: taxBreakdown(priced.rawSubtotal, tax).subtotal,
    }).fee;
    feeVerified = true;
  }

  const check = checkOrderPricing(order, {
    restaurantId,
    menu,
    restaurant: tax,
    promos: [...byCode.values()],
    nowMs: Date.now(),
    pricedAt,
    isGold,
    deliveryFeeFloor,
    platformFee,
    store: {
      acceptingOrders: rData.acceptingOrders !== false,
      pausedUntilMs: millisOf(rData.pausedUntil) || null,
    },
    scheduledForMs: millisOf(order.scheduledFor) || null,
  });
  return { ...check, feeVerified };
}

/** What gets stamped on the order, so support can see why it was allowed or refused. */
export function pricingAudit(check: VerifiedPricing): Record<string, unknown> {
  return {
    ok: check.ok,
    floorTotal: check.floorTotal,
    declaredTotal: check.declaredTotal,
    shortfall: check.shortfall,
    rawSubtotal: check.rawSubtotal,
    maxDiscount: check.maxDiscount,
    feeVerified: check.feeVerified,
    problems: check.problems.slice(0, 5),
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}
