import json
with open('firestore.indexes.json', 'r') as f:
    data = json.load(f)

data['indexes'].append({
  "collectionGroup": "reviews",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    {"fieldPath": "customerUid", "order": "ASCENDING"},
    {"fieldPath": "createdAt", "order": "DESCENDING"}
  ]
})
data['indexes'].append({
  "collectionGroup": "stay_reviews",
  "queryScope": "COLLECTION",
  "fields": [
    {"fieldPath": "customerId", "order": "ASCENDING"},
    {"fieldPath": "createdAt", "order": "DESCENDING"}
  ]
})

with open('firestore.indexes.json', 'w') as f:
    json.dump(data, f, indent=2)
