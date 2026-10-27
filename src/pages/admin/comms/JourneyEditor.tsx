import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { comms, commsOp, errMessage, num, pct, when } from "./commsApi";
import { ConditionsEditor, describeCondition, USER_TYPES } from "./ConditionsEditor";
import {
  ADDABLE, BUNDLED, JOURNEY_STATUS_TONE, STEP_META, blankStep, duration, eventLabel, newStepId, pctOf, slots, summarize,
  type Journey, type JourneyCatalog, type Step, type StepType,
} from "./journeyTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import {
  AlertTriangle, ArrowLeft, Archive, CirclePlay, FlaskConical, Loader2, LogOut, MoreHorizontal, Pause, Play, Plus,
  RefreshCw, Save, Trash2, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Template { key: string; name: string; category: string; seeded?: boolean }
interface Detail {
  waiting: Record<string, number>;
  recent: {
    id: string; userId: string; email: string | null; status: string; stepId: string | null; holdout: boolean; test: boolean;
    enteredAt: number; convertedAt: number | null; exitReason: string | null; nextRunAt: number | null;
    path: { s: string; at: number; o?: string }[];
  }[];
}

const EMPTY: Omit<Journey, "id"> = {
  name: "", description: "", app: "customer", userType: "CUSTOMER", status: "draft",
  entry: { type: "event", event: "order.delivered" },
  startStepId: "email-1",
  steps: [{ id: "email-1", type: "email", templateKey: "", next: null }],
  goal: { event: "order.placed", withinDays: 7 }, exitOnGoal: true, exitEvents: [],
  reentry: { mode: "cooldown", days: 30 }, holdoutPercent: 10, onlyOptedIn: true,
};

const EDITABLE: (keyof Journey)[] = [
  "name", "description", "app", "userType", "entry", "startStepId", "steps", "goal", "exitOnGoal",
  "exitEvents", "reentry", "holdoutPercent", "onlyOptedIn", "libraryKey",
];
const pick = (j: Partial<Journey>) => Object.fromEntries(EDITABLE.map((k) => [k, j[k] ?? null]));

/**
 * One journey: the flow on the left (click a step to edit, + to insert),
 * settings and results on the right. Saving re-validates on the server.
 */
export default function JourneyEditor({ id, catalog, onClose, onCreated }: {
  id: string | null;
  catalog: JourneyCatalog | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [saved, setSaved] = useState<Journey | null>(null);
  const [draft, setDraft] = useState<Omit<Journey, "id"> | null>(id ? null : { ...EMPTY });
  const [missing, setMissing] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "journeys", id), (s) => {
      if (!s.exists()) { setMissing(true); return; }
      const j = { id: s.id, ...(s.data() as Omit<Journey, "id">) };
      setSaved(j);
      // Live counters update constantly; only reset the draft on first load.
      setDraft((cur) => cur ?? j);
    }, (err) => { console.error("[JourneyEditor] journey listener failed", err); setMissing(true); });
  }, [id]);

  // Published templates, plus the platform defaults not seeded yet — so a
  // journey can be built before "Set up everything" has run. Unseeded ones
  // are marked, and going live is refused until they're published.
  useEffect(() => onSnapshot(collection(db, "emailTemplates"), (s) => {
    const live = s.docs.filter((d) => d.data().status === "published" && (d.data().language || "en") === "en")
      .map((d) => ({ key: (d.data().key as string) || d.id.replace(/__en$/, ""), name: (d.data().name as string) || d.id, category: d.data().category as string, seeded: true }));
    const have = new Set(live.map((t) => t.key));
    const pending = BUNDLED.templates.filter((t) => !have.has(t.key)).map((t) => ({ ...t, seeded: false }));
    setTemplates([...live, ...pending].sort((a, b) => a.name.localeCompare(b.name)));
  }, (err) => {
    console.error("[JourneyEditor] templates listener failed", err);
    setTemplates(BUNDLED.templates.map((t) => ({ ...t, seeded: false })));
  }), []);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    try { setDetail(await comms<Detail>("journeyDetail", { id })); } catch { /* panel shows its own empty state */ }
  }, [id]);
  useEffect(() => {
    loadDetail();
    const t = setInterval(loadDetail, 60_000);
    return () => clearInterval(t);
  }, [loadDetail]);

  const events = catalog?.events || [];
  const fields = catalog?.segmentFields || [];
  const tName = useCallback((k?: string) => {
    const t = templates.find((x) => x.key === k);
    return t ? `${t.name}${t.seeded ? "" : " · not set up yet"}` : k ? `${k} (not published)` : "Choose a template";
  }, [templates]);
  const marketingKeys = useMemo(() => new Set(templates.filter((t) => t.category === "marketing" || t.category === "announcements").map((t) => t.key)), [templates]);

  const dirty = !!draft && (!saved || JSON.stringify(pick(draft)) !== JSON.stringify(pick(saved)));
  const status = saved?.status || "draft";

  if (missing) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">This journey no longer exists.</p>
        <Button variant="outline" className="mt-3" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1.5" />Back to journeys</Button>
      </div>
    );
  }
  if (!draft) return <div className="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading journey…</div>;

  const set = (patch: Partial<Journey>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const byId = new Map(draft.steps.map((s) => [s.id, s]));

  // ── Graph edits ──────────────────────────────────────────────────────────
  const insert = (parent: string | null, slot: string | null, type: StepType) => {
    const child = parent ? ((byId.get(parent) as unknown as Record<string, string | null>)[slot!] ?? null) : draft.startStepId;
    const sid = newStepId(draft.steps, type);
    const step = blankStep(type, sid, type === "exit" ? null : child);
    const steps = draft.steps.map((s) => (s.id === parent ? { ...s, [slot!]: sid } : s));
    set({ steps: [...steps, step], ...(parent ? {} : { startStepId: sid }) });
    setEditing(sid);
  };
  const updateStep = (sid: string, patch: Partial<Step>) => set({ steps: draft.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const outs = (s: Step) => slots(s).map((x) => (s as unknown as Record<string, string | null>)[x.key]).filter((v): v is string => !!v);
  const removable = (s: Step) => new Set(outs(s)).size <= 1;
  const removeStep = (sid: string) => {
    const s = byId.get(sid);
    if (!s) return;
    const to = outs(s)[0] ?? null;
    const keys = ["next", "timeoutNext", "yes", "no", "a", "b"] as const;
    const steps = draft.steps.filter((x) => x.id !== sid).map((x) => {
      const y = { ...x } as Record<string, unknown>;
      for (const k of keys) if (y[k] === sid) y[k] = to;
      return y as unknown as Step;
    });
    const start = draft.startStepId === sid ? (to || steps[0]?.id || "") : draft.startStepId;
    set({ steps, startStepId: start });
    setEditing(null);
  };

  // ── Server actions ───────────────────────────────────────────────────────
  const save = async (): Promise<string | null> => {
    const r = await commsOp<{ id: string }>("saveJourney", { id, journey: draft }, id ? "Journey saved" : "Journey created", setBusy);
    if (r && !id) onCreated(r.id);
    return r?.id ?? null;
  };
  const setStatus = async (next: string) => {
    if (dirty && !(await save())) return;
    const msg = next === "live" ? "Live — people will start entering" : next === "paused" ? "Paused — everyone holds where they are" : next === "archived" ? "Archived" : "Back to draft";
    await commsOp("setJourneyStatus", { id, status: next }, msg, setBusy);
  };
  const remove = async () => {
    const r = await commsOp("deleteJourney", { id }, "Journey deleted", setBusy);
    if (r) onClose();
  };

  // ── Results ──────────────────────────────────────────────────────────────
  const st = saved?.stats || {};
  const treatedN = Number(st.entered || 0) - Number(st.holdoutEntered || 0);
  const convT = pctOf(st.converted, treatedN);
  const convH = pctOf(st.holdoutConverted, st.holdoutEntered);
  const liftPts = convT !== null && convH !== null && Number(st.holdoutEntered || 0) >= 30 ? convT - convH : null;
  const em = saved?.emailStats || {};
  const hasMarketing = draft.steps.some((s) => s.type === "email" && marketingKeys.has(s.templateKey || ""));
  const live = status === "live";

  // ── Flow rendering ──────────────────────────────────────────────────────
  const seen = new Set<string>();
  const renderFrom = (sid: string | null, parent: string | null, slot: string | null): ReactNode => {
    const adder = <AddStep onPick={(t) => insert(parent, slot, t)} />;
    if (!sid) {
      return (
        <div className="flex flex-col items-center">
          {adder}
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">End</span>
        </div>
      );
    }
    const s = byId.get(sid);
    if (!s) return <p className="text-xs text-rose-600">Missing step “{sid}”</p>;
    if (seen.has(sid)) {
      return (
        <div className="flex flex-col items-center">
          {adder}
          <button type="button" onClick={() => setEditing(sid)}
            className="mt-1 rounded-full border border-dashed px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted">
            continues at “{s.label || STEP_META[s.type].label}”
          </button>
        </div>
      );
    }
    seen.add(sid);
    const sl = slots(s);
    return (
      <div className="flex flex-col items-center w-full">
        {adder}
        <StepCard step={s} summary={summarize(s, events, tName)} stats={saved?.stepStats?.[s.id]} waiting={detail?.waiting?.[s.id]}
          selected={editing === s.id} onClick={() => setEditing(s.id)}
          warn={s.type === "email" && !templates.some((t) => t.key === s.templateKey && t.seeded)} />
        {sl.length === 1 && (
          <>
            <Connector />
            {renderFrom((s as unknown as Record<string, string | null>)[sl[0].key] ?? null, s.id, sl[0].key)}
          </>
        )}
        {sl.length === 2 && (
          <div className="grid grid-cols-2 gap-4 w-full mt-1">
            {sl.map((x) => (
              <div key={x.key} className="flex flex-col items-center min-w-0">
                <Connector />
                <Badge variant="outline" className="text-[10px] mb-0.5">{x.label}</Badge>
                {renderFrom((s as unknown as Record<string, string | null>)[x.key] ?? null, s.id, x.key)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const selected = editing ? byId.get(editing) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" />Journeys</Button>
        <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Journey name"
          className="h-9 w-full sm:w-72 font-semibold" />
        <Badge variant="outline" className={cn("capitalize", JOURNEY_STATUS_TONE[status])}>{status}</Badge>
        {saved?.version ? <span className="text-[11px] text-muted-foreground">v{saved.version}{saved.updatedBy ? ` · ${saved.updatedBy}` : ""}</span> : null}
        <div className="flex flex-wrap gap-2 ml-auto">
          {id && <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}><FlaskConical className="h-4 w-4 mr-1.5" />Test</Button>}
          <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || busy} onClick={save}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}{id ? "Save" : "Create"}
          </Button>
          {id && (live
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("paused")}><Pause className="h-4 w-4 mr-1.5" />Pause</Button>
            : status !== "archived" && <Button size="sm" disabled={busy} onClick={() => setStatus("live")} className="bg-emerald-600 hover:bg-emerald-700"><Play className="h-4 w-4 mr-1.5" />{status === "paused" ? "Resume" : "Go live"}</Button>)}
          {id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-9 w-9" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {status === "paused" && <DropdownMenuItem onClick={() => setStatus("draft")}>Back to draft</DropdownMenuItem>}
                {status !== "archived" && <DropdownMenuItem onClick={() => setStatus("archived")}><Archive className="h-4 w-4 mr-2" />Archive</DropdownMenuItem>}
                {status === "archived" && <DropdownMenuItem onClick={() => setStatus("paused")}>Restore (paused)</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {live && dirty && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          Saving changes a live journey for everyone in it. People waiting on a step you remove finish their run.
        </div>
      )}
      {hasMarketing && !draft.onlyOptedIn && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-2.5 text-xs flex gap-2">
          <AlertTriangle className="h-4 w-4 text-sky-600 shrink-0" />
          This journey sends marketing email but lets everyone in. People who haven't opted in will skip those emails — turn on “Only opted-in people” if the journey is purely promotional.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-12">
        {/* Flow */}
        <Card className="rounded-2xl xl:col-span-8 overflow-hidden">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Flow</CardTitle>
            <span className="text-[11px] text-muted-foreground">Click a step to edit · + to insert</span>
          </CardHeader>
          <CardContent className="overflow-x-auto bg-[radial-gradient(circle,_hsl(var(--muted-foreground)/0.15)_1px,_transparent_1px)] [background-size:16px_16px]">
            <div className="min-w-[560px] flex flex-col items-center py-4">
              <EntryCard journey={draft} events={events} fields={fields} entered={st.entered} />
              <Connector />
              {renderFrom(draft.startStepId || null, null, null)}
            </div>
          </CardContent>
        </Card>

        {/* Settings + results */}
        <div className="xl:col-span-4 space-y-4">
          {id && (
            <Card className="rounded-2xl">
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Results</CardTitle>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Refresh" onClick={loadDetail}><RefreshCw className="h-3.5 w-3.5" /></Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Mini label="Entered" value={num(st.entered)} />
                  <Mini label="In it now" value={num(Math.max(0, Number(st.active || 0)))} />
                  <Mini label="Finished" value={num(Number(st.completed || 0) + Number(st.exited || 0))} />
                </div>
                {draft.goal ? (
                  <div className="rounded-xl border p-3 space-y-1.5 text-sm">
                    <Row label="Reached goal (got messages)" value={`${num(st.converted)} · ${pct(convT)}`} />
                    <Row label={`Holdout (${draft.holdoutPercent}%)`} value={Number(st.holdoutEntered || 0) ? `${num(st.holdoutConverted)} of ${num(st.holdoutEntered)} · ${pct(convH)}` : "—"} />
                    <Row label="Lift" value={liftPts === null ? (draft.holdoutPercent ? "needs 30+ in holdout" : "no holdout") : `${liftPts >= 0 ? "+" : ""}${(liftPts * 100).toFixed(1)} pts`}
                      tone={liftPts === null ? undefined : liftPts > 0 ? "text-emerald-600" : "text-rose-600"} />
                    <Row label="Value of goals reached" value={`₹${Math.round(Number(st.revenue || 0)).toLocaleString("en-IN")}`} />
                  </div>
                ) : <p className="text-xs text-muted-foreground">Add a goal to measure conversions and lift.</p>}
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Mini label="Sent" value={num(em.sent)} />
                  <Mini label="Delivered" value={pct(pctOf(em.delivered, em.sent))} />
                  <Mini label="Opened" value={pct(pctOf(em.opened, em.sent))} />
                  <Mini label="Clicked" value={pct(pctOf(em.clicked, em.sent))} />
                </div>
                {draft.entry.type === "segment" && saved?.scan?.lastFinishedAt && (
                  <p className="text-[11px] text-muted-foreground">Audience last scanned {when(saved.scan.lastFinishedAt)} · {num(saved.scan.lastEntered)} entered.</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Who it's for">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={draft.userType || "any"} onValueChange={(v) => set({ userType: v === "any" ? null : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Anyone</SelectItem>
                      {USER_TYPES.map((u) => <SelectItem key={u.v} value={u.v}>{u.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={draft.app} onValueChange={(v) => set({ app: v as Journey["app"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["customer", "vendor", "delivery", "host", "all"].map((a) => <SelectItem key={a} value={a} className="capitalize">{a === "all" ? "All apps" : `${a} app`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </Field>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Only opted-in people</p>
                  <p className="text-[11px] text-muted-foreground">Enter only if they said yes to offers.</p>
                </div>
                <Switch checked={draft.onlyOptedIn} onCheckedChange={(v) => set({ onlyOptedIn: v })} />
              </div>
              <Field label="Starts when">
                <Select value={draft.entry.type} onValueChange={(v) => set({ entry: v === "event" ? { type: "event", event: "order.delivered" } : { type: "segment", conditions: [{ field: "inactiveDays", op: "eq", value: 30 }] } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="event">Something happens (event)</SelectItem>
                    <SelectItem value="segment">They match an audience (checked daily)</SelectItem>
                  </SelectContent>
                </Select>
                {draft.entry.type === "event" ? (
                  <EventSelect value={draft.entry.event} events={events} onChange={(v) => set({ entry: { type: "event", event: v } })} />
                ) : (
                  <div className="mt-2 rounded-xl border p-3">
                    <ConditionsEditor fields={fields} conditions={draft.entry.conditions || []} onChange={(c) => set({ entry: { type: "segment", conditions: c } })} />
                  </div>
                )}
              </Field>
              <Field label="Goal">
                <div className="flex gap-2">
                  <Select value={draft.goal?.event || "none"} onValueChange={(v) => set({ goal: v === "none" ? null : { event: v, withinDays: draft.goal?.withinDays || 7 } })}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No goal</SelectItem>
                      {events.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {draft.goal && (
                    <div className="flex items-center gap-1">
                      <Input type="number" className="w-16" value={draft.goal.withinDays}
                        onChange={(e) => set({ goal: { ...draft.goal!, withinDays: Number(e.target.value) || 1 } })} />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                  )}
                </div>
                {draft.goal && (
                  <label className="flex items-center gap-2 mt-2 text-xs">
                    <Switch checked={draft.exitOnGoal} onCheckedChange={(v) => set({ exitOnGoal: v })} />Stop the journey when they reach it
                  </label>
                )}
              </Field>
              <Field label="Also stop if">
                <div className="flex flex-wrap gap-1.5">
                  {draft.exitEvents.map((ev) => (
                    <Badge key={ev} variant="secondary" className="gap-1">
                      {eventLabel(ev, events)}
                      <button type="button" aria-label="Remove" onClick={() => set({ exitEvents: draft.exitEvents.filter((x) => x !== ev) })}>×</button>
                    </Badge>
                  ))}
                  <Select value="" onValueChange={(v) => v && !draft.exitEvents.includes(v) && set({ exitEvents: [...draft.exitEvents, v].slice(0, 5) })}>
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="+ event" /></SelectTrigger>
                    <SelectContent>{events.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </Field>
              <Field label="Can someone go through it again?">
                <div className="flex gap-2">
                  <Select value={draft.reentry.mode} onValueChange={(v) => set({ reentry: v === "cooldown" ? { mode: "cooldown", days: draft.reentry.days || 30 } : { mode: v as "once" | "always" } })}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">Only once, ever</SelectItem>
                      <SelectItem value="cooldown">Again after a cooldown</SelectItem>
                      <SelectItem value="always">Every time it triggers</SelectItem>
                    </SelectContent>
                  </Select>
                  {draft.reentry.mode === "cooldown" && (
                    <div className="flex items-center gap-1">
                      <Input type="number" className="w-16" value={draft.reentry.days || 30}
                        onChange={(e) => set({ reentry: { mode: "cooldown", days: Number(e.target.value) || 1 } })} />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                  )}
                </div>
              </Field>
              <Field label={`Holdout: ${draft.holdoutPercent}%`}>
                <input type="range" min={0} max={50} step={5} value={draft.holdoutPercent} className="w-full accent-primary"
                  onChange={(e) => set({ holdoutPercent: Number(e.target.value) })} />
                <p className="text-[11px] text-muted-foreground">
                  This share walks the journey but gets no messages, so you can see whether the journey itself causes the goal. 10% is typical.
                </p>
              </Field>
              <Field label="Notes">
                <Textarea rows={2} value={draft.description || ""} onChange={(e) => set({ description: e.target.value })} placeholder="What this journey is for" />
              </Field>
            </CardContent>
          </Card>

          {id && <PeopleCard detail={detail} byId={byId} onExit={async (eid) => { await commsOp("exitEnrollment", { id: eid }, "Removed from the journey"); loadDetail(); }} />}
        </div>
      </div>

      {/* Step editor */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selected && (
            <StepEditor step={selected} steps={draft.steps} events={events} fields={fields} templates={templates}
              isStart={draft.startStepId === selected.id}
              onChange={(p) => updateStep(selected.id, p)}
              onRemove={removable(selected) ? () => removeStep(selected.id) : undefined} />
          )}
        </SheetContent>
      </Sheet>

      {testOpen && id && <TestDialog id={id} dirty={dirty} onClose={() => setTestOpen(false)} />}
      <ConfirmationDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete “${draft.name || "journey"}”?`}
        description="The journey and its counters are removed. Live or still-running journeys can't be deleted — pause or archive first."
        confirmLabel="Delete" isDanger onConfirm={remove} />
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Connector() {
  return <div className="h-4 w-px bg-border" />;
}

function AddStep({ onPick }: { onPick: (t: StepType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Insert a step"
          className="h-5 w-5 rounded-full border bg-background text-muted-foreground hover:text-primary hover:border-primary flex items-center justify-center">
          <Plus className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="text-xs">Insert a step</DropdownMenuLabel>
        {ADDABLE.map((t) => {
          const M = STEP_META[t];
          return (
            <DropdownMenuItem key={t} onClick={() => onPick(t)} className="items-start gap-2">
              <span className={cn("mt-0.5 h-6 w-6 rounded-md flex items-center justify-center shrink-0", M.tone)}><M.icon className="h-3.5 w-3.5" /></span>
              <span><span className="block text-sm">{M.label}</span><span className="block text-[11px] text-muted-foreground">{M.hint}</span></span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EntryCard({ journey, events, fields, entered }: { journey: Omit<Journey, "id">; events: JourneyCatalog["events"]; fields: JourneyCatalog["segmentFields"]; entered?: number }) {
  return (
    <div className="w-72 rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center justify-center gap-1"><Zap className="h-3 w-3" />Entry</p>
      <p className="text-sm font-semibold mt-1">
        {journey.entry.type === "event" ? eventLabel(journey.entry.event, events) : "Matches an audience (daily)"}
      </p>
      {journey.entry.type === "segment" && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{(journey.entry.conditions || []).map((c) => describeCondition(c, fields)).join(" · ")}</p>
      )}
      <p className="text-[11px] text-muted-foreground mt-1">
        {journey.userType ? USER_TYPES.find((u) => u.v === journey.userType)?.label : "Anyone"}
        {journey.onlyOptedIn ? " · opted in" : ""}{journey.holdoutPercent ? ` · ${journey.holdoutPercent}% holdout` : ""}
        {entered ? ` · ${num(entered)} entered` : ""}
      </p>
    </div>
  );
}

function StepCard({ step, summary, stats, waiting, selected, onClick, warn }: {
  step: Step; summary: string; stats?: Record<string, number>; waiting?: number; selected: boolean; onClick: () => void; warn?: boolean;
}) {
  const M = STEP_META[step.type];
  const s = stats || {};
  const chips: [string, string | number][] = [];
  if (s.reached) chips.push(["reached", num(s.reached)]);
  if (waiting) chips.push(["waiting", num(waiting)]);
  if (step.type === "email") {
    if (s.sent) chips.push(["sent", num(s.sent)]);
    if (s.sent && s.opened) chips.push(["opened", pct(pctOf(s.opened, s.sent))]);
    if (s.sent && s.clicked) chips.push(["clicked", pct(pctOf(s.clicked, s.sent))]);
    if (s.skipped || s.suppressed) chips.push(["skipped", num(Number(s.skipped || 0) + Number(s.suppressed || 0))]);
  }
  if (step.type === "wait_event") { if (s.event) chips.push(["happened", num(s.event)]); if (s.timeout) chips.push(["timed out", num(s.timeout)]); }
  if (step.type === "branch") { if (s.yes) chips.push(["yes", num(s.yes)]); if (s.no) chips.push(["no", num(s.no)]); }
  if (step.type === "split") { if (s.a) chips.push(["A", num(s.a)]); if (s.b) chips.push(["B", num(s.b)]); }
  if (step.type === "push") { if (s.sent) chips.push(["sent", num(s.sent)]); if (s.skipped) chips.push(["no device", num(s.skipped)]); }
  if (s.held) chips.push(["held (holdout)", num(s.held)]);
  return (
    <button type="button" onClick={onClick}
      className={cn("w-72 rounded-2xl border bg-card px-3.5 py-3 text-left shadow-sm transition-all hover:shadow-md",
        selected && "ring-2 ring-primary", warn && "border-amber-500/60")}>
      <div className="flex items-center gap-2.5">
        <span className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", M.tone)}><M.icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{M.label}</p>
          <p className="text-sm font-semibold truncate">{step.label || summary}</p>
          {step.label && <p className="text-[11px] text-muted-foreground truncate">{summary}</p>}
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {chips.map(([k, v]) => <span key={k} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]"><b>{v}</b> {k}</span>)}
        </div>
      )}
    </button>
  );
}

function StepEditor({ step, steps, events, fields, templates, isStart, onChange, onRemove }: {
  step: Step; steps: Step[]; events: JourneyCatalog["events"]; fields: JourneyCatalog["segmentFields"]; templates: Template[];
  isStart: boolean; onChange: (p: Partial<Step>) => void; onRemove?: () => void;
}) {
  const M = STEP_META[step.type];
  const targets = steps.filter((s) => s.id !== step.id);
  const target = (k: "next" | "timeoutNext" | "yes" | "no" | "a" | "b", label: string) => (
    <Field key={k} label={label}>
      <Select value={(step[k] as string) || "__end"} onValueChange={(v) => onChange({ [k]: v === "__end" ? null : v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__end">End the journey</SelectItem>
          {targets.map((t) => <SelectItem key={t.id} value={t.id}>{t.label || STEP_META[t.type].label} ({t.id})</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
  const minutesInput = (value: number | undefined, set: (n: number) => void, allowNegative = false) => {
    const unit = value && Math.abs(value) % 1440 === 0 ? 1440 : value && Math.abs(value) % 60 === 0 ? 60 : 1;
    return (
      <div className="flex gap-2">
        <Input type="number" className="flex-1" value={Math.round((value || 0) / unit)}
          onChange={(e) => { const n = Number(e.target.value) || 0; set((allowNegative ? n : Math.max(0, n)) * unit); }} />
        <Select value={String(unit)} onValueChange={(u) => set(Math.round((value || 0) / unit) * Number(u))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="1">minutes</SelectItem><SelectItem value="60">hours</SelectItem><SelectItem value="1440">days</SelectItem></SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span className={cn("h-8 w-8 rounded-lg flex items-center justify-center", M.tone)}><M.icon className="h-4 w-4" /></span>{M.label}
        </SheetTitle>
        <SheetDescription>{M.hint}{isStart ? " · first step" : ""} · id {step.id}</SheetDescription>
      </SheetHeader>
      <Field label="Label (shown on the flow)">
        <Input value={step.label || ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="Optional" />
      </Field>

      {step.type === "wait" && <Field label="Wait for">{minutesInput(step.minutes, (n) => onChange({ minutes: Math.max(1, n) }))}</Field>}
      {step.type === "wait_until" && (
        <>
          <Field label="Date field from the triggering event">
            <Select value={step.field || ""} onValueChange={(v) => onChange({ field: v })}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checkInAt">Stay check-in (stay booked)</SelectItem>
                <SelectItem value="checkOutAt">Stay check-out (stay booked)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Offset (negative = before)">{minutesInput(step.offsetMinutes, (n) => onChange({ offsetMinutes: n }), true)}</Field>
          <p className="text-[11px] text-muted-foreground">If the date is missing or already past, the step continues straight away. Currently: {duration(step.offsetMinutes)} {step.field}.</p>
        </>
      )}
      {step.type === "wait_event" && (
        <>
          <Field label="Wait for"><EventSelect value={step.event} events={events} onChange={(v) => onChange({ event: v })} /></Field>
          <Field label="Give up after">{minutesInput(step.timeoutMinutes, (n) => onChange({ timeoutMinutes: Math.max(10, n) }))}</Field>
        </>
      )}
      {step.type === "branch" && (
        <Field label="Yes if they match all of">
          <ConditionsEditor fields={fields} conditions={step.conditions || []} onChange={(c) => onChange({ conditions: c })} />
        </Field>
      )}
      {step.type === "split" && (
        <Field label={`A gets ${step.percent ?? 50}%, B gets ${100 - (step.percent ?? 50)}%`}>
          <input type="range" min={5} max={95} step={5} value={step.percent ?? 50} className="w-full accent-primary" onChange={(e) => onChange({ percent: Number(e.target.value) })} />
          <p className="text-[11px] text-muted-foreground">Stable per person — the same person always lands on the same side.</p>
        </Field>
      )}
      {step.type === "email" && (
        <Field label="Template">
          <Select value={step.templateKey || ""} onValueChange={(v) => onChange({ templateKey: v })}>
            <SelectTrigger><SelectValue placeholder="Choose a published template" /></SelectTrigger>
            <SelectContent className="max-h-80">
              {templates.map((t) => <SelectItem key={t.key} value={t.key}>{t.name} · {t.category}{t.seeded ? "" : " · not set up yet"}</SelectItem>)}
            </SelectContent>
          </Select>
          {templates.some((t) => t.key === step.templateKey && !t.seeded) && (
            <p className="text-[11px] text-amber-700">This default template isn't in the database yet — run Marketing → Autopilot → “Set up everything” (or Templates → Seed defaults) before going live.</p>
          )}
          <p className="text-[11px] text-muted-foreground">Marketing templates only reach opted-in people; service templates (orders, partners) always send. The event's details and profile fields ({"{{firstName}}"}, {"{{zoneName}}"}, {"{{lastVendorName}}"}…) fill the template.</p>
        </Field>
      )}
      {step.type === "push" && (
        <>
          <Field label="Title"><Input maxLength={65} value={step.title || ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="Message"><Textarea rows={3} maxLength={180} value={step.body || ""} onChange={(e) => onChange({ body: e.target.value })} /></Field>
          <p className="text-[11px] text-muted-foreground">Goes to the customer app and the in-app notification list. Supports {"{{firstName}}"} and the other profile fields. Partners are skipped.</p>
        </>
      )}
      {step.type === "tag" && <Field label="Tag"><Input value={step.tag || ""} onChange={(e) => onChange({ tag: e.target.value })} placeholder="winback-2026" /></Field>}
      {step.type === "sunset" && (
        <p className="text-xs rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
          Turns marketing, product news and the newsletter off for this person and records it as a sunset (not their own choice). Order and account emails continue. They can opt back in from the app at any time.
        </p>
      )}

      {slots(step).map((x) => target(x.key, x.label ? `Then (${x.label.toLowerCase()})` : "Then"))}

      {onRemove ? (
        <Button variant="outline" className="w-full text-rose-600" onClick={onRemove}><Trash2 className="h-4 w-4 mr-1.5" />Remove step</Button>
      ) : (
        <p className="text-[11px] text-muted-foreground">To remove this step, first point both of its paths to the same next step.</p>
      )}
    </div>
  );
}

function EventSelect({ value, events, onChange }: { value?: string; events: JourneyCatalog["events"]; onChange: (v: string) => void }) {
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className="mt-2"><SelectValue placeholder="Choose an event" /></SelectTrigger>
      <SelectContent>{events.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function PeopleCard({ detail, byId, onExit }: { detail: Detail | null; byId: Map<string, Step>; onExit: (id: string) => void }) {
  const label = (sid: string | null) => (sid ? byId.get(sid)?.label || (byId.get(sid) ? STEP_META[byId.get(sid)!.type].label : sid) : "—");
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">People</CardTitle></CardHeader>
      <CardContent>
        {!detail ? <p className="text-xs text-muted-foreground">Loading…</p> : detail.recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody has entered yet.</p>
        ) : (
          <ul className="divide-y">
            {detail.recent.map((r) => (
              <li key={r.id} className="py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate flex-1">{r.email || r.userId}</span>
                  {r.test && <Badge variant="outline" className="text-[9px]">test</Badge>}
                  {r.holdout && <Badge variant="outline" className="text-[9px]">holdout</Badge>}
                  {r.convertedAt && <Badge className="text-[9px] bg-emerald-600">goal</Badge>}
                  <span className="capitalize text-muted-foreground">{r.status}</span>
                  {r.status === "active" && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Remove from journey" onClick={() => onExit(r.id)}><LogOut className="h-3 w-3" /></Button>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5">
                  {r.status === "active" ? <>At <b>{label(r.stepId)}</b>{r.nextRunAt ? ` · next ${when(r.nextRunAt)}` : ""}</> : r.exitReason ? `Ended: ${r.exitReason}` : ""}
                  {" · entered "}{when(r.enteredAt)}
                </p>
                <p className="text-muted-foreground/80 mt-0.5 truncate">
                  {r.path.filter((p) => p.s !== "enter").map((p, i) => (
                    <Fragment key={i}>{i ? " → " : ""}{label(p.s)}{p.o && p.o !== "wait" ? ` (${p.o})` : ""}</Fragment>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TestDialog({ id, dirty, onClose }: { id: string; dirty: boolean; onClose: () => void }) {
  const [email, setEmail] = useState(auth.currentUser?.email || "");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await comms("testJourney", { id, email });
      toast.success("Test started — steps run every couple of minutes with waits cut to one minute.");
      onClose();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CirclePlay className="h-5 w-5" />Test this journey</DialogTitle>
          <DialogDescription>
            Runs a real copy through the saved journey for one account: emails and pushes are sent to them, every wait is cut to about a minute, and nothing counts in the results.
            The account must exist on The Kada. Consent still applies — marketing emails need that account to be opted in.
          </DialogDescription>
        </DialogHeader>
        {dirty && <p className="text-xs text-amber-700">You have unsaved changes — the test uses the last saved version.</p>}
        <Label>Account email</Label>
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@thekada.in" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || !email}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Start test</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/40 py-2"><p className="text-sm font-bold">{value}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div>;
}
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground text-xs">{label}</span><span className={cn("font-semibold text-xs text-right", tone)}>{value}</span></div>;
}
