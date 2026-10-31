import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { QRCodeCanvas } from "qrcode.react";
import { auth, db } from "@/lib/firebase";
import { listenCollection } from "@/hooks/useLiveCollection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmationDialog } from "@/components/admin/core/ConfirmationDialog";
import { Copy, Download, Link2, Loader2, QrCode, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { when } from "../comms/commsApi";
import { LINK_COLLECTION, PLAN_COLLECTION, utmSlug, type MarketingPlan } from "./marketingData";

// One spelling per place, so reports group cleanly instead of splitting
// "Instagram", "insta" and "IG" into three rows.
const SOURCES = [
  "instagram", "facebook", "google", "youtube", "whatsapp", "email", "push", "poster", "table-tent",
  "flyer", "partner", "influencer", "referral",
];
const MEDIUMS = [
  { v: "social", label: "social — organic posts" },
  { v: "paid-social", label: "paid-social — Meta/YouTube ads" },
  { v: "cpc", label: "cpc — search ads" },
  { v: "email", label: "email" },
  { v: "push", label: "push" },
  { v: "qr", label: "qr — printed codes" },
  { v: "offline", label: "offline — print without QR" },
  { v: "influencer", label: "influencer" },
  { v: "referral", label: "referral / partner" },
];

interface SavedLink {
  id: string; name: string; url: string; destination: string;
  source: string; medium: string; campaign: string; content?: string;
  createdAt?: { toMillis?: () => number }; createdBy?: string;
}

function buildUrl(dest: string, p: { source: string; medium: string; campaign: string; content: string; term: string }): string | null {
  try {
    const u = new URL(dest.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const set = (k: string, v: string) => { const s = utmSlug(v); if (s) u.searchParams.set(k, s); };
    set("utm_source", p.source);
    set("utm_medium", p.medium);
    set("utm_campaign", p.campaign);
    set("utm_content", p.content);
    set("utm_term", p.term);
    return u.toString();
  } catch {
    return null;
  }
}

function downloadCanvas(canvas: HTMLCanvasElement | null, name: string) {
  if (!canvas) return;
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${utmSlug(name) || "kada-qr"}.png`;
  a.click();
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied");
  } catch {
    toast.error("Couldn't copy — select the link and copy it by hand.");
  }
}

/**
 * Tracked links & QR codes — every link in a post, ad, poster or table tent
 * carries consistent UTM tags tied to a plan's campaign name, so web
 * analytics can say which placement brought the visit. Codes download as
 * print-ready PNGs.
 */
export default function LinksQrPage() {
  const [dest, setDest] = useState("https://thekada.in");
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [term, setTerm] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [plans, setPlans] = useState<MarketingPlan[]>([]);
  const [showQr, setShowQr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SavedLink | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const rowQrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => listenCollection<SavedLink>(LINK_COLLECTION, { orderByField: "createdAt", limit: 300 }, setLinks), []);
  useEffect(() => listenCollection<MarketingPlan>(PLAN_COLLECTION, { orderByField: "createdAt", limit: 300 }, setPlans), []);

  const url = useMemo(() => buildUrl(dest, { source, medium, campaign, content, term }), [dest, source, medium, campaign, content, term]);
  const openPlans = plans.filter((p) => !["done", "cancelled"].includes(p.status));

  const save = async () => {
    if (!url) { toast.error("Enter a full web address, starting with https://"); return; }
    if (!utmSlug(campaign)) { toast.error("Add a campaign name so the visits can be traced to a plan."); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, LINK_COLLECTION), {
        name: name.trim() || `${utmSlug(campaign)} · ${source}`,
        url, destination: dest.trim(), source: utmSlug(source), medium: utmSlug(medium), campaign: utmSlug(campaign),
        content: utmSlug(content) || null, term: utmSlug(term) || null,
        createdAt: serverTimestamp(), createdBy: auth.currentUser?.email || null,
      });
      toast.success("Link saved");
      setName("");
      setContent("");
    } catch {
      toast.error("Couldn't save the link. Check your admin access and try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteDoc(doc(db, LINK_COLLECTION, deleting.id));
      toast.success("Link deleted");
    } catch {
      toast.error("Couldn't delete the link.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Links & QR</h2>
        <p className="text-sm text-muted-foreground">Tagged links and print-ready QR codes, so you can see which post, ad or poster brought people in.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="rounded-2xl lg:col-span-3">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" />Build a link</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Destination</Label>
              <Input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="https://thekada.in/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Source — where it's placed</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Medium — what kind of placement</Label>
              <Select value={medium} onValueChange={setMedium}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MEDIUMS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Campaign</Label>
              {openPlans.length > 0 ? (
                <Select value={campaign || "__custom"} onValueChange={(v) => setCampaign(v === "__custom" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Pick a plan" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom">Type a name…</SelectItem>
                    {openPlans.map((p) => (
                      <SelectItem key={p.id} value={p.utmCampaign || utmSlug(p.name)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {(!openPlans.length || !openPlans.some((p) => (p.utmCampaign || utmSlug(p.name)) === campaign)) && (
                <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="diwali-2026" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Content <span className="text-muted-foreground font-normal">(optional — which creative)</span></Label>
              <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="reel-biryani-v2" />
            </div>
            <div className="space-y-1.5">
              <Label>Term <span className="text-muted-foreground font-normal">(optional — search keyword)</span></Label>
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="food delivery kochi" />
            </div>
            <div className="space-y-1.5">
              <Label>Label <span className="text-muted-foreground font-normal">(for this list)</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bio link, Oct" />
            </div>
            <div className="sm:col-span-2 rounded-xl border bg-muted/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your link</p>
              <p className="text-xs font-mono break-all mt-1">{url ?? "Enter a full web address, starting with https://"}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" disabled={!url} onClick={() => url && copy(url)}><Copy className="h-4 w-4 mr-1.5" />Copy</Button>
                <Button size="sm" onClick={save} disabled={saving || !url}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}Save link
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4" />QR code</CardTitle></CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {url ? (
              <>
                <div className="rounded-2xl bg-white p-4 border">
                  <QRCodeCanvas ref={qrRef} value={url} size={220} level="M" marginSize={2} />
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadCanvas(qrRef.current, name || campaign || "kada-qr")}>
                  <Download className="h-4 w-4 mr-1.5" />Download PNG
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  Print at least 2.5 cm wide, dark on light. Test-scan the printed proof before a full print run.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-10">The QR appears once the link is valid.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">Saved links</CardTitle></CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Saved links appear here for the whole team to reuse.</p>
          ) : (
            <div className="divide-y">
              {links.map((l) => (
                <div key={l.id} className="py-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.campaign} · {l.source} / {l.medium}{l.content ? ` · ${l.content}` : ""} · {when(l.createdAt)}{l.createdBy ? ` · ${l.createdBy}` : ""}
                      </p>
                      <p className="text-[11px] font-mono text-muted-foreground break-all mt-0.5">{l.url}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Copy link" onClick={() => copy(l.url)}><Copy className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Show QR"
                        onClick={() => setShowQr((s) => (s === l.id ? null : l.id))}><QrCode className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" aria-label="Delete link" onClick={() => setDeleting(l)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  {showQr === l.id && (
                    <div className="mt-3 flex items-center gap-4">
                      <div className="rounded-xl bg-white p-3 border">
                        <QRCodeCanvas ref={rowQrRef} value={l.url} size={140} level="M" marginSize={2} />
                      </div>
                      <Button size="sm" variant="outline" onClick={() => downloadCanvas(rowQrRef.current, l.name)}>
                        <Download className="h-4 w-4 mr-1.5" />Download PNG
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            Read the results in the destination site's analytics, grouped by these UTM values. Deleting a link here doesn't break printed codes.
          </p>
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete "${deleting?.name ?? ""}"?`}
        description="It's removed from this list only. The link and any printed QR keep working."
        confirmLabel="Delete"
        isDanger
        onConfirm={remove}
      />
    </div>
  );
}
