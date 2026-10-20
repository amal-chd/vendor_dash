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
        count: admin.firestore.AggregateField.count(),
      })
      .get();
    console.log('--- SUCCESS! GMV IS:', agg.data().gmv, '---');
  } catch (e) {
    console.log('--- ERROR:', e.message, '---');
  }
  process.exit(0);
}
run();
