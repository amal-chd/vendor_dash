import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { COL, NotificationTemplate, NotificationChannel } from "./types";

export const createTemplate = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { key, title, body, variables, channelVariants, languageVariants } = request.data;
  if (!key || !title || !body) {
    throw new HttpsError("invalid-argument", "Key, title, and body are required");
  }

  const db = admin.firestore();
  
  // Enforce unique key
  const existing = await db.collection(COL.NOTIFICATION_TEMPLATES).where("key", "==", key).limit(1).get();
  if (!existing.empty) {
    throw new HttpsError("already-exists", `Template with key ${key} already exists`);
  }

  const templateData: NotificationTemplate = {
    key,
    title,
    body,
    variables: variables || [],
    channelVariants,
    languageVariants,
    status: "draft",
  };

  const docRef = await db.collection(COL.NOTIFICATION_TEMPLATES).add({
    ...templateData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth?.uid,
  });

  return { id: docRef.id };
});

export const updateTemplate = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id, updates } = request.data;
  if (!id || !updates) {
    throw new HttpsError("invalid-argument", "Template ID and updates are required");
  }

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_TEMPLATES).doc(id);
  
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "Template not found");
  }

  const currentData = doc.data();

  // Create version snapshot if it's published and being edited
  if (currentData?.status === "published") {
    await docRef.collection("versions").add({
      ...currentData,
      versionedAt: admin.firestore.FieldValue.serverTimestamp(),
      versionedBy: request.auth?.uid,
    });
  }

  const safeUpdates = { ...updates };
  // If we're updating a published template, revert to draft? Or maybe allow updating in place. 
  // Let's assume updating content reverts to draft unless specified.
  if (updates.title || updates.body || updates.languageVariants || updates.channelVariants) {
    safeUpdates.status = "draft";
  }

  await docRef.update({
    ...safeUpdates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth?.uid,
  });

  return { success: true };
});

export const publishTemplate = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id } = request.data;
  if (!id) throw new HttpsError("invalid-argument", "Template ID is required");

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_TEMPLATES).doc(id);
  
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "Template not found");

  await docRef.update({
    status: "published",
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedBy: request.auth?.uid,
  });

  return { success: true };
});

export const archiveTemplate = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { id } = request.data;
  if (!id) throw new HttpsError("invalid-argument", "Template ID is required");

  const db = admin.firestore();
  const docRef = db.collection(COL.NOTIFICATION_TEMPLATES).doc(id);
  
  await docRef.update({
    status: "archived",
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    archivedBy: request.auth?.uid,
  });

  return { success: true };
});

/**
 * Replace Mustache-style variables like {{name}} with their values.
 */
function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w]+)\s*\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

/**
 * Utility function to render a template.
 * Not exposed as a callable function.
 */
export async function renderTemplate(
  templateKey: string,
  variables: Record<string, string>,
  language?: string,
  channel?: string
): Promise<{ title: string; body: string }> {
  const db = admin.firestore();
  const snapshot = await db.collection(COL.NOTIFICATION_TEMPLATES)
    .where("key", "==", templateKey)
    .where("status", "==", "published")
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error(`Published template with key ${templateKey} not found`);
  }

  const template = snapshot.docs[0].data() as NotificationTemplate;

  let title = template.title;
  let body = template.body;

  if (language && template.languageVariants && template.languageVariants[language]) {
    title = template.languageVariants[language].title || title;
    body = template.languageVariants[language].body || body;
  }

  if (channel && template.channelVariants && template.channelVariants[channel as NotificationChannel]) {
    title = template.channelVariants[channel as NotificationChannel].title || title;
    body = template.channelVariants[channel as NotificationChannel].body || body;
  }

  return {
    title: interpolate(title, variables),
    body: interpolate(body, variables),
  };
}
