/**
 * ─────────────────────────────────────────────────────────────────────────
 * Reads a partner's uploaded KYC document with Gemini and returns the fields
 * documentChecks.ts decides on.
 *
 * The reader only EXTRACTS. It never decides whether a document is good —
 * that stays in the pure, tested rules, so a model quirk can't wave anything
 * through. A government-API provider can later confirm the extracted numbers
 * exist (see VERIFICATION_PROVIDER below).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions";
import type { DocumentReading, ReadableStep } from "./documentChecks";

/** What to pull out of each document type, described to the model. */
const FIELDS: Record<ReadableStep, { document: string; fields: Record<string, string> }> = {
  pan: {
    document: "an Indian PAN card (Income Tax Department permanent account number card)",
    fields: {
      panNumber: "the 10-character PAN, e.g. ABCPE1234F",
      name: "the card holder's name exactly as printed",
      fatherName: "father's name if printed, else null",
      dateOfBirth: "date of birth or incorporation as printed, else null",
    },
  },
  gst_certificate: {
    document: "an Indian GST registration certificate (Form GST REG-06)",
    fields: {
      gstin: "the 15-character GSTIN",
      legalName: "Legal Name of Business",
      tradeName: "Trade Name, if any, else null",
      address: "Address of Principal Place of Business",
    },
  },
  fssai: {
    document:
      "an Indian FSSAI food licence or registration certificate, or an FSSAI application acknowledgement",
    fields: {
      licenceNumber: "the 14-digit licence/registration number, or the application reference number",
      businessName: "name of the food business operator",
      address: "premises address",
      validUpto: "expiry / valid-upto date as printed, else null",
    },
  },
  bank_proof: {
    document: "an Indian cancelled cheque, bank passbook first page, or bank statement header",
    fields: {
      accountNumber: "the full bank account number, digits only",
      ifsc: "the 11-character IFSC code",
      holderName: "the account holder's name as printed",
      bankName: "the bank's name",
    },
  },
  owner_identity: {
    document: "an Indian identity document: Aadhaar card, voter ID, passport or driving licence",
    fields: {
      idType: "one of: aadhaar, voter_id, passport, driving_licence, other",
      idNumber: "the document number",
      name: "the holder's name as printed",
      dateOfBirth: "date of birth as printed, else null",
    },
  },
  driving_licence: {
    document: "an Indian driving licence",
    fields: {
      licenceNumber: "the driving licence number",
      name: "holder's name",
      validUpto: "non-transport validity / expiry date as printed, else null",
      vehicleClasses: "authorised vehicle classes, e.g. MCWG, LMV, comma separated",
    },
  },
  vehicle_rc: {
    document: "an Indian vehicle registration certificate (RC)",
    fields: {
      registrationNumber: "vehicle registration number, e.g. KL07CD1234",
      ownerName: "registered owner's name",
      vehicleClass: "vehicle class / body type",
      fuelType: "fuel type if printed, else null",
    },
  },
  vehicle_insurance: {
    document: "an Indian motor vehicle insurance policy or certificate",
    fields: {
      policyNumber: "policy number",
      registrationNumber: "vehicle registration number covered",
      validUpto: "policy end / expiry date as printed",
    },
  },
};

/**
 * Which extra verifier confirms extracted numbers against government records.
 * "none" today; when a provider (Surepass, IDfy, Cashfree) is contracted, set
 * `config/onboarding_verification.provider` and implement it here.
 */
export type VerificationProvider = "none" | "surepass" | "idfy" | "cashfree";

export async function readDocument(args: {
  apiKey: string;
  stepId: ReadableStep;
  bytes: Buffer;
  mimeType: string;
}): Promise<DocumentReading> {
  const spec = FIELDS[args.stepId];
  const fieldList = Object.entries(spec.fields)
    .map(([k, v]) => `  "${k}": ${v}`)
    .join(",\n");

  const instruction = `You read identity and business documents for a food and hospitality marketplace in India.
The user uploaded what should be ${spec.document}.

Return ONLY a JSON object:
{
  "readable": true if this is a legible ${spec.document}, false if it is blurry, cropped, a different document, or not a document,
  "documentKind": a short snake_case name for what the image actually is (e.g. "pan_card", "cancelled_cheque", "aadhaar_card", "selfie", "menu"),
  "confidence": number from 0 to 1 — how sure you are that every extracted value is exactly right,
  "fields": {
${fieldList}
  }
}

Rules:
- Copy values exactly as printed. Never guess, infer or complete a partly hidden value — use null instead.
- If a field is not on the document, use null.
- Dates: copy as printed.
- Do not wrap the JSON in markdown.`;

  const ai = new GoogleGenAI({ apiKey: args.apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { inlineData: { data: args.bytes.toString("base64"), mimeType: args.mimeType } },
      { text: "Read this document." },
    ],
    config: { systemInstruction: instruction, temperature: 0, responseMimeType: "application/json" },
  });

  try {
    // JSON mode normally returns bare JSON; tolerate a markdown fence anyway
    // so a formatting quirk can't turn a good PAN into "unreadable".
    const raw = (response.text ?? "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as Omit<Partial<DocumentReading>, "readable"> & { readable?: unknown };
    const fields: Record<string, string | null> = {};
    for (const key of Object.keys(spec.fields)) {
      const v = (parsed.fields as Record<string, unknown> | undefined)?.[key];
      fields[key] = v === null || v === undefined ? null : String(v).slice(0, 200);
    }
    const confidence = Number(parsed.confidence);
    const reading: DocumentReading = {
      readable: parsed.readable === true || parsed.readable === "true",
      documentKind: typeof parsed.documentKind === "string" ? parsed.documentKind.slice(0, 40) : null,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      fields,
    };
    // One plain line per read, so why a document was accepted or refused is
    // visible in `firebase functions:log` (no document numbers logged).
    logger.info(`documentReader: step=${args.stepId} kind=${reading.documentKind ?? "?"} readable=${reading.readable} confidence=${reading.confidence.toFixed(2)} mime=${args.mimeType}`);
    return reading;
  } catch (e) {
    logger.warn("documentReader: unparseable model response", { stepId: args.stepId, error: String(e) });
    return { readable: false, documentKind: null, confidence: 0, fields: {} };
  }
}
