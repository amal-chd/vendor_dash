/**
 * ─────────────────────────────────────────────────────────────────────────
 * vendorTransitionOrder — the single authoritative path for a restaurant to
 * move one of its orders.
 *
 * Replaces raw client `update({status})` writes, which had no validation:
 *   - any status in any direction (completed → preparing was accepted)
 *   - a stale device could resurrect a customer-cancelled order
 *   - rejecting a PAID order refunded nobody
 *   - staff logins could not act at all; parent owners could not release
 *
 * Guarantees:
 *   - legal transitions only (vendorOrderRules.ts, mirrored in firestore.rules)
 *   - idempotent: repeating a transition that already happened is a success,
 *     never a duplicate event — safe for network retries and multiple devices
 *   - authority: owner / parent / outlet / active staff with the permission
 *   - cancel or reject of a platform-paid order refunds the customer
 *   - every transition writes an immutable, attributed timeline event
 * ─────────────────────────────────────────────────────────────────────────
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { HOT_PATH } from "./options";
import { writeEvent } from "./deliveryLifecycle";
import { resolveVendorActor, actorHasAny, timelineRole } from "./vendorAuthority";
import {
  EVENT_TYPE,
  clampPrepMinutes,
  eventKey,
  isNewLike,
  isVendorTarget,
  normaliseStatus,
  refundAmountRupees,
  requiredPermissions,
  transitionProblem,
  type VendorTarget,
} from "./vendorOrderRules";
import {
  executeRazorpayRefund,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  stageCancellationRefund,
  type RefundOutcome,
} from "./refunds";

function str(v: unknown, max: number): string {
  return (v ?? "").toString().trim().slice(0, max);
}

export const vendorTransitionOrder = onCall(
  { ...HOT_PATH, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");

    const orderId = str(request.data?.orderId, 128);
    if (!orderId) throw new HttpsError("invalid-argument", "orderId is required.");

    const toRaw = normaliseStatus(request.data?.to);
    if (!isVendorTarget(toRaw)) {
      throw new HttpsError("invalid-argument", `"${String(request.data?.to)}" is not a valid order action.`);
    }
    const to: VendorTarget = toRaw;

    const reason = str(request.data?.reason, 200);
    if ((to === "cancelled" || to === "rejected") && reason.length < 3) {
      throw new HttpsError(
        "invalid-argument",
        "Choose a reason before rejecting or cancelling. The customer sees it.",
      );
    }
    const prepMinutes = clampPrepMinutes(request.data?.prepMinutes);
    const autoAccepted = request.data?.autoAccepted === true;

    const db = admin.firestore();
    const ref = db.collection("orders").doc(orderId);

    // Authority needs the restaurantId; it is a server-owned field the rules
    // forbid clients from changing, and it is strictly re-checked inside the txn.
    let restaurantId = str(request.data?.restaurantId, 128);
    if (!restaurantId) {
      const pre = await ref.get();
      if (!pre.exists) throw new HttpsError("not-found", "This order no longer exists.");
      restaurantId = String(pre.data()?.restaurantId ?? "");
    }
    const actor = await resolveVendorActor(request, restaurantId);
    const needed = requiredPermissions(to);
    if (!actorHasAny(actor, needed)) {
      throw new HttpsError(
        "permission-denied",
        `Your role can't do this (needs ${needed.join(" or ")} access). Ask the owner to update your permissions.`,
      );
    }

    const result = await db.runTransaction(async (tx) => {
      // ── ALL reads first (Firestore forbids reads after writes) ──────────
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "This order no longer exists.");
      const o = snap.data() ?? {};
      if (String(o.restaurantId ?? "") !== restaurantId) {
        throw new HttpsError("failed-precondition", "This order no longer belongs to this restaurant.");
      }
      const from = normaliseStatus(o.status) || "new";

      // Idempotent success: another device or a retry already did this.
      if (from === to) {
        return { idempotent: true, from, refund: null as RefundOutcome | null };
      }

      const problem = transitionProblem(o, to);
      if (problem) {
        throw new HttpsError("failed-precondition", problem, { currentStatus: from });
      }

      const refundAmt = to === "cancelled" || to === "rejected" ? refundAmountRupees(o) : 0;
      const refundId = `vendor_${orderId}`;
      const refundRef = db.collection("platform_refunds").doc(refundId);
      const existingRefund = refundAmt > 0 ? (await tx.get(refundRef)).data() : undefined;

      // ── Writes ──────────────────────────────────────────────────────────
      const now = admin.firestore.FieldValue.serverTimestamp();
      const patch: Record<string, unknown> = {
        status: to,
        updatedAt: now,
        lastStatusActor: {
          uid: actor.uid,
          role: actor.role,
          staffId: actor.staffId ?? null,
        },
      };

      const accepting = to === "confirmed" || (to === "preparing" && isNewLike(from));
      if (accepting) {
        patch.acceptedAt = now;
        patch.acceptedBy = actor.uid;
        patch.etaMinutes = prepMinutes;
        patch.estimatedReadyAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + prepMinutes * 60_000,
        );
        if (autoAccepted) patch.autoAccepted = true;
      }
      if (to === "preparing") patch.preparingAt = now;
      if (to === "ready") patch.readyAt = now;
      if (to === "ready_for_pickup") {
        patch.releasedForPickupAt = now;
        patch.releasedBy = actor.uid;
        if (!o.readyAt) patch.readyAt = now;
      }
      if (to === "completed") patch.completedAt = now;
      if (to === "cancelled" || to === "rejected") {
        patch.cancelReason = reason;
        patch[to === "rejected" ? "rejectedAt" : "cancelledAt"] = now;
        patch.cancelledBy = actor.uid;
        patch.cancelledByRole = actor.role;
      }

      let refund: RefundOutcome | null = null;
      if (refundAmt > 0 && existingRefund?.status !== "completed") {
        const staged = stageCancellationRefund({
          tx,
          order: o,
          orderId,
          refundId,
          amount: refundAmt,
          reason,
          ledgerReason: `Restaurant ${to}: ${reason}`,
          source: "vendor_transition",
          requestedBy: actor.uid,
          requestedByRole: actor.role,
        });
        Object.assign(patch, staged.patch);
        refund = staged.refund;
      }

      tx.set(ref, patch, { merge: true });

      const role = timelineRole(actor);
      const meta = {
        staffId: actor.staffId ?? null,
        reason: reason || null,
        prepMinutes: accepting ? prepMinutes : null,
        autoAccepted: autoAccepted || null,
        refundAmount: refund?.amount ?? null,
        refundStatus: refund?.status ?? null,
      };
      // A compound accept (new → preparing) records the acceptance too, so
      // the dispute timeline shows both moments.
      if (accepting && to === "preparing") {
        writeEvent(tx, orderId, eventKey(orderId, "confirmed"), {
          type: EVENT_TYPE.confirmed,
          actorId: actor.uid,
          actorRole: role,
          from,
          to: "confirmed",
          metadata: meta,
        });
      }
      writeEvent(tx, orderId, eventKey(orderId, to), {
        type: EVENT_TYPE[to],
        actorId: actor.uid,
        actorRole: role,
        from: accepting && to === "preparing" ? "confirmed" : from,
        to,
        metadata: meta,
      });

      return { idempotent: false, from, refund };
    });

    let refund = result.refund;
    if (refund?.status === "pending_execution") {
      // Never throws: a failed gateway call is recorded and surfaced to ops,
      // and the status change above is already committed.
      const exec = await executeRazorpayRefund(refund.refundId);
      refund = { ...refund, status: exec.status };
    }

    logger.info("vendorTransitionOrder", {
      orderId,
      from: result.from,
      to,
      actor: actor.uid,
      role: actor.role,
      idempotent: result.idempotent,
      refundStatus: refund?.status ?? null,
    });

    return {
      ok: true,
      status: to,
      from: result.from,
      idempotent: result.idempotent,
      refund,
    };
  },
);
