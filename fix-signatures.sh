#!/bin/bash

# NEUES Signaturfix-Skript mit korrektem ad-hoc Signing
# Entfernt alte Signaturen komplett und re-signiert richtig

set -e

APP_PATH="/Applications/Embroidery Converter.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ App nicht gefunden: $APP_PATH"
    exit 1
fi

echo "🔧 Repariere macOS Codesignatures..."
echo "===================================="
echo ""

# Entitlements für Signing definieren
ENTITLEMENTS_FILE=$(mktemp)
cat > "$ENTITLEMENTS_FILE" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-executable-page-protection</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.device.usb</key>
    <true/>
    <key>com.apple.security.device.serial</key>
    <true/>
</dict>
</plist>
EOF

echo "Schritt 1: Entferne alle alten Signaturen..."
echo ""

# ALLE Binaries/Frameworks/Apps: Signature entfernen
find "$APP_PATH" -type f \( -name "*.framework" -o -name "*.app" -o -perm -111 \) | while read item; do
    if [ -d "$item" ]; then
        # Ist ein Bundle/Framework - entferne _CodeSignature komplett
        rm -rf "$item/_CodeSignature" 2>/dev/null || true
    else
        # Ist ein einzelnes Binary
        codesign --remove-signature "$item" 2>/dev/null || true
    fi
done

echo "✅ Alte Signaturen entfernt"
echo ""

echo "Schritt 2: Re-signiere ALL Components mit ad-hoc..."
echo ""

# ZUERST: Alle einzelnen Binaries (nicht in Frameworks)
echo "  🔹 Einzelne Binaries..."
find "$APP_PATH/Contents" -maxdepth 3 -type f \( -perm -111 ! -path "*/Frameworks/*" ! -path "*/Helper*" \) -exec chmod +x {} \; -exec codesign --force --deep -s - --entitlements "$ENTITLEMENTS_FILE" {} \; 2>/dev/null || true

# Python Binary extra
if [ -f "$APP_PATH/Contents/Resources/pybin/convert" ]; then
    echo "  🔹 Python Binary..."
    chmod +x "$APP_PATH/Contents/Resources/pybin/convert"
    codesign --force -s - --entitlements "$ENTITLEMENTS_FILE" "$APP_PATH/Contents/Resources/pybin/convert" 2>/dev/null || true
fi

# DANN: Helper Apps (diese müssen VOR dem Main App signiert werden)
echo "  🔹 Helper Apps..."
for helper in "$APP_PATH/Contents/Frameworks"/Embroidery\ Converter\ Helper*.app; do
    if [ -d "$helper" ]; then
        codesign --force --deep -s - --entitlements "$ENTITLEMENTS_FILE" "$helper" 2>/dev/null || true
    fi
done

# DANN: Frameworks
echo "  🔹 Frameworks..."
for framework in "$APP_PATH/Contents/Frameworks"/*.framework; do
    if [ -d "$framework" ]; then
        codesign --force --deep -s - --entitlements "$ENTITLEMENTS_FILE" "$framework" 2>/dev/null || true
    fi
done

# ZULETZT: Main App (mit --deep flag für Hierarchie)
echo "  🔹 Main App..."
codesign --force --deep -s - --entitlements "$ENTITLEMENTS_FILE" "$APP_PATH" 2>/dev/null || true

echo "✅ Alle Komponenten signiert"
echo ""

echo "Schritt 3: Verifiziere Signaturen..."
echo ""

# Überprüfe Main App
echo "  Main App:"
if codesign -v "$APP_PATH" 2>&1 | grep -q "valid on disk"; then
    echo "    ✅ Gültig"
else
    RESULT=$(codesign -v "$APP_PATH" 2>&1)
    echo "    ⚠️  $RESULT"
fi

# Überprüfe Frameworks
echo "  Electron Framework:"
if codesign -v "$APP_PATH/Contents/Frameworks/Electron Framework.framework" 2>&1 | grep -q "valid"; then
    echo "    ✅ Gültig"
else
    RESULT=$(codesign -v "$APP_PATH/Contents/Frameworks/Electron Framework.framework" 2>&1 | head -1)
    echo "    ⚠️  $RESULT"
fi

# Überprüfe erste Helper
HELPER=$(ls "$APP_PATH/Contents/Frameworks"/Embroidery\ Converter\ Helper.app 2>/dev/null)
if [ -n "$HELPER" ]; then
    echo "  First Helper:"
    if codesign -v "$HELPER" 2>&1 | grep -q "valid"; then
        echo "    ✅ Gültig"
    else
        RESULT=$(codesign -v "$HELPER" 2>&1 | head -1)
        echo "    ⚠️  $RESULT"
    fi
fi

echo ""
echo "Schritt 4: Entferne Quarantine-Attribute..."
echo ""

find "$APP_PATH" -type f -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true
find "$APP_PATH" -type f -exec xattr -d com.apple.macl {} \; 2>/dev/null || true

echo "✅ Quarantine-Attribute entfernt"
echo ""

# Cleanup
rm -f "$ENTITLEMENTS_FILE"

echo "✅ Fertig!"
echo ""
echo "Starten Sie die App neu:"
echo "  open /Applications/Embroidery\\ Converter.app"
echo ""
