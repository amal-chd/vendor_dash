/**
 * ─────────────────────────────────────────────────────────────────────────
 * Automatic document checks for partner onboarding.
 *
 * The AI reader (documentReader.ts) turns a photo into fields; this module
 * decides whether those fields are good enough to trust without a human.
 * Pure — no Firebase — so every rule is unit-tested.
 *
 * Verdicts:
 *   auto_verified  every check passed; counts toward automatic go-live
 *   needs_review   readable but something didn't match; an admin decides
 *   retake         unreadable or the wrong document; the partner re-uploads
 *
 * Checks are deliberately about consistency, not identity proof: a format
 * that validates, a GSTIN whose embedded PAN is the partner's PAN, a bank
 * cheque whose account matches what they typed, names that agree. A paid
 * government API can later confirm the numbers exist (`provider` slot).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { nameSimilarity, NAME_MATCH_THRESHOLD, normaliseAccount, normaliseIfsc } from "./bankVerification";

export type DocumentStatus = "auto_verified" | "needs_review" | "retake";

/** Steps the reader knows how to read. Anything else is stored unread. */
export const READABLE_STEPS = [
  "pan",
  "gst_certificate",
  "fssai",
  "bank_proof",
  "owner_identity",
  "driving_licence",
  "vehicle_rc",
  "vehicle_insurance",
] as const;
export type ReadableStep = (typeof READABLE_STEPS)[number];

export function isReadableStep(stepId: string): stepId is ReadableStep {
  return (READABLE_STEPS as readonly string[]).includes(stepId);
}

/** What the reader extracted from one upload. */
/** What each document step is called in messages to the partner. */
export const STEP_NOUN: Record<string, string> = {
  pan: "PAN card",
  gst_certificate: "GST certificate",
  fssai: "FSSAI licence",
  bank_proof: "cancelled cheque or passbook",
  owner_identity: "ID card",
  driving_licence: "driving licence",
  vehicle_rc: "vehicle RC",
  vehicle_insurance: "vehicle insurance",
};

/** Loose match between the reader's `documentKind` and the step it was uploaded for. */
export function kindMatchesStep(stepId: string, kind: string): boolean {
  const k = kind.toLowerCase();
  const expect: Record<string, string[]> = {
    pan: ["pan"],
    gst_certificate: ["gst"],
    fssai: ["fssai", "food", "licen"],
    bank_proof: ["cheque", "check", "passbook", "bank", "statement"],
    owner_identity: ["aadhaar", "aadhar", "voter", "passport", "driving", "licen", "id"],
    driving_licence: ["driving", "licen", "dl"],
    vehicle_rc: ["registration", "rc", "vehicle"],
    vehicle_insurance: ["insurance", "policy"],
  };
  return (expect[stepId] ?? []).some((w) => k.includes(w));
}

export interface DocumentReading {
  /** False when the image isn't a legible document of the expected kind. */
  readable: boolean;
  /** What the reader thinks the document is, e.g. "pan_card", "cancelled_cheque". */
  documentKind?: string | null;
  /** 0–1 reader confidence. */
  confidence: number;
  fields: Record<string, string | null | undefined>;
}

/** Facts from the partner's own record that uploads are checked against. */
export interface CheckContext {
  now: number;
  businessStructure?: string | null;
  /** Legal / applicant name (PAN name once PAN is verified). */
  legalName?: string | null;
  /** PAN already verified for this partner. */
  panNumber?: string | null;
  /** Bank details the partner typed. */
  bank?: { accountNumber?: string | null; ifsc?: string | null; holder?: string | null } | null;
}

export interface DocumentVerdict {
  status: DocumentStatus;
  /** Partner-facing, plain-language reasons. Empty when auto_verified. */
  issues: string[];
  /** Normalised values worth keeping (numbers masked where the law requires). */
  fields: Record<string, string | null>;
  documentNumber: string | null;
  expiresAt: number | null;
  /** Which individual checks ran and how they came out (null = not applicable). */
  checks: Record<string, boolean | null>;
}

const MIN_CONFIDENCE = 0.75;

// ── Normalisers ───────────────────────────────────────────────────────────

export function normaliseId(v: unknown): string {
  return (v ?? "").toString().toUpperCase().replace(/[\s\-./]/g, "");
}

// ── PAN ───────────────────────────────────────────────────────────────────

export function isValidPan(v: unknown): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normaliseId(v));
}

/** Holder type encoded in the 4th PAN character. */
export function panHolderType(v: unknown): string | null {
  const pan = normaliseId(v);
  if (!isValidPan(pan)) return null;
  const map: Record<string, string> = {
    P: "individual",
    C: "company",
    H: "huf",
    F: "firm",
    A: "association",
    T: "trust",
    B: "body_of_individuals",
    L: "local_authority",
    J: "artificial_juridical_person",
    G: "government",
  };
  return map[pan[3]] ?? null;
}

/**
 * Whether a PAN's holder type fits the declared business structure. Null when
 * the structure is unknown (nothing to compare against).
 */
export function panFitsStructure(pan: unknown, structure: unknown): boolean | null {
  const s = (structure ?? "").toString();
  if (!s) return null;
  const type = panHolderType(pan);
  if (!type) return false;
  const allowed: Record<string, string[]> = {
    sole_proprietor: ["individual"],
    individual: ["individual"],
    partnership: ["firm"],
    llp: ["firm"],
    private_limited: ["company"],
    public_limited: ["company"],
    trust_society: ["trust", "association", "body_of_individuals"],
  };
  const ok = allowed[s];
  return ok ? ok.includes(type) : null;
}

// ── GSTIN ─────────────────────────────────────────────────────────────────

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The GSTIN check character for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = GST_CHARS.indexOf(first14[i]);
    if (code < 0) return "";
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(v: unknown): boolean {
  const g = normaliseId(v);
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** The PAN embedded in a GSTIN (characters 3–12). */
export function panOfGstin(v: unknown): string {
  return normaliseId(v).slice(2, 12);
}

// ── FSSAI ─────────────────────────────────────────────────────────────────

/** Licence / registration numbers are 14 digits. */
export function isValidFssaiLicence(v: unknown): boolean {
  return /^[0-9]{14}$/.test(normaliseId(v));
}

/** Application reference numbers (licence still being processed). */
export function isFssaiApplicationNumber(v: unknown): boolean {
  const n = normaliseId(v);
  return !isValidFssaiLicence(n) && /^[0-9A-Z]{10,30}$/.test(n) && /[0-9]{8,}/.test(n);
}

// ── Bank ──────────────────────────────────────────────────────────────────

export function isValidIfsc(v: unknown): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normaliseIfsc(v));
}

// ── Aadhaar (store the last four digits only) ─────────────────────────────

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function isValidAadhaar(v: unknown): boolean {
  const n = (v ?? "").toString().replace(/\D/g, "");
  if (!/^[2-9][0-9]{11}$/.test(n)) return false;
  let c = 0;
  const digits = n.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  return c === 0;
}

export function maskAadhaar(v: unknown): string {
  const n = (v ?? "").toString().replace(/\D/g, "");
  return n.length >= 4 ? `XXXX XXXX ${n.slice(-4)}` : "";
}

// ── Driving licence / vehicle ─────────────────────────────────────────────

/** SS-RR-YYYY-NNNNNNN (15 characters once separators are removed). */
export function isValidDrivingLicence(v: unknown): boolean {
  return /^[A-Z]{2}[0-9]{2}(19|20)[0-9]{2}[0-9]{7}$/.test(normaliseId(v));
}

export function isValidVehicleRegistration(v: unknown): boolean {
  const n = normaliseId(v);
  return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(n) || /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/.test(n);
}

// ── Dates ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Parses the date formats Indian documents use. Midnight UTC; null if unparseable. */
export function parseDocumentDate(v: unknown): number | null {
  const s = (v ?? "").toString().trim().toUpperCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return utc(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return utc(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})[\s-]([A-Z]{3})[A-Z]*[\s-,]*(\d{4})$/);
  if (m && m[2] in MONTHS) return utc(+m[3], MONTHS[m[2]], +m[1]);
  return null;
}

function utc(y: number, mo: number, d: number): number | null {
  if (y < 1900 || y > 2200 || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo, d);
  return new Date(t).getUTCDate() === d ? t : null;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

// ── Verdicts ──────────────────────────────────────────────────────────────

function namesAgree(a: unknown, b: unknown): boolean | null {
  if (!a || !b) return null;
  return nameSimilarity(a, b) >= NAME_MATCH_THRESHOLD;
}

function field(r: DocumentReading, key: string): string {
  return (r.fields[key] ?? "").toString().trim();
}

/**
 * Decides one upload. `stepId` is the requirement it was uploaded for.
 */
export function assessDocument(stepId: string, reading: DocumentReading, ctx: CheckContext): DocumentVerdict {
  const issues: string[] = [];
  const checks: Record<string, boolean | null> = {};
  const fields: Record<string, string | null> = {};
  let documentNumber: string | null = null;
  let expiresAt: number | null = null;

  const retake = (msg: string): DocumentVerdict => ({
    status: "retake", issues: [msg], fields, documentNumber: null, expiresAt: null, checks,
  });

  if (!reading.readable) {
    // Say "this isn't your PAN card" when the reader saw something else
    // entirely (a selfie, a menu, a landscape) — "couldn't read" suggested the
    // right card in bad light.
    const kind = (reading.documentKind ?? "").toLowerCase();
    const wrongThing = kind !== "" && !kindMatchesStep(stepId, kind);
    return retake(wrongThing
      ? `This photo doesn't look like your ${STEP_NOUN[stepId] ?? "document"}. Upload a photo of the ${STEP_NOUN[stepId] ?? "document"} itself.`
      : "We couldn't read this document. Retake the photo in good light, with all four corners visible.");
  }
  const confident = reading.confidence >= MIN_CONFIDENCE;
  checks.readable_clearly = confident;
  if (!confident) issues.push("Parts of this document were hard to read, so a person will double-check it.");

  switch (stepId) {
    case "pan": {
      const pan = normaliseId(field(reading, "panNumber"));
      if (!isValidPan(pan)) return retake("That doesn't look like a PAN card. Upload a clear photo of your PAN card.");
      documentNumber = pan;
      fields.panNumber = pan;
      fields.name = field(reading, "name") || null;
      fields.holderType = panHolderType(pan);
      checks.pan_format = true;
      checks.pan_fits_business = panFitsStructure(pan, ctx.businessStructure);
      if (checks.pan_fits_business === false) {
        issues.push("This PAN's type doesn't match the business type you chose. Check you uploaded the right PAN.");
      }
      break;
    }

    case "gst_certificate": {
      const gstin = normaliseId(field(reading, "gstin"));
      if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
        return retake("That doesn't look like a GST certificate. Upload the certificate page that shows your GSTIN.");
      }
      documentNumber = gstin;
      fields.gstin = gstin;
      fields.legalName = field(reading, "legalName") || null;
      fields.tradeName = field(reading, "tradeName") || null;
      fields.stateCode = gstin.slice(0, 2);
      checks.gstin_valid = isValidGstin(gstin);
      if (!checks.gstin_valid) issues.push("The GSTIN on this certificate doesn't pass validation. Check the number is correct.");
      checks.gstin_matches_pan = ctx.panNumber ? panOfGstin(gstin) === normaliseId(ctx.panNumber) : null;
      if (checks.gstin_matches_pan === false) issues.push("This GSTIN belongs to a different PAN than the one you uploaded.");
      checks.gst_name_matches = namesAgree(fields.legalName, ctx.legalName);
      if (checks.gst_name_matches === false) issues.push("The legal name on the GST certificate doesn't match your PAN.");
      break;
    }

    case "fssai": {
      const raw = normaliseId(field(reading, "licenceNumber"));
      const isLicence = isValidFssaiLicence(raw);
      const isApplication = !isLicence && isFssaiApplicationNumber(raw);
      if (!isLicence && !isApplication) {
        return retake("That doesn't look like an FSSAI licence or application. Upload the licence, or the application acknowledgement.");
      }
      documentNumber = raw;
      fields.licenceNumber = raw;
      fields.kind = isLicence ? "licence" : "application";
      fields.businessName = field(reading, "businessName") || null;
      expiresAt = parseDocumentDate(field(reading, "validUpto"));
      checks.fssai_format = true;
      if (isApplication) {
        // Allowed to start trading on an application, but a person confirms it.
        issues.push("You uploaded an FSSAI application. We'll check it and ask for the licence once it's issued.");
        checks.fssai_licence_issued = false;
      } else if (expiresAt === null) {
        issues.push("We couldn't find the licence's expiry date, so a person will check it.");
        checks.fssai_not_expired = null;
      } else {
        checks.fssai_not_expired = expiresAt > ctx.now;
        if (!checks.fssai_not_expired) {
          return {
            status: "retake", fields, documentNumber, expiresAt, checks,
            issues: [`This FSSAI licence expired on ${fmtDate(expiresAt)}. Upload your renewed licence.`],
          };
        }
      }
      break;
    }

    case "bank_proof": {
      const account = normaliseAccount(field(reading, "accountNumber"));
      const ifsc = normaliseIfsc(field(reading, "ifsc"));
      if (!account && !ifsc) {
        return retake("That doesn't look like a cancelled cheque or bank passbook. Upload one that shows your account number and IFSC.");
      }
      fields.accountLast4 = account ? account.slice(-4) : null;
      fields.ifsc = ifsc || null;
      fields.holder = field(reading, "holderName") || null;
      const typedAccount = normaliseAccount(ctx.bank?.accountNumber);
      const typedIfsc = normaliseIfsc(ctx.bank?.ifsc);
      checks.account_matches = typedAccount && account ? typedAccount === account : null;
      checks.ifsc_matches = typedIfsc && ifsc ? typedIfsc === ifsc : null;
      checks.holder_matches = namesAgree(fields.holder, ctx.bank?.holder ?? ctx.legalName);
      if (checks.account_matches === false) issues.push("The account number on this document doesn't match the one you entered.");
      if (checks.ifsc_matches === false) issues.push("The IFSC on this document doesn't match the one you entered.");
      if (checks.account_matches === null) issues.push("We couldn't read the account number, so a person will check it.");
      if (checks.holder_matches === false) issues.push("The account holder name doesn't match your PAN or business name.");
      break;
    }

    case "owner_identity": {
      const kind = (reading.documentKind ?? field(reading, "idType")).toLowerCase();
      const name = field(reading, "name");
      fields.idType = kind || null;
      fields.name = name || null;
      if (kind.includes("aadhaar")) {
        const n = field(reading, "idNumber");
        fields.idNumber = maskAadhaar(n) || null;
        checks.id_number_valid = n ? isValidAadhaar(n) : null;
        documentNumber = fields.idNumber;
      } else {
        documentNumber = normaliseId(field(reading, "idNumber")) || null;
        fields.idNumber = documentNumber;
        checks.id_number_valid = documentNumber ? documentNumber.length >= 6 : null;
      }
      if (checks.id_number_valid === false) issues.push("The ID number on this document doesn't look valid.");
      checks.id_name_matches = namesAgree(name, ctx.legalName);
      if (checks.id_name_matches === false) issues.push("The name on this ID doesn't match your PAN.");
      break;
    }

    case "driving_licence": {
      const dl = normaliseId(field(reading, "licenceNumber"));
      if (!dl || dl.length < 10) return retake("That doesn't look like a driving licence. Upload a clear photo of the side with your licence number.");
      documentNumber = dl;
      fields.licenceNumber = dl;
      fields.name = field(reading, "name") || null;
      fields.vehicleClasses = field(reading, "vehicleClasses") || null;
      expiresAt = parseDocumentDate(field(reading, "validUpto"));
      checks.dl_format = isValidDrivingLicence(dl);
      if (!checks.dl_format) issues.push("This licence number is in an unusual format, so a person will check it.");
      checks.dl_not_expired = expiresAt === null ? null : expiresAt > ctx.now;
      if (checks.dl_not_expired === false) {
        return { status: "retake", fields, documentNumber, expiresAt, checks,
          issues: [`This driving licence expired on ${fmtDate(expiresAt!)}. Upload a valid licence.`] };
      }
      if (checks.dl_not_expired === null) issues.push("We couldn't find the licence's expiry date, so a person will check it.");
      checks.dl_name_matches = namesAgree(fields.name, ctx.legalName);
      if (checks.dl_name_matches === false) issues.push("The name on the licence doesn't match your profile.");
      break;
    }

    case "vehicle_rc": {
      const reg = normaliseId(field(reading, "registrationNumber"));
      if (!reg) return retake("That doesn't look like a vehicle RC. Upload a clear photo of your registration certificate.");
      documentNumber = reg;
      fields.registrationNumber = reg;
      fields.ownerName = field(reading, "ownerName") || null;
      checks.rc_format = isValidVehicleRegistration(reg);
      if (!checks.rc_format) issues.push("This registration number is in an unusual format, so a person will check it.");
      // A family member's vehicle is normal for riders; the name is recorded, not required to match.
      break;
    }

    case "vehicle_insurance": {
      documentNumber = normaliseId(field(reading, "policyNumber")) || null;
      fields.policyNumber = documentNumber;
      fields.registrationNumber = normaliseId(field(reading, "registrationNumber")) || null;
      expiresAt = parseDocumentDate(field(reading, "validUpto"));
      checks.insurance_not_expired = expiresAt === null ? null : expiresAt > ctx.now;
      if (checks.insurance_not_expired === false) {
        return { status: "retake", fields, documentNumber, expiresAt, checks,
          issues: [`This insurance expired on ${fmtDate(expiresAt!)}. Upload your current policy.`] };
      }
      if (checks.insurance_not_expired === null) issues.push("We couldn't find the policy's expiry date, so a person will check it.");
      break;
    }

    default:
      break;
  }

  return {
    status: issues.length === 0 ? "auto_verified" : "needs_review",
    issues,
    fields,
    documentNumber,
    expiresAt,
    checks,
  };
}
