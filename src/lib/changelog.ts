import { httpsCallable } from "firebase/functions";
import { Timestamp } from "firebase/firestore";
import { functions } from "@/lib/firebase";
import type { Block } from "@/lib/changelogMarkdown";

/**
 * Web-side changelog model. The server (functions/src/changelog/model.ts) is
 * the authority — these types and role lists exist so the console can show
 * the right controls, not to enforce anything.
 */

export type EntryType = "new" | "improved" | "fixed" | "security" | "deprecated" | "breaking";
export type Audience = "customer" | "vendor" | "rider" | "host" | "admin";
export type Platform = "ios" | "android" | "web";
export type EntryStatus = "draft" | "in_review" | "scheduled" | "published" | "archived";
export type Reaction = "party" | "love" | "like" | "think";
export type Verb = "submit" | "request_changes" | "schedule" | "publish" | "unschedule" | "archive" | "restore";

export interface ChangelogEntry {
  id: string;
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
  status: EntryStatus;
  revision: number;
  publishAt: Timestamp | null;
  publishedAt: Timestamp | null;
  notifiedAt: Timestamp | null;
  notifySkippedReason?: string;
  notifyResult?: Record<string, { recipients?: number; pushed?: number; error?: string }>;
  authorEmail: string;
  updatedByEmail: string;
  reviewedByEmail?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  stats: { views: number; acks: number; reactions: Record<Reaction, number> };
  /** "auto" when written from a deploy by the changelog bot. */
  source?: "auto";
  releaseId?: string;
  /** Why an automatic note is waiting for a person instead of going live. */
  autoHeldReason?: string | null;
}

/** One deploy, as recorded by scripts/changelog/push-release-manifest.mjs. */
export interface ChangelogRelease {
  id: string;
  headSha: string;
  branch: string;
  target: string;
  status: "pending" | "processing" | "done" | "failed" | "skipped";
  commitCount: number;
  consideredCommits?: number;
  created?: number;
  byStatus?: Partial<Record<EntryStatus, number>>;
  entryIds?: string[];
  attempts?: number;
  detail?: string | null;
  lastError?: string | null;
  createdAt: Timestamp | null;
  processedAt?: Timestamp | null;
}

export const AUTO_BOT = "changelog-bot";

/** The editable subset sent to `changelogAdmin › save`. */
export type EntryDraft = Pick<
  ChangelogEntry,
  | "title"
  | "summary"
  | "body"
  | "type"
  | "version"
  | "audiences"
  | "public"
  | "platforms"
  | "zoneIds"
  | "tags"
  | "coverImage"
  | "cta"
  | "pinned"
  | "requiresAck"
  | "notifyPush"
>;

export const EMPTY_DRAFT: EntryDraft = {
  title: "",
  summary: "",
  body: "",
  type: "new",
  version: null,
  audiences: ["customer"],
  public: false,
  platforms: [],
  zoneIds: [],
  tags: [],
  coverImage: null,
  cta: null,
  pinned: false,
  requiresAck: false,
  notifyPush: true,
};

export const TYPE_META: Record<EntryType, { label: string; badge: string; dot: string; hint: string }> = {
  new: {
    label: "New",
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
    dot: "bg-emerald-500",
    hint: "Something people couldn't do before",
  },
  improved: {
    label: "Improved",
    badge: "bg-sky-500/12 text-sky-700 dark:text-sky-400 border-sky-500/25",
    dot: "bg-sky-500",
    hint: "An existing feature got better",
  },
  fixed: {
    label: "Fixed",
    badge: "bg-slate-500/12 text-slate-700 dark:text-slate-300 border-slate-500/25",
    dot: "bg-slate-500",
    hint: "Something broken now works",
  },
  security: {
    label: "Security",
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-400 border-violet-500/25",
    dot: "bg-violet-500",
    hint: "Protects accounts, money or data",
  },
  deprecated: {
    label: "Deprecated",
    badge: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
    dot: "bg-amber-500",
    hint: "Going away — tell people what to use instead",
  },
  breaking: {
    label: "Breaking",
    badge: "bg-rose-500/12 text-rose-700 dark:text-rose-400 border-rose-500/25",
    dot: "bg-rose-500",
    hint: "Changes how people work; may need action",
  },
};

export const TYPE_ORDER: EntryType[] = ["new", "improved", "fixed", "security", "deprecated", "breaking"];

export const AUDIENCE_META: Record<Audience, { label: string; app: string }> = {
  customer: { label: "Customers", app: "The Kada" },
  vendor: { label: "Restaurants", app: "Kada Dine" },
  rider: { label: "Delivery partners", app: "Kada Rider" },
  host: { label: "Hosts", app: "Kada Host" },
  admin: { label: "Kada team", app: "Admin console" },
};

export const AUDIENCE_ORDER: Audience[] = ["customer", "vendor", "rider", "host", "admin"];

export const STATUS_META: Record<EntryStatus, { label: string; pill: string }> = {
  draft: { label: "Draft", pill: "bg-muted text-muted-foreground border-border" },
  in_review: { label: "In review", pill: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  scheduled: { label: "Scheduled", pill: "bg-sky-500/12 text-sky-700 dark:text-sky-400 border-sky-500/30" },
  published: { label: "Published", pill: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
  archived: { label: "Archived", pill: "bg-muted text-muted-foreground/70 border-border line-through" },
};

export const REACTION_EMOJI: Record<Reaction, string> = {
  party: "🎉",
  love: "❤️",
  like: "👍",
  think: "🤔",
};

// Mirrors functions/src/changelog/model.ts — used to show/hide controls only.
const AUTHOR_ROLES = ["super_admin", "platform_admin", "marketing_manager", "ops_manager", "developer", "stay_manager", "vendor_manager", "delivery_manager"];
const PUBLISH_ROLES = ["super_admin", "platform_admin", "marketing_manager"];
const OVERRIDE_ROLES = ["super_admin", "platform_admin"];

export const canAuthor = (role: string | null | undefined) => !!role && AUTHOR_ROLES.includes(role);
export const canPublish = (role: string | null | undefined) => !!role && PUBLISH_ROLES.includes(role);
export const canOverrideReview = (role: string | null | undefined) => !!role && OVERRIDE_ROLES.includes(role);

export function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "object" && v && "toMillis" in v && typeof (v as Timestamp).toMillis === "function") {
    return (v as Timestamp).toMillis();
  }
  if (typeof v === "number") return v;
  const n = Date.parse(String(v));
  return Number.isFinite(n) ? n : 0;
}

const adminCall = httpsCallable<Record<string, unknown>, Record<string, unknown>>(functions, "changelogAdmin");

export async function changelogAdmin<T = Record<string, unknown>>(
  action: "save" | "transition" | "restoreRevision" | "delete" | "aiDraft" | "saveSettings" | "runAuto" | "retryRelease",
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await adminCall({ action, ...payload });
  return res.data as T;
}

/** Pull a readable message out of a callable error. */
export function errorMessage(e: unknown, fallback = "Something went wrong."): string {
  const msg = (e as { message?: string })?.message;
  return msg && !/^internal$/i.test(msg) ? msg : fallback;
}
