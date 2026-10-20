/**
 * Shared by the admin Pricing pages. The backend (functions/src/pricing) is
 * the only place prices are computed; these helpers only label, format and
 * gate the UI. Role lists mirror functions/src/pricing/permissions.ts — the
 * server enforces them regardless.
 */
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type RuleKind =
  | "tax_category" | "tax_assignment" | "packaging" | "delivery_fee" | "surge" | "platform_fee"
  | "small_order_fee" | "commission" | "rider_earning" | "promotion" | "rounding" | "pipeline"
  | "stay_rate" | "stay_fee" | "stay_commission" | "refund_policy" | "settlement";

export const KIND_LABELS: Record<string, string> = {
  tax_category: "Tax category",
  tax_assignment: "Tax assignment",
  packaging: "Packaging charge",
  delivery_fee: "Delivery fee",
  surge: "Surge",
  platform_fee: "Platform fee",
  small_order_fee: "Small order fee",
  commission: "Restaurant commission",
  rider_earning: "Rider earnings",
  promotion: "Promotion / coupon",
  rounding: "Rounding",
  pipeline: "Calculation order",
  stay_rate: "Stay nightly rate",
  stay_fee: "Stay fee",
  stay_commission: "Host commission",
  refund_policy: "Refund policy",
  settlement: "Settlement",
};

export const KIND_GROUPS: { key: string; label: string; kinds: RuleKind[] }[] = [
  { key: "food", label: "Food & delivery", kinds: ["packaging", "delivery_fee", "surge", "platform_fee", "small_order_fee", "rider_earning"] },
  { key: "stay", label: "Stay", kinds: ["stay_rate", "stay_fee", "stay_commission"] },
  { key: "promotions", label: "Promotions", kinds: ["promotion"] },
  { key: "finance", label: "Finance", kinds: ["commission", "refund_policy", "settlement", "rounding", "pipeline"] },
  { key: "tax", label: "Tax", kinds: ["tax_category", "tax_assignment"] },
];

const SUPER = ["super_admin", "platform_admin"];
const FINANCE = [...SUPER, "finance_manager"];
const OPERATIONS = [...SUPER, "ops_manager", "delivery_manager"];
const MARKETING = [...SUPER, "marketing_manager"];
const STAY = [...SUPER, "stay_manager"];

export const RULE_KIND_ROLES: Record<RuleKind, string[]> = {
  tax_category: FINANCE,
  tax_assignment: FINANCE,
  commission: FINANCE,
  stay_commission: FINANCE,
  platform_fee: FINANCE,
  settlement: FINANCE,
  refund_policy: FINANCE,
  rounding: FINANCE,
  pipeline: FINANCE,
  small_order_fee: [...FINANCE, "ops_manager"],
  packaging: [...FINANCE, "ops_manager", "vendor_manager"],
  delivery_fee: OPERATIONS,
  surge: OPERATIONS,
  rider_earning: [...OPERATIONS, "finance_manager"],
  promotion: MARKETING,
  stay_rate: STAY,
  stay_fee: [...STAY, "finance_manager"],
};

export const SIMULATOR_ROLES = [...SUPER, "finance_manager", "ops_manager", "delivery_manager", "marketing_manager", "stay_manager", "analytics", "auditor"];

export const canManageKind = (role: string | null, kind: RuleKind) => !!role && RULE_KIND_ROLES[kind].includes(role);
export const canSimulate = (role: string | null) => !!role && SIMULATOR_ROLES.includes(role);

/** Starting params per kind. Checked by the server before anything publishes. */
export const PARAM_TEMPLATES: Record<RuleKind, Record<string, unknown>> = {
  tax_category: { id: "restaurant_food", label: "Restaurant service 5%", rateBps: 500, hsnSac: "996331", liability: "platform_eco" },
  tax_assignment: { component: "items", taxCategoryId: "restaurant_food", supplier: "vendor", inclusive: false, placeOfSupply: "supplier_state" },
  packaging: { mode: "per_order", amountPaise: 1000, useItemLevel: true, useVendorDefault: true, maxPaise: 5000 },
  delivery_fee: { basePaise: 2500, perKmPaise: 800, freeUnderMeters: 0, minPaise: 2000, maxPaise: 9900, goldFree: true },
  surge: { multiplierBps: 12000, flatPaise: 0, maxMultiplierBps: 15000, maxAddPaise: 3000, goldWaived: true, riderShareBps: 5000 },
  platform_fee: { mode: "fixed", amountPaise: 500, goldWaived: false },
  small_order_fee: { belowPaise: 14900, amountPaise: 1500 },
  commission: { bps: 1500, includePackaging: false },
  rider_earning: { basePaise: 2500, perKmPaise: 600 },
  promotion: { code: "KADA50", label: "50% off up to ₹100", type: "percent", bps: 5000, maxDiscountPaise: 10000, minCartPaise: 19900, fundedBy: "platform", perCustomerLimit: 1, stackable: false },
  rounding: { lineMode: "half_up", taxMode: "half_up", finalStepPaise: 100, finalMode: "half_up" },
  pipeline: {},
  stay_rate: { adjustBps: 2000 },
  stay_fee: { fee: "service", bps: 1000, minPaise: 10000, maxPaise: 150000 },
  stay_commission: { bps: 1500, paymentFeeBps: 200 },
  refund_policy: {},
  settlement: {},
};

export const SCOPE_TEMPLATES: Record<string, Record<string, unknown>> = {
  food: { product: "food" },
  stay: { product: "stay" },
};

export const scopeFor = (kind: RuleKind) => (kind.startsWith("stay_") ? SCOPE_TEMPLATES.stay : kind.startsWith("tax_") ? {} : SCOPE_TEMPLATES.food);

export const inr = (paise: number | null | undefined) =>
  `₹${((Number(paise) || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const pct = (bps: number | null | undefined) => `${((Number(bps) || 0) / 100).toFixed(2).replace(/\.00$/, "")}%`;

export const fmtWhen = (d: Date | number | null | undefined) => {
  if (d == null) return "—";
  const date = typeof d === "number" ? new Date(d) : d;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

/** { a: { b: 1 } } → { "a.b": 1 } (arrays kept whole). */
export function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

export interface RuleDraft {
  ruleId: string;
  kind: RuleKind;
  name: string;
  active: boolean;
  priority: number;
  effectiveFrom: number;
  effectiveUntil: number | null;
  scope: Record<string, unknown>;
  params: Record<string, unknown>;
}

/** Drafts handed from the rule editor to the simulator ("test before publishing"). */
export const SIM_DRAFTS_KEY = "kada.pricing.simDrafts";

export function readSimDrafts(): RuleDraft[] {
  try {
    const v = JSON.parse(localStorage.getItem(SIM_DRAFTS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function writeSimDrafts(drafts: RuleDraft[]) {
  try {
    localStorage.setItem(SIM_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* storage unavailable: the simulator just starts without drafts */
  }
}

export async function pricingAdmin<T = Record<string, unknown>>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await httpsCallable(functions, "pricingAdmin")({ action, payload });
  return res.data as T;
}

/** A readable message from a callable error, including server-side validation problems. */
export function callableError(e: unknown): string {
  const err = e as { message?: string; details?: { problems?: string[] } };
  const problems = err?.details?.problems;
  return problems?.length ? problems.join(" ") : err?.message || "Something went wrong.";
}
