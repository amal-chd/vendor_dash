import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Bot,
  CalendarClock,
  Copy,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  AUDIENCE_META,
  AUDIENCE_ORDER,
  REACTION_EMOJI,
  STATUS_META,
  TYPE_META,
  TYPE_ORDER,
  canAuthor,
  canOverrideReview,
  canPublish,
  changelogAdmin,
  errorMessage,
  toMillis,
  type Audience,
  type ChangelogEntry,
  type ChangelogRelease,
  type EntryStatus,
  type EntryType,
  type Reaction,
  type Verb,
} from "@/lib/changelog";
import { AudienceChips, StatusPill, TypeBadge } from "@/components/changelog/ChangelogPreview";
import { dayLabel, formatDateTime, formatRelative } from "@/components/changelog/format";

type View = "updates" | "schedule" | "insights" | "settings";

const VIEWS: { key: View; label: string; icon: typeof FileText }[] = [
  { key: "updates", label: "Updates", icon: FileText },
  { key: "schedule", label: "Schedule", icon: CalendarClock },
  { key: "insights", label: "Insights", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings2 },
];

const STATUS_FILTERS: { key: EntryStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "in_review", label: "In review" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "archived", label: "Archived" },
];

const totalReactions = (e: ChangelogEntry) =>
  Object.values(e.stats?.reactions ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);

/**
 * The changelog console: every release note across the customer app, the
 * three partner apps, the website and internal ops notes, in one list.
 *
 * Reads Firestore directly (admins only, per the rules). Every write goes
 * through the `changelogAdmin` callable, which owns validation, the review
 * workflow and push delivery.
 */
export default function ChangelogAdminPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((v) => v.key === params.get("view")) ? params.get("view") : "updates") as View;
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    next.set("view", v);
    setParams(next, { replace: true });
  };

  const { role } = usePermissions();
  const { rows, loading } = useLiveCollection<ChangelogEntry>("changelog_entries", {
    orderByField: "updatedAt",
    orderDir: "desc",
    limit: 500,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Rocket className="h-4 w-4 text-primary" /> Changelog
          </h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            Release notes for customers, restaurants, delivery partners, hosts and the website — written once,
            shown in every app’s “What’s new”, and optionally pushed.
          </p>
        </div>
        {canAuthor(role) && (
          <Button size="sm" className="h-9" onClick={() => navigate("/admin/growth/changelog/new")}>
            <Plus className="mr-1.5 h-4 w-4" /> New update
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              view === v.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <v.icon className="h-3.5 w-3.5" />
            {v.label}
            {v.key === "schedule" && (counts.scheduled ?? 0) > 0 && (
              <span className="ml-0.5 rounded-full bg-sky-500/15 px-1.5 text-[10px] font-black text-sky-700 dark:text-sky-400 tabular-nums">
                {counts.scheduled}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === "updates" && <UpdatesView rows={rows} loading={loading} counts={counts} role={role} />}
      {view === "schedule" && <ScheduleView rows={rows} loading={loading} role={role} />}
      {view === "insights" && <InsightsView rows={rows} loading={loading} />}
      {view === "settings" && <SettingsView role={role} />}
    </div>
  );
}

// ── Updates ─────────────────────────────────────────────────────────────────

function UpdatesView({
  rows,
  loading,
  counts,
  role,
}: {
  rows: ChangelogEntry[];
  loading: boolean;
  counts: Record<string, number>;
  role: string | null;
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<EntryStatus | "all">("all");
  const [type, setType] = useState<EntryType | "all">("all");
  const [audience, setAudience] = useState<Audience | "all">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChangelogEntry | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (type !== "all" && r.type !== type) return false;
      if (audience !== "all" && !(r.audiences ?? []).includes(audience)) return false;
      if (!needle) return true;
      return [r.title, r.summary, r.version ?? "", ...(r.tags ?? [])].join(" ").toLowerCase().includes(needle);
    });
  }, [rows, status, type, audience, q]);

  const heldAuto = rows.filter((r) => r.source === "auto" && r.status === "draft").length;
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const archivable = filtered.filter((r) => selected.has(r.id) && r.status !== "archived");

  const transition = async (entry: ChangelogEntry, verb: Verb) => {
    setBusy(entry.id);
    try {
      await changelogAdmin("transition", { id: entry.id, verb });
      toast.success(verb === "archive" ? "Archived" : verb === "restore" ? "Restored to draft" : "Updated");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update that entry."));
    } finally {
      setBusy(null);
    }
  };

  const archiveSelected = async () => {
    setBusy("bulk");
    let ok = 0;
    for (const entry of archivable) {
      try {
        await changelogAdmin("transition", { id: entry.id, verb: "archive" });
        ok++;
      } catch (e) {
        toast.error(`${entry.title}: ${errorMessage(e)}`);
      }
    }
    setSelected(new Set());
    setBusy(null);
    if (ok) toast.success(`Archived ${ok} update${ok === 1 ? "" : "s"}`);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(pendingDelete.id);
    try {
      await changelogAdmin("delete", { id: pendingDelete.id });
      toast.success("Draft deleted");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't delete that draft."));
    } finally {
      setBusy(null);
      setPendingDelete(null);
    }
  };

  const duplicate = (entry: ChangelogEntry) =>
    navigate("/admin/growth/changelog/new", {
      state: {
        duplicateOf: {
          title: entry.title,
          summary: entry.summary,
          body: entry.body,
          type: entry.type,
          version: entry.version,
          audiences: entry.audiences,
          public: entry.public,
          platforms: entry.platforms,
          zoneIds: entry.zoneIds,
          tags: entry.tags,
          coverImage: entry.coverImage,
          cta: entry.cta,
          pinned: false,
          requiresAck: entry.requiresAck,
          notifyPush: entry.notifyPush,
        },
      },
    });

  return (
    <div className="space-y-3">
      {heldAuto > 0 && status !== "draft" && (
        <button
          type="button"
          onClick={() => setStatus("draft")}
          className="flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-left text-sm hover:bg-amber-500/10"
        >
          <Bot className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="flex-1">
            <b>{heldAuto}</b> automatic note{heldAuto === 1 ? " is" : "s are"} waiting for a person — security-related, or
            shipping with the next app update.
          </span>
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Review</span>
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                status === f.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={(v) => setType(v as EntryType | "all")}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_ORDER.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={audience} onValueChange={(v) => setAudience(v as Audience | "all")}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All audiences</SelectItem>
              {AUDIENCE_ORDER.map((a) => (
                <SelectItem key={a} value={a}>
                  {AUDIENCE_META[a].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, tag, version"
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          <span className="font-semibold tabular-nums">{selected.size} selected</span>
          {canPublish(role) && archivable.length > 0 && (
            <Button size="sm" variant="outline" className="h-7" disabled={busy === "bulk"} onClick={archiveSelected}>
              {busy === "bulk" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" />}
              Archive {archivable.length}
            </Button>
          )}
          <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="w-9 px-3 py-2.5">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => setSelected(v ? new Set(filtered.map((r) => r.id)) : new Set())}
                  aria-label="Select all"
                />
              </th>
              <th className="px-3 py-2.5">Update</th>
              <th className="px-3 py-2.5">Audience</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Engagement</th>
              <th className="px-3 py-2.5">Last edit</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading &&
              [0, 1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td colSpan={7} className="px-3 py-3">
                    <div className="h-9 animate-pulse rounded-md bg-muted/60" />
                  </td>
                </tr>
              ))}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center">
                  <FileText className="mx-auto h-6 w-6 text-muted-foreground/50" />
                  <p className="mt-2 text-sm font-semibold">
                    {rows.length ? "No updates match these filters" : "No release notes yet"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {rows.length
                      ? "Clear a filter or search for something else."
                      : "Write the first one — it can go to one app, several, or the public website."}
                  </p>
                  {!rows.length && canAuthor(role) && (
                    <Button size="sm" className="mt-4 h-8" onClick={() => navigate("/admin/growth/changelog/new")}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> New update
                    </Button>
                  )}
                </td>
              </tr>
            )}

            {!loading &&
              filtered.map((r) => {
                const publishedMs = toMillis(r.publishedAt);
                const publishAtMs = toMillis(r.publishAt);
                const reactions = totalReactions(r);
                const everPublished = Boolean(r.publishedAt);
                return (
                  <tr
                    key={r.id}
                    className="group cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                    onClick={() => navigate(`/admin/growth/changelog/${r.id}`)}
                  >
                    <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(r.id);
                            else next.delete(r.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${r.title}`}
                      />
                    </td>
                    <td className="max-w-[420px] px-3 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <TypeBadge type={r.type} />
                        {r.version && <span className="font-mono text-[11px] text-muted-foreground">v{r.version}</span>}
                        {r.pinned && <Pin className="h-3 w-3 text-primary" aria-label="Pinned" />}
                        {r.requiresAck && <ShieldCheck className="h-3 w-3 text-rose-500" aria-label="Requires acknowledgement" />}
                        {r.source === "auto" && <AutoBadge />}
                      </div>
                      <p className="mt-1 truncate font-semibold text-foreground">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.summary}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <AudienceChips audiences={r.audiences ?? []} isPublic={r.public} />
                      {r.visibility === "internal" && (
                        <p className="mt-1 text-[10px] font-medium text-muted-foreground">Internal only</p>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <StatusPill status={r.status} />
                      {r.source === "auto" && r.autoHeldReason && r.status === "draft" && (
                        <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                          {r.autoHeldReason}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {r.status === "scheduled"
                          ? formatDateTime(publishAtMs)
                          : r.status === "published"
                            ? formatRelative(publishedMs)
                            : r.status === "in_review"
                              ? "Awaiting approval"
                              : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top text-xs tabular-nums">
                      {everPublished ? (
                        <div className="space-y-0.5">
                          <p className="flex items-center gap-1 text-foreground">
                            <Eye className="h-3 w-3 text-muted-foreground" /> {r.stats?.views ?? 0}
                            <span className="ml-2 text-muted-foreground">{reactions} reactions</span>
                          </p>
                          {r.requiresAck && (
                            <p className="text-muted-foreground">
                              {r.stats?.acks ?? 0} acknowledged
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-xs">
                      <p className="text-foreground">{formatRelative(toMillis(r.updatedAt))}</p>
                      <p className="max-w-[160px] truncate text-muted-foreground">{r.updatedByEmail}</p>
                    </td>
                    <td className="px-2 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-label="More actions" variant="ghost" size="icon" className="h-7 w-7" disabled={busy === r.id}>
                            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => navigate(`/admin/growth/changelog/${r.id}`)}>
                            <FileText className="mr-2 h-3.5 w-3.5" /> Open
                          </DropdownMenuItem>
                          {canAuthor(role) && (
                            <DropdownMenuItem onClick={() => duplicate(r)}>
                              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                            </DropdownMenuItem>
                          )}
                          {canPublish(role) && r.status !== "archived" && (
                            <DropdownMenuItem onClick={() => transition(r, "archive")}>
                              <Archive className="mr-2 h-3.5 w-3.5" /> Archive
                            </DropdownMenuItem>
                          )}
                          {canAuthor(role) && r.status === "archived" && (
                            <DropdownMenuItem onClick={() => transition(r, "restore")}>
                              <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore to draft
                            </DropdownMenuItem>
                          )}
                          {canAuthor(role) && !everPublished && (r.status === "draft" || r.status === "archived" || r.status === "in_review") && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-rose-600 focus:text-rose-600"
                                onClick={() => setPendingDelete(r)}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete draft
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft and all its saved revisions are removed permanently. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-rose-600 hover:bg-rose-700">
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Schedule ────────────────────────────────────────────────────────────────

function ScheduleView({ rows, loading, role }: { rows: ChangelogEntry[]; loading: boolean; role: string | null }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const upcoming = useMemo(
    () => rows.filter((r) => r.status === "scheduled").sort((a, b) => toMillis(a.publishAt) - toMillis(b.publishAt)),
    [rows],
  );
  const recent = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    return rows
      .filter((r) => r.status === "published" && toMillis(r.publishedAt) >= cutoff)
      .sort((a, b) => toMillis(b.publishedAt) - toMillis(a.publishedAt));
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChangelogEntry[]>();
    for (const r of upcoming) {
      const key = dayLabel(toMillis(r.publishAt));
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return Array.from(map.entries());
  }, [upcoming]);

  const run = async (entry: ChangelogEntry, verb: Verb) => {
    setBusy(entry.id);
    try {
      await changelogAdmin("transition", { id: entry.id, verb });
      toast.success(verb === "unschedule" ? "Moved back to drafts" : "Published");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-muted/50" />;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold">Going out</h3>
          <span className="text-xs text-muted-foreground">Checked every 5 minutes · IST</span>
        </header>
        {grouped.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <div className="divide-y divide-border">
            {grouped.map(([day, entries]) => (
              <div key={day} className="px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{day}</p>
                <ul className="space-y-2">
                  {entries.map((r) => (
                    <li key={r.id} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs font-semibold tabular-nums">
                        {new Date(toMillis(r.publishAt)).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => navigate(`/admin/growth/changelog/${r.id}`)}
                      >
                        <p className="truncate text-sm font-semibold hover:text-primary">{r.title}</p>
                        <AudienceChips audiences={r.audiences ?? []} isPublic={r.public} className="mt-0.5" />
                      </button>
                      {canPublish(role) && (
                        <div className="flex shrink-0 gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === r.id} onClick={() => run(r, "unschedule")}>
                            Unschedule
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === r.id} onClick={() => run(r, "publish")}>
                            Publish now
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-bold">Published in the last 30 days</h3>
          <span className="text-xs text-muted-foreground tabular-nums">{recent.length}</span>
        </header>
        {recent.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing published recently.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/admin/growth/changelog/${r.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30"
                >
                  <TypeBadge type={r.type} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRelative(toMillis(r.publishedAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Insights ────────────────────────────────────────────────────────────────

function InsightsView({ rows, loading }: { rows: ChangelogEntry[]; loading: boolean }) {
  const navigate = useNavigate();
  const published = useMemo(() => rows.filter((r) => Boolean(r.publishedAt)), [rows]);

  const totals = useMemo(() => {
    const reactions: Record<Reaction, number> = { party: 0, love: 0, like: 0, think: 0 };
    let views = 0;
    for (const r of published) {
      views += r.stats?.views ?? 0;
      for (const k of Object.keys(reactions) as Reaction[]) reactions[k] += r.stats?.reactions?.[k] ?? 0;
    }
    const monthAgo = Date.now() - 30 * 86_400_000;
    return {
      views,
      reactions,
      reactionTotal: Object.values(reactions).reduce((a, b) => a + b, 0),
      last30: published.filter((r) => toMillis(r.publishedAt) >= monthAgo).length,
    };
  }, [published]);

  const top = useMemo(
    () => [...published].sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0)).slice(0, 10),
    [published],
  );
  const needsAck = useMemo(() => published.filter((r) => r.requiresAck && r.status === "published"), [published]);

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-muted/50" />;

  const maxViews = Math.max(1, ...top.map((r) => r.stats?.views ?? 0));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Published, last 30 days", value: totals.last30 },
          { label: "People who opened a note", value: totals.views },
          { label: "Reactions", value: totals.reactionTotal },
          { label: "Awaiting acknowledgement", value: needsAck.length },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{k.value.toLocaleString("en-IN")}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-bold">Most-read updates</h3>
            <p className="text-xs text-muted-foreground">A view counts once per person, however often they open it.</p>
          </header>
          {top.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No published updates yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {top.map((r) => {
                const views = r.stats?.views ?? 0;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/growth/changelog/${r.id}`)}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {views.toLocaleString("en-IN")} views · {totalReactions(r)} reactions
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${(views / maxViews) * 100}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="rounded-xl border border-border bg-card px-4 py-3">
            <h3 className="text-sm font-bold">How people reacted</h3>
            <div className="mt-3 space-y-2">
              {(Object.keys(totals.reactions) as Reaction[]).map((k) => {
                const n = totals.reactions[k];
                const pct = totals.reactionTotal ? Math.round((n / totals.reactionTotal) * 100) : 0;
                return (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-center">{REACTION_EMOJI[k]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {n} · {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold">Acknowledgements</h3>
              <p className="text-xs text-muted-foreground">Breaking and security notes people must confirm.</p>
            </header>
            {needsAck.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No live notes require acknowledgement.</p>
            ) : (
              <ul className="divide-y divide-border">
                {needsAck.map((r) => {
                  const views = r.stats?.views ?? 0;
                  const acks = r.stats?.acks ?? 0;
                  const pct = views ? Math.round((acks / views) * 100) : 0;
                  return (
                    <li key={r.id} className="px-4 py-2.5">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {acks} of {views} people who opened it ({pct}%)
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────

function AutoBadge() {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded bg-sky-500/10 px-1 py-px text-[10px] font-semibold text-sky-600 dark:text-sky-400"
      title="Written automatically from a deploy"
    >
      <Bot className="h-3 w-3" /> Auto
    </span>
  );
}

interface ChangelogSettings {
  requireReview: boolean;
  defaultNotifyPush: boolean;
  autoGenerate: boolean;
  autoPublish: "publish" | "review";
  autoHoldMinutes: number;
  autoPush: boolean;
  updatedByEmail?: string;
}

const HOLD_OPTIONS = [
  { value: 0, label: "Publish immediately" },
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
];

function SettingsView({ role }: { role: string | null }) {
  const [settings, setSettings] = useState<ChangelogSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = canOverrideReview(role);

  useEffect(
    () =>
      onSnapshot(
        doc(db, "config", "changelog"),
        (snap) => {
          const d = snap.data() ?? {};
          setSettings({
            requireReview: d.requireReview === true,
            defaultNotifyPush: d.defaultNotifyPush !== false,
            autoGenerate: d.autoGenerate !== false,
            autoPublish: d.autoPublish === "review" ? "review" : "publish",
            autoHoldMinutes: typeof d.autoHoldMinutes === "number" ? d.autoHoldMinutes : 60,
            autoPush: d.autoPush === true,
            updatedByEmail: d.updatedByEmail,
          });
        },
        () =>
          setSettings({
            requireReview: false,
            defaultNotifyPush: true,
            autoGenerate: true,
            autoPublish: "publish",
            autoHoldMinutes: 60,
            autoPush: false,
          }),
      ),
    [],
  );

  const save = async (patch: Partial<ChangelogSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const { updatedByEmail: _ignored, ...payload } = next;
      await changelogAdmin("saveSettings", payload);
      toast.success("Changelog settings saved");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save settings."));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="h-40 animate-pulse rounded-xl bg-muted/50" />;

  const holdLabel = HOLD_OPTIONS.find((o) => o.value === settings.autoHoldMinutes)?.label ?? `${settings.autoHoldMinutes} minutes`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,42rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        {!editable && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Only super and platform admins can change these settings.
          </p>
        )}

        <h3 className="flex items-center gap-1.5 pt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Bot className="h-3.5 w-3.5" /> Automatic release notes
        </h3>

        <div className="flex items-start justify-between gap-6 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold">Write notes from every deploy</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              After each deploy, the commits that shipped are turned into plain-language notes for the right apps.
              Housekeeping (tests, refactors, tooling) is skipped, and a change is never announced twice.
            </p>
          </div>
          <Switch
            checked={settings.autoGenerate}
            disabled={!editable || saving}
            onCheckedChange={(v) => save({ autoGenerate: v })}
          />
        </div>

        <div
          className={cn(
            "space-y-4 rounded-xl border border-border bg-card p-4",
            !settings.autoGenerate && "pointer-events-none opacity-50",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-sm">
              <p className="text-sm font-semibold">What happens to a new note</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {settings.autoPublish === "publish"
                  ? `It is scheduled and goes live after ${holdLabel.toLowerCase() === "publish immediately" ? "no delay" : holdLabel}. Anyone who can publish can stop it from the Schedule view before then.`
                  : "It waits as a draft until someone publishes it."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                value={settings.autoPublish}
                disabled={!editable || saving}
                onValueChange={(v) => save({ autoPublish: v as "publish" | "review" })}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="publish">Publish on its own</SelectItem>
                  <SelectItem value="review">Wait for a person</SelectItem>
                </SelectContent>
              </Select>
              {settings.autoPublish === "publish" && (
                <Select
                  value={String(settings.autoHoldMinutes)}
                  disabled={!editable || saving}
                  onValueChange={(v) => save({ autoHoldMinutes: Number(v) })}
                >
                  <SelectTrigger className="h-8 w-[160px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOLD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.value === 0 ? o.label : `Hold ${o.label}`}
                      </SelectItem>
                    ))}
                    {!HOLD_OPTIONS.some((o) => o.value === settings.autoHoldMinutes) && (
                      <SelectItem value={String(settings.autoHoldMinutes)}>Hold {holdLabel}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="flex items-start justify-between gap-6 border-t border-border pt-4">
            <div>
              <p className="text-sm font-semibold">Push automatic notes</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Off by default: automatic notes appear in “What’s new” without interrupting anyone. Turn on to send a
                push when each one goes live.
              </p>
            </div>
            <Switch
              checked={settings.autoPush}
              disabled={!editable || saving}
              onCheckedChange={(v) => save({ autoPush: v })}
            />
          </div>

          <ul className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
            <li>• Always held as drafts: anything that looks security-related, breaking or deprecating.</li>
            <li>• Held until you publish: changes that only touch the mobile apps — they reach people with the next store update.</li>
            <li>• Published straight away: notes only the Kada team can see.</li>
            <li>• Commit messages are never shown to customers — only the rewritten note is.</li>
          </ul>
        </div>

        <h3 className="pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Publishing</h3>

        <div className="flex items-start justify-between gap-6 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold">Require review before publishing</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Updates must be submitted for review, and someone other than the last editor approves them before
              they go live or get scheduled. Automatic notes wait in review too. Super and platform admins can still
              publish an urgent note directly.
            </p>
          </div>
          <Switch
            checked={settings.requireReview}
            disabled={!editable || saving}
            onCheckedChange={(v) => save({ requireReview: v })}
          />
        </div>

        <div className="flex items-start justify-between gap-6 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold">Send a push notification by default</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              New updates start with push turned on. Authors can switch it off per update. Zone-targeted updates
              never push, because notifications can’t be limited to a zone.
            </p>
          </div>
          <Switch
            checked={settings.defaultNotifyPush}
            disabled={!editable || saving}
            onCheckedChange={(v) => save({ defaultNotifyPush: v })}
          />
        </div>

        {settings.updatedByEmail && (
          <p className="text-[11px] text-muted-foreground">Last changed by {settings.updatedByEmail}</p>
        )}
      </div>

      <DeployQueue role={role} />
    </div>
  );
}

const RELEASE_STATUS: Record<ChangelogRelease["status"], { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-muted text-muted-foreground" },
  processing: { label: "Writing notes", className: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  done: { label: "Done", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
};

function DeployQueue({ role }: { role: string | null }) {
  const navigate = useNavigate();
  const { rows, loading, error } = useLiveCollection<ChangelogRelease>("changelog_releases", {
    orderByField: "createdAt",
    orderDir: "desc",
    limit: 12,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const allowed = canPublish(role);

  const runNow = async () => {
    setBusy("run");
    try {
      const res = await changelogAdmin<{ ran: boolean; reason?: string; created?: number; status?: string }>("runAuto", {});
      if (!res.ran) toast.message(res.reason ?? "Nothing to do.");
      else if (res.status === "done") toast.success(`Wrote ${res.created ?? 0} note${res.created === 1 ? "" : "s"}`);
      else toast.message(`Deploy ${res.status}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't run automatic notes."));
    } finally {
      setBusy(null);
    }
  };

  const retry = async (id: string) => {
    setBusy(id);
    try {
      await changelogAdmin("retryRelease", { id });
      toast.success("Queued again — it runs within 5 minutes, or press Run now.");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't retry."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 pt-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Recent deploys</h3>
        {allowed && (
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={busy === "run"} onClick={runNow}>
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run now
          </Button>
        )}
      </div>

      {loading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted/50" />
      ) : error ? (
        <p className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          Couldn’t load deploys: {error}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">No deploys recorded yet</p>
          <p className="mt-1">
            The next <code className="rounded bg-muted px-1">firebase deploy</code> of functions or hosting records the
            commits it shipped here, and notes are written within about five minutes.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {rows.map((r) => {
            const meta = RELEASE_STATUS[r.status] ?? RELEASE_STATUS.pending;
            const created = toMillis(r.createdAt);
            return (
              <li key={r.id} className="space-y-1.5 px-3 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold">{(r.headSha ?? r.id).slice(0, 7)}</span>
                  <span className="truncate text-muted-foreground">{r.branch}</span>
                  <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", meta.className)}>{meta.label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    {created ? formatRelative(created) : ""}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {r.commitCount} commit{r.commitCount === 1 ? "" : "s"} · {r.target}
                  {r.status === "done" && (
                    <>
                      {" "}· {r.created ?? 0} note{r.created === 1 ? "" : "s"}
                      {r.byStatus &&
                        Object.entries(r.byStatus)
                          .filter(([, n]) => n)
                          .map(([s, n]) => ` · ${n} ${STATUS_META[s as EntryStatus]?.label.toLowerCase() ?? s}`)
                          .join("")}
                    </>
                  )}
                </p>
                {(r.lastError || r.detail) && (
                  <p className={cn("leading-snug", r.lastError ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                    {r.lastError ? `Last error: ${r.lastError}` : r.detail}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(r.entryIds ?? []).slice(0, 6).map((id, i) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => navigate(`/admin/growth/changelog/${id}`)}
                      className="rounded border border-border px-1.5 py-px text-[11px] hover:border-foreground/40"
                    >
                      Note {i + 1}
                    </button>
                  ))}
                  {allowed && (r.status === "failed" || r.status === "skipped") && (
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => retry(r.id)}
                      className="rounded border border-border px-1.5 py-px text-[11px] font-semibold hover:border-foreground/40"
                    >
                      {busy === r.id ? "…" : "Retry"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
