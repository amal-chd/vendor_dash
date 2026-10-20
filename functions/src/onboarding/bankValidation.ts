/**
 * ─────────────────────────────────────────────────────────────────────────
 * Real bank-account verification via RazorpayX Fund Account Validation.
 *
 * Phase 1 gave banking a state machine but left `verified` as a purely
 * human decision. That is better than the old "any non-empty string is
 * good enough", but an admin eyeballing an account number cannot tell a
 * transposed digit from a correct one either.
 *
 * This module does the authoritative check: a ₹1 penny drop to the account.
 * Razorpay returns whether the account is `active` AND the name the bank has
 * registered against it. That registered name — not the name the applicant
 * typed — is what we match against their legal entity. It is the only way to
 * catch "correct account number, but it belongs to someone else".
 *
 * Outcomes:
 *   account active + name matches   → verified (automatic)
 *   account active + name mismatch  → action_required, queued for a human
 *   account invalid                 → failed, applicant must re-enter
 *
 * Degradation: validation needs RAZORPAY_ACCOUNT_NUMBER (the RazorpayX source
 * account). Where that secret is absent the account simply stays
 * `pending_verification` and the existing manual admin path still works —
 * we never silently mark something verified because automation was
 * unavailable.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { assertAdmin } from "../admin_operations";
import {
  type PartnerRole,
  PARTNER_ROLES,
  ROLE_COLLECTION,
} from "./stateMachine";
import {
  BANK_STATES,
  type BankVerificationState,
  bankDetailsHash,
  canTransitionBank,
  checkNameMatch,
} from "./bankVerification";
import {
  PARTNER_PRIVATE_COLLECTION,
  ownerUidsOf,
  readPartnerContact,
  readPartnerWithPrivate,
  resolveBankDetails,
  resolveContact,
} from "./partnerPrivate";
import { setStepComplete } from "./transition";

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RAZORPAY_ACCOUNT_NUMBER = defineSecret("RAZORPAY_ACCOUNT_NUMBER");

export const BANK_VALIDATION_SECRETS = [
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_ACCOUNT_NUMBER,
];

const RZP_BASE = "https://api.razorpay.com/v1";

/** ₹1 in paise — the standard penny-drop amount. */
const PENNY_DROP_PAISE = 100;

interface Creds {
  keyId: string;
  keySecret: string;
  accountNumber: string;
}

function readCreds(): Creds {
  const read = (s: { value(): string }, env: string): string => {
    try {
      return s.value() || process.env[env] || "";
    } catch {
      return process.env[env] || "";
    }
  };
  return {
    keyId: read(RAZORPAY_KEY_ID, "RAZORPAY_KEY_ID"),
    keySecret: read(RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET"),
    accountNumber: read(RAZORPAY_ACCOUNT_NUMBER, "RAZORPAY_ACCOUNT_NUMBER"),
  };
}

export function isValidationConfigured(): boolean {
  const c = readCreds();
  return Boolean(c.keyId && c.keySecret && c.accountNumber);
}

async function rzp(
  c: Creds,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<any> {
  const auth = Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64");
  const res = await fetch(`${RZP_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.description || text || `HTTP ${res.status}`;
    logger.error(`Razorpay ${method} ${path} failed:`, msg);
    throw new HttpsError("internal", `Razorpay: ${msg}`);
  }
  return json;
}

/**
 * Creates (or reuses) the Contact + Fund Account for a partner's bank
 * details, then fires a penny-drop validation.
 *
 * Returns the validation id — the result arrives asynchronously via the
 * `fund_account.validation.*` webhook, or can be polled with
 * `pollBankValidation`.
 */
export async function startBankValidation(
  role: PartnerRole,
  partnerId: string,
): Promise<{ started: boolean; validationId?: string; reason?: string }> {
  if (!isValidationConfigured()) {
    return {
      started: false,
      reason:
        "RazorpayX is not configured (RAZORPAY_ACCOUNT_NUMBER missing). " +
        "The account stays pending until an admin verifies it manually.",
    };
  }

  const c = readCreds();
  const { ref, privateRef, exists, data: d, priv } = await readPartnerWithPrivate(role, partnerId);
  if (!exists) throw new HttpsError("not-found", "Partner not found.");

  const details = resolveBankDetails(priv, d);
  if (!details) {
    throw new HttpsError(
      "failed-precondition",
      "No bank account on file to validate.",
    );
  }
  if (d.bank?.verificationState === BANK_STATES.VERIFIED) {
    return { started: false, reason: "Already verified." };
  }

  const pb = (priv.bank ?? {}) as Record<string, any>;
  const px = (priv.payout ?? {}) as Record<string, any>;
  const hash = bankDetailsHash(details);
  const holder = details.holder || (d.name ?? "").toString().trim();

  // 1) Contact — reuse the one payouts.ts may already have created.
  let contactId: string = px.contactId || pb.razorpayContactId || "";
  if (!contactId) {
    const reach = resolveContact(await readPartnerContact(role, partnerId), d);
    const contact = await rzp(c, "/contacts", "POST", {
      name: (d.name ?? holder ?? "Kada partner").toString().slice(0, 50),
      email: reach.email,
      contact: reach.phone,
      type: role === "rider" ? "employee" : "vendor",
      reference_id: partnerId,
      notes: { kada_role: role, kada_ref: partnerId },
    });
    contactId = contact.id;
  }

  // 2) Fund account for these exact details — never one minted for an
  //    earlier account, or the penny drop would verify the wrong account.
  let fundAccountId: string = pb.detailsHash === hash ? pb.razorpayFundAccountId || "" : "";
  if (!fundAccountId) {
    const fund = await rzp(c, "/fund_accounts", "POST", {
      contact_id: contactId,
      account_type: "bank_account",
      bank_account: {
        name: holder.slice(0, 120),
        ifsc: details.ifsc,
        account_number: details.accountNumber,
      },
    });
    fundAccountId = fund.id;
  }

  // 3) Penny drop.
  const validation = await rzp(c, "/fund_accounts/validations", "POST", {
    account_number: c.accountNumber,
    fund_account: { id: fundAccountId },
    amount: PENNY_DROP_PAISE,
    currency: "INR",
    notes: { kada_role: role, kada_ref: partnerId },
  });

  // Routing ids live with the details in the private store; the partner doc
  // only learns that a check is running.
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = admin.firestore().batch();
  batch.set(
    privateRef,
    {
      role,
      partnerId,
      ownerUids: ownerUidsOf(role, partnerId, d),
      bank: {
        razorpayContactId: contactId,
        razorpayFundAccountId: fundAccountId,
        detailsHash: hash,
        validationId: validation.id,
        validationStartedAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
  batch.set(
    ref,
    { bank: { verificationMessage: "Penny-drop verification in progress.", updatedAt: now } },
    { merge: true },
  );
  await batch.commit();

  logger.info(`Bank validation started for ${role}/${partnerId}: ${validation.id}`);
  return { started: true, validationId: validation.id };
}

/**
 * Applies a validation outcome to the partner's bank state.
 *
 * Shared by the webhook and the poller so both paths reach the same verdict —
 * a divergence here would mean "verified by webhook, failed by poll".
 */
export async function applyValidationResult(
  role: PartnerRole,
  partnerId: string,
  result: {
    status: string;
    accountStatus?: string;
    registeredName?: string;
  },
): Promise<{ state: BankVerificationState; message: string }> {
  const { ref, privateRef, exists, data: d } = await readPartnerWithPrivate(role, partnerId);
  if (!exists) throw new HttpsError("not-found", "Partner not found.");

  const bank = (d.bank ?? {}) as Record<string, any>;
  const from = (bank.verificationState ?? BANK_STATES.NOT_ADDED) as BankVerificationState;

  let to: BankVerificationState;
  // `message` lands on the partner doc — world-readable for vendors and
  // hosts — so it never quotes the bank-registered name. `detail` does, and
  // goes to the private store for reviewers.
  let message: string;
  let detail: string;
  let nameMatch: { score: number; matched: boolean; comparedTo: string } | null = null;

  // `status: "completed"` only means the validation FINISHED — it says nothing
  // about whether the account is good. When Razorpay reports an
  // `account_status` that field is authoritative; only fall back to the
  // validation status when the account verdict is absent entirely. Treating
  // them as interchangeable would pass an explicitly `invalid` account.
  const accountActive =
    result.accountStatus
      ? result.accountStatus === "active"
      : result.status === "completed";

  if (!accountActive) {
    to = BANK_STATES.FAILED;
    message =
      `The bank reported this account as "${result.accountStatus ?? result.status}". ` +
      `Check the account number and IFSC, then re-submit.`;
    detail = message;
  } else {
    // The bank's REGISTERED name is the source of truth, not what the
    // applicant typed. This is the check that catches a valid account
    // belonging to someone else.
    const legalName =
      (d.legalName ?? d.ownerName ?? d.name ?? "").toString().trim();
    const registered = (result.registeredName ?? "").toString().trim();

    if (registered && legalName) {
      nameMatch = checkNameMatch(registered, legalName);
      if (nameMatch.matched) {
        to = BANK_STATES.VERIFIED;
        message = "Verified — the name the bank has on record matches the legal name.";
        detail = `Verified — bank-registered name "${registered}" matches "${legalName}".`;
      } else {
        to = BANK_STATES.ACTION_REQUIRED;
        message =
          "Account is valid but the name the bank has on record does not match " +
          "the legal name. A reviewer must confirm before payouts.";
        detail =
          `Account is valid but the bank has it registered to "${registered}", ` +
          `which does not match "${legalName}". A reviewer must confirm before payouts.`;
      }
    } else {
      // Account confirmed live but no name to compare — do NOT auto-verify.
      to = BANK_STATES.ACTION_REQUIRED;
      message =
        "Account is valid but the bank returned no registered name to match. " +
        "A reviewer must confirm before payouts.";
      detail = message;
    }
  }

  if (!canTransitionBank(from, to)) {
    logger.warn(
      `Validation result would make an illegal bank transition ${from} → ${to} ` +
        `for ${role}/${partnerId}; leaving state unchanged.`,
    );
    return { state: from, message: `No change (already ${from}).` };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = admin.firestore().batch();
  batch.set(
    ref,
    {
      bank: {
        verificationState: to,
        verificationMessage: message,
        validationResult: {
          status: result.status,
          accountStatus: result.accountStatus ?? null,
          // A merge would otherwise keep a name left by an older write.
          registeredName: admin.firestore.FieldValue.delete(),
          at: now,
        },
        ...(nameMatch ? { bankNameMatch: nameMatch } : {}),
        ...(to === BANK_STATES.VERIFIED ? { verifiedAt: now } : {}),
        updatedAt: now,
      },
    },
    { merge: true },
  );
  batch.set(
    privateRef,
    {
      role,
      partnerId,
      bank: {
        registeredName: result.registeredName ?? null,
        verificationDetail: detail,
        validationResult: {
          status: result.status,
          accountStatus: result.accountStatus ?? null,
          registeredName: result.registeredName ?? null,
          at: now,
        },
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
  await batch.commit();

  if (to === BANK_STATES.VERIFIED) {
    await setStepComplete(role, partnerId, "bank_verification", true, "system").catch(
      () => {},
    );
  }

  logger.info(`Bank validation applied for ${role}/${partnerId}: ${from} → ${to}`);
  // Callers are the webhook and the admin-only poller, so the detail is safe here.
  return { state: to, message: detail };
}

/**
 * Handles a `fund_account.validation.*` webhook. Razorpay does not tell us
 * which partner a validation belongs to, so we look it up by validation id.
 */
export async function handleValidationWebhook(
  eventType: string,
  entity: Record<string, any>,
): Promise<void> {
  const validationId = entity?.id;
  if (!validationId) return;

  const db = admin.firestore();
  const result = {
    status: eventType.endsWith("failed") ? "failed" : (entity.status ?? "completed"),
    accountStatus: entity.results?.account_status,
    registeredName: entity.results?.registered_name,
  };

  // The validation id is stored with the details, in the private store.
  const priv = await db
    .collection(PARTNER_PRIVATE_COLLECTION)
    .where("bank.validationId", "==", validationId)
    .limit(1)
    .get();
  if (!priv.empty) {
    const rec = priv.docs[0].data();
    const role = rec.role as PartnerRole;
    const partnerId = String(rec.partnerId ?? "");
    if (PARTNER_ROLES.includes(role) && partnerId) {
      await applyValidationResult(role, partnerId, result);
      return;
    }
  }

  // Validations started before the private store existed kept the id on the
  // partner doc.
  for (const role of PARTNER_ROLES) {
    const snap = await db
      .collection(ROLE_COLLECTION[role])
      .where("bank.validationId", "==", validationId)
      .limit(1)
      .get();
    if (snap.empty) continue;

    await applyValidationResult(role, snap.docs[0].id, result);
    return;
  }

  logger.warn(`Validation webhook ${validationId} matched no partner.`);
}

/** Admin: kick off (or re-run) verification for one partner. */
export const verifyBankAccount = onCall(
  { secrets: BANK_VALIDATION_SECRETS },
  async (request) => {
    assertAdmin(request);
    const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
    const adminRole =
      (typeof claims.adminRole === "string" && claims.adminRole) || "super_admin";
    if (!["super_admin", "platform_admin", "finance_manager"].includes(adminRole)) {
      throw new HttpsError(
        "permission-denied",
        "Only finance-grade admins may run bank verification.",
      );
    }

    const role = (request.data?.role ?? "").toString() as PartnerRole;
    const partnerId = (request.data?.partnerId ?? "").toString();
    if (!PARTNER_ROLES.includes(role) || !partnerId) {
      throw new HttpsError("invalid-argument", "role and partnerId are required.");
    }

    return startBankValidation(role, partnerId);
  },
);

/**
 * Polls a pending validation. Razorpay's webhook is the primary path; this
 * is the fallback for a dropped delivery, and the manual "check now" button.
 */
export const pollBankValidation = onCall(
  { secrets: BANK_VALIDATION_SECRETS },
  async (request) => {
    assertAdmin(request);
    const role = (request.data?.role ?? "").toString() as PartnerRole;
    const partnerId = (request.data?.partnerId ?? "").toString();
    if (!PARTNER_ROLES.includes(role) || !partnerId) {
      throw new HttpsError("invalid-argument", "role and partnerId are required.");
    }
    if (!isValidationConfigured()) {
      throw new HttpsError(
        "failed-precondition",
        "RazorpayX is not configured; verify manually instead.",
      );
    }

    const { data, priv } = await readPartnerWithPrivate(role, partnerId);
    const validationId = priv.bank?.validationId || data.bank?.validationId;
    if (!validationId) {
      throw new HttpsError("failed-precondition", "No validation in progress.");
    }

    const c = readCreds();
    const v = await rzp(c, `/fund_accounts/validations/${validationId}`, "GET");

    return applyValidationResult(role, partnerId, {
      status: v.status,
      accountStatus: v.results?.account_status,
      registeredName: v.results?.registered_name,
    });
  },
);
