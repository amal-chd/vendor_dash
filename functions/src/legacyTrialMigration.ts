import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * One-time migration off the removed trial tier.
 *
 * Trials no longer exist anywhere in the product: the apps, the web dashboard
 * and the security rules all treat `subscriptionStatus === "active"` as the
 * only thing that unlocks Kada Dine / Kada Host. Merchants still sitting on
 * the legacy `trial` / `trialing` status would therefore be locked out the
 * moment the new gating ships, through no action of their own.
 *
 * This converts them honestly rather than silently:
 *
 *   - trial WITH a future end date  → active, keeping that exact end date, so
 *     the merchant keeps every day they were promised.
 *   - trial WITH no / past end date → active for `graceDays` from now, so
 *     nobody is cut off without notice. Sales can then convert or expire them.
 *
 * It never shortens anyone's access and never touches a merchant who is
 * already `active`, `expired`, `paused` or `cancelled`. Run it ONCE, with
 * `dryRun: true` first to see the blast radius.
 * ─────────────────────────────────────────────────────────────────────────
 */

const LEGACY_TRIAL_STATUSES = ["trial", "trialing"];

interface MigrationResult {
  collection: string;
  scanned: number;
  migratedKeptEndDate: number;
  migratedGivenGrace: number;
  ids: string[];
}

function toMillis(raw: unknown): number {
  if (!raw) return 0;
  if (raw instanceof admin.firestore.Timestamp) return raw.toMillis();
  if (typeof raw === "number") return raw;
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function migrateCollection(
  collection: string,
  graceDays: number,
  dryRun: boolean,
  actor: string,
): Promise<MigrationResult> {
  const db = admin.firestore();
  const result: MigrationResult = {
    collection,
    scanned: 0,
    migratedKeptEndDate: 0,
    migratedGivenGrace: 0,
    ids: [],
  };

  const snap = await db
    .collection(collection)
    .where("subscriptionStatus", "in", LEGACY_TRIAL_STATUSES)
    .get();

  result.scanned = snap.size;
  if (snap.empty) return result;

  const now = Date.now();
  const graceEnd = new Date(now + graceDays * 86_400_000);

  // Chunked so a large tenant base cannot blow the 500-write batch limit.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = db.batch();

    for (const doc of chunk) {
      const d = doc.data();
      const endMs = toMillis(d.subscriptionEndDate ?? d.subscriptionExpiry);
      const keepsExistingEnd = endMs > now;

      if (keepsExistingEnd) result.migratedKeptEndDate++;
      else result.migratedGivenGrace++;
      result.ids.push(doc.id);

      if (dryRun) continue;

      const update: Record<string, unknown> = {
        subscriptionStatus: "active",
        legacyTrialMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
        legacyTrialMigratedBy: actor,
        // Preserve what they were on before, so this is auditable and
        // reversible from the document itself.
        legacyTrialPreviousStatus: (d.subscriptionStatus ?? "").toString(),
      };
      if (!keepsExistingEnd) {
        update.subscriptionEndDate = graceEnd.toISOString();
      }
      batch.set(doc.ref, update, { merge: true });
    }

    if (!dryRun) await batch.commit();
  }

  return result;
}

export const migrateLegacyTrials = onCall({ maxInstances: 1 }, async (request) => {
  const email = (request.auth?.token?.email as string) || "";
  const role = (request.auth?.token?.adminRole as string) || "super_admin";
  const isAdmin =
    request.auth?.token?.platformAdmin === true ||
    ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email);
  if (!isAdmin) throw new HttpsError("permission-denied", "Admins only.");
  if (!["super_admin", "platform_admin"].includes(role)) {
    throw new HttpsError(
      "permission-denied",
      `Your role (${role}) cannot run migrations.`,
    );
  }

  // Defaults to a dry run on purpose: the caller has to ask for the write.
  const dryRun = request.data?.dryRun !== false;
  const rawGrace = Number(request.data?.graceDays);
  const graceDays =
    Number.isFinite(rawGrace) && rawGrace > 0 && rawGrace <= 90
      ? Math.round(rawGrace)
      : 14;

  const actor = email || request.auth?.uid || "unknown";
  const results = [
    await migrateCollection("restaurants", graceDays, dryRun, actor),
    await migrateCollection("hotels", graceDays, dryRun, actor),
  ];

  const totals = results.reduce(
    (acc, r) => ({
      scanned: acc.scanned + r.scanned,
      keptEndDate: acc.keptEndDate + r.migratedKeptEndDate,
      givenGrace: acc.givenGrace + r.migratedGivenGrace,
    }),
    { scanned: 0, keptEndDate: 0, givenGrace: 0 },
  );

  if (!dryRun) {
    await admin.firestore().collection("admin_logs").add({
      action: "migrate_legacy_trials",
      actor,
      role,
      graceDays,
      totals,
      affected: results.flatMap((r) =>
        r.ids.map((id) => `${r.collection}/${id}`),
      ),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  logger.info("Legacy trial migration", { dryRun, graceDays, totals, actor });
  return { ok: true, dryRun, graceDays, totals, results };
});
