#!/bin/bash

# Exit on error
set -e

# Get version from package.json
VERSION=$(node -e "console.log(require('./package.json').version)")
PACKAGE_NAME="barateza-ticket-notifier-$VERSION"
DIST_DIR="dist"
ROOT_DIR=$(pwd)

echo "📦 Packaging $PACKAGE_NAME..."

# 1. Clean and create dist directories
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/package"

# 2. Copy core extension files
echo "📄 Copying files..."
FILES=(
    "background.js"
    "manifest.json"
    "popup.html"
    "popup.js"
    "popup.css"
    "offscreen.html"
    "offscreen.js"
    "PRIVACY_POLICY.md"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$DIST_DIR/package/"
    else
        echo "⚠️ Warning: $file not found!"
    fi
done

# 3. Copy directories
echo "📁 Copying directories..."
cp -R icons "$DIST_DIR/package/"
cp -R utils "$DIST_DIR/package/"

# 4. Create ZIP archive
echo "🤐 Creating zip archive..."
cd "$DIST_DIR/package"
zip -r "../$PACKAGE_NAME.zip" . > /dev/null
cd "$ROOT_DIR"

echo "✅ Packaging complete!"
echo "📍 Zip file: $DIST_DIR/$PACKAGE_NAME.zip"
echo "📂 Unpacked: $DIST_DIR/package/"
ls -lh "$DIST_DIR/$PACKAGE_NAME.zip"
