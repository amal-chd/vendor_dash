/**
 * Pricing reconciliation: does the money that moved match the prices the
 * engine set?
 *
 * For every order placed through the pricing engine in a window, compare its
 * price snapshot with what was recorded elsewhere:
 *   - the snapshot's split (restaurant + rider + Kada + GST + donation) adds up
 *     to the customer total,
 *   - the order's rupee total (what apps show) equals the snapshot,
 *   - the captured Razorpay payment equals the snapshot,
 *   - refunds never exceed what was paid,
 *   - an online order doesn't progress unpaid,
 *   - the rider was credited what the snapshot set aside.
 *
 * Each run is recorded in `pricing_recon_runs`; its findings in
 * `pricing_recon_issues/{orderId}__{code}` stamped with the run id, so the
 * admin view shows exactly what the latest run found. Server-only collections
 * (no client rules): the admin reads them through `pricingAdmin`.
 */
import * as admin from "firebase-admin";
import { withFinanceMany } from "./orderFinance";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

export const RECON_RUNS = "pricing_recon_runs";
export const RECON_ISSUES = "pricing_recon_issues";

export type ReconSeverity = "high" | "medium";

export interface ReconIssue {
  orderId: string;
  orderNumber: string | null;
  restaurantId: string | null;
  code: string;
  severity: ReconSeverity;
  message: string;
  expectedPaise: number | null;
  actualPaise: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;
const paise = (rupees: unknown) => Math.round((Number(rupees) || 0) * 100);
const IN_PROGRESS = ["confirmed", "accepted", "preparing", "ready", "ready_for_pickup", "picked_up", "out_for_delivery", "completed", "delivered"];

/** Findings for one pricing-engine order. Pure. */
export function checkEngineOrder(orderId: string, o: Doc, captured: { grossAmountPaise: number } | null): ReconIssue[] {
  const q = o.pricing;
  const t = q?.totals;
  const s = q?.settlement;
  if (typeof q?.engineVersion !== "string" || !t || !s) return [];
  const issues: ReconIssue[] = [];
  const add = (code: string, severity: ReconSeverity, message: string, expected: number | null, actual: number | null) =>
    issues.push({
      orderId,
      orderNumber: o.orderNumber ? String(o.orderNumber) : null,
      restaurantId: o.restaurantId ? String(o.restaurantId) : null,
      code,
      severity,
      message,
      expectedPaise: expected,
      actualPaise: actual,
    });

  const total = Number(t.totalPaise) || 0;
  const split =
    (Number(s.vendorPayoutPaise) || 0) +
    (Number(s.rider?.totalPaise) || 0) +
    (Number(s.platformRevenuePaise) || 0) +
    (Number(s.taxLiability?.platformEcoPaise) || 0) +
    (Number(s.taxLiability?.platformOwnPaise) || 0) +
    (Number(t.donationPaise) || 0);
  if (split !== total) {
    add("split_mismatch", "high", "The snapshot's split between restaurant, rider, Kada, GST and donation doesn't add up to the customer total.", total, split);
  }

  if (paise(o.total) !== total) {
    add("order_total_mismatch", "high", "The order's rupee total differs from its price snapshot, so apps show a different amount than was priced.", total, paise(o.total));
  }

  const method = String(o.paymentMethod ?? "").toLowerCase();
  const paid = String(o.paymentStatus ?? "").toLowerCase() === "paid";
  if (paid && method === "razorpay") {
    if (!captured) {
      add("payment_not_recorded", "medium", "Marked paid online, but no captured Razorpay payment is recorded for it.", total, null);
    } else if (captured.grossAmountPaise !== total) {
      add("payment_amount_mismatch", "high", "The captured payment doesn't equal the priced total.", total, captured.grossAmountPaise);
    }
  }

  const refunded = paise(o.refundAmount);
  if (refunded > total) add("over_refunded", "high", "More was refunded than the customer paid.", total, refunded);

  const status = String(o.status ?? "").toLowerCase();
  if (IN_PROGRESS.includes(status) && (method === "razorpay" || method === "wallet") && !paid) {
    add("unpaid_in_progress", "high", "An online order moved forward without a confirmed payment.", total, 0);
  }

  if ((status === "completed" || status === "delivered") && q.fulfilment === "delivery" && Number(o.riderEarning) > 0) {
    const expected = Number(s.rider?.totalPaise) || 0;
    const actual = paise(o.riderEarning);
    if (Math.abs(actual - expected) > 1) {
      add("rider_pay_mismatch", "medium", "The rider was credited a different amount than the price snapshot set aside.", expected, actual);
    }
  }
  return issues;
}

export async function runPricingReconciliation(days: number, trigger: string) {
  const db = admin.firestore();
  const window = Math.min(14, Math.max(1, Math.trunc(days) || 2));
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - window * 86_400_000);
  const snap = await db.collection("orders").where("timestamp", ">=", since).orderBy("timestamp", "desc").limit(3000).get();
  const orders = snap.docs.filter((d) => typeof d.data().pricing?.engineVersion === "string");

  const paymentIds = [...new Set(orders.map((d) => String(d.data().razorpayPaymentId ?? "")).filter(Boolean))];
  const captured = new Map<string, number>();
  for (let i = 0; i < paymentIds.length; i += 100) {
    const refs = paymentIds.slice(i, i + 100).map((id) => db.collection("transactions").doc(id));
    for (const t of await db.getAll(...refs)) {
      if (t.exists) captured.set(t.id, paise(t.data()?.gross_amount));
    }
  }

  const withSplit = await withFinanceMany(orders);
  const issues = orders.flatMap((d) => {
    const o = withSplit.get(d.id) ?? d.data();
    const pid = String(o.razorpayPaymentId ?? "");
    return checkEngineOrder(d.id, o, pid && captured.has(pid) ? { grossAmountPaise: captured.get(pid)! } : null);
  });
  const byCode: Record<string, number> = {};
  for (const i of issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  const high = issues.filter((i) => i.severity === "high").length;

  const runRef = db.collection(RECON_RUNS).doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const writes: ((b: FirebaseFirestore.WriteBatch) => void)[] = [
    (b) => b.set(runRef, { at: now, trigger, days: window, ordersChecked: orders.length, issues: issues.length, high, byCode }),
    ...issues.map((i) => (b: FirebaseFirestore.WriteBatch) =>
      b.set(db.collection(RECON_ISSUES).doc(`${i.orderId}__${i.code}`), { ...i, runId: runRef.id, lastSeenAt: now }, { merge: true })),
  ];
  if (high > 0) {
    writes.push((b) => b.set(db.collection("admin_notifications").doc(`pricing_recon_${runRef.id}`), {
      type: "pricing_reconciliation",
      title: `Pricing check found ${high} serious ${high === 1 ? "issue" : "issues"}`,
      message: Object.entries(byCode).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(", "),
      read: false,
      createdAt: now,
    }));
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
  return { runId: runRef.id, days: window, ordersChecked: orders.length, issues: issues.length, high, byCode };
}

const millis = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? null;

/** The latest runs and everything the most recent one found. */
export async function reconciliationReport() {
  const db = admin.firestore();
  const runs = await db.collection(RECON_RUNS).orderBy("at", "desc").limit(10).get();
  const latest = runs.docs[0];
  const found = latest ? await db.collection(RECON_ISSUES).where("runId", "==", latest.id).limit(500).get() : null;
  return {
    runs: runs.docs.map((d) => ({ id: d.id, ...d.data(), at: millis(d.data().at) })),
    issues: (found?.docs ?? []).map((d) => ({ id: d.id, ...d.data(), lastSeenAt: millis(d.data().lastSeenAt) })),
  };
}

/** Every morning at 03:00 IST, check the last two days of pricing-engine orders. */
export const reconcilePricingDaily = onSchedule(
  { schedule: "0 3 * * *", timeZone: "Asia/Kolkata", retryCount: 1 },
  async () => {
    const r = await runPricingReconciliation(2, "schedule");
    logger.info(`Pricing reconciliation: ${r.ordersChecked} orders, ${r.issues} issues (${r.high} high)`, r.byCode);
  },
);
