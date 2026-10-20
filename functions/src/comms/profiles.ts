/**
 * Communication profiles. `communicationProfiles/{userId}` is a thin overlay on
 * the canonical user record (customer_users / delivery_users / restaurants /
 * hotels) — it links by uid and stores consent, channels, engagement and
 * marketing attributes, NOT a second copy of PII. Marketing consent is never
 * assumed (default off); transactional is always on.
 */

import * as admin from "firebase-admin";
import { COL, UserType } from "./types";
import { PARTNER_CONTACT_COLLECTION, partnerDocKey } from "../onboarding/partnerPrivate";

interface ProfileSeed {
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  phone?: string;
  language?: string;
  country?: string;
  timezone?: string;
  source?: string;
}

/** Default channels — essential on, marketing off (explicit opt-in required). */
function defaultChannels() {
  return { transactional: true, marketing: false, announcements: false, newsletter: false };
}

/** Create the profile if missing (idempotent, cheap: one read + conditional write). */
export async function ensureProfile(
  userId: string,
  userType: UserType,
  seed: ProfileSeed
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection(COL.profiles).doc(userId);
  const snap = await ref.get();
  const now = admin.firestore.FieldValue.serverTimestamp();
  if (!snap.exists) {
    await ref.set({
      userId,
      userType,
      email: (seed.email || "").toLowerCase(),
      emailVerified: seed.emailVerified ?? false,
      displayName: seed.displayName || "",
      phone: seed.phone || "",
      language: seed.language || "en",
      country: seed.country || "IN",
      timezone: seed.timezone || "Asia/Kolkata",
      source: seed.source || "system",
      emailStatus: "active",
      channels: defaultChannels(),
      marketingConsent: { enabled: false },
      engagement: {},
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    return;
  }
  // Keep contact fields fresh without touching consent.
  const patch: Record<string, unknown> = { updatedAt: now };
  if (seed.email) patch.email = seed.email.toLowerCase();
  if (seed.displayName) patch.displayName = seed.displayName;
  if (seed.emailVerified !== undefined) patch.emailVerified = seed.emailVerified;
  await ref.set(patch, { merge: true });
}

/** Record an explicit marketing consent change with an audit trail. */
export async function setMarketingConsent(
  userId: string,
  enabled: boolean,
  meta: { source: string; method: string; version?: string }
): Promise<void> {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = db.collection(COL.profiles).doc(userId);
  await ref.set(
    {
      marketingConsent: {
        enabled,
        source: meta.source,
        method: meta.method,
        version: meta.version || "v1",
        updatedAt: now,
        ...(enabled ? { givenAt: now } : { withdrawnAt: now }),
      },
      "channels.marketing": enabled,
      updatedAt: now,
    },
    { merge: true }
  );
  await db.collection(COL.profiles).doc(userId).collection("consentHistory").add({
    enabled,
    source: meta.source,
    method: meta.method,
    version: meta.version || "v1",
    at: now,
  });
}

const CANONICAL: Record<UserType, string> = {
  CUSTOMER: "customer_users",
  DELIVERY_PARTNER: "delivery_users",
  VENDOR: "restaurants",
  HOST: "hotels",
  RESTAURANT_STAFF: "staff",
  ADMIN: "admins",
  SUPPORT_AGENT: "support_agents",
  LEAD: "leads",
  SUBSCRIBER: "subscribers",
};

/** Batched backfill for one user type (cost-aware; paged). Returns count. */
export async function backfillType(userType: UserType, pageLimit = 400): Promise<number> {
  const db = admin.firestore();
  const col = CANONICAL[userType];
  if (!col) return 0;
  const snap = await db.collection(col).limit(pageLimit).get();
  // Vendor/host owner email lives in partner_contact — the listing docs are
  // publicly readable, so it was moved off them.
  const contactRole = userType === "VENDOR" ? "vendor" : userType === "HOST" ? "host" : null;
  const contacts =
    contactRole && !snap.empty
      ? await db.getAll(
          ...snap.docs.map((d) =>
            db.collection(PARTNER_CONTACT_COLLECTION).doc(partnerDocKey(contactRole, d.id)),
          ),
        )
      : [];
  let n = 0;
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (let i = 0; i < snap.docs.length; i++) {
    const doc = snap.docs[i];
    const d = doc.data();
    const c = contacts[i]?.data() ?? {};
    const email = (
      c.email || c.ownerEmail || c.outletEmail || c.hostEmail || d.email || d.supportEmail || ""
    ).toString().toLowerCase();
    if (!email) continue;
    const ref = db.collection(COL.profiles).doc(doc.id);
    batch.set(
      ref,
      {
        userId: doc.id,
        userType,
        email,
        displayName: (d.name || d.displayName || d.ownerName || "").toString(),
        phone: (d.phone || d.phoneNumber || c.ownerPhone || "").toString(),
        language: (d.language || "en").toString(),
        emailStatus: "active",
        channels: { transactional: true },
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );
    n++;
  }
  if (n > 0) await batch.commit();
  return n;
}
