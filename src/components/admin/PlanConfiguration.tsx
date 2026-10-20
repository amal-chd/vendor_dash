import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Save, RotateCcw, Settings2, AlertTriangle } from "lucide-react";

/**
 * Plan Configuration — the admin editor for `config/plan_catalog`, THE single
 * source of truth for Kada Dine + Kada Host pricing, commission and limits.
 *
 * Editing here propagates live to the marketing site, both dashboards and the
 * apps (they read the same catalog). It is never applied retroactively:
 * settlements snapshot their own rate at generation time, so changing a price
 * cannot rewrite a past order, invoice or settlement.
 */
interface PlanRow {
  id: string;
  product: "dine" | "stay";
  name: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  commissionPercent: number;
  maxOutlets: number;
  features: string[];
  visible: boolean;
  active: boolean;
  popular: boolean;
  sortOrder: number;
}

export function PlanConfiguration() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [original, setOriginal] = useState<PlanRow[]>([]);
  const [product, setProduct] = useState<"dine" | "stay">("dine");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number>(0);

  // The catalog document is created server-side on first read. Until something
  // calls getPlanCatalog it simply doesn't exist, which rendered an empty
  // "No plans configured" state with no way out. Seed it on mount, once.
  const [seeding, setSeeding] = useState(false);
  const seedCatalog = async () => {
    setSeeding(true);
    try {
      await httpsCallable(functions, "getPlanCatalog")({});
    } catch (e) {
      console.error("PlanConfiguration: seed failed", e);
      toast.error("Could not load the default plans.");
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "plan_catalog"),
      (snap) => {
        const raw = (snap.data()?.plans as PlanRow[] | undefined) ?? [];
        setPlans(raw);
        setOriginal(raw);
        setVersion(Number(snap.data()?.version ?? 0));
        setLoading(false);
        // Missing or empty → ask the server to seed the defaults.
        if (!snap.exists() || raw.length === 0) void seedCatalog();
      },
      (err) => {
        console.error("PlanConfiguration listener failed", err);
        toast.error("Could not load the plan catalog.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const rows = useMemo(
    () => plans.filter((p) => p.product === product).sort((a, b) => a.sortOrder - b.sortOrder),
    [plans, product],
  );

  const dirty = useMemo(
    () => JSON.stringify(plans) !== JSON.stringify(original),
    [plans, original],
  );

  const patch = (id: string, prod: string, field: keyof PlanRow, value: unknown) => {
    setPlans((prev) =>
      prev.map((p) => (p.id === id && p.product === prod ? { ...p, [field]: value } : p)),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await httpsCallable(functions, "updatePlanCatalog")({ plans });
      const v = (res.data as { version?: number })?.version;
      toast.success(`Pricing saved${v ? ` (v${v})` : ""} — live everywhere`);
    } catch (e) {
      // Server-side validation messages are meaningful (e.g. annual > monthly).
      toast.error(e instanceof Error ? e.message : "Could not save pricing");
    } finally {
      setSaving(false);
    }
  };

  const num = (v: string): number | null => {
    const t = v.trim();
    if (t === "" || t.toLowerCase() === "custom") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  if (loading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading plan configuration…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-border/60">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" /> Plan Configuration
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              The single source of truth for Kada Dine &amp; Kada Host pricing,
              commission and limits. Changes go live everywhere — and never alter
              past orders or settlements.
              {version > 0 && <span className="ml-1 opacity-70">· v{version}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border overflow-hidden">
              {(["dine", "stay"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProduct(p)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    product === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {p === "dine" ? "Kada Dine" : "Kada Host"}
                </button>
              ))}
            </div>
            {dirty && (
              <Button variant="outline" size="sm" onClick={() => setPlans(original)} disabled={saving}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {saving ? "Saving…" : "Save pricing"}
            </Button>
          </div>
        </div>

        {dirty && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Unsaved changes. Saving updates pricing across the marketing site,
            both dashboards and the apps.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left py-2 font-semibold">Plan</th>
                <th className="text-left py-2 font-semibold">Monthly ₹</th>
                <th className="text-left py-2 font-semibold">Annual ₹/mo</th>
                <th className="text-left py-2 font-semibold">Commission %</th>
                <th className="text-left py-2 font-semibold">Max outlets</th>
                <th className="text-left py-2 font-semibold">Visible</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs">
                    <p className="text-muted-foreground">
                      {seeding
                        ? "Loading the default plans…"
                        : `No ${product === "dine" ? "Kada Dine" : "Kada Host"} plans configured yet.`}
                    </p>
                    {!seeding && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={seedCatalog}>
                        Load default plans
                      </Button>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={`${p.product}:${p.id}`} className="border-b last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{p.name}</span>
                        {p.popular && (
                          <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">
                            Popular
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">{p.id}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        className="h-8 w-24"
                        value={p.monthlyPrice === null ? "Custom" : String(p.monthlyPrice)}
                        onChange={(e) => patch(p.id, p.product, "monthlyPrice", num(e.target.value))}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        className="h-8 w-24"
                        value={p.annualPrice === null ? "Custom" : String(p.annualPrice)}
                        onChange={(e) => patch(p.id, p.product, "annualPrice", num(e.target.value))}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        className="h-8 w-20"
                        value={p.commissionPercent}
                        onChange={(e) =>
                          patch(p.id, p.product, "commissionPercent", Number(e.target.value))
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-20"
                        value={p.maxOutlets}
                        onChange={(e) => patch(p.id, p.product, "maxOutlets", Number(e.target.value))}
                      />
                    </td>
                    <td className="py-2">
                      <Switch
                        checked={p.visible !== false}
                        onCheckedChange={(v) => patch(p.id, p.product, "visible", v)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Commission % applies to merchants on the <strong>commission</strong>{" "}
          billing model. Merchants on <strong>subscription</strong> are charged 0%
          while their plan is active. A bespoke per-merchant rate set on a
          Vendor/Host 360 page always overrides the plan value.
        </p>
      </CardContent>
    </Card>
  );
}
