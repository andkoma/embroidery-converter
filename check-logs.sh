#!/bin/bash

# Entferne Quarantine-Attribute (ohne -r flag auf macOS)
echo "🔓 Entferne Gatekeeper-Sperrung..."
find ./node_modules/electron/dist/Electron.app -type f -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true

echo "✓ Fertig!"
echo ""
echo "Starte App in 3 Sekunden... (Schließe sie manuell nach dem Start)"
sleep 3

# Starte die App im Hintergrund
npm start > /tmp/app.log 2>&1 &
APP_PID=$!

# Warte 10 Sekunden für den Start
sleep 10

# Beende die App
kill $APP_PID 2>/dev/null || true

# Zeige Logs
echo ""
echo "📋 App-Logs:"
echo "================================"
tail -50 /tmp/app.log
echo ""
echo "📋 User Data Logs:"
LOGS_DIR="$HOME/Library/Application Support/embroidery-converter/logs"
if [ -d "$LOGS_DIR" ]; then
    echo "  📍 $LOGS_DIR"
    ls -lah "$LOGS_DIR"
    echo ""
    echo "  Letzter Log:"
    tail -20 "$LOGS_DIR"/*.log
else
    echo "  (Keine Logs gefunden)"
fi
