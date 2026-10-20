/**
 * ─────────────────────────────────────────────────────────────────────────
 * Where an order's money split lives.
 *
 * The price snapshot used to be stored whole on the order document, which
 * the customer can read — so any customer could see the restaurant's
 * commission, the rider's pay and Kada's revenue. The order now carries the
 * snapshot WITHOUT `settlement`; the split (and the restaurant's payout
 * statement) lives in `orders/{id}/finance/pricing`, readable only by admins
 * and the restaurant (firestore.rules), written only here.
 *
 * Every server reader of `pricing.settlement` goes through `withFinance` /
 * `withFinanceMany`, which put it back. Orders placed before this change still
 * have it inline and are returned unchanged.
 * ─────────────────────────────────────────────────────────────────────────
 */
import * as admin from "firebase-admin";
import type { FoodQuote } from "./food";
import { vendorBill } from "./bill";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

export function financeRef(orderRef: FirebaseFirestore.DocumentReference): FirebaseFirestore.DocumentReference {
  return orderRef.collection("finance").doc("pricing");
}

/** The snapshot as stored on the (customer-readable) order. */
export function publicSnapshot(q: FoodQuote): Omit<FoodQuote, "settlement"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { settlement, ...rest } = q;
  return rest;
}

/** The restricted finance document for an order. */
export function financeDoc(q: FoodQuote, restaurantId: string): Doc {
  return {
    restaurantId,
    engineVersion: q.engineVersion,
    settlement: q.settlement,
    vendorBill: vendorBill(q),
  };
}

/** Order data with `pricing.settlement` restored from a finance doc, if it was moved there. */
export function attachSettlement(order: Doc, finance: Doc | undefined): Doc {
  if (!order?.pricing || order.pricing.settlement || !finance?.settlement) return order;
  return { ...order, pricing: { ...order.pricing, settlement: finance.settlement } };
}

const needsFinance = (o: Doc | undefined) => typeof o?.pricing?.engineVersion === "string" && !o.pricing.settlement;

/** One order, settlement restored. */
export async function withFinance(orderRef: FirebaseFirestore.DocumentReference, order: Doc): Promise<Doc> {
  if (!needsFinance(order)) return order;
  const f = await financeRef(orderRef).get();
  return attachSettlement(order, f.data());
}

/** Many orders (settlement runs, reconciliation): one batched read for those that need it. */
export async function withFinanceMany(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<Map<string, Doc>> {
  const out = new Map<string, Doc>();
  const pending = docs.filter((d) => needsFinance(d.data()));
  const finance = new Map<string, Doc>();
  for (let i = 0; i < pending.length; i += 300) {
    const chunk = pending.slice(i, i + 300);
    const snaps = await admin.firestore().getAll(...chunk.map((d) => financeRef(d.ref)));
    snaps.forEach((s, j) => {
      if (s.exists) finance.set(chunk[j].id, s.data() as Doc);
    });
  }
  for (const d of docs) out.set(d.id, attachSettlement(d.data(), finance.get(d.id)));
  return out;
}
