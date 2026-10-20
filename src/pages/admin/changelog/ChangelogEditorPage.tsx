import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { collection, doc, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bold,
  Bot,
  CalendarClock,
  CheckCircle2,
  Heading2,
  Heading3,
  History,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminScope } from "@/hooks/useAdminScope";
import { parseChangelogMarkdown } from "@/lib/changelogMarkdown";
import {
  AUDIENCE_META,
  AUDIENCE_ORDER,
  EMPTY_DRAFT,
  REACTION_EMOJI,
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
  type EntryDraft,
  type EntryStatus,
  type EntryType,
  type Platform,
  type Reaction,
  type Verb,
} from "@/lib/changelog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ChangelogArticle, InAppPreview, StatusPill } from "@/components/changelog/ChangelogPreview";
import { AiDraftDialog } from "@/components/changelog/AiDraftDialog";
import { formatDateTime, formatRelative, toLocalInputValue } from "@/components/changelog/format";

interface RevisionDoc {
  id: string;
  revision: number;
  title: string;
  editorEmail: string;
  savedAt: Timestamp | null;
}

interface EventDoc {
  id: string;
  verb: Verb;
  from: EntryStatus;
  to: EntryStatus;
  actorEmail: string;
  at: Timestamp | null;
  publishAt: Timestamp | null;
}

const ACK_TYPES: EntryType[] = ["breaking", "deprecated", "security"];

const VERB_DONE: Record<Verb, string> = {
  submit: "Submitted for review",
  request_changes: "Sent back to draft",
  schedule: "Scheduled",
  publish: "Published",
  unschedule: "Unscheduled — back in drafts",
  archive: "Archived",
  restore: "Restored to draft",
};

const EVENT_TEXT: Record<Verb, string> = {
  submit: "submitted it for review",
  request_changes: "requested changes",
  schedule: "scheduled it",
  publish: "published it",
  unschedule: "unscheduled it",
  archive: "archived it",
  restore: "restored it to draft",
};

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "ios", label: "iOS" },
  { key: "android", label: "Android" },
  { key: "web", label: "Web" },
];

function toDraft(e: ChangelogEntry): EntryDraft {
  return {
    title: e.title ?? "",
    summary: e.summary ?? "",
    body: e.body ?? "",
    type: e.type ?? "new",
    version: e.version ?? null,
    audiences: e.audiences ?? [],
    public: e.public === true,
    platforms: e.platforms ?? [],
    zoneIds: e.zoneIds ?? [],
    tags: e.tags ?? [],
    coverImage: e.coverImage ?? null,
    cta: e.cta ?? null,
    pinned: e.pinned === true,
    requiresAck: e.requiresAck === true,
    notifyPush: e.notifyPush === true,
  };
}

/**
 * Write, review, schedule and publish one release note.
 *
 * Concurrency: the entry is live-subscribed. If someone else saves while this
 * editor has unsaved changes, their revision is NOT merged into the textarea —
 * a banner offers to load it, and the server rejects a stale save outright
 * (`expectedRevision`), so nobody's words are silently overwritten.
 */
export default function ChangelogEditorPage() {
  const { id = "new" } = useParams<{ id: string }>();
  const isNew = id === "new";
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { role } = usePermissions();
  const { zones } = useAdminScope();

  const duplicateOf = (location.state as { duplicateOf?: EntryDraft } | null)?.duplicateOf ?? null;

  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(() =>
    duplicateOf ? { ...duplicateOf, title: `${duplicateOf.title} (copy)`.slice(0, 120) } : EMPTY_DRAFT,
  );
  const [dirty, setDirty] = useState(Boolean(duplicateOf));
  const [loaded, setLoaded] = useState(isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyVerb, setBusyVerb] = useState<Verb | null>(null);
  const [settings, setSettings] = useState({ requireReview: false, defaultNotifyPush: true });
  const [revisions, setRevisions] = useState<RevisionDoc[]>([]);
  const [events, setEvents] = useState<EventDoc[]>([]);

  const [confirmPublish, setConfirmPublish] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [uploading, setUploading] = useState<"body" | "cover" | null>(null);
  const [tagText, setTagText] = useState("");

  const dirtyRef = useRef(dirty);
  const baseRevisionRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const latestRef = useRef<ChangelogEntry | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const bodyFileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  useEffect(
    () =>
      onSnapshot(
        doc(db, "config", "changelog"),
        (snap) => {
          const d = snap.data() ?? {};
          const next = { requireReview: d.requireReview === true, defaultNotifyPush: d.defaultNotifyPush !== false };
          setSettings(next);
          // A brand-new, untouched draft picks up the team's push default.
          if (isNew && !dirtyRef.current) setDraft((prev) => ({ ...prev, notifyPush: next.defaultNotifyPush }));
        }, (err) => console.error("[ChangelogEditorPage] config listener failed", err),
      ),
    [isNew],
  );

  useEffect(() => {
    if (isNew) {
      setEntry(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setLoadError(null);
    return onSnapshot(
      doc(db, "changelog_entries", id),
      (snap) => {
        if (!snap.exists()) {
          setLoadError("This update doesn't exist, or it was deleted.");
          setLoaded(true);
          return;
        }
        const data = { id: snap.id, ...(snap.data() as Omit<ChangelogEntry, "id">) } as ChangelogEntry;
        latestRef.current = data;
        setEntry(data);
        setLoaded(true);
        if (savingRef.current) return;
        if (baseRevisionRef.current === null || !dirtyRef.current) {
          setDraft(toDraft(data));
          baseRevisionRef.current = data.revision;
          setRemoteChanged(false);
        } else if (data.revision !== baseRevisionRef.current) {
          setRemoteChanged(true);
        }
      },
      (err) => {
        setLoadError(err.message);
        setLoaded(true);
      },
    );
  }, [id, isNew]);

  useEffect(() => {
    if (isNew) {
      setRevisions([]);
      setEvents([]);
      return;
    }
    const unsubRev = onSnapshot(
      query(collection(db, "changelog_entries", id, "revisions"), orderBy("revision", "desc"), limit(30)),
      (snap) => setRevisions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RevisionDoc, "id">) }))), (err) => console.error("[ChangelogEditorPage] changelog_entries listener failed", err),
    );
    const unsubEvents = onSnapshot(
      query(collection(db, "changelog_entries", id, "events"), orderBy("at", "desc"), limit(30)),
      (snap) => setEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventDoc, "id">) }))), (err) => console.error("[ChangelogEditorPage] changelog_entries listener failed", err),
    );
    return () => {
      unsubRev();
      unsubEvents();
    };
  }, [id, isNew]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const status: EntryStatus = entry?.status ?? "draft";
  const blocks = useMemo(() => parseChangelogMarkdown(draft.body), [draft.body]);
  const userEmail = (user?.email ?? "").toLowerCase();
  const lastEditor = (entry?.updatedByEmail ?? entry?.authorEmail ?? "").toLowerCase();
  const override = canOverrideReview(role);

  const readOnly = status === "published" || status === "scheduled" ? !canPublish(role) : !canAuthor(role);
  const saveBlocker =
    draft.title.trim().length < 3
      ? "Add a title (3+ characters)."
      : draft.summary.trim().length < 10
        ? "Add a one-line summary (10+ characters)."
        : !draft.audiences.length && !draft.public
          ? "Pick an audience or publish it on the website."
          : null;

  // Maker-checker, mirrored from the server so buttons explain themselves.
  // Saving makes you the last editor, which disqualifies you as the reviewer.
  const reviewReason = (() => {
    if (!settings.requireReview || override) return null;
    if (status === "draft" || isNew) return "Review is on — submit for review first.";
    if (status === "in_review" && (lastEditor === userEmail || dirty)) {
      return dirty
        ? "Saving your edits makes you the last editor, so someone else must approve."
        : "You made the last edit, so someone else must approve.";
    }
    return null;
  })();

  const apps = AUDIENCE_ORDER.filter((a) => draft.audiences.includes(a) && a !== "admin");
  const pushSummary = !draft.notifyPush
    ? "No push notification."
    : draft.zoneIds.length
      ? "No push — zone-targeted updates appear in-app only."
      : apps.length
        ? `Push notification to ${apps.map((a) => AUDIENCE_META[a].label.toLowerCase()).join(", ")}.`
        : "No push — no app audience selected.";

  // ── Editing ───────────────────────────────────────────────────────────────
  const patch = useCallback((p: Partial<EntryDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (p.type && !ACK_TYPES.includes(p.type)) next.requiresAck = false;
      return next;
    });
    setDirty(true);
    dirtyRef.current = true;
  }, []);

  const save = useCallback(async (): Promise<string | null> => {
    if (saveBlocker) {
      toast.error(saveBlocker);
      return null;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { entry: draft };
      if (!isNew) {
        payload.id = id;
        if (baseRevisionRef.current !== null) payload.expectedRevision = baseRevisionRef.current;
      }
      const res = await changelogAdmin<{ id: string; revision: number; created: boolean }>("save", payload);
      baseRevisionRef.current = res.revision;
      dirtyRef.current = false;
      setDirty(false);
      setRemoteChanged(false);
      toast.success(res.created ? "Draft created" : `Saved · revision ${res.revision}`);
      if (res.created) navigate(`/admin/growth/changelog/${res.id}`, { replace: true });
      return res.id;
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't save this update."));
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, id, isNew, navigate, saveBlocker]);

  const runVerb = async (verb: Verb, publishAt?: number) => {
    let targetId: string | null = isNew ? null : id;
    if (isNew || dirty) {
      targetId = await save();
      if (!targetId) return;
    }
    setBusyVerb(verb);
    try {
      await changelogAdmin("transition", { id: targetId, verb, ...(publishAt ? { publishAt } : {}) });
      toast.success(VERB_DONE[verb]);
    } catch (e) {
      toast.error(errorMessage(e, "That didn't work."));
    } finally {
      setBusyVerb(null);
    }
  };

  const loadTheirs = () => {
    const latest = latestRef.current;
    if (!latest) return;
    setDraft(toDraft(latest));
    baseRevisionRef.current = latest.revision;
    dirtyRef.current = false;
    setDirty(false);
    setRemoteChanged(false);
  };

  const restore = async (revision: number) => {
    if (
      dirty &&
      !(await confirmDialog({
        title: `Restore revision ${revision}?`,
        description: "Your unsaved changes will be discarded.",
        confirmLabel: "Discard and restore",
        destructive: true,
      }))
    )
      return;
    dirtyRef.current = false;
    setDirty(false);
    try {
      await changelogAdmin("restoreRevision", { id, revision });
      toast.success(`Restored revision ${revision} as a new revision`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't restore that revision."));
    }
  };

  const remove = async () => {
    try {
      await changelogAdmin("delete", { id });
      toast.success("Draft deleted");
      navigate("/admin/growth?tab=changelog");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't delete this draft."));
    }
  };

  // Cmd/Ctrl+S saves from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !readOnly && !saving) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, readOnly, saving, save]);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  // ── Body toolbar ──────────────────────────────────────────────────────────
  const editBody = (fn: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const el = bodyRef.current;
    if (!el) return;
    const r = fn(draft.body, el.selectionStart, el.selectionEnd);
    patch({ body: r.text });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };

  const wrap = (marker: string, placeholder: string) =>
    editBody((t, s, e) => {
      const sel = t.slice(s, e) || placeholder;
      return {
        text: t.slice(0, s) + marker + sel + marker + t.slice(e),
        start: s + marker.length,
        end: s + marker.length + sel.length,
      };
    });

  const prefixLines = (prefix: string) =>
    editBody((t, s, e) => {
      const lineStart = t.lastIndexOf("\n", s - 1) + 1;
      const lines = t.slice(lineStart, e).split("\n");
      const replaced = lines
        .map((l, i) => {
          const clean = l.replace(/^(#{1,3}\s+|[-*]\s+|\d{1,3}[.)]\s+|>\s?)/, "");
          return prefix === "1. " ? `${i + 1}. ${clean}` : `${prefix}${clean}`;
        })
        .join("\n");
      return { text: t.slice(0, lineStart) + replaced + t.slice(e), start: lineStart, end: lineStart + replaced.length };
    });

  const insertBlock = (snippet: string) =>
    editBody((t, s) => {
      const before = t.slice(0, s);
      const after = t.slice(s);
      const pre = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const post = after.startsWith("\n") || !after ? "\n" : "\n\n";
      const pos = (before + pre + snippet).length;
      return { text: before + pre + snippet + post + after, start: pos, end: pos };
    });

  const insertLink = () =>
    editBody((t, s, e) => {
      const label = t.slice(s, e) || "link text";
      const snippet = `[${label}](https://)`;
      const urlStart = s + label.length + 3;
      return { text: t.slice(0, s) + snippet + t.slice(e), start: urlStart, end: urlStart + 8 };
    });

  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      wrap("**", "bold text");
    } else if (k === "i") {
      e.preventDefault();
      wrap("*", "italic text");
    } else if (k === "k") {
      e.preventDefault();
      insertLink();
    }
  };

  const upload = async (file: File, target: "body" | "cover") => {
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file.");
    if (file.size > 8 * 1024 * 1024) return toast.error("Images must be under 8 MB.");
    setUploading(target);
    try {
      const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-60);
      const r = storageRef(storage, `changelog_media/${isNew ? "drafts" : id}/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type });
      const url = await getDownloadURL(r);
      if (target === "cover") patch({ coverImage: { url, alt: draft.coverImage?.alt ?? "" } });
      else insertBlock(`![${file.name.replace(/\.[a-z0-9]+$/i, "")}](${url})`);
    } catch (e) {
      toast.error(errorMessage(e, "Upload failed."));
    } finally {
      setUploading(null);
    }
  };

  const addTags = (raw: string) => {
    const next = raw
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9\- ]/g, ""))
      .filter(Boolean);
    if (!next.length) return;
    patch({ tags: Array.from(new Set([...draft.tags, ...next])).slice(0, 8) });
    setTagText("");
  };

  const back = async () => {
    if (
      dirty &&
      !(await confirmDialog({
        title: "Leave without saving?",
        description: "Your unsaved changes will be lost.",
        confirmLabel: "Leave",
        cancelLabel: "Keep editing",
        destructive: true,
      }))
    )
      return;
    navigate("/admin/growth?tab=changelog");
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-amber-500" />
        <p className="mt-3 font-semibold">{loadError}</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/admin/growth?tab=changelog">Back to changelog</Link>
        </Button>
      </div>
    );
  }

  const everPublished = Boolean(entry?.publishedAt);
  const busy = saving || busyVerb !== null;

  const workflow = (() => {
    const btns: React.ReactNode[] = [];
    const author = canAuthor(role);
    const publisher = canPublish(role);
    const liveDisabled = busy || Boolean(reviewReason) || Boolean(saveBlocker);

    if (status === "draft") {
      if (author && settings.requireReview) {
        btns.push(
          <Button key="submit" size="sm" variant="outline" disabled={busy || Boolean(saveBlocker)} onClick={() => runVerb("submit")}>
            {busyVerb === "submit" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Submit for review
          </Button>,
        );
      }
    }
    if (status === "in_review" && author) {
      btns.push(
        <Button key="changes" size="sm" variant="ghost" disabled={busy} onClick={() => runVerb("request_changes")}>
          <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Request changes
        </Button>,
      );
    }
    if ((status === "draft" || status === "in_review") && publisher) {
      btns.push(
        <Button
          key="schedule"
          size="sm"
          variant="outline"
          disabled={liveDisabled}
          onClick={() => {
            setScheduleAt(toLocalInputValue(Math.ceil((Date.now() + 3_600_000) / 900_000) * 900_000));
            setScheduleOpen(true);
          }}
        >
          <CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Schedule
        </Button>,
        <Button key="publish" size="sm" disabled={liveDisabled} onClick={() => setConfirmPublish(true)}>
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {status === "in_review" ? "Approve & publish" : "Publish"}
        </Button>,
      );
    }
    if (status === "scheduled" && publisher) {
      btns.push(
        <Button key="unschedule" size="sm" variant="ghost" disabled={busy} onClick={() => runVerb("unschedule")}>
          Unschedule
        </Button>,
        <Button key="publishnow" size="sm" disabled={busy} onClick={() => setConfirmPublish(true)}>
          <Send className="mr-1.5 h-3.5 w-3.5" /> Publish now
        </Button>,
      );
    }
    if (status === "published" && publisher) {
      btns.push(
        <Button key="archive" size="sm" variant="outline" disabled={busy} onClick={() => runVerb("archive")}>
          <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
        </Button>,
      );
    }
    if (status === "archived" && author) {
      btns.push(
        <Button key="restore" size="sm" variant="outline" disabled={busy} onClick={() => runVerb("restore")}>
          <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore to draft
        </Button>,
      );
    }
    return btns;
  })();

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:-mx-6 md:-mt-6 md:px-6 lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={back}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Changelog
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <StatusPill status={status} />
            {entry && <span className="text-xs text-muted-foreground tabular-nums">rev {entry.revision}</span>}
            {entry?.status === "scheduled" && (
              <span className="text-xs text-muted-foreground">· goes out {formatDateTime(toMillis(entry.publishAt))}</span>
            )}
            {dirty ? (
              <span className="text-xs font-medium text-amber-600">Unsaved changes</span>
            ) : entry ? (
              <span className="text-xs text-muted-foreground">Saved {formatRelative(toMillis(entry.updatedAt))}</span>
            ) : null}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!readOnly && (
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || busy || Boolean(saveBlocker)}
                onClick={() => void save()}
                title={saveBlocker ?? "Save (⌘S)"}
              >
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save
              </Button>
            )}
            {workflow}
          </div>
        </div>
        {(reviewReason || (saveBlocker && dirty)) && (
          <p className="mt-2 text-right text-[11px] text-muted-foreground">{saveBlocker && dirty ? saveBlocker : reviewReason}</p>
        )}
      </div>

      {entry?.source === "auto" && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.06] px-4 py-3 text-sm">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
          <div className="flex-1 space-y-0.5">
            <p>
              Written automatically from a deploy
              {entry.releaseId ? <span className="font-mono text-xs"> ({entry.releaseId.slice(0, 7)})</span> : null}. Check
              the wording — the model only saw commit messages.
            </p>
            {entry.autoHeldReason && entry.status === "draft" && (
              <p className="text-xs text-amber-700 dark:text-amber-400">Held: {entry.autoHeldReason}</p>
            )}
          </div>
        </div>
      )}

      {remoteChanged && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="flex-1">
            <b>{latestRef.current?.updatedByEmail ?? "Someone"}</b> saved a newer version while you were editing.
            Saving now will be refused so neither version is lost.
          </span>
          <Button size="sm" variant="outline" onClick={loadTheirs}>
            Load their version
          </Button>
        </div>
      )}

      {readOnly && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {status === "published" || status === "scheduled"
            ? "This update is live or scheduled — only someone who can publish may edit it."
            : `Your role (${role ?? "unknown"}) can view but not edit release notes.`}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── Writing ─────────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <fieldset disabled={readOnly} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs">Type</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {TYPE_ORDER.map((t) => {
                  const meta = TYPE_META[t];
                  const active = draft.type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patch({ type: t })}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left transition-colors",
                        active ? "border-foreground/50 bg-muted/60 ring-1 ring-foreground/10" : "border-border hover:border-foreground/30",
                      )}
                      title={meta.hint}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground line-clamp-2">{meta.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="cl-title" className="text-xs">
                  Title
                </Label>
                <span className="text-[11px] text-muted-foreground tabular-nums">{draft.title.length} / 120</span>
              </div>
              <Input
                id="cl-title"
                value={draft.title}
                maxLength={120}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Pay for delivery with Kada Gold points"
                className="h-11 text-base font-semibold"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="cl-summary" className="text-xs">
                  Summary <span className="font-normal text-muted-foreground">— shown in push notifications and cards</span>
                </Label>
                <span
                  className={cn(
                    "text-[11px] tabular-nums",
                    draft.summary.length > 180 ? "text-amber-600" : "text-muted-foreground",
                  )}
                >
                  {draft.summary.length} / 280
                </span>
              </div>
              <Textarea
                id="cl-summary"
                value={draft.summary}
                maxLength={280}
                rows={2}
                onChange={(e) => patch({ summary: e.target.value })}
                placeholder="Gold members can now cover the delivery fee with points at checkout."
                className="resize-none"
              />
              {draft.summary.length > 180 && (
                <p className="text-[11px] text-amber-600">Push notifications usually cut off around 180 characters.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="cl-body" className="text-xs">
                  Details
                </Label>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAiOpen(true)}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" /> Draft with AI
                </Button>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card focus-within:ring-2 focus-within:ring-ring/30">
                <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-1.5 py-1">
                  {[
                    { icon: Heading2, label: "Heading", run: () => prefixLines("## ") },
                    { icon: Heading3, label: "Subheading", run: () => prefixLines("### ") },
                    { icon: Bold, label: "Bold (⌘B)", run: () => wrap("**", "bold text") },
                    { icon: Italic, label: "Italic (⌘I)", run: () => wrap("*", "italic text") },
                    { icon: Link2, label: "Link (⌘K)", run: insertLink },
                    { icon: List, label: "Bulleted list", run: () => prefixLines("- ") },
                    { icon: ListOrdered, label: "Numbered list", run: () => prefixLines("1. ") },
                    { icon: Quote, label: "Quote", run: () => prefixLines("> ") },
                    { icon: Minus, label: "Divider", run: () => insertBlock("---") },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      title={b.label}
                      aria-label={b.label}
                      onClick={b.run}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    >
                      <b.icon className="h-4 w-4" />
                    </button>
                  ))}
                  <span className="mx-1 h-4 w-px bg-border" />
                  <button
                    type="button"
                    title="Insert image"
                    aria-label="Insert image"
                    onClick={() => bodyFileRef.current?.click()}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    {uploading === "body" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  </button>
                  <input
                    ref={bodyFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f, "body");
                      e.target.value = "";
                    }}
                  />
                </div>
                <Textarea
                  id="cl-body"
                  ref={bodyRef}
                  value={draft.body}
                  onChange={(e) => patch({ body: e.target.value })}
                  onKeyDown={onBodyKeyDown}
                  placeholder={"## What changed\n\n- Tap **Use points** at checkout to cover the delivery fee\n- Works on every order over ₹149\n\n## Why\n\nGold members asked for it more than anything else."}
                  className="min-h-[340px] resize-y rounded-none border-0 font-mono text-[13px] leading-relaxed focus-visible:ring-0"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Supports <code>## headings</code>, <code>- bullets</code>, <code>1. numbered</code>, <code>**bold**</code>,{" "}
                <code>*italic*</code>, <code>`code`</code>, <code>[links](https://…)</code>, <code>&gt; quotes</code> and images.
                Raw HTML isn’t rendered.
              </p>
            </div>
          </fieldset>

          {!isNew && canAuthor(role) && !everPublished && status !== "scheduled" && (
            <div className="border-t border-border pt-4">
              <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-600" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete draft
              </Button>
            </div>
          )}
        </div>

        {/* ── Side panel ─────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <Tabs defaultValue="preview" className="xl:sticky xl:top-20">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="targeting">Targeting</TabsTrigger>
              <TabsTrigger value="history" disabled={isNew}>
                History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="mt-4">
              <Tabs defaultValue="app">
                <TabsList className="h-8">
                  <TabsTrigger value="app" className="text-xs">
                    In app
                  </TabsTrigger>
                  <TabsTrigger value="web" className="text-xs">
                    Website
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="app" className="mt-4">
                  <InAppPreview draft={draft} blocks={blocks} dateMs={toMillis(entry?.publishedAt) || Date.now()} />
                </TabsContent>
                <TabsContent value="web" className="mt-4">
                  {draft.public ? (
                    <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-background p-4">
                      <ChangelogArticle
                        title={draft.title}
                        type={draft.type}
                        version={draft.version}
                        dateMs={toMillis(entry?.publishedAt) || Date.now()}
                        coverImage={draft.coverImage}
                        blocks={blocks}
                        cta={draft.cta}
                        pinned={draft.pinned}
                      />
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      Not on the website. Turn on “Publish on the website” under Targeting to show it at /changelog.
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="targeting" className="mt-4">
              <fieldset disabled={readOnly} className="space-y-5 rounded-xl border border-border bg-card p-4">
                <div className="space-y-2">
                  <Label className="text-xs">Who sees it</Label>
                  <div className="space-y-1.5">
                    {AUDIENCE_ORDER.map((a) => (
                      <label key={a} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-muted/40">
                        <Checkbox
                          checked={draft.audiences.includes(a)}
                          onCheckedChange={(v) =>
                            patch({
                              audiences: v
                                ? AUDIENCE_ORDER.filter((x) => x === a || draft.audiences.includes(x))
                                : draft.audiences.filter((x) => x !== a),
                            })
                          }
                        />
                        <span className="text-sm font-medium">{AUDIENCE_META[a].label}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">{AUDIENCE_META[a].app}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Publish on the website</p>
                      <p className="text-[11px] text-muted-foreground">Listed publicly at /changelog</p>
                    </div>
                    <Switch checked={draft.public} onCheckedChange={(v) => patch({ public: v })} />
                  </div>
                  {draft.audiences.length === 1 && draft.audiences[0] === "admin" && !draft.public && (
                    <p className="text-[11px] text-muted-foreground">Internal note — hidden from every app and the website.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">
                    Platforms <span className="font-normal text-muted-foreground">— none selected means all</span>
                  </Label>
                  <div className="flex gap-3">
                    {PLATFORMS.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={draft.platforms.includes(p.key)}
                          onCheckedChange={(v) =>
                            patch({
                              platforms: v
                                ? PLATFORMS.map((x) => x.key).filter((k) => k === p.key || draft.platforms.includes(k))
                                : draft.platforms.filter((k) => k !== p.key),
                            })
                          }
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">
                    Zones <span className="font-normal text-muted-foreground">— none selected means every zone</span>
                  </Label>
                  {zones.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No service zones yet, so this goes to every area.</p>
                  ) : (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                      {zones.map((z) => (
                        <label key={z.id} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={draft.zoneIds.includes(z.id)}
                            onCheckedChange={(v) =>
                              patch({
                                zoneIds: v ? [...draft.zoneIds, z.id] : draft.zoneIds.filter((x) => x !== z.id),
                              })
                            }
                          />
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: z.colour || "#94A3B8" }} />
                          {z.name || z.id}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Version</Label>
                    <Input
                      value={draft.version ?? ""}
                      onChange={(e) => patch({ version: e.target.value || null })}
                      placeholder="2.4.1"
                      className="h-9 font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tags</Label>
                    <Input
                      value={tagText}
                      onChange={(e) => setTagText(e.target.value)}
                      onBlur={() => addTags(tagText)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addTags(tagText);
                        }
                      }}
                      placeholder="checkout, gold"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                {draft.tags.length > 0 && (
                  <div className="-mt-2 flex flex-wrap gap-1">
                    {draft.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => patch({ tags: draft.tags.filter((x) => x !== t) })}
                        className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] hover:line-through"
                        title="Remove tag"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs">Cover image</Label>
                  {draft.coverImage?.url ? (
                    <div className="space-y-2">
                      <img src={draft.coverImage.url} alt="" className="w-full rounded-lg border border-border object-cover" />
                      <Input
                        value={draft.coverImage.alt}
                        onChange={(e) => patch({ coverImage: { url: draft.coverImage!.url, alt: e.target.value } })}
                        placeholder="Describe the image for screen readers"
                        className="h-9 text-sm"
                      />
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => patch({ coverImage: null })}>
                        Remove image
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => coverFileRef.current?.click()}>
                      {uploading === "cover" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                      Upload cover image
                    </Button>
                  )}
                  <input
                    ref={coverFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f, "cover");
                      e.target.value = "";
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Button</Label>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <Input
                      value={draft.cta?.label ?? ""}
                      onChange={(e) =>
                        patch({ cta: e.target.value || draft.cta?.url ? { label: e.target.value, url: draft.cta?.url ?? "" } : null })
                      }
                      placeholder="Try it"
                      maxLength={32}
                      className="h-9 text-sm"
                    />
                    <Input
                      value={draft.cta?.url ?? ""}
                      onChange={(e) =>
                        patch({ cta: e.target.value || draft.cta?.label ? { label: draft.cta?.label ?? "", url: e.target.value } : null })
                      }
                      placeholder="kada://checkout or https://…"
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <ToggleRow
                    title="Pin to the top"
                    detail="Stays first in What’s new and on the website."
                    checked={draft.pinned}
                    onChange={(v) => patch({ pinned: v })}
                  />
                  <ToggleRow
                    title="Require acknowledgement"
                    detail={
                      ACK_TYPES.includes(draft.type)
                        ? "People must tap “I understand” before they can dismiss it."
                        : "Only for Breaking, Deprecated or Security updates."
                    }
                    checked={draft.requiresAck}
                    disabled={!ACK_TYPES.includes(draft.type)}
                    onChange={(v) => patch({ requiresAck: v })}
                  />
                  <ToggleRow
                    title="Send a push notification"
                    detail={
                      draft.zoneIds.length
                        ? "Zone-targeted updates don’t push — notifications can’t be limited to a zone."
                        : "Sent once, when it goes live."
                    }
                    checked={draft.notifyPush}
                    onChange={(v) => patch({ notifyPush: v })}
                  />
                </div>
              </fieldset>
            </TabsContent>

            <TabsContent value="history" className="mt-4 space-y-4">
              {entry && everPublished && (
                <section className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-bold">Delivery</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <Stat label="Views" value={entry.stats?.views ?? 0} />
                    <Stat
                      label="Reactions"
                      value={Object.values(entry.stats?.reactions ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)}
                    />
                    <Stat label="Acknowledged" value={entry.requiresAck ? entry.stats?.acks ?? 0 : "—"} />
                  </div>
                  <div className="mt-3 flex gap-2 text-sm">
                    {(Object.keys(REACTION_EMOJI) as Reaction[]).map((k) => (
                      <span key={k} className="rounded-full border border-border px-2 py-0.5 tabular-nums">
                        {REACTION_EMOJI[k]} {entry.stats?.reactions?.[k] ?? 0}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {entry.notifySkippedReason ? (
                      <p>{entry.notifySkippedReason}</p>
                    ) : entry.notifyResult ? (
                      Object.entries(entry.notifyResult).map(([aud, r]) => (
                        <p key={aud}>
                          Push to {aud}:{" "}
                          {r.error ? <span className="text-rose-600">failed — {r.error}</span> : `${r.pushed ?? 0} devices of ${r.recipients ?? 0} people`}
                        </p>
                      ))
                    ) : entry.notifyPush ? (
                      <p>Push pending.</p>
                    ) : (
                      <p>No push notification was sent.</p>
                    )}
                  </div>
                </section>
              )}

              <section className="rounded-xl border border-border bg-card">
                <h3 className="flex items-center gap-1.5 border-b border-border px-4 py-3 text-sm font-bold">
                  <History className="h-3.5 w-3.5" /> Revisions
                </h3>
                {revisions.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">No saved revisions.</p>
                ) : (
                  <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                    {revisions.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">r{r.revision}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{r.title}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {r.editorEmail} · {formatRelative(toMillis(r.savedAt))}
                          </p>
                        </div>
                        {entry && r.revision !== entry.revision && !readOnly && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => restore(r.revision)}>
                            <RotateCcw className="mr-1 h-3 w-3" /> Restore
                          </Button>
                        )}
                        {entry && r.revision === entry.revision && (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Current" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card">
                <h3 className="border-b border-border px-4 py-3 text-sm font-bold">Activity</h3>
                {events.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">No workflow activity yet.</p>
                ) : (
                  <ol className="max-h-72 space-y-0 overflow-y-auto px-4 py-2">
                    {events.map((ev) => (
                      <li key={ev.id} className="relative border-l border-border py-2 pl-4">
                        <span className="absolute -left-[4px] top-3 h-2 w-2 rounded-full bg-primary/70" />
                        <p className="text-xs">
                          <b className="font-semibold">{ev.actorEmail === "scheduler" ? "Scheduler" : ev.actorEmail}</b>{" "}
                          {EVENT_TEXT[ev.verb] ?? ev.verb}
                          {ev.verb === "schedule" && ev.publishAt ? ` for ${formatDateTime(toMillis(ev.publishAt))}` : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{formatRelative(toMillis(ev.at))}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Publish confirmation */}
      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish “{draft.title || "this update"}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>It goes live immediately:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    {apps.length
                      ? `In What’s new for ${apps.map((a) => AUDIENCE_META[a].app).join(", ")}`
                      : "Not shown in any app"}
                    {draft.zoneIds.length ? ` — ${draft.zoneIds.length} zone${draft.zoneIds.length === 1 ? "" : "s"} only` : ""}
                  </li>
                  <li>{draft.public ? "On the public website at /changelog" : "Not on the website"}</li>
                  <li>{pushSummary}</li>
                  {draft.requiresAck && <li>People must confirm they’ve read it.</li>}
                </ul>
                {dirty && <p className="text-amber-600">Your unsaved changes will be saved first.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmPublish(false);
                void runVerb("publish");
              }}
            >
              Publish now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule this update</DialogTitle>
            <DialogDescription>
              It publishes automatically within 5 minutes of this time. {pushSummary}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            value={scheduleAt}
            min={toLocalInputValue(Date.now() + 2 * 60_000)}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!scheduleAt || busy}
              onClick={() => {
                const at = new Date(scheduleAt).getTime();
                if (!Number.isFinite(at) || at < Date.now() + 60_000) {
                  toast.error("Pick a time at least a couple of minutes from now.");
                  return;
                }
                setScheduleOpen(false);
                void runVerb("schedule", at);
              }}
            >
              <CalendarClock className="mr-1.5 h-4 w-4" /> Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft and every saved revision are removed permanently. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-rose-600 hover:bg-rose-700">
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AiDraftDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        type={draft.type}
        audiences={draft.audiences as Audience[]}
        hasContent={Boolean(draft.title || draft.summary || draft.body)}
        onUse={(d) => patch({ title: d.title, summary: d.summary, body: d.body })}
      />
    </div>
  );
}

function ToggleRow({
  title,
  detail,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-60")}>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{detail}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-2">
      <p className="text-lg font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
