import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { AlertTriangle, Plus, ScrollText, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Tier {
  hoursBefore: number;
  refundPercent: number;
}

/**
 * What "Flexible / Moderate / Strict" actually mean in money.
 *
 * Hosts have always picked one of these three labels in the listing wizard, but
 * nothing defined them — so guest cancellation could not be built at all. These
 * are the server's defaults (functions/src/stayCancellation.ts); saving here
 * overrides them live, with no deploy.
 */
const DEFAULTS: Record<string, Tier[]> = {
  Flexible: [{ hoursBefore: 24, refundPercent: 100 }],
  Moderate: [
    { hoursBefore: 120, refundPercent: 100 },
    { hoursBefore: 24, refundPercent: 50 },
  ],
  Strict: [
    { hoursBefore: 168, refundPercent: 100 },
    { hoursBefore: 48, refundPercent: 50 },
  ],
};

const hoursLabel = (h: number) => {
  if (h % 24 === 0 && h >= 24) {
    const d = h / 24;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  return `${h} hour${h === 1 ? "" : "s"}`;
};

export default function StayPolicies() {
  const [tiers, setTiers] = useState<Record<string, Tier[]>>(DEFAULTS);
  const [defaultPolicy, setDefaultPolicy] = useState("Moderate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [usingDefaults, setUsingDefaults] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, "config", "stay_policies"));
        const c = (snap.data()?.cancellation ?? {}) as {
          tiers?: Record<string, Tier[]>;
          defaultPolicy?: string;
        };
        if (c.tiers && Object.keys(c.tiers).length) {
          setTiers({ ...DEFAULTS, ...c.tiers });
          setUsingDefaults(false);
        }
        if (c.defaultPolicy) setDefaultPolicy(c.defaultPolicy);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't load the stay policies");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const problems = useMemo(() => {
    const out: string[] = [];
    for (const [name, ladder] of Object.entries(tiers)) {
      if (!ladder.length) {
        out.push(`${name} has no tiers — every cancellation on it refunds nothing.`);
        continue;
      }
      for (const t of ladder) {
        if (!Number.isFinite(t.hoursBefore) || t.hoursBefore < 0) {
          out.push(`${name}: notice hours must be zero or more.`);
        }
        if (!Number.isFinite(t.refundPercent) || t.refundPercent < 0 || t.refundPercent > 100) {
          out.push(`${name}: refund must be between 0% and 100%.`);
        }
      }
      const sorted = [...ladder].sort((a, b) => b.hoursBefore - a.hoursBefore);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].refundPercent > sorted[i - 1].refundPercent) {
          out.push(
            `${name}: cancelling later refunds MORE (${sorted[i].refundPercent}% at ${hoursLabel(sorted[i].hoursBefore)} vs ${sorted[i - 1].refundPercent}% at ${hoursLabel(sorted[i - 1].hoursBefore)}) — guests would be paid to wait.`,
          );
        }
        if (sorted[i].hoursBefore === sorted[i - 1].hoursBefore) {
          out.push(`${name}: two tiers at ${hoursLabel(sorted[i].hoursBefore)} — one will never apply.`);
        }
      }
    }
    if (!tiers[defaultPolicy]) {
      out.push(`The fallback policy "${defaultPolicy}" is not one of the tiers above.`);
    }
    return out;
  }, [tiers, defaultPolicy]);

  const save = async () => {
    if (problems.length) {
      toast.error("Fix the warnings before saving — these numbers move real money.");
      return;
    }
    setSaving(true);
    try {
      await setDoc(
        doc(db, "config", "stay_policies"),
        {
          cancellation: { tiers, defaultPolicy },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setUsingDefaults(false);
      toast.success("Saved. New cancellations use these terms immediately.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the policies");
    } finally {
      setSaving(false);
    }
  };

  const patchTier = (name: string, i: number, field: keyof Tier, value: string) => {
    setTiers((prev) => {
      const ladder = [...(prev[name] ?? [])];
      ladder[i] = { ...ladder[i], [field]: Math.round(Number(value)) };
      return { ...prev, [name]: ladder };
    });
  };

  const addTier = (name: string) =>
    setTiers((prev) => ({
      ...prev,
      [name]: [...(prev[name] ?? []), { hoursBefore: 24, refundPercent: 50 }],
    }));

  const removeTier = (name: string, i: number) =>
    setTiers((prev) => ({ ...prev, [name]: (prev[name] ?? []).filter((_, j) => j !== i) }));

  if (loading) return <p className="text-sm text-muted-foreground">Loading stay policies…</p>;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Cancellation policies"
        description="What Flexible, Moderate and Strict mean when a guest cancels. Read live by the server on every cancellation — no deploy needed."
        icon={ScrollText}
        badge={
          usingDefaults ? (
            <Badge variant="outline">using built-in defaults</Badge>
          ) : (
            <Badge>configured</Badge>
          )
        }
        actions={
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Fallback policy</Label>
              <Select value={defaultPolicy} onValueChange={setDefaultPolicy}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(tiers).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save policies"}
            </Button>
          </div>
        }
      />

      <p className="text-sm text-muted-foreground">
        A guest gets the refund of the <strong>first row whose notice period they still meet</strong>,
        as a percentage of everything they paid (room plus Kada&apos;s fee). Once check-in has passed,
        nothing is refundable. The app shows the guest this exact amount before they confirm.
      </p>

      {problems.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
          {problems.map((p) => (
            <div key={p} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(tiers).map(([name, ladder]) => (
          <Card key={name} className="rounded-2xl">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{name}</h3>
                {defaultPolicy === name && <Badge variant="outline">fallback</Badge>}
              </div>
              {[...ladder]
                .map((t, i) => ({ t, i }))
                .sort((a, b) => b.t.hoursBefore - a.t.hoursBefore)
                .map(({ t, i }) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Notice (hours)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={t.hoursBefore}
                        onChange={(e) => patchTier(name, i, "hoursBefore", e.target.value)}
                        className="w-[90px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Refund %
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={t.refundPercent}
                        onChange={(e) => patchTier(name, i, "refundPercent", e.target.value)}
                        className="w-[80px]"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeTier(name, i)}
                      aria-label="Remove tier"
                    >
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                ))}
              <Button size="sm" variant="outline" onClick={() => addTier(name)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add tier
              </Button>
              <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                {ladder.length === 0
                  ? "Nothing is ever refunded on this policy."
                  : [...ladder]
                      .sort((a, b) => b.hoursBefore - a.hoursBefore)
                      .map((t) => `${t.refundPercent}% if cancelled ${hoursLabel(t.hoursBefore)}+ ahead`)
                      .join("; ") + "; otherwise nothing."}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
