/**
 * Public preference center + unsubscribe. These callables authenticate via the
 * signed preference TOKEN (not login), so a recipient can manage or unsubscribe
 * straight from an email link. No raw uid is exposed; every change is audited.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { COL } from "./types";
import { COMMS_TOKEN_SECRET } from "./queue";
import { verifyPreferenceToken } from "./tokens";
import { setMarketingConsent } from "./profiles";

function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  if (!u || !d) return email;
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

/** Add/refresh a suppression entry (keyed by normalized email). */
export async function suppress(
  email: string,
  reason: "unsubscribed" | "hard_bounce" | "spam_complaint" | "invalid" | "blocked" | "manual",
  source: string
): Promise<void> {
  const db = admin.firestore();
  const key = email.trim().toLowerCase();
  await db.collection(COL.suppressions).doc(key).set(
    {
      email: key,
      reason,
      source,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export const getEmailPreferences = onCall(
  { secrets: [COMMS_TOKEN_SECRET] },
  async (request) => {
    const token = (request.data?.token || "").toString();
    const payload = verifyPreferenceToken(token);
    if (!payload) throw new HttpsError("permission-denied", "Invalid or expired link.");
    const snap = await admin.firestore().collection(COL.profiles).doc(payload.uid).get();
    const d = snap.data() || {};
    return {
      email: maskEmail(payload.email),
      channels: d.channels || { transactional: true, marketing: false },
      marketingConsent: d.marketingConsent?.enabled === true,
      emailStatus: d.emailStatus || "active",
    };
  }
);

export const updateEmailPreferences = onCall(
  { secrets: [COMMS_TOKEN_SECRET] },
  async (request) => {
    const token = (request.data?.token || "").toString();
    const channels = request.data?.channels || {};
    const payload = verifyPreferenceToken(token);
    if (!payload) throw new HttpsError("permission-denied", "Invalid or expired link.");

    const db = admin.firestore();
    const ref = db.collection(COL.profiles).doc(payload.uid);
    const now = admin.firestore.FieldValue.serverTimestamp();
    // Only allow toggling non-essential channels; transactional stays on.
    const allowed = ["marketing", "announcements", "newsletter"];
    const patch: Record<string, unknown> = { updatedAt: now, "channels.transactional": true };
    for (const k of allowed) {
      if (typeof channels[k] === "boolean") patch[`channels.${k}`] = channels[k];
    }
    await ref.set(patch, { merge: true });

    if (typeof channels.marketing === "boolean") {
      await setMarketingConsent(payload.uid, channels.marketing, {
        source: "preference_center",
        method: "self_service",
      });
      if (!channels.marketing) await suppress(payload.email, "unsubscribed", "preference_center");
    }
    await db.collection(COL.audit).add({
      action: "preferences_updated",
      target: payload.uid,
      channels,
      via: "token",
      at: now,
    });
    return { ok: true };
  }
);

export const unsubscribeAll = onCall(
  { secrets: [COMMS_TOKEN_SECRET] },
  async (request) => {
    const token = (request.data?.token || "").toString();
    const payload = verifyPreferenceToken(token);
    if (!payload) throw new HttpsError("permission-denied", "Invalid or expired link.");
    const now = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore().collection(COL.profiles).doc(payload.uid).set(
      {
        "channels.marketing": false,
        "channels.announcements": false,
        "channels.newsletter": false,
        updatedAt: now,
      },
      { merge: true }
    );
    await setMarketingConsent(payload.uid, false, {
      source: "one_click_unsubscribe",
      method: "email_link",
    });
    await suppress(payload.email, "unsubscribed", "one_click_unsubscribe");
    await admin.firestore().collection(COL.audit).add({
      action: "unsubscribed_all",
      target: payload.uid,
      via: "token",
      at: now,
    });
    return { ok: true };
  }
);
