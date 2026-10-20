/**
 * ─────────────────────────────────────────────────────────────────────────
 * Partner private store — where full bank details, payout routing, PAN and
 * the owner's personal contact live.
 *
 * `restaurants/{id}` and `hotels/{id}` are publicly readable (the customer
 * apps list them straight from Firestore), so every field on those docs is
 * readable by anyone holding the public web config. The onboarding engine
 * used to write `bank.accountNumber` / `bank.ifsc` there, and legacy docs
 * also carry `kyc.bank`, `bankDetails`, `payoutAccount`, the RazorpayX
 * routing cache (`payout.*`) and the owner's login email.
 *
 * Now:
 *   partner_private/{role}_{partnerId}  bank details, payout cache, PAN
 *                                        (finance-grade admins + owner)
 *   partner_contact/{role}_{partnerId}  owner email / personal phone
 *                                        (any admin + owner)
 *
 * Both are written only here, via the Admin SDK. The public doc keeps what a
 * listing or a gate needs: `bank.verificationState`, the masked account, the
 * 4-letter bank code and the name-match OUTCOME.
 *
 * Top-level collections, not a `private` subcollection: `hotels/{id}` has a
 * public-read catch-all over its subcollections and rules OR together, so a
 * subdoc there would be public no matter what its own rule said.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { createHmac, randomBytes } from "crypto";
import { type PartnerRole, ROLE_COLLECTION } from "./stateMachine";
import {
  type BankRecord,
  bankDetailsHash,
  maskAccount,
  normaliseAccount,
  normaliseIfsc,
} from "./bankVerification";

type Doc = Record<string, any>;

export const PARTNER_PRIVATE_COLLECTION = "partner_private";
export const PARTNER_CONTACT_COLLECTION = "partner_contact";

export function partnerDocKey(role: PartnerRole, partnerId: string): string {
  return `${role}_${partnerId}`;
}

export function partnerPrivateRef(
  role: PartnerRole,
  partnerId: string,
): admin.firestore.DocumentReference {
  return admin
    .firestore()
    .collection(PARTNER_PRIVATE_COLLECTION)
    .doc(partnerDocKey(role, partnerId));
}

export function partnerContactRef(
  role: PartnerRole,
  partnerId: string,
): admin.firestore.DocumentReference {
  return admin
    .firestore()
    .collection(PARTNER_CONTACT_COLLECTION)
    .doc(partnerDocKey(role, partnerId));
}

/** Keys under a public `bank` map that identify, route to, or name the account. */
export const SENSITIVE_BANK_KEYS = [
  "holder",
  "accountName",
  "accountNumber",
  "account",
  "ifsc",
  "vpa",
  "upiId",
  // An unkeyed sha256 of a 9–18 digit account + a known IFSC is brute-forceable.
  "detailsHash",
  "razorpayContactId",
  "razorpayFundAccountId",
  "validationId",
  "validationStartedAt",
  "mismatchAcceptedBy",
  "mismatchAcceptedReason",
] as const;

/** Engine bookkeeping that belongs with the details it was created for. */
const ROUTING_BANK_KEYS = [
  "razorpayContactId",
  "razorpayFundAccountId",
  "validationId",
  "validationStartedAt",
  "mismatchAcceptedBy",
  "mismatchAcceptedReason",
] as const;

/** Top-level fields that only ever carry payout routing data. */
export const SENSITIVE_TOP_LEVEL_FIELDS = [
  "bankDetails",
  "payoutAccount",
  // RazorpayX contact/fund-account cache. Also an integrity problem on a
  // client-writable doc: payouts trusted `payout.fundAccountId`.
  "payout",
  "payoutVpa",
] as const;

/**
 * Owner contact on the public listing docs. `phone` is deliberately absent:
 * it is the shop's published number (customer app, public menu, receipts).
 */
export const CONTACT_FIELDS = [
  "email",
  "ownerEmail",
  "ownerPhone",
  "outletEmail",
  "hostEmail",
] as const;

export const REDACTED_HOLDER_FLAG =
  "Account holder name does not match the legal name — see Bank Verification.";
export const REDACTED_DUPLICATE_FLAG =
  "Bank account matches another partner's account — see Bank Verification.";

const HOLDER_FLAG_RE = /^Holder name ".*" does not match/;
const DUPLICATE_FLAG_RE = /^Bank account already used by:/;

function isObj(v: unknown): v is Doc {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

function text(v: unknown): string {
  return (v ?? "").toString().trim();
}

/** Older submitBankDetails flags quoted the typed holder name and other partners' ids. */
export function redactRiskFlag(flag: string): string {
  if (HOLDER_FLAG_RE.test(flag)) return REDACTED_HOLDER_FLAG;
  if (DUPLICATE_FLAG_RE.test(flag)) return REDACTED_DUPLICATE_FLAG;
  return flag;
}

// ─────────────────────────────────────────────────────────────────────────
// Resolution — one precedence order for every server reader
// ─────────────────────────────────────────────────────────────────────────

export type BankSource = "private" | "bank" | "kyc.bank" | "payoutAccount" | "bankDetails";

export interface ResolvedBankDetails {
  holder: string;
  accountNumber: string;
  ifsc: string;
  vpa?: string;
  source: BankSource;
}

/**
 * The private record wins; the legacy public blobs are read only for partners
 * the seal migration has not reached yet. Reading them server-side leaks
 * nothing — the leak was client reads — and it keeps payouts and the penny
 * drop working between deploy and migration.
 */
export function resolveBankDetails(priv?: Doc, pub?: Doc): ResolvedBankDetails | null {
  const candidates: [BankSource, unknown][] = [
    ["private", priv?.bank],
    ["bank", pub?.bank],
    ["kyc.bank", isObj(pub?.kyc) ? pub?.kyc.bank : undefined],
    ["payoutAccount", pub?.payoutAccount],
    ["bankDetails", pub?.bankDetails],
  ];
  for (const [source, c] of candidates) {
    if (!isObj(c)) continue;
    const accountNumber = normaliseAccount(c.accountNumber ?? c.account);
    const ifsc = normaliseIfsc(c.ifsc);
    if (!accountNumber || !ifsc) continue;
    const vpa = text(c.vpa ?? c.upiId);
    return {
      holder: text(c.holder ?? c.accountName ?? pub?.name),
      accountNumber,
      ifsc,
      ...(vpa ? { vpa } : {}),
      source,
    };
  }
  return null;
}

/**
 * UPI payout destination. `allowListingUpi` keeps the vendor behaviour of
 * falling back to the shop's customer-payment `upiId`, which is public by
 * design (it is printed on the POS QR).
 */
export function resolvePayoutVpa(
  priv?: Doc,
  pub?: Doc,
  opts?: { allowListingUpi?: boolean },
): string {
  const details = resolveBankDetails(priv, pub);
  const candidates = [
    details?.vpa,
    priv?.payoutVpa,
    isObj(priv?.legacy) ? priv?.legacy.payoutVpa : undefined,
    pub?.payoutVpa,
    opts?.allowListingUpi ? pub?.upiId : undefined,
  ];
  for (const c of candidates) {
    const v = text(c);
    if (v) return v;
  }
  return "";
}

/** Contact for RazorpayX contacts and admin surfaces. */
export function resolveContact(contact?: Doc, pub?: Doc): { email?: string; phone?: string } {
  const email =
    text(contact?.email) ||
    text(pub?.email) ||
    text(contact?.ownerEmail) ||
    text(pub?.ownerEmail) ||
    text(contact?.outletEmail) ||
    text(contact?.hostEmail);
  const phone = text(pub?.phone) || text(contact?.ownerPhone) || text(pub?.ownerPhone);
  return { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}

/** The 4-letter bank code from an IFSC ("HDFC0001234" → "HDFC"). Identifies the bank, not the branch. */
export function ifscBankCode(ifsc: unknown): string | null {
  const i = normaliseIfsc(ifsc);
  return /^[A-Z]{4}/.test(i) ? i.slice(0, 4) : null;
}

/** Everything about an account the public doc may show. */
export function publicBankSummary(d: { accountNumber?: unknown; ifsc?: unknown }): {
  accountMasked: string;
  ifscBank: string | null;
} {
  return { accountMasked: maskAccount(d.accountNumber), ifscBank: ifscBankCode(d.ifsc) };
}

/** Splits a freshly collected bank record into its private and public halves. */
export function splitBankRecord(record: BankRecord): { privateBank: Doc; publicBank: Doc } {
  const privateBank: Doc = {
    holder: record.holder,
    accountNumber: record.accountNumber,
    ifsc: record.ifsc,
    detailsHash: record.detailsHash,
  };
  if (record.vpa) privateBank.vpa = record.vpa;

  const publicBank: Doc = {
    verificationState: record.verificationState,
    ...publicBankSummary(record),
  };
  if (record.nameMatch) publicBank.nameMatch = record.nameMatch;

  if (record.updatedAt !== undefined) {
    privateBank.updatedAt = record.updatedAt;
    publicBank.updatedAt = record.updatedAt;
  }
  return { privateBank, publicBank };
}

/** Uids allowed to read their own private/contact record (checked by rules). */
export function ownerUidsOf(role: PartnerRole, partnerId: string, pub?: Doc): string[] {
  const ids = [partnerId];
  // Outlets are owned by their parent (mirrors isRestaurantOwner in rules).
  if (role === "vendor") ids.push(text(pub?.ownerId), text(pub?.parentId));
  return Array.from(new Set(ids.filter(Boolean)));
}

// ─────────────────────────────────────────────────────────────────────────
// Seal planning — pure, shared by the write trigger and the migration
// ─────────────────────────────────────────────────────────────────────────

export interface SealPlan {
  /** True when the public doc must change. */
  needed: boolean;
  /** Public field paths that held private data. */
  moved: string[];
  /** Merged into partner_private (never overwrites held bank details). */
  privatePatch: Doc;
  /** Merged into partner_contact (latest public value wins). */
  contactPatch: Doc;
  /** Dotted-path updates for the public doc. */
  publicSet: Doc;
  /** Dotted paths to delete from the public doc. */
  publicDelete: string[];
  /** Human-readable notes, never containing the values themselves. */
  conflicts: string[];
  /** Details to fingerprint when the private record is being filled. */
  fingerprintFor: { accountNumber: string; ifsc: string } | null;
}

function emptyPlan(): SealPlan {
  return {
    needed: false,
    moved: [],
    privatePatch: {},
    contactPatch: {},
    publicSet: {},
    publicDelete: [],
    conflicts: [],
    fingerprintFor: null,
  };
}

/**
 * Decides what moves off a public partner doc. Idempotent: planning against
 * an already-sealed doc returns `needed: false`.
 */
export function planPartnerSeal(role: PartnerRole, pub: Doc | undefined, priv?: Doc): SealPlan {
  const plan = emptyPlan();
  if (!isObj(pub)) return plan;

  const legacy: Doc = {};
  const identity: Doc = {};
  let bankTouched = false;
  const move = (path: string) => {
    plan.moved.push(path);
    plan.publicDelete.push(path);
  };

  // 1) The public `bank` map: keep verification state, drop everything that
  //    identifies, names or routes to the account.
  const bank = pub.bank;
  const bankIsMap = isObj(bank);
  const bankIsJunk = present(bank) && !bankIsMap;
  if (bankIsJunk) {
    legacy.bankRaw = bank;
    plan.moved.push("bank");
    bankTouched = true;
  } else if (bankIsMap) {
    const moved: Doc = {};
    for (const k of SENSITIVE_BANK_KEYS) {
      if (!present(bank[k])) continue;
      moved[k] = bank[k];
      move(`bank.${k}`);
    }
    if (isObj(bank.validationResult) && present(bank.validationResult.registeredName)) {
      moved.registeredName = bank.validationResult.registeredName;
      move("bank.validationResult.registeredName");
    }
    if (Object.keys(moved).length) {
      legacy.bank = moved;
      bankTouched = true;
    }
  }

  // 2) Legacy KYC blobs. GSTIN / FSSAI stay public — they are printed on
  //    invoices and menus by law. PAN is personal.
  if (isObj(pub.kyc)) {
    if (present(pub.kyc.bank)) {
      legacy.kycBank = pub.kyc.bank;
      move("kyc.bank");
      bankTouched = true;
    }
    if (present(pub.kyc.pan)) {
      identity.pan = text(pub.kyc.pan).toUpperCase();
      move("kyc.pan");
    }
  }
  if (isObj(pub.kycDraft)) {
    if (present(pub.kycDraft.pan)) {
      if (!identity.pan) identity.pan = text(pub.kycDraft.pan).toUpperCase();
      move("kycDraft.pan");
    }
    if (present(pub.kycDraft.bankHolder)) {
      legacy.bankHolderDraft = pub.kycDraft.bankHolder;
      move("kycDraft.bankHolder");
    }
  }

  // 3) Top-level payout blobs.
  for (const f of SENSITIVE_TOP_LEVEL_FIELDS) {
    if (!present(pub[f])) continue;
    move(f);
    bankTouched = true;
    if (f === "payout" && isObj(pub.payout) && !isObj(priv?.payout)) {
      plan.privatePatch.payout = pub.payout;
    } else if (f === "payoutVpa" && !present(priv?.payoutVpa)) {
      plan.privatePatch.payoutVpa = text(pub.payoutVpa);
    } else {
      legacy[f] = pub[f];
    }
  }

  // 4) Owner contact — listing docs only; delivery_users is not public, and
  //    the rider app reads its own phone/email from it.
  if (role !== "rider") {
    for (const f of CONTACT_FIELDS) {
      if (!present(pub[f])) continue;
      plan.contactPatch[f] = text(pub[f]);
      move(f);
    }
  }

  // 5) Risk flags that quoted the typed holder name or other partners' ids.
  if (Array.isArray(pub.riskFlags)) {
    const original = pub.riskFlags.map((f: unknown) => String(f));
    const redacted = original.map(redactRiskFlag);
    if (redacted.some((f: string, i: number) => f !== original[i])) {
      plan.publicSet.riskFlags = Array.from(new Set(redacted));
      legacy.riskFlags = original.filter((f: string, i: number) => f !== redacted[i]);
      plan.moved.push("riskFlags");
    }
  }

  // 6) Full details into the private store — but never over details the
  //    engine already holds there: those are what verification was run on.
  const held = resolveBankDetails(priv, undefined);
  const found = resolveBankDetails(undefined, pub);
  if (found && !held) {
    const pb: Doc = {
      holder: found.holder,
      accountNumber: found.accountNumber,
      ifsc: found.ifsc,
      detailsHash: bankDetailsHash(found),
      migratedFrom: found.source,
    };
    if (found.vpa) pb.vpa = found.vpa;
    if (found.source === "bank" && bankIsMap) {
      for (const k of ROUTING_BANK_KEYS) if (present(bank[k])) pb[k] = bank[k];
      if (isObj(bank.validationResult) && present(bank.validationResult.registeredName)) {
        pb.registeredName = bank.validationResult.registeredName;
      }
    }
    plan.privatePatch.bank = pb;
    plan.fingerprintFor = { accountNumber: found.accountNumber, ifsc: found.ifsc };
  } else if (
    found &&
    held &&
    (found.accountNumber !== held.accountNumber || found.ifsc !== held.ifsc)
  ) {
    plan.conflicts.push(
      `Public ${found.source} differs from the private record; the private record was kept.`,
    );
  }

  // 7) What the public doc keeps: the masked account and the bank code.
  const summaryFrom = held ?? found;
  if (bankTouched && summaryFrom) {
    const s = publicBankSummary(summaryFrom);
    if (bankIsJunk) {
      plan.publicSet.bank = s;
    } else {
      if (bank?.accountMasked !== s.accountMasked) plan.publicSet["bank.accountMasked"] = s.accountMasked;
      if ((bank?.ifscBank ?? null) !== s.ifscBank) plan.publicSet["bank.ifscBank"] = s.ifscBank;
    }
  } else if (bankIsJunk) {
    plan.publicDelete.push("bank");
  }

  if (Object.keys(identity).length) plan.privatePatch.identity = identity;
  if (Object.keys(legacy).length) plan.privatePatch.legacy = legacy;
  plan.needed = plan.publicDelete.length > 0 || Object.keys(plan.publicSet).length > 0;
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────
// Duplicate detection — keyed fingerprints, never a plain hash
// ─────────────────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 over the normalised account + IFSC. Account numbers are
 * low-entropy (9–18 digits, and the IFSC narrows the bank), so an unkeyed
 * hash is reversible by enumeration; without the key this is not.
 */
export function computeBankFingerprint(
  key: string | Buffer,
  accountNumber: unknown,
  ifsc: unknown,
): string {
  const a = normaliseAccount(accountNumber);
  const i = normaliseIfsc(ifsc);
  if (!a || !i) return "";
  return createHmac("sha256", key).update(`${a}|${i}`).digest("hex");
}

/**
 * The HMAC key lives in `server_secrets/bank_fingerprint` (rules deny every
 * client). Generated once, in a transaction, on first use — so a deploy never
 * blocks on a secret someone forgot to set. Anyone who can read this doc can
 * already read partner_private itself, so it adds no weaker boundary.
 */
const FINGERPRINT_KEY_COLLECTION = "server_secrets";
const FINGERPRINT_KEY_DOC = "bank_fingerprint";

let fingerprintKeyCache: Promise<{ keyId: string; key: Buffer }> | null = null;

export function bankFingerprintKey(): Promise<{ keyId: string; key: Buffer }> {
  if (!fingerprintKeyCache) {
    fingerprintKeyCache = loadOrCreateFingerprintKey().catch((e) => {
      fingerprintKeyCache = null;
      throw e;
    });
  }
  return fingerprintKeyCache;
}

async function loadOrCreateFingerprintKey(): Promise<{ keyId: string; key: Buffer }> {
  const db = admin.firestore();
  const ref = db.collection(FINGERPRINT_KEY_COLLECTION).doc(FINGERPRINT_KEY_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (d && typeof d.key === "string" && typeof d.keyId === "string") {
      return { keyId: d.keyId, key: Buffer.from(d.key, "base64") };
    }
    const key = randomBytes(32);
    const keyId = randomBytes(6).toString("hex");
    tx.set(ref, {
      key: key.toString("base64"),
      keyId,
      algorithm: "HMAC-SHA256",
      purpose:
        "Bank-account duplicate detection (partner_private.bankFingerprint). " +
        "Rotating it orphans every existing fingerprint.",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { keyId, key };
  });
}

export async function fingerprintBank(
  accountNumber: unknown,
  ifsc: unknown,
): Promise<{ bankFingerprint: string; bankFingerprintKeyId: string } | null> {
  const k = await bankFingerprintKey();
  const fp = computeBankFingerprint(k.key, accountNumber, ifsc);
  return fp ? { bankFingerprint: fp, bankFingerprintKeyId: k.keyId } : null;
}

/**
 * The same account + IFSC on another partner (any role) is a strong fraud
 * signal — or an owner who also delivers. Either way it is flagged for
 * review, not silently allowed.
 */
export async function findDuplicateBankAccounts(
  fingerprint: string,
  self: { role: PartnerRole; partnerId: string },
): Promise<{ role: string; partnerId: string }[]> {
  if (!fingerprint) return [];
  const selfKey = partnerDocKey(self.role, self.partnerId);
  const snap = await admin
    .firestore()
    .collection(PARTNER_PRIVATE_COLLECTION)
    .where("bankFingerprint", "==", fingerprint)
    .limit(20)
    .get();
  return snap.docs
    .filter((d) => d.id !== selfKey)
    .map((d) => ({
      role: text(d.data().role),
      partnerId: text(d.data().partnerId),
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// I/O
// ─────────────────────────────────────────────────────────────────────────

/** Public doc + private record in one round trip. */
export async function readPartnerWithPrivate(
  role: PartnerRole,
  partnerId: string,
): Promise<{
  ref: admin.firestore.DocumentReference;
  privateRef: admin.firestore.DocumentReference;
  exists: boolean;
  data: Doc;
  priv: Doc;
}> {
  const db = admin.firestore();
  let ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
  let privateRef = partnerPrivateRef(role, partnerId);
  const [snap, privSnap] = await db.getAll(ref, privateRef);

  if (snap.exists) {
    return {
      ref,
      privateRef,
      exists: true,
      data: snap.data() ?? {},
      priv: privSnap.data() ?? {},
    };
  }

  // Fallback: Check if document exists with ownerUid, ownerId, or userId == partnerId
  const collectionRef = db.collection(ROLE_COLLECTION[role]);
  const ownerQuery = await collectionRef.where("ownerUid", "==", partnerId).limit(1).get();
  let foundDoc = !ownerQuery.empty ? ownerQuery.docs[0] : null;

  if (!foundDoc) {
    const ownerIdQuery = await collectionRef.where("ownerId", "==", partnerId).limit(1).get();
    if (!ownerIdQuery.empty) foundDoc = ownerIdQuery.docs[0];
  }
  if (!foundDoc) {
    const userIdQuery = await collectionRef.where("userId", "==", partnerId).limit(1).get();
    if (!userIdQuery.empty) foundDoc = userIdQuery.docs[0];
  }

  if (foundDoc) {
    ref = foundDoc.ref;
    privateRef = partnerPrivateRef(role, foundDoc.id);
    const resolvedPrivSnap = await privateRef.get();
    return {
      ref,
      privateRef,
      exists: true,
      data: foundDoc.data() ?? {},
      priv: resolvedPrivSnap.data() ?? (privSnap.data() ?? {}),
    };
  }

  return {
    ref,
    privateRef,
    exists: false,
    data: {},
    priv: privSnap.data() ?? {},
  };
}

export async function readPartnerContact(role: PartnerRole, partnerId: string): Promise<Doc> {
  return (await partnerContactRef(role, partnerId).get()).data() ?? {};
}

/**
 * Moves private fields off one partner doc, atomically: the private copy and
 * the public delete commit together or not at all.
 */
export async function sealPartnerDoc(
  role: PartnerRole,
  partnerId: string,
  opts?: { dryRun?: boolean },
): Promise<SealPlan> {
  const db = admin.firestore();
  const pubRef = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
  const privRef = partnerPrivateRef(role, partnerId);
  const contactRef = partnerContactRef(role, partnerId);

  if (opts?.dryRun) {
    const [p, q] = await db.getAll(pubRef, privRef);
    return p.exists ? planPartnerSeal(role, p.data(), q.data()) : emptyPlan();
  }

  // The key loader runs its own transaction; transactions don't nest.
  const key = await bankFingerprintKey();

  return db.runTransaction(async (tx) => {
    const [p, q] = await tx.getAll(pubRef, privRef);
    if (!p.exists) return emptyPlan();
    const pub = p.data() ?? {};
    const plan = planPartnerSeal(role, pub, q.data());
    if (!plan.needed) return plan;

    const now = admin.firestore.FieldValue.serverTimestamp();
    const owners = ownerUidsOf(role, partnerId, pub);

    if (Object.keys(plan.privatePatch).length) {
      const privWrite: Doc = {
        ...plan.privatePatch,
        role,
        partnerId,
        ownerUids: owners,
        sealedAt: now,
        updatedAt: now,
      };
      if (plan.fingerprintFor) {
        const fp = computeBankFingerprint(
          key.key,
          plan.fingerprintFor.accountNumber,
          plan.fingerprintFor.ifsc,
        );
        if (fp) {
          privWrite.bankFingerprint = fp;
          privWrite.bankFingerprintKeyId = key.keyId;
        }
      }
      tx.set(privRef, privWrite, { merge: true });
    }

    if (Object.keys(plan.contactPatch).length) {
      tx.set(
        contactRef,
        { ...plan.contactPatch, role, partnerId, ownerUids: owners, updatedAt: now },
        { merge: true },
      );
    }

    const update: Doc = { ...plan.publicSet };
    for (const path of plan.publicDelete) update[path] = admin.firestore.FieldValue.delete();
    tx.update(pubRef, update);
    return plan;
  });
}

/**
 * Trigger entry point. Older app builds, the web dashboard and admin edits
 * still write `email` / legacy bank blobs straight onto the public doc; this
 * moves them within seconds of the write. The pure check runs first, so an
 * ordinary partner-doc update costs no extra reads.
 */
export async function sealPartnerOnWrite(
  role: PartnerRole,
  partnerId: string,
  data: Doc | undefined,
): Promise<void> {
  if (!planPartnerSeal(role, data).needed) return;
  try {
    const plan = await sealPartnerDoc(role, partnerId);
    if (plan.needed) {
      logger.info(`Sealed private fields off ${role}/${partnerId}: ${plan.moved.join(", ")}`);
    }
  } catch (e) {
    logger.error(`sealPartnerOnWrite failed for ${role}/${partnerId}`, e);
  }
}
