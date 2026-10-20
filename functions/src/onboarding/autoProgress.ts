/**
 * ─────────────────────────────────────────────────────────────────────────
 * Automatic go-live.
 *
 * When a partner has finished every mandatory step, this decides what
 * happens next without anyone at Kada lifting a finger:
 *
 *   every document auto_verified, bank verified, inside a service zone,
 *   no risk flags                        → walk the state machine to `active`
 *   something is still being checked     → `submitted`, waiting on it
 *   something needs a person             → `submitted`, with the exact reasons
 *                                          queued for the admin console
 *
 * The walk goes through every state the machine requires (submitted →
 * kyc_review → approved → commercial_setup → ready_for_activation → active),
 * so the activation gate and the immutable timeline still apply — automation
 * never bypasses them, it just takes the steps for the reviewer.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import {
  type OnboardingRecord,
  type OnboardingState,
  type PartnerRole,
  ROLE_COLLECTION,
  isOnboardingState,
} from "./stateMachine";
import { applicantContextOf, missingMandatorySteps, resolveRequirements } from "./kycRules";
import { loadRequirementOverrides } from "./activationGate";
import { BANK_STATES } from "./bankVerification";
import { transitionPartner } from "./transition";

export type DocumentCheckStatus = "checking" | "auto_verified" | "needs_review" | "retake";

export interface AutoProgressInput {
  state: OnboardingState;
  missing: string[];
  /** Mandatory, AI-checked document steps: id → label. */
  checkedDocuments: { id: string; label: string }[];
  documentChecks: Record<string, { status?: string } | undefined>;
  bankState: string;
  zoneId: string | null | undefined;
  riskFlags: string[];
  blockingReasons: string[];
}

export type AutoDecision =
  | { kind: "none" }
  | { kind: "wait"; reasons: string[] }
  | { kind: "review"; reasons: string[] }
  | { kind: "activate" };

/** States automation may act from. Anything later is a person's call. */
const FILLING: OnboardingState[] = ["started", "incomplete", "action_required"];
const AWAITING: OnboardingState[] = ["submitted", "kyc_review", "verification"];

/** Pure decision — unit tested. */
export function decideAutoProgress(i: AutoProgressInput): AutoDecision {
  if (!FILLING.includes(i.state) && !AWAITING.includes(i.state)) return { kind: "none" };
  if (i.missing.length > 0) return { kind: "none" };

  const waits: string[] = [];
  const reviews: string[] = [];

  for (const doc of i.checkedDocuments) {
    const status = i.documentChecks[doc.id]?.status;
    if (status === "auto_verified") continue;
    if (status === "checking") waits.push(`Checking your ${doc.label}.`);
    else if (status === "retake") reviews.push(`${doc.label} needs a clearer photo.`);
    // No automatic verdict at all (uploaded by an older app) or flagged.
    else reviews.push(`${doc.label}: a person needs to check it.`);
  }

  if (i.bankState === BANK_STATES.PENDING) waits.push("Verifying your bank account.");
  else if (i.bankState !== BANK_STATES.VERIFIED) reviews.push("Bank account needs a person to confirm it.");

  if (!i.zoneId) reviews.push("Your location is outside the areas we serve right now.");
  if (i.riskFlags.length > 0) reviews.push("A few details need a person to confirm them.");
  reviews.push(...i.blockingReasons.map(String));

  if (reviews.length > 0) return { kind: "review", reasons: [...reviews, ...waits] };
  if (waits.length > 0) return { kind: "wait", reasons: waits };
  return { kind: "activate" };
}

/** The legal path from where the partner is to `active`. */
export function pathToActive(from: OnboardingState): OnboardingState[] {
  const tail: OnboardingState[] = ["kyc_review", "approved", "commercial_setup", "ready_for_activation", "active"];
  switch (from) {
    case "started":
    case "incomplete":
    case "action_required":
      return ["submitted", ...tail];
    case "submitted":
      return tail;
    case "kyc_review":
      return tail.slice(1);
    case "verification":
      return tail.slice(1);
    case "approved":
      return ["commercial_setup", "ready_for_activation", "active"];
    case "commercial_setup":
      return ["ready_for_activation", "active"];
    case "ready_for_activation":
    case "suspended":
      return ["active"];
    default:
      return [];
  }
}

const TITLES: Record<string, { title: string; body: (reasons: string[]) => string }> = {
  activate: { title: "You're live on Kada 🎉", body: () => "Everything checked out. Customers can find you now." },
  review: {
    title: "We're checking a few details",
    body: (r) => `Nothing to do right now. ${r[0] ?? ""} We'll let you know as soon as you're live.`.trim(),
  },
  wait: { title: "Almost there", body: (r) => `${r[0] ?? "We're finishing the last checks."} You'll go live automatically.` },
};

/** Days-idle reminders for partners who stopped mid-onboarding. */
export const NUDGE_DAYS = [1, 3, 7] as const;

/** The reminder due now, or null. Pure — unit tested. */
export function dueNudge(daysIdle: number, sent: Record<string, unknown> | undefined): number | null {
  let due: number | null = null;
  for (const d of NUDGE_DAYS) if (daysIdle >= d && !sent?.[`d${d}`]) due = d;
  return due;
}

/**
 * Push tokens for a partner, wherever that app keeps them: riders, restaurants
 * and mess kitchens hold a `fcmTokens` array on their own doc; hosts keep one
 * token at `fcm_tokens/{uid}`.
 */
async function partnerPushTokens(role: PartnerRole, partnerId: string): Promise<string[]> {
  const db = admin.firestore();
  if (role === "host") {
    const t = (await db.collection("fcm_tokens").doc(partnerId).get()).data()?.token;
    return typeof t === "string" && t ? [t] : [];
  }
  const raw = (await db.collection(ROLE_COLLECTION[role]).doc(partnerId).get()).data()?.fcmTokens;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string" && t.length > 0).slice(-10) : [];
}

/**
 * Tells a partner about their onboarding: an in-app entry (fields every app's
 * inbox reads — riders use `isRead`, restaurants `read`/`message`) plus a push
 * straight to their devices, so a partner who closed the app mid-onboarding
 * still hears "you're live" or "we need a clearer photo".
 */
export async function notifyPartnerInApp(role: PartnerRole, partnerId: string, title: string, body: string, severity = "info") {
  const db = admin.firestore();
  try {
    await db.collection(ROLE_COLLECTION[role]).doc(partnerId).collection("notifications").add({
      title, message: body, body, type: "onboarding", source: "onboarding", severity,
      read: false, isRead: false,
      // The restaurant topic trigger would push this again; it's pushed below.
      pushSent: true,
      data: { type: "onboarding" },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn(`notifyPartnerInApp: inbox write failed for ${role}/${partnerId}`, e);
  }
  try {
    const tokens = await partnerPushTokens(role, partnerId);
    if (tokens.length === 0) return;
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { type: "onboarding", role },
      apns: { payload: { aps: { sound: "default" } } },
      android: { priority: "high", notification: { channelId: "high_importance_channel", sound: "default" } },
    });
  } catch (e) {
    logger.warn(`notifyPartnerInApp: push failed for ${role}/${partnerId}`, e);
  }
}

async function notifyPartner(role: PartnerRole, partnerId: string, kind: keyof typeof TITLES, reasons: string[]) {
  const t = TITLES[kind];
  await notifyPartnerInApp(role, partnerId, t.title, t.body(reasons), kind === "activate" ? "success" : "info");
}

/**
 * Re-evaluates one partner and acts. Safe to call often (idempotent): it
 * does nothing while steps are missing, and only notifies on a change.
 */
export async function runAutoProgress(
  role: PartnerRole,
  partnerId: string,
  trigger: string,
): Promise<AutoDecision> {
  const db = admin.firestore();
  const ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
  const snap = await ref.get();
  if (!snap.exists) return { kind: "none" };

  const data = snap.data() ?? {};
  const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
  const state: OnboardingState = isOnboardingState(ob.state) ? ob.state : "started";
  const overrides = await loadRequirementOverrides();
  const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);
  const checks = (data.onboardingChecks ?? {}) as { documents?: Record<string, { status?: string }>; lastDecision?: string };

  const decision = decideAutoProgress({
    state,
    missing: missingMandatorySteps(reqs, ob.steps).map((r) => r.id),
    checkedDocuments: reqs.filter((r) => r.mandatory && r.requiresDocument && r.autoVerify).map((r) => ({ id: r.id, label: r.label })),
    documentChecks: checks.documents ?? {},
    bankState: (data.bank?.verificationState ?? BANK_STATES.NOT_ADDED) as string,
    zoneId: ob.zoneId ?? (data.zoneId as string | undefined),
    riskFlags: Array.isArray(data.riskFlags) ? data.riskFlags.map(String) : [],
    blockingReasons: Array.isArray(ob.blockingReasons) ? ob.blockingReasons.map(String) : [],
  });
  if (decision.kind === "none") return decision;

  const actor = { actor: "system", actorId: `auto-onboarding:${trigger}` };

  try {
    if (decision.kind === "activate") {
      for (const to of pathToActive(state)) {
        await transitionPartner({
          role, partnerId, to, ...actor,
          reason: to === "active" ? "Every automatic check passed" : "Automatic checks passed",
        });
      }
    } else if (FILLING.includes(state)) {
      await transitionPartner({
        role, partnerId, to: "submitted", ...actor,
        reason: decision.kind === "review" ? "Submitted; some checks need a person" : "Submitted; final checks running",
      });
    }
  } catch (e) {
    // The gate may still refuse (e.g. a check changed mid-walk). Record why for ops.
    logger.warn(`autoProgress: could not advance ${role}/${partnerId}`, e);
    await ref.set({
      onboardingChecks: {
        review: { reasons: [String((e as Error).message ?? e)], at: admin.firestore.FieldValue.serverTimestamp() },
      },
    }, { merge: true });
    return { kind: "review", reasons: [String((e as Error).message ?? e)] };
  }

  const reasons = decision.kind === "activate" ? [] : decision.reasons;
  const signature = `${decision.kind}:${reasons.join("|")}`;
  await ref.set({
    onboardingChecks: {
      review: {
        reasons,
        needsPerson: decision.kind === "review",
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
      lastDecision: signature,
    },
  }, { merge: true });

  if (checks.lastDecision !== signature) await notifyPartner(role, partnerId, decision.kind, reasons);
  return decision;
}
