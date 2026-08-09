#!/usr/bin/env python3
"""Functional test for the folder-based Gallery motif library and the
Collections motif entry + open-files modal. Drives the real renderer in
headless Chromium with a stubbed window.api that emits a synthetic nested
folder structure. Fails (non-zero exit) on any console error or missing
expected UI element."""
import json
import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RENDERER = os.path.join(ROOT, "renderer")
SAMPLES = os.path.join(ROOT, "samples")
CONVERT = os.path.join(ROOT, "scripts", "convert.py")


def backend(cmd, args):
    p = subprocess.run([sys.executable, CONVERT, cmd, json.dumps(args)],
                       capture_output=True, text=True, cwd=ROOT)
    out = p.stdout.strip()
    return json.loads(out) if out else {}


def one_preview():
    for name in os.listdir(SAMPLES):
        if name.lower().endswith((".pes", ".dst", ".jef", ".vp3")):
            meta = backend("inspect", {"input_path": os.path.join(SAMPLES, name)})
            if meta.get("preview"):
                return meta
    return {"preview": None, "stitch_count": 100, "color_count": 2}


def build_scan():
    base = "/lib/motifs"
    # Synthetic nested structure:
    #  Tulip/ (stitch files + doc directly)
    #  Anchor/ (hoop-size subfolders + doc)
    files = [
        {"path": base + "/Tulip/tulip.pes", "name": "tulip.pes", "ext": "pes"},
        {"path": base + "/Tulip/tulip.dst", "name": "tulip.dst", "ext": "dst"},
        {"path": base + "/Tulip/instructions.pdf", "name": "instructions.pdf", "ext": "pdf"},
        {"path": base + "/Anchor/Small/anchor.pes", "name": "anchor.pes", "ext": "pes"},
        {"path": base + "/Anchor/Large/anchor.dst", "name": "anchor.dst", "ext": "dst"},
        {"path": base + "/Anchor/guide.pdf", "name": "guide.pdf", "ext": "pdf"},
    ]
    for f in files:
        f["size"] = 1234
        f["mtime"] = 1700000000000
    return base, files


def init_script(base, files, meta):
    data = {"base": base, "files": files, "preview": meta.get("preview"),
            "meta": {"stitch_count": meta.get("stitch_count"),
                     "color_count": meta.get("color_count"),
                     "width_mm": meta.get("width_mm"),
                     "height_mm": meta.get("height_mm"),
                     "threads": meta.get("threads") or []}}
    return "window.__T = " + json.dumps(data) + ";\n" + r"""
(function () {
  const D = window.__T;
  window.__SETTINGS = {
    language: 'de', theme: 'light',
    managedFolders: [{ id: 'root1', path: D.base, recursive: true, alias: 'Motive' }],
    galleryTags: {},
    ai: { enabled: true, autoTag: true, activeProviderId: 'p1',
      providers: [{ id: 'p1', name: 'Ollama', kind: 'ollama', baseUrl: 'http://x', model: 'llava',
        enabled: true, capabilities: { vision: true }, allow: { autoClassify: true, sendExternal: true } }] },
    collections: [{ id: 'c1', name: 'Meine Sammlung', parentId: null, files: [], tags: [], createdAt: Date.now() }],
  };
  const embExts = ['pes','dst','jef','vp3'];
  window.api = {
    platform: 'linux',
    backendStatus: async () => ({ available: true, mode: 'bundled' }),
    listFormats: async () => ({ success: true, formats: [] }),
    getSettings: async () => JSON.parse(JSON.stringify(window.__SETTINGS)),
    setSettings: async (patch) => { Object.assign(window.__SETTINGS, patch || {}); return true; },
    scanFolders: async (opts, onEntry) => {
      for (const f of D.files) onEntry({ type: 'file', path: f.path, name: f.name, ext: f.ext, size: f.size, mtime: f.mtime });
      onEntry({ type: 'done', count: D.files.length });
      return 'scan';
    },
    getThumbsCached: async (items, onThumb) => {
      for (const it of items) {
        const ext = (it.path.split('.').pop() || '').toLowerCase();
        if (embExts.includes(ext)) onThumb({ type: 'thumb', path: it.path, meta: D.meta, preview: D.preview });
      }
      onThumb({ type: 'done', count: items.length });
      return 'thumb';
    },
    getThumbnail: async (p) => ({ meta: D.meta, preview: D.preview }),
    statDir: async () => ({ exists: true, mtime: 1700000000000, isDir: true }),
    aiClassify: async ({ items }) => ({ ok: true, results: (items||[]).map(it => ({ id: it.id, category: 'Blumen', tags: ['tulpe','blume'] })) }),
    aiTest: async () => ({ ok: true }),
    openPath: async () => '',
    showItem: async () => {},
    pickFolders: async () => [D.base],
    openFiles: async () => [],
    getAppVersion: async () => '2.0.0',
    cancelStream: async () => true,
    defaultDir: async () => '/out',
    selectOutputDir: async () => '/out',
    listVolumes: async () => [],
    secretsStatus: async () => ({ isSet: false, last4: '', protected: true }),
    secretsAvailable: async () => ({ available: true }),
    inspect: async () => ({ success: true }),
    convert: async () => ({ success: true, output_path: '/out/x.pes', warnings: [] }),
    joinPath: async (...s) => s.join('/'),
    ensureDir: async () => true,
    readText: async () => ({ success: true, content: '' }),
  };
})();
"""


def main():
    base, files = build_scan()
    meta = one_preview()
    errors = []
    index_url = "file://" + os.path.join(RENDERER, "index.html")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb"])
        page = browser.new_page(viewport={"width": 1280, "height": 820})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        page.add_init_script(init_script(base, files, meta))
        page.goto(index_url)
        page.wait_for_selector(".nav-item", timeout=8000)
        page.wait_for_timeout(500)

        # ---- Gallery ----
        page.click('.nav-item[data-view="gallery"]')
        page.wait_for_timeout(1500)

        page.screenshot(path="/tmp/gallery_library_test.png")
        folder_cards = page.query_selector_all(".gv-folder-card")
        print("root motif cards:", len(folder_cards))
        assert len(folder_cards) == 2, f"expected 2 motif cards, got {len(folder_cards)}"

        # Drill into "Anchor" (has hoop-size subfolders + a doc)
        names = [c.get_attribute("data-folder") for c in folder_cards]
        anchor = next(c for c in folder_cards if (c.get_attribute("data-folder") or "").endswith("Anchor"))
        anchor.click()
        page.wait_for_timeout(900)
        crumbs = page.query_selector_all(".gv-crumb")
        print("breadcrumb crumbs after drill:", len(crumbs))
        assert len(crumbs) >= 2, "breadcrumb should show Library > Anchor"
        sub = page.query_selector_all(".gv-folder-card")
        docs = page.query_selector_all(".gv-doc-card")
        print("Anchor subfolders:", len(sub), "docs:", len(docs))
        assert len(sub) == 2, f"expected 2 hoop-size subfolders, got {len(sub)}"
        assert len(docs) == 1, f"expected 1 doc in Anchor, got {len(docs)}"

        # Back to library via breadcrumb
        page.click('.gv-crumb[data-idx="-1"]')
        page.wait_for_timeout(600)

        # Mark both motifs, then send to collection
        for cb in page.query_selector_all(".gv-folder-check"):
            cb.click()
        page.wait_for_timeout(400)
        marked_bar = page.query_selector("#gv-marked-bar")
        print("marked bar visible:", "show" in (marked_bar.get_attribute("class") or ""))
        # AI classify
        page.click("#gv-ai-classify")
        page.wait_for_timeout(800)
        # Send to collection
        page.click("#gv-send-collection")
        page.wait_for_timeout(1200)

        # ---- Collections: motif entry should appear; open its modal ----
        # We navigated to collections via send. Select node c1.
        cur_view = page.evaluate("() => window.router && window.router.current")
        print("current view after send:", cur_view)
        # Accept the queue banner into selected collection
        # Select the collection first
        node = page.query_selector('.cl-node, [data-node-id="c1"]')
        if node:
            node.click(); page.wait_for_timeout(400)
        add_btn = page.query_selector("#cl-queue-add")
        if add_btn:
            add_btn.click(); page.wait_for_timeout(800)
        motif_cards = page.query_selector_all(".cl-card.cl-motif")
        print("collection motif cards:", len(motif_cards))
        assert len(motif_cards) >= 1, "expected at least 1 motif entry in collection"

        # Open motif modal
        page.click(".cl-motif-open")
        page.wait_for_timeout(600)
        modal = page.query_selector("#cl-motif-modal")
        vis = modal and modal.evaluate("el => getComputedStyle(el).display") if modal else "none"
        rows = page.query_selector_all(".cl-mm-row")
        print("motif modal display:", vis, "rows:", len(rows))
        assert modal and vis == "flex", "motif modal should be visible"
        assert len(rows) >= 1, "motif modal should list contained files"

        page.screenshot(path="/tmp/gallery_motif_test.png")
        browser.close()

    real_errors = [e for e in errors if "favicon" not in e.lower()]
    if real_errors:
        print("\nCONSOLE ERRORS:")
        for e in real_errors:
            print("  -", e)
        sys.exit(1)
    print("\nALL GALLERY MOTIF TESTS PASSED")


if __name__ == "__main__":
    main()
