const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', 'utf8');

// Find _payoutCard and remove it
const pStart = code.indexOf('  Widget _payoutCard(RiderProfile p');
if (pStart !== -1) {
  const pEnd = code.indexOf('  Future<void> _requestPayout(RiderProfile p) async {');
  if (pEnd !== -1) {
    code = code.substring(0, pStart) + code.substring(pEnd);
  }
}

// Find _requestPayout and remove it since it's now inside _WalletCardState
const rStart = code.indexOf('  Future<void> _requestPayout(RiderProfile p) async {');
if (rStart !== -1) {
  const rEnd = code.indexOf('  Widget _netStat(String label');
  if (rEnd !== -1) {
    code = code.substring(0, rStart) + code.substring(rEnd);
  }
}

// Find _CashCard and remove it
const cCardStart = code.indexOf('class _CashCard extends StatelessWidget {');
if (cCardStart !== -1) {
  // It's the last class before _RequestPayoutCard or the end of the file
  const cCardEnd = code.indexOf('class _RequestPayoutCard extends StatefulWidget {');
  if (cCardEnd !== -1) {
    code = code.substring(0, cCardStart) + code.substring(cCardEnd);
  } else {
    // maybe it goes until _WalletCard
    const wCardStart = code.indexOf('class _WalletCard extends StatefulWidget {');
    if (wCardStart !== -1) {
       code = code.substring(0, cCardStart) + code.substring(wCardStart);
    }
  }
}

// And remove _RequestPayoutCard if it's there
const reqCardStart = code.indexOf('class _RequestPayoutCard extends StatefulWidget {');
if (reqCardStart !== -1) {
  const wCardStart2 = code.indexOf('class _WalletCard extends StatefulWidget {');
  if (wCardStart2 !== -1) {
    code = code.substring(0, reqCardStart) + code.substring(wCardStart2);
  } else {
    code = code.substring(0, reqCardStart);
  }
}

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', code);
