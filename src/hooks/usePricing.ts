import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PLANS, Plan } from "@/constants/plans";

/**
 * Reads pricing from `config/plan_catalog` — THE single source of truth for
 * Kada Dine + Kada Host (functions/src/planCatalog.ts). The legacy
 * `config/pricing` overrides and the hardcoded PLANS array are kept only as a
 * fallback for the first render / a missing catalog, so nothing breaks while
 * the catalog seeds itself.
 */
export function usePricing(options?: { includeHidden?: boolean; product?: "dine" | "stay" }) {
  const includeHidden = options?.includeHidden ?? false;
  const product = options?.product ?? "dine";
  const [dynamicPlans, setDynamicPlans] = useState<Plan[]>(PLANS);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Primary: the plan catalog. Live, so an admin price change propagates to
  // every surface without a redeploy.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "plan_catalog"),
      (snap) => {
        const raw = snap.exists() ? (snap.data()?.plans as any[] | undefined) : undefined;
        if (!Array.isArray(raw) || raw.length === 0) return; // keep fallback
        const forProduct = raw.filter((p) => (p?.product ?? "dine") === product);
        if (forProduct.length === 0) return;

        setDynamicPlans(
          forProduct
            .slice()
            .sort((a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0))
            .map((p) => {
              const base = PLANS.find((x) => x.id === p.id);
              return {
                ...(base ?? ({} as Plan)),
                id: p.id,
                name: p.name ?? base?.name ?? p.id,
                // null in the catalog means "Custom" (sales-led), not free.
                monthlyPrice: p.monthlyPrice === null || p.monthlyPrice === undefined ? "Custom" : p.monthlyPrice,
                annualPrice: p.annualPrice === null || p.annualPrice === undefined ? "Custom" : p.annualPrice,
                features: Array.isArray(p.features) && p.features.length ? p.features : base?.features ?? [],
                maxOutlets: p.maxOutlets ?? base?.maxOutlets ?? 1,
                popular: p.popular ?? base?.popular ?? false,
              } as Plan;
            }),
        );
        const vis: Record<string, boolean> = {};
        for (const p of forProduct) vis[p.id] = p.visible !== false && p.active !== false;
        setVisibility(vis);
        setLoading(false);
      },
      (err) => {
        console.error("usePricing: plan_catalog listener failed", err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [product]);

  // Fallback: legacy per-price overrides. Only fills gaps the catalog left.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "config", "pricing"), (snapshot) => {
      if (snapshot.exists()) {
        const pricingData = snapshot.data();
        const updatedPlans = PLANS.map(plan => ({
          ...plan,
          monthlyPrice: pricingData[`${plan.id}_monthly`] !== undefined ? pricingData[`${plan.id}_monthly`] : plan.monthlyPrice,
          annualPrice: pricingData[`${plan.id}_annual`] !== undefined ? pricingData[`${plan.id}_annual`] : plan.annualPrice,
          monthlyPriceUSD: pricingData[`${plan.id}USD_monthly`] !== undefined ? pricingData[`${plan.id}USD_monthly`] : plan.monthlyPriceUSD,
          annualPriceUSD: pricingData[`${plan.id}USD_annual`] !== undefined ? pricingData[`${plan.id}USD_annual`] : plan.annualPriceUSD,
        }));
        const vis: Record<string, boolean> = {};
        for (const p of PLANS) {
          vis[p.id] = pricingData[`${p.id}_visible`] !== false; // default true
        }
        setDynamicPlans(updatedPlans);
        setVisibility(vis);
      }
      setLoading(false);
    }, (err) => console.error("[usePricing] config listener failed", err));

    return () => unsub();
  }, []);

  const plans = includeHidden
    ? dynamicPlans
    : dynamicPlans.filter(p => visibility[p.id] !== false);

  return { plans, visibility, loading };
}
