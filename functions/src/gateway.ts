import { logger } from "firebase-functions";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./refunds";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Small Razorpay REST helpers shared by the webhook, the payment sweep and
 * the refund engine. Callers must bind RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET
 * on their function.
 * ─────────────────────────────────────────────────────────────────────────
 */

const API = "https://api.razorpay.com/v1";

export function razorpayBasicAuth(): string | null {
  let keyId = "";
  let keySecret = "";
  try {
    keyId = RAZORPAY_KEY_ID.value() || process.env.RAZORPAY_KEY_ID || "";
    keySecret = RAZORPAY_KEY_SECRET.value() || process.env.RAZORPAY_KEY_SECRET || "";
  } catch {
    keyId = process.env.RAZORPAY_KEY_ID || "";
    keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  }
  return keyId && keySecret ? Buffer.from(`${keyId}:${keySecret}`).toString("base64") : null;
}

/** GET a Razorpay resource; null when it couldn't be read (caller retries later). */
export async function razorpayGet<T>(path: string): Promise<T | null> {
  const basic = razorpayBasicAuth();
  if (!basic) return null;
  try {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) {
      logger.warn("razorpayGet failed", { path, status: res.status });
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    logger.warn("razorpayGet error", { path, e: String(e) });
    return null;
  }
}

/**
 * Capture an authorized payment. Razorpay voids (and returns to the customer)
 * any payment left `authorized` for a few days, so a payment we intend to keep
 * must be captured — normally the account's auto-capture setting does this,
 * this is the backstop when it is off or delayed.
 *
 * Returns true when the payment is captured (now or already).
 */
export async function capturePayment(paymentId: string, amountPaise: number, currency = "INR"): Promise<boolean> {
  const basic = razorpayBasicAuth();
  if (!basic || !paymentId || !(amountPaise > 0)) return false;
  try {
    const res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency }),
    });
    if (res.ok) return true;
    const text = await res.text();
    // Already captured (webhook vs sweep race) is success, not an error.
    if (/already been captured/i.test(text)) return true;
    logger.warn("capturePayment failed", { paymentId, status: res.status, body: text.slice(0, 300) });
    return false;
  } catch (e) {
    logger.warn("capturePayment error", { paymentId, e: String(e) });
    return false;
  }
}

/**
 * A gateway receipt that is unique per attempt. Razorpay treats `receipt` as
 * an idempotency key and rejects a second order with the same value
 * ("Duplicate request"), so a receipt derived only from our own id makes every
 * retry after the first gateway order fail.
 */
export function uniqueReceipt(prefix: string): string {
  const suffix = `_${Date.now().toString(36)}`;
  return `${prefix.slice(0, 40 - suffix.length)}${suffix}`;
}
