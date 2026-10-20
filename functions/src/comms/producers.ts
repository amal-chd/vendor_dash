/**
 * Transactional producers. Business events → `enqueueEmail` (never the provider
 * directly, never blocking the user's API call). This wires the flagship,
 * highest-volume flow — customer order lifecycle emails — end to end. Other
 * producers (vendor/rider approval, subscription, support) call `enqueueEmail`
 * from their existing functions the same way; see COMMS.md.
 */

import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { enqueueEmail, COMMS_SECRETS } from "./queue";
import { ensureProfile } from "./profiles";
import { isOrderHeld, orderReleased } from "../vendorOrderRules";

const DELIVERED = new Set(["delivered", "completed"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

/** Map an order (creation / status change) to a template + category. */
function templateFor(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData
): { key: string; type: string } | null {
  const prevStatus = (before?.status || "").toString().toLowerCase();
  const status = (after.status || "").toString().toLowerCase();
  // Confirm only a real order: an unpaid or unpriced one used to get an
  // "order confirmed" email even if it never went through.
  if (!before) return isOrderHeld(after) ? null : { key: "order_confirmation", type: "ORDER_CONFIRMATION" };
  if (orderReleased(before, after)) return { key: "order_confirmation", type: "ORDER_CONFIRMATION" };
  if (status === prevStatus) return null; // no status change → nothing to send
  if (DELIVERED.has(status)) return { key: "order_delivered", type: "ORDER_DELIVERED" };
  if (CANCELLED.has(status)) return { key: "order_cancelled", type: "ORDER_CANCELLED" };
  return null;
}

export const onOrderEmail = onDocumentWritten(
  { document: "orders/{orderId}", secrets: COMMS_SECRETS },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return; // deletion — nothing to email
    const before = event.data?.before?.data();
    const mapping = templateFor(before, after);
    if (!mapping) return;

    const orderId = event.params.orderId as string;
    const customerUid = (after.customerUid || after.customerId || "").toString();
    if (!customerUid) return;

    // Resolve the customer's email from the canonical record (not duplicated).
    const userSnap = await admin.firestore().collection("customer_users").doc(customerUid).get();
    const user = userSnap.data() || {};
    const email = (user.email || "").toString().trim().toLowerCase();
    if (!email) return; // phone-only account — no email channel

    // Keep a light comms profile in sync (cheap, idempotent).
    await ensureProfile(customerUid, "CUSTOMER", {
      email,
      displayName: (user.name || user.displayName || "").toString(),
      language: (user.language || "en").toString(),
      source: "order",
    }).catch(() => {});

    await enqueueEmail({
      eventId: `order_${orderId}_${mapping.key}`, // idempotent — never sends twice
      type: mapping.type,
      category: "orders",
      to: email,
      userId: customerUid,
      userType: "CUSTOMER",
      templateKey: mapping.key,
      data: {
        firstName: (user.name || user.displayName || "there").toString().split(" ")[0],
        orderId,
        vendorName: (after.restaurantName || after.outletName || "your restaurant").toString(),
        orderTotal: Math.round(Number(after.totalAmount || after.total || 0)),
        amount: Math.round(Number(after.totalAmount || after.total || 0)),
        itemsCount: Array.isArray(after.items) ? after.items.length : 0,
        trackUrl: `https://thekada.in/orders/${orderId}`,
      },
    });
  }
);
