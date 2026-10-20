const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

async function run() {
  console.log("Fetching completed orders...");
  const snap = await db.collection("orders").where("status", "in", ["completed", "delivered"]).get();
  
  let fixed = 0;
  for (const doc of snap.docs) {
    const order = doc.data();
    if (order.riderId && !order.riderEarning) {
      console.log(`Fixing order ${doc.id}`);
      const uid = order.riderId;
      const econ = { riderBaseFee: 20, riderPerKm: 8 };
      
      const pickup = order.pickupLocation ? { lat: order.pickupLocation.latitude, lng: order.pickupLocation.longitude } : null;
      const drop = order.deliveryLocation ? { lat: order.deliveryLocation.latitude, lng: order.deliveryLocation.longitude } : null;
      
      let distanceKm = 0;
      if (pickup?.lat && drop?.lat) {
        const toRad = (x) => (x * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(drop.lat - pickup.lat);
        const dLon = toRad(drop.lng - pickup.lng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(pickup.lat)) * Math.cos(toRad(drop.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      
      const tip = Number(order.tip ?? 0) || 0;
      const distancePay = Math.round(distanceKm * econ.riderPerKm);
      const riderEarning = econ.riderBaseFee + distancePay + tip;

      const batch = db.batch();
      batch.update(doc.ref, { riderEarning });
      
      batch.set(
        db.collection("rider_earnings").doc(uid).collection("entries").doc(doc.id),
        {
          orderId: doc.id,
          orderNumber: (order.orderNumber ?? "").toString(),
          restaurantName: (order.restaurantName ?? "").toString(),
          base: econ.riderBaseFee,
          distancePay,
          distanceKm: Number(distanceKm.toFixed(2)),
          tip,
          total: riderEarning,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      batch.set(
        db.collection("delivery_users").doc(uid),
        {
          "earnings.lifetime": admin.firestore.FieldValue.increment(riderEarning),
          "earnings.today": admin.firestore.FieldValue.increment(riderEarning),
          "earnings.week": admin.firestore.FieldValue.increment(riderEarning),
          deliveriesToday: admin.firestore.FieldValue.increment(1),
        },
        { merge: true }
      );
      
      await batch.commit();
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} orders`);
}
run().catch(console.error);
