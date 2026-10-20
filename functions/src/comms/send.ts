/**
 * Core send pipeline. Given a dequeued email event it: resolves the template
 * (with language fallback), enforces suppression + consent + frequency caps,
 * renders safely, injects unsubscribe/preferences links for marketing, delivers
 * via the provider, and writes an immutable `emailLogs` entry. Idempotency is
 * owned by the queue (deterministic eventId); this module is the "how to send".
 */

import * as admin from "firebase-admin";
import {
  COL,
  EmailCategory,
  EmailEvent,
  EmailProviderResult,
  ESSENTIAL_CATEGORIES,
  isMarketingCategory,
} from "./types";
import { render, wrapHtml } from "./render";
import { deliver } from "./provider";
import { preferencesUrl, unsubscribeUrl } from "./tokens";

export function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

/** Suppression check. Hard bounces / complaints / invalids block ALL mail;
 *  an unsubscribe blocks only marketing. */
async function suppression(
  db: admin.firestore.Firestore,
  email: string
): Promise<{ reason?: string; blocksAll: boolean; blocksMarketing: boolean }> {
  const snap = await db.collection(COL.suppressions).doc(email).get();
  if (!snap.exists) return { blocksAll: false, blocksMarketing: false };
  const reason = (snap.data()?.reason || "").toString();
  const hard = ["hard_bounce", "spam_complaint", "invalid", "blocked"].includes(reason);
  return { reason, blocksAll: hard, blocksMarketing: true };
}

/** Consent check for the given category against the user's comms profile. */
function consentAllows(
  profile: FirebaseFirestore.DocumentData | undefined,
  category: EmailCategory
): boolean {
  if (ESSENTIAL_CATEGORIES.includes(category)) return true; // never blocked
  if (!isMarketingCategory(category)) return true;
  if (!profile) return false; // no profile → no marketing consent
  const channels = profile.channels || {};
  const marketingConsent = profile.marketingConsent?.enabled === true;
  const channelOn = category === "marketing"
    ? channels.marketing !== false
    : channels.announcements !== false;
  return marketingConsent && channelOn && profile.emailStatus !== "suppressed";
}

/** Simple per-user marketing frequency cap (config-driven, safe defaults). */
async function underFrequencyCap(
  profile: FirebaseFirestore.DocumentData | undefined,
  settings: FirebaseFirestore.DocumentData | undefined
): Promise<boolean> {
  const maxDay = Number(settings?.maxMarketingPerDay ?? 2);
  const maxWeek = Number(settings?.maxMarketingPerWeek ?? 5);
  const eng = profile?.engagement || {};
  return (eng.marketingSentToday ?? 0) < maxDay && (eng.marketingSentThisWeek ?? 0) < maxWeek;
}

interface ResolvedTemplate {
  subject: string;
  preheader?: string;
  html: string;
  text: string;
}

/** Resolve a template by key with language fallback (requested → en). */
async function resolveTemplate(
  db: admin.firestore.Firestore,
  templateKey: string,
  language: string
): Promise<ResolvedTemplate | null> {
  const col = db.collection(COL.templates);
  // Prefer published <key>__<lang>, then <key>__en, then <key>.
  const candidates = [`${templateKey}__${language}`, `${templateKey}__en`, templateKey];
  for (const id of candidates) {
    const snap = await col.doc(id).get();
    const d = snap.data();
    if (snap.exists && d && d.status !== "archived") {
      return {
        subject: (d.subject || "").toString(),
        preheader: d.preheader?.toString(),
        html: (d.html || "").toString(),
        text: (d.text || "").toString(),
      };
    }
  }
  return null;
}

export interface SendOutcome extends EmailProviderResult {
  skipped?: boolean;
  reason?: string;
}

/**
 * Build + deliver a single email event. Returns a provider result (or a
 * skipped outcome when suppressed / no-consent / capped). Does not mutate the
 * event doc — the queue owns status transitions.
 */
export async function deliverEvent(event: EmailEvent): Promise<SendOutcome> {
  const db = admin.firestore();
  const to = normalizeEmail(event.to);
  const category = event.category;

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { ok: false, provider: "none", skipped: true, reason: "invalid_recipient", permanent: true };
  }

  // Load profile + settings (best-effort).
  const [profileSnap, settingsSnap, supp] = await Promise.all([
    event.userId ? db.collection(COL.profiles).doc(event.userId).get() : Promise.resolve(null),
    db.collection(COL.settings).doc("email").get(),
    suppression(db, to),
  ]);
  const profile = profileSnap?.data();
  const settings = settingsSnap.data();

  if (supp.blocksAll) {
    return { ok: false, provider: "none", skipped: true, reason: `suppressed_${supp.reason}`, permanent: true };
  }
  if (isMarketingCategory(category) && supp.blocksMarketing) {
    return { ok: false, provider: "none", skipped: true, reason: "unsubscribed", permanent: true };
  }
  if (!consentAllows(profile, category)) {
    return { ok: false, provider: "none", skipped: true, reason: "no_consent", permanent: true };
  }
  if (isMarketingCategory(category) && !(await underFrequencyCap(profile, settings))) {
    return { ok: false, provider: "none", skipped: true, reason: "frequency_capped", permanent: false };
  }

  const language = (profile?.language || (event.data?.language as string) || "en").toString();
  const tpl = await resolveTemplate(db, event.templateKey, language);
  if (!tpl) {
    return { ok: false, provider: "none", skipped: true, reason: `template_missing:${event.templateKey}`, permanent: true };
  }

  // Variables available to the template. Marketing gets unsub/preferences links.
  const vars: Record<string, unknown> = { ...event.data };
  if (event.userId) {
    vars.preferencesUrl = preferencesUrl(event.userId, to);
    vars.unsubscribeUrl = unsubscribeUrl(event.userId, to);
  }

  const subject = render(tpl.subject, vars, { html: false });
  const bodyHtml = render(tpl.html, vars, { html: true });
  const footerHtml = isMarketingCategory(category) && event.userId
    ? `You received this because you opted into Kada updates. ` +
      `<a href="{{{unsubscribeUrl}}}" style="color:#2563eb">Unsubscribe</a> · ` +
      `<a href="{{{preferencesUrl}}}" style="color:#2563eb">Manage preferences</a>`
    : `This is a service message from The Kada.`;
  const html = wrapHtml({
    bodyHtml,
    preheader: tpl.preheader ? render(tpl.preheader, vars, { html: false }) : undefined,
    footerHtml: render(footerHtml, vars, { html: true }),
  });
  const text = render(tpl.text || "", vars, { html: false });

  const headers: Record<string, string> = {};
  if (isMarketingCategory(category) && event.userId) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl(event.userId, to)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const result = await deliver(
    {
      to,
      subject,
      html,
      text,
      headers,
      tags: { category, templateKey: event.templateKey, eventId: event.eventId },
    },
    {
      fromName: settings?.fromName,
      fromAddress: settings?.fromAddress,
      replyTo: settings?.replyTo,
    }
  );

  // Immutable log + engagement bump (best-effort).
  await writeLog(db, event, to, subject, result);
  if (result.ok && event.userId) await bumpEngagement(db, event.userId, category);

  return result;
}

async function writeLog(
  db: admin.firestore.Firestore,
  event: EmailEvent,
  to: string,
  subject: string,
  result: EmailProviderResult
): Promise<void> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection(COL.logs).add({
    eventId: event.eventId,
    type: event.type,
    category: event.category,
    recipientUserId: event.userId || null,
    recipientEmail: to,
    userType: event.userType || null,
    templateKey: event.templateKey,
    campaignId: event.campaignId || null,
    provider: result.provider,
    providerMessageId: result.messageId || null,
    subject,
    status: result.ok ? "sent" : "failed",
    attemptCount: event.attemptCount,
    error: result.error || null,
    createdAt: now,
    sentAt: result.ok ? now : null,
  });
}

async function bumpEngagement(
  db: admin.firestore.Firestore,
  userId: string,
  category: EmailCategory
): Promise<void> {
  const inc = admin.firestore.FieldValue.increment(1);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const patch: Record<string, unknown> = {
    "engagement.lastSentAt": now,
    updatedAt: now,
  };
  if (isMarketingCategory(category)) {
    patch["engagement.marketingSentToday"] = inc;
    patch["engagement.marketingSentThisWeek"] = inc;
    patch["engagement.lastMarketingAt"] = now;
  }
  await db.collection(COL.profiles).doc(userId).set(patch, { merge: true }).catch(() => {});
}
