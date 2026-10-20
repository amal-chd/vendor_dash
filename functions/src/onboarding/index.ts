/**
 * ─────────────────────────────────────────────────────────────────────────
 * Onboarding callables — the API surface for partner apps and the admin
 * console. Clients never write `onboarding.*` directly (Firestore rules
 * block it); every mutation lands here so the state machine, gates and
 * audit trail cannot be bypassed.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  type PartnerRole,
  type OnboardingRecord,
  PARTNER_ROLES,
  ROLE_COLLECTION,
  isOnboardingState,
} from "./stateMachine";
import {
  resolveRequirements,
  completionPercent,
  missingMandatorySteps,
} from "./kycRules";
import {
  evaluateGate,
  loadRequirementOverrides,
  documentsExpiringWithin,
} from "./activationGate";
import {
  transitionPartner,
  setStepComplete,
  activationBlockers,
  applicantContextOf,
} from "./transition";
import {
  BANK_STATES,
  buildPendingBankRecord,
  validateBankDetails,
  maskAccount,
} from "./bankVerification";
import {
  REDACTED_DUPLICATE_FLAG,
  REDACTED_HOLDER_FLAG,
  SENSITIVE_BANK_KEYS,
  findDuplicateBankAccounts,
  fingerprintBank,
  ownerUidsOf,
  readPartnerWithPrivate,
  resolveBankDetails,
  splitBankRecord,
} from "./partnerPrivate";
import { resolveZoneForPoint, stampZone } from "../zones";
import { logger } from "firebase-functions";
import { GEMINI_API_KEY } from "../ai";
import { enforceRateLimit } from "../rateLimit";
import { assessDocument, isReadableStep, type CheckContext, type DocumentVerdict } from "./documentChecks";
import { readDocument } from "./documentReader";
import { runAutoProgress } from "./autoProgress";
import { grandfatherIfLegacyLive } from "./backfill";

function str(v: unknown, max = 500): string {
  return (v ?? "").toString().trim().slice(0, max);
}

function assertRole(v: unknown): PartnerRole {
  const r = str(v, 20) as PartnerRole;
  if (!PARTNER_ROLES.includes(r)) {
    throw new HttpsError("invalid-argument", `Unknown partner role "${r}".`);
  }
  return r;
}

function requireAuth(request: any): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  return uid;
}

function isAdmin(request: any): boolean {
  const t = request.auth?.token ?? {};
  return Boolean(t.admin || t.platformAdmin || t.adminRole);
}

/**
 * Returns the applicant's resolved requirement set + progress. This is what
 * the partner app renders its wizard from — the app does NOT hardcode its
 * own step list, so admin requirement changes take effect without a release.
 */
export const getOnboardingState = onCall(async (request) => {
  const uid = requireAuth(request);
  const role = assertRole(request.data?.role);
  const partnerId = str(request.data?.partnerId, 128) || uid;

  // A non-admin may only read their own onboarding record.
  if (partnerId !== uid && !isAdmin(request)) {
    throw new HttpsError("permission-denied", "Cannot read another partner's onboarding.");
  }

  // A partner who was live before the engine is recognised as live, not
  const { exists, data, priv, ref } = await readPartnerWithPrivate(role, partnerId);
  const canonicalPartnerId = exists ? ref.id : partnerId;

  // A partner who was live before the engine is recognised as live, not
  // restarted as an applicant (and one an older wizard flipped is repaired).
  await grandfatherIfLegacyLive(role, canonicalPartnerId);

  if (!exists) {
    return { exists: false, state: null, requirements: [], completion: 0, partnerId: canonicalPartnerId };
  }

  const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
  const overrides = await loadRequirementOverrides();
  const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);
  // Details come from the private store. This response only ever goes to the
  // partner themselves or an admin (checked above).
  const details = resolveBankDetails(priv, data);

  return {
    exists: true,
    partnerId: canonicalPartnerId,
    state: isOnboardingState(ob.state) ? ob.state : "started",
    role,
    businessStructure: ob.businessStructure ?? null,
    steps: ob.steps ?? {},
    requirements: reqs,
    completion: completionPercent(reqs, ob.steps),
    missing: missingMandatorySteps(reqs, ob.steps).map((r) => ({
      id: r.id,
      label: r.label,
      group: r.group,
    })),
    zoneId: ob.zoneId ?? null,
    marketId: ob.marketId ?? null,
    blockingReasons: ob.blockingReasons ?? [],
    bank:
      data.bank || details
        ? {
            state: data.bank?.verificationState ?? BANK_STATES.NOT_ADDED,
            holder: details?.holder || null,
            accountMasked: data.bank?.accountMasked || maskAccount(details?.accountNumber),
            ifsc: details?.ifsc ?? null,
            message: data.bank?.verificationMessage ?? null,
            nameMatch: data.bank?.nameMatch ?? null,
          }
        : { state: BANK_STATES.NOT_ADDED },
    documentsExpiringSoon: documentsExpiringWithin(data.documents, reqs, 30),
    // What the automatic checks concluded, per document, and why a partner
    // is waiting — the app shows these instead of a generic "under review".
    checks: {
      documents: data.onboardingChecks?.documents ?? {},
      review: data.onboardingChecks?.review ?? null,
      bankProofNeeded: data.onboardingChecks?.bankProofNeeded === true,
      identityCheckNeeded: data.onboardingChecks?.identityCheckNeeded === true,
    },
    // The partner's own extracted document numbers, to show on their resumed form.
    documentNumbers: Object.fromEntries(
      Object.entries((priv.verifications ?? {}) as Record<string, { documentNumber?: string | null }>)
        .map(([k, v]) => [k, v?.documentNumber ?? null]),
    ),
  };
});

/** Marks one onboarding step complete/incomplete. Applicant-facing. */
export const submitOnboardingStep = onCall(async (request) => {
  const uid = requireAuth(request);
  const role = assertRole(request.data?.role);
  const partnerId = str(request.data?.partnerId, 128) || uid;
  const stepId = str(request.data?.stepId, 64);
  const complete = request.data?.complete !== false;

  if (partnerId !== uid && !isAdmin(request)) {
    throw new HttpsError("permission-denied", "Cannot edit another partner's onboarding.");
  }
  if (!stepId) throw new HttpsError("invalid-argument", "stepId is required.");

  const { ref, exists } = await readPartnerWithPrivate(role, partnerId);
  const canonicalPartnerId = exists ? ref.id : partnerId;

  // Already live before the engine: nothing to fill in, and ticking a step
  // must never restart them as an applicant.
  if (await grandfatherIfLegacyLive(role, canonicalPartnerId)) {
    return { completion: 100, state: "active", alreadyLive: true, partnerId: canonicalPartnerId };
  }

  const result = await setStepComplete(role, canonicalPartnerId, stepId, complete, uid);
  // The last step may complete onboarding: check whether the partner can go live.
  const decision = await runAutoProgress(role, canonicalPartnerId, `step:${stepId}`).catch((e) => {
    logger.warn(`submitOnboardingStep: auto-progress failed for ${role}/${canonicalPartnerId}`, e);
    return { kind: "none" as const };
  });
  return { ...result, decision, partnerId: canonicalPartnerId };
});

/** Applicant declares onboarding done → moves into the ops review queue. */
export const submitOnboarding = onCall(async (request) => {
  const uid = requireAuth(request);
  const role = assertRole(request.data?.role);
  const partnerId = str(request.data?.partnerId, 128) || uid;

  if (partnerId !== uid && !isAdmin(request)) {
    throw new HttpsError("permission-denied", "Cannot submit another partner's onboarding.");
  }

  const { ref, exists, data } = await readPartnerWithPrivate(role, partnerId);
  if (!exists) throw new HttpsError("not-found", "Partner not found.");
  const canonicalPartnerId = ref.id;
  const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
  const overrides = await loadRequirementOverrides();
  const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);
  const missing = missingMandatorySteps(reqs, ob.steps);

  if (missing.length > 0) {
    throw new HttpsError(
      "failed-precondition",
      `Complete these first: ${missing.map((m) => m.label).join(", ")}.`,
    );
  }

  const decision = await runAutoProgress(role, canonicalPartnerId, "submit");
  const after = await admin.firestore().collection(ROLE_COLLECTION[role]).doc(canonicalPartnerId).get();
  const state = (after.data()?.onboarding?.state ?? "submitted") as string;
  if (decision.kind === "none" && !["submitted", "active"].includes(state)) {
    // Automation had nothing to act on (e.g. already reviewed): fall back to the queue.
    return transitionPartner({
      role,
      partnerId: canonicalPartnerId,
      to: "submitted",
      actor: "applicant",
      actorId: uid,
      reason: "Applicant submitted onboarding for review",
    });
  }
  return { to: state, decision, partnerId: canonicalPartnerId };
});

/**
 * Collects bank details. ALWAYS lands in `pending_verification` — the client
 * cannot self-declare verified. Runs duplicate + name-match checks and flags
 * for review rather than silently accepting a mismatch.
 */
export const submitBankDetails = onCall(async (request) => {
  const uid = requireAuth(request);
  const role = assertRole(request.data?.role);
  const partnerId = str(request.data?.partnerId, 128) || uid;

  if (partnerId !== uid && !isAdmin(request)) {
    throw new HttpsError("permission-denied", "Cannot edit another partner's banking.");
  }

  const holder = str(request.data?.holder, 140);
  const accountNumber = str(request.data?.accountNumber, 32);
  const ifsc = str(request.data?.ifsc, 16);
  const vpa = str(request.data?.vpa, 120);

  const validation = validateBankDetails({ holder, accountNumber, ifsc });
  if (!validation.valid) {
    throw new HttpsError("invalid-argument", validation.errors.join(" "));
  }

  const { ref, privateRef, exists, data, priv } = await readPartnerWithPrivate(role, partnerId);
  if (!exists) throw new HttpsError("not-found", "Partner not found.");
  const canonicalPartnerId = ref.id;

  // Compare the holder name against the strongest legal name we hold.
  const legalName =
    str(data.legalName, 140) ||
    str(data.ownerName, 140) ||
    str(data.name, 140);

  const record = buildPendingBankRecord({
    holder,
    accountNumber,
    ifsc,
    vpa: vpa || undefined,
    legalName: legalName || undefined,
  });

  // Full details → partner_private; the partner doc gets state + a masked
  // summary. (Spreading the whole record also used to write `vpa: undefined`,
  // which the Admin SDK rejects.)
  const { privateBank, publicBank } = splitBankRecord(record);

  // Duplicate detection across every role, by keyed fingerprint.
  const fp = await fingerprintBank(record.accountNumber, record.ifsc);
  const duplicates = fp
    ? await findDuplicateBankAccounts(fp.bankFingerprint, { role, partnerId: canonicalPartnerId })
    : [];

  // riskFlags sit on the world-readable doc, so they name no one; the
  // specifics go to the private record for reviewers.
  const flags: string[] = [];
  if (duplicates.length > 0) flags.push(REDACTED_DUPLICATE_FLAG);
  if (record.nameMatch && !record.nameMatch.matched) flags.push(REDACTED_HOLDER_FLAG);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const del = admin.firestore.FieldValue.delete();
  // New details invalidate the RazorpayX objects and verdict built for the
  // old ones — reusing the old fund account would penny-drop the wrong account.
  const detailsChanged = str(priv.bank?.detailsHash, 64) !== record.detailsHash;

  const batch = admin.firestore().batch();
  batch.set(
    privateRef,
    {
      role,
      partnerId: canonicalPartnerId,
      ownerUids: ownerUidsOf(role, canonicalPartnerId, data),
      bank: {
        ...privateBank,
        review: {
          duplicates,
          holderMatched: record.nameMatch?.matched ?? null,
          holderComparedTo: record.nameMatch?.comparedTo ?? null,
          holderScore: record.nameMatch?.score ?? null,
        },
        ...(detailsChanged
          ? {
              razorpayFundAccountId: del,
              validationId: del,
              validationStartedAt: del,
              validationResult: del,
              registeredName: del,
              verificationDetail: del,
              migratedFrom: del,
            }
          : {}),
      },
      ...(fp ?? {}),
      updatedAt: now,
    },
    { merge: true },
  );
  batch.set(
    ref,
    {
      bank: {
        // Legacy engine writes put full details here; clear them.
        ...Object.fromEntries(SENSITIVE_BANK_KEYS.map((k) => [k, del])),
        ...publicBank,
        verificationMessage: flags.length
          ? "Awaiting manual review — see risk flags."
          : "Awaiting verification.",
        ...(detailsChanged ? { validationResult: del, bankNameMatch: del } : {}),
      },
      riskFlags: flags.length ? admin.firestore.FieldValue.arrayUnion(...flags) : del,
    },
    { merge: true },
  );
  await batch.commit();

  // Mark the collection steps done; verification remains outstanding.
  await setStepComplete(role, canonicalPartnerId, "bank_holder", true, uid).catch(() => {});
  await setStepComplete(role, canonicalPartnerId, "bank_account", true, uid).catch(() => {});

  // Fire the penny-drop immediately so the partner is not waiting on an
  // admin to remember. Best-effort: if RazorpayX is not configured (or the
  // call fails) the account simply stays `pending_verification` and the
  // manual admin path still works — we never mark it verified by default.
  let pennyDrop: { started: boolean; reason?: string } = {
    started: false,
    reason: "Verification not started.",
  };
  try {
    // Lazy import: bankValidation declares RazorpayX secrets at module scope,
    // and a static import would register them as required deploy params for
    // every function in the codebase (blocking deploys until the secret is
    // set). Importing at call time keeps the dependency runtime-only, and the
    // module's own readCreds() try/catch reports "not configured" rather than
    // throwing when the secret is absent.
    const { startBankValidation } = await import("./bankValidation");
    pennyDrop = await startBankValidation(role, canonicalPartnerId);
  } catch (e) {
    console.error(`submitBankDetails: validation kickoff failed for ${role}/${canonicalPartnerId}`, e);
    pennyDrop = { started: false, reason: "Verification could not be started automatically." };
  }

  await ref.set({ onboardingChecks: { bankProofNeeded: !pennyDrop.started } }, { merge: true });
  await runAutoProgress(role, canonicalPartnerId, "bank").catch(() => {});

  return {
    state: record.verificationState,
    accountMasked: publicBank.accountMasked,
    bankProofNeeded: !pennyDrop.started,
    nameMatch: record.nameMatch ?? null,
    flags,
    validationStarted: pennyDrop.started,
    validationNote: pennyDrop.reason ?? null,
    partnerId: canonicalPartnerId,
  };
});

/**
 * Resolves + persists the applicant's zone from a pin drop.
 *
 * Delegates to the canonical `zones.ts` module (real polygon containment,
 * priority/area tie-breaking, zone cache) rather than re-deriving geography
 * here — the onboarding engine must agree with dispatch and pricing about
 * which zone a partner is in, and the only way to guarantee that is to ask
 * the same resolver.
 */
export const resolveOnboardingZone = onCall(async (request) => {
  const uid = requireAuth(request);
  const role = assertRole(request.data?.role);
  const partnerId = str(request.data?.partnerId, 128) || uid;
  const lat = Number(request.data?.lat);
  const lng = Number(request.data?.lng);

  if (partnerId !== uid && !isAdmin(request)) {
    throw new HttpsError("permission-denied", "Cannot edit another partner's location.");
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpsError("invalid-argument", "Valid lat/lng required.");
  }

  const { ref, exists, data } = await readPartnerWithPrivate(role, partnerId);
  if (!exists) throw new HttpsError("not-found", "Partner not found.");
  const canonicalPartnerId = ref.id;

  const point = { lat, lng };
  const { zone, nearest } = await resolveZoneForPoint(point);

  // stampZone respects a prior manual admin override, so a pin-drop by the
  // applicant can never silently undo an ops decision.
  const zoneId = await stampZone(ref, point, data);

  await ref.set(
    {
      location: point,
      zoneId: zoneId ?? null,
      zoneName: zone?.name ?? null,
      marketId: zone?.marketId ?? null,
      onboarding: {
        zoneId: zoneId ?? null,
        zoneName: zone?.name ?? null,
        marketId: zone?.marketId ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      serviceable: Boolean(zone),
    },
    { merge: true },
  );

  // Only a real containing zone satisfies the mandatory zone gate. Outside
  // coverage leaves the step open, so activation stays blocked until an
  // admin either extends the zone or records an explicit override.
  if (zoneId && zone) {
    await setStepComplete(role, canonicalPartnerId, "zone_assignment", true, uid).catch(() => {});
    await setStepComplete(role, canonicalPartnerId, "map_location", true, uid).catch(() => {});
  }

  return {
    zoneId: zoneId ?? null,
    zoneName: zone?.name ?? null,
    marketId: zone?.marketId ?? null,
    serviceable: Boolean(zone),
    nearest,
    partnerId: canonicalPartnerId,
    reason: zone
      ? `Zone "${zone.name}".`
      : "Location is outside every active service zone.",
  };
});

/** Read-only preview — used by the app to show the zone before committing. */
export const previewZone = onCall(async (request) => {
  requireAuth(request);
  const lat = Number(request.data?.lat);
  const lng = Number(request.data?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpsError("invalid-argument", "Valid lat/lng required.");
  }
  const { zone, nearest } = await resolveZoneForPoint({ lat, lng });
  return {
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
    marketId: zone?.marketId ?? null,
    serviceable: Boolean(zone),
    nearest,
  };
});

/** Admin: why is this partner blocked? Same source as the enforcement path. */
export const getActivationBlockers = onCall(async (request) => {
  requireAuth(request);
  if (!isAdmin(request)) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const role = assertRole(request.data?.role);
  const partnerId = str(request.data?.partnerId, 128);

  const snap = await admin
    .firestore()
    .collection(ROLE_COLLECTION[role])
    .doc(partnerId)
    .get();
  if (!snap.exists) throw new HttpsError("not-found", "Partner not found.");

  const data = snap.data() ?? {};
  const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
  const overrides = await loadRequirementOverrides();

  return {
    blockers: activationBlockers(role, data, ob, overrides),
    gate: await evaluateGate(role, partnerId),
  };
});

/**
 * Reads an uploaded KYC document, checks it, and records the verdict.
 *
 * The app uploads the file to `<collection>/<partnerId>/kyc/<step>.<ext>`
 * (Storage rules allow only the owner) and calls this. The server — never the
 * client — downloads it, has Gemini read it, runs the pure checks in
 * documentChecks.ts, pre-fills the numbers, marks the step, and re-evaluates
 * automatic go-live. Sensitive values (PAN, account digits) go only to the
 * private store; the partner doc gets the status and plain-language issues.
 */
export const readKycDocument = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 90, memory: "512MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const role = assertRole(request.data?.role);
    const partnerId = str(request.data?.partnerId, 128) || uid;
    if (partnerId !== uid && !isAdmin(request)) {
      throw new HttpsError("permission-denied", "Cannot upload documents for another partner.");
    }
    const stepId = str(request.data?.stepId, 64);
    const storagePath = str(request.data?.storagePath, 400);

    const { ref, privateRef, exists, data, priv } = await readPartnerWithPrivate(role, partnerId);
    if (!exists) throw new HttpsError("not-found", "Partner not found.");
    const canonicalPartnerId = ref.id;

    const folders = [`${ROLE_COLLECTION[role]}/${partnerId}/kyc/`];
    if (canonicalPartnerId !== partnerId) {
      folders.push(`${ROLE_COLLECTION[role]}/${canonicalPartnerId}/kyc/`);
    }
    // Riders who signed up on an older build uploaded their ID, PAN and RC
    // here; reading those saves them snapping the same card again.
    if (role === "rider") {
      folders.push(`rider_documents/${partnerId}/`);
      if (canonicalPartnerId !== partnerId) {
        folders.push(`rider_documents/${canonicalPartnerId}/`);
      }
    }
    if (!folders.some((f) => storagePath.startsWith(f)) || storagePath.includes("..")) {
      throw new HttpsError("invalid-argument", "Upload the document from the app, then try again.");
    }
    await enforceRateLimit(`kyc_read_${uid}`, 40, 60 * 60_000);

    const ob = (data.onboarding ?? {}) as Partial<OnboardingRecord>;
    const overrides = await loadRequirementOverrides();
    const reqs = resolveRequirements(role, applicantContextOf(data, ob), overrides);
    const req = reqs.find((r) => r.id === stepId);
    if (!req?.requiresDocument) {
      throw new HttpsError("invalid-argument", "This step doesn't take a document.");
    }

    const file = admin.storage().bucket().file(storagePath);
    const [present] = await file.exists();
    if (!present) throw new HttpsError("not-found", "The upload didn't finish. Please try again.");
    const [meta] = await file.getMetadata();
    if (Number(meta.size) > 15 * 1024 * 1024) {
      throw new HttpsError("invalid-argument", "That file is over 15 MB. Upload a smaller photo or PDF.");
    }
    const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeType =
      (meta.contentType && meta.contentType !== "application/octet-stream" ? meta.contentType : "") ||
      ({ pdf: "application/pdf", png: "image/png", heic: "image/heic", webp: "image/webp" } as Record<string, string>)[ext] ||
      "image/jpeg";

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docEntry: Record<string, unknown> = {
      path: storagePath,
      url: str(request.data?.url, 1500) || null,
      uploadedAt: now,
      uploadedBy: uid,
    };

    // Photos, menus: kept, not read.
    if (!req.autoVerify || !isReadableStep(stepId)) {
      await ref.set({
        documents: { [stepId]: docEntry },
        onboardingChecks: { documents: { [stepId]: { status: "auto_verified", issues: [], checkedAt: now, provider: "stored" } } },
      }, { merge: true });
      await setStepComplete(role, canonicalPartnerId, stepId, true, uid).catch(() => {});
      await runAutoProgress(role, canonicalPartnerId, `upload:${stepId}`).catch(() => {});
      return { status: "auto_verified", issues: [], fields: {}, documentNumber: null, expiresAt: null, partnerId: canonicalPartnerId };
    }

    await ref.set({
      onboardingChecks: { documents: { [stepId]: { status: "checking", issues: [], checkedAt: now } } },
    }, { merge: true });

    const verifications = (priv.verifications ?? {}) as Record<string, { status?: string; fields?: Record<string, string> }>;
    const bank = resolveBankDetails(priv, data);
    const ctx: CheckContext = {
      now: Date.now(),
      // Riders are individuals: their PAN must be a personal one.
      businessStructure: (role === "rider" ? "individual" : ob.businessStructure ?? data.businessStructure ?? null) as string | null,
      legalName: (verifications.pan?.fields?.name ?? data.legalName ?? data.ownerName ?? data.name ?? null) as string | null,
      panNumber: verifications.pan?.status !== "retake" ? verifications.pan?.fields?.panNumber ?? null : null,
      bank: bank ? { accountNumber: bank.accountNumber, ifsc: bank.ifsc, holder: bank.holder } : null,
    };

    let reading = null;
    try {
      const [bytes] = await file.download();
      reading = await readDocument({ apiKey: GEMINI_API_KEY.value(), stepId, bytes, mimeType });
    } catch (e) {
      logger.error(`readKycDocument: reader failed for ${role}/${partnerId}/${stepId}`, e);
    }
    const verdict: DocumentVerdict = reading
      ? assessDocument(stepId, reading, ctx)
      : {
          status: "needs_review",
          issues: ["We couldn't check this automatically just now, so a person will."],
          fields: {}, documentNumber: null, expiresAt: null, checks: {},
        };

    const clientExpiry = Number(request.data?.expiresAt);
    const expiresAt = verdict.expiresAt ?? (Number.isFinite(clientExpiry) && clientExpiry > 0 ? clientExpiry : null);
    const publicPatch: Record<string, unknown> = {
      documents: {
        [stepId]: { ...docEntry, ...(expiresAt ? { expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt) } : {}) },
      },
      onboardingChecks: {
        documents: {
          [stepId]: { status: verdict.status, issues: verdict.issues, checkedAt: now, provider: reading ? "ai" : "unavailable" },
        },
        // A holder name that doesn't match asks for the owner's ID.
        ...(verdict.checks.holder_matches === false || verdict.checks.id_name_matches === false
          ? { identityCheckNeeded: true }
          : {}),
      },
    };
    if (stepId === "pan" && verdict.status !== "retake" && verdict.fields.name && !data.legalName) {
      publicPatch.legalName = verdict.fields.name;
    }
    if (stepId === "bank_proof" && verdict.status === "auto_verified" && data.bank?.verificationState !== BANK_STATES.VERIFIED) {
      publicPatch.bank = {
        verificationState: BANK_STATES.VERIFIED,
        verificationMethod: "document_ai",
        verificationMessage: "Verified from your cancelled cheque / passbook.",
        verifiedAt: now,
        updatedAt: now,
      };
    }

    const batch = db.batch();
    batch.set(ref, publicPatch, { merge: true });
    batch.set(privateRef, {
      role,
      partnerId: canonicalPartnerId,
      ownerUids: ownerUidsOf(role, canonicalPartnerId, data),
      verifications: {
        [stepId]: {
          status: verdict.status,
          issues: verdict.issues,
          fields: verdict.fields,
          checks: verdict.checks,
          documentNumber: verdict.documentNumber,
          documentKind: reading?.documentKind ?? null,
          confidence: reading?.confidence ?? null,
          provider: reading ? "ai" : "unavailable",
          path: storagePath,
          checkedAt: now,
        },
      },
      updatedAt: now,
    }, { merge: true });
    await batch.commit();

    await setStepComplete(role, canonicalPartnerId, stepId, verdict.status !== "retake", uid).catch((e) =>
      logger.warn(`readKycDocument: step update refused for ${role}/${canonicalPartnerId}/${stepId}`, e),
    );
    await runAutoProgress(role, canonicalPartnerId, `document:${stepId}`).catch((e) =>
      logger.warn(`readKycDocument: auto-progress failed for ${role}/${canonicalPartnerId}`, e),
    );

    return {
      status: verdict.status,
      issues: verdict.issues,
      fields: verdict.fields,
      documentNumber: verdict.documentNumber,
      expiresAt: verdict.expiresAt,
      partnerId: canonicalPartnerId,
    };
  },
);
