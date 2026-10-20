/**
 * Kada Stay booking + payment, server-authoritative.
 *
 * Before this, the customer app computed the total, opened Razorpay with a
 * client amount and no gateway order, then wrote the booking itself with
 * `paymentStatus: "paid_via_razorpay"` — or, for other methods, simply waited
 * two seconds and marked it paid. Nothing verified any payment.
 *
 *   quoteStayBooking   → server price (engine), stored 15 minutes
 *   createStayBooking  → re-price, create the booking + snapshot, create the
 *                        Razorpay order server-side (idempotent)
 *   verifyStayPayment  → signature + gateway order check, mark paid once
 *   (webhook)          → STAY_BOOKING branch confirms if the app never returns
 *   flagUnverifiedStayBooking → bookings an older app marked paid itself are
 *                        flagged for verification, not trusted
 */
import * as admin from "firebase-admin";
import {
  nightsBetween,
  readNights,
  claimNights,
  releaseNights,
  shouldReleaseNights,
  isClosedBookingStatus,
} from "../stayInventory";
import { assertModuleEnabled } from "../featureFlags";
import { uniqueReceipt } from "../gateway";
import { STRAY_OUTCOMES, refundStrayPayment, strayPaymentMessage } from "../paymentCapture";
import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { enforceRateLimit } from "../rateLimit";
import { HOT_PATH } from "../options";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "../refunds";
import { quoteStay, type StayQuote } from "./stay";
import { buildStayQuoteInput, type StayQuoteRequest } from "./stayLoader";
import { paiseToRupees } from "./money";

const QUOTE_TTL_MS = 15 * 60_000;
const str = (v: unknown, max = 200) => (v ?? "").toString().trim().slice(0, max);
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

function keys(): { keyId: string; keySecret: string } {
  try {
    return {
      keyId: RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "",
      keySecret: RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "",
    };
  } catch {
    return { keyId: process.env.RAZORPAY_KEY_ID || "", keySecret: process.env.RAZORPAY_KEY_SECRET || "" };
  }
}

function sanitizeStay(data: Record<string, unknown>): StayQuoteRequest {
  const d = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v, 10)) ? str(v, 10) : "");
  return {
    hotelId: str(data.hotelId, 128),
    roomId: str(data.roomId, 128),
    checkIn: d(data.checkIn),
    checkOut: d(data.checkOut),
    guests: Math.trunc(Number(data.guests) || 1),
    couponCode: str(data.couponCode, 40) || null,
  };
}

function stayCustomerView(q: StayQuote) {
  return {
    engineVersion: q.engineVersion,
    currency: q.currency,
    nights: q.nights.map((n) => ({ date: n.date, ratePaise: n.ratePaise, extraGuestPaise: n.extraGuestPaise })),
    nightCount: q.nightCount,
    couponProblem: q.couponProblem,
    promotions: q.promotions.map((p) => ({ code: p.code, label: p.label, amountPaise: p.totalPaise })),
    totals: q.totals,
    display: q.display,
    problems: q.problems,
  };
}

async function priceStay(uid: string, req: StayQuoteRequest) {
  if (!req.hotelId || !req.checkIn || !req.checkOut) {
    throw new HttpsError("invalid-argument", "Choose check-in and check-out dates.");
  }
  const built = await buildStayQuoteInput(uid, req);
  const quote = quoteStay(built.input, built.rules);
  quote.problems = [...new Set([...built.problems, ...quote.problems])];
  return { quote, context: built.context };
}

export const quoteStayBooking = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to see the price.");
  await enforceRateLimit(`quote_stay_${uid}`, 60, 10 * 60_000);
  const req = sanitizeStay((request.data ?? {}) as Record<string, unknown>);
  const { quote } = await priceStay(uid, req);
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const ref = admin.firestore().collection("pricing_quotes").doc();
  await ref.set({
    kind: "stay",
    uid,
    hotelId: req.hotelId,
    request: plain(req),
    quote: plain(quote),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
  });
  return { quoteId: ref.id, expiresAt, ...stayCustomerView(quote) };
});

async function createGatewayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  const { keyId, keySecret } = keys();
  if (!keyId || !keySecret) {
    throw new HttpsError("failed-precondition", "Online payment isn't configured right now. Choose pay at property.");
  }
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: uniqueReceipt(receipt), notes }),
  });
  if (!res.ok) {
    logger.error("Stay Razorpay order failed", { status: res.status, body: await res.text() });
    throw new HttpsError("unavailable", "Couldn't start the payment. Nothing was charged. Please try again.");
  }
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  return { ...order, keyId };
}

export const createStayBooking = onCall({ ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to book.");
  await assertModuleEnabled("kadaStay", "KadaStay bookings are paused right now.");
  await enforceRateLimit(`book_stay_${uid}`, 20, 10 * 60_000);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const quoteId = str(data.quoteId, 128);
  const idempotencyKey = str(data.idempotencyKey, 80);
  const paymentMethod = str(data.paymentMethod, 30) === "pay_at_property" ? "pay_at_property" : "razorpay";
  if (!quoteId || !idempotencyKey) throw new HttpsError("invalid-argument", "quoteId and idempotencyKey are required.");

  const db = admin.firestore();
  const placementRef = db.collection("stay_placements").doc(`${uid}_${idempotencyKey}`);
  const quoteRef = db.collection("pricing_quotes").doc(quoteId);
  const [placementSnap, quoteSnap] = await Promise.all([placementRef.get(), quoteRef.get()]);
  const done = placementSnap.data();
  if (done) {
    let razorpayOrderId: string | null = done.razorpayOrderId ?? null;
    if (done.paymentMethod === "razorpay" && !razorpayOrderId) {
      // The booking exists but its gateway order failed last time: retry only that.
      const bookingId = String(done.bookingId);
      const order = await createGatewayOrder(Number(done.amountPaise), bookingId, { stayBookingId: bookingId, uid, payment_context: "STAY_BOOKING" });
      razorpayOrderId = order.id;
      const binding = { razorpayOrderIds: admin.firestore.FieldValue.arrayUnion(order.id) };
      await Promise.all([
        db.collection("hotels").doc(String(done.hotelId)).collection("bookings").doc(bookingId).update(binding),
        db.collection("stay_bookings").doc(bookingId).update(binding),
        placementRef.update({ razorpayOrderId: order.id }),
      ]);
    }
    return {
      ok: true,
      idempotent: true,
      bookingId: done.bookingId,
      paymentMethod: done.paymentMethod ?? paymentMethod,
      razorpayOrderId,
      keyId: keys().keyId,
      amountPaise: done.amountPaise,
    };
  }
  const stored = quoteSnap.data();
  if (!stored || stored.uid !== uid || stored.kind !== "stay") throw new HttpsError("not-found", "This checkout has expired. Choose your dates again.");
  if (stored.usedByBookingId) throw new HttpsError("failed-precondition", "This checkout was already used for a booking.");
  if ((stored.expiresAt?.toMillis?.() ?? 0) < Date.now()) throw new HttpsError("failed-precondition", "This checkout has expired. Choose your dates again.");

  const req = stored.request as StayQuoteRequest;
  const { quote, context } = await priceStay(uid, { ...req, at: undefined });
  if (quote.problems.length) throw new HttpsError("failed-precondition", quote.problems.join(" "), { quote: stayCustomerView(quote) });
  const shown = Number(stored.quote?.totals?.totalPaise);
  if (quote.totals.totalPaise !== shown) {
    throw new HttpsError("failed-precondition",
      `The price changed from ₹${(shown / 100).toFixed(2)} to ₹${(quote.totals.totalPaise / 100).toFixed(2)}. Please review before booking.`,
      { quote: stayCustomerView(quote), reason: "price_changed" });
  }

  const bookingRef = db.collection("hotels").doc(req.hotelId).collection("bookings").doc();
  const mirrorRef = db.collection("stay_bookings").doc(bookingRef.id);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const dayTs = (d: string) => admin.firestore.Timestamp.fromMillis(Date.parse(`${d}T00:00:00Z`));
  const booking = {
    hotelId: req.hotelId,
    roomId: context.roomId,
    customerId: uid,
    customerName: str(data.guestName, 80) || "Guest",
    guestPhone: str(data.guestPhone, 20) || null,
    guestEmail: str(data.guestEmail, 120) || null,
    specialRequests: str(data.specialRequests, 500) || null,
    hotelName: context.hotelName,
    imageUrl: context.imageUrl,
    checkIn: dayTs(req.checkIn),
    checkOut: dayTs(req.checkOut),
    guests: req.guests,
    adults: req.guests,
    children: 0,
    source: "KadaStay App",
    roomNumber: context.roomNumber,
    // Legacy rupee field read by the customer and host apps.
    totalAmount: paiseToRupees(quote.totals.totalPaise),
    status: paymentMethod === "razorpay" ? "pending_payment" : "reserved",
    paymentStatus: paymentMethod === "razorpay" ? "pending" : "pay_at_property",
    paymentMethod,
    pricing: plain(quote),
    pricingQuoteId: quoteId,
    createdAt: now,
  };

  // Nights this booking occupies. Claiming them inside the transaction is what
  // stops the same room-night being sold twice: concurrent bookings contend on
  // these documents, so Firestore serialises them and the loser is rejected.
  const nights = nightsBetween(new Date(`${req.checkIn}T00:00:00Z`), new Date(`${req.checkOut}T00:00:00Z`));
  const roomRef = db.collection("hotels").doc(req.hotelId).collection("rooms").doc(context.roomId);

  await db.runTransaction(async (tx) => {
    // Every read first — Firestore forbids reading after writing in a txn.
    const [p, q, roomSnap, nightStates] = await Promise.all([
      tx.get(placementRef),
      tx.get(quoteRef),
      tx.get(roomRef),
      readNights(tx, db, req.hotelId, context.roomId, nights),
    ]);
    if (p.exists) return;
    if (q.data()?.usedByBookingId) throw new HttpsError("failed-precondition", "This checkout was already used for a booking.");

    // Availability was previously never checked here at all: a host could block
    // a date and still be given the booking.
    claimNights(tx, db, req.hotelId, context.roomId, nightStates, Number(roomSnap.data()?.inventory) || 1);

    tx.create(bookingRef, booking);
    tx.create(mirrorRef, booking);
    tx.update(quoteRef, { usedByBookingId: bookingRef.id, usedAt: now });
    tx.create(placementRef, { bookingId: bookingRef.id, hotelId: req.hotelId, paymentMethod, amountPaise: quote.totals.totalPaise, createdAt: now });
  });

  if (paymentMethod === "pay_at_property") {
    return { ok: true, bookingId: bookingRef.id, paymentMethod, razorpayOrderId: null, amountPaise: quote.totals.totalPaise };
  }
  const order = await createGatewayOrder(quote.totals.totalPaise, bookingRef.id, {
    stayBookingId: bookingRef.id,
    hotelId: req.hotelId,
    uid,
    payment_context: "STAY_BOOKING",
  });
  const binding = { razorpayOrderIds: admin.firestore.FieldValue.arrayUnion(order.id) };
  await Promise.all([bookingRef.update(binding), mirrorRef.update(binding), placementRef.update({ razorpayOrderId: order.id })]);
  return { ok: true, bookingId: bookingRef.id, paymentMethod, razorpayOrderId: order.id, keyId: order.keyId, amountPaise: order.amount, currency: order.currency };
});

const STAY_CLOSED = ["cancelled", "canceled", "rejected", "expired", "no_show"];

export type StayPaymentOutcome = "paid" | "already_paid" | "duplicate" | "closed" | "underpaid" | "missing";

/** Pure decision for a Stay payment, mirroring decideFoodPayment. */
export function decideStayPayment(
  b: Record<string, any> | null | undefined,
  payment: { paymentId: string; amountPaise: number },
): StayPaymentOutcome {
  if (!b) return "missing";
  if (b.paymentStatus === "paid") return String(b.razorpayPaymentId ?? "") === payment.paymentId ? "already_paid" : "duplicate";
  if (STAY_CLOSED.includes(String(b.status ?? "").toLowerCase())) return "closed";
  const due = Number(b.pricing?.totals?.totalPaise);
  if (!Number.isFinite(due) || payment.amountPaise < due) return "underpaid";
  return "paid";
}

/**
 * Marks a Stay booking paid once, on both copies. Used by the callable and the
 * webhook; a payment the booking can't use (paid twice, or the booking expired
 * while the guest was paying) is refunded automatically.
 */
export async function applyStayPayment(args: {
  bookingId: string;
  razorpayOrderId: string;
  paymentId: string;
  amountPaise: number;
  source: "app" | "webhook" | "sweep";
}): Promise<StayPaymentOutcome> {
  const db = admin.firestore();
  const mirrorRef = db.collection("stay_bookings").doc(args.bookingId);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(mirrorRef);
    const b = snap.exists ? snap.data() ?? {} : null;
    const decision = decideStayPayment(b, { paymentId: args.paymentId, amountPaise: args.amountPaise });
    if (decision === "paid" && b) {
      const patch = {
        paymentStatus: "paid",
        status: "confirmed",
        razorpayOrderId: args.razorpayOrderId,
        razorpayPaymentId: args.paymentId,
        paidAmountPaise: args.amountPaise,
        paidVia: args.source,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.update(mirrorRef, patch);
      tx.update(db.collection("hotels").doc(String(b.hotelId)).collection("bookings").doc(args.bookingId), patch);
    }
    return decision;
  });
  if (STRAY_OUTCOMES.has(outcome)) {
    await refundStrayPayment({
      paymentId: args.paymentId,
      amountPaise: args.amountPaise,
      kind: "stay_booking",
      relatedId: args.bookingId,
      outcome,
      source: args.source,
    });
  }
  return outcome;
}

/** Minutes a Stay booking may wait for its online payment before it's released. */
const UNPAID_STAY_TTL_MIN = 30;

/**
 * Close Stay bookings whose online payment never completed, so hosts don't see
 * ghost "pending payment" guests. Runs inside the existing 5-minute order
 * sweeper (no extra function — CPU quota). A payment that lands afterwards is
 * refunded automatically by applyStayPayment.
 */
export async function expireUnpaidStayBookings(
  // Asks the gateway whether the guest actually paid; true = now confirmed.
  reconcile?: (doc: FirebaseFirestore.QueryDocumentSnapshot) => Promise<boolean>,
): Promise<number> {
  const db = admin.firestore();
  const cutoff = Date.now() - UNPAID_STAY_TTL_MIN * 60_000;
  const snap = await db.collection("stay_bookings").where("status", "==", "pending_payment").limit(200).get();
  let expired = 0;
  for (const doc of snap.docs) {
    const created = doc.get("createdAt") as admin.firestore.Timestamp | undefined;
    if (!created || Date.now() - created.toMillis() < 3 * 60_000) continue;
    // Paid but never confirmed (app closed, webhook missing): confirm, don't expire.
    if (reconcile && (await reconcile(doc).catch(() => false))) continue;
    if (created.toMillis() > cutoff) continue;
    const closed = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(doc.ref)).data() ?? {};
      if (cur.status !== "pending_payment" || cur.paymentStatus === "paid") return false;

      // Give the room-nights back, or an abandoned checkout would hold them
      // until someone noticed the room looking fully booked.
      const roomId = String(cur.roomId ?? "");
      const ci = (cur.checkIn as admin.firestore.Timestamp | undefined)?.toDate?.();
      const co = (cur.checkOut as admin.firestore.Timestamp | undefined)?.toDate?.();
      const states =
        roomId && ci && co
          ? await readNights(tx, db, String(cur.hotelId), roomId, nightsBetween(ci, co))
          : [];

      const patch = {
        status: "cancelled",
        paymentStatus: "expired",
        cancelReason: "Payment wasn't completed, so the booking wasn't confirmed.",
        cancelledBy: "system",
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        // This path releases the nights itself, below. Claim the marker in the
        // same write so onStayBookingClosedReleaseNights — which fires on this
        // very status change — does not release them a second time.
        nightsReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      tx.update(doc.ref, patch);
      tx.set(db.collection("hotels").doc(String(cur.hotelId)).collection("bookings").doc(doc.id), patch, { merge: true });
      if (states.length) releaseNights(tx, db, String(cur.hotelId), roomId, states);
      return true;
    });
    if (closed) expired++;
  }
  if (expired) logger.info("expireUnpaidStayBookings", { expired });
  return expired;
}

export const verifyStayPayment = onCall({ ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to confirm payment.");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const bookingId = str(data.bookingId, 128);
  const razorpayOrderId = str(data.razorpayOrderId, 64);
  const razorpayPaymentId = str(data.razorpayPaymentId, 64);
  const signature = str(data.razorpaySignature, 256);
  if (!bookingId || !razorpayOrderId || !razorpayPaymentId || !signature) {
    throw new HttpsError("invalid-argument", "Missing payment verification fields.");
  }
  const { keyId, keySecret } = keys();
  if (!keySecret) throw new HttpsError("failed-precondition", "Online payment gateway secret is missing.");
  const expected = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new HttpsError("permission-denied", "Payment signature verification failed.");
  }

  const snap = await admin.firestore().collection("stay_bookings").doc(bookingId).get();
  const b = snap.data();
  if (!b) throw new HttpsError("not-found", "Booking not found.");
  if (b.customerId !== uid) throw new HttpsError("permission-denied", "Not your booking.");

  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
  }).catch(() => null);
  const gateway = res && res.ok ? ((await res.json()) as { amount?: number; notes?: Record<string, unknown> }) : null;
  if (!gateway) {
    throw new HttpsError("unavailable", "Couldn't confirm the payment with the gateway yet. If money was taken, the booking confirms automatically within a few minutes.");
  }
  if (String(gateway.notes?.stayBookingId ?? "") !== bookingId) {
    throw new HttpsError("permission-denied", "This payment belongs to a different booking.");
  }
  const amountPaise = Number(gateway.amount) || 0;
  const outcome = await applyStayPayment({ bookingId, razorpayOrderId, paymentId: razorpayPaymentId, amountPaise, source: "app" });
  if (outcome === "closed" || outcome === "underpaid" || outcome === "missing") {
    throw new HttpsError("failed-precondition", strayPaymentMessage(outcome, amountPaise), { reason: "refunded", outcome });
  }
  if (outcome === "duplicate") {
    return { ok: true, status: outcome, notice: strayPaymentMessage(outcome, amountPaise) };
  }
  return { ok: true, status: outcome };
});

/**
 * Older customer-app builds write the booking themselves and mark it
 * "paid_via_…" with no payment attached. Don't trust that: flag it for
 * verification and tell ops, so the host confirms payment before check-in.
 */
export const flagUnverifiedStayBooking = onDocumentCreated(
  { document: "hotels/{hotelId}/bookings/{bookingId}", maxInstances: 2 },
  async (event) => {
    const b = event.data?.data();
    if (!b || b.pricing) return; // server-created bookings carry a price snapshot
    // Hosts record walk-in / front-desk bookings (and cash they collected) on
    // their own property; only guest-written bookings claim an online payment.
    if (String(b.customerId ?? "") === event.params.hotelId) return;
    if (!/^paid/i.test(String(b.paymentStatus ?? ""))) return;
    if (b.razorpayPaymentId) return;
    await event.data!.ref.set({
      paymentVerified: false,
      paymentReviewRequired: true,
      paymentReviewReason: "Marked paid by the app with no verified gateway payment. Confirm payment before check-in.",
    }, { merge: true });
    await admin.firestore().collection("admin_notifications").doc(`stay_unverified_${event.params.bookingId}`).set({
      type: "stay_payment_unverified",
      title: "Stay booking marked paid without a verified payment",
      message: `Booking ${event.params.bookingId} at ${String(b.hotelName ?? event.params.hotelId)} for ₹${Number(b.totalAmount) || 0} has no linked payment.`,
      hotelId: event.params.hotelId,
      bookingId: event.params.bookingId,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  },
);

/**
 * Give the room-nights back when a booking closes.
 *
 * `claimNights` runs inside createStayBooking, so every booking holds its
 * nights from the moment it exists. But the ONLY path that ever released them
 * was the unpaid-checkout sweeper: a guest cancelling through
 * cancelStayBooking, a host declining, ops cancelling from the admin console —
 * none of them gave the inventory back. Those nights stayed counted as sold
 * for good, so each cancellation permanently removed that room from sale on
 * those dates and the property quietly looked more booked than it was.
 *
 * A trigger rather than a call in each cancel path, because the paths are not
 * all callables: the admin console and the host app write the status directly,
 * and a future one will too. Releasing on the transition is the only version
 * that cannot be forgotten.
 */
export const onStayBookingClosedReleaseNights = onDocumentUpdated(
  { document: "stay_bookings/{bookingId}", maxInstances: 5 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (
      !shouldReleaseNights({
        before: before.status,
        after: after.status,
        alreadyReleased: Boolean(after.nightsReleasedAt),
      })
    ) {
      return;
    }

    const bookingId = event.params.bookingId;
    const hotelId = String(after.hotelId ?? "");
    const roomId = String(after.roomId ?? "");
    const checkIn = (after.checkIn as admin.firestore.Timestamp | undefined)?.toDate?.();
    const checkOut = (after.checkOut as admin.firestore.Timestamp | undefined)?.toDate?.();
    if (!hotelId || !roomId || !checkIn || !checkOut) {
      logger.warn("onStayBookingClosedReleaseNights: booking has no room-nights to release", {
        bookingId,
        hotelId,
        roomId,
      });
      return;
    }

    const db = admin.firestore();
    const ref = db.collection("stay_bookings").doc(bookingId);
    try {
      const released = await db.runTransaction(async (tx) => {
        // Re-read inside the transaction: the marker is what makes this safe
        // against a retried trigger delivery, and against ops and the host
        // closing the same booking at the same moment. Releasing twice would
        // take a night from 2 → 1 → 0 and free another guest's room.
        const snap = await tx.get(ref);
        if (!snap.exists) return 0;
        const cur = snap.data() ?? {};
        if (cur.nightsReleasedAt) return 0;
        if (!isClosedBookingStatus(cur.status)) return 0;

        const nights = nightsBetween(checkIn, checkOut);
        const states = await readNights(tx, db, hotelId, roomId, nights);
        if (states.length) releaseNights(tx, db, hotelId, roomId, states);
        tx.set(
          ref,
          { nightsReleasedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
        return states.length;
      });
      if (released) {
        logger.info("onStayBookingClosedReleaseNights", {
          bookingId,
          hotelId,
          roomId,
          nights: released,
          status: after.status,
        });
      }
    } catch (e) {
      // Loud, because the failure direction is lost revenue: the room stays
      // marked sold and nothing else will try again.
      logger.error("onStayBookingClosedReleaseNights failed", { bookingId, e });
    }
  },
);
