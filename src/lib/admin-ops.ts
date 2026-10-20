import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { toast } from "sonner";
import { auth } from "@/lib/firebase";
import { ADMIN_EMAILS } from "@/lib/auth-flow";

export type AdminAction =
  | "adjustWallet"
  | "setCustomerStatus"
  | "refundOrder"
  | "setCommission"
  | "setBillingModel"
  | "upsertMarket"
  | "deleteMarket"
  | "upsertZone"
  | "deleteZone"
  | "moderateReview"
  | "upsertHomeCollection"
  | "deleteHomeCollection"
  | "upsertIncident"
  | "upsertCancellationReason"
  | "generateHostSettlements"
  | "settleHostPayout"
  | "grantAdmin"
  | "revokeAdmin"
  | "seedDefaultOps"
  // Refund maker-checker — approvals above the threshold.
  | "approveRefund"
  | "rejectRefund"
  // Re-runs a failed gateway refund (RefundsPage). Server-only by nature.
  | "retryRefund"
  // ── Onboarding / KYC / activation engine ──
  | "transitionOnboarding"
  | "reviewOnboardingStep"
  | "setBankVerification"
  | "overrideOnboardingZone"
  | "setOnboardingRequirements"
  // ── Vendor management ──
  | "resetVendorPassword"
  | "setVendorStatus";

const call = httpsCallable<
  { action: AdminAction; payload?: Record<string, unknown> },
  { ok?: boolean } & Record<string, unknown>
>(functions, "adminPlatformAction");

async function audit(action: string, payload: Record<string, unknown>) {
  try {
    await addDoc(collection(db, "admin_logs"), {
      type: "platform",
      action,
      description: `admin:${action}`,
      adminEmail: auth.currentUser?.email ?? "",
      payload,
      timestamp: serverTimestamp(),
    });
  } catch {
    /* non-fatal */
  }
}

function str(v: unknown, max = 500) {
  return (v ?? "").toString().trim().slice(0, max);
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Direct Firestore writes — works even if Cloud Functions are not deployed. */
async function firestoreFallback(action: AdminAction, data: Record<string, unknown>) {
  switch (action) {
    case "upsertMarket": {
      const id = str(data.id, 80);
      const ref = id ? doc(db, "markets", id) : doc(collection(db, "markets"));
      await setDoc(
        ref,
        {
          name: str(data.name, 80),
          city: str(data.city, 80) || str(data.name, 80),
          state: str(data.state, 80),
          country: str(data.country, 40) || "IN",
          lat: num(data.lat),
          lng: num(data.lng),
          serviceRadiusKm: num(data.serviceRadiusKm, 7),
          status: str(data.status, 32) || "active",
          deliveryEnabled: data.deliveryEnabled !== false,
          stayEnabled: data.stayEnabled !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await audit(action, { id: ref.id });
      return { ok: true, id: ref.id };
    }
    case "deleteMarket":
      await deleteDoc(doc(db, "markets", str(data.id, 80)));
      return { ok: true };
    case "upsertZone": {
      const id = str(data.id, 80);
      const ref = id ? doc(db, "demand_zones", id) : doc(collection(db, "demand_zones"));
      await setDoc(
        ref,
        {
          name: str(data.name, 80),
          lat: num(data.lat),
          lng: num(data.lng),
          radiusKm: num(data.radiusKm, 2),
          surgeMultiplier: num(data.surgeMultiplier, 1),
          demand: str(data.demand, 32) || "normal",
          active: data.active !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await audit(action, { id: ref.id });
      return { ok: true, id: ref.id };
    }
    case "deleteZone":
      await deleteDoc(doc(db, "demand_zones", str(data.id, 80)));
      return { ok: true };
    case "upsertHomeCollection": {
      const id = str(data.id, 80);
      const ref = id ? doc(db, "home_collections", id) : doc(collection(db, "home_collections"));
      await setDoc(
        ref,
        {
          title: str(data.title, 120),
          subtitle: str(data.subtitle, 200),
          kind: str(data.kind, 40) || "restaurants",
          imageUrl: str(data.imageUrl, 2000),
          restaurantIds: Array.isArray(data.restaurantIds) ? data.restaurantIds.slice(0, 50) : [],
          cuisine: str(data.cuisine, 80),
          sortOrder: num(data.sortOrder, 100),
          active: data.active !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true, id: ref.id };
    }
    case "deleteHomeCollection":
      await deleteDoc(doc(db, "home_collections", str(data.id, 80)));
      return { ok: true };
    case "upsertIncident": {
      const id = str(data.id, 80);
      const ref = id ? doc(db, "ops_incidents", id) : doc(collection(db, "ops_incidents"));
      await setDoc(
        ref,
        {
          title: str(data.title, 160),
          severity: str(data.severity, 24) || "minor",
          status: str(data.status, 24) || "investigating",
          impact: str(data.impact, 400),
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true, id: ref.id };
    }
    case "upsertCancellationReason": {
      const id = str(data.id, 80);
      const ref = id ? doc(db, "cancellation_reasons", id) : doc(collection(db, "cancellation_reasons"));
      await setDoc(
        ref,
        {
          label: str(data.label, 160),
          audience: str(data.audience, 32) || "customer",
          active: data.active !== false,
          sortOrder: num(data.sortOrder, 100),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true, id: ref.id };
    }
    case "setCommission":
      await setDoc(
        doc(db, "restaurants", str(data.restaurantId, 128)),
        { commissionRate: num(data.rate), platformCommission: num(data.rate), commissionUpdatedAt: serverTimestamp() },
        { merge: true },
      );
      return { ok: true };
    case "setCustomerStatus": {
      const status = str(data.status, 32);
      await setDoc(
        doc(db, "customer_users", str(data.uid, 128)),
        {
          accountStatus: status,
          isBanned: status === "banned",
          statusReason: str(data.reason, 400) || null,
          statusUpdatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true };
    }
    // Money-moving actions have NO client fallback: they must run through the
    // server callable (adminPlatformAction), which enforces the maker-checker
    // approval gate on large refunds and writes a tamper-proof audit entry. A
    // browser-side wallet credit / refund would bypass both — so we fail loudly
    // instead of moving money off-book. (Playbook Tier-0.02.)
    case "adjustWallet":
      throw new Error("Wallet adjustments must run on the server. Please retry — the secure path is temporarily unavailable.");
    case "refundOrder":
      throw new Error("Refunds must run on the server (approval + audit). Please retry — the secure path is temporarily unavailable.");
    case "moderateReview": {
      await setDoc(
        doc(db, "restaurants", str(data.restaurantId, 128), "reviews", str(data.reviewId, 128)),
        {
          moderationStatus: str(data.status, 32),
          hidden: str(data.status, 32) === "hidden",
          moderatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true };
    }
    // Marking a settlement paid is a record that money LEFT the platform. The
    // server does it in a transaction that refuses an already-paid settlement
    // and stamps who settled it; doing it from the browser skipped both, so a
    // retry could record a second payout against the same settlement and
    // overwrite the first UTR — the evidence that the first one happened.
    case "settleHostPayout":
      throw new Error("Host payouts must be settled on the server (double-payment guard + audit). Please retry — the secure path is temporarily unavailable.");
    case "seedDefaultOps": {
      const batch = writeBatch(db);
      [
        { label: "Changed my mind", audience: "customer" },
        { label: "Ordered by mistake", audience: "customer" },
        { label: "Rider taking too long", audience: "customer" },
        { label: "Restaurant closed / item unavailable", audience: "vendor" },
        { label: "Unable to reach customer", audience: "rider" },
        { label: "Guest cancelled stay", audience: "stay" },
      ].forEach((r, i) => {
        batch.set(doc(collection(db, "cancellation_reasons")), {
          ...r,
          active: true,
          sortOrder: i + 1,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      await setDoc(
        doc(db, "config", "feature_flags"),
        {
          groupOrdering: true,
          kadaGold: true,
          kadaStay: true,
          tableBooking: true,
          giftCards: true,
          cashOnDelivery: true,
          wallet: true,
          referrals: true,
          ads: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        doc(db, "config", "loyalty"),
        {
          earnPerHundred: 5,
          redeemValuePaise: 100,
          referralBonus: 50,
          referredBonus: 50,
          goldMonthlyPrice: 99,
          goldQuarterlyPrice: 249,
          goldYearlyPrice: 799,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await setDoc(
        doc(db, "config", "app_releases"),
        {
          customerMinIos: "1.0.0",
          customerMinAndroid: "1.0.0",
          forceUpdate: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: true };
    }
    case "grantAdmin": {
      // Only bootstrap admins can grant access via the fallback path
      const callerEmail = auth.currentUser?.email?.toLowerCase() ?? "";
      if (!ADMIN_EMAILS.includes(callerEmail)) throw new Error("Insufficient permissions to grant admin access.");
      const email = str(data.email, 160).toLowerCase();
      if (!email.includes("@")) throw new Error("Valid email required");
      const id = email.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      await setDoc(
        doc(db, "admin_team", id),
        {
          email,
          role: str(data.role, 40) || "ops",
          active: true,
          claimsPending: true,
          googleWorkspace: data.createGoogleAccount ? "pending" : "none",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await audit(action, { email, createGoogleAccount: !!data.createGoogleAccount });
      return { ok: true, claimsPending: true };
    }
    case "revokeAdmin": {
      const callerEmail = auth.currentUser?.email?.toLowerCase() ?? "";
      if (!ADMIN_EMAILS.includes(callerEmail)) throw new Error("Insufficient permissions to revoke admin access.");
      const id = str(data.uid, 128);
      if (!id) throw new Error("Member id required");
      await setDoc(doc(db, "admin_team", id), { active: false, claimsPending: true, updatedAt: serverTimestamp() }, { merge: true });
      return { ok: true, claimsPending: true };
    }
    case "setVendorStatus": {
      const restaurantId = str(data.restaurantId, 128);
      const isBlocked = Boolean(data.isBlocked);
      const reason = str(data.reason, 400);
      if (!restaurantId) throw new Error("Restaurant ID required");
      await setDoc(doc(db, "restaurants", restaurantId), {
        isBlocked,
        blockedReason: isBlocked ? (reason || "Suspended by admin") : null,
        blockedAt: isBlocked ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await audit(action, { restaurantId, isBlocked, reason });
      return { ok: true, isBlocked };
    }
    case "resetVendorPassword": {
      const email = str(data.email, 128);
      if (email) {
        const { sendPasswordResetEmail } = await import("firebase/auth");
        await sendPasswordResetEmail(auth, email);
        await audit(action, { restaurantId: data.restaurantId, email, mode: "client_send_email" });
        return { ok: true, mode: "send_email", email, message: `Password reset email dispatched to ${email}.` };
      }
      throw new Error("Password reset requires Cloud Function (adminPlatformAction) or a valid vendor email.");
    }
    case "overrideOnboardingZone": {
      const role = (str(data.role, 20) || "vendor") as "vendor" | "rider" | "host" | "mess";
      const partnerId = str(data.partnerId, 128);
      const zoneId = str(data.zoneId, 128);
      const zoneName = str(data.zoneName, 128);
      const reason = str(data.reason, 500) || "Zone assigned by admin";
      if (!partnerId || !zoneId) throw new Error("Partner ID and Zone ID are required");
      const collMap: Record<string, string> = {
        vendor: "restaurants",
        rider: "delivery_users",
        host: "hotels",
        mess: "mess_kitchens",
      };
      const coll = collMap[role] || "restaurants";
      await setDoc(
        doc(db, coll, partnerId),
        {
          zoneId,
          zoneName: zoneName || null,
          onboarding: {
            zoneId,
            zoneName: zoneName || null,
            zoneOverrideReason: reason,
            zoneOverrideBy: auth.currentUser?.email ?? "admin",
            steps: { zone_assignment: true, map_location: true },
            updatedAt: serverTimestamp(),
          },
          serviceable: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await audit(action, { role, partnerId, zoneId, zoneName, reason });
      return { ok: true };
    }
    case "setBankVerification": {
      const role = (str(data.role, 20) || "vendor") as "vendor" | "rider" | "host" | "mess";
      const partnerId = str(data.partnerId, 128);
      const to = str(data.to, 40) || "verified";
      const message = str(data.message, 500);
      if (!partnerId) throw new Error("Partner ID required");
      const collMap: Record<string, string> = {
        vendor: "restaurants",
        rider: "delivery_users",
        host: "hotels",
        mess: "mess_kitchens",
      };
      const coll = collMap[role] || "restaurants";
      await setDoc(
        doc(db, coll, partnerId),
        {
          bank: {
            verificationState: to,
            verificationMessage: message || (to === "verified" ? "Verified by reviewer" : null),
            ...(to === "verified" ? { verifiedAt: serverTimestamp() } : {}),
            updatedAt: serverTimestamp(),
          },
          onboarding: {
            steps: { bank_verification: to === "verified" },
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true },
      );
      await audit(action, { role, partnerId, to, message });
      return { ok: true, to };
    }
    case "reviewOnboardingStep": {
      const role = (str(data.role, 20) || "vendor") as "vendor" | "rider" | "host" | "mess";
      const partnerId = str(data.partnerId, 128);
      const stepId = str(data.stepId, 64);
      const decision = str(data.decision, 20); // "approved" | "rejected"
      const reason = str(data.reason, 500);
      if (!partnerId || !stepId || !["approved", "rejected"].includes(decision)) {
        throw new Error("Partner ID, step ID and decision are required");
      }
      const collMap: Record<string, string> = {
        vendor: "restaurants",
        rider: "delivery_users",
        host: "hotels",
        mess: "mess_kitchens",
      };
      const coll = collMap[role] || "restaurants";
      await setDoc(
        doc(db, coll, partnerId),
        {
          onboarding: {
            stepReviews: {
              [stepId]: {
                decision,
                by: auth.currentUser?.email ?? "admin",
                at: serverTimestamp(),
                reason: reason || null,
              },
            },
            steps: {
              [stepId]: decision === "approved",
            },
            ...(decision === "rejected" ? { state: "action_required" } : {}),
            updatedAt: serverTimestamp(),
          },
          onboardingChecks: {
            documents: {
              [stepId]: {
                status: decision === "approved" ? "auto_verified" : "retake",
                issues: decision === "approved" ? [] : [reason],
                provider: "admin",
                reviewedBy: auth.currentUser?.email ?? "admin",
                checkedAt: serverTimestamp(),
              },
            },
          },
        },
        { merge: true },
      );
      await audit(action, { role, partnerId, stepId, decision, reason });
      return { ok: true };
    }
    case "transitionOnboarding": {
      const role = (str(data.role, 20) || "vendor") as "vendor" | "rider" | "host" | "mess";
      const partnerId = str(data.partnerId, 128);
      const to = str(data.to, 40) || "active";
      const reason = str(data.reason, 500);
      if (!partnerId || !to) throw new Error("Partner ID and stage required");
      const collMap: Record<string, string> = {
        vendor: "restaurants",
        rider: "delivery_users",
        host: "hotels",
        mess: "mess_kitchens",
      };
      const coll = collMap[role] || "restaurants";
      await setDoc(
        doc(db, coll, partnerId),
        {
          onboarding: {
            state: to,
            updatedAt: serverTimestamp(),
          },
          ...(to === "active" ? { isBlocked: false, isVerified: true } : {}),
        },
        { merge: true },
      );
      await addDoc(collection(db, coll, partnerId, "onboarding_events"), {
        to,
        actor: "admin",
        actorId: auth.currentUser?.email ?? "admin",
        reason: reason || null,
        at: serverTimestamp(),
      }).catch(() => {});
      await audit(action, { role, partnerId, to, reason });
      return { ok: true, to };
    }
    case "generateHostSettlements":
      throw new Error("This action needs Cloud Functions deployed (adminPlatformAction).");
    default:
      throw new Error(`No client fallback for ${action}`);
  }
}

/**
 * Callable error codes that mean the server RAN and said no. These must never
 * fall through to a browser write.
 *
 * The fallback existed for one situation: Cloud Functions not deployed yet. But
 * it caught every error, so any deliberate server refusal was retried as a
 * direct Firestore write — and `adminPlatformAction` refuses deliberately a
 * lot. Its per-action RBAC table (`assertActionRole`) throws permission-denied,
 * which the fallback then performed anyway: role checks only held for the
 * actions that happen to have no fallback branch. The same went for every
 * precondition — `settleHostPayout` refuses "Already paid", and the fallback
 * re-stamped the settlement as paid with a fresh UTR, erasing the guard against
 * paying a host twice.
 *
 * A refusal is now surfaced. Only a genuinely unreachable function falls back.
 */
const SERVER_VERDICT_CODES = new Set([
  "permission-denied",
  "unauthenticated",
  "invalid-argument",
  "failed-precondition",
  "already-exists",
  "out-of-range",
  "resource-exhausted",
  "aborted",
  "data-loss",
  // The server ran and threw something unexpected. It may have half-applied;
  // repeating the write from the browser would compound that, not fix it.
  "internal",
]);

/** Actions with no client path, ever: they move money or record that it moved. */
const SERVER_ONLY: AdminAction[] = [
  "adjustWallet",
  "refundOrder",
  "approveRefund",
  "rejectRefund",
  "retryRefund",
  "settleHostPayout",
  "generateHostSettlements",
];

export async function adminAction(action: AdminAction, payload: Record<string, unknown> = {}) {
  try {
    const res = await call({ action, payload });
    return res.data;
  } catch (e) {
    const code = ((e as { code?: string }).code ?? "").replace(/^functions\//, "");
    if (SERVER_VERDICT_CODES.has(code) || SERVER_ONLY.includes(action)) {
      throw e;
    }
    console.warn(`callable ${action} unreachable (${code || "unknown"}), using Firestore fallback`, e);
    return firestoreFallback(action, payload);
  }
}

export async function adminActionToast(
  action: AdminAction,
  payload: Record<string, unknown> = {},
  success = "Saved",
) {
  try {
    const data = await adminAction(action, payload);
    // A high-value action that got queued for maker-checker approval isn't done
    // yet — tell the operator a second admin must approve it.
    if (data && typeof data === "object" && (data as { pendingApproval?: boolean }).pendingApproval === true) {
      toast.info("Queued for approval — a second admin must approve this before any money moves.");
    } else {
      toast.success(success);
    }
    return data;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Action failed";
    toast.error(msg);
    throw e;
  }
}
