import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

interface Settings {
  fromName?: string; fromAddress?: string; replyTo?: string;
  maxMarketingPerDay?: number; maxMarketingPerWeek?: number;
  domain?: { verified?: boolean; spf?: boolean; dkim?: boolean; dmarc?: boolean };
}

function DnsRow({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm font-medium">{label}</span>
      {ok ? (
        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1"><ShieldCheck className="h-3 w-3" />Verified</Badge>
      ) : (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1"><ShieldAlert className="h-3 w-3" />Not verified</Badge>
      )}
    </div>
  );
}

export default function CommsSettingsPage() {
  const [s, setS] = useState<Settings>({});
  const [provider, setProvider] = useState<{ provider: string; providerConfigured: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const u = onSnapshot(doc(db, "communicationSettings", "email"), (d) => setS((d.data() as Settings) || {}), (err) => console.error("[CommsSettingsPage] communicationSettings listener failed", err));
    httpsCallable(functions, "commsOverview")({})
      .then((r) => setProvider(r.data as { provider: string; providerConfigured: boolean }))
      .catch(() => {});
    return u;
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "communicationSettings", "email"), {
        fromName: s.fromName || "The Kada",
        fromAddress: s.fromAddress || "no-reply@thekada.in",
        replyTo: s.replyTo || "support@thekada.in",
        domain: {
          name: "thekada.in",
          verified: true,
          spf: true,
          dkim: true,
          dmarc: true,
          dmarcPolicy: "none",
        },
        maxMarketingPerDay: Number(s.maxMarketingPerDay ?? 2),
        maxMarketingPerWeek: Number(s.maxMarketingPerWeek ?? 5),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast.success("Settings saved.");
    } catch { toast.error("Save failed (admin only)."); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Sender identity used for the next deploy, plus frequency caps. Credentials stay in Secret Manager.</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-bold">Email provider</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <Badge variant="outline" className="uppercase font-semibold">{provider?.provider || "—"}</Badge>
          {provider?.providerConfigured
            ? <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Configured</Badge>
            : <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Set provider credentials in Cloud Functions secrets</Badge>}
          <span className="text-xs text-muted-foreground">Credentials live only in server-side secrets — never here.</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-bold">Sender identity & limits</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>From name</Label><Input value={s.fromName ?? "The Kada"} onChange={(e) => setS({ ...s, fromName: e.target.value })} placeholder="The Kada" /></div>
            <div><Label>From address</Label><Input value={s.fromAddress ?? "no-reply@thekada.in"} onChange={(e) => setS({ ...s, fromAddress: e.target.value })} placeholder="no-reply@thekada.in" /></div>
          </div>
          <div><Label>Reply-to</Label><Input value={s.replyTo ?? "support@thekada.in"} onChange={(e) => setS({ ...s, replyTo: e.target.value })} placeholder="support@thekada.in" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Max marketing / day</Label><Input type="number" value={s.maxMarketingPerDay ?? 2} onChange={(e) => setS({ ...s, maxMarketingPerDay: Number(e.target.value) })} /></div>
            <div><Label>Max marketing / week</Label><Input type="number" value={s.maxMarketingPerWeek ?? 5} onChange={(e) => setS({ ...s, maxMarketingPerWeek: Number(e.target.value) })} /></div>
          </div>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save settings"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-bold">Domain authentication</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            Checked against Resend on 1 Oct 2026. The from address must stay on thekada.in or Resend will reject the send.
            DMARC exists and is monitoring only.
          </p>
          <DnsRow label="thekada.in verified" ok />
          <DnsRow label="SPF (send / rsend)" ok />
          <DnsRow label="DKIM" ok />
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">DMARC</span>
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Monitoring · p=none</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
