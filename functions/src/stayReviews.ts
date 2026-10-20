/**
 * Guest reviews for Kada Stay.
 *
 * `stay_reviews` is admin-write in the rules, and the customer app had only a
 * "Review functionality coming soon" snackbar, so listings showed a made-up
 * rating. A guest now reviews a stay they actually completed, once per
 * booking (editing replaces it), and the property's rating and review count
 * are kept exactly in the same transaction.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { enforceRateLimit } from "./rateLimit";

const str = (v: unknown, max: number) => (v ?? "").toString().trim().slice(0, max);
const millis = (v: unknown): number => {
  if (typeof v === "number") return v;
  const t = v as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
};

const NOT_REVIEWABLE = ["cancelled", "canceled", "rejected", "pending_payment", "no_show"];

export const submitStayReview = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to review your stay.");
  await enforceRateLimit(`stay_review_${uid}`, 10, 60 * 60_000);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const bookingId = str(data.bookingId, 128);
  const rating = Math.trunc(Number(data.rating));
  const comment = str(data.comment, 1000);
  if (!bookingId) throw new HttpsError("invalid-argument", "Choose the stay you're reviewing.");
  if (!(rating >= 1 && rating <= 5)) throw new HttpsError("invalid-argument", "Pick a rating from 1 to 5 stars.");

  const db = admin.firestore();
  const bookingRef = db.collection("stay_bookings").doc(bookingId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    const b = bookingSnap.data();
    if (!b || b.customerId !== uid) throw new HttpsError("not-found", "We couldn't find that stay on your account.");
    if (NOT_REVIEWABLE.includes(String(b.status ?? "").toLowerCase())) {
      throw new HttpsError("failed-precondition", "Only completed stays can be reviewed.");
    }
    const checkOut = millis(b.checkOut);
    if (!checkOut || checkOut > Date.now()) {
      throw new HttpsError("failed-precondition", "You can review your stay after check-out.");
    }

    const hotelId = String(b.hotelId ?? "");
    const reviewRef = db.collection("stay_reviews").doc(bookingId);
    const hotelRef = db.collection("hotels").doc(hotelId);
    const mirrorRef = hotelRef.collection("bookings").doc(bookingId);
    const [existing, hotelSnap, mirrorSnap] = await Promise.all([tx.get(reviewRef), tx.get(hotelRef), tx.get(mirrorRef)]);

    const prev = existing.data();
    const h = hotelSnap.data() ?? {};
    let count = Number(h.reviewCount) || 0;
    let sum = Number.isFinite(Number(h.ratingSum)) && h.ratingSum != null ? Number(h.ratingSum) : 0;
    if (prev) sum -= Number(prev.rating) || 0;
    else count += 1;
    sum += rating;

    tx.set(reviewRef, {
      hotelId,
      bookingId,
      customerId: uid,
      guestName: str(b.customerName, 80) || "Guest",
      rating,
      comment,
      hostReply: prev?.hostReply ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    }, { merge: true });
    if (hotelSnap.exists && count > 0) {
      tx.update(hotelRef, { ratingSum: sum, reviewCount: count, rating: Math.round((sum / count) * 10) / 10 });
    }
    const reviewed = { reviewRating: rating, reviewedAt: now };
    tx.update(bookingRef, reviewed);
    if (mirrorSnap.exists) tx.update(mirrorRef, reviewed);
    return { ok: true, updated: Boolean(prev), reviewCount: count };
  });
});

/**
 * Removes a guest's own stay review and reverses the property's rating in the
 * same transaction.
 *
 * `stay_reviews` is admin-write, so the app used to delete the doc directly and
 * every attempt failed with permission-denied. Doing it here also keeps the
 * hotel's `ratingSum`/`reviewCount`/`rating` honest — a raw delete would have
 * left the property rated by a review that no longer exists.
 */
export const deleteStayReview = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage your reviews.");
  await enforceRateLimit(`stay_review_delete_${uid}`, 20, 60 * 60_000);

  const bookingId = str((request.data as Record<string, unknown> | undefined)?.bookingId, 128);
  if (!bookingId) throw new HttpsError("invalid-argument", "We couldn't tell which review to remove.");

  const db = admin.firestore();
  const reviewRef = db.collection("stay_reviews").doc(bookingId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(reviewRef);
    const review = snap.data();
    // Idempotent: a second tap (or a retry) is a success, not an error.
    if (!review) return { ok: true, alreadyGone: true };
    if (review.customerId !== uid) {
      throw new HttpsError("permission-denied", "You can only remove your own review.");
    }

    const hotelId = String(review.hotelId ?? "");
    if (hotelId) {
      const hotelRef = db.collection("hotels").doc(hotelId);
      const hotelSnap = await tx.get(hotelRef);
      if (hotelSnap.exists) {
        const h = hotelSnap.data() ?? {};
        const count = Math.max(0, (Number(h.reviewCount) || 0) - 1);
        const sum = Math.max(0, (Number(h.ratingSum) || 0) - (Number(review.rating) || 0));
        tx.update(hotelRef, {
          ratingSum: count > 0 ? sum : 0,
          reviewCount: count,
          // No reviews left means no rating — never a stale average.
          rating: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
        });
      }
    }

    // The booking keeps its history but stops claiming a review.
    const bookingRef = db.collection("stay_bookings").doc(bookingId);
    const bookingSnap = await tx.get(bookingRef);
    if (bookingSnap.exists) {
      tx.update(bookingRef, {
        reviewRating: admin.firestore.FieldValue.delete(),
        reviewedAt: admin.firestore.FieldValue.delete(),
      });
      const mirrorRef = db
        .collection("hotels")
        .doc(String(bookingSnap.data()?.hotelId ?? hotelId))
        .collection("bookings")
        .doc(bookingId);
      const mirrorSnap = await tx.get(mirrorRef);
      if (mirrorSnap.exists) {
        tx.update(mirrorRef, {
          reviewRating: admin.firestore.FieldValue.delete(),
          reviewedAt: admin.firestore.FieldValue.delete(),
        });
      }
    }

    tx.delete(reviewRef);
    return { ok: true, alreadyGone: false };
  });
});

/**
 * The host's public reply to a guest review.
 *
 * `stay_reviews` is admin-write, so the host app's direct `update()` was
 * rejected every time — hosts believed they had replied and guests never saw
 * anything. Written here after checking the caller actually owns the property.
 */
export const replyToStayReview = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to reply.");
  await enforceRateLimit(`stay_reply_${uid}`, 60, 60 * 60_000);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const reviewId = str(data.reviewId, 128);
  const reply = str(data.reply, 1000);
  if (!reviewId) throw new HttpsError("invalid-argument", "Which review is this a reply to?");

  const db = admin.firestore();
  const reviewRef = db.collection("stay_reviews").doc(reviewId);
  const snap = await reviewRef.get();
  const review = snap.data();
  if (!review) throw new HttpsError("not-found", "That review no longer exists.");

  const hotelId = String(review.hotelId ?? "");
  // The host signs in as the hotel, or as a user carrying its hotelId.
  // A host signs in AS the property (hotel doc id == their uid), which is the
  // same check the rules make everywhere else. `users/{uid}.hotelId` covers a
  // login attached to a property it isn't named after.
  let owns = hotelId === uid;
  if (!owns) {
    const [hostUser, hotel] = await Promise.all([
      db.collection("users").doc(uid).get(),
      db.collection("hotels").doc(hotelId).get(),
    ]);
    owns =
      String(hostUser.data()?.hotelId ?? "") === hotelId ||
      String(hotel.data()?.ownerId ?? "") === uid;
  }
  if (!owns && request.auth?.token?.platformAdmin !== true) {
    throw new HttpsError("permission-denied", "Only this property can reply to its reviews.");
  }

  // An empty reply removes one — the host app's "edit reply" cleared to blank.
  await reviewRef.set(
    reply
      ? { hostReply: reply, replyDate: admin.firestore.FieldValue.serverTimestamp() }
      : {
          hostReply: admin.firestore.FieldValue.delete(),
          replyDate: admin.firestore.FieldValue.delete(),
        },
    { merge: true },
  );
  return { ok: true, cleared: reply.length === 0 };
});
