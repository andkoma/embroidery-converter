#!/bin/bash

# Embroidery Converter - macOS Gatekeeper Konfiguration
# Dieses Skript erlaubt die Ausführung der App ohne Developer Account

DMG_FILE="${1:-$HOME/Downloads/Embroidery Converter-1.0.0-arm64.dmg}"

echo "🔓 Embroidery Converter - Gatekeeper Freigabe"
echo "=================================================="
echo ""

if [ ! -f "$DMG_FILE" ]; then
    echo "❌ Fehler: DMG-Datei nicht gefunden: $DMG_FILE"
    exit 1
fi

echo "📍 DMG-Datei: $DMG_FILE"
echo ""

# Entferne macOS Attribute, die Gatekeeper blockieren
echo "🧹 Entferne macOS Sicherheits-Attribute..."
echo ""

# Entferne macOS ACL Attribute
if xattr "$DMG_FILE" | grep -q "com.apple.macl"; then
    echo "  ℹ️ com.apple.macl Attribut gefunden..."
    xattr -d com.apple.macl "$DMG_FILE"
    echo "  ✅ Entfernt"
else
    echo "  ℹ️ Keine com.apple.macl Attribute vorhanden"
fi

echo ""

# Entferne Quarantine Attribute
if xattr "$DMG_FILE" | grep -q "com.apple.quarantine"; then
    echo "  ℹ️ com.apple.quarantine Attribut gefunden..."
    xattr -d com.apple.quarantine "$DMG_FILE"
    echo "  ✅ Entfernt"
else
    echo "  ℹ️ Keine com.apple.quarantine Attribute vorhanden"
fi

echo ""

# Variante 2: Mit Gatekeeper whitelisten (erfordert sudo)
echo "Methode 2: Whiteliste in Gatekeeper (erfordert Passwort)..."
echo "  Bitte geben Sie Ihr Mac-Passwort ein:"
sudo spctl --add --label "Embroidery Converter" "$DMG_FILE"

if [ $? -eq 0 ]; then
    echo "  ✅ In Gatekeeper whitelisted"
else
    echo "  ⚠️ Gatekeeper-Whitelisting fehlgeschlagen (ist ok)"
fi

echo ""
echo "=================================================="
echo "✅ Fertig! Sie können die DMG jetzt öffnen:"
echo ""
echo "   open \"$DMG_FILE\""
echo ""
echo "Oder doppelklicken Sie auf die Datei im Finder."
echo ""
