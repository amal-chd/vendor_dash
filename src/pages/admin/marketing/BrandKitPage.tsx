import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy, Loader2, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { when } from "../comms/commsApi";
import { BRAND_DOC } from "./marketingData";

// Mirrors functions/src/comms/brand.ts and the apps' Kada Blue — the
// palette is code, so it's shown here to copy, not edited.
const PALETTE = [
  { name: "Navy", hex: "#0F1F4F" },
  { name: "Royal", hex: "#1E3A8A" },
  { name: "Kada Blue", hex: "#2563EB" },
  { name: "Azure", hex: "#0284C7" },
  { name: "Ice", hex: "#E0F2FE" },
  { name: "Ink", hex: "#0F172A" },
  { name: "Kada Gold", hex: "#B07D12" },
];

interface Brand {
  positioning: string;
  voice: string;
  wordsUse: string;
  wordsAvoid: string;
  claims: string;
  offerRules: string;
  logoUrl: string;
  handles: string;
  hashtags: string;
  updatedAt?: { toMillis?: () => number };
  updatedBy?: string;
}

// A starting point the team edits — nothing is saved until they press Save.
const STARTER: Brand = {
  positioning: "The Kada is the local super-app for food delivery, dining, stays and mess — built for our city, fair to the kitchens and riders who power it.",
  voice: "Warm, local and plain-spoken. Short sentences. Talk like a helpful neighbour, not a bank. Confident, never shouty.",
  wordsUse: "your neighbourhood, fresh, on the way, local kitchens, fair",
  wordsAvoid: "ALL CAPS, !!!, 'best in India', 'guaranteed', 'free' (unless it is free), fake urgency ('only 2 left' when it isn't)",
  claims: "Never publish a number we can't prove — no invented order counts, ratings, delivery times or savings. Every claim needs a source in our own data.",
  offerRules: "State the full condition next to the headline (minimum order, max discount, expiry, who it's for). Codes in caps. One offer per message.",
  logoUrl: "https://www.thekada.in/favicon.png",
  handles: "",
  hashtags: "#TheKada",
};

const FIELDS: { key: keyof Brand; label: string; hint: string; rows?: number }[] = [
  { key: "positioning", label: "Positioning", hint: "One or two sentences: who we're for and why us.", rows: 3 },
  { key: "voice", label: "Voice & tone", hint: "How every message should sound.", rows: 3 },
  { key: "wordsUse", label: "Words we use", hint: "Comma-separated.", rows: 2 },
  { key: "wordsAvoid", label: "Words & habits we avoid", hint: "Comma-separated.", rows: 2 },
  { key: "claims", label: "Claims rule", hint: "What may be stated as fact, and the proof needed.", rows: 3 },
  { key: "offerRules", label: "How we write offers", hint: "So customers never feel tricked.", rows: 3 },
];

/**
 * Brand kit — the one page a marketer, agency or partner reads before
 * writing anything for The Kada. Saved in marketing_settings/brand.
 */
export default function BrandKitPage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => onSnapshot(doc(db, ...BRAND_DOC), (snap) => {
    setSaved(snap.exists());
    setBrand((cur) => cur ?? (snap.exists() ? { ...STARTER, ...(snap.data() as Brand) } : STARTER));
  }, () => setBrand((cur) => cur ?? STARTER)), []);

  const save = async () => {
    if (!brand) return;
    setSaving(true);
    try {
      const { updatedAt: _u, updatedBy: _b, ...rest } = brand;
      await setDoc(doc(db, ...BRAND_DOC), { ...rest, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || null }, { merge: true });
      toast.success("Brand kit saved");
    } catch {
      toast.error("Couldn't save the brand kit. Check your admin access and try again.");
    } finally {
      setSaving(false);
    }
  };

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1500);
    } catch {
      toast.error("Couldn't copy.");
    }
  };

  if (!brand) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading brand kit…</div>;
  }
  const set = (k: keyof Brand, v: string) => setBrand({ ...brand, [k]: v });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Brand kit</h2>
          <p className="text-sm text-muted-foreground">
            How The Kada looks and sounds — read it before writing any campaign.
            {saved && brand.updatedAt ? ` Last saved ${when(brand.updatedAt)}${brand.updatedBy ? ` by ${brand.updatedBy}` : ""}.` : " Not saved yet — edit the starter text and save."}
          </p>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}Save brand kit
        </Button>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" />Colours & type</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            {PALETTE.map((c) => (
              <button key={c.hex} type="button" onClick={() => copyHex(c.hex)}
                className="rounded-xl border overflow-hidden text-left hover:shadow-sm transition-shadow">
                <div className="h-14" style={{ background: c.hex }} />
                <div className="p-2">
                  <p className="text-xs font-semibold">{c.name}</p>
                  <p className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                    {c.hex}{copied === c.hex ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Type: <span className="font-semibold">Plus Jakarta Sans</span> everywhere — apps, web and email. Gradients run navy → royal → Kada Blue → azure.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {FIELDS.map((f) => (
          <Card key={f.key} className="rounded-2xl">
            <CardContent className="p-5 space-y-1.5">
              <Label className="text-sm font-semibold">{f.label}</Label>
              <p className="text-xs text-muted-foreground">{f.hint}</p>
              <Textarea rows={f.rows ?? 3} value={(brand[f.key] as string) ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">Assets & handles</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input value={brand.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
            {/^https:\/\//.test(brand.logoUrl) && (
              <div className="mt-2 inline-flex rounded-xl border bg-white p-3">
                <img src={brand.logoUrl} alt="The Kada logo" className="h-12 w-12 object-contain" />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Social handles</Label>
            <Textarea rows={3} value={brand.handles} onChange={(e) => set("handles", e.target.value)} placeholder="Instagram @…  ·  YouTube @…" />
          </div>
          <div className="space-y-1.5">
            <Label>Hashtags</Label>
            <Textarea rows={3} value={brand.hashtags} onChange={(e) => set("hashtags", e.target.value)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
