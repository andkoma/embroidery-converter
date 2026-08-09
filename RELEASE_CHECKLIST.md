# 📋 Release Checklist & Best Practices

Dieses Dokument dokumentiert wichtige Erkenntnisse aus Releases und bietet eine Checklist für zukünftige Releases, um wiederkehrende Fehler zu vermeiden.

## 🔑 Kritische Erkenntnisse

### 1. macOS Code-Signing & Entitlements

**Problem (v1.2.43):** App zeigte "beschädigte Software" Dialog statt zu starten.

**Root Cause:**
- `afterSign` Hook war initial disabled (`null`)
- `afterPack` wurde statt `afterSign` verwendet
- `hardenedRuntime: false` war zu schwach

**Lösung (korrekt):**
```json
{
  "mac": {
    "hardenedRuntime": true,
    "afterSign": "scripts/afterSign.js",      // ← In mac section (platform-specific hook)
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "signingIdentity": "-"
  }
}
```

**Key Points:**
- ✅ `afterSign` muss in `mac` section sein (electron-builder macOS-specific hook)
- ✅ `hardenedRuntime: true` ist erforderlich für Runtime-Entitlements
- ✅ `signingIdentity: "-"` für ad-hoc Signing
- ❌ `afterSign` NICHT auf globaler Ebene (würde Windows beeinflussen)
- ❌ Niemals `"afterSign": null`

### 2. Platform-Spezifische Konfiguration

**Problem (v1.2.43):** Windows-Build fehlgeschlagen, weil `afterSign` auf globaler Ebene war.

**Lösung:** 
Platform-spezifische Hooks gehören in Platform-spezifische Sections laut electron-builder Schema:

```json
// ✅ CORRECT - afterSign in mac section (electron-builder macOS-specific hook)
"mac": {
  "afterSign": "scripts/afterSign.js",  // ← Only in mac section
  "hardenedRuntime": true,
  // ...
}

// ❌ WRONG - Global level affects all platforms
"build": {
  "afterSign": "scripts/afterSign.js",  // ← Would break Windows!
  "mac": { ... },
  "win": { ... }
}
```

**Checklist:**
- ✅ Verify `afterSign` ist in `mac` section (nicht global)
- ✅ Verify Windows section hat KEINE macOS-Hooks
- ✅ Verify Windows und Linux bauen **ohne Fehler**

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

---

## 📋 Release Checklist

### Pre-Release (vor Tag erstellen)

- [ ] `npm run build:all` lokal testen (oder mindestens `npm run build:mac`)
- [ ] Validate mit: `npm run validate:release` (muss mit ✅ bestätigt werden!)
- [ ] Verify `package.json`:
  - [ ] `version` korrekt aktualisiert
  - [ ] `afterSign` ist auf **globaler Ebene** (nicht in `mac` section)
  - [ ] `hardenedRuntime: true` in `mac` section
  - [ ] `signingIdentity: "-"` in `mac` section
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
| "beschädigte Software" Dialog | Ungültige Code-Signatur | `afterSign` in `mac` section, `hardenedRuntime: true` |
| "Invalid configuration object" (Windows) | `afterSign` auf globaler Ebene | Move `afterSign` in `mac` section |
| Windows-Build fehlgeschlagen | `afterSign` auf globaler Ebene aufgerufen | `afterSign` ist macOS-specific, gehört in `mac` section |
| "Release bereits vorhanden" | Tag Überschreiben nicht erlaubt | Nutze `overwrite: true` in gh-release action |
| x64 findet Python nicht | Nicht alle `python3.X` Varianten durchsucht | Update `pythonCandidates()` mit versioned variants |
| App zeigt "No Python" Error | System Python hat pyembroidery nicht | Add pre-flight check + Installation-Anleitung |

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
