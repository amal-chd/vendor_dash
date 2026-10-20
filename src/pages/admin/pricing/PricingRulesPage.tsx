import { confirmDialog } from "@/components/admin/core/asyncDialogs";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Scale, Plus, History, FlaskConical, Info } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLiveCollection } from "@/hooks/useLiveCollection";
import { usePermissions } from "@/hooks/usePermissions";
import {
  KIND_GROUPS, KIND_LABELS, PARAM_TEMPLATES, callableError, canManageKind, fmtWhen, pricingAdmin,
  readSimDrafts, scopeFor, writeSimDrafts, type RuleDraft, type RuleKind,
} from "./pricingShared";

interface RuleDoc extends RuleDraft {
  id: string;
  version: number;
  reason?: string;
  publishedBy?: { email?: string; role?: string };
  publishedAt?: { toDate?: () => Date };
}

type Status = "live" | "scheduled" | "inactive" | "ended";

function statusOf(r: RuleDoc, now: number): Status {
  if (r.effectiveUntil != null && r.effectiveUntil <= now) return "ended";
  if (r.effectiveFrom > now) return "scheduled";
  return r.active ? "live" : "inactive";
}

const STATUS_BADGE: Record<Status, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  live: { label: "Live", variant: "default" },
  scheduled: { label: "Scheduled", variant: "outline" },
  inactive: { label: "Off", variant: "secondary" },
  ended: { label: "Superseded", variant: "secondary" },
};

function scopeSummary(scope: Record<string, unknown>): string {
  const parts = Object.entries(scope ?? {}).map(([k, v]) => {
    if (Array.isArray(v)) return `${k.replace(/Ids$/, "s")}: ${v.length}`;
    if (v && typeof v === "object") return `${k}: ${JSON.stringify(v)}`;
    return `${k}: ${v}`;
  });
  return parts.length ? parts.join(" · ") : "Everywhere";
}

const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

interface EditorState {
  existing: boolean;
  ruleId: string;
  kind: RuleKind;
  name: string;
  active: boolean;
  priority: string;
  effectiveFrom: string;
  scope: string;
  params: string;
  reason: string;
}

function newEditor(kind: RuleKind): EditorState {
  return {
    existing: false,
    ruleId: "",
    kind,
    name: "",
    active: true,
    priority: "0",
    effectiveFrom: toLocalInput(Date.now()),
    scope: JSON.stringify(scopeFor(kind), null, 2),
    params: JSON.stringify(PARAM_TEMPLATES[kind], null, 2),
    reason: "",
  };
}

function editorFrom(r: RuleDoc): EditorState {
  return {
    existing: true,
    ruleId: r.ruleId,
    kind: r.kind,
    name: r.name,
    active: r.active,
    priority: String(r.priority),
    effectiveFrom: toLocalInput(Date.now()),
    scope: JSON.stringify(r.scope ?? {}, null, 2),
    params: JSON.stringify(r.params ?? {}, null, 2),
    reason: "",
  };
}

function draftOf(e: EditorState): { draft: RuleDraft | null; error: string | null } {
  try {
    const scope = JSON.parse(e.scope || "{}");
    const params = JSON.parse(e.params || "{}");
    const from = new Date(e.effectiveFrom).getTime();
    return {
      draft: {
        ruleId: e.ruleId.trim(),
        kind: e.kind,
        name: e.name.trim(),
        active: e.active,
        priority: Number(e.priority) || 0,
        effectiveFrom: Number.isFinite(from) ? Math.max(from, Date.now()) : Date.now(),
        effectiveUntil: null,
        scope,
        params,
      },
      error: null,
    };
  } catch (err) {
    return { draft: null, error: `Scope and params must be valid JSON. ${(err as Error).message}` };
  }
}

export default function PricingRulesPage() {
  const { role } = usePermissions();
  const [, setParams] = useSearchParams();
  const { rows, loading, error } = useLiveCollection<RuleDoc>("pricing_rules", { limit: 2000 });
  const [group, setGroup] = useState<string>("all");
  const [q, setQ] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  const byRule = useMemo(() => {
    const m = new Map<string, RuleDoc[]>();
    for (const r of rows) {
      if (!r.ruleId) continue;
      m.set(r.ruleId, [...(m.get(r.ruleId) ?? []), r]);
    }
    for (const list of m.values()) list.sort((a, b) => b.version - a.version);
    return m;
  }, [rows]);

  const current = useMemo(() => {
    const kinds = group === "all" ? null : new Set(KIND_GROUPS.find((g) => g.key === group)?.kinds ?? []);
    const needle = q.trim().toLowerCase();
    return [...byRule.values()]
      .map((versions) => versions.find((v) => statusOf(v, now) !== "ended") ?? versions[0])
      .filter((r) => !kinds || kinds.has(r.kind))
      .filter((r) => !needle || [r.ruleId, r.name, r.kind, JSON.stringify(r.params)].some((v) => (v ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.priority - a.priority);
  }, [byRule, group, q, now]);

  const manageable = (KIND_GROUPS.flatMap((g) => g.kinds)).filter((k) => canManageKind(role, k));

  async function check() {
    if (!editor) return;
    const { draft, error: jsonError } = draftOf(editor);
    if (!draft) return setProblems([jsonError!]);
    setBusy(true);
    try {
      const res = await pricingAdmin<{ problems: string[] }>("validateRule", { rule: draft });
      setProblems(res.problems);
      if (!res.problems.length) toast.success("Rule looks valid.");
    } catch (e) {
      setProblems([callableError(e)]);
    } finally {
      setBusy(false);
    }
  }

  function testInSimulator() {
    if (!editor) return;
    const { draft, error: jsonError } = draftOf(editor);
    if (!draft) return setProblems([jsonError!]);
    writeSimDrafts([...readSimDrafts().filter((d) => d.ruleId !== draft.ruleId), draft]);
    setEditor(null);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("tab", "simulator");
      return next;
    });
    toast.message(`"${draft.ruleId}" is loaded into the simulator as a draft.`);
  }

  async function publish() {
    if (!editor) return;
    const { draft, error: jsonError } = draftOf(editor);
    if (!draft) return setProblems([jsonError!]);
    if (editor.reason.trim().length < 5) return setProblems(["Explain the change (at least 5 characters). It's kept in the audit log."]);
    if (
      !(await confirmDialog({
        title: `Publish ${draft.ruleId}?`,
        description: `New quotes in every app use it from ${fmtWhen(draft.effectiveFrom)}. Orders already placed keep their prices.`,
        confirmLabel: "Publish rule",
      }))
    )
      return;
    setBusy(true);
    try {
      const res = await pricingAdmin<{ rule: { ruleId: string; version: number } }>("publishRule", { rule: draft, reason: editor.reason.trim() });
      toast.success(`Published ${res.rule.ruleId} v${res.rule.version}.`);
      writeSimDrafts(readSimDrafts().filter((d) => d.ruleId !== draft.ruleId));
      setEditor(null);
      setProblems(null);
    } catch (e) {
      setProblems([callableError(e)]);
    } finally {
      setBusy(false);
    }
  }

  const history = historyFor ? byRule.get(historyFor) ?? [] : [];
  const editorKindAllowed = editor ? canManageKind(role, editor.kind) : false;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Pricing rules"
        description="The single source of truth for prices, GST, fees, surge, commission, rider pay, promotions and Stay rates. Every change is a new, dated version with a reason."
        icon={Scale}
        actions={
          manageable.length > 0 && (
            <Button onClick={() => { setProblems(null); setEditor(newEditor(manageable[0])); }}>
              <Plus className="mr-1 h-4 w-4" /> New rule
            </Button>
          )
        }
      />

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p>
          Until a rule is published here, prices come from today's live settings (zone economics, surge switch, coupons, each
          restaurant's tax setting), shown in the simulator as <span className="font-mono">legacy-…</span> rules. A published rule takes over
          automatically. Placed orders and bookings keep the price snapshot they were created with.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[{ key: "all", label: "All" }, ...KIND_GROUPS].map((g) => (
          <Button key={g.key} size="sm" variant={group === g.key ? "default" : "outline"} onClick={() => setGroup(g.key)}>
            {g.label}
          </Button>
        ))}
        <Input placeholder="Search rules…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto max-w-xs" />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead className="text-right">Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last change</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && current.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-muted-foreground">No published rules here yet — the legacy live settings apply.</TableCell></TableRow>
            )}
            {current.map((r) => {
              const st = STATUS_BADGE[statusOf(r, now)];
              return (
                <TableRow key={r.ruleId}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.ruleId}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{KIND_LABELS[r.kind] ?? r.kind}</TableCell>
                  <TableCell className="max-w-[16rem] truncate text-xs" title={JSON.stringify(r.scope)}>{scopeSummary(r.scope)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.priority}</TableCell>
                  <TableCell>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {statusOf(r, now) === "scheduled" && <div className="mt-1 text-xs text-muted-foreground">{fmtWhen(r.effectiveFrom)}</div>}
                  </TableCell>
                  <TableCell>v{r.version}</TableCell>
                  <TableCell className="text-xs">
                    <div>{r.publishedBy?.email}</div>
                    <div className="text-muted-foreground">{fmtWhen(r.publishedAt?.toDate?.())}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={() => setHistoryFor(r.ruleId)}><History className="h-4 w-4" /></Button>
                    {canManageKind(role, r.kind) && (
                      <Button size="sm" variant="outline" onClick={() => { setProblems(null); setEditor(editorFrom(r)); }}>Change</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{historyFor}</DialogTitle>
            <DialogDescription>Every version ever published. Versions are never edited or deleted.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {history.map((v) => (
              <div key={v.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">v{v.version}</span>
                  <Badge variant={STATUS_BADGE[statusOf(v, now)].variant}>{STATUS_BADGE[statusOf(v, now)].label}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {fmtWhen(v.effectiveFrom)} → {v.effectiveUntil ? fmtWhen(v.effectiveUntil) : "open"} · {v.publishedBy?.email} ({v.publishedBy?.role?.replace(/_/g, " ")})
                  </span>
                </div>
                {v.reason && <p className="mt-1 text-xs">“{v.reason}”</p>}
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify({ priority: v.priority, active: v.active, scope: v.scope, params: v.params }, null, 2)}</pre>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-w-3xl">
          {editor && (
            <>
              <DialogHeader>
                <DialogTitle>{editor.existing ? `New version of ${editor.ruleId}` : "New pricing rule"}</DialogTitle>
                <DialogDescription>
                  Amounts are in paise (₹1 = 100), percentages in basis points (1% = 100). Nothing changes until you publish.
                </DialogDescription>
              </DialogHeader>
              <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Rule id</Label>
                  <Input value={editor.ruleId} disabled={editor.existing} placeholder="kochi-dinner-surge" onChange={(e) => setEditor({ ...editor, ruleId: e.target.value.toLowerCase() })} />
                </div>
                <div className="space-y-1">
                  <Label>Kind</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={editor.kind}
                    disabled={editor.existing}
                    onChange={(e) => {
                      const kind = e.target.value as RuleKind;
                      setEditor({ ...editor, kind, scope: JSON.stringify(scopeFor(kind), null, 2), params: JSON.stringify(PARAM_TEMPLATES[kind], null, 2) });
                    }}
                  >
                    {KIND_GROUPS.map((g) => (
                      <optgroup key={g.key} label={g.label}>
                        {g.kinds.map((k) => (
                          <option key={k} value={k} disabled={!canManageKind(role, k)}>{KIND_LABELS[k]}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Name</Label>
                  <Input value={editor.name} placeholder="Kochi dinner surge" onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Priority (higher wins)</Label>
                  <Input type="number" value={editor.priority} onChange={(e) => setEditor({ ...editor, priority: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Takes effect (your local time)</Label>
                  <Input type="datetime-local" value={editor.effectiveFrom} onChange={(e) => setEditor({ ...editor, effectiveFrom: e.target.value })} />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Switch checked={editor.active} onCheckedChange={(v) => setEditor({ ...editor, active: v })} />
                  <Label>{editor.active ? "Active" : "Turned off (publishing this version switches the rule off)"}</Label>
                </div>
                <div className="space-y-1">
                  <Label>Scope (JSON)</Label>
                  <Textarea rows={10} className="font-mono text-xs" value={editor.scope} onChange={(e) => setEditor({ ...editor, scope: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Params (JSON)</Label>
                  <Textarea rows={10} className="font-mono text-xs" value={editor.params} onChange={(e) => setEditor({ ...editor, params: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Reason for the change (kept in the audit log)</Label>
                  <Textarea rows={2} value={editor.reason} placeholder="Monsoon rider shortage in Ernakulam; cap surge at ₹30." onChange={(e) => setEditor({ ...editor, reason: e.target.value })} />
                </div>
                {problems && (
                  <div className={`rounded-md p-2 text-sm sm:col-span-2 ${problems.length ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                    {problems.length ? <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : "No problems found."}
                  </div>
                )}
                {!editorKindAllowed && (
                  <p className="text-sm text-destructive sm:col-span-2">Your role can't publish {KIND_LABELS[editor.kind]} rules. You can still check it and test it in the simulator.</p>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" disabled={busy} onClick={check}>Check</Button>
                <Button variant="outline" disabled={busy} onClick={testInSimulator}><FlaskConical className="mr-1 h-4 w-4" /> Test in simulator</Button>
                <Button disabled={busy || !editorKindAllowed} onClick={publish}>Publish</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
