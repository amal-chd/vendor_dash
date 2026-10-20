const admin = require("firebase-admin");
admin.initializeApp({
  projectId: "kada-restaurant-os-v1"
});

async function run() {
  try {
    const db = admin.firestore();
    const agg = await db.collection("orders").count().get();
    console.log("Total Orders:", agg.data().count);
    
    // Call the same aggregation logic
    const agg2 = await db.collection("orders").aggregate({
        gmv: admin.firestore.AggregateField.sum("total")
    }).get();
    console.log("Total GMV:", agg2.data().gmv);

  } catch(e) {
    console.error(e);
  }
}
run();
