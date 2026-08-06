#!/bin/bash

# Apply ad-hoc code signing with entitlements to macOS app bundle
# Usage: ./sign-app.sh <path-to-app> [entitlements-path]

APP_PATH="${1:?App path required}"
ENTITLEMENTS_PATH="${2:-.../build/entitlements.mac.plist}"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ Error: App not found at $APP_PATH"
  exit 1
fi

if [ ! -f "$ENTITLEMENTS_PATH" ]; then
  echo "❌ Error: Entitlements file not found at $ENTITLEMENTS_PATH"
  exit 2
fi

echo "✓ Applying ad-hoc signature with entitlements"
echo "  App: $APP_PATH"
echo "  Entitlements: $ENTITLEMENTS_PATH"
echo ""

# Apply ad-hoc signature with entitlements
codesign --entitlements "$ENTITLEMENTS_PATH" -fs - --deep --force "$APP_PATH"

if [ $? -ne 0 ]; then
  echo "❌ Code signing failed"
  exit 3
fi

echo ""
echo "✓ Signature applied. Verifying entitlements:"
codesign -d --entitlements - "$APP_PATH"
