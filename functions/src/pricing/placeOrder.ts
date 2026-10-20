/**
 * `placeFoodOrder`: the server creates a customer's food order from a quote.
 *
 * The client never writes a price. It sends the quote id it was shown, and
 * the server:
 *   1. re-prices the same cart now (menu, rules and coupon may have changed),
 *   2. refuses with the NEW total if it differs from what was shown,
 *   3. creates the order with the full price snapshot, legacy rupee fields for
 *      older app builds, a server order number and promo usage counters, all in
 *      one transaction, idempotent on the client's key.
 *
 * The snapshot never changes after this. Later rule changes affect new quotes
 * only.
 */
import * as admin from "firebase-admin";
import { moduleEnabled } from "../featureFlags";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { enforceRateLimit } from "../rateLimit";
import { HOT_PATH } from "../options";
import { quoteFood, type FoodQuote } from "./food";
import { buildFoodQuoteInput, type FoodCartRequest } from "./foodLoader";
import { customerView } from "./callables";
import { paiseToRupees } from "./money";
import { customerBill } from "./bill";
import { financeDoc, financeRef, publicSnapshot } from "./orderFinance";

const str = (v: unknown, max = 200) => (v ?? "").toString().trim().slice(0, max);
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));
const SCHEDULE_MIN_LEAD_MS = 30 * 60_000;

function legacyOrderItems(q: FoodQuote, cart: FoodCartRequest) {
  return q.lines.map((l, i) => ({
    menuItemId: l.menuItemId,
    name: l.name,
    // Unit price including add-ons, in rupees — what vendor and rider apps read.
    price: paiseToRupees(l.unitPaise + l.modifierUnitPaise),
    qty: l.qty,
    quantity: l.qty,
    selectedVariant: cart.items[i]?.selectedVariant ?? null,
    selectedAddons: cart.items[i]?.selectedAddons ?? [],
  }));
}

export const placeFoodOrder = onCall({ ...HOT_PATH }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to place an order.");
  await enforceRateLimit(`place_food_${uid}`, 20, 10 * 60_000);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const quoteId = str(data.quoteId, 128);
  const idempotencyKey = str(data.idempotencyKey, 80);
  const paymentMethod = str(data.paymentMethod, 20).toLowerCase();
  if (!quoteId || !idempotencyKey) throw new HttpsError("invalid-argument", "quoteId and idempotencyKey are required.");
  if (!["cod", "razorpay", "wallet"].includes(paymentMethod)) {
    throw new HttpsError("invalid-argument", "Choose cash on delivery, online payment or wallet.");
  }
  const customerName = str(data.customerName, 80) || "Guest";
  const customerPhone = str(data.customerPhone, 20);
  if (customerPhone.replace(/\D/g, "").length < 8) {
    throw new HttpsError("invalid-argument", "Add a valid phone number so the restaurant and rider can reach you.");
  }
  const instructions = str(data.instructions, 500);
  const scheduledForMs = data.scheduledFor == null ? null : Number(data.scheduledFor);
  if (scheduledForMs != null && (!Number.isFinite(scheduledForMs) || scheduledForMs < Date.now() + SCHEDULE_MIN_LEAD_MS)) {
    throw new HttpsError("invalid-argument", "Scheduled orders need a slot at least 30 minutes from now.");
  }

  const db = admin.firestore();
  const placementRef = db.collection("order_placements").doc(`${uid}_${idempotencyKey}`);
  const quoteRef = db.collection("pricing_quotes").doc(quoteId);

  // These two reads do not depend on each other, and the customer is staring at
  // a spinner while they run. Firestore is still in nam5 while this function
  // runs in Mumbai, so each round trip measures 400-1100 ms — doing them in
  // sequence spent a second of someone's checkout for nothing. The replay path
  // now pays one extra read, which is the rare case.
  const [existing, quoteSnap] = await Promise.all([placementRef.get(), quoteRef.get()]);

  if (existing.exists) {
    const e = existing.data() ?? {};
    return { ok: true, idempotent: true, orderId: e.orderId, orderNumber: e.orderNumber, totalPaise: e.totalPaise };
  }

  const stored = quoteSnap.data();
  if (!quoteSnap.exists || stored?.uid !== uid || stored?.kind === "stay") throw new HttpsError("not-found", "This checkout has expired. Review your cart again.");
  if (stored.usedByOrderId) throw new HttpsError("failed-precondition", "This checkout was already used to place an order.");
  if ((stored.expiresAt?.toMillis?.() ?? 0) < Date.now()) {
    throw new HttpsError("failed-precondition", "This checkout has expired. Review your cart again to see the current total.");
  }

  // Re-price now. What the customer saw must still be true.
  const cart = stored.cart as FoodCartRequest;

  // The restaurant document is needed below and depends only on the cart, so it
  // is fetched alongside the re-price rather than after it. Repricing problems
  // are still raised before anything reads the restaurant, so the order of
  // errors the customer sees is unchanged.
  const [quoteInput, restaurantSnap] = await Promise.all([
    buildFoodQuoteInput(uid, { ...cart, at: undefined }),
    db.collection("restaurants").doc(cart.restaurantId).get(),
  ]);
  const { input, rules, problems } = quoteInput;
  const quote = quoteFood(input, rules);
  quote.problems = [...new Set([...problems, ...quote.problems])];
  if (quote.problems.length) throw new HttpsError("failed-precondition", quote.problems.join(" "), { quote: customerView(quote) });
  if (cart.couponCode && quote.couponProblem) {
    throw new HttpsError("failed-precondition", quote.couponProblem, { quote: customerView(quote) });
  }
  const shownTotal = Number(stored.quote?.totals?.totalPaise);
  if (quote.totals.totalPaise !== shownTotal) {
    throw new HttpsError(
      "failed-precondition",
      `Your total changed from ₹${(shownTotal / 100).toFixed(2)} to ₹${(quote.totals.totalPaise / 100).toFixed(2)}. Please review before placing the order.`,
      { quote: customerView(quote), reason: "price_changed" },
    );
  }

  if (paymentMethod === "cod") {
    // Same switch the app shows: Feature Flags first, Platform Settings as
    // the fallback (featureFlags.ts). Reading only Platform Settings let the
    // two disagree.
    if (!(await moduleEnabled("cashOnDelivery"))) throw new HttpsError("failed-precondition", "Cash on delivery isn't available right now. Pay online or with your wallet.");
  }

  const r = restaurantSnap.data() ?? {};
  const address = (data.address ?? {}) as Record<string, unknown>;
  const isPickup = cart.fulfilment === "pickup";
  const t = quote.totals;

  const orderRef = db.collection("orders").doc();
  const counterRef = db.collection("restaurants").doc(cart.restaurantId).collection("meta").doc("orderCounter");
  const now = admin.firestore.FieldValue.serverTimestamp();

  const result = await db.runTransaction(async (tx) => {
    const [placement, counter, freshQuote] = await Promise.all([tx.get(placementRef), tx.get(counterRef), tx.get(quoteRef)]);
    if (placement.exists) {
      const e = placement.data() ?? {};
      return { orderId: String(e.orderId), orderNumber: String(e.orderNumber), idempotent: true };
    }
    if (freshQuote.data()?.usedByOrderId) throw new HttpsError("failed-precondition", "This checkout was already used to place an order.");
    const seq = (Number(counter.data()?.seq) || 0) + 1;
    const orderNumber = `DL-${String(seq).padStart(4, "0")}`;

    tx.set(counterRef, { seq }, { merge: true });
    tx.create(orderRef, {
      restaurantId: cart.restaurantId,
      parentId: cart.restaurantId,
      restaurantName: str(r.name, 120) || "Restaurant",
      restaurantLogo: str(r.logoUrl, 500),
      zoneId: (r.zoneId as string) || ((cart as any).zoneId as string) || null,
      zoneName: (r.zoneName as string) || ((cart as any).zoneName as string) || null,
      marketId: (r.marketId as string) || ((cart as any).marketId as string) || null,
      table: isPickup ? "Pickup" : "Delivery",
      tableLabel: isPickup ? `Pickup • ${str(r.name, 80)}` : `Delivery • ${str(address.area, 80) || "Address"}`,
      orderNumber,
      orderSource: "delivery_app",
      items: legacyOrderItems(quote, cart),
      // Legacy rupee fields for existing vendor / rider / customer builds.
      subtotal: paiseToRupees(t.itemsGrossPaise),
      tax: paiseToRupees(t.taxPaise),
      discount: paiseToRupees(t.itemDiscountPaise + t.cartDiscountPaise),
      tip: paiseToRupees(t.tipPaise),
      packagingFee: paiseToRupees(t.packagingPaise),
      deliveryFee: paiseToRupees(t.deliveryPaise + t.surgePaise),
      platformFee: paiseToRupees(t.platformFeePaise + t.smallOrderFeePaise),
      ...(t.donationPaise > 0 ? { donation: paiseToRupees(t.donationPaise), donationCause: str(data.donationCause, 60) || "Kada Cares" } : {}),
      total: paiseToRupees(t.totalPaise),
      // The permanent, authoritative price snapshot — minus the money split
      // (commission, rider pay, Kada's revenue), which the customer must not
      // see; that lives in orders/{id}/finance/pricing (orderFinance.ts).
      pricing: plain(publicSnapshot(quote)),
      // The bill exactly as the customer was shown it (pricing/bill.ts).
      bill: plain(customerBill(quote)),
      pricingQuoteId: quoteId,
      pricingCheck: { ok: true, source: "pricing_engine", engineVersion: quote.engineVersion, checkedAt: now },
      status: scheduledForMs != null ? "scheduled" : "new",
      fulfillmentType: scheduledForMs != null ? "scheduled" : "now",
      ...(scheduledForMs != null ? { scheduledFor: admin.firestore.Timestamp.fromMillis(scheduledForMs) } : {}),
      type: isPickup ? "takeaway" : "delivery",
      channel: isPickup ? "takeaway" : "delivery",
      customerName,
      customerPhone,
      customerUid: uid,
      paymentStatus: "pending",
      paymentMethod,
      paymentOptions: paymentMethod === "cod" ? ["cod"] : ["razorpay"],
      currency: "INR",
      deliveryAddress: isPickup
        ? { line1: "", area: "", landmark: "", pincode: "", gps: null }
        : {
            line1: str(address.line1, 200),
            area: str(address.area, 120),
            landmark: str(address.landmark, 120),
            pincode: str(address.pincode, 10),
            gps: cart.drop ? { lat: cart.drop.lat, lng: cart.drop.lng } : null,
          },
      deliveryAddressText: isPickup ? "" : str(address.text, 300),
      instructions,
      timestamp: now,
    });
    for (const p of quote.promotions) {
      const usage = db.collection("promo_usage").doc(p.ruleId);
      tx.set(usage, { count: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
      tx.set(usage.collection("customers").doc(uid), { count: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
    }
    tx.create(financeRef(orderRef), { ...plain(financeDoc(quote, cart.restaurantId)), createdAt: now });
    tx.update(quoteRef, { usedByOrderId: orderRef.id, usedAt: now });
    tx.create(placementRef, { orderId: orderRef.id, orderNumber, totalPaise: t.totalPaise, createdAt: now });
    return { orderId: orderRef.id, orderNumber, idempotent: false };
  });

  return { ok: true, ...result, totalPaise: t.totalPaise, paymentMethod };
});
