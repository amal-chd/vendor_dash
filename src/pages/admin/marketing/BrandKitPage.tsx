import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy, Loader2, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { when } from "../comms/commsApi";
import { BRAND_DOC } from "./marketingData";
import { BRAND_PROFILES_COLLECTION, BRAND_PROFILE_OPTIONS, buildBrandProfileMap, type BrandProfile } from "./brandProfiles";

const TEXT_FIELDS: { key: keyof BrandProfile; label: string; hint: string; rows?: number }[] = [
  { key: "description", label: "Profile description", hint: "Short internal description for the marketing team." },
  { key: "audience", label: "Primary audience", hint: "Who this product or company speaks to.", rows: 2 },
  { key: "positioning", label: "Positioning", hint: "Who it is for, what it does and why it matters.", rows: 3 },
  { key: "voice", label: "Voice & tone", hint: "How campaign copy should sound.", rows: 3 },
  { key: "wordsUse", label: "Words we use", hint: "Comma-separated phrases that fit the brand.", rows: 2 },
  { key: "wordsAvoid", label: "Words & habits we avoid", hint: "Claims, clichés or habits to keep out of copy.", rows: 2 },
  { key: "claims", label: "Claims & proof rules", hint: "Facts that need evidence or must not be invented.", rows: 3 },
  { key: "offerRules", label: "Offer rules", hint: "Terms and conditions the creative must communicate.", rows: 3 },
];

const ASSET_FIELDS: { key: "logoUrl" | "website" | "handles" | "hashtags" | "font"; label: string; placeholder: string }[] = [
  { key: "logoUrl", label: "Logo URL", placeholder: "https://…" },
  { key: "website", label: "Website / destination", placeholder: "https://…" },
  { key: "handles", label: "Social handles", placeholder: "Instagram @… · LinkedIn …" },
  { key: "hashtags", label: "Preferred hashtags", placeholder: "#Brand #Category" },
  { key: "font", label: "Typography", placeholder: "Font family or style" },
];

const COLOR_FIELDS: { key: keyof BrandProfile["palette"]; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
];

/** Shared brand source for Social Studio prompts and the wider Marketing workspace. */
export default function BrandKitPage() {
  const [savedProfiles, setSavedProfiles] = useState<Record<string, Partial<BrandProfile>>>({});
  const [legacyKada, setLegacyKada] = useState<Partial<BrandProfile>>();
  const [params, setParams] = useSearchParams();
  const requestedBrand = params.get("brand");
  const selectedId = BRAND_PROFILE_OPTIONS.some((option) => option.id === requestedBrand) ? requestedBrand! : "kadaverse";
  const setSelectedId = (id: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("brand", id);
      return next;
    }, { replace: true });
  };
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [profileLoadError, setProfileLoadError] = useState("");
  const profiles = useMemo(() => buildBrandProfileMap(savedProfiles, legacyKada), [savedProfiles, legacyKada]);
  const brand = profiles[selectedId];

  useEffect(() => {
    const unsubscribeProfiles = onSnapshot(collection(db, BRAND_PROFILES_COLLECTION), (snapshot) => {
      const rows: Record<string, Partial<BrandProfile>> = {};
      snapshot.docs.forEach((item) => { rows[item.id] = item.data() as Partial<BrandProfile>; });
      setSavedProfiles(rows);
      setProfileLoadError("");
    }, (error) => {
      const message = (error as { code?: string }).code === "permission-denied"
        ? "Your account cannot read marketing brand profiles. Confirm you have a marketing_manager, platform_admin or super_admin role and that Firestore rules are deployed."
        : "Couldn't load saved brand profiles. Check your connection and try again.";
      setProfileLoadError(message);
      toast.error(message);
    });
    const unsubscribeLegacy = onSnapshot(doc(db, ...BRAND_DOC), (snapshot) => {
      if (snapshot.exists()) setLegacyKada(snapshot.data() as Partial<BrandProfile>);
    }, (error) => console.error("[BrandKitPage] legacy communication brand listener failed", error));
    return () => { unsubscribeProfiles(); unsubscribeLegacy(); };
  }, []);

  const save = async () => {
    if (!brand) return;
    const invalidColor = COLOR_FIELDS.find((field) => !/^#[0-9a-fA-F]{6}$/.test(brand.palette[field.key]));
    if (invalidColor) {
      toast.error(`${invalidColor.label} colour must be a six-digit hex value, such as #2563EB.`);
      return;
    }
    setSaving(true);
    try {
      const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...rest } = brand;
      const payload = { ...rest, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || null };
      await setDoc(doc(db, BRAND_PROFILES_COLLECTION, brand.id), payload, { merge: true });
      // Keep the existing communication-brand record in sync for The Kada's
      // email/SMS templates that still read marketing_settings/brand.
      if (brand.id === "the-kada") await setDoc(doc(db, ...BRAND_DOC), payload, { merge: true });
      toast.success(`${brand.name} profile saved`);
    } catch {
      toast.error("Couldn't save this brand profile. Check your marketing admin access and try again.");
    } finally {
      setSaving(false);
    }
  };

  const copyHex = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(hex);
      setTimeout(() => setCopied((value) => value === hex ? null : value), 1500);
    } catch { toast.error("Couldn't copy the colour value."); }
  };

  const update = (key: keyof BrandProfile, value: string) => {
    setSavedProfiles((current) => ({
      ...current,
      [selectedId]: { ...brand, ...current[selectedId], [key]: value },
    }));
  };
  const updateColor = (key: keyof BrandProfile["palette"], value: string) => {
    setSavedProfiles((current) => ({
      ...current,
      [selectedId]: { ...brand, ...current[selectedId], palette: { ...brand.palette, [key]: value } },
    }));
  };

  if (!brand) return <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading brand kit…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-64 flex-1">
          <h2 className="text-lg font-bold tracking-tight">Brand kit</h2>
          <p className="text-sm text-muted-foreground">One editable source for KadaVerse and each product. Social Studio uses the selected profile in its full poster prompts.</p>
          {brand.updatedAt && <p className="mt-1 text-xs text-muted-foreground">Last saved {when(brand.updatedAt)}{brand.updatedBy ? ` by ${brand.updatedBy}` : ""}.</p>}
        </div>
        <Button size="sm" onClick={save} disabled={saving || Boolean(profileLoadError)}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Save {brand.name}
        </Button>
      </div>

      {profileLoadError && <Card role="alert" className="border-destructive/40 bg-destructive/5"><CardContent className="p-4 text-sm text-destructive">{profileLoadError} Profile saving is disabled until the existing settings are readable, to avoid overwriting them with defaults.</CardContent></Card>}

      <Card className="rounded-2xl">
        <CardHeader className="pb-3"><CardTitle className="text-base">Choose a company or product</CardTitle><CardDescription>Each profile has its own audience, tone, visual palette, logo and claim rules. Select the profile you are editing.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BRAND_PROFILE_OPTIONS.map((option) => (
              <button key={option.id} type="button" onClick={() => setSelectedId(option.id)} className={`rounded-xl border p-3 text-left transition-colors ${selectedId === option.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{option.section}</span>
                <span className="mt-1 block font-semibold">{option.name}</span>
                <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{profiles[option.id].description}</span>
              </button>
            ))}
          </div>
          <div className="rounded-xl border bg-muted/20 p-3 text-sm"><span className="font-semibold">{brand.name}</span><span className="text-muted-foreground"> · {brand.audience}</span></div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Palette className="h-4 w-4" />Colours & type</CardTitle><CardDescription>These are included in image prompts. Colour values accept six-digit hex codes.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {COLOR_FIELDS.map((field) => {
              const hex = brand.palette[field.key];
              return <div key={field.key} className="overflow-hidden rounded-xl border">
                <div className="h-14" style={{ background: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#ffffff" }} />
                <div className="space-y-1 p-2">
                  <Label className="text-xs font-semibold">{field.label}</Label>
                  <div className="flex gap-1"><Input aria-label={`${brand.name} ${field.label} colour`} value={hex} onChange={(event) => updateColor(field.key, event.target.value)} className="h-8 px-2 font-mono text-xs" /><Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Copy ${field.label} colour`} onClick={() => copyHex(hex)}>{copied === hex ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
                </div>
              </div>;
            })}
          </div>
          <div className="max-w-xl space-y-1.5"><Label>Typography</Label><Input value={brand.font} onChange={(event) => update("font", event.target.value)} placeholder="Font family or visual style" /></div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {TEXT_FIELDS.map((field) => (
          <Card key={field.key} className="rounded-2xl"><CardContent className="space-y-1.5 p-5">
            <Label className="text-sm font-semibold">{field.label}</Label><p className="text-xs text-muted-foreground">{field.hint}</p>
            <Textarea rows={field.rows ?? 2} value={String(brand[field.key] ?? "")} onChange={(event) => update(field.key, event.target.value)} />
          </CardContent></Card>
        ))}
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">Assets & publishing details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ASSET_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5"><Label>{field.label}</Label><Input value={brand[field.key]} onChange={(event) => update(field.key, event.target.value)} placeholder={field.placeholder} />
              {field.key === "logoUrl" && /^https:\/\//.test(brand.logoUrl) && <div className="inline-flex rounded-xl border bg-white p-2 dark:bg-slate-50"><img src={brand.logoUrl} alt={`${brand.name} logo`} className="h-12 w-12 object-contain" /></div>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
