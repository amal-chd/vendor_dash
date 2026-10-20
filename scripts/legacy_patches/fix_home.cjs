const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/home/home_screen.dart', 'utf8');

code = code.replace(
  `          const SizedBox(height: 24),
              ],

          // ── ACTION BUTTON: GO ONLINE / GO OFFLINE ──
          if (!isOnline)`,
  `          const SizedBox(height: 24),

          // ── ACTION BUTTON: GO ONLINE / GO OFFLINE ──
          if (!isOnline)`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/home/home_screen.dart', code);
console.log('Fixed home_screen.dart syntax errors!');
