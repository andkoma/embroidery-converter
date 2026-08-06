#!/bin/bash

# SCHNELL-FIX wenn Embroidery Converter nicht startet
# Führen Sie dieses Skript NACH dem Kopieren aus der DMG aus
# Das entfernt alle Quarantine-Attribute

echo "🔧 Schnell-Fix für Embroidery Converter"
echo "========================================"
echo ""

APP_LOCATION="/Applications/Embroidery Converter.app"

if [ ! -d "$APP_LOCATION" ]; then
    echo "❌ App nicht gefunden unter: $APP_LOCATION"
    echo ""
    echo "Stellen Sie sicher, dass die App aus der DMG kopiert wurde."
    exit 1
fi

echo "📍 Verarbeite: $APP_LOCATION"
echo ""
echo "🧹 Entferne Quarantine-Attribute..."
echo "   (kann einige Sekunden dauern)"
echo ""

# REKURSIV alle Dateien bereinigen
echo "  ⏳ Quarantine-Attribute..."
find "$APP_LOCATION" -type f -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
echo "  ✅ Entfernt"

echo "  ⏳ ACL-Attribute..."
find "$APP_LOCATION" -type f -exec xattr -d com.apple.macl {} \; 2>/dev/null || true
echo "  ✅ Entfernt"

echo ""
echo "✅ Fertig!"
echo ""
echo "Sie können die App jetzt starten:"
echo "  • Doppelklick im Applications-Ordner"
echo "  • Oder: open /Applications/Embroidery\\ Converter.app"
echo ""
echo "Die Warnung sollte weg sein!"
echo ""
