const fs = require('fs');
let rules = fs.readFileSync('firestore.rules', 'utf8');

// Insert new match blocks for missing collections before the closing bracket of the database match
const injectionString = `
    match /crm_campaigns/{id} { allow read, write: if isAdmin(); }
    match /crm_segments/{id} { allow read, write: if isAdmin(); }
    match /risk_investigations/{id} { allow read, write: if isAdmin(); }
    match /blocked_entities/{id} { allow read, write: if isAdmin(); }
  }
}
`;

rules = rules.replace(/  \}\n\}\n?$/, injectionString);
fs.writeFileSync('firestore.rules', rules);
