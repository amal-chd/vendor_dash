/**
 * ─────────────────────────────────────────────────────────────────────────
 * Document-expiry sweep.
 *
 * A partner activated with valid papers does not stay compliant forever —
 * FSSAI licences lapse, vehicle insurance and PUC expire. Nothing in the
 * platform noticed before: a rider whose insurance expired last month kept
 * receiving orders, which is an uninsured-driver liability, and a vendor with
 * a lapsed FSSAI kept selling food.
 *
 * This nightly sweep:
 *   - suspends any ACTIVE partner with an expired MANDATORY document
 *   - warns partners whose documents expire within 30 / 7 days
 *
 * It only ever suspends on a MANDATORY, expiry-tracked document, so an
 * optional or non-expiring upload can never take a partner offline.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import {
  type PartnerRole,
  PARTNER_ROLES,
  ROLE_COLLECTION,
  ONBOARDING_EVENTS_SUBCOLLECTION,
} from "./stateMachine";
import { resolveRequirements } from "./kycRules";
import {
  expiredDocuments,
  documentsExpiringWithin,
  loadRequirementOverrides,
} from "./activationGate";
import { applicantContextOf } from "./transition";
import { missingMandatorySteps } from "./kycRules";
import { dueNudge, notifyPartnerInApp, runAutoProgress } from "./autoProgress";

/**
 * Keeps onboarding moving without anyone chasing it:
 *   - reminds partners who stopped part-way (after 1, 3 and 7 idle days)
 *   - re-evaluates partners waiting on checks, in case a trigger was missed
 */
async function nudgeRole(
  role: PartnerRole,
  overrides: Record<string, Record<string, Record<string, unknown>>>,
): Promise<{ role: PartnerRole; nudged: number; reevaluated: number }> {
  const db = admin.firestore();
  const out = { role, nudged: 0, reevaluated: 0 };
  const snap = await db
    .collection(ROLE_COLLECTION[role])
    .where("onboarding.state", "in", ["started", "incomplete", "action_required", "submitted"])
    .limit(1000)
    .get();

  for (const doc of snap.docs) {
    const d = doc.data() ?? {};
    const ob = d.onboarding ?? {};
    try {
      if (ob.state === "submitted") {
        await runAutoProgress(role, doc.id, "nightly");
        out.reevaluated++;
        continue;
      }
      const updated = ob.updatedAt?.toMillis?.() ?? 0;
      if (!updated) continue;
      const daysIdle = Math.floor((Date.now() - updated) / 86_400_000);
      const sent = d.onboardingChecks?.nudges as Record<string, unknown> | undefined;
      const due = dueNudge(daysIdle, sent);
      if (due === null) continue;

      const reqs = resolveRequirements(role, applicantContextOf(d, ob), overrides);
      const missing = missingMandatorySteps(reqs, ob.steps).filter((r) => !r.automatic);
      if (missing.length === 0) continue;
      const left = missing.length === 1 ? `Just "${missing[0].label}" left.` : `${missing.length} steps left, starting with "${missing[0].label}".`;
      const title = ob.state === "action_required" ? "Your application needs a quick fix" : "Finish setting up to start earning";
      await notifyPartnerInApp(role, doc.id, title, `${left} It only takes a few minutes, and you can pick up where you left off.`);
      await doc.ref.set({ onboardingChecks: { nudges: { [`d${due}`]: admin.firestore.FieldValue.serverTimestamp() } } }, { merge: true });
      out.nudged++;
    } catch (err) {
      logger.error(`Onboarding nudge failed for ${role}/${doc.id}`, err);
    }
  }
  return out;
}

const WARN_DAYS = 30;

interface SweepResult {
  role: PartnerRole;
  scanned: number;
  suspended: number;
  warned: number;
}

async function sweepRole(
  role: PartnerRole,
  overrides: Record<string, Record<string, Record<string, unknown>>>,
): Promise<SweepResult> {
  const db = admin.firestore();
  const result: SweepResult = { role, scanned: 0, suspended: 0, warned: 0 };

  // Only ACTIVE partners can be suspended by expiry; everyone else is
  // already blocked by the gate, so scanning them would be wasted reads.
  const snap = await db
    .collection(ROLE_COLLECTION[role])
    .where("onboarding.state", "==", "active")
    .limit(2000)
    .get();

  for (const doc of snap.docs) {
    result.scanned++;
    const d = doc.data() ?? {};
    const ob = d.onboarding ?? {};

    try {
      const reqs = resolveRequirements(role, applicantContextOf(d, ob), overrides);
      const expired = expiredDocuments(d.documents, reqs);

      if (expired.length > 0) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        const reason = `Expired mandatory document(s): ${expired.join(", ")}.`;

        await doc.ref.update({
          "onboarding.state": "suspended",
          "onboarding.suspendedAt": now,
          "onboarding.blockingReasons": [reason],
          "onboarding.updatedAt": now,
          isActive: false,
          ...(role === "rider" ? { status: "suspended" } : {}),
        });

        await doc.ref.collection(ONBOARDING_EVENTS_SUBCOLLECTION).add({
          partnerId: doc.id,
          role,
          from: "active",
          to: "suspended",
          actor: "system",
          actorId: "expiry-sweep",
          reason,
          at: now,
        });

        result.suspended++;
        logger.warn(`Expiry sweep suspended ${role}/${doc.id}: ${reason}`);
        continue;
      }

      // Not expired — warn if something lapses soon.
      const soon = documentsExpiringWithin(d.documents, reqs, WARN_DAYS);
      if (soon.length > 0) {
        await doc.ref.set(
          {
            onboarding: {
              documentsExpiringSoon: soon.map((s) => ({
                id: s.id,
                label: s.label,
                expiresAt: s.expiresAt,
              })),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        );
        result.warned++;
      }
    } catch (e) {
      logger.error(`Expiry sweep failed for ${role}/${doc.id}`, e);
    }
  }

  return result;
}

/** Runs nightly at 02:30 IST, before the morning operating window. */
export const onboardingExpirySweep = onSchedule(
  { schedule: "30 2 * * *", timeZone: "Asia/Kolkata" },
  async () => {
    const overrides = await loadRequirementOverrides();
    const results: SweepResult[] = [];
    const nudges = [];
    for (const role of PARTNER_ROLES) {
      results.push(await sweepRole(role, overrides));
      nudges.push(await nudgeRole(role, overrides));
    }
    logger.info("onboardingExpirySweep complete", { results, nudges });
  },
);
