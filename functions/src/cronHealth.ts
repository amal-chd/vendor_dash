import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import type { Anomaly } from "./opsHealth";

/**
 * Heartbeats for scheduled work, and a watchdog that notices when one stops.
 *
 * In September a set of missing composite indexes made several crons throw
 * FAILED_PRECONDITION on every run. Scheduled orders stopped dispatching,
 * notification retries stopped retrying, and the stuck-order alert itself
 * stopped firing — for days, silently, because a cron that throws looks
 * exactly like a cron that had nothing to do. The alerting we had watched
 * orders and partners; nothing watched the watchers.
 *
 * So every wrapped cron records the outcome of each run in `cron_health/{name}`,
 * and `checkCronHealth` reports any cron that has not SUCCEEDED within its own
 * expected window. The result is appended to the same `ops_health/anomalies`
 * document the console's Ops Alerts panel already renders, so a dead cron shows
 * up next to stalled orders instead of needing a new place to look.
 */

const db = () => admin.firestore();

export interface CronHeartbeat {
  /** Minutes between scheduled runs, used to decide what "late" means. */
  everyMinutes: number;
  lastRunAt?: admin.firestore.Timestamp;
  lastSuccessAt?: admin.firestore.Timestamp;
  lastDurationMs?: number;
  lastError?: string | null;
  consecutiveFailures?: number;
}

/**
 * Wrap a scheduled handler so each run is recorded.
 *
 * The heartbeat write is deliberately best-effort and never masks the real
 * error: a cron that fails must still fail, so Cloud Scheduler retries and the
 * error reaches Cloud Logging. The heartbeat only adds the memory of it.
 */
export function withCronHeartbeat<A extends unknown[], T>(
  name: string,
  everyMinutes: number,
  handler: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return async (...args: A) => {
    const startedAt = Date.now();
    const ref = db().collection("cron_health").doc(name);
    try {
      const result = await handler(...args);
      await ref
        .set(
          {
            everyMinutes,
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
            lastDurationMs: Date.now() - startedAt,
            lastError: null,
            consecutiveFailures: 0,
          },
          { merge: true },
        )
        .catch((e) => logger.warn(`cron_health write failed for ${name}`, e));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ref
        .set(
          {
            everyMinutes,
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastDurationMs: Date.now() - startedAt,
            lastError: message.slice(0, 500),
            consecutiveFailures: admin.firestore.FieldValue.increment(1),
          },
          { merge: true },
        )
        .catch((e) => logger.warn(`cron_health write failed for ${name}`, e));
      // Rethrow: the run really did fail.
      throw err;
    }
  };
}

/**
 * How late a cron may be before we call it stalled.
 *
 * Generous on purpose — Cloud Scheduler is not exact, a 1-minute cron that
 * takes 90 seconds is fine, and a flapping alert gets ignored. We want the
 * "it has been dead since Tuesday" case, not jitter.
 */
function stalledAfterMs(everyMinutes: number): number {
  return Math.max(everyMinutes * 4, everyMinutes + 15) * 60_000;
}

/**
 * Crons that have not succeeded recently, as console anomalies.
 *
 * Only reports crons that have run at least once: a cron that has never
 * recorded a heartbeat is usually one that was just added or renamed, and
 * guessing about it would cry wolf on every deploy.
 */
export async function checkCronHealth(): Promise<Anomaly[]> {
  const snap = await db().collection("cron_health").get().catch((e) => {
    logger.error("checkCronHealth: could not read cron_health", e);
    return null;
  });
  if (!snap || snap.empty) return [];

  return evaluateCronHealth(
    snap.docs.map((doc) => {
      const d = doc.data() as CronHeartbeat;
      return {
        name: doc.id,
        everyMinutes: Number(d.everyMinutes) || 60,
        lastSuccessMs: d.lastSuccessAt?.toMillis?.() ?? null,
        consecutiveFailures: Number(d.consecutiveFailures) || 0,
        lastError: d.lastError ?? null,
      };
    }),
    Date.now(),
  );
}

/** One cron's heartbeat, flattened so the decision logic needs no Firestore. */
export interface CronStatus {
  name: string;
  everyMinutes: number;
  lastSuccessMs: number | null;
  consecutiveFailures: number;
  lastError?: string | null;
}

/** The decision half of checkCronHealth, pure so it can be tested directly. */
export function evaluateCronHealth(entries: CronStatus[], now: number): Anomaly[] {
  const stalled: { name: string; minutesLate: number; error?: string | null }[] = [];
  const failing: { name: string; failures: number; error?: string | null }[] = [];

  for (const d of entries) {
    const everyMinutes = d.everyMinutes;
    const lastSuccess = d.lastSuccessMs;
    const failures = d.consecutiveFailures;

    if (failures >= 3) {
      failing.push({ name: d.name, failures, error: d.lastError });
      continue; // already reported as failing; no need to also call it late
    }
    if (!lastSuccess) continue;
    const late = now - lastSuccess;
    if (late > stalledAfterMs(everyMinutes)) {
      stalled.push({ name: d.name, minutesLate: Math.round(late / 60_000), error: d.lastError });
    }
  }

  const out: Anomaly[] = [];

  if (failing.length) {
    out.push({
      key: "crons_failing",
      severity: "critical",
      title: "Scheduled jobs are failing",
      detail:
        `${failing.map((f) => `${f.name} (${f.failures}x)`).join(", ")}. ` +
        `Last error: ${failing[0].error ?? "unknown"}. ` +
        `Full history in the cron_health collection.`,
      href: "/admin",
      count: failing.length,
    });
  }

  if (stalled.length) {
    out.push({
      key: "crons_stalled",
      severity: "critical",
      title: "Scheduled jobs have stopped running",
      detail:
        `${stalled.map((s) => `${s.name} (last success ${s.minutesLate} min ago)`).join(", ")}. ` +
        `Check Cloud Logging for that function — a thrown cron looks identical ` +
        `to an idle one. Full history in the cron_health collection.`,
      href: "/admin",
      count: stalled.length,
    });
  }

  return out;
}
