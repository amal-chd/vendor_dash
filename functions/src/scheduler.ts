import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { isOrderHeld } from "./vendorOrderRules";
import { withCronHeartbeat } from "./cronHealth";

/**
 * Runs every 5 minutes to release scheduled orders to vendors.
 * An order with fulfillmentType == 'scheduled' and status == 'scheduled'
 * is moved to 'new' when the current time is within 45 minutes of the scheduled time.
 */
export const processScheduledOrders = onSchedule("every 5 minutes", withCronHeartbeat("processScheduledOrders", 5, async (event) => {
  const db = admin.firestore();
  
  // Define the threshold (e.g., release to vendor 45 minutes before the scheduled time)
  // Vendors usually need 20-30 mins to prepare and 10-15 mins for delivery.
  const leadTimeMs = 45 * 60 * 1000; 
  const now = Date.now();
  const thresholdDate = new Date(now + leadTimeMs);

  const snapshot = await db.collection("orders")
    .where("fulfillmentType", "==", "scheduled")
    .where("status", "==", "scheduled")
    .where("scheduledFor", "<=", thresholdDate)
    .get();

  if (snapshot.empty) {
    console.log("No scheduled orders to process at this time.");
    return;
  }

  const batch = db.batch();
  let count = 0;

  snapshot.forEach((doc) => {
    // An unpaid online order stays parked; it is released on a later run
    // once its payment lands, and never reaches a kitchen before that.
    if (count >= 450 || isOrderHeld(doc.data())) return;
    // Release the order to the vendor by updating status to "new"
    batch.update(doc.ref, {
      status: "new",
      // Optional: keep track of when it was released
      releasedAt: FieldValue.serverTimestamp(),
    });
    count++;
  });

  if (count === 0) return;
  await batch.commit();
  console.log(`Successfully processed and released ${count} scheduled orders.`);
}));
