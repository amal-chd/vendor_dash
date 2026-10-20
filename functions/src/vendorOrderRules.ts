/**
 * ─────────────────────────────────────────────────────────────────────────
 * Vendor order transitions — the PURE rules.
 *
 * No Firebase imports, so the whole matrix is unit-testable. Two enforcement
 * points share these semantics and MUST change together:
 *   1. `vendorTransitionOrder` (vendorOrders.ts) — the authoritative path.
 *   2. `vendorCanMoveOrder` / `vendorOrderUpdateAllowed` in firestore.rules —
 *      defence in depth for app builds that still write `orders.status`.
 *
 * Why this exists: a restaurant could previously write ANY status in ANY
 * direction. A stale device could move a customer-cancelled order back to
 * "preparing", and nothing on the server refused completed → preparing.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { isInStoreOrder } from "./orderChannels";

export const VENDOR_TARGETS = [
  "confirmed",
  "preparing",
  "ready",
  "ready_for_pickup",
  "completed",
  "cancelled",
  "rejected",
] as const;
export type VendorTarget = (typeof VENDOR_TARGETS)[number];

const NEW_LIKE = ["new", "pending", "placed", "scheduled"];
const ACCEPTED_LIKE = ["confirmed", "accepted"];
const PREPARING_LIKE = ["preparing", "cooking"];
const READY_LIKE = ["ready", "prepared"];
const TERMINAL = ["delivered", "completed", "cancelled", "canceled", "rejected", "void"];

export function normaliseStatus(s: unknown): string {
  return (s ?? "").toString().trim().toLowerCase();
}

export function isVendorTarget(s: unknown): s is VendorTarget {
  return (VENDOR_TARGETS as readonly string[]).includes(normaliseStatus(s));
}

export function isNewLike(s: unknown): boolean {
  return NEW_LIKE.includes(normaliseStatus(s) || "new");
}

export function isTerminalStatus(s: unknown): boolean {
  return TERMINAL.includes(normaliseStatus(s));
}

/**
 * Legal vendor moves. Accepting straight into "preparing" is a legitimate
 * compound action (a kitchen that starts immediately) and records both an
 * ACCEPTED and a PREPARING event. READY is a hard gate before release: a
 * rider must never be dispatched to food the kitchen has not finished.
 */
export function canVendorTransition(
  fromRaw: unknown,
  toRaw: unknown,
  opts: { inStore?: boolean } = {},
): boolean {
  const from = normaliseStatus(fromRaw) || "new";
  const to = normaliseStatus(toRaw);
  // Counter service: a table order is served as dishes come out and settled at
  // the till, so an ACCEPTED in-store order may close without a READY step.
  // READY stays mandatory wherever food is handed over for pickup.
  if (opts.inStore && to === "completed" && (ACCEPTED_LIKE.includes(from) || PREPARING_LIKE.includes(from))) {
    return true;
  }
  if (NEW_LIKE.includes(from)) return ["confirmed", "preparing", "rejected", "cancelled"].includes(to);
  if (ACCEPTED_LIKE.includes(from)) return ["preparing", "cancelled"].includes(to);
  if (PREPARING_LIKE.includes(from)) return ["ready", "cancelled"].includes(to);
  if (READY_LIKE.includes(from)) return ["ready_for_pickup", "completed", "cancelled"].includes(to);
  if (from === "ready_for_pickup") return to === "completed";
  return false;
}

export function isDeliveryOrder(o: Record<string, unknown>): boolean {
  return normaliseStatus(o.type) === "delivery" || normaliseStatus(o.channel) === "delivery";
}

const absent = (v: unknown) => v === undefined || v === "";

/**
 * In-store for OPERATIONS (transitions, refunds): tagged POS/QR, or an
 * untagged order with no customer account. The web POS created untagged orders,
 * and treating those as marketplace orders would lock restaurants out of their
 * own counter tickets. Customer-app orders always carry customerUid, so a
 * marketplace order can never be reclassified. Mirrors `orderIsInStore` in
 * firestore.rules exactly (missing or "" only; null counts as present).
 * Finance channel classification (orderChannels.ts) is deliberately unchanged.
 */
export function isCounterOrder(o: Record<string, unknown>): boolean {
  if (isInStoreOrder(o as { orderSource?: unknown })) return true;
  return absent(o.orderSource) && absent(o.customerUid) && absent(o.userId) && absent(o.customerId);
}

const LABELS: Record<string, string> = {
  new: "New",
  pending: "New",
  placed: "New",
  draft: "Awaiting payment",
  scheduled: "Scheduled",
  confirmed: "Accepted",
  accepted: "Accepted",
  preparing: "Preparing",
  cooking: "Preparing",
  ready: "Ready",
  prepared: "Ready",
  ready_for_pickup: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  rejected: "Rejected",
  void: "Voided",
};

export function statusLabel(s: unknown): string {
  const v = normaliseStatus(s) || "new";
  return LABELS[v] ?? v;
}

/**
 * Why a move is refused, in words an operator can act on — or null when the
 * move is legal. Every message states that nothing was changed, because the
 * worst outcome for a busy kitchen is guessing whether a tap took effect.
 */
export function transitionProblem(order: Record<string, unknown>, toRaw: unknown): string | null {
  const from = normaliseStatus(order.status) || "new";
  const to = normaliseStatus(toRaw);
  if (!isVendorTarget(to)) return `"${String(toRaw)}" is not a valid order action. Nothing was changed.`;
  if (isTerminalStatus(from)) {
    return `This order is already ${statusLabel(from)}. Nothing was changed.`;
  }
  if (to === "completed" && isDeliveryOrder(order)) {
    return "Delivery orders are completed by the delivery partner at handoff, not by the restaurant. Nothing was changed.";
  }
  if (to === "ready_for_pickup" && !isDeliveryOrder(order)) {
    return "Only delivery orders are released for rider pickup. Mark this order Ready or Completed instead.";
  }
  if (!canVendorTransition(from, to, { inStore: isCounterOrder(order) })) {
    return (
      `This order is ${statusLabel(from)}, so it can't be moved to ${statusLabel(to)}. ` +
      "It may have been updated on another device or by the customer. Nothing was changed."
    );
  }
  return null;
}

/** Any-of permission set a staff member needs for each action. */
export function requiredPermissions(to: VendorTarget): string[] {
  switch (to) {
    case "completed":
      return ["orders", "pos"];
    case "cancelled":
    case "rejected":
      return ["orders"];
    default:
      return ["orders", "kitchen"];
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A customer-app order paid online (Razorpay or wallet) whose payment hasn't
 * been confirmed yet. The app creates the order BEFORE the payment runs, so a
 * failed or abandoned payment used to leave a live order the kitchen was
 * alerted to and a rider was dispatched for. Until paid, neither happens.
 */
export function isAwaitingOnlinePayment(o: Record<string, unknown>): boolean {
  if (isCounterOrder(o)) return false;
  if (!["razorpay", "wallet"].includes(normaliseStatus(o.paymentMethod))) return false;
  if (normaliseStatus(o.paymentStatus) === "paid") return false;
  return isNewLike(o.status) || normaliseStatus(o.status) === "draft";
}

/** A customer-app order, as opposed to a counter ticket. */
export function isCustomerOrder(o: Record<string, unknown>): boolean {
  return !isCounterOrder(o) && String(o.customerUid ?? "").trim() !== "";
}

const pricedOk = (o: Record<string, unknown>) =>
  (o.pricingCheck as { ok?: unknown } | undefined)?.ok === true;
const isPaid = (o: Record<string, unknown>) => normaliseStatus(o.paymentStatus) === "paid";

/**
 * A cash-on-delivery customer order the server hasn't priced yet
 * (vetCustomerOrder). COD orders had no price check at all, so a modified app
 * could set the total the rider collects and the vendor is settled on. Online
 * orders are priced when they're paid instead.
 */
export function isAwaitingOrderVetting(o: Record<string, unknown>): boolean {
  if (!isCustomerOrder(o)) return false;
  if (["razorpay", "wallet"].includes(normaliseStatus(o.paymentMethod))) return false;
  if (pricedOk(o)) return false;
  return isNewLike(o.status);
}

/** Not real yet: no kitchen alert, no rider, no confirmation to the customer. */
export function isOrderHeld(o: Record<string, unknown>): boolean {
  return isAwaitingOnlinePayment(o) || isAwaitingOrderVetting(o);
}

/**
 * True on the single update that makes a held order real: its online payment
 * landed, or its pricing check passed. A restaurant acting on an older order
 * never counts, so nothing is announced or dispatched twice.
 */
export function orderReleased(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const newlyPaid = isPaid(after) && !isPaid(before) && isAwaitingOnlinePayment(before);
  const newlyVetted = pricedOk(after) && !pricedOk(before);
  if (!newlyPaid && !newlyVetted) return false;
  if (isOrderHeld(after)) return false;
  return !isTerminalStatus(after.status);
}

/**
 * Why a customer may not cancel from the app, or null when they may. The
 * window closes once the restaurant accepts: the kitchen has started, so the
 * request goes to support instead. An unpaid draft can always be abandoned.
 */
export function customerCancelProblem(o: Record<string, unknown>): string | null {
  const s = normaliseStatus(o.status) || "new";
  if (isTerminalStatus(s)) return `This order is already ${statusLabel(s)}. Nothing was changed.`;
  if (s === "draft" || NEW_LIKE.includes(s)) return null;
  return (
    "The restaurant has already started this order, so it can't be cancelled from the app. " +
    "Contact support and we'll help. Nothing was changed."
  );
}

/**
 * A cancelled/rejected order owes the customer a refund only when the
 * PLATFORM collected the money. In-store orders (POS/QR, or staff-created with
 * no customer) are the restaurant's own till and are settled at the counter.
 */
export function isRefundableOnCancel(o: Record<string, unknown>): boolean {
  return normaliseStatus(o.paymentStatus) === "paid" && !isCounterOrder(o);
}

/** Remaining refundable amount in rupees, net of any earlier partial refund. */
export function refundAmountRupees(o: Record<string, unknown>): number {
  if (!isRefundableOnCancel(o)) return 0;
  const total = num(o.total ?? o.totalAmount ?? o.payable);
  const already = num(o.refundAmount);
  return Math.round(Math.max(0, total - already) * 100) / 100;
}

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function clampPrepMinutes(v: unknown, fallback = 20): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(180, Math.max(1, n));
}

export const EVENT_TYPE: Record<VendorTarget, string> = {
  confirmed: "ORDER_ACCEPTED",
  preparing: "ORDER_PREPARING",
  ready: "ORDER_READY",
  ready_for_pickup: "ORDER_RELEASED_FOR_PICKUP",
  completed: "ORDER_COMPLETED",
  cancelled: "ORDER_CANCELLED",
  rejected: "ORDER_REJECTED",
};

/**
 * Deterministic timeline key, so a retried transition overwrites its own
 * event instead of duplicating it. Release shares releaseOrderForPickup's key,
 * so either path produces exactly one release event.
 */
export function eventKey(orderId: string, to: VendorTarget): string {
  return to === "ready_for_pickup" ? `released_${orderId}` : `vendor_${orderId}_${to}`;
}

/**
 * Staff role presets. Mirrors vendor_mobile_app/lib/utils/staff_permissions.dart
 * (kStaffRoles) and `staffRoleGrants` in firestore.rules — change all three
 * together. An unknown role gets NOTHING: the Dart client used to fall back to
 * the Admin preset, silently granting finance access to a blank role.
 */
export const STAFF_ROLE_PRESETS: Record<string, readonly string[]> = {
  admin: [
    "orders", "kitchen", "pos", "menu", "tables", "reservations", "stock",
    "recipes", "guests", "loyalty", "schedule", "reports", "marketing", "expenses",
  ],
  manager: [
    "orders", "kitchen", "pos", "menu", "tables", "reservations", "stock",
    "recipes", "guests", "loyalty", "schedule",
  ],
  chef: ["kitchen", "orders", "stock", "recipes", "menu"],
  cashier: ["orders", "pos", "tables", "reservations", "guests"],
  waiter: ["tables", "reservations", "orders", "pos"],
  custom: [],
};

/** Explicit permission list wins; an empty list falls back to the role preset. */
export function resolveStaffPermissions(staff: Record<string, unknown>): Set<string> {
  const raw = staff.permissions;
  if (Array.isArray(raw) && raw.length > 0) return new Set(raw.map((p) => String(p)));
  return new Set(STAFF_ROLE_PRESETS[normaliseStatus(staff.role)] ?? []);
}
