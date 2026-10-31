import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { commsOp, num, pct, STATUS_TONE } from "./commsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FlaskConical, Plus, Trophy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VariantStats { sent?: number; delivered?: number; opened?: number; clicked?: number; bounced?: number; complained?: number }
interface Experiment {
  id: string; name: string; status?: string; variantA?: string; variantB?: string; splitPercent?: number;
  metric?: "open" | "click"; winner?: string | null; stats?: { A?: VariantStats; B?: VariantStats };
}

const MIN_PER_VARIANT = 100;

/** Two-proportion z-test; |z| ≥ 1.96 ≈ 95% confidence the difference is real. */
function zScore(a: number, na: number, b: number, nb: number): number {
  if (!na || !nb) return 0;
  const p = (a + b) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  return se ? (a / na - b / nb) / se : 0;
}

export default function EmailExperimentsPage() {
  const [rows, setRows] = useState<Experiment[]>([]);
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "emailExperiments"), (s) =>
      setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Experiment, "id">) }))),
      (err) => console.error("[EmailExperimentsPage] emailExperiments listener failed", err));
    const u2 = onSnapshot(collection(db, "emailTemplates"), (s) =>
      setTemplates(s.docs.filter((d) => ["marketing", "announcements"].includes(d.data().category) && d.data().status === "published")
        .map((d) => ({ key: (d.data().key as string) || d.id, name: (d.data().name as string) || d.id }))),
      (err) => console.error("[EmailExperimentsPage] emailTemplates listener failed", err));
    return () => { u1(); u2(); };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">A/B tests</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Compare two versions of a campaign email. Attach the test to a campaign and each recipient gets one version (always the same one). A winner is suggested only once both sides have {MIN_PER_VARIANT}+ sends and the gap is statistically real.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-2" />New test</Button>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <FlaskConical className="h-7 w-7 mx-auto mb-2 opacity-40" />
          <p className="font-semibold text-foreground">No tests yet</p>
          <p className="text-sm mt-1">Duplicate a marketing template, change the subject, and test the two.</p>
        </CardContent></Card>
      ) : rows.map((r) => {
        const metric = r.metric || "open";
        const A = r.stats?.A || {}, B = r.stats?.B || {};
        const hit = (v: VariantStats) => (metric === "click" ? v.clicked || 0 : v.opened || 0);
        const rateA = A.sent ? hit(A) / A.sent : null;
        const rateB = B.sent ? hit(B) / B.sent : null;
        const z = zScore(hit(A), A.sent || 0, hit(B), B.sent || 0);
        const enough = (A.sent || 0) >= MIN_PER_VARIANT && (B.sent || 0) >= MIN_PER_VARIANT;
        const suggestion = enough && Math.abs(z) >= 1.96 ? (z > 0 ? "A" : "B") : null;
        return (
          <Card key={r.id} className="rounded-2xl"><CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-primary" />
                <span className="font-bold">{r.name}</span>
                <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[r.status || "running"])}>{r.status || "running"}</Badge>
                <span className="text-xs text-muted-foreground">by {metric} rate · {r.splitPercent ?? 50}/{100 - (r.splitPercent ?? 50)} split</span>
              </div>
              {r.status !== "completed" ? (
                <div className="flex gap-1.5">
                  {(["A", "B"] as const).map((v) => (
                    <Button key={v} size="sm" variant={suggestion === v ? "default" : "outline"}
                      onClick={() => { if (confirm(`End the test with ${v} as the winner?`)) commsOp("concludeExperiment", { id: r.id, winner: v }, `${v} marked as the winner.`); }}>
                      <Trophy className="h-3.5 w-3.5 mr-1" />{v} wins
                    </Button>
                  ))}
                </div>
              ) : r.winner && <Badge className="gap-1"><Trophy className="h-3 w-3" />{r.winner} won</Badge>}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {([["A", r.variantA, A, rateA], ["B", r.variantB, B, rateB]] as const).map(([v, key, s, rate]) => (
                <div key={v} className={cn("rounded-xl border p-3", (r.winner || suggestion) === v && "border-emerald-500/50 bg-emerald-500/5")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black">Version {v}</span>
                    <span className="text-xs font-mono text-muted-foreground truncate ml-2">{key}</span>
                  </div>
                  <p className="text-2xl font-black mt-1">{pct(rate)}</p>
                  <p className="text-[11px] text-muted-foreground">{metric === "click" ? "clicked" : "opened"} · {num(s.sent)} sent · {num(s.delivered)} delivered · {num(s.clicked)} clicks</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {!enough ? `Waiting for ${MIN_PER_VARIANT} sends on each side before calling it.`
                : suggestion ? `Version ${suggestion} is ahead with ~95% confidence.`
                : "No clear winner yet — the difference could be chance."}
            </p>
          </CardContent></Card>
        );
      })}

      {creating && <CreateDialog templates={templates} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateDialog({ templates, onClose }: { templates: { key: string; name: string }[]; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", variantA: "", variantB: "", splitPercent: 50, metric: "open" });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New A/B test</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} placeholder="Subject: emoji vs no emoji" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          {(["variantA", "variantB"] as const).map((k, i) => (
            <div key={k}>
              <Label>Version {i ? "B" : "A"}</Label>
              <Select value={form[k]} onValueChange={(v) => setForm({ ...form, [k]: v })}>
                <SelectTrigger><SelectValue placeholder="Published marketing template" /></SelectTrigger>
                <SelectContent>{templates.map((t) => <SelectItem key={`${k}-${t.key}`} value={t.key}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>% getting A</Label><Input type="number" min={10} max={90} value={form.splitPercent} onChange={(e) => setForm({ ...form, splitPercent: Number(e.target.value) })} /></div>
            <div>
              <Label>Judge by</Label>
              <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="open">Opens (subject lines)</SelectItem><SelectItem value="click">Clicks (content)</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            if (await commsOp("saveExperiment", form, "Test created. Attach it to a campaign to run it.", setBusy)) onClose();
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create test"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
