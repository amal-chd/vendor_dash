import { describe, expect, it } from "vitest";
import { alreadyParked } from "../src/delivery";

describe("re-parking an order with no rider available", () => {
  it("is skipped when the order is already parked with a clean round", () => {
    expect(alreadyParked({ deliveryStatus: "unassigned", offer: { riderId: "", expiresAt: null, attemptedRiderIds: [] } })).toBe(true);
    expect(alreadyParked({ deliveryStatus: "unassigned" })).toBe(true);
  });

  it("still writes when something would change", () => {
    expect(alreadyParked({ deliveryStatus: "offered", offer: { riderId: "r1" } })).toBe(false);
    expect(alreadyParked({ deliveryStatus: "unassigned", offer: { riderId: "", attemptedRiderIds: ["r1"] } })).toBe(false);
  });
});
