const fs = require('fs');
const indexesPath = '/Users/amalchand/Documents/The Kada/firestore.indexes.json';
const data = JSON.parse(fs.readFileSync(indexesPath, 'utf8'));

data.indexes.push({
  "collectionGroup": "referrals",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "referrerUid", "order": "ASCENDING" },
    { "fieldPath": "participantType", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
});

fs.writeFileSync(indexesPath, JSON.stringify(data, null, 2));
console.log('Done');
