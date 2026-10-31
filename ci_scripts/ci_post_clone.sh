#!/bin/sh
set -e

echo "=========================================================="
echo "==> Running Xcode Cloud Root ci_post_clone.sh"
echo "=========================================================="

# 1. Determine the repository root
if [ -n "$CI_PRIMARY_REPOSITORY_PATH" ]; then
    REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
    REPO_ROOT="$(git rev-parse --show-toplevel)"
else
    REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

echo "==> REPO_ROOT: $REPO_ROOT"
echo "==> CI_PRODUCT: $CI_PRODUCT"
echo "==> CI_PROJECT_FILE_PATH: $CI_PROJECT_FILE_PATH"

# 2. Install Flutter SDK if not already available
export FLUTTER_ROOT="$HOME/flutter"
if ! command -v flutter >/dev/null 2>&1; then
    if [ ! -d "$FLUTTER_ROOT" ]; then
        echo "==> Flutter not found in PATH. Cloning Flutter SDK (stable channel)..."
        git clone --depth 1 -b stable https://github.com/flutter/flutter.git "$FLUTTER_ROOT"
    fi
    export PATH="$FLUTTER_ROOT/bin:$PATH"
fi

echo "==> Flutter version:"
flutter --version

flutter config --no-analytics

# 3. Pre-cache iOS engine artifacts
echo "==> Precaching Flutter iOS artifacts..."
flutter precache --ios

# 4. Ensure CocoaPods is installed
if ! command -v pod >/dev/null 2>&1; then
    echo "==> Installing CocoaPods via Homebrew..."
    HOMEBREW_NO_AUTO_UPDATE=1 brew install cocoapods
fi

echo "==> CocoaPods version:"
pod --version

prepare_app() {
    APP_NAME="$1"
    APP_DIR="$REPO_ROOT/$APP_NAME"
    if [ -d "$APP_DIR" ]; then
        echo "==> Preparing $APP_NAME..."
        cd "$APP_DIR"
        flutter pub get
        cd "$APP_DIR/ios"
        pod install
        if [ ! -f "$APP_DIR/ios/Flutter/Generated.xcconfig" ]; then
            echo "ERROR: Generated.xcconfig was not found in $APP_DIR/ios/Flutter!"
            exit 1
        fi
        echo "==> $APP_NAME prepared successfully."
    fi
}

# 5. Check what product/project is being built
case "$CI_PROJECT_FILE_PATH" in
    *vendor_mobile_app*)
        prepare_app "vendor_mobile_app"
        ;;
    *customer_mobile_app*)
        prepare_app "customer_mobile_app"
        ;;
    *)
        case "$CI_PRODUCT" in
            *"Dine"*|*"vendor"*|*"Vendor"*)
                prepare_app "vendor_mobile_app"
                ;;
            *"Kada"*|*"customer"*|*"Customer"*)
                prepare_app "customer_mobile_app"
                ;;
            *)
                # If unspecified, prepare both so any Xcode Cloud workflow will succeed
                echo "==> Preparing both customer_mobile_app and vendor_mobile_app..."
                prepare_app "customer_mobile_app"
                prepare_app "vendor_mobile_app"
                ;;
        esac
        ;;
esac

echo "==> All Xcode Cloud post-clone setup completed successfully! Proceeding to Xcode build."
exit 0
