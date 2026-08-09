(function () {
'use strict';
/**
 * Gallery View — Motif library (folder-based browser)
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Concept:
 *  A managed folder is a LIBRARY ROOT. Its immediate sub-folders are "motifs".
 *  A motif folder may contain (a) several format variants of the same design,
 *  (b) documentation files (.pdf/.doc/.docx) and/or (c) further sub-folders
 *  (e.g. per hoop size) that in turn hold the stitch files.
 *
 *  The Gallery therefore behaves like a recursive folder browser:
 *   - Top level  → one card per motif (immediate sub-folder of a root)
 *   - Drill down → sub-folders (hoop sizes), stitch-file variants and documents
 *
 *  Actions:
 *   - Motif / folder cards → mark → "Add to Collection" (entry level only) + AI tagging
 *   - Stitch files         → select specific formats → "Send to Transfer"
 *   - Documents            → inline PDF preview / open externally
 *
 * ID prefix: gv-
 */

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */
const EMB_EXTS = [
  'dst', 'pes', 'pec', 'jef', 'vp3', 'hus', 'xxx', 'exp', 'sew',
  'emb', 'u01', 'tap', 'phb', 'phc', 'bro', 'dat', 'dsb', 'dsz',
  'emd', '10o', '100', 'shv', 'jpx', 'ksm', 'max', 'tbf', 'gt',
  'inb', 'zxy', 'stx',
];
const DOC_EXTS = ['pdf', 'doc', 'docx'];
const SCAN_EXTS = EMB_EXTS.concat(DOC_EXTS);
const GAL_CACHE = 'galleryScanCache';   // gallery-private (keeps Batch cache clean)

/* ------------------------------------------------------------------ *
 *  Module-level state (reset on each mount)
 * ------------------------------------------------------------------ */
let _abortCtrl      = null;
let _scanRequestId  = null;
let _thumbRequestId = null;

let _managedFolders = [];        // { id, path, recursive, alias }[]
let _allFiles       = [];        // FileEntry[] (embroidery + documents)
let _root           = null;      // synthetic tree root
let _path           = [];        // breadcrumb: array of folder nodes (drill-down)
let _tags           = {};        // { [folderPath]: { category, tags:[] } }

let _markedFolders  = new Set(); // marked motif/folder paths (→ Collection / AI)
let _selStitch      = new Set(); // selected stitch-file paths (→ Transfer)

let _activeFolderId = null;      // null = all roots; else restrict to one root
let _searchQuery    = '';
let _sortMode       = 'name-asc';
let _selected       = null;      // stitch file shown in detail modal

const SEP = (window.api && window.api.platform === 'win32') ? '\\' : '/';

/* ------------------------------------------------------------------ *
 *  i18n helper
 * ------------------------------------------------------------------ */
function t(key, params) {
  const lang = (window.store && window.store.get('settings.language', 'en')) || 'en';
  const dict = (window.I18N && window.I18N[lang]) || (window.I18N && window.I18N.en) || {};
  let s = dict[key] !== undefined
    ? dict[key]
    : ((window.I18N && window.I18N.en && window.I18N.en[key]) || key);
  if (params) for (const k in params) s = s.split('{' + k + '}').join(params[k]);
  return s;
}

/* ------------------------------------------------------------------ *
 *  Path helpers
 * ------------------------------------------------------------------ */
function splitPath(p) { return String(p || '').split(/[\\/]+/).filter(Boolean); }
function tailLabel(p) { const parts = splitPath(p); return parts.slice(-2).join(SEP) || p; }
function baseName(p)  { const parts = splitPath(p); return parts[parts.length - 1] || p; }
function folderLabel(folder) {
  if (folder.alias && folder.alias.trim()) return folder.alias.trim();
  return tailLabel(folder.path);
}
function belongsTo(filePath, folderPath) {
  const a = String(filePath || '');
  const b = String(folderPath || '');
  return a === b || a.startsWith(b.endsWith(SEP) ? b : b + SEP) ||
         a.startsWith(b + '/') || a.startsWith(b + '\\');
}
function extOf(f) { return (f.ext || (baseName(f.name || f.path).split('.').pop() || '')).toLowerCase(); }
function isEmb(f)  { return EMB_EXTS.includes(extOf(f)); }
function isDoc(f)  { return DOC_EXTS.includes(extOf(f)); }
/** Strip the extension → grouping stem for format variants. */
function stemOf(f) {
  const n = baseName(f.name || f.path);
  const dot = n.lastIndexOf('.');
  return (dot > 0 ? n.slice(0, dot) : n).toLowerCase();
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function mkId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */
async function mount(container) {
  _abortCtrl = new AbortController();

  injectCSS();
  const host = container || document.getElementById('viewHost');
  host.innerHTML = buildHTML();

  const settings = await window.api.getSettings();
  _managedFolders = normalizeFolders(settings.managedFolders || []);
  _tags = (settings.galleryTags && typeof settings.galleryTags === 'object') ? settings.galleryTags : {};

  renderFolderList();
  wireEvents();

  await loadAndScan(false);
}

function unmount() {
  if (_scanRequestId)  { window.api.cancelStream(_scanRequestId);  _scanRequestId = null; }
  if (_thumbRequestId) { window.api.cancelStream(_thumbRequestId); _thumbRequestId = null; }
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
  closeDetail();
  closeDocModal();
  removeCSS();
  _managedFolders = [];
  _allFiles = [];
  _root = null;
  _path = [];
  _markedFolders = new Set();
  _selStitch = new Set();
  _selected = null;
}

/** Normalise persisted folder entries to a common schema. */
function normalizeFolders(saved) {
  return (saved || []).map(f =>
    typeof f === 'string'
      ? { id: mkId(), path: f, recursive: true, alias: '' }
      : { id: f.id || mkId(), path: f.path, recursive: f.recursive !== false, alias: f.alias || '' }
  ).filter(f => f.path);
}

/* ------------------------------------------------------------------ *
 *  HTML template
 * ------------------------------------------------------------------ */
function buildHTML() {
  return `
<div class="gv-root">
  <!-- Left: Library roots -->
  <aside class="gv-folders-panel">
    <div class="gv-panel-header">
      <h3>${esc(t('gallery.managedFolders'))}</h3>
      <div class="gv-header-actions">
        <button id="gv-refresh-btn" class="gv-icon-btn gv-ghost" title="${esc(t('gallery.refresh'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-5H1"/>
          </svg>
        </button>
        <button id="gv-add-folder-btn" class="gv-icon-btn" title="${esc(t('gallery.addFolder'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
        </button>
      </div>
    </div>
    <div id="gv-folder-list" class="gv-folder-list"></div>
  </aside>

  <!-- Center: Browser -->
  <main class="gv-grid-panel">
    <div class="gv-toolbar">
      <input type="text" id="gv-search" class="gv-search" placeholder="${esc(t('gallery.searchMotif'))}" />
      <div class="gv-sort">
        <select id="gv-sort-select">
          <option value="name-asc">${esc(t('gallery.sortName'))}</option>
          <option value="name-desc">${esc(t('gallery.sortNameDesc'))}</option>
          <option value="size-asc">${esc(t('gallery.sortSize'))}</option>
          <option value="size-desc">${esc(t('gallery.sortSizeDesc'))}</option>
        </select>
      </div>
    </div>

    <div id="gv-breadcrumb" class="gv-breadcrumb"></div>

    <div class="gv-marked-bar" id="gv-marked-bar">
      <span id="gv-marked-count" class="gv-marked-count"></span>
      <button id="gv-deselect-all" class="gv-link-btn">${esc(t('gallery.deselectAll'))}</button>
      <button id="gv-ai-classify" class="gv-send-batch gv-ai-btn">✨ ${esc(t('gallery.aiClassify'))}</button>
      <button id="gv-send-collection" class="gv-send-batch">${esc(t('gallery.sendToCollection'))}</button>
    </div>

    <div class="gv-transfer-bar" id="gv-transfer-bar">
      <span id="gv-transfer-count" class="gv-marked-count"></span>
      <button id="gv-transfer-deselect" class="gv-link-btn">${esc(t('gallery.deselectAll'))}</button>
      <button id="gv-send-transfer" class="gv-send-batch">${esc(t('gallery.sendToTransfer'))} →</button>
    </div>

    <div id="gv-scan-status" class="gv-scan-status"></div>
    <div id="gv-grid" class="gv-grid card"></div>
  </main>
</div>

<!-- Detail modal (single stitch file) -->
<div id="gv-modal" class="gv-modal" hidden>
  <div class="gv-modal-backdrop" id="gv-modal-backdrop"></div>
  <div class="gv-modal-card" id="gv-modal-card"></div>
</div>

<!-- Document preview modal -->
<div id="gv-doc-modal" class="gv-modal" hidden>
  <div class="gv-modal-backdrop" id="gv-doc-backdrop"></div>
  <div class="gv-doc-card" id="gv-doc-card"></div>
</div>
`;
}

/* ------------------------------------------------------------------ *
 *  CSS injection (light theme)
 * ------------------------------------------------------------------ */
function injectCSS() {
  if (document.getElementById('gv-styles')) return;
  const style = document.createElement('style');
  style.id = 'gv-styles';
  style.textContent = `
.gv-root {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--surface, #f4f6fb);
  color: var(--text, #1c2333);
  font-size: 13px;
}

/* ── Folders panel ── */
.gv-folders-panel {
  display: flex; flex-direction: column;
  min-height: 0;
  background: var(--panel-bg, #fff);
  border-right: 1px solid var(--border, #e3e7ef);
}
.gv-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border, #e3e7ef);
  background: var(--panel-header-bg, #f9fafd);
}
.gv-panel-header h3 {
  margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .04em;
  text-transform: uppercase; color: var(--muted, #6b7385);
}
.gv-header-actions { display: flex; gap: 4px; }
.gv-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: var(--accent, #5b5bd6); color: #fff; cursor: pointer;
  transition: background .15s;
}
.gv-icon-btn svg { width: 15px; height: 15px; }
.gv-icon-btn:hover { background: var(--accent-hover, #4a4ac4); }
.gv-icon-btn.gv-ghost { background: transparent; color: var(--muted, #6b7385); }
.gv-icon-btn.gv-ghost:hover { background: var(--hover-bg, #f0f2f9); color: var(--text, #1c2333); }

.gv-folder-list { flex: 1; overflow-y: auto; padding: 6px; }
.gv-folder-item {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 8px; margin-bottom: 3px; border-radius: 6px;
  background: var(--panel-bg, #fff); border: 1px solid var(--border, #e3e7ef);
}
.gv-folder-item:hover { background: var(--hover-bg, #f0f2f9); }
.gv-folder-icon { flex-shrink: 0; color: var(--accent, #5b5bd6); width: 14px; height: 14px; }
.gv-folder-label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text, #1c2333); font-size: 12px; cursor: pointer;
}
.gv-folder-alias-input {
  flex: 1; min-width: 0; font-size: 12px; padding: 2px 4px;
  border: 1px solid var(--accent, #5b5bd6); border-radius: 4px;
  background: var(--input-bg, #fff); color: var(--text, #1c2333); outline: none;
}
.gv-folder-remove {
  flex-shrink: 0; background: transparent; border: none; cursor: pointer;
  color: var(--muted, #6b7385); font-size: 15px; line-height: 1; padding: 0 3px;
  opacity: .6; transition: opacity .15s, color .15s;
}
.gv-folder-remove:hover { opacity: 1; color: var(--error, #d64545); }
.gv-folder-item { cursor: pointer; transition: background .15s, border-color .15s; }
.gv-folder-item.active {
  border-color: var(--accent, #5b5bd6);
  background: var(--accent-subtle, #ececfb);
}
.gv-folder-item.active .gv-folder-label { color: var(--accent, #5b5bd6); font-weight: 600; }
.gv-folder-all { margin-bottom: 6px; }
.gv-folder-rec {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border-radius: 4px; border: none;
  background: transparent; cursor: pointer; color: var(--muted, #6b7385);
  opacity: .5; transition: opacity .15s, color .15s, background .15s;
}
.gv-folder-rec svg { width: 13px; height: 13px; }
.gv-folder-rec:hover { opacity: 1; background: var(--hover-bg, #f0f2f9); }
.gv-folder-rec.on { opacity: 1; color: var(--accent, #5b5bd6); }
.gv-empty-folders {
  padding: 28px 14px; text-align: center; color: var(--muted, #6b7385);
  font-size: 12px; line-height: 1.6;
}

/* ── Grid panel ── */
.gv-grid-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.gv-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: var(--panel-header-bg, #f9fafd);
  border-bottom: 1px solid var(--border, #e3e7ef);
}
.gv-search {
  flex: 1; min-width: 0; padding: 6px 10px;
  background: var(--input-bg, #fff); border: 1px solid var(--border, #e3e7ef);
  border-radius: 6px; color: var(--text, #1c2333); font-size: 13px; outline: none;
}
.gv-search:focus { border-color: var(--accent, #5b5bd6); }
.gv-sort select {
  padding: 5px 8px; background: var(--input-bg, #fff);
  border: 1px solid var(--border, #e3e7ef); border-radius: 6px;
  color: var(--text, #1c2333); font-size: 12px; outline: none;
}

/* ── Breadcrumb ── */
.gv-breadcrumb {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  padding: 8px 14px; background: var(--panel-bg, #fff);
  border-bottom: 1px solid var(--border, #e3e7ef); font-size: 12px;
}
.gv-crumb {
  color: var(--accent, #5b5bd6); cursor: pointer; padding: 2px 4px; border-radius: 4px;
}
.gv-crumb:hover { background: var(--hover-bg, #f0f2f9); text-decoration: underline; }
.gv-crumb.current { color: var(--text, #1c2333); font-weight: 600; cursor: default; }
.gv-crumb.current:hover { background: none; text-decoration: none; }
.gv-crumb-sep { color: var(--muted, #98a0b3); }

.gv-marked-bar, .gv-transfer-bar {
  display: none; align-items: center; gap: 12px;
  padding: 8px 14px; background: var(--accent-subtle, #eef1fd);
  border-bottom: 1px solid var(--border, #e3e7ef);
}
.gv-marked-bar.show, .gv-transfer-bar.show { display: flex; }
.gv-transfer-bar { background: #eafaf1; }
.gv-marked-count { font-size: 12px; color: var(--text, #1c2333); font-weight: 600; }
.gv-link-btn {
  padding: 4px 8px; border: none; background: none; cursor: pointer; font-size: 12px;
  color: var(--accent,#4a6ef5); text-decoration: underline; transition: opacity .15s;
}
.gv-link-btn:hover { opacity: 0.8; }
.gv-send-batch {
  margin-left: auto; padding: 6px 14px; border: none; border-radius: 7px;
  background: var(--accent, #5b5bd6); color: #fff; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background .15s;
}
.gv-send-batch + .gv-send-batch { margin-left: 0; }
.gv-send-batch:hover { background: var(--accent-hover, #4a4ac4); }
.gv-send-batch:disabled { opacity: .5; cursor: default; }
.gv-ai-btn { background: #7a5bd6; }
.gv-ai-btn:hover { background: #674ac4; }

.gv-scan-status {
  padding: 6px 14px; font-size: 12px; color: var(--muted, #6b7385);
  background: var(--panel-bg, #fff); border-bottom: 1px solid var(--border, #e3e7ef);
  min-height: 0;
}
.gv-scan-status:empty { display: none; }

/* ── Card grid ── */
.gv-grid { flex: 1; overflow-y: auto; padding: 16px; background: var(--surface, #f4f6fb); }
.gv-grid.card {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px; align-content: start;
}
.gv-section-label {
  grid-column: 1 / -1; font-size: 11px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: var(--muted, #6b7385); margin: 4px 0 -4px;
}
.gv-card {
  position: relative; display: flex; flex-direction: column; align-items: center;
  padding: 10px; background: var(--panel-bg, #fff);
  border: 1px solid var(--border, #e3e7ef); border-radius: 10px;
  cursor: pointer; transition: box-shadow .15s, border-color .15s;
}
.gv-card:hover { border-color: var(--accent, #5b5bd6); box-shadow: var(--shadow); }
.gv-card-check {
  position: absolute; top: 8px; left: 8px; width: 16px; height: 16px;
  cursor: pointer; z-index: 2;
}
.gv-card-badge-doc {
  position: absolute; top: 6px; right: 8px; font-size: 13px; z-index: 2;
}
.gv-thumb {
  width: 120px; height: 120px; background: var(--surface, #f4f6fb);
  border: 1px solid var(--border, #e3e7ef); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 8px; overflow: hidden;
}
.gv-thumb svg { width: 100%; height: 100%; }
.gv-thumb-ph { color: var(--muted, #98a0b3); font-size: 10px; }
.gv-folder-thumb { color: var(--accent, #5b5bd6); }
.gv-folder-thumb svg { width: 54px; height: 54px; }
.gv-card-name {
  width: 100%; text-align: center; font-size: 12px; color: var(--text, #1c2333);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;
}
.gv-card-sub { font-size: 10.5px; color: var(--muted, #6b7385); margin-top: 2px; }
.gv-card-chips { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; margin-top: 5px; }
.gv-badge {
  font-size: 9px; font-family: monospace; text-transform: uppercase;
  background: var(--accent-subtle, #eef1fd); color: var(--accent, #5b5bd6);
  padding: 1px 6px; border-radius: 8px; font-weight: 700;
}
.gv-tag-chip {
  font-size: 9.5px; background: #eef7ef; color: #2f7d47;
  padding: 1px 7px; border-radius: 8px;
}
.gv-card-actions { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; margin-top: 8px; width: 100%; }
.gv-mini-btn {
  padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border, #e3e7ef);
  background: var(--input-bg, #fff); color: var(--text, #1c2333); font-size: 10.5px;
  cursor: pointer; transition: all .12s;
}
.gv-mini-btn:hover { border-color: var(--accent, #5b5bd6); color: var(--accent, #5b5bd6); }
.gv-mini-btn.sel { background: var(--accent, #5b5bd6); border-color: var(--accent, #5b5bd6); color: #fff; }

.gv-empty-grid {
  padding: 56px 16px; text-align: center; color: var(--muted, #6b7385);
  font-size: 13px; white-space: pre-line;
}

/* ── Detail modal ── */
.gv-modal { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; }
.gv-modal[hidden] { display: none; }
.gv-modal-backdrop { position: absolute; inset: 0; background: rgba(20,25,40,.45); }
.gv-modal-card {
  position: relative; z-index: 1; width: min(760px, 92vw); max-height: 88vh; overflow-y: auto;
  background: var(--panel-bg, #fff); border-radius: 14px; box-shadow: 0 20px 60px rgba(20,25,40,.28);
  padding: 22px;
}
.gv-modal-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.gv-modal-title { margin: 0; font-size: 17px; font-weight: 650; color: var(--text, #1c2333); word-break: break-all; }
.gv-modal-close {
  background: transparent; border: none; font-size: 22px; line-height: 1; cursor: pointer;
  color: var(--muted, #6b7385); padding: 0 4px;
}
.gv-modal-close:hover { color: var(--text, #1c2333); }
.gv-modal-body { display: grid; grid-template-columns: 300px 1fr; gap: 22px; }
@media (max-width: 640px){ .gv-modal-body { grid-template-columns: 1fr; } }
.gv-modal-preview {
  width: 300px; height: 300px; max-width: 100%;
  background: var(--surface, #f4f6fb); border: 1px solid var(--border, #e3e7ef);
  border-radius: 10px; display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.gv-modal-preview svg { width: 100%; height: 100%; }
.gv-meta-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.gv-meta-table td { padding: 5px 6px; border-bottom: 1px solid var(--row-border, #f0f2f8); vertical-align: top; }
.gv-meta-key { color: var(--muted, #6b7385); white-space: nowrap; width: 38%; }
.gv-meta-val { color: var(--text, #1c2333); word-break: break-all; }
.gv-palette { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.gv-swatch { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted, #6b7385); }
.gv-swatch-dot { width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--border, #e3e7ef); }
.gv-modal-actions { display: flex; gap: 8px; margin-top: 20px; grid-column: 1 / -1; flex-wrap: wrap; }
.gv-modal-btn {
  padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600;
  background: var(--accent, #5b5bd6); color: #fff; transition: background .15s;
}
.gv-modal-btn:hover { background: var(--accent-hover, #4a4ac4); }
.gv-modal-btn.secondary {
  background: var(--input-bg, #fff); color: var(--text, #1c2333);
  border: 1px solid var(--border, #e3e7ef);
}
.gv-modal-btn.secondary:hover { background: var(--hover-bg, #f0f2f9); }

/* ── Document modal ── */
.gv-doc-card {
  position: relative; z-index: 1; width: min(900px, 94vw); height: 88vh;
  display: flex; flex-direction: column;
  background: var(--panel-bg, #fff); border-radius: 14px; overflow: hidden;
  box-shadow: 0 20px 60px rgba(20,25,40,.28);
}
.gv-doc-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; border-bottom: 1px solid var(--border, #e3e7ef);
}
.gv-doc-title { font-size: 14px; font-weight: 650; color: var(--text, #1c2333); word-break: break-all; }
.gv-doc-body { flex: 1; min-height: 0; background: var(--surface, #f4f6fb); }
.gv-doc-body iframe { width: 100%; height: 100%; border: none; }
.gv-doc-fallback { padding: 48px 24px; text-align: center; color: var(--muted, #6b7385); font-size: 13px; }
`;
  document.head.appendChild(style);
}
function removeCSS() { document.getElementById('gv-styles')?.remove(); }

/* ------------------------------------------------------------------ *
 *  Folder list + alias editing
 * ------------------------------------------------------------------ */
function renderFolderList() {
  const container = document.getElementById('gv-folder-list');
  if (!container) return;

  if (_managedFolders.length === 0) {
    container.innerHTML = `<div class="gv-empty-folders">${esc(t('gallery.noFolders'))}</div>`;
    return;
  }

  const allActive = _activeFolderId === null ? ' active' : '';
  let html = `
    <div class="gv-folder-item gv-folder-all${allActive}" data-id="__all__" title="${esc(t('gallery.allFolders'))}">
      <svg class="gv-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      <span class="gv-folder-label">${esc(t('gallery.allFolders'))}</span>
    </div>`;

  html += _managedFolders.map(folder => {
    const active = _activeFolderId === folder.id ? ' active' : '';
    const recOn  = folder.recursive !== false;
    return `
    <div class="gv-folder-item${active}" data-id="${esc(folder.id)}">
      <svg class="gv-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="gv-folder-label" data-id="${esc(folder.id)}"
            title="${esc(folder.path)}">${esc(folderLabel(folder))}</span>
      <button class="gv-folder-rec${recOn ? ' on' : ''}" data-id="${esc(folder.id)}"
              title="${esc(recOn ? t('gallery.recursiveOn') : t('gallery.recursiveOff'))}"
              aria-pressed="${recOn ? 'true' : 'false'}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </button>
      <button class="gv-folder-remove" data-id="${esc(folder.id)}" title="Remove">×</button>
    </div>`;
  }).join('');

  container.innerHTML = html;
}

function beginAliasEdit(id) {
  const folder = _managedFolders.find(f => f.id === id);
  const labelEl = document.querySelector(`.gv-folder-label[data-id="${CSS.escape(id)}"]`);
  if (!folder || !labelEl) return;

  const input = document.createElement('input');
  input.className = 'gv-folder-alias-input';
  input.value = folder.alias || tailLabel(folder.path);
  input.title = folder.path;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    folder.alias = input.value.trim();
    persistFolders();
    renderFolderList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { renderFolderList(); }
  });
  input.addEventListener('blur', commit);
}

function persistFolders() {
  window.api.setSettings({ managedFolders: _managedFolders }).catch(() => {});
}

/* ------------------------------------------------------------------ *
 *  Source-folder filter + per-folder recursion
 * ------------------------------------------------------------------ */
function setActiveFolder(id) {
  _activeFolderId = id;
  _path = [];                 // reset drill-down when switching roots
  renderFolderList();
  rebuildAndRender();
}

async function toggleFolderRecursive(id) {
  const folder = _managedFolders.find(f => f.id === id);
  if (!folder) return;
  folder.recursive = folder.recursive === false ? true : false;
  persistFolders();
  renderFolderList();
  const cache = window.store.get(GAL_CACHE, {}) || {};
  delete cache[folder.path];
  window.store.set(GAL_CACHE, cache);
  _allFiles = _allFiles.filter(f => !belongsTo(f.path, folder.path));
  rebuildAndRender();
  await loadAndScan(false);
}

/* ------------------------------------------------------------------ *
 *  Add / remove folders
 * ------------------------------------------------------------------ */
async function addFolders() {
  const paths = await window.api.pickFolders().catch(() => []);
  if (!paths || !paths.length) return;
  let added = false;
  for (const p of paths) {
    if (!_managedFolders.some(f => f.path === p)) {
      _managedFolders.push({ id: mkId(), path: p, recursive: true, alias: '' });
      added = true;
    }
  }
  if (!added) return;
  persistFolders();
  renderFolderList();
  await loadAndScan(false);
}

async function removeFolder(id) {
  const folder = _managedFolders.find(f => f.id === id);
  _managedFolders = _managedFolders.filter(f => f.id !== id);
  persistFolders();
  renderFolderList();
  if (folder) {
    const cache = window.store.get(GAL_CACHE, {}) || {};
    delete cache[folder.path];
    window.store.set(GAL_CACHE, cache);
    _allFiles = _allFiles.filter(f => !belongsTo(f.path, folder.path));
    if (_activeFolderId === id) _activeFolderId = null;
    _path = [];
    rebuildAndRender();
  }
}

/* ------------------------------------------------------------------ *
 *  Scanning with store-backed (gallery-private) cache
 * ------------------------------------------------------------------ */
async function loadAndScan(forceAll) {
  if (_managedFolders.length === 0) {
    _allFiles = [];
    setStatus('');
    rebuildAndRender();
    return;
  }

  const cache = window.store.get(GAL_CACHE, {}) || {};
  const toScan = [];
  const keep = [];

  for (const folder of _managedFolders) {
    const recursive = folder.recursive !== false;
    let stat = { exists: true, mtime: 0 };
    try { stat = await window.api.statDir(folder.path); } catch (_) {}
    const entry = cache[folder.path];
    if (!forceAll && entry && Array.isArray(entry.files) &&
        stat.exists && entry.dirMtime === stat.mtime && entry.recursive === recursive) {
      keep.push(...entry.files);
    } else {
      toScan.push({ path: folder.path, mtime: stat.mtime, recursive });
    }
  }

  _allFiles = dedupByPath(keep);
  rebuildAndRender();

  if (toScan.length === 0) {
    setStatus(t('gallery.filesFound', { n: _allFiles.length }));
    loadThumbnails();
    return;
  }

  await runScan(toScan);
}

async function runScan(toScan) {
  setStatus(t('gallery.scanning'));

  const groups = new Map();  // recursive(bool) → [toScan entry]
  for (const entry of toScan) {
    const key = entry.recursive !== false;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  try {
    for (const [recursive, group] of groups) {
      const paths = group.map(g => g.path);
      const mtimeByFolder = new Map(group.map(g => [g.path, g.mtime]));
      const collected = [];

      await new Promise((resolve) => {
        window.api.scanFolders(
          { folders: paths, recursive, extensions: SCAN_EXTS },
          (entry) => {
            if (entry.type === 'file') {
              collected.push(entry);
            } else if (entry.type === 'done') {
              _scanRequestId = null;
              const cache = window.store.get(GAL_CACHE, {}) || {};
              for (const g of group) {
                const bucket = collected.filter(f =>
                  belongsTo(f.path, g.path) && longestOwner(f.path, group) === g.path);
                cache[g.path] = {
                  files: bucket,
                  scannedAt: Date.now(),
                  dirMtime: mtimeByFolder.get(g.path),
                  recursive,
                };
              }
              window.store.set(GAL_CACHE, cache);
              _allFiles = _allFiles.filter(f => !group.some(g => belongsTo(f.path, g.path)));
              _allFiles.push(...collected);
              _allFiles = dedupByPath(_allFiles);
              setStatus(t('gallery.filesFound', { n: _allFiles.length }));
              rebuildAndRender();
              loadThumbnails();
              resolve();
            }
          }
        ).then(id => { _scanRequestId = id; }).catch(() => resolve());
      });
    }
  } catch (err) {
    console.error('Gallery scan error:', err);
    setStatus('Scan failed');
  }
}

function dedupByPath(files) {
  const seen = new Set();
  const out = [];
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    out.push(f);
  }
  return out;
}

function longestOwner(filePath, group) {
  let best = null, bestLen = -1;
  for (const g of group) {
    if (belongsTo(filePath, g.path) && g.path.length > bestLen) {
      best = g.path; bestLen = g.path.length;
    }
  }
  return best;
}

function setStatus(text) {
  const el = document.getElementById('gv-scan-status');
  if (el) el.textContent = text || '';
}

/* ------------------------------------------------------------------ *
 *  Thumbnails (cached in userData/thumbcache via main process)
 * ------------------------------------------------------------------ */
async function loadThumbnails() {
  const embFiles = _allFiles.filter(f => isEmb(f) && !f.preview && !f._thumbTried);
  if (embFiles.length === 0) return;
  const items = embFiles.map(f => ({ path: f.path, mtime: f.mtime }));
  const byPath = new Map(_allFiles.map(f => [f.path, f]));

  try {
    _thumbRequestId = await window.api.getThumbsCached(items, (entry) => {
      if (entry.type === 'thumb') {
        const f = byPath.get(entry.path);
        if (f) {
          f._thumbTried = true;
          f.preview = entry.preview || null;
          const m = entry.meta || {};
          f.stitches = m.stitch_count;
          f.colors = m.color_count;
          f.width = m.width_mm;
          f.height = m.height_mm;
          f.threads = m.threads || [];
        }
      } else if (entry.type === 'done') {
        _thumbRequestId = null;
        embFiles.forEach(f => { f._thumbTried = true; });
        rebuildAndRender();
        if (_selected) {
          const sel = byPath.get(_selected.path);
          if (sel) openDetail(sel);
        }
      }
    });
  } catch (err) {
    console.error('Gallery thumbnail error:', err);
  }
}

/* ------------------------------------------------------------------ *
 *  Folder-tree model
 * ------------------------------------------------------------------ */
function makeNode(name, path) {
  return { name, path, children: new Map(), files: [] };
}

/** Directory segments between a base folder and a file (excludes filename). */
function dirRelSegments(base, filePath) {
  const b = splitPath(base);
  const p = splitPath(filePath);
  const dirSegs = p.slice(0, -1);   // drop filename
  return dirSegs.slice(b.length);   // drop base prefix
}

/** Rebuild the tree from the flat file list, honoring the active-root filter. */
function buildTree() {
  const root = makeNode('', '__root__');
  const roots = _managedFolders.filter(mf => !_activeFolderId || mf.id === _activeFolderId);
  for (const mf of roots) {
    const files = _allFiles.filter(f => belongsTo(f.path, mf.path));
    // Motif-node name for the managed folder itself (alias > basename).
    const mfName = (mf.alias && mf.alias.trim()) ? mf.alias.trim() : (baseName(mf.path) || mf.path);
    for (const f of files) {
      const rel = dirRelSegments(mf.path, f.path);
      // A file lying directly inside the managed folder means the managed
      // folder IS the motif: attach it to a node named after the folder
      // instead of dumping loose files into the synthetic root.
      if (rel.length === 0) {
        if (!root.children.has(mf.path)) root.children.set(mf.path, makeNode(mfName, mf.path));
        root.children.get(mf.path).files.push(f);
        continue;
      }
      let cur = root;
      let curPath = mf.path;
      for (const seg of rel) {
        curPath = curPath + SEP + seg;
        if (!cur.children.has(curPath)) cur.children.set(curPath, makeNode(seg, curPath));
        cur = cur.children.get(curPath);
      }
      cur.files.push(f);
    }
  }
  _root = root;
}

/** The node currently being viewed (root when breadcrumb empty). */
function currentNode() {
  return _path.length ? _path[_path.length - 1] : _root;
}

/** Re-resolve breadcrumb nodes against a freshly built tree (paths persist). */
function reResolvePath() {
  const newPath = [];
  let cur = _root;
  for (const old of _path) {
    const next = cur && cur.children.get(old.path);
    if (!next) break;
    newPath.push(next);
    cur = next;
  }
  _path = newPath;
}

/** Walk a subtree, collecting embroidery files (recursive). */
function collectEmb(node, out) {
  out = out || [];
  node.files.forEach(f => { if (isEmb(f)) out.push(f); });
  node.children.forEach(ch => collectEmb(ch, out));
  return out;
}
function collectDocs(node, out) {
  out = out || [];
  node.files.forEach(f => { if (isDoc(f)) out.push(f); });
  node.children.forEach(ch => collectDocs(ch, out));
  return out;
}
/** First embroidery file with a rendered preview in a subtree (for the card). */
function firstPreviewFile(node) {
  const all = collectEmb(node);
  return all.find(f => f.preview) || all[0] || null;
}
/** Distinct embroidery format extensions in a subtree. */
function formatSet(node) {
  const s = new Set();
  collectEmb(node).forEach(f => s.add(extOf(f)));
  return [...s].sort();
}

function findNodeByPath(path) {
  // BFS from root
  if (!_root) return null;
  const stack = [_root];
  while (stack.length) {
    const n = stack.pop();
    if (n.path === path) return n;
    n.children.forEach(ch => stack.push(ch));
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Render orchestration
 * ------------------------------------------------------------------ */
function rebuildAndRender() {
  buildTree();
  reResolvePath();
  renderBreadcrumb();
  renderGrid();
  updateBars();
}

function renderBreadcrumb() {
  const el = document.getElementById('gv-breadcrumb');
  if (!el) return;
  const crumbs = [`<span class="gv-crumb${_path.length === 0 ? ' current' : ''}" data-idx="-1">${esc(t('gallery.library'))}</span>`];
  _path.forEach((node, i) => {
    crumbs.push('<span class="gv-crumb-sep">›</span>');
    const cur = i === _path.length - 1 ? ' current' : '';
    crumbs.push(`<span class="gv-crumb${cur}" data-idx="${i}">${esc(node.name)}</span>`);
  });
  el.innerHTML = crumbs.join(' ');
}

/** Compare helper honoring the sort selector. */
function sortNodes(list, nameGet, sizeGet) {
  const dir = _sortMode.endsWith('desc') ? -1 : 1;
  const byName = _sortMode.startsWith('name');
  list.sort((a, b) => byName
    ? dir * String(nameGet(a)).localeCompare(String(nameGet(b)))
    : dir * ((sizeGet(a) || 0) - (sizeGet(b) || 0)));
  return list;
}

function renderGrid() {
  const grid = document.getElementById('gv-grid');
  if (!grid) return;

  if (_managedFolders.length === 0) {
    grid.innerHTML = `<div class="gv-empty-grid">${esc(t('gallery.noFolders'))}</div>`;
    return;
  }

  // Search mode: flat list of matching motif folders across the whole library.
  if (_searchQuery) {
    renderSearchResults(grid);
    return;
  }

  const node = currentNode();
  if (!node) { grid.innerHTML = `<div class="gv-empty-grid">${esc(t('gallery.noFiles'))}</div>`; return; }

  const subfolders = sortNodes([...node.children.values()], n => n.name, n => collectEmb(n).length);
  const looseEmb = node.files.filter(isEmb);
  const docs     = node.files.filter(isDoc);

  // Group loose embroidery files by stem → format variants.
  const variantMap = new Map();
  looseEmb.forEach(f => {
    const k = stemOf(f);
    if (!variantMap.has(k)) variantMap.set(k, []);
    variantMap.get(k).push(f);
  });
  const variants = sortNodes([...variantMap.entries()].map(([stem, files]) => ({ stem, files })),
    v => v.stem, v => v.files.reduce((m, f) => m + (f.size || 0), 0));

  if (subfolders.length === 0 && variants.length === 0 && docs.length === 0) {
    grid.innerHTML = `<div class="gv-empty-grid">${esc(t('gallery.emptyFolder'))}</div>`;
    return;
  }

  const parts = [];

  if (subfolders.length) {
    parts.push(`<div class="gv-section-label">${esc(t('gallery.folders'))}</div>`);
    subfolders.forEach(n => parts.push(folderCardHTML(n)));
  }
  if (variants.length) {
    parts.push(`<div class="gv-section-label">${esc(t('gallery.designs'))}</div>`);
    variants.forEach(v => parts.push(variantCardHTML(v)));
  }
  if (docs.length) {
    parts.push(`<div class="gv-section-label">${esc(t('gallery.documents'))}</div>`);
    docs.forEach(d => parts.push(docCardHTML(d)));
  }
  grid.innerHTML = parts.join('');
}

function renderSearchResults(grid) {
  const q = _searchQuery.toLowerCase();
  // Gather all motif-level folders (immediate children of roots) + deeper folders.
  const matches = [];
  const seen = new Set();
  const visit = (node) => {
    node.children.forEach(ch => {
      const tags = (_tags[ch.path] && _tags[ch.path].tags) || [];
      const cat  = (_tags[ch.path] && _tags[ch.path].category) || '';
      const hay = (ch.name + ' ' + tags.join(' ') + ' ' + cat).toLowerCase();
      if (hay.includes(q) && !seen.has(ch.path)) { seen.add(ch.path); matches.push(ch); }
      visit(ch);
    });
  };
  if (_root) visit(_root);

  if (!matches.length) {
    grid.innerHTML = `<div class="gv-empty-grid">${esc(t('gallery.noMatches'))}</div>`;
    return;
  }
  sortNodes(matches, n => n.name, n => collectEmb(n).length);
  const parts = [`<div class="gv-section-label">${esc(t('gallery.searchResults'))} (${matches.length})</div>`];
  matches.forEach(n => parts.push(folderCardHTML(n)));
  grid.innerHTML = parts.join('');
}

/* ── Card builders ── */
function folderCardHTML(node) {
  const marked = _markedFolders.has(node.path);
  const pv = firstPreviewFile(node);
  const preview = (pv && pv.preview) ? renderPreview(pv.preview)
    : `<span class="gv-folder-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>`;
  const fmts = formatSet(node);
  const embCount = collectEmb(node).length;
  const hasDocs = collectDocs(node).length > 0;
  const tags = (_tags[node.path] && _tags[node.path].tags) || [];

  const chips = fmts.slice(0, 6).map(e => `<span class="gv-badge">${esc(e)}</span>`).join('')
    + tags.slice(0, 3).map(tg => `<span class="gv-tag-chip">${esc(tg)}</span>`).join('');

  return `
    <div class="gv-card gv-folder-card" data-folder="${esc(node.path)}">
      <input type="checkbox" class="gv-card-check gv-folder-check" data-folder="${esc(node.path)}" ${marked ? 'checked' : ''} title="${esc(t('gallery.markMotif'))}"/>
      ${hasDocs ? `<span class="gv-card-badge-doc" title="${esc(t('gallery.hasDocs'))}">📄</span>` : ''}
      <div class="gv-thumb">${preview}</div>
      <div class="gv-card-name" title="${esc(node.name)}">${esc(node.name)}</div>
      <div class="gv-card-sub">${esc(t('gallery.designCount', { n: embCount }))}</div>
      <div class="gv-card-chips">${chips}</div>
    </div>`;
}

function variantCardHTML(v) {
  const pv = v.files.find(f => f.preview) || v.files[0];
  const preview = (pv && pv.preview) ? renderPreview(pv.preview)
    : `<span class="gv-thumb-ph">${esc(t('preview.none'))}</span>`;
  const actions = v.files.map(f => {
    const sel = _selStitch.has(f.path) ? ' sel' : '';
    return `<button class="gv-mini-btn gv-fmt-btn${sel}" data-path="${esc(f.path)}" title="${esc(t('gallery.toggleTransfer'))}">${esc(extOf(f).toUpperCase())}</button>`;
  }).join('');
  const stitches = (pv && pv.stitches != null) ? Number(pv.stitches).toLocaleString() : '';

  return `
    <div class="gv-card gv-variant-card" data-path="${esc(pv ? pv.path : '')}">
      <div class="gv-thumb">${preview}</div>
      <div class="gv-card-name" title="${esc(v.stem)}">${esc(v.stem)}</div>
      ${stitches ? `<div class="gv-card-sub">${esc(stitches)} ${esc(t('gallery.detail.stitches'))}</div>` : ''}
      <div class="gv-card-actions">${actions}</div>
    </div>`;
}

function docCardHTML(d) {
  const icon = extOf(d) === 'pdf' ? '📕' : '📘';
  return `
    <div class="gv-card gv-doc-card-item" data-doc="${esc(d.path)}">
      <div class="gv-thumb"><span style="font-size:44px">${icon}</span></div>
      <div class="gv-card-name" title="${esc(d.name)}">${esc(d.name)}</div>
      <div class="gv-card-actions">
        <button class="gv-mini-btn gv-doc-open" data-doc="${esc(d.path)}">${esc(t('gallery.preview'))}</button>
      </div>
    </div>`;
}

function renderPreview(preview) {
  if (!preview || !Array.isArray(preview.lines) || preview.lines.length === 0) {
    return `<span class="gv-thumb-ph">${esc(t('preview.none'))}</span>`;
  }
  const left = preview.left || 0, top = preview.top || 0;
  const width = preview.width || 1, height = preview.height || 1;
  const viewBox = `${left} ${top} ${width} ${height}`;
  const strokeW = Math.max(Math.max(width, height) / 120, 0.4);
  const paths = preview.lines.map(line => {
    const pts = line.pts || [];
    if (pts.length < 2) return '';
    const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ');
    return `<path d="${d}" stroke="${esc(line.hex || '#888')}" fill="none" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/* ------------------------------------------------------------------ *
 *  Action bars (marked folders → Collection/AI ; stitch → Transfer)
 * ------------------------------------------------------------------ */
function updateBars() {
  const mBar = document.getElementById('gv-marked-bar');
  const mCount = document.getElementById('gv-marked-count');
  if (mBar && mCount) {
    if (_markedFolders.size > 0) {
      mBar.classList.add('show');
      mCount.textContent = t('gallery.markedMotifs', { n: _markedFolders.size });
    } else {
      mBar.classList.remove('show');
    }
  }
  const tBar = document.getElementById('gv-transfer-bar');
  const tCount = document.getElementById('gv-transfer-count');
  if (tBar && tCount) {
    if (_selStitch.size > 0) {
      tBar.classList.add('show');
      tCount.textContent = t('gallery.selectedFiles', { n: _selStitch.size });
    } else {
      tBar.classList.remove('show');
    }
  }
}

function toggleFolderMark(path, on) {
  if (on) _markedFolders.add(path); else _markedFolders.delete(path);
  updateBars();
}
function toggleStitch(path) {
  if (_selStitch.has(path)) _selStitch.delete(path); else _selStitch.add(path);
  // refresh just the button states cheaply
  document.querySelectorAll(`.gv-fmt-btn[data-path="${CSS.escape(path)}"]`)
    .forEach(b => b.classList.toggle('sel', _selStitch.has(path)));
  updateBars();
}

/** Build collection hand-off items: motif ENTRY LEVEL only (folder reference). */
function sendMarkedToCollection() {
  if (_markedFolders.size === 0) return;
  const items = [];
  _markedFolders.forEach(path => {
    const node = findNodeByPath(path);
    if (!node) return;
    const embFiles = collectEmb(node).map(f => ({
      path: f.path, name: baseName(f.name || f.path), ext: extOf(f), mtime: f.mtime, size: f.size,
    }));
    const docFiles = collectDocs(node).map(f => ({
      path: f.path, name: baseName(f.name || f.path), ext: extOf(f), mtime: f.mtime, size: f.size,
    }));
    const meta = _tags[path] || {};
    items.push({
      kind: 'motif',
      path,                          // entry level = the motif folder
      name: node.name,
      ext: 'motif',
      files: embFiles,               // contained stitch files (for "open")
      docs: docFiles,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      category: meta.category || '',
    });
  });
  if (!items.length) return;
  window.store.set('collectionsQueue', items);
  window.events && window.events.emit('gallery:send-to-collections', { files: items });
  window.router && window.router.load('collections');
}

function sendSelectedToTransfer() {
  if (_selStitch.size === 0) return;
  const byPath = new Map(_allFiles.map(f => [f.path, f]));
  const items = [..._selStitch].map(p => {
    const f = byPath.get(p) || {};
    return { path: p, name: baseName(f.name || p), ext: extOf(f || { path: p }), mtime: f.mtime, size: f.size };
  });
  window.store.set('transferQueue', items);
  window.router && window.router.load('transfer');
}

/* ------------------------------------------------------------------ *
 *  Detail modal (single stitch file)
 * ------------------------------------------------------------------ */
function openDetail(file) {
  _selected = file;
  const modal = document.getElementById('gv-modal');
  const card = document.getElementById('gv-modal-card');
  if (!modal || !card) return;

  const preview = file.preview ? renderPreview(file.preview) : `<span class="gv-thumb-ph">${esc(t('preview.none'))}</span>`;
  const dims = (file.width && file.height) ? `${file.width} × ${file.height} mm` : '—';
  const modified = file.mtime ? new Date(file.mtime).toLocaleString() : '—';

  const palette = (file.threads && file.threads.length)
    ? `<div class="gv-palette">` + file.threads.map(th => {
        const hex = th.hex || '#888';
        return `<span class="gv-swatch"><span class="gv-swatch-dot" style="background:${esc(hex)}"></span>${esc(hex)}</span>`;
      }).join('') + `</div>`
    : '';

  card.innerHTML = `
    <div class="gv-modal-head">
      <h3 class="gv-modal-title">${esc(baseName(file.name || file.path))}</h3>
      <button class="gv-modal-close" data-action="close" title="${esc(t('gallery.detail.close'))}">×</button>
    </div>
    <div class="gv-modal-body">
      <div class="gv-modal-preview">${preview}</div>
      <div>
        <table class="gv-meta-table">
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.stitches'))}</td><td class="gv-meta-val">${file.stitches != null ? Number(file.stitches).toLocaleString() : '—'}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.colors'))}</td><td class="gv-meta-val">${file.colors != null ? file.colors : '—'}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.dimensions'))}</td><td class="gv-meta-val">${esc(dims)}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.format'))}</td><td class="gv-meta-val">${esc(extOf(file).toUpperCase())}</td></tr>
          <tr><td class="gv-meta-key">Size</td><td class="gv-meta-val">${formatSize(file.size || 0)}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.path'))}</td><td class="gv-meta-val">${esc(file.path)}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.modified'))}</td><td class="gv-meta-val">${esc(modified)}</td></tr>
        </table>
        ${palette}
      </div>
      <div class="gv-modal-actions">
        <button class="gv-modal-btn" data-action="convert">${esc(t('gallery.detail.convert'))}</button>
        <button class="gv-modal-btn secondary" data-action="simulator">${esc(t('gallery.detail.simulator'))}</button>
        <button class="gv-modal-btn secondary" data-action="transfer">${esc(t('gallery.sendToTransfer'))}</button>
        <button class="gv-modal-btn secondary" data-action="close">${esc(t('gallery.detail.close'))}</button>
      </div>
    </div>
  `;
  modal.hidden = false;
}

function closeDetail() {
  const modal = document.getElementById('gv-modal');
  if (modal) modal.hidden = true;
  _selected = null;
}

/* ------------------------------------------------------------------ *
 *  Document preview modal
 * ------------------------------------------------------------------ */
function openDocModal(path) {
  const modal = document.getElementById('gv-doc-modal');
  const card = document.getElementById('gv-doc-card');
  if (!modal || !card) return;
  const name = baseName(path);
  const ext = (path.split('.').pop() || '').toLowerCase();
  const fileUrl = 'file://' + (SEP === '\\' ? '/' + path.replace(/\\/g, '/') : path);

  const body = (ext === 'pdf')
    ? `<iframe src="${esc(fileUrl)}" title="${esc(name)}"></iframe>`
    : `<div class="gv-doc-fallback">${esc(t('gallery.docNoInline'))}</div>`;

  card.innerHTML = `
    <div class="gv-doc-head">
      <span class="gv-doc-title">${esc(name)}</span>
      <div style="display:flex;gap:8px">
        <button class="gv-modal-btn secondary" data-doc-action="open">${esc(t('gallery.openExternal'))}</button>
        <button class="gv-modal-close" data-doc-action="close">×</button>
      </div>
    </div>
    <div class="gv-doc-body">${body}</div>
  `;
  card._docPath = path;
  modal.hidden = false;
}

function closeDocModal() {
  const modal = document.getElementById('gv-doc-modal');
  if (modal) modal.hidden = true;
}

/* ------------------------------------------------------------------ *
 *  AI classification (tag marked motifs)
 * ------------------------------------------------------------------ */
function rasterize(preview, size) {
  if (!preview || !Array.isArray(preview.lines) || !preview.lines.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const left = preview.left || 0, top = preview.top || 0;
  const w = preview.width || 1, h = preview.height || 1;
  const pad = size * 0.08;
  const scale = Math.min((size - 2 * pad) / w, (size - 2 * pad) / h);
  const offX = (size - w * scale) / 2 - left * scale;
  const offY = (size - h * scale) / 2 - top * scale;
  ctx.lineWidth = Math.max(size / 200, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  preview.lines.forEach(line => {
    const pts = line.pts || [];
    if (pts.length < 2) return;
    ctx.strokeStyle = line.hex || '#333';
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const x = pt[0] * scale + offX, y = pt[1] * scale + offY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  return canvas.toDataURL('image/png');
}

async function classifyMarked() {
  if (_markedFolders.size === 0) return;
  const btn = document.getElementById('gv-ai-classify');

  // Ensure previews exist; if not, kick a thumbnail load and bail with a hint.
  const items = [];
  const needThumbs = [];
  _markedFolders.forEach(path => {
    const node = findNodeByPath(path);
    if (!node) return;
    const pv = firstPreviewFile(node);
    if (pv && pv.preview) {
      const img = rasterize(pv.preview, 256);
      if (img) items.push({ id: path, image: img });
    } else if (pv) {
      needThumbs.push(pv);
    }
  });

  if (!items.length) {
    if (needThumbs.length) { loadThumbnails(); alert(t('gallery.aiNoPreviewYet')); }
    else alert(t('gallery.aiNoPreview'));
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '✨ ' + t('gallery.aiClassifying'); }
  try {
    const r = await window.api.aiClassify({ items, autoTag: true });
    if (!r || !r.ok) throw new Error(r && r.error ? r.error : 'unknown');
    (r.results || []).forEach(res => {
      if (!res || !res.id) return;
      _tags[res.id] = { category: res.category || '', tags: Array.isArray(res.tags) ? res.tags : [] };
    });
    await persistTags();
    rebuildAndRender();
    alert(t('gallery.aiDone', { n: (r.results || []).length }));
  } catch (err) {
    console.error('Gallery AI classify error:', err);
    alert(t('gallery.aiFailed') + ': ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ ' + t('gallery.aiClassify'); }
  }
}

async function persistTags() {
  window.store && window.store.set('galleryTags', _tags);
  try { await window.api.setSettings({ galleryTags: _tags }); } catch (_) {}
}

/* ------------------------------------------------------------------ *
 *  Event wiring
 * ------------------------------------------------------------------ */
function wireEvents() {
  const sig = _abortCtrl.signal;

  document.getElementById('gv-add-folder-btn')?.addEventListener('click', addFolders, { signal: sig });
  document.getElementById('gv-refresh-btn')?.addEventListener('click', () => loadAndScan(true), { signal: sig });

  // Folder sidebar (delegated)
  const folderList = document.getElementById('gv-folder-list');
  folderList?.addEventListener('click', (e) => {
    const rm = e.target.closest('.gv-folder-remove');
    if (rm) { e.stopPropagation(); removeFolder(rm.dataset.id); return; }
    const rec = e.target.closest('.gv-folder-rec');
    if (rec) { e.stopPropagation(); toggleFolderRecursive(rec.dataset.id); return; }
    const item = e.target.closest('.gv-folder-item');
    if (!item) return;
    setActiveFolder(item.dataset.id === '__all__' ? null : item.dataset.id);
  }, { signal: sig });
  folderList?.addEventListener('dblclick', (e) => {
    const label = e.target.closest('.gv-folder-label');
    if (label) beginAliasEdit(label.dataset.id);
  }, { signal: sig });

  document.getElementById('gv-search')
    ?.addEventListener('input', (e) => { _searchQuery = e.target.value.trim(); renderGrid(); }, { signal: sig });
  document.getElementById('gv-sort-select')
    ?.addEventListener('change', (e) => { _sortMode = e.target.value; renderGrid(); }, { signal: sig });

  // Breadcrumb navigation
  document.getElementById('gv-breadcrumb')?.addEventListener('click', (e) => {
    const c = e.target.closest('.gv-crumb');
    if (!c) return;
    const idx = parseInt(c.dataset.idx, 10);
    _path = idx < 0 ? [] : _path.slice(0, idx + 1);
    renderBreadcrumb(); renderGrid();
  }, { signal: sig });

  // Action bars
  document.getElementById('gv-deselect-all')?.addEventListener('click', () => {
    _markedFolders.clear(); rebuildAndRender();
  }, { signal: sig });
  document.getElementById('gv-transfer-deselect')?.addEventListener('click', () => {
    _selStitch.clear(); rebuildAndRender();
  }, { signal: sig });
  document.getElementById('gv-send-collection')?.addEventListener('click', sendMarkedToCollection, { signal: sig });
  document.getElementById('gv-send-transfer')?.addEventListener('click', sendSelectedToTransfer, { signal: sig });
  document.getElementById('gv-ai-classify')?.addEventListener('click', classifyMarked, { signal: sig });

  // Grid interactions (delegated)
  const grid = document.getElementById('gv-grid');
  grid?.addEventListener('change', (e) => {
    const cb = e.target.closest('.gv-folder-check');
    if (cb) { toggleFolderMark(cb.dataset.folder, cb.checked); e.stopPropagation(); }
  }, { signal: sig });
  grid?.addEventListener('click', (e) => {
    // Format button → toggle transfer selection
    const fmt = e.target.closest('.gv-fmt-btn');
    if (fmt) { e.stopPropagation(); toggleStitch(fmt.dataset.path); return; }
    // Document open
    const docBtn = e.target.closest('.gv-doc-open');
    if (docBtn) { e.stopPropagation(); openDocModal(docBtn.dataset.doc); return; }
    // Folder checkbox handled by change
    if (e.target.closest('.gv-folder-check')) return;
    // Folder card → drill in
    const folderCard = e.target.closest('.gv-folder-card');
    if (folderCard) {
      const node = findNodeByPath(folderCard.dataset.folder);
      if (node) { _path.push(node); _searchQuery = ''; const s = document.getElementById('gv-search'); if (s) s.value = ''; renderBreadcrumb(); renderGrid(); }
      return;
    }
    // Variant card → open detail of representative file
    const variantCard = e.target.closest('.gv-variant-card');
    if (variantCard) {
      const f = _allFiles.find(x => x.path === variantCard.dataset.path);
      if (f) openDetail(f);
      return;
    }
  }, { signal: sig });

  // Detail modal
  document.getElementById('gv-modal-backdrop')?.addEventListener('click', closeDetail, { signal: sig });
  document.getElementById('gv-modal-card')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !_selected) return;
    const action = btn.dataset.action;
    if (action === 'close') { closeDetail(); }
    else if (action === 'convert') {
      window.store.set('filesQueue', [_selected.path]); closeDetail(); window.router && window.router.load('files');
    } else if (action === 'simulator') {
      window.store.set('simulatorQueue', _selected.path); closeDetail(); window.router && window.router.load('simulator');
    } else if (action === 'transfer') {
      const f = _selected;
      window.store.set('transferQueue', [{ path: f.path, name: baseName(f.name || f.path), ext: extOf(f), mtime: f.mtime, size: f.size }]);
      closeDetail(); window.router && window.router.load('transfer');
    }
  }, { signal: sig });

  // Document modal
  document.getElementById('gv-doc-backdrop')?.addEventListener('click', closeDocModal, { signal: sig });
  document.getElementById('gv-doc-card')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-doc-action]');
    if (!btn) return;
    const card = document.getElementById('gv-doc-card');
    if (btn.dataset.docAction === 'close') closeDocModal();
    else if (btn.dataset.docAction === 'open' && card && card._docPath) {
      window.api.openPath(card._docPath).catch(() => {});
    }
  }, { signal: sig });
}

/* ------------------------------------------------------------------ *
 *  Register with shell router
 * ------------------------------------------------------------------ */
window.registerView('gallery', { mount, unmount });
})();
