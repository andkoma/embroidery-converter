#!/bin/bash

# Ad-hoc Signatur-Skript für Electron App (KEIN Developer ID nötig)
#
# WICHTIG: Ein einziger "codesign --deep" Durchlauf von AUSSEN nach INNEN.
# Die frühere Variante (Signaturen erst einzeln entfernen, dann Frameworks/
# Helper/Binaries in mehreren getrennten Schritten neu signieren) hat eine
# INKONSISTENTE Signatur erzeugt: Info.plist war nicht gebunden und die
# Resource-Siegel fehlten teilweise ("code has no resources but signature
# indicates they must be present"). Das führt bei Nutzern zur harten
# "beschädigt deinen Computer"-Meldung (nicht die harmlose "nicht
# verifizierter Entwickler"-Warnung, die man mit "Trotzdem öffnen" umgehen
# kann).
#
# Diese Version erzeugt eine korrekte, in sich konsistente ad-hoc Signatur
# mit eindeutiger App-spezifischer Identität (ai.orgware.embroideryconverter
# statt der generischen "Electron"-Stub-Identität).

set -e

APP_PATH="release/mac-arm64/Embroidery Converter.app"
ENTITLEMENTS="build/entitlements.mac.plist"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ App-Bundle nicht gefunden: $APP_PATH"
    exit 1
fi

if [ ! -f "$ENTITLEMENTS" ]; then
    echo "❌ Entitlements-Datei nicht gefunden: $ENTITLEMENTS"
    exit 1
fi

echo "🔐 Signiere App ad-hoc..."
echo "================================"
echo ""

codesign --force --deep -s - --entitlements "$ENTITLEMENTS" "$APP_PATH"
echo "  ✅ App signiert"
echo ""

echo "Verifiziere Signatur..."
echo ""

if codesign -v "$APP_PATH" 2>&1; then
    echo "  ✅ Signatur gültig"
else
    echo "  ❌ Signatur ungültig - siehe Ausgabe oben"
    exit 1
fi

codesign -dvvv "$APP_PATH" 2>&1 | grep -E "Identifier=|Info.plist|Sealed Resources"

echo ""
echo "✅ Fertig!"
echo ""
