import { describe, it, expect } from "vitest";
import { scoreVendor, scoreRider } from "../src/opsHealth";

// Health scores drive who ops calls first. A score that flags a healthy new
// joiner, or fails to flag a partner cancelling a third of their orders, sends
// someone to the wrong conversation.

const vendor = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  name: "Test Kitchen",
  zoneId: "z1",
  isOpen: true,
  ...over,
});

const order = (status: string) => ({ status });

describe("scoreVendor", () => {
  it("gives a clean, busy vendor a perfect score", () => {
    const s = scoreVendor(vendor(), Array.from({ length: 40 }, () => order("delivered")));
    expect(s.score).toBe(100);
    expect(s.band).toBe("healthy");
  });

  // A vendor with no history is new, not bad. Penalising them would bury the
  // genuinely failing partners under false positives.
  it("does not penalise a vendor with no orders", () => {
    const s = scoreVendor(vendor(), []);
    expect(s.score).toBe(100);
    expect(s.signals.map((x) => x.key)).toContain("no_orders");
  });

  it("penalises a high cancellation rate", () => {
    const orders = [
      ...Array.from({ length: 30 }, () => order("delivered")),
      ...Array.from({ length: 10 }, () => order("cancelled")),
    ];
    const s = scoreVendor(vendor(), orders);
    expect(s.score).toBeLessThan(100);
    expect(s.signals.map((x) => x.key)).toContain("cancel_rate");
  });

  // Small samples are noise: two cancellations out of three orders is a bad
  // day, not a bad vendor.
  it("ignores cancellations below a meaningful sample size", () => {
    const s = scoreVendor(vendor(), [order("delivered"), order("cancelled")]);
    expect(s.signals.map((x) => x.key)).not.toContain("cancel_rate");
  });

  it("flags a vendor no zone covers, because customers cannot see them", () => {
    const s = scoreVendor(vendor({ zoneId: null }), []);
    expect(s.score).toBe(80);
    expect(s.signals.find((x) => x.key === "no_zone")?.delta).toBe(-20);
  });

  it("penalises a poor rating only once there are enough ratings", () => {
    expect(
      scoreVendor(vendor({ rating: 2.5, ratingCount: 2 }), []).signals.map((x) => x.key),
    ).not.toContain("rating");
    expect(
      scoreVendor(vendor({ rating: 2.5, ratingCount: 40 }), []).signals.map((x) => x.key),
    ).toContain("rating");
  });

  it("bands a badly failing vendor as at_risk", () => {
    const orders = [
      ...Array.from({ length: 10 }, () => order("delivered")),
      ...Array.from({ length: 20 }, () => order("cancelled")),
    ];
    const s = scoreVendor(vendor({ rating: 2, ratingCount: 50, zoneId: null }), orders);
    expect(s.band).toBe("at_risk");
  });

  it("never returns a score outside 0-100", () => {
    const orders = Array.from({ length: 100 }, () => order("cancelled"));
    const s = scoreVendor(
      vendor({ rating: 1, ratingCount: 100, zoneId: null, isOpen: false }),
      orders,
    );
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });

  it("explains every deduction, so an operator can act on it", () => {
    const s = scoreVendor(vendor({ zoneId: null, isOpen: false }), []);
    for (const signal of s.signals) {
      expect(signal.detail.length).toBeGreaterThan(0);
      expect(signal.label.length).toBeGreaterThan(0);
    }
  });
});

describe("scoreRider", () => {
  const rider = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    name: "Test Rider",
    zoneId: "z1",
    cashInHand: 0,
    ...over,
  });

  it("gives a clean rider a perfect score", () => {
    const s = scoreRider(
      rider(),
      Array.from({ length: 30 }, () => ({ deliveryStatus: "delivered" })),
    );
    expect(s.score).toBe(100);
  });

  it("penalises dropped deliveries", () => {
    const deliveries = [
      ...Array.from({ length: 20 }, () => ({ deliveryStatus: "delivered" })),
      ...Array.from({ length: 10 }, () => ({ deliveryStatus: "reassigned" })),
    ];
    const s = scoreRider(rider(), deliveries);
    expect(s.signals.map((x) => x.key)).toContain("drop_rate");
    expect(s.score).toBeLessThan(100);
  });

  // Cash in hand is platform money in someone's pocket — the one signal that
  // is a financial risk rather than a service-quality one.
  it("scales the penalty with the amount of undeposited cash", () => {
    const small = scoreRider(rider({ cashInHand: 3500 }), []);
    const large = scoreRider(rider({ cashInHand: 12000 }), []);
    expect(large.score).toBeLessThan(small.score);
    expect(large.signals.find((x) => x.key === "cash_in_hand")?.detail).toContain("12,000");
  });

  it("leaves a normal float alone", () => {
    expect(scoreRider(rider({ cashInHand: 1200 }), []).signals.map((x) => x.key)).not.toContain(
      "cash_in_hand",
    );
  });

  it("caps the cash penalty rather than zeroing an otherwise good rider", () => {
    const s = scoreRider(rider({ cashInHand: 999999 }), []);
    expect(s.signals.find((x) => x.key === "cash_in_hand")?.delta).toBe(-25);
    expect(s.score).toBe(75);
  });
});
