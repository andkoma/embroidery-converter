# 🔓 macOS Gatekeeper Workaround für Enduser

## Das Problem

Beim Download von **Embroidery Converter** zeigt macOS eine Warnung:
- "Embroidery Converter beschädigt deinen Computer" oder
- Die App lässt sich nicht starten, ohne dass ein Dialog erscheint

Das ist **kein Bug** - es ist macOS Gatekeeper's Sicherheitsmechanismus für heruntergeladene Apps ohne Apple Developer ID Zertifikat.

---

## ✅ Lösung: 3 Optionen

### Option 1: Terminal-Schnellfix (Empfohlen für alle)

1. **Öffne Terminal** (Cmd+Space → "Terminal" → Enter)

2. **Kopiere & paste diesen Befehl:**
   ```bash
   /usr/bin/xattr -cr /Applications/Embroidery\ Converter.app
   ```

3. **Drücke Enter**

4. **Starte die App** (Doppelklick auf das Programm oder `open /Applications/Embroidery\ Converter.app`)

**Das war's!** Die Quarantine-Attribute sind entfernt und die App startet normal.

---

### Option 2: Dragging & Dropping (Alternative)

Falls du das QUICK_FIX.sh-Skript hast:

1. Lade das Skript herunter oder erstelle eine Textdatei mit:
   ```bash
   #!/bin/bash
   /usr/bin/xattr -cr /Applications/Embroidery\ Converter.app
   ```

2. Speichere als `fix.sh`

3. Öffne Terminal, wechsle zum Download-Verzeichnis:
   ```bash
   cd ~/Downloads
   chmod +x fix.sh
   ./fix.sh
   ```

---

### Option 3: Systemeinstellungen (Komplizierteste Option)

Falls die obigen Methoden nicht funktionieren:

1. **Öffne Systemeinstellungen** (Apple-Menü → Systemeinstellungen)

2. Gehe zu **Datenschutz & Sicherheit**

3. Suche nach **"Embroidery Converter"** in der Liste

4. Klick auf **"Trotzdem öffnen"** oder **"Zulassen"**

5. Versuche, die App erneut zu öffnen

---

## 🔧 Warum ist das nötig?

**Ad-hoc Signatur** (kostenlos, ohne Developer ID):
- ✅ Funktioniert perfekt auf deinem eigenen Mac
- ✅ Wird vom Build-System automatisch angewendet
- ❌ Kann Gatekeeper's Malware-Scan nicht erfüllen, wenn die App heruntergeladen wurde
- ❌ Gatekeeper fügt ein `com.apple.quarantine`-Attribut hinzu

**Developer ID Signatur + Notarization** (bezahlt, Apple Developer Program):
- ✅ Würde diesen Workaround überflüssig machen
- ❌ Kostet ~100$/Jahr + Notarization-Zeit
- ❌ Nicht für Open-Source/Hobby-Projekte notwendig

---

## ❓ Fragen?

Falls der Workaround nicht funktioniert:

1. Überprüfe, dass die App wirklich unter `/Applications/Embroidery Converter.app` liegt
2. Überprüfe die **Logs**:
   ```bash
   cat ~/Library/Application\ Support/embroidery-converter/logs/embroidery-converter-*.log
   ```
3. Stelle sicher, dass du das neueste **Build** (1.3.1 oder später) hast

---

## 💡 Alternativ: Code durchschauen

Die App ist **Open Source**! Falls du dem vorgebauten Binary nicht traust:

1. [GitHub Repository öffnen](https://github.com/andkoma/embroidery-converter)
2. Source herunterladen oder klonen
3. Lokal mit `npm install && npm start` bauen und testen

**Lokal gebaute Versionen haben die Quarantine-Attribute NICHT und funktionieren sofort!**

---

## Kontakt

Fragen oder Probleme? Öffne ein [GitHub Issue](https://github.com/andkoma/embroidery-converter/issues).
