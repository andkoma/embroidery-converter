# 🏗️ Embroidery Converter — Architecture & Design Plan

**Status:** ✅ Phase A, B & C COMPLETE · **Version:** 0.4 · **Date:** 2026-08-05
**Author org:** orgware.ai (andkoma@akopp.de) · *Created with AI support.*

This document is the **design blueprint** for evolving the app from a single-screen
converter into a **multi-panel embroidery workstation**. No production code is
changed by this document — it exists to get agreement on structure before building.

> **Confirmed decisions (from requirements discussion):**
> 1. **Build order:** **A → B → C → D** (Shell+Batch → Gallery → Simulator → Machine Transfer).
> 2. **Options model:** every conversion option (format, resize, color) is available in
>    every mode, but **per-file settings are the default**; a shared profile is *optional*.
> 3. **Machine transfer (for now):** USB carriers/cables appear to the OS as a
>    **mounted/shared filesystem**, so the requirement is to reliably target **mounted
>    or network share folders as the output destination**. Deeper protocols come later.
> 4. **This deliverable:** the design/architecture plan itself, covering full future scope.

---

## 1. Vision & Goals

Transform the app into a workstation with distinct, purpose-built **views** that share
one backend, one data model, and one settings store:

| View | Purpose | Phase |
|------|---------|-------|
| **Convert** | Today's single/few-file conversion with rich per-file options | (exists) |
| **Batch** | Add folders, scan recursively, filter/search, mark files, convert many | **A** |
| **Gallery / Explorer** | File-manager-style browse of managed folders with previews, filter, detail pane | **B** |
| **Simulator** | Time-lapse animation of the stitch-out for a selected file | **C** |
| **Machine Transfer** | Send files to machines via mounted USB / network shares (later: link protocols) | **D** |

### Design principles

- **One shell, many views.** A persistent left navigation rail switches views; each view
  is a self-contained module that mounts/unmounts into a shared content area.
- **Shared core, isolated UI.** All views call the same backend commands and share a
  central store (files, thread/preview cache, settings). UI concerns stay in the view.
- **Per-file first.** Options attach to a file record by default; a batch "profile" is an
  optional overlay that fills gaps where a file has no explicit override.
- **Backend stays stateless & JSON-based.** The Python backend remains a set of
  request→response subcommands. Long-running/streamed work (folder scans, simulation
  frames) uses a small streaming extension (NDJSON) rather than a stateful server.
- **Additive, non-breaking.** Existing IPC channels (`backend:convert`, etc.) keep working;
  new capabilities are added alongside. The current Convert screen is preserved.

---

## 2. Current State (baseline)

```
Electron main (main.js)
  ├─ resolveBackend()  → bundled PyInstaller binary OR system python + scripts/convert.py
  ├─ runBackend(cmd,payload) → spawn child, parse single JSON on stdout
  └─ ipcMain.handle: backend:{status,formats,inspect,convert},
                     dialog:{openFiles,selectOutputDir}, fs:defaultDir,
                     shell:{openPath,showItem}
preload.js → window.api (thin invoke wrappers)
renderer/  → single screen (index.html + renderer.js + styles.css + i18n.js)
scripts/convert.py → inspect | convert | formats   (+ vendored pyembroidery)
```

**Constraint that shapes the redesign:** the single `renderer.js` owns one screen's
worth of global state and DOM wiring. Adding more screens to it would not scale — hence
the shell + view-module refactor in Phase A.

---

## 3. Target Architecture

### 3.1 High-level component map

```
┌──────────────────────────────────────────────────────────────────┐
│ Electron Main (main.js + main/ modules)                            │
│   • backend runner (request/response + NDJSON streaming)           │
│   • settings store (electron JSON on disk)                         │
│   • folder/library service (managed roots, scans, watchers)        │
│   • device/volume service (list mounts & removable drives)         │
│   • IPC registry (grouped handlers)                                │
└───────────────▲───────────────────────────────▲───────────────────┘
                │ contextBridge (preload)         │ NDJSON events
┌───────────────┴───────────────────────────────┴───────────────────┐
│ Renderer (SPA shell)                                               │
│                                                                    │
│  NavRail ─ Convert │ Batch │ Gallery │ Simulator │ Transfer        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ViewHost (mounts the active view module)                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  Shared Store: files, previews cache, formats, settings, jobs      │
│  Shared UI kit: OptionsPanel, PreviewThumb, ThreadList, StatusPill │
└────────────────────────────────────────────────────────────────────┘
        │ spawn / stream
┌───────┴────────────────────────────────────────────────────────────┐
│ Python backend (scripts/convert.py → grows into a small package)     │
│   inspect | convert | formats            (existing)                  │
│   scan | preview | thumbs (batch)        (Phase A/B)                 │
│   simulate (frame timeline)              (Phase C)                   │
│   probe-destination (write test)         (Phase D)                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Renderer structure (proposed folders)

```
renderer/
├── index.html            # shell only: nav rail + <main id="viewHost">
├── styles/               # split CSS: base.css, shell.css, per-view css
├── core/
│   ├── store.js          # central reactive state (files, settings, jobs)
│   ├── api.js            # typed wrappers over window.api
│   ├── router.js         # view switching + lifecycle (mount/unmount)
│   └── events.js         # subscribe to streamed backend events
├── components/           # reusable UI: OptionsPanel, PreviewThumb, ThreadList…
├── views/
│   ├── convert/          # existing screen, migrated into a view module
│   ├── batch/            # Phase A
│   ├── gallery/          # Phase B
│   ├── simulator/        # Phase C
│   └── transfer/         # Phase D
└── i18n.js               # extended with new keys per view
```

> **Framework choice (open question Q1):** the current app is dependency-free vanilla JS.
> A multi-view app is very manageable with a tiny homegrown router + a small reactive
> store (no build step, keeps installers lean). If you'd prefer a framework (e.g. Preact/
> Svelte) I'll note the trade-off, but my recommendation is **vanilla + ~100-line micro
> store/router** to avoid a bundler and keep the security/CSP model simple.

---

## 4. Shared Data Models

These live in the renderer store and are also the JSON contracts with the backend.

### 4.1 `FileRecord` (per-file, the heart of the per-file-first model)
```jsonc
{
  "id": "uuid",
  "path": "/abs/path/rose.pes",
  "name": "rose.pes",
  "ext": "pes",
  "size_bytes": 20480,
  "meta": {                     // from `inspect`
    "stitches": 2847,
    "colors": 3,
    "width_mm": 52.3, "height_mm": 48.1,
    "threads": [{ "hex": "#e74c3c" }, ...]
  },
  "preview": { "left":0,"top":0,"width":523,"height":481,
               "lines":[{ "hex":"#e74c3c","pts":[[x,y],...] }] },
  "options": {                  // PER-FILE overrides (all optional)
    "output_format": "dst",
    "resize": { "width_mm": 50, "height_mm": null, "lock_aspect": true, "resample": true },
    "colors": { "limit": 12 }
  },
  "status": "pending|inspecting|ready|converting|done|error",
  "result": { "output_path": "...", "warnings": [] },
  "error": null
}
```

### 4.2 `BatchProfile` (optional shared overlay)
```jsonc
{
  "output_format": "dst",
  "resize": { "width_mm": null, "height_mm": null, "lock_aspect": true, "resample": false },
  "colors": { "limit": null },
  "output_dir": "/Volumes/BROTHER/",   // may be a mounted USB / share
  "naming": { "pattern": "{name}.{ext}", "on_conflict": "suffix|overwrite|skip" }
}
```
**Resolution rule:** effective option = `file.options.X ?? profile.X ?? appDefault.X`.
Per-file always wins; the profile only fills gaps. This satisfies *“optional for all,
per-file by default.”*

### 4.3 `ManagedFolder` (Gallery/Batch roots) & `AppSettings`
```jsonc
// settings.json (persisted by main process)
{
  "language": "en",
  "theme": "light",
  "managedFolders": [
    { "id":"uuid", "path":"/Users/me/Designs", "recursive": true, "watch": true }
  ],
  "recentOutputDirs": ["/Volumes/USB_MACHINE", "/Users/me/out"],
  "gallery": { "typeFilter": ["pes","dst","jef"], "sort": "name", "thumbSize": 128 },
  "transfer": { "favoriteDestinations": [{ "label":"Brother USB","path":"/Volumes/…" }] }
}
```

### 4.4 `Job` (unifies Convert & Batch runs)
```jsonc
{
  "id":"uuid", "kind":"convert|batch",
  "items":[{ "fileId":"…","status":"…","output_path":"…","warnings":[] }],
  "progress": { "done": 3, "total": 20 },
  "startedAt": 0, "finishedAt": 0, "cancelRequested": false
}
```

---

## 5. Backend Evolution (Python)

`scripts/convert.py` grows into a small package `scripts/embroidery_backend/` while
**keeping the same CLI contract** (subcommand + JSON payload → JSON on stdout). New
subcommands:

| Command | Args | Returns | Phase |
|--------|------|---------|-------|
| `inspect` | `{input_path}` | meta + preview *(exists)* | – |
| `convert` | `{input_path,output_path,output_format,options}` | result + warnings *(exists)* | – |
| `formats` | `{}` | read/write format list *(exists)* | – |
| `scan` | `{roots:[…],recursive,exts:[…],query}` | **NDJSON** stream of lightweight file entries | A/B |
| `thumbs` | `{paths:[…],max_points}` | preview polylines per path (batchable) | A/B |
| `simulate` | `{input_path,segment_len,max_frames}` | ordered stitch timeline / frame chunks (NDJSON) | C |
| `probe-destination` | `{dir}` | `{writable, free_bytes, fs_type, warnings}` | D |

**Streaming design (NDJSON):** for `scan` and `simulate`, the backend prints one JSON
object per line and flushes; main.js reads line-by-line and forwards each as an IPC event
(`backend:stream`) tagged with a `requestId`. This keeps big folder scans and long
simulations responsive and cancellable **without turning the backend into a server**.

**Cancellation:** main.js keeps a map of `requestId → child`. A `backend:cancel`
IPC kills the child; the renderer resolves the job as cancelled.

---

## 6. IPC Surface Evolution

Existing channels stay. New, grouped additions (exposed through `preload.js`):

```
window.api = {
  // existing
  backendStatus, listFormats, inspect, convert,
  openFiles, selectOutputDir, defaultDir, openPath, showItem, platform,

  // settings (Phase A)
  getSettings(), setSettings(patch),

  // folders & scanning (Phase A/B)
  pickFolders(), scanFolders({roots,recursive,exts,query}, onEntry) → requestId,
  makeThumbs(paths) ,

  // jobs (Phase A)
  runBatch(job, onProgress) → requestId,
  cancel(requestId),

  // simulator (Phase C)
  simulate({path,...}, onFrame) → requestId,

  // devices / destinations (Phase D)
  listVolumes(),                 // removable drives + network mounts
  probeDestination(dir),         // writable? space? fs type?
}
```

Streaming callbacks are wired via a single `backend:stream` event demultiplexed by
`requestId` inside `core/events.js`.

---

## 7. View Specifications

### 7.1 Convert (existing → migrated)
- Behavior unchanged for the user. Internally becomes `views/convert/` consuming the
  shared store + `OptionsPanel` component.
- **Migration only** — no feature change in Phase A beyond relocation.

### 7.2 Batch (Phase A) — *primary pain-point fix*
**Layout:** three regions
1. **Sources** — add folders (or drop them); recursive toggle; live count.
2. **File table** — virtualized list of scanned files with columns: thumb, name,
   type, stitches, colors, size (mm), and a **selection checkbox**. Toolbar with
   **search box** + **type filter chips** (`.pes .dst .jef …`) + "select all/filtered".
3. **Conversion setup** — a **BatchProfile** editor (format, resize, color, output
   folder, naming/conflict policy) **plus** the ability to open any row and set
   **per-file overrides** (defaults to per-file; profile fills the rest).

**Flow:** add folders → `scan` streams entries → user filters/searches → marks files →
sets profile and/or per-file options → **Convert marked** → `runBatch` streams progress →
per-row status + summary (done/skipped/errors) with "reveal in folder".

**Why this fixes the dialog problem:** per-file option dialogs don't scale to hundreds of
files, so batch uses a shared profile by default while still honoring any per-file override.

### 7.3 Gallery / Explorer (Phase B)
- **Managed folders** rail (add/remove roots, recursive, optional watch for changes).
- **Thumbnail grid** with adjustable size; lazy `thumbs` generation + on-disk thumb cache
  keyed by path+mtime.
- **Filter/search** by name and type; **sort** by name/size/stitches/colors/date.
- **Detail pane** on select: large preview, stitch count, color palette (swatches),
  dimensions, format read/write capability, path; quick actions → *Send to Convert*,
  *Send to Batch*, *Simulate*, *Transfer*.
- Reuses `PreviewThumb`, `ThreadList` components from Phase A.

### 7.4 Stitch Simulator (Phase C)
- **Canvas player** that draws stitches incrementally along the real stitch order.
- Controls: play/pause, **scrub slider**, speed (1×–32×), stitch counter, jump color-to-color.
- Rendering: progressive polyline draw; optional needle marker; color changes honored.
- Data via `simulate` (ordered segments streamed as NDJSON; large files chunked/decimated
  like the current preview's 4000-point cap, but ordered for animation).
- Export (optional, later): render timeline to a video/GIF using the media pipeline.

### 7.5 Machine Transfer (Phase D)
**Now (in scope):** treat machine carriers as **mounted filesystems**.
- **Destination picker** that lists **removable drives & network mounts** (via a
  `listVolumes` service in main using OS facilities) plus manual folder pick and
  **favorite destinations**.
- **`probe-destination`**: verify writable, show free space & filesystem type, and warn on
  common gotchas (e.g., FAT32 filename limits, format not supported by the target machine).
- **Transfer action**: convert (if needed) → copy to destination → verify → eject hint.
- **Machine profiles (data-driven):** a small JSON registry mapping a machine/brand to its
  accepted formats, folder conventions, and filename constraints, so the UI can validate
  before writing. Starts minimal; grows over time.

**Later (out of scope now, but designed for):** USB-link cable protocols, WLAN upload,
SewNet-style cloud services. These become **pluggable "transport" providers** behind a
common `Transport` interface (`list()`, `probe()`, `send()`), so the mounted-folder case is
just the first provider and new transports drop in without UI rewrites.

---

## 8. Cross-Cutting Concerns

- **i18n:** every new view ships EN/DE/FR keys; `i18n.js` gains namespaced sections
  (`batch.*`, `gallery.*`, `sim.*`, `transfer.*`). No hard-coded UI strings.
- **Performance:** virtualized lists (Batch/Gallery), thumbnail caching, point decimation,
  streaming scans, and cancellable jobs.
- **Security:** keep `contextIsolation:true`, `nodeIntegration:false`, current CSP.
  All new powers go through explicit, validated IPC handlers (path allow-listing for writes).
- **Settings persistence:** JSON file in `app.getPath('userData')`, read on boot, patched via
  `setSettings`. Managed folders, favorites, filters, language persist here.
- **Error handling:** the never-throw structured-status pattern already used for
  `backend:status` extends to scans/transfers (actionable messages, not bare errors).
- **Testing:** backend subcommands get focused Python tests (isolated interpreter, as done
  for the vendored lib); renderer store/reducers get lightweight unit checks; each phase
  ends with an end-to-end smoke run under Xvfb.

---

## 9. Phased Delivery Plan

### Phase A — Multi-view shell + Batch  ✅ **COMPLETE**
- A1. ✅ Introduce shell: nav rail + `ViewHost` + micro router/store; **migrate Convert**
  unchanged into `views/convert/`. *(refactor, no UX change)*
- A2. ✅ Settings service (main) + `getSettings/setSettings`; persist language + folders.
- A3. ✅ Backend `scan` (NDJSON) + `thumbs`; main streaming plumbing + `cancel`.
- A4. ✅ Batch view: sources, virtualized filter/search table, selection.
- A5. ✅ `BatchProfile` + per-file override model + resolution rule; `runBatch` with progress.
- A6. ✅ i18n (EN/DE/FR batch.* keys) + syntax validation; docs update.
- **Exit criteria:** ✅ user adds folders, filters/marks files, converts many to an output
  folder (incl. a mounted/share path) with batch profile options applied.

**Commits:** 778468c (A1), 44b58dc (A2), 1ee5caf (A3), 174ca24 (A4), 3ead395 (A5), 4ec7a3a (A6)

### Phase B — Gallery / Explorer  ✅ **COMPLETE**
- B1. ✅ Gallery view skeleton with three-panel layout (Folders | Grid | Detail)
- B2. ✅ Managed folders with add/remove + persistence via settings.galleryFolders
- B3. ✅ Folder scanning using existing NDJSON streaming backend
- B4. ✅ Filter chips by extension, search bar, sort options (name/size/stitches)
- B5. ✅ Thumbnail grid with IntersectionObserver lazy loading (viewport-aware)
- B6. ✅ Detail pane with large preview, metadata, and hand-off actions
- B7. ✅ i18n (EN/DE/FR gallery.* keys) + syntax validation

**Exit criteria:** ✅ user adds folders, scans files, filters/searches, views lazy-loaded
thumbnails in grid, clicks for detail view with metadata and actions (Send to
Convert/Batch/Simulator, Show in Folder).

**Commits:** 0b05d79 (B1: skeleton + folder mgmt), be4d789 (B2-B7: lazy loading + i18n)

### Phase C — Stitch Simulator  ✅ **COMPLETE**
- C1. ✅ Simulator view skeleton with three-panel layout (Controls | Canvas | Info)
- C2. ✅ HTML5 Canvas rendering with progressive stitch-by-stitch drawing
- C3. ✅ Playback controls: Play/Pause, Reset, Timeline scrubber, Speed (0.5x-10x)
- C4. ✅ Color navigation: Prev/Next color block jumps, palette display with click-to-jump
- C5. ✅ Gallery integration: Hand-off via `gallery:send-to-simulator` event
- C6. ✅ Animation engine: requestAnimationFrame with adjustable stitches/sec
- C7. ✅ i18n (EN/DE/FR simulator.* keys) + syntax validation

**Exit criteria:** ✅ user loads embroidery file (via button or Gallery hand-off), sees
canvas-rendered stitches with actual thread colors, plays/pauses animation with smooth
playback at adjustable speed, scrubs timeline to any stitch position, jumps between color
blocks using prev/next buttons or palette clicks.

**Commits:** [C1-C7: complete simulator implementation]

### Phase D — Machine Transfer
- `listVolumes` + `probe-destination`; destination picker with removable/network mounts +
  favorites; machine profile validation; convert→copy→verify. Transport-provider seam for
  future USB-link/WLAN/SewNet. Exit: reliably write correct formats to a mounted machine.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Refactor regresses the working Convert screen | Migrate first with **zero UX change**; keep IPC identical; smoke test before adding Batch |
| Large libraries (10k+ files) sluggish | Streaming scan, virtualization, thumbnail cache, decimation |
| Cross-platform volume enumeration differs | Isolate in a main-process `device service`; per-OS strategy; manual folder pick always available as fallback |
| FAT32 / machine filename limits break writes | `probe-destination` + machine profiles validate before copy |
| Scope creep across 4 phases | Strict per-phase exit criteria; each phase shippable on its own |

---

## 11. Design Decisions (locked in 2026-08-05)

- **Q1. Renderer tech:** ✅ **Vanilla JS + micro router/store** (no bundler, no framework).
- **Q2. Navigation style:** ✅ Left **icon rail** with view labels.
- **Q3. Batch naming/conflicts:** ✅ Default to **suffix** `name (1).dst`; user can override.
- **Q4. Gallery watching:** ✅ **Auto-watch** managed folders with a manual refresh button.
- **Q5. Simulator export:** ✅ **Playback-only** in Phase C; revisit video/GIF export later.
- **Q6. Machine profiles (Phase D):** Target brands confirmed:
  - **Husqvarna** (Viking), **Brother**, **Singer**, **Pfaff**, **Janome**, **Bernina**.
  - Validation to cover format support, filename constraints (8.3 on older FAT), folder conventions.

---

## 12. What This Plan Does *Not* Change Yet

- No production code is modified by this document.
- The current Convert screen, backend commands, and installers remain as-is until Phase A
  begins and is signed off.

---

*Once you approve (and answer Q1–Q5; Q6 can follow), I'll begin **Phase A**: the shell +
Batch panel, migrating the existing Convert screen in without changing its behavior.*

*Copyright © 2026 orgware.ai (andkoma@akopp.de). Created with AI support.*
