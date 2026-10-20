import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import {
  planPartnerSeal,
  resolveBankDetails,
  resolvePayoutVpa,
  resolveContact,
  computeBankFingerprint,
  publicBankSummary,
  splitBankRecord,
  ownerUidsOf,
  redactRiskFlag,
  REDACTED_HOLDER_FLAG,
  REDACTED_DUPLICATE_FLAG,
  type SealPlan,
} from "../src/onboarding/partnerPrivate";
import { bankDetailsHash, type BankRecord } from "../src/onboarding/bankVerification";

type Doc = Record<string, any>;

const ACCOUNT = "50100123456789";
const IFSC = "HDFC0001234";

function setPath(obj: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function deletePath(obj: Doc, path: string): void {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur?.[p] !== "object" || cur[p] === null) return;
    cur = cur[p];
  }
  delete cur[parts[parts.length - 1]];
}

/** Applies a plan to a plain object the way Firestore update() would. */
function applyPublic(pub: Doc, plan: SealPlan): Doc {
  const out = structuredClone(pub);
  for (const p of plan.publicDelete) deletePath(out, p);
  for (const [p, v] of Object.entries(plan.publicSet)) setPath(out, p, v);
  return out;
}

function mergeDeep(target: Doc, patch: Doc): Doc {
  const out = structuredClone(target);
  for (const [k, v] of Object.entries(patch)) {
    const both = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object";
    out[k] = both ? mergeDeep(out[k], v) : v;
  }
  return out;
}

const leaksAccount = (doc: unknown) => {
  const s = JSON.stringify(doc);
  return s.includes(ACCOUNT) || s.includes(IFSC);
};

// Shapes actually found on partner docs.
const engineVendor: Doc = {
  name: "Kada Foods",
  phone: "+919876543210",
  bank: {
    holder: "Kada Foods",
    accountNumber: ACCOUNT,
    ifsc: IFSC,
    verificationState: "pending_verification",
    verificationMessage: "Awaiting verification.",
    detailsHash: "0123456789abcdef",
    nameMatch: { score: 1, matched: true, comparedTo: "Kada Foods" },
    razorpayFundAccountId: "fa_123",
  },
};

const legacyHost: Doc = {
  name: "Backwater Stay",
  email: "owner@example.com",
  ownerPhone: "+919800000000",
  kyc: { bank: { account: ACCOUNT, ifsc: IFSC, holder: "A Owner" }, gst: "32ABCDE1234F1Z5" },
  bankDetails: { accountNumber: "123456789012", ifsc: "SBIN0000001" },
  payoutAccount: { accountNumber: "123456789012", ifsc: "SBIN0000001" },
  payout: { contactId: "cont_1", fundAccountId: "fa_1", detailsHash: "abc" },
  payoutVpa: "owner@okhdfc",
};

const legacyRider: Doc = {
  name: "Rider",
  email: "rider@example.com",
  phone: "+919811111111",
  bank: { account: ACCOUNT, ifsc: IFSC, holder: "Rider", upiId: "rider@upi" },
};

// ─────────────────────────────────────────────────────────────────────────
// Sealing — nothing identifying may survive on a public doc
// ─────────────────────────────────────────────────────────────────────────

describe("sealing a public partner doc", () => {
  it("moves engine-written bank details off a vendor doc, keeping state and the masked summary", () => {
    const plan = planPartnerSeal("vendor", engineVendor);
    expect(plan.needed).toBe(true);

    const after = applyPublic(engineVendor, plan);
    expect(leaksAccount(after)).toBe(false);
    expect(after.bank.holder).toBeUndefined();
    expect(after.bank.detailsHash).toBeUndefined();
    expect(after.bank.razorpayFundAccountId).toBeUndefined();
    expect(after.bank.verificationState).toBe("pending_verification");
    expect(after.bank.nameMatch.matched).toBe(true);
    expect(after.bank.accountMasked).toBe("••••6789");
    expect(after.bank.ifscBank).toBe("HDFC");

    expect(plan.privatePatch.bank).toMatchObject({
      holder: "Kada Foods",
      accountNumber: ACCOUNT,
      ifsc: IFSC,
      razorpayFundAccountId: "fa_123",
      migratedFrom: "bank",
    });
    expect(plan.fingerprintFor).toEqual({ accountNumber: ACCOUNT, ifsc: IFSC });
  });

  it("moves every legacy payout blob and records the strongest one as the account", () => {
    const plan = planPartnerSeal("host", legacyHost);
    const after = applyPublic(legacyHost, plan);

    expect(leaksAccount(after)).toBe(false);
    expect(JSON.stringify(after)).not.toContain("123456789012");
    for (const f of ["kyc.bank", "bankDetails", "payoutAccount", "payout", "payoutVpa"]) {
      expect(plan.publicDelete).toContain(f);
    }
    // GSTIN is printed on invoices — it stays.
    expect(after.kyc.gst).toBe("32ABCDE1234F1Z5");

    expect(plan.privatePatch.bank).toMatchObject({ accountNumber: ACCOUNT, migratedFrom: "kyc.bank" });
    expect(plan.privatePatch.payout).toEqual(legacyHost.payout);
    expect(plan.privatePatch.payoutVpa).toBe("owner@okhdfc");
    expect(plan.privatePatch.legacy).toMatchObject({
      kycBank: legacyHost.kyc.bank,
      bankDetails: legacyHost.bankDetails,
      payoutAccount: legacyHost.payoutAccount,
    });
  });

  it("never overwrites bank details the private store already holds", () => {
    const priv = { bank: { accountNumber: "999988887777", ifsc: "ICIC0000001", holder: "Owner" } };
    const pub = { kyc: { bank: { account: ACCOUNT, ifsc: IFSC } } };
    const plan = planPartnerSeal("vendor", pub, priv);

    expect(plan.privatePatch.bank).toBeUndefined();
    expect(plan.fingerprintFor).toBeNull();
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts.join(" ")).not.toContain(ACCOUNT);
    // The public summary describes the account that is actually on record.
    expect(applyPublic(pub, plan).bank.accountMasked).toBe("••••7777");
  });

  it("moves the owner's contact off listings but keeps the published shop phone", () => {
    const plan = planPartnerSeal("host", legacyHost);
    expect(plan.contactPatch).toEqual({ email: "owner@example.com", ownerPhone: "+919800000000" });

    const vendor = { ...engineVendor, email: "login@example.com", outletEmail: "outlet@example.com", ownerEmail: "o@example.com" };
    const vp = planPartnerSeal("vendor", vendor);
    expect(vp.contactPatch).toEqual({
      email: "login@example.com",
      ownerEmail: "o@example.com",
      outletEmail: "outlet@example.com",
    });
    expect(vp.publicDelete).not.toContain("phone");
    expect(applyPublic(vendor, vp).phone).toBe("+919876543210");
  });

  it("leaves rider contact alone — delivery_users is not public and the app reads it", () => {
    const plan = planPartnerSeal("rider", legacyRider);
    expect(plan.contactPatch).toEqual({});
    expect(plan.publicDelete).not.toContain("email");
    expect(plan.publicDelete).toEqual(expect.arrayContaining(["bank.account", "bank.ifsc", "bank.upiId"]));
    expect(leaksAccount(applyPublic(legacyRider, plan))).toBe(false);
    expect(plan.privatePatch.bank).toMatchObject({ accountNumber: ACCOUNT, vpa: "rider@upi" });
  });

  it("moves PAN but not GSTIN or FSSAI", () => {
    const pub = {
      kyc: { pan: "abcde1234f", gst: "32ABCDE1234F1Z5", fssai: "11223344556677" },
      kycDraft: { pan: "abcde1234f", fssai: "11223344556677", bankHolder: "A Owner" },
    };
    const plan = planPartnerSeal("vendor", pub);
    const after = applyPublic(pub, plan);

    expect(plan.privatePatch.identity).toEqual({ pan: "ABCDE1234F" });
    expect(JSON.stringify(after).toUpperCase()).not.toContain("ABCDE1234F\"");
    expect(after.kyc.pan).toBeUndefined();
    expect(after.kycDraft.pan).toBeUndefined();
    expect(after.kycDraft.bankHolder).toBeUndefined();
    expect(after.kyc.gst).toBe("32ABCDE1234F1Z5");
    expect(after.kycDraft.fssai).toBe("11223344556677");
  });

  it("moves the bank-registered name out of a penny-drop result", () => {
    const pub = {
      bank: {
        verificationState: "action_required",
        validationResult: { status: "completed", accountStatus: "active", registeredName: "RAJESH KUMAR" },
      },
    };
    const plan = planPartnerSeal("vendor", pub);
    const after = applyPublic(pub, plan);
    expect(JSON.stringify(after)).not.toContain("RAJESH");
    expect(after.bank.validationResult.accountStatus).toBe("active");
    expect(plan.privatePatch.legacy.bank.registeredName).toBe("RAJESH KUMAR");
  });

  it("redacts risk flags that quoted the holder name or other partners' ids", () => {
    const pub = {
      riskFlags: [
        'Holder name "Rajesh Kumar" does not match "Kada Foods" (similarity 0).',
        "Bank account already used by: restaurants(r1,r2)",
        "Manual review requested",
      ],
    };
    const plan = planPartnerSeal("vendor", pub);
    const after = applyPublic(pub, plan);

    expect(after.riskFlags).toEqual([REDACTED_HOLDER_FLAG, REDACTED_DUPLICATE_FLAG, "Manual review requested"]);
    expect(JSON.stringify(after)).not.toMatch(/Rajesh|r1,r2/);
    expect(plan.privatePatch.legacy.riskFlags).toHaveLength(2);
    expect(redactRiskFlag(REDACTED_HOLDER_FLAG)).toBe(REDACTED_HOLDER_FLAG);
  });

  it("is idempotent — a sealed doc plans to nothing", () => {
    for (const [role, pub] of [
      ["vendor", engineVendor],
      ["host", legacyHost],
      ["rider", legacyRider],
    ] as const) {
      const plan = planPartnerSeal(role, pub);
      const sealedPub = applyPublic(pub, plan);
      const sealedPriv = mergeDeep({}, plan.privatePatch);
      expect(planPartnerSeal(role, sealedPub, sealedPriv).needed, role).toBe(false);
    }
  });

  it("does nothing to a clean listing", () => {
    const clean = {
      name: "Kada Foods",
      phone: "+919876543210",
      upiId: "kadafoods@okaxis",
      bank: { verificationState: "verified", accountMasked: "••••6789", ifscBank: "HDFC" },
      riskFlags: [],
    };
    expect(planPartnerSeal("vendor", clean).needed).toBe(false);
  });

  it("drops a non-map bank value rather than leaving it public", () => {
    const pub = { bank: ACCOUNT };
    const plan = planPartnerSeal("vendor", pub);
    expect(plan.publicDelete).toEqual(["bank"]);
    expect(applyPublic(pub, plan).bank).toBeUndefined();
  });

  it("never emits overlapping update paths (Firestore rejects a path and its prefix together)", () => {
    const fixtures: [Parameters<typeof planPartnerSeal>[0], Doc][] = [
      ["vendor", engineVendor],
      ["host", legacyHost],
      ["rider", legacyRider],
      ["vendor", { bank: "junk", kyc: { bank: { account: ACCOUNT, ifsc: IFSC } } }],
      ["vendor", { bank: { holder: "X", validationResult: { registeredName: "Y" } }, riskFlags: ["Holder name \"X\" does not match \"Z\""] }],
    ];
    for (const [role, pub] of fixtures) {
      const plan = planPartnerSeal(role, pub);
      const paths = [...plan.publicDelete, ...Object.keys(plan.publicSet)];
      for (const a of paths) {
        for (const b of paths) {
          if (a === b) continue;
          expect(b.startsWith(`${a}.`), `${a} overlaps ${b}`).toBe(false);
        }
      }
      expect(new Set(paths).size).toBe(paths.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fingerprints — duplicate detection without a reversible hash
// ─────────────────────────────────────────────────────────────────────────

describe("bank fingerprints", () => {
  const key = Buffer.alloc(32, 7);

  it("is stable for the same key and details", () => {
    expect(computeBankFingerprint(key, ACCOUNT, IFSC)).toBe(computeBankFingerprint(key, ACCOUNT, IFSC));
    expect(computeBankFingerprint(key, ACCOUNT, IFSC)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalises spacing, dashes and IFSC case", () => {
    expect(computeBankFingerprint(key, "5010 0123-456789", "hdfc0001234")).toBe(
      computeBankFingerprint(key, ACCOUNT, IFSC),
    );
  });

  it("depends on the key", () => {
    expect(computeBankFingerprint(Buffer.alloc(32, 8), ACCOUNT, IFSC)).not.toBe(
      computeBankFingerprint(key, ACCOUNT, IFSC),
    );
  });

  it("is not a plain hash anyone could recompute", () => {
    const fp = computeBankFingerprint(key, ACCOUNT, IFSC);
    expect(fp).not.toBe(createHash("sha256").update(`${ACCOUNT}|${IFSC}`).digest("hex"));
    expect(fp.startsWith(bankDetailsHash({ accountNumber: ACCOUNT, ifsc: IFSC }))).toBe(false);
  });

  it("refuses incomplete details instead of fingerprinting an empty string", () => {
    expect(computeBankFingerprint(key, "", IFSC)).toBe("");
    expect(computeBankFingerprint(key, ACCOUNT, "")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Resolution — the one precedence order every server reader uses
// ─────────────────────────────────────────────────────────────────────────

describe("bank detail resolution", () => {
  it("prefers the private record over any public blob", () => {
    const d = resolveBankDetails(
      { bank: { accountNumber: "999988887777", ifsc: "ICIC0000001", holder: "P" } },
      engineVendor,
    );
    expect(d).toMatchObject({ accountNumber: "999988887777", source: "private" });
  });

  it("falls back through the legacy shapes in order", () => {
    expect(resolveBankDetails(undefined, legacyHost)?.source).toBe("kyc.bank");
    expect(resolveBankDetails(undefined, { payoutAccount: legacyHost.payoutAccount, bankDetails: { accountNumber: ACCOUNT, ifsc: IFSC } })?.source).toBe("payoutAccount");
    expect(resolveBankDetails(undefined, { bankDetails: { accountNumber: ACCOUNT, ifsc: IFSC } })?.source).toBe("bankDetails");
  });

  it("reads the rider `bank.account` shape and skips incomplete candidates", () => {
    expect(resolveBankDetails(undefined, legacyRider)).toMatchObject({ accountNumber: ACCOUNT, vpa: "rider@upi" });
    expect(
      resolveBankDetails({ bank: { holder: "only a name" } }, { kyc: { bank: { account: ACCOUNT, ifsc: IFSC } } })?.source,
    ).toBe("kyc.bank");
    expect(resolveBankDetails({}, { bank: { verificationState: "verified" } })).toBeNull();
  });

  it("only falls back to the shop's customer UPI when asked", () => {
    const pub = { upiId: "shop@okaxis" };
    expect(resolvePayoutVpa({}, pub)).toBe("");
    expect(resolvePayoutVpa({}, pub, { allowListingUpi: true })).toBe("shop@okaxis");
    expect(resolvePayoutVpa({ payoutVpa: "owner@upi" }, pub, { allowListingUpi: true })).toBe("owner@upi");
  });

  it("prefers the private contact and keeps the public shop phone", () => {
    expect(resolveContact({ email: "p@example.com", ownerPhone: "+91900" }, { email: "old@example.com", phone: "+91800" })).toEqual({
      email: "p@example.com",
      phone: "+91800",
    });
    expect(resolveContact({ ownerPhone: "+91900" }, {})).toEqual({ phone: "+91900" });
  });
});

describe("new bank submissions", () => {
  it("puts nothing identifying in the public half, and no undefined values in either", () => {
    const record: BankRecord = {
      holder: "Kada Foods",
      accountNumber: ACCOUNT,
      ifsc: IFSC,
      vpa: undefined,
      verificationState: "pending_verification",
      detailsHash: bankDetailsHash({ accountNumber: ACCOUNT, ifsc: IFSC }),
      nameMatch: undefined,
    };
    const { privateBank, publicBank } = splitBankRecord(record);

    expect(leaksAccount(publicBank)).toBe(false);
    expect(publicBank).toEqual({
      verificationState: "pending_verification",
      accountMasked: "••••6789",
      ifscBank: "HDFC",
    });
    expect(privateBank).toMatchObject({ accountNumber: ACCOUNT, ifsc: IFSC, holder: "Kada Foods" });
    // The Admin SDK throws on undefined (ignoreUndefinedProperties is off).
    for (const half of [privateBank, publicBank]) {
      expect(Object.values(half).every((v) => v !== undefined)).toBe(true);
    }
  });

  it("summarises an account as last four + bank code only", () => {
    expect(publicBankSummary({ accountNumber: ACCOUNT, ifsc: "icic0000001" })).toEqual({
      accountMasked: "••••6789",
      ifscBank: "ICIC",
    });
    expect(publicBankSummary({})).toEqual({ accountMasked: "", ifscBank: null });
  });
});

describe("private record ownership", () => {
  it("lets an outlet's parent and the recorded owner read a vendor record", () => {
    expect(ownerUidsOf("vendor", "outlet1", { parentId: "parent1", ownerId: "owner1" }).sort()).toEqual(
      ["outlet1", "owner1", "parent1"].sort(),
    );
  });

  it("does not let a host or rider doc name extra owners", () => {
    expect(ownerUidsOf("host", "h1", { ownerId: "someone-else" })).toEqual(["h1"]);
    expect(ownerUidsOf("rider", "u1", { parentId: "x" })).toEqual(["u1"]);
  });
});
