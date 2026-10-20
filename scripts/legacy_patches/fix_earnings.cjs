const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', 'utf8');

// Replace _payoutCard and _CashCard references in build
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

// We should also replace the old _payoutCard implementation and _CashCard implementation with _WalletCard and _requestDeposit
const oldPayoutCardStart = `  Widget _payoutCard(RiderProfile p, Color cardColor, Color borderColor) {`;
const oldCashCardEnd = `  Widget _netDivider(Color borderColor) {`; // wait _CashCard is much lower.

// I will just use sed or string manipulation to insert the WalletCard and remove old ones later if they conflict.
// Actually, I can just inject _WalletCard and not use _payoutCard. _CashCard might be at the bottom, I can leave it or remove it.

const newWalletCard = `
class _WalletCard extends StatefulWidget {
  final RiderProfile p;
  final Color cardColor;
  final Color borderColor;
  const _WalletCard({required this.p, required this.cardColor, required this.borderColor});
  @override
  State<_WalletCard> createState() => _WalletCardState();
}

class _WalletCardState extends State<_WalletCard> {

  Future<void> _requestPayoutLocal(RiderProfile p) async {
    final upiCtl = TextEditingController(
      text: (p.bank['upiId'] ?? '').toString(),
    );
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(left: 24, right: 24, top: 18, bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Theme.of(ctx).dividerColor, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 18),
            Text('Withdraw \${Money.inr(p.availableForPayout)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20)),
            const SizedBox(height: 4),
            const Text('Enter the UPI ID where you want to receive your payout. Kada ops settles requests within 24 hours.', style: TextStyle(fontSize: 13, color: RiderColors.muted)),
            const SizedBox(height: 16),
            TextField(
              controller: upiCtl,
              autofocus: true,
              decoration: const InputDecoration(hintText: 'yourname@bank', prefixIcon: Icon(Icons.account_balance_rounded), border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Request Payout', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    final upi = upiCtl.text.trim();
    if (!upi.contains('@')) {
      messenger.showSnackBar(const SnackBar(content: Text('Enter a valid UPI ID (name@bank).')));
      return;
    }
    try {
      HapticFeedback.mediumImpact();
      await RiderService.instance.requestPayout(upiId: upi, amount: p.availableForPayout, riderName: p.name, phone: p.phone);
      messenger.showSnackBar(const SnackBar(content: Text('Payout requested! Kada ops will settle it shortly.'), backgroundColor: RiderColors.success));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not request payout: $e')));
    }
  }

  Future<void> _requestDepositLocal(RiderProfile p) async {
    final utrCtl = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).cardColor,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(left: 24, right: 24, top: 18, bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Theme.of(ctx).dividerColor, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 18),
            Text('Deposit \${Money.inr(p.amountOwedToPlatform)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: RiderColors.danger)),
            const SizedBox(height: 4),
            const Text('Please pay the exact amount to Kada Operations UPI:', style: TextStyle(fontSize: 13, color: RiderColors.ink)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: RiderColors.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
              child: const Row(
                children: [
                  Icon(Icons.qr_code_2_rounded, color: RiderColors.primary),
                  SizedBox(width: 12),
                  Expanded(child: Text('kada@upi', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: RiderColors.primary))),
                ],
              ),
            ),
            const SizedBox(height: 16),
            const Text('Once paid, enter the 12-digit UTR/Reference number below:', style: TextStyle(fontSize: 13, color: RiderColors.muted)),
            const SizedBox(height: 8),
            TextField(
              controller: utrCtl,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: 'e.g. 312345678901', prefixIcon: Icon(Icons.numbers_rounded), border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: RiderColors.danger),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('I Have Paid', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    final utr = utrCtl.text.trim();
    if (utr.isEmpty || utr.length < 6) {
      messenger.showSnackBar(const SnackBar(content: Text('Please enter a valid Reference/UTR number.')));
      return;
    }
    try {
      HapticFeedback.mediumImpact();
      await RiderService.instance.requestDeposit(amount: p.amountOwedToPlatform, referenceNumber: utr, riderName: p.name, phone: p.phone);
      messenger.showSnackBar(const SnackBar(content: Text('Deposit requested! Pending ops verification.'), backgroundColor: RiderColors.success));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not request deposit: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.p;
    final netBalance = p.netBalance;
    final available = p.availableForPayout;
    final owes = p.amountOwedToPlatform;

    String title;
    IconData icon;
    Color color;
    String amountText;
    String desc;

    if (netBalance > 0) {
      title = 'AVAILABLE FOR PAYOUT';
      icon = Icons.account_balance_wallet_rounded;
      color = RiderColors.success;
      amountText = Money.inr(available);
      desc = 'Platform owes you (Earnings > COD Cash)';
    } else if (netBalance < 0) {
      title = 'AMOUNT TO DEPOSIT';
      icon = Icons.warning_rounded;
      color = RiderColors.danger;
      amountText = Money.inr(owes);
      desc = 'You owe the platform (COD Cash > Earnings)';
    } else {
      title = 'BALANCE CLEARED';
      icon = Icons.check_circle_rounded;
      color = RiderColors.muted;
      amountText = Money.inr(0);
      desc = 'Earnings perfectly balance collected COD cash';
    }

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: widget.cardColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: widget.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(title,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.plusJakartaSans(
                        fontWeight: FontWeight.w900,
                        fontSize: 11.5,
                        letterSpacing: 0.9,
                        color: RiderColors.muted)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(amountText,
              style: GoogleFonts.plusJakartaSans(
                  fontWeight: FontWeight.w900,
                  fontSize: 28,
                  color: RiderColors.ink)),
          const SizedBox(height: 2),
          Text(desc, style: GoogleFonts.plusJakartaSans(fontSize: 12, color: RiderColors.muted)),
          const SizedBox(height: 14),
          
          if (netBalance > 0) ...[
            if (p.payoutPending)
              _pendingPill('Payout requested — awaiting settlement', RiderColors.primary)
            else if (available >= 100)
              _actionButton('Request Payout', Icons.north_east_rounded, RiderColors.primary, () => _requestPayoutLocal(p))
            else
              Text('Earn \${Money.inr(100 - available)} more to withdraw (min ₹100)', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: RiderColors.muted)),
          ] else if (netBalance < 0) ...[
            if (p.depositPending)
              _pendingPill('Deposit verification pending', RiderColors.warning)
            else
              _actionButton('Deposit COD Cash', Icons.payment_rounded, RiderColors.danger, () => _requestDepositLocal(p)),
          ] else ...[
             _pendingPill('All settled ✨', RiderColors.success)
          ],
        ],
      ),
    );
  }

  Widget _pendingPill(String text, Color color) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(Icons.hourglass_top_rounded, color: color, size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: GoogleFonts.plusJakartaSans(fontWeight: FontWeight.w700, fontSize: 12.5, color: color))),
        ],
      ),
    );
  }

  Widget _actionButton(String label, IconData icon, Color color, VoidCallback onTap) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(backgroundColor: color),
        onPressed: onTap,
        icon: Icon(icon, size: 18),
        label: Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
      ),
    );
  }
}
`;

// Append newWalletCard at the end. It's inside the file so it's private.
code += '\n' + newWalletCard;

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/earnings/earnings_screen.dart', code);
