#!/usr/bin/env python3
"""
Capture screenshots of every Embroidery Converter view by driving the REAL
renderer chrome (index.html + all core/shell/view scripts) in headless
Chromium.  Only `window.api` (the Electron preload bridge) is stubbed — every
other layer (store, router, i18n, shell, the five views) runs authentically.

The stub returns REAL backend data: formats + per-file inspect results are
produced by invoking scripts/convert.py against the demo samples, so the
thumbnails, palettes and stitch previews shown are genuine.
"""
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(ROOT, "renderer")
SAMPLES = os.path.join(ROOT, "samples")
CONVERT = os.path.join(ROOT, "scripts", "convert.py")
OUT_DIR = os.path.join(ROOT, "docs", "screenshots")
os.makedirs(OUT_DIR, exist_ok=True)

VIEWPORT = {"width": 1280, "height": 820}

SAMPLE_FILES = [
    "tulip_flower.pes",
    "nautical_anchor.dst",
    "monogram_A.jef",
    "spiral_swirl.vp3",
    "tulip_flower.dst",
    "nautical_anchor.pes",
]


def backend(cmd, args):
    """Invoke the real Python backend and return parsed JSON (single object)."""
    p = subprocess.run(
        [sys.executable, CONVERT, cmd, json.dumps(args)],
        capture_output=True, text=True, cwd=ROOT,
    )
    out = p.stdout.strip()
    return json.loads(out) if out else {}


def build_data():
    """Collect formats + inspect metadata/preview for every sample file."""
    formats = backend("formats", {})
    files = []
    for name in SAMPLE_FILES:
        path = os.path.join(SAMPLES, name)
        if not os.path.isfile(path):
            continue
        meta = backend("inspect", {"input_path": path})
        st = os.stat(path)
        files.append({
            "path": path,
            "name": name,
            "ext": name.rsplit(".", 1)[-1].lower(),
            "size": st.st_size,
            "mtime": int(st.st_mtime * 1000),
            "inspect": meta,
        })
    return {
        "formats": formats.get("formats", []),
        "files": files,
        "samplesDir": SAMPLES,
    }


def init_script(data):
    """JS injected before any page script runs — stubs the window.api bridge."""
    return (
        "window.__EC = " + json.dumps(data) + ";\n"
        + r"""
(function () {
  const D = window.__EC;
  const byPath = new Map(D.files.map(f => [f.path, f]));
  function fileObj(f, extra) {
    return Object.assign({ path: f.path, name: f.name, ext: f.ext,
                           mtime: f.mtime, size: f.size, tags: [], category: '' }, extra || {});
  }
  const now = Date.now();
  // A demo Collections tree: two roots, one with nested subgroups.
  window.__SETTINGS = {
    language: 'en',
    theme: 'light',
    galleryFolders: [D.samplesDir],
    managedFolders: [{ id: 'demo', path: D.samplesDir, recursive: true }],
    conversion: { defaultFormat: 'dst', resample: false, colorLimit: null, onConflict: 'suffix' },
    transfer: { favoriteDestinations: [{ label: 'Brother USB', path: '/Volumes/BROTHER' }] },
    transferFavorites: [{ label: 'Brother USB', path: '/Volumes/BROTHER' }],
    defaultMachine: 'brother',
    ai: {
      enabled: true,
      autoTag: true,
      activeProviderId: 'prov-ollama',
      providers: [
        { id: 'prov-ollama', name: 'Ollama (local)', kind: 'ollama',
          baseUrl: 'http://localhost:11434', model: 'llava',
          requiresKey: false, secretRef: 'ai.provider.prov-ollama', enabled: true,
          capabilities: { vision: true, chat: true, embeddings: false },
          allow: { autoClassify: true, sendExternal: true } },
        { id: 'prov-openai', name: 'OpenAI', kind: 'openai',
          baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
          requiresKey: true, secretRef: 'ai.provider.prov-openai', enabled: false,
          capabilities: { vision: true, chat: true, embeddings: false },
          allow: { autoClassify: true, sendExternal: false } },
      ],
    },
    collections: [
      { id: 'c-nature', name: 'Nature Designs', parentId: null, tags: [], createdAt: now,
        files: [ fileObj(D.files[0], { category: 'Flowers', tags: ['floral','tulip'] }) ] },
      { id: 'c-flowers', name: 'Flowers', parentId: 'c-nature', tags: [], createdAt: now,
        files: D.files.filter(f => f.name.indexOf('tulip') === 0).map(f => fileObj(f, { category: 'Flowers', tags: ['floral'] })) },
      { id: 'c-swirls', name: 'Swirls', parentId: 'c-nature', tags: [], createdAt: now,
        files: D.files.filter(f => f.name.indexOf('spiral') === 0).map(f => fileObj(f)) },
      { id: 'c-marine', name: 'Nautical', parentId: null, tags: [], createdAt: now,
        files: D.files.filter(f => f.name.indexOf('nautical') === 0).map(f => fileObj(f, { category: 'Nautical', tags: ['anchor'] })) },
    ],
    projects: [
      { id: 'proj-demo', name: 'Spring Collection 2026', parentId: null, type: 'project', createdAt: now,
        assets: [
          { id: 'asset-1', name: D.files[0].name, path: D.files[0].path, kind: 'embroidery',
            size: D.files[0].size, mtime: D.files[0].mtime, addedAt: now,
            preview: D.files[0].inspect.preview, tags: ['floral'], category: 'Flowers',
            notes: 'Beautiful tulip design for spring projects', versions: [
              { id: 'v1', path: D.files[0].path, mtime: D.files[0].mtime, label: 'Original', isActive: true }
            ] },
          { id: 'asset-2', name: D.files[1].name, path: D.files[1].path, kind: 'embroidery',
            size: D.files[1].size, mtime: D.files[1].mtime, addedAt: now,
            preview: D.files[1].inspect.preview, tags: ['nautical'], category: 'Marine',
            notes: '', versions: [
              { id: 'v1', path: D.files[1].path, mtime: D.files[1].mtime, label: 'Original', isActive: true }
            ] },
        ],
        subfolders: [] },
      { id: 'proj-monograms', name: 'Monogram Library', parentId: null, type: 'project', createdAt: now,
        assets: [
          { id: 'asset-3', name: D.files[2].name, path: D.files[2].path, kind: 'embroidery',
            size: D.files[2].size, mtime: D.files[2].mtime, addedAt: now,
            preview: D.files[2].inspect.preview, tags: ['letter'], category: 'Monograms',
            notes: 'Letter A monogram', versions: [
              { id: 'v1', path: D.files[2].path, mtime: D.files[2].mtime, label: 'Original', isActive: true }
            ] },
        ],
        subfolders: [] },
    ],
  };
  function metaOf(f) {
    const m = f.inspect || {};
    return {
      stitch_count: m.stitch_count, color_count: m.color_count,
      color_changes: m.color_changes, width_mm: m.width_mm,
      height_mm: m.height_mm, threads: m.threads || [],
    };
  }
  window.api = {
    backendStatus: async () => ({ available: true, mode: 'bundled', pythonFound: true }),
    listFormats:   async () => ({ success: true, formats: D.formats }),
    inspect:       async (p) => {
      const f = byPath.get(p);
      return f ? f.inspect : { success: false, error: 'not found' };
    },
    convert:       async () => ({ success: true, output_path: '/out/file.pes', warnings: [] }),
    scanFolders:   async (opts, onEntry) => {
      // Accept both {paths} (gallery) and {folders} (batch)
      for (const f of D.files) {
        onEntry({ type: 'file', path: f.path, name: f.name, ext: f.ext,
                  size: f.size, mtime: f.mtime });
      }
      onEntry({ type: 'done', count: D.files.length });
      return 'scan-req';
    },
    makeThumbs:    async (paths, onThumb) => {
      for (const p of paths) {
        const f = byPath.get(p);
        if (f) onThumb({ type: 'thumb', path: p, meta: metaOf(f), preview: f.inspect.preview });
      }
      onThumb({ type: 'done', count: paths.length });
      return 'thumb-req';
    },
    getThumbsCached: async (items, onThumb) => {
      for (const it of items) {
        const f = byPath.get(it.path);
        if (f) onThumb({ type: 'thumb', path: it.path, meta: metaOf(f), preview: f.inspect.preview });
      }
      onThumb({ type: 'done', count: items.length });
      return 'thumb-cached-req';
    },
    getAppVersion: async () => '2.0.0',
    aiTest:        async (providerId) => ({ ok: true, sample: 'ok' }),
    secretsAvailable: async () => ({ available: true }),
    secretsStatus: async (ref) => (ref === 'ai.provider.prov-openai'
                     ? { isSet: true, last4: 'AB12', protected: true }
                     : { isSet: false, last4: '', protected: true }),
    secretsSet:    async (ref, value) => ({ ok: true }),
    secretsDelete: async (ref) => ({ ok: true }),
    aiClassify:    async ({ items }) => ({
      ok: true,
      results: (items || []).map((it, i) => ({
        id: it.id,
        category: ['Flowers', 'Nautical', 'Lettering', 'Geometric'][i % 4],
        tags: [['floral','tulip'], ['anchor','sea'], ['monogram','letter'], ['spiral','swirl']][i % 4],
      })),
    }),
    runBatch:      async (job, onProgress) => {
      (job.files || []).forEach(f => onProgress({ type: 'progress', path: f.path || f, status: 'done', outputPath: '/out' }));
      onProgress({ type: 'done', completed: (job.files || []).length, failed: 0 });
      return 'batch-req';
    },
    cancelStream:  async () => true,
    getSettings:   async () => JSON.parse(JSON.stringify(window.__SETTINGS)),
    setSettings:   async (patch) => { Object.assign(window.__SETTINGS, patch || {}); return true; },
    openFiles:     async () => D.files.map(f => f.path),
    selectOutputDir: async () => '/Users/demo/Embroidery/Output',
    pickFolders:   async () => [D.samplesDir],
    defaultDir:    async () => '/Users/demo/Embroidery/Output',
    openPath:      async () => '',
    showItem:      async () => {},
    listVolumes:   async () => ([
      { mountPoint: '/Volumes/BROTHER', label: 'BROTHER USB', capacity: 2013265920, available: 1932735283, removable: true },
      { mountPoint: '/Volumes/JANOME',  label: 'JANOME CARD', capacity: 4026531840, available: 3892314112, removable: true },
    ]),
    joinPath:      async (...seg) => seg.join('/'),
    ensureDir:     async () => true,
    copyFile:      async () => true,
    verifyFile:    async () => true,
    openAnyFiles:  async () => D.files.slice(0, 2).map(f => f.path),
    readText:      async (path) => ({ success: true, content: 'Sample note text...' }),
    projectExport: async ({ manifest }) => ({ success: true, path: '/Users/demo/Desktop/' + (manifest.name || 'project') + '.ecproj' }),
    projectImport: async () => ({ success: true, manifest: { tree: { id: 'imported', name: 'Imported Project', assets: [] } } }),
    statDir:       async (p) => ({ exists: true, mtime: now, isDir: false }),
    getThumbnail:  async (p, mt) => {
      const f = byPath.get(p);
      return f ? { meta: metaOf(f), preview: f.inspect.preview } : null;
    },
    platform:      'darwin',
  };
})();
"""
    )


def shoot(page, name):
    page.wait_for_timeout(700)
    path = os.path.join(OUT_DIR, name)
    page.screenshot(path=path)
    print("saved", os.path.relpath(path, ROOT))


def main():
    data = build_data()
    print("formats:", len(data["formats"]), "| files:", len(data["files"]))
    for f in data["files"]:
        ins = f["inspect"]
        print("  ", f["name"], "->", ins.get("stitch_count"), "stitches,",
              ins.get("color_count"), "colors,",
              len((ins.get("preview") or {}).get("lines", [])), "preview lines")

    index_url = "file://" + os.path.join(RENDERER, "index.html")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb"])
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=2)
        page.add_init_script(init_script(data))
        page.goto(index_url)
        # Shell boots into Convert automatically.
        page.wait_for_selector(".nav-item", timeout=8000)
        page.wait_for_timeout(800)

        # ---- Convert: populate via the Browse button (openFiles stub) ----
        page.wait_for_selector("#cv-browseBtn", timeout=5000)
        page.click("#cv-browseBtn")
        page.wait_for_timeout(1200)
        shoot(page, "01-convert.png")

        # ---- Batch: auto-scans managedFolders from settings ----
        page.click('.nav-item[data-view="batch"]')
        page.wait_for_timeout(1400)
        shoot(page, "02-batch.png")

        # ---- Gallery: auto-scans galleryFolders + makeThumbs ----
        page.click('.nav-item[data-view="gallery"]')
        page.wait_for_timeout(1600)
        # Select the first grid item to populate the detail pane.
        try:
            page.click(".gv-grid-item", timeout=3000)
            page.wait_for_timeout(600)
        except Exception as e:
            print("gallery select skipped:", e)
        shoot(page, "03-gallery.png")

        # ---- Simulator: hand off a file, then render the full design ----
        page.click('.nav-item[data-view="simulator"]')
        page.wait_for_timeout(600)
        first = data["files"][0]
        page.evaluate(
            "(f) => window.events.emit('gallery:send-to-simulator', { file: f })",
            {"path": first["path"], "name": first["name"], "ext": first["ext"]},
        )
        page.wait_for_timeout(1200)
        # Drive the scrubber to the end so the whole stitch-out is drawn.
        page.evaluate(
            """() => {
              const s = document.getElementById('sim-scrubber');
              if (s) { s.value = s.max; s.dispatchEvent(new Event('input', { bubbles: true })); }
            }"""
        )
        page.wait_for_timeout(900)
        shoot(page, "04-simulator.png")

        # ---- Transfer: drives auto-load; add source files + pick a drive ----
        page.click('.nav-item[data-view="transfer"]')
        page.wait_for_timeout(900)
        try:
            page.click("#tr-add-files-btn", timeout=3000)
            page.wait_for_timeout(800)
        except Exception as e:
            print("transfer add-files skipped:", e)
        try:
            page.click(".tr-dest-item", timeout=3000)
            page.wait_for_timeout(500)
        except Exception as e:
            print("transfer dest select skipped:", e)
        shoot(page, "05-transfer.png")

        # ---- Collections: nested tree + files grid + inspector ----
        page.click('.nav-item[data-view="collections"]')
        page.wait_for_timeout(1200)
        # Expand the first root so its subgroups are visible.
        try:
            page.click('[data-toggle]', timeout=2000)
            page.wait_for_timeout(400)
        except Exception as e:
            print("collections expand skipped:", e)
        # Select the first file to populate the inspector.
        try:
            page.click('.cl-card', timeout=2500)
            page.wait_for_timeout(500)
        except Exception as e:
            print("collections file select skipped:", e)
        shoot(page, "06-collections.png")

        # ---- Projects: tree + assets grid + inspector ----
        page.click('.nav-item[data-view="projects"]')
        page.wait_for_timeout(1200)
        # Select the first project to show its assets.
        try:
            page.click('.pv-tree-node', timeout=2500)
            page.wait_for_timeout(600)
        except Exception as e:
            print("projects tree select skipped:", e)
        # Select an asset to populate the inspector.
        try:
            page.click('.pv-asset-card', timeout=2500)
            page.wait_for_timeout(500)
        except Exception as e:
            print("projects asset select skipped:", e)
        shoot(page, "07-projects.png")

        # ---- Settings: open the AI & Vision topic ----
        page.click('.nav-item[data-view="settings"]')
        page.wait_for_timeout(1000)
        try:
            page.click('[data-topic="ai"]', timeout=2500)
            page.wait_for_timeout(500)
        except Exception as e:
            print("settings topic select skipped:", e)
        # Expand the OpenAI provider so the secret / capability / allowance UI shows.
        try:
            page.click('[data-edit="prov-openai"]', timeout=2500)
            page.wait_for_timeout(600)
        except Exception as e:
            print("settings provider edit skipped:", e)
        shoot(page, "08-settings.png")

        browser.close()
    print("done")


if __name__ == "__main__":
    main()
