(function () {
'use strict';
/**
 * Gallery View — Browse embroidery files with thumbnail grid / list
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Features:
 *  - Managed folders (shared with Batch via settings.managedFolders)
 *  - Scan caching in the shared store (skip unchanged folders)
 *  - Manual Refresh button forces a full re-scan
 *  - Path display: last 2 segments + tooltip + double-click alias editing
 *  - Suffix filter chips (dynamic + "All")
 *  - Batch markers (checkbox per item + "Send to Batch →")
 *  - Card / List view toggle
 *  - Detail modal (large preview, metadata, thread palette, actions)
 *
 * ID prefix: gv-
 */

/* ------------------------------------------------------------------ *
 *  Module-level state (reset on each mount)
 * ------------------------------------------------------------------ */
let _abortCtrl      = null;
let _scanRequestId  = null;
let _thumbRequestId = null;

let _managedFolders = [];        // { id, path, recursive, alias }[]
let _allFiles       = [];        // FileEntry[]
let _filtered       = [];        // FileEntry[] after filter/search/sort
let _selected       = null;      // FileEntry currently shown in detail modal
let _marked         = new Set(); // marked file paths (for Send to Batch)

let _activeExtFilter = null;     // null = All
let _searchQuery     = '';
let _sortMode        = 'name-asc';
let _viewMode        = 'card';   // 'card' | 'list'

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
function splitPath(p) {
  return String(p || '').split(/[\\/]+/).filter(Boolean);
}
/** Last two path segments joined by the OS separator. */
function tailLabel(p) {
  const parts = splitPath(p);
  return parts.slice(-2).join(SEP) || p;
}
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
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  renderFolderList();
  wireEvents();
  updateToolbar();

  await loadAndScan(false);
}

function unmount() {
  if (_scanRequestId)  { window.api.cancelStream(_scanRequestId);  _scanRequestId = null; }
  if (_thumbRequestId) { window.api.cancelStream(_thumbRequestId); _thumbRequestId = null; }
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
  closeDetail();
  removeCSS();
  _managedFolders = [];
  _allFiles = [];
  _filtered = [];
  _selected = null;
  _marked = new Set();
}

/** Normalise persisted folder entries to a common schema. */
function normalizeFolders(saved) {
  return (saved || []).map(f =>
    typeof f === 'string'
      ? { id: mkId(), path: f, recursive: true, alias: '' }
      : { id: f.id || mkId(), path: f.path, recursive: f.recursive !== false, alias: f.alias || '' }
  ).filter(f => f.path);
}
function mkId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

/* ------------------------------------------------------------------ *
 *  HTML template
 * ------------------------------------------------------------------ */
function buildHTML() {
  return `
<div class="gv-root">
  <!-- Left: Folders -->
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

  <!-- Center: Grid -->
  <main class="gv-grid-panel">
    <div class="gv-toolbar">
      <input type="text" id="gv-search" class="gv-search" placeholder="${esc(t('gallery.search'))}" />
      <div class="gv-sort">
        <select id="gv-sort-select">
          <option value="name-asc">${esc(t('gallery.sortName'))}</option>
          <option value="name-desc">${esc(t('gallery.sortNameDesc'))}</option>
          <option value="size-asc">${esc(t('gallery.sortSize'))}</option>
          <option value="size-desc">${esc(t('gallery.sortSizeDesc'))}</option>
          <option value="stitches-asc">${esc(t('gallery.sortStitches'))}</option>
          <option value="stitches-desc">${esc(t('gallery.sortStitchesDesc'))}</option>
        </select>
      </div>
      <div class="gv-view-toggle">
        <button id="gv-view-card" class="gv-view-btn active" title="${esc(t('gallery.viewCard'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </button>
        <button id="gv-view-list" class="gv-view-btn" title="${esc(t('gallery.viewList'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="gv-filter-row">
      <div class="gv-filters" id="gv-filter-chips"></div>
    </div>
    <div class="gv-marked-bar" id="gv-marked-bar">
      <span id="gv-marked-count" class="gv-marked-count"></span>
      <button id="gv-send-collection" class="gv-send-batch gv-send-collection">${esc(t('gallery.sendToCollection'))}</button>
      <button id="gv-send-batch" class="gv-send-batch">${esc(t('gallery.sendToBatch'))} →</button>
    </div>
    <div id="gv-scan-status" class="gv-scan-status"></div>
    <div id="gv-grid" class="gv-grid"></div>
  </main>
</div>

<!-- Detail modal -->
<div id="gv-modal" class="gv-modal" hidden>
  <div class="gv-modal-backdrop" id="gv-modal-backdrop"></div>
  <div class="gv-modal-card" id="gv-modal-card"></div>
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
  height: 100%;
  background: var(--surface, #f4f6fb);
  color: var(--text, #1c2333);
  font-size: 13px;
}

/* ── Folders panel ── */
.gv-folders-panel {
  display: flex; flex-direction: column;
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
.gv-empty-folders {
  padding: 28px 14px; text-align: center; color: var(--muted, #6b7385);
  font-size: 12px; line-height: 1.6;
}

/* ── Grid panel ── */
.gv-grid-panel { display: flex; flex-direction: column; min-width: 0; }
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
.gv-view-toggle { display: flex; gap: 2px; }
.gv-view-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: 1px solid var(--border, #e3e7ef);
  background: var(--input-bg, #fff); color: var(--muted, #6b7385);
  cursor: pointer; border-radius: 6px; transition: all .15s;
}
.gv-view-btn svg { width: 16px; height: 16px; }
.gv-view-btn:hover { border-color: var(--accent, #5b5bd6); color: var(--text, #1c2333); }
.gv-view-btn.active { background: var(--accent, #5b5bd6); border-color: var(--accent, #5b5bd6); color: #fff; }

.gv-filter-row {
  padding: 8px 14px; background: var(--panel-bg, #fff);
  border-bottom: 1px solid var(--border, #e3e7ef);
}
.gv-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.gv-filter-chip {
  padding: 3px 11px; border-radius: 12px; font-size: 11px; font-family: monospace;
  background: var(--chip-bg, #f0f2f9); border: 1px solid var(--border, #e3e7ef);
  color: var(--muted, #6b7385); cursor: pointer; user-select: none;
  transition: all .12s;
}
.gv-filter-chip:hover { border-color: var(--accent, #5b5bd6); color: var(--accent, #5b5bd6); }
.gv-filter-chip.active {
  background: var(--accent, #5b5bd6); border-color: var(--accent, #5b5bd6); color: #fff;
}

.gv-marked-bar {
  display: none; align-items: center; gap: 12px;
  padding: 8px 14px; background: var(--accent-subtle, #eef1fd);
  border-bottom: 1px solid var(--border, #e3e7ef);
}
.gv-marked-bar.show { display: flex; }
.gv-marked-count { font-size: 12px; color: var(--text, #1c2333); font-weight: 600; }
.gv-send-batch {
  margin-left: auto; padding: 6px 14px; border: none; border-radius: 7px;
  background: var(--accent, #5b5bd6); color: #fff; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: background .15s;
}
.gv-send-batch:hover { background: var(--accent-hover, #4a4ac4); }

.gv-scan-status {
  padding: 6px 14px; font-size: 12px; color: var(--muted, #6b7385);
  background: var(--panel-bg, #fff); border-bottom: 1px solid var(--border, #e3e7ef);
  min-height: 0;
}
.gv-scan-status:empty { display: none; }

/* ── Card grid ── */
.gv-grid { flex: 1; overflow-y: auto; padding: 16px; background: var(--surface, #f4f6fb); }
.gv-grid.card {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px; align-content: start;
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
.gv-thumb {
  width: 110px; height: 110px; background: var(--surface, #f4f6fb);
  border: 1px solid var(--border, #e3e7ef); border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 8px; overflow: hidden;
}
.gv-thumb svg { width: 100%; height: 100%; }
.gv-thumb-ph { color: var(--muted, #98a0b3); font-size: 10px; }
.gv-card-name {
  width: 100%; text-align: center; font-size: 11.5px; color: var(--text, #1c2333);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gv-card-meta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.gv-badge {
  font-size: 9px; font-family: monospace; text-transform: uppercase;
  background: var(--accent-subtle, #eef1fd); color: var(--accent, #5b5bd6);
  padding: 1px 6px; border-radius: 8px; font-weight: 700;
}
.gv-card-stitches { font-size: 10px; color: var(--muted, #6b7385); }

/* ── List view ── */
.gv-grid.list { display: block; padding: 0; }
.gv-list-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.gv-list-table thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--panel-header-bg, #f9fafd); color: var(--muted, #6b7385);
  text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase;
  letter-spacing: .03em; padding: 8px 10px; border-bottom: 1px solid var(--border, #e3e7ef);
}
.gv-list-table tbody tr {
  border-bottom: 1px solid var(--row-border, #f0f2f8); cursor: pointer;
}
.gv-list-table tbody tr:hover { background: var(--row-hover, #f7f9fd); }
.gv-list-table td { padding: 5px 10px; color: var(--text, #1c2333); vertical-align: middle; }
.gv-list-thumb {
  width: 32px; height: 32px; border: 1px solid var(--border, #e3e7ef);
  border-radius: 5px; background: var(--surface, #f4f6fb); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.gv-list-thumb svg { width: 100%; height: 100%; }
.gv-col-num { text-align: right; color: var(--muted, #6b7385); font-variant-numeric: tabular-nums; }
.gv-list-name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
.gv-modal-actions { display: flex; gap: 8px; margin-top: 20px; grid-column: 1 / -1; }
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

  container.innerHTML = _managedFolders.map(folder => `
    <div class="gv-folder-item" data-id="${esc(folder.id)}">
      <svg class="gv-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="gv-folder-label" data-id="${esc(folder.id)}"
            title="${esc(folder.path)}">${esc(folderLabel(folder))}</span>
      <button class="gv-folder-remove" data-id="${esc(folder.id)}" title="Remove">×</button>
    </div>
  `).join('');
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
  await loadAndScan(false); // will scan the newly-added folders (cache miss)
}

async function removeFolder(id) {
  const folder = _managedFolders.find(f => f.id === id);
  _managedFolders = _managedFolders.filter(f => f.id !== id);
  persistFolders();
  renderFolderList();
  if (folder) {
    // Drop from scan cache + in-memory files
    const cache = window.store.get('scanCache', {}) || {};
    delete cache[folder.path];
    window.store.set('scanCache', cache);
    _allFiles = _allFiles.filter(f => !belongsTo(f.path, folder.path));
    applyFilters();
  }
}

/* ------------------------------------------------------------------ *
 *  Scanning with store-backed cache
 * ------------------------------------------------------------------ */
async function loadAndScan(forceAll) {
  if (_managedFolders.length === 0) {
    _allFiles = [];
    setStatus('');
    applyFilters();
    return;
  }

  const cache = window.store.get('scanCache', {}) || {};
  const toScan = [];
  const keep = [];

  for (const folder of _managedFolders) {
    let stat = { exists: true, mtime: 0 };
    try { stat = await window.api.statDir(folder.path); } catch (_) {}
    const entry = cache[folder.path];
    if (!forceAll && entry && Array.isArray(entry.files) &&
        stat.exists && entry.dirMtime === stat.mtime) {
      keep.push(...entry.files);        // cache hit — folder unchanged
    } else {
      toScan.push({ path: folder.path, mtime: stat.mtime });
    }
  }

  _allFiles = keep.slice();
  applyFilters(); // render cached results immediately

  if (toScan.length === 0) {
    setStatus(t('gallery.filesFound', { n: _allFiles.length }));
    loadThumbnails();
    return;
  }

  await runScan(toScan);
}

async function runScan(toScan) {
  const paths = toScan.map(t => t.path);
  const mtimeByFolder = new Map(toScan.map(t => [t.path, t.mtime]));
  const collected = [];

  setStatus(t('gallery.scanning'));

  try {
    _scanRequestId = await window.api.scanFolders(
      { folders: paths, recursive: true },
      (entry) => {
        if (entry.type === 'file') {
          collected.push(entry);
        } else if (entry.type === 'done') {
          _scanRequestId = null;
          // Bucket collected files per scanned folder → update cache
          const cache = window.store.get('scanCache', {}) || {};
          for (const t of toScan) {
            const bucket = collected.filter(f => belongsTo(f.path, t.path));
            cache[t.path] = {
              files: bucket,
              scannedAt: Date.now(),
              dirMtime: mtimeByFolder.get(t.path),
            };
          }
          window.store.set('scanCache', cache);
          // Merge: drop previous files from scanned folders, add fresh
          _allFiles = _allFiles.filter(f => !toScan.some(t => belongsTo(f.path, t.path)));
          _allFiles.push(...collected);
          setStatus(t('gallery.filesFound', { n: _allFiles.length }));
          applyFilters();
          loadThumbnails();
        }
      }
    );
  } catch (err) {
    console.error('Gallery scan error:', err);
    setStatus('Scan failed');
  }
}

function setStatus(text) {
  const el = document.getElementById('gv-scan-status');
  if (el) el.textContent = text || '';
}

/* ------------------------------------------------------------------ *
 *  Thumbnails (cached in userData/thumbcache via main process)
 * ------------------------------------------------------------------ */
async function loadThumbnails() {
  const need = _allFiles.filter(f => !f.preview && !f._thumbTried);
  if (need.length === 0) return;
  const items = need.map(f => ({ path: f.path, mtime: f.mtime }));
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
        need.forEach(f => { f._thumbTried = true; });
        applyFilters();
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
 *  Filter / search / sort
 * ------------------------------------------------------------------ */
function applyFilters() {
  let result = _allFiles.slice();

  if (_activeExtFilter) result = result.filter(f => f.ext === _activeExtFilter);

  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    result = result.filter(f => (f.name || '').toLowerCase().includes(q));
  }

  result.sort((a, b) => {
    switch (_sortMode) {
      case 'name-asc':      return (a.name || '').localeCompare(b.name || '');
      case 'name-desc':     return (b.name || '').localeCompare(a.name || '');
      case 'size-asc':      return (a.size || 0) - (b.size || 0);
      case 'size-desc':     return (b.size || 0) - (a.size || 0);
      case 'stitches-asc':  return (a.stitches || 0) - (b.stitches || 0);
      case 'stitches-desc': return (b.stitches || 0) - (a.stitches || 0);
      default: return 0;
    }
  });

  _filtered = result;
  renderGrid();
  renderFilterChips();
  updateToolbar();
}

function renderFilterChips() {
  const container = document.getElementById('gv-filter-chips');
  if (!container) return;

  const extCounts = {};
  _allFiles.forEach(f => { if (f.ext) extCounts[f.ext] = (extCounts[f.ext] || 0) + 1; });
  const exts = Object.keys(extCounts).sort();

  let html = `<div class="gv-filter-chip ${_activeExtFilter === null ? 'active' : ''}" data-ext="__all__">${esc(t('gallery.filterAll'))} (${_allFiles.length})</div>`;
  html += exts.map(ext =>
    `<div class="gv-filter-chip ${_activeExtFilter === ext ? 'active' : ''}" data-ext="${esc(ext)}">${esc(ext.toUpperCase())} (${extCounts[ext]})</div>`
  ).join('');
  container.innerHTML = html;
}

/* ------------------------------------------------------------------ *
 *  Grid rendering (card + list)
 * ------------------------------------------------------------------ */
function renderGrid() {
  const grid = document.getElementById('gv-grid');
  if (!grid) return;
  grid.classList.toggle('card', _viewMode === 'card');
  grid.classList.toggle('list', _viewMode === 'list');

  if (_filtered.length === 0) {
    grid.innerHTML = `<div class="gv-empty-grid">${esc(t('gallery.noFiles'))}</div>`;
    return;
  }

  if (_viewMode === 'card') renderCards(grid);
  else renderList(grid);
}

function renderCards(grid) {
  const frag = document.createDocumentFragment();
  _filtered.forEach(file => {
    const card = document.createElement('div');
    card.className = 'gv-card';
    card.dataset.path = file.path;
    const marked = _marked.has(file.path);
    const preview = file.preview ? renderPreview(file.preview) : `<span class="gv-thumb-ph">${esc(t('preview.none'))}</span>`;
    const stitches = (file.stitches != null) ? `<span class="gv-card-stitches">${Number(file.stitches).toLocaleString()}</span>` : '';
    card.innerHTML = `
      <input type="checkbox" class="gv-card-check" data-path="${esc(file.path)}" ${marked ? 'checked' : ''} title="${esc(t('gallery.detail.addToBatch'))}"/>
      <div class="gv-thumb">${preview}</div>
      <div class="gv-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
      <div class="gv-card-meta">
        <span class="gv-badge">${esc((file.ext || '').toUpperCase())}</span>
        ${stitches}
      </div>
    `;
    frag.appendChild(card);
  });
  grid.replaceChildren(frag);
}

function renderList(grid) {
  const rows = _filtered.map(file => {
    const marked = _marked.has(file.path);
    const preview = file.preview ? renderPreview(file.preview) : '';
    const dims = (file.width && file.height) ? `${file.width} × ${file.height}` : '—';
    return `
      <tr data-path="${esc(file.path)}">
        <td><input type="checkbox" class="gv-row-check" data-path="${esc(file.path)}" ${marked ? 'checked' : ''}/></td>
        <td><div class="gv-list-thumb">${preview}</div></td>
        <td class="gv-list-name" title="${esc(file.name)}">${esc(file.name)}</td>
        <td>${esc((file.ext || '').toUpperCase())}</td>
        <td class="gv-col-num">${file.stitches != null ? Number(file.stitches).toLocaleString() : '—'}</td>
        <td class="gv-col-num">${file.colors != null ? file.colors : '—'}</td>
        <td class="gv-col-num">${dims}</td>
        <td class="gv-col-num">${formatSize(file.size || 0)}</td>
      </tr>`;
  }).join('');

  grid.innerHTML = `
    <table class="gv-list-table">
      <thead>
        <tr>
          <th style="width:30px"></th>
          <th style="width:44px"></th>
          <th>${esc(t('files.title'))}</th>
          <th>${esc(t('gallery.detail.format'))}</th>
          <th class="gv-col-num">${esc(t('gallery.detail.stitches'))}</th>
          <th class="gv-col-num">${esc(t('gallery.detail.colors'))}</th>
          <th class="gv-col-num">mm</th>
          <th class="gv-col-num">Size</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
 *  Batch markers toolbar
 * ------------------------------------------------------------------ */
function updateToolbar() {
  const bar = document.getElementById('gv-marked-bar');
  const count = document.getElementById('gv-marked-count');
  if (!bar || !count) return;
  if (_marked.size > 0) {
    bar.classList.add('show');
    count.textContent = t('gallery.marked', { n: _marked.size });
  } else {
    bar.classList.remove('show');
  }
}

function toggleMark(path, on) {
  if (on) _marked.add(path); else _marked.delete(path);
  updateToolbar();
}

function sendToBatch() {
  if (_marked.size === 0) return;
  window.store.set('batchQueue', Array.from(_marked));
  window.router && window.router.load('batch');
}

function sendToCollection() {
  if (_marked.size === 0) return;
  const byPath = new Map(_allFiles.map(f => [f.path, f]));
  const files = Array.from(_marked).map((p) => {
    const f = byPath.get(p) || {};
    return {
      path: p,
      name: f.name || (p.split(/[\\/]/).pop()),
      ext: f.ext || ((p.split('.').pop() || '').toLowerCase()),
      mtime: f.mtime,
      size: f.size,
    };
  });
  window.store.set('collectionsQueue', files);
  window.events && window.events.emit('gallery:send-to-collections', { files });
  window.router && window.router.load('collections');
}

/* ------------------------------------------------------------------ *
 *  Detail modal
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
      <h3 class="gv-modal-title">${esc(file.name)}</h3>
      <button class="gv-modal-close" data-action="close" title="${esc(t('gallery.detail.close'))}">×</button>
    </div>
    <div class="gv-modal-body">
      <div class="gv-modal-preview">${preview}</div>
      <div>
        <table class="gv-meta-table">
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.stitches'))}</td><td class="gv-meta-val">${file.stitches != null ? Number(file.stitches).toLocaleString() : '—'}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.colors'))}</td><td class="gv-meta-val">${file.colors != null ? file.colors : '—'}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.dimensions'))}</td><td class="gv-meta-val">${esc(dims)}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.format'))}</td><td class="gv-meta-val">${esc((file.ext || '').toUpperCase())}</td></tr>
          <tr><td class="gv-meta-key">Size</td><td class="gv-meta-val">${formatSize(file.size || 0)}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.path'))}</td><td class="gv-meta-val">${esc(file.path)}</td></tr>
          <tr><td class="gv-meta-key">${esc(t('gallery.detail.modified'))}</td><td class="gv-meta-val">${esc(modified)}</td></tr>
        </table>
        ${palette}
      </div>
      <div class="gv-modal-actions">
        <button class="gv-modal-btn" data-action="convert">${esc(t('gallery.detail.convert'))}</button>
        <button class="gv-modal-btn secondary" data-action="simulator">${esc(t('gallery.detail.simulator'))}</button>
        <button class="gv-modal-btn secondary" data-action="batch">${esc(t('gallery.detail.addToBatch'))}</button>
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
 *  Event wiring
 * ------------------------------------------------------------------ */
function wireEvents() {
  const sig = _abortCtrl.signal;

  document.getElementById('gv-add-folder-btn')
    ?.addEventListener('click', addFolders, { signal: sig });

  document.getElementById('gv-refresh-btn')
    ?.addEventListener('click', () => loadAndScan(true), { signal: sig });

  // Folder list: remove + alias edit (delegated)
  const folderList = document.getElementById('gv-folder-list');
  folderList?.addEventListener('click', (e) => {
    const rm = e.target.closest('.gv-folder-remove');
    if (rm) { removeFolder(rm.dataset.id); return; }
  }, { signal: sig });
  folderList?.addEventListener('dblclick', (e) => {
    const label = e.target.closest('.gv-folder-label');
    if (label) beginAliasEdit(label.dataset.id);
  }, { signal: sig });

  document.getElementById('gv-search')
    ?.addEventListener('input', (e) => { _searchQuery = e.target.value.trim(); applyFilters(); }, { signal: sig });

  document.getElementById('gv-sort-select')
    ?.addEventListener('change', (e) => { _sortMode = e.target.value; applyFilters(); }, { signal: sig });

  document.getElementById('gv-filter-chips')
    ?.addEventListener('click', (e) => {
      const chip = e.target.closest('.gv-filter-chip');
      if (!chip) return;
      const ext = chip.dataset.ext;
      _activeExtFilter = (ext === '__all__') ? null : (_activeExtFilter === ext ? null : ext);
      applyFilters();
    }, { signal: sig });

  // View toggle
  document.getElementById('gv-view-card')?.addEventListener('click', () => setViewMode('card'), { signal: sig });
  document.getElementById('gv-view-list')?.addEventListener('click', () => setViewMode('list'), { signal: sig });

  // Send to batch
  document.getElementById('gv-send-batch')?.addEventListener('click', sendToBatch, { signal: sig });
  document.getElementById('gv-send-collection')?.addEventListener('click', sendToCollection, { signal: sig });

  // Grid interactions (delegated: checkbox = mark, otherwise open detail)
  const grid = document.getElementById('gv-grid');
  grid?.addEventListener('change', (e) => {
    const cb = e.target.closest('.gv-card-check, .gv-row-check');
    if (cb) { toggleMark(cb.dataset.path, cb.checked); e.stopPropagation(); }
  }, { signal: sig });
  grid?.addEventListener('click', (e) => {
    if (e.target.closest('.gv-card-check, .gv-row-check')) return; // handled by change
    const item = e.target.closest('.gv-card, tr[data-path]');
    if (!item) return;
    const file = _filtered.find(f => f.path === item.dataset.path);
    if (file) openDetail(file);
  }, { signal: sig });

  // Modal
  document.getElementById('gv-modal-backdrop')?.addEventListener('click', closeDetail, { signal: sig });
  document.getElementById('gv-modal-card')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !_selected) return;
    const action = btn.dataset.action;
    if (action === 'close' || action === '__close__') { closeDetail(); }
    else if (action === 'convert') {
      // Hand off the selected file to the Files view via a store queue
      // (robust across the navigation that follows; an event listener could
      // fire before the Files view has mounted).
      window.store.set('filesQueue', [_selected.path]);
      closeDetail();
      window.router && window.router.load('files');
    } else if (action === 'simulator') {
      window.store.set('simulatorQueue', _selected.path);
      closeDetail();
      window.router && window.router.load('simulator');
    } else if (action === 'batch') {
      window.store.set('batchQueue', [_selected.path]);
      closeDetail();
      window.router && window.router.load('batch');
    }
  }, { signal: sig });
}

function setViewMode(mode) {
  _viewMode = mode;
  document.getElementById('gv-view-card')?.classList.toggle('active', mode === 'card');
  document.getElementById('gv-view-list')?.classList.toggle('active', mode === 'list');
  renderGrid();
}

/* ------------------------------------------------------------------ *
 *  Register with shell router
 * ------------------------------------------------------------------ */
window.registerView('gallery', { mount, unmount });
})();
