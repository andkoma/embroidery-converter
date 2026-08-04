# 📦 Building Option 1: Lightweight Installers (Python Required)

This guide walks you through creating **lightweight installers** for Windows 11 and macOS that require users to have Python 3.7+ installed.

> **Option 1 vs Option 2:**
> - **Option 1 (this guide):** Smaller installer (~100 MB), requires Python 3.7+ on user's machine
> - **Option 2 (see BUILD.md):** Larger installer (~150 MB), self-contained, no Python required

---

## 🎯 What You'll Get

- **Windows:** `Embroidery Converter Setup 1.0.0.exe` (~100 MB)
  - NSIS installer with desktop shortcut
  - Requires Python 3.7+ on user's machine
  
- **macOS:** `Embroidery Converter-1.0.0.dmg` (~120 MB)
  - Drag-to-install DMG package
  - Requires Python 3.7+ on user's machine

---

## ⚙️ Prerequisites

### On Windows 11

1. **Node.js 18+** – [Download from nodejs.org](https://nodejs.org/)
   ```cmd
   node --version
   npm --version
   ```

2. **Git** (optional, for cloning) – [Download from git-scm.com](https://git-scm.com/)

**Note:** You do NOT need Python on the BUILD machine for Option 1 (only users need it).

### On macOS

1. **Node.js 18+** – Install via [nodejs.org](https://nodejs.org/) or Homebrew:
   ```bash
   brew install node
   node --version
   npm --version
   ```

2. **Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```

**Note:** You do NOT need Python on the BUILD machine for Option 1.

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

### Step 3: Ensure No Bundled Binary Exists

For Option 1, we want the app to use the user's system Python, not a bundled binary.

```bash
# Remove any existing bundled binary
rm -rf pybuild/dist/convert*
```

Verify the directory only contains the README.txt placeholder:

```bash
ls pybuild/dist/
```

Expected output: `README.txt` only.

---

### Step 4: Build the Installer

Now we package the app WITHOUT bundling Python.

#### Windows:
```cmd
npm run build:win
```

**What happens:**
- electron-builder packages the app
- Bundles Electron + UI files + Python scripts (no binary)
- Creates NSIS installer in `release/`

**Expected output:**
```
• building        target=nsis file=release\Embroidery Converter Setup 1.0.0.exe
• building block map  blockMapFile=release\Embroidery Converter Setup 1.0.0.exe.blockmap
```

**Build time:** 2-4 minutes  
**Installer location:** `release/Embroidery Converter Setup 1.0.0.exe`  
**Size:** ~100 MB

---

#### macOS:
```bash
npm run build:mac
```

**What happens:**
- electron-builder packages the app
- Bundles Electron + UI files + Python scripts (no binary)
- Creates DMG installer in `release/`

**Expected output:**
```
• building        target=macOS zip arch=x64 file=release/mac/Embroidery Converter-1.0.0.zip
• building        target=DMG arch=x64 file=release/Embroidery Converter-1.0.0.dmg
```

**Build time:** 4-7 minutes  
**Installer location:** `release/Embroidery Converter-1.0.0.dmg`  
**Size:** ~120 MB

---

## ✅ Verification Checklist

After building, verify your installer:

### Windows:

1. ✅ Installer file exists:
   ```cmd
   dir release\*.exe
   ```

2. ✅ Install on a test machine **with Python 3.7+ installed**
   - Verify Python is installed: `python --version`
   - Double-click the `.exe` installer
   - Choose installation directory
   - Let it create desktop shortcut

3. ✅ Launch the app from desktop shortcut

4. ✅ Check backend status badge:
   - Should show **"Conversion engine ready"** (green)
   - Hover tooltip: "Backend mode: system-python"

5. ✅ Test conversion:
   - Drag & drop a `.pes` or `.dst` file
   - Select output format
   - Click "Convert All Files"
   - Verify output file is created

---

### macOS:

1. ✅ DMG file exists:
   ```bash
   ls -lh release/*.dmg
   ```

2. ✅ Install on a test machine **with Python 3.7+ installed**
   - Verify Python is installed: `python3 --version`
   - Open the DMG (double-click)
   - Drag "Embroidery Converter" to Applications

3. ✅ Launch from Applications folder
   - If macOS shows "unidentified developer" warning:
     - Right-click → Open → Open anyway

4. ✅ Check backend status badge:
   - Should show **"Conversion engine ready"** (green)
   - Hover tooltip: "Backend mode: system-python"

5. ✅ Test conversion:
   - Drag & drop a `.pes` file
   - Select output format (e.g., DST)
   - Click "Convert All Files"
   - Verify output file is created

---

## ⚠️ Important: User Requirements

**Users of Option 1 installers MUST have:**

### Windows Users:
- **Python 3.7+** installed from [python.org](https://www.python.org/downloads/)
- Python must be added to PATH during installation

To verify Python is accessible:
```cmd
python --version
```

### macOS Users:
- **Python 3.7+** (usually pre-installed on macOS 10.13+)
- Verify with: `python3 --version`

### If Python is Not Found:

The app will show **"Backend error"** with a red badge. Users should:

1. Install Python 3.7+ from:
   - Windows: https://www.python.org/downloads/
   - macOS: `brew install python3` or https://www.python.org/downloads/

2. Restart the app

---

## 🐛 Troubleshooting

### ❌ "Backend error" after installation (red badge)

**Cause:** User's machine doesn't have Python 3.7+ installed or Python is not in PATH.

**Fix for Windows:**
1. Install Python from python.org
2. During installation, check ✅ "Add Python to PATH"
3. Restart the app

**Fix for macOS:**
```bash
# Install Python via Homebrew
brew install python3

# Or download from python.org
# Then restart the app
```

---

### ❌ Build fails with "electron-builder" error

**Cause:** Dependencies not installed.

**Fix:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run build:win   # or build:mac
```

---

### ❌ macOS: "App is damaged and can't be opened"

**Cause:** Gatekeeper security blocking unsigned app.

**Fix (for testing):**
```bash
xattr -cr "/Applications/Embroidery Converter.app"
```

**Fix (for distribution):** Sign the app with an Apple Developer certificate (see BUILD.md).

---

## 📊 Size Comparison

| Component | Option 1 (Lightweight) | Option 2 (Self-Contained) |
|-----------|------------------------|---------------------------|
| **Windows installer** | ~100 MB | ~150 MB |
| **macOS installer** | ~120 MB | ~180 MB |
| **User requirements** | Python 3.7+ required | None (bundled) |
| **Install time** | Faster (~30 sec) | Slower (~60 sec) |
| **Best for** | Tech-savvy users, developers | End users, non-technical |

---

## 🔄 Clean Build

If you need to rebuild from scratch:

```bash
# Remove all build artifacts
rm -rf release node_modules

# Reinstall everything
npm install

# Rebuild
npm run build:win   # or build:mac
```

---

## 📝 Build Script Reference

| Script | Purpose | Platform |
|--------|---------|----------|
| `npm run build:win` | Build Windows installer (.exe) | Windows only |
| `npm run build:mac` | Build macOS installer (.dmg) | macOS only |
| `npm run build` | Build for current platform | Any |

**Note:** Option 1 does NOT use `npm run python:bundle` — skip that step!

---

## 📋 User Installation Guide (to include with installer)

Copy this text for your README or user guide:

```markdown
# Installation Requirements

This version of Embroidery Converter requires **Python 3.7 or later** installed on your system.

## Windows:
1. Install Python from https://www.python.org/downloads/
   - ✅ Check "Add Python to PATH" during installation
2. Run the installer
3. Launch Embroidery Converter

## macOS:
1. macOS 10.13+ includes Python 3 by default
2. If needed, install via Homebrew: `brew install python3`
3. Open the DMG and drag to Applications
4. Launch Embroidery Converter

## Verify Python:
- Windows: Open Command Prompt, type `python --version`
- macOS: Open Terminal, type `python3 --version`

You should see Python 3.7 or higher.

## Troubleshooting:
If the app shows "Backend error", Python is not installed or not in PATH.
Install Python and restart the app.
```

---

## ✅ Distribution Checklist

Before distributing Option 1 installers:

- ✅ Verify installer does NOT contain bundled Python binary
- ✅ Test on machine WITH Python 3.7+ → should work
- ✅ Test on machine WITHOUT Python → should show clear error
- ✅ Include Python requirement in installer description
- ✅ Provide installation guide for users (see above)
- ✅ Test on multiple Python versions (3.7, 3.9, 3.11)

---

## 🎁 When to Use Option 1 vs Option 2

**Use Option 1 (Lightweight) when:**
- ✅ Target audience is developers or tech-savvy users
- ✅ You want faster downloads and installations
- ✅ Users likely already have Python installed
- ✅ Smaller file size is important (bandwidth, hosting costs)

**Use Option 2 (Self-Contained) when:**
- ✅ Target audience is non-technical end users
- ✅ You want "just works" out-of-the-box experience
- ✅ Users may not have or want to install Python
- ✅ Larger file size is acceptable

**Recommendation:** Offer both! Let users choose based on their needs.

---

**Built with ❤️ using Electron and pyembroidery**

*Copyright © 2024 orgware.ai (andkoma@akopp.de). Created with AI support.*
