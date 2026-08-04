# Embroidery Converter

A cross-platform **Electron** desktop app for converting embroidery stitch files
between machine formats. Conversion is powered by the Python
[`pyembroidery`](https://github.com/EmbroidePy/pyembroidery) library, which
supports 80+ embroidery formats.

![formats](https://img.shields.io/badge/formats-DST%20PES%20JEF%20VP3%20HUS%20XXX%20EXP%20SEW%20U01%20%E2%80%A6-5b5bd6)

---

## 📥 Quick Download

**Ready to install?** Choose your platform:

| Platform | Download |
|----------|----------|
| 🍎 **macOS (Apple Silicon M1/M2/M3/M4)** | [Download arm64.dmg](https://github.com/andkoma/embroidery-converter/releases/latest) |
| 🍎 **macOS (Intel)** | [Download x64.dmg](https://github.com/andkoma/embroidery-converter/releases/latest) |
| 🪟 **Windows (11/10)** | [Download Setup.exe](https://github.com/andkoma/embroidery-converter/releases/latest) |

👉 **[See all versions & detailed instructions](./DOWNLOADS.md)**

---

## 📖 About This Project

👉 **[Learn about the project, authors, and vision](./ABOUT.md)**

**Embroidery Converter** is a free, open-source solution for converting embroidery files between 50+ machine formats. Created by Andrew Kopp, a computer scientist with 40+ years of experience in IT, now building creative tools in his second life.

**Key Facts:**
- 🎯 **Author:** Andrew Kopp ([orgware.ai](https://orgware.ai)) – AI & Educational Tech Specialist
- 📜 **License:** MIT (free for personal & commercial use)
- 🚀 **Built with:** Electron + pyembroidery + AI-assisted development
- 🌍 **Community-driven** – Issues, PRs, and suggestions welcome!

---

## Features

- **Drag & drop** any number of embroidery files onto the window (or browse).
- **Input preview gallery** — each added file shows a small vector thumbnail of
  the actual stitches (rendered in its thread colors) so you get visual feedback
  before converting.
- **Multi-language UI** — switch the interface between **English**, **Deutsch**
  and **Français** from the language selector in the top bar (remembered between
  sessions).
- **Read** formats: DST, PES, PEC, JEF, VP3, HUS, XXX, EXP, SEW, U01, TAP, PHB,
  PHC, BRO, DAT, DSB, DSZ, EMD, 10O, 100, SHV, KSM, MAX, JPX, TBF, GT, INB, ZXY,
  CSV, JSON, GCODE and more.
- **Write** formats: PES, DST, JEF, VP3, EXP, XXX, PEC, U01, TBF, PMV, CSV, JSON,
  GCODE, SVG, PNG (writable set is queried live from `pyembroidery`).
- **Per-file metadata**: stitch count, color count, and dimensions in millimetres,
  shown as soon as a file is dropped.
- **Format-specific options panel**:
  - **Color count reduction** — cap the number of color blocks for formats with
    limited color slots; extra color changes are merged.
  - **Color palette** display and (visual) editing of thread colors.
  - Hints when the target format (e.g. DST/EXP) stores no color information.
- **Resize with stitch resampling** — enter target width/height in mm, lock the
  aspect ratio, and optionally **resample stitches** so stitch *density* is
  preserved instead of simply stretching coordinates.
- **Output folder** selector, **Convert** button, progress bar, and per-file
  status icons (pending / converting / done / error) with conversion warnings.
- **Installers** for Windows (NSIS `.exe`) and macOS (`.dmg`) via
  `electron-builder`.

## Project structure

```
embroidery_converter/
├── package.json          Electron + electron-builder config
├── main.js               Electron main process (spawns the Python backend)
├── preload.js            contextBridge IPC bridge
├── renderer/
│   ├── index.html
│   ├── styles.css
│   ├── i18n.js           EN / DE / FR interface translations
│   └── renderer.js
├── scripts/
│   ├── convert.py        pyembroidery read / transform / write logic
│   ├── vendor/
│   │   └── pyembroidery/ bundled pure-Python engine (no pip needed)
│   └── requirements.txt
├── assets/               icon.ico, icon.icns, icon.png
└── README.md
```

## Architecture

- The **main process** (`main.js`) manages the window and spawns the Python
  backend via `child_process`. It resolves the backend in this order:
  1. A **bundled PyInstaller binary** at `resources/pybin/convert[.exe]`
     (used in packaged builds — no Python required on the user's machine).
  2. The **system Python** running `scripts/convert.py` (used in development).
     `main.js` searches a broad list of interpreter locations (Homebrew,
     python.org framework, pyenv, conda, `Program Files`, …) because a
     GUI-launched app does **not** inherit the shell `PATH`. If no working
     Python 3 is found, the backend badge reports the reason instead of a bare
     "Backend error".
- **Vendored `pyembroidery`** — a full copy of the pure-Python `pyembroidery`
  library ships in `scripts/vendor/pyembroidery` and is prepended to
  `sys.path` by `convert.py`. This means the source app works with **any** plain
  Python 3 interpreter — no `pip install` step is required for the conversion
  engine to run.
- The **backend** (`scripts/convert.py`) exposes three sub-commands, each taking
  a JSON argument and returning a single JSON object on stdout:
  - `inspect {"input_path": "..."}` → metadata + thread palette.
  - `convert {"input_path","output_path","output_format","options"}` → result.
  - `formats {}` → supported formats with read/write capability.
- The **renderer** (`renderer/`) provides the drag & drop UI and talks to the
  main process only through the safe `window.api` bridge defined in `preload.js`
  (contextIsolation on, nodeIntegration off).

### `convert.py` options

```jsonc
{
  "input_path":   "/abs/in.dst",
  "output_path":  "/abs/out.pes",
  "output_format":"pes",
  "options": {
    "resize_width_mm":   120.0,   // optional target width  (mm)
    "resize_height_mm":  80.0,    // optional target height (mm)
    "resample_stitches": true,    // re-space stitches to keep density
    "color_limit":       15       // cap number of color blocks
  }
}
```

Result:

```jsonc
{
  "success": true,
  "stitch_count": 1234,
  "color_count": 3,
  "width_mm": 120.0,
  "height_mm": 80.0,
  "output_path": "/abs/out.pes",
  "warnings": ["Resampled stitches to preserve density (203 -> 782 stitches)."]
}
```

> pyembroidery works internally in units of **1/10 mm** (10 units = 1 mm); the
> script converts to/from millimetres for you.

---

## 📦 Installation

### For End Users
👉 **[Download the latest release](./DOWNLOADS.md)** for your platform:
- macOS (arm64 or x64)
- Windows (11/10)

See [DOWNLOADS.md](./DOWNLOADS.md) for:
- System requirements
- Step-by-step installation
- Which version to download

After installation, see [GETTING_STARTED.md](./GETTING_STARTED.md) for first-time setup and testing!

---

## Development setup

Requires **Node.js 18+** and **Python 3.8+**.

```bash
# 1. Install Node dependencies
npm install

# 2. Install the Python backend dependency
pip install -r scripts/requirements.txt      # installs pyembroidery

# 3. Run the app (uses your system Python)
npm start
```

During development the app automatically detects `python3` / `python` on your
`PATH` and runs `scripts/convert.py`. The backend status indicator in the top
right shows **“System Python ready”** when everything is wired up.

---

## Bundling Python with PyInstaller (self-contained builds)

For distributable installers you don't want end users to install Python. Bundle
`convert.py` into a single self-contained executable with
[PyInstaller](https://pyinstaller.org/), then let `electron-builder` copy it
into the app resources.

```bash
# Install build tools (in the same Python env that has pyembroidery)
pip install pyinstaller pyembroidery

# Build the backend binary  ->  pybuild/dist/convert[.exe]
npm run python:bundle
# (equivalent to:)
# pyinstaller --onefile --distpath ./pybuild/dist --workpath ./pybuild/build \
#             --specpath ./pybuild --name convert scripts/convert.py
```

`package.json` already declares:

```jsonc
"extraResources": [
  { "from": "scripts",       "to": "scripts", "filter": ["**/*"] },
  { "from": "pybuild/dist",  "to": "pybin",   "filter": ["**/*"] }
]
```

so the binary lands at `resources/pybin/convert[.exe]` inside the packaged app.
At runtime `main.js` prefers this bundled binary and only falls back to system
Python if it is missing.

> **Platform note:** PyInstaller produces a binary for the OS it runs on. Build
> the Windows `convert.exe` on Windows and the macOS `convert` on macOS (each
> just before running the corresponding `electron-builder` target).

---

## Building installers

**You have two build options:**

### Option 1: Lightweight (~100 MB, requires Python 3.7+)
Users must have Python 3.7+ installed. Smaller download, faster installation.

```bash
npm install
rm -rf pybuild/dist/convert*
npm run build:win   # or build:mac
```

📖 **See [BUILD_OPTION1.md](./BUILD_OPTION1.md)** for complete guide.

---

### Option 2: Self-Contained (~150 MB, no Python required)
Everything bundled. Works out-of-the-box, no dependencies.

```bash
npm install
pip install pyinstaller
npm run python:bundle
npm run build:win   # or build:mac
```

📖 **See [BUILD.md](./BUILD.md)** for complete guide.

---

### Which option should I choose?

📊 **See [BUILD_COMPARISON.md](./BUILD_COMPARISON.md)** for detailed comparison and recommendations.

**Quick guide:**
- **Commercial/end-user software?** → Use **Option 2** (self-contained)
- **Internal/developer tools?** → Use **Option 1** (lightweight)
- **Not sure?** → Offer **both** and let users choose!

### Pre-flight checklist

Before building for distribution, review [PREFLIGHT_CHECKLIST.md](./PREFLIGHT_CHECKLIST.md) to ensure quality and verify all features work correctly.

---

## 🚀 Automated Builds with GitHub Actions

This project uses **GitHub Actions** for automatic cross-platform builds:

- **macOS builds** (arm64 + x64) on every release tag
- **Windows builds** automatically via GitHub runners
- **Installers uploaded** as release assets

📖 **See [CI_CD.md](./CI_CD.md)** for setup and usage.

**Quick start:**
```bash
git tag v1.0.1
git push --tags
```
→ Builds trigger automatically, results appear in Releases tab after ~15 minutes.

---

## 📥 Getting Started After Installation

New users can test the app immediately with sample files:

📖 **See [GETTING_STARTED.md](./GETTING_STARTED.md)** for:
- How to get sample files
- Step-by-step test workflow
- Format reference guide
- Troubleshooting tips

**Quick test:**
```bash
cd samples/
python3 generate_samples.py
```
Then drag generated `.pes`, `.dst`, `.jef` files into the app!

---

## 📋 License & Third-Party Attributions

This project respects all open-source licenses:

- **Electron** (MIT) — Desktop framework
- **electron-builder** (MIT) — App packaging
- **pyembroidery** (MIT) — Format conversion engine

📖 **See [LICENSES.md](./LICENSES.md)** for complete license information and attribution.

---

## Supported format notes

- **DST / EXP / TAP** store no thread color information — colors are dropped when
  writing to these formats (the app warns you).
- **Color reduction** merges the stitches of removed color blocks into the
  preceding block; it does not perform perceptual color quantization.
- **Resample stitches** subdivides long stitch segments created by up-scaling so
  the resulting stitch density stays close to the original. Very large upscales
  will increase stitch counts significantly.

## License

MIT

## Copyright & Credits

Copyright © 2024 **[orgware.ai](https://orgware.ai)** — [andkoma@akopp.de](mailto:andkoma@akopp.de)

**Learn more:**
- 📖 [About the project & authors](./ABOUT.md)
- 📋 [License & third-party attributions](./LICENSES.md)

> **EU AI Act Transparency Notice:** This application was developed with AI support,
> in accordance with EU AI Act transparency requirements.
