import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { assertAdmin } from "./admin_operations";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Gateway reconciliation — closing the loop between money COLLECTED and money
 * actually DEPOSITED into the bank.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Razorpay collects customer payments, deducts its fees + GST, batches them,
 * and settles the net to the merchant bank account (each settlement carries a
 * bank UTR). Until now nothing ingested those settlements, so the books could
 * never be closed. This module:
 *
 *   • syncGatewaySettlements  — pulls /v1/settlements into `gateway_settlements`
 *     (idempotent per settlement id), + the daily combined recon report into
 *     `settlement_recon` so every payment/refund is traced to the settlement
 *     (and UTR) that carried it to the bank. Runs on a schedule and on demand.
 *   • getReconciliationReport — server-side money-movement summary for a period:
 *     collected vs settled vs fees vs refunds, plus unsettled float.
 *
 * Uses the same gateway key as payments.ts (no RazorpayX account number needed).
 */

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RECON_SECRETS = [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET];

const RZP_BASE = "https://api.razorpay.com/v1";

function readKeys(): { keyId: string; keySecret: string } {
  const read = (s: { value(): string }, env: string): string => {
    try {
      return s.value() || process.env[env] || "";
    } catch {
      return process.env[env] || "";
    }
  };
  return {
    keyId: read(RAZORPAY_KEY_ID, "RAZORPAY_KEY_ID"),
    keySecret: read(RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET"),
  };
}

async function rzpGet(keyId: string, keySecret: string, path: string): Promise<any> {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`${RZP_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.description || text || `HTTP ${res.status}`;
    logger.error(`Razorpay GET ${path} failed:`, msg);
    throw new Error(`Razorpay: ${msg}`);
  }
  return json;
}

const paise = (n: unknown) => (Number(n) || 0) / 100;

/**
 * Pull every settlement (paginating) and upsert into `gateway_settlements`.
 * Also pulls the combined recon report for the current + previous month so each
 * payment/refund is linked to the settlement that carried it.
 */
async function runSettlementSync(): Promise<{
  settlements: number;
  reconRows: number;
  totalSettledInr: number;
}> {
  const { keyId, keySecret } = readKeys();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are not configured on the server.");
  }
  const db = admin.firestore();

  // ── 1) Settlements (paginated) ──
  let settlementsSynced = 0;
  let totalSettledInr = 0;
  let skip = 0;
  const PAGE = 100;
  // Cap the crawl so a huge history can't run forever in one invocation.
  for (let page = 0; page < 50; page++) {
    const data = await rzpGet(keyId, keySecret, `/settlements?count=${PAGE}&skip=${skip}`);
    const items: any[] = data.items ?? [];
    if (!items.length) break;

    let batch = db.batch();
    let ops = 0;
    for (const s of items) {
      const amount = paise(s.amount);
      totalSettledInr += amount;
      batch.set(
        db.collection("gateway_settlements").doc(String(s.id)),
        {
          settlementId: s.id,
          amount,
          fees: paise(s.fees),
          tax: paise(s.tax),
          utr: s.utr ?? null,
          status: s.status ?? "processed",
          createdAt: admin.firestore.Timestamp.fromMillis((Number(s.created_at) || 0) * 1000),
          syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      settlementsSynced++;
      if (++ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();

    if (!data.has_more || items.length < PAGE) break;
    skip += PAGE;
  }

  // ── 2) Combined recon report (current + previous month) ──
  let reconRows = 0;
  const now = new Date();
  const months = [
    { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 },
    { y: new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear(), m: ((now.getUTCMonth() + 11) % 12) + 1 },
  ];
  for (const { y, m } of months) {
    let rSkip = 0;
    for (let page = 0; page < 20; page++) {
      let data: any;
      try {
        data = await rzpGet(
          keyId,
          keySecret,
          `/settlements/recon/combined?year=${y}&month=${String(m).padStart(2, "0")}&count=100&skip=${rSkip}`,
        );
      } catch (e) {
        logger.warn(`recon combined ${y}-${m} failed`, e);
        break;
      }
      const items: any[] = data.items ?? [];
      if (!items.length) break;

      let batch = db.batch();
      let ops = 0;
      for (const r of items) {
        const id = `${r.settlement_id || "unsettled"}_${r.entity_id || r.type}_${r.settled_at || rSkip}_${ops}`;
        batch.set(
          db.collection("settlement_recon").doc(id.slice(0, 400)),
          {
            entityId: r.entity_id ?? null, // pay_… / rfnd_…
            type: r.type ?? null, // payment / refund / adjustment / …
            debit: paise(r.debit),
            credit: paise(r.credit),
            amount: paise(r.amount),
            fee: paise(r.fee),
            tax: paise(r.tax),
            settlementId: r.settlement_id ?? null,
            settlementUtr: r.settlement_utr ?? null,
            orderReceipt: r.order_receipt ?? null,
            settled: r.settled === true || r.settled === "Yes",
            settledAt: r.settled_at
              ? admin.firestore.Timestamp.fromMillis(Number(r.settled_at) * 1000)
              : null,
            postedAt: r.created_at
              ? admin.firestore.Timestamp.fromMillis(Number(r.created_at) * 1000)
              : null,
            month: `${y}-${String(m).padStart(2, "0")}`,
            syncedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        reconRows++;
        if (++ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();

      if (!data.has_more || items.length < 100) break;
      rSkip += 100;
    }
  }

  await db.collection("config").doc("reconciliation").set(
    {
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSettlementsSynced: settlementsSynced,
      lastReconRows: reconRows,
      totalSettledInr,
    },
    { merge: true },
  );

  return { settlements: settlementsSynced, reconRows, totalSettledInr };
}

/** Admin: sync now. */
export const syncGatewaySettlements = onCall({ secrets: RECON_SECRETS }, async (request) => {
  assertAdmin(request);
  try {
    const result = await runSettlementSync();
    await admin.firestore().collection("admin_logs").add({
      type: "reconciliation",
      action: "syncGatewaySettlements",
      description: `Synced ${result.settlements} settlements, ${result.reconRows} recon rows (₹${Math.round(result.totalSettledInr)} settled)`,
      adminEmail: (request.auth?.token?.email as string) || "admin",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, ...result };
  } catch (e: any) {
    throw new HttpsError("internal", e?.message || "Settlement sync failed.");
  }
});

/** Scheduled: pull settlements every day at 07:30 IST (02:00 UTC). */
export const scheduledGatewaySync = onSchedule(
  { schedule: "0 2 * * *", timeZone: "Asia/Kolkata", secrets: RECON_SECRETS, retryCount: 2 },
  async () => {
    const result = await runSettlementSync();
    logger.info(`Scheduled gateway sync: ${result.settlements} settlements, ${result.reconRows} recon rows`);
  },
);

/**
 * Admin: money-movement reconciliation summary for a window (default 30d).
 * Compares what we RECORDED collecting (internal `transactions`) with what the
 * gateway actually SETTLED to the bank, and surfaces the unsettled float.
 */
export const getReconciliationReport = onCall(async (request) => {
  assertAdmin(request);
  const db = admin.firestore();
  const days = Math.min(365, Math.max(1, Number((request.data as any)?.days) || 30));
  const startMs = Date.now() - days * 86_400_000;
  const startTs = admin.firestore.Timestamp.fromMillis(startMs);

  // Internal captured payments (money-in ledger written by the webhook).
  let internalCollected = 0;
  let internalCount = 0;
  try {
    const txSnap = await db
      .collection("transactions")
      .where("created_at", ">=", startTs)
      .get();
    for (const d of txSnap.docs) {
      const t = d.data();
      if ((t.status ?? "") === "captured") {
        internalCollected += Number(t.gross_amount ?? 0) || 0;
        internalCount++;
      }
    }
  } catch (e) {
    logger.warn("recon: transactions read failed", e);
  }

  // Gateway settlements deposited to bank.
  let settledToBank = 0;
  let gatewayFees = 0;
  let gatewayTax = 0;
  let settlementCount = 0;
  const recentSettlements: any[] = [];
  try {
    const sSnap = await db
      .collection("gateway_settlements")
      .where("createdAt", ">=", startTs)
      .orderBy("createdAt", "desc")
      .get();
    for (const d of sSnap.docs) {
      const s = d.data();
      settledToBank += Number(s.amount ?? 0) || 0;
      gatewayFees += Number(s.fees ?? 0) || 0;
      gatewayTax += Number(s.tax ?? 0) || 0;
      settlementCount++;
      if (recentSettlements.length < 25) {
        recentSettlements.push({
          id: s.settlementId,
          amount: Number(s.amount ?? 0),
          fees: Number(s.fees ?? 0),
          tax: Number(s.tax ?? 0),
          utr: s.utr ?? null,
          status: s.status ?? "processed",
          createdAt: (s.createdAt?.toMillis?.() ?? 0),
        });
      }
    }
  } catch (e) {
    logger.warn("recon: gateway_settlements read failed", e);
  }

  // Unsettled recon rows = collected but not yet in the bank (float).
  let unsettledFloat = 0;
  let unsettledCount = 0;
  try {
    const uSnap = await db
      .collection("settlement_recon")
      .where("settled", "==", false)
      .limit(1000)
      .get();
    for (const d of uSnap.docs) {
      const r = d.data();
      if ((r.type ?? "") === "refund") continue;
      unsettledFloat += Number(r.credit ?? r.amount ?? 0) || 0;
      unsettledCount++;
    }
  } catch (e) {
    logger.warn("recon: unsettled read failed", e);
  }

  const cfg = (await db.collection("config").doc("reconciliation").get()).data() ?? {};

  return {
    ok: true,
    rangeDays: days,
    internal: { collected: internalCollected, count: internalCount },
    gateway: {
      settledToBank,
      fees: gatewayFees,
      tax: gatewayTax,
      settlementCount,
      recentSettlements,
    },
    float: { unsettled: unsettledFloat, count: unsettledCount },
    // A positive delta means we recorded more than the gateway has settled yet
    // (normal — settlement lags collection); a large persistent gap is a flag.
    variance: Math.round((internalCollected - settledToBank - unsettledFloat) * 100) / 100,
    lastSyncAt: cfg.lastSyncAt?.toMillis?.() ?? null,
  };
});
