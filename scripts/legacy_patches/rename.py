import os
import re
import sys

def rename_app(app_dir, new_name):
    # Android
    android_manifest = os.path.join(app_dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
    if os.path.exists(android_manifest):
        with open(android_manifest, 'r') as f:
            content = f.read()
        
        # Replace android:label="..."
        content = re.sub(r'android:label="[^"]*"', f'android:label="{new_name}"', content)
        
        with open(android_manifest, 'w') as f:
            f.write(content)
        print(f"Updated {android_manifest}")

    # iOS
    ios_plist = os.path.join(app_dir, 'ios', 'Runner', 'Info.plist')
    if os.path.exists(ios_plist):
        with open(ios_plist, 'r') as f:
            content = f.read()
        
        # Replace CFBundleDisplayName
        content = re.sub(r'<key>CFBundleDisplayName</key>\s*<string>[^<]*</string>', f'<key>CFBundleDisplayName</key>\n\t<string>{new_name}</string>', content)
        
        # Replace CFBundleName (often the same, or app identifier, but let's update it if needed)
        content = re.sub(r'<key>CFBundleName</key>\s*<string>[^<]*</string>', f'<key>CFBundleName</key>\n\t<string>{new_name}</string>', content)
        
        with open(ios_plist, 'w') as f:
            f.write(content)
        print(f"Updated {ios_plist}")

if __name__ == "__main__":
    app_dir = sys.argv[1]
    new_name = sys.argv[2]
    rename_app(app_dir, new_name)
