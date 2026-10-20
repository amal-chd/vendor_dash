import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { deliverBroadcast } from "../notificationEngine/broadcast";
import { PUSH_AUDIENCE, type Audience } from "./model";

export const db = () => admin.firestore();
export const ENTRIES = "changelog_entries";

/**
 * Give a slug that no other entry uses. Permalinks (/changelog/<slug>) are
 * shared and indexed, so two notes must never resolve to the same URL.
 */
export async function uniqueSlug(
  tx: admin.firestore.Transaction,
  base: string,
  selfId: string,
): Promise<string> {
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const hits = await tx.get(db().collection(ENTRIES).where("slug", "==", candidate).limit(2));
    if (hits.docs.every((d) => d.id === selfId)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// ── Announcing ──────────────────────────────────────────────────────────────

/**
 * Push a just-published entry to its audiences, exactly once.
 *
 * `notifiedAt` is claimed in a transaction BEFORE sending, so a publish that
 * races the scheduler, or a retry after a timeout, never pushes twice. The
 * cost of that ordering is that a crash mid-send can under-deliver — the
 * right trade for a notification nobody asked to receive twice.
 */
export async function announce(entryId: string): Promise<void> {
  const ref = db().collection(ENTRIES).doc(entryId);

  const entry = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!d || d.status !== "published" || d.notifiedAt || d.notifyPush !== true) return null;
    tx.update(ref, { notifiedAt: admin.firestore.FieldValue.serverTimestamp() });
    return d;
  });
  if (!entry) return;

  // Broadcasts can't be filtered by zone. Pushing a zone-targeted note to the
  // whole audience would tell Thrissur about a Kochi-only change, so skip the
  // push and say why — the note still appears in-app for the right zones.
  if (Array.isArray(entry.zoneIds) && entry.zoneIds.length > 0) {
    await ref.update({ notifySkippedReason: "Zone-targeted updates appear in-app only; push goes to whole audiences." });
    return;
  }

  const results: Record<string, { recipients: number; pushed: number } | { error: string }> = {};
  for (const audience of (entry.audiences ?? []) as Audience[]) {
    const pushAudience = PUSH_AUDIENCE[audience];
    if (!pushAudience) continue;
    try {
      results[pushAudience] = await deliverBroadcast({
        title: entry.title,
        body: entry.summary,
        audience: pushAudience,
        type: "changelog",
        deepLink: `kada://whats-new/${entryId}`,
        imageUrl: entry.coverImage?.url,
      });
    } catch (e: any) {
      logger.error("changelog push failed", { entryId, audience, e });
      results[pushAudience] = { error: String(e?.message ?? e).slice(0, 200) };
    }
  }
  await ref.update({ notifyResult: results });
}
