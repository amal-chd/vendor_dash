import * as admin from "firebase-admin";
import { withFinance } from "./pricing/orderFinance";
import { withCronHeartbeat } from "./cronHealth";
import { awardedTodayFrom, parseQuestTiers, tiersToAward } from "./questTiers";
import { deliveriesSoFarToday, earningsFields } from "./riderEarnings";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { HOT_PATH } from "./options";
import { resolveZoneForPoint } from "./zones";
import { baseDeliveryFeeFor } from "./orderPricing";
import { isOrderHeld } from "./vendorOrderRules";
import {
  requireShopRelease,
  logEvent,
  writeEvent,
  OrderStatus,
  DeliveryState,
  POST_PICKUP,
  SCHEDULED_DISPATCH_LEAD_MIN,
  isTerminalOrder,
  scheduledDispatchHold,
} from "./deliveryLifecycle";
import { assertAdmin } from "./adminAuthz";

/**
 * Delivery ecosystem backend: rider auto-assignment, live-delivery lifecycle,
 * and rider earnings. Orders live in the shared top-level `orders` collection;
 * riders in `delivery_users/{uid}`. The assignment engine offers a ready order
 * to the nearest available online rider, who accepts/rejects; on timeout the
 * order is re-offered to the next candidate. See firestore.rules for the
 * matching client-side write boundaries.
 */

const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── Tunables ────────────────────────────────────────────────────────────────
const OFFER_TTL_SECONDS = 45; // how long a rider has to accept an offer
const RIDER_BASE_FEE = 20; // ₹ base pay per delivery
const RIDER_PER_KM = 8; // ₹ per km (restaurant → drop)
const MAX_ASSIGN_RADIUS_KM = 12; // ignore riders farther than this from pickup
/**
 * Presence. The rider app writes `locationUpdatedAt` on movement and as a
 * heartbeat at least every 2 minutes while online. Silence past these limits
 * means the phone died, lost signal or was killed:
 *   - dispatch skips the rider (an offer would just time out, delaying the
 *     customer by a full offer window per dead phone), and
 *   - the presence sweep takes them offline and says why, so the app never
 *     shows "Online" to a rider the platform has stopped dispatching to.
 */
export const PRESENCE_DISPATCH_STALE_MS = 10 * 60_000;
export const PRESENCE_OFFLINE_STALE_MS = 20 * 60_000;

/** True when a rider's last presence signal is older than [limitMs]. Absent = unknown, not stale. */
export function presenceIsStale(locationUpdatedAt: unknown, now: number, limitMs: number): boolean {
  const ms =
    locationUpdatedAt instanceof admin.firestore.Timestamp
      ? locationUpdatedAt.toMillis()
      : typeof (locationUpdatedAt as { toMillis?: unknown })?.toMillis === "function"
        ? (locationUpdatedAt as { toMillis: () => number }).toMillis()
        : NaN;
  return Number.isFinite(ms) && now - ms > limitMs;
}

const DELIVERY_TYPES = ["delivery"];

// Admin-tunable platform economics, read from `config/platform` (managed on the
// website admin "Platform Settings" page). Falls back to the constants above so
// behaviour is unchanged until an admin overrides them.
export interface PlatformEconomics {
  riderBaseFee: number;
  riderPerKm: number;
  deliveryBaseFee: number;
  deliveryPerKm: number;
  freeDeliveryUnderKm: number;
  freeDeliveryAbove: number;
  minOrderValue: number;
  platformFee: number;
  serviceRadiusKm: number;
  codEnabled: boolean;
  maintenanceMode: boolean;
  autoDispatchEnabled: boolean;
}
/**
 * `config/platform` is a single small document that changes when an admin edits
 * settings — minutes or days apart — but it was read on every checkout, every
 * quote and every dispatch. With Firestore still in nam5 and the functions in
 * Mumbai, each of those reads is a transpacific round trip measured at
 * 400-1100 ms, paid again for every request.
 *
 * Cache it per instance for a minute. The cost is that a settings change takes
 * up to 60 s to reach every warm instance, which is acceptable for fees, radius
 * and flags — including maintenanceMode, where a minute's lag is far cheaper
 * than a second of latency on every order.
 */
const ECONOMICS_TTL_MS = 60_000;
let economicsCache: { value: PlatformEconomics; at: number } | null = null;

/** Drops the cache so a test, or an admin write, can force a re-read. */
export function invalidatePlatformEconomics(): void {
  economicsCache = null;
}

export async function platformEconomics(): Promise<PlatformEconomics> {
  if (economicsCache && Date.now() - economicsCache.at < ECONOMICS_TTL_MS) {
    return economicsCache.value;
  }
  const fresh = await readPlatformEconomics();
  economicsCache = { value: fresh, at: Date.now() };
  return fresh;
}

async function readPlatformEconomics(): Promise<PlatformEconomics> {
  const fallback: PlatformEconomics = {
    riderBaseFee: RIDER_BASE_FEE,
    riderPerKm: RIDER_PER_KM,
    deliveryBaseFee: 25,
    deliveryPerKm: 7,
    freeDeliveryUnderKm: 3,
    freeDeliveryAbove: 0,
    minOrderValue: 0,
    platformFee: 0,
    serviceRadiusKm: 15,
    codEnabled: true,
    maintenanceMode: false,
    autoDispatchEnabled: true,
  };
  const nonNegative = (value: unknown, fallbackValue: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallbackValue;
  };
  try {
    const snap = await db().collection("config").doc("platform").get();
    const d = snap.data() ?? {};
    return {
      riderBaseFee: nonNegative(d.riderBaseFee, fallback.riderBaseFee),
      riderPerKm: nonNegative(d.riderPerKm, fallback.riderPerKm),
      deliveryBaseFee: nonNegative(d.deliveryBaseFee, fallback.deliveryBaseFee),
      deliveryPerKm: nonNegative(d.deliveryPerKm, fallback.deliveryPerKm),
      freeDeliveryUnderKm: nonNegative(d.freeDeliveryUnderKm, fallback.freeDeliveryUnderKm),
      freeDeliveryAbove: nonNegative(d.freeDeliveryAbove, fallback.freeDeliveryAbove),
      minOrderValue: nonNegative(d.minOrderValue, fallback.minOrderValue),
      platformFee: nonNegative(d.platformFee, fallback.platformFee),
      serviceRadiusKm: nonNegative(d.serviceRadiusKm, fallback.serviceRadiusKm),
      codEnabled: typeof d.codEnabled === "boolean" ? d.codEnabled : fallback.codEnabled,
      maintenanceMode: typeof d.maintenanceMode === "boolean" ? d.maintenanceMode : fallback.maintenanceMode,
      autoDispatchEnabled: typeof d.autoDispatchEnabled === "boolean" ? d.autoDispatchEnabled : fallback.autoDispatchEnabled,
    };
  } catch {
    return fallback;
  }
}

// ── Geo ───────────────────────────────────────────────────────────────────--
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function coord(obj: any): { lat: number; lng: number } | null {
  if (!obj || typeof obj !== "object") return null;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Pickup point = restaurant location (falls back to order-embedded coords). */
async function pickupCoord(order: FirebaseFirestore.DocumentData): Promise<{ lat: number; lng: number } | null> {
  const restaurantId = (order.restaurantId ?? "").toString();
  if (restaurantId) {
    try {
      const snap = await db().collection("restaurants").doc(restaurantId).get();
      const loc = coord(snap.data()?.location);
      if (loc) return loc;
    } catch (e) {
      logger.warn("pickupCoord: restaurant read failed", e);
    }
  }
  return coord(order.restaurantLocation);
}

function dropCoord(order: FirebaseFirestore.DocumentData): { lat: number; lng: number } | null {
  const gps = order.deliveryAddress?.gps;
  return coord(gps);
}

// ── ETA (researched: Swiggy/Zomato model) ────────────────────────────────────
// Delivery time = max(prep time, first-mile travel) + last-mile travel.
// The rider riding to the restaurant happens in PARALLEL with food prep, so we
// take the max of the two, then add the restaurant→customer leg.
// https://bytes.swiggy.com/predicting-food-delivery-time-at-cart-cda23a84ba63
const ROAD_WINDING_FACTOR = 1.3; // straight-line km → approx road km
const AVG_RIDER_SPEED_KMH = 20; // two-wheeler in Indian city traffic
const PICKUP_HANDLING_MIN = 3; // dwell at restaurant + handoff at door

/** Travel minutes for a straight-line distance, road-adjusted. */
function travelMinutes(straightKm: number): number {
  return (straightKm * ROAD_WINDING_FACTOR) / AVG_RIDER_SPEED_KMH * 60;
}

/** Prep time from the order's item count (base + per-item, capped). */
function prepMinutes(order: FirebaseFirestore.DocumentData): number {
  const items = Array.isArray(order.items) ? order.items : [];
  const count = items.reduce((s: number, it: any) => {
    const q = Number(it?.qty ?? it?.quantity ?? 1);
    return s + (Number.isFinite(q) ? q : 1);
  }, 0);
  return Math.min(45, Math.round(12 + count * 1.5));
}

/**
 * Compute and stamp the ETA on the order. When a rider is known, the first-mile
 * leg uses the rider's real position; otherwise it falls back to the prep time
 * (prep dominates before a rider is assigned).
 */
async function stampEta(
  orderRef: FirebaseFirestore.DocumentReference,
  order: FirebaseFirestore.DocumentData,
  riderCoord?: { lat: number; lng: number } | null
): Promise<void> {
  const pickup = await pickupCoord(order);
  const drop = dropCoord(order);
  const prep = prepMinutes(order);
  const lastMile = pickup && drop
    ? travelMinutes(haversineKm(pickup.lat, pickup.lng, drop.lat, drop.lng))
    : 15;
  const firstMile = riderCoord && pickup
    ? travelMinutes(haversineKm(riderCoord.lat, riderCoord.lng, pickup.lat, pickup.lng))
    : Math.min(prep, 8);
  const total = Math.round(Math.max(prep, firstMile) + lastMile + PICKUP_HANDLING_MIN);
  await orderRef.set(
    {
      prepTimeMinutes: prep,
      etaMinutes: total,
      estimatedDeliveryAt: admin.firestore.Timestamp.fromMillis(Date.now() + total * 60_000),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// ── Push ────────────────────────────────────────────────────────────────────
/**
 * Rich, premium push:
 * - Per-order collapse: successive status updates for the same order REPLACE
 *   each other in the shade (Android `tag` + APNs `apns-collapse-id`) instead
 *   of stacking five stale alerts.
 * - Grouping: orders thread together (APNs `threadId`).
 * - Optional big-picture image (food/restaurant photo) on Android + iOS
 *   (`mutable-content` lets a future notification-service extension attach it).
 * - Deep link: `clickAction` routes taps straight to live tracking.
 */
async function pushToTokens(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, any> = {},
  opts: { imageUrl?: string; collapseKey?: string } = {}
): Promise<void> {
  const unique = Array.from(new Set((tokens || []).filter(Boolean)));
  if (unique.length === 0) return;
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) stringData[k] = String(v);
  }
  const collapse = (opts.collapseKey ?? stringData.orderId ?? "").toString();
  try {
    await admin.messaging().sendEachForMulticast({
      tokens: unique,
      notification: {
        title,
        body,
        ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
      },
      data: stringData,
      apns: {
        ...(collapse ? { headers: { "apns-collapse-id": collapse.slice(0, 64) } } : {}),
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            mutableContent: true,
            ...(collapse ? { threadId: collapse } : {}),
          },
        },
        ...(opts.imageUrl ? { fcmOptions: { imageUrl: opts.imageUrl } } : {}),
      },
      android: {
        priority: "high",
        notification: {
          channelId: "high_importance_channel",
          sound: "default",
          color: "#2563EB",
          ...(collapse ? { tag: collapse } : {}),
          ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
    });
  } catch (e) {
    logger.error("pushToTokens failed", e);
  }
}

async function notifyRider(riderId: string, title: string, body: string, data: Record<string, any> = {}) {
  // In-app notification record for the rider's Notifications screen + bell
  // (delivery_users/{uid}/notifications). Transient offers are push-only so the
  // persistent feed isn't cluttered with expired 45s requests — pass
  // `inApp: false`, or use kind "offer", to skip the record.
  const kind = (data.type ?? data.kind ?? "system").toString();
  const persist = data.inApp !== false && kind !== "offer";
  if (persist) {
    try {
      const type = ["order", "earning", "promo", "system", "achievement"].includes(kind)
        ? kind
        : (kind === "cancelled" ? "order" : "system");
      await db().collection("delivery_users").doc(riderId)
        .collection("notifications").add({
          title,
          body,
          type,
          isRead: false,
          createdAt: FieldValue.serverTimestamp(),
          data,
        });
    } catch (e) {
      logger.warn("notifyRider: in-app write failed", e);
    }
  }

  try {
    const snap = await db().collection("delivery_users").doc(riderId).get();
    const tokens = (snap.data()?.fcmTokens as string[]) || [];
    await pushToTokens(tokens, title, body, { ...data, channel: "rider" });
  } catch (e) {
    logger.warn("notifyRider failed", e);
  }

  // Dispatch to Notification Engine
  try {
     // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { processNotificationEvent } = require("./notificationEngine/engine");
    await processNotificationEvent({
      event: `system.rider_notification`,
      entityType: 'rider',
      entityId: riderId,
      timestamp: Date.now(),
      data: { title, body, ...data }
    });
  } catch (e) {
    logger.warn("notifyRider: engine dispatch failed", e);
  }
}

/** Writes an in-app notification for the customer AND pushes to their devices. */
async function notifyCustomer(order: FirebaseFirestore.DocumentData, orderId: string, title: string, body: string) {
  const uid = (order.customerUid ?? "").toString();
  if (!uid) return;
  try {
    await db()
      .collection("customer_users")
      .doc(uid)
      .collection("notifications")
      .add({
        title,
        body,
        read: false,
        type: "order",
        orderId,
        timestamp: FieldValue.serverTimestamp(),
      });
  } catch (e) {
    logger.warn("notifyCustomer: write failed", e);
  }
  try {
    const snap = await db().collection("customer_users").doc(uid).get();
    const tokens = (snap.data()?.fcmTokens as string[]) || [];
    // Big-picture: lead item's photo (falls back to restaurant image) makes the
    // shade notification feel like the order, not a generic alert.
    const items = Array.isArray(order.items) ? order.items : [];
    const imageUrl = (items[0]?.image ?? order.restaurantImage ?? "").toString() || undefined;
    await pushToTokens(tokens, title, body, { orderId, type: "order" }, { imageUrl, collapseKey: orderId });
  } catch (e) {
    logger.warn("notifyCustomer: push failed", e);
  }

  // Dispatch to Notification Engine
  try {
     // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { processNotificationEvent } = require("./notificationEngine/engine");
    await processNotificationEvent({
      event: `system.customer_order_notification`,
      entityType: 'customer',
      entityId: uid,
      timestamp: Date.now(),
      data: { title, body, orderId }
    });
  } catch (e) {
    logger.warn("notifyCustomer: engine dispatch failed", e);
  }
}

// ── Candidate riders ──────────────────────────────────────────────────────---
interface Candidate {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
  distanceKm: number;
}

/**
 * Approved + online riders with no active order, sorted by distance from the
 * pickup point, excluding anyone in `excludeIds`. Runs with admin privileges so
 * it can read the whole fleet.
 */
async function findCandidateRiders(
  pickup: { lat: number; lng: number } | null,
  excludeIds: string[],
  restaurantId?: string
): Promise<Candidate[]> {
  const snap = await db()
    .collection("delivery_users")
    .where("status", "==", "approved")
    .where("isOnline", "==", true)
    .get();

  const out: Candidate[] = [];
  const skipped: string[] = [];
  for (const doc of snap.docs) {
    if (excludeIds.includes(doc.id)) {
      skipped.push(`${doc.id}:already-attempted`);
      continue;
    }
    const d = doc.data();

    // ── Onboarding gate ──────────────────────────────────────────────────
    // `status == "approved"` alone is not enough to dispatch to. It is a
    // single legacy flag with no awareness of KYC completeness, document
    // expiry or banking — so a rider whose insurance lapsed last month, or
    // who was suspended by the expiry sweep, still looked dispatchable here.
    // The engine's lifecycle state is the real answer.
    //
    // An ABSENT record does not skip the rider: legacy riders predate the
    // engine and the backfill owns them. Refusing them here would strand
    // the fleet the moment this deploys, before the backfill has run.
    const obState = d.onboarding?.state;
    if (obState && obState !== "active") {
      skipped.push(`${doc.id}:onboarding(${obState})`);
      continue;
    }

    // "Take a break" in the rider app: online (shift streak kept) but not
    // taking orders. It used to be ignored here, so riders on a break were
    // still offered — and penalised for missing — orders.
    if (d.isPaused === true) {
      skipped.push(`${doc.id}:on-break`);
      continue;
    }

    if (presenceIsStale(d.locationUpdatedAt, Date.now(), PRESENCE_DISPATCH_STALE_MS)) {
      skipped.push(`${doc.id}:no-signal`);
      continue;
    }

    // Busy check with batching capability:
    const currentOrderId = (d.currentOrderId ?? "").toString();
    if (currentOrderId) {
      let stale = false;
      let canBatch = false;
      try {
        const orderSnap = await db().collection("orders").doc(currentOrderId).get();
        const ds = (orderSnap.data()?.deliveryStatus ?? "").toString();
        const st = (orderSnap.data()?.status ?? "").toString().toLowerCase();
        
        stale =
          !orderSnap.exists ||
          ["delivered", "cancelled"].includes(ds) ||
          ["delivered", "completed", "cancelled", "canceled", "rejected", "paid"].includes(st);

        // Batching Logic: If the rider is still at the restaurant (not yet on the way to the customer),
        // and the new order is from the exact same restaurant, we can batch it to them.
        const currentRestaurantId = (orderSnap.data()?.restaurantId ?? "").toString();
        if (!stale && restaurantId && currentRestaurantId === restaurantId && ["assigned", "at_restaurant"].includes(ds)) {
           canBatch = true;
           logger.info(`findCandidateRiders: Batching allowed for rider ${doc.id} (already at restaurant ${restaurantId})`);
        }
      } catch {
        // Read failed — assume genuinely busy rather than double-assigning.
      }
      if (stale) {
        await doc.ref
          .set({ currentOrderId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
          .catch(() => {});
        logger.info(`findCandidateRiders: healed stale currentOrderId ${currentOrderId} on rider ${doc.id}`);
      } else if (!canBatch) {
        skipped.push(`${doc.id}:busy(${currentOrderId})`);
        continue;
      }
    }

    const loc = coord(d.location);
    let distanceKm = Number.POSITIVE_INFINITY;
    if (pickup && loc) {
      distanceKm = haversineKm(pickup.lat, pickup.lng, loc.lat, loc.lng);
      if (distanceKm > MAX_ASSIGN_RADIUS_KM) {
        skipped.push(`${doc.id}:too-far(${distanceKm.toFixed(1)}km)`);
        continue;
      }
    }
    out.push({
      id: doc.id,
      name: (d.name ?? "Rider").toString(),
      phone: (d.phone ?? "").toString(),
      vehicle: [d.vehicleType, d.vehicleNumber].filter(Boolean).join(" • "),
      distanceKm,
    });
  }
  if (out.length === 0) {
    // Make "no riders" diagnosable in production instead of a dead end.
    logger.info(
      `findCandidateRiders: 0 candidates (online+approved=${snap.size})` +
        (skipped.length ? ` skipped=[${skipped.join(", ")}]` : ""),
    );
  }
  // Riders with a known location (finite distance) rank first, nearest first.
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
}

const NON_DELIVERY_TYPES = ["takeaway", "pickup", "dine-in", "dinein", "dine_in"];

function isDeliveryOrder(order: FirebaseFirestore.DocumentData): boolean {
  const type = (order.type ?? order.channel ?? "").toString().toLowerCase();
  const source = (order.orderSource ?? "").toString().toLowerCase();
  // Takeaway / self-pickup / dine-in orders never need a rider, even though the
  // customer app stamps orderSource="delivery_app" on every order it creates.
  // Exclude them explicitly BEFORE the delivery_app fallback so pickups are
  // never offered to a rider (they are served by the restaurant).
  if (NON_DELIVERY_TYPES.includes(type)) return false;
  return DELIVERY_TYPES.includes(type) || source === "delivery_app";
}

/**
 * Offer a ready order to the next-nearest candidate. If none remain, park the
 * order as `unassigned` (the sweeper retries it) and alert the restaurant.
 * Returns the rider id offered to, or null when nobody was available.
 */
/**
 * True when the order is already parked with a clean offer round, so parking
 * it again would change nothing. Rewriting it anyway re-fired every order
 * trigger (~9 functions) once a minute per parked order via the sweeper, which
 * kept enough instances warm to exhaust the Cloud Run CPU quota and block
 * checkout from starting.
 */
export function alreadyParked(order: FirebaseFirestore.DocumentData): boolean {
  const attempted = order.offer?.attemptedRiderIds;
  return (
    order.deliveryStatus === "unassigned" &&
    !(order.offer?.riderId ?? "") &&
    (!Array.isArray(attempted) || attempted.length === 0)
  );
}

async function offerToNextRider(
  orderRef: FirebaseFirestore.DocumentReference,
  order: FirebaseFirestore.DocumentData
): Promise<string | null> {
  const econ = await platformEconomics();
  
  // If admin has disabled auto-dispatch, immediately park as unassigned
  if (!econ.autoDispatchEnabled) {
    if (alreadyParked(order)) return null;
    await orderRef.set(
      {
        deliveryStatus: "unassigned",
        offer: { riderId: "", expiresAt: null, attemptedRiderIds: [] },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logger.info(`Auto-dispatch is paused. Parked order ${orderRef.id} as unassigned.`);
    return null;
  }

  const attempted: string[] = Array.isArray(order.offer?.attemptedRiderIds)
    ? order.offer.attemptedRiderIds
    : [];
  const pickup = await pickupCoord(order);
  const candidates = await findCandidateRiders(pickup, attempted, (order.restaurantId ?? "").toString());

  if (candidates.length === 0) {
    // Nothing to change: don't touch the order (see alreadyParked).
    if (alreadyParked(order)) return null;
    // Round exhausted. RESET the attempted list so the next sweeper tick starts
    // a fresh offer round — otherwise, with a small fleet, one declined/expired
    // offer would exclude every rider forever and permanently orphan the order
    // (Swiggy-style re-pinging is the correct behaviour).
    await orderRef.set(
      {
        deliveryStatus: "unassigned",
        offer: { riderId: "", expiresAt: null, attemptedRiderIds: [] },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logger.info(
      `No riders available for order ${orderRef.id}; parked as unassigned` +
        (attempted.length ? ` (round reset after ${attempted.length} attempted)` : "."),
    );
    return null;
  }

  const next = candidates[0];
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OFFER_TTL_SECONDS * 1000);

  // Offer economics (Swiggy-style): show the rider their PAYOUT + distances up
  // front, not the order value. Trip = restaurant→customer; earning is based on
  // it; pickup distance = rider→restaurant.
  const drop = dropCoord(order);
  const tripKm = pickup && drop ? haversineKm(pickup.lat, pickup.lng, drop.lat, drop.lng) : 0;
  const pickupKm = Number.isFinite(next.distanceKm) ? next.distanceKm : 0;
  const tip = Number(order.tip ?? 0) || 0;
  const estimatedEarning = econ.riderBaseFee + Math.round(tripKm * econ.riderPerKm) + tip;

  await orderRef.set(
    {
      deliveryStatus: "offered",
      // Stamp the pickup coords so the rider offer/map has them without a
      // separate restaurant read.
      ...(pickup ? { restaurantLocation: pickup } : {}),
      estimatedEarning,
      tripDistanceKm: Number(tripKm.toFixed(2)),
      offer: {
        riderId: next.id,
        expiresAt,
        attemptedRiderIds: [...attempted, next.id],
        distanceKm: Number(pickupKm.toFixed(2)),
        earning: estimatedEarning,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const restaurantName = (order.restaurantName ?? "a restaurant").toString();
  await notifyRider(
    next.id,
    "New delivery request",
    `Earn ₹${estimatedEarning} • ${restaurantName}${tripKm > 0 ? ` • ${tripKm.toFixed(1)} km trip` : ""}`,
    { orderId: orderRef.id, kind: "offer" }
  );
  logger.info(`Offered order ${orderRef.id} to rider ${next.id} (₹${estimatedEarning}, ${tripKm.toFixed(1)}km)`);
  return next.id;
}

// ── Trigger: order PLACED by a customer → assign nearest rider immediately ────
// Swiggy/Zomato model: the rider is dispatched as soon as the order is placed
// (nearest to the restaurant) so they ride to the restaurant while the food is
// being prepared, rather than waiting for the vendor to mark it ready.
export const onOrderPlacedAssignRider = onDocumentCreated({ document: "orders/{orderId}", maxInstances: 3 }, async (event) => {
  const order = event.data?.data();
  if (!order) return;
  // An online order isn't real until it's paid. The app creates it before the
  // payment runs, so a failed or abandoned payment used to dispatch a rider to
  // food nobody bought. onOrderPaymentConfirmed starts delivery once it lands.
  if (isOrderHeld(order)) {
    logger.info(`Order ${event.params.orderId} held: awaiting payment or its pricing check before dispatch.`);
    return;
  }
  await beginDeliveryForOrder(event.data!.ref, event.params.orderId, order);
});

/**
 * Starts the delivery leg of a placed (and, for online orders, paid) order:
 * handoff OTP, ETA, timeline event, then dispatch unless the shop-release gate
 * holds it. Safe to call again: it no-ops once a rider is involved, and never
 * replaces an OTP the customer may already have seen.
 */
export async function beginDeliveryForOrder(
  ref: FirebaseFirestore.DocumentReference,
  orderId: string,
  order: FirebaseFirestore.DocumentData,
): Promise<void> {
  if (!isDeliveryOrder(order)) return;

  const status = (order.status ?? "").toString().toLowerCase();
  if (["cancelled", "completed", "delivered"].includes(status)) return;

  const ds = (order.deliveryStatus ?? "").toString();
  if (["offered", "assigned", "at_restaurant", "picked_up", "on_the_way", "arrived", "delivered"].includes(ds)) {
    return;
  }

  // A scheduled order is dispatched near its slot, not at placement.
  if (scheduledDispatchHold(order)) {
    logger.info(`Order ${orderId} held: scheduled for later (dispatchDueScheduledOrders starts it).`);
    return;
  }

  // Delivery OTP (Swiggy/Zomato-style handoff verification). The plaintext OTP
  // lives in `order_secrets/{orderId}` which the rider CANNOT read (rules) —
  // only the customer sees it and reads it out at the door. We set a public
  // `otpRequired` flag on the order so the rider app knows to prompt for it.
  const customerUid = (order.customerUid ?? "").toString();
  if (customerUid) {
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    try {
      await db().collection("order_secrets").doc(orderId).create({
        otp,
        customerUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      // ALREADY_EXISTS: keep the OTP the customer may already have.
      if ((e as { code?: number }).code !== 6) throw e;
    }
    await ref.set({ otpRequired: true }, { merge: true });
  }

  await stampEta(ref, order).catch((e) => logger.error("stampEta failed", e));

  await logEvent(orderId, `placed_${orderId}`, {
    type: "ORDER_PLACED",
    actorId: customerUid || "system",
    actorRole: "customer",
    to: status || "new",
  });

  // Shop-release gate. When enabled, an order is NOT dispatched at placement —
  // the shop must explicitly release it (releaseOrderForPickup), which fires
  // `onOrderReleasedDispatch` below. When disabled, legacy behaviour is kept
  // exactly as-is so this ships dark.
  if (await requireShopRelease()) {
    logger.info(`Order ${orderId} held: awaiting shop release before dispatch.`);
    return;
  }

  await offerToNextRider(ref, order);
}

/**
 * Starts delivery for scheduled orders whose slot is within the dispatch lead
 * window. Keyed on fulfillmentType rather than status, so an order the
 * restaurant accepted early (now "preparing") is still picked up. Each order is
 * started once: the marker is written before dispatch.
 */
export const dispatchDueScheduledOrders = onSchedule("every 5 minutes", withCronHeartbeat("dispatchDueScheduledOrders", 5, async () => {
  const now = Date.now();
  const snap = await db()
    .collection("orders")
    .where("fulfillmentType", "==", "scheduled")
    .where("scheduledFor", ">=", admin.firestore.Timestamp.fromMillis(now - 6 * 3_600_000))
    .where("scheduledFor", "<=", admin.firestore.Timestamp.fromMillis(now + SCHEDULED_DISPATCH_LEAD_MIN * 60_000))
    .limit(200)
    .get();

  let started = 0;
  for (const doc of snap.docs) {
    const o = doc.data();
    if (o.scheduledDispatchStartedAt) continue;
    if (isOrderHeld(o)) continue;
    const ds = (o.deliveryStatus ?? "").toString();
    if (ds && ds !== "unassigned") continue;
    await doc.ref.set({ scheduledDispatchStartedAt: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await beginDeliveryForOrder(doc.ref, doc.id, o);
      started++;
    } catch (e) {
      logger.error("dispatchDueScheduledOrders: dispatch failed", { orderId: doc.id, error: String(e) });
    }
  }
  if (started > 0) logger.info("dispatchDueScheduledOrders", { started, scanned: snap.size });
}));

// ── Trigger: shop released the order → begin dispatch ────────────────────────
// Only fires on the transition INTO ready_for_pickup, so a re-save of an
// already-released order can never double-dispatch.
export const onOrderReleasedDispatch = onDocumentUpdated({ document: "orders/{orderId}", maxInstances: 3 }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (!isDeliveryOrder(after)) return;

  const was = (before.status ?? "").toString();
  const now = (after.status ?? "").toString();
  if (was === OrderStatus.READY_FOR_PICKUP || now !== OrderStatus.READY_FOR_PICKUP) return;

  const ds = (after.deliveryStatus ?? "").toString();
  if (["offered", "assigned", "at_restaurant", "picked_up", "on_the_way", "arrived", "delivered"].includes(ds)) {
    return; // already has a rider in flight
  }

  const ref = event.data!.after.ref;
  await stampEta(ref, after).catch((e) => logger.error("stampEta failed", e));
  await offerToNextRider(ref, after);
});

// ── Trigger: order CANCELLED → free the assigned/offered rider ────────────────
// Without this, a rider who was assigned (or mid-offer) an order that then gets
// cancelled stays "busy" (currentOrderId set) forever and receives no new offers.
export const onOrderCancelledFreeRider = onDocumentUpdated({ document: "orders/{orderId}", maxInstances: 3 }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  const wasCancelled = ["cancelled", "canceled", "rejected"].includes(
    (before.status ?? "").toString().toLowerCase()
  );
  const isCancelled = ["cancelled", "canceled", "rejected"].includes(
    (after.status ?? "").toString().toLowerCase()
  );
  if (wasCancelled || !isCancelled) return; // only on the transition into cancelled
  if ((after.deliveryStatus ?? "") === "delivered") return; // already completed

  const riderId = (after.riderId ?? after.offer?.riderId ?? "").toString();
  const ref = event.data!.after.ref;

  await ref.set(
    { deliveryStatus: "cancelled", offer: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  if (riderId) {
    // Only release the rider if THIS order is the one they're holding.
    const riderRef = db().collection("delivery_users").doc(riderId);
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(riderRef);
      if (snap.exists && (snap.data()?.currentOrderId ?? "") === event.params.orderId) {
        // Batching resolution: Check if rider has queued orders
        const rider = snap.data()!;
        let nextOrderId = FieldValue.delete();
        if (rider.queuedOrderIds && Array.isArray(rider.queuedOrderIds) && rider.queuedOrderIds.length > 0) {
           const queued = [...rider.queuedOrderIds];
           // Remove the one they just delivered if it was somehow in the queue
           const validQueue = queued.filter(id => id !== event.params.orderId);
           if (validQueue.length > 0) {
             nextOrderId = validQueue[0] as any; // Pop the next order
           }
        }

        const updates: any = { 
          currentOrderId: nextOrderId, 
          updatedAt: FieldValue.serverTimestamp() 
        };
        
        // Remove the promoted order from the queue
        if (nextOrderId !== FieldValue.delete()) {
           updates.queuedOrderIds = FieldValue.arrayRemove(nextOrderId);
           logger.info(`freeRiderOnCancel: Promoted batched order ${nextOrderId} for rider ${riderId}`);
        }

        tx.set(riderRef, updates, { merge: true });
      }
    }).catch((e) => logger.error("free rider on cancel failed", e));
    await notifyRider(riderId, "Order cancelled", "An order you were assigned was cancelled. You're free for new requests.", {
      orderId: event.params.orderId,
      kind: "cancelled",
    });
  }
  logger.info(`Order ${event.params.orderId} cancelled; freed rider ${riderId || "(none)"}.`);
});

// ── Callable: rider accepts an offer ─────────────────────────────────────────
export const acceptDeliveryOffer = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const orderId = (request.data?.orderId ?? "").toString();
  if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

  const riderSnap = await db().collection("delivery_users").doc(uid).get();
  const rider = riderSnap.data();
  if (!rider || rider.status !== "approved") {
    throw new HttpsError("permission-denied", "Rider is not approved.");
  }
  // Re-check the lifecycle state at accept time, not just at dispatch. An
  // offer already in flight when the rider was suspended (expired insurance,
  // revoked banking, manual action) must not still be acceptable — otherwise
  // the suspension only takes effect on the NEXT order.
  const riderObState = rider.onboarding?.state;
  if (riderObState && riderObState !== "active") {
    throw new HttpsError(
      "failed-precondition",
      `Your account is "${riderObState}" and cannot take orders right now.`,
    );
  }

  const orderRef = db().collection("orders").doc(orderId);
  const alreadyMine = await db().runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = snap.data()!;
    // Idempotent: a retry after a lost response (the rider's app never heard
    // the first "ok") must succeed, not tell them the order they now hold is
    // "no longer yours".
    if (
      order.riderId === uid &&
      ["assigned", "at_restaurant", "picked_up", "on_the_way", "arrived"].includes(String(order.deliveryStatus ?? ""))
    ) {
      return true;
    }
    if (order.offer?.riderId !== uid) {
      throw new HttpsError("failed-precondition", "This offer is no longer yours.");
    }
    if ((order.deliveryStatus ?? "") !== "offered") {
      throw new HttpsError("failed-precondition", "Order already taken.");
    }
    const expiresAt: FirebaseFirestore.Timestamp | undefined = order.offer?.expiresAt;
    if (expiresAt && expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("deadline-exceeded", "Offer expired.");
    }

    tx.set(
      orderRef,
      {
        riderId: uid,
        riderName: (rider.name ?? "Rider").toString(),
        riderPhone: (rider.phone ?? "").toString(),
        riderVehicle: [rider.vehicleType, rider.vehicleNumber].filter(Boolean).join(" • "),
        deliveryStatus: "assigned",
        offer: FieldValue.delete(),
        assignedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Timeline: recorded inside the same transaction as the claim, so an
    // assignment can never exist without its event (or vice versa).
    writeEvent(tx, orderId, `assigned_${orderId}`, {
      type: "DELIVERY_ASSIGNED",
      actorId: uid,
      actorRole: "rider",
      from: "offered",
      to: "assigned",
      metadata: { riderName: (rider.name ?? "Rider").toString() },
    });
    const updates: any = { updatedAt: FieldValue.serverTimestamp() };
    const currentOrderId = (rider.currentOrderId ?? "").toString();
    
    // Sequential Batching: if they already have an active order, queue it.
    if (currentOrderId && currentOrderId !== orderId) {
      updates.queuedOrderIds = FieldValue.arrayUnion(orderId);
      logger.info(`acceptDeliveryOffer: Batched order ${orderId} into queue for rider ${uid}`);
    } else {
      updates.currentOrderId = orderId;
    }

    tx.set(
      db().collection("delivery_users").doc(uid),
      updates,
      { merge: true }
    );
    return false;
  });
  // Already accepted earlier: the customer and restaurant were told then.
  if (alreadyMine) return { success: true, idempotent: true };

  const orderSnap = await orderRef.get();
  const order = orderSnap.data()!;
  // Refine the ETA now that we know the rider's real position (first-mile leg).
  await stampEta(orderRef, order, coord(rider.location)).catch((e) => logger.error("stampEta on accept failed", e));
  await notifyCustomer(
    order,
    orderId,
    "Rider assigned 🛵",
    `${(rider.name ?? "Your rider").toString()} is heading to the restaurant.`
  );
  const restaurantId = (order.restaurantId ?? "").toString();
  if (restaurantId) {
    await db()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("notifications")
      .add({
        title: "Rider assigned",
        message: `${(rider.name ?? "Rider").toString()} will pick up order ${(order.orderNumber ?? "").toString()}`,
        source: "delivery",
        severity: "info",
        read: false,
        metadata: { orderId, riderName: rider.name ?? "" },
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  }
  return { success: true };
});

// ── Callable: rider declines an offer → re-offer to next ─────────────────────
export const declineDeliveryOffer = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const orderId = (request.data?.orderId ?? "").toString();
  if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");

  const orderRef = db().collection("orders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data()!;
  if (order.offer?.riderId !== uid) {
    // Already moved on — nothing to do.
    return { success: true, reassigned: false };
  }
  const riderId = await offerToNextRider(orderRef, order);
  return { success: true, reassigned: !!riderId };
});

export const reassignExpiredOffers = onSchedule("every 1 minutes", withCronHeartbeat("reassignExpiredOffers", 1, async () => {
  const econ = await platformEconomics();
  const autoDispatch = econ.autoDispatchEnabled;

  const now = Date.now();

  // 1) Offers that timed out without an accept.
  const offered = await db().collection("orders").where("deliveryStatus", "==", "offered").get();
  for (const doc of offered.docs) {
    const order = doc.data();
    const expiresAt: FirebaseFirestore.Timestamp | undefined = order.offer?.expiresAt;
    if (expiresAt && expiresAt.toMillis() < now) {
      if (autoDispatch) {
        await offerToNextRider(doc.ref, order).catch((e) => logger.error("re-offer failed", e));
      } else {
        await doc.ref.set({ deliveryStatus: "unassigned", offer: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  }

  if (!autoDispatch) {
    logger.info("Auto-dispatch is disabled. Not sweeping parked orders.");
    return;
  }

  // 2) Orders parked as unassigned (no rider was online at placement) — retry
  //    any that are still live (not cancelled/completed/delivered).
  const parked = await db().collection("orders").where("deliveryStatus", "==", "unassigned").get();
  for (const doc of parked.docs) {
    const order = doc.data();
    const status = (order.status ?? "").toString().toLowerCase();
    if (["cancelled", "completed", "delivered"].includes(status)) continue;
    await offerToNextRider(doc.ref, order).catch((e) => logger.error("retry parked failed", e));
  }
}));

// ── Scheduled sweeper: Reset Daily & Weekly Earnings ────────────────────────
export const resetDailyEarnings = onSchedule("30 18 * * *", async () => {
  // Runs at 18:30 UTC = Midnight IST
  // Anyone with ANY of the day's counters set — a rider who delivered but
  // earned ₹0 (or only tips) was skipped before, so their counters carried
  // into the next day. Writes are also date-stamped now (riderEarnings.ts),
  // so this is a tidy-up rather than the only line of defence.
  const col = db().collection("delivery_users");
  const snaps = await Promise.all([
    col.where("earnings.today", ">", 0).get(),
    col.where("deliveriesToday", ">", 0).get(),
    col.where("tipsToday", ">", 0).get(),
    col.where("expensesToday", ">", 0).get(),
  ]);
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const s of snaps) for (const d of s.docs) refs.set(d.id, d.ref);
  const all = [...refs.values()];
  const chunks = [];
  for (let i = 0; i < all.length; i += 500) {
    const batch = db().batch();
    all.slice(i, i + 500).forEach((ref) =>
      batch.update(ref, { "earnings.today": 0, expensesToday: 0, deliveriesToday: 0, tipsToday: 0 }),
    );
    chunks.push(batch.commit());
  }
  await Promise.all(chunks);
  logger.info(`Reset daily earnings for ${all.length} riders`);
});

export const resetWeeklyEarnings = onSchedule("30 18 * * 0", async () => {
  // Runs at 18:30 UTC on Sundays = Midnight Monday IST
  const snap = await db().collection("delivery_users").where("earnings.week", ">", 0).get();
  const chunks = [];
  for (let i = 0; i < snap.docs.length; i += 500) {
    const batch = db().batch();
    snap.docs.slice(i, i + 500).forEach(doc => batch.update(doc.ref, { "earnings.week": 0 }));
    chunks.push(batch.commit());
  }
  await Promise.all(chunks);
  logger.info(`Reset weekly earnings for ${snap.size} riders`);
});

export const resetMonthlyEarnings = onSchedule(
  { schedule: "0 0 1 * *", timeZone: "Asia/Kolkata" },
  async () => {
    // Runs at midnight IST on the 1st of each month.
    const snap = await db().collection("delivery_users").where("earnings.month", ">", 0).get();
    const chunks = [];
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = db().batch();
      snap.docs.slice(i, i + 500).forEach(doc => batch.update(doc.ref, { "earnings.month": 0 }));
      chunks.push(batch.commit());
    }
    await Promise.all(chunks);
    logger.info(`Reset monthly earnings for ${snap.size} riders`);
  },
);

// ── Callable: rider completes the delivery → earnings + COD ───────────────────
export const completeDelivery = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const orderId = (request.data?.orderId ?? "").toString();
  if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");
  const codCollected = request.data?.codCollected === true;
  const otp = (request.data?.otp ?? "").toString().trim();
  const photoUrl = (request.data?.photoUrl ?? "").toString().trim();

  const orderRef = db().collection("orders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data()!;
  if ((order.riderId ?? "") !== uid) {
    throw new HttpsError("permission-denied", "You are not assigned to this order.");
  }
  if ((order.deliveryStatus ?? "") === "delivered") {
    return { success: true, alreadyDelivered: true };
  }

  // Verify the handoff OTP the customer reads out (anti-fraud). The rider never
  // sees this value — they must obtain it from the customer at the door.
  let otpVerification: "verified" | "unavailable" = "verified";
  if (order.otpRequired === true) {
    const secretSnap = await db().collection("order_secrets").doc(orderId).get();
    const expected = (secretSnap.data()?.otp ?? "").toString();
    if (expected) {
      if (otp !== expected) {
        throw new HttpsError("permission-denied", "Incorrect delivery OTP. Please ask the customer to read it out again.");
      }
    } else {
      // The order says an OTP is required but no secret exists — it was never
      // written, or something removed it (an ops cleanup, a bulk delete). The
      // rider cannot reach this state themselves; the rules keep order_secrets
      // out of their hands.
      //
      // Completing anyway is the lesser evil: refusing strands a rider at a
      // customer's door over our own missing document. But it must never be
      // SILENT, which is what the old `expected && ...` check made it — the
      // anti-fraud gate simply evaporated with nothing to show for it. Record
      // it on the order so a human can review the handoff.
      otpVerification = "unavailable";
      logger.error(
        `completeDelivery: order ${orderId} has otpRequired but no stored OTP — completing WITHOUT handoff verification`,
        { orderId, riderId: uid },
      );
    }
  }

  // Earnings = base + distance pay + customer tip.
  const pickup = await pickupCoord(order);
  const drop = dropCoord(order);
  const distanceKm = pickup && drop ? haversineKm(pickup.lat, pickup.lng, drop.lat, drop.lng) : 0;
  const econ = await platformEconomics();
  const pay = riderPayFor(await withFinance(orderRef, order), distanceKm, econ);
  const { tip, distancePay, total: riderEarning } = pay;

  const isCod =
    (order.paymentMethod ?? "").toString().toLowerCase() === "cod" ||
    (Array.isArray(order.paymentOptions) && order.paymentOptions.includes("cod"));
  const codAmount = isCod && codCollected ? Number(order.total ?? 0) || 0 : 0;

  const now = new Date();

  // ── Daily Quest bonus ──────────────────────────────────────────────────────
  // A ladder of milestones (settings/delivery.questTiers, managed in Platform
  // Settings); each rung is paid once per day the moment it is reached —
  // exactly what the rider app shows. Only the top rung used to be paid.
  const [riderSnapQ, questSnap] = await Promise.all([
    db().collection("delivery_users").doc(uid).get(),
    db().collection("settings").doc("delivery").get(),
  ]);
  const riderDataQ = riderSnapQ.data() ?? {};
  const questCfg = questSnap.data() ?? {};
  const questLadder = parseQuestTiers(questCfg);
  // Date-aware: a counter left over from an earlier day must not count toward
  // today's quest (it never reset, so riders were paid a "daily" bonus for
  // trips spread across days).
  const newDeliveriesToday = deliveriesSoFarToday(riderDataQ, now) + 1;
  const istTodayStr = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const alreadyPaidTiers = awardedTodayFrom(riderDataQ, istTodayStr, questLadder);
  const newTiers = tiersToAward(questLadder, newDeliveriesToday, alreadyPaidTiers);
  const awardQuest = newTiers.length > 0;
  const bonus = newTiers.reduce((sum, t) => sum + t.bonus, 0);
  // Batching resolution: Check if rider has queued orders
  let nextOrderId: any = FieldValue.delete();
  let nextQueuedUpdate: any = null;
  if (riderDataQ.queuedOrderIds && Array.isArray(riderDataQ.queuedOrderIds) && riderDataQ.queuedOrderIds.length > 0) {
    const validQueue = riderDataQ.queuedOrderIds.filter((id: any) => id !== orderId);
    if (validQueue.length > 0) {
      nextOrderId = validQueue[0];
      nextQueuedUpdate = FieldValue.arrayRemove(nextOrderId);
      logger.info(`completeDelivery: Promoted batched order ${nextOrderId} for rider ${uid}`);
    }
  }

  const batch = db().batch();

  batch.set(
    orderRef,
    {
      deliveryStatus: "delivered",
      status: "completed",
      deliveredAt: FieldValue.serverTimestamp(),
      riderEarning,
      codCollected: isCod ? codCollected : false,
      ...(photoUrl ? { deliveryPhotoUrl: photoUrl } : {}),
      // "unavailable" means the handoff completed without OTP verification
      // because the stored secret was missing. Left on the order deliberately
      // so a disputed delivery can be told apart from a verified one.
      ...(order.otpRequired === true ? { otpVerification } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    db().collection("rider_earnings").doc(uid).collection("entries").doc(orderId),
    {
      orderId,
      orderNumber: (order.orderNumber ?? "").toString(),
      restaurantName: (order.restaurantName ?? "").toString(),
      base: pay.base,
      distancePay,
      surgeShare: pay.surgeShare,
      incentive: pay.incentive,
      distanceKm: Number(distanceKm.toFixed(2)),
      tip,
      total: riderEarning,
      pricingSource: pay.source,
      codCollected: codAmount,
      paymentMethod: (order.paymentMethod ?? "").toString(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    db().collection("delivery_users").doc(uid),
    {
      currentOrderId: nextOrderId,
      ...(nextQueuedUpdate ? { queuedOrderIds: nextQueuedUpdate } : {}),
      isOnline: true,
      lifetimeDeliveries: FieldValue.increment(1),
      // Nested + date-stamped (see riderEarnings.ts). The old dotted keys in
      // set() created stray top-level fields the app never read.
      ...earningsFields(riderDataQ, riderEarning + bonus, now, { tip }),
      cashInHand: FieldValue.increment(codAmount),
      ...(awardQuest
        ? {
            questTiersAwardedDate: istTodayStr,
            questTiersAwarded: [...alreadyPaidTiers, ...newTiers.map((t) => t.trips)],
            // Kept for older app builds that read it as "quest done today".
            ...(newTiers.some((t) => t.trips === questLadder[questLadder.length - 1].trips)
              ? { questAwardedDate: istTodayStr }
              : {}),
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Ledger entry per rung (deterministic id = once per rung per day).
  for (const t of newTiers) {
    const entryId = `quest_${istTodayStr}_${t.trips}`;
    batch.set(
      db().collection("rider_earnings").doc(uid).collection("entries").doc(entryId),
      {
        orderId: entryId,
        restaurantName: `Daily Quest Bonus (${t.trips} trips)`,
        base: t.bonus,
        distancePay: 0,
        distanceKm: 0,
        tip: 0,
        total: t.bonus,
        codCollected: 0,
        type: "quest_bonus",
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();

  // Timeline: idempotent by deterministic key, so a retried completion (double
  // tap, network retry) records exactly one DELIVERY_CONFIRMED event.
  await logEvent(orderId, `delivered_${orderId}`, {
    type: "DELIVERY_CONFIRMED",
    actorId: uid,
    actorRole: "rider",
    from: (order.deliveryStatus ?? "").toString(),
    to: "delivered",
    metadata: { riderEarning, codCollected: isCod ? codCollected : false },
  });

  // In-app earnings record for the rider's feed.
  await notifyRider(
    uid,
    `You earned ₹${riderEarning}`,
    `Delivery of order ${(order.orderNumber ?? orderId).toString()} completed${tip > 0 ? ` — includes ₹${tip} tip 💚` : ""}.`,
    { orderId, type: "earning" }
  ).catch(() => {});

  if (awardQuest) {
    const top = questLadder[questLadder.length - 1];
    const allDone = newDeliveriesToday >= top.trips;
    await notifyRider(
      uid,
      allDone ? "🎉 Daily Quest complete!" : "🎯 Quest milestone reached!",
      `You hit ${newTiers[newTiers.length - 1].trips} trips today — ₹${bonus} bonus added to your earnings.`,
      { type: "earning" }
    ).catch(() => {});
  }

  // The handoff OTP has served its purpose — remove it.
  await db().collection("order_secrets").doc(orderId).delete().catch(() => {});

  await notifyCustomer(order, orderId, "Delivered ✅", "Your order has been delivered. Enjoy your meal!");
  return { success: true, riderEarning, codAmount, questBonus: bonus };
});

// ── Callable: rider requests a payout of their available online earnings ──────
// Available = earnings.lifetime − paidOut. Creates a `payout_requests` doc the
// admin settles via `settleRiderPayout`. COD cash-in-hand is a separate ledger
// (settleRiderCash), so it is intentionally NOT netted here.
const MIN_PAYOUT = 100;

export const requestRiderPayout = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const upiId = (request.data?.upiId ?? "").toString().trim();
  if (!upiId || !upiId.includes("@")) {
    throw new HttpsError("invalid-argument", "Enter a valid UPI ID (name@bank).");
  }

  const riderRef = db().collection("delivery_users").doc(uid);
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(riderRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Rider profile not found.");
    }
    const data = snap.data() ?? {};
    if (data.payoutPending === true) {
      throw new HttpsError(
        "failed-precondition",
        "You already have a payout request pending."
      );
    }

    // Onboarding + banking gates. Previously this callable checked only that
    // the UPI string looked well-formed, so a suspended rider — or one whose
    // bank account had never been verified — could still queue money out, to
    // any UPI id they typed at request time. Both gates are engine-owned and
    // cannot be self-granted.
    const obState = data.onboarding?.state;
    if (obState && obState !== "active") {
      throw new HttpsError(
        "failed-precondition",
        `Your account is "${obState}". Payouts resume once it is active again.`
      );
    }
    const bankState = data.bank?.verificationState;
    if (bankState !== "verified") {
      throw new HttpsError(
        "failed-precondition",
        bankState
          ? `Your bank account is "${bankState}". It must be verified before you can withdraw.`
          : "Add and verify your bank account before requesting a payout."
      );
    }
    // Until fixRiderEarnings has run, older earnings sit in a stray top-level
    // "earnings.lifetime" field (riderEarnings.ts). Nested + stray is exact
    // both before the repair and after it (the repair folds one into the other).
    const lifetime =
      (Number(data.earnings?.lifetime ?? 0) || 0) + (Number(data["earnings.lifetime"] ?? 0) || 0);
    const paidOut = Number(data.paidOut ?? 0) || 0;
    const available = Math.floor(lifetime - paidOut);
    if (available < MIN_PAYOUT) {
      throw new HttpsError(
        "failed-precondition",
        `You need at least ₹${MIN_PAYOUT} to request a payout. Available: ₹${available}.`
      );
    }

    const reqRef = db().collection("payout_requests").doc();
    tx.set(reqRef, {
      riderUid: uid,
      riderName: (data.name ?? "Rider").toString(),
      amount: available,
      upiId,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(
      riderRef,
      {
        payoutPending: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { amount: available, requestId: reqRef.id };
  });

  logger.info(`Rider ${uid} requested payout of ₹${result.amount}`);
  await notifyRider(
    uid,
    "Payout requested",
    `Your ₹${result.amount} payout to ${upiId} is being processed — Kada ops settles requests within 24 hours.`,
    { type: "earning", requestId: result.requestId }
  ).catch(() => {});
  return { success: true, ...result };
});

// ── Callable: dynamic delivery fee for a customer order ──────────────────────
// Checkout blocks on this call, so it gets a real CPU + high concurrency:
// the fleet default (cpu 0.5 / concurrency 1) means one instance per in-flight
// request and a cold start on most checkouts. cpu:1 is required for
// concurrency > 1 in Cloud Run.
export const calculateDeliveryFee = onCall({ ...HOT_PATH }, async (request) => {
  const restaurantId = (request.data?.restaurantId ?? "").toString();
  const deliveryLat = Number(request.data?.deliveryLat);
  const deliveryLng = Number(request.data?.deliveryLng);
  const orderSubtotal = Number(request.data?.orderSubtotal ?? 0);

  if (!restaurantId) {
    throw new HttpsError("invalid-argument", "restaurantId is required.");
  }
  if (!Number.isFinite(deliveryLat) || !Number.isFinite(deliveryLng)) {
    throw new HttpsError("invalid-argument", "Valid deliveryLat and deliveryLng are required.");
  }

  // All four reads are independent — fetch them in ONE parallel round-trip
  // instead of four sequential awaits (restaurant → config → user → settings),
  // which was the bulk of the non-cold-start latency at checkout.
  const [restaurantSnap, econGlobal, userSnapPre, configSnapPre, zoneMatch] = await Promise.all([
    db().collection("restaurants").doc(restaurantId).get(),
    platformEconomics(),
    request.auth?.uid
      ? db().collection("customer_users").doc(request.auth.uid).get().catch(() => null)
      : Promise.resolve(null),
    db().collection("settings").doc("delivery").get().catch(() => null),
    // The DROP point decides the zone: the customer pays their own area's
    // rate, not the restaurant's. A vendor near a zone seam would otherwise
    // quote a different fee to two neighbours on the same street.
    resolveZoneForPoint({ lat: deliveryLat, lng: deliveryLng }).catch(() => null),
  ]);

  // Zone economics override the global defaults where a zone is configured.
  // Without a zone (a city not yet mapped) the platform-wide numbers still
  // apply, so this is additive and nothing breaks before zones are drawn.
  const zone = zoneMatch?.zone ?? null;
  const econPre = zone
    ? {
        ...econGlobal,
        deliveryBaseFee: zone.economics.deliveryBaseFee,
        deliveryPerKm: zone.economics.deliveryPerKm,
        freeDeliveryUnderKm: zone.economics.freeDeliveryUnderKm,
        freeDeliveryAbove: zone.economics.freeDeliveryAbove,
        minOrderValue: zone.economics.minOrderValue,
        platformFee: zone.economics.platformFee,
        serviceRadiusKm: zone.economics.maxDeliveryRadiusKm,
        codEnabled: econGlobal.codEnabled && zone.codEnabled,
      }
    : econGlobal;
  if (!restaurantSnap.exists) {
    throw new HttpsError("not-found", "Restaurant not found.");
  }

  const rData = restaurantSnap.data()!;
  const restaurantCoord = coord(rData.location) ?? coord(rData.coordinates);
  if (!restaurantCoord) {
    throw new HttpsError(
      "failed-precondition",
      "Restaurant does not have valid coordinates configured."
    );
  }

  // Calculate Haversine distance.
  const distanceKm = haversineKm(
    restaurantCoord.lat,
    restaurantCoord.lng,
    deliveryLat,
    deliveryLng
  );
  const roundedDistance = Number(distanceKm.toFixed(2));

  // Admin-tunable fee: free under N km or above a configured basket value,
  // then base + per-km (from Platform Settings -> config/platform).
  const econ = econPre;
  if (econ.maintenanceMode) {
    throw new HttpsError("failed-precondition", "Ordering is paused for maintenance.");
  }

  const serviceRadiusKm = Math.min(25, Math.max(1, econ.serviceRadiusKm || 15));
  let baseDeliveryFee: number;
  let breakdown: string;

  if (distanceKm > serviceRadiusKm) {
    throw new HttpsError(
      "out-of-range",
      zone
        ? `${zone.name} delivers up to ${serviceRadiusKm} km. This address is ${roundedDistance} km away.`
        : `Delivery is not available beyond ${serviceRadiusKm} km. Distance: ${roundedDistance} km.`
    );
  }

  // Check if caller is a Kada Gold VIP member (free delivery above ₹149)
  let isGoldVip = false;
  if (request.auth?.uid) {
    try {
      const userSnap = userSnapPre;
      if (userSnap && userSnap.exists) {
        const uData = userSnap.data() || {};
        const isGold = uData.isGold === true;
        const goldUntilMs = uData.goldUntil instanceof admin.firestore.Timestamp
          ? uData.goldUntil.toMillis()
          : Number(uData.goldUntil) || 0;
        if (isGold && goldUntilMs > Date.now()) {
          isGoldVip = true;
        }
      }
    } catch (err) {
      logger.warn("calculateDeliveryFee: failed to verify Kada Gold status", err);
    }
  }

  // Shared with the payment-time pricing check (orderPricing.ts), so the fee a
  // customer is quoted and the floor they are held to can't drift apart.
  ({ fee: baseDeliveryFee, breakdown } = baseDeliveryFeeFor({
    distanceKm,
    econ,
    isGoldVip,
    orderSubtotal,
  }));

  // Calculate real-time Peak Hour / Surge Pricing
  let surgeFee = 0;
  let surgeReason = "";

  // Check admin config override in Firestore (/settings/delivery)
  try {
    const configSnap = configSnapPre;
    if (configSnap && configSnap.exists) {
      const cData = configSnap.data() || {};
      if (cData.surgeActive === true && typeof cData.surgeFee === "number") {
        surgeFee = cData.surgeFee;
        surgeReason = cData.surgeReason || "High Demand Zone";
      }
    }
  } catch (err) {
    logger.warn("calculateDeliveryFee: failed to read /settings/delivery config", err);
  }

  // If no manual override, apply peak-hour surge automatically (IST = UTC + 5:30)
  if (surgeFee === 0) {
    const nowUtc = new Date();
    const istHour = (nowUtc.getUTCHours() + 5 + Math.floor((nowUtc.getUTCMinutes() + 30) / 60)) % 24;
    if (istHour >= 12 && istHour < 15) {
      surgeFee = 15;
      surgeReason = "Peak Lunch Rush";
    } else if (istHour >= 19 && istHour <= 22) {
      surgeFee = 20;
      surgeReason = "Peak Dinner Hours";
    } else if (istHour >= 23 || istHour < 5) {
      surgeFee = 25;
      surgeReason = "Late Night Delivery";
    }
  }

  // A zone may carry its own multiplier (a hard-to-serve island, a new area
  // being seeded). It scales the surge component only — never the base fare,
  // so a multiplier can't quietly double what every customer pays.
  if (zone && zone.surgeMultiplier > 1 && surgeFee > 0) {
    surgeFee = Math.round(surgeFee * zone.surgeMultiplier);
    surgeReason = surgeReason ? `${surgeReason} · ${zone.name}` : zone.name;
  }

  const totalDeliveryFee = baseDeliveryFee + surgeFee;
  if (surgeFee > 0) {
    breakdown += ` + ₹${surgeFee} Surge (${surgeReason})`;
  }

  return {
    distanceKm: roundedDistance,
    baseFee: baseDeliveryFee,
    surgeFee,
    surgeActive: surgeFee > 0,
    surgeReason,
    deliveryFee: totalDeliveryFee,
    platformFee: econ.platformFee,
    minimumOrderValue: econ.minOrderValue,
    codEnabled: econ.codEnabled,
    maintenanceMode: econ.maintenanceMode,
    serviceRadiusKm,
    breakdown,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
    // Pricing inputs echoed back so the client can cache them and render an
    // INSTANT local estimate on the next checkout instead of blocking on this
    // call. The server stays authoritative — the client reconciles on response.
    pricing: {
      restaurantLat: restaurantCoord.lat,
      restaurantLng: restaurantCoord.lng,
      freeDeliveryUnderKm: econ.freeDeliveryUnderKm,
      freeDeliveryAbove: econ.freeDeliveryAbove,
      deliveryBaseFee: econ.deliveryBaseFee,
      deliveryPerKm: econ.deliveryPerKm,
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// §19 / PHASE 17 — Controlled reassignment.
// ASSIGNED → REASSIGNMENT_REQUIRED → UNASSIGNED → (re-offered) → new rider.
// Ownership is NEVER silently overwritten: the previous rider is recorded on
// the order and in the timeline, so admin can see "Driver A → Driver B" + why.
// ─────────────────────────────────────────────────────────────────────────────
export const reassignDelivery = onCall({ maxInstances: 3 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const orderId = (request.data?.orderId ?? "").toString();
  const reason = (request.data?.reason ?? "").toString().slice(0, 300);
  if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");
  const isAdminCaller = request.auth?.token?.platformAdmin === true;

  const orderRef = db().collection("orders").doc(orderId);

  const result = await db().runTransaction(async (tx) => {
    // ALL reads must happen before ANY write inside a Firestore transaction.
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = snap.data()!;
    const prevRider = (order.riderId ?? "").toString();
    const ds = (order.deliveryStatus ?? "").toString();
    const prevRiderSnap = prevRider
      ? await tx.get(db().collection("delivery_users").doc(prevRider))
      : null;

    if (!prevRider) {
      throw new HttpsError("failed-precondition", "This order has no assigned rider.");
    }
    if (!isAdminCaller && prevRider !== uid) {
      throw new HttpsError("permission-denied", "This delivery is not assigned to you.");
    }
    if (ds === "delivered") {
      throw new HttpsError("failed-precondition", "This delivery is already completed.");
    }
    // A rider holding the food cannot silently abandon it — that needs ops.
    // An admin can still force a reassignment (e.g. rider accident/breakdown).
    if (POST_PICKUP.includes(ds) && !isAdminCaller) {
      throw new HttpsError(
        "failed-precondition",
        "You've already picked this order up — contact support to hand it over.",
      );
    }

    tx.set(
      orderRef,
      {
        deliveryStatus: "unassigned",
        riderId: FieldValue.delete(),
        riderName: FieldValue.delete(),
        riderPhone: FieldValue.delete(),
        riderVehicle: FieldValue.delete(),
        offer: FieldValue.delete(),
        previousRiderIds: FieldValue.arrayUnion(prevRider),
        reassignCount: FieldValue.increment(1),
        reassignedAt: FieldValue.serverTimestamp(),
        lastReassignReason: reason || null,
        deliveryFlag: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Free the previous rider so they receive new offers immediately.
    const riderPatch: Record<string, unknown> = {
      queuedOrderIds: FieldValue.arrayRemove(orderId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Only clear currentOrderId if it actually points at THIS order — a rider
    // batching two deliveries must keep the other one.
    if (prevRiderSnap?.data()?.currentOrderId === orderId) {
      riderPatch.currentOrderId = FieldValue.delete();
    }
    tx.set(db().collection("delivery_users").doc(prevRider), riderPatch, { merge: true });

    // Idempotent per (order, previous rider): a double-tap writes one event,
    // but a genuine A→B→C chain still records each handoff.
    writeEvent(tx, orderId, `reassign_${orderId}_${prevRider}`, {
      type: "REASSIGNMENT_REQUIRED",
      actorId: uid,
      actorRole: isAdminCaller ? "admin" : "rider",
      from: ds,
      to: "unassigned",
      metadata: { previousRiderId: prevRider, reason: reason || null },
    });

    return { previousRiderId: prevRider, fromStage: ds };
  });

  // Re-dispatch outside the transaction.
  const fresh = await orderRef.get();
  if (fresh.exists) {
    await offerToNextRider(orderRef, fresh.data()!).catch((e) =>
      logger.error("reassignDelivery: re-offer failed", e),
    );
  }
  logger.info(`Order ${orderId} reassigned away from ${result.previousRiderId} by ${uid}`);
  return { ok: true, ...result };
});


// ── Callable: ops assigns a NAMED rider to an order ──────────────────────────
// Dispatch (admin → Live Operations) needs to hand a specific rider a specific
// order: a regular who knows the building, or a rescue after a breakdown.
//
// This used to be three blind `updateDoc` calls from the browser, which skipped
// every invariant the rider's own accept path enforces. It could assign a
// SUSPENDED rider, clobber an order a rider had just legitimately accepted
// (last write wins), leave the stale `offer` on the order for the re-offer
// cron to act on, overwrite the `currentOrderId` of a rider already carrying
// another delivery, write no timeline event, and never tell the customer that
// anyone was coming. Same bookkeeping as acceptDeliveryOffer, admin-driven.
export const adminAssignRider = onCall({ ...HOT_PATH }, async (request) => {
  assertAdmin(request);
  const actorId = request.auth?.uid ?? "admin";
  const actorEmail = (request.auth?.token?.email as string | undefined) ?? "";
  const orderId = (request.data?.orderId ?? "").toString();
  const riderId = (request.data?.riderId ?? "").toString();
  const reason = (request.data?.reason ?? "").toString().slice(0, 300);
  if (!orderId || !riderId) {
    throw new HttpsError("invalid-argument", "orderId and riderId are required.");
  }

  const orderRef = db().collection("orders").doc(orderId);
  const riderRef = db().collection("delivery_users").doc(riderId);

  const outcome = await db().runTransaction(async (tx) => {
    // All reads first — Firestore forbids a read after a write in a txn.
    const [orderSnap, riderSnap] = await Promise.all([tx.get(orderRef), tx.get(riderRef)]);
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
    if (!riderSnap.exists) throw new HttpsError("not-found", "Rider not found.");
    const order = orderSnap.data()!;
    const rider = riderSnap.data()!;
    const prevRiderId = (order.riderId ?? "").toString();
    const prevRiderSnap =
      prevRiderId && prevRiderId !== riderId
        ? await tx.get(db().collection("delivery_users").doc(prevRiderId))
        : null;

    // 1. The rider must actually be allowed to carry orders. Dispatch could
    //    previously hand a delivery to a rider the platform had suspended.
    if ((rider.status ?? "") !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        `${rider.name ?? "This rider"} is not approved (status: ${rider.status ?? "unknown"}).`,
      );
    }
    const riderState = rider.onboarding?.state;
    if (riderState && riderState !== "active") {
      throw new HttpsError(
        "failed-precondition",
        `${rider.name ?? "This rider"}'s account is "${riderState}" and cannot take orders.`,
      );
    }

    // 2. A finished or cancelled order is not assignable.
    const status = (order.status ?? "").toString();
    if (isTerminalOrder(status)) {
      throw new HttpsError("failed-precondition", `This order is already ${status}.`);
    }

    const stage = (order.deliveryStatus ?? DeliveryState.UNASSIGNED).toString();

    // 3. Idempotent: re-sending the same assignment succeeds quietly, so a
    //    double-click or a lost response does not look like a failure.
    if (prevRiderId === riderId && stage !== DeliveryState.UNASSIGNED && stage !== DeliveryState.OFFERED) {
      return { changed: false, riderName: (rider.name ?? "Rider").toString(), previousRiderId: "" };
    }

    // 4. Someone else is physically holding the food. Taking the order off
    //    them silently loses track of a real bag of food — ops must reassign
    //    (which frees the rider and re-offers) before handing it to someone new.
    if (prevRiderId && prevRiderId !== riderId && POST_PICKUP.includes(stage)) {
      throw new HttpsError(
        "failed-precondition",
        `${order.riderName ?? "The current rider"} has already picked this order up. Reassign it first.`,
      );
    }

    tx.set(
      orderRef,
      {
        riderId,
        riderName: (rider.name ?? "Rider").toString(),
        riderPhone: (rider.phone ?? "").toString(),
        riderVehicle: [rider.vehicleType, rider.vehicleNumber].filter(Boolean).join(" • "),
        deliveryStatus: DeliveryState.ASSIGNED,
        // The order may have been mid-offer to somebody else. Leaving the offer
        // behind lets reassignExpiredOffers re-dispatch an assigned order.
        offer: FieldValue.delete(),
        deliveryFlag: FieldValue.delete(),
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: actorEmail || "admin",
        assignedByAdmin: true,
        ...(prevRiderId && prevRiderId !== riderId
          ? { previousRiderIds: FieldValue.arrayUnion(prevRiderId) }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Keyed by rider: a double-tap writes one event, but a genuine handoff
    // A→B records both legs.
    writeEvent(tx, orderId, `admin_assign_${orderId}_${riderId}`, {
      type: "DELIVERY_ASSIGNED",
      actorId,
      actorRole: "admin",
      from: stage,
      to: DeliveryState.ASSIGNED,
      metadata: {
        riderId,
        riderName: (rider.name ?? "Rider").toString(),
        adminEmail: actorEmail,
        reason: reason || null,
        previousRiderId: prevRiderId || null,
      },
    });

    // Sequential batching, exactly as the rider's own accept path does: a
    // rider already carrying an order gets this one queued, not swapped.
    const currentOrderId = (rider.currentOrderId ?? "").toString();
    tx.set(
      riderRef,
      currentOrderId && currentOrderId !== orderId
        ? { queuedOrderIds: FieldValue.arrayUnion(orderId), updatedAt: FieldValue.serverTimestamp() }
        : { currentOrderId: orderId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    // Free the rider we took it from, keeping any other delivery they hold.
    if (prevRiderSnap?.exists) {
      const prevPatch: Record<string, unknown> = {
        queuedOrderIds: FieldValue.arrayRemove(orderId),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (prevRiderSnap.data()?.currentOrderId === orderId) {
        prevPatch.currentOrderId = FieldValue.delete();
      }
      tx.set(prevRiderSnap.ref, prevPatch, { merge: true });
    }

    return {
      changed: true,
      riderName: (rider.name ?? "Rider").toString(),
      previousRiderId: prevRiderId && prevRiderId !== riderId ? prevRiderId : "",
    };
  });

  if (!outcome.changed) {
    return { ok: true, idempotent: true, riderName: outcome.riderName };
  }

  // Everything below is best-effort: the assignment is already committed, and
  // a failed notification must not report the assignment as failed.
  const freshSnap = await orderRef.get();
  const order = freshSnap.data() ?? {};
  const riderSnap = await riderRef.get();
  const rider = riderSnap.data() ?? {};

  await stampEta(orderRef, order, coord(rider.location)).catch((e) =>
    logger.error("adminAssignRider: stampEta failed", e),
  );
  await notifyCustomer(
    order,
    orderId,
    "Rider assigned 🛵",
    `${outcome.riderName} is heading to the restaurant.`,
  ).catch(() => {});
  await riderRef
    .collection("notifications")
    .add({
      title: "New Delivery Assigned",
      body: `Order #${(order.orderNumber ?? orderId.slice(-6)).toString()} assigned by Dispatch.`,
      type: "order_assigned",
      orderId,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch((e) => logger.error("adminAssignRider: rider notification failed", e));
  const restaurantId = (order.restaurantId ?? "").toString();
  if (restaurantId) {
    await db()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("notifications")
      .add({
        title: "Rider assigned",
        message: `${outcome.riderName} will pick up order ${(order.orderNumber ?? "").toString()}`,
        source: "delivery",
        severity: "info",
        read: false,
        metadata: { orderId, riderName: outcome.riderName },
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  }

  logger.info(`Order ${orderId} assigned to rider ${riderId} by ${actorEmail || actorId}`);
  return { ok: true, riderName: outcome.riderName, previousRiderId: outcome.previousRiderId };
});

// ─────────────────────────────────────────────────────────────────────────────
// §18 — Stuck / delayed delivery detection.
// Flags orders that stopped moving so ops can intervene. Deliberately does NOT
// auto-cancel: a slow delivery is still a legitimate delivery. Thresholds only
// escalate, never destroy.
// ─────────────────────────────────────────────────────────────────────────────
const STUCK_UNASSIGNED_MIN = 10; // released/placed but nobody took it
const STUCK_NO_PROGRESS_MIN = 15; // accepted but never reached the shop
const STUCK_OVERDUE_MIN = 45; // food picked up but not delivered

export const sweepStuckDeliveries = onSchedule("every 5 minutes", withCronHeartbeat("sweepStuckDeliveries", 5, async () => {
  const now = Date.now();
  const ms = (m: number) => m * 60_000;

  // Presence: take silent riders offline (see PRESENCE_OFFLINE_STALE_MS). A
  // rider mid-delivery is left alone — a basement or lift is normal, and the
  // stuck-delivery flags below cover a delivery that really stalls.
  const online = await db().collection("delivery_users").where("isOnline", "==", true).get();
  for (const r of online.docs) {
    const d = r.data();
    if ((d.currentOrderId ?? "").toString()) continue;
    if (!presenceIsStale(d.locationUpdatedAt, now, PRESENCE_OFFLINE_STALE_MS)) continue;
    await r.ref
      .set(
        {
          isOnline: false,
          offlineReason: "no_signal",
          offlineAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      .catch((e) => logger.error("presence sweep failed", { rider: r.id, e }));
    logger.info(`presence: took ${r.id} offline (no signal for ${PRESENCE_OFFLINE_STALE_MS / 60_000} min)`);
  }

  const active = await db()
    .collection("orders")
    .where("deliveryStatus", "in", [
      "unassigned",
      "assigned",
      "at_restaurant",
      "picked_up",
      "on_the_way",
      "arrived",
    ])
    .limit(400)
    .get();

  let flagged = 0;
  for (const doc of active.docs) {
    const o = doc.data();
    const status = (o.status ?? "").toString();
    if (["cancelled", "rejected", "completed", "delivered"].includes(status)) continue;
    if (o.deliveryFlag) continue; // already flagged — don't re-alert

    const ds = (o.deliveryStatus ?? "").toString();
    const at = (v: any): number =>
      v?.toMillis?.() ?? (typeof v === "number" ? v : 0);

    let flag = "";
    let detail = "";
    if (ds === "unassigned") {
      const since = at(o.releasedForPickupAt) || at(o.timestamp) || at(o.createdAt);
      if (since && now - since > ms(STUCK_UNASSIGNED_MIN)) {
        flag = "unassigned_too_long";
        detail = `No delivery partner for ${Math.round((now - since) / 60000)} min`;
      }
    } else if (ds === "assigned") {
      const since = at(o.assignedAt);
      if (since && now - since > ms(STUCK_NO_PROGRESS_MIN)) {
        flag = "no_pickup_progress";
        detail = `Rider assigned ${Math.round((now - since) / 60000)} min ago, not at shop`;
      }
    } else if (POST_PICKUP.includes(ds) && ds !== "delivered") {
      const since = at(o.pickedUpAt);
      if (since && now - since > ms(STUCK_OVERDUE_MIN)) {
        flag = "delivery_overdue";
        detail = `Picked up ${Math.round((now - since) / 60000)} min ago, not delivered`;
      }
    }
    if (!flag) continue;

    await doc.ref.set(
      { deliveryFlag: flag, deliveryFlaggedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await logEvent(doc.id, `flag_${doc.id}_${flag}`, {
      type: "DELIVERY_FLAGGED",
      actorId: "system",
      actorRole: "system",
      from: ds,
      metadata: { flag, detail },
    });
    await db().collection("admin_notifications").add({
      type: "delivery_exception",
      title: `\u26a0\ufe0f ${flag.replace(/_/g, " ")}`,
      body: `Order ${(o.orderNumber ?? doc.id).toString()}: ${detail}`,
      orderId: doc.id,
      flag,
      urgency: "high",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    flagged++;
  }
  if (flagged) logger.info(`sweepStuckDeliveries flagged ${flagged} orders`);
}));

// ─────────────────────────────────────────────────────────────────────────────
// Rider earnings SAFETY NET.
//
// Earnings used to be computed ONLY inside `completeDelivery`. Any other route
// to a finished order — an admin resolving a stuck delivery, a manual status
// correction, a legacy/aggregator write — left `riderEarning` unset, so the
// rider saw ₹0 for a delivery they actually made. (`fixEarnings.ts` existed to
// backfill exactly this, which is a symptom, not a fix.)
//
// Earnings are now STATE-driven: whenever an order transitions into a finished
// state with a rider attached and no earning recorded, we compute and pay it
// using the same formula. Idempotent on the per-order earnings entry, so it can
// never double-pay and never races `completeDelivery` (which writes the earning
// in the same batch as the status, so this trigger sees it already set).
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A delivery's rider pay in rupees. Orders placed through the pricing engine
 * carry it in `pricing.settlement.rider` (paise), fixed when the order was
 * priced, so later fee changes can't move it. Older orders keep today's
 * base + per-km + tip formula.
 */
function riderPayFor(
  order: FirebaseFirestore.DocumentData,
  distanceKm: number,
  econ: { riderBaseFee: number; riderPerKm: number },
): { base: number; distancePay: number; surgeShare: number; incentive: number; tip: number; total: number; source: "pricing_snapshot" | "legacy_formula" } {
  const r = order.pricing?.settlement?.rider;
  const totalPaise = Number(r?.totalPaise);
  if (typeof order.pricing?.engineVersion === "string" && Number.isSafeInteger(totalPaise) && totalPaise > 0) {
    const rupees = (p: unknown) => (Number(p) || 0) / 100;
    return {
      base: rupees(r.basePaise),
      distancePay: rupees(r.distancePaise),
      surgeShare: rupees(r.surgeSharePaise),
      incentive: rupees(r.incentivePaise),
      tip: rupees(r.tipPaise),
      total: totalPaise / 100,
      source: "pricing_snapshot",
    };
  }
  const tip = Number(order.tip ?? 0) || 0;
  const distancePay = Math.round(distanceKm * econ.riderPerKm);
  return { base: econ.riderBaseFee, distancePay, surgeShare: 0, incentive: 0, tip, total: econ.riderBaseFee + distancePay + tip, source: "legacy_formula" };
}

function isFinishedOrder(o: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!o) return false;
  const s = (o.status ?? "").toString().toLowerCase();
  const d = (o.deliveryStatus ?? "").toString().toLowerCase();
  return d === "delivered" || s === "delivered" || s === "completed";
}

/** Compute + persist a rider's earning for a finished delivery, exactly once. */
export async function ensureRiderEarning(
  orderId: string,
  order: FirebaseFirestore.DocumentData,
): Promise<number> {
  const uid = (order.riderId ?? "").toString();
  if (!uid) return 0;
  if (Number(order.riderEarning ?? 0) > 0) return Number(order.riderEarning);

  // Reads that need to happen BEFORE the transaction (a txn may not perform
  // fresh async reads once writes begin).
  const pickup = await pickupCoord(order);
  const drop = dropCoord(order);
  const distanceKm = pickup && drop ? haversineKm(pickup.lat, pickup.lng, drop.lat, drop.lng) : 0;
  const econ = await platformEconomics();
  const pay = riderPayFor(await withFinance(db().collection("orders").doc(orderId), order), distanceKm, econ);
  const { tip, distancePay, total: riderEarning } = pay;

  const orderRef = db().collection("orders").doc(orderId);
  const entryRef = db()
    .collection("rider_earnings")
    .doc(uid)
    .collection("entries")
    .doc(orderId);

  const riderRef = db().collection("delivery_users").doc(uid);
  return await db().runTransaction(async (tx) => {
    const entrySnap = await tx.get(entryRef);
    const orderSnap = await tx.get(orderRef);
    const riderSnap = await tx.get(riderRef);
    // Already paid for this order — either by completeDelivery or a previous
    // run of this trigger.
    if (entrySnap.exists) return Number(entrySnap.data()?.total ?? 0) || 0;
    const fresh = orderSnap.data() ?? order;
    if (Number(fresh.riderEarning ?? 0) > 0) return Number(fresh.riderEarning);

    tx.set(
      entryRef,
      {
        orderId,
        orderNumber: (fresh.orderNumber ?? "").toString(),
        restaurantName: (fresh.restaurantName ?? "").toString(),
        base: pay.base,
        distancePay,
        surgeShare: pay.surgeShare,
        incentive: pay.incentive,
        distanceKm: Number(distanceKm.toFixed(2)),
        tip,
        total: riderEarning,
        pricingSource: pay.source,
        codCollected: 0,
        paymentMethod: (fresh.paymentMethod ?? "").toString(),
        reconciled: true,
        source: "safety_net",
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(orderRef, { riderEarning, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      riderRef,
      {
        ...earningsFields(riderSnap.data(), riderEarning, new Date()),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return riderEarning;
  });
}

export const onOrderFinishedEnsureEarnings = onDocumentUpdated(
  { document: "orders/{orderId}", maxInstances: 3 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) return;
    // Only on the transition INTO a finished state.
    if (!isFinishedOrder(after) || isFinishedOrder(before)) return;
    if (!(after.riderId ?? "")) return;
    if (Number(after.riderEarning ?? 0) > 0) return; // completeDelivery paid it

    try {
      const paid = await ensureRiderEarning(event.params.orderId, after);
      if (paid > 0) {
        logger.info(
          `Safety net paid rider ${after.riderId} ₹${paid} for ${event.params.orderId} ` +
            `(order finished without completeDelivery)`,
        );
        await logEvent(event.params.orderId, `earning_${event.params.orderId}`, {
          type: "RIDER_EARNING_RECORDED",
          actorId: "system",
          actorRole: "system",
          metadata: { riderId: after.riderId, amount: paid, source: "safety_net" },
        });
      }
    } catch (e) {
      logger.error("ensureRiderEarning failed", { orderId: event.params.orderId, e });
    }
  },
);
