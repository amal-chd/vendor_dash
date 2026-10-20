import { describe, it, expect } from "vitest";
import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRESENCE_DISPATCH_STALE_MS, PRESENCE_OFFLINE_STALE_MS, presenceIsStale } from "../src/delivery";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const ts = (msAgo: number) => admin.firestore.Timestamp.fromMillis(NOW - msAgo);

describe("rider presence", () => {
  it("treats a recent heartbeat as alive and a long silence as stale", () => {
    expect(presenceIsStale(ts(2 * 60_000), NOW, PRESENCE_DISPATCH_STALE_MS)).toBe(false);
    expect(presenceIsStale(ts(PRESENCE_DISPATCH_STALE_MS + 1), NOW, PRESENCE_DISPATCH_STALE_MS)).toBe(true);
  });

  it("never judges a rider with no signal record (legacy data) as stale", () => {
    expect(presenceIsStale(undefined, NOW, PRESENCE_DISPATCH_STALE_MS)).toBe(false);
    expect(presenceIsStale(null, NOW, PRESENCE_DISPATCH_STALE_MS)).toBe(false);
    expect(presenceIsStale("yesterday", NOW, PRESENCE_DISPATCH_STALE_MS)).toBe(false);
  });

  it("stops offering before it takes anyone offline, and the app heartbeat fits well inside both", () => {
    expect(PRESENCE_DISPATCH_STALE_MS).toBeLessThan(PRESENCE_OFFLINE_STALE_MS);
    // The rider app heartbeats every 2 minutes (location_service.dart).
    expect(PRESENCE_DISPATCH_STALE_MS).toBeGreaterThanOrEqual(4 * 2 * 60_000);
  });
});

describe("dispatch rules", () => {
  const src = readFileSync(join(__dirname, "..", "src", "delivery.ts"), "utf8");
  const find = src.slice(src.indexOf("async function findCandidateRiders"), src.indexOf("const NON_DELIVERY_TYPES"));

  it("skips riders on a break and riders with no recent signal", () => {
    expect(find).toMatch(/d\.isPaused === true/);
    expect(find).toMatch(/presenceIsStale\(d\.locationUpdatedAt/);
  });

  it("lets a rider retry an accept whose reply was lost", () => {
    const accept = src.slice(src.indexOf("export const acceptDeliveryOffer"), src.indexOf("export const declineDeliveryOffer"));
    expect(accept).toMatch(/order\.riderId === uid/);
    expect(accept).toMatch(/idempotent: true/);
  });

  it("never takes a rider offline mid-delivery", () => {
    const sweep = src.slice(src.indexOf("export const sweepStuckDeliveries"));
    expect(sweep).toMatch(/if \(\(d\.currentOrderId \?\? ""\)\.toString\(\)\) continue;/);
  });
});
