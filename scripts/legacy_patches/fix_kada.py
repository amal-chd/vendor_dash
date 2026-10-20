import os

files = [
    "customer_mobile_app/lib/screens/kada/kada_stay_view.dart",
]

for file in files:
    with open(file, 'r') as f:
        content = f.read()
    
    content = content.replace("const Color(0xFFFFF8E1)", "AppColors.gold.withValues(alpha: 0.1)")
    content = content.replace("Color(0xFFF5A623)", "AppColors.gold")
    content = content.replace("const Color(0xFFB07D10)", "AppColors.goldDeep")
    
    with open(file, 'w') as f:
        f.write(content)
