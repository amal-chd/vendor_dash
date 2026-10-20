import { onCall, HttpsError } from "firebase-functions/v2/https";
import { withCronHeartbeat } from "../cronHealth";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { COL, NotificationCampaign } from "./types";
import { deliverBroadcast, mapAudience } from "./broadcast";

export const createCampaign = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { name, objective, audience, schedule, title, body, apps, channels, priority } = request.data;
  if (!name || !audience) {
    throw new HttpsError("invalid-argument", "Name and audience are required");
  }

  const db = admin.firestore();
  const campaignData: NotificationCampaign = {
    name,
    objective,
    audience,
    title: title || name,
    body: body || objective || "",
    apps,
    channels,
    priority,
    status: "draft",
    schedule: schedule || null,
    createdBy: request.auth?.uid || "unknown",
  };

  const docRef = await db.collection(COL.NOTIFICATION_CAMPAIGNS).add({
    ...campaignData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: docRef.id };
});

export const updateCampaign = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id, updates } = request.data;
  if (!id || !updates) {
    throw new HttpsError("invalid-argument", "Campaign ID and updates are required");
  }

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_CAMPAIGNS).doc(id);
  
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "Campaign not found");
  }

  const currentStatus = doc.data()?.status;
  if (currentStatus !== "draft" && currentStatus !== "pending_approval") {
    throw new HttpsError("failed-precondition", "Cannot update a campaign that is not draft or pending approval");
  }

  // Prevent status updates through this endpoint
  const safeUpdates = { ...updates };
  delete safeUpdates.status;

  await docRef.update({
    ...safeUpdates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const submitForApproval = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id } = request.data;
  if (!id) throw new HttpsError("invalid-argument", "Campaign ID is required");

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_CAMPAIGNS).doc(id);
  
  await docRef.update({
    status: "pending_approval",
    submittedBy: request.auth?.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const approveCampaign = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id } = request.data;
  if (!id) throw new HttpsError("invalid-argument", "Campaign ID is required");

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_CAMPAIGNS).doc(id);
  
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Campaign not found");

  const data = doc.data();
  const scheduledAt = data?.scheduledAt;

  await docRef.update({
    status: "approved",
    approvedBy: request.auth?.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
    await executeCampaign(id);
  }

  return { success: true };
});

export const cancelCampaign = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id } = request.data;
  if (!id) throw new HttpsError("invalid-argument", "Campaign ID is required");

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_CAMPAIGNS).doc(id);
  
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Campaign not found");

  const status = doc.data()?.status;
  if (status === "sending" || status === "sent") {
    throw new HttpsError("failed-precondition", "Cannot cancel an already sending/sent campaign");
  }

  await docRef.update({
    status: "cancelled",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});

export const duplicateCampaign = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id } = request.data;
  if (!id) throw new HttpsError("invalid-argument", "Campaign ID is required");

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_CAMPAIGNS).doc(id);
  
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Campaign not found");

  const data = doc.data() as any;
  delete data.createdAt;
  delete data.updatedAt;
  delete data.status;
  delete data.scheduledAt;
  delete data.createdBy;
  delete data.approvedBy;
  delete data.submittedBy;
  
  data.name = `${data.name} (Copy)`;
  data.status = "draft";
  data.createdBy = request.auth?.uid;

  const newDocRef = await db.collection(COL.NOTIFICATION_CAMPAIGNS).add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: newDocRef.id };
});

export async function executeCampaign(campaignId: string) {
  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_CAMPAIGNS).doc(campaignId);
  
  // Claim the campaign before sending anything. Both callers hand us a
  // campaign sitting in "approved", and processScheduledCampaigns queries for
  // exactly that every minute — so a plain update cannot stop two runners (two
  // regions, a retry, two overlapping minutes) from both reading "approved"
  // and both broadcasting to every targeted user. The transaction lets exactly
  // one of them win; the losers return without sending.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return false;
    if (String(snap.data()?.status ?? "") !== "approved") return false;
    tx.update(docRef, {
      status: "sending",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (!claimed) {
    console.log(
      `executeCampaign: ${campaignId} is not approved (already claimed or cancelled) — skipping`,
    );
    return;
  }

  try {
    const snap = await docRef.get();
    const data = snap.data() || {};
    const title = String(data.title || data.name || "Kada");
    const body = String(data.body || data.objective || "");
    if (!body) {
      throw new Error("Campaign has no message body");
    }
    const mapped = mapAudience(String(data.audience || "customers"));
    const result = await deliverBroadcast({
      title,
      body,
      audience: mapped.audience,
      vendorFilter: mapped.vendorFilter,
      urgent: data.priority === "critical" || data.priority === "high",
      campaignId,
    });

    await docRef.update({
      status: "sent",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      stats: {
        sent: result.recipients,
        delivered: result.pushed,
        opened: 0,
        clicked: 0,
        failed: Math.max(0, result.recipients - result.pushed),
      },
    });
  } catch (err: any) {
    await docRef.update({
      status: "failed",
      error: err.message,
    });
    throw err;
  }
}

export const processScheduledCampaigns = onSchedule("every 1 minutes", withCronHeartbeat("processScheduledCampaigns", 1, async (event) => {
  const db = admin.firestore();
  const now = new Date().toISOString();

  const snapshot = await db.collection(COL.NOTIFICATION_CAMPAIGNS)
    .where("status", "==", "approved")
    .where("scheduledAt", "<=", now)
    .get();

  for (const doc of snapshot.docs) {
    await executeCampaign(doc.id);
  }
}));
