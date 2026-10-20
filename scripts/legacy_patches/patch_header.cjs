const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/home/home_screen.dart', 'utf8');

// Replace the entire _Header class and add _CuteToggle
const newHeader = fs.readFileSync('new_header.dart', 'utf8');
code = code.replace(/class _Header extends StatelessWidget \{[\s\S]*?\n\}\n/, newHeader + '\n\n');

// Also remove _OnlineCard class
code = code.replace(/class _OnlineCard extends StatelessWidget \{[\s\S]*?\n\}\n/g, '');

// Remove _OnlineCard(profile: profile) from build method of HomeScreen
code = code.replace(/\/\/ 3\. Online\/Offline Shift Toggle Card\n\s*_OnlineCard\(profile: profile\)/g, '');
code = code.replace(/\/\/ 3\. Online\/Offline Shift Toggle Card/g, '');

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/home/home_screen.dart', code);
