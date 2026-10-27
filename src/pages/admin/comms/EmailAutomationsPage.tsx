import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { commsOp, loadCatalog, num, type TriggerDef } from "./commsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Zap, Loader2, Pencil, Clock, PlugZap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Automation {
  id: string;
  name: string;
  trigger: string;
  templateKey: string;
  delayMinutes?: number;
  userType?: string | null;
  enabled?: boolean;
  stats?: { triggered?: number; sent?: number; skipped?: number; failed?: number; opened?: number; clicked?: number };
}

function delayLabel(m?: number) {
  if (!m) return "immediately";
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"} later`;
  if (m % 60 === 0) return `${m / 60} h later`;
  return `${m} min later`;
}

/** "When X happens, send T after D." Runs from the real business events. */
export default function EmailAutomationsPage() {
  const [rows, setRows] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<{ key: string; name: string; category: string }[]>([]);
  const [triggers, setTriggers] = useState<TriggerDef[]>([]);
  const [editing, setEditing] = useState<Partial<Automation> | null>(null);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "emailAutomations"), (s) =>
      setRows(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Automation, "id">) }))),
      (err) => console.error("[EmailAutomationsPage] emailAutomations listener failed", err));
    const u2 = onSnapshot(collection(db, "emailTemplates"), (s) =>
      setTemplates(s.docs.filter((d) => d.data().status === "published" && d.data().language === "en")
        .map((d) => ({ key: d.data().key as string, name: (d.data().name as string) || d.id, category: d.data().category as string }))),
      (err) => console.error("[EmailAutomationsPage] emailTemplates listener failed", err));
    loadCatalog().then((c) => setTriggers(c.triggers)).catch(() => {});
    return () => { u1(); u2(); };
  }, []);

  const trig = (k: string) => triggers.find((t) => t.key === k);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Automations</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Extra emails that follow something a person did — a review request a day after delivery, a tip after a first booking. Built-in receipts already send on their own; you don't need an automation for them.
          </p>
        </div>
        <Button onClick={() => setEditing({ enabled: true, delayMinutes: 0 })}><Plus className="h-4 w-4 mr-2" />New automation</Button>
      </div>

      {rows.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Zap className="h-7 w-7 mx-auto mb-2 opacity-40" />
          <p className="font-semibold text-foreground">No automations yet</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const t = trig(r.trigger);
            const s = r.stats || {};
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3">
                <div className={cn("h-9 w-9 rounded-xl grid place-items-center shrink-0", r.enabled !== false ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <Zap className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold">{r.name}</p>
                    {t && !t.producer && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20"><PlugZap className="h-3 w-3 mr-1" />trigger not wired yet</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    When <b className="font-semibold text-foreground">{t?.label || r.trigger}</b> → send <span className="font-mono">{r.templateKey}</span>
                    <Clock className="h-3 w-3 ml-1" />{delayLabel(r.delayMinutes)}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {num(s.triggered)} triggered · {num(s.sent)} sent · {num(s.opened)} opened
                </div>
                <Switch checked={r.enabled !== false}
                  onCheckedChange={(v) => commsOp("saveAutomation", { ...r, enabled: v }, v ? `"${r.name}" is live` : `"${r.name}" paused`)} />
                <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => {
                  if (confirm(`Delete "${r.name}"? Emails already waiting will still go out.`)) commsOp("deleteAutomation", { id: r.id }, `"${r.name}" deleted`);
                }}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
              </div>
            );
          })}
        </div>
      )}

      {editing && <AutomationDialog initial={editing} triggers={triggers} templates={templates} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AutomationDialog({ initial, triggers, templates, onClose }: {
  initial: Partial<Automation>; triggers: TriggerDef[]; templates: { key: string; name: string; category: string }[]; onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial.name || "", trigger: initial.trigger || "order.delivered", templateKey: initial.templateKey || "",
    delay: initial.delayMinutes ?? 0, unit: "minutes" as "minutes" | "hours" | "days", enabled: initial.enabled !== false,
  });
  const [busy, setBusy] = useState(false);
  const t = triggers.find((x) => x.key === form.trigger);
  const factor = form.unit === "days" ? 1440 : form.unit === "hours" ? 60 : 1;
  const tpl = templates.find((x) => x.key === form.templateKey);
  const marketing = tpl && ["marketing", "announcements"].includes(tpl.category);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial.id ? "Edit automation" : "New automation"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} placeholder="Ask for a review" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <Label>When</Label>
            <Select value={form.trigger} onValueChange={(v) => setForm({ ...form, trigger: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {triggers.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}{x.producer ? "" : " (not wired yet)"}</SelectItem>)}
              </SelectContent>
            </Select>
            {t && !t.producer && <p className="text-[11px] text-amber-700 mt-1">Nothing in the platform emits this event yet, so this automation won't send until it does.</p>}
            {t?.producer && <p className="text-[11px] text-muted-foreground mt-1">Available to the template: {t.variables.map((v) => `{{${v}}}`).join(" ")}</p>}
          </div>
          <div>
            <Label>Send</Label>
            <Select value={form.templateKey} onValueChange={(v) => setForm({ ...form, templateKey: v })}>
              <SelectTrigger><SelectValue placeholder="Pick a published template" /></SelectTrigger>
              <SelectContent>{templates.map((x) => <SelectItem key={x.key} value={x.key}>{x.name}</SelectItem>)}</SelectContent>
            </Select>
            {marketing && <p className="text-[11px] text-muted-foreground mt-1">This is a marketing template, so it only reaches people who opted in.</p>}
          </div>
          <div>
            <Label>After</Label>
            <div className="flex gap-2">
              <Input type="number" min={0} className="w-28" value={Math.round(form.delay / factor)} onChange={(e) => setForm({ ...form, delay: Math.max(0, Number(e.target.value) || 0) * factor })} />
              <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v as typeof form.unit, delay: Math.round(form.delay / factor) * (v === "days" ? 1440 : v === "hours" ? 60 : 1) })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="minutes">minutes</SelectItem><SelectItem value="hours">hours</SelectItem><SelectItem value="days">days</SelectItem></SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Delayed emails are checked every 5 minutes.</p>
          </div>
          <label className="flex items-center justify-between rounded-xl border px-3 py-2">
            <span className="text-sm font-semibold">Live</span>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !form.templateKey} onClick={async () => {
            const r = await commsOp("saveAutomation", {
              id: initial.id, name: form.name, trigger: form.trigger, templateKey: form.templateKey,
              delayMinutes: form.delay, enabled: form.enabled,
            }, form.enabled ? "Automation is live." : "Automation saved (paused).", setBusy);
            if (r) onClose();
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
