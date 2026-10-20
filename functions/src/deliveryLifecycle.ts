import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { HOT_PATH } from "./options";
import { resolveVendorActor, actorHasAny, timelineRole } from "./vendorAuthority";
import { isDeliveryOrder, normaliseStatus } from "./vendorOrderRules";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * THE authoritative order + delivery lifecycle.
 *
 * Single source of truth for: what the states are, which transitions are
 * legal, who may perform them, what conditions must hold, and what event is
 * recorded. Nothing else in the codebase may invent a transition.
 *
 * Wire values deliberately match the strings already persisted in Firestore
 * (`orders.status` / `orders.deliveryStatus`) so this is a validation layer
 * over the existing data model, NOT a migration. The only NEW wire value is
 * `ready_for_pickup` (the shop-release gate).
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Coarse order status (customer/vendor facing) ──────────────────────────
export const OrderStatus = {
  NEW: "new",
  CONFIRMED: "confirmed",
  PREPARING: "preparing",
  READY: "ready",
  READY_FOR_PICKUP: "ready_for_pickup",
  OUT_FOR_DELIVERY: "out_for_delivery",
  DELIVERED: "delivered",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REJECTED: "rejected",
} as const;

// ── Delivery leg (rider facing) ───────────────────────────────────────────
export const DeliveryState = {
  UNASSIGNED: "unassigned",
  OFFERED: "offered",
  ASSIGNED: "assigned",
  AT_RESTAURANT: "at_restaurant",
  PICKED_UP: "picked_up",
  ON_THE_WAY: "on_the_way",
  ARRIVED: "arrived",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  REASSIGNMENT_REQUIRED: "reassignment_required",
} as const;

export type DeliveryStateValue =
  (typeof DeliveryState)[keyof typeof DeliveryState];

/**
 * Legal rider-driven transitions. ARRIVED → DELIVERED is deliberately absent:
 * completion runs through `completeDelivery` (server-verified OTP + payout),
 * never through the generic stage advance.
 */
const RIDER_TRANSITIONS: Record<string, string[]> = {
  [DeliveryState.ASSIGNED]: [DeliveryState.AT_RESTAURANT],
  [DeliveryState.AT_RESTAURANT]: [DeliveryState.PICKED_UP],
  [DeliveryState.PICKED_UP]: [DeliveryState.ON_THE_WAY],
  [DeliveryState.ON_THE_WAY]: [DeliveryState.ARRIVED],
};

/** Stages that mean the rider physically holds the food. */
export const POST_PICKUP: string[] = [
  DeliveryState.PICKED_UP,
  DeliveryState.ON_THE_WAY,
  DeliveryState.ARRIVED,
  DeliveryState.DELIVERED,
];

/** Terminal order states — nothing may transition out of these. */
const TERMINAL_ORDER: string[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

export function isTerminalOrder(status: string): boolean {
  return TERMINAL_ORDER.includes((status ?? "").toString());
}

/** Is `to` a legal next stage from `from` for a rider? */
export function canRiderTransition(from: string, to: string): boolean {
  return (RIDER_TRANSITIONS[(from ?? "").toString()] ?? []).includes(to);
}

/**
 * The delivery leg in order, for operator corrections. Ops regularly has to
 * fix a stage a rider never tapped (bad signal at the shop, app killed in the
 * background), which the rider table cannot express: it only allows one exact
 * step at a time from the rider's own device.
 */
const ADMIN_STAGE_ORDER: string[] = [
  DeliveryState.UNASSIGNED,
  DeliveryState.OFFERED,
  DeliveryState.ASSIGNED,
  DeliveryState.AT_RESTAURANT,
  DeliveryState.PICKED_UP,
  DeliveryState.ON_THE_WAY,
  DeliveryState.ARRIVED,
];

/**
 * May an admin move this delivery leg from `from` to `to`?
 *
 * Forward only, and never into DELIVERED — completion owns the OTP check and
 * the rider payout, so it must run through `completeDelivery`. Rewinding is
 * refused too: "un-picking-up" an order the rider is physically carrying
 * desynchronises the rider's app from the board. To take an order off a rider,
 * ops uses `reassignDelivery`, which frees the rider and re-offers the order.
 */
export function canAdminForceStage(from: string, to: string): boolean {
  const i = ADMIN_STAGE_ORDER.indexOf((from ?? "").toString());
  const j = ADMIN_STAGE_ORDER.indexOf((to ?? "").toString());
  return i >= 0 && j > i;
}

/**
 * Customer-facing copy. The customer must never see a raw database state.
 * Derived from the delivery leg first (more specific), then coarse status.
 */
export function customerFacingStatus(
  orderStatus: string,
  deliveryStatus: string,
): { title: string; detail: string } {
  const s = (orderStatus ?? "").toString();
  const d = (deliveryStatus ?? "").toString();

  if (s === OrderStatus.CANCELLED) return { title: "Cancelled", detail: "This order was cancelled." };
  if (s === OrderStatus.REJECTED) return { title: "Not accepted", detail: "The restaurant could not accept this order." };
  if (d === DeliveryState.DELIVERED || s === OrderStatus.DELIVERED || s === OrderStatus.COMPLETED) {
    return { title: "Delivered", detail: "Enjoy your order!" };
  }
  if (d === DeliveryState.ARRIVED) return { title: "Near you", detail: "Your delivery partner is at your location." };
  if (d === DeliveryState.ON_THE_WAY) return { title: "On the way", detail: "Your order is on the way." };
  if (d === DeliveryState.PICKED_UP) return { title: "Picked up", detail: "Your order has been picked up." };
  if (d === DeliveryState.AT_RESTAURANT) return { title: "Collecting your order", detail: "Your delivery partner is at the restaurant." };
  if (d === DeliveryState.ASSIGNED || d === DeliveryState.OFFERED) {
    return { title: "Delivery partner assigned", detail: "Your partner is heading to the restaurant." };
  }
  if (s === OrderStatus.READY_FOR_PICKUP) {
    return { title: "Finding a delivery partner", detail: "We're finding a delivery partner for you." };
  }
  if (s === OrderStatus.READY) return { title: "Order ready", detail: "Your order is ready." };
  if (s === OrderStatus.PREPARING) return { title: "Preparing", detail: "The restaurant is preparing your order." };
  if (s === OrderStatus.CONFIRMED) return { title: "Order accepted", detail: "The restaurant accepted your order." };
  return { title: "Order placed", detail: "Waiting for the restaurant to accept." };
}

/**
 * Append an immutable timeline event. Idempotent: the caller supplies a
 * deterministic `eventKey`, so a retried mutation overwrites the same document
 * instead of creating a duplicate entry.
 */
export function writeEvent(
  tx: admin.firestore.Transaction,
  orderId: string,
  eventKey: string,
  data: {
    type: string;
    actorId: string;
    actorRole: string;
    from?: string;
    to?: string;
    metadata?: Record<string, unknown>;
  },
): void {
  const ref = admin
    .firestore()
    .collection("orders")
    .doc(orderId)
    .collection("events")
    .doc(eventKey.slice(0, 400));
  tx.set(
    ref,
    {
      ...data,
      from: data.from ?? null,
      to: data.to ?? null,
      metadata: data.metadata ?? {},
      at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Non-transactional timeline write (for triggers/callables outside a txn). */
export async function logEvent(
  orderId: string,
  eventKey: string,
  data: {
    type: string;
    actorId: string;
    actorRole: string;
    from?: string;
    to?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin
      .firestore()
      .collection("orders")
      .doc(orderId)
      .collection("events")
      .doc(eventKey.slice(0, 400))
      .set(
        {
          ...data,
          from: data.from ?? null,
          to: data.to ?? null,
          metadata: data.metadata ?? {},
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch (e) {
    logger.warn("logEvent failed", { orderId, eventKey, e });
  }
}

/**
 * Is the shop-release gate switched on? Config-flagged so the gate can ship
 * dark and be enabled per-deployment once shops are trained (settings/delivery
 * → requireShopRelease). Defaults to FALSE = today's behaviour, unchanged.
 */
export async function requireShopRelease(): Promise<boolean> {
  try {
    const snap = await admin.firestore().collection("settings").doc("delivery").get();
    return snap.data()?.requireShopRelease === true;
  } catch {
    return false;
  }
}

/** True when the order has been explicitly released by the shop for dispatch. */
export function isReleasedForPickup(order: FirebaseFirestore.DocumentData): boolean {
  return (
    (order.status ?? "").toString() === OrderStatus.READY_FOR_PICKUP ||
    order.releasedForPickupAt != null
  );
}

/** Minutes before a scheduled slot that rider dispatch begins. */
export const SCHEDULED_DISPATCH_LEAD_MIN = 45;

/**
 * True while a scheduled order is too far from its slot to dispatch a rider.
 * Dispatch used to start at placement, so a rider could be sent hours before
 * the food was due. dispatchDueScheduledOrders starts it when the slot nears.
 */
export function scheduledDispatchHold(order: FirebaseFirestore.DocumentData, nowMs = Date.now()): boolean {
  const t = order.scheduledFor as { toMillis?: () => number } | Date | number | null | undefined;
  const ms =
    t instanceof Date ? t.getTime()
    : typeof t === "number" ? t
    : t && typeof (t as { toMillis?: () => number }).toMillis === "function" ? (t as { toMillis: () => number }).toMillis()
    : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return false;
  return ms - nowMs > SCHEDULED_DISPATCH_LEAD_MIN * 60_000;
}

/** Order statuses in which the kitchen has explicitly finished the food. */
const HANDOFF_READY_STATUSES = ["ready", "prepared", "ready_for_pickup"];

/**
 * THE pickup rule as a pure check: why a rider may not confirm pickup yet, or
 * null when they may. READY is a hard business rule and applies whatever the
 * `requireShopRelease` flag says. Previously pickup was only gated when that
 * flag was on (default off), so a rider could take an order the kitchen was
 * still cooking. The flag adds the stricter explicit-release gate on top.
 * Mirrored for direct rider writes in firestore.rules.
 */
export function pickupProblem(
  order: FirebaseFirestore.DocumentData,
  requireRelease: boolean,
): string | null {
  const status = (order.status ?? "").toString().trim().toLowerCase();
  const released = isReleasedForPickup(order);
  if (!released && !HANDOFF_READY_STATUSES.includes(status)) {
    return "The restaurant has not marked this order ready yet. Pickup unlocks once it is Ready.";
  }
  if (requireRelease && !released) {
    return "The shop has not released this order for pickup yet.";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// PHASE 5 — the shop release gate.
// The shop explicitly hands the order to dispatch. READY alone is NOT enough.
// ─────────────────────────────────────────────────────────────────────────
export const releaseOrderForPickup = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const orderId = (request.data?.orderId ?? "").toString();
  if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");

  const db = admin.firestore();
  const ref = db.collection("orders").doc(orderId);

  // Same authority as every vendor transition (owner, parent/outlet owner,
  // or active staff with order/kitchen access). This used to accept only an
  // exact restaurantId === uid match, so parent owners and staff could never
  // hand an order to dispatch.
  const pre = await ref.get();
  if (!pre.exists) throw new HttpsError("not-found", "Order not found.");
  const restaurantId = (pre.data()?.restaurantId ?? "").toString();
  const actor = await resolveVendorActor(request, restaurantId);
  if (!actorHasAny(actor, ["orders", "kitchen"])) {
    throw new HttpsError("permission-denied", "Your role can't release orders for pickup.");
  }

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = snap.data() ?? {};
    const status = normaliseStatus(order.status);

    if ((order.restaurantId ?? "").toString() !== restaurantId) {
      throw new HttpsError("failed-precondition", "This order no longer belongs to this restaurant.");
    }
    if (isTerminalOrder(status)) {
      throw new HttpsError("failed-precondition", "This order is already closed.");
    }
    // Idempotent: releasing twice is a no-op success, never a duplicate event.
    if (status === OrderStatus.READY_FOR_PICKUP || order.releasedForPickupAt != null) {
      return { alreadyReleased: true };
    }
    // READY is a hard gate. This previously released from ANY open status —
    // including "new" — authorising a rider for food nobody had cooked.
    if (!["ready", "prepared"].includes(status)) {
      throw new HttpsError(
        "failed-precondition",
        `Mark this order Ready before releasing it for pickup (it is currently "${status || "new"}"). Nothing was changed.`,
      );
    }
    if (!isDeliveryOrder(order)) {
      throw new HttpsError("failed-precondition", "Only delivery orders are released for rider pickup.");
    }

    tx.set(
      ref,
      {
        status: OrderStatus.READY_FOR_PICKUP,
        releasedForPickupAt: admin.firestore.FieldValue.serverTimestamp(),
        releasedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    writeEvent(tx, orderId, `released_${orderId}`, {
      type: "ORDER_RELEASED_FOR_PICKUP",
      actorId: uid,
      actorRole: timelineRole(actor),
      from: status,
      to: OrderStatus.READY_FOR_PICKUP,
    });

    return { alreadyReleased: false };
  });

  logger.info(`Order ${orderId} released for pickup by ${uid}`, result);
  return { ok: true, ...result };
});

// ─────────────────────────────────────────────────────────────────────────
// PHASE 4 — the single transition API for the rider-driven delivery leg.
// Replaces the client's raw `set(merge:true)` write of deliveryStatus.
// ─────────────────────────────────────────────────────────────────────────
export const advanceDeliveryStage = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  // Ops correcting a stage the rider never tapped. The admin console used to
  // write `deliveryStatus` straight onto the order — no transition check, no
  // pickup gate, no timeline event — and mapped "arrived" to status:"completed",
  // which terminated the order so the rider's completeDelivery (OTP + payout)
  // could never run. Admins come through here now, with the same gates.
  const isAdminCaller = request.auth?.token?.platformAdmin === true;

  const orderId = (request.data?.orderId ?? "").toString();
  const toStage = (request.data?.stage ?? "").toString();
  if (!orderId || !toStage) {
    throw new HttpsError("invalid-argument", "orderId and stage are required.");
  }
  if (!Object.values(DeliveryState).includes(toStage as DeliveryStateValue)) {
    throw new HttpsError("invalid-argument", `Unknown stage "${toStage}".`);
  }

  const db = admin.firestore();
  const ref = db.collection("orders").doc(orderId);
  const gateOn = await requireShopRelease();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = snap.data() ?? {};
    const from = (order.deliveryStatus ?? DeliveryState.UNASSIGNED).toString();
    const status = (order.status ?? "").toString();

    // 1. Ownership — only the assigned rider drives this leg (or ops).
    if (!isAdminCaller && (order.riderId ?? "").toString() !== uid) {
      throw new HttpsError("permission-denied", "This delivery is not assigned to you.");
    }
    if (isAdminCaller && !(order.riderId ?? "").toString()) {
      throw new HttpsError(
        "failed-precondition",
        "This order has no rider yet — assign one before moving the delivery along.",
      );
    }
    // 2. Order must still be live.
    if (status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED) {
      throw new HttpsError("failed-precondition", "This order was cancelled.");
    }
    // 3. Idempotency — re-sending the stage you're already in succeeds quietly.
    if (from === toStage) return { changed: false, state: from };
    // 4. Transition must be legal. A rider takes one exact step; ops may skip
    //    ahead to catch up with reality, but neither may rewind, and neither
    //    may land on DELIVERED — that is completeDelivery's (OTP + payout).
    const legal = isAdminCaller
      ? canAdminForceStage(from, toStage)
      : canRiderTransition(from, toStage);
    if (!legal) {
      throw new HttpsError(
        "failed-precondition",
        toStage === DeliveryState.DELIVERED
          ? "A delivery is completed at handoff by the rider (OTP verified), not from the console."
          : `Cannot go from "${from}" to "${toStage}".`,
      );
    }
    // 5. THE pickup rule. The kitchen must have marked the order READY (always
    //    on) and, when the release gate is enabled, explicitly released it.
    //    Enforced server-side; the client cannot skip it.
    if (toStage === DeliveryState.PICKED_UP) {
      const problem = pickupProblem(order, gateOn);
      if (problem) throw new HttpsError("failed-precondition", problem);
    }

    const patch: Record<string, unknown> = {
      deliveryStatus: toStage,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (toStage === DeliveryState.AT_RESTAURANT) patch.atRestaurantAt = admin.firestore.FieldValue.serverTimestamp();
    if (toStage === DeliveryState.PICKED_UP) patch.pickedUpAt = admin.firestore.FieldValue.serverTimestamp();
    if (toStage === DeliveryState.ON_THE_WAY) {
      // Customer tracking keys "on the way" off the coarse status — preserved.
      patch.status = OrderStatus.OUT_FOR_DELIVERY;
      patch.outForDeliveryAt = admin.firestore.FieldValue.serverTimestamp();
    }
    if (toStage === DeliveryState.ARRIVED) patch.arrivedAt = admin.firestore.FieldValue.serverTimestamp();

    tx.set(ref, patch, { merge: true });

    writeEvent(tx, orderId, `stage_${orderId}_${toStage}`, {
      type: `DELIVERY_${toStage.toUpperCase()}`,
      actorId: uid,
      actorRole: isAdminCaller ? "admin" : "rider",
      from,
      to: toStage,
      ...(isAdminCaller
        ? { metadata: { forcedBy: (request.auth?.token?.email as string | undefined) ?? "admin" } }
        : {}),
    });

    return { changed: true, state: toStage };
  });

  return { ok: true, ...outcome };
});
