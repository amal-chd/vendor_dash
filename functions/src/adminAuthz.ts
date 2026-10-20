/**
 * The platform admin gate, on its own.
 *
 * This lived in admin_operations.ts, which also pulls in the broadcast engine,
 * the billing model and the plan catalog. Fourteen modules — including the
 * delivery hot path — imported nothing from it but `assertAdmin`, and paid for
 * that whole dependency tree on every cold start. Keeping the gate in a leaf
 * module means one definition (it has been tightened before: see the
 * email_verified note below) without the baggage.
 */
import { HttpsError } from "firebase-functions/v2/https";

export const ADMIN_EMAILS = ["thekada@gmail.com", "thekadaapp@gmail.com"];

/** Staff roles granted as a custom claim by an existing admin. */
export const STAFF_ROLES = [
  "super_admin", "platform_admin", "ops_manager", "finance_manager",
  "support_manager", "support_agent", "vendor_manager", "delivery_manager",
  "stay_manager", "marketing_manager", "analytics", "developer", "auditor",
];

/** The same gate as assertAdmin, as a boolean for callables that also serve non-admins. */
export function isAdminCaller(request: any): boolean {
  try {
    assertAdmin(request);
    return true;
  } catch {
    return false;
  }
}

export function assertAdmin(request: any): void {
  const callerEmail = (request.auth?.token?.email as string | undefined) ?? "";
  const hasClaim = request.auth?.token?.platformAdmin === true;
  // The allowlist must only match a VERIFIED email. Both apps allow email +
  // password sign-up, whose tokens carry any address the user typed with
  // email_verified=false — so an allowlisted address that had no account in
  // this project yet could be registered by anyone and pass this check.
  // vendorAuthority.ts and comms/adminAuth.ts already require verification;
  // this was the one admin gate that didn't, and it guards disbursePayout.
  // A staff role is granted by an admin as a custom claim, so it needs no
  // email check of its own.
  const emailVerified = request.auth?.token?.email_verified === true;
  const role = String(request.auth?.token?.adminRole ?? "");
  if (
    !request.auth ||
    (!(emailVerified && callerEmail && ADMIN_EMAILS.includes(callerEmail)) &&
      !hasClaim &&
      !STAFF_ROLES.includes(role))
  ) {
    throw new HttpsError("permission-denied", "Only administrators can perform this action.");
  }
}
