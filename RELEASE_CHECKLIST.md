# 📋 Release Checklist & Best Practices

Dieses Dokument dokumentiert wichtige Erkenntnisse aus Releases und bietet eine Checklist für zukünftige Releases, um wiederkehrende Fehler zu vermeiden.

## 🔑 Kritische Erkenntnisse

### 1. macOS Code-Signing & Entitlements

**Problem (v1.2.43 → v1.2.44):** App zeigte "beschädigte Software" Dialog statt zu starten. Beim Versuch dies zu fixen wurde zusätzlich der Windows-Build kaputt gemacht, weil eine **nicht-existierende Property** (`signingIdentity`) und ein **falsch platzierter Hook** (`afterSign` in `mac`) verwendet wurden.

**Root Cause:**
- `signingIdentity` ist **keine gültige electron-builder Property** — der Schema-Validator lehnt sie ab (egal welche Plattform gebaut wird, da die GESAMTE Config validiert wird). Der korrekte Property-Name ist `identity`.
- `afterSign` ist ein **globaler Hook** (Top-Level in `build`), **keine** `mac`-spezifische Property. In `mac` platziert, lehnt der Schema-Validator ihn als "unknown property" ab.
- Der Hook selbst darf nicht `process.platform` (Host-OS) prüfen, sondern `context.electronPlatformName` (Ziel-Plattform des Builds) — sonst schlägt Cross-Building (z.B. Windows-Target auf macOS-Host) fehl.

**Lösung (korrekt, verifiziert mit `npx electron-builder --win --dir` und `--mac --dir`):**
```json
{
  "afterSign": "scripts/afterSign.js",   // ← GLOBAL (electron-builder Hook, nicht mac-spezifisch)
  "mac": {
    "hardenedRuntime": true,
    "identity": null,                    // ← "identity", NICHT "signingIdentity"; null = electron-builder signiert selbst NICHT
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  },
  "win": { ... }
}
```

```javascript
// scripts/afterSign.js
module.exports = async function(context) {
  // context.electronPlatformName = Ziel-Plattform des Builds (NICHT process.platform!)
  if (context.electronPlatformName !== 'darwin') {
    return; // Windows/Linux-Build → Hook überspringen
  }
  // Ad-hoc Signing mit codesign -s - (electron-builder signiert wegen identity:null nicht selbst)
  execSync(`codesign --force --deep --strict --options=runtime -s - --entitlements "..." "..."`);
};
```

**Key Points:**
- ✅ `afterSign` ist ein **globaler Hook** — wird bei JEDEM Build-Target aufgerufen, das Skript selbst entscheidet anhand `context.electronPlatformName`, ob es aktiv wird
- ✅ `identity: null` deaktiviert electron-builders eigenes Signing (wir signieren manuell im Hook)
- ✅ `hardenedRuntime: true` ist erforderlich für Runtime-Entitlements
- ❌ `signingIdentity` existiert NICHT im electron-builder Schema — führt zu `ValidationError` bei JEDEM Build (auch Windows!)
- ❌ `afterSign` NICHT in `mac` section — führt zu `ValidationError` bei JEDEM Build
- ❌ Niemals `process.platform` im Hook verwenden — immer `context.electronPlatformName`

### 2. Schema-Validierungsfehler betreffen ALLE Plattformen

**Wichtige Erkenntnis:** electron-builder validiert bei **jedem** Build (egal ob `--win`, `--mac` oder `--linux`) die **komplette** `build`-Konfiguration inkl. aller Plattform-Sections. Ein ungültiges Property in `mac` lässt daher auch den Windows-Build fehlschlagen — nicht nur macOS-Builds.

**Deshalb:** `npm run validate:release` führt jetzt die **echte** electron-builder Schema-Validierung aus (`app-builder-lib/out/util/config` → `validateConfig()`), nicht nur eigene Annahmen. Das ist die einzige zuverlässige Methode, um solche Fehler VOR dem CI-Build zu erkennen.

**Checklist:**
- ✅ `npm run validate:release` lokal ausführen — führt die echte electron-builder Schema-Prüfung aus
- ✅ Bei Unsicherheit über eine Property: `npx electron-builder --<platform> --dir` lokal testen (kein Installer, nur Schema + Packaging)
- ✅ Windows und macOS bauen **ohne Fehler**

### 3. Required macOS Entitlements

Die App benötigt diese Entitlements für korrekte Funktionalität:

```xml
<!-- JIT Compiler (Electron/V8) -->
<key>com.apple.security.cs.allow-jit</key>

<!-- Unsigned executable memory (Electron requirement) -->
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>

<!-- Environment variables (für Python-Backend) -->
<key>com.apple.security.cs.allow-dyld-environment-variables</key>

<!-- Disable library validation (für PyInstaller .dylib files) -->
<key>com.apple.security.cs.disable-library-validation</key>

<!-- File access (für Dateien öffnen/speichern) -->
<key>com.apple.security.files.user-selected.read-write</key>
<key>com.apple.security.files.downloads.read-write</key>

<!-- Subprocess (für Python-Backend) -->
<key>com.apple.security.cs.allow-executable-memory-with-write</key>

<!-- Netzwerk (für zukünftige Features) -->
<key>com.apple.security.network.client</key>
<key>com.apple.security.network.server</key>
```

### 4. App Translocation — "App hängt beim Start, kein Fenster erscheint" (v1.2.45)

**Problem:** Nutzer meldeten: Gatekeeper-Dialog erscheint korrekt (kein "beschädigt"-Fehler mehr), aber danach hängt die App beim Start — Dock-Icon bounct dauerhaft, kein Fenster wird je aufgebaut, keine Fehlermeldung.

**Root Cause (verifiziert durch Reproduktion + Kernel-Log-Analyse):**
macOS führt **App Translocation** ("Gatekeeper Path Randomization") durch, wenn eine unter Quarantäne stehende App **direkt aus dem gemounteten DMG heraus gestartet wird**, statt sie vorher in den `Programme`-Ordner zu ziehen. Die App läuft dann von einem zufälligen, schreibgeschützten Pfad wie:
```
/private/var/folders/.../AppTranslocation/<uuid>/d/MeineApp.app
```
Von dort aus kann der Kernel (`AppleSystemPolicy`, Teil von Gatekeeper) das Starten von Kind-Prozessen (Renderer/GPU-Helper) verweigern:
```
kernel: (AppleSystemPolicy) ASP: Security policy would not allow process: <pid>, .../AppTranslocation/.../MeineApp.app/Contents/MacOS/MeineApp
```
Das äußere Electron-Hauptprozess läuft weiter (daher bounct das Dock-Icon), aber es wird nie ein Fenster erzeugt, weil der Renderer-Helper-Prozess nicht starten darf. Es gibt dabei **keinen Crash-Report** und **keine Fehlermeldung** — der Prozess hängt einfach lautlos.

**Lösung (mehrschichtig, da die OS-Blockade selbst nicht durch App-Code umgangen werden kann):**
1. **DMG-Layout mit explizitem "Programme"-Alias** (`build.dmg.contents` in `package.json`) — zeigt App-Icon und Applications-Verknüpfung nebeneinander, motiviert Nutzer zum Drag & Drop statt direktem Start aus dem DMG.
2. **Laufzeit-Erkennung in `main.js`** (`isRunningTranslocated()`): Prüft `process.execPath` auf `/AppTranslocation/` und zeigt — falls die App diesen Punkt überhaupt erreicht (d.h. der Gatekeeper-Dialog wurde beantwortet) — einen klaren Hinweisdialog statt lautlos zu hängen.
3. **`afterSign.js` signiert von innen nach außen, NIE mit `--deep`**: Apples `codesign`-Dokumentation warnt explizit, dass `--deep` "nur für Testzwecke" gedacht ist und bei komplexen Bundles (mehrere Helper-Apps + Frameworks wie bei Electron) inkonsistente Signaturen erzeugen kann. Stattdessen: zuerst alle `.framework`- und Helper-`.app`-Bundles einzeln signieren, dann das äußere App-Bundle zuletzt.

**Wichtig für Nutzer-Dokumentation:** Immer explizit kommunizieren: *"Ziehe die App in den Programme-Ordner, bevor du sie öffnest — starte sie nicht direkt aus dem Installations-Fenster."*

**Checklist:**
- ✅ `dmg.contents` in `package.json` enthält Applications-Alias
- ✅ `main.js` erkennt und meldet App Translocation statt zu hängen
- ✅ `afterSign.js` nutzt kein `--deep`, signiert stattdessen Frameworks/Helper einzeln zuerst
- ✅ Reproduktion getestet: `xattr -w com.apple.quarantine "0081;00000000;Chrome;" App.app && open App.app`

---

## 📋 Release Checklist

### Pre-Release (vor Tag erstellen)

- [ ] `npm run build:all` lokal testen (oder mindestens `npm run build:mac`)
- [ ] Validate mit: `npm run validate:release` (muss mit ✅ bestätigt werden!)
- [ ] Verify `package.json`:
  - [ ] `version` korrekt aktualisiert
  - [ ] `afterSign` ist auf **globaler Ebene** (nicht in `mac` section)
  - [ ] `hardenedRuntime: true` in `mac` section
  - [ ] `identity: null` in `mac` section (NICHT `signingIdentity` — diese Property existiert nicht)
  - [ ] `dmg.contents` enthält Applications-Alias (verhindert App Translocation)
  - [ ] Keine Platform-Hooks in Platform-spezifischen Sections (außer `afterSign` auf global)
- [ ] Verify Entitlements-Datei existiert: `build/entitlements.mac.plist`
- [ ] Verify GitHub Secrets konfiguriert: `GH_TOKEN` (für Release-Upload)
- [ ] Build-Log prüfen auf Warnings/Errors

### Tag erstellen & Build triggern

```bash
git tag v1.2.43
git push origin v1.2.43
```

- [ ] GitHub Actions Build-Job starten (check Actions tab)

### Build-Verification in CI/CD

- [ ] macOS arm64 Job:
  - [ ] PyInstaller binary erstellt: `pybuild/dist/arm64/convert`
  - [ ] DMG-Datei erstellt
  - [ ] Codesign verifikation erfolgreich
  - [ ] Entitlements in Log sichtbar

- [ ] macOS x64 Job:
  - [ ] System Python fallback aktiv (kein PyInstaller)
  - [ ] DMG-Datei erstellt
  - [ ] Gatekeeper-Test erfolgreich

- [ ] Windows Job:
  - [ ] PyInstaller `.exe` erstellt: `pybuild/dist/convert.exe`
  - [ ] NSIS Installer erstellt
  - [ ] Kein Fehler bei Electron-Builder

### Post-Build Verification

- [ ] Release auf GitHub erstellt mit beiden DMGs und .exe
- [ ] Test-Download + Install auf macOS arm64
  - [ ] App startet ohne "beschädigte Software" Dialog
  - [ ] Logs schreibbar: `~/Library/Application Support/embroidery-converter/logs/`
  - [ ] Backend-Test erfolgreich: `backend:status` IPC Handler
  - [ ] Datei-Konvertierung funktioniert

- [ ] Test-Download + Install auf macOS x64
  - [ ] App findet System Python
  - [ ] Fehler wenn pyembroidery nicht installiert (mit Installationsanleitung)
  - [ ] Nach `pip install pyembroidery`: Konvertierung funktioniert

- [ ] Test auf Windows
  - [ ] NSIS Installer läuft
  - [ ] App startet ohne Fehler
  - [ ] Backend-Test erfolgreich
  - [ ] Datei-Konvertierung funktioniert

---

## 🔍 Häufige Fehler

| Fehler | Ursache | Lösung |
|--------|--------|--------|
| "beschädigte Software" Dialog | Ungültige Code-Signatur | `afterSign` (global) + `identity: null` + `hardenedRuntime: true` |
| "Invalid configuration object... unknown property 'signingIdentity'" | `signingIdentity` existiert nicht im Schema | Verwende `identity` statt `signingIdentity` |
| "Invalid configuration object... unknown property 'afterSign'" (in mac) | `afterSign` ist ein globaler Hook, keine `mac`-Property | `afterSign` auf Top-Level in `build` verschieben |
| Windows-Build fehlgeschlagen wegen `mac`-Config | electron-builder validiert IMMER die komplette Config | `npm run validate:release` lokal ausführen VOR jedem Tag |
| `afterSign` läuft auch bei Windows-Build | Hook prüft `process.platform` (Host) statt Ziel-Plattform | Hook muss `context.electronPlatformName` prüfen |
| "Release bereits vorhanden" | Tag Überschreiben nicht erlaubt | Nutze `overwrite: true` in gh-release action |
| x64 findet Python nicht | Nicht alle `python3.X` Varianten durchsucht | Update `pythonCandidates()` mit versioned variants |
| App zeigt "No Python" Error | System Python hat pyembroidery nicht | Add pre-flight check + Installation-Anleitung |
| App hängt beim Start, Dock-Icon bounct, kein Fenster (v1.2.45) | App Translocation: direkt aus DMG gestartet statt aus /Applications; Kernel blockiert Helper-Prozesse | DMG-Layout mit Applications-Alias + Laufzeit-Erkennung `isRunningTranslocated()` + kein `--deep` beim Signieren |

---

## 📚 Dokumentation für Benutzer

Diese Release-Erkenntnisse sollten dokumentiert sein:

- [GATEKEEPER_FIX.md](./GATEKEEPER_FIX.md) - macOS Signatur-Details
- [MACOS_X64_SETUP.md](./MACOS_X64_SETUP.md) - x64 Installation & Troubleshooting
- [CI_CD.md](./CI_CD.md) - Build & Release-Prozess
- [BUILD.md](./BUILD.md) - Lokales Build-Setup

---

## 🚀 Automation Improvements

Für zukünftige Releases könnten folgende Automatisierungen implementiert werden:

1. **Pre-Release Validation Script**
   ```bash
   npm run validate:release  # Checkt package.json, Entitlements, etc.
   ```

2. **Automated Changelog Generation**
   - Sammelt Commits seit letztem Tag
   - Generiert Release Notes automatically

3. **Post-Build Signature Verification**
   - Extrahiert DMG und prüft Code-Signatur automatisch
   - Fehlgeschlag wenn Signature ungültig

4. **macOS Code-Sign Template**
   - Vordefinierte Entitlements für Electron+Python
   - Reusable `afterSign.js` Vorlage

---

## 📞 Support & Debugging

### Signature verifizieren (nach Extract)

```bash
# Extract DMG
hdiutil attach Embroidery\ Converter-1.2.43-arm64.dmg
cd /Volumes/Embroidery\ Converter

# Verify signature
codesign -dv "Embroidery Converter.app"

# Check entitlements
codesign -d --entitlements - "Embroidery Converter.app"

# Cleanup
cd /tmp
hdiutil detach /Volumes/Embroidery\ Converter
```

### Build lokal debuggen

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Alle
npm run build:all
```

### Log-Ausgabe
- macOS/Linux: `~/Library/Application Support/embroidery-converter/logs/`
- Windows: `%APPDATA%\embroidery-converter\logs\`

---

**Last Updated:** 2026-08-09
**Release Version:** v1.2.43
