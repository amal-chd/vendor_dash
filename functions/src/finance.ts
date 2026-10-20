import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { assertAdmin } from "./admin_operations";
import { WALKIN_SOURCES } from "./orderChannels";

/**
 * getFinanceSummary — the ecosystem P&L behind the admin Finance Command Center.
 *
 * Aggregates the whole money picture server-side (no 500-doc client cap):
 *  • Revenue  — commission, delivery fees, stay service fees, ad boosts
 *  • Payouts  — vendor settlements, rider payouts (paid + pending)
 *  • Leakage  — refunds, promo/coupon discounts
 *  • Liability — outstanding wallet balance, unredeemed gift cards, Gold members
 *
 * Range-scoped sums use getAggregateFromServer (cheap, indexed on a single
 * field). Lower-volume ledgers (settlements, payouts, ad_charges, refunds) are
 * read within the range and summed in JS so we can split by status without
 * needing composite indexes. Money is returned in rupees.
 */
const DAY_MS = 86_400_000;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const getFinanceSummary = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();

  const days = Math.min(365, Math.max(1, num((request.data as { days?: unknown })?.days) || 30));
  const start = admin.firestore.Timestamp.fromMillis(Date.now() - days * DAY_MS);

  // ── Orders: GMV, discounts, delivery fees (single-field timestamp range) ──
  let gmv = 0;
  let discountGiven = 0;
  let deliveryFees = 0;
  let orderCount = 0;
  try {
    const agg = await db
      .collection("orders")
      .where("timestamp", ">=", start)
      .aggregate({
        gmv: admin.firestore.AggregateField.sum("total"),
        discount: admin.firestore.AggregateField.sum("discount"),
        delivery: admin.firestore.AggregateField.sum("deliveryFee"),
        count: admin.firestore.AggregateField.count(),
      })
      .get();
    const d = agg.data();
    gmv = num(d.gmv);
    discountGiven = num(d.discount);
    deliveryFees = num(d.delivery);
    orderCount = num(d.count);
  } catch (e) {
    // Aggregation unavailable (e.g. missing index) — leave zeros rather than fail.
    console.error("finance: orders aggregate failed", e);
  }

  // ── Channel split: in-store (walk-in POS + QR) vs online marketplace ──────
  // Headline GMV/order-count must reflect ONLY the online marketplace. Walk-in
  // and QR sales are the restaurant's own in-store revenue flowing through the
  // POS; counting them as GMV overstates the marketplace and skews take-rate.
  // We aggregate the in-store slice and subtract, so orders with no
  // `orderSource` (legacy) correctly remain on the online side.
  let walkInGmv = 0;
  let walkInCount = 0;
  try {
    const wAgg = await db
      .collection("orders")
      .where("timestamp", ">=", start)
      .where("orderSource", "in", [...WALKIN_SOURCES])
      .aggregate({
        gmv: admin.firestore.AggregateField.sum("total"),
        count: admin.firestore.AggregateField.count(),
      })
      .get();
    walkInGmv = num(wAgg.data().gmv);
    walkInCount = num(wAgg.data().count);
  } catch (e) {
    console.error("finance: walk-in aggregate failed", e);
  }
  const onlineGmv = Math.max(0, gmv - walkInGmv);
  const onlineOrderCount = Math.max(0, orderCount - walkInCount);

  // ── Vendor settlements: commission revenue + vendor payouts, by status ──
  let commissionRevenue = 0;
  let gatewayFees = 0;
  let vendorPaid = 0;
  let vendorPending = 0;
  const settleSnap = await db
    .collection("vendor_settlements")
    .where("createdAt", ">=", start)
    .get();
  for (const doc of settleSnap.docs) {
    const s = doc.data();
    commissionRevenue += num(s.commissionAmount);
    gatewayFees += num(s.gatewayFee);
    const net = num(s.netPayout);
    if ((s.status ?? "") === "paid") vendorPaid += net;
    else vendorPending += net;
  }

  // ── Host (KadaStay) settlements: stay commission revenue + host payouts ──
  let stayCommission = 0;
  let hostPaid = 0;
  let hostPending = 0;
  try {
    const hostSnap = await db.collection("host_settlements").where("createdAt", ">=", start).get();
    for (const doc of hostSnap.docs) {
      const s = doc.data();
      stayCommission += num(s.commissionAmount);
      const net = num(s.netPayout);
      if ((s.status ?? "") === "paid") hostPaid += net;
      else hostPending += net;
    }
  } catch (e) {
    console.error("finance: host_settlements read failed", e);
  }

  // ── Rider payouts (payout_requests), by status ──
  let riderPaid = 0;
  let riderPending = 0;
  const payoutSnap = await db
    .collection("payout_requests")
    .where("createdAt", ">=", start)
    .get();
  for (const doc of payoutSnap.docs) {
    const p = doc.data();
    const amt = num(p.amount ?? p.netAmount ?? p.payoutAmount);
    if ((p.status ?? "") === "paid") riderPaid += amt;
    else riderPending += amt;
  }

  // ── Ad-boost revenue (ad_charges), by collection status ──
  let adRevenue = 0;
  let adPending = 0;
  try {
    const adSnap = await db.collection("ad_charges").where("createdAt", ">=", start).get();
    for (const doc of adSnap.docs) {
      const a = doc.data();
      const amt = num(a.amount);
      adRevenue += amt;
      if ((a.status ?? "") === "pending") adPending += amt;
    }
  } catch (e) {
    console.error("finance: ad_charges read failed", e);
  }

  // ── Refunds (leakage) ──
  let refunds = 0;
  let refundCount = 0;
  try {
    const refSnap = await db.collection("refunds").where("createdAt", ">=", start).get();
    for (const doc of refSnap.docs) {
      refunds += num(doc.data().refundAmount ?? doc.data().amount);
      refundCount += 1;
    }
  } catch (e) {
    // Some deployments timestamp refunds differently — don't fail the panel.
    console.error("finance: refunds read failed", e);
  }

  // ── Liabilities (point-in-time, not range-scoped) ──
  let walletLiability = 0;
  let goldMembers = 0;
  try {
    const wAgg = await db
      .collection("customer_users")
      .aggregate({
        wallet: admin.firestore.AggregateField.sum("walletBalance"),
        count: admin.firestore.AggregateField.count(),
      })
      .get();
    walletLiability = num(wAgg.data().wallet);
  } catch (e) {
    console.error("finance: wallet aggregate failed", e);
  }
  try {
    const goldAgg = await db
      .collection("customer_users")
      .where("isGold", "==", true)
      .count()
      .get();
    goldMembers = num(goldAgg.data().count);
  } catch (e) {
    console.error("finance: gold count failed", e);
  }

  let giftCardLiability = 0;
  let giftCardCount = 0;
  try {
    const gcAgg = await db
      .collection("gift_cards")
      .aggregate({
        balance: admin.firestore.AggregateField.sum("balance"),
        count: admin.firestore.AggregateField.count(),
      })
      .get();
    giftCardLiability = num(gcAgg.data().balance);
    giftCardCount = num(gcAgg.data().count);
  } catch (e) {
    console.error("finance: gift card aggregate failed", e);
  }

  // ── Roll-up ──
  const grossRevenue = commissionRevenue + deliveryFees + adRevenue + stayCommission;
  const netEarnings = grossRevenue - refunds - riderPaid - riderPending;

  return {
    ok: true,
    rangeDays: days,
    generatedAt: Date.now(),
    // `orders` now reports the ONLINE marketplace only — this is the number
    // that drives GMV headlines. In-store is reported separately below.
    orders: {
      gmv: onlineGmv,
      orderCount: onlineOrderCount,
      discountGiven,
      deliveryFees,
    },
    inStore: { gmv: walkInGmv, orderCount: walkInCount },
    allChannels: { gmv, orderCount },
    revenue: {
      commission: commissionRevenue,
      deliveryFees,
      ads: adRevenue,
      stayCommission,
      gatewayFees,
      gross: grossRevenue,
    },
    payouts: {
      vendorPaid,
      vendorPending,
      riderPaid,
      riderPending,
      hostPaid,
      hostPending,
    },
    leakage: { refunds, refundCount, discounts: discountGiven },
    liabilities: {
      wallet: walletLiability,
      giftCards: giftCardLiability,
      giftCardCount,
      goldMembers,
    },
    pending: { adCharges: adPending },
    netEarnings,
  };
});
