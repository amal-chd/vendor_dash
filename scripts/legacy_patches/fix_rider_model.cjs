const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/models/models.dart', 'utf8');

// Add fields
code = code.replace(
  `    this.onTimeRate = 1.0,\n  });`,
  `    this.onTimeRate = 1.0,\n    this.autoAccept = false,\n    this.isPaused = false,\n  });`
);
code = code.replace(
  `  final double onTimeRate;`,
  `  final double onTimeRate;\n  final bool autoAccept;\n  final bool isPaused;`
);

// Add to fromDoc
code = code.replace(
  `      isOnline: d['isOnline'] == true,`,
  `      isOnline: d['isOnline'] == true,\n      autoAccept: d['autoAccept'] == true,\n      isPaused: d['isPaused'] == true,`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/models/models.dart', code);
