const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', 'utf8');

// I will just find class _CashCard extends StatelessWidget { and delete its entire body.
// It ends with   }
// }
const cashCardMatch = code.match(/class _CashCard extends StatelessWidget \{[\s\S]*?\n\}\n/);
if (cashCardMatch) {
  code = code.replace(cashCardMatch[0], '');
}

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', code);
