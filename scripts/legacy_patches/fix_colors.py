import os
import re

def replace_in_file(path, replacements):
    with open(path, 'r') as f:
        content = f.read()
    
    for old, new in replacements:
        content = content.replace(old, new)
        
    with open(path, 'w') as f:
        f.write(content)

replacements = [
    ("Colors.white", "AppColors.surface"),
    ("Colors.black", "AppColors.ink"),
    ("const _DashedDivider({this.color = AppColors.ink});", "const _DashedDivider({this.color});"),
    ("paint.color = color;", "paint.color = color ?? AppColors.ink;")
]

cart_path = "customer_mobile_app/lib/screens/cart/cart_screen.dart"

with open(cart_path, 'r') as f:
    content = f.read()

content = content.replace("Colors.white", "AppColors.surface")
content = content.replace("Colors.black", "AppColors.ink")

# Fix the dashed divider
content = content.replace("const _DashedDivider({this.color = AppColors.ink});", "const _DashedDivider({this.color});")
content = content.replace("paint.color = color;", "paint.color = color ?? AppColors.ink;")
content = content.replace("final Color color;", "final Color? color;")

with open(cart_path, 'w') as f:
    f.write(content)

