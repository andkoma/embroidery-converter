# Embroidery Converter

A cross-platform **Electron** desktop app for converting embroidery stitch files
between machine formats. Conversion is powered by the Python
[`pyembroidery`](https://github.com/EmbroidePy/pyembroidery) library, which
supports 80+ embroidery formats.

![formats](https://img.shields.io/badge/formats-DST%20PES%20JEF%20VP3%20HUS%20XXX%20EXP%20SEW%20U01%20%E2%80%A6-5b5bd6)

## Features

- **Drag & drop** any number of embroidery files onto the window (or browse).
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
│   └── renderer.js
├── scripts/
│   ├── convert.py        pyembroidery read / transform / write logic
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

```bash
# Current platform
npm run build

# Windows NSIS installer (.exe)  ->  release/
npm run build:win

# macOS DMG (.dmg)               ->  release/
npm run build:mac
```

electron-builder configuration (in `package.json`):

- `appId`: `com.embroideryconverter.app`
- `productName`: `Embroidery Converter`
- **Windows**: `nsis` target, icon `assets/icon.ico`
- **macOS**: `dmg` target, icon `assets/icon.icns`
- Output directory: `release/`

### Recommended full release flow

```bash
npm install
pip install -r scripts/requirements.txt pyinstaller
npm run python:bundle     # produces pybuild/dist/convert[.exe]
npm run build:win         # on Windows  -> release/*.exe
npm run build:mac         # on macOS    -> release/*.dmg
```

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
