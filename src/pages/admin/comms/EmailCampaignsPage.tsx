import { useEffect, useState } from "react";
import { useCommsApp, matchesApp, AppKey } from "./channelShell";
import { collection, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Send, Loader2, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface Campaign {
  id: string; name: string; templateKey: string; segmentId: string; status: string; app?: AppKey;
  stats?: { queued?: number; sent?: number; failed?: number; skipped?: number };
}
interface Opt { id: string; label: string; key?: string; }

const tone: Record<string, string> = {
  draft: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  queued: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  processing: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  paused: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  cancelled: "bg-rose-500/10 text-rose-600 border-rose-500/20",
};

export default function EmailCampaignsPage({ openCreate = false }: { openCreate?: boolean }) {
  const app = useCommsApp();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Opt[]>([]);
  const [segments, setSegments] = useState<Opt[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(openCreate);
  const [form, setForm] = useState({ name: "", templateKey: "", segmentId: "" });

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "emailCampaigns"),
      (s) => setCampaigns(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Campaign, "id">) }))), (err) => console.error("[EmailCampaignsPage] emailCampaigns listener failed", err));
    const u2 = onSnapshot(collection(db, "emailTemplates"),
      (s) => setTemplates(s.docs.filter((d) => d.data().category === "marketing" || d.data().category === "announcements")
        .map((d) => ({ id: d.id, key: d.data().key, label: `${d.data().name} (${d.data().key})` }))), (err) => console.error("[EmailCampaignsPage] emailTemplates listener failed", err));
    const u3 = onSnapshot(collection(db, "emailSegments"),
      (s) => setSegments(s.docs.map((d) => ({ id: d.id, label: d.data().name || d.id }))), (err) => console.error("[EmailCampaignsPage] emailSegments listener failed", err));
    return () => { u1(); u2(); u3(); };
  }, []);

  const create = async () => {
    if (!form.name || !form.templateKey || !form.segmentId) { toast.error("Name, template and audience are required."); return; }
    setCreating(true);
    try {
      await addDoc(collection(db, "emailCampaigns"), {
        ...form, app, status: "draft", stats: { queued: 0, sent: 0 },
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      toast.success("Campaign created as draft.");
      setForm({ name: "", templateKey: "", segmentId: "" });
      setOpen(false);
    } catch { toast.error("Create failed (admin only)."); }
    finally { setCreating(false); }
  };

  const send = async (c: Campaign) => {
    try {
      await httpsCallable(functions, "sendCampaign")({ campaignId: c.id });
      toast.success(`Campaign "${c.name}" queued. Suppressed and unsubscribed people are left out.`);
    } catch (e) { toast.error(`Send failed: ${(e as { message?: string }).message || "error"}`); }
  };

  const segmentName = (id: string) => segments.find((s) => s.id === id)?.label || id;
  const visible = campaigns.filter((c) => matchesApp(app, c.app || "all"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Campaigns</h2>
          <p className="text-sm text-muted-foreground">Marketing sends. Consent, suppression, and the daily frequency cap are applied before anyone is queued.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New campaign</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New campaign</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Select value={form.templateKey} onValueChange={(v) => setForm({ ...form, templateKey: v })}>
                <SelectTrigger><SelectValue placeholder="Marketing template" /></SelectTrigger>
                <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.key!}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={form.segmentId} onValueChange={(v) => setForm({ ...form, segmentId: v })}>
                <SelectTrigger><SelectValue placeholder="Audience segment" /></SelectTrigger>
                <SelectContent>{segments.length === 0 ? <SelectItem value="none" disabled>Create a segment in Audiences first</SelectItem> : segments.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <DialogFooter><Button onClick={create} disabled={creating}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create draft"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {visible.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Megaphone className="h-6 w-6 mx-auto mb-2 opacity-40" />
          <p>No campaigns for this app yet.</p>
          <p className="text-xs mt-1">Create an audience first, then a draft. Only people who opted into marketing are included.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {visible.map((c) => (
            <Card key={c.id}><CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{c.name}</span>
                  <Badge variant="outline" className={cn("text-[10px]", tone[c.status])}>{c.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.templateKey} → {segmentName(c.segmentId)}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Queued {c.stats?.queued ?? 0} · Sent {c.stats?.sent ?? 0} · Skipped {c.stats?.skipped ?? 0} · Failed {c.stats?.failed ?? 0}</p>
              </div>
              {["draft", "scheduled", "paused"].includes(c.status) && (
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="sm"><Send className="h-3.5 w-3.5 mr-1.5" />Send</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Send "{c.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This queues a marketing email to everyone in the audience who has marketing consent and is not suppressed or unsubscribed. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => send(c)}>Confirm & send</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}
