import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Service zones — THE geographic source of truth for the whole platform.
 *
 * Hierarchy:  Country → Market (city) → Zone (polygon) → vendors / riders /
 * customers / orders.
 *
 * Before this module, "where" was a single global number
 * (`config/platform.serviceRadiusKm`) applied identically to every city, and
 * `markets` was a decorative point+radius record nothing read. `demand_zones`
 * is a *surge pricing* record and is deliberately left alone — it answers
 * "how much extra do we pay riders here right now", not "do we serve here".
 *
 * Design rules that the rest of the codebase depends on:
 *
 *  1. RESOLUTION IS SERVER-SIDE. A client can ask which zone a point is in,
 *     but can never assert one. Zone decides fees and serviceability, so a
 *     client-chosen zone would be a way to pick your own delivery price.
 *
 *  2. ZONES ARE STAMPED, NOT JOINED. `restaurants.zoneId`, `delivery_users
 *     .zoneId` and `orders.zoneId` are written at the moment the entity's
 *     location is known. Reads stay single-collection and cheap; reports stay
 *     consistent even if a polygon is redrawn later.
 *
 *  3. A MANUAL ASSIGNMENT IS NEVER OVERWRITTEN BY AUTO-RESOLVE. Each stamp
 *     carries `zoneAssignment: "auto" | "manual"`. Admins deal with real
 *     edge cases (a vendor on a boundary, a rider who works the next zone
 *     over) and their override has to survive the next backfill.
 *
 *  4. OVERLAP IS ALLOWED AND DETERMINISTIC. Real service areas overlap at
 *     their seams. Highest `priority` wins; ties break on smaller area, so a
 *     small dense zone nested inside a big one takes precedence.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ZoneBBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface ZoneEconomics {
  deliveryBaseFee: number;
  deliveryPerKm: number;
  freeDeliveryUnderKm: number;
  freeDeliveryAbove: number;
  minOrderValue: number;
  platformFee: number;
  maxDeliveryRadiusKm: number;
}

export interface ZoneDoc {
  id: string;
  marketId: string;
  name: string;
  slug: string;
  colour: string;
  polygon: LatLng[];
  bbox: ZoneBBox;
  centroid: LatLng;
  areaSqKm: number;
  active: boolean;
  priority: number;
  economics: ZoneEconomics;
  codEnabled: boolean;
  surgeMultiplier: number;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** Mean Earth radius, km. */
const EARTH_R = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Axis-aligned bounds of a ring. Cheap pre-filter before the real test. */
export function bboxOf(polygon: LatLng[]): ZoneBBox {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function inBBox(point: LatLng, b: ZoneBBox): boolean {
  return (
    point.lat >= b.minLat &&
    point.lat <= b.maxLat &&
    point.lng >= b.minLng &&
    point.lng <= b.maxLng
  );
}

/**
 * Ray casting (crossing number). Counts how many times a ray cast east from
 * the point crosses the ring; odd means inside.
 *
 * The `(yi > y) !== (yj > y)` test deliberately treats one endpoint of each
 * edge as half-open. That is what stops a point lying exactly on a shared
 * vertex from being counted twice and coming out "outside" — which matters
 * here because adjacent zones are routinely drawn sharing vertices.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  const { lat: y, lng: x } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lng;
    const yj = polygon[j].lat;
    const xj = polygon[j].lng;
    const straddles = yi > y !== yj > y;
    if (!straddles) continue;
    const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < xCross) inside = !inside;
  }
  return inside;
}

/** Centroid of the ring's vertices. Good enough for map framing + "nearest". */
export function centroidOf(polygon: LatLng[]): LatLng {
  if (!polygon.length) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  for (const p of polygon) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / polygon.length, lng: lng / polygon.length };
}

/**
 * Approximate area in km², via the shoelace formula on a local equirectangular
 * projection. Only used to break priority ties and to show a figure in admin,
 * so the projection error at city scale is irrelevant.
 */
export function areaSqKm(polygon: LatLng[]): number {
  if (polygon.length < 3) return 0;
  const c = centroidOf(polygon);
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((c.lat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = (polygon[i].lng - c.lng) * kmPerDegLng;
    const yi = (polygon[i].lat - c.lat) * kmPerDegLat;
    const xj = (polygon[j].lng - c.lng) * kmPerDegLng;
    const yj = (polygon[j].lat - c.lat) * kmPerDegLat;
    sum += xj * yi - xi * yj;
  }
  return Math.abs(sum) / 2;
}

/** Self-intersection check on a ring — a bow-tie polygon breaks containment. */
export function isSelfIntersecting(polygon: LatLng[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  const seg = (i: number) => [polygon[i], polygon[(i + 1) % n]] as const;
  const cross = (o: LatLng, a: LatLng, b: LatLng) =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const intersects = (p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng) => {
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (and the wrap-around pair) — they share a vertex.
      if (j === i || j === (i + 1) % n || i === (j + 1) % n) continue;
      const [a1, a2] = seg(i);
      const [b1, b2] = seg(j);
      if (intersects(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// ── Normalisation ───────────────────────────────────────────────────────────

const DEFAULT_ECONOMICS: ZoneEconomics = {
  deliveryBaseFee: 25,
  deliveryPerKm: 7,
  freeDeliveryUnderKm: 3,
  freeDeliveryAbove: 0,
  minOrderValue: 0,
  platformFee: 0,
  maxDeliveryRadiusKm: 15,
};

function nonNegative(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function normaliseEconomics(raw: unknown): ZoneEconomics {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    deliveryBaseFee: nonNegative(d.deliveryBaseFee, DEFAULT_ECONOMICS.deliveryBaseFee),
    deliveryPerKm: nonNegative(d.deliveryPerKm, DEFAULT_ECONOMICS.deliveryPerKm),
    freeDeliveryUnderKm: nonNegative(d.freeDeliveryUnderKm, DEFAULT_ECONOMICS.freeDeliveryUnderKm),
    freeDeliveryAbove: nonNegative(d.freeDeliveryAbove, DEFAULT_ECONOMICS.freeDeliveryAbove),
    minOrderValue: nonNegative(d.minOrderValue, DEFAULT_ECONOMICS.minOrderValue),
    platformFee: nonNegative(d.platformFee, DEFAULT_ECONOMICS.platformFee),
    // Hard cap: no zone may claim to deliver further than 30 km.
    maxDeliveryRadiusKm: Math.min(
      30,
      nonNegative(d.maxDeliveryRadiusKm, DEFAULT_ECONOMICS.maxDeliveryRadiusKm),
    ),
  };
}

/** Coerce loose input into a clean ring, or throw with a usable message. */
export function normalisePolygon(raw: unknown): LatLng[] {
  if (!Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "polygon must be an array of points.");
  }
  const pts: LatLng[] = [];
  for (const p of raw) {
    const lat = Number((p as any)?.lat);
    const lng = Number((p as any)?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    // Drop consecutive duplicates — the map editor emits them on double-click.
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.lat - lat) < 1e-9 && Math.abs(last.lng - lng) < 1e-9) continue;
    pts.push({ lat, lng });
  }
  // A ring that repeats its first point at the end is closed; we store it open.
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9) pts.pop();
  }
  if (pts.length < 3) {
    throw new HttpsError("invalid-argument", "A zone needs at least 3 distinct points.");
  }
  if (pts.length > 500) {
    throw new HttpsError("invalid-argument", "A zone may have at most 500 points.");
  }
  if (isSelfIntersecting(pts)) {
    throw new HttpsError(
      "invalid-argument",
      "The zone boundary crosses itself. Redraw it without crossing lines.",
    );
  }
  return pts;
}

// ── Zone cache ──────────────────────────────────────────────────────────────
//
// Zones change rarely (an admin redraws a boundary) but are read on every
// order, every discovery call and every dispatch. A short in-instance cache
// turns that into roughly one read per instance per minute instead of one per
// request. Deliberately short so an admin edit goes live without a redeploy.

const ZONE_CACHE_TTL_MS = 60_000;
let zoneCache: { at: number; zones: ZoneDoc[] } | null = null;

function toZoneDoc(id: string, d: FirebaseFirestore.DocumentData): ZoneDoc | null {
  const polygon = Array.isArray(d.polygon)
    ? d.polygon
        .map((p: any) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
        .filter((p: LatLng) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    : [];
  if (polygon.length < 3) return null;
  return {
    id,
    marketId: (d.marketId ?? "").toString(),
    name: (d.name ?? "").toString(),
    slug: (d.slug ?? "").toString(),
    colour: (d.colour ?? "#0F6E6A").toString(),
    polygon,
    bbox: (d.bbox as ZoneBBox) ?? bboxOf(polygon),
    centroid: (d.centroid as LatLng) ?? centroidOf(polygon),
    areaSqKm: Number(d.areaSqKm) || areaSqKm(polygon),
    active: d.active !== false,
    priority: Number(d.priority) || 0,
    economics: normaliseEconomics(d.economics),
    codEnabled: d.codEnabled !== false,
    surgeMultiplier: Number(d.surgeMultiplier) || 1,
  };
}

export async function loadZones(force = false): Promise<ZoneDoc[]> {
  const now = Date.now();
  if (!force && zoneCache && now - zoneCache.at < ZONE_CACHE_TTL_MS) {
    return zoneCache.zones;
  }
  const snap = await admin.firestore().collection("zones").get();
  const zones: ZoneDoc[] = [];
  for (const doc of snap.docs) {
    const z = toZoneDoc(doc.id, doc.data());
    if (z) zones.push(z);
  }
  zoneCache = { at: now, zones };
  return zones;
}

/** Drop the cache so the very next read sees a just-saved edit. */
export function invalidateZoneCache(): void {
  zoneCache = null;
}

// ── Resolution ──────────────────────────────────────────────────────────────

export interface ZoneMatch {
  zone: ZoneDoc | null;
  /** Active zones ranked by centroid distance — what to offer when outside. */
  nearest: Array<{ id: string; name: string; marketId: string; distanceKm: number }>;
}

/**
 * Which zone contains this point.
 *
 * `includeInactive` exists for admin tooling: an admin looking at a paused
 * zone still needs to see which entities fall inside it. Customer-facing
 * callers must never pass it.
 */
export async function resolveZoneForPoint(
  point: LatLng,
  opts: { includeInactive?: boolean; limitNearest?: number } = {},
): Promise<ZoneMatch> {
  const zones = await loadZones();
  const candidates = opts.includeInactive ? zones : zones.filter((z) => z.active);

  const containing = candidates.filter(
    (z) => inBBox(point, z.bbox) && pointInPolygon(point, z.polygon),
  );

  // Highest priority wins; ties go to the smaller zone, so a dense zone drawn
  // inside a wider one takes precedence without needing a priority bump.
  containing.sort((a, b) => b.priority - a.priority || a.areaSqKm - b.areaSqKm);

  const nearest = candidates
    .map((z) => ({
      id: z.id,
      name: z.name,
      marketId: z.marketId,
      distanceKm: haversineKm(point, z.centroid),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, opts.limitNearest ?? 3);

  return { zone: containing[0] ?? null, nearest };
}

function coord(raw: unknown): LatLng | null {
  const d = raw as any;
  const lat = Number(d?.lat ?? d?.latitude);
  const lng = Number(d?.lng ?? d?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null; // unset, not Null Island
  return { lat, lng };
}

/**
 * Stamp a zone onto an entity document.
 *
 * Returns the zone id actually in force. A `manual` assignment is respected:
 * this is what stops the nightly backfill from undoing an admin's override.
 */
export async function stampZone(
  ref: FirebaseFirestore.DocumentReference,
  point: LatLng | null,
  existing: FirebaseFirestore.DocumentData | undefined,
  opts: { force?: boolean } = {},
): Promise<string | null> {
  if (!opts.force && existing?.zoneAssignment === "manual") {
    return (existing.zoneId ?? null) as string | null;
  }
  if (!point) return (existing?.zoneId ?? null) as string | null;

  const { zone } = await resolveZoneForPoint(point, { includeInactive: true });
  const zoneId = zone?.id ?? null;
  if ((existing?.zoneId ?? null) === zoneId) return zoneId;

  await ref.set(
    {
      zoneId,
      marketId: zone?.marketId ?? null,
      zoneName: zone?.name ?? null,
      zoneAssignment: "auto",
      zoneResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return zoneId;
}

/** The coordinate that decides a restaurant's zone. */
export function restaurantPoint(d: FirebaseFirestore.DocumentData | undefined): LatLng | null {
  return coord(d?.location);
}

/** The coordinate that decides a rider's zone — their registered base. */
export function riderPoint(d: FirebaseFirestore.DocumentData | undefined): LatLng | null {
  return coord(d?.baseLocation) ?? coord(d?.location);
}

/** The coordinate that decides an order's zone — where the food is going. */
export function orderPoint(d: FirebaseFirestore.DocumentData | undefined): LatLng | null {
  return coord(d?.deliveryAddress?.gps) ?? coord(d?.restaurantLocation);
}

// ── Callables ───────────────────────────────────────────────────────────────

function assertAdminCaller(request: { auth?: { token?: Record<string, unknown> } }): {
  email: string;
  role: string;
} {
  const token = request.auth?.token ?? {};
  const email = (token.email as string) || "";
  const role = (token.adminRole as string) || "super_admin";
  const isAdmin =
    token.platformAdmin === true ||
    ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email);
  if (!isAdmin) throw new HttpsError("permission-denied", "Admins only.");
  return { email, role };
}

/**
 * Which zone is this coordinate in, and is Kada actually usable there?
 *
 * Callable by any signed-in user — the customer app asks this before showing a
 * location as serviceable. It answers three distinct states rather than a
 * boolean, because "we don't deliver here" and "nothing is open right now"
 * need different words in the app, and both beat an empty restaurant list.
 */
export const resolveZone = onCall({ maxInstances: 5 }, async (request) => {
  const point = coord(request.data);
  if (!point) throw new HttpsError("invalid-argument", "lat and lng are required.");

  const { zone, nearest } = await resolveZoneForPoint(point);

  if (!zone) {
    return {
      ok: true,
      status: "outside_coverage" as const,
      zone: null,
      nearest,
    };
  }

  // A zone with no open vendor is serviceable on paper and useless in
  // practice; say which one it is rather than returning an empty list.
  const openSnap = await admin
    .firestore()
    .collection("restaurants")
    .where("zoneId", "==", zone.id)
    .where("isOpen", "==", true)
    .limit(1)
    .get();

  return {
    ok: true,
    status: openSnap.empty ? ("no_supply" as const) : ("serviceable" as const),
    zone: {
      id: zone.id,
      name: zone.name,
      marketId: zone.marketId,
      economics: zone.economics,
      codEnabled: zone.codEnabled,
      surgeMultiplier: zone.surgeMultiplier,
    },
    nearest,
  };
});

/** Create or update a zone. Admin-only; validates the ring before storing. */
export const upsertServiceZone = onCall({ maxInstances: 3 }, async (request) => {
  const { email, role } = assertAdminCaller(request);
  if (!["super_admin", "platform_admin", "ops_manager"].includes(role)) {
    throw new HttpsError("permission-denied", `Your role (${role}) cannot edit zones.`);
  }

  const data = (request.data ?? {}) as Record<string, unknown>;
  const name = (data.name ?? "").toString().trim().slice(0, 80);
  if (!name) throw new HttpsError("invalid-argument", "name is required.");
  const marketId = (data.marketId ?? "").toString().trim().slice(0, 80);
  if (!marketId) throw new HttpsError("invalid-argument", "marketId is required.");

  const polygon = normalisePolygon(data.polygon);
  const db = admin.firestore();

  // The parent city must exist — a zone with a dangling marketId would vanish
  // from every city-scoped report without any error surfacing.
  const marketSnap = await db.collection("markets").doc(marketId).get();
  if (!marketSnap.exists) {
    throw new HttpsError("failed-precondition", "That city does not exist.");
  }

  const id = (data.id ?? "").toString().trim().slice(0, 80);
  const ref = id ? db.collection("zones").doc(id) : db.collection("zones").doc();
  const before = id ? (await ref.get()).data() ?? null : null;

  const payload = {
    marketId,
    name,
    slug: (data.slug ?? "").toString().trim().slice(0, 80) ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    colour: (data.colour ?? "#0F6E6A").toString().slice(0, 9),
    polygon,
    bbox: bboxOf(polygon),
    centroid: centroidOf(polygon),
    areaSqKm: Math.round(areaSqKm(polygon) * 100) / 100,
    active: data.active !== false,
    priority: Number(data.priority) || 0,
    economics: normaliseEconomics(data.economics),
    codEnabled: data.codEnabled !== false,
    surgeMultiplier: Math.min(3, Math.max(1, Number(data.surgeMultiplier) || 1)),
    hours: data.hours ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  };

  await ref.set(payload, { merge: true });
  invalidateZoneCache();

  await db.collection("admin_logs").add({
    type: "platform",
    action: id ? "updateZone" : "createZone",
    description: `Zone ${name}`,
    adminEmail: email,
    payload: { id: ref.id, name, marketId, points: polygon.length, before },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, id: ref.id, areaSqKm: payload.areaSqKm };
});

/**
 * Delete a zone.
 *
 * Refuses while entities still point at it. Silently orphaning vendors and
 * riders would take them out of every zone-filtered view with no error —
 * deactivating is what the admin almost always means.
 */
export const deleteServiceZone = onCall({ maxInstances: 2 }, async (request) => {
  const { email, role } = assertAdminCaller(request);
  if (!["super_admin", "platform_admin"].includes(role)) {
    throw new HttpsError("permission-denied", `Your role (${role}) cannot delete zones.`);
  }
  const id = (request.data?.id ?? "").toString().trim();
  if (!id) throw new HttpsError("invalid-argument", "id is required.");

  const db = admin.firestore();
  const partnerLabel: Record<string, string> = {
    restaurants: "vendors",
    delivery_users: "delivery partners",
    mess_kitchens: "mess kitchens",
  };
  for (const collection of ["restaurants", "delivery_users", "mess_kitchens"]) {
    const used = await db.collection(collection).where("zoneId", "==", id).limit(1).get();
    if (!used.empty) {
      throw new HttpsError(
        "failed-precondition",
        `This zone still has ${partnerLabel[collection]} ` +
          "assigned. Move them first, or deactivate the zone instead of deleting it.",
      );
    }
  }

  await db.collection("zones").doc(id).delete();
  invalidateZoneCache();
  await db.collection("admin_logs").add({
    type: "platform",
    action: "deleteZone",
    description: `Zone ${id} deleted`,
    adminEmail: email,
    payload: { id },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/** Pin an entity to a zone by hand, or hand it back to auto-resolution. */
export const setEntityZone = onCall({ maxInstances: 3 }, async (request) => {
  const { email, role } = assertAdminCaller(request);
  if (!["super_admin", "platform_admin", "ops_manager"].includes(role)) {
    throw new HttpsError("permission-denied", `Your role (${role}) cannot reassign zones.`);
  }

  const kind = (request.data?.kind ?? "").toString();
  const entityId = (request.data?.entityId ?? "").toString().trim();
  const zoneId = (request.data?.zoneId ?? "").toString().trim();
  const mode = request.data?.mode === "auto" ? "auto" : "manual";

  const collection =
    kind === "vendor"
      ? "restaurants"
      : kind === "rider"
        ? "delivery_users"
        : kind === "mess"
          ? "mess_kitchens"
          : "";
  if (!collection) throw new HttpsError("invalid-argument", "kind must be vendor, rider or mess.");
  if (!entityId) throw new HttpsError("invalid-argument", "entityId is required.");

  const db = admin.firestore();
  const ref = db.collection(collection).doc(entityId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That record does not exist.");
  const existing = snap.data() ?? {};

  if (mode === "auto") {
    const point = kind === "rider" ? riderPoint(existing) : restaurantPoint(existing);
    const resolved = await stampZone(ref, point, existing, { force: true });
    await db.collection("admin_logs").add({
      type: "platform",
      action: "setEntityZone",
      description: `${kind} ${entityId} → auto`,
      adminEmail: email,
      payload: { kind, entityId, mode, resolved, previous: existing.zoneId ?? null },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, zoneId: resolved, mode };
  }

  if (!zoneId) throw new HttpsError("invalid-argument", "zoneId is required for a manual pin.");
  const zoneSnap = await db.collection("zones").doc(zoneId).get();
  if (!zoneSnap.exists) throw new HttpsError("not-found", "That zone does not exist.");
  const zone = zoneSnap.data() ?? {};

  await ref.set(
    {
      zoneId,
      marketId: zone.marketId ?? null,
      zoneName: zone.name ?? null,
      zoneAssignment: "manual",
      zoneResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection("admin_logs").add({
    type: "platform",
    action: "setEntityZone",
    description: `${kind} ${entityId} pinned to ${zone.name ?? zoneId}`,
    adminEmail: email,
    payload: { kind, entityId, zoneId, mode, previous: existing.zoneId ?? null },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, zoneId, mode };
});

/**
 * Re-resolve every vendor and rider against the current polygons.
 *
 * Run after redrawing boundaries. Dry-run by default and manual assignments
 * are left alone, so it is safe to run for the count alone.
 */
export const backfillZones = onCall({ maxInstances: 1, timeoutSeconds: 540 }, async (request) => {
  const { email, role } = assertAdminCaller(request);
  if (!["super_admin", "platform_admin"].includes(role)) {
    throw new HttpsError("permission-denied", `Your role (${role}) cannot run backfills.`);
  }
  const dryRun = request.data?.dryRun !== false;
  const db = admin.firestore();
  await loadZones(true);

  const summary: Record<string, { scanned: number; changed: number; unresolved: number }> = {};

  for (const [kind, collection] of [
    ["vendor", "restaurants"],
    ["rider", "delivery_users"],
    ["mess", "mess_kitchens"],
  ] as const) {
    const snap = await db.collection(collection).get();
    const stat = { scanned: snap.size, changed: 0, unresolved: 0 };

    for (let i = 0; i < snap.docs.length; i += 400) {
      const chunk = snap.docs.slice(i, i + 400);
      const batch = db.batch();
      let writes = 0;

      for (const doc of chunk) {
        const d = doc.data();
        if (d.zoneAssignment === "manual") continue;
        const point = kind === "rider" ? riderPoint(d) : restaurantPoint(d);
        if (!point) {
          stat.unresolved++;
          continue;
        }
        const { zone } = await resolveZoneForPoint(point, { includeInactive: true });
        const next = zone?.id ?? null;
        if (!next) stat.unresolved++;
        if ((d.zoneId ?? null) === next) continue;
        stat.changed++;
        if (dryRun) continue;
        batch.set(
          doc.ref,
          {
            zoneId: next,
            marketId: zone?.marketId ?? null,
            zoneName: zone?.name ?? null,
            zoneAssignment: "auto",
            zoneResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        writes++;
      }
      if (!dryRun && writes) await batch.commit();
    }
    summary[collection] = stat;
  }

  if (!dryRun) {
    await db.collection("admin_logs").add({
      type: "platform",
      action: "backfillZones",
      description: "Zone backfill",
      adminEmail: email,
      payload: summary,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  logger.info("Zone backfill", { dryRun, summary, email });
  return { ok: true, dryRun, summary };
});

/**
 * Keep a vendor's zone in step with their location.
 *
 * Vendors move their pin from the app's settings screen; without this the
 * stamp would only ever be as fresh as the last manual backfill.
 */
export async function syncRestaurantZone(
  restaurantId: string,
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined,
): Promise<void> {
  if (!after) return;
  const prev = restaurantPoint(before);
  const next = restaurantPoint(after);
  if (!next) return;
  const moved = !prev || prev.lat !== next.lat || prev.lng !== next.lng;
  if (!moved && after.zoneId !== undefined) return;
  await stampZone(admin.firestore().collection("restaurants").doc(restaurantId), next, after);
}

// ── Triggers ────────────────────────────────────────────────────────────────

/**
 * Stamp every order with the zone it was delivered into, at creation.
 *
 * Stamped rather than joined at read time so that finance and analytics can
 * group by zone with a single-collection query, and so a boundary redrawn next
 * month never silently rewrites last month's numbers.
 */
export const onOrderStampZone = onDocumentCreated(
  { document: "orders/{orderId}", maxInstances: 3 },
  async (event) => {
    const order = event.data?.data();
    if (!order || order.zoneId !== undefined) return;
    const point = orderPoint(order);
    if (!point) return;
    try {
      const { zone } = await resolveZoneForPoint(point, { includeInactive: true });
      await event.data!.ref.set(
        {
          zoneId: zone?.id ?? null,
          marketId: zone?.marketId ?? null,
          zoneName: zone?.name ?? null,
        },
        { merge: true },
      );
    } catch (e) {
      // Never block an order over analytics metadata.
      logger.error("onOrderStampZone failed", { orderId: event.params.orderId, e });
    }
  },
);

/** Re-resolve a vendor's zone whenever they move their pin. */
export const onRestaurantLocationChanged = onDocumentWritten(
  { document: "restaurants/{restaurantId}", maxInstances: 3 },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    try {
      await syncRestaurantZone(event.params.restaurantId, before, after);
    } catch (e) {
      logger.error("onRestaurantLocationChanged failed", {
        restaurantId: event.params.restaurantId,
        e,
      });
    }
  },
);
