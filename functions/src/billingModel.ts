import * as admin from "firebase-admin";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Billing model — how a merchant pays Kada. The two models are ALTERNATIVES,
 * never both.
 *
 *   commission   → Kada takes a % of every settled order. No platform fee.
 *   subscription → the merchant pays a flat recurring fee; commission is 0.
 *
 * Before this existed, commission was applied unconditionally while
 * subscriptions separately gated app access — so a merchant paying a
 * subscription ALSO had commission deducted from every settlement.
 *
 * DEFAULT IS `commission` when the field is absent, which reproduces the
 * existing behaviour exactly. Switching a merchant to `subscription` is an
 * explicit admin action.
 * ─────────────────────────────────────────────────────────────────────────
 */
export type BillingModel = "commission" | "subscription";

export const BILLING_MODELS: BillingModel[] = ["commission", "subscription"];

/** Resolve a merchant document's billing model (defaults to commission). */
export function billingModelOf(doc: { billingModel?: unknown } | undefined): BillingModel {
  const v = (doc?.billingModel ?? "").toString().toLowerCase();
  return v === "subscription" ? "subscription" : "commission";
}

/**
 * The commission rate to actually apply for this merchant.
 * Subscription merchants are charged 0% — they already pay a flat fee.
 */
export function effectiveCommissionRate(
  doc: (Record<string, unknown> & { billingModel?: unknown }) | undefined,
  configuredRate: number,
): { rate: number; model: BillingModel; waived: boolean; lapsed: boolean } {
  const model = billingModelOf(doc);
  if (model === "subscription") {
    // A LAPSED subscription must not keep earning a 0% rate — that would be a
    // free ride on the platform. If the subscription is no longer active we
    // fall back to charging commission and flag it, so revenue never leaks
    // silently while someone forgets to renew.
    if (!hasActiveSubscription(doc as Record<string, unknown> | undefined)) {
      return { rate: configuredRate, model, waived: false, lapsed: true };
    }
    return { rate: 0, model, waived: true, lapsed: false };
  }
  return { rate: configuredRate, model, waived: false, lapsed: false };
}

/**
 * Audit fields stamped on every settlement so a payout can always be explained:
 * which model was in force, the configured rate, and whether it was waived.
 * Without this, a 0% settlement is indistinguishable from a bug.
 */
export function billingAudit(
  model: BillingModel,
  configuredRate: number,
  waived: boolean,
  lapsed = false,
): Record<string, unknown> {
  return {
    billingModel: model,
    configuredCommissionRate: configuredRate,
    commissionWaived: waived,
    ...(waived
      ? { commissionWaivedReason: "Merchant is on the subscription plan" }
      : {}),
    ...(lapsed
      ? {
          subscriptionLapsed: true,
          commissionChargedReason:
            "Subscription is not active — commission charged instead",
        }
      : {}),
  };
}

/** Is this merchant's subscription currently valid? */
export function hasActiveSubscription(doc: Record<string, unknown> | undefined): boolean {
  if (!doc) return false;
  const status = (doc.subscriptionStatus ?? "").toString().toLowerCase();
  // Trials were removed from the product: a merchant is either on a paid
  // subscription or on commission billing. A legacy `trial` status therefore
  // no longer waives commission.
  if (status === "active") {
    const raw = doc.subscriptionEndDate ?? doc.subscriptionExpiry;
    const ms =
      raw instanceof admin.firestore.Timestamp
        ? raw.toMillis()
        : typeof raw === "number"
          ? raw
          : raw
            ? Date.parse(String(raw))
            : 0;
    // No expiry recorded → treat as active (legacy docs).
    return !ms || ms > Date.now();
  }
  return false;
}
