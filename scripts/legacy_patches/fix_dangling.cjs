const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/home/home_screen.dart', 'utf8');

code = code.replace(/^[ \t]*\.animate\(effects: AppMotion\.entrance\(1\)\),/gm, '');
fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/home/home_screen.dart', code);
