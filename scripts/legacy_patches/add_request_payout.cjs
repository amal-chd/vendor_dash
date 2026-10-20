const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', 'utf8');

const buttonCode = `
                if (uid != null)
                  _RequestPayoutCard(profile: p).animate(effects: AppMotion.entrance(_timePeriod == 0 ? 5 : 6)),
                const SizedBox(height: 16),
`;

code = code.replace(
  `if (p.cashInHand > 0) const SizedBox(height: 16),`,
  `if (p.cashInHand > 0) const SizedBox(height: 16),\n` + buttonCode
);

const widgetCode = `
class _RequestPayoutCard extends StatefulWidget {
  final RiderProfile profile;
  const _RequestPayoutCard({required this.profile});
  @override
  State<_RequestPayoutCard> createState() => _RequestPayoutCardState();
}

class _RequestPayoutCardState extends State<_RequestPayoutCard> {
  bool _loading = false;
  Future<void> _request() async {
    final balance = widget.profile.earningsLifetime - widget.profile.paidOut;
    if (balance < 500) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Minimum ₹500 required to request a payout.')));
      return;
    }
    setState(() => _loading = true);
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) return;
      await FirebaseFirestore.instance.collection('payout_requests').add({
        'riderId': uid,
        'riderName': widget.profile.name,
        'phone': widget.profile.phone,
        'amount': balance,
        'status': 'Pending',
        'createdAt': FieldValue.serverTimestamp(),
        'type': 'Rider Payout',
        'bankDetails': widget.profile.bank,
      });
      // Optionally update rider document to show pending payout
      await FirebaseFirestore.instance.collection('delivery_users').doc(uid).update({
        'payoutPending': true,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Payout requested successfully!')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final balance = widget.profile.earningsLifetime - widget.profile.paidOut;
    final pending = widget.profile.payoutPending;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RiderColors.primary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: RiderColors.primary.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Available Balance', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: RiderColors.muted)),
                const SizedBox(height: 4),
                Text(Money.inr(balance), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 22, color: RiderColors.ink)),
              ],
            ),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: pending ? RiderColors.muted : RiderColors.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              elevation: 0,
            ),
            onPressed: pending || _loading ? null : _request,
            child: _loading 
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : Text(pending ? 'Pending' : 'Request Payout', style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}
`;

// Append widgetCode to the end of the file
code += '\n' + widgetCode;

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', code);
