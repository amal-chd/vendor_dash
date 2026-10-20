import * as admin from "firebase-admin";
import { attachSettlement, financeDoc, financeRef } from "./pricing/orderFinance";
import { customerBill } from "./pricing/bill";
import { isItemisedRefund, planFoodRefund, refundHistoryOf, refundHistoryPatch, sanitizeRefundRequest, type FoodRefundPlan } from "./pricing/refundPlan";
import type { FoodQuote } from "./pricing/food";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { assertAdmin } from "./admin_operations";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, executeRazorpayRefund } from "./refunds";
import { toPaise } from "./vendorOrderRules";
import { effectiveCommissionRate, billingAudit, BILLING_MODELS, type BillingModel } from "./billingModel";
import { readCatalog, commissionForMerchant } from "./planCatalog";
import {
  type PartnerRole,
  type OnboardingState,
  ROLE_COLLECTION,
  isOnboardingState,
  explainTransition,
  type OnboardingRecord,
} from "./onboarding/stateMachine";
import { transitionPartner, setStepComplete } from "./onboarding/transition";
import {
  BANK_STATES,
  BANK_STATE_VALUES,
  canTransitionBank,
  type BankVerificationState,
} from "./onboarding/bankVerification";
import { ownerUidsOf, partnerPrivateRef } from "./onboarding/partnerPrivate";
import { runAutoProgress, pathToActive } from "./onboarding/autoProgress";

type Action =
  | "adjustWallet"
  | "setCustomerStatus"
  | "refundOrder"
  | "approveRefund"
  | "rejectRefund"
  | "retryRefund"
  | "refundSubscription"
  | "replayWebhookEvent"
  | "sealOrderFinance"
  | "setCommission"
  | "setBillingModel"
  | "upsertMarket"
  | "deleteMarket"
  | "upsertZone"
  | "deleteZone"
  | "moderateReview"
  | "upsertHomeCollection"
  | "deleteHomeCollection"
  | "upsertIncident"
  | "upsertCancellationReason"
  | "generateHostSettlements"
  | "settleHostPayout"
  | "grantAdmin"
  | "revokeAdmin"
  | "seedDefaultOps"
  // ── Onboarding / KYC / activation engine ──
  | "transitionOnboarding"
  | "reviewOnboardingStep"
  | "setBankVerification"
  | "overrideOnboardingZone"
  | "setOnboardingRequirements"
  // ── Vendor management ──
  | "resetVendorPassword"
  | "setVendorStatus";

async function audit(
  db: admin.firestore.Firestore,
  email: string,
  action: string,
  payload: Record<string, unknown>,
) {
  await db.collection("admin_logs").add({
    type: "platform",
    action,
    description: `adminPlatformAction:${action}`,
    adminEmail: email,
    payload,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function str(v: unknown, max = 500): string {
  return (v ?? "").toString().trim().slice(0, max);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Maker-checker: refunds at/under this move immediately; above it they are
// queued as `pending_approval` and a SECOND finance-grade admin must approve
// before any money leaves the platform. (Mirrors src/lib/approval.ts.)
const REFUND_APPROVAL_THRESHOLD = 5000;

// Server-side RBAC (spec §35): which roles may run each action. This is the
// authoritative boundary — the frontend also gates the UI, but a role that
// isn't listed here is refused even if it calls the callable directly.
// Bootstrap owners / platformAdmin holders without an explicit `adminRole`
// claim resolve to super_admin, so existing owners keep full access.
const ACTION_ROLES: Record<Action, string[]> = {
  adjustWallet: ["super_admin", "platform_admin", "finance_manager", "support_manager"],
  setCustomerStatus: ["super_admin", "platform_admin", "ops_manager", "support_manager", "vendor_manager"],
  refundOrder: ["super_admin", "platform_admin", "finance_manager", "support_manager"],
  // Approving/rejecting a queued high-value refund is a finance-grade action
  // (support can request one but not approve their own).
  approveRefund: ["super_admin", "platform_admin", "finance_manager"],
  rejectRefund: ["super_admin", "platform_admin", "finance_manager"],
  retryRefund: ["super_admin", "platform_admin", "finance_manager"],
  refundSubscription: ["super_admin", "platform_admin", "finance_manager"],
  replayWebhookEvent: ["super_admin", "platform_admin", "finance_manager"],
  sealOrderFinance: ["super_admin", "platform_admin", "finance_manager"],
  setCommission: ["super_admin", "platform_admin", "finance_manager"],
  setBillingModel: ["super_admin", "platform_admin", "finance_manager"],
  upsertMarket: ["super_admin", "platform_admin", "ops_manager"],
  deleteMarket: ["super_admin", "platform_admin"],
  upsertZone: ["super_admin", "platform_admin", "ops_manager", "delivery_manager"],
  deleteZone: ["super_admin", "platform_admin", "delivery_manager"],
  moderateReview: ["super_admin", "platform_admin", "support_manager", "vendor_manager"],
  upsertHomeCollection: ["super_admin", "platform_admin", "marketing_manager"],
  deleteHomeCollection: ["super_admin", "platform_admin", "marketing_manager"],
  upsertIncident: ["super_admin", "platform_admin", "ops_manager"],
  upsertCancellationReason: ["super_admin", "platform_admin", "ops_manager"],
  generateHostSettlements: ["super_admin", "platform_admin", "finance_manager"],
  settleHostPayout: ["super_admin", "platform_admin", "finance_manager"],
  grantAdmin: ["super_admin", "platform_admin"],
  revokeAdmin: ["super_admin", "platform_admin"],
  seedDefaultOps: ["super_admin", "platform_admin"],
  // Onboarding: ops/vendor/delivery managers run the day-to-day review queue;
  // bank verification is finance-grade because it gates where money lands.
  transitionOnboarding: [
    "super_admin", "platform_admin", "ops_manager", "vendor_manager", "delivery_manager",
  ],
  reviewOnboardingStep: [
    "super_admin", "platform_admin", "ops_manager", "vendor_manager", "delivery_manager",
  ],
  setBankVerification: ["super_admin", "platform_admin", "finance_manager"],
  overrideOnboardingZone: ["super_admin", "platform_admin", "ops_manager"],
  setOnboardingRequirements: ["super_admin", "platform_admin"],
  resetVendorPassword: ["super_admin", "platform_admin", "support_manager", "vendor_manager"],
  setVendorStatus: ["super_admin", "platform_admin", "ops_manager", "support_manager", "vendor_manager"],
};

function assertActionRole(request: any, action: Action): void {
  const claims = request.auth?.token ?? {};
  const role =
    (typeof claims.adminRole === "string" && claims.adminRole) || "super_admin";
  const allowed = ACTION_ROLES[action] ?? ["super_admin"];
  if (!allowed.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      `Your role (${role}) is not permitted to perform "${action}".`,
    );
  }
}

export const adminPlatformAction = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  assertAdmin(request);
  const email = (request.auth?.token?.email as string) || "";
  const action = str(request.data?.action, 80) as Action;
  assertActionRole(request, action);
  const data = (request.data?.payload ?? {}) as Record<string, unknown>;
  const db = admin.firestore();

  switch (action) {
    case "adjustWallet": {
      const uid = str(data.uid, 128);
      const amount = num(data.amount);
      const reason = str(data.reason, 400) || "Admin adjustment";
      if (!uid || amount === 0) {
        throw new HttpsError("invalid-argument", "uid and non-zero amount required.");
      }
      const userRef = db.collection("customer_users").doc(uid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
        tx.update(userRef, {
          walletBalance: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(userRef.collection("wallet_transactions").doc(), {
          type: amount > 0 ? "credit" : "debit",
          amount: Math.abs(amount),
          title: amount > 0 ? "Credit from Kada" : "Wallet adjustment",
          description: reason,
          adminEmail: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await audit(db, email, action, { uid, amount, reason });
      return { ok: true };
    }

    case "setCustomerStatus": {
      const uid = str(data.uid, 128);
      const status = str(data.status, 32); // active | banned | suspended
      const reason = str(data.reason, 400);
      if (!uid || !["active", "banned", "suspended"].includes(status)) {
        throw new HttpsError("invalid-argument", "uid and valid status required.");
      }
      await db.collection("customer_users").doc(uid).set(
        {
          accountStatus: status,
          isBanned: status === "banned",
          statusReason: reason || null,
          statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          statusUpdatedBy: email,
        },
        { merge: true },
      );
      if (status === "banned") {
        try {
          await admin.auth().revokeRefreshTokens(uid);
        } catch (e) {
          logger.warn("revoke tokens failed", e);
        }
      }
      await audit(db, email, action, { uid, status, reason });
      return { ok: true };
    }

    case "refundOrder": {
      const orderId = str(data.orderId, 128);
      const amount = num(data.amount);
      const reason = str(data.reason, 400) || "Admin refund";
      const method = str(data.method, 32) || "wallet"; // wallet | original
      if (!orderId) throw new HttpsError("invalid-argument", "orderId required.");
      if (method !== "wallet" && method !== "original") {
        throw new HttpsError("invalid-argument", 'method must be "wallet" or "original".');
      }

      const orderRef = db.collection("orders").doc(orderId);
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
        // The money split lives in orders/{id}/finance/pricing for newer orders.
        const o = attachSettlement(snap.data() ?? {}, (await tx.get(financeRef(orderRef))).data());
        if (o.refundStatus === "refunded") {
          throw new HttpsError("failed-precondition", "Order already refunded.");
        }
        if (o.refundStatus === "processing") {
          throw new HttpsError("failed-precondition", "A refund for this order is already being processed.");
        }
        // "original" means back to the card/UPI the customer paid with, which
        // needs the gateway payment. Refuse up front rather than record a
        // refund nobody can execute.
        const paymentId = str(o.razorpayPaymentId, 128);
        if (method === "original" && !paymentId) {
          throw new HttpsError(
            "failed-precondition",
            "This order has no online payment to refund to. Refund to the Kada wallet instead. Nothing was changed.",
          );
        }
        const paid = num(o.total ?? o.totalAmount ?? o.payable, 0);
        // Pricing-engine orders can refund specific items, charges, the tip or
        // the donation: the amount, GST reversed and the restaurant's clawback
        // come from the order's price snapshot, net of earlier refunds.
        let plan: FoodRefundPlan | null = null;
        if (isItemisedRefund(data)) {
          if (typeof o.pricing?.engineVersion !== "string") {
            throw new HttpsError("failed-precondition", "This order was placed before itemised refunds. Refund an amount instead. Nothing was changed.");
          }
          plan = planFoodRefund(o.pricing as FoodQuote, sanitizeRefundRequest(data), refundHistoryOf(o));
          if (plan.problems.length) throw new HttpsError("failed-precondition", `${plan.problems.join(" ")} Nothing was changed.`);
        }
        const alreadyRefunded = num(o.refundAmount, 0);
        const refundable = Math.max(0, Math.round((paid - alreadyRefunded) * 100) / 100);
        const refundAmt = plan ? plan.amountPaise / 100 : amount > 0 ? Math.min(amount, refundable) : refundable;
        if (!(refundAmt > 0)) throw new HttpsError("failed-precondition", "Nothing is left to refund on this order.");
        const totalRefunded = Math.round((alreadyRefunded + refundAmt) * 100) / 100;
        // Partial vs full — a full refund cancels the order (excluded from the
        // vendor's next settlement); a partial refund keeps the order live so
        // the vendor still earns commission on the RETAINED amount. The
        // settlement generator subtracts refunds from the vendor's basis.
        const isFullRefund = totalRefunded >= paid;
        const customerUid = str(o.customerUid ?? o.userId ?? o.customerId, 128);

        // Maker-checker gate: a large refund is QUEUED (no money moves) and must
        // be approved by a second finance admin via `approveRefund`.
        if (refundAmt > REFUND_APPROVAL_THRESHOLD) {
          const refundRef = db.collection("platform_refunds").doc();
          tx.set(refundRef, {
            orderId,
            orderNumber: o.orderNumber ?? null,
            restaurantId: o.restaurantId ?? null,
            restaurantName: o.restaurantName ?? null,
            customerUid: customerUid || null,
            amount: refundAmt,
            reason,
            method,
            ...(plan ? { plan: JSON.parse(JSON.stringify(plan)), refundRequest: sanitizeRefundRequest(data) } : {}),
            status: "pending_approval",
            requestedBy: email,
            createdBy: email,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return { pendingApproval: true, refundAmt, customerUid, refundId: refundRef.id, viaGateway: false };
        }

        // Gateway refunds are recorded as intent here and executed after
        // commit. They used to be written "completed" while no money moved.
        const viaGateway = method === "original" && refundAmt > 0;
        tx.update(orderRef, {
          refundStatus: viaGateway ? "processing" : isFullRefund ? "refunded" : "partial",
          refundAmount: totalRefunded,
          ...(plan ? refundHistoryPatch(o, plan) : {}),
          refundReason: reason,
          refundMethod: method,
          refundedAt: admin.firestore.FieldValue.serverTimestamp(),
          refundedBy: email,
          // Only cancel on FULL refund — partials keep original status so the
          // vendor's next settlement includes commission on the retained amount.
          ...(isFullRefund && o.status !== "cancelled" ? { status: "cancelled" } : {}),
        });
        const refundRef = db.collection("platform_refunds").doc();
        tx.set(refundRef, {
          orderId,
          orderNumber: o.orderNumber ?? null,
          restaurantId: o.restaurantId ?? null,
          restaurantName: o.restaurantName ?? null,
          customerUid: customerUid || null,
          amount: refundAmt,
          reason,
          method,
          ...(plan ? { plan: JSON.parse(JSON.stringify(plan)) } : {}),
          status: viaGateway ? "pending_execution" : "completed",
          ...(viaGateway
            ? {
                razorpayPaymentId: paymentId,
                amountPaise: toPaise(refundAmt),
                onSuccessRefundStatus: isFullRefund ? "refunded" : "partial",
              }
            : {}),
          createdBy: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (method === "wallet" && customerUid && refundAmt > 0) {
          const userRef = db.collection("customer_users").doc(customerUid);
          tx.set(
            userRef,
            {
              walletBalance: admin.firestore.FieldValue.increment(refundAmt),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          tx.set(userRef.collection("wallet_transactions").doc(), {
            type: "credit",
            amount: refundAmt,
            title: "Order refund",
            description: reason,
            orderId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return { pendingApproval: false, refundAmt, customerUid, refundId: refundRef.id, viaGateway };
      });
      // Money moves only after the order change commits (external HTTP can't
      // run inside a transaction). The executor claims the refund atomically,
      // so a retried request never pays out twice.
      const execution = result.viaGateway ? await executeRazorpayRefund(result.refundId) : null;
      await audit(db, email, action, {
        orderId,
        ...result,
        reason,
        method,
        gatewayStatus: execution?.status ?? null,
        razorpayRefundId: execution?.razorpayRefundId ?? null,
      });
      return {
        ok: true,
        ...result,
        refundStatus: execution?.status ?? (result.pendingApproval ? "pending_approval" : "completed"),
        gatewayError: execution?.error ?? null,
      };
    }

    // Second admin approves a queued high-value refund → money actually moves.
    case "approveRefund": {
      const refundId = str(data.refundId, 128);
      if (!refundId) throw new HttpsError("invalid-argument", "refundId required.");
      const refundRef = db.collection("platform_refunds").doc(refundId);
      const result = await db.runTransaction(async (tx) => {
        const rSnap = await tx.get(refundRef);
        if (!rSnap.exists) throw new HttpsError("not-found", "Refund not found.");
        const r = rSnap.data() ?? {};
        if (r.status !== "pending_approval") {
          throw new HttpsError("failed-precondition", `Refund is already ${r.status}.`);
        }
        // Maker-checker: the approver must not be the person who requested it.
        if ((r.requestedBy ?? r.createdBy) === email) {
          throw new HttpsError("permission-denied", "You can't approve a refund you requested. A second admin must approve.");
        }
        const orderId = str(r.orderId, 128);
        const orderRef = db.collection("orders").doc(orderId);
        const oSnap = await tx.get(orderRef);
        const o = attachSettlement(oSnap.exists ? oSnap.data() ?? {} : {}, (await tx.get(financeRef(orderRef))).data());
        // An itemised request is planned again against the order as it is now,
        // so a refund made while this one waited can't be paid twice.
        const plan = r.refundRequest && typeof o.pricing?.engineVersion === "string"
          ? planFoodRefund(o.pricing as FoodQuote, r.refundRequest, refundHistoryOf(o))
          : null;
        if (plan?.problems.length) throw new HttpsError("failed-precondition", `${plan.problems.join(" ")} Reject this request instead.`);
        const refundAmt = plan ? plan.amountPaise / 100 : num(r.amount);
        const customerUid = str(r.customerUid, 128);
        const method = str(r.method, 32) || "wallet";
        const paid = num(o.total ?? o.totalAmount ?? o.payable, 0);
        const totalRefunded = Math.round((num(o.refundAmount, 0) + refundAmt) * 100) / 100;
        const isFullRefund = totalRefunded >= paid;
        if (o.refundStatus === "processing") {
          throw new HttpsError("failed-precondition", "A refund for this order is already being processed.");
        }
        const paymentId = str(o.razorpayPaymentId, 128);
        const viaGateway = method === "original" && refundAmt > 0 && o.refundStatus !== "refunded";
        if (viaGateway && !paymentId) {
          throw new HttpsError(
            "failed-precondition",
            "This order has no online payment to refund to. Reject this request and refund to the Kada wallet instead. Nothing was changed.",
          );
        }

        if (oSnap.exists && o.refundStatus !== "refunded") {
          tx.update(orderRef, {
            refundStatus: viaGateway ? "processing" : isFullRefund ? "refunded" : "partial",
            refundAmount: totalRefunded,
            ...(plan ? refundHistoryPatch(o, plan) : {}),
            refundReason: r.reason ?? "Admin refund",
            refundMethod: method,
            refundedAt: admin.firestore.FieldValue.serverTimestamp(),
            refundedBy: r.requestedBy ?? r.createdBy ?? email,
            approvedBy: email,
            // Only cancel on FULL refund — partials keep the vendor's
            // commission on the retained amount (see settlement generator).
            ...(isFullRefund && o.status !== "cancelled" ? { status: "cancelled" } : {}),
          });
        }
        tx.update(refundRef, {
          status: viaGateway ? "pending_execution" : "completed",
          ...(plan ? { amount: refundAmt, plan: JSON.parse(JSON.stringify(plan)) } : {}),
          approvedBy: email,
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(viaGateway
            ? {
                razorpayPaymentId: paymentId,
                amountPaise: toPaise(refundAmt),
                onSuccessRefundStatus: isFullRefund ? "refunded" : "partial",
              }
            : {}),
        });
        if (method === "wallet" && customerUid && refundAmt > 0 && o.refundStatus !== "refunded") {
          const userRef = db.collection("customer_users").doc(customerUid);
          tx.set(
            userRef,
            {
              walletBalance: admin.firestore.FieldValue.increment(refundAmt),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          tx.set(userRef.collection("wallet_transactions").doc(), {
            type: "credit",
            amount: refundAmt,
            title: "Order refund",
            description: r.reason ?? "Order refund",
            orderId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        return { refundAmt, customerUid, orderId, viaGateway };
      });
      const execution = result.viaGateway ? await executeRazorpayRefund(refundId) : null;
      await audit(db, email, action, {
        refundId,
        ...result,
        gatewayStatus: execution?.status ?? null,
        razorpayRefundId: execution?.razorpayRefundId ?? null,
      });
      return {
        ok: true,
        ...result,
        refundStatus: execution?.status ?? "completed",
        gatewayError: execution?.error ?? null,
      };
    }

    case "rejectRefund": {
      const refundId = str(data.refundId, 128);
      const reason = str(data.reason, 400) || "Rejected by approver";
      if (!refundId) throw new HttpsError("invalid-argument", "refundId required.");
      const refundRef = db.collection("platform_refunds").doc(refundId);
      await db.runTransaction(async (tx) => {
        const rSnap = await tx.get(refundRef);
        if (!rSnap.exists) throw new HttpsError("not-found", "Refund not found.");
        if (rSnap.data()?.status !== "pending_approval") {
          throw new HttpsError("failed-precondition", "Refund is not pending approval.");
        }
        tx.update(refundRef, {
          status: "rejected",
          rejectedBy: email,
          rejectionReason: reason,
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await audit(db, email, action, { refundId, reason });
      return { ok: true };
    }

    // A gateway refund that failed (network, gateway error) is money still owed
    // to the customer. Retrying re-runs the SAME refund record: the executor
    // claims it atomically, so two admins clicking at once can't pay twice.
    // "executing" is deliberately not retryable — the gateway may already have
    // accepted it, so that needs reconciliation against Razorpay, not a resend.
    case "retryRefund": {
      const refundId = str(data.refundId, 128);
      if (!refundId) throw new HttpsError("invalid-argument", "refundId required.");
      const rSnap = await db.collection("platform_refunds").doc(refundId).get();
      if (!rSnap.exists) throw new HttpsError("not-found", "Refund not found.");
      const r = rSnap.data() ?? {};
      if (r.status !== "failed") {
        throw new HttpsError(
          "failed-precondition",
          `Only failed refunds can be retried. This one is ${r.status ?? "unknown"}. Nothing was changed.`,
        );
      }
      if (!r.razorpayPaymentId || !(Number(r.amountPaise) > 0)) {
        throw new HttpsError(
          "failed-precondition",
          "This refund has no gateway payment to retry against. Refund to the Kada wallet instead. Nothing was changed.",
        );
      }
      const execution = await executeRazorpayRefund(refundId);
      await audit(db, email, action, {
        refundId,
        orderId: r.orderId ?? null,
        gatewayStatus: execution.status,
        razorpayRefundId: execution.razorpayRefundId ?? null,
      });
      return { ok: true, refundStatus: execution.status, gatewayError: execution.error ?? null };
    }

    // Refund a merchant's subscription purchase and take back the time it
    // bought (subscriptionBilling.refundSubscriptionOrder). Idempotent on the
    // purchase: a second click re-runs the same refund record.
    case "refundSubscription": {
      const razorpayOrderId = str(data.razorpayOrderId, 128);
      const reason = str(data.reason, 300);
      if (!razorpayOrderId || !reason) throw new HttpsError("invalid-argument", "razorpayOrderId and reason are required.");
      const { refundSubscriptionOrder } = await import("./subscriptionBilling");
      const out = await refundSubscriptionOrder({ razorpayOrderId, reason, requestedBy: email });
      await audit(db, email, action, { razorpayOrderId, reason, refundId: out.refundId, gatewayStatus: out.status });
      return { ok: true, refundStatus: out.status, gatewayError: out.error ?? null };
    }

    // Re-run a stored Razorpay webhook event. The queue trigger fires only on
    // create, so this is the only way to retry one that failed. Handlers are
    // idempotent: replaying an event already applied changes nothing.
    // Older pricing-engine orders still carry pricing.settlement (commission,
    // rider pay, Kada's revenue) on the customer-readable order. Move it to
    // orders/{id}/finance/pricing, and store the customer bill while at it.
    // 200 orders per call; dry run unless apply === true. Re-run until
    // `remaining` is 0. Idempotent: an order already moved isn't matched.
    case "sealOrderFinance": {
      const apply = data.apply === true;
      const snap = await db.collection("orders").orderBy("pricing.settlement.vendorPayoutPaise").limit(200).get();
      let moved = 0;
      if (apply && !snap.empty) {
        const batch = db.batch();
        for (const d of snap.docs) {
          const o = d.data();
          const q = o.pricing as FoodQuote;
          if (typeof q?.engineVersion !== "string" || !q.settlement) continue;
          batch.set(
            financeRef(d.ref),
            {
              ...JSON.parse(JSON.stringify(financeDoc(q, String(o.restaurantId ?? "")))),
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              movedFromOrder: true,
            },
            { merge: true },
          );
          batch.update(d.ref, {
            "pricing.settlement": admin.firestore.FieldValue.delete(),
            ...(o.bill ? {} : { bill: JSON.parse(JSON.stringify(customerBill(q))) }),
          });
          moved++;
        }
        await batch.commit();
      }
      const left = apply
        ? (await db.collection("orders").orderBy("pricing.settlement.vendorPayoutPaise").limit(1).get()).size
        : snap.size;
      await audit(db, email, action, { apply, moved, matched: snap.size });
      return { ok: true, apply, matched: snap.size, moved, remaining: apply ? left : snap.size };
    }

    case "replayWebhookEvent": {
      const eventId = str(data.eventId, 200);
      if (!eventId) throw new HttpsError("invalid-argument", "eventId required.");
      const ref = db.collection("razorpay_webhook_events").doc(eventId);
      if (!(await ref.get()).exists) throw new HttpsError("not-found", "Webhook event not found.");
      const { processWebhookEvent } = await import("./razorpayWebhook");
      let error: string | null = null;
      try {
        await processWebhookEvent(ref, { force: true });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      await audit(db, email, action, { eventId, error });
      return { ok: !error, error };
    }

    case "setBillingModel": {
      // Switch a merchant between the two ALTERNATIVE models. Commission and
      // subscription are mutually exclusive: a subscription merchant is charged
      // 0% commission on settlements from the next cycle onward.
      const kind = str(data.kind, 16); // "vendor" | "host"
      const id = str(data.id, 128);
      const model = str(data.model, 20) as BillingModel;
      if (!id) throw new HttpsError("invalid-argument", "id required.");
      if (!BILLING_MODELS.includes(model)) {
        throw new HttpsError("invalid-argument", "model must be commission or subscription.");
      }
      if (!["vendor", "host"].includes(kind)) {
        throw new HttpsError("invalid-argument", "kind must be vendor or host.");
      }
      const coll = kind === "host" ? "hotels" : "restaurants";
      const ref = db.collection(coll).doc(id);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Merchant not found.");
      const previous = (snap.data()?.billingModel ?? "commission").toString();

      await ref.set(
        {
          billingModel: model,
          billingModelUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          billingModelUpdatedBy: email,
        },
        { merge: true },
      );
      await audit(db, email, action, { kind, id, from: previous, to: model });
      return { ok: true, kind, id, from: previous, to: model };
    }

    case "setCommission": {
      const restaurantId = str(data.restaurantId, 128);
      const rate = num(data.rate);
      if (!restaurantId || rate < 0 || rate > 80) {
        throw new HttpsError("invalid-argument", "restaurantId and rate 0–80 required.");
      }
      await db.collection("restaurants").doc(restaurantId).set(
        {
          commissionRate: rate,
          platformCommission: rate,
          commissionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          commissionUpdatedBy: email,
        },
        { merge: true },
      );
      await audit(db, email, action, { restaurantId, rate });
      return { ok: true };
    }

    case "upsertMarket": {
      const id = str(data.id, 80);
      const name = str(data.name, 80);
      if (!name) throw new HttpsError("invalid-argument", "name required.");
      const ref = id
        ? db.collection("markets").doc(id)
        : db.collection("markets").doc();
      await ref.set(
        {
          name,
          slug: str(data.slug, 80) || name.toLowerCase().replace(/\s+/g, "-"),
          city: str(data.city, 80) || name,
          state: str(data.state, 80),
          country: str(data.country, 40) || "IN",
          lat: num(data.lat),
          lng: num(data.lng),
          serviceRadiusKm: num(data.serviceRadiusKm, 7),
          status: str(data.status, 32) || "active", // active | paused | coming_soon
          deliveryEnabled: data.deliveryEnabled !== false,
          stayEnabled: data.stayEnabled !== false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: email,
        },
        { merge: true },
      );
      await audit(db, email, action, { id: ref.id, name });
      return { ok: true, id: ref.id };
    }

    case "deleteMarket": {
      const id = str(data.id, 80);
      if (!id) throw new HttpsError("invalid-argument", "id required.");
      await db.collection("markets").doc(id).delete();
      await audit(db, email, action, { id });
      return { ok: true };
    }

    case "upsertZone": {
      const id = str(data.id, 80);
      const name = str(data.name, 80);
      if (!name) throw new HttpsError("invalid-argument", "name required.");
      const ref = id
        ? db.collection("demand_zones").doc(id)
        : db.collection("demand_zones").doc();
      await ref.set(
        {
          name,
          marketId: str(data.marketId, 80) || null,
          lat: num(data.lat),
          lng: num(data.lng),
          radiusKm: num(data.radiusKm, 2),
          surgeMultiplier: num(data.surgeMultiplier, 1),
          demand: str(data.demand, 32) || "normal",
          active: data.active !== false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: email,
        },
        { merge: true },
      );
      await audit(db, email, action, { id: ref.id, name });
      return { ok: true, id: ref.id };
    }

    case "deleteZone": {
      const id = str(data.id, 80);
      if (!id) throw new HttpsError("invalid-argument", "id required.");
      await db.collection("demand_zones").doc(id).delete();
      await audit(db, email, action, { id });
      return { ok: true };
    }

    case "moderateReview": {
      const restaurantId = str(data.restaurantId, 128);
      const reviewId = str(data.reviewId, 128);
      const status = str(data.status, 32); // published | hidden | flagged
      if (!restaurantId || !reviewId || !["published", "hidden", "flagged"].includes(status)) {
        throw new HttpsError("invalid-argument", "restaurantId, reviewId, status required.");
      }
      await db
        .collection("restaurants")
        .doc(restaurantId)
        .collection("reviews")
        .doc(reviewId)
        .set(
          {
            moderationStatus: status,
            hidden: status === "hidden",
            moderatedBy: email,
            moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      await audit(db, email, action, { restaurantId, reviewId, status });
      return { ok: true };
    }

    case "upsertHomeCollection": {
      const id = str(data.id, 80);
      const title = str(data.title, 120);
      if (!title) throw new HttpsError("invalid-argument", "title required.");
      const ref = id
        ? db.collection("home_collections").doc(id)
        : db.collection("home_collections").doc();
      await ref.set(
        {
          title,
          subtitle: str(data.subtitle, 200),
          kind: str(data.kind, 40) || "restaurants", // restaurants | cuisine | banner
          imageUrl: str(data.imageUrl, 2000),
          restaurantIds: Array.isArray(data.restaurantIds) ? data.restaurantIds.slice(0, 50) : [],
          cuisine: str(data.cuisine, 80),
          sortOrder: num(data.sortOrder, 100),
          active: data.active !== false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: email,
        },
        { merge: true },
      );
      await audit(db, email, action, { id: ref.id, title });
      return { ok: true, id: ref.id };
    }

    case "deleteHomeCollection": {
      const id = str(data.id, 80);
      if (!id) throw new HttpsError("invalid-argument", "id required.");
      await db.collection("home_collections").doc(id).delete();
      await audit(db, email, action, { id });
      return { ok: true };
    }

    case "upsertIncident": {
      const id = str(data.id, 80);
      const title = str(data.title, 160);
      if (!title) throw new HttpsError("invalid-argument", "title required.");
      const ref = id
        ? db.collection("ops_incidents").doc(id)
        : db.collection("ops_incidents").doc();
      await ref.set(
        {
          title,
          severity: str(data.severity, 24) || "minor", // minor | major | critical
          status: str(data.status, 24) || "investigating", // investigating | identified | monitoring | resolved
          impact: str(data.impact, 400),
          modules: Array.isArray(data.modules) ? data.modules : [],
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await audit(db, email, action, { id: ref.id, title });
      return { ok: true, id: ref.id };
    }

    case "upsertCancellationReason": {
      const id = str(data.id, 80);
      const label = str(data.label, 160);
      if (!label) throw new HttpsError("invalid-argument", "label required.");
      const ref = id
        ? db.collection("cancellation_reasons").doc(id)
        : db.collection("cancellation_reasons").doc();
      await ref.set(
        {
          label,
          audience: str(data.audience, 32) || "customer", // customer | vendor | rider | stay
          active: data.active !== false,
          sortOrder: num(data.sortOrder, 100),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await audit(db, email, action, { id: ref.id, label });
      return { ok: true, id: ref.id };
    }

    case "generateHostSettlements": {
      const hotels = await db.collection("hotels").limit(500).get();
      const generated: { settlementId: string; hotelId: string; netPayout: number }[] = [];
      const periodEnd = new Date();
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - 7);

      // Commission comes from the plan catalog — the single source of truth —
      // exactly as vendor settlements resolve it. It previously read
      // `data.commissionRate` (the ADMIN'S OWN REQUEST PAYLOAD) with a
      // hardcoded 15% fallback, so whoever pressed the button decided the
      // rate and the Plan Configuration screen was bypassed entirely. It also
      // silently disagreed with Dine, which defaults from
      // `config/platform.defaultCommissionPercent`.
      const stayCatalog = await readCatalog();
      const stayPlatformCfg = await db.collection("config").doc("platform").get();
      const defaultHostRate = Number(
        stayPlatformCfg.data()?.defaultStayCommissionPercent ??
          stayPlatformCfg.data()?.defaultCommissionPercent ??
          10,
      );

      for (const h of hotels.docs) {
        const bookings = await db.collection("hotels").doc(h.id).collection("bookings").limit(500).get();
        let gross = 0;
        let count = 0;
        const bookingIds: string[] = [];
        for (const b of bookings.docs) {
          const bd = b.data();
          const st = String(bd.status ?? "").toLowerCase();
          if (!["confirmed", "completed", "checked_out", "checkedout"].includes(st)) continue;
          if (bd.settlementId) continue;
          const amt = num(bd.amount ?? bd.total ?? bd.grandTotal, 0);
          if (amt <= 0) continue;
          gross += amt;
          count++;
          bookingIds.push(b.id);
        }
        if (count === 0) continue;
        // Precedence matches Dine: a bespoke per-property rate → their plan's
        // rate → the platform default. A property on a negotiated rate is
        // never overwritten by its plan.
        const hostResolved = commissionForMerchant(
          stayCatalog,
          "stay",
          h.data(),
          defaultHostRate,
        );
        // Per-property billing model: a subscription host pays a flat fee, so
        // commission is waived for them (previously charged unconditionally).
        const hostBilling = effectiveCommissionRate(h.data(), hostResolved.rate);
        const commissionRate = hostBilling.rate;
        const commissionAmount = Math.round(gross * (commissionRate / 100) * 100) / 100;
        const netPayout = Math.max(0, Math.round((gross - commissionAmount) * 100) / 100);
        const settlementRef = db.collection("host_settlements").doc();
        await settlementRef.set({
          settlementId: settlementRef.id,
          hotelId: h.id,
          hotelName: h.data()?.name ?? "Property",
          ownerId: h.id,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          grossSales: gross,
          bookingCount: count,
          commissionRate,
          ...billingAudit(hostBilling.model, hostResolved.rate, hostBilling.waived, hostBilling.lapsed),
          commissionSource: hostResolved.source,
          commissionAmount,
          netPayout,
          bookingIds,
          status: "pending",
          generatedBy: email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const batch = db.batch();
        bookingIds.forEach((id) => {
          batch.set(
            db.collection("hotels").doc(h.id).collection("bookings").doc(id),
            { settlementId: settlementRef.id },
            { merge: true },
          );
        });
        await batch.commit();
        generated.push({ settlementId: settlementRef.id, hotelId: h.id, netPayout });
      }
      await audit(db, email, action, { count: generated.length });
      return { ok: true, count: generated.length, settlements: generated };
    }

    case "settleHostPayout": {
      const settlementId = str(data.settlementId, 128);
      const utrNumber = str(data.utrNumber, 80);
      if (!settlementId) throw new HttpsError("invalid-argument", "settlementId required.");
      const ref = db.collection("host_settlements").doc(settlementId);
      const paid = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError("not-found", "Settlement not found.");
        if (snap.data()?.status === "paid") {
          throw new HttpsError("failed-precondition", "Already paid.");
        }
        tx.update(ref, {
          status: "paid",
          utrNumber: utrNumber || null,
          settledBy: email,
          settledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return snap.data()?.netPayout ?? 0;
      });
      await audit(db, email, action, { settlementId, paid });
      return { ok: true, paid };
    }

    case "grantAdmin": {
      const targetEmail = str(data.email, 120).toLowerCase();
      const role = str(data.role, 32) || "ops_manager";
      const createGoogle = !!data.createGoogleAccount;
      if (!targetEmail.includes("@")) {
        throw new HttpsError("invalid-argument", "Valid email required.");
      }
      let user;
      try {
        user = await admin.auth().getUserByEmail(targetEmail);
      } catch {
        throw new HttpsError("not-found", "No Firebase Auth user with that email. They must sign in once first.");
      }
      await admin.auth().setCustomUserClaims(user.uid, {
        platformAdmin: true,
        adminRole: role,
      });
      await db.collection("admin_team").doc(user.uid).set({
        email: targetEmail,
        role,
        uid: user.uid,
        grantedBy: email,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        active: true,
        googleWorkspace: createGoogle ? "pending" : "none",
      }, { merge: true });
      await audit(db, email, action, { targetEmail, role, createGoogleAccount: createGoogle });
      return { ok: true, uid: user.uid, googleWorkspacePending: createGoogle };
    }

    case "revokeAdmin": {
      const uid = str(data.uid, 128);
      if (!uid) throw new HttpsError("invalid-argument", "uid required.");
      await admin.auth().setCustomUserClaims(uid, { platformAdmin: false, adminRole: null });
      // Force off-boarding to take effect immediately: revoke refresh tokens so
      // the removed admin's existing session can't keep its stale admin claims
      // until natural expiry (up to 1h). Client re-auth then reflects no access.
      try {
        await admin.auth().revokeRefreshTokens(uid);
      } catch (e) {
        logger.warn(`revokeAdmin: token revoke failed for ${uid}`, e);
      }
      await db.collection("admin_team").doc(uid).set(
        {
          active: false,
          revokedBy: email,
          revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await audit(db, email, action, { uid });
      return { ok: true };
    }

    // ── Onboarding / KYC / activation ─────────────────────────────────
    case "transitionOnboarding": {
      const role = str(data.role, 20) as PartnerRole;
      const partnerId = str(data.partnerId, 128);
      const to = str(data.to, 40) as OnboardingState;
      const reason = str(data.reason, 500);
      // An override skips the mandatory-gate recheck. Restricted to the two
      // highest roles AND always recorded in the immutable timeline, so an
      // exception is deliberate and attributable rather than invisible.
      const wantsOverride = data.overrideGates === true;
      if (wantsOverride) {
        const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
        const r = (typeof claims.adminRole === "string" && claims.adminRole) || "super_admin";
        if (!["super_admin", "platform_admin"].includes(r)) {
          throw new HttpsError(
            "permission-denied",
            "Only super_admin or platform_admin may override activation gates.",
          );
        }
        if (!reason) {
          throw new HttpsError(
            "invalid-argument",
            "A written reason is required when overriding activation gates.",
          );
        }
      }
      if (!partnerId || !to) {
        throw new HttpsError("invalid-argument", "role, partnerId and to are required.");
      }

      // If activating an applicant not yet at ready_for_activation via admin override,
      // walk the legal state path so the state machine and timeline integrity are maintained.
      if (to === "active") {
        const snap = await db.collection(ROLE_COLLECTION[role]).doc(partnerId).get();
        if (snap.exists) {
          const ob = (snap.data()?.onboarding ?? {}) as Partial<OnboardingRecord>;
          const from: OnboardingState = isOnboardingState(ob.state) ? ob.state : "started";
          if (from !== "ready_for_activation" && from !== "active") {
            if (!wantsOverride) {
              throw new HttpsError(
                "failed-precondition",
                explainTransition(from, to),
              );
            }
            const path = pathToActive(from);
            let lastResult: any = null;
            for (const nextState of path) {
              lastResult = await transitionPartner({
                role,
                partnerId,
                to: nextState,
                actor: "admin",
                actorId: email,
                reason: nextState === "active" ? reason : `Admin override advance to ${nextState}`,
                overrideGates: true,
                metadata: { gateOverride: true },
              });
            }
            await audit(db, email, action, { role, partnerId, ...lastResult, override: true });
            return { ok: true, ...lastResult };
          }
        }
      }

      const result = await transitionPartner({
        role,
        partnerId,
        to,
        actor: "admin",
        actorId: email,
        reason: reason || undefined,
        overrideGates: wantsOverride,
        metadata: wantsOverride ? { gateOverride: true } : undefined,
      });
      await audit(db, email, action, { role, partnerId, ...result, override: wantsOverride });
      return { ok: true, ...result };
    }

    case "reviewOnboardingStep": {
      const role = str(data.role, 20) as PartnerRole;
      const partnerId = str(data.partnerId, 128);
      const stepId = str(data.stepId, 64);
      const decision = str(data.decision, 20); // "approved" | "rejected"
      const reason = str(data.reason, 500);

      if (!partnerId || !stepId || !["approved", "rejected"].includes(decision)) {
        throw new HttpsError(
          "invalid-argument",
          "role, partnerId, stepId and decision (approved|rejected) are required.",
        );
      }
      if (decision === "rejected" && !reason) {
        throw new HttpsError(
          "invalid-argument",
          "A rejection reason is required so the applicant knows what to fix.",
        );
      }

      const ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
      await ref.set(
        {
          onboarding: {
            stepReviews: {
              [stepId]: {
                decision,
                by: email,
                at: admin.firestore.FieldValue.serverTimestamp(),
                reason: reason || null,
              },
            },
            // A rejected step is no longer complete — the applicant must redo it.
            ...(decision === "rejected" ? { steps: { [stepId]: false } } : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          // A person's decision replaces the automatic verdict, so automatic
          // go-live counts an approval and the app shows a rejection as
          // "Fix" with the reason instead of "a person will confirm it".
          onboardingChecks: {
            documents: {
              [stepId]: {
                status: decision === "approved" ? "auto_verified" : "retake",
                issues: decision === "approved" ? [] : [reason],
                provider: "admin",
                reviewedBy: email,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
          },
        },
        { merge: true },
      );

      // A rejection bounces the whole application back to the applicant.
      if (decision === "rejected") {
        await transitionPartner({
          role,
          partnerId,
          to: "action_required",
          actor: "admin",
          actorId: email,
          reason: `Step "${stepId}" rejected: ${reason}`,
        }).catch((e) => logger.warn("reviewOnboardingStep: transition skipped", e));
      } else {
        // Approving the last flagged item takes the partner live on its own.
        await runAutoProgress(role, partnerId, `admin-review:${stepId}`).catch((e) =>
          logger.warn("reviewOnboardingStep: auto-progress skipped", e));
      }

      await audit(db, email, action, { role, partnerId, stepId, decision, reason });
      return { ok: true };
    }

    case "setBankVerification": {
      const role = str(data.role, 20) as PartnerRole;
      const partnerId = str(data.partnerId, 128);
      const to = str(data.state, 40) as BankVerificationState;
      const message = str(data.message, 500);
      const acceptMismatch = data.acceptMismatch === true;

      if (!partnerId || !BANK_STATE_VALUES.includes(to)) {
        throw new HttpsError(
          "invalid-argument",
          `role, partnerId and a valid state (${BANK_STATE_VALUES.join("|")}) are required.`,
        );
      }

      const ref = db.collection(ROLE_COLLECTION[role]).doc(partnerId);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Partner not found.");

      const bank = (snap.data()?.bank ?? {}) as { verificationState?: BankVerificationState; nameMatch?: { matched?: boolean } };
      const from = bank.verificationState ?? BANK_STATES.NOT_ADDED;
      if (!canTransitionBank(from, to)) {
        throw new HttpsError(
          "failed-precondition",
          `Illegal bank state transition "${from}" → "${to}".`,
        );
      }
      // Verifying over an unresolved name mismatch must be explicit, so a
      // reviewer can't rubber-stamp money into a third party's account.
      if (to === BANK_STATES.VERIFIED && bank.nameMatch?.matched === false && !acceptMismatch) {
        throw new HttpsError(
          "failed-precondition",
          "Holder name does not match the legal name. Re-check, or pass " +
            "acceptMismatch with a written reason to record the exception.",
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const waived = acceptMismatch && to === BANK_STATES.VERIFIED;
      const batch = db.batch();
      batch.set(
        ref,
        {
          bank: {
            verificationState: to,
            // A waived mismatch's reason tends to name the account holder, and
            // the partner doc is world-readable — it gets a neutral line.
            verificationMessage: waived
              ? "Verified by a reviewer after a manual check."
              : message || null,
            ...(to === BANK_STATES.VERIFIED ? { verifiedAt: now } : {}),
            updatedAt: now,
          },
        },
        { merge: true },
      );
      if (acceptMismatch) {
        // Who waved a mismatch through (an admin email) is audit data for the
        // private record, not for the public partner doc.
        batch.set(
          partnerPrivateRef(role, partnerId),
          {
            role,
            partnerId,
            ownerUids: ownerUidsOf(role, partnerId, snap.data()),
            bank: {
              mismatchAcceptedBy: email,
              mismatchAcceptedReason: message || null,
              mismatchAcceptedAt: now,
            },
            updatedAt: now,
          },
          { merge: true },
        );
      }
      await batch.commit();

      if (to === BANK_STATES.VERIFIED) {
        await setStepComplete(role, partnerId, "bank_verification", true, email).catch(() => {});
      }

      await audit(db, email, action, { role, partnerId, from, to, acceptMismatch, message });
      return { ok: true, from, to };
    }

    case "overrideOnboardingZone": {
      const role = str(data.role, 20) as PartnerRole;
      const partnerId = str(data.partnerId, 128);
      const zoneId = str(data.zoneId, 128);
      const zoneName = str(data.zoneName, 128);
      const marketId = str(data.marketId, 128);
      const reason = str(data.reason, 500);

      if (!partnerId || !zoneId) {
        throw new HttpsError("invalid-argument", "role, partnerId and zoneId are required.");
      }
      if (!reason) {
        throw new HttpsError(
          "invalid-argument",
          "A reason is required — zone overrides bypass the service-area check.",
        );
      }

      await db.collection(ROLE_COLLECTION[role]).doc(partnerId).set(
        {
          zoneId,
          ...(zoneName ? { zoneName } : {}),
          ...(marketId ? { marketId } : {}),
          zoneAssignment: "manual",
          onboarding: {
            zoneId,
            ...(zoneName ? { zoneName } : {}),
            marketId: marketId || null,
            zoneOverrideBy: email,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          serviceable: true,
        },
        { merge: true },
      );
      await setStepComplete(role, partnerId, "zone_assignment", true, email).catch(() => {});
      await setStepComplete(role, partnerId, "map_location", true, email).catch(() => {});
      await runAutoProgress(role, partnerId, "admin-zone").catch((e) =>
        logger.warn("overrideOnboardingZone: auto-progress skipped", e));
      await audit(db, email, action, { role, partnerId, zoneId, marketId, reason });
      return { ok: true };
    }

    case "setOnboardingRequirements": {
      // Admin-managed overrides consumed by the KYC rules engine. Shape:
      //   { vendor: { fssai: { mandatory: false } }, rider: { upi: { mandatory: true } } }
      const requirements = (data.requirements ?? {}) as Record<string, unknown>;
      await db.collection("config").doc("onboarding_requirements").set(
        { ...requirements, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: email },
        { merge: true },
      );
      await audit(db, email, action, { requirements });
      return { ok: true };
    }

    case "seedDefaultOps": {
      const reasons = [
        { label: "Changed my mind", audience: "customer" },
        { label: "Ordered by mistake", audience: "customer" },
        { label: "Rider taking too long", audience: "customer" },
        { label: "Restaurant closed / item unavailable", audience: "vendor" },
        { label: "Unable to reach customer", audience: "rider" },
        { label: "Guest cancelled stay", audience: "stay" },
      ];
      const batch = db.batch();
      reasons.forEach((r, i) => {
        const ref = db.collection("cancellation_reasons").doc();
        batch.set(ref, {
          ...r,
          active: true,
          sortOrder: i + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      await db.collection("config").doc("feature_flags").set(
        {
          groupOrdering: true,
          kadaGold: true,
          kadaStay: true,
          tableBooking: true,
          giftCards: true,
          cashOnDelivery: true,
          wallet: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await db.collection("config").doc("app_releases").set(
        {
          customerMinIos: "1.0.0",
          customerMinAndroid: "1.0.0",
          customerLatestIos: "1.0.0",
          customerLatestAndroid: "1.0.0",
          forceUpdate: false,
          storeUrlIos: "",
          storeUrlAndroid: "",
          releaseNotes: "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await db.collection("config").doc("loyalty").set(
        {
          earnPerHundred: 5,
          redeemValuePaise: 100,
          referralBonus: 50,
          referredBonus: 50,
          goldMonthlyPrice: 99,
          goldQuarterlyPrice: 249,
          goldYearlyPrice: 799,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await audit(db, email, action, {});
      return { ok: true };
    }

    case "resetVendorPassword": {
      const restaurantId = str(data.restaurantId, 128);
      if (!restaurantId) {
        throw new HttpsError("invalid-argument", "restaurantId is required.");
      }
      const mode = (str(data.mode, 32) || "generate_link") as "generate_link" | "set_password" | "send_email";
      const newPassword = typeof data.newPassword === "string" ? data.newPassword.trim() : "";
      const requestedEmail = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";

      // 1. Fetch restaurant doc
      const rDoc = await db.collection("restaurants").doc(restaurantId).get();
      if (!rDoc.exists) {
        throw new HttpsError("not-found", `Vendor with ID "${restaurantId}" does not exist.`);
      }
      const rData = rDoc.data() || {};
      const restaurantName = rData.name || "Vendor";

      // 2. Fetch partner_contact doc
      const cKey = `vendor_${restaurantId}`;
      const cDoc = await db.collection("partner_contact").doc(cKey).get();
      const cData = cDoc.exists ? cDoc.data() || {} : {};

      // 3. Resolve target email
      const candidateEmail = requestedEmail || cData.email || cData.ownerEmail || cData.outletEmail || rData.email || "";

      // 4. Resolve candidate Auth UIDs
      const candidateUids = [rData.ownerId, restaurantId].filter(Boolean) as string[];

      // 5. Locate existing Firebase Auth user
      let userRecord: admin.auth.UserRecord | null = null;
      for (const uid of candidateUids) {
        try {
          userRecord = await admin.auth().getUser(uid);
          if (userRecord) break;
        } catch {
          // not found by uid
        }
      }

      if (!userRecord && candidateEmail) {
        try {
          userRecord = await admin.auth().getUserByEmail(candidateEmail);
        } catch {
          // not found by email
        }
      }

      // 6. Handle case where user does not exist in Auth
      if (!userRecord) {
        if (mode === "set_password") {
          if (!candidateEmail) {
            throw new HttpsError("invalid-argument", "An email address is required to create and provision login credentials.");
          }
          if (!newPassword || newPassword.length < 6) {
            throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
          }
          try {
            userRecord = await admin.auth().createUser({
              uid: candidateUids[0] || restaurantId,
              email: candidateEmail,
              password: newPassword,
              displayName: restaurantName,
            });
          } catch (createErr: any) {
            try {
              userRecord = await admin.auth().createUser({
                email: candidateEmail,
                password: newPassword,
                displayName: restaurantName,
              });
            } catch (err2: any) {
              throw new HttpsError("internal", `Failed to provision vendor auth user: ${err2.message || createErr.message}`);
            }
          }

          // Link ownerId on restaurant and partner_contact
          const batch = db.batch();
          batch.set(
            db.collection("restaurants").doc(restaurantId),
            { ownerId: userRecord.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true },
          );
          batch.set(
            db.collection("partner_contact").doc(cKey),
            {
              role: "vendor",
              email: candidateEmail,
              ownerEmail: candidateEmail,
              ownerUid: userRecord.uid,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          await batch.commit();

          await audit(db, email, "resetVendorPassword", {
            restaurantId,
            mode,
            actionTaken: "provisioned_and_set_password",
            authUid: userRecord.uid,
            vendorEmail: candidateEmail,
          });

          return {
            ok: true,
            mode: "set_password",
            email: candidateEmail,
            message: `Created new login account and set password for ${restaurantName}.`,
          };
        } else {
          throw new HttpsError(
            "not-found",
            `No Firebase Auth account found for ${restaurantName} (${candidateEmail || "no email recorded"}). Use "Set Temporary Password" to provision their login credentials.`,
          );
        }
      }

      const targetEmail = userRecord.email || candidateEmail;
      if (!targetEmail) {
        throw new HttpsError("failed-precondition", "The vendor account has no registered email address.");
      }

      if (mode === "set_password") {
        if (!newPassword || newPassword.length < 6) {
          throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
        }
        await admin.auth().updateUser(userRecord.uid, { password: newPassword });
        // Revoke active sessions to prevent session hijacking
        await admin.auth().revokeRefreshTokens(userRecord.uid).catch(() => null);

        // Update partner contact if changed
        if (targetEmail && targetEmail !== cData.email) {
          await db.collection("partner_contact").doc(cKey).set(
            {
              role: "vendor",
              email: targetEmail,
              ownerEmail: targetEmail,
              ownerUid: userRecord.uid,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          ).catch(() => null);
        }

        await audit(db, email, "resetVendorPassword", {
          restaurantId,
          mode,
          authUid: userRecord.uid,
          vendorEmail: targetEmail,
        });

        return {
          ok: true,
          mode: "set_password",
          email: targetEmail,
          message: `Password updated successfully for ${restaurantName}. All active sessions have been revoked.`,
        };
      } else {
        // mode is "generate_link" or "send_email"
        const link = await admin.auth().generatePasswordResetLink(targetEmail);

        await audit(db, email, "resetVendorPassword", {
          restaurantId,
          mode,
          authUid: userRecord.uid,
          vendorEmail: targetEmail,
        });

        return {
          ok: true,
          mode,
          email: targetEmail,
          link,
          message: `Password reset link generated for ${targetEmail}.`,
        };
      }
    }

    case "setVendorStatus": {
      const restaurantId = str(data.restaurantId, 128);
      const isBlocked = Boolean(data.isBlocked);
      const reason = str(data.reason, 400);
      if (!restaurantId) {
        throw new HttpsError("invalid-argument", "restaurantId is required.");
      }
      await db.collection("restaurants").doc(restaurantId).set(
        {
          isBlocked,
          blockedReason: isBlocked ? (reason || "Suspended by platform administrator") : null,
          blockedAt: isBlocked ? admin.firestore.FieldValue.serverTimestamp() : null,
          blockedBy: isBlocked ? email : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // If blocked, also revoke refresh tokens for the owner if exists
      if (isBlocked) {
        const rDoc = await db.collection("restaurants").doc(restaurantId).get();
        const ownerId = rDoc.data()?.ownerId || restaurantId;
        try {
          await admin.auth().revokeRefreshTokens(ownerId);
        } catch {
          // ignore error
        }
      }

      await audit(db, email, "setVendorStatus", { restaurantId, isBlocked, reason });
      return { ok: true, isBlocked };
    }

    default:
      throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
  }
});
