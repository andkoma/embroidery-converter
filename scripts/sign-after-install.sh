#!/bin/bash

# Embroidery Converter - App nach Installation signieren und säubern
# Führen Sie dieses Skript aus NACHDEM Sie die App aus der DMG in den Applications-Ordner kopiert haben

echo "🔧 Embroidery Converter - Finale Signierung nach Installation"
echo "=============================================================="
echo ""

APP_LOCATION="${1:-/Applications/Embroidery Converter.app}"

if [ ! -d "$APP_LOCATION" ]; then
    echo "❌ Fehler: App nicht gefunden unter: $APP_LOCATION"
    echo ""
    echo "Bitte kopieren Sie zuerst 'Embroidery Converter.app' aus der DMG in den Applications-Ordner!"
    exit 1
fi

echo "📍 App-Pfad: $APP_LOCATION"
echo ""

# Entitlements
ENTITLEMENTS="/tmp/entitlements-final.plist"
cat > "$ENTITLEMENTS" << 'EOF'
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
	<key>com.apple.security.cs.allow-dyld-environment-variables</key>
	<true/>
	<key>com.apple.security.files.user-selected.read-write</key>
	<true/>
	<key>com.apple.security.files.user-selected.read-only</key>
	<true/>
	<key>com.apple.security.device.usb</key>
	<true/>
</dict>
</plist>
EOF

echo "🔐 Signiere App-Komponenten..."

# Python-Binary
PYTHON_BIN="$APP_LOCATION/Contents/Resources/pybin/convert"
if [ -f "$PYTHON_BIN" ]; then
    echo "  🐍 Python-Binary..."
    chmod +x "$PYTHON_BIN"
    codesign -s - --entitlements "$ENTITLEMENTS" --force "$PYTHON_BIN" 2>/dev/null
fi

# Alle Binaries
echo "  📝 Binaries und Libraries..."
find "$APP_LOCATION/Contents" -type f \( -executable -o -name "*.dylib" \) ! -path "*._*" ! -path "*Resources/pybin*" -exec codesign -s - --entitlements "$ENTITLEMENTS" --force {} \; 2>/dev/null

# Frameworks
echo "  🔧 Frameworks..."
find "$APP_LOCATION/Contents/Frameworks" -name "*.framework" -exec codesign -s - --entitlements "$ENTITLEMENTS" --force --deep {} \; 2>/dev/null

# Hauptapp
echo "  📦 Hauptanwendung..."
codesign -s - --entitlements "$ENTITLEMENTS" --force --deep "$APP_LOCATION" 2>/dev/null

# WICHTIG: Entferne macOS Quarantine und ACL Attribute
echo ""
echo "🧹 Entferne macOS Sicherheits-Attribute..."
echo "  Entferne Quarantine und ACL Flags..."
find "$APP_LOCATION" -type f -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true
find "$APP_LOCATION" -type f -exec xattr -d com.apple.macl {} \; 2>/dev/null || true

echo ""
echo "✅ Signierung und Säuberung abgeschlossen!"
echo ""
echo "Sie können die App jetzt starten:"
echo "  - Doppelklick auf 'Embroidery Converter' im Applications-Ordner, oder"
echo "  - Terminal: open '$APP_LOCATION'"
echo ""
