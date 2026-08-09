#!/bin/bash

# Entfernt macOS Gatekeeper-Sperrung durch Quarantine-Attribute
# Problem: "Electron beschädigt deinen Computer"
# Lösung: Entferne com.apple.quarantine Attribute von allen Electron-Komponenten

set -e

ELECTRON_PATH="./node_modules/electron/dist/Electron.app"

if [ ! -d "$ELECTRON_PATH" ]; then
    echo "❌ Electron nicht gefunden in $ELECTRON_PATH"
    exit 1
fi

echo "🔓 Entferne Gatekeeper-Sperrung..."
echo "================================"
echo ""

# Entferne von Main App
echo "  📍 Main App..."
xattr -d com.apple.quarantine "$ELECTRON_PATH" 2>/dev/null || true

# Entferne von allen Frameworks
echo "  📍 Frameworks..."
find "$ELECTRON_PATH/Contents/Frameworks" -type f -name "Electron*" -o -name "*.framework" | while read fw; do
    xattr -d com.apple.quarantine "$fw" 2>/dev/null || true
done

# Entferne von allen Binaries und Libraries
echo "  📍 Binaries & Libraries..."
find "$ELECTRON_PATH" -type f \( -name "*.dylib" -o -executable \) -exec \
    xattr -d com.apple.quarantine {} \; 2>/dev/null || true

# Entferne recursive
echo "  📍 Recursive cleanup..."
xattr -rd com.apple.quarantine "$ELECTRON_PATH" 2>/dev/null || true

echo ""
echo "✅ Gatekeeper-Sperrung aufgehoben!"
echo ""
echo "🚀 Du kannst jetzt die App starten:"
echo "   npm start"
