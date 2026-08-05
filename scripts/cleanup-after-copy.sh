#!/bin/bash

# Embroidery Converter - NACH DEM KOPIEREN AUS DMG AUSFÜHREN
# Das entfernt alle Quarantine-Attribute, die macOS beim Kopieren hinzufügt

echo "🔧 Embroidery Converter - Quarantine-Cleanup nach Installation"
echo "================================================================"
echo ""

APP_LOCATION="${1:-/Applications/Embroidery Converter.app}"

if [ ! -d "$APP_LOCATION" ]; then
    echo "❌ App nicht gefunden: $APP_LOCATION"
    echo ""
    echo "Bitte stellen Sie sicher, dass Sie die App aus der DMG"
    echo "in den Applications-Ordner kopiert haben."
    exit 1
fi

echo "📍 App-Pfad: $APP_LOCATION"
echo ""
echo "🧹 Entferne Quarantine-Attribute von ALLEN Dateien..."
echo "   (Dies kann einige Sekunden dauern)"
echo ""

# WICHTIG: Rekursiv alle Quarantine-Attribute entfernen
echo "  ⏳ Verarbeite Dateien..."
find "$APP_LOCATION" -type f -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
echo "  ✅ com.apple.quarantine entfernt"

echo "  ⏳ Verarbeite ACL..."
find "$APP_LOCATION" -type f -exec xattr -d com.apple.macl {} \; 2>/dev/null || true
echo "  ✅ com.apple.macl entfernt"

echo ""
echo "================================================================"
echo "✅ Fertig!"
echo ""
echo "Sie können die App jetzt starten:"
echo "  • Doppelklick im Applications-Ordner, oder"
echo "  • Terminal: open \"$APP_LOCATION\""
echo ""
echo "Die Warnung sollte nicht mehr erscheinen."
echo ""
