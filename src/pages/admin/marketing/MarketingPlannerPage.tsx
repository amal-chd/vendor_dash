import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDoc, collection, deleteDoc, doc, serverTimestamp, Timestamp, updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { StatCards } from "@/components/admin/StatCards";
import { ChevronLeft, ChevronRight, ClipboardList, Loader2, Pencil, Plus, Target, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PLAN_CHANNELS, PLAN_COLLECTION, PLAN_GOALS, PLAN_STATUSES, SOURCE_META, inr, loadMarketingEvents, toDate, utmSlug,
  type MarketingEvent, type MarketingPlan, type MarketingSource, type PlanStatus,
} from "./marketingData";

const STATUS_TONE: Record<string, string> = {
  idea: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  planned: "bg-sky-500/10 text-sky-700 border-sky-500/20",
  approved: "bg-indigo-500/10 text-indigo-700 border-indigo-500/20",
  live: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  done: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
  cancelled: "bg-rose-500/10 text-rose-600 border-rose-500/20",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const toInput = (d: Date | null) =>
  d ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : "";

interface Draft {
  name: string; goal: string; status: PlanStatus; channels: string[]; audience: string; kpi: string;
  target: string; budget: string; spent: string; owner: string; notes: string; startAt: string; endAt: string;
}
const EMPTY: Draft = {
  name: "", goal: "retain", status: "idea", channels: [], audience: "", kpi: "", target: "", budget: "", spent: "",
  owner: "", notes: "", startAt: "", endAt: "",
};

/**
 * Planner — one calendar for every channel plus the briefs behind them.
 * Channel activity (email, push, in-app, coupon and ad end dates) is read
 * from each channel's own collection; plans are the team's briefs, kept in
 * marketing_plans, each with a goal, KPI, budget and a UTM campaign name so
 * results can be traced back to it.
 */
export default function MarketingPlannerPage() {
  const [plans, setPlans] = useState<MarketingPlan[]>([]);
  const [events, setEvents] = useState<MarketingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [hidden, setHidden] = useState<Set<MarketingSource>>(new Set());
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MarketingPlan | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("open");

  useEffect(() => listenCollection<MarketingPlan>(PLAN_COLLECTION, { orderByField: "createdAt", limit: 300 }, setPlans), []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setEvents(await loadMarketingEvents());
    setLoading(false);
  }, []);
  // Plans change live; reload the cross-channel feed whenever they do.
  useEffect(() => { loadEvents(); }, [loadEvents, plans.length]);

  const grid = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, MarketingEvent[]>();
    const lo = grid[0].getTime();
    const hi = grid[grid.length - 1].getTime() + 86_400_000;
    for (const e of events) {
      if (hidden.has(e.source)) continue;
      // Multi-day plans show on every day they run.
      const s = Math.max(e.start.getTime(), lo);
      const end = Math.min((e.end ?? e.start).getTime(), hi);
      for (let t = s; t <= end; t += 86_400_000) {
        const k = dayKey(new Date(t));
        map.set(k, [...(map.get(k) ?? []), e]);
      }
    }
    return map;
  }, [events, grid, hidden]);

  const visiblePlans = useMemo(() => plans
    .filter((p) => statusFilter === "all" ? true
      : statusFilter === "open" ? !["done", "cancelled"].includes(p.status) : p.status === statusFilter)
    .sort((a, b) => (toDate(a.startAt)?.getTime() ?? Infinity) - (toDate(b.startAt)?.getTime() ?? Infinity)),
  [plans, statusFilter]);

  const totals = useMemo(() => {
    const active = plans.filter((p) => p.status !== "cancelled");
    return {
      budget: active.reduce((s, p) => s + (p.budget || 0), 0),
      spent: active.reduce((s, p) => s + (p.spent || 0), 0),
      live: plans.filter((p) => p.status === "live").length,
      review: plans.filter((p) => p.status === "planned").length,
    };
  }, [plans]);

  const openNew = (day?: Date) => setEditing({ id: null, draft: { ...EMPTY, startAt: toInput(day ?? null) } });
  const openEdit = (p: MarketingPlan) => setEditing({
    id: p.id,
    draft: {
      name: p.name || "", goal: p.goal || "retain", status: p.status || "idea", channels: p.channels || [],
      audience: p.audience || "", kpi: p.kpi || "", target: p.target?.toString() ?? "", budget: p.budget?.toString() ?? "",
      spent: p.spent?.toString() ?? "", owner: p.owner || "", notes: p.notes || "",
      startAt: toInput(toDate(p.startAt)), endAt: toInput(toDate(p.endAt)),
    },
  });

  const save = async () => {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim()) { toast.error("Give the plan a name."); return; }
    if (!d.kpi.trim()) { toast.error("Say how you'll measure it — a plan without a KPI can't be judged."); return; }
    const start = d.startAt ? new Date(`${d.startAt}T00:00:00`) : null;
    const end = d.endAt ? new Date(`${d.endAt}T23:59:59`) : null;
    if (start && end && end < start) { toast.error("The end date is before the start date."); return; }
    const numOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
    const payload = {
      name: d.name.trim(), goal: d.goal, status: d.status, channels: d.channels, audience: d.audience.trim(),
      kpi: d.kpi.trim(), target: numOrNull(d.target), budget: numOrNull(d.budget), spent: numOrNull(d.spent),
      owner: d.owner.trim(), notes: d.notes.trim(), utmCampaign: utmSlug(d.name),
      startAt: start ? Timestamp.fromDate(start) : null, endAt: end ? Timestamp.fromDate(end) : null,
      updatedAt: serverTimestamp(),
    };
    setSaving(true);
    try {
      if (editing.id) await updateDoc(doc(db, PLAN_COLLECTION, editing.id), payload);
      else await addDoc(collection(db, PLAN_COLLECTION), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email || null });
      toast.success(editing.id ? "Plan updated" : "Plan added");
      setEditing(null);
    } catch {
      toast.error("Couldn't save the plan. Check your admin access and try again.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (p: MarketingPlan, status: PlanStatus) => {
    try {
      await updateDoc(doc(db, PLAN_COLLECTION, p.id), { status, updatedAt: serverTimestamp() });
    } catch {
      toast.error("Couldn't change the status.");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, PLAN_COLLECTION, deleting.id));
      toast.success("Plan deleted");
    } catch {
      toast.error("Couldn't delete the plan.");
    } finally {
      setDeleting(null);
    }
  };

  const today = dayKey(new Date());
  const d = editing?.draft;
  const setD = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Planner</h2>
          <p className="text-sm text-muted-foreground">Every channel on one calendar, and the brief behind each campaign.</p>
        </div>
        <Button size="sm" onClick={() => openNew()}><Plus className="h-4 w-4 mr-1.5" />New plan</Button>
      </div>

      <StatCards stats={[
        { label: "Live plans", value: totals.live, icon: Target, tone: "text-emerald-600" },
        { label: "Waiting for approval", value: totals.review, icon: ClipboardList, tone: "text-sky-600" },
        { label: "Budget", value: inr(totals.budget), icon: Wallet },
        {
          label: "Spent", value: inr(totals.spent), icon: Wallet,
          tone: totals.budget && totals.spent > totals.budget ? "text-rose-600" : undefined,
          hint: totals.budget ? `${Math.round((totals.spent / totals.budget) * 100)}% of budget` : undefined,
        },
      ]} />

      <Card className="rounded-2xl">
        <CardHeader className="pb-3 flex-row flex-wrap items-center gap-3 space-y-0">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <CardTitle className="text-base w-36 text-center">
              {month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next month"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="ml-1 h-8"
              onClick={() => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)); }}>Today</Button>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" />}
          </div>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {(Object.keys(SOURCE_META) as MarketingSource[]).map((src) => {
              const off = hidden.has(src);
              return (
                <button key={src} type="button"
                  onClick={() => setHidden((h) => { const n = new Set(h); if (off) n.delete(src); else n.add(src); return n; })}
                  className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity",
                    off ? "opacity-40" : SOURCE_META[src].chip)}>
                  <span className={cn("h-2 w-2 rounded-full", SOURCE_META[src].dot)} />{SOURCE_META[src].label}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="grid grid-cols-7 min-w-[720px] border-l border-t rounded-lg overflow-hidden">
            {WEEKDAYS.map((w) => (
              <div key={w} className="border-r border-b bg-muted/40 px-2 py-1.5 text-[11px] font-semibold uppercase text-muted-foreground">{w}</div>
            ))}
            {grid.map((day) => {
              const k = dayKey(day);
              const items = byDay.get(k) ?? [];
              const inMonth = day.getMonth() === month.getMonth();
              return (
                <div key={k}
                  className={cn("group border-r border-b min-h-[96px] p-1.5 align-top", !inMonth && "bg-muted/20")}>
                  <div className="flex items-center justify-between">
                    <span className={cn("text-xs font-semibold h-6 w-6 flex items-center justify-center rounded-full",
                      k === today ? "bg-primary text-primary-foreground" : inMonth ? "" : "text-muted-foreground")}>
                      {day.getDate()}
                    </span>
                    <button type="button" aria-label="Plan on this day" onClick={() => openNew(day)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {items.slice(0, 3).map((e) => (
                      <Link key={e.id} to={e.href} title={`${SOURCE_META[e.source].label}: ${e.title} (${e.status})`}
                        className={cn("flex items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight border truncate", SOURCE_META[e.source].chip)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", SOURCE_META[e.source].dot)} />
                        <span className="truncate">{e.title}</span>
                      </Link>
                    ))}
                    {items.length > 3 && <p className="text-[10px] text-muted-foreground px-1">+{items.length - 3} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Coupons and ads have no start date in their settings, so they appear on the day they end.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Briefs</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="all">All</SelectItem>
              {PLAN_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {visiblePlans.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm font-semibold">No briefs here yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                A brief says who it's for, what it should change, and how you'll know. Write one before building the campaign.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => openNew()}><Plus className="h-4 w-4 mr-1.5" />Write a brief</Button>
            </div>
          ) : (
            <div className="divide-y">
              {visiblePlans.map((p) => {
                const s = toDate(p.startAt);
                const e = toDate(p.endAt);
                const goal = PLAN_GOALS.find((g) => g.key === p.goal)?.label ?? p.goal;
                const over = p.budget && p.spent && p.spent > p.budget;
                return (
                  <div key={p.id} className="py-3 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-sm">{p.name}</p>
                        <Badge variant="outline" className="text-[10px]">{goal}</Badge>
                        {(p.channels || []).map((c) => <Badge key={c} variant="secondary" className="text-[10px] capitalize">{c}</Badge>)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {s ? s.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "No date"}
                        {e ? ` – ${e.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                        {p.audience ? ` · ${p.audience}` : ""}
                        {` · KPI: ${p.kpi}${p.target !== null && p.target !== undefined ? ` → ${p.target.toLocaleString("en-IN")}` : ""}`}
                        {p.owner ? ` · ${p.owner}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">utm_campaign={p.utmCampaign || utmSlug(p.name)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.budget ? (
                        <span className={cn("text-xs font-semibold", over ? "text-rose-600" : "text-muted-foreground")}>
                          {inr(p.spent ?? 0)} / {inr(p.budget)}
                        </span>
                      ) : null}
                      <Select value={p.status} onValueChange={(v) => setStatus(p, v as PlanStatus)}>
                        <SelectTrigger className={cn("h-8 w-32 text-xs border", STATUS_TONE[p.status])}><SelectValue /></SelectTrigger>
                        <SelectContent>{PLAN_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit plan" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" aria-label="Delete plan" onClick={() => setDeleting(p)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit plan" : "New plan"}</DialogTitle>
            <DialogDescription>Who it's for, what it should change, and how you'll know it worked.</DialogDescription>
          </DialogHeader>
          {d && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Name</Label>
                <Input value={d.name} onChange={(e) => setD({ name: e.target.value })} placeholder="Weekend biryani win-back" />
                {d.name && <p className="text-[11px] text-muted-foreground font-mono">utm_campaign={utmSlug(d.name)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Goal</Label>
                <Select value={d.goal} onValueChange={(v) => setD({ goal: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAN_GOALS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={d.status} onValueChange={(v) => setD({ status: v as PlanStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAN_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Channels</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PLAN_CHANNELS.map((c) => {
                    const on = d.channels.includes(c);
                    return (
                      <button key={c} type="button"
                        onClick={() => setD({ channels: on ? d.channels.filter((x) => x !== c) : [...d.channels, c] })}
                        className={cn("rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                          on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}>
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Audience</Label>
                <Input value={d.audience} onChange={(e) => setD({ audience: e.target.value })} placeholder="Customers in Kochi who haven't ordered in 30 days" />
              </div>
              <div className="space-y-1.5">
                <Label>KPI</Label>
                <Input value={d.kpi} onChange={(e) => setD({ kpi: e.target.value })} placeholder="Orders with code BIRYANI50" />
              </div>
              <div className="space-y-1.5">
                <Label>Target</Label>
                <Input type="number" inputMode="numeric" value={d.target} onChange={(e) => setD({ target: e.target.value })} placeholder="300" />
              </div>
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input type="date" value={d.startAt} onChange={(e) => setD({ startAt: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input type="date" value={d.endAt} onChange={(e) => setD({ endAt: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Budget (₹)</Label>
                <Input type="number" inputMode="numeric" value={d.budget} onChange={(e) => setD({ budget: e.target.value })} placeholder="Discounts + ad spend" />
              </div>
              <div className="space-y-1.5">
                <Label>Spent so far (₹)</Label>
                <Input type="number" inputMode="numeric" value={d.spent} onChange={(e) => setD({ spent: e.target.value })} />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Owner</Label>
                <Input value={d.owner} onChange={(e) => setD({ owner: e.target.value })} placeholder="Who answers for it" />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} value={d.notes} onChange={(e) => setD({ notes: e.target.value })} placeholder="Offer, creative, links, holdout group, approvals…" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Save plan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete "${deleting?.name ?? ""}"?`}
        description="The brief is removed for everyone. Campaigns already built from it are not touched."
        confirmLabel="Delete plan"
        isDanger
        onConfirm={remove}
      />
    </div>
  );
}
