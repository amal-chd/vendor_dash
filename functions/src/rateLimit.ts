/**
 * Per-caller rate limits for callables that cost money or can be spammed
 * (Gemini calls, payment order creation, cancellations). Nothing throttled
 * them before: one signed-in account could loop an AI endpoint or hammer the
 * payment gateway. App Check is the stronger layer and still needs console
 * setup; this bounds damage per account in the meantime.
 *
 * Fixed window, stored at `rate_limits/{key}` (no client rules = no client
 * access). The window arithmetic is pure and unit-tested.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

export interface WindowState {
  count: number;
  windowStartMs: number;
}

export interface WindowDecision {
  allowed: boolean;
  next: WindowState;
  retryAfterSec: number;
}

/** Decide whether one more call fits in the current window. */
export function windowDecision(
  state: WindowState | undefined,
  nowMs: number,
  limit: number,
  windowMs: number,
): WindowDecision {
  const fresh = !state || nowMs - state.windowStartMs >= windowMs || nowMs < state.windowStartMs;
  const current: WindowState = fresh ? { count: 0, windowStartMs: nowMs } : state;
  if (current.count >= limit) {
    return {
      allowed: false,
      next: current,
      retryAfterSec: Math.max(1, Math.ceil((current.windowStartMs + windowMs - nowMs) / 1000)),
    };
  }
  return { allowed: true, next: { count: current.count + 1, windowStartMs: current.windowStartMs }, retryAfterSec: 0 };
}

/**
 * Records one call against [key] and reports whether it fit. Fails OPEN on a
 * storage error: a limiter outage must never block a customer.
 */
export async function allowCall(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const db = admin.firestore();
  const ref = db.collection("rate_limits").doc(key.replace(/\//g, "_").slice(0, 400));
  try {
    const d = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const decision = windowDecision(snap.data() as WindowState | undefined, Date.now(), limit, windowMs);
      if (decision.allowed) {
        tx.set(ref, {
          ...decision.next,
          expireAt: admin.firestore.Timestamp.fromMillis(decision.next.windowStartMs + windowMs * 2),
        });
      }
      return decision;
    });
    return { allowed: d.allowed, retryAfterSec: d.retryAfterSec };
  } catch (e) {
    logger.warn("rate limiter unavailable; allowing call", { key, error: String(e) });
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Throws `resource-exhausted` when [key] has used [limit] calls in [windowMs].
 * Fails OPEN on a storage error: a limiter outage must never block a customer
 * from paying or cancelling.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = "You're doing that too often. Please wait a moment and try again.",
): Promise<void> {
  const decision = await allowCall(key, limit, windowMs);
  if (!decision.allowed) {
    throw new HttpsError("resource-exhausted", `${message} (try again in ${decision.retryAfterSec}s)`, {
      retryAfterSec: decision.retryAfterSec,
    });
  }
}
