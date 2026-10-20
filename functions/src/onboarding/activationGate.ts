/**
 * ─────────────────────────────────────────────────────────────────────────
 * Activation gate — the ONE place that answers "may this partner operate?"
 *
 * Every downstream surface (order placement, rider dispatch, booking
 * creation, payout release) must call `assertOperational` / `isPartnerActive`
 * rather than reading a status flag itself. Before this module each caller
 * used its own predicate:
 *
 *   - rider dispatch checked `status == "approved" && isOnline`
 *   - vendor order flow checked nothing at all
 *   - host booking flow checked nothing at all
 *   - payouts checked only that account+IFSC strings were non-empty
 *
 * Those divergent checks are exactly how a partner with expired insurance or
 * unverified banking stayed operational. Centralising the predicate means a
 * new gate (document expiry, bank suspension, risk flag) is enforced
 * everywhere the moment it is added here.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import {
  type OnboardingRecord,
  type OnboardingState,
  type PartnerRole,
  ROLE_COLLECTION,
  isOperational,
  isOnboardingState,
} from "./stateMachine";
import {
  resolveRequirements,
  missingMandatorySteps,
  applicantContextOf,
} from "./kycRules";
import { BANK_STATES, type BankVerificationState } from "./bankVerification";

/** Result of a gate evaluation — never a bare boolean, so callers can explain. */
export interface GateResult {
  allowed: boolean;
  state: OnboardingState | null;
  /** Machine-readable reasons, safe to show the partner. */
  reasons: string[];
  /** True when the partner document doesn't exist at all. */
  missing?: boolean;
}

const ALLOW: GateResult = { allowed: true, state: "active", reasons: [] };

/**
 * Reads the partner's onboarding record and evaluates every operational gate.
 *
 * Gates, in order of severity:
 *   1. partner document exists
 *   2. onboarding.state is operational (`active`)
 *   3. no unexpired blocking reasons
 *   4. every mandatory step for their resolved requirement set is complete
 *   5. banking is `verified` when the partner receives payouts
 *   6. no mandatory document is past its expiry date
 */
export async function evaluateGate(
  role: PartnerRole,
  partnerId: string,
  opts?: { requirePayoutReady?: boolean },
): Promise<GateResult> {
  if (!partnerId) {
    return { allowed: false, state: null, reasons: ["Partner id missing."], missing: true };
  }

  const db = admin.firestore();
  const snap = await db.collection(ROLE_COLLECTION[role]).doc(partnerId).get();
  if (!snap.exists) {
    return { allowed: false, state: null, reasons: ["Partner not found."], missing: true };
  }

  const data = snap.data() ?? {};
  const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
  const rawState = ob.state;
  const state: OnboardingState | null = isOnboardingState(rawState) ? rawState : null;

  const reasons: string[] = [];

  // ── Gate 1/2: lifecycle state ────────────────────────────────────────
  if (!state) {
    // A partner with no onboarding record predates this engine. Treat as
    // NOT operational — a legacy doc must be migrated deliberately rather
    // than silently inheriting live privileges.
    return {
      allowed: false,
      state: null,
      reasons: [
        "Partner has no onboarding record. Run the onboarding backfill or " +
          "complete onboarding before operating.",
      ],
    };
  }
  if (!isOperational(state)) {
    reasons.push(`Onboarding state is "${state}" — must be "active" to operate.`);
  }

  // ── Gate 3: explicit blocking reasons ────────────────────────────────
  const blocking = Array.isArray(ob.blockingReasons) ? ob.blockingReasons : [];
  for (const r of blocking) reasons.push(String(r));

  // ── Gate 4: mandatory step completion ────────────────────────────────
  const ctx = applicantContextOf(data, ob);
  const overrides = await loadRequirementOverrides();
  const reqs = resolveRequirements(role, ctx, overrides);
  const missing = missingMandatorySteps(reqs, ob.steps);
  if (missing.length > 0) {
    reasons.push(
      `Incomplete mandatory steps: ${missing.map((m) => m.label).join(", ")}.`,
    );
  }

  // ── Gate 5: banking verification (only when payouts apply) ───────────
  const needsPayout = opts?.requirePayoutReady ?? true;
  if (needsPayout) {
    const bankState = (data.bank?.verificationState ?? "not_added") as BankVerificationState;
    if (bankState !== BANK_STATES.VERIFIED) {
      reasons.push(
        `Bank account is "${bankState}" — must be "verified" before payouts.`,
      );
    }
  }

  // ── Gate 6: document expiry ──────────────────────────────────────────
  const expired = expiredDocuments(data.documents, reqs);
  if (expired.length > 0) {
    reasons.push(`Expired documents: ${expired.join(", ")}.`);
  }

  return { allowed: reasons.length === 0, state, reasons };
}

/** Throws an HttpsError when the partner may not operate. */
export async function assertOperational(
  role: PartnerRole,
  partnerId: string,
  opts?: { requirePayoutReady?: boolean; action?: string },
): Promise<void> {
  const result = await evaluateGate(role, partnerId, opts);
  if (result.allowed) return;
  const what = opts?.action ? ` to ${opts.action}` : "";
  throw new HttpsError(
    "failed-precondition",
    `Partner is not cleared${what}. ${result.reasons.join(" ")}`,
  );
}

/** Cheap boolean form, for query filters and UI. */
export async function isPartnerActive(
  role: PartnerRole,
  partnerId: string,
): Promise<boolean> {
  const r = await evaluateGate(role, partnerId, { requirePayoutReady: false });
  return r.allowed;
}

/**
 * Returns the ids of mandatory documents whose expiry date has passed.
 * `documents` is the partner's `{ docId: { url, expiresAt, ... } }` map.
 */
export function expiredDocuments(
  documents: unknown,
  reqs: { id: string; label: string; tracksExpiry?: boolean; mandatory: boolean }[],
): string[] {
  if (!documents || typeof documents !== "object") return [];
  const docs = documents as Record<string, { expiresAt?: unknown }>;
  const now = Date.now();
  const out: string[] = [];

  for (const req of reqs) {
    if (!req.tracksExpiry || !req.mandatory) continue;
    const entry = docs[req.id];
    if (!entry) continue;
    const ms = toMillis(entry.expiresAt);
    if (ms !== null && ms < now) out.push(req.label);
  }
  return out;
}

/** Documents expiring within `days` — feeds the admin "expiring" queue. */
export function documentsExpiringWithin(
  documents: unknown,
  reqs: { id: string; label: string; tracksExpiry?: boolean; mandatory: boolean }[],
  days: number,
): { id: string; label: string; expiresAt: number }[] {
  if (!documents || typeof documents !== "object") return [];
  const docs = documents as Record<string, { expiresAt?: unknown }>;
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;
  const out: { id: string; label: string; expiresAt: number }[] = [];

  for (const req of reqs) {
    if (!req.tracksExpiry) continue;
    const entry = docs[req.id];
    if (!entry) continue;
    const ms = toMillis(entry.expiresAt);
    if (ms !== null && ms >= now && ms <= horizon) {
      out.push({ id: req.id, label: req.label, expiresAt: ms });
    }
  }
  return out;
}

function toMillis(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && v && "toMillis" in v) {
    try {
      return (v as admin.firestore.Timestamp).toMillis();
    } catch {
      return null;
    }
  }
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Loads admin-managed requirement overrides. Cached per warm instance for
 * 60s — the gate runs on hot paths (every order/dispatch) and these change
 * on a human timescale.
 */
let overridesCache: {
  at: number;
  value: Record<string, Record<string, Record<string, unknown>>>;
} | null = null;
const OVERRIDES_TTL_MS = 60_000;

export async function loadRequirementOverrides(): Promise<
  Record<string, Record<string, Record<string, unknown>>>
> {
  if (overridesCache && Date.now() - overridesCache.at < OVERRIDES_TTL_MS) {
    return overridesCache.value;
  }
  try {
    const snap = await admin
      .firestore()
      .collection("config")
      .doc("onboarding_requirements")
      .get();
    const value = snap.exists ? ((snap.data() ?? {}) as any) : {};
    overridesCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    // Never let a config read failure open the gate — fall back to the
    // compiled-in defaults, which are the strict set.
    console.error("activationGate: requirement overrides load failed", e);
    return overridesCache?.value ?? {};
  }
}

/** Test hook — clears the memoised overrides. */
export function __clearOverridesCache(): void {
  overridesCache = null;
}
