import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";
import { assertAdmin } from "./admin_operations";
import { WALKIN_SOURCES } from "./orderChannels";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Per-entity earnings breakdown: gross → deductions → net.
 *
 * Every figure is derived from the ledger that actually governs the payout,
 * never re-derived from a rate × volume shortcut:
 *   • Vendors — `vendor_settlements` (the doc that is actually paid out).
 *   • Riders  — `orders.riderEarning` (what completeDelivery / the earnings
 *               safety net actually credited), plus COD cash still held.
 *   • Platform— commission + delivery fees + ads actually recorded.
 *
 * In-store (walk-in POS + QR) revenue is excluded from platform delivery-fee
 * income, matching the GMV channel split — see orderChannels.ts.
 * ─────────────────────────────────────────────────────────────────────────
 */

const DAY_MS = 86_400_000;
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export const getEarningsBreakdown = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();
  const data = (request.data ?? {}) as { days?: unknown; restaurantId?: unknown; riderId?: unknown };
  const days = Math.min(365, Math.max(1, n(data.days) || 30));
  const start = admin.firestore.Timestamp.fromMillis(Date.now() - days * DAY_MS);
  const restaurantFilter = (data.restaurantId ?? "").toString();
  const riderFilter = (data.riderId ?? "").toString();

  // ── VENDORS — straight from the settlement ledger that gets paid ─────────
  type VendorRow = {
    restaurantId: string; restaurantName: string; grossSales: number;
    commission: number; gatewayFee: number; tax: number; adDeductions: number;
    adjustments: number; refundOffsets: number; net: number;
    settlements: number; paid: number; pending: number;
  };
  const vendors = new Map<string, VendorRow>();
  let platformCommission = 0;
  try {
    let q = db.collection("vendor_settlements").where("createdAt", ">=", start);
    if (restaurantFilter) q = q.where("restaurantId", "==", restaurantFilter);
    const snap = await q.get();
    for (const d of snap.docs) {
      const s = d.data();
      const id = (s.restaurantId ?? "").toString();
      if (!id) continue;
      const row = vendors.get(id) ?? {
        restaurantId: id,
        restaurantName: (s.restaurantName ?? "Restaurant").toString(),
        grossSales: 0, commission: 0, gatewayFee: 0, tax: 0, adDeductions: 0,
        adjustments: 0, refundOffsets: 0, net: 0, settlements: 0, paid: 0, pending: 0,
      };
      row.grossSales += n(s.grossSales);
      row.commission += n(s.commissionAmount);
      row.gatewayFee += n(s.gatewayFee);
      row.tax += n(s.tdsAmount) + n(s.tcsAmount);
      row.adDeductions += n(s.adDeductions);
      row.adjustments += n(s.adjustmentsTotal);
      row.refundOffsets += n(s.refundOffsets);
      row.net += n(s.netPayout);
      row.settlements += 1;
      if ((s.status ?? "") === "paid") row.paid += n(s.netPayout);
      else row.pending += n(s.netPayout);
      vendors.set(id, row);
      platformCommission += n(s.commissionAmount);
    }
  } catch (e) {
    console.error("earnings: vendor settlements failed", e);
  }

  // ── RIDERS — what was actually credited per delivered order ──────────────
  type RiderRow = {
    riderId: string; riderName: string; deliveries: number; earned: number;
    tips: number; codCollected: number;
  };
  const riders = new Map<string, RiderRow>();
  let deliveryFeeIncome = 0;
  try {
    const snap = await db
      .collection("orders")
      .where("deliveryStatus", "==", "delivered")
      .where("timestamp", ">=", start)
      .get();
    for (const d of snap.docs) {
      const o = d.data();
      // Delivery-fee income is marketplace-only; in-store never carries one.
      if (!WALKIN_SOURCES.includes((o.orderSource ?? "") as never)) {
        deliveryFeeIncome += n(o.deliveryFee);
      }
      const rid = (o.riderId ?? "").toString();
      if (!rid) continue;
      if (riderFilter && rid !== riderFilter) continue;
      const row = riders.get(rid) ?? {
        riderId: rid,
        riderName: (o.riderName ?? "Rider").toString(),
        deliveries: 0, earned: 0, tips: 0, codCollected: 0,
      };
      row.deliveries += 1;
      row.earned += n(o.riderEarning);
      row.tips += n(o.tip);
      if (n(o.codCollected) > 0 || o.codCollected === true) row.codCollected += n(o.total);
      riders.set(rid, row);
    }
  } catch (e) {
    console.error("earnings: rider orders failed", e);
  }

  // Outstanding COD cash still physically held by riders.
  let codOutstanding = 0;
  try {
    const cash = await db.collection("delivery_users").where("cashInHand", ">", 0).get();
    for (const d of cash.docs) codOutstanding += n(d.data().cashInHand);
  } catch (e) {
    console.error("earnings: cod outstanding failed", e);
  }

  // ── PLATFORM — ad revenue actually charged ───────────────────────────────
  let adRevenue = 0;
  try {
    const ads = await db.collection("ad_charges").where("createdAt", ">=", start).get();
    for (const d of ads.docs) adRevenue += n(d.data().amount);
  } catch (e) {
    console.error("earnings: ad revenue failed", e);
  }

  const riderPayout = [...riders.values()].reduce((s, x) => s + x.earned, 0);
  const vendorRows = [...vendors.values()].sort((a, b) => b.net - a.net);
  const riderRows = [...riders.values()].sort((a, b) => b.earned - a.earned);

  return {
    ok: true,
    rangeDays: days,
    generatedAt: Date.now(),
    vendors: vendorRows.map((v) => ({
      ...v,
      grossSales: r2(v.grossSales), commission: r2(v.commission),
      gatewayFee: r2(v.gatewayFee), tax: r2(v.tax), adDeductions: r2(v.adDeductions),
      adjustments: r2(v.adjustments), refundOffsets: r2(v.refundOffsets),
      net: r2(v.net), paid: r2(v.paid), pending: r2(v.pending),
    })),
    riders: riderRows.map((x) => ({
      ...x, earned: r2(x.earned), tips: r2(x.tips), codCollected: r2(x.codCollected),
    })),
    platform: {
      commission: r2(platformCommission),
      deliveryFees: r2(deliveryFeeIncome),
      ads: r2(adRevenue),
      gross: r2(platformCommission + deliveryFeeIncome + adRevenue),
      riderPayout: r2(riderPayout),
      net: r2(platformCommission + deliveryFeeIncome + adRevenue - riderPayout),
    },
    cod: { outstanding: r2(codOutstanding) },
  };
});
