import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { AiAuditLog, COL } from "./types";

/**
 * Log an AI generation attempt.
 * @param log - The AI audit log details
 * @returns The ID of the created log
 */
export async function logAiGeneration(log: AiAuditLog): Promise<string> {
  const db = admin.firestore();
  const docRef = db.collection(COL.AI_AUDIT_LOGS).doc();
  const data = {
    ...log,
    id: docRef.id,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };
  await docRef.set(data);
  return docRef.id;
}

/**
 * Get a single AI audit log.
 */
export const getAiAuditLog = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { logId } = request.data;
  if (!logId) {
    throw new HttpsError("invalid-argument", "logId is required");
  }

  const doc = await admin.firestore().collection(COL.AI_AUDIT_LOGS).doc(logId).get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "Log not found");
  }

  return doc.data();
});

/**
 * List AI audit logs with pagination for the admin dashboard.
 */
export const listAiAuditLogs = onCall({ maxInstances: 2 }, async (request) => {
  const email = request.auth?.token?.email;
  if (email !== "thekada@gmail.com" && email !== "thekadaapp@gmail.com") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { limit = 50, lastTimestamp } = request.data;

  let query = admin.firestore().collection(COL.AI_AUDIT_LOGS).orderBy("timestamp", "desc");

  if (lastTimestamp) {
    query = query.startAfter(admin.firestore.Timestamp.fromDate(new Date(lastTimestamp)));
  }

  const snapshot = await query.limit(limit).get();
  const logs = snapshot.docs.map((doc) => doc.data());

  return { logs };
});
