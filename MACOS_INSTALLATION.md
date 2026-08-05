## 🎯 Embroidery Converter für macOS - Installationsanleitung

Dieses Dokument erklärt, wie Sie die Embroidery Converter Anwendung auf Ihrem Mac installieren und starten.

### 📋 Voraussetzungen

- **macOS 10.13+** (High Sierra oder neuer)
- Die DMG-Datei: `Embroidery Converter-1.0.0-arm64.dmg`

### 📥 Installation (WICHTIG - bitte genau folgen!)

#### Schritt 1: DMG öffnen

1. Öffnen Sie **Finder**
2. Navigieren Sie zu **Downloads**
3. Doppelklicken Sie auf `Embroidery Converter-1.0.0-arm64.dmg`
4. Das Installationsfenster erscheint

#### Schritt 2: App in Applications kopieren

1. Im Installationsfenster sehen Sie:
   - Links: **Embroidery Converter** App-Symbol
   - Rechts: **Applications** Ordner-Symbol
2. **Ziehen Sie die App in den Applications-Ordner** (Drag & Drop)
3. Warten Sie, bis der Kopiervorgang abgeschlossen ist

#### ⚠️ WICHTIG - Schritt 3: Cleanup ausführen (MUSS gemacht werden!)

**Bevor Sie die App starten, muss dieser Schritt erfolgen!**

Öffnen Sie das **Terminal** und führen Sie aus:

```bash
/Applications/Embroidery\ Converter.app/Contents/Resources/pybin/convert --help
```

**ODER** führen Sie das Hilfsskript aus (wenn Sie das Projekt haben):

```bash
./QUICK_FIX.sh
```

Das entfernt die Quarantine-Attribute, die macOS beim Kopieren automatisch hinzufügt.

---

### 🚀 Starten der Anwendung

Nach dem Cleanup können Sie die App normal starten:

#### Variante 1: Aus dem Finder (einfach)

1. Öffnen Sie **Finder**
2. Navigieren Sie zu **Applications**
3. Suchen Sie **Embroidery Converter**
4. Doppelklicken Sie auf die App

#### Variante 2: Aus Spotlight (schnell)

1. Drücken Sie `⌘ + Space` (Spotlight-Suche öffnen)
2. Tippen Sie `Embroidery Converter`
3. Drücken Sie `Enter`

#### Variante 3: Aus dem Terminal

```bash
open /Applications/Embroidery\ Converter.app
```

---

### ⚠️ Meldung "nicht verifizierter Entwickler" / "kann nicht geöffnet werden"

Die App ist **nicht mit einem Apple Developer ID Zertifikat signiert** (das
kostet 99 $/Jahr). Deshalb zeigt macOS beim ersten Start eine Warnung, dass
der Entwickler nicht verifiziert werden konnte. Das ist normal und kein Fehler
- Sie können den Start manuell erlauben:

**Variante 1 (empfohlen): Rechtsklick öffnen**

1. Öffnen Sie **Finder** → **Applications**
2. Finden Sie **Embroidery Converter**
3. **Rechtsklick** (oder Control-Klick) auf die App
4. Wählen Sie **"Öffnen"**
5. Klicken Sie im Dialog auf **"Öffnen"**
6. macOS merkt sich diese Ausnahme für zukünftige Starts

**Variante 2: Über die Systemeinstellungen**

1. Versuchen Sie die App normal per Doppelklick zu öffnen (wird geblockt)
2. Öffnen Sie **Systemeinstellungen → Datenschutz & Sicherheit**
3. Scrollen Sie nach unten, dort steht "Embroidery Converter wurde blockiert"
4. Klicken Sie auf **"Trotzdem öffnen"**

**Variante 3: Terminal (entfernt die Quarantäne-Markierung komplett)**

```bash
xattr -cr /Applications/Embroidery\ Converter.app
```

Sollte stattdessen die Meldung **"beschädigt deinen Computer"** erscheinen
(statt der oben beschriebenen harmlosen Warnung), deutet das auf eine
fehlerhafte oder unvollständig heruntergeladene DMG hin - laden Sie die Datei
in diesem Fall erneut herunter.

---

### ✅ Häufig gestellte Fragen (FAQ)

**F: Die App öffnet nicht, sondern zeigt eine Warnung?**  
A: Führen Sie `./QUICK_FIX.sh` oder den Befehl oben aus. Das ist normal bei Downloads.

**F: Kann ich die DMG nach der Installation löschen?**  
A: Ja, nach der Installation können Sie die DMG-Datei löschen.

**F: Muss ich Python installieren?**  
A: Nein! Alles ist in der App eingebunden.

**F: Warum diese Warnung?**  
A: Das ist eine macOS-Sicherheitsfunktion für nicht-signierte Apps. Ohne Developer Account müssen Benutzer einmalig bestätigen.

---

### 📚 Weitere Ressourcen

- [Projektrepository](https://github.com/andkoma/embroidery-converter)
- [README.md](../README.md)

---

**Version:** 1.0.0  
**Letzte Aktualisierung:** August 2026
