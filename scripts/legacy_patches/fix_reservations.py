import os

file = "customer_mobile_app/lib/screens/profile/customer_reservations_screen.dart"

with open(file, 'r') as f:
    content = f.read()

content = content.replace("const Color(0xFFF59E0B)", "AppColors.gold")
content = content.replace("const Color(0xFFD97706)", "AppColors.goldDeep")

with open(file, 'w') as f:
    f.write(content)
