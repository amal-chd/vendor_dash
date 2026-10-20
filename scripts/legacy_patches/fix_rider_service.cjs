const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/services/rider_service.dart', 'utf8');

const newMethods = `
  Future<void> setAutoAccept(bool auto) async {
    final uid = _uid;
    if (uid == null) return;
    await _db.collection('delivery_users').doc(uid).set({'autoAccept': auto}, SetOptions(merge: true));
  }

  Future<void> setPaused(bool paused) async {
    final uid = _uid;
    if (uid == null) return;
    await _db.collection('delivery_users').doc(uid).set({'isPaused': paused}, SetOptions(merge: true));
  }
`;

code = code.replace(
  `  Future<void> setOnline(bool online) async {`,
  newMethods + `\n  Future<void> setOnline(bool online) async {`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/services/rider_service.dart', code);
