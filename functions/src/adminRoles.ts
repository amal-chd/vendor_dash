import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { assertAdmin } from "./admin_operations";

const VALID_ROLES = [
  "super_admin", "platform_admin", "ops_manager", "finance_manager",
  "support_manager", "support_agent", "vendor_manager", "delivery_manager",
  "stay_manager", "marketing_manager", "analytics", "developer", "auditor",
];

const BOOTSTRAP = ["thekada@gmail.com", "thekadaapp@gmail.com"];

/**
 * Assign an admin role (spec §35). Sets the `adminRole` custom claim on the
 * target user, records it in admin_roles, and writes an immutable audit event.
 * Only a Super Admin (or bootstrap owner) may call it — role escalation is
 * enforced here, server-side, not in the UI.
 */
export const setAdminRole = onCall(async (request) => {
  assertAdmin(request);

  const token = request.auth?.token as Record<string, unknown> | undefined;
  const callerEmail = String(token?.email ?? "").toLowerCase();
  const isSuper =
    token?.adminRole === "super_admin" ||
    token?.platformAdmin === true ||
    BOOTSTRAP.includes(callerEmail);
  if (!isSuper) {
    throw new HttpsError("permission-denied", "Only a Super Admin can assign roles.");
  }

  const uid = String((request.data as { uid?: unknown })?.uid ?? "").trim();
  const role = String((request.data as { role?: unknown })?.role ?? "").trim();
  if (!uid) throw new HttpsError("invalid-argument", "A target uid is required.");
  if (!VALID_ROLES.includes(role)) throw new HttpsError("invalid-argument", `Invalid role: ${role}`);

  const userRec = await admin.auth().getUser(uid);
  const existing = userRec.customClaims ?? {};
  await admin.auth().setCustomUserClaims(uid, { ...existing, adminRole: role });

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection("admin_roles").doc(uid).set(
    {
      uid,
      role,
      email: userRec.email ?? null,
      assignedBy: callerEmail || "system",
      updatedAt: now,
    },
    { merge: true },
  );

  // Immutable audit event.
  await db.collection("audit_events").add({
    action: "ADMIN_ROLE_SET",
    entity: "admin",
    entityId: uid,
    description: `Assigned role "${role}" to ${userRec.email ?? uid}`,
    before: { role: existing.adminRole ?? null },
    after: { role },
    actorEmail: callerEmail || null,
    actorUid: request.auth?.uid ?? null,
    timestamp: now,
  });

  return { ok: true, uid, role };
});
