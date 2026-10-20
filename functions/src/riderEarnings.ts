import * as admin from "firebase-admin";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Rider earnings counters on `delivery_users/{uid}` — how to write them.
 *
 * BUG THIS REPLACES: every writer used `set({ "earnings.today": inc }, {merge})`.
 * `set()` does NOT treat dots as paths (only `update()` does), so the money
 * landed in top-level fields literally named "earnings.today", "earnings.week",
 * "earnings.lifetime"… while the rider app, payouts (`earnings.lifetime`) and
 * the reset jobs all read the nested `earnings.today`. Riders saw ₹0, could
 * not withdraw, and the daily counters never reset.
 *
 * Now:
 *   - writes use a nested `earnings: {…}` map (deep-merged by set+merge),
 *   - today / week / month are date-stamped in `earningsPeriod` (IST), so a
 *     new day starts from zero even if the midnight job misses a rider, and
 *   - `recomputeRiderEarnings` rebuilds the counters from the authoritative
 *     ledger (`rider_earnings/{uid}/entries`) and deletes the stray fields.
 * ─────────────────────────────────────────────────────────────────────────
 */

const IST_MS = 5.5 * 60 * 60 * 1000;

export interface EarningsPeriod {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  /** IST date of that week's Monday, YYYY-MM-DD. */
  week: string;
  /** IST month, YYYY-MM. */
  month: string;
}

export function istPeriods(at: Date): EarningsPeriod {
  const ist = new Date(at.getTime() + IST_MS);
  const day = ist.toISOString().slice(0, 10);
  const mondayOffset = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - mondayOffset));
  return { day, week: monday.toISOString().slice(0, 10), month: day.slice(0, 7) };
}

/** Which buckets still belong to the current period for this rider. */
export function samePeriods(previous: unknown, now: EarningsPeriod) {
  const p = (previous ?? {}) as Partial<EarningsPeriod>;
  return { day: p.day === now.day, week: p.week === now.week, month: p.month === now.month };
}

/**
 * The rider-doc fields to `set(…, {merge: true})` when [amount] rupees are
 * earned. [trip] also bumps the day's trip and tip counters (a completed
 * delivery, as opposed to a bonus).
 */
export function earningsFields(
  riderData: FirebaseFirestore.DocumentData | undefined,
  amount: number,
  now: Date,
  trip?: { tip: number },
): Record<string, unknown> {
  const period = istPeriods(now);
  const same = samePeriods(riderData?.earningsPeriod, period);
  const inc = admin.firestore.FieldValue.increment;
  const bucket = (isSame: boolean, v: number) => (isSame ? inc(v) : v);
  return {
    earnings: {
      lifetime: inc(amount),
      today: bucket(same.day, amount),
      week: bucket(same.week, amount),
      month: bucket(same.month, amount),
      lastEarnedAt: admin.firestore.Timestamp.fromDate(now),
    },
    earningsPeriod: period,
    ...(trip
      ? {
          deliveriesToday: bucket(same.day, 1),
          tipsToday: bucket(same.day, trip.tip),
        }
      : {}),
  };
}

/** Trips already counted today, honouring the period stamp (0 on a new day). */
export function deliveriesSoFarToday(riderData: FirebaseFirestore.DocumentData | undefined, now: Date): number {
  const same = samePeriods(riderData?.earningsPeriod, istPeriods(now));
  // Legacy docs (no stamp) can't be trusted: their counter never reset.
  if (!same.day) return 0;
  return Number(riderData?.deliveriesToday ?? 0) || 0;
}

/** Top-level fields the old writers created by mistake. */
export function strayEarningsFields(riderData: FirebaseFirestore.DocumentData | undefined): string[] {
  return Object.keys(riderData ?? {}).filter((k) => k.startsWith("earnings."));
}

interface LedgerEntry {
  id: string;
  total: number;
  tip: number;
  createdAt: Date | null;
}

/** Pure: counters implied by a rider's ledger at [now]. */
export function totalsFromLedger(entries: LedgerEntry[], now: Date) {
  const period = istPeriods(now);
  const out = { lifetime: 0, today: 0, week: 0, month: 0, deliveriesToday: 0, tipsToday: 0, lastEarnedAt: null as Date | null };
  for (const e of entries) {
    const total = Number.isFinite(e.total) ? e.total : 0;
    out.lifetime += total;
    if (!e.createdAt) continue;
    if (!out.lastEarnedAt || e.createdAt > out.lastEarnedAt) out.lastEarnedAt = e.createdAt;
    const p = istPeriods(e.createdAt);
    const isTrip = !e.id.startsWith("quest_");
    if (p.day === period.day) {
      out.today += total;
      if (isTrip) {
        out.deliveriesToday += 1;
        out.tipsToday += e.tip || 0;
      }
    }
    if (p.week === period.week) out.week += total;
    if (p.month === period.month) out.month += total;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    ...out,
    lifetime: round(out.lifetime),
    today: round(out.today),
    week: round(out.week),
    month: round(out.month),
    tipsToday: round(out.tipsToday),
    period,
  };
}

export interface RepairReport {
  riderId: string;
  before: { nestedLifetime: number; strayLifetime: number; strayFields: string[] };
  after: ReturnType<typeof totalsFromLedger>;
  applied: boolean;
}

/**
 * Rebuild a rider's counters from their ledger and remove the stray
 * top-level "earnings.*" fields. Idempotent. With [apply] false it only
 * reports what it would change.
 */
export async function recomputeRiderEarnings(uid: string, apply: boolean, now = new Date()): Promise<RepairReport> {
  const db = admin.firestore();
  const riderRef = db.collection("delivery_users").doc(uid);
  const [riderSnap, entriesSnap] = await Promise.all([
    riderRef.get(),
    db.collection("rider_earnings").doc(uid).collection("entries").get(),
  ]);
  const data = riderSnap.data() ?? {};
  const entries: LedgerEntry[] = entriesSnap.docs.map((d) => {
    const e = d.data();
    const created = e.createdAt instanceof admin.firestore.Timestamp ? e.createdAt.toDate() : null;
    return { id: d.id, total: Number(e.total ?? 0) || 0, tip: Number(e.tip ?? 0) || 0, createdAt: created };
  });
  const totals = totalsFromLedger(entries, now);
  const stray = strayEarningsFields(data);
  const report: RepairReport = {
    riderId: uid,
    before: {
      nestedLifetime: Number(data.earnings?.lifetime ?? 0) || 0,
      strayLifetime: Number(data["earnings.lifetime"] ?? 0) || 0,
      strayFields: stray,
    },
    after: totals,
    applied: false,
  };
  if (!apply || !riderSnap.exists) return report;

  const FieldValue = admin.firestore.FieldValue;
  const args: unknown[] = [
    "earnings.lifetime", totals.lifetime,
    "earnings.today", totals.today,
    "earnings.week", totals.week,
    "earnings.month", totals.month,
    "earningsPeriod", totals.period,
    "deliveriesToday", totals.deliveriesToday,
    "tipsToday", totals.tipsToday,
    "earningsRepairedAt", FieldValue.serverTimestamp(),
  ];
  if (totals.lastEarnedAt) args.push("earnings.lastEarnedAt", admin.firestore.Timestamp.fromDate(totals.lastEarnedAt));
  // A FieldPath with one segment names the literal "earnings.today" field
  // (a plain string would mean the nested one we just wrote).
  for (const f of stray) args.push(new admin.firestore.FieldPath(f), FieldValue.delete());
  const [first, firstValue, ...rest] = args;
  await riderRef.update(first as string, firstValue, ...rest);
  report.applied = true;
  return report;
}
