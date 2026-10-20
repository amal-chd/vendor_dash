const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'kada-restaurant-os-v1' });
const db = admin.firestore();

async function run() {
  const now = new Date();
  const defaultEnd = new Date(now);
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);
  console.log("Date Range:", defaultStart.toISOString(), defaultEnd.toISOString());

  const ordersSnap = await db
    .collection("orders")
    .where("status", "in", ["completed", "delivered"])
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(defaultStart))
    .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(defaultEnd))
    .get();
    
  console.log("Total completed/delivered orders in last 7 days:", ordersSnap.size);
  let unsetOrders = 0;
  ordersSnap.forEach(doc => {
      if (!doc.data().settlementId) unsetOrders++;
  });
  console.log("Orders without settlementId:", unsetOrders);
}

run().catch(console.error);
