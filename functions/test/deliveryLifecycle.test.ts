import { describe, it, expect } from "vitest";
import {
  DeliveryState,
  OrderStatus,
  canRiderTransition,
  canAdminForceStage,
  isTerminalOrder,
  customerFacingStatus,
  isReleasedForPickup,
  pickupProblem,
  scheduledDispatchHold,
  SCHEDULED_DISPATCH_LEAD_MIN,
} from "../src/deliveryLifecycle";

/**
 * Transition-engine tests — the matrix required by the delivery spec.
 * These lock the authoritative lifecycle so a future edit can't silently
 * re-open a skipped-stage or backwards transition.
 */
describe("rider delivery transitions", () => {
  it("allows the legal forward chain, one step at a time", () => {
    expect(canRiderTransition(DeliveryState.ASSIGNED, DeliveryState.AT_RESTAURANT)).toBe(true);
    expect(canRiderTransition(DeliveryState.AT_RESTAURANT, DeliveryState.PICKED_UP)).toBe(true);
    expect(canRiderTransition(DeliveryState.PICKED_UP, DeliveryState.ON_THE_WAY)).toBe(true);
    expect(canRiderTransition(DeliveryState.ON_THE_WAY, DeliveryState.ARRIVED)).toBe(true);
  });

  it("rejects skipping stages", () => {
    // The core bug the old rules allowed: jump straight to picked_up/arrived.
    expect(canRiderTransition(DeliveryState.ASSIGNED, DeliveryState.PICKED_UP)).toBe(false);
    expect(canRiderTransition(DeliveryState.ASSIGNED, DeliveryState.ARRIVED)).toBe(false);
    expect(canRiderTransition(DeliveryState.AT_RESTAURANT, DeliveryState.ON_THE_WAY)).toBe(false);
    expect(canRiderTransition(DeliveryState.PICKED_UP, DeliveryState.ARRIVED)).toBe(false);
  });

  it("rejects backwards transitions", () => {
    expect(canRiderTransition(DeliveryState.PICKED_UP, DeliveryState.AT_RESTAURANT)).toBe(false);
    expect(canRiderTransition(DeliveryState.ARRIVED, DeliveryState.ON_THE_WAY)).toBe(false);
    expect(canRiderTransition(DeliveryState.ON_THE_WAY, DeliveryState.ASSIGNED)).toBe(false);
  });

  it("never allows the rider to self-transition to DELIVERED", () => {
    // Completion must go through completeDelivery (server-verified OTP + payout).
    expect(canRiderTransition(DeliveryState.ARRIVED, DeliveryState.DELIVERED)).toBe(false);
    expect(canRiderTransition(DeliveryState.ON_THE_WAY, DeliveryState.DELIVERED)).toBe(false);
  });

  it("rejects transitions out of an unassigned/offered leg", () => {
    expect(canRiderTransition(DeliveryState.UNASSIGNED, DeliveryState.PICKED_UP)).toBe(false);
    expect(canRiderTransition(DeliveryState.UNASSIGNED, DeliveryState.AT_RESTAURANT)).toBe(false);
    expect(canRiderTransition(DeliveryState.OFFERED, DeliveryState.AT_RESTAURANT)).toBe(false);
  });
});

describe("terminal order states", () => {
  it("treats closed orders as terminal", () => {
    expect(isTerminalOrder(OrderStatus.DELIVERED)).toBe(true);
    expect(isTerminalOrder(OrderStatus.COMPLETED)).toBe(true);
    expect(isTerminalOrder(OrderStatus.CANCELLED)).toBe(true);
    expect(isTerminalOrder(OrderStatus.REJECTED)).toBe(true);
  });
  it("treats live orders as non-terminal", () => {
    expect(isTerminalOrder(OrderStatus.PREPARING)).toBe(false);
    expect(isTerminalOrder(OrderStatus.READY)).toBe(false);
    expect(isTerminalOrder(OrderStatus.READY_FOR_PICKUP)).toBe(false);
  });
});

describe("shop release gate", () => {
  it("READY alone is NOT a release", () => {
    expect(isReleasedForPickup({ status: OrderStatus.READY })).toBe(false);
    expect(isReleasedForPickup({ status: OrderStatus.PREPARING })).toBe(false);
  });
  it("recognises an explicitly released order", () => {
    expect(isReleasedForPickup({ status: OrderStatus.READY_FOR_PICKUP })).toBe(true);
    expect(isReleasedForPickup({ status: OrderStatus.READY, releasedForPickupAt: new Date() })).toBe(true);
  });
});

describe("customer-facing status mapping", () => {
  it("never leaks a raw database state", () => {
    const cases: [string, string][] = [
      [OrderStatus.NEW, ""],
      [OrderStatus.PREPARING, ""],
      [OrderStatus.READY_FOR_PICKUP, ""],
      [OrderStatus.READY, DeliveryState.ASSIGNED],
      [OrderStatus.READY, DeliveryState.PICKED_UP],
      [OrderStatus.OUT_FOR_DELIVERY, DeliveryState.ON_THE_WAY],
      [OrderStatus.OUT_FOR_DELIVERY, DeliveryState.ARRIVED],
      [OrderStatus.COMPLETED, DeliveryState.DELIVERED],
    ];
    // Only snake_case DB identifiers count as a leak. Plain English words like
    // "assigned" are legitimate copy ("Delivery partner assigned").
    const raw = [
      "ready_for_pickup", "at_restaurant", "picked_up", "on_the_way",
      "out_for_delivery",
    ];
    for (const [s, d] of cases) {
      const { title, detail } = customerFacingStatus(s, d);
      expect(title.length).toBeGreaterThan(0);
      expect(detail.length).toBeGreaterThan(0);
      for (const r of raw) {
        expect(title.toLowerCase()).not.toContain(r);
        expect(detail.toLowerCase()).not.toContain(r);
      }
    }
  });

  it("maps the key lifecycle moments to human copy", () => {
    expect(customerFacingStatus(OrderStatus.READY_FOR_PICKUP, "").title).toBe("Finding a delivery partner");
    expect(customerFacingStatus(OrderStatus.READY, DeliveryState.ASSIGNED).title).toBe("Delivery partner assigned");
    expect(customerFacingStatus(OrderStatus.READY, DeliveryState.PICKED_UP).title).toBe("Picked up");
    expect(customerFacingStatus(OrderStatus.OUT_FOR_DELIVERY, DeliveryState.ARRIVED).title).toBe("Near you");
    expect(customerFacingStatus(OrderStatus.COMPLETED, DeliveryState.DELIVERED).title).toBe("Delivered");
  });

  it("prioritises cancellation over any delivery stage", () => {
    expect(customerFacingStatus(OrderStatus.CANCELLED, DeliveryState.ON_THE_WAY).title).toBe("Cancelled");
  });
});

describe("pickup requires READY (hard business rule)", () => {
  it("refuses pickup while the kitchen is still working, whatever the flag", () => {
    for (const status of ["new", "confirmed", "preparing", ""]) {
      expect(pickupProblem({ status }, false)).toMatch(/not marked this order ready/);
      expect(pickupProblem({ status }, true)).toMatch(/not marked this order ready/);
    }
  });

  it("allows pickup of a READY order when the release gate is off", () => {
    expect(pickupProblem({ status: "ready" }, false)).toBeNull();
    expect(pickupProblem({ status: "Prepared" }, false)).toBeNull();
  });

  it("still demands an explicit release when the gate is on", () => {
    expect(pickupProblem({ status: "ready" }, true)).toMatch(/not released/);
    expect(pickupProblem({ status: "ready_for_pickup" }, true)).toBeNull();
    expect(pickupProblem({ status: "ready", releasedForPickupAt: 1 }, true)).toBeNull();
  });
});

describe("scheduled orders dispatch near their slot", () => {
  const now = Date.UTC(2026, 8, 14, 10, 0);
  const inMin = (m: number) => ({ toMillis: () => now + m * 60_000 });

  it("holds a rider while the slot is far away", () => {
    expect(scheduledDispatchHold({ scheduledFor: inMin(180) }, now)).toBe(true);
    expect(scheduledDispatchHold({ scheduledFor: inMin(SCHEDULED_DISPATCH_LEAD_MIN + 1) }, now)).toBe(true);
  });

  it("releases dispatch inside the lead window or once overdue", () => {
    expect(scheduledDispatchHold({ scheduledFor: inMin(SCHEDULED_DISPATCH_LEAD_MIN) }, now)).toBe(false);
    expect(scheduledDispatchHold({ scheduledFor: inMin(-10) }, now)).toBe(false);
  });

  it("never holds an order without a valid slot", () => {
    expect(scheduledDispatchHold({}, now)).toBe(false);
    expect(scheduledDispatchHold({ scheduledFor: "soon" }, now)).toBe(false);
  });
});

/**
 * Ops overrides. The admin console used to write `deliveryStatus` straight onto
 * the order with no checks at all, and mapped "arrived" to status:"completed" —
 * terminating the order so the rider's completeDelivery (OTP + payout) could
 * never run. Admins go through advanceDeliveryStage now, and these are the only
 * extra powers they get over a rider: skipping forward, never rewinding, and
 * never landing on DELIVERED.
 */
describe("canAdminForceStage", () => {
  it("lets ops skip ahead to catch up with a rider who never tapped", () => {
    // The rider collected and left without tapping either stage.
    expect(canAdminForceStage(DeliveryState.ASSIGNED, DeliveryState.ON_THE_WAY)).toBe(true);
    expect(canAdminForceStage(DeliveryState.ASSIGNED, DeliveryState.ARRIVED)).toBe(true);
    expect(canAdminForceStage(DeliveryState.OFFERED, DeliveryState.ASSIGNED)).toBe(true);
  });

  it("still allows the ordinary single step", () => {
    expect(canAdminForceStage(DeliveryState.AT_RESTAURANT, DeliveryState.PICKED_UP)).toBe(true);
    expect(canAdminForceStage(DeliveryState.ON_THE_WAY, DeliveryState.ARRIVED)).toBe(true);
  });

  it("refuses DELIVERED from every stage — that is completeDelivery's alone", () => {
    for (const from of [
      DeliveryState.UNASSIGNED,
      DeliveryState.ASSIGNED,
      DeliveryState.AT_RESTAURANT,
      DeliveryState.PICKED_UP,
      DeliveryState.ON_THE_WAY,
      DeliveryState.ARRIVED,
    ]) {
      expect(canAdminForceStage(from, DeliveryState.DELIVERED)).toBe(false);
    }
  });

  it("refuses a rewind: un-picking-up food the rider is carrying", () => {
    expect(canAdminForceStage(DeliveryState.PICKED_UP, DeliveryState.AT_RESTAURANT)).toBe(false);
    expect(canAdminForceStage(DeliveryState.ARRIVED, DeliveryState.ON_THE_WAY)).toBe(false);
    expect(canAdminForceStage(DeliveryState.ASSIGNED, DeliveryState.UNASSIGNED)).toBe(false);
  });

  it("refuses a no-op and anything off the board", () => {
    expect(canAdminForceStage(DeliveryState.PICKED_UP, DeliveryState.PICKED_UP)).toBe(false);
    expect(canAdminForceStage(DeliveryState.CANCELLED, DeliveryState.ASSIGNED)).toBe(false);
    expect(canAdminForceStage(DeliveryState.ASSIGNED, DeliveryState.CANCELLED)).toBe(false);
    expect(canAdminForceStage(DeliveryState.ASSIGNED, DeliveryState.REASSIGNMENT_REQUIRED)).toBe(false);
    expect(canAdminForceStage("", DeliveryState.ASSIGNED)).toBe(false);
    expect(canAdminForceStage(DeliveryState.ASSIGNED, "teleported")).toBe(false);
  });

  it("never grants a rider-illegal BACKWARD move that canRiderTransition also refuses", () => {
    // Admin power is strictly "skip forward"; the forward chain itself is the
    // same shape the rider walks.
    const chain = [
      DeliveryState.ASSIGNED,
      DeliveryState.AT_RESTAURANT,
      DeliveryState.PICKED_UP,
      DeliveryState.ON_THE_WAY,
      DeliveryState.ARRIVED,
    ];
    for (let i = 0; i < chain.length; i++) {
      for (let j = 0; j <= i; j++) {
        expect(canAdminForceStage(chain[i], chain[j])).toBe(false);
      }
    }
  });
});
