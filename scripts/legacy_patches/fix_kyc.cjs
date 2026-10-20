const fs = require('fs');
let content = fs.readFileSync('/Users/amalchand/Documents/The Kada/src/pages/admin/KycVerificationPage.tsx', 'utf8');

content = content.replace(
  `    if (docs.license) push("aadhaar", "Driving License", docs.license);`,
  `    if (docs.license) push("license", "Driving License", docs.license);\n    if (docs.rc) push("rc", data.vehicle?.number || "Vehicle RC", docs.rc);\n    if (docs.profile) push("profile", "Live Selfie / Profile", docs.profile);`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/src/pages/admin/KycVerificationPage.tsx', content);
