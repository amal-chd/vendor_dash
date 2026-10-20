import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { PARTNER_CONTACT_COLLECTION, ownerUidsOf, partnerDocKey } from "./onboarding/partnerPrivate";
import { assertOperational } from "./onboarding/activationGate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItem {
  name?: string;
  title?: string;
  quantity?: number | string;
  qty?: number | string;
  price?: number;
}

interface RecipeIngredient {
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit?: string;
}

interface RecipeDoc {
  restaurantId: string;
  menuItemName: string;
  ingredients: RecipeIngredient[];
}

interface LoyaltyWalletData {
  restaurantId: string;
  phone: string;
  customerPhone?: string;
  name: string;
  points: number;
  totalSpent: number;
  ordersCount: number;
  createdAt: admin.firestore.FieldValue;
  lastOrderAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPLETED_STATUSES = new Set(["completed", "done", "delivered"]);

export function isCompletedStatus(status: unknown): boolean {
  return COMPLETED_STATUSES.has(String(status ?? "").toLowerCase());
}

export function parseQty(q: number | string | undefined): number {
  if (typeof q === "number") return Number.isFinite(q) ? q : 1;
  const n = parseInt(String(q ?? "1"), 10);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Resolves the "effective restaurant" for a callable invocation. Owners get
 * back their own uid; outlet sub-accounts get the parent restaurant's uid.
 * Previously these callables trusted a client-supplied `restaurantId`, which
 * let any authenticated caller award/redeem loyalty against any wallet.
 * Throws unauthenticated if no auth, or permission-denied if the caller's
 * own restaurants doc is missing.
 */
async function resolveCallerRestaurantId(
  request: { auth?: { uid?: string; token?: Record<string, any> } | null }
): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  // 1. Check custom claims if present
  const tokenRestId = request.auth?.token?.restaurantId;
  if (typeof tokenRestId === "string" && tokenRestId.length > 0) {
    return tokenRestId;
  }

  // 2. Direct restaurant doc
  const ownDocSnap = await admin
    .firestore()
    .collection("restaurants")
    .doc(uid)
    .get();
  if (ownDocSnap.exists) {
    const data = ownDocSnap.data() ?? {};
    if (data.isOutlet === true && typeof data.parentId === "string" && data.parentId.length > 0) {
      return data.parentId;
    }
    return uid;
  }

  // 3. Staff doc lookup by authUid
  const staffByAuth = await admin
    .firestore()
    .collection("staff")
    .where("authUid", "==", uid)
    .limit(1)
    .get();
  if (!staffByAuth.empty) {
    const s = staffByAuth.docs[0].data();
    if (s.restaurantId) return s.restaurantId;
  }

  // 4. Staff doc lookup by email
  const email = request.auth?.token?.email;
  if (email) {
    const staffByEmail = await admin
      .firestore()
      .collection("staff")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!staffByEmail.empty) {
      const s = staffByEmail.docs[0].data();
      if (s.restaurantId) return s.restaurantId;
    }
  }

  throw new HttpsError("permission-denied", "Restaurant profile not found");
}

// ---------------------------------------------------------------------------
// 1. onOrderCompleted — auto-deduct inventory when an order reaches a
//    terminal status (completed / done / delivered).
// ---------------------------------------------------------------------------

export const onOrderCompleted = onDocumentWritten({ document: "orders/{orderId}", maxInstances: 3 }, async (event) => {
  const before = event.data?.before?.data() as Record<string, unknown> | undefined;
  const after = event.data?.after?.data() as Record<string, unknown> | undefined;

  // Only act when the after-state exists (not a delete).
  if (!after) return;

  const wasCompleted = isCompletedStatus(before?.status);
  const isNowCompleted = isCompletedStatus(after.status);

  // Only trigger when transitioning INTO a completed state.
  if (wasCompleted || !isNowCompleted) return;

  const restaurantId = String(after.restaurantId ?? "");
  const orderId = event.params.orderId;
  const orderNumber = String(after.orderNumber ?? "");
  const parentId = after.parentId ? String(after.parentId) : "";
  // Outlets are treated as separate restaurants, so we use their own recipes and inventory
  const effectiveRestaurantId = restaurantId;

  if (!restaurantId) {
    console.error("onOrderCompleted: missing restaurantId on order", orderId);
    return;
  }

  const items: OrderItem[] = Array.isArray(after.items) ? (after.items as OrderItem[]) : [];
  if (items.length === 0) return;

  const db = admin.firestore();

  const batch = db.batch();

  for (const item of items) {
    const itemName = String(item.name ?? item.title ?? "").trim();
    if (!itemName) continue;

    const orderQty = parseQty(item.quantity ?? item.qty);

    let recipesSnap: admin.firestore.QuerySnapshot;
    try {
      recipesSnap = await db
        .collection("recipes")
        .where("restaurantId", "==", effectiveRestaurantId)
        .where("menuItemName", "==", itemName)
        .get();
    } catch (err) {
      console.error(`onOrderCompleted: failed to fetch recipe for "${itemName}"`, err);
      continue;
    }

    for (const recipeDoc of recipesSnap.docs) {
      const recipe = recipeDoc.data() as RecipeDoc;
      const ingredients: RecipeIngredient[] = Array.isArray(recipe.ingredients)
        ? recipe.ingredients
        : [];

      for (const ingredient of ingredients) {
        const { inventoryItemId, inventoryItemName, quantity: recipeQty } = ingredient;
        if (!inventoryItemId) continue;

        const deducted = (recipeQty ?? 0) * orderQty;
        if (deducted <= 0) continue;

        const inventoryRef = db.collection("inventory").doc(inventoryItemId);
        batch.set(inventoryRef, { stock: admin.firestore.FieldValue.increment(-deducted) }, { merge: true });
          batch.set(db.collection("inventory_logs").doc(), {
            restaurantId: effectiveRestaurantId,
            itemId: inventoryItemId,
            itemName: inventoryItemName ?? "",
            type: "reduction",
            quantity: deducted,
            reason: `Order ${orderNumber}`,
            orderId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            by: "system"
          });
        }
      }
    }

  // Rider earnings for orders finished outside the rider app are handled by
  // onOrderFinishedEnsureEarnings → ensureRiderEarning (delivery.ts): one
  // transactional, idempotent path. A second, non-transactional copy lived
  // here and could credit the same delivery twice.

  // --- Update Customer Stats ---
  const customerPhone = String(after.customerPhone ?? "");
  const customerName = String(after.customerName ?? "Guest");
  const customerUid = String(after.customerUid ?? "");
  const orderTotal = Number(after.totalAmount) || Number(after.total) || 0;

  if (customerPhone && customerPhone.length >= 8) {
    const custRef = db.collection('restaurants').doc(restaurantId).collection('customers').doc(customerPhone);
    batch.set(custRef, {
      name: customerName,
      phone: customerPhone,
      customerUid: customerUid,
      lastOrderDate: admin.firestore.FieldValue.serverTimestamp(),
      totalOrders: admin.firestore.FieldValue.increment(1),
      totalSpent: admin.firestore.FieldValue.increment(orderTotal),
    }, { merge: true });
  }

  try {
    await batch.commit();
  } catch (err) {
    console.error("onOrderCompleted: batch commit failed", err);
  }
});

// ---------------------------------------------------------------------------
// 2. awardLoyaltyPoints — callable, invoked from POS after checkout.
// ---------------------------------------------------------------------------

export const awardLoyaltyPoints = onCall(async (request) => {
  const {
    customerPhone,
    customerName,
    orderTotal,
    orderId,
    orderNumber,
    pointsRate,
  } = request.data ?? {};

  // restaurantId is derived from the authenticated caller (or their parent
  // restaurant if they're an outlet sub-account). Never trust a client-
  // supplied restaurantId — that let attackers credit any wallet.
  const restaurantId = await resolveCallerRestaurantId(request);

  if (!customerPhone || typeof customerPhone !== "string") {
    throw new HttpsError("invalid-argument", "customerPhone is required");
  }
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required");
  }

  const db = admin.firestore();
  
  const orderSnap = await db.collection("orders").doc(orderId).get();
  if (!orderSnap.exists) {
    throw new HttpsError("not-found", "Order not found");
  }
  const orderData = orderSnap.data()!;
  
  if (orderData.restaurantId !== restaurantId) {
    throw new HttpsError("permission-denied", "Order does not belong to this restaurant");
  }

  const actualOrderTotal = Number(orderData.totalAmount) || Number(orderData.total) || 0;

  // 1 point per ₹10 spent.
  const rate = typeof pointsRate === "number" && pointsRate > 0 ? pointsRate : 1;
  const newPoints = Math.floor(actualOrderTotal / 10) * rate;

  // Find existing wallet.
  const walletsSnap = await db
    .collection("loyalty_wallets")
    .where("restaurantId", "==", restaurantId)
    .where("phone", "==", customerPhone)
    .limit(1)
    .get();

  let walletId: string;
  let totalPoints: number;

  if (!walletsSnap.empty) {
    const walletDoc = walletsSnap.docs[0];
    walletId = walletDoc.id;
    const current = walletDoc.data();

    totalPoints = (Number(current.points) || 0) + newPoints;

    await walletDoc.ref.update({
      points: totalPoints,
      totalSpent: admin.firestore.FieldValue.increment(actualOrderTotal),
      ordersCount: admin.firestore.FieldValue.increment(1),
      lastOrderAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    totalPoints = newPoints;

    const newWallet: LoyaltyWalletData = {
      restaurantId,
      phone: customerPhone,
      customerPhone,
      name: String(customerName ?? ""),
      points: newPoints,
      totalSpent: actualOrderTotal,
      ordersCount: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastOrderAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const walletRef = await db.collection("loyalty_wallets").add(newWallet);
    walletId = walletRef.id;
  }

  // Add transaction log.
  await db
    .collection("loyalty_wallets")
    .doc(walletId)
    .collection("transactions")
    .add({
      type: "earn",
      points: newPoints,
      orderId,
      orderNumber: orderNumber ?? "",
      orderTotal: actualOrderTotal,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  return { ok: true, walletId, points: newPoints, totalPoints };
});

// ---------------------------------------------------------------------------
// 3. redeemLoyaltyPoints — callable, invoked from POS when customer redeems.
// ---------------------------------------------------------------------------

export const redeemLoyaltyPoints = onCall(async (request) => {
  const { walletId, pointsToRedeem, orderId, orderNumber } =
    request.data ?? {};

  // restaurantId is derived from auth — never from client input.
  const restaurantId = await resolveCallerRestaurantId(request);

  if (!walletId || typeof walletId !== "string") {
    throw new HttpsError("invalid-argument", "walletId is required");
  }
  if (
    typeof pointsToRedeem !== "number" ||
    !Number.isInteger(pointsToRedeem) ||
    pointsToRedeem <= 0
  ) {
    throw new HttpsError("invalid-argument", "pointsToRedeem must be a positive integer");
  }
  if (!orderId || typeof orderId !== "string") {
    throw new HttpsError("invalid-argument", "orderId is required");
  }

  const db = admin.firestore();
  const walletRef = db.collection("loyalty_wallets").doc(walletId);

  const remainingPoints = await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists) {
      throw new HttpsError("not-found", "Loyalty wallet not found");
    }

    const wallet = walletSnap.data()!;

    if (wallet.restaurantId !== restaurantId) {
      throw new HttpsError("permission-denied", "Wallet does not belong to this restaurant");
    }

    const currentPoints = Number(wallet.points) || 0;
    if (currentPoints < pointsToRedeem) {
      throw new HttpsError(
        "failed-precondition",
        `Insufficient points: wallet has ${currentPoints}, requested ${pointsToRedeem}`
      );
    }

    const newPoints = currentPoints - pointsToRedeem;
    tx.update(walletRef, { points: newPoints });

    const txLogRef = walletRef.collection("transactions").doc();
    tx.set(txLogRef, {
      type: "redeem",
      points: -pointsToRedeem,
      orderId,
      orderNumber: orderNumber ?? "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return newPoints;
  });

  return { ok: true, remainingPoints };
});

// ---------------------------------------------------------------------------
// 4. generateGstReport — callable, invoked from the reports screen.
// ---------------------------------------------------------------------------

export const generateGstReport = onCall(async (request) => {
  // Auth check: restaurantId == uid of the caller.
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const restaurantId = await resolveCallerRestaurantId(request);
  const { startDate, endDate } = request.data ?? {};

  if (!startDate || typeof startDate !== "string") {
    throw new HttpsError("invalid-argument", "startDate (ISO string) is required");
  }
  if (!endDate || typeof endDate !== "string") {
    throw new HttpsError("invalid-argument", "endDate (ISO string) is required");
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new HttpsError("invalid-argument", "startDate and endDate must be valid ISO date strings");
  }
  if (start > end) {
    throw new HttpsError("invalid-argument", "startDate must be before or equal to endDate");
  }

  const db = admin.firestore();

  const ordersQuery = db
    .collection("orders")
    .where("parentId", "==", restaurantId)
    .where("timestamp", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("timestamp", "<=", admin.firestore.Timestamp.fromDate(end))
    .where("status", "in", ["completed", "done", "delivered"]);

  const aggSnap = await ordersQuery.aggregate({
    taxableValue: admin.firestore.AggregateField.sum("subtotal"),
    totalTax: admin.firestore.AggregateField.sum("tax"),
    grandTotal: admin.firestore.AggregateField.sum("total"),
    ordersCount: admin.firestore.AggregateField.count(),
  }).get();

  const aggData = aggSnap.data();
  const taxableValue = aggData.taxableValue || 0;
  const totalTax = aggData.totalTax || 0;
  const grandTotal = aggData.grandTotal || 0;
  const ordersCount = aggData.ordersCount || 0;

  // CGST and SGST are each half of total GST (intra-state split).
  const cgst = totalTax / 2;
  const sgst = totalTax / 2;

  return {
    taxableValue,
    cgst,
    sgst,
    totalTax,
    grandTotal,
    ordersCount,
    // Default HSN for restaurant services (as per GST schedule).
    hsnCode: "9963",
    hsnDescription: "Restaurant Services",
    dateRange: { start: startDate, end: endDate },
  };
});

// ---------------------------------------------------------------------------
// 5. createOutletAccount — callable, invoked to create a sub-account for an outlet.
// ---------------------------------------------------------------------------

/**
 * Outlet login emails belong in partner_contact: the root restaurants doc is
 * publicly readable. The owner-only outlets subcollection keeps its copy for
 * the vendor app's credentials screen.
 */
function withoutLoginEmail<T extends Record<string, any>>(data: T): T {
  const rest: Record<string, any> = { ...data };
  delete rest.email;
  delete rest.outletEmail;
  return rest as T;
}

function setOutletContact(
  batch: admin.firestore.WriteBatch,
  outletUid: string,
  parentId: string,
  email: string,
): void {
  batch.set(
    admin.firestore().collection(PARTNER_CONTACT_COLLECTION).doc(partnerDocKey("vendor", outletUid)),
    {
      role: "vendor",
      partnerId: outletUid,
      ownerUids: ownerUidsOf("vendor", outletUid, { parentId }),
      email,
      outletEmail: email,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export const createOutletAccount = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const parentId = await resolveCallerRestaurantId(request);

  // Validate only the parent owner can manage outlets (not an existing outlet)
  if (parentId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Only the main restaurant owner can manage outlets.");
  }

  const {
    outletId,
    email,
    password,
    name,
    phone,
    address,
    state,
    district,
    hours,
    managerName,
    createAccount
  } = request.data ?? {};

  if (!name) {
    throw new HttpsError("invalid-argument", "Name is required.");
  }

  const db = admin.firestore();

  // If outletId is provided, we are editing an existing outlet
  if (outletId) {
    const subDocRef = db.collection("restaurants").doc(parentId).collection("outlets").doc(outletId);
    const subDocSnap = await subDocRef.get();
    if (!subDocSnap.exists) {
      throw new HttpsError("not-found", "Outlet document not found.");
    }
    const existingData = subDocSnap.data() || {};
    const outletUid = existingData.outletUid || existingData.id || ""; // The user's UID (if they have one)

    const baseData: any = {
      name,
      phone: phone || "",
      address: address || "",
      state: state || "",
      district: district || "",
      hours: hours || "",
      managerName: managerName || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Case A: Assigning or updating email/password
    if (email || password) {
      if (outletUid) {
        // They already have an auth account, so we update it!
        const updateData: any = {};
        if (email) {
          updateData.email = email;
          baseData.outletEmail = email;
          baseData.email = email;
        }
        if (password) {
          if (password.length < 6) {
            throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
          }
          updateData.password = password;
        }
        if (name) updateData.displayName = name;

        try {
          await admin.auth().updateUser(outletUid, updateData);
        } catch (error: any) {
          throw new HttpsError("already-exists", `Failed to update auth user: ${error.message}`);
        }

        // Now update both firestore documents
        const batch = db.batch();
        batch.update(subDocRef, baseData);
        batch.update(db.collection("restaurants").doc(outletUid), {
          ...withoutLoginEmail(baseData),
          isOutlet: true,
          parentId,
        });
        if (email) setOutletContact(batch, outletUid, parentId, email);
        await batch.commit();

        return { ok: true, outletId, outletUid };
      } else {
        // They DO NOT have an auth account yet, let's create it!
        if (!email || !password) {
          throw new HttpsError("invalid-argument", "Email and password are required to assign login credentials.");
        }
        if (password.length < 6) {
          throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
        }
        let userRecord;
        try {
          userRecord = await admin.auth().createUser({
            uid: outletId,
            email,
            password,
            displayName: name,
          });
        } catch (error: any) {
          throw new HttpsError("already-exists", `Failed to create auth user: ${error.message}`);
        }

        baseData.outletUid = outletId;
        baseData.outletEmail = email;
        baseData.email = email;

        // Save in sub-collection & root restaurants collection
        const batch = db.batch();
        batch.update(subDocRef, baseData);

        const rootData = {
          ...existingData,
          ...baseData,
          id: outletId,
          isOutlet: true,
          parentId,
          isActive: existingData.isActive !== false,
          onboardingStep: "live",
          createdAt: existingData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        };
        batch.set(db.collection("restaurants").doc(outletId), withoutLoginEmail(rootData), { merge: true });
        setOutletContact(batch, outletId, parentId, email);
        await batch.commit();

        return { ok: true, outletId: outletId, outletUid: outletId };
      }
    } else {
      // Just updating details (no email/password updates)
      const batch = db.batch();
      batch.update(subDocRef, baseData);
      if (outletUid) {
        batch.update(db.collection("restaurants").doc(outletUid), baseData);
      }
      await batch.commit();
      return { ok: true, outletId, outletUid };
    }
  } else {
    // Case B: Creating a brand new outlet
    const baseData: any = {
      name,
      phone: phone || "",
      address: address || "",
      state: state || "",
      district: district || "",
      hours: hours || "",
      managerName: managerName || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (createAccount) {
      if (!email || !password) {
        throw new HttpsError("invalid-argument", "Email and password are required to create a login account.");
      }
      if (password.length < 6) {
        throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
      }

      let userRecord;
      try {
        userRecord = await admin.auth().createUser({
          email,
          password,
          displayName: name,
        });
      } catch (error: any) {
        throw new HttpsError("already-exists", `Failed to create auth user: ${error.message}`);
      }

      const newOutletUid = userRecord.uid;
      baseData.id = newOutletUid;
      baseData.outletUid = newOutletUid;
      baseData.outletEmail = email;
      baseData.email = email;

      const rootData = {
        ...baseData,
        isOutlet: true,
        parentId,
        isActive: true,
        onboardingStep: "live",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      const newSubRef = db.collection("restaurants").doc(parentId).collection("outlets").doc(newOutletUid);
      const newRootRef = db.collection("restaurants").doc(newOutletUid);

      batch.set(newSubRef, baseData);
      batch.set(newRootRef, withoutLoginEmail(rootData));
      setOutletContact(batch, newOutletUid, parentId, email);

      try {
        await batch.commit();
      } catch (error: any) {
        await admin.auth().deleteUser(newOutletUid).catch(() => {});
        throw new HttpsError("internal", `Failed to save Firestore documents: ${error.message}`);
      }

      return { ok: true, outletId: newOutletUid, outletUid: newOutletUid };
    } else {
      // Creating a new outlet WITHOUT login credentials
      const newSubRef = db.collection("restaurants").doc(parentId).collection("outlets").doc();
      const newId = newSubRef.id;

      baseData.id = newId;
      baseData.outletUid = "";
      baseData.outletEmail = "";
      baseData.isActive = true;
      baseData.createdAt = admin.firestore.FieldValue.serverTimestamp();

      await newSubRef.set(baseData);
      return { ok: true, outletId: newId, outletUid: "" };
    }
  }
});

// ---------------------------------------------------------------------------
// 6. provisionStaffAccount — callable. The restaurant owner creates (or updates)
//    a Firebase Auth login for a staff member so they can sign in with their own
//    email + password on their own device. A custom claim links the account back
//    to the restaurant + staff document so the app can start a scoped, permission
//    -restricted staff session. PIN-based clock-in does NOT need this.
// ---------------------------------------------------------------------------

export const provisionStaffAccount = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  const restaurantId = await resolveCallerRestaurantId(request);

  const { staffId, email, password, name } = request.data ?? {};
  if (!staffId || typeof staffId !== "string") {
    throw new HttpsError("invalid-argument", "staffId is required.");
  }
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "A valid email is required.");
  }
  if (password && typeof password === "string" && password.length > 0 && password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  const db = admin.firestore();
  const staffRef = db.collection("staff").doc(staffId);
  const staffSnap = await staffRef.get();
  if (!staffSnap.exists) {
    throw new HttpsError("not-found", "Staff member not found.");
  }
  const staff = staffSnap.data() ?? {};

  // Ownership: the staff member must belong to the caller's restaurant.
  if (staff.restaurantId !== restaurantId) {
    throw new HttpsError("permission-denied", "This staff member belongs to another restaurant.");
  }

  const displayName = (name || staff.name || "Staff").toString();
  const existingUid = (staff.authUid as string | undefined) || undefined;
  let authUid = existingUid;

  try {
    if (existingUid) {
      // Update the existing login.
      const updates: admin.auth.UpdateRequest = { email, displayName };
      if (password) updates.password = password;
      await admin.auth().updateUser(existingUid, updates);
    } else {
      // Reuse an account that may already exist for this email, else create one.
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        if (!password) {
          throw new HttpsError("invalid-argument", "A password is required to create a new staff login.");
        }
        userRecord = await admin.auth().createUser({ email, password, displayName });
      }
      authUid = userRecord.uid;
    }
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("already-exists", `Could not set up the staff login: ${error.message}`);
  }

  if (!authUid) {
    throw new HttpsError("internal", "Failed to resolve the staff account id.");
  }

  // Claim links the login to the restaurant + staff doc so the app can scope it.
  await admin.auth().setCustomUserClaims(authUid, {
    staff: true,
    restaurantId,
    staffDocId: staffId,
  });

  await staffRef.update({
    authUid,
    email,
    emailLoginEnabled: true,
    loginEnabled: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, authUid };
});

// ---------------------------------------------------------------------------
// 7. revokeStaffAccount — callable. Owner disables/removes a staff member's
//    email login. Deletes the Auth user (if any) and clears the link fields.
// ---------------------------------------------------------------------------

export const revokeStaffAccount = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  const restaurantId = await resolveCallerRestaurantId(request);

  const { staffId } = request.data ?? {};
  if (!staffId || typeof staffId !== "string") {
    throw new HttpsError("invalid-argument", "staffId is required.");
  }

  const db = admin.firestore();
  const staffRef = db.collection("staff").doc(staffId);
  const staffSnap = await staffRef.get();
  if (!staffSnap.exists) {
    throw new HttpsError("not-found", "Staff member not found.");
  }
  const staff = staffSnap.data() ?? {};
  if (staff.restaurantId !== restaurantId) {
    throw new HttpsError("permission-denied", "This staff member belongs to another restaurant.");
  }

  const authUid = staff.authUid as string | undefined;
  if (authUid) {
    try {
      await admin.auth().deleteUser(authUid);
    } catch (_) {
      // Already gone — carry on clearing the doc.
    }
  }

  await staffRef.update({
    authUid: admin.firestore.FieldValue.delete(),
    emailLoginEnabled: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

// ---------------------------------------------------------------------------
// 8. requestVendorPayout — callable. The owner asks for their already-generated
//    pending settlements to be paid out.
//
//    This deliberately does NOT compute a balance of its own. `vendor_settlements`
//    are produced by the settlement engine (admin_operations.generateVendorSettlement)
//    and the `netPayout` on those docs is the only figure that may ever be paid.
//    A second balance calculation here could drift from the engine and queue out
//    more money than was actually settled.
//
//    Creating the request moves no money: an admin still settles it, and the
//    actual disbursement path additionally requires RAZORPAY_ACCOUNT_NUMBER.
// ---------------------------------------------------------------------------
const MIN_VENDOR_PAYOUT = 100;

export const requestVendorPayout = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  // Owner-only. A staff login must never be able to queue money out, whatever
  // feature permissions the owner granted them.
  if (request.auth?.token?.staff === true) {
    throw new HttpsError(
      "permission-denied",
      "Only the account owner can request a payout.",
    );
  }

  const restaurantId = await resolveCallerRestaurantId(request);

  // Onboarding + banking gates. Both are engine-owned and cannot be
  // self-granted, so a suspended shop or an unverified bank account cannot
  // queue a payout.
  await assertOperational("vendor", restaurantId, {
    requirePayoutReady: true,
    action: "request a payout",
  });

  const db = admin.firestore();
  const settlementsSnap = await db
    .collection("vendor_settlements")
    .where("restaurantId", "==", restaurantId)
    .where("status", "==", "pending")
    .get();

  const settlementIds: string[] = [];
  let total = 0;
  for (const doc of settlementsSnap.docs) {
    const amount = Number(doc.data()?.netPayout ?? 0) || 0;
    if (amount <= 0) continue;
    settlementIds.push(doc.id);
    total += amount;
  }
  total = Math.round(total * 100) / 100;

  if (settlementIds.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "You have no settled earnings awaiting payout yet.",
    );
  }
  if (total < MIN_VENDOR_PAYOUT) {
    throw new HttpsError(
      "failed-precondition",
      `You need at least \u20b9${MIN_VENDOR_PAYOUT} to request a payout. Available: \u20b9${total}.`,
    );
  }

  const requestsCol = db.collection("vendor_payout_requests");
  const result = await db.runTransaction(async (tx) => {
    const pending = await tx.get(
      requestsCol
        .where("restaurantId", "==", restaurantId)
        .where("status", "==", "pending")
        .limit(1),
    );
    if (!pending.empty) {
      throw new HttpsError(
        "failed-precondition",
        "You already have a payout request pending.",
      );
    }
    const ref = requestsCol.doc();
    tx.set(ref, {
      restaurantId,
      requestedBy: uid,
      amount: total,
      settlementIds,
      settlementCount: settlementIds.length,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { requestId: ref.id, amount: total, settlementCount: settlementIds.length };
  });

  return { ok: true, ...result };
});
