const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/models/models.dart', 'utf8');

code = code.replace(
  `  final bool payoutPending;`,
  `  final bool payoutPending;\n  final bool depositPending;`
);

code = code.replace(
  `    this.payoutPending = false,`,
  `    this.payoutPending = false,\n    this.depositPending = false,`
);

code = code.replace(
  `      payoutPending: d['payoutPending'] == true,`,
  `      payoutPending: d['payoutPending'] == true,\n      depositPending: d['depositPending'] == true,`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/models/models.dart', code);
