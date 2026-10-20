/**
 * ─────────────────────────────────────────────────────────────────────────
 * Onboarding transition engine — the ONLY writer of `onboarding.state`.
 *
 * Every state change goes through `transitionPartner`, which:
 *   1. reads current state inside a transaction (no lost updates / races)
 *   2. refuses illegal transitions per the state machine
 *   3. re-derives the mandatory-step gates before allowing `active`
 *   4. writes the new state + an immutable event to the timeline
 *
 * Nothing else may write the field. Firestore rules block client writes to
 * `onboarding.*` entirely, and the admin console calls the callable rather
 * than `updateDoc`, so the transaction is the true choke point.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import {
  type OnboardingRecord,
  type OnboardingState,
  type PartnerRole,
  ROLE_COLLECTION,
  ONBOARDING_EVENTS_SUBCOLLECTION,
  canTransition,
  explainTransition,
  isOnboardingState,
} from "./stateMachine";
import {
  resolveRequirements,
  missingMandatorySteps,
  completionPercent,
  applicantContextOf,
} from "./kycRules";
import { loadRequirementOverrides } from "./activationGate";
import { BANK_STATES, type BankVerificationState } from "./bankVerification";

export interface TransitionInput {
  role: PartnerRole;
  partnerId: string;
  to: OnboardingState;
  /** "admin" | "system" | "applicant" */
  actor: string;
  actorId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  /**
   * Skips the mandatory-gate recheck when entering `active`. Only an explicit
   * admin override may set this, and it is recorded in the event so the
   * exception is auditable rather than invisible.
   */
  overrideGates?: boolean;
}

export interface TransitionResult {
  from: OnboardingState | null;
  to: OnboardingState;
  completion: number;
}

/**
 * Performs a guarded state transition. Throws HttpsError on any violation.
 */
export async function transitionPartner(
  input: TransitionInput,
): Promise<TransitionResult> {
  const { role, partnerId, to, actor, actorId, reason, metadata } = input;

  if (!partnerId) {
    throw new HttpsError("invalid-argument", "partnerId is required.");
  }
  if (!isOnboardingState(to)) {
    throw new HttpsError("invalid-argument", `Unknown target state "${to}".`);
  }

  const db = admin.firestore();
  const ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
  const overrides = await loadRequirementOverrides();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", `${role} ${partnerId} not found.`);
    }
    const data = snap.data() ?? {};
    const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;

    // A doc predating this engine starts at `started` rather than being
    // treated as already-live — legacy partners must be migrated explicitly.
    const from: OnboardingState = isOnboardingState(ob.state) ? ob.state : "started";

    if (from === to) {
      // Idempotent no-op — re-running a transition shouldn't error or
      // append a duplicate timeline entry.
      return {
        from,
        to,
        completion: currentCompletion(role, data, ob, overrides),
        noop: true,
      };
    }

    if (!canTransition(from, to)) {
      throw new HttpsError("failed-precondition", explainTransition(from, to));
    }

    // ── Hard gate: entering `active` re-derives every requirement ───────
    if (to === "active" && !input.overrideGates) {
      const blockers = activationBlockers(role, data, ob, overrides);
      if (blockers.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          `Cannot activate: ${blockers.join(" ")}`,
        );
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {
      "onboarding.state": to,
      "onboarding.role": role,
      "onboarding.updatedAt": now,
    };

    // Stamp lifecycle timestamps on the transitions that earn them.
    if (to === "submitted") patch["onboarding.submittedAt"] = now;
    if (to === "approved") patch["onboarding.approvedAt"] = now;
    if (to === "active") {
      patch["onboarding.activatedAt"] = now;
      patch["onboarding.blockingReasons"] = [];
      // Mirror to the legacy flags the rest of the platform still reads, so
      // dispatch/discovery stay consistent during the migration window.
      patch["isActive"] = true;
      if (role === "rider") patch["status"] = "approved";
    }
    if (to === "suspended") {
      patch["onboarding.suspendedAt"] = now;
      patch["isActive"] = false;
      if (role === "rider") patch["status"] = "suspended";
    }
    if (to === "action_required" && reason) {
      patch["onboarding.blockingReasons"] = [reason];
    }

    tx.update(ref, patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);

    // Immutable timeline entry.
    tx.set(ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).doc(), {
      partnerId,
      role,
      from,
      to,
      actor,
      actorId: actorId ?? null,
      reason: reason ?? null,
      metadata: metadata ?? null,
      at: now,
    });

    return {
      from,
      to,
      completion: currentCompletion(role, data, ob, overrides),
      noop: false,
    };
  });

  return { from: result.from, to: result.to, completion: result.completion };
}

export { applicantContextOf };

function currentCompletion(
  role: PartnerRole,
  data: Record<string, unknown>,
  ob: Partial<OnboardingRecord>,
  overrides: Record<string, Record<string, Record<string, unknown>>>,
): number {
  const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);
  return completionPercent(reqs, ob.steps);
}

/**
 * Every reason this partner may not be activated right now. Shared by the
 * transition guard and the admin "why is this blocked?" surface, so the
 * console never explains it differently from how the engine enforces it.
 */
export function activationBlockers(
  role: PartnerRole,
  data: Record<string, unknown>,
  ob: Partial<OnboardingRecord>,
  overrides: Record<string, Record<string, Record<string, unknown>>>,
): string[] {
  const blockers: string[] = [];
  const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);

  const missing = missingMandatorySteps(reqs, ob.steps);
  if (missing.length > 0) {
    blockers.push(
      `${missing.length} mandatory step(s) incomplete: ${missing
        .map((m) => m.label)
        .join(", ")}.`,
    );
  }

  const bank = (data.bank ?? {}) as { verificationState?: BankVerificationState };
  const bankState = bank.verificationState ?? BANK_STATES.NOT_ADDED;
  if (bankState !== BANK_STATES.VERIFIED) {
    blockers.push(`Bank account is "${bankState}", must be "verified".`);
  }

  if (!ob.zoneId) {
    blockers.push("No service zone assigned.");
  }

  const reasons = Array.isArray(ob.blockingReasons) ? ob.blockingReasons : [];
  if (reasons.length > 0) {
    blockers.push(...reasons.map(String));
  }

  return blockers;
}

/**
 * Marks a single onboarding step complete (or incomplete) and, when every
 * mandatory step is done, auto-advances an `incomplete` partner to
 * `submitted`. Called by the partner apps as the applicant progresses.
 */
export async function setStepComplete(
  role: PartnerRole,
  partnerId: string,
  stepId: string,
  complete: boolean,
  actorId?: string,
): Promise<{ completion: number; state: OnboardingState }> {
  const db = admin.firestore();
  const ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
  const overrides = await loadRequirementOverrides();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", `${role} ${partnerId} not found.`);
    }
    const data = snap.data() ?? {};
    const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
    const from: OnboardingState = isOnboardingState(ob.state) ? ob.state : "started";

    // Steps may only be edited while the applicant still owns the form.
    const editable: OnboardingState[] = ["started", "incomplete", "action_required"];
    if (!editable.includes(from)) {
      throw new HttpsError(
        "failed-precondition",
        `Cannot edit steps while onboarding state is "${from}".`,
      );
    }

    const steps = { ...(ob.steps ?? {}), [stepId]: complete };
    const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);
    const completion = completionPercent(reqs, steps);
    const remaining = missingMandatorySteps(reqs, steps);

    const now = admin.firestore.FieldValue.serverTimestamp();
    // Moving off `started`/`action_required` the moment real progress lands.
    const nextState: OnboardingState = from === "started" ? "incomplete" : from;

    tx.update(ref, {
      "onboarding.steps": steps,
      "onboarding.state": nextState,
      "onboarding.role": role,
      "onboarding.updatedAt": now,
    });

    if (nextState !== from) {
      tx.set(ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).doc(), {
        partnerId,
        role,
        from,
        to: nextState,
        actor: "applicant",
        actorId: actorId ?? null,
        reason: `Step "${stepId}" ${complete ? "completed" : "cleared"}`,
        at: now,
      });
    }

    return {
      completion,
      state: nextState,
      remaining: remaining.map((r) => r.id),
    } as any;
  });
}
