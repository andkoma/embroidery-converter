# ✈️ Pre-Flight Build Checklist

Use this checklist **before** building installers to ensure everything is configured correctly.

---

## 📋 System Requirements

### Windows 11 Build Machine

- [ ] **Node.js 18+** installed and in PATH
  ```cmd
  node --version
  npm --version
  ```
  Expected: `v18.x.x` or higher

- [ ] **Python 3.7+** installed and in PATH
  ```cmd
  python --version
  pip --version
  ```
  Expected: `Python 3.7+`

- [ ] **PyInstaller** installed
  ```cmd
  pyinstaller --version
  ```
  Expected: `6.x.x`

- [ ] Sufficient disk space: **5 GB free** minimum

---

### macOS Build Machine

- [ ] **Node.js 18+** installed
  ```bash
  node --version
  npm --version
  ```

- [ ] **Python 3.7+** installed
  ```bash
  python3 --version
  pip3 --version
  ```

- [ ] **Xcode Command Line Tools** installed
  ```bash
  xcode-select --version
  ```

- [ ] **PyInstaller** installed
  ```bash
  pyinstaller --version
  ```

- [ ] Sufficient disk space: **5 GB free** minimum

---

## 🔧 Project Setup

- [ ] Source code extracted or cloned
  ```bash
  cd embroidery_converter
  ls -la
  ```
  Should see: `package.json`, `main.js`, `scripts/`, etc.

- [ ] Dependencies installed
  ```bash
  npm install
  ```
  Check: `node_modules/` directory exists (~500 MB)

- [ ] No existing build artifacts (clean start)
  ```bash
  rm -rf release pybuild/build pybuild/dist/convert*
  ```

---

## 🐍 Python Backend Bundling

- [ ] Run PyInstaller bundle script
  ```bash
  npm run python:bundle
  ```

- [ ] Verify binary exists:
  - **Windows:** `pybuild\dist\convert.exe` (~20 MB)
  - **macOS:** `pybuild/dist/convert` (~18 MB)

- [ ] Test bundled binary
  ```bash
  # Windows:
  pybuild\dist\convert.exe formats "{}"
  
  # macOS:
  ./pybuild/dist/convert formats '{}'
  ```
  Expected: JSON output with 50+ formats

- [ ] Verify pyembroidery is bundled (no external dependencies)
  ```bash
  # Windows:
  pybuild\dist\convert.exe inspect "{\"input_path\":\"test.pes\"}"
  
  # macOS:
  ./pybuild/dist/convert inspect '{"input_path":"test.pes"}'
  ```
  Should work even if `pip uninstall pyembroidery` was run

---

## 📦 Installer Build

- [ ] Choose build target:
  - Windows: `npm run build:win`
  - macOS: `npm run build:mac`

- [ ] Monitor build output for errors
  ```
  • building        target=nsis file=release\...exe
  • building        target=DMG arch=x64 file=release\...dmg
  ```

- [ ] Verify installer created:
  - **Windows:** `release/Embroidery Converter Setup 1.0.0.exe`
  - **macOS:** `release/Embroidery Converter-1.0.0.dmg`

- [ ] Check installer size:
  - **Windows:** ~150 MB
  - **macOS:** ~180 MB

---

## ✅ Post-Build Verification

### Installation Test

- [ ] **Install on clean test machine** (no Python, no development tools)
  - Windows: Double-click `.exe` installer
  - macOS: Open `.dmg`, drag to Applications

- [ ] **Launch app successfully**
  - Windows: Desktop shortcut or Start Menu
  - macOS: Applications folder

- [ ] **Backend status badge shows GREEN**
  - Top-right corner: "Conversion engine ready"
  - Hover tooltip: "Backend mode: bundled"

---

### Functionality Test

- [ ] **File preview works**
  - Drag & drop a `.pes` file
  - Thumbnail preview appears with stitch pattern

- [ ] **Format conversion works**
  1. Add file (e.g., `sample.pes`)
  2. Select output format (e.g., `DST`)
  3. Click "Convert All Files"
  4. Output file created successfully

- [ ] **Resize feature works**
  1. Add file
  2. Enable "Resize" checkbox
  3. Set dimensions (e.g., 50mm × 50mm)
  4. Enable "Resample stitches"
  5. Convert
  6. Verify output has ~same stitch density

- [ ] **Color reduction works** (for DST/EXP formats)
  1. Add multi-color file (e.g., `.pes` with 5 colors)
  2. Select `DST` format
  3. Set "Color limit: 3"
  4. Convert
  5. Verify output has 3 colors

- [ ] **Multi-language UI works**
  - Click language selector (globe icon)
  - Switch to Deutsch (DE)
  - Verify UI strings are in German
  - Switch to Français (FR)
  - Verify UI strings are in French
  - Switch back to English (EN)

- [ ] **Output directory selection works**
  - Click "Browse..." in bottom bar
  - Select custom directory
  - Convert a file
  - Verify output appears in selected directory

---

### Edge Cases

- [ ] **Handles invalid files gracefully**
  - Drop a `.jpg` image → shows error
  - Drop a text file → shows error

- [ ] **Handles unsupported conversions**
  - Try converting to read-only format → shows warning

- [ ] **Handles very large files**
  - Test with 100,000+ stitch file
  - Preview should decimate to ~4000 points
  - Conversion should complete (may take 10+ seconds)

- [ ] **Handles files with special characters in name**
  - Files with spaces: `my design.pes`
  - Unicode: `デザイン.pes`, `мой_дизайн.pes`

---

## 🔍 Quality Checklist

### Code Quality

- [ ] No debug `console.log()` statements in production code
- [ ] All file headers include copyright notice
- [ ] Version number updated in `package.json`
- [ ] README.md is up-to-date

### Security

- [ ] No hardcoded paths or credentials
- [ ] `contextIsolation: true` in BrowserWindow options
- [ ] `nodeIntegration: false` in BrowserWindow options
- [ ] All IPC handlers use `ipcMain.handle` (not `on`)

### Performance

- [ ] App launches in < 3 seconds on target hardware
- [ ] File preview renders in < 500ms for typical files
- [ ] Conversion completes in < 5 seconds for typical files

---

## 🚨 Known Issues & Workarounds

### Windows

- [ ] **Antivirus false positive**
  - Symptom: Windows Defender blocks .exe
  - Workaround: Add exclusion during build, or sign the executable

- [ ] **"App can't be opened" on first launch**
  - Symptom: Windows SmartScreen warning
  - Workaround: Click "More info" → "Run anyway"
  - Fix: Sign the app with a code signing certificate

### macOS

- [ ] **"App is damaged" Gatekeeper warning**
  - Symptom: Can't open app after copying from DMG
  - Workaround: `xattr -cr "/Applications/Embroidery Converter.app"`
  - Fix: Sign and notarize the app with Apple Developer certificate

- [ ] **Permission dialogs**
  - Symptom: macOS asks for file access permissions
  - Expected: This is normal, grant permissions

---

## 📝 Release Notes Template

Copy this template for your release notes:

```markdown
# Embroidery Converter v1.0.0

## ✨ Features

- Drag & drop conversion between 50+ embroidery formats
- Visual preview gallery with thread colors
- Per-file resize with stitch resampling
- Color reduction for limited-palette formats
- Multi-language UI (English, Deutsch, Français)
- Self-contained installer (no Python required)

## 💾 Downloads

- **Windows 11/10:** [Embroidery Converter Setup 1.0.0.exe](#) (150 MB)
- **macOS 10.13+:** [Embroidery Converter-1.0.0.dmg](#) (180 MB)

## 📋 System Requirements

- **Windows:** Windows 10/11 (64-bit)
- **macOS:** macOS 10.13 High Sierra or later

## 🔧 Installation

### Windows
1. Download the `.exe` installer
2. Double-click to run
3. Follow installation wizard
4. Launch from desktop shortcut

### macOS
1. Download the `.dmg` file
2. Open the DMG
3. Drag "Embroidery Converter" to Applications
4. Launch from Applications folder
5. If Gatekeeper blocks: Right-click → Open → Open anyway

## 🐛 Known Issues

- None at this time

## 📞 Support

For issues or questions, contact: andkoma@akopp.de

## 📜 License

MIT License - Copyright © 2024 orgware.ai

Created with AI support (EU AI Act compliance).
```

---

## ✅ Final Sign-Off

**Before releasing to users:**

- [ ] All checklist items above are ✅ checked
- [ ] Tested on at least 2 different machines
- [ ] Release notes written
- [ ] Download links prepared
- [ ] Support contact information ready

**Build Quality:** ⭐⭐⭐⭐⭐

**Ready for distribution:** YES / NO

**Signed by:** _______________ **Date:** _______________

---

*This checklist ensures high-quality, production-ready installers that work out-of-the-box for end users.*
