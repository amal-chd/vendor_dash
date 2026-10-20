import os

replacements = {
    "Colors.white": "AppColors.surface",
    "Colors.black": "AppColors.ink",
}

files = [
    "customer_mobile_app/lib/screens/checkout/checkout_screen.dart",
    "customer_mobile_app/lib/screens/checkout/map_picker_screen.dart",
    "customer_mobile_app/lib/screens/profile/addresses_screen.dart",
    "customer_mobile_app/lib/screens/profile/customer_reservations_screen.dart",
    "customer_mobile_app/lib/screens/profile/favorites_screen.dart",
    "customer_mobile_app/lib/screens/profile/gift_cards_screen.dart",
    "customer_mobile_app/lib/screens/profile/kada_gold_screen.dart",
    "customer_mobile_app/lib/screens/kada/kada_stay_checkout_screen.dart",
    "customer_mobile_app/lib/screens/kada/kada_stay_view.dart"
]

for file in files:
    with open(file, 'r') as f:
        content = f.read()
    
    # Do replacements safely
    content = content.replace("Colors.white", "AppColors.surface")
    content = content.replace("Colors.black", "AppColors.ink")
    content = content.replace("Colors.white70", "AppColors.surface.withValues(alpha: 0.7)")

    # specific replacements
    if "kada_gold_screen.dart" in file:
        content = content.replace("const Color(0xFF14120E)", "AppColors.bg")
        content = content.replace("Color(0xFF14120E)", "AppColors.bg")
        content = content.replace("Color(0xFF0A0907)", "AppColors.bg")
        content = content.replace("const Color(0xFF14110C)", "AppColors.bg")
        content = content.replace("const Color(0xFF2A1F04)", "AppColors.goldDeep")
        content = content.replace("Color(0xFF2A1F04)", "AppColors.goldDeep")
        content = content.replace("const Color(0xFF34D399)", "AppColors.success")
        content = content.replace("const Color(0xFF10B981)", "AppColors.success")
        
    if "kada_stay_view.dart" in file:
        content = content.replace("const Color(0xFF0F172A)", "AppColors.ink")
        content = content.replace("Color(0xFF0F172A)", "AppColors.ink")
        content = content.replace("AppColors.surface.withValues(alpha: 0.94)", "AppColors.surfaceHigh.withValues(alpha: 0.94)")
        # we might have over-replaced Colors.white with AppColors.surface where AppColors.surfaceHigh is needed.
        # we can fix floating bar specifically.
        
    if "kada_stay_checkout_screen.dart" in file:
        content = content.replace("const Color(0xFFFFF8E1)", "AppColors.gold.withValues(alpha: 0.1)")
        content = content.replace("Color(0xFFF5A623)", "AppColors.gold")
        content = content.replace("const Color(0xFFB07D10)", "AppColors.goldDeep")
        content = content.replace("const Color(0xFF5C6BC0)", "AppColors.primary")
        content = content.replace("const Color(0xFF26A69A)", "AppColors.success")
        
    with open(file, 'w') as f:
        f.write(content)
