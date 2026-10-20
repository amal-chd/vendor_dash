import { Link } from "react-router-dom";
import { ArrowRight, Globe, Pin, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/changelogMarkdown";
import {
  AUDIENCE_META,
  AUDIENCE_ORDER,
  REACTION_EMOJI,
  STATUS_META,
  TYPE_META,
  type Audience,
  type EntryDraft,
  type EntryStatus,
  type EntryType,
  type Reaction,
} from "@/lib/changelog";
import { ChangelogBlocks } from "./ChangelogBlocks";
import { formatDate } from "./format";

export function TypeBadge({ type, className }: { type: EntryType; className?: string }) {
  const meta = TYPE_META[type] ?? TYPE_META.new;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        meta.badge,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function StatusPill({ status, className }: { status: EntryStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        meta.pill,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function AudienceChips({
  audiences,
  isPublic,
  className,
}: {
  audiences: Audience[];
  isPublic?: boolean;
  className?: string;
}) {
  const ordered = AUDIENCE_ORDER.filter((a) => audiences.includes(a));
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {ordered.map((a) => (
        <span
          key={a}
          className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
        >
          {AUDIENCE_META[a].label}
        </span>
      ))}
      {isPublic && (
        <span className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground whitespace-nowrap">
          <Globe className="h-2.5 w-2.5" /> Website
        </span>
      )}
    </div>
  );
}

/**
 * One changelog entry as it appears on the public website.
 *
 * The editor's "Website" preview renders this same component, so what an
 * admin approves is exactly what visitors get.
 */
export function ChangelogArticle({
  title,
  type,
  version,
  dateMs,
  coverImage,
  blocks,
  cta,
  pinned,
  href,
}: {
  title: string;
  type: EntryType;
  version: string | null;
  dateMs: number;
  coverImage: { url: string; alt: string } | null;
  blocks: Block[];
  cta: { label: string; url: string } | null;
  pinned?: boolean;
  /** Permalink for the title; omit on the permalink page itself. */
  href?: string;
}) {
  const ctaExternal = cta ? /^https?:\/\//i.test(cta.url) : false;
  const ctaIsAppLink = cta?.url.startsWith("kada://") ?? false;

  return (
    <article className="grid gap-x-10 gap-y-3 md:grid-cols-[160px_minmax(0,1fr)]">
      <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-start md:gap-2 md:pt-1">
        <time className="text-sm font-medium text-muted-foreground tabular-nums">{formatDate(dateMs)}</time>
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeBadge type={type} />
          {version && (
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              v{version}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <h2 className="text-balance text-xl font-bold tracking-tight text-foreground md:text-2xl">
          {pinned && <Pin className="mr-2 inline h-4 w-4 -translate-y-0.5 text-primary" aria-label="Pinned" />}
          {href ? (
            <Link to={href} className="hover:text-primary transition-colors">
              {title || "Untitled update"}
            </Link>
          ) : (
            title || "Untitled update"
          )}
        </h2>

        {coverImage?.url && (
          <img
            src={coverImage.url}
            alt={coverImage.alt}
            loading="lazy"
            className="w-full rounded-2xl border border-border object-cover"
          />
        )}

        <ChangelogBlocks blocks={blocks} />

        {cta && !ctaIsAppLink && (
          <a
            href={cta.url}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            {...(ctaExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {cta.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </article>
  );
}

/**
 * How the entry looks in the apps' "What's new" screen.
 *
 * The Flutter apps render from the same block tree; this preview matches their
 * card layout closely enough to judge length, image crop and tone.
 */
export function InAppPreview({ draft, blocks, dateMs }: { draft: EntryDraft; blocks: Block[]; dateMs: number }) {
  const reactions: Reaction[] = ["party", "love", "like", "think"];
  const apps = AUDIENCE_ORDER.filter((a) => draft.audiences.includes(a) && a !== "admin");

  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-[340px] rounded-[2rem] border border-border bg-muted/40 p-2 shadow-sm">
        <div className="overflow-hidden rounded-[1.55rem] bg-background">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-[15px] font-bold tracking-tight">What's new</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <div className="max-h-[520px] overflow-y-auto px-3 pb-4">
            <article className="space-y-2.5 rounded-2xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between gap-2">
                <TypeBadge type={draft.type} />
                <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(dateMs)}</span>
              </div>
              <h3 className="text-[16px] font-bold leading-snug tracking-tight">
                {draft.title || <span className="text-muted-foreground">Title</span>}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {draft.summary || "Your one-line summary appears here."}
              </p>
              {draft.coverImage?.url && (
                <img src={draft.coverImage.url} alt={draft.coverImage.alt} className="w-full rounded-xl object-cover" />
              )}
              <ChangelogBlocks blocks={blocks} density="compact" />
              {draft.cta?.label && (
                <div className="flex h-9 items-center justify-center rounded-xl bg-foreground text-[13px] font-semibold text-background">
                  {draft.cta.label}
                </div>
              )}
              {draft.requiresAck && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-2.5 text-[12px] text-foreground">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                  People must tap “I understand” before they can dismiss this.
                </div>
              )}
              <div className="flex gap-1.5 pt-1">
                {reactions.map((r) => (
                  <span key={r} className="rounded-full border border-border px-2 py-0.5 text-[13px]">
                    {REACTION_EMOJI[r]}
                  </span>
                ))}
              </div>
            </article>
          </div>
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground">
        {apps.length
          ? `Shown in ${apps.map((a) => AUDIENCE_META[a].app).join(", ")}`
          : "Not shown in any app — pick a customer or partner audience."}
      </p>
    </div>
  );
}
