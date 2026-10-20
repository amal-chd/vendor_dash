import { describe, it, expect } from "vitest";
import {
  canVendorTransition,
  clampPrepMinutes,
  customerCancelProblem,
  isAwaitingOnlinePayment,
  isCounterOrder,
  isOrderHeld,
  orderReleased,
  eventKey,
  isRefundableOnCancel,
  refundAmountRupees,
  requiredPermissions,
  resolveStaffPermissions,
  toPaise,
  transitionProblem,
} from "../src/vendorOrderRules";

/**
 * Locks the vendor order state machine. firestore.rules mirrors this matrix
 * (vendorCanMoveOrder) — if a case changes here, change the rules too.
 */
describe("vendor order transitions", () => {
  it("allows the forward chain", () => {
    expect(canVendorTransition("new", "confirmed")).toBe(true);
    expect(canVendorTransition("confirmed", "preparing")).toBe(true);
    expect(canVendorTransition("preparing", "ready")).toBe(true);
    expect(canVendorTransition("ready", "ready_for_pickup")).toBe(true);
    expect(canVendorTransition("ready", "completed")).toBe(true);
  });

  it("allows accepting straight into preparing", () => {
    expect(canVendorTransition("new", "preparing")).toBe(true);
    expect(canVendorTransition("scheduled", "preparing")).toBe(true);
  });

  it("refuses backwards moves", () => {
    expect(canVendorTransition("preparing", "new")).toBe(false);
    expect(canVendorTransition("ready", "preparing")).toBe(false);
    expect(canVendorTransition("ready_for_pickup", "ready")).toBe(false);
  });

  it("refuses re-opening a closed order (the stale-device resurrection race)", () => {
    for (const closed of ["completed", "cancelled", "rejected", "delivered"]) {
      expect(canVendorTransition(closed, "preparing")).toBe(false);
      expect(canVendorTransition(closed, "confirmed")).toBe(false);
    }
    expect(transitionProblem({ status: "cancelled" }, "preparing")).toMatch(/already Cancelled/);
  });

  it("treats READY as a hard gate before release", () => {
    expect(canVendorTransition("preparing", "ready_for_pickup")).toBe(false);
    expect(canVendorTransition("new", "ready_for_pickup")).toBe(false);
  });

  it("only allows rejecting an order that has not been accepted", () => {
    expect(canVendorTransition("new", "rejected")).toBe(true);
    expect(canVendorTransition("preparing", "rejected")).toBe(false);
    expect(canVendorTransition("preparing", "cancelled")).toBe(true);
  });

  it("lets an accepted in-store order close without a READY step (served at the table)", () => {
    expect(canVendorTransition("preparing", "completed", { inStore: true })).toBe(true);
    expect(transitionProblem({ status: "preparing", orderSource: "pos", type: "dine-in" }, "completed")).toBeNull();
    // Untagged staff-created ticket (web POS before tagging).
    expect(transitionProblem({ status: "preparing", type: "dine-in" }, "completed")).toBeNull();
  });

  it("still requires READY before completing a customer-app order", () => {
    expect(canVendorTransition("preparing", "completed")).toBe(false);
    expect(canVendorTransition("new", "completed", { inStore: true })).toBe(false);
    expect(
      transitionProblem(
        { status: "preparing", orderSource: "delivery_app", customerUid: "c1", type: "takeaway" },
        "completed",
      ),
    ).toMatch(/can't be moved/);
    // Untagged but customer-owned legacy order is still a marketplace order.
    expect(transitionProblem({ status: "preparing", userId: "c1", type: "takeaway" }, "completed")).toMatch(
      /can't be moved/,
    );
  });

  it("refuses restaurant completion of a delivery order", () => {
    expect(transitionProblem({ status: "ready", type: "delivery" }, "completed")).toMatch(
      /delivery partner/,
    );
    expect(transitionProblem({ status: "ready", type: "takeaway" }, "completed")).toBeNull();
  });

  it("refuses releasing a non-delivery order", () => {
    expect(transitionProblem({ status: "ready", type: "takeaway" }, "ready_for_pickup")).toMatch(
      /Only delivery orders/,
    );
  });

  it("rejects unknown actions and states nothing changed", () => {
    expect(transitionProblem({ status: "new" }, "teleported")).toMatch(/not a valid/);
    expect(transitionProblem({ status: "preparing" }, "new")).toMatch(/Nothing was changed/);
  });

  it("normalises legacy casing", () => {
    expect(canVendorTransition("New", "Preparing")).toBe(true);
    expect(canVendorTransition(undefined, "confirmed")).toBe(true);
  });
});

describe("refunds on cancel/reject", () => {
  const paidOnline = { paymentStatus: "paid", orderSource: "delivery_app", total: 540 };

  it("refunds the full total of a platform-paid order", () => {
    expect(isRefundableOnCancel(paidOnline)).toBe(true);
    expect(refundAmountRupees(paidOnline)).toBe(540);
  });

  it("treats untagged legacy customer orders as platform-paid", () => {
    expect(refundAmountRupees({ paymentStatus: "paid", total: 200, customerUid: "c1" })).toBe(200);
    expect(refundAmountRupees({ paymentStatus: "paid", total: 200, userId: "c1" })).toBe(200);
  });

  it("never refunds a staff-created untagged ticket with no customer (web POS)", () => {
    expect(refundAmountRupees({ paymentStatus: "paid", total: 200 })).toBe(0);
    // null is a present value, same as firestore.rules — stays marketplace.
    expect(refundAmountRupees({ paymentStatus: "paid", total: 200, customerUid: null })).toBe(200);
  });

  it("never refunds in-store POS or QR orders (settled at the counter)", () => {
    expect(refundAmountRupees({ ...paidOnline, orderSource: "pos" })).toBe(0);
    expect(refundAmountRupees({ ...paidOnline, orderSource: "qr_menu" })).toBe(0);
  });

  it("never refunds an unpaid order", () => {
    expect(refundAmountRupees({ ...paidOnline, paymentStatus: "pending" })).toBe(0);
  });

  it("refunds only the remainder after a partial refund", () => {
    expect(refundAmountRupees({ ...paidOnline, refundAmount: 140 })).toBe(400);
    expect(refundAmountRupees({ ...paidOnline, refundAmount: 999 })).toBe(0);
  });

  it("converts to paise without float drift", () => {
    expect(toPaise(540)).toBe(54000);
    expect(toPaise(199.99)).toBe(19999);
  });
});

describe("in-store classification (transitions, refunds, settlements)", () => {
  it("classifies tagged POS/QR and staff-created tickets as in-store", () => {
    expect(isCounterOrder({ orderSource: "pos" })).toBe(true);
    expect(isCounterOrder({ orderSource: "qr_menu" })).toBe(true);
    expect(isCounterOrder({ type: "dine-in", total: 300 })).toBe(true);
  });

  it("never classifies a customer or marketplace order as in-store", () => {
    expect(isCounterOrder({ orderSource: "delivery_app", customerUid: "c1" })).toBe(false);
    expect(isCounterOrder({ customerUid: "c1" })).toBe(false);
    expect(isCounterOrder({ userId: "c1" })).toBe(false);
    expect(isCounterOrder({ orderSource: "web_delivery" })).toBe(false);
  });
});

describe("online orders wait for payment", () => {
  const online = { orderSource: "delivery_app", customerUid: "c1", status: "new" };

  it("holds an unpaid Razorpay or wallet order", () => {
    expect(isAwaitingOnlinePayment({ ...online, paymentMethod: "razorpay", paymentStatus: "pending" })).toBe(true);
    expect(isAwaitingOnlinePayment({ ...online, paymentMethod: "wallet", paymentStatus: "pending" })).toBe(true);
    expect(isAwaitingOnlinePayment({ ...online, status: "draft", paymentMethod: "razorpay" })).toBe(true);
  });

  it("releases it once paid, and never holds cash on delivery", () => {
    expect(isAwaitingOnlinePayment({ ...online, paymentMethod: "razorpay", paymentStatus: "paid" })).toBe(false);
    expect(isAwaitingOnlinePayment({ ...online, paymentMethod: "cod", paymentStatus: "pending" })).toBe(false);
  });

  it("ignores counter tickets and orders already in the kitchen or closed", () => {
    expect(isAwaitingOnlinePayment({ orderSource: "pos", status: "new", paymentMethod: "razorpay", paymentStatus: "pending" })).toBe(false);
    expect(isAwaitingOnlinePayment({ ...online, status: "preparing", paymentMethod: "razorpay", paymentStatus: "pending" })).toBe(false);
    expect(isAwaitingOnlinePayment({ ...online, status: "cancelled", paymentMethod: "razorpay", paymentStatus: "pending" })).toBe(false);
  });
});

describe("orders go live only once they're real", () => {
  const cod = { orderSource: "delivery_app", customerUid: "c1", status: "new", paymentMethod: "cod" };
  const online = { ...cod, paymentMethod: "razorpay", paymentStatus: "pending" };

  it("holds a cash order until its pricing check passes", () => {
    expect(isOrderHeld(cod)).toBe(true);
    const vetted = { ...cod, pricingCheck: { ok: true } };
    expect(isOrderHeld(vetted)).toBe(false);
    expect(orderReleased(cod, vetted)).toBe(true);
  });

  it("releases an online order when paid, not when merely priced", () => {
    const priced = { ...online, pricingCheck: { ok: true } };
    expect(orderReleased(online, priced)).toBe(false);
    expect(orderReleased(priced, { ...priced, paymentStatus: "paid" })).toBe(true);
  });

  it("never re-announces an order the restaurant acts on", () => {
    expect(orderReleased(cod, { ...cod, status: "preparing" })).toBe(false);
  });

  it("never releases a cancelled order", () => {
    expect(orderReleased(cod, { ...cod, status: "cancelled", pricingCheck: { ok: false } })).toBe(false);
    expect(orderReleased(online, { ...online, status: "cancelled", paymentStatus: "paid" })).toBe(false);
  });

  it("never holds counter tickets", () => {
    expect(isOrderHeld({ orderSource: "pos", status: "new", paymentMethod: "cash" })).toBe(false);
  });
});

describe("customer cancellation window", () => {
  it("lets a customer cancel before the restaurant accepts", () => {
    for (const status of ["new", "pending", "placed", "scheduled", "draft", undefined]) {
      expect(customerCancelProblem({ status })).toBeNull();
    }
  });

  it("closes once the kitchen has started", () => {
    for (const status of ["confirmed", "preparing", "ready", "ready_for_pickup", "out_for_delivery"]) {
      expect(customerCancelProblem({ status })).toMatch(/Contact support/);
    }
  });

  it("refuses an order that is already closed", () => {
    expect(customerCancelProblem({ status: "delivered" })).toMatch(/already Delivered/);
    expect(customerCancelProblem({ status: "rejected" })).toMatch(/already Rejected/);
  });
});

describe("staff permissions", () => {
  it("gives a chef kitchen access but no finances", () => {
    const chef = resolveStaffPermissions({ role: "Chef" });
    expect(chef.has("kitchen")).toBe(true);
    expect(chef.has("expenses")).toBe(false);
  });

  it("gives an unknown or blank role nothing (the client used to grant Admin)", () => {
    expect(resolveStaffPermissions({ role: "" }).size).toBe(0);
    expect(resolveStaffPermissions({ role: "Sous Chef" }).size).toBe(0);
    expect(resolveStaffPermissions({}).size).toBe(0);
  });

  it("lets an explicit permission list override the role preset", () => {
    const p = resolveStaffPermissions({ role: "Admin", permissions: ["kitchen"] });
    expect([...p]).toEqual(["kitchen"]);
  });

  it("maps actions to any-of permission sets", () => {
    expect(requiredPermissions("preparing")).toEqual(["orders", "kitchen"]);
    expect(requiredPermissions("rejected")).toEqual(["orders"]);
    expect(requiredPermissions("completed")).toEqual(["orders", "pos"]);
  });
});

describe("helpers", () => {
  it("clamps prep minutes to a sane window", () => {
    expect(clampPrepMinutes(undefined)).toBe(20);
    expect(clampPrepMinutes(0)).toBe(20);
    expect(clampPrepMinutes(-5)).toBe(20);
    expect(clampPrepMinutes(999)).toBe(180);
    expect(clampPrepMinutes("25")).toBe(25);
  });

  it("uses deterministic event keys, shared with releaseOrderForPickup", () => {
    expect(eventKey("o1", "preparing")).toBe("vendor_o1_preparing");
    expect(eventKey("o1", "ready_for_pickup")).toBe("released_o1");
  });
});
