import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 6 — the chain audit, as a test rather than a one-off read-through.
 *
 * The chain the whole platform depends on:
 *
 *   customer location → zone → shop availability → order → delivery assignment
 *   → vendor earnings → delivery earnings → commission → settlement → analytics
 *
 * Each link has ONE source of truth. The failure mode this file exists to
 * catch is a second one appearing: a hard-coded delivery fee here, a
 * client-supplied zone there, a commission rate read from the wrong document.
 * Those never break a build and rarely break a test — they just quietly
 * charge the wrong person the wrong amount.
 *
 * These assertions read the real source, so they fail the moment someone
 * reintroduces a bypass.
 */

const SRC = join(__dirname, "..", "src");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("chain: customer location → zone", () => {
  const zones = read("zones.ts");

  it("resolves zones only from coordinates, never from a client-supplied id", () => {
    // Scope to the callable's own body. `setEntityZone` further down the file
    // legitimately accepts a zoneId — it is the admin-only manual pin.
    const start = zones.indexOf("export const resolveZone");
    const next = zones.indexOf("export const", start + 20);
    const body = zones.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("coord(request.data)");
    expect(body).not.toMatch(/request\.data\??\.zoneId/);
  });

  it("answers three states, so an empty list is never mistaken for no coverage", () => {
    expect(zones).toContain('"outside_coverage"');
    expect(zones).toContain('"no_supply"');
    expect(zones).toContain('"serviceable"');
  });

  it("treats a missing zone as out of coverage rather than defaulting to one", () => {
    expect(zones).toMatch(/if \(!zone\) \{[\s\S]*?outside_coverage/);
  });
});

describe("chain: zone → delivery pricing", () => {
  const delivery = read("delivery.ts");

  it("prices from the drop point, not the restaurant", () => {
    expect(delivery).toContain("resolveZoneForPoint({ lat: deliveryLat, lng: deliveryLng })");
  });

  it("overlays zone economics on the platform defaults", () => {
    expect(delivery).toContain("zone.economics.deliveryBaseFee");
    expect(delivery).toContain("zone.economics.deliveryPerKm");
    expect(delivery).toContain("zone.economics.maxDeliveryRadiusKm");
  });

  it("still works before any zone is drawn, so the feature is additive", () => {
    expect(delivery).toContain(": econGlobal");
  });

  // A zone multiplier scaling the base fare would silently double what every
  // customer in that area pays. It may only scale surge.
  it("applies the zone multiplier to surge only, never to the base fare", () => {
    const idx = delivery.indexOf("zone.surgeMultiplier");
    expect(idx).toBeGreaterThan(-1);
    const window = delivery.slice(idx - 400, idx + 200);
    expect(window).toContain("surgeFee");
    expect(window).not.toContain("baseDeliveryFee =");
  });
});

describe("chain: order → zone stamping", () => {
  const zones = read("zones.ts");

  it("stamps the zone at creation so reports never move under a redrawn boundary", () => {
    expect(zones).toContain("onOrderStampZone");
    expect(zones).toContain('document: "orders/{orderId}"');
  });

  it("never blocks an order if stamping fails — it is analytics metadata", () => {
    const fn = zones.slice(zones.indexOf("export const onOrderStampZone"));
    expect(fn).toContain("catch");
  });

  it("keeps an admin's manual assignment through an auto backfill", () => {
    expect(zones).toContain('existing?.zoneAssignment === "manual"');
    expect(zones).toContain('if (d.zoneAssignment === "manual") continue;');
  });
});

describe("chain: commission → settlement", () => {
  const billing = read("billingModel.ts");
  const operations = read("admin_operations.ts");

  it("waives commission only for an active paid subscription", () => {
    expect(billing).toContain("hasActiveSubscription");
    expect(billing).toMatch(/status === "active"/);
  });

  // A lapsed subscriber silently keeping 0% commission is pure revenue loss,
  // and it is invisible until someone reconciles a month later.
  it("falls back to commission billing when a subscription has lapsed", () => {
    expect(billing).toContain("lapsed");
    expect(billing).toMatch(/lapsed: true/);
  });

  it("settles on net-of-refund sales, not raw gross", () => {
    expect(operations).toContain("refundAmount");
    expect(operations).toContain("refundOffsets");
  });
});

describe("chain: no second source of truth", () => {
  it("prices subscriptions server-side, never from the client", () => {
    const sub = read("subscriptionBilling.ts");
    const fn = sub.slice(sub.indexOf("createSubscriptionOrder"));
    expect(fn).toContain("priceFor(plan, period)");
    expect(fn).not.toMatch(/request\.data\??\.amount/);
  });

  it("keeps the plan catalog as the only place prices live", () => {
    const catalog = read("planCatalog.ts");
    expect(catalog).toContain("config");
    expect(catalog).toContain("plan_catalog");
  });

  // Settlements snapshot their rate at generation time. Without that, editing
  // a commission rate today would silently rewrite what a vendor was owed
  // last month.
  it("does not apply a plan change retroactively", () => {
    const catalog = read("planCatalog.ts");
    expect(catalog).toContain("HISTORICAL SAFETY");
  });
});

describe("chain: entitlement is server-owned end to end", () => {
  it("has no in-app-purchase verification left anywhere", () => {
    const index = read("index.ts");
    // Match real module wiring, not the comment that records the removal.
    expect(index).not.toMatch(/from "\.\/iapVerify"/);
    expect(index).not.toMatch(/export \{[^}]*verifyAppStoreReceipt/);
  });

  it("grants subscriptions only from the signature-verified webhook", () => {
    const webhook = read("razorpayWebhook.ts");
    expect(webhook).toContain("activateSubscription");
    expect(webhook).toContain("timingSafeEqual");
  });
});
