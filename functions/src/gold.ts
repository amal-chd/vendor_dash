import * as admin from "firebase-admin";
import { assertModuleEnabled } from "./featureFlags";
import { onCall, HttpsError } from "firebase-functions/v2/https";

/**
 * Kada Gold VIP membership, purchased with the customer's in-app wallet
 * (`customer_users/{uid}.walletBalance`). ₹99 buys 30 days; buying while already
 * a member extends from the current expiry. Membership state lives on the user
 * doc as `isGold` + `goldUntil` (Timestamp) so clients can gate benefits.
 */

interface Plan {
  price: number;
  days: number;
  name: string;
}

const PLANS: Record<string, Plan> = {
  "1_month": { price: 99, days: 30, name: "1 Month VIP" },
  "3_months": { price: 249, days: 90, name: "3 Months VIP" },
  "12_months": { price: 799, days: 365, name: "1 Year VIP" },
};

async function loadGoldPlans(): Promise<Record<string, Plan>> {
  try {
    const snap = await admin.firestore().collection("config").doc("loyalty").get();
    const d = snap.data() ?? {};
    return {
      "1_month": { price: Number(d.goldMonthlyPrice) || 99, days: 30, name: "1 Month VIP" },
      "3_months": { price: Number(d.goldQuarterlyPrice) || 249, days: 90, name: "3 Months VIP" },
      "12_months": { price: Number(d.goldYearlyPrice) || 799, days: 365, name: "1 Year VIP" },
    };
  } catch {
    return PLANS;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const purchaseGoldMembership = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to join Kada Gold.");
  }
  await assertModuleEnabled("kadaGold", "Kada Gold isn't open for new memberships right now.");

  const planId = (request.data?.planId as string) || "1_month";
  const plans = await loadGoldPlans();
  const plan = plans[planId] || plans["1_month"];

  const db = admin.firestore();
  const userRef = db.collection("customer_users").doc(uid);

  const result = await db.runTransaction(async (txn) => {
    const snap = await txn.get(userRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Your profile could not be found.");
    }
    const data = snap.data() ?? {};
    const balance = Number(data.walletBalance) || 0;
    if (balance < plan.price) {
      const shortBy = Math.ceil(plan.price - balance);
      throw new HttpsError(
        "failed-precondition",
        `Add ₹${shortBy} to your wallet to join Kada Gold.`
      );
    }

    // Extend from the later of now / existing expiry.
    const now = Date.now();
    const existingMs =
      data.goldUntil instanceof admin.firestore.Timestamp
        ? data.goldUntil.toMillis()
        : 0;
    const base = Math.max(now, existingMs);
    const untilMs = base + plan.days * DAY_MS;
    const goldUntil = admin.firestore.Timestamp.fromMillis(untilMs);
    const newBalance = balance - plan.price;

    txn.update(userRef, {
      walletBalance: newBalance,
      isGold: true,
      goldUntil,
      goldUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add transaction record
    const txRef = userRef.collection("wallet_transactions").doc();
    txn.set(txRef, {
      type: "gold_subscription",
      amount: -plan.price,
      title: `Kada Gold (${plan.name})`,
      description: `Purchased ${plan.name} for ₹${plan.price}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { newBalance, goldUntil: untilMs, planName: plan.name };
  });

  return { ok: true, ...result };
});
