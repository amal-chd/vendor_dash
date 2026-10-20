/**
 * Marketing campaigns. A campaign targets a saved segment with a template.
 * Sending is scalable by design: `sendCampaign` validates + estimates + flips
 * status to "queued"; a scheduled worker pages the audience by cursor in
 * batches and enqueues one idempotent marketing event per recipient
 * (`campaign_{id}_{uid}`). The core send pipeline then enforces consent,
 * suppression and frequency caps — a campaign can never mail an unsubscribed or
 * bounced address, and re-running never double-sends.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { COL, UserType } from "./types";
import { enqueueEmail, COMMS_SECRETS } from "./queue";
import { assertRole } from "./adminAuth";

interface Condition {
  field: string; // e.g. "userType" | "city" | "minOrders" | "inactiveDays" | "tag"
  op: "eq" | "neq" | "gte" | "lte" | "contains";
  value: unknown;
}

/** In-memory predicate for a profile against a segment's conditions. */
function matches(profile: FirebaseFirestore.DocumentData, conditions: Condition[]): boolean {
  return conditions.every((c) => {
    switch (c.field) {
      case "userType":
        return c.op === "neq" ? profile.userType !== c.value : profile.userType === c.value;
      case "city":
        return (profile.city || profile.preferredLocation || "").toString().toLowerCase() ===
          String(c.value).toLowerCase();
      case "minOrders":
        return Number(profile.orderStats?.count || 0) >= Number(c.value);
      case "maxOrders":
        return Number(profile.orderStats?.count || 0) <= Number(c.value);
      case "inactiveDays": {
        const last = profile.orderStats?.lastOrderAt?.toMillis?.() || 0;
        return Date.now() - last >= Number(c.value) * 86400_000;
      }
      case "tag":
        return Array.isArray(profile.tags) && profile.tags.includes(c.value);
      case "hasActiveSubscription":
        return (profile.subscriptionStatus === "active") === Boolean(c.value);
      default:
        return true;
    }
  });
}

/** Admin: queue a campaign for sending after safety checks. */
export const sendCampaign = onCall(async (request) => {
  await assertRole(request, ["ADMIN", "MARKETING_MANAGER"]);
  const campaignId = (request.data?.campaignId || "").toString();
  if (!campaignId) throw new HttpsError("invalid-argument", "campaignId required.");
  const db = admin.firestore();
  const ref = db.collection(COL.campaigns).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Campaign not found.");
  const c = snap.data() as FirebaseFirestore.DocumentData;
  if (!["draft", "scheduled", "paused"].includes(c.status)) {
    throw new HttpsError("failed-precondition", `Campaign is '${c.status}', cannot send.`);
  }
  if (!c.templateKey || !c.segmentId) {
    throw new HttpsError("failed-precondition", "Campaign needs a template and an audience.");
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.update({
    status: "queued",
    queuedBy: request.auth?.uid || null,
    queuedAt: now,
    cursor: null,
    stats: { queued: 0, sent: 0, skipped: 0, failed: 0 },
    updatedAt: now,
  });
  await db.collection(COL.audit).add({
    adminUserId: request.auth?.uid, action: "campaign_send", target: campaignId,
    metadata: { templateKey: c.templateKey, segmentId: c.segmentId }, at: now,
  });
  return { ok: true, status: "queued" };
});

const BATCH = 200;

function variantBucket(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 100;
}

/** If a running experiment lists this template as variant A or B, split recipients. */
function templateForRecipient(
  experiments: FirebaseFirestore.DocumentData[],
  templateKey: string,
  userId: string,
): string {
  const exp = experiments.find((e) => e.variantA === templateKey || e.variantB === templateKey);
  if (!exp?.variantA || !exp?.variantB) return templateKey;
  const split = Math.min(100, Math.max(0, Number(exp.splitPercent) || 50));
  return variantBucket(userId) < split ? String(exp.variantA) : String(exp.variantB);
}

/** Scheduled worker — pages queued campaigns and enqueues recipient emails. */
export const processCampaigns = onSchedule(
  { schedule: "every 2 minutes", secrets: COMMS_SECRETS },
  async () => {
    const db = admin.firestore();
    const campaigns = await db
      .collection(COL.campaigns)
      .where("status", "in", ["queued", "processing"])
      .limit(3)
      .get();

    const runningExps = await db.collection("emailExperiments").where("status", "==", "running").limit(25).get();
    const experiments = runningExps.docs.map((d) => d.data());

    for (const cDoc of campaigns.docs) {
      const c = cDoc.data();
      const segSnap = await db.collection(COL.segments).doc(c.segmentId).get();
      const conditions: Condition[] = (segSnap.data()?.conditions || []) as Condition[];

      // Base query: marketing-eligible profiles, cursor-paged by document id.
      let q = db
        .collection(COL.profiles)
        .where("channels.marketing", "==", true)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(BATCH);
      if (c.cursor) q = q.startAfter(c.cursor);

      const page = await q.get();
      let queued = 0;
      for (const p of page.docs) {
        const prof = p.data();
        if (!matches(prof, conditions)) continue;
        const email = (prof.email || "").toString();
        if (!email) continue;
        const created = await enqueueEmail({
          eventId: `campaign_${cDoc.id}_${p.id}`, // idempotent per recipient
          type: "CAMPAIGN",
          category: "marketing",
          to: email,
          userId: p.id,
          userType: (prof.userType || "CUSTOMER") as UserType,
          templateKey: templateForRecipient(experiments, String(c.templateKey), p.id),
          campaignId: cDoc.id,
          data: {
            firstName: (prof.displayName || "there").toString().split(" ")[0],
            city: prof.city || prof.preferredLocation || "your area",
            ...(c.data || {}),
          },
        });
        if (created) queued++;
      }

      const done = page.size < BATCH;
      const now = admin.firestore.FieldValue.serverTimestamp();
      await cDoc.ref.update({
        status: done ? "sent" : "processing",
        cursor: page.empty ? c.cursor : page.docs[page.docs.length - 1].id,
        "stats.queued": admin.firestore.FieldValue.increment(queued),
        ...(done ? { completedAt: now } : {}),
        updatedAt: now,
      });
    }
  }
);
