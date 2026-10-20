import { PageSkeleton } from "@/components/admin/core/LoadingSkeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, onSnapshot, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { writeAudit } from "@/lib/audit";
import { toast } from "sonner";
import {
  Loader2,
  Bike,
  Truck,
  Settings2,
  Save,
  IndianRupee,
  Zap,
  Trophy,
  Smartphone,
  Store,
  LifeBuoy,
  Plus,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

/**
 * Platform Settings — the one place for platform-wide switches and numbers.
 * Every field here is read by the apps or the backend; nothing is decorative.
 * Four documents, each with a single owner rule:
 *
 *   config/platform          fees, rider pay, operations, support contacts
 *                            (read by delivery.ts → the pricing engine's legacy
 *                            baseline, and by the customer app)
 *   settings/delivery        surge override + rider daily quest
 *                            (calculateDeliveryFee / pricing, completeDelivery,
 *                            rider app)
 *   config/feature_flags     customer-app modules — the app and the server both
 *                            let these win over config/platform (featureFlags.ts)
 *   config/platform_features vendor-dashboard modules (DashboardLayout)
 *
 * Defaults MUST match the code fallbacks so nothing changes until an admin
 * saves an override.
 */
const DEFAULTS = {
  deliveryBaseFee: 25,
  deliveryPerKm: 7,
  freeDeliveryUnderKm: 3,
  freeDeliveryAbove: 0,
  minOrderValue: 0,
  platformFee: 0,
  defaultCommissionPercent: 10,
  riderBaseFee: 20,
  riderPerKm: 8,
  serviceRadiusKm: 15,
  autoDispatchEnabled: true,
  maintenanceMode: false,
  supportPhone: "",
  supportWhatsapp: "",
};
type PlatformCfg = typeof DEFAULTS;

interface QuestTier {
  trips: number;
  bonus: number;
}
const DELIVERY_DEFAULTS = {
  surgeActive: false,
  surgeFee: 20,
  surgeReason: "Peak demand",
  questTiers: [
    { trips: 8, bonus: 150 },
    { trips: 15, bonus: 250 },
    { trips: 20, bonus: 300 },
  ] as QuestTier[],
};
type DeliveryCfg = typeof DELIVERY_DEFAULTS;

const MODULES: { key: string; label: string; hint: string }[] = [
  { key: "cashOnDelivery", label: "Cash on delivery", hint: "COD at checkout. Enforced by the server too." },
  { key: "wallet", label: "Kada Money wallet", hint: "Top-ups and paying with the wallet. Refunds to the wallet still work." },
  { key: "kadaGold", label: "Kada Gold", hint: "New Gold memberships. Existing members keep their benefits." },
  { key: "kadaStay", label: "KadaStay", hint: "Stay tab and new bookings." },
  { key: "tableBooking", label: "Table booking", hint: "Dine-in reservations." },
  { key: "giftCards", label: "Gift cards", hint: "Buying gift cards." },
  { key: "groupOrdering", label: "Group ordering", hint: "Shared carts and split bills." },
  { key: "referrals", label: "Referral bonuses", hint: "Referral credits for new customers." },
  { key: "ads", label: "Sponsored ads", hint: "Sponsored banners and boosted restaurants on home." },
];
const MODULE_DEFAULTS: Record<string, boolean> = Object.fromEntries(MODULES.map((m) => [m.key, true]));

const VENDOR_MODULES: { key: string; label: string; hint: string }[] = [
  { key: "kds", label: "Kitchen display", hint: "Kitchen screen in the vendor web dashboard." },
  { key: "marketing", label: "Marketing", hint: "Campaigns and offers in the vendor web dashboard." },
];
const VENDOR_DEFAULTS: Record<string, boolean> = Object.fromEntries(VENDOR_MODULES.map((m) => [m.key, true]));

/** The automatic surge the server applies when no override is on (delivery.ts, pricing/legacy.ts). */
const AUTO_SURGE = [
  { name: "Lunch rush", hours: "12:00 – 14:59", fee: 15 },
  { name: "Dinner", hours: "19:00 – 22:59", fee: 20 },
  { name: "Late night", hours: "23:00 – 04:59", fee: 25 },
];

const MAX_TIERS = 6;

const NumField = ({
  label,
  hint,
  value,
  onChange,
  prefix = "₹",
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold uppercase tracking-wide">{label}</Label>
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-bold">{prefix}</span>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Number.isFinite(next) ? Math.max(0, next) : 0);
        }}
        className="pl-8 font-bold"
      />
    </div>
    {hint && <p className="text-[10px] text-muted-foreground font-bold">{hint}</p>}
  </div>
);

const ToggleRow = ({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 p-4">
    <div>
      <p className="text-sm font-semibold uppercase tracking-tight">{label}</p>
      <p className="text-[11px] text-muted-foreground font-bold">{hint}</p>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

const Section = ({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: typeof Truck;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <Card className={`rounded-2xl border-border/40 shadow-card ${className ?? ""}`}>
    <CardHeader>
      <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
        <Icon className="h-4 w-4" /> {title}
      </CardTitle>
      {description && <CardDescription className="text-xs">{description}</CardDescription>}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

/** Problems that would make the quest ladder pay wrongly; empty = valid. */
function questProblems(tiers: QuestTier[]): string[] {
  const out: string[] = [];
  if (tiers.length === 0) out.push("Add at least one tier, or riders get no daily quest.");
  tiers.forEach((t, i) => {
    if (!(t.trips >= 1)) out.push(`Tier ${i + 1}: trips must be at least 1.`);
    if (!(t.bonus >= 0)) out.push(`Tier ${i + 1}: bonus can't be negative.`);
    if (i > 0 && t.trips <= tiers[i - 1].trips) out.push(`Tier ${i + 1} must need more trips than tier ${i}.`);
  });
  return out;
}

export default function PlatformSettingsPage() {
  const [platform, setPlatform] = useState<PlatformCfg>(DEFAULTS);
  const [delivery, setDelivery] = useState<DeliveryCfg>(DELIVERY_DEFAULTS);
  const [modules, setModules] = useState<Record<string, boolean>>(MODULE_DEFAULTS);
  const [vendorModules, setVendorModules] = useState<Record<string, boolean>>(VENDOR_DEFAULTS);
  const [saved, setSaved] = useState<{
    platform: PlatformCfg;
    delivery: DeliveryCfg;
    modules: Record<string, boolean>;
    vendorModules: Record<string, boolean>;
  } | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const markLoaded = (k: string) => setLoaded((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
  // Which parts the admin is editing — a live update from elsewhere (Live
  // Operations also writes config/platform) must not wipe unsaved edits.
  const dirtyRef = useRef<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Live listeners. Each also refreshes the "saved" snapshot used for the
  // dirty check and the audit before/after, as long as the admin hasn't
  // started editing that part.
  useEffect(() => {
    const onErr = (what: string) => (err: unknown) => {
      console.error(`Platform settings: ${what} failed`, err);
      toast.error(`Couldn't load ${what}`);
      markLoaded(what);
    };
    const subs = [
      onSnapshot(doc(db, "config", "platform"), (snap) => {
        const d = (snap.data() ?? {}) as Partial<PlatformCfg>;
        const next = { ...DEFAULTS };
        (Object.keys(DEFAULTS) as (keyof PlatformCfg)[]).forEach((k) => {
          if (d[k] !== undefined && typeof d[k] === typeof DEFAULTS[k]) (next as Record<string, unknown>)[k] = d[k];
        });
        if (!dirtyRef.current.includes("platform")) setPlatform(next);
        setSaved((s) => ({ ...(s ?? emptySaved()), platform: next }));
        markLoaded("platform settings");
      }, onErr("platform settings")),
      onSnapshot(doc(db, "settings", "delivery"), (snap) => {
        const d = snap.data() ?? {};
        const tiers: QuestTier[] = Array.isArray(d.questTiers) && d.questTiers.length
          ? (d.questTiers as QuestTier[]).map((t) => ({ trips: Number(t.trips) || 0, bonus: Number(t.bonus) || 0 }))
          : typeof d.questTarget === "number"
            ? [{ trips: d.questTarget, bonus: Number(d.questBonus) || 0 }]
            : DELIVERY_DEFAULTS.questTiers;
        const next: DeliveryCfg = {
          surgeActive: d.surgeActive === true,
          surgeFee: typeof d.surgeFee === "number" ? d.surgeFee : DELIVERY_DEFAULTS.surgeFee,
          surgeReason: typeof d.surgeReason === "string" ? d.surgeReason : DELIVERY_DEFAULTS.surgeReason,
          questTiers: [...tiers].sort((a, b) => a.trips - b.trips),
        };
        if (!dirtyRef.current.includes("delivery")) setDelivery(next);
        setSaved((s) => ({ ...(s ?? emptySaved()), delivery: next }));
        markLoaded("surge & quest settings");
      }, onErr("surge & quest settings")),
      onSnapshot(doc(db, "config", "feature_flags"), (snap) => {
        const d = snap.data() ?? {};
        const next = { ...MODULE_DEFAULTS };
        Object.keys(MODULE_DEFAULTS).forEach((k) => {
          if (typeof d[k] === "boolean") next[k] = d[k];
        });
        if (!dirtyRef.current.includes("modules")) setModules(next);
        setSaved((s) => ({ ...(s ?? emptySaved()), modules: next }));
        markLoaded("app modules");
      }, onErr("app modules")),
      onSnapshot(doc(db, "config", "platform_features"), (snap) => {
        const d = snap.data() ?? {};
        const next = { ...VENDOR_DEFAULTS };
        Object.keys(VENDOR_DEFAULTS).forEach((k) => {
          if (typeof d[k] === "boolean") next[k] = d[k];
        });
        if (!dirtyRef.current.includes("vendorModules")) setVendorModules(next);
        setSaved((s) => ({ ...(s ?? emptySaved()), vendorModules: next }));
        markLoaded("vendor modules");
      }, onErr("vendor modules")),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  const dirtyParts = useMemo(() => {
    if (!saved) return [] as string[];
    const parts: string[] = [];
    if (JSON.stringify(platform) !== JSON.stringify(saved.platform)) parts.push("platform");
    if (JSON.stringify(delivery) !== JSON.stringify(saved.delivery)) parts.push("delivery");
    if (JSON.stringify(modules) !== JSON.stringify(saved.modules)) parts.push("modules");
    if (JSON.stringify(vendorModules) !== JSON.stringify(saved.vendorModules)) parts.push("vendorModules");
    return parts;
  }, [platform, delivery, modules, vendorModules, saved]);
  dirtyRef.current = dirtyParts;

  const problems = questProblems(delivery.questTiers);
  const surgeProblem =
    delivery.surgeActive && !(delivery.surgeFee > 0) ? "Set a surge fee above ₹0 before turning the override on." : null;

  const setP = <K extends keyof PlatformCfg>(k: K, v: PlatformCfg[K]) => setPlatform((p) => ({ ...p, [k]: v }));
  const setD = <K extends keyof DeliveryCfg>(k: K, v: DeliveryCfg[K]) => setDelivery((p) => ({ ...p, [k]: v }));
  const setTier = (i: number, patch: Partial<QuestTier>) =>
    setD("questTiers", delivery.questTiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const save = async () => {
    if (problems.length || surgeProblem) {
      toast.error(problems[0] ?? surgeProblem ?? "Fix the highlighted settings first");
      return;
    }
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const at = serverTimestamp();
      if (dirtyParts.includes("platform")) {
        batch.set(doc(db, "config", "platform"), { ...platform, updatedAt: at }, { merge: true });
      }
      if (dirtyParts.includes("delivery")) {
        const tiers = [...delivery.questTiers].sort((a, b) => a.trips - b.trips);
        const top = tiers[tiers.length - 1];
        batch.set(
          doc(db, "settings", "delivery"),
          {
            surgeActive: delivery.surgeActive,
            surgeFee: Number(delivery.surgeFee) || 0,
            surgeReason: delivery.surgeReason.trim() || "Peak demand",
            questTiers: tiers,
            // Older rider-app builds read the single legacy target.
            questTarget: top.trips,
            questBonus: top.bonus,
            updatedAt: at,
          },
          { merge: true },
        );
      }
      if (dirtyParts.includes("modules")) {
        batch.set(doc(db, "config", "feature_flags"), { ...modules, updatedAt: at }, { merge: true });
      }
      if (dirtyParts.includes("vendorModules")) {
        batch.set(doc(db, "config", "platform_features"), { ...vendorModules, updatedAt: at }, { merge: true });
      }
      await batch.commit();
      await writeAudit({
        action: "PLATFORM_SETTINGS_UPDATED",
        entity: "platform_settings",
        description: `Updated ${dirtyParts.join(", ")}`,
        before: saved ? Object.fromEntries(dirtyParts.map((p) => [p, saved[p as keyof typeof saved]])) : null,
        after: Object.fromEntries(
          dirtyParts.map((p) => [p, { platform, delivery, modules, vendorModules }[p as "platform"]]),
        ),
      });
      setSaved({ platform, delivery, modules, vendorModules });
      toast.success("Saved — live across all apps");
    } catch (e) {
      console.error(e);
      toast.error("Save failed — your admin role may not allow changing platform settings");
    } finally {
      setSaving(false);
    }
  };

  if (loaded.size < 4 || !saved) {
    return (
      <PageSkeleton kpis={0} />
    );
  }

  const questTotal = delivery.questTiers.reduce((s, t) => s + (Number(t.bonus) || 0), 0);

  return (
    <div className="space-y-6 pb-28">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Platform settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fees, rider pay, surge, quests and app modules. Changes go live in the customer, rider and vendor apps.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {platform.maintenanceMode && (
            <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30 font-semibold uppercase tracking-wide">
              Maintenance mode ON
            </Badge>
          )}
          {delivery.surgeActive && (
            <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 font-semibold uppercase tracking-wide">
              Surge override +₹{delivery.surgeFee}
            </Badge>
          )}
        </div>
      </div>

      <Section
        icon={Truck}
        title="Delivery & fees"
        description={
          <>
            What the customer pays — the baseline the pricing engine uses. Rules published in{" "}
            <Link to="/admin/pricing" className="underline">Pricing</Link> take priority. GST is set per restaurant and by
            Pricing tax rules, not here.
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumField label="Delivery base fee" value={platform.deliveryBaseFee} onChange={(n) => setP("deliveryBaseFee", n)} hint="Flat fee per delivery order" />
          <NumField label="Delivery ₹ / km" value={platform.deliveryPerKm} onChange={(n) => setP("deliveryPerKm", n)} hint="Distance component" />
          <NumField label="Free within km" value={platform.freeDeliveryUnderKm} onChange={(n) => setP("freeDeliveryUnderKm", n)} prefix="km" hint="Distance threshold for free delivery" />
          <NumField label="Free delivery above" value={platform.freeDeliveryAbove} onChange={(n) => setP("freeDeliveryAbove", n)} hint="Order value for free delivery (0 = off)" />
          <NumField label="Min order value" value={platform.minOrderValue} onChange={(n) => setP("minOrderValue", n)} hint="0 = no minimum" />
          <NumField label="Platform fee" value={platform.platformFee} onChange={(n) => setP("platformFee", n)} hint="Flat platform fee (0 = off)" />
          <NumField label="Default vendor commission" value={platform.defaultCommissionPercent} onChange={(n) => setP("defaultCommissionPercent", Math.min(100, n))} prefix="%" hint="When neither the restaurant nor its plan sets one" />
        </div>
      </Section>

      <Section icon={Bike} title="Rider pay" description="What a rider earns per delivery: base + distance + their share of surge + the customer's tip.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumField label="Rider base fee" value={platform.riderBaseFee} onChange={(n) => setP("riderBaseFee", n)} hint="Guaranteed pay per delivery" />
          <NumField label="Rider ₹ / km" value={platform.riderPerKm} onChange={(n) => setP("riderPerKm", n)} hint="Distance pay (restaurant → drop)" />
          <div className="flex items-end">
            <div className="rounded-2xl bg-primary/5 border border-primary/15 p-3 w-full">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Example payout</p>
              <p className="font-black text-lg flex items-center gap-1">
                <IndianRupee className="h-4 w-4" />
                {platform.riderBaseFee + platform.riderPerKm * 3}
                <span className="text-xs font-bold text-muted-foreground">for a 3 km trip</span>
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        icon={Zap}
        title="Surge pricing & peak hours"
        description="Added to the delivery fee on every order and shared with the rider. A zone's own multiplier scales it."
        className={delivery.surgeActive ? "border-amber-500/40" : ""}
      >
        <div className="space-y-4">
          <ToggleRow
            label="Manual surge override"
            hint={delivery.surgeActive ? "On — replaces the automatic peak-hour surge until turned off." : "Off — the automatic schedule below applies."}
            checked={delivery.surgeActive}
            onChange={(v) => setD("surgeActive", v)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <NumField label="Override surge fee" value={delivery.surgeFee} onChange={(n) => setD("surgeFee", n)} hint="Per order, while the override is on" />
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide">Reason shown to customers</Label>
              <Input value={delivery.surgeReason} maxLength={60} onChange={(e) => setD("surgeReason", e.target.value)} className="font-bold" />
              <p className="text-[10px] text-muted-foreground font-bold">e.g. "Heavy rain", "Festival rush"</p>
            </div>
          </div>
          {surgeProblem && <p className="text-xs font-bold text-rose-600">{surgeProblem}</p>}
          <div className="rounded-2xl border border-border/50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Automatic peak-hour surge (IST)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {AUTO_SURGE.map((w) => (
                <div key={w.name} className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs font-black">{w.name}</p>
                  <p className="text-[11px] text-muted-foreground font-bold">{w.hours} · +₹{w.fee}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground font-bold mt-2">
              Built into the server. To change these windows or amounts, publish surge rules in{" "}
              <Link to="/admin/pricing" className="underline">Pricing</Link> — they take priority.
            </p>
          </div>
        </div>
      </Section>

      <Section
        icon={Trophy}
        title="Rider daily quest"
        description="Milestones for trips completed in a day (IST). Each tier is paid once, the moment it's reached — riders see every tier and the total in their app."
      >
        <div className="space-y-3">
          {delivery.questTiers.map((t, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-3">
              <span className="pb-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-12">Tier {i + 1}</span>
              <NumField label="Trips" prefix="#" value={t.trips} onChange={(n) => setTier(i, { trips: Math.round(n) })} />
              <NumField label="Bonus" value={t.bonus} onChange={(n) => setTier(i, { bonus: Math.round(n) })} />
              <Button
                variant="ghost"
                size="icon"
                className="mb-0.5"
                aria-label={`Remove tier ${i + 1}`}
                onClick={() => setD("questTiers", delivery.questTiers.filter((_, j) => j !== i))}
              >
                <XCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          {problems.map((p) => (
            <p key={p} className="text-xs font-bold text-rose-600">{p}</p>
          ))}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <Button
              variant="outline"
              className="rounded-xl gap-1.5"
              disabled={delivery.questTiers.length >= MAX_TIERS}
              onClick={() => {
                const last = delivery.questTiers[delivery.questTiers.length - 1] ?? { trips: 0, bonus: 0 };
                setD("questTiers", [...delivery.questTiers, { trips: last.trips + 5, bonus: last.bonus + 50 }]);
              }}
            >
              <Plus className="h-4 w-4" /> Add tier
            </Button>
            <p className="text-xs font-bold text-muted-foreground">
              A rider who completes every tier earns <span className="text-foreground">₹{questTotal.toLocaleString("en-IN")}</span> a day in quest bonuses.
            </p>
          </div>
        </div>
      </Section>

      <Section
        icon={Smartphone}
        title="Customer app modules"
        description="Turning a module off hides it in the app and the server refuses it, within about 30 seconds."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODULES.map((m) => (
            <ToggleRow key={m.key} label={m.label} hint={m.hint} checked={modules[m.key]} onChange={(v) => setModules((p) => ({ ...p, [m.key]: v }))} />
          ))}
        </div>
      </Section>

      <Section icon={Store} title="Vendor dashboard modules" description="Platform-wide switches for sections of the vendor web dashboard.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {VENDOR_MODULES.map((m) => (
            <ToggleRow key={m.key} label={m.label} hint={m.hint} checked={vendorModules[m.key]} onChange={(v) => setVendorModules((p) => ({ ...p, [m.key]: v }))} />
          ))}
        </div>
      </Section>

      <Section icon={Settings2} title="Operations">
        <div className="space-y-4">
          <NumField label="Delivery radius (km)" value={platform.serviceRadiusKm} onChange={(n) => setP("serviceRadiusKm", Math.min(25, n))} prefix="◎" hint="Outside a zone. Inside a zone, the zone's own radius applies. Max 25 km." />
          <ToggleRow label="Auto-dispatch riders" hint="Offer new orders to nearby riders automatically. Off = dispatch by hand from Live Operations." checked={platform.autoDispatchEnabled} onChange={(v) => setP("autoDispatchEnabled", v)} />
          <ToggleRow label="Maintenance mode" hint="Customers see a maintenance notice and can't get delivery quotes." checked={platform.maintenanceMode} onChange={(v) => setP("maintenanceMode", v)} />
        </div>
      </Section>

      <Section icon={LifeBuoy} title="Support contacts" description="Shown to customers in the app's help screens.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide">Support phone</Label>
            <Input value={platform.supportPhone} inputMode="tel" placeholder="+91…" onChange={(e) => setP("supportPhone", e.target.value.replace(/[^\d+ ]/g, ""))} className="font-bold" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide">Support WhatsApp</Label>
            <Input value={platform.supportWhatsapp} inputMode="tel" placeholder="Same as phone if empty" onChange={(e) => setP("supportWhatsapp", e.target.value.replace(/[^\d+ ]/g, ""))} className="font-bold" />
          </div>
        </div>
      </Section>

      <div className="fixed bottom-0 left-0 right-0 md:left-[var(--sidebar-width,16rem)] bg-background/80 backdrop-blur-xl border-t border-border/50 p-4 z-30">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
            {dirtyParts.length ? "Unsaved changes" : "All changes saved"}
          </p>
          <Button onClick={save} disabled={saving || dirtyParts.length === 0} className="rounded-2xl font-semibold uppercase tracking-wide gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save & publish
          </Button>
        </div>
      </div>
    </div>
  );
}

function emptySaved() {
  return {
    platform: DEFAULTS,
    delivery: DELIVERY_DEFAULTS,
    modules: MODULE_DEFAULTS,
    vendorModules: VENDOR_DEFAULTS,
  };
}
