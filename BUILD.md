# 📦 Building Self-Contained Installers

This guide walks you through creating **self-contained installers** for Windows 11 and macOS that include the Python runtime bundled with PyInstaller.

> **Important:** Installers must be built on their target platform. You cannot build Windows installers on macOS or vice versa.

---

## 🎯 What You'll Get

- **Windows:** `Embroidery Converter Setup 1.0.0.exe` (~150 MB)
  - NSIS installer with desktop shortcut
  - Works on any Windows 11/10 machine (no Python required)
  
- **macOS:** `Embroidery Converter-1.0.0.dmg` (~180 MB)
  - Drag-to-install DMG package
  - Works on macOS 10.13+ (no Python required)

---

## ⚙️ Prerequisites

### On Windows 11

1. **Node.js 18+** – [Download from nodejs.org](https://nodejs.org/)
   ```cmd
   node --version
   npm --version
   ```

2. **Python 3.7+** – [Download from python.org](https://www.python.org/downloads/)
   ```cmd
   python --version
   pip --version
   ```
   
   ⚠️ **Important:** Check "Add Python to PATH" during installation!

3. **Git** (optional, for cloning) – [Download from git-scm.com](https://git-scm.com/)

### On macOS

1. **Node.js 18+** – Install via [nodejs.org](https://nodejs.org/) or Homebrew:
   ```bash
   brew install node
   node --version
   npm --version
   ```

2. **Python 3.7+** – macOS includes Python 3, or install via Homebrew:
   ```bash
   brew install python3
   python3 --version
   pip3 --version
   ```

3. **Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```

---

## 🚀 Build Steps

### Step 1: Get the Source Code

If you have a zip file, extract it. If using Git:

```bash
git clone <repository-url>
cd embroidery_converter
```

---

### Step 2: Install Dependencies

Open Terminal (macOS) or Command Prompt (Windows) in the project directory:

```bash
npm install
```

This installs Electron and electron-builder (~500 MB download, takes 2-5 minutes).

---

### Step 3: Install PyInstaller

#### Windows:
```cmd
pip install pyinstaller
```

#### macOS:
```bash
pip3 install pyinstaller
```

Verify installation:
```bash
pyinstaller --version
```

You should see something like `6.x.x`.

---

### Step 4: Bundle the Python Backend

This creates a standalone Python executable with pyembroidery built-in.

#### Windows:
```cmd
npm run python:bundle
```

#### macOS:
```bash
npm run python:bundle
```

**What happens:**
- PyInstaller analyzes `scripts/convert.py`
- Bundles Python runtime + pyembroidery library
- Creates binary in `pybuild/dist/`:
  - Windows: `convert.exe` (~20 MB)
  - macOS: `convert` (~18 MB)

**Expected output:**
```
Building EXE from EXE-00.toc completed successfully.
Build complete! The results are available in: .../pybuild/dist
```

**Verify the binary works:**

#### Windows:
```cmd
pybuild\dist\convert.exe formats "{}"
```

#### macOS:
```bash
./pybuild/dist/convert formats '{}'
```

You should see JSON output with 50+ embroidery formats.

---

### Step 5: Build the Installer

Now we package everything into an installer.

#### Windows:
```cmd
npm run build:win
```

**What happens:**
- electron-builder packages the app
- Bundles Electron + UI files + Python binary
- Creates NSIS installer in `release/`

**Expected output:**
```
• building        target=nsis file=release\Embroidery Converter Setup 1.0.0.exe
• building block map  blockMapFile=release\Embroidery Converter Setup 1.0.0.exe.blockmap
```

**Build time:** 3-5 minutes  
**Installer location:** `release/Embroidery Converter Setup 1.0.0.exe`  
**Size:** ~150 MB

---

#### macOS:
```bash
npm run build:mac
```

**What happens:**
- electron-builder packages the app
- Bundles Electron + UI files + Python binary
- Creates DMG installer in `release/`

**Expected output:**
```
• building        target=macOS zip arch=x64 file=release/mac/Embroidery Converter-1.0.0.zip
• building        target=DMG arch=x64 file=release/Embroidery Converter-1.0.0.dmg
```

**Build time:** 5-8 minutes  
**Installer location:** `release/Embroidery Converter-1.0.0.dmg`  
**Size:** ~180 MB

---

## ✅ Verification Checklist

After building, verify your installer:

### Windows:

1. ✅ Installer file exists:
   ```cmd
   dir release\*.exe
   ```

2. ✅ Install the app (double-click the .exe)
   - Choose installation directory
   - Let it create desktop shortcut

3. ✅ Launch the app from desktop shortcut

4. ✅ Check backend status badge → should show **"Conversion engine ready"** (green)

5. ✅ Test conversion:
   - Drag & drop a `.pes` or `.dst` file
   - Select output format (e.g., DST → PES)
   - Click "Convert All Files"
   - Verify output file is created

---

### macOS:

1. ✅ DMG file exists:
   ```bash
   ls -lh release/*.dmg
   ```

2. ✅ Open the DMG (double-click)
   - Drag "Embroidery Converter" to Applications

3. ✅ Launch from Applications folder
   - If macOS shows "unidentified developer" warning:
     - Right-click → Open → Open anyway
     - (For distribution, you'll need to code-sign the app)

4. ✅ Check backend status badge → should show **"Conversion engine ready"** (green)

5. ✅ Test conversion:
   - Drag & drop a `.pes` or `.dst` file
   - Select output format
   - Click "Convert All Files"
   - Verify output file is created

---

## 🐛 Troubleshooting

### ❌ "PyInstaller not found"

**Cause:** PyInstaller not installed or not in PATH.

**Fix:**
```bash
pip install pyinstaller --upgrade
# or on macOS:
pip3 install pyinstaller --upgrade
```

---

### ❌ "Backend error" in the app

**Cause:** Bundled binary was not created or not found.

**Diagnosis:**
1. Check if binary exists:
   - Windows: `pybuild\dist\convert.exe`
   - macOS: `pybuild/dist/convert`

2. Test binary directly:
   ```bash
   ./pybuild/dist/convert formats '{}'
   ```

**Fix:** Re-run `npm run python:bundle`

---

### ❌ "electron-builder" fails with "Cannot find module"

**Cause:** Dependencies not installed.

**Fix:**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### ❌ macOS: "App is damaged and can't be opened"

**Cause:** Gatekeeper security blocking unsigned app.

**Fix (for testing):**
```bash
xattr -cr "/Applications/Embroidery Converter.app"
```

**Fix (for distribution):** Sign the app with an Apple Developer certificate:
```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-password"
npm run build:mac
```

See [electron-builder code signing docs](https://www.electron.build/code-signing).

---

### ❌ Windows: "NSIS Error" during build

**Cause:** Antivirus blocking electron-builder.

**Fix:**
1. Temporarily disable antivirus
2. Add `release/` folder to antivirus exclusions
3. Re-run `npm run build:win`

---

### ❌ Build takes forever / hangs

**Cause:** Large `node_modules` or disk issues.

**Fix:**
```bash
# Clean build artifacts
rm -rf release pybuild/build pybuild/dist
# Re-bundle
npm run python:bundle
npm run build:win   # or build:mac
```

---

## 📂 Build Output Structure

After successful build:

```
embroidery_converter/
├── release/
│   ├── Embroidery Converter Setup 1.0.0.exe    (Windows installer)
│   ├── Embroidery Converter-1.0.0.dmg          (macOS installer)
│   ├── win-unpacked/                            (Windows app contents)
│   └── mac/                                     (macOS app contents)
├── pybuild/
│   ├── dist/
│   │   ├── convert.exe                         (Windows binary)
│   │   └── convert                             (macOS binary)
│   └── build/                                  (PyInstaller temp files)
└── node_modules/                               (npm packages)
```

**Distribute:** Only the `.exe` (Windows) or `.dmg` (macOS) file!

---

## 🔄 Clean Build

If you need to rebuild from scratch:

```bash
# Remove all build artifacts
rm -rf release pybuild node_modules

# Reinstall everything
npm install
pip install pyinstaller  # or pip3 on macOS

# Rebuild
npm run python:bundle
npm run build:win   # or build:mac
```

---

## 📝 Build Script Reference

| Script | Purpose | Platform |
|--------|---------|----------|
| `npm run python:bundle` | Create standalone Python binary | Windows/macOS |
| `npm run build:win` | Build Windows installer (.exe) | Windows only |
| `npm run build:mac` | Build macOS installer (.dmg) | macOS only |
| `npm run build:all` | Build both (only works if cross-compile configured) | Both |
| `npm run build` | Build for current platform | Any |

---

## 🎁 Distribution Checklist

Before distributing your installer:

- ✅ Test on a **clean machine** without Python installed
- ✅ Verify backend badge shows **green** (conversion engine ready)
- ✅ Test at least 3 different format conversions
- ✅ Test resize feature with stitch resampling
- ✅ Test color reduction for DST/EXP formats
- ✅ Test multi-language UI (EN/DE/FR)
- ✅ Verify all file previews render correctly
- ✅ Check that output files open in embroidery software
- ✅ Windows: Test on Windows 10 and 11
- ✅ macOS: Test on macOS 10.13+ (or your minimum target)

---

## 📞 Support

If you encounter issues not covered here:

1. Check the main [README.md](./README.md) for development setup
2. Verify all prerequisites are installed and up-to-date
3. Try a clean build (see "Clean Build" section above)
4. Check electron-builder logs in `release/builder-debug.yml`

---

## 🔐 Code Signing (Optional)

For production distribution, you should code-sign your installers:

### Windows (requires Code Signing Certificate):
```bash
export WIN_CSC_LINK="/path/to/certificate.pfx"
export WIN_CSC_KEY_PASSWORD="certificate-password"
npm run build:win
```

### macOS (requires Apple Developer Account):
```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export CSC_NAME="Developer ID Application: Your Name (TEAM_ID)"
npm run build:mac
```

See [electron-builder documentation](https://www.electron.build/code-signing) for details.

---

**Built with ❤️ using Electron, PyInstaller, and pyembroidery**

*Copyright © 2024 orgware.ai (andkoma@akopp.de). Created with AI support.*
