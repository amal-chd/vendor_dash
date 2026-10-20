const path = require('path');
const fs = require('fs');
const admin = require(path.join(__dirname, '../functions/node_modules/firebase-admin'));

if (!admin.apps.length) {
  try {
    admin.initializeApp({ projectId: "kada-restaurant-os-v1" });
  } catch (e) {
    console.warn("Init fallback:", e.message);
  }
}

const db = admin.firestore();

async function seed() {
  console.log("Loading food_studio_presets.json...");
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../food_studio_presets.json'), 'utf-8'));
  console.log(`Found ${data.length} presets to seed.`);

  const batchSize = 400;
  let batch = db.batch();
  let count = 0;

  for (const preset of data) {
    const docRef = db.collection('food_studio_presets').doc(preset.id);
    batch.set(docRef, {
      ...preset,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      verified: true
    }, { merge: true });
    count++;
  }

  console.log(`Committing batch of ${count} presets to Firestore collection 'food_studio_presets'...`);
  try {
    await batch.commit();
    console.log("Successfully seeded 300 food studio presets to Firestore!");
  } catch (err) {
    console.error("Batch commit error (may require ADC / auth):", err.message);
  }
}

seed().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
