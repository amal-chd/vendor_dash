import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listenCollection } from "@/hooks/useLiveCollection";
import { commsOp, num, pct } from "./commsApi";
import { matchesApp, useCommsApp } from "./channelShell";
import {
  JOURNEY_STATUS_TONE, STEP_META, eventLabel, lift, loadJourneyCatalog, pctOf, type Journey, type JourneyCatalog, type LibraryJourney,
} from "./journeyTypes";
import JourneyEditor from "./JourneyEditor";
import { StatCards } from "@/components/admin/StatCards";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Copy, Loader2, Pause, Play, Plus, Route, Sparkles, Target, TrendingUp, Users, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Journeys — multi-step, event- or audience-triggered lifecycle flows with
 * goals, exits and holdouts. The runner lives in functions/src/comms/journeys.ts.
 */
export default function EmailJourneysPage() {
  const app = useCommsApp();
  const [params, setParams] = useSearchParams();
  const openId = params.get("journey");
  const [rows, setRows] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<JourneyCatalog | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);

  useEffect(() => listenCollection<Journey>("journeys", { limit: 200 }, (r) => { setRows(r); setLoading(false); },
    () => setLoading(false)), []);
  useEffect(() => { loadJourneyCatalog().then(setCatalog).catch(() => {}); }, []);

  const open = (id: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (id) n.set("journey", id); else n.delete("journey");
    return n;
  }, { replace: false });

  const visible = useMemo(() => rows
    .filter((j) => j.status !== "archived")
    .filter((j) => matchesApp(app, j.app))
    .sort((a, b) => ["live", "paused", "draft"].indexOf(a.status) - ["live", "paused", "draft"].indexOf(b.status) || a.name.localeCompare(b.name)),
  [rows, app]);
  const archived = rows.filter((j) => j.status === "archived");

  const totals = useMemo(() => visible.reduce((t, j) => ({
    live: t.live + (j.status === "live" ? 1 : 0),
    active: t.active + Math.max(0, Number(j.stats?.active || 0)),
    entered: t.entered + Number(j.stats?.entered || 0),
    converted: t.converted + Number(j.stats?.converted || 0),
    sent: t.sent + Number(j.emailStats?.sent || 0),
  }), { live: 0, active: 0, entered: 0, converted: 0, sent: 0 }), [visible]);

  if (openId) {
    return <JourneyEditor id={openId === "new" ? null : openId} catalog={catalog} onClose={() => open(null)} onCreated={(id) => open(id)} />;
  }

  const install = async (lib: LibraryJourney) => {
    const r = await commsOp<{ id: string }>("installJourney", { key: lib.key }, `“${lib.title}” added as a draft`, (b) => setBusy(b ? lib.key : null));
    if (r) open(r.id);
  };
  const setStatus = (j: Journey, status: string) =>
    commsOp("setJourneyStatus", { id: j.id, status }, status === "live" ? `“${j.name}” is live` : `“${j.name}” paused`, (b) => setBusy(b ? j.id : null));
  const duplicate = async (j: Journey) => {
    const r = await commsOp<{ id: string }>("duplicateJourney", { id: j.id }, "Copied as a draft", (b) => setBusy(b ? j.id : null));
    if (r) open(r.id);
  };

  const installed = new Set(rows.map((r) => r.libraryKey).filter(Boolean));
  const stages = catalog ? [...new Set(catalog.library.map((l) => l.stage))] : [];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Journeys</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Automated, multi-step flows that start from what people do — signing up, ordering, booking, going quiet — and stop the moment they reach the goal.
            Every message still passes consent, quiet hours and frequency caps.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowLibrary((s) => !s)}>
            <Sparkles className="h-4 w-4 mr-1.5" />{showLibrary ? "Hide library" : "Lifecycle library"}
          </Button>
          <Button size="sm" onClick={() => open("new")}><Plus className="h-4 w-4 mr-1.5" />New journey</Button>
        </div>
      </div>

      <StatCards stats={[
        { label: "Live journeys", value: totals.live, icon: Workflow, tone: "text-emerald-600" },
        { label: "In a journey now", value: num(totals.active), icon: Users, hint: "Waiting on a step" },
        { label: "Goals reached", value: num(totals.converted), icon: Target, tone: "text-sky-600", hint: totals.entered ? `${pct(totals.converted / totals.entered)} of ${num(totals.entered)} entrants` : "No entrants yet" },
        { label: "Journey emails sent", value: num(totals.sent), icon: TrendingUp },
      ]} />

      {(showLibrary || (!loading && rows.length === 0)) && catalog && (
        <Card className="rounded-2xl border-primary/20 bg-primary/[0.02]">
          <CardContent className="p-5 space-y-4">
            <div>
              <p className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Lifecycle library</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Proven flows for a food, stays and partner marketplace. Each installs as a draft with its templates — review the copy and timing, test it on yourself, then go live.
              </p>
            </div>
            {stages.map((stage) => (
              <div key={stage}>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{stage}</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {catalog.library.filter((l) => l.stage === stage).map((l) => (
                    <div key={l.key} className="rounded-xl border bg-card p-4 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-sm">{l.title}</p>
                        {installed.has(l.key) && <Badge variant="secondary" className="text-[10px] shrink-0">Installed</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex-1">{l.why}</p>
                      <div className="flex flex-wrap gap-1 mt-3">
                        {l.def.steps.filter((s) => s.type !== "exit").map((s) => {
                          const M = STEP_META[s.type];
                          return <span key={s.id} title={s.label} className={cn("inline-flex h-6 w-6 items-center justify-center rounded-md", M.tone)}><M.icon className="h-3.5 w-3.5" /></span>;
                        })}
                      </div>
                      <Button size="sm" variant={installed.has(l.key) ? "outline" : "default"} className="mt-3" disabled={busy === l.key} onClick={() => install(l)}>
                        {busy === l.key ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                        {installed.has(l.key) ? "Install another copy" : "Install as draft"}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading journeys…</div>
      ) : visible.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="py-12 text-center">
          <Route className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="font-semibold mt-3">No journeys for this app yet</p>
          <p className="text-sm text-muted-foreground mt-1">Start from the lifecycle library above, or build one from scratch.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((j) => {
            const s = j.stats || {};
            const treated = Number(s.entered || 0) - Number(s.holdoutEntered || 0);
            const conv = j.goal ? pctOf(s.converted, treated) : null;
            const up = lift(j);
            const e = j.emailStats || {};
            return (
              <Card key={j.id} className="rounded-2xl hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(j.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{j.name}</p>
                      <Badge variant="outline" className={cn("text-[10px] capitalize", JOURNEY_STATUS_TONE[j.status])}>{j.status}</Badge>
                      {j.holdoutPercent > 0 && <Badge variant="outline" className="text-[10px]">{j.holdoutPercent}% holdout</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                      {j.entry.type === "event" ? <>When <b>{eventLabel(j.entry.event, catalog?.events || [])}</b></> : <>Daily: people matching <b>{(j.entry.conditions || []).length} condition{(j.entry.conditions || []).length === 1 ? "" : "s"}</b></>}
                      <ArrowRight className="h-3 w-3" />{j.steps.length} steps
                      {j.goal && <><ArrowRight className="h-3 w-3" />goal: {eventLabel(j.goal.event, catalog?.events || [])} in {j.goal.withinDays}d</>}
                    </p>
                  </button>
                  <div className="grid grid-cols-4 gap-4 text-center shrink-0">
                    <Metric label="Entered" value={num(s.entered)} />
                    <Metric label="In it now" value={num(Math.max(0, Number(s.active || 0)))} />
                    <Metric label="Converted" value={conv === null ? "—" : pct(conv)} />
                    <Metric label="Lift" value={up === null ? "—" : `${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)} pts`}
                      tone={up === null ? undefined : up > 0 ? "text-emerald-600" : "text-rose-600"} />
                  </div>
                  <div className="hidden xl:grid grid-cols-2 gap-4 text-center shrink-0">
                    <Metric label="Opened" value={pct(pctOf(e.opened, e.sent))} />
                    <Metric label="Clicked" value={pct(pctOf(e.clicked, e.sent))} />
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {j.status === "live" ? (
                      <Button size="sm" variant="outline" disabled={busy === j.id} onClick={() => setStatus(j, "paused")}><Pause className="h-4 w-4 mr-1" />Pause</Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy === j.id} onClick={() => setStatus(j, "live")}><Play className="h-4 w-4 mr-1" />{j.status === "paused" ? "Resume" : "Go live"}</Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Duplicate journey" disabled={busy === j.id} onClick={() => duplicate(j)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {archived.length} archived: {archived.map((j, i) => (
            <span key={j.id}>{i ? ", " : ""}<button type="button" className="underline" onClick={() => open(j.id)}>{j.name}</button></span>
          ))}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className={cn("text-sm font-bold", tone)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
