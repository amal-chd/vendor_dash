const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function test() {
  try {
    const snap = await db.collection('restaurants')
      .orderBy('geohash')
      .startAt(['gbsuv7y'])
      .endAt(['gbsuv7z'])
      .get();
    console.log("Success, docs:", snap.size);
  } catch(e) {
    console.error("Error:", e.message);
  }
}
test();
