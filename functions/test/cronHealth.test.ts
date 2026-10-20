import { describe, it, expect } from "vitest";
import { evaluateCronHealth, type CronStatus } from "../src/cronHealth";

// A cron that throws on every run looks exactly like a cron with nothing to do.
// That is how missing indexes silently stopped scheduled orders, notification
// retries and the stuck-order alert for days in September. These tests pin the
// two things that matter: a dead cron IS reported, and ordinary scheduler
// jitter is NOT — an alert that cries wolf gets muted, and then we are blind
// again.

const MIN = 60_000;
const now = Date.UTC(2026, 9, 3, 12, 0, 0);

const cron = (over: Partial<CronStatus> = {}): CronStatus => ({
  name: "processScheduledOrders",
  everyMinutes: 5,
  lastSuccessMs: now - 2 * MIN,
  consecutiveFailures: 0,
  lastError: null,
  ...over,
});

describe("evaluateCronHealth", () => {
  it("says nothing when every cron succeeded recently", () => {
    expect(evaluateCronHealth([cron(), cron({ name: "retryFailedEmails" })], now)).toEqual([]);
  });

  it("tolerates a late run rather than flapping", () => {
    // A 5-minute cron that last succeeded 12 minutes ago is late but alive:
    // Cloud Scheduler is not exact and a slow run is normal.
    expect(evaluateCronHealth([cron({ lastSuccessMs: now - 12 * MIN })], now)).toEqual([]);
  });

  it("reports a cron that has not succeeded for several intervals", () => {
    const out = evaluateCronHealth([cron({ lastSuccessMs: now - 90 * MIN })], now);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("crons_stalled");
    expect(out[0].severity).toBe("critical");
    expect(out[0].detail).toContain("processScheduledOrders");
    expect(out[0].detail).toContain("90 min ago");
  });

  it("gives a frequent cron a floor so a 1-minute job is not flagged instantly", () => {
    // 4x a 1-minute interval would be 4 minutes, which is pure jitter. The
    // floor (interval + 15 min) keeps a 1-minute cron from alerting constantly.
    expect(evaluateCronHealth([cron({ everyMinutes: 1, lastSuccessMs: now - 10 * MIN })], now)).toEqual([]);
    const out = evaluateCronHealth([cron({ everyMinutes: 1, lastSuccessMs: now - 40 * MIN })], now);
    expect(out[0]?.key).toBe("crons_stalled");
  });

  it("reports repeated failures and surfaces the error text", () => {
    const out = evaluateCronHealth(
      [cron({ consecutiveFailures: 4, lastError: "9 FAILED_PRECONDITION: The query requires an index." })],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("crons_failing");
    expect(out[0].detail).toContain("FAILED_PRECONDITION");
    expect(out[0].detail).toContain("4x");
  });

  it("does not double-report a failing cron as also stalled", () => {
    const out = evaluateCronHealth(
      [cron({ consecutiveFailures: 5, lastSuccessMs: now - 600 * MIN })],
      now,
    );
    expect(out.map((a) => a.key)).toEqual(["crons_failing"]);
  });

  it("stays quiet about a cron that has never recorded a success", () => {
    // Newly added or renamed crons have no history. Guessing about them would
    // fire an alert on every deploy, which trains people to ignore it.
    expect(evaluateCronHealth([cron({ lastSuccessMs: null })], now)).toEqual([]);
  });

  it("groups several dead crons into one alert", () => {
    const out = evaluateCronHealth(
      [
        cron({ name: "a", lastSuccessMs: now - 200 * MIN }),
        cron({ name: "b", lastSuccessMs: now - 300 * MIN }),
      ],
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
    expect(out[0].detail).toContain("a");
    expect(out[0].detail).toContain("b");
  });
});
