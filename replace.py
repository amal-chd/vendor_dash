import os

for root, _, files in os.walk('.'):
    if 'node_modules' in root or '.git' in root or 'build' in root or '.dart_tool' in root:
        continue
    for file in files:
        if file.endswith('.dart'):
            path = os.path.join(root, file)
            with open(path, 'r') as f:
                content = f.read()
            if 'FirebaseFunctions.instance' in content:
                content = content.replace('FirebaseFunctions.instance', "FirebaseFunctions.instanceFor(region: 'asia-south1')")
                with open(path, 'w') as f:
                    f.write(content)
