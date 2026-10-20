const fs = require('fs');
const data = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));

data.indexes.push({
  "collectionGroup": "orders",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "restaurantId",
      "order": "ASCENDING"
    },
    {
      "fieldPath": "timestamp",
      "order": "ASCENDING"
    }
  ]
});

fs.writeFileSync('firestore.indexes.json', JSON.stringify(data, null, 2));
console.log('Done');
