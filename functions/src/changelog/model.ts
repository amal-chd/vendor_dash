import { HttpsError } from "firebase-functions/v2/https";
import { parseChangelogMarkdown, safeHref, safeImageSrc, type Block } from "./markdown";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Changelog entry model: types, validation and the publishing state machine.
 *
 * Kept free of Firestore so every rule here is unit-testable. The callables in
 * ./index.ts are thin: authenticate, load, call into this file, write.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Keep-a-Changelog categories, in the order readers scan for them. */
export const ENTRY_TYPES = ["new", "improved", "fixed", "security", "deprecated", "breaking"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Who a note is for. `admin` = internal release notes for the ops team. */
export const AUDIENCES = ["customer", "vendor", "rider", "host", "admin"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const PLATFORMS = ["ios", "android", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const STATUSES = ["draft", "in_review", "scheduled", "published", "archived"] as const;
export type EntryStatus = (typeof STATUSES)[number];

/**
 * Reactions are a fixed set — free-text emoji turns analytics into noise.
 * Stored under stable ASCII keys: emoji as Firestore map keys need escaped
 * field paths on every counter update. Clients map key → emoji for display.
 */
export const REACTIONS = ["party", "love", "like", "think"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface EntryFields {
  title: string;
  slug: string;
  summary: string;
  body: string;
  blocks: Block[];
  type: EntryType;
  version: string | null;
  audiences: Audience[];
  public: boolean;
  visibility: "external" | "internal";
  platforms: Platform[];
  zoneIds: string[];
  tags: string[];
  coverImage: { url: string; alt: string } | null;
  cta: { label: string; url: string } | null;
  pinned: boolean;
  requiresAck: boolean;
  notifyPush: boolean;
}

function str(v: unknown, max: number): string {
  return (typeof v === "string" ? v : v == null ? "" : String(v)).trim().slice(0, max);
}

function pickSubset<T extends string>(raw: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<T>();
  for (const v of raw) if (allowed.includes(v as T)) set.add(v as T);
  // Preserve the canonical order so two equal selections compare equal.
  return allowed.filter((a) => set.has(a));
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "update"
  );
}

const VERSION_RE = /^v?\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:[-+][0-9A-Za-z.-]{1,32})?$/;

/**
 * An entry nobody outside the ops team is meant to see is `internal`: the
 * security rules hide internal entries from every non-admin read, so an
 * internal release note can never leak through an app or the website.
 */
export function deriveVisibility(audiences: Audience[], isPublic: boolean): "external" | "internal" {
  if (isPublic) return "external";
  return audiences.some((a) => a !== "admin") ? "external" : "internal";
}

/**
 * Validate and normalise an editor payload. Throws `invalid-argument` with a
 * message written for the person filling in the form.
 */
export function normaliseEntry(raw: Record<string, unknown>): EntryFields {
  const title = str(raw.title, 120);
  if (title.length < 3) {
    throw new HttpsError("invalid-argument", "Give the update a title of at least 3 characters.");
  }

  const summary = str(raw.summary, 280);
  if (summary.length < 10) {
    throw new HttpsError(
      "invalid-argument",
      "Add a one-line summary (10+ characters). It is what appears in notifications and cards.",
    );
  }

  const body = typeof raw.body === "string" ? raw.body.replace(/\r\n?/g, "\n") : "";
  if (body.length > 20_000) {
    throw new HttpsError("invalid-argument", "The note body is over 20,000 characters. Split it into two updates.");
  }

  const type = ENTRY_TYPES.includes(raw.type as EntryType) ? (raw.type as EntryType) : null;
  if (!type) throw new HttpsError("invalid-argument", "Choose a type: New, Improved, Fixed, Security, Deprecated or Breaking.");

  const audiences = pickSubset(raw.audiences, AUDIENCES);
  const isPublic = raw.public === true;
  if (!audiences.length && !isPublic) {
    throw new HttpsError(
      "invalid-argument",
      "Pick at least one audience, or publish it on the website — otherwise nobody can see it.",
    );
  }

  const versionRaw = str(raw.version, 40);
  if (versionRaw && !VERSION_RE.test(versionRaw)) {
    throw new HttpsError("invalid-argument", "Version must look like 2.4 or 2.4.1 (optionally 2.4.1-beta).");
  }

  const tags = Array.isArray(raw.tags)
    ? Array.from(
        new Set(
          raw.tags
            .map((t) => str(t, 24).toLowerCase().replace(/[^a-z0-9\- ]/g, "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 8)
    : [];

  const zoneIds = Array.isArray(raw.zoneIds)
    ? Array.from(new Set(raw.zoneIds.map((z) => str(z, 80)).filter(Boolean))).slice(0, 50)
    : [];

  let coverImage: EntryFields["coverImage"] = null;
  const cover = raw.coverImage as Record<string, unknown> | null | undefined;
  if (cover && typeof cover === "object" && str(cover.url, 2000)) {
    const url = safeImageSrc(str(cover.url, 2000));
    if (!url) throw new HttpsError("invalid-argument", "The cover image must be an https:// link.");
    coverImage = { url, alt: str(cover.alt, 200) };
  }

  let cta: EntryFields["cta"] = null;
  const ctaRaw = raw.cta as Record<string, unknown> | null | undefined;
  if (ctaRaw && typeof ctaRaw === "object" && (str(ctaRaw.label, 40) || str(ctaRaw.url, 2000))) {
    const label = str(ctaRaw.label, 32);
    const url = safeHref(str(ctaRaw.url, 2000));
    if (!label) throw new HttpsError("invalid-argument", "The button needs a label, e.g. “Try it”.");
    if (!url) {
      throw new HttpsError(
        "invalid-argument",
        "The button link must be https://…, a site path like /pricing, or an app link kada://….",
      );
    }
    cta = { label, url };
  }

  const blocks = parseChangelogMarkdown(body);

  return {
    title,
    slug: slugify(str(raw.slug, 80) || title),
    summary,
    body,
    blocks,
    type,
    version: versionRaw ? versionRaw.replace(/^v/, "") : null,
    audiences,
    public: isPublic,
    visibility: deriveVisibility(audiences, isPublic),
    platforms: pickSubset(raw.platforms, PLATFORMS),
    zoneIds,
    tags,
    coverImage,
    cta,
    pinned: raw.pinned === true,
    // Acknowledgement only makes sense for changes that alter how people work.
    requiresAck: raw.requiresAck === true && ["breaking", "deprecated", "security"].includes(type),
    notifyPush: raw.notifyPush === true,
  };
}

// ── Publishing workflow ─────────────────────────────────────────────────────

export const VERBS = ["submit", "request_changes", "schedule", "publish", "unschedule", "archive", "restore"] as const;
export type Verb = (typeof VERBS)[number];

export interface TransitionContext {
  now: number;
  publishAt?: number | null;
  /** config/changelog.requireReview — maker-checker on. */
  requireReview: boolean;
  /** The caller wrote the current revision. */
  actorIsAuthor: boolean;
  /** Super/platform admins may bypass review, e.g. for an urgent security note. */
  actorCanOverride: boolean;
}

const ALLOWED: Record<Verb, EntryStatus[]> = {
  submit: ["draft"],
  request_changes: ["in_review"],
  schedule: ["draft", "in_review"],
  publish: ["draft", "in_review", "scheduled"],
  unschedule: ["scheduled"],
  archive: ["draft", "in_review", "scheduled", "published"],
  restore: ["archived"],
};

const RESULT: Record<Verb, EntryStatus> = {
  submit: "in_review",
  request_changes: "draft",
  schedule: "scheduled",
  publish: "published",
  unschedule: "draft",
  archive: "archived",
  restore: "draft",
};

/**
 * Decide the next status, or throw `failed-precondition` explaining why not.
 *
 * Maker-checker: with review required, going live (publish or schedule) needs
 * the entry to have been submitted for review AND a different person to
 * approve it. A scheduled entry already passed that gate when it was
 * scheduled, so the scheduler publishing it does not re-check.
 */
export function nextStatus(current: EntryStatus, verb: Verb, ctx: TransitionContext): EntryStatus {
  if (!VERBS.includes(verb)) {
    throw new HttpsError("invalid-argument", `Unknown action: ${verb}`);
  }
  if (!ALLOWED[verb].includes(current)) {
    throw new HttpsError(
      "failed-precondition",
      `Can't ${verb.replace("_", " ")} an update that is ${current.replace("_", " ")}.`,
    );
  }

  const goingLive = verb === "schedule" || (verb === "publish" && current !== "scheduled");
  if (goingLive && ctx.requireReview && !ctx.actorCanOverride) {
    if (current !== "in_review") {
      throw new HttpsError(
        "failed-precondition",
        "Review is required before going live. Submit it for review first.",
      );
    }
    if (ctx.actorIsAuthor) {
      throw new HttpsError(
        "failed-precondition",
        "Someone other than the author has to approve this update.",
      );
    }
  }

  if (verb === "schedule") {
    const at = ctx.publishAt ?? 0;
    if (!at || at <= ctx.now + 60_000) {
      throw new HttpsError("invalid-argument", "Pick a publish time at least a minute in the future.");
    }
    if (at > ctx.now + 366 * 86_400_000) {
      throw new HttpsError("invalid-argument", "Schedule within the next year.");
    }
  }

  return RESULT[verb];
}

// ── Permissions ─────────────────────────────────────────────────────────────

const AUTHOR_ROLES = ["super_admin", "platform_admin", "marketing_manager", "ops_manager", "developer", "stay_manager", "vendor_manager", "delivery_manager"];
const PUBLISH_ROLES = ["super_admin", "platform_admin", "marketing_manager"];
const OVERRIDE_ROLES = ["super_admin", "platform_admin"];

export function canAuthor(role: string): boolean {
  return AUTHOR_ROLES.includes(role);
}
export function canPublish(role: string): boolean {
  return PUBLISH_ROLES.includes(role);
}
export function canOverrideReview(role: string): boolean {
  return OVERRIDE_ROLES.includes(role);
}

/** Verbs that change what readers see need publish rights; the rest, author rights. */
export function verbNeedsPublishRights(verb: Verb): boolean {
  return verb === "schedule" || verb === "publish" || verb === "archive" || verb === "unschedule";
}

/** Broadcast audience name for each changelog audience (see notificationEngine). */
export const PUSH_AUDIENCE: Partial<Record<Audience, "customers" | "vendors" | "riders" | "hosts">> = {
  customer: "customers",
  vendor: "vendors",
  rider: "riders",
  host: "hosts",
};
