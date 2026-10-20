import { createHash } from "node:crypto";
import { AUDIENCES, ENTRY_TYPES, type Audience, type EntryStatus, type EntryType } from "./model";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Automatic release notes — pure logic.
 *
 * Every `firebase deploy` sends the recent git commits to Firestore
 * (scripts/changelog/push-release-manifest.mjs). The scheduled changelog job
 * turns the commits it hasn't seen into plain-language notes and publishes
 * them under the policy below. This file holds every decision in that flow
 * so it can be tested without Firestore or Gemini.
 *
 * Safety rules the rest of the flow relies on:
 *  - Commit text is NEVER copied onto an entry. Entries are readable by the
 *    public once published; commit messages talk about holes, bypasses and
 *    internal names. Only the AI-rewritten note is published.
 *  - Anything that smells like a security fix is held as a draft. Announcing
 *    "we closed a payment bypass" tells people where to look.
 *  - Internal notes (Kada team only) publish immediately — the security rules
 *    already hide them from every app and the website.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface ManifestCommit {
  sha: string;
  subject: string;
  body: string;
  /** Author date, ISO 8601. Survives rebase and cherry-pick, unlike the sha. */
  date: string;
  /** See MOBILE_AREAS / AREA_READERS. Derived from the files the commit touched. */
  areas: string[];
  /** Changed file names per surface (newer manifests), e.g. { admin: ["RefundsPage.tsx"] }. */
  surfaces?: Record<string, string[]>;
}

export interface KeyedCommit extends ManifestCommit {
  key: string;
}

export interface GeneratedNote {
  audiences: Audience[];
  type: EntryType;
  title: string;
  summary: string;
  body: string;
  public: boolean;
  sensitive: boolean;
  commitKeys: string[];
}

export interface AutoSettings {
  autoGenerate: boolean;
  /** "publish": go live after the hold. "review": always wait for a person. */
  autoPublish: "publish" | "review";
  autoHoldMinutes: number;
  autoPush: boolean;
  requireReview: boolean;
}

export const DEFAULT_AUTO_SETTINGS: AutoSettings = {
  autoGenerate: true,
  autoPublish: "publish",
  autoHoldMinutes: 60,
  autoPush: false,
  requireReview: false,
};

/**
 * Only commits this recent are eligible. The first run looks back a week so
 * turning the feature on doesn't announce months of history; after that, three
 * weeks, so work committed a while ago but deployed today still gets a note.
 */
export const FIRST_RUN_WINDOW_DAYS = 7;
export const FRESH_WINDOW_DAYS = 21;

/** Surfaces that reach people only through an App Store / Play Store release. */
export const MOBILE_AREAS = ["customer-app", "dine-app", "rider-app", "host-app"] as const;
/** How long a commit is remembered as already handled. Longer than the window, so nothing repeats. */
export const SEEN_RETENTION_DAYS = 60;
export const MAX_NOTES_PER_DELIVERY = 6;
export const MAX_COMMITS_PER_PROMPT = 80;

const DAY_MS = 86_400_000;

/**
 * Stable identity for a change: author date + subject. The same work
 * deployed from two worktrees, or rebased onto main, keeps its author date
 * and subject but not its sha — keying on the sha would announce it twice.
 */
export function commitKey(c: Pick<ManifestCommit, "subject" | "date">): string {
  return createHash("sha1")
    .update(`${c.date.trim()}|${c.subject.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Conventional-commit types that never change what anyone sees, plus
 * merges, reverts of nothing, and work-in-progress.
 */
const NOISE_RE = /^(?:(?:chore|ci|docs|test|tests|style|build|refactor)(?:\([^)]*\))?!?:|merge\b|wip\b|fixup!|squash!)/i;

export function isNoiseCommit(c: Pick<ManifestCommit, "subject">): boolean {
  return NOISE_RE.test(c.subject.trim());
}

const LIVE_ON_DEPLOY: Record<string, readonly string[]> = {
  functions: ["backend"],
  hosting: ["admin", "dine-web", "website"],
};

/**
 * The commits a deploy actually put in front of people. A functions deploy
 * ships backend work, not the web app sitting in the same checkout — that is
 * announced when hosting deploys. App-only commits ride along with either:
 * their notes wait for the store release regardless (see decideAutoPolicy).
 * Commits left out are not marked handled, so the matching deploy picks them up.
 */
export function commitsForTarget(commits: ManifestCommit[], target: string): ManifestCommit[] {
  const live = LIVE_ON_DEPLOY[target];
  if (!live) return commits;
  return commits.filter((c) => {
    const areas = c.areas ?? [];
    if (areas.some((a) => live.includes(a))) return true;
    return areas.length > 0 && areas.every((a) => (MOBILE_AREAS as readonly string[]).includes(a));
  });
}

/** Commits worth writing about: recent, meaningful, not already handled. */
export function freshCommits(
  commits: ManifestCommit[],
  seen: Record<string, number>,
  now: number,
  windowDays: number = FRESH_WINDOW_DAYS,
): KeyedCommit[] {
  const cutoff = now - windowDays * DAY_MS;
  const out: KeyedCommit[] = [];
  const keys = new Set<string>();
  for (const c of commits) {
    if (!c || typeof c.subject !== "string" || typeof c.date !== "string") continue;
    const at = Date.parse(c.date);
    if (!Number.isFinite(at) || at < cutoff || at > now + DAY_MS) continue;
    if (isNoiseCommit(c)) continue;
    const key = commitKey(c);
    if (seen[key] || keys.has(key)) continue;
    keys.add(key);
    out.push({ ...c, key });
  }
  return out.slice(0, MAX_COMMITS_PER_PROMPT);
}

/**
 * Record commits as handled and forget anything past retention, so the
 * state document stays small no matter how long the project runs.
 */
export function mergeSeen(
  seen: Record<string, number>,
  handled: Array<{ key: string; date: string }>,
  now: number,
): Record<string, number> {
  const cutoff = now - SEEN_RETENTION_DAYS * DAY_MS;
  const next: Record<string, number> = {};
  for (const [k, at] of Object.entries(seen ?? {})) {
    if (typeof at === "number" && at >= cutoff) next[k] = at;
  }
  for (const h of handled) {
    const at = Date.parse(h.date);
    // Retention is measured from when we handled it, not when it was written,
    // so an old commit that arrives late is still remembered long enough.
    next[h.key] = Number.isFinite(at) ? Math.max(at, now) : now;
  }
  return next;
}

/**
 * Words that mean a commit fixed something exploitable. Deliberately broad:
 * a false positive costs one manual review, a false negative publishes a
 * how-to.
 */
export const SECURITY_HINT_RE =
  /\b(?:security|vulnerab\w*|exploit\w*|bypass\w*|loophole|hole|leak\w*|secrets?|passwords?|credentials?|xss|csrf|injection|privilege|escalation|p0|unauthori[sz]ed|spoof\w*|forg\w*)\b/i;

export interface AutoDecision {
  status: EntryStatus;
  publishAt: number | null;
  public: boolean;
  notifyPush: boolean;
  heldReason: string | null;
}

/** Decide how an automatically written note goes out. */
export function decideAutoPolicy(
  note: GeneratedNote,
  source: KeyedCommit[],
  settings: AutoSettings,
  now: number,
): AutoDecision {
  const sourceText = sourceTextFor(note, source);
  const awaitsAppRelease = onlyMobileAreas(note, source);

  const internalOnly = note.audiences.length > 0 && note.audiences.every((a) => a === "admin");
  if (internalOnly) {
    return { status: "published", publishAt: null, public: false, notifyPush: false, heldReason: null };
  }

  const sensitive =
    note.sensitive ||
    note.type === "security" ||
    note.type === "breaking" ||
    note.type === "deprecated" ||
    SECURITY_HINT_RE.test(sourceText) ||
    SECURITY_HINT_RE.test(`${note.title} ${note.summary} ${note.body}`);

  if (sensitive) {
    return {
      status: "draft",
      publishAt: null,
      public: false,
      notifyPush: false,
      heldReason:
        note.type === "breaking" || note.type === "deprecated"
          ? "Changes how people work — check the wording and whether it needs acknowledgement."
          : "Looks security-related — publishing it could point people at the fix. Review before release.",
    };
  }

  const publicOk = note.public && note.audiences.some((a) => a === "customer" || a === "vendor" || a === "host");

  // A deploy puts web and backend changes in front of people immediately, but
  // app changes only arrive with a store release this pipeline can't see.
  // Announcing them now would describe features nobody has yet.
  if (awaitsAppRelease) {
    return {
      status: "draft",
      publishAt: null,
      public: publicOk,
      notifyPush: settings.autoPush,
      heldReason: "Ships with the next app update. Publish once that update is live in the stores.",
    };
  }

  if (settings.requireReview || settings.autoPublish === "review") {
    return {
      status: settings.requireReview ? "in_review" : "draft",
      publishAt: null,
      public: publicOk,
      notifyPush: settings.autoPush,
      heldReason: "Automatic notes are set to wait for a person.",
    };
  }

  const hold = Math.min(7 * 24 * 60, Math.max(0, Math.round(settings.autoHoldMinutes || 0)));
  if (hold === 0) {
    return { status: "published", publishAt: null, public: publicOk, notifyPush: settings.autoPush, heldReason: null };
  }
  return {
    status: "scheduled",
    publishAt: now + hold * 60_000,
    public: publicOk,
    notifyPush: settings.autoPush,
    heldReason: null,
  };
}

const AREA_READERS: Record<string, string> = {
  "customer-app": "the customer app (people ordering food and booking stays)",
  "dine-app": "the Kada Dine mobile app (restaurant owners and staff)",
  "rider-app": "the Kada Rider app (delivery partners)",
  "host-app": "the Kada Host app (hotel and homestay hosts)",
  "dine-web": "the Kada Dine web dashboard (restaurant owners and staff)",
  admin: "the internal Kada admin console",
  website: "the public website",
  backend: "backend services (work out who notices from the message)",
};

export function buildAutoPrompt(commits: KeyedCommit[]): { system: string; user: string } {
  const system = `You write release notes for Kada, a food delivery, restaurant POS and hotel booking platform in Kerala, India, from git commits.

Apps and who uses them:
- customer: The Kada customer app
- vendor: Kada Dine, for restaurants
- rider: Kada Rider, for delivery partners
- host: Kada Host, for hotels and homestays
- admin: Kada's internal team (ops console)

Rules:
- Group related commits into one note. Write at most ${MAX_NOTES_PER_DELIVERY} notes. Fewer, better notes beat one per commit.
- Skip anything a user or the ops team would not notice: refactors, tests, tooling, copy tweaks nobody asked for. It is fine to return no notes.
- Use ONLY facts in the commits. Never invent features, numbers, dates or benefits.
- Write for the reader: what they can now do, or what works better. No commit hashes, file paths, function or collection names, ticket numbers, "P0", or engineering jargon.
- Pick audiences from who actually sees the change. Backend changes that only the ops team notices go to "admin". A change can have several audiences.
- Anything in the internal admin console is for audience "admin" ONLY — restaurants, riders, customers and hosts never see it. Use "files" to tell which surface each part of a commit is on.
- When one commit changes several surfaces, tell each audience only about the parts on its own surface (write separate notes if needed).
- sensitive = true when the change fixes a security, privacy, fraud or payment-integrity problem, or when describing it could help someone abuse the old behaviour. Still describe such changes neutrally.
- public = true only for improvements you would happily show prospective customers on the website.
- type: new | improved | fixed | security | deprecated | breaking.
- title: max 70 characters. summary: one sentence, max 180 characters.
- body: markdown using only "## " headings, "- " bullets, **bold** and *italic*. No HTML, links or images. Max 900 characters.
- commitKeys: the keys of the commits the note is based on.

Return JSON only:
{"notes":[{"audiences":["customer"],"type":"improved","title":"","summary":"","body":"","public":false,"sensitive":false,"commitKeys":[""]}]}`;

  const user = commits
    .map((c) => {
      const areas = c.areas.length ? c.areas.map((a) => AREA_READERS[a] ?? a).join("; ") : "unknown";
      const files = c.surfaces && Object.keys(c.surfaces).length
        ? `\n  files: ${Object.entries(c.surfaces).map(([a, f]) => `${a}: ${f.join(", ")}`).join("; ")}`
        : "";
      const body = c.body.trim() ? `\n  details: ${c.body.trim().replace(/\s+/g, " ").slice(0, 500)}` : "";
      return `- key: ${c.key}\n  message: ${c.subject.trim()}\n  touches: ${areas}${files}${body}`;
    })
    .join("\n");

  return { system, user };
}

/** Validate the model's JSON into notes. Anything malformed is dropped, not guessed. */
export function parseAutoNotes(raw: unknown, validKeys: Set<string>): GeneratedNote[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { notes?: unknown }).notes)
    ? ((raw as { notes: unknown[] }).notes)
    : [];
  const out: GeneratedNote[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    const audiences = Array.isArray(n.audiences)
      ? AUDIENCES.filter((a) => (n.audiences as unknown[]).includes(a))
      : [];
    const commitKeys = Array.isArray(n.commitKeys)
      ? Array.from(new Set((n.commitKeys as unknown[]).map(String).filter((k) => validKeys.has(k))))
      : [];
    const title = typeof n.title === "string" ? n.title.trim() : "";
    const summary = typeof n.summary === "string" ? n.summary.trim() : "";
    if (!audiences.length || !commitKeys.length || title.length < 3 || summary.length < 10) continue;

    out.push({
      audiences,
      type: ENTRY_TYPES.includes(n.type as EntryType) ? (n.type as EntryType) : "improved",
      title: title.slice(0, 120),
      summary: summary.slice(0, 280),
      body: typeof n.body === "string" ? n.body.trim().slice(0, 4000) : "",
      public: n.public === true,
      sensitive: n.sensitive === true,
      commitKeys,
    });
    if (out.length >= MAX_NOTES_PER_DELIVERY) break;
  }
  return out;
}

/** True when every commit behind the note only changed mobile app code. */
export function onlyMobileAreas(note: GeneratedNote, commits: KeyedCommit[]): boolean {
  const keys = new Set(note.commitKeys);
  const areas = commits.filter((c) => keys.has(c.key)).flatMap((c) => c.areas);
  return areas.length > 0 && areas.every((a) => (MOBILE_AREAS as readonly string[]).includes(a));
}

/** The commit text behind a note, for the security heuristic. Never stored on the entry. */
export function sourceTextFor(note: GeneratedNote, commits: KeyedCommit[]): string {
  const keys = new Set(note.commitKeys);
  return commits
    .filter((c) => keys.has(c.key))
    .map((c) => `${c.subject}\n${c.body}`)
    .join("\n");
}
