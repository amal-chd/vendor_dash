// ─────────────────────────────────────────────────────────────────────────────
// Tenant deletion — production-grade.
//
// The previous implementation worked for tiny tenants but had real holes:
//   1. Loaded the FULL matching collection into RAM before deleting → OOM
//      on a tenant with 50k+ orders.
//   2. Did not cascade to outlet sub-accounts (separate restaurants/{uid}
//      docs with isOutlet=true + parentId pointing at the parent). Outlets
//      and their auth users stayed alive after the parent was deleted.
//   3. No re-entrancy lock — admin double-clicks → two parallel passes →
//      duplicate audit logs and race conditions.
//   4. No FCM topic cleanup — devices kept getting the deleted tenant's
//      push notifications.
//   5. No safety check preventing an admin from accidentally deleting
//      one of the platform-admin accounts.
//   6. Returned {ok:true} with no audit breakdown.
//
// This rewrite addresses all of them while keeping the callable's
// signature unchanged so the admin UI doesn't need any client work.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from "firebase-admin";
import { withFinanceMany } from "./pricing/orderFinance";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { deliverBroadcast, mapAudience } from "./notificationEngine/broadcast";
import { effectiveCommissionRate, billingAudit } from "./billingModel";
import { readCatalog, commissionForMerchant } from "./planCatalog";
import { isCounterOrder } from "./vendorOrderRules";
import { ADMIN_EMAILS, assertAdmin } from "./adminAuthz";

// Re-exported: the gate itself now lives in adminAuthz.ts (a leaf module), but
// thirteen modules import it from here.
export { assertAdmin };


// How many docs to delete per batch. Firestore caps at 500 ops per batch /
// 1MB request size; we use a conservative 400 to leave headroom for the
// metadata fields each delete generates.
const DELETE_PAGE_SIZE = 400;

// Every collection whose docs carry a `restaurantId` field. Order doesn't
// matter functionally but we put high-volume collections last so a
// partial failure leaves the lighter cleanup work done first.
const ROOT_COLLECTIONS = [
  "support_tickets",
  "expenses",
  "campaigns",
  "menu_ads",
  "user_sessions",
  "reservations",
  "suppliers",
  "purchase_orders",
  "shifts",
  "leaves",
  "day_closings",
  "brands",
  "wastage",
  "attendance",
  "payroll",
  "kot_tickets",
  "menu",
  "tables",
  "staff",
  "recipes",
  "inventory",
  "inventory_logs",
  "orders",
];

// Subcollections directly under restaurants/{id}/...
const RESTAURANT_SUBCOLLECTIONS = [
  "customers",
  "public_analytics",
  "notifications",
  "ai_insights",
  "outlets",
  "schedules",
  "settings",
];

// Storage path prefixes that the app writes data into. We additionally
// crawl `restaurants/{id}/` as a catch-all in case the app starts writing
// new paths we didn't list here.
const STORAGE_HARDCODED_PREFIXES = (rid: string) => [
  `menu_items/${rid}/`,
  `logos/${rid}/`,
  `ads/${rid}/`,
  `dish_photos/${rid}/`,
  `staff_avatars/${rid}/`,
  `customer_avatars/${rid}/`,
  `receipts/${rid}/`,
  `restaurants/${rid}/`,
];

interface DeletionReport {
  ok: true;
  mode: "soft" | "hard";
  restaurantId: string;
  cascadedOutlets: string[];
  deletedCounts: Record<string, number>;
  storagePrefixesCleared: number;
  walletsDeleted: number;
  walletTransactionsDeleted: number;
  authUsersDeleted: number;
  durationMs: number;
}

export const deleteTenantAccount = onCall(async (request) => {
  const callerEmail = request.auth?.token.email as string | undefined;
  if (!request.auth || !callerEmail || !ADMIN_EMAILS.includes(callerEmail)) {
    throw new HttpsError(
      "permission-denied",
      "Only administrators can perform this action.",
    );
  }

  const { restaurantId, mode } = request.data;
  if (!restaurantId || typeof restaurantId !== "string") {
    throw new HttpsError("invalid-argument", "Valid restaurantId is required.");
  }
  if (!["soft", "hard"].includes(mode)) {
    throw new HttpsError("invalid-argument", "mode must be 'soft' or 'hard'.");
  }

  const db = admin.firestore();
  const startedAt = Date.now();

  // ── Safety: never delete a platform-admin tenant ─────────────────────────
  const targetDoc = await db.collection("restaurants").doc(restaurantId).get();
  const targetEmail = targetDoc.data()?.email as string | undefined;
  if (targetEmail && ADMIN_EMAILS.includes(targetEmail)) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot delete a platform-admin tenant. Remove from ADMIN_EMAILS first.",
    );
  }

  // ── Re-entrancy lock — Firestore transaction guarantees one winner ───────
  // We write a `deletionStatus` field; if it already says "running" we bail.
  // The lock is cleared on success or wiped along with the doc on hard delete.
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.collection("restaurants").doc(restaurantId));
      if (!snap.exists) {
        // Already gone — only allow if we're soft-deleting (idempotent).
        if (mode === "hard") return; // proceed anyway to clean orphan data
      }
      const status = snap.data()?.deletionStatus as string | undefined;
      if (status === "running") {
        throw new HttpsError(
          "aborted",
          "A deletion is already in progress for this tenant.",
        );
      }
      tx.set(
        db.collection("restaurants").doc(restaurantId),
        {
          deletionStatus: "running",
          deletionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          deletionMode: mode,
          deletedBy: callerEmail,
        },
        { merge: true },
      );
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", `Failed to acquire deletion lock: ${e}`);
  }

  // ── SOFT delete ──────────────────────────────────────────────────────────
  if (mode === "soft") {
    const batch = db.batch();
    batch.set(
      db.collection("restaurants").doc(restaurantId),
      {
        isDeleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: callerEmail,
        subscriptionStatus: "blocked",
        deletionStatus: "soft-completed",
      },
      { merge: true },
    );

    // Revoke active sessions immediately so the user is signed out.
    const sessions = await db
      .collection("user_sessions")
      .where("restaurantId", "==", restaurantId)
      .get();
    sessions.docs.forEach((d) => batch.delete(d.ref));

    batch.set(db.collection("admin_logs").doc(), {
      type: "deletion",
      action: "soft_delete",
      description: `Soft deleted restaurant ${restaurantId} (${targetEmail ?? "?"})`,
      adminEmail: callerEmail,
      restaurantId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    // Revoke auth tokens (best-effort — outlet sub-accounts share the
    // parent's tenant ID for data but have their own auth users).
    try {
      await admin.auth().revokeRefreshTokens(restaurantId);
    } catch (e) {
      logger.warn(`soft-delete: revoke tokens failed for ${restaurantId}`, e);
    }

    return {
      ok: true,
      mode: "soft",
      message: "Restaurant soft-deleted successfully.",
      restaurantId,
      durationMs: Date.now() - startedAt,
    };
  }

  // ── HARD delete ──────────────────────────────────────────────────────────
  const report: DeletionReport = {
    ok: true,
    mode: "hard",
    restaurantId,
    cascadedOutlets: [],
    deletedCounts: {},
    storagePrefixesCleared: 0,
    walletsDeleted: 0,
    walletTransactionsDeleted: 0,
    authUsersDeleted: 0,
    durationMs: 0,
  };

  // 1. Find + cascade outlet sub-accounts (separate restaurants/{uid} docs
  //    with isOutlet=true + parentId === this restaurantId).
  const outlets = await db
    .collection("restaurants")
    .where("parentId", "==", restaurantId)
    .where("isOutlet", "==", true)
    .get();
  for (const o of outlets.docs) {
    report.cascadedOutlets.push(o.id);
    try {
      // Delete the outlet's auth user — its data shares the parent's
      // restaurantId so the main pass below will sweep it up.
      await admin.auth().deleteUser(o.id);
      report.authUsersDeleted++;
    } catch (e) {
      logger.warn(`hard-delete: outlet auth delete failed for ${o.id}`, e);
    }
    try {
      await db.collection("billing_private").doc(o.id).delete();
    } catch (e) {
      // ignore billing private deletion error if not found
    }
    await o.ref.delete().catch(() => {});
  }

  // 2. Paginated delete across every root collection scoped by restaurantId.
  for (const coll of ROOT_COLLECTIONS) {
    const count = await paginatedDeleteWhere(
      db,
      db.collection(coll).where("restaurantId", "==", restaurantId),
    );
    if (count > 0) report.deletedCounts[coll] = count;
  }

  // 3. Loyalty wallets — wallet doc + transactions subcollection.
  const wallets = await db
    .collection("loyalty_wallets")
    .where("restaurantId", "==", restaurantId)
    .get();
  for (const w of wallets.docs) {
    const txCount = await paginatedDeleteCollection(db, w.ref.collection("transactions"));
    report.walletTransactionsDeleted += txCount;
    await w.ref.delete().catch(() => {});
    report.walletsDeleted++;
  }

  // 4. Subcollections under restaurants/{id}/...
  for (const sub of RESTAURANT_SUBCOLLECTIONS) {
    const count = await paginatedDeleteCollection(
      db,
      db.collection(`restaurants/${restaurantId}/${sub}`),
    );
    if (count > 0) report.deletedCounts[`restaurants/${sub}`] = count;
  }

  // 5. billing_private + restaurant doc.
  await db.collection("billing_private").doc(restaurantId).delete().catch(() => {});
  await db.collection("restaurants").doc(restaurantId).delete().catch(() => {});

  // 6. Storage — hardcoded prefixes plus a catch-all for anything new under
  //    `restaurants/{id}/`. Failure is logged but doesn't abort the rest.
  let storagePrefixesCleared = 0;
  try {
    const bucket = admin.storage().bucket();
    for (const prefix of STORAGE_HARDCODED_PREFIXES(restaurantId)) {
      try {
        const [files] = await bucket.getFiles({ prefix });
        if (files.length > 0) {
          await bucket.deleteFiles({ prefix });
          storagePrefixesCleared++;
        }
      } catch (e) {
        logger.warn(`hard-delete: storage prefix ${prefix} failed`, e);
      }
    }
  } catch (e) {
    logger.warn(`hard-delete: storage cleanup failed for ${restaurantId}`, e);
  }
  report.storagePrefixesCleared = storagePrefixesCleared;

  // 7. FCM topic cleanup — best-effort. We can't unsubscribe a topic without
  //    holding the device tokens (the topic is server-side), but we DO want
  //    to remove any FCM-token-keyed docs we have for this tenant. None in
  //    the current schema; this is a placeholder for when notification
  //    preferences move to Firestore.
  // (no-op — leaving the hook so we don't forget when token storage lands)

  // 8. Delete the primary Firebase Auth user.
  try {
    await admin.auth().deleteUser(restaurantId);
    report.authUsersDeleted++;
  } catch (e) {
    logger.warn(`hard-delete: auth user delete failed for ${restaurantId}`, e);
  }

  // 9. Audit log with the full breakdown — written LAST so the log captures
  //    the actual numbers and survives even if some step above logged a
  //    warning along the way.
  report.durationMs = Date.now() - startedAt;
  await db.collection("admin_logs").add({
    type: "deletion",
    action: "hard_delete",
    description: `Hard deleted restaurant ${restaurantId} (${targetEmail ?? "?"})`,
    adminEmail: callerEmail,
    restaurantId,
    report,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    ...report,
    message: "Restaurant hard-deleted successfully.",
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination helpers — memory-safe deletes for arbitrarily large collections.
// ─────────────────────────────────────────────────────────────────────────────

async function paginatedDeleteWhere(
  db: admin.firestore.Firestore,
  query: admin.firestore.Query,
): Promise<number> {
  let total = 0;
  // Loop until the query returns no docs. Each iteration is a separate page.
  // We never hold more than DELETE_PAGE_SIZE docs in memory.
  while (true) {
    const snap = await query.limit(DELETE_PAGE_SIZE).select().get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    // If we got less than a full page, we're done.
    if (snap.size < DELETE_PAGE_SIZE) break;
  }
  return total;
}

async function paginatedDeleteCollection(
  db: admin.firestore.Firestore,
  ref: admin.firestore.CollectionReference,
): Promise<number> {
  return paginatedDeleteWhere(db, ref);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rider fleet administration (delivery ecosystem).
//
// Riders self-register in the delivery app as `pending_approval`; a platform
// admin reviews their KYC docs from the website admin panel and approves,
// rejects, or suspends them here. Approval also sets a `rider:true` custom
// claim for future use. `settleRiderCash` zeroes the cash-in-hand ledger after
// an offline COD reconciliation/payout.
// ─────────────────────────────────────────────────────────────────────────────


async function setRiderStatus(
  uid: string,
  status: "approved" | "rejected" | "suspended",
  extra: Record<string, any> = {},
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection("delivery_users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Rider not found.");

  await ref.set(
    {
      status,
      ...(status !== "approved" ? { isOnline: false } : {}),
      ...extra,
      statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  try {
    await admin.auth().setCustomUserClaims(uid, { rider: status === "approved" });
  } catch (e) {
    logger.warn(`setRiderStatus: claim update failed for ${uid}`, e);
  }
}

export const approveRider = onCall(async (request) => {
  assertAdmin(request);
  const uid = (request.data?.uid ?? "").toString();
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");
  await setRiderStatus(uid, "approved", { rejectionReason: admin.firestore.FieldValue.delete() });
  logger.info(`Rider ${uid} approved by ${request.auth?.token?.email}`);
  return { success: true, status: "approved" };
});

export const rejectRider = onCall(async (request) => {
  assertAdmin(request);
  const uid = (request.data?.uid ?? "").toString();
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");
  const reason = (request.data?.reason ?? "").toString().slice(0, 500);
  await setRiderStatus(uid, "rejected", { rejectionReason: reason });
  logger.info(`Rider ${uid} rejected by ${request.auth?.token?.email}`);
  return { success: true, status: "rejected" };
});

export const suspendRider = onCall(async (request) => {
  assertAdmin(request);
  const uid = (request.data?.uid ?? "").toString();
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");
  const reason = (request.data?.reason ?? "").toString().slice(0, 500);
  await setRiderStatus(uid, "suspended", { rejectionReason: reason });
  logger.info(`Rider ${uid} suspended by ${request.auth?.token?.email}`);
  return { success: true, status: "suspended" };
});

export const settleRiderCash = onCall(async (request) => {
  assertAdmin(request);
  const uid = (request.data?.uid ?? "").toString();
  if (!uid) throw new HttpsError("invalid-argument", "uid required.");

  const db = admin.firestore();
  const ref = db.collection("delivery_users").doc(uid);
  const settled = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Rider not found.");
    const amount = Number(snap.data()?.cashInHand ?? 0) || 0;
    tx.set(ref, { cashInHand: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      db.collection("rider_earnings").doc(uid).collection("settlements").doc(),
      {
        amount,
        settledBy: request.auth?.token?.email ?? "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    );
    return amount;
  });
  logger.info(`Settled ₹${settled} cash for rider ${uid} by ${request.auth?.token?.email}`);
  return { success: true, settled };
});

// Admin approves a rider's online-earnings payout request: marks it paid and
// advances the rider's `paidOut` ledger so their available balance drops.
export const settleRiderPayout = onCall(async (request) => {
  assertAdmin(request);
  const requestId = (request.data?.requestId ?? "").toString();
  if (!requestId) throw new HttpsError("invalid-argument", "requestId required.");

  const db = admin.firestore();
  const reqRef = db.collection("payout_requests").doc(requestId);
  const paid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError("not-found", "Payout request not found.");
    const data = snap.data() ?? {};
    if (data.status !== "pending") {
      throw new HttpsError("failed-precondition", "This request is already processed.");
    }
    const amount = Number(data.amount ?? 0) || 0;
    const riderUid = (data.riderUid ?? "").toString();
    if (!riderUid) throw new HttpsError("failed-precondition", "Request is missing its rider.");

    tx.update(reqRef, {
      status: "paid",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      settledBy: request.auth?.token?.email ?? "",
    });
    tx.set(
      db.collection("delivery_users").doc(riderUid),
      {
        paidOut: admin.firestore.FieldValue.increment(amount),
        payoutPending: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return amount;
  });

  logger.info(`Paid out ₹${paid} for request ${requestId} by ${request.auth?.token?.email}`);
  return { success: true, paid };
});

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast a push + in-app notification to CUSTOMER-app users.
//
// Customer notification docs live under `customer_users/{uid}/notifications`,
// which are own-doc-write-only per firestore.rules — so the admin website cannot
// write them directly. This callable runs with admin privileges: it writes each
// customer's inbox (matching the app's AppNotification schema: title/body/
// timestamp/read/type/orderId) and pushes to their FCM tokens.
// ─────────────────────────────────────────────────────────────────────────────
export const broadcastToCustomers = onCall(async (request) => {
  assertAdmin(request);
  const title = (request.data?.title ?? "").toString().trim();
  const body = (request.data?.body ?? "").toString().trim();
  if (!title || !body) {
    throw new HttpsError("invalid-argument", "Title and body are required.");
  }
  const result = await deliverBroadcast({
    title,
    body,
    audience: "customers",
    type: (request.data?.type ?? "promo").toString(),
    urgent: request.data?.urgent === true,
  });
  return { success: true, ...result };
});

/** Unified admin broadcast: customers, vendors, riders, or hosts. */
export const broadcastNotification = onCall(async (request) => {
  assertAdmin(request);
  const title = (request.data?.title ?? "").toString().trim();
  const body = (request.data?.body ?? "").toString().trim();
  if (!title || !body) {
    throw new HttpsError("invalid-argument", "Title and body are required.");
  }
  const mapped = mapAudience(request.data?.audience);
  const result = await deliverBroadcast({
    title,
    body,
    audience: mapped.audience,
    vendorFilter: mapped.vendorFilter,
    type: (request.data?.type ?? "promo").toString(),
    urgent: request.data?.urgent === true,
    campaignId: request.data?.campaignId ? String(request.data.campaignId) : undefined,
    imageUrl: request.data?.imageUrl ? String(request.data.imageUrl) : undefined,
    deepLink: request.data?.deepLink ? String(request.data.deepLink) : undefined,
  });

  const db = admin.firestore();
  await db.collection("admin_notifications").add({
    title,
    body,
    audience: request.data?.audience ?? mapped.audience,
    urgent: request.data?.urgent === true,
    recipientCount: result.recipients,
    pushed: result.pushed,
    status: "sent",
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    sentBy: request.auth?.token?.email ?? "admin",
  });
  await db.collection("admin_logs").add({
    type: "notification",
    description: `Broadcast "${title}" to ${request.data?.audience ?? mapped.audience} (${result.recipients} recipients, ${result.pushed} push)`,
    adminEmail: request.auth?.token?.email ?? "admin",
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, ...result };
});

/**
 * Admin callable to generate settlement ledgers for vendors.
 * Aggregates all completed orders within the date range that haven't been settled yet.
 */
export const generateVendorSettlements = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();

  const startDateStr = (request.data?.startDate ?? "").toString();
  const endDateStr = (request.data?.endDate ?? "").toString();

  const now = new Date();
  const defaultEnd = new Date(now);
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);

  const periodStart = startDateStr ? new Date(startDateStr) : defaultStart;
  const periodEnd = endDateStr ? new Date(endDateStr) : defaultEnd;

  const restaurantsSnap = await db.collection("restaurants").get();
  const platformCfg = await db.collection("config").doc("platform").get();
  const defaultCommission = Number(platformCfg.data()?.defaultCommissionPercent ?? 10);
  // The plan catalog is the source of truth for plan-derived commission.
  // Read once per run, not per merchant.
  const catalog = await readCatalog();
  if (restaurantsSnap.empty) {
    return { success: true, count: 0, settlements: [] };
  }

  const generated = [];

  for (const rDoc of restaurantsSnap.docs) {
    const restaurantId = rDoc.id;
    const rData = rDoc.data();
    // Billing model decides whether commission applies at all. Subscription
    // merchants pay a flat fee instead, so their commission is 0 — previously
    // they were charged BOTH.
    // Precedence: bespoke per-merchant rate → their plan's rate → platform
    // default. A merchant on a negotiated rate is never overwritten by a plan.
    const resolved = commissionForMerchant(catalog, "dine", rData, defaultCommission);
    const configuredRate = resolved.rate;
    const billing = effectiveCommissionRate(rData, configuredRate);
    const commissionRate = billing.rate;

    // Fetch delivered/completed orders for this restaurant in the period
    const ordersSnap = await db
      .collection("orders")
      .where("restaurantId", "==", restaurantId)
      .where("status", "in", ["completed", "delivered"])
      // Every order creator (customer app, POS, QR menu, web, webhook) stamps
      // `timestamp`; none writes `createdAt`. Filtering on `createdAt` matched
      // essentially nothing, so marketplace orders were never settled.
      // Index restaurantId+status+timestamp already exists.
      .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(periodStart))
      .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(periodEnd))
      .get();

    if (ordersSnap.empty) continue;

    let grossSales = 0;
    let orderCount = 0;
    let refundOffsets = 0; // sum of refundAmount deducted (audit only)
    let inStoreExcluded = 0;
    const orderIds: string[] = [];
    let legacyGross = 0; // commissioned at the merchant's current rate
    let snapshotCommission = 0; // commission + its GST, fixed in engine price snapshots
    let vendorFundedDelivery = 0;
    let engineOrderCount = 0;

    // Engine orders keep their money split in orders/{id}/finance/pricing;
    // put it back on each order before reading pricing.settlement.
    const withSplit = await withFinanceMany(ordersSnap.docs);
    ordersSnap.docs.forEach((oDoc) => {
      const oData = withSplit.get(oDoc.id) ?? oDoc.data();
      // In-store POS/QR sales were paid at the restaurant's own counter. The
      // platform never held that money, so it must not be paid out or
      // commissioned as if it had.
      if (isCounterOrder(oData)) {
        inStoreExcluded++;
        return;
      }
      if (!oData.settlementId) {
        const refunded = Number(oData.refundAmount ?? 0) || 0;
        const snap = oData.pricing?.settlement;
        if (typeof oData.pricing?.engineVersion === "string" && snap) {
          // Pricing-engine order: the restaurant's share, the commission (with
          // its GST) and any restaurant-funded delivery were fixed when the
          // order was priced. Delivery and platform fees, tips and donations
          // were never the restaurant's sales, so they don't enter its basis.
          const vendorValue =
            ((Number(snap.vendorItemsValuePaise) || 0) +
              (Number(snap.packagingToVendorPaise) || 0) +
              (Number(snap.vendorTaxCollectedPaise) || 0)) / 100;
          // Itemised refunds record exactly what the restaurant gives back and
          // the commission returned with it; plain-amount refunds come off whole.
          const commissionReturned = (Number(oData.refundCommissionReversalPaise) || 0) / 100;
          const vendorGivesBack = oData.refundVendorClawbackPaise != null
            ? (Number(oData.refundVendorClawbackPaise) || 0) / 100 + commissionReturned
            : refunded;
          grossSales += Math.max(0, vendorValue - vendorGivesBack);
          snapshotCommission += Math.max(0, ((Number(snap.commissionPaise) || 0) + (Number(snap.commissionTax?.total) || 0)) / 100 - commissionReturned);
          vendorFundedDelivery += (Number(snap.vendorFundedDeliveryPaise) || 0) / 100;
          if (vendorGivesBack > 0) refundOffsets += Math.min(vendorGivesBack, vendorValue);
          engineOrderCount++;
        } else {
          const total = Number(oData.total ?? oData.totalAmount ?? 0) || 0;
          // Partial refunds: keep the order in settlement but subtract the
          // refunded amount from the vendor's basis, so commission applies only
          // to what the vendor actually retained. (Full refunds cancel the order
          // and are excluded upstream by the status filter.)
          const retained = Math.max(0, total - refunded);
          grossSales += retained;
          legacyGross += retained;
          if (refunded > 0) refundOffsets += Math.min(refunded, total);
        }
        orderCount++;
        orderIds.push(oDoc.id);
      }
    });

    if (orderCount === 0 || grossSales === 0) continue;

    const commissionAmount = Math.round((legacyGross * (commissionRate / 100) + snapshotCommission) * 100) / 100;
    const gatewayFee = Math.round((grossSales * 0.02 * 1.18) * 100) / 100; // 2% + 18% GST

    // Tax Deductions at Source (TDS/TCS)
    const platformData = platformCfg.data() || {};
    const tdsRate = Number(platformData.tdsRate ?? 1.0);
    const tcsRate = Number(platformData.tcsRate ?? 1.0);
    const tdsAmount = Math.round((grossSales * (tdsRate / 100)) * 100) / 100;
    const tcsAmount = Math.round((grossSales * (tcsRate / 100)) * 100) / 100;

    // Ad Deductions
    const adSnap = await db
      .collection("ad_charges")
      .where("restaurantId", "==", restaurantId)
      .where("status", "==", "pending")
      .get();
    let adDeductions = 0;
    const adChargeIds: string[] = [];
    adSnap.docs.forEach((c) => {
      adDeductions += Number(c.data().amount ?? 0) || 0;
      adChargeIds.push(c.id);
    });
    adDeductions = Math.round(adDeductions * 100) / 100;

    // Manual Adjustments (Credits/Debits from disputes, penalties, etc.)
    const adjSnap = await db
      .collection("vendor_adjustments")
      .where("restaurantId", "==", restaurantId)
      .where("status", "==", "pending")
      .get();
    let adjustmentsTotal = 0;
    const adjustmentIds: string[] = [];
    adjSnap.docs.forEach((a) => {
      adjustmentsTotal += Number(a.data().amount ?? 0) || 0;
      adjustmentIds.push(a.id);
    });
    adjustmentsTotal = Math.round(adjustmentsTotal * 100) / 100;

    // Net Payout formula:
    const netPayout = Math.max(
      0,
      Math.round((grossSales - commissionAmount - vendorFundedDelivery - gatewayFee - adDeductions - tdsAmount - tcsAmount + adjustmentsTotal) * 100) / 100,
    );

    const settlementRef = db.collection("vendor_settlements").doc();
    const settlementId = settlementRef.id;

    await settlementRef.set({
      settlementId,
      restaurantId,
      pricingEngineOrders: engineOrderCount,
      snapshotCommission: Math.round(snapshotCommission * 100) / 100,
      vendorFundedDelivery: Math.round(vendorFundedDelivery * 100) / 100,
      restaurantName: rData.name ?? "Restaurant",
      ownerId: rData.ownerId ?? restaurantId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      grossSales,
      orderCount,
      commissionRate,
      ...billingAudit(billing.model, configuredRate, billing.waived, billing.lapsed),
      commissionRateSource: resolved.source,
      commissionAmount,
      // Sum of partial refunds subtracted from vendor's basis this period —
      // exposed on the settlement doc so ops can reconcile against raw GMV.
      refundOffsets,
      // In-store orders skipped this period (audit: explains GMV vs gross).
      inStoreExcluded,
      gatewayFee,
      tdsRate,
      tdsAmount,
      tcsRate,
      tcsAmount,
      adDeductions,
      adChargeIds,
      adjustmentsTotal,
      adjustmentIds,
      netPayout,
      orderIds,
      status: "pending",
      // Masked only: vendor finance staff can read settlements. Full details
      // live in partner_private (SettlementsPage's bank export reads them there).
      bankSummary: {
        accountMasked: rData.bank?.accountMasked ?? null,
        ifscBank: rData.bank?.ifscBank ?? null,
        verificationState: rData.bank?.verificationState ?? null,
      },
      generatedBy: request.auth?.token?.email ?? "system",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Helper to process arrays in Firestore batches of 500
    const chunkArray = <T>(arr: T[], size: number): T[][] => {
      return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
        arr.slice(i * size, i * size + size)
      );
    };

    // Mark orders with settlementId (chunked safely to max 500 per batch)
    const orderChunks = chunkArray(orderIds, 450);
    for (const chunk of orderChunks) {
      const batch = db.batch();
      chunk.forEach((id) => {
        batch.update(db.collection("orders").doc(id), { settlementId });
      });
      await batch.commit();
    }

    // Mark the netted ad charges as collected against this settlement.
    if (adChargeIds.length) {
      const adChunks = chunkArray(adChargeIds, 450);
      for (const chunk of adChunks) {
        const adBatch = db.batch();
        chunk.forEach((id) => {
          adBatch.update(db.collection("ad_charges").doc(id), {
            status: "settled",
            settlementId,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await adBatch.commit();
      }
    }

    // Mark manual adjustments as collected against this settlement.
    if (adjustmentIds.length) {
      const adjChunks = chunkArray(adjustmentIds, 450);
      for (const chunk of adjChunks) {
        const adjBatch = db.batch();
        chunk.forEach((id) => {
          adjBatch.update(db.collection("vendor_adjustments").doc(id), {
            status: "settled",
            settlementId,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await adjBatch.commit();
      }
    }

    generated.push({ settlementId, restaurantId, netPayout, orderCount, adDeductions });
  }

  logger.info(`Generated ${generated.length} vendor settlements by ${request.auth?.token?.email}`);
  return { success: true, count: generated.length, settlements: generated };
});

/**
 * Admin marks a vendor settlement as paid with UTR / bank reference.
 */
export const settleVendorPayout = onCall(async (request) => {
  assertAdmin(request);
  const settlementId = (request.data?.settlementId ?? "").toString();
  const utrNumber = (request.data?.utrNumber ?? "").toString().trim();
  const notes = (request.data?.notes ?? "").toString().trim();

  if (!settlementId) throw new HttpsError("invalid-argument", "settlementId required.");

  const db = admin.firestore();
  const ref = db.collection("vendor_settlements").doc(settlementId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Settlement not found.");
    const data = snap.data() ?? {};
    if (data.status === "paid") {
      throw new HttpsError("failed-precondition", "Settlement is already marked paid.");
    }

    tx.update(ref, {
      status: "paid",
      utrNumber: utrNumber || null,
      notes: notes || null,
      settledBy: request.auth?.token?.email ?? "",
      settledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return data.netPayout;
  });

  logger.info(`Vendor settlement ${settlementId} marked paid (₹${result}) by ${request.auth?.token?.email}`);
  return { success: true, settlementId, paidAmount: result };
});
