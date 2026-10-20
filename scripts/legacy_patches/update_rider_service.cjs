const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/services/rider_service.dart', 'utf8');

const depositCode = `
  Future<void> requestDeposit({
    required double amount,
    required String referenceNumber,
    String? riderName,
    String? phone,
  }) async {
    final uid = _uid;
    if (uid == null) throw Exception('Please log in first.');
    if (referenceNumber.trim().isEmpty) {
      throw Exception('Please enter a valid reference number.');
    }

    final batch = _db.batch();
    final reqRef = _db.collection('payout_requests').doc();
    batch.set(reqRef, {
      'riderUid': uid,
      'riderId': uid,
      'riderName': riderName ?? 'Rider',
      'phone': phone ?? '',
      'amount': amount,
      'referenceNumber': referenceNumber.trim(),
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'type': 'Rider Deposit',
    });
    batch.set(
      _db.collection('delivery_users').doc(uid),
      {
        'depositPending': true,
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );
    await batch.commit();
  }
`;

code = code.replace(
  `  Future<void> requestPayout({`,
  depositCode + `\n  Future<void> requestPayout({`
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/services/rider_service.dart', code);
