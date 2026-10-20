/**
 * ─────────────────────────────────────────────────────────────────────────
 * Partner private-data migration — moves bank details, payout routing, PAN
 * and owner contact OFF the publicly readable partner docs.
 *
 * Mirrors backfillOnboarding: admin-only, DRY RUN by default, idempotent (a
 * sealed doc plans to nothing), resumable via `startAfter`. The report names
 * field paths and document ids only — never the values.
 *
 * The write trigger (triggers.ts) seals a doc on its next write; this reaches
 * the ones nobody touches. Run it before trusting duplicate detection:
 * fingerprints exist only for records in the private store.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { assertAdmin } from "../admin_operations";
import { type PartnerRole, PARTNER_ROLES, ROLE_COLLECTION } from "./stateMachine";
import {
  PARTNER_PRIVATE_COLLECTION,
  partnerDocKey,
  planPartnerSeal,
  sealPartnerDoc,
} from "./partnerPrivate";

export interface SealReport {
  role: PartnerRole;
  scanned: number;
  /** Docs still carrying private fields when scanned. */
  needsSeal: number;
  /** Docs actually sealed (0 on a dry run). */
  sealed: number;
  /** Field path → number of docs it was found on. */
  byField: Record<string, number>;
  /** Docs whose public legacy details disagree with the private record (first 50). */
  conflicts: { partnerId: string; notes: string[] }[];
  errors: string[];
  /** Pass back as `startAfter` (with a single `role`) to continue; null when done. */
  nextCursor: string | null;
}

const PAGE = 300;

export async function sealRole(
  role: PartnerRole,
  opts?: { dryRun?: boolean; limit?: number; startAfter?: string },
): Promise<SealReport> {
  const db = admin.firestore();
  const dryRun = opts?.dryRun !== false; // default SAFE: dry run
  const limit = Math.min(20000, Math.max(1, Math.floor(opts?.limit ?? 5000)));

  const report: SealReport = {
    role,
    scanned: 0,
    needsSeal: 0,
    sealed: 0,
    byField: {},
    conflicts: [],
    errors: [],
    nextCursor: null,
  };

  const col = db.collection(ROLE_COLLECTION[role]);
  let cursor: string | null = opts?.startAfter || null;
  let done = false;

  while (!done && report.scanned < limit) {
    const want = Math.min(PAGE, limit - report.scanned);
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(want);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.size < want) done = true;
    if (snap.empty) break;

    // Existing private records for the whole page in one round trip.
    const privSnaps = await db.getAll(
      ...snap.docs.map((d) => db.collection(PARTNER_PRIVATE_COLLECTION).doc(partnerDocKey(role, d.id))),
    );

    for (let i = 0; i < snap.docs.length; i++) {
      const docSnap = snap.docs[i];
      report.scanned++;

      const plan = planPartnerSeal(role, docSnap.data(), privSnaps[i].data());
      if (!plan.needed) continue;

      report.needsSeal++;
      for (const f of plan.moved) report.byField[f] = (report.byField[f] ?? 0) + 1;
      if (plan.conflicts.length && report.conflicts.length < 50) {
        report.conflicts.push({ partnerId: docSnap.id, notes: plan.conflicts });
      }
      if (dryRun) continue;

      try {
        // Re-plans inside a transaction, so a write since the scan is respected.
        const applied = await sealPartnerDoc(role, docSnap.id);
        if (applied.needed) report.sealed++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        report.errors.push(`${docSnap.id}: ${msg}`);
        logger.error(`sealRole ${role}/${docSnap.id} failed`, e);
      }
    }

    cursor = snap.docs[snap.docs.length - 1].id;
  }

  report.nextCursor = done ? null : cursor;
  return report;
}

/**
 * Admin callable. Defaults to a DRY RUN — pass `apply: true` to write.
 * Optional: `role` (one of vendor|rider|host), `limit` per role, and
 * `startAfter` (a report's `nextCursor`, single role only).
 */
export const sealPartnerPrivateData = onCall(
  // An operator-run migration needs one instance; the region is at its CPU quota.
  { timeoutSeconds: 540, maxInstances: 1 },
  async (request) => {
    assertAdmin(request);
    const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
    const adminRole =
      (typeof claims.adminRole === "string" && claims.adminRole) || "super_admin";
    if (!["super_admin", "platform_admin"].includes(adminRole)) {
      throw new HttpsError(
        "permission-denied",
        "Only super_admin or platform_admin may run the private-data migration.",
      );
    }

    const apply = request.data?.apply === true;
    const only = request.data?.role as PartnerRole | undefined;
    const limit = Number(request.data?.limit) || 5000;
    const startAfter =
      typeof request.data?.startAfter === "string" && request.data.startAfter
        ? request.data.startAfter
        : undefined;

    const roles: PartnerRole[] =
      only && PARTNER_ROLES.includes(only) ? [only] : [...PARTNER_ROLES];
    if (startAfter && roles.length !== 1) {
      throw new HttpsError("invalid-argument", "startAfter needs a single role.");
    }

    const reports: SealReport[] = [];
    for (const r of roles) {
      reports.push(await sealRole(r, { dryRun: !apply, limit, startAfter }));
    }

    if (apply) {
      await admin.firestore().collection("admin_logs").add({
        type: "platform",
        action: "sealPartnerPrivateData",
        description: "Moved partner bank/contact data into the private store",
        adminEmail: (request.auth?.token?.email as string) || "",
        payload: reports.map((r) => ({
          role: r.role,
          scanned: r.scanned,
          sealed: r.sealed,
          errors: r.errors.length,
        })),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return {
      dryRun: !apply,
      reports,
      note: apply
        ? "Applied. Sealed fields now live in partner_private / partner_contact and " +
          "are gone from the public docs."
        : "DRY RUN — nothing written. Re-run with apply:true to move the fields.",
    };
  },
);
