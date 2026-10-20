import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Self-serve restaurant promotion ("Boost").
 *
 * A vendor activates a sponsored placement on the customer home feed. The
 * customer app already renders any active `platform_ads` doc of type
 * `sponsored_restaurant` (AdsService), so activation just writes that doc.
 *
 * Billing is POSTPAID and server-authoritative: the price comes from
 * BOOST_PLANS here (never from the client), and the spend is ledgered in
 * `ad_charges` with status "pending" to be netted against the vendor's next
 * settlement. No money is moved client-side. `platform_ads` creation is
 * admin-only in the rules, so this callable (admin SDK) is the only path a
 * vendor can take — they can never self-write a free boost.
 */
const BOOST_PLANS: Record<string, { days: number; amount: number; priority: number }> = {
  "7d": { days: 7, amount: 499, priority: 50 },
  "15d": { days: 15, amount: 899, priority: 60 },
  "30d": { days: 30, amount: 1499, priority: 75 },
};

const DAY_MS = 86_400_000;

export const createAdBoost = onCall(async (request) => {
  const db = admin.firestore();
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to boost your restaurant.");
  }

  const data = (request.data ?? {}) as { restaurantId?: unknown; plan?: unknown };
  const restaurantId = String(data.restaurantId ?? "").trim();
  const planKey = String(data.plan ?? "").trim();
  if (!restaurantId) {
    throw new HttpsError("invalid-argument", "Missing restaurant.");
  }
  const plan = BOOST_PLANS[planKey];
  if (!plan) {
    throw new HttpsError("invalid-argument", "Choose a valid boost plan.");
  }

  // Ownership — a vendor may only boost their own restaurant. The restaurant
  // doc id is the owner uid, and `ownerId` mirrors it.
  const rSnap = await db.collection("restaurants").doc(restaurantId).get();
  if (!rSnap.exists) {
    throw new HttpsError("not-found", "Restaurant not found.");
  }
  const rData = rSnap.data() || {};
  const owns = restaurantId === uid || rData.ownerId === uid;
  if (!owns) {
    throw new HttpsError("permission-denied", "You can only boost your own restaurant.");
  }

  const now = admin.firestore.Timestamp.now();

  // One active boost per restaurant — don't let a vendor stack spend by accident.
  const existing = await db
    .collection("platform_ads")
    .where("type", "==", "sponsored_restaurant")
    .where("restaurantId", "==", restaurantId)
    .where("active", "==", true)
    .limit(10)
    .get();
  const hasActive = existing.docs.some((d) => {
    const e = d.data().endAt as admin.firestore.Timestamp | undefined;
    return !e || e.toMillis() > now.toMillis();
  });
  if (hasActive) {
    throw new HttpsError(
      "failed-precondition",
      "This restaurant already has an active boost running.",
    );
  }

  const endAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + plan.days * DAY_MS);
  const restaurantName = String(rData.name ?? rData.restaurantName ?? "Restaurant");

  const adRef = db.collection("platform_ads").doc();
  const chargeRef = db.collection("ad_charges").doc();

  const batch = db.batch();
  batch.set(adRef, {
    type: "sponsored_restaurant",
    title: restaurantName,
    subtitle: "",
    tag: "SPONSORED",
    imageUrl: rData.logoUrl ?? rData.imageUrl ?? "",
    restaurantId,
    restaurantName,
    searchQuery: "",
    priority: plan.priority,
    active: true,
    impressions: 0,
    clicks: 0,
    startAt: now,
    endAt,
    createdAt: now,
    source: "vendor_self_serve",
    ownerUid: uid,
    chargeId: chargeRef.id,
  });
  batch.set(chargeRef, {
    vendorUid: uid,
    restaurantId,
    campaignId: adRef.id,
    plan: planKey,
    days: plan.days,
    amount: plan.amount,
    currency: "INR",
    status: "pending", // netted against the vendor's next settlement
    settlementId: null,
    createdAt: now,
  });
  await batch.commit();

  return {
    success: true,
    campaignId: adRef.id,
    amount: plan.amount,
    days: plan.days,
    endAt: endAt.toMillis(),
  };
});
