const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', 'utf8');

code = code.replace(
  `    return Container(
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: CheckboxListTile(`,
  `    return Material(
      color: cardColor,
      borderRadius: BorderRadius.circular(16),
      child: CheckboxListTile(`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', code);
