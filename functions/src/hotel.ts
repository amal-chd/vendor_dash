import * as admin from "firebase-admin";
import { commitInChunks } from "./batchWrite";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

const GRACE_PERIOD_DAYS = 3;

/**
 * Daily cron: age merchant subscriptions — Kada Host (`hotels`) AND Kada Dine
 * (`restaurants`). Dine used to have no expiry job at all, so a lapsed
 * restaurant read "active" in admin and every status screen forever.
 *
 * The merchant doc is the entitlement store — written by the signature-verified
 * Razorpay webhook (`subscriptionBilling.ts`) and by admins. This job is the
 * only other writer, and it only ever moves a subscription *down*:
 *
 *   active, past its end date            →  grace_period (GRACE_PERIOD_DAYS)
 *   active + cancelAtPeriodEnd, past end →  cancelled (no grace: they asked to stop)
 *   grace_period, past grace             →  expired
 *
 * The grace step exists so a renewal payment still settling never locks a
 * merchant out over a timing gap. There is no trial state: nothing here can
 * grant access — only take it away once the paid term is genuinely over.
 * Commission billing resumes on its own once the subscription isn't active
 * (billingModel.effectiveCommissionRate).
 */
export const hotelSubscriptionExpiryCron = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "UTC",
  },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const graceEnd = admin.firestore.Timestamp.fromMillis(now.toMillis() + GRACE_PERIOD_DAYS * 86_400_000);

    for (const collection of ["hotels", "restaurants"]) {
      const results = { activeToGrace: 0, cancelled: 0, graceExpired: 0 };

      // 1. Active subscriptions past their end date. Chunked commits: a batch
      // takes at most 500 writes and this query has no limit — an oversized
      // batch would fail all-or-nothing and look like a quiet day.
      const expiredActive = await db
        .collection(collection)
        .where("subscriptionStatus", "==", "active")
        .where("subscriptionEndDate", "<=", now)
        .get();
      if (!expiredActive.empty) {
        await commitInChunks(expiredActive.docs, (batch, doc) => {
          if (doc.get("subscriptionCancelAtPeriodEnd") === true) {
            batch.update(doc.ref, { subscriptionStatus: "cancelled", subscriptionUpdatedAt: now });
            results.cancelled++;
          } else {
            batch.update(doc.ref, {
              subscriptionStatus: "grace_period",
              subscriptionGraceEndDate: graceEnd,
              subscriptionUpdatedAt: now,
            });
            results.activeToGrace++;
          }
        });
      }

      // 2. Grace periods that have themselves run out → expired.
      const expiredGrace = await db
        .collection(collection)
        .where("subscriptionStatus", "==", "grace_period")
        .where("subscriptionGraceEndDate", "<=", now)
        .get();
      if (!expiredGrace.empty) {
        results.graceExpired = await commitInChunks(expiredGrace.docs, (batch, doc) => {
          batch.update(doc.ref, { subscriptionStatus: "expired", subscriptionUpdatedAt: now });
        });
      }

      if (results.activeToGrace || results.cancelled || results.graceExpired) {
        logger.info(`Subscription expiry: ${collection}`, results);
      }
    }
  }
);

/**
 * Daily Cron: Aggregates daily room service orders and revenue per hotel.
 */
export const aggregateHotelDailyAnalytics = onSchedule(
  {
    schedule: "5 0 * * *",
    timeZone: "UTC",
  },
  async () => {
    const db = admin.firestore();

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(yesterday);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const dateKey = yesterday.toISOString().split("T")[0];

    const startTs = admin.firestore.Timestamp.fromDate(yesterday);
    const endTs = admin.firestore.Timestamp.fromDate(dayEnd);

    logger.info(`Aggregating hotel analytics for ${dateKey}`);

    const hotelsSnap = await db.collection("hotels").get();
    if (hotelsSnap.empty) return;

    for (const hotelDoc of hotelsSnap.docs) {
      try {
        const hotelId = hotelDoc.id;
        const ordersSnap = await db
          .collection("orders")
          .where("hotelId", "==", hotelId)
          .where("createdAt", ">=", startTs)
          .where("createdAt", "<=", endTs)
          .get();

        if (ordersSnap.empty) continue;

        let totalRevenue = 0;
        const totalOrders = ordersSnap.size;
        let completedOrders = 0;

        ordersSnap.docs.forEach((d) => {
          const data = d.data();
          const amount = Number(data.total ?? data.totalAmount ?? 0) || 0;
          totalRevenue += amount;
          if (data.status === "completed" || data.status === "delivered") {
            completedOrders++;
          }
        });

        await db
          .collection("hotels")
          .doc(hotelId)
          .collection("daily_analytics")
          .doc(dateKey)
          .set(
            {
              date: dateKey,
              totalOrders,
              completedOrders,
              totalRevenue,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      } catch (err) {
        logger.error("Error aggregating hotel daily analytics", { hotelId: hotelDoc.id, err });
      }
    }
  }
);
