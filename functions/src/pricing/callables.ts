/**
 * Callables for the central pricing engine.
 *
 * - `quoteFoodOrder` (customers): the authoritative checkout breakdown. The
 *   quote is stored for 15 minutes so the order can be placed against it.
 * - `pricingAdmin` (admins): publish rule versions (role-checked per rule
 *   kind, audited), validate drafts, and simulate orders — including against
 *   draft rules that aren't published yet.
 */
import * as admin from "firebase-admin";
import { customerBill } from "./bill";
import { withFinance } from "./orderFinance";
import { planFoodRefund, refundHistoryOf, sanitizeRefundRequest } from "./refundPlan";
import { reconciliationReport, runPricingReconciliation } from "./reconcile";
import type { FoodQuote as SnapshotQuote } from "./food";
import { quoteStay } from "./stay";
import { buildStayQuoteInput } from "./stayLoader";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { assertAdmin } from "../admin_operations";
import { enforceRateLimit } from "../rateLimit";
import { HOT_PATH } from "../options";
import { quoteFood, type FoodQuote, type FoodQuoteInput } from "./food";
import { buildFoodQuoteInput, type FoodCartRequest } from "./foodLoader";
import { publishRule } from "./store";
import { RULE_KINDS, validateRule, type AnyRule, type PricingRule, type RuleKind, type RuleScope } from "./rules";
import { canManageRuleKind, canSimulate, resolveAdminRole } from "./permissions";

const QUOTE_TTL_MS = 15 * 60_000;

const str = (v: unknown, max = 200) => (v ?? "").toString().trim().slice(0, max);
const int = (v: unknown, fallback = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isSafeInteger(n) ? n : fallback;
};
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

export function sanitizeCart(data: Record<string, unknown>): FoodCartRequest {
  const items = Array.isArray(data.items) ? data.items.slice(0, 50) : [];
  const drop = data.drop as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = Number(drop?.lat);
  const lng = Number(drop?.lng);
  return {
    restaurantId: str(data.restaurantId, 128),
    items: items.map((i) => {
      const x = (i ?? {}) as Record<string, unknown>;
      const variant = x.selectedVariant as { name?: unknown } | null | undefined;
      const addons = Array.isArray(x.selectedAddons) ? x.selectedAddons.slice(0, 20) : [];
      return {
        menuItemId: str(x.menuItemId, 128),
        qty: int(x.qty ?? x.quantity, 1),
        selectedVariant: variant?.name ? { name: str(variant.name, 100) } : null,
        selectedAddons: addons.map((a) => ({ name: str((a as { name?: unknown })?.name, 100) })),
      };
    }),
    fulfilment: str(data.fulfilment) === "pickup" ? "pickup" : "delivery",
    express: data.express === true,
    drop: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    couponCode: str(data.couponCode, 40) || null,
    tipPaise: Math.max(0, int(data.tipPaise)),
    donationPaise: Math.max(0, int(data.donationPaise)),
  };
}

/** What a customer may see: no commission, payouts or platform revenue. */
export function customerView(q: FoodQuote) {
  return {
    engineVersion: q.engineVersion,
    currency: q.currency,
    fulfilment: q.fulfilment,
    lines: q.lines.map((l) => ({
      lineId: l.lineId, menuItemId: l.menuItemId, name: l.name, qty: l.qty,
      unitPaise: l.unitPaise, modifierUnitPaise: l.modifierUnitPaise, grossPaise: l.grossPaise,
      discountPaise: l.itemDiscountPaise + l.cartDiscountPaise, customerPaysPaise: l.customerPaysPaise,
    })),
    charges: q.charges
      .filter((c) => c.fundedBy === "customer")
      .map((c) => ({ key: c.key, label: c.label, grossPaise: c.grossPaise, waivedPaise: c.waivedPaise, customerPaysPaise: c.customerPaysPaise })),
    promotions: q.promotions.map((p) => ({ code: p.code, label: p.label, type: p.type, amountPaise: p.totalPaise })),
    couponProblem: q.couponProblem,
    totals: q.totals,
    display: q.display,
    // Compact, labelled bill (pricing/bill.ts); null → apps fall back to display.
    bill: customerBill(q),
    problems: q.problems,
  };
}

export const quoteFoodOrder = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to see your order total.");
  await enforceRateLimit(`quote_food_${uid}`, 60, 10 * 60_000);
  const cart = sanitizeCart((request.data ?? {}) as Record<string, unknown>);
  if (!cart.restaurantId || cart.items.length === 0) {
    throw new HttpsError("invalid-argument", "Add items from a restaurant to see your total.");
  }

  const { input, rules, problems } = await buildFoodQuoteInput(uid, cart);
  const quote = quoteFood(input, rules);
  quote.problems = [...new Set([...problems, ...quote.problems])];

  const expiresAt = Date.now() + QUOTE_TTL_MS;
  const ref = admin.firestore().collection("pricing_quotes").doc();
  await ref.set({
    uid,
    restaurantId: cart.restaurantId,
    cart: plain(cart),
    quote: plain(quote),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(expiresAt),
  });
  return { quoteId: ref.id, expiresAt, ...customerView(quote) };
});

function sanitizeRule(raw: unknown): Omit<PricingRule, "version"> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = str(r.kind, 40) as RuleKind;
  if (!RULE_KINDS.includes(kind)) throw new HttpsError("invalid-argument", `Unknown rule kind "${kind}".`);
  const s = (r.scope ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 128)).filter(Boolean).slice(0, 500) : undefined);
  const scope: RuleScope = plain({
    product: s.product === "stay" ? "stay" : s.product === "food" ? "food" : undefined,
    zoneIds: list(s.zoneIds),
    vendorIds: list(s.vendorIds),
    propertyIds: list(s.propertyIds),
    categoryIds: list(s.categoryIds),
    minOrderPaise: s.minOrderPaise == null ? undefined : int(s.minOrderPaise),
    maxOrderPaise: s.maxOrderPaise == null ? undefined : int(s.maxOrderPaise),
    daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek.map((d) => int(d)).filter((d) => d >= 0 && d <= 6) : undefined,
    timeWindows: Array.isArray(s.timeWindows)
      ? s.timeWindows.map((w) => ({ from: str((w as { from?: unknown })?.from, 5), to: str((w as { to?: unknown })?.to, 5) }))
      : undefined,
  });
  return {
    ruleId: str(r.ruleId, 80),
    kind,
    name: str(r.name, 120),
    active: r.active !== false,
    priority: int(r.priority),
    effectiveFrom: r.effectiveFrom == null ? Date.now() : int(r.effectiveFrom),
    effectiveUntil: r.effectiveUntil == null ? null : int(r.effectiveUntil),
    scope,
    params: plain((r.params ?? {}) as Record<string, unknown>),
  };
}

export const pricingAdmin = onCall({ maxInstances: 3 }, async (request) => {
  assertAdmin(request);
  const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
  const role = resolveAdminRole(claims);
  const actor = { uid: request.auth!.uid, email: str(claims.email, 200), role };
  const action = str(request.data?.action, 40);
  const payload = (request.data?.payload ?? {}) as Record<string, unknown>;

  switch (action) {
    case "validateRule": {
      const draft = sanitizeRule(payload.rule);
      return { ok: true, problems: validateRule(draft) };
    }

    case "publishRule": {
      const draft = sanitizeRule(payload.rule);
      if (!canManageRuleKind(role, draft.kind)) {
        throw new HttpsError("permission-denied", `Your role (${role}) can't change ${draft.kind.replace(/_/g, " ")} rules.`);
      }
      const result = await publishRule({ draft, reason: str(payload.reason, 500), actor });
      return { ok: true, rule: result.rule, closed: result.closed };
    }

    case "simulateFood": {
      if (!canSimulate(role)) throw new HttpsError("permission-denied", `Your role (${role}) can't run the pricing simulator.`);
      const cart = sanitizeCart((payload.cart ?? {}) as Record<string, unknown>);
      if (!cart.restaurantId || cart.items.length === 0) {
        throw new HttpsError("invalid-argument", "Choose a restaurant and at least one item to simulate.");
      }
      const at = payload.at == null ? Date.now() : int(payload.at, Date.now());
      const customerUid = str(payload.customerUid, 128) || null;
      const built = await buildFoodQuoteInput(customerUid, { ...cart, at });
      const o = (payload.overrides ?? {}) as Record<string, unknown>;
      const input: FoodQuoteInput = {
        ...built.input,
        at,
        zoneId: o.zoneId === undefined ? built.input.zoneId : (str(o.zoneId, 128) || null),
        distanceKm: o.distanceKm == null ? built.input.distanceKm : Number(o.distanceKm),
        weatherAlert: o.weatherAlert === true,
        demand: o.demand ? { activeOrders: int((o.demand as Record<string, unknown>).activeOrders), availableRiders: int((o.demand as Record<string, unknown>).availableRiders) } : null,
        customer: {
          ...built.input.customer,
          ...(o.isGold != null ? { isGold: o.isGold === true } : {}),
          ...(o.completedOrders != null ? { completedOrders: int(o.completedOrders), isNew: int(o.completedOrders) === 0 } : {}),
          ...(o.customerStateCode ? { stateCode: str(o.customerStateCode, 2) } : {}),
        },
      };
      // Draft rules are tested ahead of publishing: they win over everything live.
      const drafts: AnyRule[] = (Array.isArray(payload.draftRules) ? payload.draftRules : []).slice(0, 20).map((d, i) => ({
        ...sanitizeRule(d),
        version: 1_000_000 + i,
        effectiveFrom: 0,
        effectiveUntil: null,
      }));
      const draftProblems = drafts.flatMap((d) => validateRule(d).map((p) => `${d.ruleId}: ${p}`));
      const quote = quoteFood(input, [...built.rules, ...drafts]);
      quote.problems = [...new Set([...built.problems, ...quote.problems])];
      return { ok: true, quote, draftProblems, input: plain(input) };
    }

    case "simulateStay": {
      if (!canSimulate(role)) throw new HttpsError("permission-denied", `Your role (${role}) can't run the pricing simulator.`);
      const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v, 10)) ? str(v, 10) : "");
      const at = payload.at == null ? Date.now() : int(payload.at, Date.now());
      const req = {
        hotelId: str(payload.hotelId, 128),
        roomId: str(payload.roomId, 128),
        checkIn: day(payload.checkIn),
        checkOut: day(payload.checkOut),
        guests: int(payload.guests, 1),
        couponCode: str(payload.couponCode, 40) || null,
        at,
      };
      if (!req.hotelId || !req.checkIn || !req.checkOut) {
        throw new HttpsError("invalid-argument", "Choose a property, check-in and check-out to simulate.");
      }
      const built = await buildStayQuoteInput(str(payload.customerUid, 128) || null, req);
      const drafts: AnyRule[] = (Array.isArray(payload.draftRules) ? payload.draftRules : []).slice(0, 20).map((d, i) => ({
        ...sanitizeRule(d),
        version: 1_000_000 + i,
        effectiveFrom: 0,
        effectiveUntil: null,
      }));
      const draftProblems = drafts.flatMap((d) => validateRule(d).map((p) => `${d.ruleId}: ${p}`));
      const quote = quoteStay(built.input, [...built.rules, ...drafts]);
      quote.problems = [...new Set([...built.problems, ...quote.problems])];
      return { ok: true, quote, draftProblems, input: plain(built.input) };
    }

    case "planRefund": {
      if (!canSimulate(role) && role !== "support_manager") {
        throw new HttpsError("permission-denied", `Your role (${role}) can't plan refunds.`);
      }
      const orderId = str(payload.orderId, 128);
      const snap = orderId ? await admin.firestore().collection("orders").doc(orderId).get() : null;
      const o = snap?.exists ? await withFinance(snap.ref, snap.data() ?? {}) : undefined;
      if (!o) throw new HttpsError("not-found", "Order not found.");
      if (typeof o.pricing?.engineVersion !== "string") {
        throw new HttpsError("failed-precondition", "This order was placed before the pricing engine, so it can only be refunded by amount.");
      }
      return planFoodRefund(o.pricing as SnapshotQuote, sanitizeRefundRequest(payload), refundHistoryOf(o));
    }

    case "reconciliationReport": {
      if (!canSimulate(role)) throw new HttpsError("permission-denied", `Your role (${role}) can't view price checks.`);
      return reconciliationReport();
    }

    case "runReconciliation": {
      if (!["super_admin", "platform_admin", "finance_manager"].includes(role)) {
        throw new HttpsError("permission-denied", `Your role (${role}) can't run price checks.`);
      }
      return runPricingReconciliation(int(payload.days, 7), `manual:${actor.email || actor.uid}`);
    }

    default:
      throw new HttpsError("invalid-argument", `Unknown pricing action "${action}".`);
  }
});
