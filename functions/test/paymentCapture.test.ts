import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STRAY_OUTCOMES,
  decideFoodPayment,
  expectedOrderPaise,
  signatureMatches,
  strayPaymentMessage,
} from "../src/paymentCapture";
import { decideStayPayment } from "../src/pricing/stayCallables";

const pay = (amountPaise: number, paymentId = "pay_1") => ({ paymentId, amountPaise });
const engineOrder = (over: Record<string, unknown> = {}) => ({
  status: "new",
  paymentStatus: "pending",
  paymentMethod: "razorpay",
  total: 250,
  pricing: { engineVersion: "2026.09", totals: { totalPaise: 25_000 } },
  ...over,
});

describe("food order payments", () => {
  it("applies a full payment to an open order", () => {
    expect(decideFoodPayment(engineOrder(), pay(25_000))).toBe("paid");
    expect(decideFoodPayment(engineOrder({ status: "draft" }), pay(25_000))).toBe("paid");
  });

  it("treats the same payment reported twice (app + webhook) as already applied", () => {
    const o = engineOrder({ paymentStatus: "paid", razorpayPaymentId: "pay_1" });
    expect(decideFoodPayment(o, pay(25_000, "pay_1"))).toBe("already_paid");
  });

  it("refunds a second, different payment for an already-paid order", () => {
    const o = engineOrder({ paymentStatus: "paid", razorpayPaymentId: "pay_1" });
    expect(decideFoodPayment(o, pay(25_000, "pay_2"))).toBe("duplicate");
  });

  it("refunds money that arrives after the order was cancelled", () => {
    for (const status of ["cancelled", "canceled", "rejected", "expired"]) {
      expect(decideFoodPayment(engineOrder({ status }), pay(25_000)), status).toBe("closed");
    }
  });

  it("keeps a late payment for food that was actually delivered", () => {
    expect(decideFoodPayment(engineOrder({ status: "delivered" }), pay(25_000))).toBe("paid_after_fulfilment");
  });

  it("refunds a short payment, allowing only ₹1 of rounding", () => {
    expect(decideFoodPayment(engineOrder(), pay(24_950))).toBe("paid");
    expect(decideFoodPayment(engineOrder(), pay(24_800))).toBe("underpaid");
  });

  it("refunds a payment for an order that doesn't exist", () => {
    expect(decideFoodPayment(null, pay(100))).toBe("missing");
  });

  it("prices engine orders from the snapshot, legacy ones from the rupee total", () => {
    expect(expectedOrderPaise(engineOrder({ total: 1 }))).toBe(25_000);
    expect(expectedOrderPaise({ total: 199.99 })).toBe(19_999);
    expect(expectedOrderPaise({ totalAmount: 50 })).toBe(5_000);
  });

  it("refunds exactly the outcomes where the customer gets nothing for the money", () => {
    expect([...STRAY_OUTCOMES].sort()).toEqual(["closed", "duplicate", "missing", "underpaid"]);
  });

  it("tells the customer what happened and when the money returns", () => {
    expect(strayPaymentMessage("closed", 25_000)).toMatch(/closed before your payment.*₹250 .*5–7 working days/);
    expect(strayPaymentMessage("duplicate", 12_345)).toContain("₹123.45");
  });
});

describe("stay booking payments", () => {
  const booking = (over: Record<string, unknown> = {}) => ({
    status: "pending_payment",
    paymentStatus: "pending",
    pricing: { totals: { totalPaise: 300_000 } },
    ...over,
  });

  it("confirms a full payment, refunds everything else", () => {
    expect(decideStayPayment(booking(), pay(300_000))).toBe("paid");
    expect(decideStayPayment(booking({ paymentStatus: "paid", razorpayPaymentId: "pay_1" }), pay(300_000))).toBe("already_paid");
    expect(decideStayPayment(booking({ paymentStatus: "paid", razorpayPaymentId: "pay_1" }), pay(300_000, "pay_2"))).toBe("duplicate");
    expect(decideStayPayment(booking({ status: "cancelled", paymentStatus: "expired" }), pay(300_000))).toBe("closed");
    expect(decideStayPayment(booking(), pay(299_999))).toBe("underpaid");
    expect(decideStayPayment(null, pay(1))).toBe("missing");
  });
});

describe("checkout signature", () => {
  const secret = "test_secret";
  const sign = (o: string, p: string) => crypto.createHmac("sha256", secret).update(`${o}|${p}`).digest("hex");

  it("accepts Razorpay's signature and rejects anything else", () => {
    expect(signatureMatches(secret, "order_A", "pay_B", sign("order_A", "pay_B"))).toBe(true);
    expect(signatureMatches(secret, "order_A", "pay_C", sign("order_A", "pay_B"))).toBe(false);
    expect(signatureMatches(secret, "order_A", "pay_B", "short")).toBe(false);
    expect(signatureMatches("other", "order_A", "pay_B", sign("order_A", "pay_B"))).toBe(false);
  });
});

describe("gateway order hygiene", () => {
  const src = readFileSync(join(__dirname, "..", "src", "payments.ts"), "utf8");
  const create = src.slice(src.indexOf("export const createRazorpayOrder"), src.indexOf("export const verifyRazorpayPayment"));

  it("never lets the app choose the amount, context or notes of a food payment", () => {
    expect(create).not.toMatch(/request\.data\?\.(amount|context|notes)/);
    expect(create).toContain('payment_context: "FOOD_ORDER"');
  });

  it("wallet top-ups are credited by the webhook using the gateway order id", () => {
    const hook = readFileSync(join(__dirname, "..", "src", "razorpayWebhook.ts"), "utf8");
    expect(hook).toContain("creditWalletTopup(String(paymentEntity.order_id)");
  });
});
