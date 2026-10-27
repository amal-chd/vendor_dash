import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { comms, commsOp, errMessage, num, pct, when } from "../comms/commsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bot, CalendarDays, Check, CheckCircle2, CircleDashed, Copy, Loader2, Play, RefreshCw, Sparkles, Users, Wand2, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Override { skip?: boolean; date?: string; offerCode?: string; daysBefore?: number }
interface Settings {
  enabled: boolean;
  occasions: { mode: "off" | "draft" | "schedule"; leadDays: number };
  overrides: Record<string, Override>;
  autoPause: boolean;
  digest: { enabled: boolean; recipients: string[] };
}
interface CalendarRow {
  key: string; name: string; date: string; approx: boolean; region: string; theme: string; why: string; sendAt: number;
  daysBefore: number; audience: string; skip: boolean; offerCode: string; templateKey: string; subject: string;
  campaign: null | { id: string; status: string; sent: number; opened: number; clicked: number };
}
interface Status {
  settings: Settings;
  setupAt: number | null;
  lastRunAt: number | null;
  lastResult: null | { drafted: string[]; paused: string[]; at: number };
  log: { at: number; entry: string }[];
  journeys: Record<string, null | { id: string; status: string; name: string }>;
  segmentsReady: number;
  segmentsTotal: number;
  calendar: CalendarRow[];
}
interface Breakdown { stages: Record<string, { all: number; optedIn: number }>; scanned: number; capped: boolean }

const AUDIENCE: Record<string, string> = {
  optin_customers: "All opted-in customers",
  lc_active_loyal: "Ordered in the last 30 days",
  lc_lapsing: "Lapsing customers",
};
const STAGES: { key: string; label: string; tone: string; hint: string }[] = [
  { key: "new", label: "New", tone: "bg-sky-500", hint: "Welcome series" },
  { key: "never_ordered", label: "Never ordered", tone: "bg-slate-400", hint: "First-order nudges" },
  { key: "first_order", label: "First order", tone: "bg-cyan-500", hint: "Second-order journey" },
  { key: "active", label: "Active", tone: "bg-emerald-500", hint: "Occasions, reviews" },
  { key: "loyal", label: "Loyal", tone: "bg-emerald-600", hint: "Occasions, reviews" },
  { key: "champion", label: "Champion", tone: "bg-indigo-600", hint: "Referrals, reviews" },
  { key: "at_risk", label: "At risk", tone: "bg-amber-500", hint: "Win-back (from 30 days)" },
  { key: "lapsed", label: "Lapsed", tone: "bg-orange-600", hint: "Win-back" },
  { key: "lost", label: "Lost", tone: "bg-rose-600", hint: "Sunset policy" },
];
const JOURNEY_NAMES: Record<string, string> = {
  welcome_series: "Welcome series", second_order: "First → second order", review_request: "Post-delivery review",
  winback: "Win-back (30 days)", sunset: "Sunset policy", stay_pre_arrival: "Stay pre-arrival", partner_onboarding: "Partner first week",
};

/**
 * Marketing autopilot: one switch for the recurring work — lifecycle journeys,
 * occasion campaigns from the Kerala/India calendar, guard rails and a weekly
 * digest — plus an AI copywriter for anything new. The engine is
 * functions/src/comms/autopilot.ts; nothing here sends directly.
 */
export default function AutopilotPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [activate, setActivate] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const s = await comms<Status>("autopilotStatus");
      setStatus(s);
      setDraft(s.settings);
    } catch (e) {
      setError(errMessage(e));
    }
    comms<Breakdown>("lifecycleBreakdown").then(setBreakdown).catch(() => setBreakdown(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (next: Settings, message = "Autopilot saved") => {
    setDraft(next);
    if (await commsOp("saveAutopilot", { settings: next }, message, (b) => setBusy(b ? "save" : null))) load();
  };
  const setup = async () => {
    const r = await commsOp<Record<string, number>>("setupAutopilot", { activate }, undefined, (b) => setBusy(b ? "setup" : null));
    if (r) {
      toast.success(`Ready: ${r.journeysActivated} journeys turned on, ${r.segmentsCreated} audiences and ${r.templatesCreated} templates added.`);
      load();
    }
  };
  const runNow = async () => { if (await commsOp("runAutopilotNow", {}, "Autopilot ran", (b) => setBusy(b ? "run" : null))) load(); };
  const draftNow = async (key: string) => { if (await commsOp("draftOccasion", { key }, "Campaign drafted", (b) => setBusy(b ? key : null))) load(); };
  const setOverride = (key: string, patch: Override) => {
    if (!draft) return;
    const cur = { ...(draft.overrides[key] || {}), ...patch };
    for (const k of Object.keys(cur) as (keyof Override)[]) if (cur[k] === "" || cur[k] === undefined || cur[k] === false) delete cur[k];
    const overrides = { ...draft.overrides };
    if (Object.keys(cur).length) overrides[key] = cur; else delete overrides[key];
    save({ ...draft, overrides }, "Occasion updated");
  };

  if (error && !status) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-rose-600">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!status || !draft) return <div className="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading autopilot…</div>;

  const journeysOn = Object.values(status.journeys).filter((j) => j?.status === "live").length;
  const journeysTotal = Object.keys(status.journeys).length;
  const ready = status.setupAt && journeysOn === journeysTotal && status.segmentsReady === status.segmentsTotal;
  const totalCustomers = breakdown ? Object.values(breakdown.stages).reduce((s, x) => s + x.all, 0) : 0;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <Card className={cn("rounded-2xl overflow-hidden border-2", draft.enabled ? "border-emerald-500/30" : "border-primary/20")}>
        <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center gap-5">
          <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center shrink-0", draft.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-primary/10 text-primary")}>
            <Bot className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">Marketing autopilot</h2>
              <Badge variant="outline" className={draft.enabled ? "text-emerald-700 border-emerald-500/30 bg-emerald-500/10" : ""}>{draft.enabled ? "On" : "Off"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Runs the recurring marketing for you: lifecycle journeys for every customer stage, a campaign for each Kerala and India occasion, guard rails on anything underperforming, and a weekly digest to your inbox.
              Every message still passes consent, quiet hours and frequency caps.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {status.lastRunAt ? `Last ran ${when(status.lastRunAt)}` : "Hasn't run yet"}{status.setupAt ? ` · set up ${when(status.setupAt)}` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-2 shrink-0 lg:items-end">
            <div className="flex gap-2">
              <Button onClick={setup} disabled={busy === "setup"} className={ready ? "" : "bg-emerald-600 hover:bg-emerald-700"} variant={ready ? "outline" : "default"}>
                {busy === "setup" ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Wand2 className="h-4 w-4 mr-1.5" />}
                {ready ? "Re-run setup" : "Set up everything"}
              </Button>
              <Switch checked={draft.enabled} onCheckedChange={(v) => save({ ...draft, enabled: v }, v ? "Autopilot on" : "Autopilot off")} aria-label="Autopilot on/off" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={activate} onCheckedChange={setActivate} className="scale-75" />Turn the lifecycle journeys on
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Checklist */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Workflow className="h-4 w-4" />What's running</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <Item ok={status.segmentsReady === status.segmentsTotal} label={`Prebuilt audiences (${status.segmentsReady}/${status.segmentsTotal})`} hint="Lifecycle stages, recent and lapsing customers, partners" />
            {Object.entries(status.journeys).map(([k, j]) => (
              <Item key={k} ok={j?.status === "live"} warn={!!j && j.status !== "live"} label={JOURNEY_NAMES[k] || k}
                hint={j ? (j.status === "live" ? "Live" : `${j.status} — open to review`) : "Not installed"}
                to={j ? `/admin/growth?tab=email&section=journeys&journey=${j.id}` : undefined} />
            ))}
            <Item ok={draft.occasions.mode !== "off"} label="Occasion campaigns" hint={draft.occasions.mode === "schedule" ? `Scheduled automatically, ${draft.occasions.leadDays} days ahead` : draft.occasions.mode === "draft" ? `Drafted ${draft.occasions.leadDays} days ahead for you to send` : "Off"} />
            <Item ok={draft.autoPause} label="Guard rails" hint="Pause journeys that lower conversions vs their holdout" />
            <Item ok={draft.digest.enabled && draft.digest.recipients.length > 0} warn={draft.digest.enabled && !draft.digest.recipients.length} label="Weekly digest" hint={draft.digest.recipients.length ? draft.digest.recipients.join(", ") : "Add a recipient below"} />
          </CardContent>
        </Card>

        {/* Lifecycle */}
        <Card className="rounded-2xl xl:col-span-2">
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Customers by lifecycle stage</CardTitle>
            <span className="text-[11px] text-muted-foreground">{breakdown ? `${num(totalCustomers)} customers${breakdown.capped ? " (first 5,000)" : ""}` : "Counting…"}</span>
          </CardHeader>
          <CardContent>
            {!breakdown ? <p className="text-sm text-muted-foreground py-6 text-center">Lifecycle counts are unavailable right now.</p> : (
              <div className="space-y-2.5">
                {STAGES.map((s) => {
                  const v = breakdown.stages[s.key] || { all: 0, optedIn: 0 };
                  return (
                    <div key={s.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="font-medium">{s.label}</span>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full rounded-full", s.tone)} style={{ width: `${totalCustomers ? Math.max(2, (v.all / totalCustomers) * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground text-right w-44">
                        <b className="text-foreground">{num(v.all)}</b> · {num(v.optedIn)} opted in · <span className="hidden sm:inline">{s.hint}</span>
                      </span>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground pt-1">Stages are worked out from order history every time they're used, so they never go stale. Each one is a ready audience under Email → Audiences.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Calendar */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle className="text-base flex items-center gap-2 mr-auto"><CalendarDays className="h-4 w-4" />Occasion calendar · Kerala & India</CardTitle>
          <Select value={draft.occasions.mode} onValueChange={(v) => save({ ...draft, occasions: { ...draft.occasions, mode: v as Settings["occasions"]["mode"] } })}>
            <SelectTrigger className="w-60 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="schedule">Draft and schedule automatically</SelectItem>
              <SelectItem value="draft">Draft for me to review and send</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5 text-xs">
            <Input type="number" className="h-8 w-16" defaultValue={draft.occasions.leadDays}
              onBlur={(e) => Number(e.target.value) !== draft.occasions.leadDays && save({ ...draft, occasions: { ...draft.occasions, leadDays: Number(e.target.value) || 10 } })} />
            days ahead
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Each occasion has its own editable template (Email → Templates, “occasion”). Moon-sighted dates are only ever drafted — confirm the date and the autopilot schedules it.
            Add a real promo code and it appears in the email; without one, the email promises nothing.
          </p>
          <div className="divide-y">
            {status.calendar.map((o) => {
              const ov = draft.overrides[o.key] || {};
              const c = o.campaign;
              return (
                <div key={o.key} className={cn("py-3 grid gap-3 lg:grid-cols-[9rem_1fr_auto] items-start", o.skip && "opacity-50")}>
                  <div>
                    <p className="text-sm font-bold">{new Date(`${o.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                    <p className="text-[11px] text-muted-foreground">sends {when(o.sendAt)}</p>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-sm">{o.name}</p>
                      <Badge variant="outline" className="text-[10px]">{o.region}</Badge>
                      {o.approx && <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-500/30">confirm date</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{AUDIENCE[o.audience] || o.audience}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">“{o.subject}” · {o.why}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {o.approx && (
                        <Input type="date" className="h-7 w-36 text-xs" defaultValue={ov.date || ""} aria-label="Confirmed date"
                          onBlur={(e) => e.target.value !== (ov.date || "") && setOverride(o.key, { date: e.target.value })} />
                      )}
                      <Input className="h-7 w-32 text-xs uppercase" placeholder="Promo code" defaultValue={ov.offerCode || ""} aria-label="Promo code"
                        onBlur={(e) => e.target.value.toUpperCase() !== (ov.offerCode || "") && setOverride(o.key, { offerCode: e.target.value.toUpperCase() })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 lg:justify-end">
                    {c ? (
                      <Link to="/admin/growth?tab=email&section=campaigns" className="text-xs">
                        <Badge variant="outline" className="capitalize">{c.status}</Badge>
                        {c.sent > 0 && <span className="ml-2 text-muted-foreground">{num(c.sent)} sent · {pct(c.sent ? c.clicked / c.sent : null)} clicked</span>}
                      </Link>
                    ) : o.skip ? <Badge variant="outline">Skipped</Badge> : <Badge variant="outline" className="text-muted-foreground">Planned</Badge>}
                    {!c && !o.skip && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === o.key} onClick={() => draftNow(o.key)}>
                        {busy === o.key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Draft now"}
                      </Button>
                    )}
                    {!c && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOverride(o.key, { skip: !o.skip })}>{o.skip ? "Include" : "Skip"}</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-5">
        <AiWriter />

        <div className="xl:col-span-2 space-y-5">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-base">Guard rails & digest</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Toggle label="Pause journeys that hurt" hint="When 100+ people are in both groups and the journey's conversion is 2+ points below its holdout."
                checked={draft.autoPause} onChange={(v) => save({ ...draft, autoPause: v })} />
              <Toggle label="Weekly digest" hint="Monday 9 am: last week's sends, opens, clicks, live journeys and what's coming."
                checked={draft.digest.enabled} onChange={(v) => save({ ...draft, digest: { ...draft.digest, enabled: v } })} />
              <div className="space-y-1.5">
                <Label className="text-xs">Digest recipients (comma-separated)</Label>
                <Input defaultValue={draft.digest.recipients.join(", ")} placeholder="marketing@thekada.in"
                  onBlur={(e) => {
                    const list = e.target.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
                    if (list.join(",") !== draft.digest.recipients.join(",")) save({ ...draft, digest: { ...draft.digest, recipients: list } });
                  }} />
              </div>
              <Button variant="outline" size="sm" onClick={runNow} disabled={busy === "run" || !draft.enabled}>
                {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}Run today's checks now
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Autopilot activity</CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Refresh" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
            </CardHeader>
            <CardContent>
              {status.log.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet — turn it on and it logs everything it does here.</p> : (
                <ul className="space-y-2 max-h-72 overflow-y-auto">
                  {status.log.map((l, i) => (
                    <li key={i} className="text-xs flex gap-2"><span className="text-muted-foreground shrink-0 w-28">{when(l.at)}</span><span>{l.entry}</span></li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ ok, warn, label, hint, to }: { ok: boolean; warn?: boolean; label: string; hint: string; to?: string }) {
  const body = (
    <div className="flex items-start gap-2.5 py-1.5">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" /> : <CircleDashed className={cn("h-4 w-4 mt-0.5 shrink-0", warn ? "text-amber-500" : "text-muted-foreground")} />}
      <div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-muted-foreground truncate">{hint}</p></div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-lg hover:bg-muted/50 -mx-1.5 px-1.5">{body}</Link> : body;
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-muted-foreground">{hint}</p></div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

interface EmailCopy { subjects?: string[]; preheader?: string; headline?: string; body?: string; cta?: string }
interface PushCopy { options?: { title: string; body: string }[] }

/** Brief in, on-brand options out. Nothing is saved or sent from here. */
function AiWriter() {
  const [brief, setBrief] = useState("");
  const [channel, setChannel] = useState<"email" | "push">("email");
  const [tone, setTone] = useState("warm");
  const [audience, setAudience] = useState("");
  const [offerCode, setOfferCode] = useState("");
  const [malayalam, setMalayalam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<(EmailCopy & PushCopy) | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      setOut(await comms<EmailCopy & PushCopy>("aiCopy", { brief, channel, tone, audience, offerCode, language: malayalam ? "ml-mix" : "en" }));
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl xl:col-span-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />AI copywriter</CardTitle>
        <p className="text-xs text-muted-foreground">Writes in the voice from your Brand kit and never invents numbers or offers. Paste what you like into a template or a push.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Remind people in Kochi that kitchens are open late on weekends; friendly, for customers who ordered recently." />
        <div className="grid gap-2 sm:grid-cols-4">
          <Select value={channel} onValueChange={(v) => setChannel(v as "email" | "push")}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="push">Push</SelectItem></SelectContent>
          </Select>
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{["warm", "playful", "festive", "urgent but honest", "premium", "informative"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-9" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Audience (optional)" />
          <Input className="h-9 uppercase" value={offerCode} onChange={(e) => setOfferCode(e.target.value)} placeholder="Real promo code (optional)" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs"><Switch checked={malayalam} onCheckedChange={setMalayalam} className="scale-75" />Add a Malayalam greeting</label>
          <Button size="sm" onClick={run} disabled={busy || brief.trim().length < 8}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Wand2 className="h-4 w-4 mr-1.5" />}Write options
          </Button>
        </div>
        {out && (
          <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
            {channel === "email" ? (
              <>
                {(out.subjects || []).map((s, i) => <CopyLine key={i} label={`Subject ${i + 1}`} text={s} />)}
                {out.preheader && <CopyLine label="Preheader" text={out.preheader} />}
                {out.headline && <CopyLine label="Headline" text={out.headline} />}
                {out.body && <CopyLine label="Body" text={out.body} />}
                {out.cta && <CopyLine label="Button" text={out.cta} />}
              </>
            ) : (out.options || []).map((o, i) => <CopyLine key={i} label={`Push ${i + 1}`} text={`${o.title}\n${o.body}`} />)}
            <p className="text-[11px] text-muted-foreground">Check facts before sending — the assistant only knows what's in your brief.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CopyLine({ label, text }: { label: string; text: string }): ReactNode {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-20 shrink-0 pt-0.5">{label}</span>
      <span className="flex-1 whitespace-pre-line">{text}</span>
      <button type="button" aria-label={`Copy ${label}`} className="text-muted-foreground hover:text-foreground"
        onClick={async () => {
          try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { toast.error("Couldn't copy."); }
        }}>
        {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
