/**
 * ─────────────────────────────────────────────────────────────────────────
 * Onboarding lifecycle triggers.
 *
 * `onboarding` is engine-owned — Firestore rules refuse client writes to it —
 * so a newly created partner document cannot initialise its own record. These
 * triggers do it, which guarantees EVERY partner has a record no matter how
 * the doc was created (app signup, admin console, import, seed).
 *
 * That matters because `activationGate` is fail-closed: a partner with no
 * record is not operational. Without these triggers a fresh signup would be
 * permanently stuck rather than merely un-onboarded.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import {
  type PartnerRole,
  ONBOARDING_EVENTS_SUBCOLLECTION,
} from "./stateMachine";
import { BANK_STATES } from "./bankVerification";
import { sealPartnerOnWrite } from "./partnerPrivate";
import { runAutoProgress } from "./autoProgress";

/**
 * Bank verdict changed: a failed or unconfirmed automatic check asks for a
 * cancelled cheque; a verified account may be the last thing before go-live.
 */
async function onboardingBankWatch(
  ref: admin.firestore.DocumentReference,
  role: PartnerRole,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): Promise<void> {
  const from = before?.bank?.verificationState ?? BANK_STATES.NOT_ADDED;
  const to = after?.bank?.verificationState ?? BANK_STATES.NOT_ADDED;
  if (from === to) return;
  try {
    if ((to === BANK_STATES.FAILED || to === BANK_STATES.ACTION_REQUIRED) && after?.onboardingChecks?.bankProofNeeded !== true) {
      await ref.set({ onboardingChecks: { bankProofNeeded: true } }, { merge: true });
    }
    if (to === BANK_STATES.VERIFIED) await runAutoProgress(role, ref.id, "bank-verified");
  } catch (e) {
    logger.warn(`onboardingBankWatch failed for ${role}/${ref.id}`, e);
  }
}

/** Writes the initial `started` record if the doc doesn't already have one. */
async function initialiseOnboarding(
  ref: admin.firestore.DocumentReference,
  role: PartnerRole,
  data: admin.firestore.DocumentData | undefined,
): Promise<void> {
  if (data?.onboarding?.state) return; // already initialised or backfilled

  const now = admin.firestore.FieldValue.serverTimestamp();
  try {
    await ref.set(
      {
        onboarding: {
          state: "started",
          role,
          steps: { account: true }, // the account itself now exists
          blockingReasons: [],
          updatedAt: now,
        },
        // Never let a brand-new partner inherit operational flags.
        isActive: false,
      },
      { merge: true },
    );

    await ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).add({
      partnerId: ref.id,
      role,
      from: null,
      to: "started",
      actor: "system",
      actorId: "onboarding-trigger",
      reason: "Partner document created",
      at: now,
    });
  } catch (e) {
    logger.error(`initialiseOnboarding failed for ${role}/${ref.id}`, e);
  }
}

// The create/update triggers below also seal: any bank details, payout
// routing, PAN or owner contact written onto a partner doc (older app builds,
// the web dashboard, admin edits) is moved into partner_private /
// partner_contact within seconds. sealPartnerOnWrite is a pure check first,
// so an ordinary write costs nothing extra.

export const onVendorCreatedInitOnboarding = onDocumentCreated(
  "restaurants/{restaurantId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await sealPartnerOnWrite("vendor", snap.id, snap.data());
    // Outlets inherit their parent's onboarding — they are not separate
    // partners and must not sit in the review queue on their own.
    if (snap.data()?.parentId) return;
    await initialiseOnboarding(snap.ref, "vendor", snap.data());
  },
);

export const onRiderCreatedInitOnboarding = onDocumentCreated(
  "delivery_users/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await sealPartnerOnWrite("rider", snap.id, snap.data());
    await initialiseOnboarding(snap.ref, "rider", snap.data());
  },
);

export const onHostCreatedInitOnboarding = onDocumentCreated(
  "hotels/{hotelId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await sealPartnerOnWrite("host", snap.id, snap.data());
    await initialiseOnboarding(snap.ref, "host", snap.data());
  },
);

export const onMessKitchenCreatedInitOnboarding = onDocumentCreated(
  "mess_kitchens/{kitchenId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    await sealPartnerOnWrite("mess", snap.id, snap.data());
    await initialiseOnboarding(snap.ref, "mess", snap.data());
  },
);

/**
 * Auto-suspends an active partner whose banking stops being verified.
 *
 * Without this, revoking a bank account (fraud, a failed re-verification, a
 * closed account) would block their payouts but leave them taking orders —
 * accruing a balance nobody can settle. Suspending closes that gap in the
 * same move.
 */
function bankStateOf(d: admin.firestore.DocumentData | undefined): string {
  return (d?.bank?.verificationState ?? BANK_STATES.NOT_ADDED) as string;
}

async function suspendOnBankRevocation(
  ref: admin.firestore.DocumentReference,
  role: PartnerRole,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
): Promise<void> {
  const wasVerified = bankStateOf(before) === BANK_STATES.VERIFIED;
  const isVerified = bankStateOf(after) === BANK_STATES.VERIFIED;
  if (!wasVerified || isVerified) return;

  const state = after?.onboarding?.state;
  if (state !== "active") return;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const reason =
    `Bank verification revoked (${bankStateOf(before)} → ${bankStateOf(after)}); ` +
    `suspended so no further orders accrue against an unsettleable account.`;

  try {
    await ref.update({
      "onboarding.state": "suspended",
      "onboarding.suspendedAt": now,
      "onboarding.blockingReasons": [reason],
      "onboarding.updatedAt": now,
      isActive: false,
      ...(role === "rider" ? { status: "suspended" } : {}),
    });

    await ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).add({
      partnerId: ref.id,
      role,
      from: "active",
      to: "suspended",
      actor: "system",
      actorId: "bank-revocation-watch",
      reason,
      at: now,
    });

    logger.warn(`Suspended ${role}/${ref.id}: ${reason}`);
  } catch (e) {
    logger.error(`suspendOnBankRevocation failed for ${role}/${ref.id}`, e);
  }
}

export const onVendorBankChanged = onDocumentUpdated(
  "restaurants/{restaurantId}",
  async (event) => {
    if (!event.data) return;
    await suspendOnBankRevocation(
      event.data.after.ref,
      "vendor",
      event.data.before.data(),
      event.data.after.data(),
    );
    await onboardingBankWatch(event.data.after.ref, "vendor", event.data.before.data(), event.data.after.data());
    await sealPartnerOnWrite("vendor", event.data.after.id, event.data.after.data());
  },
);

export const onRiderBankChanged = onDocumentUpdated(
  "delivery_users/{uid}",
  async (event) => {
    if (!event.data) return;
    await suspendOnBankRevocation(
      event.data.after.ref,
      "rider",
      event.data.before.data(),
      event.data.after.data(),
    );
    await onboardingBankWatch(event.data.after.ref, "rider", event.data.before.data(), event.data.after.data());
    await sealPartnerOnWrite("rider", event.data.after.id, event.data.after.data());
  },
);

export const onHostBankChanged = onDocumentUpdated(
  "hotels/{hotelId}",
  async (event) => {
    if (!event.data) return;
    await suspendOnBankRevocation(
      event.data.after.ref,
      "host",
      event.data.before.data(),
      event.data.after.data(),
    );
    await onboardingBankWatch(event.data.after.ref, "host", event.data.before.data(), event.data.after.data());
    await sealPartnerOnWrite("host", event.data.after.id, event.data.after.data());
  },
);

export const onMessKitchenBankChanged = onDocumentUpdated(
  "mess_kitchens/{kitchenId}",
  async (event) => {
    if (!event.data) return;
    await suspendOnBankRevocation(
      event.data.after.ref,
      "mess",
      event.data.before.data(),
      event.data.after.data(),
    );
    await onboardingBankWatch(event.data.after.ref, "mess", event.data.before.data(), event.data.after.data());
    await sealPartnerOnWrite("mess", event.data.after.id, event.data.after.data());
  },
);
