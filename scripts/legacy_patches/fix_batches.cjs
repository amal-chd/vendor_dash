const fs = require('fs');

const path = '/Users/amalchand/Documents/The Kada/functions/src/admin_operations.ts';
let code = fs.readFileSync(path, 'utf8');

const regex2 = /\/\/ Mark the netted ad charges[\s\S]*?await adBatch\.commit\(\);\n    }/m;
const replacement2 = `// Mark the netted ad charges as collected against this settlement.
    if (adChargeIds.length) {
      const adChunks = chunkArray(adChargeIds, 450);
      for (const chunk of adChunks) {
        const adBatch = db.batch();
        chunk.forEach((id) => {
          adBatch.update(db.collection("ad_charges").doc(id), {
            status: "settled",
            settlementId,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await adBatch.commit();
      }
    }`;
code = code.replace(regex2, replacement2);

const regex3 = /\/\/ Mark manual adjustments as collected[\s\S]*?await adjBatch\.commit\(\);\n    }/m;
const replacement3 = `// Mark manual adjustments as collected against this settlement.
    if (adjustmentIds.length) {
      const adjChunks = chunkArray(adjustmentIds, 450);
      for (const chunk of adjChunks) {
        const adjBatch = db.batch();
        chunk.forEach((id) => {
          adjBatch.update(db.collection("vendor_adjustments").doc(id), {
            status: "settled",
            settlementId,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
        await adjBatch.commit();
      }
    }`;
code = code.replace(regex3, replacement3);

fs.writeFileSync(path, code);
