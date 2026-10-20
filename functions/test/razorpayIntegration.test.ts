import { describe, it, expect } from "vitest";
import { webhookEventId } from "../src/razorpayWebhook";
import { uniqueReceipt } from "../src/gateway";

// A real Razorpay delivery: the body has NO top-level `id` — the event id
// arrives only in the x-razorpay-event-id header. Reading payload.id rejected
// every production event with a 400.
const realBody = {
  entity: "event",
  account_id: "acc_X",
  event: "payment.captured",
  contains: ["payment"],
  payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 1000 } } },
  created_at: 1700000000,
};

describe("webhookEventId", () => {
  it("uses the x-razorpay-event-id header", () => {
    expect(webhookEventId("evt_abc", realBody, JSON.stringify(realBody))).toBe("evt_abc");
  });
  it("never fails a real delivery that lacks a body id", () => {
    const id = webhookEventId(undefined, realBody, JSON.stringify(realBody));
    expect(id).toMatch(/^body_[0-9a-f]{40}$/);
  });
  it("is stable for a redelivery of the same body (dedupes)", () => {
    const raw = JSON.stringify(realBody);
    expect(webhookEventId(undefined, realBody, raw)).toBe(webhookEventId(undefined, realBody, raw));
  });
  it("takes the first header value when repeated", () => {
    expect(webhookEventId(["evt_1", "evt_2"], realBody, "")).toBe("evt_1");
  });
});

describe("uniqueReceipt", () => {
  it("fits Razorpay's 40-char limit even for long ids", () => {
    expect(uniqueReceipt("x".repeat(80)).length).toBeLessThanOrEqual(40);
  });
  it("differs between attempts for the same order", async () => {
    const a = uniqueReceipt("order123");
    await new Promise((r) => setTimeout(r, 2));
    expect(uniqueReceipt("order123")).not.toBe(a);
  });
});
