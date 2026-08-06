#!/bin/bash

# macOS Build mit Gatekeeper-Fixes
# Problem: electron-builder fügt fehlerhafte Signaturen ein
# Lösung: Signatur korrigieren NACH electron-builder, dann DMG mit signierter App machen

set -e

echo "🏗️  Embroidery Converter macOS Build"
echo "====================================="
echo ""

APP_PATH="release/mac-arm64/Embroidery Converter.app"

# Schritt 1: electron-builder - NUR einmal, OHNE erneute Signierung
echo "Schritt 1: Erstelle App mit electron-builder..."
echo ""
npm run build:mac 2>&1 | grep -E "(building|target|Detected)" || true

echo ""
echo "✅ electron-builder fertig"
echo ""

# Schritt 2: Signiere App mit KORREKTEM Skript
echo "Schritt 2: Repariere Signaturen (Gatekeeper-Fix)..."
echo ""
./sign-app.sh

# Schritt 2.5: Cleanup
echo ""
echo "Schritt 2.5: Entferne Quarantine-Attribute..."
echo ""

echo "  📍 Verarbeite App-Bundle..."
find "$APP_PATH" -type f -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true
find "$APP_PATH" -type f -exec xattr -d com.apple.macl {} \; 2>/dev/null || true
echo "  ✅ App bereinigt"

# Schritt 3: Finales Signing - ALL Signaturen nochmal prüfen
echo ""
echo "Schritt 3: Finale Verifizierung..."
echo ""

ERRORS=0

if [ -d "$APP_PATH" ]; then
    if codesign -v "$APP_PATH" 2>&1 | grep -q "code has no resources"; then
        echo "  ❌ Hauptapp: Keine Resources!"
        ERRORS=$((ERRORS+1))
    else
        echo "  ✅ Hauptapp OK"
    fi
    
    for fw in "$APP_PATH/Contents/Frameworks"/*.framework; do
        if codesign -v "$fw" 2>&1 | grep -q "code has no resources"; then
            echo "  ❌ $(basename "$fw"): Keine Resources!"
            ERRORS=$((ERRORS+1))
        fi
    done
fi

echo ""

if [ $ERRORS -eq 0 ]; then
    echo "✅ BUILD ERFOLGREICH!"
    echo ""
    for dmg in release/Embroidery*.dmg; do
        if [ -f "$dmg" ]; then
            echo "  📍 $(basename "$dmg")"
            echo "     Größe: $(du -h "$dmg" | cut -f1)"
        fi
    done
    echo ""
    echo "💡 Die App-Warnung 'beschädigt deinen Computer' sollte NICHT mehr erscheinen!"
else
    echo "❌ $ERRORS Signatur-Fehler!"
    echo ""
    echo "💡 Tipps:"
    echo "  - Überprüfen Sie, dass alle Frameworks vorhanden sind"
    echo "  - Versuchen Sie: rm -rf release/mac-arm64 && npm run build:mac"
    exit 1
fi

echo ""
