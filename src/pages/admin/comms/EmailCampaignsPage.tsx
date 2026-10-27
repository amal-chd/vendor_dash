import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCommsApp, matchesApp, AppKey } from "./channelShell";
import { comms, commsOp, num, pct, when, STATUS_TONE } from "./commsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Send, Loader2, Megaphone, Pause, Play, XCircle, Pencil, CalendarClock, AlertTriangle, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stats {
  audience?: number; queued?: number; sent?: number; skipped?: number; failed?: number;
  delivered?: number; opened?: number; clicked?: number; bounced?: number; complained?: number;
}
interface Campaign {
  id: string; name: string; description?: string; templateKey: string; segmentId: string; experimentId?: string | null;
  status: string; app?: AppKey; stats?: Stats; scheduledAt?: { toMillis?: () => number } | null;
  pausedReason?: string; createdAt?: { toMillis?: () => number }; completedAt?: { toMillis?: () => number };
}
interface Opt { id: string; label: string; key?: string }

const LIVE = ["scheduled", "queued", "processing"];

/** Marketing campaigns: compose, test, schedule, watch, pause. */
export default function EmailCampaignsPage({ openCreate = false }: { openCreate?: boolean }) {
  const app = useCommsApp();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Opt[]>([]);
  const [segments, setSegments] = useState<Opt[]>([]);
  const [experiments, setExperiments] = useState<Opt[]>([]);
  const [editing, setEditing] = useState<Partial<Campaign> | null>(openCreate ? {} : null);
  const [launching, setLaunching] = useState<Campaign | null>(null);

  useEffect(() => {
    const err = (what: string) => (e: unknown) => console.error(`[EmailCampaignsPage] ${what} listener failed`, e);
    const u1 = onSnapshot(query(collection(db, "emailCampaigns"), orderBy("updatedAt", "desc"), limit(200)),
      (s) => setCampaigns(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Campaign, "id">) }))), err("campaigns"));
    const u2 = onSnapshot(collection(db, "emailTemplates"),
      (s) => setTemplates(s.docs
        .filter((d) => ["marketing", "announcements"].includes(d.data().category) && d.data().status === "published")
        .map((d) => ({ id: d.id, key: d.data().key, label: d.data().name || d.data().key }))), err("templates"));
    const u3 = onSnapshot(collection(db, "emailSegments"),
      (s) => setSegments(s.docs.map((d) => ({ id: d.id, label: d.data().name || d.id }))), err("segments"));
    const u4 = onSnapshot(collection(db, "emailExperiments"),
      (s) => setExperiments(s.docs.filter((d) => d.data().status === "running").map((d) => ({ id: d.id, label: d.data().name || d.id }))), err("experiments"));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const segmentName = (id: string) => segments.find((s) => s.id === id)?.label || "Deleted audience";
  const templateName = (k: string) => templates.find((t) => t.key === k)?.label || k;
  const visible = campaigns.filter((c) => matchesApp(app, c.app || "all"));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Campaigns</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            One-off sends to an audience. Only people who opted in are mailed; unsubscribes, bounces, frequency caps and quiet hours are applied to every recipient automatically.
          </p>
        </div>
        <Button onClick={() => setEditing({})}><Plus className="h-4 w-4 mr-2" />New campaign</Button>
      </div>

      {visible.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Megaphone className="h-7 w-7 mx-auto mb-2 opacity-40" />
          <p className="font-semibold text-foreground">No campaigns for this app yet</p>
          <p className="text-sm mt-1">You'll need a published marketing template and an audience.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((c) => <CampaignCard key={c.id} c={c} segmentName={segmentName(c.segmentId)} templateName={templateName(c.templateKey)}
            onEdit={() => setEditing(c)} onLaunch={() => setLaunching(c)} />)}
        </div>
      )}

      {editing && (
        <CampaignDialog initial={editing} app={app} templates={templates} segments={segments} experiments={experiments}
          onClose={() => setEditing(null)}
          onSaved={(saved) => { const isNew = !editing.id; setEditing(null); if (isNew) setLaunching(saved); }} />
      )}
      {launching && <LaunchDialog c={launching} segmentName={segmentName(launching.segmentId)} onClose={() => setLaunching(null)} />}
    </div>
  );
}

function Funnel({ s }: { s: Stats }) {
  const sent = s.sent || 0;
  const rows: [string, number | undefined, string?][] = [
    ["Audience", s.audience], ["Sent", s.sent], ["Delivered", s.delivered, pct(sent ? (s.delivered || 0) / sent : null)],
    ["Opened", s.opened, pct(sent ? (s.opened || 0) / sent : null)], ["Clicked", s.clicked, pct(sent ? (s.clicked || 0) / sent : null)],
    ["Skipped", s.skipped], ["Bounced", s.bounced], ["Spam reports", s.complained],
  ];
  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2 mt-3">
      {rows.map(([label, v, rate]) => (
        <div key={label} className="rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={cn("text-base font-black", (label === "Spam reports" || label === "Bounced") && (v || 0) > 0 && "text-rose-600")}>{num(v)}</p>
          {rate && rate !== "—" && <p className="text-[10px] text-muted-foreground">{rate}</p>}
        </div>
      ))}
    </div>
  );
}

function CampaignCard({ c, segmentName, templateName, onEdit, onLaunch }: {
  c: Campaign; segmentName: string; templateName: string; onEdit: () => void; onLaunch: () => void;
}) {
  const s = c.stats || {};
  const progress = s.audience ? Math.min(100, Math.round((((s.sent || 0) + (s.skipped || 0) + (s.failed || 0)) / s.audience) * 100)) : 0;
  return (
    <Card className="rounded-2xl"><CardContent className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold">{c.name}</span>
            <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[c.status])}>{c.status}</Badge>
            {c.experimentId && <Badge variant="outline" className="text-[10px]"><FlaskConical className="h-3 w-3 mr-1" />A/B</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{templateName} → {segmentName}</p>
          {c.status === "scheduled" && <p className="text-xs text-violet-600 mt-1 flex items-center gap-1"><CalendarClock className="h-3 w-3" />Sends {when(c.scheduledAt)}</p>}
          {c.status === "sent" && <p className="text-xs text-muted-foreground mt-1">Finished {when(c.completedAt)}</p>}
          {c.pausedReason && c.status === "paused" && <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{c.pausedReason}</p>}
        </div>
        <div className="flex gap-1.5">
          {["draft", "scheduled"].includes(c.status) && (
            <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit</Button>
          )}
          {c.status === "draft" && <Button size="sm" onClick={onLaunch}><Send className="h-3.5 w-3.5 mr-1.5" />Review & send</Button>}
          {c.status === "paused" && (
            <Button size="sm" onClick={() => commsOp("launchCampaign", { id: c.id }, "Campaign resumed.")}><Play className="h-3.5 w-3.5 mr-1.5" />Resume</Button>
          )}
          {LIVE.includes(c.status) && (
            <Button size="sm" variant="outline" onClick={() => commsOp("pauseCampaign", { id: c.id }, "Paused. Nothing more goes out until you resume.")}><Pause className="h-3.5 w-3.5 mr-1.5" />Pause</Button>
          )}
          {[...LIVE, "paused", "draft"].includes(c.status) && (
            <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => {
              if (confirm(`Cancel "${c.name}"? Anyone not yet emailed won't be.`)) commsOp("cancelCampaign", { id: c.id }, "Campaign cancelled.");
            }}><XCircle className="h-3.5 w-3.5" /></Button>
          )}
        </div>
      </div>
      {c.status !== "draft" && c.status !== "scheduled" && (
        <>
          {["queued", "processing"].includes(c.status) && <Progress value={progress} className="h-1.5 mt-3" />}
          <Funnel s={s} />
        </>
      )}
    </CardContent></Card>
  );
}

function CampaignDialog({ initial, app, templates, segments, experiments, onClose, onSaved }: {
  initial: Partial<Campaign>; app: AppKey; templates: Opt[]; segments: Opt[]; experiments: Opt[];
  onClose: () => void; onSaved: (c: Campaign) => void;
}) {
  const [form, setForm] = useState({
    name: initial.name || "", description: initial.description || "", templateKey: initial.templateKey || "",
    segmentId: initial.segmentId || "", experimentId: initial.experimentId || "",
  });
  const [audience, setAudience] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!form.segmentId) { setAudience(null); return; }
    let live = true;
    (async () => {
      const seg = await getDoc(doc(db, "emailSegments", form.segmentId));
      const r = await comms<{ matched: number }>("estimateSegment", { conditions: seg.data()?.conditions || [] }).catch(() => null);
      if (live) setAudience(r?.matched ?? null);
    })();
    return () => { live = false; };
  }, [form.segmentId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial.id ? "Edit campaign" : "New campaign"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input placeholder="October win-back" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <Label>Email</Label>
            <Select value={form.templateKey} onValueChange={(v) => setForm({ ...form, templateKey: v })}>
              <SelectTrigger><SelectValue placeholder="Pick a published marketing template" /></SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? <SelectItem value="none" disabled>Publish a marketing template first</SelectItem>
                  : templates.map((t) => <SelectItem key={t.id} value={t.key!}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Audience</Label>
            <Select value={form.segmentId} onValueChange={(v) => setForm({ ...form, segmentId: v })}>
              <SelectTrigger><SelectValue placeholder="Pick an audience" /></SelectTrigger>
              <SelectContent>
                {segments.length === 0 ? <SelectItem value="none" disabled>Create an audience first</SelectItem>
                  : segments.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.segmentId && <p className="text-xs text-muted-foreground mt-1">{audience === null ? "Counting…" : `${num(audience)} opted-in people match right now.`}</p>}
          </div>
          <div>
            <Label>A/B test (optional)</Label>
            <Select value={form.experimentId || "none"} onValueChange={(v) => setForm({ ...form, experimentId: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No test — everyone gets the email above</SelectItem>
                {experiments.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !form.name || !form.templateKey || !form.segmentId} onClick={async () => {
            const r = await commsOp<{ id: string }>("saveCampaign", { id: initial.id, app, ...form }, "Saved as a draft.", setBusy);
            if (r) onSaved({ id: r.id, status: "draft", ...form });
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LaunchDialog({ c, segmentName, onClose }: { c: Campaign; segmentName: string; onClose: () => void }) {
  const [mode, setMode] = useState<"now" | "later">("now");
  const [at, setAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setHours(10, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const scheduledMs = useMemo(() => new Date(at).getTime(), [at]);

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Send “{c.name}”</AlertDialogTitle>
          <AlertDialogDescription>
            To <b>{segmentName}</b>. Only people who opted in are included. It can't be unsent, but you can pause it while it's going out.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border p-3">
            <p className="text-sm font-semibold">1. Check it in your own inbox</p>
            <div className="flex gap-2 mt-2">
              <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Blank sends to you" className="h-9" />
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                if (await commsOp("testCampaign", { id: c.id, to: testTo || undefined }, "Test sent.", setBusy)) setTested(true);
              }}>Send test</Button>
            </div>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-sm font-semibold">2. When</p>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "now" | "later")} className="mt-2 space-y-1.5">
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="now" />Now <span className="text-xs text-muted-foreground">(anyone in quiet hours gets it in their morning)</span></label>
              <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="later" />Later</label>
            </RadioGroup>
            {mode === "later" && <Input type="datetime-local" className="mt-2 h-9" value={at} onChange={(e) => setAt(e.target.value)} />}
          </div>
          {!tested && <p className="text-xs text-amber-700">Tip: send yourself a test before going live.</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          <AlertDialogAction disabled={busy || (mode === "later" && !(scheduledMs > Date.now()))} onClick={async (e) => {
            e.preventDefault();
            const r = await commsOp<{ status: string }>("launchCampaign", { id: c.id, scheduledAt: mode === "later" ? scheduledMs : null },
              mode === "later" ? `Scheduled for ${when(scheduledMs)}.` : "Sending. Progress shows on the card.", setBusy);
            if (r) onClose();
          }}>{mode === "later" ? "Schedule" : "Send now"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
