const admin = require('firebase-admin');
admin.initializeApp({ projectId: "kada-restaurant-os-v1" });
const db = admin.firestore();

async function run() {
  const start = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86400000);
  try {
    const agg = await db
      .collection("orders")
      .where("timestamp", ">=", start)
      .aggregate({
        gmv: admin.firestore.AggregateField.sum("total"),
        discount: admin.firestore.AggregateField.sum("discount"),
        delivery: admin.firestore.AggregateField.sum("deliveryFee"),
        count: admin.firestore.AggregateField.count(),
      })
      .get();
    console.log('Orders Aggregation:', agg.data());
  } catch (e) {
    console.log('Error:', e.message);
  }
  process.exit(0);
}
run();
