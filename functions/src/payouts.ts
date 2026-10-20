import * as admin from "firebase-admin";
import { BANK_STATES } from "./onboarding/bankVerification";
import type { PartnerRole } from "./onboarding/stateMachine";
import {
  ownerUidsOf,
  readPartnerContact,
  readPartnerWithPrivate,
  resolveBankDetails,
  resolveContact,
  resolvePayoutVpa,
} from "./onboarding/partnerPrivate";
import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { assertAdmin } from "./admin_operations";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * RazorpayX Payouts — the money-OUT side of the platform.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The payment gateway (payments.ts / wallet.ts) collects money IN. This module
 * disburses money OUT to vendors, riders and hosts using the RazorpayX Payouts
 * API — real bank/UPI transfers, initiated from the admin console, tracked to
 * completion via the payout webhook (razorpayWebhook.ts).
 *
 * Flow for a single beneficiary:
 *   1. ensureFundAccount(...) — create (once, then cache) a Razorpay Contact +
 *      Fund Account from the beneficiary's saved bank/UPI details.
 *   2. disburse(...) — POST /v1/payouts (idempotent per reference_id), write a
 *      `payouts/{referenceId}` ledger doc, mark the source settlement as
 *      `processing`.
 *   3. Webhook `payout.processed` → settlement becomes `paid` with the real UTR;
 *      `payout.reversed|failed` → settlement reverts to `pending`.
 *
 * Secrets (set with `firebase functions:secrets:set`):
 *   RAZORPAY_KEY_ID          — same key as the gateway (must have payout perms)
 *   RAZORPAY_KEY_SECRET      — same secret
 *   RAZORPAY_ACCOUNT_NUMBER  — the RazorpayX SOURCE account number to pay FROM
 *                              (from RazorpayX dashboard → Account Details, e.g.
 *                              "2323230000000000"). Without it, live payouts are
 *                              disabled and only the manual UTR path works.
 */

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RAZORPAY_ACCOUNT_NUMBER = defineSecret("RAZORPAY_ACCOUNT_NUMBER");

export const PAYOUT_SECRETS = [
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_ACCOUNT_NUMBER,
];

const RZP_BASE = "https://api.razorpay.com/v1";
// IMPS caps at ₹5,00,000; above that we fall back to NEFT.
const IMPS_MAX_RUPEES = 200000;

type BeneficiaryKind = "vendor" | "rider" | "host" | "mess";

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

function assertConfigured(c: Creds): void {
  if (!c.keyId || !c.keySecret) {
    throw new HttpsError(
      "failed-precondition",
      "Razorpay keys are not configured on the server.",
    );
  }
  if (!c.accountNumber) {
    throw new HttpsError(
      "failed-precondition",
      "RazorpayX is not set up: RAZORPAY_ACCOUNT_NUMBER (the source account to pay from) is missing. " +
        "Add it from the RazorpayX dashboard, or use the manual UTR path.",
    );
  }
}

/** Low-level RazorpayX request with Basic auth + optional idempotency key. */
async function rzpx(
  c: Creds,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<any> {
  const auth = Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["X-Payout-Idempotency"] = idempotencyKey;

  const res = await fetch(`${RZP_BASE}${path}`, {
    method,
    headers,
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
    logger.error(`RazorpayX ${method} ${path} failed:`, msg);
    throw new HttpsError("internal", `Razorpay: ${msg}`);
  }
  return json;
}

// A short, stable hash of the beneficiary's bank/UPI details. If the
// beneficiary edits their bank account we detect the change and mint a fresh
// fund account rather than paying to a stale one.
function detailsHash(details: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(details))
    .digest("hex")
    .slice(0, 16);
}

interface BankDetails {
  account?: string;
  ifsc?: string;
  holder?: string;
}

interface ResolvedBeneficiary {
  ref: admin.firestore.DocumentReference;
  /** partner_private doc — the account details and the RazorpayX cache. */
  privateRef: admin.firestore.DocumentReference;
  role: PartnerRole;
  ownerUids: string[];
  name: string;
  email?: string;
  phone?: string;
  contactType: "vendor" | "employee";
  bank?: BankDetails;
  vpa?: string;
}

/**
 * Refuses to release money to an unverified account.
 *
 * Historically these resolvers read whatever strings the partner typed into
 * `kyc.bank` and pushed a payout — a typo'd IFSC or a holder name belonging
 * to someone else was indistinguishable from a checked account. The
 * onboarding engine now tracks verification state separately from the
 * collected details (see onboarding/bankVerification.ts), and only a
 * finance-grade admin action can set `verified`.
 *
 * Partners onboarded before this engine have no `bank.verificationState`.
 * They are blocked with an actionable message rather than silently paid,
 * because "we have always paid them" is not evidence the account is correct.
 */
function assertBankVerified(
  partnerDoc: Record<string, any>,
  who: string,
): void {
  const state = partnerDoc?.bank?.verificationState;
  if (state === BANK_STATES.VERIFIED) return;

  if (!state) {
    throw new HttpsError(
      "failed-precondition",
      `${who} has no verified bank account on file. Their banking predates ` +
        `verification — re-collect the account in the partner app, then ` +
        `verify it from Admin → Onboarding before releasing this payout.`,
    );
  }
  throw new HttpsError(
    "failed-precondition",
    `${who}'s bank account is "${state}", not "verified". ` +
      `Resolve it in Admin → Onboarding before releasing this payout.`,
  );
}

/**
 * Ensure a Razorpay Fund Account exists for a beneficiary, creating the Contact
 * and Fund Account on first use and caching their ids on the beneficiary doc.
 * Returns the fund_account_id + the transfer mode to use.
 */
async function ensureFundAccount(
  c: Creds,
  b: ResolvedBeneficiary,
): Promise<{ fundAccountId: string; mode: "UPI" | "IMPS" | "NEFT" }> {
  // The cache lives in the private store: on the partner doc it was public
  // and client-writable, and payouts trusted `payout.fundAccountId`.
  const snap = await b.privateRef.get();
  const px = (snap.data()?.payout ?? {}) as Record<string, any>;

  // Decide the destination: UPI VPA takes priority when present (instant, free),
  // else a bank account.
  const wantVpa = !!(b.vpa && b.vpa.includes("@"));
  const details = wantVpa
    ? { vpa: b.vpa }
    : {
        account: (b.bank?.account ?? "").trim(),
        ifsc: (b.bank?.ifsc ?? "").trim().toUpperCase(),
        holder: (b.bank?.holder ?? b.name ?? "").trim(),
      };

  if (!wantVpa && (!details.account || !details.ifsc)) {
    throw new HttpsError(
      "failed-precondition",
      `${b.name} has no payout bank account or UPI on file. Ask them to add it in their app.`,
    );
  }

  const hash = detailsHash(details);

  // Cache hit — same details already have a fund account.
  if (px.fundAccountId && px.detailsHash === hash) {
    return {
      fundAccountId: px.fundAccountId,
      mode: wantVpa ? "UPI" : px.mode || "IMPS",
    };
  }

  // 1) Contact (reuse if we already made one for this beneficiary).
  let contactId: string = px.contactId || "";
  if (!contactId) {
    const contact = await rzpx(c, "/contacts", "POST", {
      name: b.name.slice(0, 50) || "Kada beneficiary",
      email: b.email || undefined,
      contact: b.phone || undefined,
      type: b.contactType,
      reference_id: b.ref.id,
      notes: { kada_kind: b.contactType, kada_ref: b.ref.id },
    });
    contactId = contact.id;
  }

  // 2) Fund account for the current details.
  const fundBody: Record<string, unknown> = wantVpa
    ? {
        contact_id: contactId,
        account_type: "vpa",
        vpa: { address: b.vpa },
      }
    : {
        contact_id: contactId,
        account_type: "bank_account",
        bank_account: {
          name: details.holder || b.name,
          ifsc: details.ifsc,
          account_number: details.account,
        },
      };
  const fund = await rzpx(c, "/fund_accounts", "POST", fundBody);

  const mode: "UPI" | "IMPS" | "NEFT" = wantVpa ? "UPI" : "IMPS";

  await b.privateRef.set(
    {
      role: b.role,
      partnerId: b.ref.id,
      ownerUids: b.ownerUids,
      payout: {
        contactId,
        fundAccountId: fund.id,
        detailsHash: hash,
        mode,
        destination: wantVpa ? "vpa" : "bank_account",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  return { fundAccountId: fund.id, mode };
}

interface DisburseArgs {
  db: admin.firestore.Firestore;
  c: Creds;
  kind: BeneficiaryKind;
  sourceRef: admin.firestore.DocumentReference; // settlement / payout_request
  beneficiary: ResolvedBeneficiary;
  amountRupees: number;
  narration: string;
  initiatedBy: string;
}

/**
 * The single money-moving primitive. Idempotent per `payouts/{referenceId}`:
 * two clicks, a retry after a network blip, or a duplicate call all resolve to
 * (at most) one real transfer, because we both guard on the ledger doc and send
 * Razorpay an X-Payout-Idempotency key.
 */
async function disburse(a: DisburseArgs): Promise<{
  payoutId: string;
  status: string;
  referenceId: string;
  amount: number;
}> {
  const { db, c, kind, sourceRef } = a;
  const amountRupees = Math.round((a.amountRupees + Number.EPSILON) * 100) / 100;
  if (!(amountRupees > 0)) {
    throw new HttpsError("failed-precondition", "Payout amount must be positive.");
  }

  const referenceId = `${kind[0]}s_${sourceRef.id}`.slice(0, 40);
  const ledgerRef = db.collection("payouts").doc(referenceId);

  // ── Idempotency guard: claim the ledger doc, refusing an already-live one. ──
  await db.runTransaction(async (tx) => {
    const led = await tx.get(ledgerRef);
    if (led.exists) {
      const st = String(led.data()?.status ?? "");
      if (["processing", "processed", "queued", "pending"].includes(st)) {
        throw new HttpsError(
          "already-exists",
          `A payout for this item is already ${st}.`,
        );
      }
    }
    tx.set(
      ledgerRef,
      {
        referenceId,
        kind,
        sourceId: sourceRef.id,
        sourcePath: sourceRef.path,
        beneficiaryRef: a.beneficiary.ref.path,
        beneficiaryName: a.beneficiary.name,
        amount: amountRupees,
        status: "initiating",
        initiatedBy: a.initiatedBy,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  // ── Ensure the destination fund account (outside the txn: hits Razorpay). ──
  let fundAccountId: string;
  let mode: "UPI" | "IMPS" | "NEFT";
  try {
    const fa = await ensureFundAccount(c, a.beneficiary);
    fundAccountId = fa.fundAccountId;
    mode = fa.mode;
    if (mode === "IMPS" && amountRupees > IMPS_MAX_RUPEES) mode = "NEFT";
  } catch (e: any) {
    await ledgerRef.set(
      { status: "error", error: e?.message || String(e), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    throw e;
  }

  // ── Create the payout (idempotent via reference_id + header). ──
  let payout: any;
  try {
    payout = await rzpx(
      c,
      "/payouts",
      "POST",
      {
        account_number: c.accountNumber,
        fund_account_id: fundAccountId,
        amount: Math.round(amountRupees * 100), // paise
        currency: "INR",
        mode,
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: referenceId,
        narration: a.narration.slice(0, 30),
        notes: { kada_kind: kind, kada_source: sourceRef.id },
      },
      referenceId,
    );
  } catch (e: any) {
    await ledgerRef.set(
      { status: "error", error: e?.message || String(e), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    throw e;
  }

  const status = String(payout.status ?? "processing");
  await ledgerRef.set(
    {
      razorpayPayoutId: payout.id,
      fundAccountId,
      mode,
      status,
      utr: payout.utr ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { payoutId: payout.id, status, referenceId, amount: amountRupees };
}

// ─────────────────────────────────────────────────────────────────────────────
// Beneficiary resolvers — map each kind's Firestore shape to a common form.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The private record is what verification ran on; the legacy public blobs are
 * read only for partners the seal migration has not reached yet.
 */
function bankFor(priv: Record<string, any>, d: Record<string, any>): BankDetails | undefined {
  const b = resolveBankDetails(priv, d);
  return b
    ? { account: b.accountNumber, ifsc: b.ifsc, holder: b.holder || String(d.name ?? "") }
    : undefined;
}

async function resolveVendor(settlement: Record<string, any>): Promise<ResolvedBeneficiary> {
  const restaurantId = String(settlement.restaurantId ?? "");
  if (!restaurantId) throw new HttpsError("failed-precondition", "Settlement has no restaurantId.");
  const { ref, privateRef, data: d, priv } = await readPartnerWithPrivate("vendor", restaurantId);
  assertBankVerified(d, `Vendor "${d.name ?? restaurantId}"`);
  const contact = resolveContact(await readPartnerContact("vendor", restaurantId), d);
  return {
    ref,
    privateRef,
    role: "vendor",
    ownerUids: ownerUidsOf("vendor", restaurantId, d),
    name: String(d.name ?? settlement.restaurantName ?? "Restaurant"),
    email: contact.email,
    phone: contact.phone,
    contactType: "vendor",
    bank: bankFor(priv, d),
    vpa: resolvePayoutVpa(priv, d, { allowListingUpi: true }) || undefined,
  };
}

async function resolveHost(settlement: Record<string, any>): Promise<ResolvedBeneficiary> {
  const hotelId = String(settlement.hotelId ?? settlement.ownerId ?? "");
  if (!hotelId) throw new HttpsError("failed-precondition", "Settlement has no hotelId.");
  const { ref, privateRef, data: d, priv } = await readPartnerWithPrivate("host", hotelId);
  assertBankVerified(d, `Host "${d.name ?? hotelId}"`);
  const contact = resolveContact(await readPartnerContact("host", hotelId), d);
  return {
    ref,
    privateRef,
    role: "host",
    ownerUids: ownerUidsOf("host", hotelId, d),
    name: String(d.name ?? settlement.hotelName ?? "Property"),
    email: contact.email,
    phone: contact.phone,
    contactType: "vendor",
    bank: bankFor(priv, d),
    vpa: resolvePayoutVpa(priv, d) || undefined,
  };
}

async function resolveMess(settlement: Record<string, any>): Promise<ResolvedBeneficiary> {
  const kitchenId = String(settlement.kitchenId ?? "");
  if (!kitchenId) throw new HttpsError("failed-precondition", "Settlement has no kitchenId.");
  const { ref, privateRef, data: d, priv } = await readPartnerWithPrivate("mess", kitchenId);
  assertBankVerified(d, `Mess kitchen "${d.name ?? kitchenId}"`);
  const contact = resolveContact(await readPartnerContact("mess", kitchenId), d);
  return {
    ref,
    privateRef,
    role: "mess",
    ownerUids: ownerUidsOf("mess", kitchenId, d),
    name: String(d.name ?? settlement.kitchenName ?? "Mess kitchen"),
    email: contact.email,
    phone: contact.phone,
    contactType: "vendor",
    bank: bankFor(priv, d),
    vpa: resolvePayoutVpa(priv, d) || undefined,
  };
}

async function resolveRider(req: Record<string, any>): Promise<ResolvedBeneficiary> {
  const riderUid = String(req.riderUid ?? "");
  if (!riderUid) throw new HttpsError("failed-precondition", "Request has no riderUid.");
  const { ref, privateRef, data: d, priv } = await readPartnerWithPrivate("rider", riderUid);
  assertBankVerified(d, `Rider "${d.name ?? riderUid}"`);
  return {
    ref,
    privateRef,
    role: "rider",
    ownerUids: ownerUidsOf("rider", riderUid, d),
    name: String(d.name ?? req.riderName ?? "Rider"),
    email: d.email || undefined,
    phone: d.phone || undefined,
    contactType: "employee",
    bank: bankFor(priv, d),
    // The payout request carries the UPI the rider chose — prefer it.
    vpa: req.upiId || d.upiId || undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Callables
// ─────────────────────────────────────────────────────────────────────────────

/** Admin: is RazorpayX ready to pay out? Drives the console's readiness banner. */
export const getPayoutConfig = onCall({ secrets: PAYOUT_SECRETS }, async (request) => {
  assertAdmin(request);
  const c = readCreds();
  return {
    ok: true,
    configured: !!(c.keyId && c.keySecret && c.accountNumber),
    hasKeys: !!(c.keyId && c.keySecret),
    hasAccountNumber: !!c.accountNumber,
    keyIdMasked: c.keyId ? `${c.keyId.slice(0, 8)}…${c.keyId.slice(-3)}` : null,
    live: c.keyId.startsWith("rzp_live_"),
  };
});

/**
 * Admin: disburse a single settlement / payout request via RazorpayX.
 * Body: { kind: "vendor"|"rider"|"host"|"mess", id: string }
 * Leaves the source in `processing`; the webhook advances it to `paid`.
 */
export const disbursePayout = onCall({ secrets: PAYOUT_SECRETS }, async (request) => {
  assertAdmin(request);
  const c = readCreds();
  assertConfigured(c);

  const kind = String((request.data as any)?.kind ?? "") as BeneficiaryKind;
  const id = String((request.data as any)?.id ?? "").trim();
  if (!["vendor", "rider", "host", "mess"].includes(kind)) {
    throw new HttpsError("invalid-argument", "kind must be vendor, rider, host or mess.");
  }
  if (!id) throw new HttpsError("invalid-argument", "id is required.");

  const db = admin.firestore();
  const initiatedBy = (request.auth?.token?.email as string) || "admin";

  const collectionByKind: Record<BeneficiaryKind, string> = {
    vendor: "vendor_settlements",
    rider: "payout_requests",
    host: "host_settlements",
    mess: "mess_settlements",
  };
  const sourceRef = db.collection(collectionByKind[kind]).doc(id);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) throw new HttpsError("not-found", "Item not found.");
  const source = sourceSnap.data() ?? {};

  const status = String(source.status ?? "");
  if (status === "paid") throw new HttpsError("failed-precondition", "Already paid.");
  if (["processing", "queued", "pending_gateway"].includes(status)) {
    throw new HttpsError("failed-precondition", `Payout already ${status}.`);
  }

  const amountRupees = Number(
    source.netPayout ?? source.amount ?? source.netAmount ?? source.payoutAmount ?? 0,
  );

  const beneficiary =
    kind === "vendor"
      ? await resolveVendor(source)
      : kind === "host"
        ? await resolveHost(source)
        : kind === "mess"
          ? await resolveMess(source)
          : await resolveRider(source);

  const narration =
    kind === "vendor"
      ? `Kada vendor payout`
      : kind === "host"
        ? `Kada host payout`
        : kind === "mess"
          ? `Kada mess payout`
          : `Kada rider payout`;

  const result = await disburse({
    db,
    c,
    kind,
    sourceRef,
    beneficiary,
    amountRupees,
    narration,
    initiatedBy,
  });

  // Mark the source as processing so it leaves the "pending" queue immediately.
  const patch: Record<string, unknown> = {
    status: "processing",
    payoutId: result.payoutId,
    payoutRef: result.referenceId,
    payoutMethod: "razorpay",
    payoutInitiatedAt: admin.firestore.FieldValue.serverTimestamp(),
    payoutInitiatedBy: initiatedBy,
  };
  if (kind === "rider") patch.payoutPending = true;
  await sourceRef.set(patch, { merge: true });

  await db.collection("admin_logs").add({
    type: "payout",
    action: "disbursePayout",
    description: `RazorpayX payout ₹${result.amount} to ${beneficiary.name} (${kind})`,
    adminEmail: initiatedBy,
    payload: { kind, id, ...result },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, ...result };
});

/**
 * Webhook handler for payout.* events. Called by processRazorpayWebhook.
 * Advances the ledger + source settlement based on the terminal payout status.
 */
export async function handlePayoutEvent(
  eventType: string,
  payoutEntity: any,
): Promise<void> {
  const db = admin.firestore();
  const referenceId = String(payoutEntity?.reference_id ?? "");
  if (!referenceId) {
    logger.warn(`payout webhook ${eventType} without reference_id`, payoutEntity?.id);
    return;
  }
  const ledgerRef = db.collection("payouts").doc(referenceId);
  const ledgerSnap = await ledgerRef.get();
  if (!ledgerSnap.exists) {
    logger.warn(`payout webhook: no ledger for reference ${referenceId}`);
    return;
  }
  const ledger = ledgerSnap.data() ?? {};
  const status = String(payoutEntity.status ?? eventType.split(".")[1] ?? "");
  const utr = payoutEntity.utr ?? null;

  await ledgerRef.set(
    {
      status,
      utr,
      failureReason: payoutEntity.failure_reason ?? null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const kind = String(ledger.kind ?? "");
  const sourcePath = String(ledger.sourcePath ?? "");
  if (!sourcePath) return;
  const sourceRef = db.doc(sourcePath);

  const succeeded = status === "processed";
  const failed = ["reversed", "failed", "cancelled", "rejected"].includes(status);

  if (succeeded) {
    const patch: Record<string, unknown> = {
      status: "paid",
      utrNumber: utr,
      payoutStatus: "processed",
      settledAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (kind === "rider") {
      // Advance the rider's paid-out ledger so their available balance drops.
      const amount = Number(ledger.amount ?? 0) || 0;
      const riderUid = String((await sourceRef.get()).data()?.riderUid ?? "");
      patch.paidAt = admin.firestore.FieldValue.serverTimestamp();
      patch.payoutPending = false;
      await sourceRef.set(patch, { merge: true });
      if (riderUid && amount > 0) {
        await db.collection("delivery_users").doc(riderUid).set(
          {
            paidOut: admin.firestore.FieldValue.increment(amount),
            payoutPending: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    } else {
      await sourceRef.set(patch, { merge: true });
    }
  } else if (failed) {
    const patch: Record<string, unknown> = {
      status: "pending",
      payoutStatus: status,
      payoutFailureReason: payoutEntity.failure_reason ?? status,
    };
    if (kind === "rider") patch.payoutPending = false;
    await sourceRef.set(patch, { merge: true });
  }
  // queued / pending / processing → leave source in `processing`, ledger updated.
}
