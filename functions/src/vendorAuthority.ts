/**
 * Who may act on a restaurant's orders — the server-side answer.
 *
 * Mirrors `isRestaurantOwner` + `staffCanManageOrder` in firestore.rules, so a
 * callable and a direct write reach the same verdict. Before this, callables
 * used an exact `restaurantId === uid` match: parent (multi-outlet) owners and
 * every staff login were refused, while the rules gave staff no order access
 * at all — so Kitchen/Cashier roles could not operate orders.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { resolveStaffPermissions } from "./vendorOrderRules";

export type VendorActorRole = "admin" | "owner" | "staff";

export interface VendorActor {
  uid: string;
  role: VendorActorRole;
  staffId?: string;
  /** "all" for owners/admins; a concrete set for staff. */
  permissions: ReadonlySet<string> | "all";
}

// Mirrors firestore.rules isAdmin().
const ADMIN_EMAILS = ["thekada@gmail.com", "thekadaapp@gmail.com"];

type AuthLike = { auth?: { uid?: string; token?: Record<string, unknown> } | null };

export function actorHasAny(actor: VendorActor, perms: string[]): boolean {
  if (actor.permissions === "all") return true;
  const held = actor.permissions;
  return perms.some((p) => held.has(p));
}

/** Timeline role label, consistent with existing "vendor"/"admin" events. */
export function timelineRole(actor: VendorActor): string {
  if (actor.role === "admin") return "admin";
  return actor.role === "staff" ? "vendor_staff" : "vendor";
}

export async function resolveVendorActor(
  request: AuthLike,
  restaurantId: string,
): Promise<VendorActor> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const token = request.auth?.token ?? {};

  const isAdmin =
    token.platformAdmin === true ||
    (token.email_verified === true && ADMIN_EMAILS.includes(String(token.email ?? "")));
  if (isAdmin) return { uid, role: "admin", permissions: "all" };

  if (!restaurantId) {
    throw new HttpsError("failed-precondition", "This order is not linked to a restaurant.");
  }
  if (uid === restaurantId) return { uid, role: "owner", permissions: "all" };

  const db = admin.firestore();
  const [restSnap, callerSnap] = await Promise.all([
    db.collection("restaurants").doc(restaurantId).get(),
    db.collection("restaurants").doc(uid).get(),
  ]);
  // Parent owner of this outlet.
  if (restSnap.exists && restSnap.data()?.parentId === uid) {
    return { uid, role: "owner", permissions: "all" };
  }
  // Caller is an outlet of this restaurant (same grant as the rules).
  if (callerSnap.exists && callerSnap.data()?.parentId === restaurantId) {
    return { uid, role: "owner", permissions: "all" };
  }

  const staffDocId = typeof token.staffDocId === "string" ? token.staffDocId : "";
  if (token.staff === true && token.restaurantId === restaurantId && staffDocId) {
    const staffSnap = await db.collection("staff").doc(staffDocId).get();
    const s = staffSnap.data() ?? {};
    // A claim alone is not enough: the staff doc must still belong to this
    // restaurant and login must not have been disabled by the owner.
    if (staffSnap.exists && s.restaurantId === restaurantId && s.loginEnabled !== false) {
      return {
        uid,
        role: "staff",
        staffId: staffSnap.id,
        permissions: resolveStaffPermissions(s),
      };
    }
  }

  throw new HttpsError("permission-denied", "You don't have access to this restaurant's orders.");
}
