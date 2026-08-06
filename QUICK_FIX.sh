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

# WICHTIG: -r (rekursiv) bereinigt auch das .app-Bundle-Verzeichnis selbst,
# nicht nur die enthaltenen Dateien. Ohne das Bundle-Verzeichnis zu bereinigen,
# bleibt Gatekeeper blockiert, weil macOS das Quarantine-Flag primär auf dem
# Bundle-Verzeichnis prüft. Wir verwenden /usr/bin/xattr explizit, damit ein
# eventuell per Homebrew installiertes xattr (ohne -r Unterstützung) nicht
# stattdessen verwendet wird.
echo "  ⏳ Quarantine- und alle sonstigen Attribute (rekursiv)..."
/usr/bin/xattr -cr "$APP_LOCATION" 2>/dev/null
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
