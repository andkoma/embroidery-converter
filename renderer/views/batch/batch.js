(function () {
'use strict';
/**
 * renderer/views/batch/batch.js — Batch conversion panel
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Three-panel layout:
 *   [Source Folders] | [File Table (virtualised)] | [Batch Profile]
 *
 * ID prefix: bv-  (avoids DOM collisions with other views)
 */
'use strict';

/* ------------------------------------------------------------------ *
 *  i18n helper (same pattern as gallery.js)
 * ------------------------------------------------------------------ */
const t = (key, params = {}) => {
  const lang = window.store?.get('settings.language', 'en') || 'en';
  let str = window.I18N?.[lang]?.[key] || key;
  Object.entries(params).forEach(([k, v]) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  });
  return str;
};

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */
const BV_EXTS  = ['dst', 'pes', 'pec', 'jef', 'vp3', 'hus', 'xxx', 'exp', 'sew', 'emb'];
const ROW_H    = 36;   // px — virtual row height
const BUF_ROWS = 8;    // extra rows to render above/below viewport
const STYLE_ID = 'bv-styles';
const SEP = (window.api && window.api.platform === 'win32') ? '\\' : '/';

// Format preference order (same as Convert view for consistency)
const PREFERRED_ORDER = ['pes','dst','jef','vp3','exp','xxx','u01','pec','tbf','csv','json','gcode','pmv'];

/* ------------------------------------------------------------------ *
 *  Path helpers (shared display logic with Gallery)
 * ------------------------------------------------------------------ */
function bvSplitPath(p) { return String(p || '').split(/[\\/]+/).filter(Boolean); }
function bvTailLabel(p) { const parts = bvSplitPath(p); return parts.slice(-2).join(SEP) || p; }
function bvFolderLabel(f) { return (f.alias && f.alias.trim()) ? f.alias.trim() : bvTailLabel(f.path); }
/**
 * Canonicalise a path for prefix comparison. Strips trailing separators and
 * collapses the macOS firmlink prefix (/private/tmp ↔ /tmp, /private/var ↔
 * /var, …) so a folder added as "/tmp/x" still matches files the scanner
 * reports as "/private/tmp/x". Without this, symlink-prefix mismatches make
 * the per-folder bucket empty and the scan cache restores nothing on the next
 * visit to the Batch view.
 */
function bvCanon(p) {
  let s = String(p || '').replace(/[\\/]+$/, '');
  s = s.replace(/^\/private\/(tmp|var|etc)(\/|$)/, '/$1$2');
  return s;
}
function bvBelongsTo(filePath, folderPath) {
  const a = bvCanon(filePath), b = bvCanon(folderPath);
  return a === b || a.startsWith(b + '/') || a.startsWith(b + '\\');
}
/**
 * Distribute freshly-scanned files into per-folder buckets, robust to
 * symlink/prefix mismatches. Each file is assigned to the scan folder with
 * the LONGEST matching canonical prefix. As a safety net, when only a single
 * folder was scanned every file is assigned to it (no ambiguity possible).
 * @returns {Map<string, object[]>} folderPath → files[]
 */
function bvBucket(files, folderPaths) {
  const buckets = new Map(folderPaths.map(p => [p, []]));
  const canons = folderPaths.map(p => ({ p, c: bvCanon(p) }));
  const single = folderPaths.length === 1 ? folderPaths[0] : null;
  for (const f of files) {
    const fc = bvCanon(f.path);
    let best = null, bestLen = -1;
    for (const { p, c } of canons) {
      if ((fc === c || fc.startsWith(c + '/') || fc.startsWith(c + '\\')) && c.length > bestLen) {
        best = p; bestLen = c.length;
      }
    }
    if (!best) best = single;   // single-folder fallback
    if (best) buckets.get(best).push(f);
  }
  return buckets;
}
function bvMkId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

/* ------------------------------------------------------------------ *
 *  Module-level state (fully reset on each mount)
 * ------------------------------------------------------------------ */
let _container = null;
let _store     = null;
let _abortCtrl = null;

let _folders   = [];         // { id, path, recursive, alias }[]
let _allFiles  = [];         // FileEntry[] — full scan results
let _filtered  = [];         // FileEntry[] — after search + ext filter
let _selected  = new Set();  // selected file paths (Set<string>)
let _search    = '';
let _extFilter = new Set();  // active ext filter; empty = all exts shown
let _scanReqId = null;
let _scanning  = false;
let _scanGen   = 0;          // bumps each startScan; guards stale background scans
let _formats   = [];         // { extension, description, write, read }[] from backend

let _viewMode  = 'list';     // 'list' | 'card' (persisted in localStorage)
let _thumbReqId = null;      // active thumbnail-stream request id
let _tagsByPath = {};        // path → string[]  (AI vision auto-tagging groundwork)
let _mounted   = false;      // panel currently mounted? (scan keeps running if not)

// Card view: chunked rendering + viewport-based lazy thumbnails so huge
// file counts never freeze the UI or blank the grid.
let _cardIO        = null;   // IntersectionObserver for card thumbnails
let _cardRenderTok = 0;      // bumps to cancel a stale chunked render
let _cardByPath    = null;   // path → file (for the visible-card lookup)
let _thumbQueue    = new Map(); // path → file waiting for a thumbnail
let _thumbTimer    = null;   // debounce timer for the thumbnail queue

const BV_VIEW_KEY = 'ec_batch_view';

/* ------------------------------------------------------------------ *
 *  HTML template
 * ------------------------------------------------------------------ */
function buildHTML() {
  const chips = BV_EXTS.map(e =>
    `<button class="bv-chip" data-ext="${e}">.${e}</button>`
  ).join('');

  return `
<div class="bv-root">

  <!-- ── Source Folders panel ── -->
  <aside class="bv-panel bv-sources">
    <div class="bv-panel-header">
      <span class="bv-panel-title">${t('batch.sources')}</span>
      <div class="bv-header-actions">
        <button id="bv-refresh-btn" class="bv-icon-btn" title="${t('batch.refresh')}" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-5H1"/>
          </svg>
        </button>
        <button id="bv-add-folder-btn" class="bv-icon-btn bv-accent" title="${t('batch.addFolder')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9"  y1="14" x2="15" y2="14"/>
          </svg>
        </button>
      </div>
    </div>
    <ul id="bv-folder-list" class="bv-folder-list">
      <li class="bv-empty-hint" id="bv-no-folders-msg"></li>
    </ul>
  </aside>

  <!-- ── File table panel ── -->
  <main class="bv-panel bv-table-panel">
    <div class="bv-table-header">
      <div class="bv-search-row">
        <div class="bv-search-wrap">
          <svg class="bv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="bv-search" class="bv-search-input" type="text" placeholder="${t('batch.search')}"/>
        </div>
        <span id="bv-scan-status" class="bv-scan-status"></span>
        <span id="bv-file-count" class="bv-file-count">0 files</span>
        <div class="bv-view-toggle">
          <button id="bv-view-list" class="bv-view-btn active" title="">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button id="bv-view-card" class="bv-view-btn" title="">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="bv-ext-chips" class="bv-ext-chips">${chips}</div>
      <div class="bv-col-head" id="bv-col-head">
        <label class="bv-col-check">
          <input type="checkbox" id="bv-select-all"/>
        </label>
        <span class="bv-col-name">${t('batch.name')}</span>
        <span class="bv-col-ext">${t('batch.type')}</span>
        <span class="bv-col-size">${t('batch.size')}</span>
        <span class="bv-col-status">${t('batch.status')}</span>
      </div>
    </div>

    <div id="bv-table-scroll" class="bv-table-scroll">
      <div id="bv-table-rows" class="bv-table-rows"></div>
      <div id="bv-card-grid" class="bv-card-grid" hidden></div>
    </div>

    <div class="bv-table-footer">
      <span id="bv-sel-count" class="bv-sel-count"></span>
      <button id="bv-sel-all-btn" class="bv-link-btn"></button>
      <button id="bv-desel-all-btn" class="bv-link-btn" disabled></button>
      <button id="bv-add-project" class="bv-sec-btn" disabled></button>
      <button id="bv-add-collection" class="bv-sec-btn" disabled></button>
      <button id="bv-convert-btn" class="bv-convert-btn" disabled></button>
    </div>
  </main>

  <!-- ── Batch profile panel ── -->
  <aside class="bv-panel bv-profile">
    <div class="bv-panel-header">
      <span class="bv-panel-title">${t('batch.profile')}</span>
    </div>
    <div class="bv-profile-body">

      <label class="bv-field-label">${t('batch.outputFormat')}</label>
      <select id="bv-out-format" class="bv-select"></select>

      <label class="bv-field-label">${t('batch.outputFolder')}</label>
      <div class="bv-dir-row">
        <input id="bv-out-dir" class="bv-input bv-dir-input" type="text"
               placeholder="${t('batch.sameAsSource')}" readonly/>
        <button id="bv-out-dir-btn" class="bv-browse-btn" title="${t('batch.browse')}">…</button>
      </div>

      <details class="bv-section" open>
        <summary class="bv-section-title">${t('batch.resize')}</summary>
        <div class="bv-resize-row">
          <label>${t('batch.width')}
            <input id="bv-resize-w" class="bv-input bv-dim-input"
                   type="number" min="1" max="500" step="1" placeholder="—"/>
          </label>
          <label>${t('batch.height')}
            <input id="bv-resize-h" class="bv-input bv-dim-input"
                   type="number" min="1" max="500" step="1" placeholder="—"/>
          </label>
        </div>
        <label class="bv-check-label">
          <input type="checkbox" id="bv-resample"/>
          ${t('batch.resample')}
        </label>
      </details>

      <details class="bv-section">
        <summary class="bv-section-title">${t('batch.colorLimit')}</summary>
        <div class="bv-resize-row">
          <label>${t('batch.maxColors')}
            <input id="bv-color-limit" class="bv-input bv-dim-input"
                   type="number" min="1" max="64" step="1" placeholder="—"/>
          </label>
        </div>
      </details>

      <details class="bv-section">
        <summary class="bv-section-title">${t('batch.conflicts')}</summary>
        <label class="bv-check-label">
          <input type="radio" name="bv-conflict" value="suffix" checked/>
          ${t('batch.suffix')}&nbsp;<span class="bv-mono">(name (1).pes)</span>
        </label>
        <label class="bv-check-label">
          <input type="radio" name="bv-conflict" value="overwrite"/>
          ${t('batch.overwrite')}
        </label>
        <label class="bv-check-label">
          <input type="radio" name="bv-conflict" value="skip"/>
          ${t('batch.skip')}
        </label>
      </details>

    </div>
  </aside>

</div>`;
}

/* ------------------------------------------------------------------ *
 *  Scoped CSS — injected on mount, removed on unmount
 * ------------------------------------------------------------------ */
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
/* ── Root layout ── */
.bv-root {
  display: flex;
  height: 100%;
  overflow: hidden;
  font-size: 13px;
  background: var(--surface, #f4f6fb);
}
.bv-panel {
  display: flex;
  flex-direction: column;
  background: var(--panel-bg, #fff);
  border-right: 1px solid var(--border, #e2e6ef);
  overflow: hidden;
}
.bv-panel:last-child { border-right: none; }
.bv-sources      { width: 220px; flex-shrink: 0; }
.bv-table-panel  { flex: 1; min-width: 0; }
.bv-profile      { width: 230px; flex-shrink: 0; }

/* ── Panel header ── */
.bv-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border, #e2e6ef);
  background: var(--panel-header-bg, #f9fafd);
  flex-shrink: 0;
}
.bv-panel-title {
  font-weight: 600; color: var(--text, #1a2340);
  font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
}
.bv-header-actions { display: flex; gap: 4px; }
.bv-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px;
  border: none; background: transparent; cursor: pointer;
  color: var(--muted, #6b7a99);
  transition: background .15s, color .15s;
}
.bv-icon-btn svg { width: 15px; height: 15px; }
.bv-icon-btn:hover:not(:disabled) { background: var(--hover-bg,#eef1f8); color:var(--text,#1a2340); }
.bv-icon-btn:disabled { opacity: .4; cursor: default; }
.bv-icon-btn.bv-accent { color: var(--accent, #4a6ef5); }
.bv-icon-btn.bv-accent:hover { background: var(--accent-subtle, #eef1fd); }

/* ── Folder list ── */
.bv-folder-list {
  list-style: none; margin: 0; padding: 4px 0; flex: 1; overflow-y: auto;
}
.bv-folder-item {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px 6px 12px; cursor: default;
  transition: background .1s;
}
.bv-folder-item:hover { background: var(--hover-bg, #f4f6fb); }
.bv-folder-icon { flex-shrink: 0; color: var(--accent, #4a6ef5); width: 14px; height: 14px; }
.bv-folder-path {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text, #1a2340); font-size: 12px;
  direction: ltr; text-align: left; cursor: pointer;
}
.bv-folder-alias-input {
  flex: 1; min-width: 0; font-size: 12px; padding: 2px 4px;
  border: 1px solid var(--accent, #4a6ef5); border-radius: 4px;
  background: var(--input-bg, #fff); color: var(--text, #1a2340); outline: none;
}
.bv-remove-btn {
  flex-shrink: 0; border: none; background: none; cursor: pointer;
  color: var(--muted, #6b7a99); padding: 2px 4px; border-radius: 4px;
  font-size: 15px; line-height: 1; opacity: .6;
  transition: opacity .15s, color .15s;
}
.bv-remove-btn:hover { opacity: 1; color: var(--error, #e53e3e); }
.bv-empty-hint {
  padding: 20px 14px; color: var(--muted, #6b7a99); font-size: 12px; line-height: 1.6;
}

/* ── Table header ── */
.bv-table-header {
  background: var(--panel-header-bg, #f9fafd);
  border-bottom: 1px solid var(--border, #e2e6ef);
  padding: 8px 10px 0;
  flex-shrink: 0;
}
.bv-search-row {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
}
.bv-search-wrap { position: relative; flex: 1; min-width: 0; }
.bv-search-icon {
  position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
  width: 13px; height: 13px; color: var(--muted, #6b7a99); pointer-events: none;
}
.bv-search-input {
  width: 100%; box-sizing: border-box; padding: 5px 8px 5px 28px;
  border: 1px solid var(--border, #e2e6ef); border-radius: 6px; font-size: 12px;
  background: var(--input-bg, #fff); color: var(--text, #1a2340);
  outline: none; transition: border-color .15s;
}
.bv-search-input:focus { border-color: var(--accent, #4a6ef5); }
.bv-scan-status { font-size: 11px; color: var(--accent, #4a6ef5); white-space: nowrap; }
.bv-file-count  { font-size: 11px; color: var(--muted, #6b7a99); white-space: nowrap; }

/* ── Extension chips ── */
.bv-ext-chips {
  display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 8px;
}
.bv-chip {
  padding: 2px 7px; border-radius: 12px; font-size: 11px; font-family: monospace;
  border: 1px solid var(--border, #d6dbe8); background: var(--chip-bg, #f0f2f9);
  color: var(--muted, #5a6380); cursor: pointer;
  transition: background .12s, border-color .12s, color .12s; line-height: 18px;
}
.bv-chip:hover { border-color: var(--accent, #4a6ef5); color: var(--accent, #4a6ef5); }
.bv-chip.active { background: var(--accent,#4a6ef5); border-color: var(--accent,#4a6ef5); color:#fff; }

/* ── Column header ── */
.bv-col-head {
  display: flex; align-items: center; padding: 0 4px 6px;
  font-size: 11px; color: var(--muted,#6b7a99); font-weight: 600;
  text-transform: uppercase; letter-spacing: .04em;
}
.bv-col-check  { width: 30px; flex-shrink: 0; display: flex; align-items: center; }
.bv-col-name   { flex: 1; min-width: 0; }
.bv-col-ext    { width: 44px; flex-shrink: 0; text-align: right; padding-right: 6px; }
.bv-col-size   { width: 62px; flex-shrink: 0; text-align: right; padding-right: 6px; }
.bv-col-status { width: 66px; flex-shrink: 0; text-align: right; padding-right: 4px; }

/* ── Virtual scroll ── */
.bv-table-scroll {
  flex: 1; overflow-y: auto; position: relative;
  background: var(--panel-bg, #fff);
}
.bv-table-rows {
  /* height driven by padding-top + rows + padding-bottom */
  box-sizing: border-box;
}

/* ── Rows ── */
.bv-row {
  display: flex; align-items: center;
  height: ${ROW_H}px; padding: 0 4px;
  border-bottom: 1px solid var(--row-border, #f0f2f8);
  box-sizing: border-box;
  transition: background .08s;
  cursor: default;
}
.bv-row:hover   { background: var(--row-hover, #f7f9fd); }
.bv-row.bv-selected { background: var(--row-sel, #eef2fe); }
.bv-row .bv-col-check input { cursor: pointer; }
.bv-row .bv-col-name {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text, #1a2340); font-size: 12px;
}
.bv-row .bv-col-ext  { color:var(--muted,#6b7a99); font-family:monospace; font-size:11px; text-align:right; padding-right:6px; }
.bv-row .bv-col-size { color:var(--muted,#6b7a99); font-size:11px; text-align:right; padding-right:6px; }
.bv-row .bv-col-status { text-align:right; padding-right:4px; font-size:11px; }
.bv-st-pending { color:var(--muted,#6b7a99); }
.bv-st-done    { color:var(--success,#22a05a); font-weight:600; }
.bv-st-error   { color:var(--error,#e53e3e);  font-weight:600; }
.bv-st-running { color:var(--accent,#4a6ef5); }
.bv-st-skipped { color:var(--muted,#999); font-style:italic; }

/* ── Empty states ── */
.bv-empty-table {
  padding: 48px 24px; text-align: center; color:var(--muted,#6b7a99); font-size:13px;
}

/* ── Table footer ── */
.bv-table-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-top: 1px solid var(--border,#e2e6ef);
  background: var(--panel-header-bg, #f9fafd); flex-shrink: 0;
}
.bv-sel-count { font-size: 12px; color: var(--muted,#6b7a99); }
.bv-convert-btn {
  padding: 6px 18px; border-radius: 7px; border: none; cursor: pointer;
  background: var(--accent,#4a6ef5); color: #fff; font-size: 13px; font-weight: 600;
  transition: background .15s, opacity .15s;
}
.bv-convert-btn:disabled { opacity: .45; cursor: default; }
.bv-convert-btn:hover:not(:disabled) { background: var(--accent-hover,#3b5fe4); }
.bv-sec-btn {
  padding: 6px 12px; border-radius: 7px; cursor: pointer; font-size: 12px;
  border: 1px solid var(--border,#dde1ef); background: var(--input-bg,#fff);
  color: var(--text,#1a2340); transition: background .15s, border-color .15s, opacity .15s;
}
.bv-sec-btn:disabled { opacity: .45; cursor: default; }
.bv-sec-btn:hover:not(:disabled) { border-color: var(--accent,#4a6ef5); color: var(--accent,#4a6ef5); }
.bv-link-btn {
  padding: 6px 8px; border: none; background: none; cursor: pointer; font-size: 12px;
  color: var(--accent,#4a6ef5); text-decoration: underline; transition: opacity .15s;
}
.bv-link-btn:disabled { opacity: .4; cursor: default; text-decoration: none; color: var(--muted,#8b93a7); }

/* ── Profile panel ── */
.bv-profile-body { padding: 12px; overflow-y: auto; flex: 1; }
.bv-field-label {
  display: block; font-size: 11px; font-weight: 600; color: var(--muted,#6b7a99);
  text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 4px;
}
.bv-field-label:first-child { margin-top: 0; }
.bv-select, .bv-input {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--border,#dde1ef); font-size: 12px;
  background: var(--input-bg,#fff); color: var(--text,#1a2340);
  outline: none; transition: border-color .15s;
}
.bv-select:focus, .bv-input:focus { border-color: var(--accent,#4a6ef5); }
.bv-dir-row { display: flex; gap: 0; }
.bv-dir-input { flex: 1; min-width: 0; border-radius: 6px 0 0 6px; cursor: default; }
.bv-browse-btn {
  padding: 6px 10px; border: 1px solid var(--border,#dde1ef); border-left: none;
  border-radius: 0 6px 6px 0; background: var(--hover-bg,#f0f2f9);
  cursor: pointer; font-size: 13px; color: var(--text,#1a2340);
  transition: background .15s;
}
.bv-browse-btn:hover { background: var(--border,#e2e6ef); }
.bv-section { margin-top: 12px; }
.bv-section > summary {
  font-size: 11px; font-weight: 600; color: var(--muted,#6b7a99);
  text-transform: uppercase; letter-spacing: .04em;
  cursor: pointer; user-select: none; list-style: none; padding: 3px 0;
}
.bv-section > summary::marker,
.bv-section > summary::-webkit-details-marker { display: none; }
.bv-section > summary::before { content: '▸ '; }
.bv-section[open] > summary::before { content: '▾ '; }
.bv-resize-row { display: flex; gap: 8px; margin-top: 6px; }
.bv-resize-row label { flex: 1; font-size: 11px; color: var(--muted,#6b7a99); }
.bv-dim-input { width: 100%; margin-top: 3px; }
.bv-check-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text,#1a2340); cursor: pointer; padding: 4px 0;
}
.bv-check-label input { cursor: pointer; }
.bv-mono { font-family: monospace; font-size: 11px; color: var(--muted,#6b7a99); }

/* ── View toggle ── */
.bv-view-toggle { display: flex; gap: 2px; flex-shrink: 0; }
.bv-view-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 24px; padding: 0;
  border: 1px solid var(--border, #dde1ef); border-radius: 6px;
  background: var(--input-bg, #fff); color: var(--muted, #6b7a99); cursor: pointer;
  transition: background .12s, border-color .12s, color .12s;
}
.bv-view-btn svg { width: 14px; height: 14px; }
.bv-view-btn:hover { border-color: var(--accent, #4a6ef5); color: var(--accent, #4a6ef5); }
.bv-view-btn.active { background: var(--accent, #4a6ef5); border-color: var(--accent, #4a6ef5); color: #fff; }

/* ── Card grid ── */
.bv-card-grid {
  display: grid; gap: 10px; padding: 12px;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  align-content: start;
}
.bv-card {
  position: relative; display: flex; flex-direction: column;
  border: 1px solid var(--border, #e2e6ef); border-radius: 9px;
  background: var(--panel-bg, #fff); overflow: hidden; cursor: pointer;
  transition: border-color .12s, box-shadow .12s;
}
.bv-card:hover { border-color: var(--accent, #4a6ef5); box-shadow: 0 2px 10px rgba(74,110,245,.12); }
.bv-card.bv-selected { border-color: var(--accent, #4a6ef5); box-shadow: 0 0 0 1px var(--accent, #4a6ef5) inset; }
.bv-card-check {
  position: absolute; top: 7px; left: 7px; z-index: 2; cursor: pointer;
  width: 15px; height: 15px;
}
.bv-card-thumb {
  height: 108px; display: flex; align-items: center; justify-content: center;
  background: var(--surface, #f4f6fb); border-bottom: 1px solid var(--row-border, #f0f2f8);
  padding: 6px; box-sizing: border-box;
}
.bv-card-thumb svg { max-width: 100%; max-height: 100%; }
.bv-card-thumb-ph { font-size: 10px; color: var(--muted, #9aa6bf); }
.bv-card-body { padding: 7px 9px 9px; display: flex; flex-direction: column; gap: 4px; }
.bv-card-name {
  font-size: 12px; color: var(--text, #1a2340); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bv-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bv-card-badge {
  font-family: monospace; font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: var(--chip-bg, #eef1f8); color: var(--muted, #5a6380);
}
.bv-card-size { font-size: 10px; color: var(--muted, #6b7a99); }
.bv-card-status { margin-left: auto; font-size: 11px; }
.bv-card-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.bv-card-tag {
  font-size: 9px; padding: 1px 5px; border-radius: 8px;
  background: var(--accent-subtle, #eef1fd); color: var(--accent, #4a6ef5);
}

/* ── Scan spinner ── */
@keyframes bv-spin { to { transform: rotate(360deg); } }
.bv-spin { display: inline-block; animation: bv-spin .7s linear infinite; }
`;
  document.head.appendChild(s);
}

function removeStyles() {
  const s = document.getElementById(STYLE_ID);
  if (s) s.remove();
}

/* ------------------------------------------------------------------ *
 *  Utilities
 * ------------------------------------------------------------------ */
function fmtSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ------------------------------------------------------------------ *
 *  Filter + sort
 * ------------------------------------------------------------------ */
function applyFilter() {
  const q = _search.trim().toLowerCase();
  _filtered = _allFiles.filter(f => {
    if (_extFilter.size > 0 && !_extFilter.has(f.ext)) return false;
    if (q && !f.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 *  UI helpers
 * ------------------------------------------------------------------ */
function updateCounts() {
  const countEl   = document.getElementById('bv-file-count');
  const selEl     = document.getElementById('bv-sel-count');
  const convertBtn = document.getElementById('bv-convert-btn');
  const selAll    = document.getElementById('bv-select-all');

  // Count selected within the current filtered view
  let selCount = 0;
  for (const f of _filtered) { if (_selected.has(f.path)) selCount++; }

  if (countEl)    countEl.textContent = t('batch.files', {n: _filtered.length});
  if (selEl)      selEl.textContent   = t('batch.selected', {n: selCount});
  if (convertBtn) convertBtn.disabled = selCount === 0;
  const addProjBtn = document.getElementById('bv-add-project');
  const addCollBtn = document.getElementById('bv-add-collection');
  if (addProjBtn) addProjBtn.disabled = selCount === 0;
  if (addCollBtn) addCollBtn.disabled = selCount === 0;
  if (selAll) {
    const allSel = _filtered.length > 0 && selCount === _filtered.length;
    selAll.checked       = allSel;
    selAll.indeterminate = !allSel && selCount > 0;
  }
  const selAllBtn = document.getElementById('bv-sel-all-btn');
  const deselBtn  = document.getElementById('bv-desel-all-btn');
  if (selAllBtn) selAllBtn.disabled = _filtered.length === 0 || selCount === _filtered.length;
  if (deselBtn)  deselBtn.disabled  = selCount === 0;
}

/* ------------------------------------------------------------------ *
 *  Virtualised table renderer (padding-based)
 * ------------------------------------------------------------------ */
function renderRows() {
  const scrollEl = document.getElementById('bv-table-scroll');
  const rowsEl   = document.getElementById('bv-table-rows');
  if (!scrollEl || !rowsEl) return;

  const total = _filtered.length;

  if (total === 0) {
    rowsEl.style.paddingTop    = '';
    rowsEl.style.paddingBottom = '';
    const msg = _folders.length === 0
      ? t('batch.noFolders')
      : _scanning
        ? t('batch.scanning')
        : t('batch.noFiles');
    rowsEl.innerHTML = `<div class="bv-empty-table">${msg}</div>`;
    return;
  }

  const scrollTop = scrollEl.scrollTop;
  const viewH     = scrollEl.clientHeight || 400;
  const startIdx  = Math.max(0, Math.floor(scrollTop / ROW_H) - BUF_ROWS);
  const endIdx    = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + BUF_ROWS);

  rowsEl.style.paddingTop    = (startIdx * ROW_H) + 'px';
  rowsEl.style.paddingBottom = Math.max(0, (total - endIdx) * ROW_H) + 'px';

  const frag = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    const f   = _filtered[i];
    const sel = _selected.has(f.path);
    const row = document.createElement('div');
    row.className  = 'bv-row' + (sel ? ' bv-selected' : '');
    row.dataset.path = f.path;
    row.innerHTML  = `
      <label class="bv-col-check" title="${f.path}">
        <input type="checkbox"${sel ? ' checked' : ''}/>
      </label>
      <span class="bv-col-name" title="${f.path}">${f.name}</span>
      <span class="bv-col-ext">${f.ext}</span>
      <span class="bv-col-size">${fmtSize(f.size)}</span>
      <span class="bv-col-status"><span class="bv-st-${f.status || 'pending'}">${statusIcon(f.status)}</span></span>
    `;
    frag.appendChild(row);
  }
  rowsEl.replaceChildren(frag);
}

function statusIcon(s) {
  switch (s) {
    case 'done':    return '✓';
    case 'error':   return '✗';
    case 'running': return '…';
    case 'skipped': return '–';
    default:        return '';
  }
}

function escBv(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ *
 *  View dispatch (list ⇆ card)
 * ------------------------------------------------------------------ */
function renderContent() {
  const rowsEl = document.getElementById('bv-table-rows');
  const gridEl = document.getElementById('bv-card-grid');
  const colHead = document.getElementById('bv-col-head');
  const card = _viewMode === 'card';
  if (rowsEl) rowsEl.hidden = card;
  if (gridEl) gridEl.hidden = !card;
  if (colHead) colHead.style.display = card ? 'none' : '';
  if (card) renderCards();
  else      renderRows();
}

/** Virtual scroll only matters in list mode. */
function onScroll() {
  if (_viewMode !== 'card') renderRows();
}

/* ------------------------------------------------------------------ *
 *  Card renderer (with cached vector thumbnails)
 * ------------------------------------------------------------------ */
/**
 * Render the card grid.  For large collections we (a) append cards in small
 * chunks across animation frames so the main thread is never blocked (no more
 * blank screen), and (b) only fetch/render each card's vector thumbnail once
 * it scrolls into view (IntersectionObserver), so the count rises immediately
 * instead of waiting for thousands of previews to be computed up-front.
 */
function renderCards() {
  const grid = document.getElementById('bv-card-grid');
  if (!grid) return;

  // Tear down any observer / in-flight chunked render from a previous pass.
  if (_cardIO) { _cardIO.disconnect(); _cardIO = null; }
  const token = ++_cardRenderTok;

  if (_filtered.length === 0) {
    const msg = _folders.length === 0
      ? t('batch.noFolders')
      : _scanning ? t('batch.scanning') : t('batch.noFiles');
    grid.innerHTML = `<div class="bv-empty-table">${escBv(msg)}</div>`;
    return;
  }

  _cardByPath = new Map(_filtered.map(f => [f.path, f]));
  _cardIO = new IntersectionObserver(onCardVisible, { root: grid, rootMargin: '250px' });

  grid.innerHTML = '';
  const list = _filtered;
  const CHUNK = 80;
  let i = 0;

  const step = () => {
    if (token !== _cardRenderTok) return;          // superseded by a newer render
    const g = document.getElementById('bv-card-grid');
    if (!g) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(i + CHUNK, list.length);
    for (; i < end; i++) {
      const card = buildCard(list[i]);
      frag.appendChild(card);
    }
    g.appendChild(frag);
    // Observe the newly-added cards for lazy thumbnail loading.
    g.querySelectorAll('.bv-card:not([data-observed])').forEach(el => {
      el.setAttribute('data-observed', '1');
      if (_cardIO) _cardIO.observe(el);
    });
    if (i < list.length && token === _cardRenderTok) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

/** Build a single card element (thumbnail filled lazily when visible). */
function buildCard(f) {
  const sel = _selected.has(f.path);
  const card = document.createElement('div');
  card.className = 'bv-card' + (sel ? ' bv-selected' : '');
  card.dataset.path = f.path;
  const preview = f.preview
    ? renderPreview(f.preview)
    : `<span class="bv-card-thumb-ph">${escBv(t('preview.none'))}</span>`;
  const tags = (_tagsByPath[f.path] || [])
    .map(tag => `<span class="bv-card-tag">${escBv(tag)}</span>`).join('');
  card.innerHTML = `
    <input type="checkbox" class="bv-card-check"${sel ? ' checked' : ''} title="${escBv(f.path)}"/>
    <div class="bv-card-thumb">${preview}</div>
    <div class="bv-card-body">
      <div class="bv-card-name" title="${escBv(f.path)}">${escBv(f.name)}</div>
      <div class="bv-card-meta">
        <span class="bv-card-badge">${escBv((f.ext || '').toUpperCase())}</span>
        <span class="bv-card-size">${fmtSize(f.size)}</span>
        <span class="bv-card-status bv-st-${f.status || 'pending'}">${statusIcon(f.status)}</span>
      </div>
      ${tags ? `<div class="bv-card-tags">${tags}</div>` : ''}
    </div>
  `;
  return card;
}

/** IntersectionObserver callback: queue thumbnails for cards entering view. */
function onCardVisible(entries) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const path = e.target.dataset.path;
    const f = _cardByPath ? _cardByPath.get(path) : null;
    if (f) queueThumb(f);
    if (_cardIO) _cardIO.unobserve(e.target);
  }
}

/** Render a vector preview (shared shape with Gallery's renderPreview). */
function renderPreview(preview) {
  if (!preview || !Array.isArray(preview.lines) || preview.lines.length === 0) {
    return `<span class="bv-card-thumb-ph">${escBv(t('preview.none'))}</span>`;
  }
  const left = preview.left || 0, top = preview.top || 0;
  const width = preview.width || 1, height = preview.height || 1;
  const viewBox = `${left} ${top} ${width} ${height}`;
  const strokeW = Math.max(Math.max(width, height) / 120, 0.4);
  const paths = preview.lines.map(line => {
    const pts = line.pts || [];
    if (pts.length < 2) return '';
    const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ');
    return `<path d="${d}" stroke="${escBv(line.hex || '#888')}" fill="none" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

/* ------------------------------------------------------------------ *
 *  Thumbnails — cached on disk via main (persistent, configurable dir)
 *  Only requested lazily when the card view is active, to avoid the cost
 *  when the user stays in the (default) list view.
 * ------------------------------------------------------------------ */
/**
 * Lazy thumbnails: cards register here as they scroll into view.  Requests are
 * debounced and batched so scrolling through thousands of files only fetches
 * the previews actually seen — the scan/count is never blocked by thumbnailing.
 */
function queueThumb(f) {
  if (!f || f.preview || f._thumbTried || _thumbQueue.has(f.path)) return;
  _thumbQueue.set(f.path, f);
  if (_thumbTimer) return;
  _thumbTimer = setTimeout(flushThumbQueue, 120);
}

function flushThumbQueue() {
  _thumbTimer = null;
  const files = Array.from(_thumbQueue.values());
  _thumbQueue.clear();
  if (files.length === 0) return;
  const items = files.map(f => ({ path: f.path, mtime: f.mtime }));
  const byPath = new Map(files.map(f => [f.path, f]));

  window.api.getThumbsCached(items, (entry) => {
    if (entry.type === 'thumb') {
      const f = byPath.get(entry.path);
      if (f) {
        f._thumbTried = true;
        f.preview = entry.preview || null;
        const m = entry.meta || {};
        f.stitches = m.stitch_count;
        f.colors   = m.color_count;
        f.width    = m.width_mm;
        f.height   = m.height_mm;
        fillCardThumb(f);
      }
    } else if (entry.type === 'done') {
      _thumbReqId = null;
      files.forEach(f => { f._thumbTried = true; });
    }
  }).then(id => { _thumbReqId = id; }).catch(err => {
    console.error('Batch thumbnail error:', err);
  });
}

/** Fill a single already-rendered card's thumbnail once its preview arrives. */
function fillCardThumb(f) {
  if (_viewMode !== 'card') return;
  const grid = document.getElementById('bv-card-grid');
  if (!grid) return;
  const card = grid.querySelector(`.bv-card[data-path="${cssEscBv(f.path)}"]`);
  if (!card) return;
  const thumb = card.querySelector('.bv-card-thumb');
  if (thumb && f.preview) thumb.innerHTML = renderPreview(f.preview);
}

/** Back-compat no-op: thumbnails now load lazily per visible card. */
function loadThumbnails() { /* handled by IntersectionObserver in renderCards */ }

/** CSS.escape fallback for attribute selectors. */
function cssEscBv(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\\]]/g, '\\$&');
}

function setViewMode(mode) {
  _viewMode = (mode === 'card') ? 'card' : 'list';
  try { localStorage.setItem(BV_VIEW_KEY, _viewMode); } catch (_) {}
  document.getElementById('bv-view-card')?.classList.toggle('active', _viewMode === 'card');
  document.getElementById('bv-view-list')?.classList.toggle('active', _viewMode === 'list');
  renderContent();
  loadThumbnails();
}

/* ------------------------------------------------------------------ *
 *  Folder list renderer
 * ------------------------------------------------------------------ */
function renderFolders() {
  const list = document.getElementById('bv-folder-list');
  if (!list) return;
  if (_folders.length === 0) {
    const msg = document.getElementById('bv-no-folders-msg');
    if (msg) msg.innerHTML = t('batch.noFolders').replace('\n', '<br>');
    return;
  }
  list.innerHTML = _folders.map(f => `
    <li class="bv-folder-item" data-id="${f.id}">
      <svg class="bv-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="bv-folder-path bv-folder-label" data-id="${f.id}" title="${f.path}">${bvFolderLabel(f)}</span>
      <button class="bv-remove-btn" data-id="${f.id}" title="Remove">×</button>
    </li>
  `).join('');
}

/* ------------------------------------------------------------------ *
 *  Add / remove folders
 * ------------------------------------------------------------------ */
async function addFolders() {
  const paths = await window.api.pickFolders().catch(() => []);
  if (!paths || !paths.length) return;
  let added = false;
  for (const p of paths) {
    if (!_folders.some(f => f.path === p)) {
      _folders.push({ id: bvMkId(), path: p, recursive: true, alias: '' });
      added = true;
    }
  }
  if (!added) return;
  renderFolders();
  syncRefreshBtn();
  persistFolders();
  startScan();
}

function removeFolder(id) {
  _folders = _folders.filter(f => f.id !== id);
  renderFolders();
  syncRefreshBtn();
  persistFolders();
  startScan();
}

function syncRefreshBtn() {
  const btn = document.getElementById('bv-refresh-btn');
  if (btn) btn.disabled = _folders.length === 0;
}

function persistFolders() {
  // Batch keeps its OWN folder set, independent from the Gallery inventory.
  window.api.setSettings({ batchFolders: _folders }).catch(() => {});
}

/** Inline-edit a folder's display alias (double-click on the label). */
function beginAliasEdit(id) {
  const folder = _folders.find(f => f.id === id);
  const labelEl = document.querySelector(`.bv-folder-label[data-id="${CSS.escape(id)}"]`);
  if (!folder || !labelEl) return;

  const input = document.createElement('input');
  input.className = 'bv-folder-alias-input';
  input.value = folder.alias || bvTailLabel(folder.path);
  input.title = folder.path;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    folder.alias = input.value.trim();
    persistFolders();
    renderFolders();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { renderFolders(); }
  });
  input.addEventListener('blur', commit);
}

/* ------------------------------------------------------------------ *
 *  Scanning
 * ------------------------------------------------------------------ */
/**
 * Scan managed folders, using the shared store-backed cache to skip folders
 * whose directory mtime is unchanged since the last scan.
 * @param {boolean} forceAll  when true, ignore the cache and re-scan everything
 */
async function startScan(forceAll) {
  // New scan generation — any still-running background scan becomes "stale"
  // and will stop touching the shared file list / DOM (but still warms cache).
  const gen = ++_scanGen;

  // Cancel any running scan
  if (_scanReqId) {
    await window.api.cancelStream(_scanReqId).catch(() => {});
    _scanReqId = null;
  }

  if (_folders.length === 0) {
    _scanning  = false;
    _allFiles  = [];
    applyFilter();
    renderContent();
    updateCounts();
    setScanStatus('');
    return;
  }

  // Partition folders into cache-hits (reuse) and misses (need scan)
  const cache = window.store.get('scanCache', {}) || {};
  const toScan = [];
  const keep = [];

  for (const folder of _folders) {
    let stat = { exists: true, mtime: 0 };
    try { stat = await window.api.statDir(folder.path); } catch (_) {}
    const entry = cache[folder.path];
    if (forceAll !== true && entry && Array.isArray(entry.files) &&
        stat.exists && entry.dirMtime === stat.mtime) {
      keep.push(...entry.files);          // cache hit — folder unchanged
    } else {
      toScan.push({ path: folder.path, mtime: stat.mtime });
    }
  }

  // Restore statuses/selection markers for kept files (fresh pending state)
  _allFiles = keep.map(f => ({ ...f, status: f.status || 'pending' }));

  if (toScan.length === 0) {
    _scanning = false;
    setScanStatus('');
    applyFilter(); renderContent(); updateCounts(); loadThumbnails();
    return;
  }

  _scanning = true;
  scanProgress();

  const opts = { folders: toScan.map(t => t.path), recursive: true };
  const mtimeByFolder = new Map(toScan.map(t => [t.path, t.mtime]));
  const collected = [];
  let lastRenderCount = _allFiles.length;

  _scanReqId = await window.api.scanFolders(opts, (data) => {
    const stale = (gen !== _scanGen);  // a newer scan superseded this one
    if (data.type === 'file') {
      const entry = { ...data, status: 'pending' };
      collected.push(entry);            // always collect (local) so cache is warmed
      if (stale) return;
      _allFiles.push(entry);
      // Live count text updates every 25 files (cheap); the heavier grid
      // re-render is throttled to every 200 and only while the panel is mounted.
      if (_allFiles.length % 25 === 0) scanProgress();
      if (_allFiles.length - lastRenderCount >= 200) {
        lastRenderCount = _allFiles.length;
        applyFilter();
        if (_mounted) { renderContent(); updateCounts(); }
      }
    } else if (data.type === 'error' && data.path === undefined) {
      if (!stale) setScanStatus('Error: ' + (data.message || 'scan failed'));
    } else if (data.type === 'done') {
      if (!stale) {
        _scanning  = false;
        _scanReqId = null;
        setScanStatus('');
      }
      // Update cache: bucket freshly-collected files per scanned folder using
      // the symlink-robust bucketer so no folder ends up with an empty list
      // (which previously caused the cache to restore nothing on the next visit).
      const c = window.store.get('scanCache', {}) || {};
      const buckets = bvBucket(collected, toScan.map(t => t.path));
      for (const t of toScan) {
        c[t.path] = {
          files: buckets.get(t.path) || [],
          scannedAt: Date.now(),
          dirMtime: mtimeByFolder.get(t.path),
        };
      }
      window.store.set('scanCache', c);
      if (stale) return;   // background scan: cache warmed, nothing else to do
      applyFilter();
      // The panel may have been left during the scan — only touch the DOM if
      // it is still mounted; the cache is now warm for the next visit anyway.
      if (_mounted) { renderContent(); updateCounts(); }
    }
  }).catch(err => {
    _scanning = false;
    setScanStatus('Error: ' + (err && err.message ? err.message : String(err)));
    return null;
  });
}

/** Show a live "Scanning… N files" progress indicator (i18n). */
function scanProgress() {
  if (!_mounted) return;
  const n = _allFiles.length;
  setScanStatus(`<span class="bv-spin">⟳</span> ${escBv(t('batch.scanning'))} — ${n}`);
}

function setScanStatus(html) {
  const el = document.getElementById('bv-scan-status');
  if (el) el.innerHTML = html;
}

/* ------------------------------------------------------------------ *
 *  Batch conversion runner
 * ------------------------------------------------------------------ */
async function runBatchConversion(files, profile) {
  return new Promise((resolve, reject) => {
    window.api.runBatch({ files, profile }, (data) => {
      if (data.type === 'progress') {
        // Update the file's status in _allFiles
        const file = _allFiles.find(f => f.path === data.path);
        if (file) {
          file.status = data.status;
          if (data.status === 'done') {
            file.outputPath = data.outputPath;
            file.warnings   = data.warnings || [];
          } else if (data.status === 'error') {
            file.error = data.error;
          } else if (data.status === 'skipped') {
            file.message = data.message;
          }
          // Re-render to show updated status
          renderContent();
        }
      } else if (data.type === 'done') {
        // Batch completed
        const msg = `Conversion complete!\n${data.completed} succeeded, ${data.failed} failed.`;
        alert(msg);
        resolve();
      } else if (data.type === 'error' && data.path === undefined) {
        // Fatal error
        reject(new Error(data.message || 'Batch conversion failed'));
      }
    }).catch(reject);
  });
}

/* ------------------------------------------------------------------ *
 *  Event wiring
 * ------------------------------------------------------------------ */
function wireEvents() {
  const sig = _abortCtrl.signal;

  // ── Sources panel ──
  document.getElementById('bv-add-folder-btn')
    ?.addEventListener('click', addFolders, { signal: sig });

  document.getElementById('bv-refresh-btn')
    ?.addEventListener('click', () => startScan(true), { signal: sig });

  // Remove folder (delegated)
  document.getElementById('bv-folder-list')
    ?.addEventListener('click', e => {
      const btn = e.target.closest('.bv-remove-btn');
      if (btn) removeFolder(btn.dataset.id);
    }, { signal: sig });

  // Double-click folder label → inline alias edit
  document.getElementById('bv-folder-list')
    ?.addEventListener('dblclick', e => {
      const label = e.target.closest('.bv-folder-label');
      if (label) beginAliasEdit(label.dataset.id);
    }, { signal: sig });

  // ── Table controls ──
  document.getElementById('bv-search')
    ?.addEventListener('input', e => {
      _search = e.target.value;
      applyFilter(); renderContent(); updateCounts();
    }, { signal: sig });

  // View toggle (list ⇆ card)
  document.getElementById('bv-view-list')
    ?.addEventListener('click', () => setViewMode('list'), { signal: sig });
  document.getElementById('bv-view-card')
    ?.addEventListener('click', () => setViewMode('card'), { signal: sig });

  document.getElementById('bv-ext-chips')
    ?.addEventListener('click', e => {
      const chip = e.target.closest('.bv-chip');
      if (!chip) return;
      const ext = chip.dataset.ext;
      if (_extFilter.has(ext)) { _extFilter.delete(ext); chip.classList.remove('active'); }
      else                     { _extFilter.add(ext);    chip.classList.add('active'); }
      applyFilter(); renderContent(); updateCounts();
    }, { signal: sig });

  document.getElementById('bv-select-all')
    ?.addEventListener('change', e => {
      if (e.target.checked) { _filtered.forEach(f => _selected.add(f.path)); }
      else                  { _filtered.forEach(f => _selected.delete(f.path)); }
      renderContent(); updateCounts();
    }, { signal: sig });

  // Footer select-all / deselect-all (visible in both list and card view)
  document.getElementById('bv-sel-all-btn')
    ?.addEventListener('click', () => {
      _filtered.forEach(f => _selected.add(f.path));
      renderContent(); updateCounts();
    }, { signal: sig });
  document.getElementById('bv-desel-all-btn')
    ?.addEventListener('click', () => {
      _filtered.forEach(f => _selected.delete(f.path));
      renderContent(); updateCounts();
    }, { signal: sig });

  // Selection checkbox (delegated on scroll container — works for both
  // list rows and cards, which share the data-path attribute).
  document.getElementById('bv-table-scroll')
    ?.addEventListener('change', e => {
      if (e.target.type !== 'checkbox') return;
      const el = e.target.closest('.bv-row, .bv-card');
      if (!el) return;
      const p = el.dataset.path;
      if (e.target.checked) { _selected.add(p);    el.classList.add('bv-selected'); }
      else                  { _selected.delete(p); el.classList.remove('bv-selected'); }
      updateCounts();
    }, { signal: sig });

  // Clicking anywhere on a card (except its checkbox) toggles selection.
  document.getElementById('bv-card-grid')
    ?.addEventListener('click', e => {
      if (e.target.closest('.bv-card-check')) return; // checkbox handles itself
      const card = e.target.closest('.bv-card');
      if (!card) return;
      const p = card.dataset.path;
      const on = !_selected.has(p);
      if (on) { _selected.add(p); card.classList.add('bv-selected'); }
      else    { _selected.delete(p); card.classList.remove('bv-selected'); }
      const cb = card.querySelector('.bv-card-check');
      if (cb) cb.checked = on;
      updateCounts();
    }, { signal: sig });

  // Virtual scroll (list mode only)
  document.getElementById('bv-table-scroll')
    ?.addEventListener('scroll', onScroll, { signal: sig, passive: true });

  // ── Profile panel ──
  document.getElementById('bv-out-dir-btn')
    ?.addEventListener('click', async () => {
      const dir = await window.api.selectOutputDir().catch(() => null);
      if (dir) {
        const inp = document.getElementById('bv-out-dir');
        if (inp) inp.value = dir;
      }
    }, { signal: sig });

  // Convert button
  document.getElementById('bv-convert-btn')
    ?.addEventListener('click', async () => {
      const selectedFiles = _filtered.filter(f => _selected.has(f.path));
      if (selectedFiles.length === 0) return;

      const profile = readProfile();
      const btn = document.getElementById('bv-convert-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = t('batch.converting');
      }

      try {
        await runBatchConversion(selectedFiles, profile);
      } catch (err) {
        console.error('Batch conversion error:', err);
        alert(t('batch.failed') + ': ' + (err.message || String(err)));
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = t('batch.convertBtn');
        }
        updateCounts();
      }
    }, { signal: sig });

  // Add selection to a Project / Collection (create new or add to existing)
  const selectionFiles = () => _filtered
    .filter(f => _selected.has(f.path))
    .map(f => ({ path: f.path, name: f.name, ext: f.ext, mtime: f.mtime, size: f.size, preview: f.preview || null }));

  document.getElementById('bv-add-project')
    ?.addEventListener('click', async () => {
      const files = selectionFiles();
      if (!files.length || !window.Pickers) return;
      const res = await window.Pickers.addToProject(files);
      if (res && res.ok) {
        setScanStatus(escBv(t('batch.addedToProject', { n: res.added, name: res.name })));
        setTimeout(() => { if (!_scanning) setScanStatus(''); }, 3000);
      }
    }, { signal: sig });

  document.getElementById('bv-add-collection')
    ?.addEventListener('click', async () => {
      const files = selectionFiles();
      if (!files.length || !window.Pickers) return;
      const res = await window.Pickers.addToCollection(files);
      if (res && res.ok) {
        setScanStatus(escBv(t('batch.addedToCollection', { n: res.added, name: res.name })));
        setTimeout(() => { if (!_scanning) setScanStatus(''); }, 3000);
      }
    }, { signal: sig });
}

/** Collect current profile values from the UI. */
function readProfile() {
  return {
    outputFormat:     (document.getElementById('bv-out-format')  ?.value)  || 'pes',
    outputDir:        (document.getElementById('bv-out-dir')      ?.value)  || '',
    resizeWidthMm:    parseFloat(document.getElementById('bv-resize-w')?.value) || null,
    resizeHeightMm:   parseFloat(document.getElementById('bv-resize-h')?.value) || null,
    resampleStitches: (document.getElementById('bv-resample')?.checked)    || false,
    colorLimit:       parseInt(document.getElementById('bv-color-limit')?.value, 10) || null,
    conflictMode:     (document.querySelector('input[name="bv-conflict"]:checked')?.value) || 'suffix',
  };
}

/* ------------------------------------------------------------------ *
 *  Format loading (same as Convert for consistency)
 * ------------------------------------------------------------------ */
async function loadFormats() {
  const res = await window.api.listFormats();
  if (res && res.success) {
    _formats = res.formats;
  } else {
    // Fallback if backend unavailable
    const fallback = ['dst','pes','pec','exp','jef','vp3','xxx','u01','tbf','csv','json','gcode','pmv'];
    _formats = fallback.map(e => ({ extension: e, description: '', write: true, read: true }));
  }

  const writable = _formats.filter(f => f.write);
  writable.sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a.extension);
    const ib = PREFERRED_ORDER.indexOf(b.extension);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.extension.localeCompare(b.extension);
  });

  const selectEl = document.getElementById('bv-out-format');
  if (selectEl) {
    selectEl.innerHTML = '';
    for (const f of writable) {
      const opt = document.createElement('option');
      opt.value = f.extension;
      opt.textContent = '.' + f.extension.toUpperCase() + (f.description ? '  —  ' + f.description : '');
      selectEl.appendChild(opt);
    }
    // Default to PES if available, else first format
    selectEl.value = writable.some(f => f.extension === 'pes') ? 'pes' : (writable[0] || {}).extension;
  }
}

/* ------------------------------------------------------------------ *
 *  View lifecycle
 * ------------------------------------------------------------------ */
async function mount(container, store) {
  _container = container;
  _store     = store;
  _abortCtrl = new AbortController();
  _folders   = [];
  _allFiles  = [];
  _filtered  = [];
  _selected  = new Set();
  _search    = '';
  _extFilter = new Set();
  _scanReqId = null;
  _scanning  = false;
  _formats   = [];
  _thumbReqId = null;
  _tagsByPath = window.store.get('batchTags', {}) || {};

  // Restore persisted view mode
  try {
    const v = localStorage.getItem(BV_VIEW_KEY);
    _viewMode = (v === 'card') ? 'card' : 'list';
  } catch (_) { _viewMode = 'list'; }

  _mounted = true;

  injectStyles();
  container.innerHTML = buildHTML();
  wireEvents();

  // Load formats from backend (async, same as Convert)
  await loadFormats();

  // Set initial i18n text
  const convertBtn = document.getElementById('bv-convert-btn');
  if (convertBtn) convertBtn.textContent = t('batch.convertBtn');
  const addProjBtn = document.getElementById('bv-add-project');
  if (addProjBtn) addProjBtn.textContent = t('pick.addToProject');
  const addCollBtn = document.getElementById('bv-add-collection');
  if (addCollBtn) addCollBtn.textContent = t('pick.addToCollection');
  const selAllBtn = document.getElementById('bv-sel-all-btn');
  if (selAllBtn) selAllBtn.textContent = t('batch.selectAll');
  const deselAllBtn = document.getElementById('bv-desel-all-btn');
  if (deselAllBtn) deselAllBtn.textContent = t('batch.deselectAll');

  const noFoldersMsg = document.getElementById('bv-no-folders-msg');
  if (noFoldersMsg) noFoldersMsg.innerHTML = t('batch.noFolders').replace('\n', '<br>');

  // View-toggle button tooltips + active state
  const listBtn = document.getElementById('bv-view-list');
  const cardBtn = document.getElementById('bv-view-card');
  if (listBtn) { listBtn.title = t('batch.viewList'); listBtn.classList.toggle('active', _viewMode === 'list'); }
  if (cardBtn) { cardBtn.title = t('batch.viewCard'); cardBtn.classList.toggle('active', _viewMode === 'card'); }

  // Initial empty render (before settings load)
  renderContent();
  updateCounts();

  // Consume any hand-off queue from Gallery ("Send to Batch")
  const queue = window.store.get('batchQueue', []) || [];
  if (Array.isArray(queue) && queue.length > 0) {
    _selected = new Set(queue);
    window.store.set('batchQueue', []);   // clear after consuming
  }

  // Load persisted folders from settings, then scan
  window.api.getSettings().then(s => {
    // Batch uses its own independent folder set (falls back to legacy
    // managedFolders once, for users upgrading from the shared model).
    const saved = s && (s.batchFolders || s.managedFolders);
    if (Array.isArray(saved) && saved.length > 0) {
      _folders = saved.map(f =>
        typeof f === 'string'
          ? { id: bvMkId(), path: f, recursive: true, alias: '' }
          : { id: f.id || bvMkId(), path: f.path, recursive: f.recursive !== false, alias: f.alias || '' }
      );
      renderFolders();
      syncRefreshBtn();
      // Wait for layout before scanning
      requestAnimationFrame(() => startScan(false));
    }
  }).catch(() => {});
}

function unmount() {
  _mounted = false;

  // Deliberately DO NOT cancel a running folder scan here: let it finish in the
  // background so it warms the shared scan cache, making the next visit instant.
  // The stale-generation guard keeps its callbacks from touching the (now
  // removed) DOM or a future mount's file list.

  // Thumbnails are view-only work — stop them and clear the lazy queue.
  if (_thumbReqId) {
    window.api.cancelStream(_thumbReqId).catch(() => {});
    _thumbReqId = null;
  }
  if (_thumbTimer) { clearTimeout(_thumbTimer); _thumbTimer = null; }
  _thumbQueue.clear();
  if (_cardIO) { _cardIO.disconnect(); _cardIO = null; }

  if (_abortCtrl) {
    _abortCtrl.abort();
    _abortCtrl = null;
  }
  removeStyles();
  _container = null;
  _store     = null;
}

window.registerView('batch', { mount, unmount });
})();
