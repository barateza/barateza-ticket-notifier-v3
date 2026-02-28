#!/bin/bash

# Exit on error
set -e

# 1. Source of Truth: Read version from manifest.json (not package.json)
# This ensures the artifact name matches the actual extension version Chrome sees.
VERSION=$(grep '"version":' manifest.json | cut -d\" -f4)
PACKAGE_NAME="barateza-ticket-notifier-$VERSION"
DIST_DIR="dist"
STAGING_DIR="$DIST_DIR/package"
ROOT_DIR=$(pwd)

echo "📦 Packaging $PACKAGE_NAME..."

# 2. Clean slate
rm -rf "$DIST_DIR"
mkdir -p "$STAGING_DIR"

# 3. Explicit Allowlist for Root Files
# Added LICENSE (best practice)
echo "📄 Copying root files..."
FILES=(
    "background.js"
    "manifest.json"
    "popup.html"
    "popup.js"
    "popup.css"
    "offscreen.html"
    "offscreen.js"
    "PRIVACY_POLICY.md"
    "LICENSE"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$STAGING_DIR/"
    else
        echo "❌ Error: Required file '$file' not found!"
        exit 1
    fi
done

# 4. Robust Directory Copying
# Uses rsync (if available) or careful cp to exclude system files (.DS_Store, etc)
echo "📁 Copying directories (excluding system files)..."

# Function to copy clean directories
copy_dir_clean() {
    src=$1
    dest=$2
    mkdir -p "$dest/$src"
    # Find files in source, exclude hidden files/system junk, and copy
    find "$src" -maxdepth 1 -type f -not -name '.*' -not -name 'Thumbs.db' -exec cp {} "$dest/$src" \;
}

# Copy icons (ensure we don't grab design source files if they exist, only pngs)
mkdir -p "$STAGING_DIR/icons"
cp icons/*.png "$STAGING_DIR/icons/"

# Copy utils (strictly js files, no tests if they were co-located)
mkdir -p "$STAGING_DIR/utils"
cp utils/*.js "$STAGING_DIR/utils/"

# 5. Create ZIP archive with hygiene
# -X: Exclude extra file attributes (macOS)
# --exclude: Double check to ensure no hidden files or git folders get in
echo "🤐 Creating zip archive..."
cd "$STAGING_DIR"
zip -r -X "../$PACKAGE_NAME.zip" . \
    --exclude "*.DS_Store" \
    --exclude "*Thumbs.db" \
    --exclude "*.git*" \
    --exclude "*.map" > /dev/null
cd "$ROOT_DIR"

# 6. Verify Artifact
if [ -f "$DIST_DIR/$PACKAGE_NAME.zip" ]; then
    echo "✅ Packaging complete!"
    echo "📍 Zip file: $DIST_DIR/$PACKAGE_NAME.zip"
    echo "📏 Size: $(du -h "$DIST_DIR/$PACKAGE_NAME.zip" | cut -f1)"
else
    echo "❌ Error: Zip file was not created."
    exit 1
fi
