const fs = require('fs');
let code = fs.readFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', 'utf8');

// 1. Fix the CheckboxListTile that caused a framework crash earlier
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

// 2. Replace DraggableScrollableSheet with Align + SingleChildScrollView
code = code.replace(
  `              // 2. Sliding Details Sheet
              DraggableScrollableSheet(
                initialChildSize: 0.55,
                minChildSize: 0.3,
                maxChildSize: 0.95,
                snap: true,
                builder: (context, scrollController) {
                  return Container(
                    decoration: BoxDecoration(
                      color: theme.scaffoldBackgroundColor,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.15),
                          blurRadius: 16,
                          offset: const Offset(0, -4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        Center(
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 12),
                            height: 4,
                            width: 48,
                            decoration: BoxDecoration(
                              color: RiderColors.muted.withValues(alpha: 0.3),
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                        Expanded(
                          child: ListView(
                            controller: scrollController,
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
                            children: [
                              _buildEtaChip(order, drop, cardColor, borderColor),`,
  `              Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  decoration: BoxDecoration(
                    color: theme.scaffoldBackgroundColor,
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
                                _buildEtaChip(order, drop, cardColor, borderColor),`
);

// 3. Remove StageStepper
code = code.replace(
  `                              const SizedBox(height: 14),
                              _StageStepper(stage: order.stage),
                              const SizedBox(height: 18),`,
  `                              const SizedBox(height: 14),`
);

// 4. Remove CompactDestinationPreview
code = code.replace(
  `                                const SizedBox(height: 12),
                                _CompactDestinationPreview(
                                  title: 'UPCOMING DROP-OFF',
                                  name: order.customerName,
                                  address: order.deliveryAddressText,
                                  cardColor: cardColor,
                                  borderColor: borderColor,
                                  onCall: order.customerPhone.isEmpty ? null : () => _call(order.customerPhone),
                                  onChat: () => Navigator.of(context).push(MaterialPageRoute(
                                    builder: (_) => RiderChatScreen(order: order),
                                  )),
                                ),`,
  ``
);

// 5. Remove CompactOriginPreview
code = code.replace(
  `                                const SizedBox(height: 12),
                                _CompactOriginPreview(
                                  title: 'PICKED UP FROM',
                                  restaurantName: order.restaurantName,
                                  orderNumber: order.orderNumber,
                                  itemCount: order.itemCount,
                                  cardColor: cardColor,
                                  borderColor: borderColor,
                                ),`,
  ``
);

// 6. Replace TripEarningsCard with View Order Details button
code = code.replace(
  `                              const SizedBox(height: 14),
                              _TripEarningsCard(order: order, cardColor: cardColor, borderColor: borderColor),`,
  `                              const SizedBox(height: 16),
                              OutlinedButton.icon(
                                onPressed: () => _showOrderDetailsSheet(context, order, drop, cardColor, borderColor),
                                icon: const Icon(Icons.info_outline_rounded, size: 18),
                                label: const Text('View Full Order Details'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(vertical: 12),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                ),
                              ),`
);

// 7. Remove floating navigation button & close Column and container properly
// Note: We need to match the original code carefully. Let's look at lines ~780-820
code = code.replace(
  `                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),

              // Navigate Floating Button
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
              ),

              // Sticky Swipe to Confirm Button at Bottom
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _SwipeToConfirm(`,
  `                            ],
                            ),
                          ),
                        ),
                        // Sticky Swipe to Confirm Button at Bottom
                        _SwipeToConfirm(`
);

// 8. Add _showOrderDetailsSheet method
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
  orderDetailsMethod + '\n  Widget _buildEtaChip(DeliveryOrder order, LatLng? drop, Color cardColor,'
);

fs.writeFileSync('/Users/amalchand/Documents/The Kada/delivery_mobile_app/lib/screens/delivery/active_delivery_screen.dart', code);
console.log('Applied compaction changes!');
