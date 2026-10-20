/**
 * Order channel taxonomy — client-side mirror of functions/src/orderChannels.ts.
 * The single source of truth for what counts as an ONLINE (marketplace) order
 * versus a WALK-IN (POS) or QR in-store order.
 *
 * Platform GMV, order counts and every headline "marketplace" metric MUST
 * reflect only the online business. Walk-in POS sales and QR table orders are
 * the restaurant's own in-store revenue that flows through Kada's POS —
 * folding them into GMV overstates the marketplace and corrupts commission,
 * take-rate and growth reporting.
 *
 * `orderSource` values observed across the ecosystem:
 *   delivery_app → customer mobile app      (ONLINE)
 *   web_app      → customer web             (ONLINE)
 *   pos          → vendor POS, walk-in      (WALK-IN)
 *   qr_menu      → QR table ordering        (QR / in-store)
 *
 * Legacy orders may carry no `orderSource` at all. Those default to ONLINE,
 * because POS and QR have always tagged themselves — so an untagged document
 * is an old marketplace order, never an in-store one.
 */

export const ONLINE_SOURCES = ["delivery_app", "web_app"] as const;
export const WALKIN_SOURCES = ["pos", "qr_menu"] as const;

export type OrderChannel = "online" | "walkin" | "qr";

export function orderChannelOf(order: { orderSource?: unknown }): OrderChannel {
  const src = (order?.orderSource ?? "").toString().toLowerCase();
  if (src === "qr_menu") return "qr";
  if (src === "pos") return "walkin";
  return "online"; // includes untagged legacy orders
}

/** True when the order belongs to the online marketplace business. */
export function isOnlineOrder(order: { orderSource?: unknown }): boolean {
  return orderChannelOf(order) === "online";
}

/** True for in-store revenue (walk-in POS or QR table order). */
export function isInStoreOrder(order: { orderSource?: unknown }): boolean {
  return !isOnlineOrder(order);
}

const absent = (v: unknown) => v === undefined || v === null || v === "";

/**
 * True for a restaurant's own counter ticket — a walk-in. Mirrors
 * `isCounterOrder` in functions/src/vendorOrderRules.ts: a tagged POS/QR order,
 * or an untagged one with no customer account behind it (the web POS created
 * untagged tickets).
 *
 * Surfaces about Kada's CUSTOMERS — risk, dispatch, consumer analytics — must
 * exclude these: a walk-in is not a Kada customer, has no account, and can
 * neither be blocked nor dispatched to.
 */
export function isWalkInOrder(order: unknown): boolean {
  // Callers pass whatever shape their page models an order with, so this reads
  // the four fields it needs rather than demanding a type they all share.
  const o = (order ?? {}) as {
    orderSource?: unknown;
    customerUid?: unknown;
    userId?: unknown;
    customerId?: unknown;
  };
  if (isInStoreOrder(o)) return true;
  return (
    absent(o.orderSource) && absent(o.customerUid) && absent(o.userId) && absent(o.customerId)
  );
}
