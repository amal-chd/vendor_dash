import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

/**
 * Kada Unified Referral Engine — v2
 *
 * Supports four participant types (customer, vendor, rider, host) with
 * configurable, admin-managed referral programs. All money and state is
 * server-only; clients never write referral data.
 *
 * Firestore collections:
 *   referral_codes/{CODE}          → { uid, participantType, createdAt }
 *   referrals/{id}                 → full referral lifecycle doc
 *   referral_programs/{programId}  → admin-configured program rules
 *   referral_events/{eventId}      → immutable audit log
 *   referral_fraud_signals/{id}    → flagged suspicious activity
 */

type ParticipantType = "customer" | "vendor" | "rider" | "host";

interface ReferralProgram {
  id: string;
  participantType: ParticipantType;
  name: string;
  active: boolean;
  referrerReward: number;
  refereeReward: number;
  rewardType: string;
  rewardCurrency: string;
  qualifyingAction: string;
  minOrderValue: number;
  maxRewardsPerUser: number;
  maxRewardsPerDay: number;
  maxRewardsPerMonth: number;
  cooldownDays: number;
  firstActionOnly: boolean;
  expiryDays: number;
  geoRestrictions: string[];
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

const PARTICIPANT_COLLECTIONS: Record<ParticipantType, string> = {
  customer: "customer_users",
  vendor: "restaurants",
  rider: "delivery_users",
  host: "stay_hosts",
};

const DEFAULT_REWARDS: Record<ParticipantType, { referrer: number; referee: number }> = {
  customer: { referrer: 50, referee: 50 },
  vendor: { referrer: 500, referee: 500 },
  rider: { referrer: 200, referee: 200 },
  host: { referrer: 500, referee: 500 },
};

const COMPLETED_STATUSES = new Set(["completed", "done", "delivered", "checked_out"]);
const isCompleted = (s: unknown): boolean =>
  typeof s === "string" && COMPLETED_STATUSES.has(s.toLowerCase());

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(len = 7): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function getActiveProgram(
  db: admin.firestore.Firestore,
  participantType: ParticipantType,
): Promise<ReferralProgram | null> {
  const snap = await db.collection("referral_programs")
    .where("participantType", "==", participantType)
    .where("active", "==", true)
    .limit(1)
    .get();
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() } as ReferralProgram;

  const flagSnap = await db.collection("config").doc("feature_flags").get();
  if (flagSnap.data()?.referrals === false) return null;

  const defaults = DEFAULT_REWARDS[participantType];
  return {
    id: `default_${participantType}`,
    participantType,
    name: `Default ${participantType} program`,
    active: true,
    referrerReward: defaults.referrer,
    refereeReward: defaults.referee,
    rewardType: "wallet_credit",
    rewardCurrency: "INR",
    qualifyingAction: "first_order",
    minOrderValue: 0,
    maxRewardsPerUser: 100,
    maxRewardsPerDay: 10,
    maxRewardsPerMonth: 50,
    cooldownDays: 0,
    firstActionOnly: true,
    expiryDays: 90,
    geoRestrictions: [],
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  };
}

async function logReferralEvent(
  db: admin.firestore.Firestore,
  referralId: string,
  event: string,
  details: Record<string, unknown>,
) {
  await db.collection("referral_events").add({
    referralId,
    event,
    details,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function sendReferralNotification(
  db: admin.firestore.Firestore,
  uid: string,
  userCollection: string,
  title: string,
  body: string,
  data?: Record<string, string>,
) {
  try {
    await db.collection(userCollection).doc(uid).collection("notifications").add({
      title,
      body,
      type: "referral",
      read: false,
      data: data || {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const userDoc = await db.collection(userCollection).doc(uid).get();
    const fcmToken = userDoc.data()?.fcmToken || userDoc.data()?.deviceToken;
    if (fcmToken) {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: { type: "referral", ...(data || {}) },
      }).catch(() => {});
    }
  } catch (_) { /* ignore */ }
}

async function checkFraudSignals(
  db: admin.firestore.Firestore,
  referrerUid: string,
  refereeUid: string,
  participantType: ParticipantType,
): Promise<{ score: number; flags: string[] }> {
  const flags: string[] = [];
  let score = 0;
  const referrerCol = PARTICIPANT_COLLECTIONS[participantType];

  try {
    const [referrerDoc, refereeDoc] = await Promise.all([
      db.collection(referrerCol).doc(referrerUid).get(),
      db.collection(referrerCol).doc(refereeUid).get(),
    ]);
    const referrerData = referrerDoc.data() || {};
    const refereeData = refereeDoc.data() || {};
    if (referrerData.phone && referrerData.phone === refereeData.phone) {
      flags.push("same_phone"); score += 80;
    }
    if (referrerData.email && referrerData.email === refereeData.email) {
      flags.push("same_email"); score += 80;
    }
  } catch (_) { /* ignore */ }

  const dayAgo = new Date(Date.now() - 86_400_000);
  const recentSnap = await db.collection("referrals")
    .where("referrerUid", "==", referrerUid)
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(dayAgo))
    .get();
  if (recentSnap.size >= 10) { flags.push("high_velocity_24h"); score += 40; }

  const totalSnap = await db.collection("referrals")
    .where("referrerUid", "==", referrerUid)
    .get();
  if (totalSnap.size >= 50) { flags.push("excessive_total_referrals"); score += 20; }

  if (score > 0) {
    await db.collection("referral_fraud_signals").add({
      referrerUid, refereeUid, participantType, score, flags,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return { score, flags };
}

// ─── Cloud Functions ────────────────────────────────────────────────────────

export const getMyReferral = onCall({ maxInstances: 5 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to get your referral code.");

  const participantType = (String(request.data?.participantType || "customer")) as ParticipantType;
  if (!PARTICIPANT_COLLECTIONS[participantType]) {
    throw new HttpsError("invalid-argument", "Invalid participant type.");
  }

  const db = admin.firestore();
  const program = await getActiveProgram(db, participantType);
  if (!program) throw new HttpsError("failed-precondition", "Referral program is currently paused.");

  const userCol = PARTICIPANT_COLLECTIONS[participantType];
  const userRef = db.collection(userCol).doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Account not found.");

  let code = String(snap.data()?.referralCode ?? "");
  if (!code) {
    for (let attempt = 0; attempt < 8 && !code; attempt++) {
      const candidate = randomCode();
      const codeRef = db.collection("referral_codes").doc(candidate);
      try {
        await db.runTransaction(async (txn) => {
          const existing = await txn.get(codeRef);
          if (existing.exists) throw new Error("collision");
          txn.set(codeRef, {
            uid, participantType, programId: program.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          txn.set(userRef, { referralCode: candidate }, { merge: true });
        });
        code = candidate;
      } catch (_e) { /* ignore */ }
    }
    if (!code) throw new HttpsError("internal", "Could not allocate a referral code. Please try again.");
    await logReferralEvent(db, "system", "code_allocated", { uid, code, participantType });
  }

  return {
    code, participantType,
    referralCount: Number(snap.data()?.referralCount ?? 0),
    referralEarnings: Number(snap.data()?.referralEarnings ?? 0),
    referrerReward: program.referrerReward,
    refereeReward: program.refereeReward,
    programName: program.name,
  };
});

export const applyReferralCode = onCall({ maxInstances: 5 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to apply a referral code.");

  const raw = String(request.data?.code ?? "").trim().toUpperCase();
  if (raw.length < 4) throw new HttpsError("invalid-argument", "Enter a valid referral code.");

  const participantType = (String(request.data?.participantType || "customer")) as ParticipantType;
  if (!PARTICIPANT_COLLECTIONS[participantType]) {
    throw new HttpsError("invalid-argument", "Invalid participant type.");
  }

  const db = admin.firestore();
  const program = await getActiveProgram(db, participantType);
  if (!program) throw new HttpsError("failed-precondition", "Referral program is currently paused.");

  const codeSnap = await db.collection("referral_codes").doc(raw).get();
  if (!codeSnap.exists) throw new HttpsError("not-found", "That referral code doesn't exist.");

  const referrerUid = String(codeSnap.data()?.uid ?? "");
  if (!referrerUid) throw new HttpsError("not-found", "That referral code is not active.");
  if (referrerUid === uid) throw new HttpsError("failed-precondition", "You can't use your own referral code.");

  const userCol = PARTICIPANT_COLLECTIONS[participantType];
  const userRef = db.collection(userCol).doc(uid);

  const fraud = await checkFraudSignals(db, referrerUid, uid, participantType);
  if (fraud.score >= 80) {
    await logReferralEvent(db, "system", "apply_blocked_fraud", { uid, referrerUid, code: raw, fraud });
    throw new HttpsError("failed-precondition", "This referral could not be processed. Please contact support.");
  }

  let referralId = "";
  await db.runTransaction(async (txn) => {
    const me = await txn.get(userRef);
    if (!me.exists) throw new HttpsError("failed-precondition", "Finish setting up your account first.");
    if (me.data()?.referredBy) throw new HttpsError("already-exists", "You've already used a referral code.");
    if (participantType === "customer" && Number(me.data()?.lifetimeOrderValue ?? 0) > 0) {
      throw new HttpsError("failed-precondition", "Referral codes are for new users only.");
    }
    const newRef = db.collection("referrals").doc();
    referralId = newRef.id;
    txn.set(userRef, {
      referredBy: referrerUid,
      referredAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    txn.set(newRef, {
      referrerUid, refereeUid: uid, code: raw, participantType, programId: program.id,
      status: "pending", referrerReward: program.referrerReward, refereeReward: program.refereeReward,
      fraudScore: fraud.score, fraudFlags: fraud.flags,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await logReferralEvent(db, referralId, "code_applied", {
    referrerUid, refereeUid: uid, code: raw, participantType, fraudScore: fraud.score,
  });

  const referrerCol = PARTICIPANT_COLLECTIONS[participantType];
  await sendReferralNotification(db, referrerUid, referrerCol,
    "Someone used your referral code! 🎉",
    `A new ${participantType} just signed up with your code ${raw}. You'll earn ₹${program.referrerReward} after they complete their first qualifying action.`,
    { referralId },
  );

  return { ok: true, refereeReward: program.refereeReward, referralId };
});

export const onReferralQualifyingOrder = onDocumentWritten(
  { document: "orders/{orderId}", maxInstances: 5 },
  async (event) => {
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!after) return;
    if (isCompleted(before?.status) || !isCompleted(after.status)) return;

    const refereeUid = String(after.customerUid ?? "");
    if (!refereeUid) return;

    const db = admin.firestore();
    const userRef = db.collection("customer_users").doc(refereeUid);
    const userSnap = await userRef.get();
    const u = userSnap.data() ?? {};
    const referrerUid = String(u.referredBy ?? "");
    if (!referrerUid || u.referralRewarded === true) return;

    const pending = await db.collection("referrals")
      .where("refereeUid", "==", refereeUid)
      .where("status", "==", "pending")
      .where("participantType", "==", "customer")
      .limit(1)
      .get();
    if (pending.empty) return;

    const referralRef = pending.docs[0].ref;
    const referralData = pending.docs[0].data();
    const referrerRef = db.collection("customer_users").doc(referrerUid);

    if ((referralData.fraudScore || 0) >= 40) {
      await referralRef.update({
        status: "qualified",
        qualifyingActionId: event.params.orderId,
        qualifyingAction: "first_order",
        qualifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await logReferralEvent(db, referralRef.id, "qualified_held_for_review", {
        orderId: event.params.orderId, fraudScore: referralData.fraudScore,
      });
      return;
    }

    const referrerReward = Number(referralData.referrerReward ?? 50);
    const refereeReward = Number(referralData.refereeReward ?? 50);

    await db.runTransaction(async (txn) => {
      const [refereeDoc, referrerDoc, referralDoc] = await Promise.all([
        txn.get(userRef), txn.get(referrerRef), txn.get(referralRef),
      ]);
      if (refereeDoc.data()?.referralRewarded === true) return;
      if (referralDoc.data()?.status !== "pending") return;
      if (!referrerDoc.exists) return;

      const now = admin.firestore.FieldValue.serverTimestamp();
      const refereeBal = Number(refereeDoc.data()?.walletBalance ?? 0) + refereeReward;
      const referrerBal = Number(referrerDoc.data()?.walletBalance ?? 0) + referrerReward;

      txn.set(userRef, {
        walletBalance: refereeBal, referralRewarded: true,
        referralEarnings: admin.firestore.FieldValue.increment(refereeReward),
      }, { merge: true });
      txn.set(userRef.collection("wallet_transactions").doc(), {
        type: "referral", amount: refereeReward, title: "Referral bonus",
        description: "Welcome bonus for joining with a referral code",
        balanceAfter: refereeBal, createdAt: now,
      });

      txn.set(referrerRef, {
        walletBalance: referrerBal,
        referralEarnings: admin.firestore.FieldValue.increment(referrerReward),
        referralCount: admin.firestore.FieldValue.increment(1),
      }, { merge: true });
      txn.set(referrerRef.collection("wallet_transactions").doc(), {
        type: "referral", amount: referrerReward, title: "Referral reward",
        description: "A friend you referred placed their first order",
        balanceAfter: referrerBal, createdAt: now,
      });

      txn.update(referralRef, {
        status: "rewarded", qualifyingActionId: event.params.orderId,
        qualifyingAction: "first_order", rewardedAt: now,
      });
    });

    await logReferralEvent(db, referralRef.id, "rewarded", {
      orderId: event.params.orderId, referrerReward, refereeReward,
    });

    await Promise.all([
      sendReferralNotification(db, refereeUid, "customer_users",
        `₹${refereeReward} added to your wallet! 🎉`,
        "Your referral welcome bonus has been credited.",
        { referralId: referralRef.id },
      ),
      sendReferralNotification(db, referrerUid, "customer_users",
        `You earned ₹${referrerReward}! 🎉`,
        "A friend you referred just placed their first order. Your reward is in your wallet.",
        { referralId: referralRef.id },
      ),
    ]);
  },
);

export const approveReferralReward = onCall({ maxInstances: 2 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in.");

  const db = admin.firestore();
  const adminSnap = await db.collection("admin_users").doc(uid).get();
  if (!adminSnap.exists) throw new HttpsError("permission-denied", "Admin only.");

  const referralId = String(request.data?.referralId ?? "");
  if (!referralId) throw new HttpsError("invalid-argument", "Referral ID required.");

  const referralRef = db.collection("referrals").doc(referralId);
  const referralSnap = await referralRef.get();
  if (!referralSnap.exists) throw new HttpsError("not-found", "Referral not found.");

  const data = referralSnap.data()!;
  if (data.status !== "qualified") {
    throw new HttpsError("failed-precondition", "Only qualified referrals can be approved.");
  }

  const participantType = (data.participantType || "customer") as ParticipantType;
  const userCol = PARTICIPANT_COLLECTIONS[participantType] || "customer_users";
  const referrerReward = Number(data.referrerReward ?? 50);
  const refereeReward = Number(data.refereeReward ?? 50);

  await db.runTransaction(async (txn) => {
    const refereeRef = db.collection(userCol).doc(data.refereeUid);
    const referrerRef = db.collection(userCol).doc(data.referrerUid);
    const [refereeDoc, referrerDoc] = await Promise.all([
      txn.get(refereeRef), txn.get(referrerRef),
    ]);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const refereeBal = Number(refereeDoc.data()?.walletBalance ?? 0) + refereeReward;
    const referrerBal = Number(referrerDoc.data()?.walletBalance ?? 0) + referrerReward;

    txn.set(refereeRef, {
      walletBalance: refereeBal, referralRewarded: true,
      referralEarnings: admin.firestore.FieldValue.increment(refereeReward),
    }, { merge: true });
    txn.set(refereeRef.collection("wallet_transactions").doc(), {
      type: "referral", amount: refereeReward, title: "Referral bonus",
      description: "Welcome bonus approved by admin", balanceAfter: refereeBal, createdAt: now,
    });

    txn.set(referrerRef, {
      walletBalance: referrerBal,
      referralEarnings: admin.firestore.FieldValue.increment(referrerReward),
      referralCount: admin.firestore.FieldValue.increment(1),
    }, { merge: true });
    txn.set(referrerRef.collection("wallet_transactions").doc(), {
      type: "referral", amount: referrerReward, title: "Referral reward",
      description: "Referral reward approved by admin", balanceAfter: referrerBal, createdAt: now,
    });

    txn.update(referralRef, { status: "rewarded", rewardedAt: now, approvedBy: uid });
  });

  await logReferralEvent(db, referralId, "admin_approved", { approvedBy: uid });
  return { ok: true };
});

export const reverseReferralReward = onCall({ maxInstances: 2 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in.");

  const db = admin.firestore();
  const adminSnap = await db.collection("admin_users").doc(uid).get();
  if (!adminSnap.exists) throw new HttpsError("permission-denied", "Admin only.");

  const referralId = String(request.data?.referralId ?? "");
  const reason = String(request.data?.reason ?? "").trim();
  if (!referralId) throw new HttpsError("invalid-argument", "Referral ID required.");
  if (!reason) throw new HttpsError("invalid-argument", "Reversal reason required.");

  const referralRef = db.collection("referrals").doc(referralId);
  const referralSnap = await referralRef.get();
  if (!referralSnap.exists) throw new HttpsError("not-found", "Referral not found.");

  const data = referralSnap.data()!;
  if (data.status !== "rewarded") {
    throw new HttpsError("failed-precondition", "Only rewarded referrals can be reversed.");
  }

  const participantType = (data.participantType || "customer") as ParticipantType;
  const userCol = PARTICIPANT_COLLECTIONS[participantType] || "customer_users";
  const referrerReward = Number(data.referrerReward ?? 50);
  const refereeReward = Number(data.refereeReward ?? 50);

  await db.runTransaction(async (txn) => {
    const refereeRef = db.collection(userCol).doc(data.refereeUid);
    const referrerRef = db.collection(userCol).doc(data.referrerUid);
    const [refereeDoc, referrerDoc] = await Promise.all([
      txn.get(refereeRef), txn.get(referrerRef),
    ]);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const refereeBal = Math.max(0, Number(refereeDoc.data()?.walletBalance ?? 0) - refereeReward);
    txn.set(refereeRef, {
      walletBalance: refereeBal,
      referralEarnings: admin.firestore.FieldValue.increment(-refereeReward),
    }, { merge: true });
    txn.set(refereeRef.collection("wallet_transactions").doc(), {
      type: "referral_reversal", amount: -refereeReward, title: "Referral reversed",
      description: `Referral reward reversed: ${reason}`, balanceAfter: refereeBal, createdAt: now,
    });

    const referrerBal = Math.max(0, Number(referrerDoc.data()?.walletBalance ?? 0) - referrerReward);
    txn.set(referrerRef, {
      walletBalance: referrerBal,
      referralEarnings: admin.firestore.FieldValue.increment(-referrerReward),
      referralCount: admin.firestore.FieldValue.increment(-1),
    }, { merge: true });
    txn.set(referrerRef.collection("wallet_transactions").doc(), {
      type: "referral_reversal", amount: -referrerReward, title: "Referral reversed",
      description: `Referral reward reversed: ${reason}`, balanceAfter: referrerBal, createdAt: now,
    });

    txn.update(referralRef, {
      status: "reversed", reversalReason: reason,
      reversedAt: now, reversedBy: uid,
    });
  });

  await logReferralEvent(db, referralId, "reversed", { reason, reversedBy: uid });

  await Promise.all([
    sendReferralNotification(db, data.refereeUid, userCol,
      "Referral reward adjusted",
      `A referral reward of ₹${refereeReward} has been reversed. Reason: ${reason}`,
    ),
    sendReferralNotification(db, data.referrerUid, userCol,
      "Referral reward adjusted",
      `A referral reward of ₹${referrerReward} has been reversed. Reason: ${reason}`,
    ),
  ]);

  return { ok: true };
});
