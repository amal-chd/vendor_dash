import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

/**
 * Recipe-linked stock depletion.
 *
 * When an order completes, each sold item's recipe (recipes/{…} with
 * menuItemId + ingredients[{inventoryItemId, quantity}]) is used to deduct the
 * consumed quantities from the restaurant's inventory (inventory/{id}.stock).
 * Turns manual stock into live, sale-accurate inventory.
 *
 * Fires only on the transition INTO a completed/delivered state, and is
 * idempotent via the order's `stockDepleted` flag (re-checked in the txn).
 */

const isCompleted = (s: unknown): boolean => {
  const v = String(s ?? "").toLowerCase();
  return v === "completed" || v === "delivered";
};

export const onOrderDepleteStock = onDocumentWritten(
  { document: "orders/{orderId}", maxInstances: 1 },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    // Only when the order first becomes completed.
    if (isCompleted(before?.status) || !isCompleted(after.status)) return;
    if (after.stockDepleted === true) return;

    const restaurantId = String(after.restaurantId ?? "");
    const items = Array.isArray(after.items) ? after.items : [];
    if (!restaurantId || items.length === 0) return;

    const db = admin.firestore();
    const orderRef = db.collection("orders").doc(event.params.orderId);

    // Aggregate consumed quantity per inventory item across all order lines.
    const deductions = new Map<string, number>();
    for (const it of items as Record<string, unknown>[]) {
      const menuItemId = String(it.menuItemId ?? it.itemId ?? it.id ?? "");
      const qty = Number(it.qty ?? it.quantity ?? 1) || 1;
      if (!menuItemId) continue;

      // menuItemId is unique within a restaurant — query by it (single-field
      // index) and match the restaurant in memory to avoid a composite index.
      const recipeSnap = await db
        .collection("recipes")
        .where("menuItemId", "==", menuItemId)
        .limit(5)
        .get();
      const recipe = recipeSnap.docs.find((d) => String(d.data().restaurantId ?? "") === restaurantId);
      if (!recipe) continue;

      const ingredients = recipe.data().ingredients;
      if (!Array.isArray(ingredients)) continue;
      for (const ing of ingredients as Record<string, unknown>[]) {
        const invId = String(ing.inventoryItemId ?? "");
        const usage = (Number(ing.quantity ?? 0) || 0) * qty;
        if (!invId || usage <= 0) continue;
        deductions.set(invId, (deductions.get(invId) ?? 0) + usage);
      }
    }

    if (deductions.size === 0) {
      await orderRef.set({ stockDepleted: true }, { merge: true });
      return;
    }

    // Apply atomically so stock moves and the idempotency flag commit together.
    await db.runTransaction(async (txn) => {
      const fresh = await txn.get(orderRef);
      if (fresh.data()?.stockDepleted === true) return;

      const ids = Array.from(deductions.keys());
      const refs = ids.map((id) => db.collection("inventory").doc(id));
      const docs = await Promise.all(refs.map((r) => txn.get(r)));

      docs.forEach((doc, i) => {
        if (!doc.exists) return;
        const used = deductions.get(ids[i]) ?? 0;
        const current = Number(doc.data()?.stock ?? 0);
        const next = Math.max(0, Math.round((current - used) * 1000) / 1000);
        // Keep the low-stock status live so alerts/reorder nudges are accurate
        // right after a sale (the stock screen reads this field).
        const min = Number(doc.data()?.min ?? 0);
        const status = next <= 0 ? "out" : (min > 0 && next <= min ? "low" : "ok");
        txn.update(refs[i], { stock: next, status });
      });

      txn.set(
        orderRef,
        { stockDepleted: true, stockDepletedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  },
);
