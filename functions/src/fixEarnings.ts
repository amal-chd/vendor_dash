import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";
import { assertAdmin } from "./admin_operations";
import { ensureRiderEarning } from "./delivery";
import { recomputeRiderEarnings, type RepairReport } from "./riderEarnings";

/**
 * Admin repair for rider earnings (see riderEarnings.ts for the bug).
 *
 *   { apply: false }  → preview: what each rider's counters would become
 *   { apply: true }   → credit delivered orders that were never paid (through
 *                       the same idempotent path as the live trigger), then
 *                       rebuild every rider's counters from their ledger and
 *                       delete the stray top-level "earnings.*" fields.
 *   { riderId }       → just that rider.
 *
 * This used to be an unauthenticated callable that anyone could invoke to
 * scan every completed order and write earnings. It is now admin-only, and
 * preview is the default.
 */
export const fixRiderEarnings = onCall({ timeoutSeconds: 540, maxInstances: 1 }, async (request) => {
  assertAdmin(request);
  const apply = request.data?.apply === true;
  const onlyRider = (request.data?.riderId ?? "").toString().trim();
  const db = admin.firestore();

  // 1. Delivered orders nobody was ever paid for.
  let missingCredited = 0;
  let missingFound = 0;
  const ordersQuery = onlyRider
    ? db.collection("orders").where("riderId", "==", onlyRider).where("deliveryStatus", "==", "delivered")
    : db.collection("orders").where("deliveryStatus", "==", "delivered");
  const orders = await ordersQuery.limit(3000).get();
  for (const doc of orders.docs) {
    const o = doc.data();
    if (!o.riderId || Number(o.riderEarning ?? 0) > 0) continue;
    missingFound++;
    if (apply) {
      await ensureRiderEarning(doc.id, o);
      missingCredited++;
    }
  }

  // 2. Rebuild counters from the ledger.
  const riderIds = onlyRider
    ? [onlyRider]
    : (await db.collection("delivery_users").where("lifetimeDeliveries", ">", 0).get()).docs.map((d) => d.id);
  const reports: RepairReport[] = [];
  for (const uid of riderIds) {
    reports.push(await recomputeRiderEarnings(uid, apply));
  }

  const summary = {
    apply,
    ridersChecked: reports.length,
    ridersWithStrayFields: reports.filter((r) => r.before.strayFields.length > 0).length,
    missingEarningsFound: missingFound,
    missingEarningsCredited: missingCredited,
  };
  await db.collection("admin_logs").add({
    type: "platform",
    action: "fixRiderEarnings",
    description: `fixRiderEarnings (${apply ? "apply" : "preview"})`,
    adminEmail: (request.auth?.token?.email as string) || "",
    payload: summary,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    ...summary,
    riders: reports.map((r) => ({
      riderId: r.riderId,
      applied: r.applied,
      beforeLifetimeShown: r.before.nestedLifetime,
      beforeLifetimeStray: r.before.strayLifetime,
      strayFields: r.before.strayFields,
      lifetime: r.after.lifetime,
      today: r.after.today,
      week: r.after.week,
      month: r.after.month,
      deliveriesToday: r.after.deliveriesToday,
    })),
  };
});

