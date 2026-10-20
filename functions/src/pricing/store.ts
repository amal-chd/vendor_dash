/**
 * Firestore side of the pricing engine: loading rules and publishing changes.
 *
 * - `pricing_rules/{ruleId}__vNNNN` holds one immutable version each. The only
 *   mutation ever made to a stored version is closing its `effectiveUntil`
 *   when the next version is published.
 * - `pricing_audit` is append-only: who changed what, old and new values,
 *   reason, scope, rule id. Clients can't write either collection (rules).
 * - The active ruleset is published rules + the legacy adapter (today's live
 *   config at very low priority), so behaviour is unchanged until a rule is
 *   published and then changes everywhere at once.
 */
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { platformEconomics } from "../delivery";
import { loadZones } from "../zones";
import { DEFAULT_PROMOS, promoFromDoc } from "../orderPricing";
import { legacyFoodRules, type LegacyInputs } from "./legacy";
import { RULE_KINDS, publishVersion, validateRule, type AnyRule, type PricingRule, type RuleKind } from "./rules";

export const RULES_COLLECTION = "pricing_rules";
export const AUDIT_COLLECTION = "pricing_audit";
const CACHE_TTL_MS = 30_000;
/** A change may take effect now or later, never retroactively. */
const BACKDATE_GRACE_MS = 5 * 60_000;

let publishedCache: { at: number; rules: AnyRule[] } | null = null;
let legacyCache: { at: number; rules: AnyRule[] } | null = null;

export const versionDocId = (ruleId: string, version: number) => `${ruleId}__v${String(version).padStart(4, "0")}`;

export function toRule(d: FirebaseFirestore.DocumentData | undefined): AnyRule | null {
  if (!d || typeof d.ruleId !== "string" || !RULE_KINDS.includes(d.kind as RuleKind)) return null;
  return {
    ruleId: d.ruleId,
    version: Number(d.version) || 1,
    kind: d.kind as RuleKind,
    name: String(d.name ?? d.ruleId),
    active: d.active === true,
    priority: Number(d.priority) || 0,
    effectiveFrom: Number(d.effectiveFrom) || 0,
    effectiveUntil: d.effectiveUntil == null ? null : Number(d.effectiveUntil),
    scope: (d.scope ?? {}) as PricingRule["scope"],
    params: (d.params ?? {}) as Record<string, unknown>,
  };
}

export function invalidatePricingCache(): void {
  publishedCache = null;
  legacyCache = null;
}

export async function loadPublishedRules(force = false): Promise<AnyRule[]> {
  const now = Date.now();
  if (!force && publishedCache && now - publishedCache.at < CACHE_TTL_MS) return publishedCache.rules;
  const snap = await admin.firestore().collection(RULES_COLLECTION).get();
  const rules = snap.docs.map((d) => toRule(d.data())).filter((r): r is AnyRule => r !== null);
  publishedCache = { at: now, rules };
  return rules;
}

export async function loadLegacyInputs(): Promise<LegacyInputs> {
  const db = admin.firestore();
  const [econ, zones, settingsSnap, platformSnap, promoSnap] = await Promise.all([
    platformEconomics(),
    loadZones(),
    db.collection("settings").doc("delivery").get().catch(() => null),
    db.collection("config").doc("platform").get().catch(() => null),
    db.collection("promos").where("active", "==", true).get().catch(() => null),
  ]);
  const s = settingsSnap?.data() ?? {};
  const byCode = new Map(DEFAULT_PROMOS.map((p) => [p.code, p]));
  for (const d of promoSnap?.docs ?? []) {
    const p = promoFromDoc(d.id, d.data());
    if (p) byCode.set(p.code, p);
  }
  return {
    economics: {
      deliveryBaseFee: econ.deliveryBaseFee,
      deliveryPerKm: econ.deliveryPerKm,
      freeDeliveryUnderKm: econ.freeDeliveryUnderKm,
      freeDeliveryAbove: econ.freeDeliveryAbove,
      platformFee: econ.platformFee,
      riderBaseFee: econ.riderBaseFee,
      riderPerKm: econ.riderPerKm,
    },
    zones: zones.filter((z) => z.active).map((z) => ({ id: z.id, economics: z.economics, surgeMultiplier: z.surgeMultiplier })),
    manualSurge: s.surgeActive === true && typeof s.surgeFee === "number" ? { active: true, feeRupees: s.surgeFee } : null,
    defaultCommissionPercent: Number(platformSnap?.data()?.defaultCommissionPercent ?? 10),
    promos: [...byCode.values()],
  };
}

/** Published rules plus today's live config as low-priority legacy rules. */
export async function loadRuleset(force = false): Promise<AnyRule[]> {
  const now = Date.now();
  if (force || !legacyCache || now - legacyCache.at >= CACHE_TTL_MS) {
    legacyCache = { at: now, rules: legacyFoodRules(await loadLegacyInputs()) };
  }
  const published = await loadPublishedRules(force);
  return [...legacyCache.rules, ...published];
}

export async function loadRuleHistory(ruleId: string): Promise<AnyRule[]> {
  const snap = await admin.firestore().collection(RULES_COLLECTION).where("ruleId", "==", ruleId).get();
  return snap.docs
    .map((d) => toRule(d.data()))
    .filter((r): r is AnyRule => r !== null)
    .sort((a, b) => a.version - b.version);
}

export interface PricingActor {
  uid: string;
  email: string;
  role: string;
}

const snapshotOf = (r: AnyRule) => ({
  name: r.name,
  active: r.active,
  priority: r.priority,
  effectiveFrom: r.effectiveFrom,
  effectiveUntil: r.effectiveUntil,
  scope: r.scope,
  params: r.params,
});

/**
 * Publishes a rule change as a new immutable version and records it in the
 * audit log, atomically. Deactivating a rule is publishing a version with
 * `active: false` — nothing is ever deleted or rewritten.
 */
export async function publishRule(args: {
  draft: Omit<PricingRule, "version">;
  reason: string;
  actor: PricingActor;
}): Promise<{ rule: AnyRule; closed: AnyRule | null }> {
  const { draft, actor } = args;
  const reason = (args.reason ?? "").trim();
  const problems = validateRule(draft);
  if (draft.ruleId.startsWith("legacy-")) problems.push("Rule ids starting with legacy- are reserved for the live-config adapter.");
  if (reason.length < 5) problems.push("Explain the change (at least 5 characters). It's kept in the audit log.");
  if (draft.effectiveFrom < Date.now() - BACKDATE_GRACE_MS) {
    problems.push("A pricing change can't be backdated. Set effective-from to now or later.");
  }
  if (problems.length) throw new HttpsError("invalid-argument", problems.join(" "), { problems });

  const db = admin.firestore();
  const col = db.collection(RULES_COLLECTION);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(col.where("ruleId", "==", draft.ruleId));
    const history = snap.docs.map((d) => toRule(d.data())).filter((r): r is AnyRule => r !== null);
    const latest = [...history].sort((a, b) => b.version - a.version)[0] ?? null;
    if (latest && latest.kind !== draft.kind) {
      throw new HttpsError("failed-precondition", `"${draft.ruleId}" is a ${latest.kind} rule; its kind can't change. Create a new rule instead.`);
    }
    const { next, closed } = publishVersion(history, draft as Omit<PricingRule, "version">);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const who = { uid: actor.uid, email: actor.email, role: actor.role };

    if (closed) {
      tx.update(col.doc(versionDocId(closed.ruleId, closed.version)), {
        effectiveUntil: closed.effectiveUntil,
        closedAt: now,
        closedBy: who,
      });
    }
    tx.create(col.doc(versionDocId(next.ruleId, next.version)), { ...next, publishedAt: now, publishedBy: who, reason });
    tx.create(db.collection(AUDIT_COLLECTION).doc(), {
      action: !latest ? "rule_created" : next.active ? "rule_version_published" : "rule_deactivated",
      ruleId: next.ruleId,
      kind: next.kind,
      fromVersion: latest?.version ?? null,
      toVersion: next.version,
      oldValue: latest ? snapshotOf(latest) : null,
      newValue: snapshotOf(next),
      reason,
      scope: next.scope,
      actor: who,
      at: now,
    });
    return { rule: next as AnyRule, closed: closed as AnyRule | null };
  });
  invalidatePricingCache();
  return result;
}
