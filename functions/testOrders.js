const admin = require("firebase-admin");
process.env.FIRESTORE_EMULATOR_HOST="127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-project" });

async function run() {
  const snap = await admin.firestore().collection("orders").where("status", "==", "completed").limit(3).get();
  snap.docs.forEach(d => {
    console.log(d.id, d.data().total, d.data().status, d.data().riderEarning, d.data().restaurantId, d.data().riderId);
  });
}
run().catch(console.error);
