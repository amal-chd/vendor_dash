const fs = require('fs');
const data = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));

// Filter out single-field indexes from the 'indexes' array.
// Single-field indexes (only 1 field) belong in fieldOverrides, not indexes.
data.indexes = data.indexes.filter(idx => idx.fields.length > 1);

fs.writeFileSync('firestore.indexes.json', JSON.stringify(data, null, 2));
console.log('Fixed indexes');
