/**
 * Guest-initiated Kada Stay cancellation, with the refund worked out server-side.
 *
 * Until now there was no stay cancellation at all: the app had a dead
 * client-side helper that flipped `stay_bookings.status` to "cancelled" with no
 * refund, no refund record and no policy applied, and nothing called it — so a
 * guest simply could not cancel.
 *
 * ── Where the policy lives ────────────────────────────────────────────────
 * Hosts pick "Flexible / Moderate / Strict" in the listing wizard, and those
 * labels were defined NOWHERE in money terms. The tiers below are the defaults;
 * the real numbers are read from `config/stay_policies` so they can be changed
 * from the admin panel without a deploy. Each tier is a ladder of thresholds:
 * the first one whose `hoursBefore` still fits is the one that applies.
 *
 * Kada's service fee is refunded in the same proportion as the room, so a 100%
 * tier is a genuinely full refund of everything the guest paid.
 *
 * After check-in has started, nothing is refundable — the room was held and the
 * night is gone.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

import { enforceRateLimit } from "./rateLimit";
import { executeRazorpayRefund, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./refunds";

export interface CancellationTier {
  /** Hours before check-in this threshold requires. */
  hoursBefore: number;
  /** Percent of what the guest paid that comes back, 0–100. */
  refundPercent: number;
}

export interface CancellationPolicy {
  tiers: Record<string, CancellationTier[]>;
  /** Used when a listing names a policy nobody has defined. */
  defaultPolicy: string;
}

/**
 * Defaults, used until `config/stay_policies` says otherwise. Ladders are
 * written longest-notice first; `refundQuote` sorts defensively anyway.
 */
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  defaultPolicy: "Moderate",
  tiers: {
    // Cancel a day ahead and you owe nothing.
    Flexible: [{ hoursBefore: 24, refundPercent: 100 }],
    // Five days ahead is free; inside that, half back until the last day.
    Moderate: [
      { hoursBefore: 120, refundPercent: 100 },
      { hoursBefore: 24, refundPercent: 50 },
    ],
    // A week ahead is free; half back until two days out.
    Strict: [
      { hoursBefore: 168, refundPercent: 100 },
      { hoursBefore: 48, refundPercent: 50 },
    ],
  },
};

function sanitizeTiers(raw: unknown): CancellationTier[] | null {
  if (!Array.isArray(raw)) return null;
  const tiers = raw
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const hoursBefore = Math.round(Number(o.hoursBefore));
      const refundPercent = Math.round(Number(o.refundPercent));
      if (!Number.isFinite(hoursBefore) || hoursBefore < 0) return null;
      if (!Number.isFinite(refundPercent) || refundPercent < 0 || refundPercent > 100) return null;
      return { hoursBefore, refundPercent };
    })
    .filter((t): t is CancellationTier => t !== null);
  return tiers.length ? tiers : null;
}

/** The live policy, falling back to the documented defaults field by field. */
export async function loadCancellationPolicy(
  db: admin.firestore.Firestore,
): Promise<CancellationPolicy> {
  try {
    const snap = await db.collection("config").doc("stay_policies").get();
    const data = (snap.data()?.cancellation ?? {}) as Record<string, unknown>;
    const configured = (data.tiers ?? {}) as Record<string, unknown>;
    const tiers: Record<string, CancellationTier[]> = { ...DEFAULT_CANCELLATION_POLICY.tiers };
    for (const [name, value] of Object.entries(configured)) {
      const clean = sanitizeTiers(value);
      if (clean) tiers[name] = clean;
    }
    const defaultPolicy =
      typeof data.defaultPolicy === "string" && tiers[data.defaultPolicy]
        ? data.defaultPolicy
        : DEFAULT_CANCELLATION_POLICY.defaultPolicy;
    return { tiers, defaultPolicy };
  } catch (err) {
    logger.warn("stay cancellation policy read failed; using defaults", {
      err: (err as Error)?.message,
    });
    return DEFAULT_CANCELLATION_POLICY;
  }
}

export interface RefundQuote {
  /** The policy actually applied (may differ from the one asked for). */
  policy: string;
  refundPercent: number;
  refundPaise: number;
  /** Whole hours between now and check-in; negative once it has started. */
  hoursToCheckIn: number;
  /** Plain-English reason, shown to the guest before they confirm. */
  reason: string;
}

/**
 * What a cancellation returns right now. Pure, so the money rules can be tested
 * without Firestore, and so the app can show the guest the same figure the
 * cancellation will actually use.
 */
export function refundQuote(args: {
  policyName: string | null | undefined;
  policy: CancellationPolicy;
  checkIn: Date;
  paidPaise: number;
  now?: Date;
}): RefundQuote {
  const now = args.now ?? new Date();
  const name =
    args.policyName && args.policy.tiers[args.policyName]
      ? args.policyName
      : args.policy.defaultPolicy;
  const ladder = [...(args.policy.tiers[name] ?? [])].sort(
    (a, b) => b.hoursBefore - a.hoursBefore,
  );
  const hoursToCheckIn = Math.floor(
    (args.checkIn.getTime() - now.getTime()) / 3_600_000,
  );
  const paid = Math.max(0, Math.round(args.paidPaise));

  if (hoursToCheckIn < 0) {
    return {
      policy: name,
      refundPercent: 0,
      refundPaise: 0,
      hoursToCheckIn,
      reason: "The stay has already started, so nothing is refundable.",
    };
  }

  const hit = ladder.find((t) => hoursToCheckIn >= t.hoursBefore);
  if (!hit) {
    const tightest = ladder.length ? ladder[ladder.length - 1].hoursBefore : 0;
    return {
      policy: name,
      refundPercent: 0,
      refundPaise: 0,
      hoursToCheckIn,
      reason: paid > 0
        ? `A ${name} booking is non-refundable inside ${tightest} hours of check-in.`
        : "Nothing was charged, so there is nothing to refund.",
    };
  }

  // Round the refund DOWN to the rupee: never refund more than was taken.
  const refundPaise = Math.floor((paid * hit.refundPercent) / 100);
  return {
    policy: name,
    refundPercent: hit.refundPercent,
    refundPaise,
    hoursToCheckIn,
    reason: hit.refundPercent >= 100
      ? `Cancelling more than ${hit.hoursBefore} hours before check-in, so you get everything back.`
      : `Cancelling more than ${hit.hoursBefore} hours before check-in: ${hit.refundPercent}% of what you paid comes back.`,
  };
}

const CANCELLABLE_STATUSES = new Set(["pending", "reserved", "confirmed", "pending_payment"]);

interface BookingFacts {
  hotelId: string;
  hotelName: string;
  checkIn: Date;
  paidPaise: number;
  paymentId: string;
  wasPaid: boolean;
  policyName: string | null;
  status: string;
}

function factsFrom(
  b: admin.firestore.DocumentData,
  hotel: admin.firestore.DocumentData | undefined,
): BookingFacts {
  const checkInTs = b.checkIn as admin.firestore.Timestamp | undefined;
  const paidPaise = Number(
    b.paidAmountPaise ?? b.pricing?.totals?.totalPaise ?? Math.round(Number(b.totalAmount ?? 0) * 100),
  );
  return {
    hotelId: String(b.hotelId ?? ""),
    hotelName: String(b.hotelName ?? hotel?.name ?? ""),
    checkIn: checkInTs?.toDate() ?? new Date(0),
    paidPaise: Number.isFinite(paidPaise) ? paidPaise : 0,
    paymentId: String(b.razorpayPaymentId ?? ""),
    wasPaid: String(b.paymentStatus ?? "") === "paid",
    policyName: (hotel?.cancellationPolicy ?? null) as string | null,
    status: String(b.status ?? ""),
  };
}

async function readBooking(
  db: admin.firestore.Firestore,
  bookingId: string,
  uid: string,
) {
  const ref = db.collection("stay_bookings").doc(bookingId);
  const snap = await ref.get();
  const b = snap.data();
  if (!b) throw new HttpsError("not-found", "We couldn't find that stay on your account.");
  if (String(b.customerId ?? "") !== uid) {
    throw new HttpsError("permission-denied", "That booking isn't yours.");
  }
  const hotelSnap = await db.collection("hotels").doc(String(b.hotelId ?? "")).get();
  return { ref, booking: b, facts: factsFrom(b, hotelSnap.data()) };
}

/**
 * What the guest would get back — asked before they commit to anything, so the
 * confirmation sheet can state the real number instead of a guess.
 */
export const quoteStayCancellation = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage your stay.");

  const bookingId = String((request.data as Record<string, unknown> | undefined)?.bookingId ?? "").trim();
  if (!bookingId) throw new HttpsError("invalid-argument", "Which booking?");

  const db = admin.firestore();
  const { facts } = await readBooking(db, bookingId, uid);
  const policy = await loadCancellationPolicy(db);
  const quote = refundQuote({
    policyName: facts.policyName,
    policy,
    checkIn: facts.checkIn,
    paidPaise: facts.wasPaid ? facts.paidPaise : 0,
  });

  return {
    ok: true,
    cancellable: CANCELLABLE_STATUSES.has(facts.status.toLowerCase()),
    status: facts.status,
    wasPaid: facts.wasPaid,
    paidPaise: facts.wasPaid ? facts.paidPaise : 0,
    ...quote,
  };
});

/**
 * Cancels the stay and refunds what the policy says, in that order: the booking
 * is released first so the room frees up even if the gateway is having a bad
 * day, and the refund is a `platform_refunds` record either way — so money owed
 * is always visible to ops, never silently dropped.
 */
export const cancelStayBooking = onCall(
  { secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to manage your stay.");
    await enforceRateLimit(`stay_cancel_${uid}`, 10, 60 * 60_000);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const bookingId = String(data.bookingId ?? "").trim();
    const reason = String(data.reason ?? "").trim().slice(0, 300);
    if (!bookingId) throw new HttpsError("invalid-argument", "Which booking?");

    const db = admin.firestore();
    const { ref, facts } = await readBooking(db, bookingId, uid);
    if (!CANCELLABLE_STATUSES.has(facts.status.toLowerCase())) {
      throw new HttpsError(
        "failed-precondition",
        facts.status.toLowerCase().startsWith("cancel")
          ? "This booking is already cancelled."
          : `A ${facts.status.replace(/_/g, " ")} booking can't be cancelled from the app — message the property.`,
      );
    }

    const policy = await loadCancellationPolicy(db);
    const quote = refundQuote({
      policyName: facts.policyName,
      policy,
      checkIn: facts.checkIn,
      paidPaise: facts.wasPaid ? facts.paidPaise : 0,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const refundId = `stay_${bookingId}`;
    const willRefund = quote.refundPaise > 0 && facts.paymentId !== "";

    const patch: Record<string, unknown> = {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: "customer",
      cancellationReason: reason || "Cancelled by the guest",
      cancellationPolicyApplied: quote.policy,
      cancellationRefundPercent: quote.refundPercent,
      cancellationRefundPaise: quote.refundPaise,
      refundStatus: willRefund
        ? "pending_execution"
        : quote.refundPaise > 0
          ? "manual_review"
          : "none",
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(ref, patch, { merge: true });
    if (facts.hotelId) {
      batch.set(
        db.collection("hotels").doc(facts.hotelId).collection("bookings").doc(bookingId),
        patch,
        { merge: true },
      );
    }
    if (quote.refundPaise > 0) {
      // Recorded whether or not it can be executed: a refund we can't push
      // through the gateway is money owed, and ops must see it.
      batch.set(
        db.collection("platform_refunds").doc(refundId),
        {
          refundId,
          kind: "stay",
          bookingId,
          // The refund executor writes back to orders/{orderId} when set; a stay
          // has no order, so it stays blank on purpose.
          orderId: "",
          hotelId: facts.hotelId,
          // The refunds queue lists food and stay refunds together; without a
          // name a stay row showed a blank "Restaurant" and linked into the
          // food orders search.
          hotelName: facts.hotelName,
          restaurantName: facts.hotelName,
          customerId: uid,
          amountPaise: quote.refundPaise,
          amount: quote.refundPaise / 100,
          razorpayPaymentId: facts.paymentId || null,
          method: facts.paymentId ? "original" : "manual",
          reason: `Stay cancelled by guest (${quote.policy}, ${quote.refundPercent}%)`,
          status: willRefund ? "pending_execution" : "manual_review",
          createdAt: now,
        },
        { merge: true },
      );
    }
    if (facts.hotelId) {
      // The host needs to know the room is free again.
      batch.set(db.collection("hotels").doc(facts.hotelId).collection("notifications").doc(), {
        type: "booking_cancelled",
        title: "Booking cancelled",
        message: `A guest cancelled their stay from ${facts.checkIn.toDateString()}.`,
        bookingId,
        read: false,
        createdAt: now,
      });
    }
    await batch.commit();

    let refund: { status: string; razorpayRefundId?: string; error?: string } | null = null;
    if (willRefund) {
      refund = await executeRazorpayRefund(refundId);
      await ref.set(
        {
          refundStatus: refund.status === "completed" ? "completed" : refund.status,
          refundedAt: refund.status === "completed" ? now : null,
        },
        { merge: true },
      );
    }

    logger.info("cancelStayBooking", {
      bookingId,
      policy: quote.policy,
      refundPercent: quote.refundPercent,
      refundPaise: quote.refundPaise,
      refundStatus: refund?.status ?? patch.refundStatus,
    });

    return {
      ok: true,
      ...quote,
      refundQueued: willRefund,
      refundStatus: refund?.status ?? String(patch.refundStatus),
    };
  },
);
