/**
 * Admin comms callables — all role-gated server-side. Test sends, profile
 * backfill, and a REAL overview built from Firestore count() aggregations
 * (never fabricated numbers, never full-collection scans).
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { COL, UserType } from "./types";
import { render, wrapHtml } from "./render";
import { activeProvider, deliver, resendKey } from "./provider";
import { COMMS_SECRETS } from "./queue";
import { assertAdmin, assertRole } from "./adminAuth";
import { backfillType } from "./profiles";

/** Send a real test email of a template to an admin-chosen address. */
export const sendTestEmail = onCall({ secrets: COMMS_SECRETS }, async (request) => {
  await assertAdmin(request);
  const templateKey = (request.data?.templateKey || "").toString();
  const to = (request.data?.to || "").toString().trim().toLowerCase();
  const language = (request.data?.language || "en").toString();
  const sample = (request.data?.sampleData || {}) as Record<string, unknown>;
  if (!templateKey || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    throw new HttpsError("invalid-argument", "Valid templateKey and recipient are required.");
  }
  const db = admin.firestore();
  const ids = [`${templateKey}__${language}`, `${templateKey}__en`, templateKey];
  let tpl: FirebaseFirestore.DocumentData | undefined;
  for (const id of ids) {
    const s = await db.collection(COL.templates).doc(id).get();
    if (s.exists) { tpl = s.data(); break; }
  }
  if (!tpl) throw new HttpsError("not-found", `Template '${templateKey}' not found.`);

  const vars = { firstName: "Test", city: "Kochi", orderId: "TEST-1001", vendorName: "Demo Kitchen",
    orderTotal: "499", amount: "499", itemsCount: 2, planName: "Kada Gold", renewalDate: "in 7 days",
    supportTicketId: "TKT-TEST", trackUrl: "https://thekada.in", preferencesUrl: "https://thekada.in",
    unsubscribeUrl: "https://thekada.in", ...sample };
  const subject = `[TEST] ${render((tpl.subject || "").toString(), vars, { html: false })}`;
  const html = wrapHtml({
    bodyHtml: render((tpl.html || "").toString(), vars, { html: true }),
    preheader: tpl.preheader ? render(tpl.preheader.toString(), vars, { html: false }) : undefined,
    footerHtml: "Test email sent from the Kada Admin Panel.",
  });
  const text = render((tpl.text || "").toString(), vars, { html: false });

  const settingsSnap = await db.collection("communicationSettings").doc("email").get();
  const settings = settingsSnap.data() || {};
  const result = await deliver(
    { to, subject, html, text, tags: { test: "true", templateKey } },
    { fromName: settings.fromName, fromAddress: settings.fromAddress, replyTo: settings.replyTo }
  );
  await db.collection(COL.logs).add({
    eventId: `test_${Date.now()}`, type: "TEST", category: (tpl.category || "announcements"),
    recipientEmail: to, templateKey, provider: result.provider, providerMessageId: result.messageId || null,
    subject, status: result.ok ? "sent" : "failed", error: result.error || null,
    isTest: true, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sentAt: result.ok ? admin.firestore.FieldValue.serverTimestamp() : null,
  });
  await db.collection(COL.audit).add({
    adminUserId: request.auth?.uid, action: "send_test_email", target: templateKey,
    metadata: { to, provider: result.provider, ok: result.ok },
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (!result.ok) {
    throw new HttpsError("internal", `Provider rejected the send: ${result.error || "unknown error"}`);
  }
  return { ok: true, provider: result.provider, messageId: result.messageId };
});

/** Backfill communication profiles from a canonical collection (paged). */
export const commsBackfillProfiles = onCall(async (request) => {
  await assertRole(request, ["ADMIN", "MARKETING_MANAGER"]);
  const userType = (request.data?.userType || "CUSTOMER").toString() as UserType;
  const count = await backfillType(userType, Number(request.data?.limit || 400));
  await admin.firestore().collection(COL.audit).add({
    adminUserId: request.auth?.uid, action: "backfill_profiles", target: userType,
    metadata: { count }, at: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, userType, count };
});

async function count(q: FirebaseFirestore.Query): Promise<number> {
  try { return (await q.count().get()).data().count; } catch { return 0; }
}

const APP_TO_USERTYPE: Record<string, string> = {
  customer: "CUSTOMER",
  vendor: "VENDOR",
  delivery: "DELIVERY_PARTNER",
  host: "HOST",
};

/** Real communications overview — aggregation counts, no full scans. When an
 *  `app` is passed (customer/vendor/delivery/host), profile + log + campaign
 *  counts are scoped to that app's userType; suppressions/queue stay platform-
 *  wide (inherently cross-app). "all" returns platform totals. */
export const commsOverview = onCall({ secrets: COMMS_SECRETS }, async (request) => {
  await assertRole(request, ["ADMIN", "MARKETING_MANAGER", "ANALYST", "SUPPORT_MANAGER"]);
  const db = admin.firestore();
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400_000);
  const app = (request.data?.app || "all").toString();
  const ut = APP_TO_USERTYPE[app];

  const profilesQ = ut ? db.collection(COL.profiles).where("userType", "==", ut) : db.collection(COL.profiles);
  const marketingQ = profilesQ.where("channels.marketing", "==", true);
  const sentQ = ut
    ? db.collection(COL.logs).where("userType", "==", ut).where("status", "==", "sent").where("createdAt", ">=", since)
    : db.collection(COL.logs).where("status", "==", "sent").where("createdAt", ">=", since);
  const failedQ = ut
    ? db.collection(COL.logs).where("userType", "==", ut).where("status", "==", "failed").where("createdAt", ">=", since)
    : db.collection(COL.logs).where("status", "==", "failed").where("createdAt", ">=", since);
  const campaignsQ = ut ? db.collection(COL.campaigns).where("app", "==", app) : db.collection(COL.campaigns);

  const [profiles, marketingEligible, suppressed, sent30, failed30, campaigns, queued] =
    await Promise.all([
      count(profilesQ),
      count(marketingQ),
      count(db.collection(COL.suppressions)),
      count(sentQ),
      count(failedQ),
      count(campaignsQ),
      count(db.collection(COL.events).where("status", "==", "queued")),
    ]);
  return {
    app,
    totalProfiles: profiles,
    marketingEligible,
    suppressed,
    sent30d: sent30,
    failed30d: failed30,
    campaigns,
    queued,
    provider: activeProvider(),
    providerConfigured: activeProvider() === "resend" ? !!resendKey() : !!process.env.GMAIL_APP_PASSWORD,
  };
});
