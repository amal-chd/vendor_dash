import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { comms, commsOp } from "./commsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Copy, PauseCircle } from "lucide-react";
import { toast } from "sonner";

interface Settings {
  fromName?: string; fromAddress?: string; replyTo?: string;
  marketingFromName?: string; marketingFromAddress?: string;
  maxMarketingPerDay?: number; maxMarketingPerWeek?: number;
  quietHoursStart?: number; quietHoursEnd?: number;
  pauseMarketing?: boolean; pauseAll?: boolean;
  postalAddress?: string; logoUrl?: string; bulkPerRun?: number;
}

const DEFAULT_LOGO = "https://www.thekada.in/favicon.png";
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString("en-IN", { hour: "numeric" });

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}{hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}</div>;
}

export default function CommsSettingsPage() {
  const [s, setS] = useState<Settings>({});
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [urls, setUrls] = useState<{ webhookUrl: string; unsubscribeUrl: string } | null>(null);

  useEffect(() => onSnapshot(doc(db, "communicationSettings", "email"), (d) => {
    if (!dirty) setS((d.data() as Settings) || {});
    setLoaded(true);
  }, (err) => { console.error("[CommsSettingsPage] settings listener failed", err); setLoaded(true); }), [dirty]);
  useEffect(() => { comms<{ webhookUrl: string; unsubscribeUrl: string }>("health").then(setUrls).catch(() => {}); }, []);

  const set = (patch: Partial<Settings>) => { setS((x) => ({ ...x, ...patch })); setDirty(true); };
  const save = async (override?: Partial<Settings>) => {
    const next = { ...s, ...override };
    if (await commsOp("saveSettings", { settings: next }, "Settings saved. They apply to the next email sent.", setSaving)) setDirty(false);
  };
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success("Copied."));

  if (!loaded) return <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">How every Kada email is sent. Provider keys stay in Secret Manager and never appear here.</p>
      </div>

      <Card className={s.pauseAll || s.pauseMarketing ? "border-amber-500/40" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2"><PauseCircle className="h-4 w-4" />Emergency pause</CardTitle>
          <CardDescription>Holds email in the queue — nothing is lost. Resume and it goes out. Saves immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
            <div><p className="text-sm font-semibold">Pause marketing</p><p className="text-xs text-muted-foreground">Campaigns, offers and announcements. Receipts keep going.</p></div>
            <Switch checked={!!s.pauseMarketing} onCheckedChange={(v) => { set({ pauseMarketing: v }); save({ pauseMarketing: v }); }} />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
            <div><p className="text-sm font-semibold">Pause everything</p><p className="text-xs text-muted-foreground">Every email except sign-in and security alerts. Use only during an incident.</p></div>
            <Switch checked={!!s.pauseAll} onCheckedChange={(v) => {
              if (v && !confirm("Pause all email? Customers will stop getting order and payment emails until you resume.")) return;
              set({ pauseAll: v }); save({ pauseAll: v });
            }} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Senders</CardTitle>
          <CardDescription>Marketing can go out under its own address (ideally a subdomain like news.thekada.in) so a bad campaign can't hurt receipt delivery.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Service email — from name"><Input value={s.fromName ?? "The Kada"} onChange={(e) => set({ fromName: e.target.value })} /></Field>
            <Field label="Service email — from address"><Input value={s.fromAddress ?? "no-reply@thekada.in"} onChange={(e) => set({ fromAddress: e.target.value })} /></Field>
            <Field label="Marketing — from name" hint="Blank = same as service"><Input value={s.marketingFromName ?? ""} placeholder="The Kada" onChange={(e) => set({ marketingFromName: e.target.value })} /></Field>
            <Field label="Marketing — from address" hint="Must be verified in Resend"><Input value={s.marketingFromAddress ?? ""} placeholder="hello@news.thekada.in" onChange={(e) => set({ marketingFromAddress: e.target.value })} /></Field>
          </div>
          <Field label="Reply-to" hint="Where replies go. A monitored inbox builds trust; no-reply alone looks cold."><Input value={s.replyTo ?? "support@thekada.in"} onChange={(e) => set({ replyTo: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Brand</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Logo URL" hint="HTTPS PNG or JPG, square, at least 96×96. SVG doesn't show in Gmail or Outlook.">
            <div className="flex items-center gap-3">
              <img src={s.logoUrl || DEFAULT_LOGO} alt="" className="h-10 w-10 rounded-lg border bg-white object-contain p-1" />
              <Input value={s.logoUrl ?? ""} placeholder={DEFAULT_LOGO} onChange={(e) => set({ logoUrl: e.target.value })} />
            </div>
          </Field>
          <Field label="Postal address in the footer" hint="Required by anti-spam law in many countries for marketing email.">
            <Input value={s.postalAddress ?? ""} placeholder="The Kada, Kochi, Kerala, India" onChange={(e) => set({ postalAddress: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Respecting people's inboxes</CardTitle>
          <CardDescription>Applied to every marketing email, per person, in their own timezone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Most offers per person per day"><Input type="number" min={0} max={10} value={s.maxMarketingPerDay ?? 2} onChange={(e) => set({ maxMarketingPerDay: Number(e.target.value) })} /></Field>
            <Field label="Most offers per person per week"><Input type="number" min={0} max={30} value={s.maxMarketingPerWeek ?? 5} onChange={(e) => set({ maxMarketingPerWeek: Number(e.target.value) })} /></Field>
            <Field label="Quiet hours start" hint={hourLabel(s.quietHoursStart ?? 21)}><Input type="number" min={0} max={23} value={s.quietHoursStart ?? 21} onChange={(e) => set({ quietHoursStart: Number(e.target.value) })} /></Field>
            <Field label="Quiet hours end" hint={`${hourLabel(s.quietHoursEnd ?? 9)} — marketing waits until then`}><Input type="number" min={0} max={23} value={s.quietHoursEnd ?? 9} onChange={(e) => set({ quietHoursEnd: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Campaign speed (emails per 2-minute run)" hint="Lower it when warming up a new sending domain."><Input type="number" min={100} max={5000} step={100} value={s.bulkPerRun ?? 1000} onChange={(e) => set({ bulkPerRun: Number(e.target.value) })} /></Field>
        </CardContent>
      </Card>

      <div className="sticky bottom-3 flex justify-end">
        <Button onClick={() => save()} disabled={saving || !dirty} className="shadow-lg">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? "Save changes" : "Saved"}</Button>
      </div>

      {urls && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Provider setup</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              ["Resend webhook endpoint", urls.webhookUrl, "In Resend → Webhooks, add this URL with all email.* events, then store its signing secret as RESEND_WEBHOOK_SECRET."],
              ["One-click unsubscribe endpoint", urls.unsubscribeUrl, "Put in every marketing email's List-Unsubscribe header automatically. Nothing to configure."],
            ].map(([label, url, hint]) => (
              <div key={label}>
                <p className="text-xs font-semibold">{label}</p>
                <div className="flex gap-2 mt-1"><Input readOnly value={url} className="font-mono text-xs" /><Button size="icon" variant="outline" onClick={() => copy(url)}><Copy className="h-4 w-4" /></Button></div>
                <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
