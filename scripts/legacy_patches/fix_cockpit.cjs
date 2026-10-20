const fs = require('fs');

let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', 'utf8');

const batchedOrders = fs.readFileSync('batched_orders.txt', 'utf8');
const verificationBlock = fs.readFileSync('verification_block.txt', 'utf8');

const newBody = `      body: StreamBuilder<DeliveryOrder>(
        stream: RiderService.instance.orderStream(widget.orderId),
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final order = snap.data!;
          final drop = (order.dropLat != null && order.dropLng != null)
              ? LatLng(order.dropLat!, order.dropLng!)
              : null;
          if (order.stage == DeliveryStage.delivered) {
            return _DeliveredView(order: order);
          }
          final isArrivedStage = order.stage == DeliveryStage.arrived;
          final otpNeeded = order.otpRequired;
          final verificationDone =
              otpNeeded ? _otpVerified : (_otpVerified || _photoCaptured);

          return Stack(
            children: [
              Positioned.fill(
                child: _buildMap(drop),
              ),
              Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  decoration: BoxDecoration(
                    color: Theme.of(context).scaffoldBackgroundColor,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.15),
                        blurRadius: 16,
                        offset: const Offset(0, -4),
                      ),
                    ],
                  ),
                  child: SafeArea(
                    top: false,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(height: 12),
                        Center(
                          child: Container(
                            height: 4,
                            width: 48,
                            decoration: BoxDecoration(
                              color: RiderColors.muted.withValues(alpha: 0.3),
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                        Flexible(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _buildEtaChip(order, drop, cardColor, borderColor),
                                
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
                                
                                const SizedBox(height: 12),
                                
                                if ([DeliveryStage.assigned, DeliveryStage.atRestaurant].contains(order.stage)) ...[
                                  _StorePickupFocusCard(
                                    order: order,
                                    cardColor: cardColor,
                                    borderColor: borderColor,
                                    onNavigate: () => _navigate(_pickup),
                                  ),
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
                                    const SizedBox(height: 12),
                                    // verification block
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
                                                    letterSpacing: 0.8,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 12),
                                          if (verificationDone)
                                            const Text(
                                              'Order securely verified. You can now handover the items to the customer.',
                                              style: TextStyle(
                                                  fontSize: 13,
                                                  fontWeight: FontWeight.w600,
                                                  color: RiderColors.muted),
                                            )
                                          else if (otpNeeded)
                                            _buildOtpSection(order)
                                          else
                                            _buildPhotoVerificationSection(order),
                                        ],
                                      ),
                                    ),
                                  ],
                                ],
                                
                                const SizedBox(height: 16),
                                
                                OutlinedButton.icon(
                                  onPressed: () => _showOrderDetailsSheet(context, order, drop, cardColor, borderColor),
                                  icon: const Icon(Icons.info_outline_rounded, size: 18),
                                  label: const Text('View Full Order Details'),
                                  style: OutlinedButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(vertical: 12),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        
                        _SwipeToConfirm(
                          label: _actionLabel(order.stage),
                          stage: order.stage,
                          busy: _busy,
                          enabled: !isArrivedStage || (verificationDone && (!order.isCod || _codCollected)),
                          onConfirm: () => _advance(order),
                          cardColor: cardColor,
                          borderColor: borderColor,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

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

const startIndex = code.indexOf('      body: StreamBuilder<DeliveryOrder>(');
const endIndex = code.indexOf('  Widget _buildEtaChip(DeliveryOrder order, LatLng? drop, Color cardColor,');

if (startIndex !== -1 && endIndex !== -1) {
  code = code.substring(0, startIndex) + newBody + '\n' + code.substring(endIndex);
  fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', code);
  console.log('Successfully replaced body!');
} else {
  console.log('Could not find start or end index!');
}
