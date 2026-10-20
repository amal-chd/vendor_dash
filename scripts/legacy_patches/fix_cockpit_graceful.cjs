const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', 'utf8');

// 1. Change DraggableScrollableSheet sizes to be more compact
code = code.replace(
  `              DraggableScrollableSheet(
                initialChildSize: 0.55,
                minChildSize: 0.3,
                maxChildSize: 0.95,`,
  `              DraggableScrollableSheet(
                initialChildSize: 0.42,
                minChildSize: 0.3,
                maxChildSize: 0.95,`
);

// 2. We will restructure the ListView children to be purely contextual and compact.
// Let's find the start of the ListView children.
const listStart = code.indexOf('children: [\\n                              _buildEtaChip(');
// If it fails to find that exact string, let's use a regex
const listViewMatch = code.match(/child: ListView\([\s\S]*?padding: const EdgeInsets.fromLTRB\(16, 4, 16, 96\),\n\s*children: \[/);

if (!listViewMatch) {
  console.log('Could not find ListView start');
} else {
  // Let's find the end of the ListView children array.
  // It ends before the FloatingActionButton
  const listEndMatch = code.match(/                            \],\n\s*\),\n\s*\),\n\s*\],\n\s*\),\n\s*\);\n\s*},\n\s*\),\n\n\s*\/\/ Navigate Floating Button/);
  
  if (!listEndMatch) {
    console.log('Could not find ListView end');
  } else {
    const startIndex = listViewMatch.index + listViewMatch[0].length;
    const endIndex = listEndMatch.index;
    
    // We replace the entire children array contents with a smarter, contextual structure.
    // Wait, it's easier to just rebuild the 'children' array using the existing widget methods.
    
    const newChildren = `
                              _buildEtaChip(order, drop, cardColor, borderColor),
                              
                              // Batched Orders Warning
                              StreamBuilder<List<DeliveryOrder>>(
                                stream: RiderService.instance.activeDeliveriesStream(),
                                builder: (ctx, batchSnap) {
                                  final list = batchSnap.data ?? [];
                                  if (list.length <= 1) return const SizedBox.shrink();
                                  final others = list.where((o) => o.id != order.id).toList();
                                  if (others.isEmpty) return const SizedBox.shrink();
                                  return Container(
                                    margin: const EdgeInsets.only(top: 12),
                                    padding: const EdgeInsets.all(14),
                                    decoration: BoxDecoration(
                                      color: RiderColors.primary.withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(color: RiderColors.primary.withValues(alpha: 0.3)),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            const Icon(Icons.layers_rounded, size: 20, color: RiderColors.primary),
                                            const SizedBox(width: 10),
                                            Text(
                                              '\${others.length} Batched Order\${others.length > 1 ? 's' : ''} Queued',
                                              style: const TextStyle(
                                                color: RiderColors.primary,
                                                fontSize: 14,
                                                fontWeight: FontWeight.w900,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 8),
                                        ...others.map((o) => Padding(
                                          padding: const EdgeInsets.only(bottom: 4, left: 30),
                                          child: Text(
                                            '• #\${o.orderNumber} (\${o.customerName})',
                                            style: const TextStyle(
                                              fontSize: 13, 
                                              fontWeight: FontWeight.w700,
                                              color: RiderColors.muted
                                            ),
                                          ),
                                        )),
                                      ],
                                    ),
                                  );
                                },
                              ),
                              
                              const SizedBox(height: 14),
                              
                              // Context-Aware Primary Mission Focus
                              if ([DeliveryStage.assigned, DeliveryStage.atRestaurant].contains(order.stage)) ...[
                                _StorePickupFocusCard(
                                  order: order,
                                  cardColor: cardColor,
                                  borderColor: borderColor,
                                  onNavigate: () => _navigate(_pickup),
                                ),
                                const SizedBox(height: 16),
                                _OrderItemsChecklist(
                                    order: order,
                                    cardColor: cardColor,
                                    borderColor: borderColor),
                              ] else ...[
                                _CustomerDropFocusCard(
                                  order: order,
                                  cardColor: cardColor,
                                  borderColor: borderColor,
                                  onNavigate: () => _navigate(drop),
                                  onCall: order.customerPhone.isEmpty ? null : () => _call(order.customerPhone),
                                  onChat: () => Navigator.of(context).push(MaterialPageRoute(
                                    builder: (_) => RiderChatScreen(order: order),
                                  )),
                                  onCorrectPin: isArrivedStage ? () => _correctPin(order) : null,
                                ),
                                if (order.instructions.isNotEmpty) ...[
                                  const SizedBox(height: 12),
                                  _CustomerNoteCard(instructions: order.instructions),
                                ],
                                if (isArrivedStage) ...[
                                  const SizedBox(height: 16),
                                  // Verification Block
                                  Container(
                                    padding: const EdgeInsets.all(16),
                                    decoration: BoxDecoration(
                                      color: verificationDone
                                          ? RiderColors.success.withValues(alpha: 0.1)
                                          : RiderColors.primary.withValues(alpha: 0.08),
                                      borderRadius: BorderRadius.circular(18),
                                      border: Border.all(
                                        color: verificationDone
                                            ? RiderColors.success.withValues(alpha: 0.5)
                                            : RiderColors.primary.withValues(alpha: 0.4),
                                      ),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Icon(
                                              verificationDone
                                                  ? Icons.verified_user_rounded
                                                  : Icons.security_rounded,
                                              color: verificationDone
                                                  ? RiderColors.success
                                                  : RiderColors.primary,
                                            ),
                                            const SizedBox(width: 10),
                                            Expanded(
                                              child: Text(
                                                verificationDone
                                                    ? 'DOORSTEP VERIFIED SUCCESSFULLY'
                                                    : 'DOORSTEP SECURITY VERIFICATION',
                                                style: TextStyle(
                                                  fontWeight: FontWeight.w900,
                                                  fontSize: 12,
                                                  color: verificationDone
                                                      ? RiderColors.success
                                                      : RiderColors.primary,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          verificationDone
                                              ? (_photoCaptured && !_otpVerified
                                                  ? 'Drop-off photo captured. You can now complete the delivery.'
                                                  : 'OTP captured. You can now complete the delivery.')
                                              : (otpNeeded
                                                  ? 'Ask the customer for their 4-digit delivery OTP to confirm the handover. A photo is optional.'
                                                  : 'Capture a drop-off photo, or enter the customer OTP, to complete this delivery.'),
                                          style: const TextStyle(
                                              fontSize: 13, color: RiderColors.muted),
                                        ),
                                        if (!verificationDone) ...[
                                          const SizedBox(height: 14),
                                          Row(
                                            children: [
                                              Expanded(
                                                child: ElevatedButton.icon(
                                                  onPressed: () => _showOtpModal(order),
                                                  style: ElevatedButton.styleFrom(
                                                    backgroundColor: RiderColors.primary,
                                                    foregroundColor: Colors.white,
                                                    minimumSize: const Size(0, 44),
                                                  ),
                                                  icon: const Icon(Icons.pin_rounded,
                                                      size: 18),
                                                  label: const Text('Enter OTP',
                                                      style: TextStyle(fontSize: 13)),
                                                ),
                                              ),
                                              const SizedBox(width: 10),
                                              Expanded(
                                                child: OutlinedButton.icon(
                                                  onPressed: _takePhotoProof,
                                                  style: OutlinedButton.styleFrom(
                                                    minimumSize: const Size(0, 44),
                                                  ),
                                                  icon: const Icon(
                                                      Icons.camera_alt_outlined,
                                                      size: 18),
                                                  label: Text(
                                                      otpNeeded
                                                          ? 'Add Photo'
                                                          : 'Photo Proof',
                                                      style: const TextStyle(fontSize: 13)),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ] else if (_otpVerified && !_photoCaptured) ...[
                                          const SizedBox(height: 12),
                                          OutlinedButton.icon(
                                            onPressed: _takePhotoProof,
                                            style: OutlinedButton.styleFrom(
                                              minimumSize: const Size(0, 40),
                                            ),
                                            icon: const Icon(
                                                Icons.camera_alt_outlined, size: 16),
                                            label: const Text('Add drop-off photo (optional)',
                                                style: TextStyle(fontSize: 12.5)),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                  const SizedBox(height: 16),
                                  _PaymentCard(order: order, cardColor: cardColor),
                                  if (order.isCod) ...[
                                    const SizedBox(height: 12),
                                    _CodChangeCalculator(
                                      amount: order.total,
                                      cardColor: cardColor,
                                    ),
                                    const SizedBox(height: 12),
                                    _CodConfirm(
                                      amount: order.total,
                                      value: _codCollected,
                                      onChanged: (v) => setState(() => _codCollected = v),
                                      cardColor: cardColor,
                                    ),
                                  ],
                                ],
                              ],
                              
                              const SizedBox(height: 24),
                              
                              // View Full Details Button
                              OutlinedButton.icon(
                                onPressed: () => _showOrderDetailsSheet(context, order, drop, cardColor, borderColor),
                                icon: const Icon(Icons.info_outline_rounded, size: 18),
                                label: const Text('View Full Order Details'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(vertical: 14),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                                ),
                              ),
`;

    code = code.substring(0, startIndex) + '\\n' + newChildren + '\\n' + code.substring(endIndex);
  }
}

// 3. Inject the _showOrderDetailsSheet method near the bottom
const orderDetailsMethod = `
  void _showOrderDetailsSheet(BuildContext context, DeliveryOrder order, LatLng? drop, Color cardColor, Color borderColor) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          decoration: BoxDecoration(
            color: Theme.of(ctx).scaffoldBackgroundColor,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  height: 4,
                  width: 48,
                  margin: const EdgeInsets.only(bottom: 24),
                  decoration: BoxDecoration(
                    color: RiderColors.muted.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const Text('Full Order Details', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
              const SizedBox(height: 16),
              _StageStepper(stage: order.stage),
              const SizedBox(height: 16),
              _CompactOriginPreview(
                title: 'RESTAURANT',
                restaurantName: order.restaurantName,
                orderNumber: order.orderNumber,
                itemCount: order.itemCount,
                cardColor: cardColor,
                borderColor: borderColor,
              ),
              const SizedBox(height: 12),
              _CompactDestinationPreview(
                title: 'CUSTOMER',
                name: order.customerName,
                address: order.deliveryAddressText,
                cardColor: cardColor,
                borderColor: borderColor,
                onCall: order.customerPhone.isEmpty ? null : () => _call(order.customerPhone),
                onChat: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => RiderChatScreen(order: order))),
              ),
              const SizedBox(height: 12),
              _TripEarningsCard(order: order, cardColor: cardColor, borderColor: borderColor),
            ],
          ),
        );
      },
    );
  }
`;

code = code.replace(
  `  Widget _buildEtaChip(DeliveryOrder order, LatLng? drop, Color cardColor,`,
  orderDetailsMethod + '\\n  Widget _buildEtaChip(DeliveryOrder order, LatLng? drop, Color cardColor,'
);

// We should also remove the old Floating Action Button to ensure it doesn't clutter the screen,
// because both _StorePickupFocusCard and _CustomerDropFocusCard already have "Navigate" buttons!
code = code.replace(
  `              // Navigate Floating Button
              Positioned(
                bottom: 110,
                right: 16,
                child: FloatingActionButton.extended(
                  heroTag: 'nav_btn_floating',
                  onPressed: () => _navigate(
                      [DeliveryStage.assigned, DeliveryStage.atRestaurant]
                              .contains(order.stage)
                          ? _pickup
                          : drop),
                  backgroundColor: RiderColors.primary,
                  foregroundColor: Colors.white,
                  elevation: 8,
                  icon: const Icon(Icons.directions_rounded),
                  label: const Text('Navigate',
                      style: TextStyle(fontWeight: FontWeight.w800)),
                ),
              ),`,
  ``
);

// We should also fix the CheckboxListTile that caused a crash earlier
code = code.replace(
  `    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDark ? RiderColors.cardDark : RiderColors.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: CheckboxListTile(`,
  `    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: isDark ? RiderColors.cardDark : RiderColors.surface,
        borderRadius: BorderRadius.circular(16),
        child: CheckboxListTile(`
);

// The CheckboxListTile at the bottom for COD
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
console.log('Restructured carefully!');
