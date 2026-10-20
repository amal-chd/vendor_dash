const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', 'utf8');

// 1. Add import
if (!code.includes('package:cloud_firestore/cloud_firestore.dart')) {
  code = "import 'package:cloud_firestore/cloud_firestore.dart';\n" + code;
}

// 2. Replace UI usages
code = code.replace(
  `                _payoutCard(p, cardColor, borderColor)
                    .animate(effects: AppMotion.entrance(_timePeriod == 0 ? 3 : 4)),

                if (p.cashInHand > 0) ...[
                  const SizedBox(height: 14),
                  _CashCard(amount: p.cashInHand)
                      .animate(effects: AppMotion.entrance(_timePeriod == 0 ? 4 : 5)),
                ],`,
  `                _WalletCard(p: p, cardColor: cardColor, borderColor: borderColor)
                    .animate(effects: AppMotion.entrance(_timePeriod == 0 ? 3 : 4)),`
);

code = code.replace(
  `                _payoutCard(p, cardColor, borderColor)
                    .animate(effects: AppMotion.entrance(_timePeriod == 0 ? 3 : 4)),

                if (p.cashInHand > 0) const SizedBox(height: 16),
                if (p.cashInHand > 0)
                  _CashCard(amount: p.cashInHand)
                      .animate(effects: AppMotion.entrance(_timePeriod == 0 ? 4 : 5)),`,
  `                _WalletCard(p: p, cardColor: cardColor, borderColor: borderColor)
                    .animate(effects: AppMotion.entrance(_timePeriod == 0 ? 3 : 4)),`
);

// Delete _payoutCard function
const pStart = code.indexOf('  Widget _payoutCard(RiderProfile p');
if (pStart !== -1) {
  const pEnd = code.indexOf('  Future<void> _requestPayout(RiderProfile p) async {');
  if (pEnd !== -1) {
    code = code.substring(0, pStart) + code.substring(pEnd);
  }
}

// Delete _requestPayout function
const rStart = code.indexOf('  Future<void> _requestPayout(RiderProfile p) async {');
if (rStart !== -1) {
  const rEnd = code.indexOf('  Widget _netStat(String label');
  if (rEnd !== -1) {
    code = code.substring(0, rStart) + code.substring(rEnd);
  }
}

// Delete _CashCard class properly
const cashCardMatch = code.match(/class _CashCard extends StatelessWidget \{[\s\S]*?\n\}\n/);
if (cashCardMatch) {
  code = code.replace(cashCardMatch[0], '');
}

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', code);
