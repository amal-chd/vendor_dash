/**
 * ─────────────────────────────────────────────────────────────────────────
 * Kada Mess — plans and subscriptions.
 *
 * A mess kitchen sells a monthly (or weekly) meal plan rather than single
 * orders: a customer subscribes, eats on the days the plan covers, and can
 * skip days they won't be there.
 *
 * Shape:
 *   mess_kitchens/{kitchenId}/plans/{planId}   — the kitchen's own menu of plans
 *   mess_subscriptions/{subscriptionId}        — one customer's subscription
 *
 * Money rules (user's decisions, 2026-09-15):
 *   • The customer pays Kada up front for the plan.
 *   • Kada's revenue is a per-customer-per-day fee taken from the kitchen's
 *     settlement (`feePerCustomerPerDayPaise` on the kitchen, admin-set) —
 *     never added on top of the customer's price here.
 *   • Delivery is the mess's own; no rider dispatch.
 *
 * The price ALWAYS comes from the stored plan, never from the client.
 * ─────────────────────────────────────────────────────────────────────────
 */
import * as admin from "firebase-admin";
import { uniqueReceipt } from "./gateway";
import { STRAY_OUTCOMES, refundStrayPayment, strayPaymentMessage } from "./paymentCapture";
import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import { enforceRateLimit } from "./rateLimit";
import { HOT_PATH } from "./options";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./refunds";
import { assertAdmin } from "./admin_operations";

const MAX_PLAN_DAYS = 31;
/**
 * Kada's cut when a kitchen has no `feePerCustomerPerDayPaise` set — the ₹3
 * per customer per day the founder settled on (2026-09-15). It used to fall
 * back to ZERO, so a kitchen onboarded before an admin opened its fee screen
 * earned Kada nothing, silently and forever. Admin can still set any value,
 * including 0.
 */
const DEFAULT_FEE_PER_CUSTOMER_PER_DAY_PAISE = 300;
const MIN_PLAN_PAISE = 10_000; // ₹100 — below this a "plan" is a mistake
const MAX_PLAN_PAISE = 5_000_000; // ₹50,000

type Meal = "breakfast" | "lunch" | "dinner";
const MEALS: Meal[] = ["breakfast", "lunch", "dinner"];

function str(v: unknown, max = 120): string {
  return (v ?? "").toString().trim().slice(0, max);
}

function keys() {
  return { keyId: RAZORPAY_KEY_ID.value(), keySecret: RAZORPAY_KEY_SECRET.value() };
}

/** Midnight-of-day key, e.g. "2026-09-24" — how skips are recorded. */
/**
 * India has no DST, so a fixed offset is exact.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The calendar day a meal belongs to, in IST.
 *
 * This used to read UTC date components. A mess day is a day in Kochi — the
 * kitchen cooks lunch on a date in IST — so between 00:00 and 05:30 IST the UTC
 * date is still yesterday, and a customer skipping "tomorrow" had it recorded
 * against the day before. The calendar showed one date and the stored key was
 * another, and generateMessSettlements then counted the wrong day: the kitchen
 * was paid for a day the customer actually skipped, or docked for one they ate.
 *
 * `sweepMessSubscriptions` already runs on Asia/Kolkata, so IST is the calendar
 * the rest of this module assumes.
 */
export function dayKey(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(
    ist.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Midnight tonight in IST, as a UTC instant — the edge of "from tomorrow". */
export function istMidnightTomorrow(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  ist.setUTCDate(ist.getUTCDate() + 1);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

interface PlanDoc {
  name?: string;
  pricePaise?: number;
  durationDays?: number;
  meals?: string[];
  vegOnly?: boolean;
  active?: boolean;
}

/**
 * The plan as the kitchen published it. Everything the customer is charged
 * and promised is read from here.
 */
async function loadPlan(kitchenId: string, planId: string) {
  const db = admin.firestore();
  const [kitchenSnap, planSnap] = await Promise.all([
    db.collection("mess_kitchens").doc(kitchenId).get(),
    db.collection("mess_kitchens").doc(kitchenId).collection("plans").doc(planId).get(),
  ]);
  if (!kitchenSnap.exists) throw new HttpsError("not-found", "This kitchen is no longer listed.");
  const kitchen = kitchenSnap.data() ?? {};
  if ((kitchen.onboarding?.state ?? "") !== "active") {
    throw new HttpsError("failed-precondition", "This kitchen isn't taking subscriptions yet.");
  }
  if (kitchen.isBlocked === true) {
    throw new HttpsError("failed-precondition", "This kitchen isn't taking subscriptions right now.");
  }
  if (!planSnap.exists) throw new HttpsError("not-found", "That plan is no longer available.");
  const plan = (planSnap.data() ?? {}) as PlanDoc;
  if (plan.active === false) {
    throw new HttpsError("failed-precondition", "That plan is no longer available.");
  }

  const pricePaise = Math.round(Number(plan.pricePaise ?? 0));
  const durationDays = Math.round(Number(plan.durationDays ?? 0));
  if (!Number.isFinite(pricePaise) || pricePaise < MIN_PLAN_PAISE || pricePaise > MAX_PLAN_PAISE) {
    throw new HttpsError("failed-precondition", "This plan's price isn't set correctly. Please tell the kitchen.");
  }
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > MAX_PLAN_DAYS) {
    throw new HttpsError("failed-precondition", "This plan's duration isn't set correctly.");
  }
  const meals = (Array.isArray(plan.meals) ? plan.meals : [])
    .map((m) => String(m).toLowerCase())
    .filter((m): m is Meal => (MEALS as string[]).includes(m));
  if (meals.length === 0) {
    throw new HttpsError("failed-precondition", "This plan has no meals set.");
  }

  return {
    kitchen,
    kitchenName: str(kitchen.name ?? kitchen.kitchenName, 120) || "Mess kitchen",
    plan: {
      id: planId,
      name: str(plan.name, 80) || "Meal plan",
      pricePaise,
      durationDays,
      meals,
      vegOnly: plan.vegOnly === true,
    },
  };
}

async function createGatewayOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
  const { keyId, keySecret } = keys();
  if (!keyId || !keySecret) {
    throw new HttpsError("failed-precondition", "Online payment isn't available right now.");
  }
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: uniqueReceipt(receipt), notes }),
  });
  if (!res.ok) {
    logger.error("Mess Razorpay order failed", { status: res.status, body: await res.text() });
    throw new HttpsError("unavailable", "Couldn't start the payment. Nothing was charged. Please try again.");
  }
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  return { ...order, keyId };
}

/**
 * Starts a subscription. Creates it as `pending_payment` and returns the
 * gateway order; nothing is active until the payment is verified, so an
 * abandoned checkout never feeds anyone for free.
 */
export const subscribeToMess = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to subscribe.");
    await enforceRateLimit(`mess_subscribe_${uid}`, 10, 10 * 60_000);

    const kitchenId = str(request.data?.kitchenId, 128);
    const planId = str(request.data?.planId, 128);
    const idempotencyKey = str(request.data?.idempotencyKey, 64) || `${kitchenId}_${planId}`;
    if (!kitchenId || !planId) {
      throw new HttpsError("invalid-argument", "Pick a kitchen and a plan.");
    }

    const startMs = Number(request.data?.startDate);
    const startAt = Number.isFinite(startMs) ? new Date(startMs) : new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (startAt.getTime() < todayStart.getTime()) {
      throw new HttpsError("invalid-argument", "Pick a start date from today onwards.");
    }

    const db = admin.firestore();
    const placementRef = db.collection("mess_placements").doc(`${uid}_${idempotencyKey}`);
    const existing = await placementRef.get();
    if (existing.exists) {
      const e = existing.data() ?? {};
      // Now that the key is stable per plan+start day, a repeat tap lands here.
      // If that subscription is already paid for, hand back "done" — never a
      // checkout, which would charge for the same plan twice.
      const priorSnap = e.subscriptionId
        ? await db.collection("mess_subscriptions").doc(String(e.subscriptionId)).get()
        : null;
      const prior = priorSnap?.data();
      if (prior && prior.paymentStatus === "paid") {
        return {
          ok: true,
          idempotent: true,
          alreadyActive: true,
          subscriptionId: e.subscriptionId,
          razorpayOrderId: null,
          keyId: null,
          amountPaise: Math.round(Number(prior.amountPaise ?? 0)),
        };
      }
      return {
        ok: true,
        idempotent: true,
        alreadyActive: false,
        subscriptionId: e.subscriptionId,
        razorpayOrderId: e.razorpayOrderId ?? null,
        keyId: keys().keyId,
        amountPaise: e.amountPaise,
      };
    }

    const { plan, kitchenName, kitchen } = await loadPlan(kitchenId, planId);

    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + plan.durationDays);

    const subRef = db.collection("mess_subscriptions").doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await subRef.set({
      customerUid: uid,
      customerName: str(request.auth?.token?.name, 80),
      kitchenId,
      kitchenName,
      // A snapshot: the kitchen may edit or retire the plan later, but this
      // subscriber keeps what they bought.
      plan: {
        id: plan.id,
        name: plan.name,
        pricePaise: plan.pricePaise,
        durationDays: plan.durationDays,
        meals: plan.meals,
        vegOnly: plan.vegOnly,
      },
      // Kada's cut, as configured for this kitchen at the time of sale.
      // An explicit 0 is honoured; only an unset fee falls back to the default.
      platformFeePerDayPaise: Number.isFinite(Number(kitchen.feePerCustomerPerDayPaise))
        ? Math.max(0, Math.round(Number(kitchen.feePerCustomerPerDayPaise)))
        : DEFAULT_FEE_PER_CUSTOMER_PER_DAY_PAISE,
      amountPaise: plan.pricePaise,
      startDate: admin.firestore.Timestamp.fromDate(startAt),
      endDate: admin.firestore.Timestamp.fromDate(endAt),
      status: "pending_payment",
      paymentStatus: "pending",
      skippedDays: [],
      createdAt: now,
      updatedAt: now,
    });

    const order = await createGatewayOrder(plan.pricePaise, subRef.id, {
      messSubscriptionId: subRef.id,
      uid,
      payment_context: "MESS_SUBSCRIPTION",
    });
    await Promise.all([
      subRef.update({ razorpayOrderId: order.id }),
      placementRef.set({
        subscriptionId: subRef.id,
        razorpayOrderId: order.id,
        amountPaise: plan.pricePaise,
        createdAt: now,
      }),
    ]);

    return {
      ok: true,
      subscriptionId: subRef.id,
      razorpayOrderId: order.id,
      keyId: order.keyId,
      amountPaise: order.amount,
      currency: order.currency,
    };
  },
);

/** Signature check, then the subscription goes live. Idempotent. */
export const verifyMessPayment = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
    const subscriptionId = str(request.data?.subscriptionId, 128);
    const razorpayOrderId = str(request.data?.razorpayOrderId, 128);
    const razorpayPaymentId = str(request.data?.razorpayPaymentId, 128);
    const signature = str(request.data?.razorpaySignature, 256);
    if (!subscriptionId || !razorpayOrderId || !razorpayPaymentId || !signature) {
      throw new HttpsError("invalid-argument", "Payment details are incomplete.");
    }

    const { keySecret } = keys();
    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new HttpsError("permission-denied", "Payment signature verification failed.");
    }

    // Only the subscriber may confirm, and only their own subscription.
    const owner = (await admin.firestore().collection("mess_subscriptions").doc(subscriptionId).get()).data();
    if (!owner) throw new HttpsError("not-found", "Subscription not found.");
    if (owner.customerUid !== uid) throw new HttpsError("permission-denied", "This isn't your subscription.");
    if (owner.razorpayOrderId !== razorpayOrderId) {
      throw new HttpsError("failed-precondition", "That payment belongs to another subscription.");
    }

    const outcome = await applyMessPayment({
      subscriptionId,
      razorpayOrderId,
      paymentId: razorpayPaymentId,
      amountPaise: Math.round(Number(owner.amountPaise) || 0),
      source: "app",
    });
    if (STRAY_OUTCOMES.has(outcome)) {
      throw new HttpsError(
        "failed-precondition",
        strayPaymentMessage(outcome, Math.round(Number(owner.amountPaise) || 0)),
        { reason: "refunded", outcome },
      );
    }
    return { ok: true, subscriptionId, status: "active" };
  },
);

/**
 * Apply a captured payment to a mess subscription, exactly once. Shared by
 * verifyMessPayment (app), the Razorpay webhook and the 5-minute payment
 * sweep, so a customer whose app closed right after paying still gets the plan
 * they paid for. An `abandoned` row (the hourly sweeper gave up on it) is
 * revived, since the customer did pay; a cancelled or already-paid one gets
 * the money back.
 */
export async function applyMessPayment(args: {
  subscriptionId: string;
  razorpayOrderId: string;
  paymentId: string;
  amountPaise: number;
  source: "app" | "webhook" | "sweep";
}): Promise<"paid" | "already_paid" | "duplicate" | "closed" | "underpaid" | "missing"> {
  const db = admin.firestore();
  const ref = db.collection("mess_subscriptions").doc(args.subscriptionId);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "missing" as const;
    const sub = snap.data() ?? {};
    if (sub.paymentStatus === "paid") {
      return String(sub.razorpayPaymentId ?? "") === args.paymentId ? ("already_paid" as const) : ("duplicate" as const);
    }
    if (sub.razorpayOrderId && sub.razorpayOrderId !== args.razorpayOrderId) return "missing" as const;
    if (sub.status === "cancelled") return "closed" as const;
    if (args.amountPaise < Math.round(Number(sub.amountPaise) || 0)) return "underpaid" as const;
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(ref, {
      status: "active",
      paymentStatus: "paid",
      razorpayPaymentId: args.paymentId,
      paidAmountPaise: args.amountPaise,
      paidVia: args.source,
      paidAt: now,
      updatedAt: now,
    });
    return "paid" as const;
  });
  if (STRAY_OUTCOMES.has(outcome)) {
    await refundStrayPayment({
      paymentId: args.paymentId,
      amountPaise: args.amountPaise,
      kind: "mess_subscription",
      relatedId: args.subscriptionId,
      outcome,
      source: args.source,
    });
  }
  return outcome;
}

/**
 * Skip a day (going home, travelling). Recorded against the subscription so
 * the kitchen's headcount for that day drops — and so Kada's per-day fee can
 * exclude it at settlement.
 *
 * Cut-off: a day can only be skipped up to the end of the previous day, or a
 * kitchen would already have cooked for them.
 */
export const skipMessDay = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  await enforceRateLimit(`mess_skip_${uid}`, 60, 10 * 60_000);

  const subscriptionId = str(request.data?.subscriptionId, 128);
  const dayMs = Number(request.data?.day);
  const skip = request.data?.skip !== false;
  if (!subscriptionId || !Number.isFinite(dayMs)) {
    throw new HttpsError("invalid-argument", "Pick a day to skip.");
  }
  const day = new Date(dayMs);
  // The cutoff is midnight in IST, not in the server's timezone (which is UTC).
  // Using the server's calendar put the boundary at 05:30 IST, so an early
  // riser could still cancel a lunch the kitchen had already started.
  const tomorrow = istMidnightTomorrow();
  if (day.getTime() < tomorrow.getTime()) {
    throw new HttpsError("failed-precondition", "Today's meals are already being cooked — you can skip from tomorrow.");
  }

  const db = admin.firestore();
  const ref = db.collection("mess_subscriptions").doc(subscriptionId);
  const key = dayKey(day);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Subscription not found.");
    const sub = snap.data() ?? {};
    if (sub.customerUid !== uid) throw new HttpsError("permission-denied", "This isn't your subscription.");
    if (sub.status !== "active") throw new HttpsError("failed-precondition", "This subscription isn't active.");
    const end = (sub.endDate as admin.firestore.Timestamp | undefined)?.toMillis() ?? 0;
    if (end && day.getTime() > end) {
      throw new HttpsError("invalid-argument", "That day is after your plan ends.");
    }
    tx.update(ref, {
      skippedDays: skip
        ? admin.firestore.FieldValue.arrayUnion(key)
        : admin.firestore.FieldValue.arrayRemove(key),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, day: key, skipped: skip };
});

/**
 * Cancels a subscription. No automatic refund: a part-eaten plan is settled
 * between the customer and the kitchen through support, so this records the
 * intent and stops future days counting.
 */
export const cancelMessSubscription = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  const subscriptionId = str(request.data?.subscriptionId, 128);
  const reason = str(request.data?.reason, 200) || "Cancelled by customer";
  if (!subscriptionId) throw new HttpsError("invalid-argument", "subscriptionId is required.");

  const db = admin.firestore();
  const ref = db.collection("mess_subscriptions").doc(subscriptionId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Subscription not found.");
    const sub = snap.data() ?? {};
    if (sub.customerUid !== uid) throw new HttpsError("permission-denied", "This isn't your subscription.");
    if (sub.status === "cancelled") return;
    tx.update(ref, {
      status: "cancelled",
      cancelReason: reason,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, status: "cancelled" };
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Settlement — what Kada owes each mess kitchen, and what it keeps.
 *
 * The customer pays Kada the whole plan up front, so a kitchen is paid out
 * per period for the days of its subscribers' plans that fell inside it.
 *
 *   earned  = plan price ÷ plan days × days of the plan inside the period
 *   fee     = feePerCustomerPerDayPaise × days actually SERVED (skips excluded)
 *   payout  = earned − fee
 *
 * A skipped day is still a day the customer bought and the kitchen held
 * capacity for, so it is earned; Kada simply does not charge its per-day fee
 * on a meal nobody ate. Both counts are written to the settlement so ops can
 * see exactly how a figure was reached.
 * ─────────────────────────────────────────────────────────────────────────
 */
/** One subscription's contribution to a settlement period. */
export interface MessSettlementLine {
  /** Days of the plan that fell inside the period. */
  coveredDays: number;
  /** Covered days the customer did not skip — what Kada charges its fee on. */
  servedDays: number;
  /** The kitchen's share, plan price pro-rated over the covered days. */
  earnedPaise: number;
  /** Kada's per-customer-per-day fee for the days served. */
  feePaise: number;
}

/**
 * The money for one subscription over one period. Pure, so the arithmetic that
 * decides what a kitchen is paid can be tested without Firestore.
 *
 * Returns null when the subscription doesn't overlap the period at all.
 */
export function messSettlementLine(
  sub: {
    startDate?: Date | null;
    endDate?: Date | null;
    plan?: { pricePaise?: number; durationDays?: number } | null;
    amountPaise?: number;
    platformFeePerDayPaise?: number;
    skippedDays?: unknown[];
  },
  periodStart: Date,
  periodEnd: Date,
): MessSettlementLine | null {
  const DAY_MS = 86_400_000;
  const start = sub.startDate;
  const end = sub.endDate;
  if (!start || !end) return null;

  const from = new Date(Math.max(start.getTime(), periodStart.getTime()));
  const to = new Date(Math.min(end.getTime(), periodEnd.getTime()));
  if (to.getTime() <= from.getTime()) return null;

  const coveredDays = Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  if (coveredDays === 0) return null;

  const planPaise = Math.round(Number(sub.plan?.pricePaise ?? sub.amountPaise ?? 0));
  const planDays = Math.max(1, Math.round(Number(sub.plan?.durationDays ?? 30)));
  const perDayPaise = Math.round(planPaise / planDays);

  const skips = new Set((Array.isArray(sub.skippedDays) ? sub.skippedDays : []).map((x) => String(x)));
  let skipped = 0;
  for (let i = 0; i < coveredDays; i++) {
    if (skips.has(dayKey(new Date(from.getTime() + i * DAY_MS)))) skipped++;
  }
  const servedDays = coveredDays - skipped;

  return {
    coveredDays,
    servedDays,
    earnedPaise: perDayPaise * coveredDays,
    feePaise: Math.round(Number(sub.platformFeePerDayPaise ?? 0)) * servedDays,
  };
}

export const generateMessSettlements = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();

  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);
  const periodStart = request.data?.startDate
    ? new Date(String(request.data.startDate))
    : defaultStart;
  const periodEnd = request.data?.endDate ? new Date(String(request.data.endDate)) : now;
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new HttpsError("invalid-argument", "startDate is not a date.");
  }
  if (periodEnd.getTime() <= periodStart.getTime()) {
    throw new HttpsError("invalid-argument", "endDate must be after startDate.");
  }

  // Every subscription that was actually paid for. Overlap with the period is
  // checked per subscription below — a cancelled plan still earns for the days
  // it ran before it was stopped.
  const subsSnap = await db
    .collection("mess_subscriptions")
    .where("paymentStatus", "==", "paid")
    .get();

  const byKitchen = new Map<
    string,
    {
      kitchenName: string;
      earnedPaise: number;
      feePaise: number;
      coveredDays: number;
      servedDays: number;
      subscriptionIds: string[];
      subscribers: Set<string>;
    }
  >();

  for (const doc of subsSnap.docs) {
    const s = doc.data();
    const kitchenId = String(s.kitchenId ?? "");
    if (!kitchenId) continue;

    const line = messSettlementLine(
      {
        startDate: (s.startDate as admin.firestore.Timestamp | undefined)?.toDate() ?? null,
        endDate: (s.endDate as admin.firestore.Timestamp | undefined)?.toDate() ?? null,
        plan: s.plan,
        amountPaise: s.amountPaise,
        platformFeePerDayPaise: s.platformFeePerDayPaise,
        skippedDays: s.skippedDays,
      },
      periodStart,
      periodEnd,
    );
    if (!line) continue;

    const agg = byKitchen.get(kitchenId) ?? {
      kitchenName: String(s.kitchenName ?? "Mess kitchen"),
      earnedPaise: 0,
      feePaise: 0,
      coveredDays: 0,
      servedDays: 0,
      subscriptionIds: [],
      subscribers: new Set<string>(),
    };
    agg.earnedPaise += line.earnedPaise;
    agg.feePaise += line.feePaise;
    agg.coveredDays += line.coveredDays;
    agg.servedDays += line.servedDays;
    agg.subscriptionIds.push(doc.id);
    if (s.customerUid) agg.subscribers.add(String(s.customerUid));
    byKitchen.set(kitchenId, agg);
  }

  const generated: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  for (const [kitchenId, agg] of byKitchen) {
    const netPayable = Math.max(0, agg.earnedPaise - agg.feePaise);
    // Deterministic id per kitchen + period: re-running the generator for the
    // same week corrects the figures instead of creating a second payable.
    const settlementId = `${kitchenId}_${dayKey(periodStart)}_${dayKey(periodEnd)}`;
    const ref = db.collection("mess_settlements").doc(settlementId);
    const prior = await ref.get();
    const priorStatus = String(prior.data()?.status ?? "");
    if (prior.exists && priorStatus !== "pending" && priorStatus !== "error") {
      // Already queued, sent or paid — never rewrite money that has moved.
      skipped.push({ settlementId, kitchenId, status: priorStatus });
      continue;
    }
    await ref.set({
      settlementId: ref.id,
      kitchenId,
      kitchenName: agg.kitchenName,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      grossPaise: agg.earnedPaise,
      platformFeePaise: agg.feePaise,
      netPayoutPaise: netPayable,
      // Rupee mirrors, the shape the payout engine and admin already read.
      grossSales: agg.earnedPaise / 100,
      commissionAmount: agg.feePaise / 100,
      netPayout: netPayable / 100,
      coveredDays: agg.coveredDays,
      servedDays: agg.servedDays,
      skippedDays: agg.coveredDays - agg.servedDays,
      subscriberCount: agg.subscribers.size,
      subscriptionIds: agg.subscriptionIds.slice(0, 500),
      status: "pending",
      generatedBy: request.auth?.token?.email ?? "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    generated.push({
      settlementId: ref.id,
      kitchenId,
      kitchenName: agg.kitchenName,
      netPayout: netPayable / 100,
      servedDays: agg.servedDays,
    });
  }

  logger.info("generateMessSettlements", {
    kitchens: generated.length,
    skipped: skipped.length,
    from: periodStart.toISOString(),
    to: periodEnd.toISOString(),
  });
  return { success: true, count: generated.length, settlements: generated, skipped };
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Subscription lifecycle. Nothing moved a mess subscription on by itself:
 *
 *   • an `active` plan stayed "active" forever once its end date passed, so
 *     "12 days left" counted down into the negatives and the kitchen's
 *     subscriber list kept showing people it no longer cooks for;
 *   • an abandoned checkout left a `pending_payment` row (and a Razorpay
 *     order) behind for good, inflating the "awaiting payment" count in admin.
 *
 * Runs hourly, writes only what it finds, and is bounded — a sweep that
 * touches nothing costs one query.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const sweepMessSubscriptions = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Asia/Kolkata" },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    let expired = 0;
    let abandoned = 0;

    // 1. Plans whose last day has passed.
    const ended = await db
      .collection("mess_subscriptions")
      .where("status", "==", "active")
      .where("endDate", "<=", now)
      .limit(400)
      .get();
    if (!ended.empty) {
      const batch = db.batch();
      ended.docs.forEach((d) => {
        batch.update(d.ref, {
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      expired = ended.size;
    }

    // 2. Checkouts nobody completed. An hour is far longer than a Razorpay
    //    session, and `verifyMessPayment` is idempotent, so a late verify on a
    //    swept row still flips it to paid rather than losing the customer's money.
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60_000);
    const stale = await db
      .collection("mess_subscriptions")
      .where("status", "==", "pending_payment")
      .where("createdAt", "<=", cutoff)
      .limit(400)
      .get();
    if (!stale.empty) {
      const batch = db.batch();
      stale.docs.forEach((d) => {
        batch.update(d.ref, {
          status: "abandoned",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      abandoned = stale.size;
    }

    if (expired || abandoned) {
      logger.info("sweepMessSubscriptions", { expired, abandoned });
    }
  },
);
