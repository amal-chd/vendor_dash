const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin (assuming default credentials or emulator)
// To run this against prod, export GOOGLE_APPLICATION_CREDENTIALS
try {
  admin.initializeApp();
} catch (e) {
  console.log("App already initialized");
}

const db = admin.firestore();

async function migrate() {
  console.log("Starting migration...");
  const restaurantsRef = db.collection('restaurants');
  const snapshot = await restaurantsRef.get();
  
  let count = 0;
  const batchArray = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    
    // Only update if they don't have currencyCode already
    if (!data.currencyCode || !data.countryCode) {
      currentBatch.update(doc.ref, {
        currencyCode: data.currencyCode || 'INR',
        countryCode: data.countryCode || 'IN',
        dialCode: data.dialCode || '+91',
        taxConfiguration: data.taxConfiguration || [
          { name: "GST", type: "compound", rate: 5, enabled: true, inclusive: false }
        ],
        timezone: data.timezone || 'Asia/Kolkata',
        locale: data.locale || 'en-IN'
      });
      
      operationCount++;
      count++;
      
      if (operationCount >= 400) {
        batchArray.push(currentBatch);
        currentBatch = db.batch();
        operationCount = 0;
      }
    }
  }
  
  if (operationCount > 0) {
    batchArray.push(currentBatch);
  }
  
  console.log(`Found ${count} documents to update. Executing batches...`);
  
  for (const batch of batchArray) {
    await batch.commit();
  }
  
  console.log("Migration complete.");
}

migrate().then(() => process.exit(0)).catch(e => {
  console.error("Migration failed:", e);
  process.exit(1);
});
