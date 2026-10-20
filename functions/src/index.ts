// MUST be first: sets global function options (maxInstances) before any of the
// re-exported modules below define their functions. See options.ts.
import "./options";
import * as admin from "firebase-admin";
import nodemailer from "nodemailer";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";

admin.initializeApp();

// In-app purchase is gone. Kada Dine and Kada Host are B2B software sold
// directly to merchants, so subscriptions are bought on the web through
// Razorpay (`subscriptionBilling.ts`) and the mobile apps are pure entitlement
// clients. The Apple/Google receipt-validation endpoints that used to live
// here were deleted along with `iapVerify.ts`.

export { onOrderCompleted, awardLoyaltyPoints, redeemLoyaltyPoints, generateGstReport, createOutletAccount, provisionStaffAccount, revokeStaffAccount, requestVendorPayout } from "./operations";
export { generateMenuFromPromptOrImage, optimizeMenuItem, analyzeDailyOperations, getAiRecommendations, smartAiSearch, generateRecipe } from "./ai";
export { deleteTenantAccount, approveRider, rejectRider, suspendRider, settleRiderCash, settleRiderPayout, broadcastToCustomers, broadcastNotification, generateVendorSettlements, settleVendorPayout } from "./admin_operations";
export { adminPlatformAction } from "./admin_platform";
export {
  onOrderPlacedAssignRider,
  onOrderCancelledFreeRider,
  onOrderReleasedDispatch,
  acceptDeliveryOffer,
  declineDeliveryOffer,
  reassignExpiredOffers,
  resetDailyEarnings,
  resetWeeklyEarnings,
  resetMonthlyEarnings,
  completeDelivery,
  calculateDeliveryFee,
  requestRiderPayout,
  reassignDelivery,
  adminAssignRider,
  sweepStuckDeliveries,
  onOrderFinishedEnsureEarnings,
  dispatchDueScheduledOrders,
} from "./delivery";
export { releaseOrderForPickup, advanceDeliveryStage } from "./deliveryLifecycle";
// THE authoritative path for a restaurant to move an order (validated,
// idempotent, attributed; refunds a paid order on cancel/reject).
export { vendorTransitionOrder } from "./vendorOrders";
export { customerCancelOrder, expireUnpaidOnlineOrders, vetCustomerOrder } from "./customerOrders";
export { pricingAdmin, quoteFoodOrder } from "./pricing/callables";
export { placeFoodOrder } from "./pricing/placeOrder";
export { reconcilePricingDaily } from "./pricing/reconcile";
export { submitStayReview, deleteStayReview, replyToStayReview } from "./stayReviews";
export { quoteStayCancellation, cancelStayBooking } from "./stayCancellation";
export { onRiderChatMessage, onGuestConversationMessage } from "./chatNotifications";
export {
  quoteStayBooking,
  createStayBooking,
  verifyStayPayment,
  flagUnverifiedStayBooking,
  // Hands room-nights back on every cancellation path, not just the sweeper.
  onStayBookingClosedReleaseNights,
} from "./pricing/stayCallables";
export { getPlanCatalog, updatePlanCatalog } from "./planCatalog";
export { migrateLegacyTrials } from "./legacyTrialMigration";
// Service zones — the geographic source of truth (markets → zones → entities).
export {
  resolveZone,
  upsertServiceZone,
  deleteServiceZone,
  setEntityZone,
  backfillZones,
  onOrderStampZone,
  onRestaurantLocationChanged,
} from "./zones";
// Partner health scores + platform anomaly detection.
export { recomputeOpsHealth, refreshOpsHealth } from "./opsHealth";
// Changelog / release notes: authoring, engagement, scheduled publishing.
export { changelogAdmin, changelogEngage, publishDueChangelog } from "./changelog";
export { createSubscriptionOrder, getSubscriptionStatus } from "./subscriptionBilling";
export { createCodDepositOrder, getCodReconciliation } from "./codReconciliation";
export { aggregatorWebhook } from "./webhook";
export { subscribeDeviceToTopic } from "./messaging";
export { createRazorpayOrder, verifyRazorpayPayment } from "./payments";
export { createAdBoost } from "./ads";
export { getFinanceSummary } from "./finance";
export { getEarningsBreakdown } from "./earningsBreakdown";
export { onOrderDonation, disburseDonations } from "./donations";
export { onOrderDepleteStock } from "./inventory";
export { setAdminRole } from "./adminRoles";
// Centralised onboarding / KYC / activation engine (Dine, Delivery, Host, Mess).
export {
  getOnboardingState,
  submitOnboardingStep,
  submitOnboarding,
  submitBankDetails,
  resolveOnboardingZone,
  previewZone,
  getActivationBlockers,
  readKycDocument,
} from "./onboarding";
// MUST be run (dry-run first, then apply) BEFORE the activation gate can be
// trusted — legacy partners have no onboarding record and the gate is
// fail-closed, so they would otherwise all halt at once.
export { backfillOnboarding } from "./onboarding/backfill";
// Moves bank details, payout routing, PAN and owner contact off the publicly
// readable partner docs into partner_private / partner_contact. Dry run first.
export { sealPartnerPrivateData } from "./onboarding/partnerPrivateMigration";
// Guarantee every new partner doc gets an onboarding record (the gate is
// fail-closed, so a doc without one would be permanently stuck), and suspend
// anyone whose banking is revoked while live.
export {
  onVendorCreatedInitOnboarding,
  onRiderCreatedInitOnboarding,
  onHostCreatedInitOnboarding,
  onMessKitchenCreatedInitOnboarding,
  onVendorBankChanged,
  onRiderBankChanged,
  onHostBankChanged,
  onMessKitchenBankChanged,
} from "./onboarding/triggers";
// Nightly: suspend partners whose mandatory documents (FSSAI, insurance, PUC)
// have lapsed, and flag what expires within 30 days.
export { onboardingExpirySweep } from "./onboarding/expirySweep";
// Real bank verification — RazorpayX penny drop. The result (account live +
// bank-registered name matching the legal entity) is what promotes banking to
// `verified`, which is the gate every payout checks.
//
// BLOCKED on the same secret as disbursePayout below: the penny drop debits the
// RazorpayX SOURCE account, so RAZORPAY_ACCOUNT_NUMBER is required. Enable
// these together with the payout exports once it is set:
//   firebase functions:secrets:set RAZORPAY_ACCOUNT_NUMBER
//   firebase deploy --only functions:verifyBankAccount,functions:pollBankValidation,functions:getPayoutConfig,functions:disbursePayout
//
// Until then banking degrades exactly as designed: submitBankDetails still
// records the account as `pending_verification` (startBankValidation reads the
// secret through a try/catch, reports "not configured", and never claims
// success), and a finance admin verifies manually from Admin → Bank
// Verification. Nothing is ever auto-verified because automation was absent.
export { verifyBankAccount, pollBankValidation } from "./onboarding/bankValidation";
export { razorpayWebhook, processRazorpayWebhook } from "./razorpayWebhook";
// NOTE: getPayoutConfig & disbursePayout require the RAZORPAY_ACCOUNT_NUMBER
// secret (the RazorpayX source account). Re-enable this export and deploy the
// two functions once that secret is set:
//   firebase functions:secrets:set RAZORPAY_ACCOUNT_NUMBER
//   firebase deploy --only functions:getPayoutConfig,functions:disbursePayout
export { getPayoutConfig, disbursePayout } from "./payouts";
export { syncGatewaySettlements, scheduledGatewaySync, getReconciliationReport } from "./reconciliation";
export { onReviewWritten } from "./reviews";
export { hotelSubscriptionExpiryCron, aggregateHotelDailyAnalytics } from "./hotel";
export { onSupportMessageCreated, onHostAssistMessageCreated, onSupportAgentReply, escalateSupportThread, resolveSupportThread, rateSupportThread, slaSweep, seedSupportMacros } from "./support";
export { purchaseGiftCard, redeemGiftCard } from "./giftcards";
export { purchaseGoldMembership } from "./gold";
export { createWalletTopupOrder, verifyWalletTopup, payOrderWithWallet } from "./wallet";
export { geoLookup } from "./geo";
export { probeIntegrations } from "./integrationHealth";
export { getMyReferral, applyReferralCode, onReferralQualifyingOrder, approveReferralReward, reverseReferralReward } from "./referrals";
// Demo mode was removed from the product. `seedDemoData`/`clearDemoData` are no
// longer exported, so they cannot be invoked; the implementations stay in
// seed.ts only until the deployed functions are deleted.
export { syncFoodStudioPresets } from "./seed";
export {
  seedKnowledgeBase,
  createKbArticle,
  updateKbArticle,
  searchKbArticles,
  createTeam,
  assignAgentToThread,
  convertThreadToTicket,
  getAgentAiAssistant,
  reembedKbArticles,
  previewKbRetrieval,
} from "./support_kb";
export { processScheduledOrders } from "./scheduler";
export { onCustomerProfileLocationChanged } from "./customerProfile";

// --- Kada Mess (plans + subscriptions) ---
export {
  subscribeToMess,
  verifyMessPayment,
  skipMessDay,
  cancelMessSubscription,
  generateMessSettlements,
  sweepMessSubscriptions,
} from "./mess";

// --- Notification Engine ---
export {
  generateNotificationContent,
  generateMultiAppContent,
  recommendSchedule,
  generateCampaignPlan,
  translateNotificationContent
} from "./notificationEngine/aiEngine";
export { getAiAuditLog, listAiAuditLogs } from "./notificationEngine/aiAudit";
export {
  createCampaign,
  updateCampaign,
  submitForApproval,
  approveCampaign,
  cancelCampaign,
  duplicateCampaign,
  processScheduledCampaigns
} from "./notificationEngine/campaigns";
export {
  createTemplate,
  updateTemplate,
  publishTemplate,
  archiveTemplate
} from "./notificationEngine/templates";
export { onNotificationJobCreated, retryFailedNotifications } from "./notificationEngine/queue";

// Legacy notifications (to be migrated/replaced)
import { sendSystemNotification } from "./notifications";
import { isOrderHeld, orderReleased } from "./vendorOrderRules";
import { recordOrderDonation } from "./donations";
import { beginDeliveryForOrder } from "./delivery";
import { getRestaurantLocalDetails, getRestaurantDayRangeUtc, formatMoney, _getCurrencyCode } from "./utils";

const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");

function isCompletedStatus(status: any) {
  const s = (status ?? "").toString().toLowerCase();
  return ["completed", "done", "delivered", "paid"].includes(s);
}

function isValidEmail(email: string) {
  const e = (email || "").trim();
  if (!e) return false;
  // Basic sanity check; we don't need perfect RFC compliance.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function formatINR(n: number) {
  const v = Math.round(Number(n) || 0);
  return `₹${v.toLocaleString("en-IN")}`;
}

function isoDateIST(d: Date) {
  // Render YYYY-MM-DD in IST (UTC+5:30).
  const ist = new Date(d.getTime() + 330 * 60_000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function istDayRangeUtc(nowUtc: Date) {
  // Compute today's IST midnight range, expressed as UTC Dates.
  const istNow = new Date(nowUtc.getTime() + 330 * 60_000);
  const startIst = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0));
  const endIst = new Date(startIst.getTime() + 24 * 60 * 60_000);
  // Convert IST-midnight timestamps back to UTC by subtracting offset.
  return {
    startUtc: new Date(startIst.getTime() - 330 * 60_000),
    endUtc: new Date(endIst.getTime() - 330 * 60_000),
  };
}

async function buildDailySummary(restaurantId: string, startUtc: Date, endUtc: Date) {
  const ordersSnap = await admin
    .firestore()
    .collection("orders")
    .where("restaurantId", "==", restaurantId)
    .where("timestamp", ">=", startUtc)
    .where("timestamp", "<", endUtc)
    .orderBy("timestamp", "desc")
    .select("status", "total", "subtotal", "discount", "tax", "items")
    .get();

  const orders = ordersSnap.docs.map((d) => d.data());
  const completed = orders.filter((o) => isCompletedStatus((o as any).status));

  const net = completed.reduce((sum, o: any) => sum + (Number(o.total) || 0), 0);
  const gross = completed.reduce((sum, o: any) => sum + (Number(o.subtotal) || Number(o.total) || 0), 0);
  const discount = completed.reduce((sum, o: any) => sum + (Number(o.discount) || 0), 0);
  const tax = completed.reduce((sum, o: any) => sum + (Number(o.tax) || 0), 0);
  const ordersCount = completed.length;
  const units = completed.reduce((acc, o: any) => {
    const items = Array.isArray(o.items) ? o.items : [];
    return (
      acc +
      items.reduce((s: number, it: any) => {
        const q = it?.quantity ?? it?.qty ?? 1;
        const n = typeof q === "number" ? q : parseInt(q?.toString?.() ?? "1", 10);
        return s + (Number.isFinite(n) ? n : 1);
      }, 0)
    );
  }, 0);

  const topAgg = new Map<string, { qty: number; revenue: number }>();
  completed.forEach((o: any) => {
    const items = Array.isArray(o.items) ? o.items : [];
    items.forEach((it: any) => {
      const name = (it?.name ?? it?.title ?? "Item").toString();
      const q = it?.quantity ?? it?.qty ?? 1;
      const qty = typeof q === "number" ? q : parseInt(q?.toString?.() ?? "1", 10);
      const price = Number(it?.price) || 0;
      const prev = topAgg.get(name) ?? { qty: 0, revenue: 0 };
      prev.qty += Number.isFinite(qty) ? qty : 1;
      prev.revenue += (Number.isFinite(qty) ? qty : 1) * price;
      topAgg.set(name, prev);
    });
  });
  const topItems = Array.from(topAgg.entries())
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  return { net, gross, discount, tax, ordersCount, units, topItems };
}

function renderEmailHtml(params: {
  dateLabel: string;
  restaurantName: string;
  net: number;
  gross: number;
  discount: number;
  tax: number;
  ordersCount: number;
  units: number;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
}) {
  const itemsHtml = params.topItems
    .map(
      (it) => `
        <tr>
          <td style="padding:10px 0; border-bottom:1px solid #eee; font-weight:700;">${it.name}</td>
          <td style="padding:10px 0; border-bottom:1px solid #eee; text-align:right;">${it.qty}</td>
          <td style="padding:10px 0; border-bottom:1px solid #eee; text-align:right; font-weight:800;">${formatINR(it.revenue)}</td>
        </tr>
      `
    )
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif; background:#f6f7fb; padding:24px;">
    <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 12px 40px rgba(15,23,42,0.08);">
      <div style="background:#0f172a; color:#fff; padding:22px 24px;">
        <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; font-weight:800; color:#93c5fd;">The Kada</div>
        <div style="font-size:22px; font-weight:900; margin-top:6px;">Daily Summary</div>
        <div style="font-size:12px; font-weight:700; margin-top:6px; color:rgba(255,255,255,0.7);">${params.restaurantName} • ${params.dateLabel}</div>
      </div>

      <div style="padding:22px 24px;">
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          ${[
            { k: "Net Sales", v: formatINR(params.net) },
            { k: "Orders", v: params.ordersCount.toLocaleString("en-IN") },
            { k: "Units Sold", v: params.units.toLocaleString("en-IN") },
            { k: "Discounts", v: formatINR(params.discount) },
          ]
            .map(
              (m) => `
              <div style="flex:1 1 140px; border:1px solid #eef2f7; border-radius:14px; padding:14px;">
                <div style="font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#64748b; font-weight:900;">${m.k}</div>
                <div style="font-size:18px; font-weight:900; color:#0f172a; margin-top:6px;">${m.v}</div>
              </div>`
            )
            .join("")}
        </div>

        <div style="margin-top:18px; border:1px solid #eef2f7; border-radius:14px; padding:14px;">
          <div style="font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#64748b; font-weight:900;">Breakdown</div>
          <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:13px; color:#0f172a;">
            <div>Gross (Subtotal)</div><div style="font-weight:900;">${formatINR(params.gross)}</div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:13px; color:#0f172a;">
            <div>Tax</div><div style="font-weight:900;">${formatINR(params.tax)}</div>
          </div>
        </div>

        <div style="margin-top:18px;">
          <div style="font-size:12px; font-weight:900; letter-spacing:0.18em; text-transform:uppercase; color:#0f172a;">Top Items</div>
          <table style="width:100%; border-collapse:collapse; margin-top:10px;">
            <thead>
              <tr>
                <th style="text-align:left; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#64748b; padding:8px 0;">Item</th>
                <th style="text-align:right; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#64748b; padding:8px 0;">Qty</th>
                <th style="text-align:right; font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:#64748b; padding:8px 0;">Revenue</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml || `<tr><td colspan="3" style="padding:12px 0; color:#64748b;">No completed orders.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div style="margin-top:22px; padding-top:14px; border-top:1px solid #eef2f7; color:#64748b; font-size:11px;">
          Sent by The Kada • Reply to this email for support.
        </div>
      </div>
    </div>
  </div>`;
}

export const sendDailySummary = onSchedule(
  {
    schedule: "0 * * * *", // Run hourly
    secrets: [GMAIL_APP_PASSWORD],
  },
  async () => {
    const now = new Date();
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "thekadaapp@gmail.com",
        pass: GMAIL_APP_PASSWORD.value(),
      },
    });

    const restaurantsSnap = await admin.firestore().collection("restaurants").get();

    for (const r of restaurantsSnap.docs) {
      const data = r.data() as any;
      const restaurantId = r.id;
      const restaurantName = (data?.name ?? "Restaurant").toString();
      const supportEmail = (data?.supportEmail ?? "").toString().trim();
      const enabled = data?.dailySummaryEnabled !== false;

      if (!enabled) continue;
      if (!isValidEmail(supportEmail)) continue;

      const timeZone = data?.timezone || "Asia/Kolkata";
      const { hour, dateString } = getRestaurantLocalDetails(now, timeZone);

      // Only execute at hour 23 (11:00 PM) local time
      if (hour !== 23) continue;

      // Prevent double run for the same date
      if (data?.lastDailySummaryDate === dateString) continue;

      try {
        const { startUtc, endUtc } = getRestaurantDayRangeUtc(dateString, timeZone);
        const summary = await buildDailySummary(restaurantId, startUtc, endUtc);

        // Skip empty days to reduce noise.
        if (summary.ordersCount === 0) continue;

        // Save popular items for public menu recommendations (analytics)
        await admin
          .firestore()
          .collection("restaurants")
          .doc(restaurantId)
          .collection("public_analytics")
          .doc("popular")
          .set({
            items: summary.topItems,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            dateLabel: dateString,
          }, { merge: true });

        const html = renderEmailHtml({
          dateLabel: dateString,
          restaurantName,
          ...summary,
        });

        const currencyCode = data?.currencyCode || (data?.currency ? _getCurrencyCode(data.currency) : "INR");

        await transporter.sendMail({
          from: `"The Kada" <thekadaapp@gmail.com>`,
          to: supportEmail,
          subject: `The Kada Daily Summary • ${dateString} • ${restaurantName}`,
          html,
          text: `Daily Summary (${dateString})\n${restaurantName}\nNet Sales: ${formatMoney(summary.net, currencyCode)}\nOrders: ${summary.ordersCount}\nUnits: ${summary.units}\nDiscounts: ${formatMoney(summary.discount, currencyCode)}\n`,
        });

        // Record successful daily summary execution date to avoid duplicate runs
        await admin.firestore().collection("restaurants").doc(restaurantId).update({
          lastDailySummaryDate: dateString,
        });
      } catch (err) {
        console.error(`Failed to process daily summary for ${restaurantId}:`, err);
      }
    }
  }
);

export const revokeSession = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new Error("unauthenticated");
  }

  const sid = (request.data?.sessionId ?? "").toString();
  if (!sid) throw new Error("Missing sessionId");

  const uid = request.auth.uid;
  
  // Verify it belongs to the user
  const docRef = admin.firestore().collection("user_sessions").doc(`${uid}_${sid}`);
  const doc = await docRef.get();
  
  if (doc.exists && doc.data()?.restaurantId === uid) {
    await docRef.delete();
    return { ok: true };
  }

  throw new Error("Session not found or unauthorized");
});

export const revokeAllSessions = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new Error("unauthenticated");
  }

  const uid = request.auth.uid;

  // Best-effort cleanup of UI session list.
  const sessionsSnap = await admin
    .firestore()
    .collection("user_sessions")
    .where("restaurantId", "==", uid)
    .get();

  const batch = admin.firestore().batch();
  sessionsSnap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  // Revoke refresh tokens last to ensure they can't immediately recreate sessions
  await admin.auth().revokeRefreshTokens(uid);

  return { ok: true };
});


export const notifyVendorNewOrder = onDocumentCreated({ document: "orders/{orderId}", maxInstances: 3 }, async (event) => {
  const data = event.data?.data() as Record<string, any> | undefined;
  if (!data) return;

  const restaurantId = (data.restaurantId ?? "").toString();
  const hotelId = (data.hotelId ?? "").toString();
  if (!restaurantId && !hotelId) return;

  // Don't notify on draft/abandoned orders
  const status = (data.status ?? "").toString().toLowerCase();
  if (status === "draft" || status === "cancelled") return;
  // A held order isn't real yet: an online order before its payment lands, or
  // a cash order before its pricing check. A failed payment used to alarm the
  // kitchen for food nobody bought. onOrderPaymentConfirmed alerts it on release.
  if (isOrderHeld(data)) return;

  // ── Handle Hotel Room Service Order ───────────────────────────────────────
  if (hotelId && !restaurantId) {
    const roomNumber = data.roomNumber ?? data.room ?? "Room";
    const items = Array.isArray(data.items) ? data.items : [];
    const countLabel = items.length;
    const total = Number(data.total ?? data.totalAmount ?? 0) || 0;
    const title = `New Order — Room ${roomNumber}`;
    const body = `${countLabel} item${countLabel === 1 ? "" : "s"} • ₹${total}`;

    try {
      await admin.messaging().send({
        topic: `hotel_${hotelId}`,
        notification: { title, body },
        data: {
          orderId: event.params.orderId,
          hotelId,
          roomNumber: String(roomNumber),
          type: "new_order",
        },
        android: { priority: "high", notification: { channelId: "kadastay_orders" } },
      });
      const hotelSnap = await admin.firestore().collection("hotels").doc(hotelId).get();
      if (hotelSnap.exists) {
        const ownerId = hotelSnap.data()?.ownerId;
        if (ownerId) {
          const tokenSnap = await admin.firestore().collection("fcm_tokens").doc(ownerId).get();
          if (tokenSnap.exists && tokenSnap.data()?.token) {
            await admin.messaging().send({
              token: tokenSnap.data()!.token,
              notification: { title, body },
              data: {
                orderId: event.params.orderId,
                hotelId,
                roomNumber: String(roomNumber),
                type: "new_order",
              },
              android: { priority: "high", notification: { channelId: "kadastay_orders" } },
            });
          }
        }
      }
    } catch (e) {
      console.error("Hotel room service notification failed:", e);
    }
    return;
  }

  await notifyVendorOfNewOrder(event.params.orderId, data);
});

/** The kitchen alert for a new restaurant order (push + in-app notification). */
async function notifyVendorOfNewOrder(orderId: string, data: Record<string, any>): Promise<void> {
  const restaurantId = (data.restaurantId ?? "").toString();
  if (!restaurantId) return;

  const orderSource = (data.orderSource ?? data.source ?? "").toString().toLowerCase();
  const orderType = (data.orderType ?? data.type ?? "").toString().toLowerCase();
  const orderNumber = (data.orderNumber ?? "").toString();
  
  // Prefer tableLabel if it's already a non-ID string, otherwise use table or tableLabel
  const rawTable = (data.table ?? "").toString();
  const rawTableLabel = (data.tableLabel ?? "").toString();
  
  const isQr =
    orderSource === "qr_menu" ||
    orderSource === "qr" ||
    orderNumber.startsWith("QR-") ||
    rawTableLabel.toLowerCase().includes("qr") ||
    rawTable.toLowerCase().includes("qr");

  const isDelivery =
    orderSource === "delivery_app" ||
    orderSource === "web_delivery" ||
    orderType === "delivery" ||
    orderNumber.startsWith("DEL-");

  const isTakeaway =
    orderSource === "takeaway" ||
    orderType === "takeaway" ||
    orderType === "pickup" ||
    orderNumber.startsWith("TAK-");

  // Resolve table name for dine-in/QR orders
  let tableDisplayName = rawTableLabel || rawTable || (isDelivery ? "Delivery" : isTakeaway ? "Takeaway" : "Dine-in");
  
  if (rawTable && (!rawTableLabel || rawTableLabel === rawTable) && rawTable !== "QR Order" && !isDelivery && !isTakeaway) {
    try {
      const tableDoc = await admin.firestore().collection("tables").doc(rawTable).get();
      if (tableDoc.exists) {
        const tData = tableDoc.data();
        tableDisplayName = tData?.name ?? tData?.label ?? tableDisplayName;
      }
    } catch (e) {
      console.error("Error resolving table name:", e);
    }
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const itemCount = items.reduce((sum, it) => {
    const q = it?.quantity ?? it?.qty ?? 1;
    const n = typeof q === "number" ? q : parseInt(q?.toString?.() ?? "1", 10);
    return sum + (Number.isFinite(n) ? n : 1);
  }, 0);

  const total = Number(data.total ?? data.totalAmount ?? 0) || 0;
  const countLabel = itemCount || items.length || 0;
  
  let title = "New Order";
  let body = "";

  if (isQr) {
    title = "New QR Order";
    body = `${tableDisplayName} • ${countLabel} item${countLabel === 1 ? "" : "s"} • ${formatINR(total)}`;
  } else if (isDelivery) {
    title = "New Delivery Order 🛵";
    const customerName = (data.customerName ?? data.userName ?? "Customer").toString();
    body = `${customerName} • ${countLabel} item${countLabel === 1 ? "" : "s"} • ${formatINR(total)}`;
  } else if (isTakeaway) {
    title = "New Takeaway Order 🛍️";
    const customerName = (data.customerName ?? data.userName ?? "Customer").toString();
    body = `${customerName} • ${countLabel} item${countLabel === 1 ? "" : "s"} • ${formatINR(total)}`;
  } else {
    title = "New Online Order";
    body = `${tableDisplayName} • ${countLabel} item${countLabel === 1 ? "" : "s"} • ${formatINR(total)}`;
  }

  const itemsPreview = items
    .slice(0, 4)
    .map((it: any) => {
      const name = (it?.name ?? it?.title ?? "Item").toString();
      const q = it?.quantity ?? it?.qty ?? 1;
      const qty = typeof q === "number" ? q : parseInt(q?.toString?.() ?? "1", 10);
      return `${name} x${Number.isFinite(qty) ? qty : 1}`;
    })
    .join(", ");

  await sendSystemNotification({
    restaurantId,
    title,
    message: body,
    severity: "high",
    source: isQr ? "qr_menu" : isDelivery ? "delivery" : isTakeaway ? "takeaway" : "online",
    metadata: {
      // Routes the push to the dedicated new-order channel and sound in
      // onNotificationCreated. Same marker room-service orders already use.
      type: "new_order",
      orderId: orderId,
      orderNumber,
      table: tableDisplayName,
      itemCount: countLabel,
      total,
      itemsPreview,
      orderSource,
      orderType,
    }
  });
}

/**
 * A held order goes live when its online payment lands (verifyRazorpayPayment,
 * the Razorpay webhook, payOrderWithWallet) or its pricing check passes
 * (vetCustomerOrder, for cash orders): alert the kitchen, start delivery and
 * record any donation then. Fires once, on that release (see orderReleased).
 */
export const onOrderPaymentConfirmed = onDocumentUpdated(
  { document: "orders/{orderId}", maxInstances: 3 },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (!orderReleased(before, after)) return;
    await notifyVendorOfNewOrder(event.params.orderId, after);
    await beginDeliveryForOrder(event.data!.after.ref, event.params.orderId, after);
    await recordOrderDonation(event.params.orderId, after);
  },
);

export const notifyReservationBooking = onDocumentCreated("reservations/{reservationId}", async (event) => {
  const data = event.data?.data() as Record<string, any> | undefined;
  if (!data) return;

  const restaurantId = (data.restaurantId ?? "").toString();
  if (!restaurantId) return;

  const source = (data.source ?? "").toString().toLowerCase();
  // Skip notifications for reservations manually added via the dashboard
  if (source === "dashboard") return;

  const guestName = (data.guestName ?? "Guest").toString();
  const guestPhone = (data.guestPhone ?? "").toString();
  const guestCount = Number(data.guestCount) || 2;
  const reservationDate = (data.reservationDate ?? "").toString();
  const reservationTime = (data.reservationTime ?? "").toString();
  const tableName = (data.tableName ?? "Auto-assign").toString();

  const body = `${guestCount} guests • ${reservationDate} at ${reservationTime} • Table: ${tableName}`;

  await sendSystemNotification({
    restaurantId,
    title: "New Table Booking",
    message: `${guestName} (${guestPhone})`,
    severity: "info",
    source: "reservation",
    metadata: {
      reservationId: event.params.reservationId,
      guestName,
      guestPhone,
      guestCount,
      reservationDate,
      reservationTime,
      tableName,
      source: data.source ?? "",
    }
  });
});

export const onNotificationCreated = onDocumentCreated(
  "restaurants/{restaurantId}/notifications/{notificationId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    // Already pushed straight to the owner's devices (e.g. onboarding updates).
    if (data.pushSent === true) return;

    const restaurantId = event.params.restaurantId;
    const title = (data.title || "New Notification").toString();
    const message = (data.message || data.body || "").toString();
    const source = (data.source || "system").toString();
    const severity = (data.severity || "info").toString();
    const metadata = data.metadata || null;

    try {
      const fcmData: Record<string, string> = {
        restaurantId,
        source,
        severity,
      };

      if (metadata) {
        for (const [key, val] of Object.entries(metadata)) {
          if (val !== undefined && val !== null) {
            fcmData[key] = String(val);
          }
        }
      }

      // New orders ring with their own sound on a dedicated channel, so a
      // locked phone doesn't sound like every other notice. Everything else
      // keeps the default. A device without the channel or sound yet (an older
      // app build) falls back to the default channel and sound, so this
      // degrades safely rather than dropping the push.
      const isNewOrder =
        !!metadata && (metadata as Record<string, unknown>).type === "new_order";

      await admin.messaging().send({
        topic: `restaurant_${restaurantId}`,
        notification: {
          title,
          body: message,
        },
        data: fcmData,
        apns: {
          payload: {
            aps: {
              sound: isNewOrder ? "new_order.wav" : "default",
              badge: 1,
            },
          },
        },
        android: {
          // High priority wakes the device from Doze so the order isn't held
          // back until the next maintenance window.
          priority: isNewOrder ? "high" : undefined,
          notification: {
            channelId: isNewOrder ? "new_orders" : "high_importance_channel",
            sound: isNewOrder ? "new_order" : "default",
          },
        },
      });
      console.log(`Successfully broadcasted notification to topic restaurant_${restaurantId}`);
    } catch (error) {
      console.error("FCM broadcast failed for system notification:", error);
    }
  }
);


export * from "./staySearch";
export * from "./stayAvailability";
export * from "./stayRecommendations";
export * from "./stayIndexer";

// Kada Communications — centralized email/comms platform (see src/comms).
export * from "./comms";

export { fixRiderEarnings } from "./fixEarnings";
