# 🔧 Lokale Entwicklung auf macOS - Gatekeeper Fix

## Das Problem: "Electron beschädigt deinen Computer"

Wenn du beim Starten der App die Fehlermeldung siehst:

```
"„Electron" beschädigt deinen Computer. Es empfiehlt sich, das Objekt in den Papierkorb zu bewegen."
```

Das ist **kein App-Bug**, sondern ein **macOS Gatekeeper-Sicherheitsmechanismus**, der:
1. Nach dem Download das `com.apple.quarantine` Attribut setzt
2. Das verhindert, dass unsignierte Electron-Binaries ausgeführt werden
3. Der Kernel killt den Prozess mit SIGKILL (bevor die App überhaupt lädt)

## ✅ Die Lösung

Das ist jetzt **automatisch** gelöst! 🎉

Nach `npm install` läuft automatisch das **postinstall-Skript** (`scripts/postinstall.js`), das:
- ✓ Alle `com.apple.quarantine` Attribute entfernt
- ✓ Ad-hoc Signierung mit Entitlements vornimmt
- ✓ Electron bereit für lokale Entwicklung macht

## 🚀 Starten der App

```bash
npm install    # Repariert Electron automatisch
npm start      # Startet die App
```

## 🔧 Manuelle Reparatur (falls nötig)

Falls die App immer noch Probleme macht:

```bash
# Entferne Quarantine-Attribute von allen Electron-Dateien
find node_modules/electron -type f -exec xattr -c {} \;

# Starte dann die App
npm start
```

## 📝 Was wurde geändert?

| Datei | Änderung |
|-------|----------|
| `scripts/postinstall.js` | Neues Skript für Gatekeeper-Fix |
| `package.json` | Postinstall-Hook registriert |
| `build/entitlements.mac.plist` | Erweiterte Berechtigungen hinzugefügt |
| `main.js` | Bessere Error-Handling & Logging |

## 🎯 Warum ist das notwendig?

- **Development (lokal)**: App muss ad-hoc signiert sein, Gatekeeper-Attribute müssen weg
- **Production (DMG)**: Mit Developer ID und Notarization kein Problem
- **GitHub Actions**: Ähnlicher Prozess für CI/CD-Builds

## 💡 Tipps

- **Log-Datei anschauen**: 
  ```bash
  tail -f ~/Library/Application\ Support/embroidery-converter/logs/*.log
  ```

- **Debug-Mode**:
  ```bash
  npm run dev
  ```

- **Nur ein Mal nötig**: Nach dem ersten `npm install` ist alles konfiguriert.

---

**Status**: ✅ Die App sollte jetzt lokal ohne "beschädigt"-Fehler starten!
