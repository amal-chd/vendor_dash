import * as admin from "firebase-admin";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { GoogleGenAI } from "@google/genai";
import { ENTRIES, announce, db, uniqueSlug } from "./store";
import { processNextRelease, retryRelease } from "./autoRun";
import {
  AUDIENCES,
  ENTRY_TYPES,
  REACTIONS,
  canAuthor,
  canOverrideReview,
  canPublish,
  nextStatus,
  normaliseEntry,
  verbNeedsPublishRights,
  VERBS,
  type Audience,
  type EntryStatus,
  type Reaction,
  type Verb,
} from "./model";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Changelog — release notes for every Kada surface.
 *
 * Three functions, deliberately. Every Cloud Function is a Cloud Run service
 * that reserves CPU against the region quota, so authoring, engagement and
 * scheduling are each one multiplexed endpoint rather than a dozen callables.
 *
 *   changelogAdmin      save · transition · restoreRevision · delete ·
 *                       aiDraft · saveSettings · runAuto · retryRelease
 *                                                        (admins, by role)
 *   changelogEngage     view · react · ack               (any signed-in user)
 *   publishDueChangelog scheduled publish + automatic notes, every 5 minutes
 *                       (see autoRun.ts)
 *
 * All writes happen here. Security rules give clients read-only access to
 * published, external entries — see firestore.rules › changelog_entries.
 * ─────────────────────────────────────────────────────────────────────────
 */

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const SETTINGS_REF = () => db().collection("config").doc("changelog");
const BOOTSTRAP_ADMINS = ["thekada@gmail.com", "thekadaapp@gmail.com"];

interface Caller {
  uid: string;
  email: string;
  role: string;
}

function requireAdmin(request: CallableRequest): Caller {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const email = String(token.email ?? "").toLowerCase();
  const isAdmin = token.platformAdmin === true || BOOTSTRAP_ADMINS.includes(email);
  if (!request.auth || !isAdmin) {
    throw new HttpsError("permission-denied", "Only Kada admins can manage the changelog.");
  }
  return {
    uid: request.auth.uid,
    email,
    // Mirrors the rest of the console: an admin without an explicit role is
    // a super admin (the bootstrap owners).
    role: String(token.adminRole ?? "super_admin"),
  };
}

async function readSettings(): Promise<{ requireReview: boolean; defaultNotifyPush: boolean }> {
  const d = (await SETTINGS_REF().get()).data() ?? {};
  return {
    requireReview: d.requireReview === true,
    defaultNotifyPush: d.defaultNotifyPush !== false,
  };
}

async function audit(caller: Caller, action: string, payload: Record<string, unknown>) {
  await db()
    .collection("admin_logs")
    .add({
      type: "changelog",
      action,
      description: `changelog:${action}`,
      adminEmail: caller.email,
      payload,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
    .catch((e) => logger.warn("changelog audit write failed", e));
}

// ── Admin endpoint ──────────────────────────────────────────────────────────

type AdminAction =
  | "save"
  | "transition"
  | "restoreRevision"
  | "delete"
  | "aiDraft"
  | "saveSettings"
  | "runAuto"
  | "retryRelease";

export const changelogAdmin = onCall(
  // One instance: a handful of admins, never a burst. Every instance reserves
  // CPU against the region quota whether or not it is busy.
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 120, maxInstances: 1 },
  async (request) => {
    const caller = requireAdmin(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const action = String(data.action ?? "") as AdminAction;

    switch (action) {
      case "save":
        return saveEntry(caller, data);
      case "transition":
        return transitionEntry(caller, data);
      case "restoreRevision":
        return restoreRevision(caller, data);
      case "delete":
        return deleteEntry(caller, data);
      case "aiDraft":
        return aiDraft(caller, data);
      case "saveSettings":
        return saveSettings(caller, data);
      case "runAuto":
        return runAuto(caller);
      case "retryRelease":
        return retryReleaseAction(caller, data);
      default:
        throw new HttpsError("invalid-argument", `Unknown changelog action: ${action}`);
    }
  },
);

async function saveEntry(caller: Caller, data: Record<string, unknown>) {
  if (!canAuthor(caller.role)) {
    throw new HttpsError("permission-denied", `Your role (${caller.role}) can't write release notes.`);
  }
  const fields = normaliseEntry((data.entry ?? {}) as Record<string, unknown>);
  const requestedId = String(data.id ?? "").trim();
  const expectedRevision = typeof data.expectedRevision === "number" ? data.expectedRevision : null;

  const ref = requestedId ? db().collection(ENTRIES).doc(requestedId) : db().collection(ENTRIES).doc();

  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.data();

    if (requestedId && !existing) {
      throw new HttpsError("not-found", "That update no longer exists.");
    }

    // Optimistic concurrency. Two people editing the same note is normal;
    // silently keeping whoever saved last is how a fix gets lost.
    const currentRevision = Number(existing?.revision ?? 0);
    if (existing && expectedRevision !== null && expectedRevision !== currentRevision) {
      throw new HttpsError(
        "aborted",
        `${existing.updatedByEmail ?? "Someone"} saved a newer version (revision ${currentRevision}). Reload to see their changes before saving.`,
      );
    }

    const status = (existing?.status ?? "draft") as EntryStatus;
    // Editing a live or scheduled note changes what readers see, so it needs
    // the same rights as publishing it.
    if ((status === "published" || status === "scheduled") && !canPublish(caller.role)) {
      throw new HttpsError(
        "permission-denied",
        "This update is live or scheduled. Only someone who can publish may edit it.",
      );
    }

    const slug = await uniqueSlug(tx, fields.slug, ref.id);
    const revision = currentRevision + 1;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const doc = {
      ...fields,
      slug,
      status,
      revision,
      updatedAt: now,
      updatedByEmail: caller.email,
      ...(existing
        ? {}
        : {
            createdAt: now,
            authorEmail: caller.email,
            publishAt: null,
            publishedAt: null,
            notifiedAt: null,
            stats: { views: 0, acks: 0, reactions: { party: 0, love: 0, like: 0, think: 0 } },
          }),
    };

    tx.set(ref, doc, { merge: true });
    // Full snapshot per save — cheap at release-note sizes, and it is what
    // makes "restore revision 3" exact rather than a best guess.
    tx.set(ref.collection("revisions").doc(String(revision)), {
      ...fields,
      slug,
      revision,
      editorEmail: caller.email,
      savedAt: now,
    });
    return { id: ref.id, revision, slug, created: !existing };
  });

  await audit(caller, result.created ? "create" : "update", { id: result.id, revision: result.revision, title: fields.title });
  return { ok: true, ...result };
}

async function transitionEntry(caller: Caller, data: Record<string, unknown>) {
  const id = String(data.id ?? "").trim();
  const verb = String(data.verb ?? "") as Verb;
  if (!id) throw new HttpsError("invalid-argument", "id is required.");
  if (!VERBS.includes(verb)) throw new HttpsError("invalid-argument", `Unknown action: ${verb}`);

  if (verbNeedsPublishRights(verb) ? !canPublish(caller.role) : !canAuthor(caller.role)) {
    throw new HttpsError("permission-denied", `Your role (${caller.role}) can't ${verb.replace("_", " ")} release notes.`);
  }

  const settings = await readSettings();
  const ref = db().collection(ENTRIES).doc(id);
  const publishAtMs = typeof data.publishAt === "number" ? data.publishAt : null;

  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!d) throw new HttpsError("not-found", "That update no longer exists.");

    const from = d.status as EntryStatus;
    const to = nextStatus(from, verb, {
      now: Date.now(),
      publishAt: publishAtMs,
      requireReview: settings.requireReview,
      // "Author" for maker-checker is whoever wrote the current words, not
      // who created the doc a month ago.
      actorIsAuthor: String(d.updatedByEmail ?? d.authorEmail ?? "") === caller.email,
      actorCanOverride: canOverrideReview(caller.role),
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const update: Record<string, unknown> = { status: to, updatedAt: now };

    if (verb === "submit") update.submittedAt = now;
    if (verb === "schedule") update.publishAt = admin.firestore.Timestamp.fromMillis(publishAtMs!);
    if (verb === "unschedule") update.publishAt = null;
    if (verb === "publish") {
      update.publishedAt = now;
      update.publishAt = null;
    }
    if ((verb === "publish" || verb === "schedule") && from === "in_review") {
      update.reviewedByEmail = caller.email;
    }
    if (verb === "restore") {
      // A restored note that goes live again is a new announcement.
      update.notifiedAt = null;
      update.notifyResult = admin.firestore.FieldValue.delete();
    }

    tx.update(ref, update as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    tx.set(ref.collection("events").doc(), {
      verb,
      from,
      to,
      actorEmail: caller.email,
      publishAt: publishAtMs ? admin.firestore.Timestamp.fromMillis(publishAtMs) : null,
      at: now,
    });
    return { from, to, title: String(d.title ?? "") };
  });

  if (outcome.to === "published") {
    await announce(id).catch((e) => logger.error("announce failed", { id, e }));
  }
  await audit(caller, verb, { id, ...outcome });
  return { ok: true, status: outcome.to };
}

async function restoreRevision(caller: Caller, data: Record<string, unknown>) {
  const id = String(data.id ?? "").trim();
  const revision = Number(data.revision);
  if (!id || !Number.isInteger(revision) || revision < 1) {
    throw new HttpsError("invalid-argument", "id and revision are required.");
  }
  const snap = await db().collection(ENTRIES).doc(id).collection("revisions").doc(String(revision)).get();
  const rev = snap.data();
  if (!rev) throw new HttpsError("not-found", `Revision ${revision} doesn't exist.`);

  const entry = await db().collection(ENTRIES).doc(id).get();
  // Restoring writes a NEW revision with the old content, so history only
  // ever grows and the restore itself can be undone.
  return saveEntry(caller, { id, entry: rev, expectedRevision: Number(entry.data()?.revision ?? 0) });
}

async function deleteEntry(caller: Caller, data: Record<string, unknown>) {
  const id = String(data.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id is required.");
  const ref = db().collection(ENTRIES).doc(id);
  const d = (await ref.get()).data();
  if (!d) return { ok: true };

  // Anything that was ever published is part of the public record — people
  // may have linked to it or acknowledged it. Archive instead.
  if (d.publishedAt || d.status === "published" || d.status === "scheduled") {
    throw new HttpsError(
      "failed-precondition",
      "This update has been published or scheduled. Archive it instead of deleting it.",
    );
  }
  if (!canAuthor(caller.role)) {
    throw new HttpsError("permission-denied", `Your role (${caller.role}) can't delete release notes.`);
  }
  await db().recursiveDelete(ref);
  await audit(caller, "delete", { id, title: d.title });
  return { ok: true };
}

async function aiDraft(caller: Caller, data: Record<string, unknown>) {
  if (!canAuthor(caller.role)) {
    throw new HttpsError("permission-denied", `Your role (${caller.role}) can't write release notes.`);
  }
  const notes = String(data.notes ?? "").trim().slice(0, 6000);
  if (notes.length < 15) {
    throw new HttpsError("invalid-argument", "Paste a few lines about what changed — commit messages, a ticket, or bullet points.");
  }
  const type = ENTRY_TYPES.includes(data.type as never) ? String(data.type) : "improved";
  const audiences = (Array.isArray(data.audiences) ? data.audiences : [])
    .filter((a): a is Audience => AUDIENCES.includes(a as Audience));
  const readers: Record<Audience, string> = {
    customer: "customers ordering food and booking stays",
    vendor: "restaurant owners and their staff using Kada Dine",
    rider: "delivery partners using Kada Rider",
    host: "hotel and homestay hosts using Kada Host",
    admin: "Kada's internal operations team",
  };
  const audienceText = audiences.length ? audiences.map((a) => readers[a]).join("; ") : "all Kada users";

  const systemInstruction = `You write release notes for Kada, a food delivery, restaurant POS and hotel booking platform in Kerala, India.
Readers: ${audienceText}. Change type: ${type}.

Rules:
- Use ONLY facts present in the notes. Never invent features, numbers, dates, percentages or customer quotes.
- Say what changed and why it matters to the reader, in plain words. No internal jargon, ticket IDs or code names.
- Warm and specific, never hype. No exclamation marks.
- Return JSON only: {"title": string, "summary": string, "body": string}
- title: max 70 characters.
- summary: one sentence, max 180 characters.
- body: markdown using ONLY "## " headings, "- " bullets, **bold** and *italic*. No HTML, no images, no links. Max 1200 characters.`;

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ text: notes }],
      config: { systemInstruction, temperature: 0.4, responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(response.text ?? "{}");
    const draft = {
      title: String(parsed.title ?? "").trim().slice(0, 120),
      summary: String(parsed.summary ?? "").trim().slice(0, 280),
      body: String(parsed.body ?? "").trim().slice(0, 4000),
    };
    if (!draft.title || !draft.summary) throw new Error("empty draft");
    await audit(caller, "aiDraft", { chars: notes.length, type });
    return { ok: true, draft };
  } catch (e) {
    logger.warn("changelog aiDraft failed", e);
    throw new HttpsError("unavailable", "AI drafting didn't work this time. Try again, or write the note by hand.");
  }
}

async function saveSettings(caller: Caller, data: Record<string, unknown>) {
  if (!canOverrideReview(caller.role)) {
    throw new HttpsError("permission-denied", "Only super or platform admins can change changelog settings.");
  }
  const hold = Number(data.autoHoldMinutes);
  const settings = {
    requireReview: data.requireReview === true,
    defaultNotifyPush: data.defaultNotifyPush !== false,
    autoGenerate: data.autoGenerate !== false,
    autoPublish: data.autoPublish === "review" ? "review" : "publish",
    // 0 publishes straight away; a week is the longest a note can sit held.
    autoHoldMinutes: Number.isFinite(hold) ? Math.min(7 * 24 * 60, Math.max(0, Math.round(hold))) : 60,
    autoPush: data.autoPush === true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedByEmail: caller.email,
  };
  await SETTINGS_REF().set(settings, { merge: true });
  const { updatedAt: _u, ...logged } = settings;
  await audit(caller, "saveSettings", logged);
  return { ok: true };
}

async function runAuto(caller: Caller) {
  if (!canPublish(caller.role)) {
    throw new HttpsError("permission-denied", `Your role (${caller.role}) can't run automatic release notes.`);
  }
  const outcome = await processNextRelease(`manual:${caller.email}`);
  await audit(caller, "runAuto", outcome as unknown as Record<string, unknown>);
  return { ok: true, ...outcome };
}

async function retryReleaseAction(caller: Caller, data: Record<string, unknown>) {
  if (!canPublish(caller.role)) {
    throw new HttpsError("permission-denied", `Your role (${caller.role}) can't retry automatic release notes.`);
  }
  const id = String(data.id ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id is required.");
  await retryRelease(id).catch(() => {
    throw new HttpsError("not-found", "That deploy record no longer exists.");
  });
  await audit(caller, "retryRelease", { id });
  return { ok: true };
}

// ── Engagement endpoint ─────────────────────────────────────────────────────

async function readableEntry(tx: admin.firestore.Transaction, id: string) {
  const ref = db().collection(ENTRIES).doc(id);
  const snap = await tx.get(ref);
  const d = snap.data();
  // Same visibility the security rules enforce for direct reads.
  if (!d || d.status !== "published" || d.visibility !== "external") return null;
  return { ref, data: d };
}

export const changelogEngage = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to react to updates.");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const action = String(data.action ?? "");
  const audience = AUDIENCES.includes(data.audience as Audience) ? String(data.audience) : null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (action === "view") {
    const ids = Array.from(
      new Set((Array.isArray(data.entryIds) ? data.entryIds : []).map((x) => String(x)).filter(Boolean)),
    ).slice(0, 50);

    // One transaction per entry: a view counts once per person, however many
    // times they open the screen.
    const counted = await Promise.all(
      ids.map((id) =>
        db()
          .runTransaction(async (tx) => {
            const entry = await readableEntry(tx, id);
            if (!entry) return false;
            const engRef = entry.ref.collection("engagement").doc(uid);
            const eng = await tx.get(engRef);
            if (eng.data()?.viewedAt) return false;
            tx.set(engRef, { viewedAt: now, audience }, { merge: true });
            tx.update(entry.ref, { "stats.views": admin.firestore.FieldValue.increment(1) });
            return true;
          })
          .catch(() => false),
      ),
    );
    return { ok: true, counted: counted.filter(Boolean).length };
  }

  if (action === "react") {
    const id = String(data.entryId ?? "");
    const next = data.reaction == null ? null : (String(data.reaction) as Reaction);
    if (next !== null && !REACTIONS.includes(next)) {
      throw new HttpsError("invalid-argument", "Unknown reaction.");
    }
    return db().runTransaction(async (tx) => {
      const entry = await readableEntry(tx, id);
      if (!entry) throw new HttpsError("not-found", "That update isn't available.");
      const engRef = entry.ref.collection("engagement").doc(uid);
      const prev = ((await tx.get(engRef)).data()?.reaction ?? null) as Reaction | null;
      if (prev === next) return { ok: true, reaction: next };

      // Counters move in the same transaction as the person's reaction, so
      // the totals can't drift from the underlying reactions.
      const inc = admin.firestore.FieldValue.increment;
      const update: Record<string, unknown> = {};
      if (prev) update[`stats.reactions.${prev}`] = inc(-1);
      if (next) update[`stats.reactions.${next}`] = inc(1);
      tx.update(entry.ref, update as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
      tx.set(engRef, { reaction: next, reactedAt: now, audience }, { merge: true });
      return { ok: true, reaction: next };
    });
  }

  if (action === "ack") {
    const id = String(data.entryId ?? "");
    return db().runTransaction(async (tx) => {
      const entry = await readableEntry(tx, id);
      if (!entry || entry.data.requiresAck !== true) {
        throw new HttpsError("not-found", "That update doesn't need acknowledging.");
      }
      const engRef = entry.ref.collection("engagement").doc(uid);
      if ((await tx.get(engRef)).data()?.ackedAt) return { ok: true, already: true };
      tx.set(engRef, { ackedAt: now, audience }, { merge: true });
      tx.update(entry.ref, { "stats.acks": admin.firestore.FieldValue.increment(1) });
      return { ok: true, already: false };
    });
  }

  throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
});

// ── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Publish entries whose time has come, then turn the next deploy into notes.
 *
 * Every 5 minutes: precise enough for "goes live at 10:00", and the cost is a
 * single indexed query when nothing is due. Each entry is re-checked inside
 * its own transaction, so an admin unscheduling at 9:59 wins.
 *
 * Automatic notes ride on this job rather than a Firestore trigger: every
 * extra function reserves CPU against a region quota that is already full.
 */
export const publishDueChangelog = onSchedule(
  // A scheduled job never needs a second instance.
  {
    schedule: "*/5 * * * *",
    timeZone: "Asia/Kolkata",
    timeoutSeconds: 300,
    maxInstances: 1,
    secrets: [GEMINI_API_KEY],
  },
  async () => {
    const due = await db()
      .collection(ENTRIES)
      .where("status", "==", "scheduled")
      .where("publishAt", "<=", admin.firestore.Timestamp.now())
      .limit(50)
      .get();

    let published = 0;
    for (const doc of due.docs) {
      const went = await db()
        .runTransaction(async (tx) => {
          const snap = await tx.get(doc.ref);
          const d = snap.data();
          const at = d?.publishAt as admin.firestore.Timestamp | undefined;
          if (!d || d.status !== "scheduled" || !at || at.toMillis() > Date.now()) return false;
          const now = admin.firestore.FieldValue.serverTimestamp();
          tx.update(doc.ref, { status: "published", publishedAt: now, publishAt: null, updatedAt: now });
          tx.set(doc.ref.collection("events").doc(), {
            verb: "publish",
            from: "scheduled",
            to: "published",
            actorEmail: "scheduler",
            at: now,
          });
          return true;
        })
        .catch((e) => {
          logger.error("scheduled publish failed", { id: doc.id, e });
          return false;
        });

      if (went) {
        published++;
        await announce(doc.id).catch((e) => logger.error("announce failed", { id: doc.id, e }));
      }
    }
    if (published) logger.info(`Published ${published} scheduled changelog entr${published === 1 ? "y" : "ies"}`);

    // Notes published by the auto-run go out in the run after they're due, so
    // the scheduled publish above always runs first and a slow model call
    // can never delay a note someone scheduled by hand.
    await processNextRelease("scheduler").catch((e) =>
      logger.error("auto changelog run failed", { e: String(e?.message ?? e) }),
    );
  },
);
