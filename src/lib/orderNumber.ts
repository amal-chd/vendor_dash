import { db } from "@/lib/firebase";
import { doc, runTransaction } from "firebase/firestore";

/**
 * Atomically increments the per-restaurant order counter and returns
 * the next sequential order number as a zero-padded string.
 *
 * Format: "KD-0001", "KD-0002", … (or the provided prefix)
 *
 * The counter lives at:  restaurants/{restaurantId}/meta/orderCounter
 * Field: { seq: number }
 *
 * Falls back gracefully to a timestamp-based ID on transaction failure so
 * orders are never lost.
 */
export async function nextOrderNumber(
  restaurantId: string,
  prefix: string = "KD"
): Promise<string> {
  try {
    const counterRef = doc(
      db,
      "restaurants",
      restaurantId,
      "meta",
      "orderCounter"
    );

    const seq = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? (snap.data().seq as number) ?? 0 : 0;
      const next = current + 1;
      tx.set(counterRef, { seq: next }, { merge: true });
      return next;
    });

    return `${prefix}-${String(seq).padStart(4, "0")}`;
  } catch (err) {
    // Graceful fallback — still unique enough for a single session
    console.warn("Order counter transaction failed, using fallback:", err);
    const fallback = Date.now().toString().slice(-5);
    return `${prefix}-${fallback}`;
  }
}
