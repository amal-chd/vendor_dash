/**
 * ─────────────────────────────────────────────────────────────────────────
 * Order channel taxonomy — the single source of truth for what counts as an
 * ONLINE (marketplace) order versus a WALK-IN / QR in-store order.
 *
 * Platform GMV, order counts and every headline metric must reflect only the
 * online marketplace business. Walk-in POS sales and QR table orders are the
 * restaurant's own in-store revenue that merely flows through Kada's POS — 
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
 * ─────────────────────────────────────────────────────────────────────────
 */

export const ONLINE_SOURCES = ["delivery_app", "web_app"] as const;
export const WALKIN_SOURCES = ["pos", "qr_menu"] as const;

export type OrderChannel = "online" | "walkin" | "qr";

/** Classify an order document by its acquisition channel. */
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
