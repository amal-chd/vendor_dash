import { describe, expect, it } from "vitest";
import {
  assessDocument,
  gstinCheckChar,
  isValidAadhaar,
  isValidDrivingLicence,
  isValidFssaiLicence,
  isValidGstin,
  isValidPan,
  isValidVehicleRegistration,
  maskAadhaar,
  panFitsStructure,
  panHolderType,
  panOfGstin,
  parseDocumentDate,
  type DocumentReading,
} from "../src/onboarding/documentChecks";

const NOW = Date.UTC(2026, 8, 17);
const read = (fields: DocumentReading["fields"], extra: Partial<DocumentReading> = {}): DocumentReading => ({
  readable: true,
  confidence: 0.95,
  fields,
  ...extra,
});

// Verhoeff check digit generator, to build valid-looking Aadhaar numbers.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
function withVerhoeff(first11: string): string {
  let c = 0;
  const digits = first11.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[(i + 1) % 8][digits[i]]];
  return first11 + INV[c];
}
const gstin = (first14: string) => first14 + gstinCheckChar(first14);

describe("format validators", () => {
  it("PAN format and holder type", () => {
    expect(isValidPan("abcpe1234f")).toBe(true);
    expect(isValidPan("ABCPE12345")).toBe(false);
    expect(panHolderType("ABCPE1234F")).toBe("individual");
    expect(panHolderType("AAACK1234Q")).toBe("company");
    expect(panFitsStructure("ABCPE1234F", "sole_proprietor")).toBe(true);
    expect(panFitsStructure("AAACK1234Q", "sole_proprietor")).toBe(false);
    expect(panFitsStructure("AAAFK1234Q", "partnership")).toBe(true);
    expect(panFitsStructure("ABCPE1234F", undefined)).toBeNull();
  });

  it("GSTIN checksum, state code and embedded PAN", () => {
    const g = gstin("32ABCPE1234F1Z");
    expect(isValidGstin(g)).toBe(true);
    expect(isValidGstin(g.slice(0, 14) + (g[14] === "A" ? "B" : "A"))).toBe(false);
    expect(isValidGstin("99ABCPE1234F1Z" + gstinCheckChar("99ABCPE1234F1Z"))).toBe(false);
    expect(panOfGstin(g)).toBe("ABCPE1234F");
  });

  it("FSSAI, Aadhaar, driving licence, vehicle registration", () => {
    expect(isValidFssaiLicence("11323999000123")).toBe(true);
    expect(isValidFssaiLicence("1132399900012")).toBe(false);
    const aadhaar = withVerhoeff("23456789012");
    expect(isValidAadhaar(aadhaar)).toBe(true);
    expect(isValidAadhaar(aadhaar.slice(0, 11) + ((Number(aadhaar[11]) + 1) % 10))).toBe(false);
    expect(maskAadhaar(aadhaar)).toBe(`XXXX XXXX ${aadhaar.slice(-4)}`);
    expect(isValidDrivingLicence("KL07 20190012345")).toBe(true);
    expect(isValidDrivingLicence("KL07 1234")).toBe(false);
    expect(isValidVehicleRegistration("KL 07 CD 1234")).toBe(true);
    expect(isValidVehicleRegistration("22 BH 1234 AA")).toBe(true);
    expect(isValidVehicleRegistration("K07CD12")).toBe(false);
  });

  it("parses the date formats on Indian documents", () => {
    expect(parseDocumentDate("31/12/2027")).toBe(Date.UTC(2027, 11, 31));
    expect(parseDocumentDate("2027-12-31")).toBe(Date.UTC(2027, 11, 31));
    expect(parseDocumentDate("31 Dec 2027")).toBe(Date.UTC(2027, 11, 31));
    expect(parseDocumentDate("31-DEC-2027")).toBe(Date.UTC(2027, 11, 31));
    expect(parseDocumentDate("31/02/2027")).toBeNull();
    expect(parseDocumentDate("soon")).toBeNull();
  });
});

describe("assessDocument", () => {
  it("auto-verifies a clean PAN that fits the business type", () => {
    const v = assessDocument("pan", read({ panNumber: "ABCPE 1234 F", name: "Amal Chand" }), { now: NOW, businessStructure: "sole_proprietor" });
    expect(v.status).toBe("auto_verified");
    expect(v.documentNumber).toBe("ABCPE1234F");
    expect(v.issues).toEqual([]);
  });

  it("sends a PAN whose type doesn't fit the business to review", () => {
    const v = assessDocument("pan", read({ panNumber: "AAACK1234Q", name: "Kada Foods" }), { now: NOW, businessStructure: "sole_proprietor" });
    expect(v.status).toBe("needs_review");
  });

  it("asks for a retake when the document can't be read or isn't a PAN", () => {
    expect(assessDocument("pan", { readable: false, confidence: 0.2, fields: {} }, { now: NOW }).status).toBe("retake");
    expect(assessDocument("pan", read({ panNumber: "HELLO" }), { now: NOW }).status).toBe("retake");
  });

  it("sends low-confidence readings to a person even when valid", () => {
    const v = assessDocument("pan", read({ panNumber: "ABCPE1234F", name: "Amal" }, { confidence: 0.5 }), { now: NOW });
    expect(v.status).toBe("needs_review");
  });

  it("checks a GST certificate against the partner's PAN and name", () => {
    const ok = assessDocument("gst_certificate", read({ gstin: gstin("32ABCPE1234F1Z"), legalName: "AMAL CHAND" }),
      { now: NOW, panNumber: "ABCPE1234F", legalName: "Amal Chand" });
    expect(ok.status).toBe("auto_verified");
    const otherPan = assessDocument("gst_certificate", read({ gstin: gstin("32ZZZPE9999F1Z"), legalName: "AMAL CHAND" }),
      { now: NOW, panNumber: "ABCPE1234F", legalName: "Amal Chand" });
    expect(otherPan.status).toBe("needs_review");
    expect(otherPan.issues.join(" ")).toMatch(/different PAN/);
  });

  it("FSSAI: valid licence passes, expired asks for renewal, application goes to review", () => {
    expect(assessDocument("fssai", read({ licenceNumber: "11323999000123", validUpto: "31/12/2028" }), { now: NOW }).status).toBe("auto_verified");
    const expired = assessDocument("fssai", read({ licenceNumber: "11323999000123", validUpto: "01/01/2025" }), { now: NOW });
    expect(expired.status).toBe("retake");
    expect(expired.issues[0]).toMatch(/expired on 01\/01\/2025/);
    expect(assessDocument("fssai", read({ licenceNumber: "20260917123456789" }), { now: NOW }).status).toBe("needs_review");
    expect(assessDocument("fssai", read({ licenceNumber: "11323999000123" }), { now: NOW }).status).toBe("needs_review");
  });

  it("bank proof must match the account the partner typed", () => {
    const bank = { accountNumber: "50100123456789", ifsc: "HDFC0001234", holder: "Amal Chand" };
    expect(assessDocument("bank_proof", read({ accountNumber: "5010 0123 4567 89", ifsc: "hdfc0001234", holderName: "AMAL CHAND" }), { now: NOW, bank }).status)
      .toBe("auto_verified");
    const wrong = assessDocument("bank_proof", read({ accountNumber: "50100999999999", ifsc: "HDFC0001234", holderName: "AMAL CHAND" }), { now: NOW, bank });
    expect(wrong.status).toBe("needs_review");
    expect(wrong.fields.accountLast4).toBe("9999");
  });

  it("stores only the last four Aadhaar digits", () => {
    const aadhaar = withVerhoeff("23456789012");
    const v = assessDocument("owner_identity", read({ idNumber: aadhaar, name: "Amal Chand" }, { documentKind: "aadhaar" }),
      { now: NOW, legalName: "Amal Chand" });
    expect(v.status).toBe("auto_verified");
    expect(v.fields.idNumber).toBe(`XXXX XXXX ${aadhaar.slice(-4)}`);
    expect(JSON.stringify(v)).not.toContain(aadhaar);
  });

  it("driving licence: format, expiry and name", () => {
    const ok = assessDocument("driving_licence", read({ licenceNumber: "KL0720190012345", name: "Rahul K", validUpto: "12/03/2040" }),
      { now: NOW, legalName: "Rahul K" });
    expect(ok.status).toBe("auto_verified");
    expect(ok.expiresAt).toBe(Date.UTC(2040, 2, 12));
    expect(assessDocument("driving_licence", read({ licenceNumber: "KL0720190012345", name: "Rahul K", validUpto: "12/03/2020" }), { now: NOW }).status)
      .toBe("retake");
  });

  it("vehicle RC accepts a family member as owner", () => {
    const v = assessDocument("vehicle_rc", read({ registrationNumber: "KL07CD1234", ownerName: "Krishnan K" }), { now: NOW, legalName: "Rahul K" });
    expect(v.status).toBe("auto_verified");
  });
});

describe("unreadable uploads say what went wrong", () => {
  it("tells the partner when the photo isn't the document at all", () => {
    const v = assessDocument("pan", { readable: false, documentKind: "landscape_photo", confidence: 0.1, fields: {} }, {});
    expect(v.status).toBe("retake");
    expect(v.issues[0]).toMatch(/doesn't look like your PAN card/);
  });

  it("asks for a clearer photo when it is the right document but unreadable", () => {
    const v = assessDocument("pan", { readable: false, documentKind: "pan_card", confidence: 0.2, fields: {} }, {});
    expect(v.issues[0]).toMatch(/couldn't read this document/);
  });
});
