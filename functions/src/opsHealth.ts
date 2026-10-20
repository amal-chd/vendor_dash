import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { checkCronHealth } from "./cronHealth";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Operational health: partner scores and platform anomalies.
 *
 * Two questions the console could not answer before:
 *
 *   "Which of my 400 vendors is quietly going bad?"
 *   "Is anything wrong right now that nobody has reported yet?"
 *
 * Both are computed SERVER-SIDE on a schedule rather than in the browser.
 * A health score means reading every order a partner has ever had; doing that
 * per admin per page-load would be thousands of reads a minute and a slow
 * console. The scheduled job reads once and writes a small summary document
 * that the admin panel reads for free.
 *
 * Scores are deliberately explainable — each carries the signals that produced
 * it. An unexplained number is one an operator cannot act on, and cannot
 * challenge when it is wrong.
 * ─────────────────────────────────────────────────────────────────────────
 */

const db = () => admin.firestore();

const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 86_400_000;

export interface HealthSignal {
  key: string;
  label: string;
  /** Points added (positive) or removed (negative) from the base score. */
  delta: number;
  detail: string;
}

export interface HealthScore {
  id: string;
  name: string;
  score: number;
  band: "healthy" | "watch" | "at_risk";
  signals: HealthSignal[];
  zoneId: string | null;
  updatedAt: unknown;
}

function band(score: number): HealthScore["band"] {
  if (score >= 75) return "healthy";
  if (score >= 50) return "watch";
  return "at_risk";
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof admin.firestore.Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? 0 : parsed;
}

// ── Vendor health ───────────────────────────────────────────────────────────

/**
 * Score a vendor out of 100 from the last 30 days of behaviour.
 *
 * Starts at 100 and subtracts for things that cost the platform a customer:
 * rejecting orders, cancelling after accepting, being closed at meal times,
 * and poor ratings. A vendor with no orders is not penalised — a new joiner
 * is not an unhealthy one, and scoring them badly would bury genuinely
 * failing partners under a pile of false positives.
 */
export function scoreVendor(
  vendor: FirebaseFirestore.DocumentData & { id: string },
  orders: FirebaseFirestore.DocumentData[],
): HealthScore {
  const signals: HealthSignal[] = [];
  let score = 100;

  const total = orders.length;
  const cancelled = orders.filter((o) =>
    ["cancelled", "rejected"].includes((o.status ?? "").toString().toLowerCase()),
  ).length;
  const cancelRate = pct(cancelled, total);

  if (total >= 5 && cancelRate > 5) {
    const penalty = Math.min(35, Math.round((cancelRate - 5) * 1.5));
    score -= penalty;
    signals.push({
      key: "cancel_rate",
      label: "Cancellations",
      delta: -penalty,
      detail: `${cancelRate.toFixed(1)}% of ${total} orders cancelled or rejected`,
    });
  }

  const rating = Number(vendor.rating) || 0;
  const ratingCount = Number(vendor.ratingCount) || 0;
  if (ratingCount >= 5 && rating > 0 && rating < 4) {
    const penalty = Math.min(25, Math.round((4 - rating) * 20));
    score -= penalty;
    signals.push({
      key: "rating",
      label: "Customer rating",
      delta: -penalty,
      detail: `${rating.toFixed(1)}★ across ${ratingCount} ratings`,
    });
  }

  // A shop nobody can order from is worth flagging before the vendor churns.
  if (vendor.isOpen === false) {
    score -= 10;
    signals.push({
      key: "closed",
      label: "Currently closed",
      delta: -10,
      detail: "Shop is marked closed, so it is hidden from customers",
    });
  }

  // Unzoned vendors are invisible to customers no matter how good they are —
  // an operational failure on our side, surfaced on their card.
  if (!vendor.zoneId) {
    score -= 20;
    signals.push({
      key: "no_zone",
      label: "Outside every zone",
      delta: -20,
      detail: "No service zone covers this vendor, so customers cannot see it",
    });
  }

  if (total === 0) {
    signals.push({
      key: "no_orders",
      label: "No orders in 30 days",
      delta: 0,
      detail: "Not scored on volume — new and dormant vendors look alike here",
    });
  }

  return {
    id: vendor.id,
    name: (vendor.name ?? "Unnamed").toString(),
    score: Math.max(0, Math.min(100, score)),
    band: band(Math.max(0, Math.min(100, score))),
    signals,
    zoneId: (vendor.zoneId ?? null) as string | null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Score a delivery partner out of 100.
 *
 * Rejecting offers and holding platform cash are the two behaviours that
 * actually hurt: the first stalls dispatch, the second is money at risk.
 */
export function scoreRider(
  rider: FirebaseFirestore.DocumentData & { id: string },
  deliveries: FirebaseFirestore.DocumentData[],
): HealthScore {
  const signals: HealthSignal[] = [];
  let score = 100;

  const total = deliveries.length;
  const failed = deliveries.filter((d) =>
    ["cancelled", "reassigned", "failed"].includes(
      (d.deliveryStatus ?? d.status ?? "").toString().toLowerCase(),
    ),
  ).length;
  const failRate = pct(failed, total);

  if (total >= 5 && failRate > 5) {
    const penalty = Math.min(35, Math.round((failRate - 5) * 1.5));
    score -= penalty;
    signals.push({
      key: "drop_rate",
      label: "Dropped deliveries",
      delta: -penalty,
      detail: `${failRate.toFixed(1)}% of ${total} deliveries cancelled or reassigned`,
    });
  }

  const rating = Number(rider.rating) || 0;
  if (rating > 0 && rating < 4) {
    const penalty = Math.min(20, Math.round((4 - rating) * 15));
    score -= penalty;
    signals.push({
      key: "rating",
      label: "Customer rating",
      delta: -penalty,
      detail: `${rating.toFixed(1)}★`,
    });
  }

  // Cash in hand is platform money sitting in someone's pocket. The longer it
  // sits, the more it is a collections problem rather than a float.
  const cash = Number(rider.cashInHand) || 0;
  if (cash > 3000) {
    const penalty = Math.min(25, Math.round((cash - 3000) / 400));
    score -= penalty;
    signals.push({
      key: "cash_in_hand",
      label: "Undeposited cash",
      delta: -penalty,
      detail: `₹${cash.toLocaleString("en-IN")} collected but not yet deposited`,
    });
  }

  if (!rider.zoneId) {
    score -= 10;
    signals.push({
      key: "no_zone",
      label: "No home zone",
      delta: -10,
      detail: "No service zone covers this partner's base location",
    });
  }

  return {
    id: rider.id,
    name: (rider.name ?? "Unnamed").toString(),
    score: Math.max(0, Math.min(100, score)),
    band: band(Math.max(0, Math.min(100, score))),
    signals,
    zoneId: (rider.zoneId ?? null) as string | null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ── Anomaly detection ───────────────────────────────────────────────────────

export interface Anomaly {
  key: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  /** Where in the console to go and do something about it. */
  href: string;
  count: number;
}

/**
 * Things that are wrong right now and that nobody has reported yet.
 *
 * Every check is a real failure mode this platform has had, not a generic
 * metric: money stuck mid-flight, orders nobody picked up, vendors invisible
 * because no zone covers them, riders holding cash.
 */
export async function detectAnomalies(): Promise<Anomaly[]> {
  const out: Anomaly[] = [];
  const now = Date.now();
  const cutoff = admin.firestore.Timestamp.fromMillis(now - 45 * 60_000);

  const [stuck, unzonedVendors, failedWebhooks, heavyCash, pendingPayouts] =
    await Promise.all([
      // Orders not yet ready well past a normal kitchen time. "confirmed" is
      // what an accepted order is stored as ("accepted" is the legacy alias);
      // without it an accepted order that never progressed was never flagged.
      // Needs the (status, timestamp) index — a silent catch here hid the
      // missing index, so this alert never fired.
      db()
        .collection("orders")
        .where("status", "in", ["new", "confirmed", "accepted", "preparing"])
        .where("timestamp", "<=", cutoff)
        .limit(200)
        .get()
        .catch((e) => {
          logger.error("detectAnomalies: stuck-orders query failed", e);
          return null;
        }),
      db().collection("restaurants").where("zoneId", "==", null).limit(200).get().catch(() => null),
      db()
        .collection("razorpay_webhook_events")
        .where("processing_status", "in", ["failed", "amount_mismatch"])
        .limit(100)
        .get()
        .catch(() => null),
      db().collection("delivery_users").where("cashInHand", ">", 5000).limit(100).get().catch(() => null),
      db()
        .collection("payout_requests")
        .where("status", "==", "pending")
        .limit(200)
        .get()
        .catch(() => null),
    ]);

  if (stuck && !stuck.empty) {
    out.push({
      key: "stuck_orders",
      severity: "critical",
      title: "Orders stalled in the kitchen",
      detail: `${stuck.size} order${stuck.size === 1 ? " has" : "s have"} sat unfinished for over 45 minutes.`,
      href: "/admin/orders?tab=live",
      count: stuck.size,
    });
  }

  if (unzonedVendors && !unzonedVendors.empty) {
    out.push({
      key: "unzoned_vendors",
      severity: "warning",
      title: "Vendors outside every zone",
      detail: `${unzonedVendors.size} vendor${unzonedVendors.size === 1 ? " is" : "s are"} invisible to customers because no service zone covers them.`,
      href: "/admin/markets",
      count: unzonedVendors.size,
    });
  }

  if (failedWebhooks && !failedWebhooks.empty) {
    out.push({
      key: "failed_webhooks",
      severity: "critical",
      title: "Payment events failed to process",
      detail: `${failedWebhooks.size} Razorpay webhook${failedWebhooks.size === 1 ? "" : "s"} failed or mismatched on amount. Money may be captured without the order being marked paid.`,
      href: "/admin/settings?tab=webhooks",
      count: failedWebhooks.size,
    });
  }

  if (heavyCash && !heavyCash.empty) {
    out.push({
      key: "rider_cash",
      severity: "warning",
      title: "Riders holding large cash balances",
      detail: `${heavyCash.size} delivery partner${heavyCash.size === 1 ? " is" : "s are"} carrying over ₹5,000 of undeposited COD.`,
      href: "/admin/delivery",
      count: heavyCash.size,
    });
  }

  if (pendingPayouts && pendingPayouts.size >= 10) {
    out.push({
      key: "pending_payouts",
      severity: "warning",
      title: "Payout queue building up",
      detail: `${pendingPayouts.size} payout requests are waiting to be settled.`,
      href: "/admin/finance?tab=payouts",
      count: pendingPayouts.size,
    });
  }

  return out;
}

// ── Scheduled recompute ─────────────────────────────────────────────────────

async function recompute(): Promise<{ vendors: number; riders: number; anomalies: number }> {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - WINDOW_MS);

  const [vendorSnap, riderSnap, orderSnap] = await Promise.all([
    db().collection("restaurants").get(),
    db().collection("delivery_users").get(),
    db().collection("orders").where("timestamp", ">=", since).get(),
  ]);

  // Bucket once instead of filtering the whole order list per partner —
  // otherwise this is O(vendors × orders) and times out on real volume.
  const byVendor = new Map<string, FirebaseFirestore.DocumentData[]>();
  const byRider = new Map<string, FirebaseFirestore.DocumentData[]>();
  for (const doc of orderSnap.docs) {
    const o = doc.data();
    const vid = (o.restaurantId ?? "").toString();
    if (vid) {
      const list = byVendor.get(vid) ?? [];
      list.push(o);
      byVendor.set(vid, list);
    }
    const rid = (o.riderId ?? "").toString();
    if (rid) {
      const list = byRider.get(rid) ?? [];
      list.push(o);
      byRider.set(rid, list);
    }
  }

  const writeScores = async (
    collection: string,
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
    bucket: Map<string, FirebaseFirestore.DocumentData[]>,
    score: (
      e: FirebaseFirestore.DocumentData & { id: string },
      o: FirebaseFirestore.DocumentData[],
    ) => HealthScore,
  ) => {
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db().batch();
      for (const doc of docs.slice(i, i + 400)) {
        const result = score({ ...doc.data(), id: doc.id }, bucket.get(doc.id) ?? []);
        batch.set(db().collection(collection).doc(doc.id), result, { merge: true });
      }
      await batch.commit();
    }
  };

  await writeScores("vendor_health", vendorSnap.docs, byVendor, scoreVendor);
  await writeScores("rider_health", riderSnap.docs, byRider, scoreRider);

  // Fold in the cron watchdog. A scheduled job that throws on every run looks
  // identical to one with nothing to do, which is how a set of missing indexes
  // silently stopped scheduled orders, notification retries and the stuck-order
  // alert itself for days. Surfacing it here means it lands in the Ops Alerts
  // panel admins already watch.
  const anomalies = [...(await detectAnomalies()), ...(await checkCronHealth())];
  await db()
    .collection("ops_health")
    .doc("anomalies")
    .set(
      {
        items: anomalies,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return { vendors: vendorSnap.size, riders: riderSnap.size, anomalies: anomalies.length };
}

/** Every 30 minutes — often enough to catch a bad night, cheap enough to run. */
export const recomputeOpsHealth = onSchedule(
  { schedule: "*/30 * * * *", timeZone: "UTC", timeoutSeconds: 540 },
  async () => {
    const summary = await recompute();
    logger.info("Ops health recomputed", summary);
  },
);

/** Force a recompute from the console, so an admin never waits for the cron. */
export const refreshOpsHealth = onCall({ maxInstances: 1, timeoutSeconds: 540 }, async (request) => {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const isAdmin =
    token.platformAdmin === true ||
    ["thekada@gmail.com", "thekadaapp@gmail.com"].includes((token.email as string) || "");
  if (!isAdmin) throw new HttpsError("permission-denied", "Admins only.");
  const summary = await recompute();
  return { ok: true, ...summary };
});
