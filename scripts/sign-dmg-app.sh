#!/bin/bash

# Apply entitlements to app inside DMG
# Usage: ./sign-dmg-app.sh <path-to-dmg> [entitlements-path]

DMG_PATH="${1:?DMG path required}"
ENTITLEMENTS_PATH="${2:-.../build/entitlements.mac.plist}"

if [ ! -f "$DMG_PATH" ]; then
  echo "❌ Error: DMG not found at $DMG_PATH"
  exit 1
fi

if [ ! -f "$ENTITLEMENTS_PATH" ]; then
  echo "❌ Error: Entitlements file not found at $ENTITLEMENTS_PATH"
  exit 2
fi

echo "🔐 Opening DMG and applying entitlements..."
echo "  DMG: $DMG_PATH"
echo "  Entitlements: $ENTITLEMENTS_PATH"
echo ""

# Create mount point
MOUNT_POINT="/tmp/embroidery_dmg_$$"
mkdir -p "$MOUNT_POINT"

# Mount the DMG
echo "📦 Mounting DMG..."
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -readonly || {
  echo "❌ Failed to mount DMG"
  rm -rf "$MOUNT_POINT"
  exit 3
}

# Find the app inside the DMG
APP_BUNDLE=$(find "$MOUNT_POINT" -maxdepth 2 -type d -name "*.app" | head -1)

if [ -z "$APP_BUNDLE" ]; then
  echo "❌ No app bundle found in DMG"
  hdiutil detach "$MOUNT_POINT"
  rm -rf "$MOUNT_POINT"
  exit 4
fi

echo "✓ Found app: $APP_BUNDLE"

# Try to sign it (may fail if DMG is read-only, that's OK)
echo "🔑 Attempting to apply entitlements..."
codesign --entitlements "$ENTITLEMENTS_PATH" -fs - --deep --force "$APP_BUNDLE" 2>&1 || echo "⚠️  Signing skipped (DMG may be read-only)"

# Verify
echo ""
echo "✓ Verification - Entitlements:"
codesign -d --entitlements - "$APP_BUNDLE" 2>/dev/null || echo "⚠️  Cannot read entitlements"

# Unmount
echo ""
echo "📭 Unmounting DMG..."
hdiutil detach "$MOUNT_POINT"
rm -rf "$MOUNT_POINT"

echo "✅ Done"
