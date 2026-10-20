import { useEffect, useState } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { useCommsApp, categoryToApp, matchesApp } from "./channelShell";
import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Sparkles, Send, Pencil, Eye } from "lucide-react";

interface Template {
  id: string;
  key: string;
  name: string;
  category: string;
  subject: string;
  preheader?: string;
  html: string;
  text?: string;
  status: string;
  language: string;
  isSystem?: boolean;
}

export default function EmailTemplatesPage() {
  const app = useCommsApp();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [preview, setPreview] = useState<Template | null>(null);
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return listenCollection<Template>(
      "emailTemplates",
      { orderByField: "category", orderDir: "asc", limit: 400 },
      (rows) => {
        setTemplates(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      const res = await httpsCallable(functions, "seedEmailTemplates")({});
      const d = res.data as { created: number; updated: number };
      toast.success(`Templates seeded — ${d.created} created, ${d.updated} updated.`);
    } catch {
      toast.error("Seeding failed. Admin access required.");
    } finally {
      setSeeding(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "emailTemplates", editing.id), {
        subject: editing.subject,
        preheader: editing.preheader || "",
        html: editing.html,
        text: editing.text || "",
        status: editing.status,
        updatedAt: new Date(),
      });
      toast.success("Template saved.");
      setEditing(null);
    } catch {
      toast.error("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async (tpl: Template) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testTo)) {
      toast.error("Enter a valid recipient email first.");
      return;
    }
    try {
      await httpsCallable(functions, "sendTestEmail")({ templateKey: tpl.key, to: testTo });
      toast.success(`Test '${tpl.key}' sent to ${testTo}.`);
    } catch (e) {
      toast.error(`Test failed: ${(e as { message?: string }).message || "provider error"}`);
    }
  };

  const grouped = templates
    .filter((t) => matchesApp(app, categoryToApp(t.category)))
    .reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] ||= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Email Templates</h2>
          <p className="text-sm text-muted-foreground">Transactional & marketing templates. Safe {"{{variable}}"} rendering.</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="test@recipient.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" onClick={seed} disabled={seeding}>
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-2">Seed defaults</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <p className="text-muted-foreground">No templates yet.</p>
            <Button onClick={seed} disabled={seeding}>
              <Sparkles className="h-4 w-4 mr-2" /> Seed the default set
            </Button>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((t) => (
                <Card key={t.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold truncate">{t.name}</span>
                          <Badge variant="outline" className="text-[10px]">{t.language}</Badge>
                          {t.status === "published" ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">live</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">{t.status}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-1">{t.subject}</p>
                        <p className="text-[10px] text-muted-foreground/70 font-mono mt-1">{t.key}</p>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-3">
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPreview(t)}>
                        <Eye className="h-3 w-3 mr-1" /> Preview
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditing(t)}>
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => sendTest(t)}>
                        <Send className="h-3 w-3 mr-1" /> Test
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit template — {editing?.name}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} placeholder="Subject" />
              <Input value={editing.preheader || ""} onChange={(e) => setEditing({ ...editing, preheader: e.target.value })} placeholder="Preheader" />
              <Textarea rows={10} value={editing.html} onChange={(e) => setEditing({ ...editing, html: e.target.value })} placeholder="HTML body" className="font-mono text-xs" />
              <Textarea rows={3} value={editing.text || ""} onChange={(e) => setEditing({ ...editing, text: e.target.value })} placeholder="Plain text" className="font-mono text-xs" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Preview — {preview?.name}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground"><b>Subject:</b> {preview?.subject}</p>
          <div className="border rounded-lg p-4 bg-white text-black max-h-[60vh] overflow-auto"
               dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview?.html || "") }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
