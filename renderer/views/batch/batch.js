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
 *  Constants
 * ------------------------------------------------------------------ */
const BV_EXTS  = ['dst', 'pes', 'pec', 'jef', 'vp3', 'hus', 'xxx', 'exp', 'sew', 'emb'];
const ROW_H    = 36;   // px — virtual row height
const BUF_ROWS = 8;    // extra rows to render above/below viewport
const STYLE_ID = 'bv-styles';

/* ------------------------------------------------------------------ *
 *  Module-level state (fully reset on each mount)
 * ------------------------------------------------------------------ */
let _container = null;
let _store     = null;
let _abortCtrl = null;

let _folders   = [];         // { id, path, recursive }[]
let _allFiles  = [];         // FileEntry[] — full scan results
let _filtered  = [];         // FileEntry[] — after search + ext filter
let _selected  = new Set();  // selected file paths (Set<string>)
let _search    = '';
let _extFilter = new Set();  // active ext filter; empty = all exts shown
let _scanReqId = null;
let _scanning  = false;

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
      <span class="bv-panel-title">Source Folders</span>
      <div class="bv-header-actions">
        <button id="bv-refresh-btn" class="bv-icon-btn" title="Re-scan folders" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-5H1"/>
          </svg>
        </button>
        <button id="bv-add-folder-btn" class="bv-icon-btn bv-accent" title="Add folders">
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
      <li class="bv-empty-hint">No folders added yet.<br>Click + to add folders.</li>
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
          <input id="bv-search" class="bv-search-input" type="text" placeholder="Search by name…"/>
        </div>
        <span id="bv-scan-status" class="bv-scan-status"></span>
        <span id="bv-file-count" class="bv-file-count">0 files</span>
      </div>
      <div id="bv-ext-chips" class="bv-ext-chips">${chips}</div>
      <div class="bv-col-head">
        <label class="bv-col-check">
          <input type="checkbox" id="bv-select-all"/>
        </label>
        <span class="bv-col-name">Name</span>
        <span class="bv-col-ext">Type</span>
        <span class="bv-col-size">Size</span>
        <span class="bv-col-status">Status</span>
      </div>
    </div>

    <div id="bv-table-scroll" class="bv-table-scroll">
      <div id="bv-table-rows" class="bv-table-rows"></div>
    </div>

    <div class="bv-table-footer">
      <span id="bv-sel-count" class="bv-sel-count">0 selected</span>
      <button id="bv-convert-btn" class="bv-convert-btn" disabled>Convert Selected</button>
    </div>
  </main>

  <!-- ── Batch profile panel ── -->
  <aside class="bv-panel bv-profile">
    <div class="bv-panel-header">
      <span class="bv-panel-title">Batch Profile</span>
    </div>
    <div class="bv-profile-body">

      <label class="bv-field-label">Output Format</label>
      <select id="bv-out-format" class="bv-select">
        <option value="dst">DST — Tajima</option>
        <option value="pes" selected>PES — Brother</option>
        <option value="jef">JEF — Janome</option>
        <option value="vp3">VP3 — Husqvarna/Pfaff</option>
        <option value="hus">HUS — Husqvarna</option>
        <option value="xxx">XXX — Singer</option>
        <option value="exp">EXP — Melco</option>
        <option value="sew">SEW — Janome</option>
      </select>

      <label class="bv-field-label">Output Folder</label>
      <div class="bv-dir-row">
        <input id="bv-out-dir" class="bv-input bv-dir-input" type="text"
               placeholder="Same as source" readonly/>
        <button id="bv-out-dir-btn" class="bv-browse-btn" title="Browse">…</button>
      </div>

      <details class="bv-section" open>
        <summary class="bv-section-title">Resize</summary>
        <div class="bv-resize-row">
          <label>W (mm)
            <input id="bv-resize-w" class="bv-input bv-dim-input"
                   type="number" min="1" max="500" step="1" placeholder="—"/>
          </label>
          <label>H (mm)
            <input id="bv-resize-h" class="bv-input bv-dim-input"
                   type="number" min="1" max="500" step="1" placeholder="—"/>
          </label>
        </div>
        <label class="bv-check-label">
          <input type="checkbox" id="bv-resample"/>
          Resample stitches
        </label>
      </details>

      <details class="bv-section">
        <summary class="bv-section-title">Color Limit</summary>
        <div class="bv-resize-row">
          <label>Max colors
            <input id="bv-color-limit" class="bv-input bv-dim-input"
                   type="number" min="1" max="64" step="1" placeholder="—"/>
          </label>
        </div>
      </details>

      <details class="bv-section">
        <summary class="bv-section-title">Conflicts</summary>
        <label class="bv-check-label">
          <input type="radio" name="bv-conflict" value="suffix" checked/>
          Add suffix&nbsp;<span class="bv-mono">(name (1).pes)</span>
        </label>
        <label class="bv-check-label">
          <input type="radio" name="bv-conflict" value="overwrite"/>
          Overwrite existing
        </label>
        <label class="bv-check-label">
          <input type="radio" name="bv-conflict" value="skip"/>
          Skip file
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
  direction: rtl; text-align: left;
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

  if (countEl)    countEl.textContent = _filtered.length + ' file' + (_filtered.length !== 1 ? 's' : '');
  if (selEl)      selEl.textContent   = selCount + ' selected';
  if (convertBtn) convertBtn.disabled = selCount === 0;
  if (selAll) {
    const allSel = _filtered.length > 0 && selCount === _filtered.length;
    selAll.checked       = allSel;
    selAll.indeterminate = !allSel && selCount > 0;
  }
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
      ? 'Add source folders in the left panel to get started.'
      : _scanning
        ? 'Scanning…'
        : 'No matching files found.';
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

/* ------------------------------------------------------------------ *
 *  Folder list renderer
 * ------------------------------------------------------------------ */
function renderFolders() {
  const list = document.getElementById('bv-folder-list');
  if (!list) return;
  if (_folders.length === 0) {
    list.innerHTML = '<li class="bv-empty-hint">No folders added yet.<br>Click + to add folders.</li>';
    return;
  }
  list.innerHTML = _folders.map(f => `
    <li class="bv-folder-item" data-id="${f.id}">
      <svg class="bv-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="bv-folder-path" title="${f.path}">${f.path}</span>
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
      _folders.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        path: p, recursive: true,
      });
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
  window.api.setSettings({ managedFolders: _folders }).catch(() => {});
}

/* ------------------------------------------------------------------ *
 *  Scanning
 * ------------------------------------------------------------------ */
async function startScan() {
  // Cancel any running scan
  if (_scanReqId) {
    await window.api.cancelStream(_scanReqId).catch(() => {});
    _scanReqId = null;
  }

  if (_folders.length === 0) {
    _scanning  = false;
    _allFiles  = [];
    applyFilter();
    renderRows();
    updateCounts();
    setScanStatus('');
    return;
  }

  _scanning = true;
  _allFiles = [];
  setScanStatus('<span class="bv-spin">⟳</span> Scanning…');

  const opts = { folders: _folders.map(f => f.path), recursive: true };
  let lastRenderCount = 0;

  _scanReqId = await window.api.scanFolders(opts, (data) => {
    if (data.type === 'file') {
      _allFiles.push({ ...data, status: 'pending' });
      // Throttle re-renders: every 100 new files
      if (_allFiles.length - lastRenderCount >= 100) {
        lastRenderCount = _allFiles.length;
        applyFilter(); renderRows(); updateCounts();
      }
    } else if (data.type === 'error' && data.path === undefined) {
      setScanStatus('Error: ' + (data.message || 'scan failed'));
    } else if (data.type === 'done') {
      _scanning  = false;
      _scanReqId = null;
      setScanStatus('');
      applyFilter(); renderRows(); updateCounts();
    }
  }).catch(err => {
    _scanning = false;
    setScanStatus('Error: ' + (err && err.message ? err.message : String(err)));
    return null;
  });
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
          renderRows();
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
    ?.addEventListener('click', startScan, { signal: sig });

  // Remove folder (delegated)
  document.getElementById('bv-folder-list')
    ?.addEventListener('click', e => {
      const btn = e.target.closest('.bv-remove-btn');
      if (btn) removeFolder(btn.dataset.id);
    }, { signal: sig });

  // ── Table controls ──
  document.getElementById('bv-search')
    ?.addEventListener('input', e => {
      _search = e.target.value;
      applyFilter(); renderRows(); updateCounts();
    }, { signal: sig });

  document.getElementById('bv-ext-chips')
    ?.addEventListener('click', e => {
      const chip = e.target.closest('.bv-chip');
      if (!chip) return;
      const ext = chip.dataset.ext;
      if (_extFilter.has(ext)) { _extFilter.delete(ext); chip.classList.remove('active'); }
      else                     { _extFilter.add(ext);    chip.classList.add('active'); }
      applyFilter(); renderRows(); updateCounts();
    }, { signal: sig });

  document.getElementById('bv-select-all')
    ?.addEventListener('change', e => {
      if (e.target.checked) { _filtered.forEach(f => _selected.add(f.path)); }
      else                  { _filtered.forEach(f => _selected.delete(f.path)); }
      renderRows(); updateCounts();
    }, { signal: sig });

  // Row checkbox (delegated on scroll container)
  document.getElementById('bv-table-scroll')
    ?.addEventListener('change', e => {
      if (e.target.type !== 'checkbox') return;
      const row = e.target.closest('.bv-row');
      if (!row) return;
      const p = row.dataset.path;
      if (e.target.checked) { _selected.add(p);    row.classList.add('bv-selected'); }
      else                  { _selected.delete(p); row.classList.remove('bv-selected'); }
      updateCounts();
    }, { signal: sig });

  // Virtual scroll
  document.getElementById('bv-table-scroll')
    ?.addEventListener('scroll', renderRows, { signal: sig, passive: true });

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
        btn.textContent = 'Converting…';
      }

      try {
        await runBatchConversion(selectedFiles, profile);
      } catch (err) {
        console.error('Batch conversion error:', err);
        alert('Batch conversion failed: ' + (err.message || String(err)));
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Convert Selected';
        }
        updateCounts();
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
 *  View lifecycle
 * ------------------------------------------------------------------ */
function mount(container, store) {
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

  injectStyles();
  container.innerHTML = buildHTML();
  wireEvents();

  // Initial empty render (before settings load)
  renderRows();
  updateCounts();

  // Load persisted folders from settings, then scan
  window.api.getSettings().then(s => {
    const saved = s && s.managedFolders;
    if (Array.isArray(saved) && saved.length > 0) {
      _folders = saved.map(f =>
        typeof f === 'string'
          ? { id: Date.now().toString(36) + Math.random().toString(36).slice(2), path: f, recursive: true }
          : { id: f.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)), path: f.path, recursive: f.recursive !== false }
      );
      renderFolders();
      syncRefreshBtn();
      // Wait for layout before scanning
      requestAnimationFrame(startScan);
    }
  }).catch(() => {});
}

function unmount() {
  if (_scanReqId) {
    window.api.cancelStream(_scanReqId).catch(() => {});
    _scanReqId = null;
  }
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
