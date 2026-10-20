const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "kada-restaurant-os-v1" });
}
const db = admin.firestore();

async function run() {
  console.log('Seeding data...');
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    await db.collection('orders').add({
      total: 1000 + (i * 100),
      discount: 50,
      deliveryFee: 40,
      timestamp: admin.firestore.Timestamp.fromDate(new Date(now.getTime() - i * 86400000))
    });
  }
  
  await db.collection('vendor_settlements').add({
    commissionAmount: 500,
    gatewayFee: 10,
    netPayout: 490,
    status: 'pending',
    createdAt: admin.firestore.Timestamp.fromDate(now)
  });
  
  await db.collection('payout_requests').add({
    amount: 200,
    status: 'paid',
    createdAt: admin.firestore.Timestamp.fromDate(now)
  });
  
  console.log('Done!');
  process.exit(0);
}
run();
