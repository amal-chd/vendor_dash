import { useEffect, useMemo, useRef, useState } from "react";
import { useCommsApp, categoryToApp, matchesApp } from "./channelShell";
import { listenCollection } from "@/hooks/useLiveCollection";
import { comms, commsOp, loadCatalog, when, STATUS_TONE, type Catalog } from "./commsApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Sparkles, Send, Plus, Search, Monitor, Smartphone, History, Copy, Archive, ArchiveRestore,
  AlertTriangle, CheckCircle2, LayoutTemplate, Braces, FileText, MoreHorizontal, Undo2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Draft { subject: string; preheader?: string; html: string; text?: string; savedAt?: unknown; restoredFrom?: number }
interface Template {
  id: string;
  key: string;
  name: string;
  description?: string;
  category: string;
  subject: string;
  preheader?: string;
  html: string;
  text?: string;
  status: string;
  language: string;
  version?: number;
  isSystem?: boolean;
  draft?: Draft | null;
  updatedAt?: { toMillis?: () => number };
}
interface Version { id: string; version: number; subject: string; note: string | null; publishedAt: number | null }
interface Preview { subject: string; html: string; text: string; bytes: number; variables: string[]; lint: { errors: string[]; warnings: string[] } }

const CATEGORY_LABEL: Record<string, string> = {
  authentication: "Account & security", orders: "Orders & bookings", payments: "Payments", billing: "Billing",
  vendor: "Restaurant partners", rider: "Riders", host: "Stay hosts", support: "Support",
  subscriptions: "Subscriptions", announcements: "Announcements", marketing: "Marketing",
};

/** Template library + editor. Edits are drafts until published; every publish is a version. */
export default function EmailTemplatesPage() {
  const app = useCommsApp();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | { fromId?: string }>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => listenCollection<Template>(
    "emailTemplates",
    { orderByField: "category", orderDir: "asc", limit: 400 },
    (rows) => { setTemplates(rows); setLoading(false); },
    () => setLoading(false),
  ), []);

  const q = search.trim().toLowerCase();
  const visible = templates
    .filter((t) => matchesApp(app, categoryToApp(t.category)))
    .filter((t) => showArchived || t.status !== "archived")
    .filter((t) => !q || [t.name, t.key, t.subject, t.draft?.subject].some((x) => (x || "").toLowerCase().includes(q)));
  const grouped = visible.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] ||= []).push(t);
    return acc;
  }, {});

  const seed = async () => {
    const r = await commsOp<{ created: number; upgraded: number; kept: number }>("seedTemplates", {}, undefined, setSeeding);
    if (r) {
      const { toast } = await import("sonner");
      toast.success(`${r.created} added · ${r.upgraded} updated to the new design · ${r.kept} kept as they are (edited by your team or already current).`);
    }
  };

  const editing = templates.find((t) => t.id === editingId) || null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Templates</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every email uses the Kada brand frame — logo, colours, footer and unsubscribe links are added automatically. Changes are saved as drafts and only reach people when you publish.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={seed} disabled={seeding}>
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-2">Update defaults</span>
          </Button>
          <Button onClick={() => setCreating({})}><Plus className="h-4 w-4 mr-2" />New template</Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name, key or subject" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72 pl-9" />
        </div>
        <Button variant={showArchived ? "secondary" : "ghost"} size="sm" onClick={() => setShowArchived((v) => !v)}>
          <Archive className="h-3.5 w-3.5 mr-1.5" />{showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : templates.length === 0 ? (
        <Card><CardContent className="py-16 text-center space-y-3">
          <LayoutTemplate className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="font-semibold">No templates yet</p>
          <p className="text-sm text-muted-foreground">Order, payment and partner emails all skip until their template exists.</p>
          <Button onClick={seed} disabled={seeding}><Sparkles className="h-4 w-4 mr-2" />Add the default set</Button>
        </CardContent></Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing matches.</CardContent></Card>
      ) : (
        Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="space-y-2">
            <h3 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{CATEGORY_LABEL[cat] || cat}</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((t) => (
                <button key={t.id} onClick={() => setEditingId(t.id)}
                  className="text-left rounded-2xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold truncate">{t.name}</span>
                    <div className="flex gap-1 shrink-0">
                      {t.draft && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">unpublished changes</Badge>}
                      <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[t.status] || "")}>{t.status === "published" ? "live" : t.status}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1.5">{t.subject || t.draft?.subject || "No subject yet"}</p>
                  <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
                    <span className="font-mono">{t.key}</span><span>·</span><span>{t.language}</span>
                    {t.version ? <><span>·</span><span>v{t.version}</span></> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {editing && <TemplateEditor template={editing} onClose={() => setEditingId(null)} onDuplicate={() => setCreating({ fromId: editing.id })} />}
      {creating && (
        <CreateTemplateDialog
          fromId={creating.fromId}
          onClose={() => setCreating(null)}
          onCreated={(id) => { setCreating(null); setEditingId(id); }}
        />
      )}
    </div>
  );
}

function CreateTemplateDialog({ fromId, onClose, onCreated }: { fromId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [form, setForm] = useState({ name: "", key: "", category: "announcements", language: "en", description: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadCatalog().then(setCatalog).catch(() => {}); }, []);
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{fromId ? "Duplicate template" : "New template"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} placeholder="Diwali offer" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, key: f.key && f.key !== slug(f.name) ? f.key : slug(e.target.value) }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Key</Label><Input value={form.key} className="font-mono text-xs" onChange={(e) => setForm({ ...form, key: slug(e.target.value) })} /></div>
            <div><Label>Language</Label><Input value={form.language} maxLength={5} onChange={(e) => setForm({ ...form, language: e.target.value.toLowerCase() })} /></div>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(catalog?.categories || []).map((c) => (
                  <SelectItem key={c.key} value={c.key}>{CATEGORY_LABEL[c.key] || c.key}{c.marketing ? " · needs opt-in" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">The category decides consent: marketing and announcements only reach people who opted in, and get an unsubscribe link.</p>
          </div>
          <div><Label>What it's for</Label><Input value={form.description} placeholder="Shown to your team only" onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !form.key} onClick={async () => {
            const r = await commsOp<{ id: string }>("createTemplate", { ...form, fromId }, "Draft created.", setBusy);
            if (r) onCreated(r.id);
          }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateEditor({ template, onClose, onDuplicate }: { template: Template; onClose: () => void; onDuplicate: () => void }) {
  const live = { subject: template.subject, preheader: template.preheader || "", html: template.html, text: template.text || "" };
  const start = template.draft || live;
  const [form, setForm] = useState({
    name: template.name,
    subject: start.subject || "",
    preheader: start.preheader || "",
    html: start.html || "",
    text: start.text || "",
  });
  const [tab, setTab] = useState<"html" | "text">("html");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [dirty, setDirty] = useState(false);
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadCatalog().then(setCatalog).catch(() => {}); }, []);

  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  // Live server-side render: the preview IS the email, frame and all.
  useEffect(() => {
    const h = setTimeout(async () => {
      setPreviewing(true);
      try {
        setPreview(await comms<Preview>("previewTemplate", { ...form, category: template.category }));
      } catch { /* keep last preview */ } finally {
        setPreviewing(false);
      }
    }, 450);
    return () => clearTimeout(h);
  }, [form.subject, form.preheader, form.html, form.text, template.category]);

  const loadVersions = async () => {
    const r = await comms<{ versions: Version[] }>("templateDetail", { id: template.id }).catch(() => null);
    setVersions(r?.versions || []);
  };

  const insert = (snippet: string) => {
    const el = htmlRef.current;
    if (tab !== "html" || !el) { set({ html: form.html + snippet }); return; }
    const a = el.selectionStart ?? form.html.length;
    const b = el.selectionEnd ?? a;
    const next = form.html.slice(0, a) + snippet + form.html.slice(b);
    set({ html: next });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + snippet.length, a + snippet.length); });
  };

  const saveDraft = async (quiet = false) => {
    const r = await commsOp("saveDraft", { id: template.id, ...form }, quiet ? undefined : "Draft saved. It isn't live until you publish.", (b) => setBusy(b ? "save" : null));
    if (r) setDirty(false);
    return !!r;
  };

  const publish = async () => {
    if (dirty && !(await saveDraft(true))) return;
    const r = await commsOp<{ version: number; warnings: string[] }>("publishTemplate", { id: template.id }, undefined, (b) => setBusy(b ? "publish" : null));
    if (r) {
      const { toast } = await import("sonner");
      toast.success(`Version ${r.version} is live. Every new email uses it from now on.`);
      setDirty(false);
      setVersions(null);
    }
  };

  const errors = preview?.lint.errors || [];
  const warnings = preview?.lint.warnings || [];
  const isMarketing = template.category === "marketing" || template.category === "announcements";
  const hasDraft = !!template.draft || dirty;
  const variables = preview?.variables || [];
  const knownVars = Object.keys(catalog?.sampleVars || {});

  return (
    <Dialog open onOpenChange={(o) => { if (!o && (!dirty || confirm("Discard unsaved changes?"))) onClose(); }}>
      <DialogContent className="max-w-[1280px] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} className="h-8 w-64 font-bold border-transparent hover:border-input focus:border-input px-2 -ml-2" />
              <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[template.status])}>{template.status === "published" ? `live · v${template.version}` : template.status}</Badge>
              {hasDraft && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/20">{dirty ? "unsaved" : "draft saved"}</Badge>}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{template.id} · {CATEGORY_LABEL[template.category] || template.category}{isMarketing ? " · opt-in only" : " · service email"}</p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu onOpenChange={(o) => o && !versions && loadVersions()}>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><History className="h-4 w-4 mr-1.5" />Versions</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Published versions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!versions ? <div className="p-3 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
                  : versions.length === 0 ? <p className="p-3 text-xs text-muted-foreground">Not published yet.</p>
                  : versions.map((v) => (
                    <DropdownMenuItem key={v.id} className="flex-col items-start gap-0.5"
                      onSelect={async () => {
                        if (dirty && !confirm("Replace your unsaved changes with this version?")) return;
                        const r = await commsOp("restoreVersion", { id: template.id, versionId: v.id }, `Version ${v.version} loaded into the draft. Publish to make it live.`);
                        if (r) {
                          const d = await comms<{ template: Template }>("templateDetail", { id: template.id });
                          const dr = d.template.draft!;
                          setForm((f) => ({ ...f, subject: dr.subject, preheader: dr.preheader || "", html: dr.html, text: dr.text || "" }));
                          setDirty(false);
                        }
                      }}>
                      <span className="text-xs font-bold">v{v.version}{v.version === template.version ? " · live" : ""}</span>
                      <span className="text-[11px] text-muted-foreground truncate w-full">{v.subject}</span>
                      <span className="text-[10px] text-muted-foreground">{when(v.publishedAt)}{v.note ? ` · ${v.note}` : ""}</span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onDuplicate}><Copy className="h-4 w-4 mr-2" />Duplicate</DropdownMenuItem>
                {template.draft && (
                  <DropdownMenuItem onSelect={async () => {
                    if (!confirm("Throw away the draft and go back to the live version?")) return;
                    if (await commsOp("discardDraft", { id: template.id }, "Draft discarded.")) { setForm({ name: template.name, ...live }); setDirty(false); }
                  }}><Undo2 className="h-4 w-4 mr-2" />Discard draft</DropdownMenuItem>
                )}
                {template.status === "archived" ? (
                  <DropdownMenuItem onSelect={() => commsOp("setTemplateStatus", { id: template.id, status: "published" }, "Template restored.")}><ArchiveRestore className="h-4 w-4 mr-2" />Restore</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="text-rose-600" onSelect={() => {
                    if (confirm(template.isSystem ? "This is a system email. Archiving it stops it being sent at all. Archive anyway?" : "Archive this template? Emails that use it will be skipped.")) {
                      commsOp("setTemplateStatus", { id: template.id, status: "archived" }, "Template archived.");
                    }
                  }}><Archive className="h-4 w-4 mr-2" />Archive</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" onClick={() => { if (!dirty || confirm("Discard unsaved changes?")) onClose(); }}><X className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Editor */}
          <div className="min-h-0 overflow-y-auto border-r p-5 space-y-4">
            <div>
              <Label className="text-xs">Subject</Label>
              <Input value={form.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Order {{orderNumber}} confirmed" />
              <p className={cn("text-[11px] mt-1", form.subject.length > 60 ? "text-amber-600" : "text-muted-foreground")}>{form.subject.length} characters · phones show about 40, desktop inboxes about 60.</p>
            </div>
            <div>
              <Label className="text-xs">Preview text</Label>
              <Input value={form.preheader} onChange={(e) => set({ preheader: e.target.value })} placeholder="The line shown after the subject in the inbox" />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Tabs value={tab} onValueChange={(v) => setTab(v as "html" | "text")}>
                <TabsList className="h-8">
                  <TabsTrigger value="html" className="text-xs"><LayoutTemplate className="h-3.5 w-3.5 mr-1" />Body</TabsTrigger>
                  <TabsTrigger value="text" className="text-xs"><FileText className="h-3.5 w-3.5 mr-1" />Plain text</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8" disabled={tab !== "html"}><Plus className="h-3.5 w-3.5 mr-1" />Block</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Kada brand blocks</DropdownMenuLabel>
                    {(catalog?.blocks || []).map((b) => <DropdownMenuItem key={b.key} onSelect={() => insert(b.html)}>{b.label}</DropdownMenuItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8"><Braces className="h-3.5 w-3.5 mr-1" />Variable</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                    {knownVars.map((v) => (
                      <DropdownMenuItem key={v} onSelect={() => tab === "html" ? insert(`{{${v}}}`) : set({ text: form.text + `{{${v}}}` })}>
                        <span className="font-mono text-xs">{`{{${v}}}`}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {tab === "html" ? (
              <Textarea ref={htmlRef} value={form.html} onChange={(e) => set({ html: e.target.value })} spellCheck={false}
                className="font-mono text-[12px] leading-relaxed min-h-[340px]" />
            ) : (
              <>
                <Textarea value={form.text} onChange={(e) => set({ text: e.target.value })} className="font-mono text-[12px] min-h-[220px]"
                  placeholder="Leave empty to generate it from the body" />
                <p className="text-[11px] text-muted-foreground">Sent alongside the designed version for clients that can't show it, and read by spam filters.</p>
              </>
            )}

            <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Variables used</p>
              <div className="flex flex-wrap gap-1.5">
                {variables.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : variables.map((v) => (
                  <Badge key={v} variant="outline" className={cn("font-mono text-[10px]", !knownVars.includes(v) && "border-amber-500/40 text-amber-700")}>{v}</Badge>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Use <code className="font-mono">{"{{name}}"}</code> for a value, <code className="font-mono">{"{{#name}}…{{/name}}"}</code> to show text only when it's set, <code className="font-mono">{"{{^name}}…{{/name}}"}</code> when it isn't. Amber ones aren't sent by any producer — check the spelling.
              </p>
            </div>

            {(errors.length > 0 || warnings.length > 0) && (
              <div className="space-y-1.5">
                {errors.map((e) => <p key={e} className="flex gap-2 text-xs text-rose-600"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{e}</p>)}
                {warnings.map((w) => <p key={w} className="flex gap-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{w}</p>)}
              </div>
            )}
            {preview && errors.length === 0 && warnings.length === 0 && (
              <p className="flex gap-2 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5" />Ready to publish · {(preview.bytes / 1024).toFixed(0)} KB (Gmail clips at 102 KB)</p>
            )}
          </div>

          {/* Preview */}
          <div className="min-h-0 flex flex-col bg-muted/40">
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-background/60">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                Preview with sample data {previewing && <Loader2 className="h-3 w-3 animate-spin" />}
              </span>
              <div className="inline-flex rounded-lg border p-0.5 bg-background">
                <Button size="sm" variant={device === "desktop" ? "secondary" : "ghost"} className="h-7 px-2" onClick={() => setDevice("desktop")}><Monitor className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant={device === "phone" ? "secondary" : "ghost"} className="h-7 px-2" onClick={() => setDevice("phone")}><Smartphone className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            {/* Inbox row */}
            <div className="mx-4 mt-3 rounded-xl border bg-background px-4 py-3">
              <div className="flex items-center gap-3">
                <img src="https://www.thekada.in/favicon.png" alt="" className="h-8 w-8 rounded-full border bg-white p-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">The Kada</span><span className="text-[11px] text-muted-foreground">now</span>
                  </div>
                  <p className="text-[13px] font-semibold truncate">{preview?.subject || form.subject || "No subject"}</p>
                  <p className="text-xs text-muted-foreground truncate">{form.preheader || "(no preview text — clients will show the first line of the body)"}</p>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <div className={cn("mx-auto rounded-xl border bg-white shadow-sm overflow-hidden transition-all", device === "phone" ? "w-[390px]" : "w-full max-w-[720px]")}>
                {preview ? (
                  <iframe title="Email preview" sandbox="" srcDoc={tab === "text" ? `<pre style="font:13px/1.6 ui-monospace,monospace;white-space:pre-wrap;padding:20px;margin:0">${(preview.text || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>` : preview.html}
                    className="w-full h-[62vh] block border-0" />
                ) : (
                  <div className="h-[62vh] grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to… (blank = you)" className="h-9 w-64" />
            <Button variant="outline" size="sm" disabled={!!busy}
              onClick={async () => {
                // Test what's on screen: save the draft first (commsOp reports a failed save).
                if (dirty) {
                  if (!(await commsOp("saveDraft", { id: template.id, ...form }))) return;
                  setDirty(false);
                }
                await commsOp("sendTest", { id: template.id, to: testTo || undefined, useDraft: true }, `Test sent${testTo ? ` to ${testTo}` : " to your inbox"}.`, (b) => setBusy(b ? "test" : null));
              }}>
              {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="ml-1.5">Send test</span>
            </Button>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => saveDraft()} disabled={!!busy || !dirty}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}
            </Button>
            <Button onClick={() => setConfirmPublish(true)} disabled={!!busy || errors.length > 0 || (!hasDraft && template.status === "published")}>
              {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish"}
            </Button>
          </DialogFooter>
        </div>

        <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Publish {form.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Every {isMarketing ? "campaign and automation" : "email"} that uses <span className="font-mono">{template.key}</span> will use this version from now on. The current version stays in history and can be restored.
                {warnings.length > 0 && ` There ${warnings.length === 1 ? "is 1 warning" : `are ${warnings.length} warnings`} — worth a look first.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not yet</AlertDialogCancel>
              <AlertDialogAction onClick={publish}>Publish</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
