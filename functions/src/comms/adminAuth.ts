/**
 * Server-side admin authorization for comms callables. Never trust the client.
 * SUPER_ADMIN = the platform owner emails (matches firestore.rules isAdmin);
 * finer roles come from `admin_users/{uid}.role`. Every privileged callable
 * gates on this — the frontend cannot grant itself access.
 */

import * as admin from "firebase-admin";
import { CallableRequest, HttpsError } from "firebase-functions/v2/https";

export type AdminRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MARKETING_MANAGER"
  | "SUPPORT_MANAGER"
  | "SUPPORT_AGENT"
  | "ANALYST";

const OWNER_EMAILS = ["thekada@gmail.com", "thekadaapp@gmail.com"];

/** Resolve the caller's admin role, or null if they are not an admin. */
export async function getAdminRole(
  request: CallableRequest
): Promise<AdminRole | null> {
  const auth = request.auth;
  if (!auth) return null;
  const email = (auth.token.email || "").toLowerCase();
  if (auth.token.email_verified && OWNER_EMAILS.includes(email)) return "SUPER_ADMIN";
  // Custom claim fast-path.
  const claimRole = (auth.token as Record<string, unknown>).adminRole;
  if (typeof claimRole === "string") return claimRole as AdminRole;
  // admin_users doc.
  const snap = await admin.firestore().collection("admin_users").doc(auth.uid).get();
  if (snap.exists) {
    const role = (snap.data()?.role || "").toString();
    if (role) return role as AdminRole;
  }
  return null;
}

/** Require any admin. Returns the role. */
export async function assertAdmin(request: CallableRequest): Promise<AdminRole> {
  const role = await getAdminRole(request);
  if (!role) throw new HttpsError("permission-denied", "Admin access required.");
  return role;
}

/** Require one of the allowed roles (SUPER_ADMIN always passes). */
export async function assertRole(
  request: CallableRequest,
  allowed: AdminRole[]
): Promise<AdminRole> {
  const role = await assertAdmin(request);
  if (role === "SUPER_ADMIN" || allowed.includes(role)) return role;
  throw new HttpsError("permission-denied", `Requires one of: ${allowed.join(", ")}.`);
}
