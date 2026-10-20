/**
 * ─────────────────────────────────────────────────────────────────────────
 * Reusable bank-account module — shared by Dine, Delivery and Host.
 *
 * The critical design point: VERIFICATION STATE IS STORED SEPARATELY FROM
 * THE COLLECTED DETAILS. Before this module, `payouts.ts` read
 * `kyc.bank.{account,ifsc}` and, if both strings were non-empty, created a
 * Razorpay fund account and pushed money. A typo'd IFSC or a mismatched
 * holder name was indistinguishable from a verified account — which is how
 * payouts reach the wrong destination.
 *
 * Now: collecting details sets `pending_verification`, and only a successful
 * verification (Razorpay fund-account validation + name match) sets
 * `verified`. `activationGate` refuses payouts in any other state.
 *
 * State machine:
 *   not_added → pending_verification → verified
 *                       ↓                  ↓
 *                    failed          action_required
 *                       ↓                  ↓
 *                pending_verification   suspended
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { createHash } from "crypto";

export const BANK_STATES = {
  NOT_ADDED: "not_added",
  PENDING: "pending_verification",
  VERIFIED: "verified",
  FAILED: "failed",
  ACTION_REQUIRED: "action_required",
  SUSPENDED: "suspended",
} as const;

export type BankVerificationState =
  (typeof BANK_STATES)[keyof typeof BANK_STATES];

export const BANK_STATE_VALUES: readonly BankVerificationState[] =
  Object.values(BANK_STATES);

/** Legal bank-state transitions. */
const BANK_TRANSITIONS: Record<BankVerificationState, BankVerificationState[]> = {
  not_added: ["pending_verification"],
  pending_verification: ["verified", "failed", "action_required"],
  verified: ["suspended", "action_required", "pending_verification"],
  failed: ["pending_verification", "action_required"],
  action_required: ["pending_verification", "suspended"],
  suspended: ["pending_verification", "action_required"],
};

export function canTransitionBank(
  from: BankVerificationState,
  to: BankVerificationState,
): boolean {
  return (BANK_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The collected bank record. Never written whole: splitBankRecord
 * (partnerPrivate.ts) sends the details to partner_private and leaves only
 * state + a masked summary on the partner doc.
 */
export interface BankRecord {
  holder: string;
  accountNumber: string;
  ifsc: string;
  /** Optional UPI VPA — an alternative payout rail, verified separately. */
  vpa?: string;
  verificationState: BankVerificationState;
  /** Why verification failed / what the partner must fix. */
  verificationMessage?: string;
  /** Razorpay ids, cached so we don't recreate on every payout. */
  razorpayContactId?: string;
  razorpayFundAccountId?: string;
  /** Hash of the details the cached ids correspond to. */
  detailsHash?: string;
  /** Name-match outcome against the owner/entity legal name. */
  nameMatch?: { score: number; matched: boolean; comparedTo: string };
  /** Set when an admin accepted a mismatch deliberately. */
  mismatchAcceptedBy?: string;
  mismatchAcceptedReason?: string;
  verifiedAt?: unknown;
  updatedAt?: unknown;
}

/** IFSC format: 4 letters, then 0, then 6 alphanumerics. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers run 9–18 digits across banks. */
const ACCOUNT_RE = /^\d{9,18}$/;

export function normaliseIfsc(v: unknown): string {
  return (v ?? "").toString().trim().toUpperCase().replace(/\s+/g, "");
}

export function normaliseAccount(v: unknown): string {
  return (v ?? "").toString().trim().replace(/[\s-]/g, "");
}

export interface BankValidation {
  valid: boolean;
  errors: string[];
}

/** Structural validation — runs before any network call. */
export function validateBankDetails(input: {
  holder?: unknown;
  accountNumber?: unknown;
  ifsc?: unknown;
}): BankValidation {
  const errors: string[] = [];
  const holder = (input.holder ?? "").toString().trim();
  const account = normaliseAccount(input.accountNumber);
  const ifsc = normaliseIfsc(input.ifsc);

  if (holder.length < 3) {
    errors.push("Account holder name must be at least 3 characters.");
  }
  if (!ACCOUNT_RE.test(account)) {
    errors.push("Account number must be 9–18 digits.");
  }
  if (!IFSC_RE.test(ifsc)) {
    errors.push("IFSC must be 11 characters, e.g. HDFC0001234.");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Normalised name comparison for holder-vs-legal-name matching.
 * Strips honorifics, punctuation, and common entity suffixes so
 * "M/s Kada Foods Pvt. Ltd." matches "KADA FOODS PRIVATE LIMITED".
 */
export function normaliseName(v: unknown): string {
  return (v ?? "")
    .toString()
    .toUpperCase()
    .replace(/\b(M\/S|MR|MRS|MS|SHRI|SMT|DR)\b/g, "")
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|AND|&)\b/g, "")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-overlap similarity in [0,1]. Deliberately simple and explainable —
 * a fuzzy-match library would be harder to justify to a compliance reviewer
 * than "what fraction of the shorter name's words appear in the longer one".
 */
export function nameSimilarity(a: unknown, b: unknown): number {
  const A = normaliseName(a).split(" ").filter(Boolean);
  const B = normaliseName(b).split(" ").filter(Boolean);
  if (A.length === 0 || B.length === 0) return 0;
  const setB = new Set(B);
  const overlap = A.filter((t) => setB.has(t)).length;
  return overlap / Math.min(A.length, B.length);
}

/** Below this the holder name is treated as a mismatch needing review. */
export const NAME_MATCH_THRESHOLD = 0.7;

export function checkNameMatch(
  holder: unknown,
  legalName: unknown,
): { score: number; matched: boolean; comparedTo: string } {
  const score = nameSimilarity(holder, legalName);
  return {
    score: Math.round(score * 100) / 100,
    matched: score >= NAME_MATCH_THRESHOLD,
    comparedTo: (legalName ?? "").toString(),
  };
}

/** Stable hash of the payout-relevant details, for cache invalidation. */
export function bankDetailsHash(r: {
  accountNumber?: unknown;
  ifsc?: unknown;
  vpa?: unknown;
}): string {
  const s = [
    normaliseAccount(r.accountNumber),
    normaliseIfsc(r.ifsc),
    (r.vpa ?? "").toString().trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

// Duplicate detection lives in partnerPrivate.ts (findDuplicateBankAccounts):
// it matches a keyed fingerprint in the private store. Querying
// `bank.accountNumber` on the partner collections needed full details on
// world-readable docs.

/**
 * Builds the bank record for a first-time submission. Always lands in
 * `pending_verification` — never `verified`, regardless of what the client
 * sends. Verification is a server-side outcome, not a client claim.
 */
export function buildPendingBankRecord(input: {
  holder: string;
  accountNumber: string;
  ifsc: string;
  vpa?: string;
  legalName?: string;
}): BankRecord {
  const holder = input.holder.trim();
  const accountNumber = normaliseAccount(input.accountNumber);
  const ifsc = normaliseIfsc(input.ifsc);
  const nameMatch = input.legalName
    ? checkNameMatch(holder, input.legalName)
    : undefined;

  return {
    holder,
    accountNumber,
    ifsc,
    vpa: input.vpa?.trim() || undefined,
    verificationState: BANK_STATES.PENDING,
    detailsHash: bankDetailsHash({ accountNumber, ifsc, vpa: input.vpa }),
    nameMatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/** Redacted form for any surface that shouldn't see the full account number. */
export function maskAccount(accountNumber: unknown): string {
  const a = normaliseAccount(accountNumber);
  if (a.length <= 4) return a ? "••••" : "";
  return `••••${a.slice(-4)}`;
}
