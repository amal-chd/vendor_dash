/**
 * ─────────────────────────────────────────────────────────────────────────
 * Onboarding backfill — migrates partners that predate the state machine.
 *
 * WHY THIS IS MANDATORY BEFORE THE GATE SHIPS:
 * `activationGate` treats a partner with no `onboarding` record as NOT
 * operational (fail-closed, deliberately — a legacy doc must not silently
 * inherit live privileges). Without this backfill, deploying the engine
 * would halt every existing vendor, rider and host at once.
 *
 * The migration infers each partner's lifecycle state from the legacy flags
 * they already carry, and — critically — decides their BANK state from
 * evidence rather than assumption:
 *
 *   verified            ← a prior payout to this account actually completed.
 *                         A settled bank transfer is real evidence the
 *                         details are correct and someone accepted the money.
 *                         Recorded with `grandfathered: true` provenance so
 *                         an auditor can tell it apart from a fresh check.
 *   pending_verification ← details on file but never successfully paid.
 *   not_added            ← no usable account/IFSC pair at all.
 *
 * Grandfathering only on a *completed payout* is the narrow, defensible
 * line: it never blesses an account the platform has not already proven,
 * and it never silently trusts a string someone typed.
 *
 * Idempotent — re-running skips partners that already have a record, so it
 * is safe to run repeatedly while rolling out.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { assertAdmin } from "../admin_operations";
import {
  type OnboardingState,
  type PartnerRole,
  ROLE_COLLECTION,
  PARTNER_ROLES,
  ONBOARDING_EVENTS_SUBCOLLECTION,
} from "./stateMachine";
import {
  resolveRequirements,
  type ApplicantContext,
} from "./kycRules";
import {
  BANK_STATES,
  type BankVerificationState,
  bankDetailsHash,
} from "./bankVerification";
import {
  SENSITIVE_BANK_KEYS,
  fingerprintBank,
  ownerUidsOf,
  partnerPrivateRef,
  publicBankSummary,
  resolveBankDetails,
} from "./partnerPrivate";

/**
 * Has a payout to this partner ever actually completed? That is the only
 * evidence we accept for grandfathering a bank account as verified.
 */
async function hasCompletedPayout(
  db: admin.firestore.Firestore,
  role: PartnerRole,
  partnerId: string,
): Promise<boolean> {
  const field =
    role === "vendor"
      ? "restaurantId"
      : role === "host"
        ? "hotelId"
        : role === "mess"
          ? "kitchenId"
          : "riderUid";
  try {
    const snap = await db
      .collection("payouts")
      .where(field, "==", partnerId)
      .where("status", "in", ["processed", "paid", "completed"])
      .limit(1)
      .get();
    if (!snap.empty) return true;
  } catch (e) {
    logger.warn(`backfill: payout lookup failed for ${role}/${partnerId}`, e);
  }

  // Settlement docs are the other place a completed transfer is recorded.
  const settlementCollection =
    role === "vendor"
      ? "vendor_settlements"
      : role === "host"
        ? "host_settlements"
        : role === "mess"
          ? "mess_settlements"
          : "payout_requests";
  const settlementField = role === "rider" ? "riderUid" : field;
  try {
    const snap = await db
      .collection(settlementCollection)
      .where(settlementField, "==", partnerId)
      .where("status", "==", "paid")
      .limit(1)
      .get();
    return !snap.empty;
  } catch (e) {
    logger.warn(`backfill: settlement lookup failed for ${role}/${partnerId}`, e);
    return false;
  }
}

/** Infers the lifecycle state a legacy partner should land in. */
export function inferState(
  role: PartnerRole,
  d: Record<string, any>,
): OnboardingState {
  const blocked = d.isBlocked === true || d.isDeleted === true;
  if (blocked) return "suspended";

  if (role === "rider") {
    const s = String(d.status ?? "").toLowerCase();
    if (s === "approved") return "active";
    if (s === "suspended" || s === "rejected") return "suspended";
    if (s === "pending_approval") return "submitted";
    return "incomplete";
  }

  const kyc = String(d.kycStatus ?? "").toLowerCase();
  const legacyStep = String(d.onboardingStep ?? "").toLowerCase();

  // A vendor already serving traffic (live + not blocked) stays operational.
  if (legacyStep === "live" || d.isActive === true) {
    if (kyc === "rejected") return "action_required";
    return "active";
  }
  if (kyc === "rejected") return "action_required";
  if (kyc === "approved" || kyc === "verified") return "approved";
  if (kyc === "pending") return "submitted";
  if (legacyStep === "profile_complete" || legacyStep === "menu_added") return "submitted";
  if (legacyStep === "setup_started") return "incomplete";
  return "started";
}

/**
 * Marks every mandatory step complete for a partner we are grandfathering
 * into `active`. Without this the gate would immediately fail them on
 * "mandatory steps incomplete" even though they are live today — we are
 * recording that the legacy flow accepted them, not that we re-checked.
 */
function stepsForLegacyActive(
  role: PartnerRole,
  d: Record<string, any>,
  bankState: BankVerificationState,
): Record<string, boolean> {
  const ctx: ApplicantContext = {
    businessStructure: d.businessStructure,
    gstRegistered: Boolean(d.gstRegistered ?? d.gst ?? d.taxId),
    vehicleType: d.vehicleType,
    servesFood: d.servesFood,
    acceptsPayouts: d.acceptsPayouts,
  };
  const reqs = resolveRequirements(role, ctx);
  const steps: Record<string, boolean> = {};
  for (const r of reqs) {
    // Bank verification is the one step we never fake — it reflects the
    // real bank state, so an unverified legacy account still blocks payouts.
    if (r.id === "bank_verification") {
      steps[r.id] = bankState === BANK_STATES.VERIFIED;
      continue;
    }
    steps[r.id] = true;
  }
  return steps;
}

/**
 * True for a partner who was live before the onboarding engine existed and
 * that the engine has never really initialised: no record at all, or only a
 * filling state some app wrote by ticking a step (no trigger `account` tick,
 * never migrated, never submitted). Such a partner must not be treated as a
 * fresh applicant — opening the wizard used to flip a live rider to
 * `incomplete`, which pushed them into onboarding and stopped dispatch.
 */
export function isUninitialisedLegacyLive(role: PartnerRole, d: Record<string, any>): boolean {
  const ob = (d.onboarding ?? {}) as Record<string, any>;
  const filling = !ob.state || ob.state === "started" || ob.state === "incomplete";
  const engineTouched =
    ob.steps?.account === true || ob.migratedFromLegacy === true || Boolean(ob.submittedAt) || Boolean(ob.activatedAt);
  return filling && !engineTouched && inferState(role, d) === "active";
}

/**
 * Migrates ONE legacy-live partner the way the backfill would (state and
 * steps; bank is left exactly as it is, so payouts stay gated on a real
 * verification). Called lazily from the onboarding callables so a live
 * partner who opens the wizard before the backfill has run is recognised as
 * live instead of being restarted. Returns true when it migrated.
 */
export async function grandfatherIfLegacyLive(role: PartnerRole, partnerId: string): Promise<boolean> {
  const db = admin.firestore();
  const ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (!snap.exists || !d || !isUninitialisedLegacyLive(role, d)) return false;
      const ob = (d.onboarding ?? {}) as Record<string, any>;
      const bankState = (d.bank?.verificationState ?? BANK_STATES.NOT_ADDED) as BankVerificationState;
      const now = admin.firestore.FieldValue.serverTimestamp();
      tx.set(ref, {
        onboarding: {
          state: "active",
          role,
          steps: { ...stepsForLegacyActive(role, d, bankState), ...(ob.steps ?? {}) },
          blockingReasons: [],
          migratedFromLegacy: true,
          activatedAt: d.createdAt ?? now,
          updatedAt: now,
        },
      }, { merge: true });
      tx.set(ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).doc(), {
        partnerId,
        role,
        from: ob.state ?? null,
        to: "active",
        actor: "system",
        actorId: "legacy-grandfather",
        reason: "Already live before the onboarding engine; recognised on first visit",
        at: now,
      });
      return true;
    });
  } catch (e) {
    logger.warn(`grandfatherIfLegacyLive failed for ${role}/${partnerId}`, e);
    return false;
  }
}

export interface BackfillReport {
  role: PartnerRole;
  scanned: number;
  migrated: number;
  skipped: number;
  byState: Record<string, number>;
  byBankState: Record<string, number>;
  errors: string[];
}

/** Migrates one role. `dryRun` reports without writing. */
export async function backfillRole(
  role: PartnerRole,
  opts?: { dryRun?: boolean; limit?: number },
): Promise<BackfillReport> {
  const db = admin.firestore();
  const dryRun = opts?.dryRun !== false; // default SAFE: dry run
  const limit = Math.min(5000, Math.max(1, opts?.limit ?? 2000));

  const report: BackfillReport = {
    role,
    scanned: 0,
    migrated: 0,
    skipped: 0,
    byState: {},
    byBankState: {},
    errors: [],
  };

  const snap = await db.collection(ROLE_COLLECTION[role]).limit(limit).get();

  for (const docSnap of snap.docs) {
    report.scanned++;
    const d = docSnap.data() ?? {};

    // Idempotent — never re-migrate a partner that already has a record.
    if (d.onboarding?.state) {
      report.skipped++;
      continue;
    }

    try {
      const state = inferState(role, d);

      // ── Bank state from evidence, not assumption ──────────────────
      // Private store first, then the legacy public blobs — this may run
      // before or after sealPartnerPrivateData.
      const privateRef = partnerPrivateRef(role, docSnap.id);
      const legacyBank = resolveBankDetails((await privateRef.get()).data(), d);
      let bankState: BankVerificationState = BANK_STATES.NOT_ADDED;
      if (legacyBank) {
        const paid = await hasCompletedPayout(db, role, docSnap.id);
        bankState = paid ? BANK_STATES.VERIFIED : BANK_STATES.PENDING;
      }

      report.byState[state] = (report.byState[state] ?? 0) + 1;
      report.byBankState[bankState] = (report.byBankState[bankState] ?? 0) + 1;

      if (dryRun) continue;

      const now = admin.firestore.FieldValue.serverTimestamp();
      const steps =
        state === "active"
          ? stepsForLegacyActive(role, d, bankState)
          : {};

      const patch: Record<string, unknown> = {
        onboarding: {
          state,
          role,
          steps,
          businessStructure: d.businessStructure ?? null,
          zoneId: d.zoneId ?? null,
          marketId: d.marketId ?? null,
          blockingReasons: [],
          migratedFromLegacy: true,
          updatedAt: now,
          ...(state === "active" ? { activatedAt: d.createdAt ?? now } : {}),
        },
      };

      const batch = db.batch();
      if (legacyBank) {
        const del = admin.firestore.FieldValue.delete();
        // Vendor and host docs are world-readable: they get the state and a
        // masked summary; the details go to partner_private.
        patch.bank = {
          ...Object.fromEntries(SENSITIVE_BANK_KEYS.map((k) => [k, del])),
          ...publicBankSummary(legacyBank),
          verificationState: bankState,
          verificationMessage:
            bankState === BANK_STATES.VERIFIED
              ? "Grandfathered — a prior payout to this account completed."
              : "Migrated from legacy onboarding; needs verification before payout.",
          grandfathered: bankState === BANK_STATES.VERIFIED,
          updatedAt: now,
        };
        if (legacyBank.source !== "private") {
          const fp = await fingerprintBank(legacyBank.accountNumber, legacyBank.ifsc);
          batch.set(
            privateRef,
            {
              role,
              partnerId: docSnap.id,
              ownerUids: ownerUidsOf(role, docSnap.id, d),
              bank: {
                holder: legacyBank.holder,
                accountNumber: legacyBank.accountNumber,
                ifsc: legacyBank.ifsc,
                ...(legacyBank.vpa ? { vpa: legacyBank.vpa } : {}),
                detailsHash: bankDetailsHash(legacyBank),
                migratedFrom: legacyBank.source,
                updatedAt: now,
              },
              ...(fp ?? {}),
              updatedAt: now,
            },
            { merge: true },
          );
        }
      }

      batch.set(docSnap.ref, patch, { merge: true });
      await batch.commit();

      // Seed the immutable timeline so the migration itself is auditable.
      await docSnap.ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).add({
        partnerId: docSnap.id,
        role,
        from: null,
        to: state,
        actor: "system",
        actorId: "onboarding-backfill",
        reason:
          `Migrated from legacy fields (kycStatus=${d.kycStatus ?? "—"}, ` +
          `onboardingStep=${d.onboardingStep ?? "—"}, status=${d.status ?? "—"}). ` +
          `Bank → ${bankState}.`,
        metadata: { migratedFromLegacy: true },
        at: now,
      });

      report.migrated++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.errors.push(`${docSnap.id}: ${msg}`);
      logger.error(`backfill ${role}/${docSnap.id} failed`, e);
    }
  }

  return report;
}

/**
 * Admin callable. Defaults to a DRY RUN — pass `apply: true` to write.
 * Run the dry run first and read the state distribution before applying.
 */
export const backfillOnboarding = onCall(async (request) => {
  assertAdmin(request);
  const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
  const role = (typeof claims.adminRole === "string" && claims.adminRole) || "super_admin";
  if (!["super_admin", "platform_admin"].includes(role)) {
    throw new HttpsError(
      "permission-denied",
      "Only super_admin or platform_admin may run the onboarding backfill.",
    );
  }

  const apply = request.data?.apply === true;
  const only = request.data?.role as PartnerRole | undefined;
  const limit = Number(request.data?.limit) || 2000;

  const roles: PartnerRole[] =
    only && PARTNER_ROLES.includes(only) ? [only] : [...PARTNER_ROLES];

  const reports: BackfillReport[] = [];
  for (const r of roles) {
    reports.push(await backfillRole(r, { dryRun: !apply, limit }));
  }

  return {
    dryRun: !apply,
    reports,
    note: apply
      ? "Applied. Partners without a completed prior payout have bank state " +
        "'pending_verification' and cannot receive payouts until verified."
      : "DRY RUN — nothing written. Re-run with apply:true to migrate.",
  };
});
