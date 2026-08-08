# 🍎 macOS x64 (Intel) Setup Guide

> **⚠️ Important:** x64 Intel Macs require **System Python** with `pyembroidery` installed.
> Arm64 (Apple Silicon) uses a bundled binary and does NOT need Python.

---

## Overview

**Architecture Differences:**

| Aspect | arm64 (Apple Silicon M1+) | x64 (Intel) |
|--------|---------------------------|-----------|
| **Bundled Binary** | ✅ Included | ❌ Not available* |
| **Execution Method** | Native PyInstaller binary | System Python |
| **Python Required** | ❌ No | ✅ **Yes** |
| **Installation** | Extract DMG → Done | Extract DMG → Install Python |

*GitHub Actions only provides arm64 runners, so x64 PyInstaller builds are not available.

---

## Installation Steps

### 1️⃣ Install the App

1. Download `Embroidery Converter-1.2.43-x64.dmg` from [Releases](https://github.com/andkoma/embroidery-converter/releases)
2. Open the DMG and drag **Embroidery Converter** to **Applications**
3. (Optional) Remove quarantine: `xattr -c /Applications/Embroidery\ Converter.app`

### 2️⃣ Install Python 3

Choose **one** of these options:

#### Option A: Homebrew (Recommended)
```bash
brew install python@3.9
```

#### Option B: python.org Installer
- Visit [python.org](https://www.python.org/downloads/macos/)
- Download Python 3.9+ for macOS (Intel)
- Run the installer

#### Option C: MacPorts
```bash
sudo port install python39 +universal
```

#### Option D: Conda/Anaconda
```bash
conda install python=3.9
```

### 3️⃣ Install `pyembroidery`

Open **Terminal** and run:

```bash
# If you installed Python via Homebrew:
python3 -m pip install pyembroidery

# OR if you have multiple Pythons:
/usr/local/bin/python3 -m pip install pyembroidery
```

**Verify installation:**
```bash
python3 -c "import pyembroidery; print('✅ pyembroidery is installed')"
```

### 4️⃣ Start the App

Launch **Embroidery Converter** from Applications or Spotlight.

✅ The app will detect your Python installation automatically.

---

## Troubleshooting

### ❌ "Failed to start backend: span Unknown system error -86"

**Cause:** Missing Python or `pyembroidery` not installed.

**Solution:** Follow steps 2-3 above, then restart the app.

### ❌ "Python found but pyembroidery not installed"

**Solution:** Run the installation command from Step 3.

### ❌ App says "No Python backend found"

**Check if Python is installed:**
```bash
python3 --version
python --version
which python3
```

If nothing prints, install Python using one of the options in Step 2.

### ❌ Multiple Python installations conflict

The app searches for Python in this order:
- `python3` (in PATH)
- `/usr/local/bin/python3`
- `/opt/homebrew/bin/python3` (Homebrew on arm64)
- `/Library/Frameworks/Python.framework/Versions/*/bin/python3`
- Conda/Anaconda installations

If you have multiple, ensure `pyembroidery` is installed in the one that runs first:
```bash
which python3  # Shows which Python is used
python3 -m pip install pyembroidery
```

### ❌ Permission denied executing backend

**Solution:**
```bash
chmod +x /Applications/Embroidery\ Converter.app/Contents/MacOS/Embroidery\ Converter
```

---

## Performance Notes

- **arm64 (Apple Silicon):** Faster (native bundled binary, no Python startup overhead)
- **x64 (Intel):** Slower startup (Python initialization ~1-2 seconds per conversion)

Both are reliable for production use once dependencies are installed.

---

## For Developers

If building on x64, use:

```bash
npm install
python3 -m pip install pyembroidery  # Required for x64 local dev
npm start
```

The app will automatically find your system Python and use it as the backend.

---

## See Also

- [General macOS Installation](./MACOS_INSTALLATION.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Troubleshooting](./QUICK_FIX.sh)
