class _Header extends StatelessWidget {
  final RiderProfile profile;
  const _Header({required this.profile});

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final name = profile.name.isEmpty ? 'Rider' : profile.name.split(' ').first;
    final ratingStr = profile.rating > 0 ? profile.rating.toStringAsFixed(1) : '4.9';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // ── TOP ROW: PROFILE & GREETING + STATUS TOGGLES ──
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Left: Profile Image & Greeting
            Expanded(
              child: Row(
                children: [
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      CircleAvatar(
                        radius: 24,
                        backgroundColor: RiderColors.primary.withValues(alpha: 0.15),
                        backgroundImage: profile.photoUrl.isNotEmpty
                            ? CachedNetworkImageProvider(profile.photoUrl)
                            : null,
                        child: profile.photoUrl.isEmpty
                            ? const Icon(Icons.person_rounded, color: RiderColors.primary, size: 24)
                            : null,
                      ),
                      Positioned(
                        bottom: -4,
                        right: -4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1.5),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1E293B),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFFFBBF24), width: 1.2),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.star_rounded, color: Color(0xFFFBBF24), size: 9),
                              const SizedBox(width: 2),
                              Text(ratingStr, style: GoogleFonts.plusJakartaSans(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w900)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ).animate().scaleXY(begin: 0.5, end: 1.0, duration: 500.ms, curve: Curves.easeOutBack),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${_greeting()},', style: GoogleFonts.plusJakartaSans(fontSize: 12, fontWeight: FontWeight.w600, color: RiderColors.muted)),
                        Text(name, style: GoogleFonts.plusJakartaSans(fontSize: 18, fontWeight: FontWeight.w900, color: RiderColors.ink, letterSpacing: -0.3)),
                      ],
                    ).animate().fadeIn(delay: 200.ms).slideX(begin: -0.1, end: 0, curve: Curves.easeOut),
                  ),
                ],
              ),
            ),
            
            // Right: Online/Offline Toggle & Notification
            Row(
              children: [
                _CuteToggle(
                  value: profile.isOnline,
                  activeColor: RiderColors.success,
                  inactiveColor: RiderColors.muted,
                  activeIcon: Icons.power_settings_new_rounded,
                  inactiveIcon: Icons.power_settings_new_rounded,
                  activeLabel: 'ONLINE',
                  inactiveLabel: 'OFFLINE',
                  onChanged: (v) async {
                    HapticFeedback.heavyImpact();
                    await RiderService.instance.setOnline(v);
                  },
                ).animate().fadeIn(delay: 300.ms),
                const SizedBox(width: 8),
                _NotificationBell().animate().fadeIn(delay: 200.ms),
              ],
            ),
          ],
        ),
        
        // ── QUICK ACTION TOGGLES: AUTO-ACCEPT & PAUSE ──
        if (profile.isOnline) ...[
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _CuteToggle(
                  value: profile.autoAccept,
                  activeColor: RiderColors.primary,
                  inactiveColor: RiderColors.borderLight,
                  activeIcon: Icons.bolt_rounded,
                  inactiveIcon: Icons.bolt_rounded,
                  activeLabel: 'Auto-Accept ON',
                  inactiveLabel: 'Auto-Accept OFF',
                  inactiveTextColor: RiderColors.muted,
                  onChanged: (v) {
                    HapticFeedback.lightImpact();
                    RiderService.instance.setAutoAccept(v);
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _CuteToggle(
                  value: profile.isPaused,
                  activeColor: const Color(0xFFF59E0B),
                  inactiveColor: RiderColors.borderLight,
                  activeIcon: Icons.pause_circle_filled_rounded,
                  inactiveIcon: Icons.pause_circle_outline_rounded,
                  activeLabel: 'Shift Paused',
                  inactiveLabel: 'Take a Break',
                  inactiveTextColor: RiderColors.muted,
                  onChanged: (v) {
                    HapticFeedback.lightImpact();
                    RiderService.instance.setPaused(v);
                  },
                ),
              ),
            ],
          ).animate().fadeIn(duration: 300.ms).slideY(begin: 0.1, end: 0, curve: Curves.easeOut),
        ],
      ],
    );
  }
}

class _CuteToggle extends StatelessWidget {
  final bool value;
  final Color activeColor;
  final Color inactiveColor;
  final IconData activeIcon;
  final IconData inactiveIcon;
  final String activeLabel;
  final String inactiveLabel;
  final Color? inactiveTextColor;
  final ValueChanged<bool> onChanged;

  const _CuteToggle({
    required this.value,
    required this.activeColor,
    required this.inactiveColor,
    required this.activeIcon,
    required this.inactiveIcon,
    required this.activeLabel,
    required this.inactiveLabel,
    this.inactiveTextColor,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        curve: Curves.elasticOut,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: value ? activeColor.withValues(alpha: 0.15) : inactiveColor.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: value ? activeColor : Colors.transparent,
            width: 1.5,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              transitionBuilder: (child, animation) => ScaleTransition(scale: animation, child: child),
              child: Icon(
                value ? activeIcon : inactiveIcon,
                key: ValueKey(value),
                size: 16,
                color: value ? activeColor : (inactiveTextColor ?? RiderColors.ink),
              ),
            ),
            const SizedBox(width: 6),
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              style: GoogleFonts.plusJakartaSans(
                fontWeight: FontWeight.w800,
                fontSize: 12,
                color: value ? activeColor : (inactiveTextColor ?? RiderColors.ink),
              ),
              child: Text(value ? activeLabel : inactiveLabel),
            ),
          ],
        ),
      ),
    );
  }
}
