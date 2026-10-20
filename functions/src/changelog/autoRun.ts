import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { GoogleGenAI } from "@google/genai";
import { ENTRIES, announce, db, uniqueSlug } from "./store";
import { normaliseEntry } from "./model";
import {
  DEFAULT_AUTO_SETTINGS,
  FIRST_RUN_WINDOW_DAYS,
  FRESH_WINDOW_DAYS,
  buildAutoPrompt,
  commitsForTarget,
  decideAutoPolicy,
  freshCommits,
  mergeSeen,
  parseAutoNotes,
  type AutoSettings,
  type ManifestCommit,
} from "./auto";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Automatic release notes — the Firestore + Gemini side.
 *
 *   deploy ──▶ changelog_releases/{headSha}   (scripts/changelog/push-release-manifest.mjs)
 *          ──▶ publishDueChangelog, every 5 min, takes ONE pending release
 *          ──▶ Gemini writes notes for commits not yet announced
 *          ──▶ changelog_entries (source: "auto"), policy in auto.ts
 *
 * One release per run keeps each run well inside the timeout and means a
 * burst of deploys is worked through in order rather than all at once.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const RELEASES = "changelog_releases";
const STATE_REF = () => db().collection("changelog_sync").doc("state");
const SETTINGS_REF = () => db().collection("config").doc("changelog");
const BOT = "changelog-bot";
const MAX_ATTEMPTS = 3;
const LEASE_MS = 10 * 60_000;

export async function readAutoSettings(): Promise<AutoSettings> {
  const d = (await SETTINGS_REF().get()).data() ?? {};
  return {
    autoGenerate: d.autoGenerate !== false,
    autoPublish: d.autoPublish === "review" ? "review" : "publish",
    autoHoldMinutes:
      typeof d.autoHoldMinutes === "number" ? d.autoHoldMinutes : DEFAULT_AUTO_SETTINGS.autoHoldMinutes,
    autoPush: d.autoPush === true,
    requireReview: d.requireReview === true,
  };
}

type Outcome =
  | { ran: false; reason: string }
  | { ran: true; releaseId: string; status: "done" | "pending" | "failed" | "skipped"; created: number; detail?: string };

/** Pick the oldest release that is due, including one abandoned mid-run. */
async function nextDueRelease(now: number) {
  const [pending, processing] = await Promise.all([
    db().collection(RELEASES).where("status", "==", "pending").limit(20).get(),
    db().collection(RELEASES).where("status", "==", "processing").limit(20).get(),
  ]);
  const due = [
    ...pending.docs.filter((d) => {
      const retryAfter = d.get("retryAfter") as admin.firestore.Timestamp | null;
      return !retryAfter || retryAfter.toMillis() <= now;
    }),
    ...processing.docs.filter((d) => {
      const lease = d.get("leaseUntil") as admin.firestore.Timestamp | null;
      return !lease || lease.toMillis() <= now;
    }),
  ];
  due.sort((a, b) => ms(a.get("createdAt")) - ms(b.get("createdAt")));
  return due[0] ?? null;
}

function ms(t: unknown): number {
  return t instanceof admin.firestore.Timestamp ? t.toMillis() : 0;
}

export async function processNextRelease(trigger: "scheduler" | string): Promise<Outcome> {
  const now = Date.now();
  const candidate = await nextDueRelease(now);
  if (!candidate) return { ran: false, reason: "No deploys waiting." };

  // Claim it. A second runner (manual "run now" racing the scheduler) sees
  // the lease and moves on.
  const claimed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(candidate.ref);
    const d = snap.data();
    if (!d) return null;
    const lease = d.leaseUntil as admin.firestore.Timestamp | null;
    const takeable =
      d.status === "pending" || (d.status === "processing" && (!lease || lease.toMillis() <= Date.now()));
    if (!takeable) return null;
    tx.update(candidate.ref, {
      status: "processing",
      leaseUntil: admin.firestore.Timestamp.fromMillis(Date.now() + LEASE_MS),
      attempts: admin.firestore.FieldValue.increment(1),
      lastTrigger: trigger,
    });
    return {
      commitsJson: String(d.commitsJson ?? "[]"),
      target: String(d.target ?? ""),
      attempts: Number(d.attempts ?? 0) + 1,
    };
  });
  if (!claimed) return { ran: false, reason: "Another run is already handling the next deploy." };

  const releaseId = candidate.id;
  const settings = await readAutoSettings();

  if (!settings.autoGenerate) {
    await candidate.ref.update({
      status: "skipped",
      leaseUntil: null,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      detail: "Automatic release notes were switched off.",
    });
    return { ran: true, releaseId, status: "skipped", created: 0 };
  }

  let commits: ManifestCommit[] = [];
  try {
    const parsed = JSON.parse(claimed.commitsJson);
    commits = Array.isArray(parsed) ? parsed : [];
  } catch {
    commits = [];
  }

  const state = (await STATE_REF().get()).data() ?? {};
  // The short first-run window applies to every deploy queued before the
  // feature started (not just the first one processed), so a backlog of
  // deploys can't announce weeks of history.
  const initMs = ms(state.initializedAt);
  const windowDays =
    initMs > 0 && ms(candidate.get("createdAt")) > initMs ? FRESH_WINDOW_DAYS : FIRST_RUN_WINDOW_DAYS;
  const fresh = freshCommits(
    commitsForTarget(commits, claimed.target),
    (state.seen ?? {}) as Record<string, number>,
    now,
    windowDays,
  );

  if (fresh.length === 0) {
    await db().runTransaction(async (tx) => {
      tx.update(candidate.ref, {
        status: "done",
        leaseUntil: null,
        created: 0,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        detail: "Nothing new to announce — every change was already covered or was internal housekeeping.",
      });
      if (!state.initializedAt) {
        tx.set(STATE_REF(), { initializedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    });
    return { ran: true, releaseId, status: "done", created: 0 };
  }

  // ── Write the notes ──
  let notes;
  try {
    const { system, user } = buildAutoPrompt(fresh);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ text: user }],
      config: { systemInstruction: system, temperature: 0.3, responseMimeType: "application/json" },
    });
    notes = parseAutoNotes(JSON.parse(response.text ?? "{}"), new Set(fresh.map((c) => c.key)));
  } catch (e: any) {
    return giveBack(candidate.ref, releaseId, claimed.attempts, e, "Note writing failed.");
  }

  let created;
  try {
  created = await db().runTransaction(async (tx) => {
    // Re-read inside the transaction: if a parallel run already covered
    // these commits, drop the notes rather than announce twice.
    const liveState = (await tx.get(STATE_REF())).data() ?? {};
    const seen = (liveState.seen ?? {}) as Record<string, number>;
    const fresher = notes.filter((n) => n.commitKeys.some((k) => !seen[k]));

    const planned: Array<{ ref: admin.firestore.DocumentReference; slug: string; doc: Record<string, unknown>; status: string }> = [];
    const usedSlugs = new Set<string>();
    for (const note of fresher) {
      const decision = decideAutoPolicy(note, fresh, settings, Date.now());
      let fields;
      try {
        fields = normaliseEntry({
          ...note,
          public: decision.public,
          notifyPush: decision.notifyPush,
          tags: ["auto"],
        });
      } catch (e) {
        logger.warn("auto changelog: dropped a note that failed validation", { releaseId, title: note.title, e });
        continue;
      }
      const ref = db().collection(ENTRIES).doc();
      let slug = await uniqueSlug(tx, fields.slug, ref.id);
      if (usedSlugs.has(slug)) slug = `${slug}-${planned.length + 1}`;
      usedSlugs.add(slug);

      const at = admin.firestore.FieldValue.serverTimestamp();
      planned.push({
        ref,
        slug,
        status: decision.status,
        doc: {
          ...fields,
          slug,
          status: decision.status,
          revision: 1,
          createdAt: at,
          updatedAt: at,
          authorEmail: BOT,
          updatedByEmail: BOT,
          publishAt: decision.publishAt ? admin.firestore.Timestamp.fromMillis(decision.publishAt) : null,
          publishedAt: decision.status === "published" ? at : null,
          notifiedAt: null,
          stats: { views: 0, acks: 0, reactions: { party: 0, love: 0, like: 0, think: 0 } },
          source: "auto",
          releaseId,
          // Keys only. Commit text stays on the release record, which only
          // admins can read — never on the entry, which the public can.
          sourceCommitKeys: note.commitKeys,
          autoHeldReason: decision.heldReason,
        },
      });
    }

    const at = admin.firestore.FieldValue.serverTimestamp();
    for (const p of planned) {
      tx.set(p.ref, p.doc);
      const { stats: _stats, ...snapshot } = p.doc;
      tx.set(p.ref.collection("revisions").doc("1"), { ...snapshot, editorEmail: BOT, savedAt: at });
      tx.set(p.ref.collection("events").doc(), {
        verb: "auto_create",
        from: null,
        to: p.status,
        actorEmail: BOT,
        releaseId,
        at,
      });
    }

    tx.set(
      STATE_REF(),
      {
        seen: mergeSeen(seen, fresh.map((c) => ({ key: c.key, date: c.date })), Date.now()),
        initializedAt: liveState.initializedAt ?? at,
        lastReleaseId: releaseId,
        lastRunAt: at,
      },
      { merge: false },
    );

    const byStatus: Record<string, number> = {};
    for (const p of planned) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    tx.update(candidate.ref, {
      status: "done",
      leaseUntil: null,
      lastError: null,
      created: planned.length,
      byStatus,
      entryIds: planned.map((p) => p.ref.id),
      consideredCommits: fresh.length,
      processedAt: at,
      detail: planned.length
        ? null
        : "The changes in this deploy didn't need a note — nothing people would notice.",
    });

    return planned;
  });
  } catch (e: any) {
    // Saving failed (e.g. a note Firestore can't store). Count it toward the
    // retry limit like a model failure — otherwise the release stayed claimed
    // and was retried every 10 minutes forever.
    return giveBack(candidate.ref, releaseId, claimed.attempts, e, "Saving the notes failed.");
  }

  for (const p of created) {
    if (p.status === "published") {
      await announce(p.ref.id).catch((e) => logger.error("announce failed", { id: p.ref.id, e }));
    }
  }
  logger.info("auto changelog: release processed", { releaseId, notes: created.length, commits: fresh.length });
  return { ran: true, releaseId, status: "done", created: created.length };
}

/** Release a claim after a failure: back in the queue with backoff, or failed for good. */
async function giveBack(
  ref: admin.firestore.DocumentReference,
  releaseId: string,
  attempts: number,
  e: any,
  detail: string,
): Promise<Outcome> {
  const failed = attempts >= MAX_ATTEMPTS;
  logger.warn("auto changelog: run failed", { releaseId, attempts, detail, e: String(e?.message ?? e) });
  await ref.update({
    status: failed ? "failed" : "pending",
    leaseUntil: null,
    // Back off 10, then 20 minutes: long enough to ride out an outage.
    retryAfter: failed ? null : admin.firestore.Timestamp.fromMillis(Date.now() + attempts * 10 * 60_000),
    lastError: String(e?.message ?? e).slice(0, 300),
  });
  return { ran: true, releaseId, status: failed ? "failed" : "pending", created: 0, detail };
}

/** Put a failed or skipped release back in the queue. */
export async function retryRelease(id: string): Promise<void> {
  await db().collection(RELEASES).doc(id).update({
    status: "pending",
    attempts: 0,
    retryAfter: null,
    leaseUntil: null,
    lastError: null,
  });
}
