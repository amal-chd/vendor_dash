import * as admin from "firebase-admin";
import { assertModuleEnabled } from "./featureFlags";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";

/**
 * Kada Gift Cards.
 *
 * `gift_cards/{cardId}`:
 *   code (16-digit, unique), pin (6-digit; doc readable ONLY by purchaser/admin —
 *   redemption always goes through the callable so recipients never read it),
 *   amount, theme, message, purchaserUid, purchaserName, status
 *   ('active' | 'redeemed' | 'void' | 'expired'), createdAt, expiresAt,
 *   redeemedByUid?, redeemedAt?
 *
 * Redeemed value credits `customer_users/{uid}.kadaMoney` — that field is
 * write-protected from clients by Firestore rules, so this function is the
 * only mint path.
 */

const THEMES = ["kada", "birthday", "thankyou", "anniversary", "congrats"];
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 10000;

export function randomDigits(n: number): string {
  // Unbiased digits from crypto randomness.
  let out = "";
  while (out.length < n) {
    const bytes = crypto.randomBytes(n * 2);
    for (const b of bytes) {
      if (b < 250 && out.length < n) out += String(b % 10);
    }
  }
  return out;
}

export const purchaseGiftCard = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  await assertModuleEnabled("giftCards", "Gift cards are unavailable right now.");

  const amount = Number(request.data?.amount);
  const theme = String(request.data?.theme || "kada").toLowerCase();
  const message = String(request.data?.message || "").slice(0, 200);

  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    throw new HttpsError(
      "invalid-argument",
      `Amount must be between ₹${MIN_AMOUNT} and ₹${MAX_AMOUNT}.`
    );
  }
  if (!THEMES.includes(theme)) {
    throw new HttpsError("invalid-argument", "Unknown card theme.");
  }

  const db = admin.firestore();

  // Generate a unique 16-digit code (retry on the vanishingly-rare collision).
  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomDigits(16);
    const clash = await db
      .collection("gift_cards")
      .where("code", "==", candidate)
      .limit(1)
      .get();
    if (clash.empty) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new HttpsError("internal", "Could not allocate a card code.");

  const pin = randomDigits(6);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + 365 * 24 * 3600 * 1000) // valid 1 year
  );

  const name =
    (request.auth?.token?.name as string | undefined) ??
    (request.auth?.token?.email as string | undefined)?.split("@")[0] ??
    "Kada customer";

  // Charge the purchaser's wallet for the card's value atomically — otherwise
  // a card could be "bought" for free and redeemed for real wallet credit.
  // (Fund the wallet via the Razorpay top-up first.)
  const amt = Math.round(amount);
  const cardRef = db.collection("gift_cards").doc();
  const userRef = db.collection("customer_users").doc(uid);

  await db.runTransaction(async (txn) => {
    const userSnap = await txn.get(userRef);
    const balance = Number(userSnap.data()?.walletBalance) || 0;
    if (balance < amt) {
      throw new HttpsError(
        "failed-precondition",
        `Add ₹${Math.ceil(amt - balance)} to your Kada wallet to buy this gift card.`
      );
    }
    const newBalance = balance - amt;
    txn.set(userRef, { walletBalance: newBalance }, { merge: true });
    txn.set(userRef.collection("wallet_transactions").doc(), {
      type: "giftcard_purchase",
      amount: -amt,
      title: "Gift card purchase",
      description: `Bought a ₹${amt} gift card`,
      balanceAfter: newBalance,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    txn.set(cardRef, {
      code,
      pin,
      amount: amt,
      theme,
      message,
      purchaserUid: uid,
      purchaserName: name,
      status: "active",
      createdAt: now,
      expiresAt,
      redeemedByUid: null,
      redeemedAt: null,
    });
  });

  return { cardId: cardRef.id, code, pin, amount: amt };
});

export const redeemGiftCard = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const code = String(request.data?.code || "").replace(/[\s-]/g, "");
  const pin = String(request.data?.pin || "").trim();
  if (!/^\d{16}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Enter the 16-digit card code.");
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new HttpsError("invalid-argument", "Enter the 6-digit PIN.");
  }

  const db = admin.firestore();
  const snap = await db
    .collection("gift_cards")
    .where("code", "==", code)
    .limit(1)
    .get();
  if (snap.empty) {
    throw new HttpsError("not-found", "We couldn't find a card with that code.");
  }
  const cardRef = snap.docs[0].ref;

  const result = await db.runTransaction(async (txn) => {
    const cardSnap = await txn.get(cardRef);
    const card = cardSnap.data() || {};

    if (card.pin !== pin) {
      throw new HttpsError("permission-denied", "Incorrect PIN for this card.");
    }
    if (card.status === "redeemed") {
      throw new HttpsError(
        "failed-precondition",
        "This gift card has already been claimed."
      );
    }
    if (card.status !== "active") {
      throw new HttpsError("failed-precondition", "This gift card is not active.");
    }
    const expiresAt = card.expiresAt as admin.firestore.Timestamp | undefined;
    if (expiresAt && expiresAt.toMillis() < Date.now()) {
      txn.update(cardRef, { status: "expired" });
      throw new HttpsError("failed-precondition", "This gift card has expired.");
    }

    const amount = Number(card.amount) || 0;
    const userRef = db.collection("customer_users").doc(uid);
    const userSnap = await txn.get(userRef);
    // Credits the shared app wallet (walletBalance) so gift-card value is
    // immediately spendable at checkout like any other wallet money.
    const balance = Number(userSnap.data()?.walletBalance) || 0;
    const newBalance = balance + amount;

    txn.set(
      userRef,
      { walletBalance: newBalance },
      { merge: true }
    );
    txn.update(cardRef, {
      status: "redeemed",
      redeemedByUid: uid,
      redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { amount, newBalance };
  });

  return { ok: true, ...result };
});
