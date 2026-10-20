const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/models/models.dart', 'utf8');

code = code.replace(
  /  double get availableForPayout \{\n\s*final v = earningsLifetime - paidOut;\n\s*return v > 0 \? v : 0;\n\s*\}/,
  `  double get netBalance => earningsLifetime - paidOut - cashInHand;

  double get availableForPayout {
    return netBalance > 0 ? netBalance : 0;
  }
  
  double get amountOwedToPlatform {
    return netBalance < 0 ? -netBalance : 0;
  }`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/models/models.dart', code);
