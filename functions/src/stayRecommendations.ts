import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { HOT_PATH } from "./options";

/**
 * Stay discovery callables. They need no sign-in, so they return only a
 * property's public listing fields — never the whole hotel document, which
 * also carries onboarding, banking, KYC and commercial fields — and only
 * properties the onboarding engine has made bookable. Result sizes are capped
 * server-side; a caller can't ask for thousands of documents.
 */

const PUBLIC_FIELDS = [
  "name", "hotelName", "subtitle", "tagline", "propertyType", "destination", "city", "location",
  "images", "photos", "imageUrl", "coverImage", "logoUrl", "price", "startingPrice", "pricePerNight",
  "amenities", "lat", "lng", "rating", "reviewCount", "cancellationPolicy", "tag", "maxGuests",
] as const;

type Doc = FirebaseFirestore.DocumentSnapshot;

export function publicStay(doc: Doc): Record<string, unknown> {
  const d = doc.data() ?? {};
  const out: Record<string, unknown> = { id: doc.id };
  for (const k of PUBLIC_FIELDS) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

export const isBookable = (doc: Doc) => doc.data()?.onboarding?.state === "active";

export const clampLimit = (v: unknown, fallback = 5, max = 20) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

const byRating = (a: Doc, b: Doc) => (Number(b.data()?.rating) || 0) - (Number(a.data()?.rating) || 0);

/**
 * Gets similar stays (same destination, similar price/type).
 */
export const getSimilarStays = onCall({ ...HOT_PATH }, async (request) => {
  const hotelId = String(request.data?.hotelId ?? "").slice(0, 128);
  const limit = clampLimit(request.data?.limit);
  if (!hotelId) throw new HttpsError("invalid-argument", "Missing hotelId.");

  const db = admin.firestore();
  const hotelSnap = await db.doc(`hotels/${hotelId}`).get();
  if (!hotelSnap.exists) {
    throw new HttpsError("not-found", "Hotel not found.");
  }

  const data = hotelSnap.data() || {};
  const destination = data.destination || data.city || data.location;
  if (!destination) return { stays: [] };

  // Equality on destination only (no composite index), then keep bookable ones.
  const snapshot = await db.collection("hotels").where("destination", "==", destination).limit(50).get();
  const stays = snapshot.docs
    .filter((doc) => doc.id !== hotelId && isBookable(doc))
    .sort(byRating)
    .slice(0, limit)
    .map(publicStay);

  return { stays };
});

/**
 * Gets popular stays by destination.
 */
export const getPopularStays = onCall({ ...HOT_PATH }, async (request) => {
  const destination = String(request.data?.destination ?? "").slice(0, 100);
  const limit = clampLimit(request.data?.limit);
  const db = admin.firestore();

  const query = destination && destination !== "Anywhere"
    ? db.collection("hotels").where("destination", "==", destination).limit(100)
    : db.collection("hotels").where("onboarding.state", "==", "active").limit(100);
  const snapshot = await query.get();

  const stays = snapshot.docs.filter(isBookable).sort(byRating).slice(0, limit).map(publicStay);
  return { stays };
});
