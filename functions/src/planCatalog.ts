import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE plan catalog — one source of truth for Kada Dine + Kada Host pricing.
 *
 * Before this, pricing lived in FIVE competing places:
 *   1. src/constants/plans.ts        (web, hardcoded Dine plans)
 *   2. config/pricing                (Firestore price overrides, Dine only)
 *   3. vendor_mobile_app iap_service (App Store / Play SKU prices)
 *   4. host_app plan_catalog.dart    (hardcoded Stay plans + fallback prices)
 *   5. config/platform + per-merchant commissionRate
 * …so a price change in admin could not reach the apps, and Dine/Stay used
 * entirely different plan vocabularies.
 *
 * Everything now reads `config/plan_catalog`. Admin is the only writer.
 *
 * HISTORICAL SAFETY: this catalog describes what to charge from NOW ON. It is
 * never applied retroactively — settlements snapshot their own rate at
 * generation time (see billingModel.ts / generateVendorSettlements), so editing
 * a plan can never rewrite a past order, invoice or settlement.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type PlanProduct = "dine" | "stay";

export interface PlanDef {
  id: string;
  product: PlanProduct;
  name: string;
  /** ₹ per month billed monthly. `null` = "Custom" (sales-led). */
  monthlyPrice: number | null;
  /** ₹ effective per month when billed annually. `null` = Custom. */
  annualPrice: number | null;
  /** Commission % charged when the merchant is on the COMMISSION model. */
  commissionPercent: number;
  maxOutlets: number;
  features: string[];
  visible: boolean;
  active: boolean;
  popular: boolean;
  sortOrder: number;
}

export interface PlanCatalog {
  plans: PlanDef[];
  updatedAt?: unknown;
  updatedBy?: string;
  version: number;
}

const CATALOG_PATH = { collection: "config", doc: "plan_catalog" };

/**
 * Seed values mirror the prices that were already live in
 * src/constants/plans.ts and host_app/plan_catalog.dart, so introducing the
 * catalog changes NOTHING until an admin edits it.
 */
export const DEFAULT_CATALOG: PlanCatalog = {
  version: 1,
  plans: [
    {
      id: "starter", product: "dine", name: "Starter",
      monthlyPrice: 499, annualPrice: 399, commissionPercent: 5,
      maxOutlets: 1, visible: true, active: true, popular: false, sortOrder: 1,
      features: ["QR ordering", "GST billing", "Single outlet", "POS sync"],
    },
    {
      id: "growth", product: "dine", name: "Growth",
      monthlyPrice: 899, annualPrice: 699, commissionPercent: 4,
      maxOutlets: 3, visible: true, active: true, popular: true, sortOrder: 2,
      features: ["Everything in Starter", "Inventory", "Staff management", "P&L reports", "Loyalty"],
    },
    {
      id: "enterprise", product: "dine", name: "Enterprise",
      monthlyPrice: null, annualPrice: null, commissionPercent: 3,
      maxOutlets: 999, visible: true, active: true, popular: false, sortOrder: 3,
      features: ["Everything in Growth", "Multi-outlet", "Aggregator integration", "Priority support"],
    },
    {
      id: "basic", product: "stay", name: "Basic",
      monthlyPrice: 499, annualPrice: 399, commissionPercent: 15,
      maxOutlets: 1, visible: true, active: true, popular: false, sortOrder: 1,
      features: ["Property listing", "Booking calendar", "Guest messaging"],
    },
    {
      id: "pro", product: "stay", name: "Pro",
      monthlyPrice: 999, annualPrice: 799, commissionPercent: 12,
      maxOutlets: 5, visible: true, active: true, popular: true, sortOrder: 2,
      features: ["Everything in Basic", "Channel sync", "Dynamic pricing", "Analytics"],
    },
    {
      id: "enterprise_stay", product: "stay", name: "Enterprise",
      monthlyPrice: null, annualPrice: null, commissionPercent: 10,
      maxOutlets: 999, visible: true, active: true, popular: false, sortOrder: 3,
      features: ["Everything in Pro", "Multi-property", "Dedicated manager"],
    },
  ],
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Validate + normalise one plan. Throws on anything that would corrupt billing. */
export function normalisePlan(raw: any, index: number): PlanDef {
  const id = (raw?.id ?? "").toString().trim();
  if (!id) throw new HttpsError("invalid-argument", `Plan #${index + 1} is missing an id.`);
  const product: PlanProduct = raw?.product === "stay" ? "stay" : "dine";

  const commission = num(raw?.commissionPercent, 0);
  if (commission < 0 || commission > 100) {
    throw new HttpsError("invalid-argument", `${id}: commission must be between 0 and 100.`);
  }
  const monthly = raw?.monthlyPrice === null || raw?.monthlyPrice === undefined || raw?.monthlyPrice === "Custom"
    ? null : Math.max(0, num(raw.monthlyPrice, 0));
  const annual = raw?.annualPrice === null || raw?.annualPrice === undefined || raw?.annualPrice === "Custom"
    ? null : Math.max(0, num(raw.annualPrice, 0));
  if (monthly !== null && annual !== null && annual > monthly) {
    // An annual plan costing MORE per month than monthly is almost always a
    // data-entry slip and would silently overcharge every annual subscriber.
    throw new HttpsError(
      "invalid-argument",
      `${id}: annual per-month price (₹${annual}) cannot exceed the monthly price (₹${monthly}).`,
    );
  }

  return {
    id,
    product,
    name: (raw?.name ?? id).toString(),
    monthlyPrice: monthly,
    annualPrice: annual,
    commissionPercent: commission,
    maxOutlets: Math.max(0, Math.round(num(raw?.maxOutlets, 1))),
    features: Array.isArray(raw?.features) ? raw.features.map((f: unknown) => String(f)).slice(0, 40) : [],
    visible: raw?.visible !== false,
    active: raw?.active !== false,
    popular: raw?.popular === true,
    sortOrder: Math.round(num(raw?.sortOrder, index + 1)),
  };
}

/** Read the catalog, seeding the defaults on first use. */
export async function readCatalog(): Promise<PlanCatalog> {
  const db = admin.firestore();
  const ref = db.collection(CATALOG_PATH.collection).doc(CATALOG_PATH.doc);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      ...DEFAULT_CATALOG,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: "system:seed",
    });
    return DEFAULT_CATALOG;
  }
  const data = snap.data() ?? {};
  const plans = Array.isArray(data.plans) ? data.plans : DEFAULT_CATALOG.plans;
  return {
    version: num(data.version, 1),
    plans: plans.map((p: any, i: number) => normalisePlan(p, i)),
    updatedAt: data.updatedAt,
    updatedBy: (data.updatedBy ?? "").toString(),
  };
}

/** Look up one plan. Returns null when unknown so callers can fall back safely. */
export function findPlan(
  catalog: PlanCatalog,
  product: PlanProduct,
  planId: string,
): PlanDef | null {
  const id = (planId ?? "").toString().toLowerCase();
  return (
    catalog.plans.find((p) => p.product === product && p.id.toLowerCase() === id) ?? null
  );
}

/**
 * The commission % to use for a merchant, resolved from their plan.
 * Falls back to the explicit per-merchant rate, then the platform default —
 * so a merchant on a bespoke rate is never silently overwritten by the catalog.
 */
export function commissionForMerchant(
  catalog: PlanCatalog,
  product: PlanProduct,
  merchant: Record<string, unknown> | undefined,
  platformDefault: number,
): { rate: number; source: "merchant" | "plan" | "default" } {
  const explicit = merchant?.commissionRate ?? merchant?.platformCommission;
  if (explicit !== undefined && explicit !== null && Number.isFinite(Number(explicit))) {
    return { rate: Number(explicit), source: "merchant" };
  }
  const planId = (merchant?.subscriptionPlan ?? merchant?.planId ?? "").toString();
  const plan = planId ? findPlan(catalog, product, planId) : null;
  if (plan) return { rate: plan.commissionPercent, source: "plan" };
  return { rate: platformDefault, source: "default" };
}

// ── Callables ────────────────────────────────────────────────────────────

/** Anyone signed in may read the catalog (prices are shown pre-purchase). */
export const getPlanCatalog = onCall({ maxInstances: 3 }, async () => {
  const catalog = await readCatalog();
  return { ok: true, ...catalog, updatedAt: undefined };
});

/** Admin-only write. Validates every plan before persisting. */
export const updatePlanCatalog = onCall({ maxInstances: 3 }, async (request) => {
  const email = (request.auth?.token?.email as string) || "";
  const role = (request.auth?.token?.adminRole as string) || "super_admin";
  const isAdmin =
    request.auth?.token?.platformAdmin === true ||
    ["thekada@gmail.com", "thekadaapp@gmail.com"].includes(email);
  if (!isAdmin) throw new HttpsError("permission-denied", "Admins only.");
  if (!["super_admin", "platform_admin", "finance_manager"].includes(role)) {
    throw new HttpsError("permission-denied", `Your role (${role}) cannot change pricing.`);
  }

  const raw = (request.data as any)?.plans;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpsError("invalid-argument", "plans must be a non-empty array.");
  }
  const plans = raw.map((p: any, i: number) => normalisePlan(p, i));
  const ids = new Set<string>();
  for (const p of plans) {
    const key = `${p.product}:${p.id}`;
    if (ids.has(key)) throw new HttpsError("invalid-argument", `Duplicate plan ${key}.`);
    ids.add(key);
  }

  const db = admin.firestore();
  const ref = db.collection(CATALOG_PATH.collection).doc(CATALOG_PATH.doc);
  const before = (await ref.get()).data() ?? {};
  const version = num(before.version, 0) + 1;

  await ref.set(
    { plans, version, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: email },
    { merge: true },
  );

  // Pricing is money: every change is auditable with a before/after snapshot.
  await db.collection("admin_logs").add({
    type: "pricing",
    action: "updatePlanCatalog",
    description: `Plan catalog updated to v${version} (${plans.length} plans)`,
    adminEmail: email,
    payload: { before: before.plans ?? null, after: plans, version },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info(`Plan catalog updated to v${version} by ${email}`);
  return { ok: true, version, count: plans.length };
});
