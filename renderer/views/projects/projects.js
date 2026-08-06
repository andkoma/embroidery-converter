/**
 * Projects View
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Manage embroidery projects: organize designs, images, documents and notes
 * into a hierarchical folder structure. Export to .ecproj packages for
 * sharing and archival.
 *
 * Two modes:
 *   • Catalog — browse all projects (search + card/list toggle), create,
 *     rename, import, export, remove. Click a project to "enter" it.
 *   • Detail  — inside one project: navigate folders (breadcrumb), add /
 *     view / update / remove files and folders, inspect an asset.
 *
 * ID prefix: pv-
 */
(function () {
'use strict';

const STYLE_ID = 'pv-styles';

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */
function t(key, params) {
  const lang = (window.store && window.store.get('settings.language', 'en')) || 'en';
  const dict = (window.I18N && window.I18N[lang]) || (window.I18N && window.I18N.en) || {};
  let val = dict[key] !== undefined
    ? dict[key]
    : ((window.I18N && window.I18N.en && window.I18N.en[key]) || key);
  if (params) Object.keys(params).forEach(k => { val = val.split('{' + k + '}').join(params[k]); });
  return val;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function assetKind(path) {
  return window.Grouping ? window.Grouping.assetKind(path) : 'document';
}
function isVisualKind(kind) {
  return window.Grouping ? window.Grouping.isVisualKind(kind) : (kind === 'embroidery' || kind === 'image');
}
function renderPreviewSVG(preview) {
  return window.Grouping ? window.Grouping.renderPreviewSVG(preview) : '';
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------------ *
 *  Module state (reset on mount)
 * ------------------------------------------------------------------ */
let _tree = null;              // Grouping tree (flat nodes linked by parentId)
let _mode = 'catalog';         // 'catalog' | 'detail'
let _activeProject = null;     // root project id when in detail mode
let _currentFolder = null;     // folder/project id whose contents are shown
let _activeAsset = null;       // selected asset id (inspector)
let _search = '';              // catalog search query
let _catalogView = 'card';     // 'card' | 'list'
let _hostEl = null;
let _abortCtrl = null;
let _saveTimer = null;

/* ------------------------------------------------------------------ *
 *  Persistence
 * ------------------------------------------------------------------ */
async function loadProjects() {
  if (!window.api) return [];
  try { const s = await window.api.getSettings(); return Array.isArray(s.projects) ? s.projects : []; }
  catch (_) { return []; }
}
function saveProjects() {
  if (!window.api || !_tree) return;
  window.api.setSettings({ projects: _tree.nodes }).catch(() => {});
  if (window.store) window.store.set('settings.projects', _tree.nodes);
}
function initTree(nodes) {
  if (!window.Grouping) { console.error('window.Grouping not loaded'); _tree = { nodes: [], byId: () => null, childrenOf: () => [], descendantIds: () => [], addNode: () => ({}), removeNode: () => {}, renameNode: () => {} }; return; }
  _tree = window.Grouping.createTree(nodes || []);
}

/* ------------------------------------------------------------------ *
 *  Tree queries
 * ------------------------------------------------------------------ */
function projectRoots() { return _tree ? _tree.nodes.filter(n => !n.parentId) : []; }

/** All assets within a project subtree (root + descendant folders). */
function collectAssets(projectId) {
  if (!_tree) return [];
  const out = [];
  const root = _tree.byId(projectId);
  if (root && Array.isArray(root.assets)) out.push(...root.assets);
  _tree.descendantIds(projectId).forEach(id => {
    const n = _tree.byId(id);
    if (n && Array.isArray(n.assets)) out.push(...n.assets);
  });
  return out;
}

/** First asset with a renderable preview (for the project card thumbnail). */
function projectThumb(projectId) {
  const assets = collectAssets(projectId);
  return assets.find(a => a.preview) || null;
}

/** Ancestor chain from project root down to the given folder id (inclusive). */
function ancestorsOf(id) {
  const chain = [];
  const seen = new Set();
  let n = _tree ? _tree.byId(id) : null;
  while (n && !seen.has(n.id)) { seen.add(n.id); chain.unshift(n); n = n.parentId ? _tree.byId(n.parentId) : null; }
  return chain;
}

/* ------------------------------------------------------------------ *
 *  Project / folder CRUD
 * ------------------------------------------------------------------ */
function createProject() {
  if (!_tree) return;
  const node = _tree.addNode(null, t('projects.newProject'), { type: 'project', assets: [] });
  saveProjects();
  // Enter the new project and immediately edit its name (no prompt()).
  enterProject(node.id);
  requestAnimationFrame(() => beginRenameTitle(node.id));
}

function createFolder(parentId) {
  if (!_tree) return;
  const node = _tree.addNode(parentId, t('projects.newFolder'), { type: 'folder', assets: [] });
  saveProjects();
  render();
  requestAnimationFrame(() => beginRenameInline(node.id));
}

function removeNode(id) {
  if (!_tree) return;
  const removed = _tree.removeNode(id);
  saveProjects();
  if (_activeProject && removed.has && removed.has(_activeProject)) { goToCatalog(); return; }
  if (_currentFolder && removed.has && removed.has(_currentFolder)) _currentFolder = _activeProject;
  if (_activeAsset) _activeAsset = null;
  render();
}

function renameNode(id, name) {
  if (!_tree) return;
  _tree.renameNode(id, name);
  saveProjects();
  render();
}

/* ------------------------------------------------------------------ *
 *  Navigation
 * ------------------------------------------------------------------ */
function goToCatalog() {
  _mode = 'catalog';
  _activeProject = null;
  _currentFolder = null;
  _activeAsset = null;
  render();
}
function enterProject(id) {
  _mode = 'detail';
  _activeProject = id;
  _currentFolder = id;
  _activeAsset = null;
  render();
}
function openFolder(id) {
  _currentFolder = id;
  _activeAsset = null;
  render();
}
function selectAsset(id) {
  _activeAsset = id;
  renderDetail();
}

/* ------------------------------------------------------------------ *
 *  Assets
 * ------------------------------------------------------------------ */
async function addAssets(folderId) {
  if (!window.api || !_tree) return;
  const paths = await window.api.openAnyFiles().catch(() => []);
  if (!paths || !paths.length) return;
  const node = _tree.byId(folderId);
  if (!node) return;
  if (!Array.isArray(node.assets)) node.assets = [];
  for (const path of paths) {
    let stats = { exists: true, mtime: Date.now(), isDir: false, size: 0 };
    try { stats = await window.api.statDir(path); } catch (_) {}
    if (stats && stats.isDir) continue;
    const kind = assetKind(path);
    const asset = {
      id: (window.Grouping ? window.Grouping.uid('a_') : 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: path.split(/[/\\]/).pop(),
      path, kind,
      size: (stats && stats.size) || 0,
      mtime: (stats && stats.mtime) || Date.now(),
      addedAt: Date.now(),
      tags: [], category: '', notes: '',
      versions: [{ id: 'v1', path, mtime: (stats && stats.mtime) || Date.now(), label: 'Original', isActive: true }],
    };
    if (kind === 'embroidery' && window.api.getThumbnail) {
      try { const th = await window.api.getThumbnail(path, asset.mtime); if (th && th.preview) asset.preview = th.preview; }
      catch (_) {}
    }
    node.assets.push(asset);
  }
  saveProjects();
  renderDetail();
}

function removeAsset(assetId) {
  if (!_tree || !_currentFolder) return;
  const node = _tree.byId(_currentFolder);
  if (!node || !Array.isArray(node.assets)) return;
  node.assets = node.assets.filter(a => a.id !== assetId);
  if (_activeAsset === assetId) _activeAsset = null;
  saveProjects();
  renderDetail();
}

function findAsset(assetId) {
  const node = _tree ? _tree.byId(_currentFolder) : null;
  if (!node || !Array.isArray(node.assets)) return null;
  return node.assets.find(a => a.id === assetId) || null;
}

/* ------------------------------------------------------------------ *
 *  Export / Import
 * ------------------------------------------------------------------ */
async function exportProject(projectId) {
  if (!window.api || !_tree) return;
  const project = _tree.byId(projectId);
  if (!project) return;
  // Gather this project's whole subtree (project + folders) as a manifest.
  const subtreeIds = new Set([projectId, ..._tree.descendantIds(projectId)]);
  const nodes = _tree.nodes.filter(n => subtreeIds.has(n.id));
  const assets = collectAssets(projectId);
  const previews = assets.filter(a => a.preview).map(a => ({ id: a.id, preview: a.preview }));
  const manifest = { version: 1, name: project.name, createdAt: project.createdAt, exportedAt: Date.now(), rootId: projectId, nodes };
  try {
    const res = await window.api.projectExport({ manifest, assets, previews });
    if (res && res.success) alert(t('projects.exportSuccess', { path: res.path }));
    else if (res && res.error && res.error !== 'Cancelled') alert(t('projects.exportFailed', { error: res.error }));
  } catch (err) { alert(t('projects.exportFailed', { error: (err && err.message) || String(err) })); }
}

async function importProject() {
  if (!window.api || !_tree) return;
  let res;
  try { res = await window.api.projectImport(); } catch (err) { alert(t('projects.importFailed', { error: (err && err.message) || String(err) })); return; }
  if (!res || !res.success || !res.manifest) {
    if (res && res.error && res.error !== 'Cancelled') alert(t('projects.importFailed', { error: res.error }));
    return;
  }
  const m = res.manifest;
  // Backwards/robust: accept either { nodes:[...] } or legacy { tree:{...} }.
  let newRootId = null;
  if (Array.isArray(m.nodes) && m.nodes.length) {
    // Re-id every node to avoid collisions, preserving parent links.
    const idMap = new Map();
    m.nodes.forEach(n => idMap.set(n.id, window.Grouping ? window.Grouping.uid('n_') : 'n_' + Math.random().toString(36).slice(2)));
    m.nodes.forEach(n => {
      const clone = Object.assign({}, n);
      clone.id = idMap.get(n.id);
      clone.parentId = n.parentId ? (idMap.get(n.parentId) || null) : null;
      if (n.id === m.rootId) { clone.parentId = null; clone.name = n.name + ' ' + t('projects.importedSuffix'); newRootId = clone.id; }
      _tree.nodes.push(clone);
    });
  } else if (m.tree) {
    const node = Object.assign({}, m.tree);
    node.id = window.Grouping ? window.Grouping.uid('n_') : 'n_' + Math.random().toString(36).slice(2);
    node.parentId = null;
    node.name = (node.name || 'Project') + ' ' + t('projects.importedSuffix');
    _tree.nodes.push(node);
    newRootId = node.id;
  }
  saveProjects();
  if (newRootId) enterProject(newRootId); else render();
  alert(t('projects.importSuccess'));
}

/* ------------------------------------------------------------------ *
 *  Inline rename (Electron has no window.prompt — use an <input>)
 * ------------------------------------------------------------------ */
function beginRenameInline(id) {
  const el = _hostEl && _hostEl.querySelector('.pv-editable-name[data-id="' + id + '"]');
  if (!el) return;
  const node = _tree.byId(id);
  const input = document.createElement('input');
  input.className = 'pv-rename-input';
  input.value = node ? node.name : '';
  el.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = () => { if (done) return; done = true; renameNode(id, input.value); };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { done = true; render(); }
  });
}
// Same, but for the big title in the detail header.
function beginRenameTitle(id) {
  const el = _hostEl && _hostEl.querySelector('.pv-detail-title[data-id="' + id + '"]');
  if (!el) return;
  const node = _tree.byId(id);
  const input = document.createElement('input');
  input.className = 'pv-title-input';
  input.value = node ? node.name : '';
  el.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = () => { if (done) return; done = true; renameNode(id, input.value); };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { done = true; render(); }
  });
}

/* ================================================================== *
 *  Rendering — dispatch
 * ================================================================== */
function render() {
  if (_mode === 'detail' && _activeProject && _tree && _tree.byId(_activeProject)) renderDetail();
  else { _mode = 'catalog'; renderCatalog(); }
}

/* ---- Catalog ----------------------------------------------------- */
function renderCatalog() {
  if (!_hostEl) return;
  const q = _search.trim().toLowerCase();
  let roots = projectRoots();
  if (q) roots = roots.filter(p => (p.name || '').toLowerCase().includes(q));

  const toolbar = `
    <div class="pv-cat-toolbar">
      <h2 class="pv-cat-title">${esc(t('projects.title'))}</h2>
      <div class="pv-search-wrap">
        <input type="text" id="pv-search" class="pv-search" placeholder="${esc(t('projects.searchPlaceholder'))}" value="${esc(_search)}" />
      </div>
      <div class="pv-view-toggle">
        <button id="pv-view-card" class="pv-view-btn ${_catalogView === 'card' ? 'active' : ''}" title="${esc(t('projects.viewCard'))}" aria-label="${esc(t('projects.viewCard'))}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
        </button>
        <button id="pv-view-list" class="pv-view-btn ${_catalogView === 'list' ? 'active' : ''}" title="${esc(t('projects.viewList'))}" aria-label="${esc(t('projects.viewList'))}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01"/></svg>
        </button>
      </div>
      <div class="pv-cat-actions">
        <button id="pv-import" class="pv-btn-ghost">${esc(t('projects.import'))}</button>
        <button id="pv-new-project" class="pv-btn-primary">+ ${esc(t('projects.newProject'))}</button>
      </div>
    </div>`;

  let body;
  if (roots.length === 0) {
    body = `<div class="pv-empty">${esc(q ? t('projects.noMatches') : t('projects.empty'))}</div>`;
  } else if (_catalogView === 'card') {
    body = '<div class="pv-cat-grid">' + roots.map(p => projectCard(p)).join('') + '</div>';
  } else {
    body = projectList(roots);
  }

  _hostEl.innerHTML = `<div class="pv-catalog">${toolbar}<div class="pv-cat-body">${body}</div></div>`;
}

function projectCard(p) {
  const count = collectAssets(p.id).length;
  const thumb = projectThumb(p.id);
  const preview = thumb
    ? `<div class="pv-card-thumb">${renderPreviewSVG(thumb.preview)}</div>`
    : `<div class="pv-card-thumb pv-card-thumb-empty">
         <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>
       </div>`;
  return `
    <div class="pv-card" data-open="${esc(p.id)}">
      ${preview}
      <div class="pv-card-body">
        <div class="pv-editable-name pv-card-name" data-id="${esc(p.id)}" title="${esc(p.name)}">${esc(p.name)}</div>
        <div class="pv-card-meta">${esc(t('projects.assetCount', { n: count }))} · ${esc(formatDate(p.createdAt))}</div>
      </div>
      <div class="pv-card-actions">
        <button class="pv-icon pv-rename" data-id="${esc(p.id)}" title="${esc(t('projects.rename'))}">✎</button>
        <button class="pv-icon pv-export" data-id="${esc(p.id)}" title="${esc(t('projects.export'))}">⇧</button>
        <button class="pv-icon pv-remove" data-id="${esc(p.id)}" title="${esc(t('projects.remove'))}">×</button>
      </div>
    </div>`;
}

function projectList(roots) {
  const rows = roots.map(p => {
    const count = collectAssets(p.id).length;
    return `
      <tr data-open="${esc(p.id)}">
        <td class="pv-list-name"><span class="pv-editable-name" data-id="${esc(p.id)}">${esc(p.name)}</span></td>
        <td class="pv-num">${count}</td>
        <td>${esc(formatDate(p.createdAt))}</td>
        <td class="pv-list-actions">
          <button class="pv-icon pv-rename" data-id="${esc(p.id)}" title="${esc(t('projects.rename'))}">✎</button>
          <button class="pv-icon pv-export" data-id="${esc(p.id)}" title="${esc(t('projects.export'))}">⇧</button>
          <button class="pv-icon pv-remove" data-id="${esc(p.id)}" title="${esc(t('projects.remove'))}">×</button>
        </td>
      </tr>`;
  }).join('');
  return `
    <table class="pv-list-table">
      <thead><tr>
        <th>${esc(t('projects.colName'))}</th>
        <th class="pv-num">${esc(t('projects.assets'))}</th>
        <th>${esc(t('projects.created'))}</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ---- Detail ------------------------------------------------------ */
function renderDetail() {
  if (!_hostEl || !_tree) return;
  const project = _tree.byId(_activeProject);
  if (!project) { goToCatalog(); return; }
  const folder = _tree.byId(_currentFolder) || project;

  // Breadcrumb from project root to current folder.
  const chain = ancestorsOf(_currentFolder);
  const crumbs = chain.map((n, i) => {
    const last = i === chain.length - 1;
    return `<span class="pv-crumb ${last ? 'current' : ''}" data-folder="${esc(n.id)}">${esc(n.name)}</span>`;
  }).join('<span class="pv-crumb-sep">/</span>');

  const header = `
    <div class="pv-detail-header">
      <button id="pv-back" class="pv-btn-ghost pv-back">← ${esc(t('projects.back'))}</button>
      <div class="pv-detail-title-wrap">
        <span class="pv-detail-title pv-editable-name" data-id="${esc(project.id)}" title="${esc(t('projects.rename'))}">${esc(project.name)}</span>
        <button class="pv-icon pv-rename" data-id="${esc(project.id)}" title="${esc(t('projects.rename'))}">✎</button>
      </div>
      <div class="pv-detail-actions">
        <button id="pv-add-folder" class="pv-btn-ghost">+ ${esc(t('projects.addFolder'))}</button>
        <button id="pv-add-assets" class="pv-btn-primary">+ ${esc(t('projects.addAssets'))}</button>
        <button id="pv-export-detail" class="pv-btn-ghost" data-id="${esc(project.id)}">${esc(t('projects.export'))}</button>
      </div>
    </div>`;

  const breadcrumb = `<div class="pv-breadcrumb">${crumbs}</div>`;

  // Folders (child nodes of current folder) + assets in the current folder.
  const childFolders = _tree.childrenOf(_currentFolder);
  const assets = Array.isArray(folder.assets) ? folder.assets : [];

  let gridItems = '';
  childFolders.forEach(f => {
    const fc = collectAssets(f.id).length;
    gridItems += `
      <div class="pv-item pv-folder-item" data-folder-open="${esc(f.id)}">
        <div class="pv-item-thumb pv-item-icon">📁</div>
        <div class="pv-item-info">
          <div class="pv-editable-name pv-item-name" data-id="${esc(f.id)}" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="pv-item-sub">${esc(t('projects.assetCount', { n: fc }))}</div>
        </div>
        <div class="pv-item-actions">
          <button class="pv-icon pv-rename" data-id="${esc(f.id)}" title="${esc(t('projects.rename'))}">✎</button>
          <button class="pv-icon pv-remove-folder" data-id="${esc(f.id)}" title="${esc(t('projects.removeFolder'))}">×</button>
        </div>
      </div>`;
  });
  assets.forEach(a => {
    const active = a.id === _activeAsset;
    let thumb;
    if ((a.kind === 'embroidery' || a.kind === 'image') && a.preview) thumb = `<div class="pv-item-thumb">${renderPreviewSVG(a.preview)}</div>`;
    else if (a.kind === 'image') thumb = `<div class="pv-item-thumb pv-item-icon">🖼</div>`;
    else if (a.kind === 'document') thumb = `<div class="pv-item-thumb pv-item-icon">📄</div>`;
    else if (a.kind === 'note') thumb = `<div class="pv-item-thumb pv-item-icon">📝</div>`;
    else thumb = `<div class="pv-item-thumb pv-item-icon">🧵</div>`;
    gridItems += `
      <div class="pv-item pv-asset-item ${active ? 'active' : ''}" data-asset="${esc(a.id)}">
        ${thumb}
        <div class="pv-item-info">
          <div class="pv-item-name" title="${esc(a.path)}">${esc(a.name)}</div>
          <div class="pv-item-sub">${esc(t('projects.kind.' + a.kind) || a.kind)}</div>
        </div>
      </div>`;
  });
  if (!gridItems) gridItems = `<div class="pv-empty">${esc(_currentFolder === _activeProject ? t('projects.noAssets') : t('projects.emptyFolder'))}</div>`;

  const inspector = renderInspectorHTML();

  _hostEl.innerHTML = `
    <div class="pv-detail">
      ${header}
      ${breadcrumb}
      <div class="pv-detail-body">
        <div class="pv-items-grid">${gridItems}</div>
        <div class="pv-inspector">${inspector}</div>
      </div>
    </div>`;
}

function renderInspectorHTML() {
  const asset = _activeAsset ? findAsset(_activeAsset) : null;
  if (!asset) return `<div class="pv-empty pv-inspector-empty">${esc(t('projects.selectAsset'))}</div>`;
  return `
    <div class="pv-inspector-header">
      <h3 title="${esc(asset.name)}">${esc(asset.name)}</h3>
      <button class="pv-icon pv-remove-asset" data-id="${esc(asset.id)}" title="${esc(t('projects.removeAsset'))}">×</button>
    </div>
    <div class="pv-insp-section">
      <h4>${esc(t('projects.details'))}</h4>
      <table class="pv-insp-table">
        <tr><td>${esc(t('projects.path'))}</td><td title="${esc(asset.path)}">${esc(asset.path)}</td></tr>
        <tr><td>${esc(t('projects.kind'))}</td><td>${esc(t('projects.kind.' + asset.kind) || asset.kind)}</td></tr>
        <tr><td>${esc(t('projects.size'))}</td><td>${esc(formatBytes(asset.size))}</td></tr>
        <tr><td>${esc(t('projects.modified'))}</td><td>${esc(formatDate(asset.mtime))}</td></tr>
      </table>
    </div>
    <div class="pv-insp-section">
      <h4>${esc(t('projects.notes'))}</h4>
      <textarea id="pv-notes" class="pv-notes" placeholder="${esc(t('projects.notesPlaceholder'))}">${esc(asset.notes || '')}</textarea>
    </div>
    <div class="pv-insp-section">
      <h4>${esc(t('projects.tags'))}</h4>
      <input id="pv-tags" type="text" class="pv-tags-input" placeholder="${esc(t('projects.tagsPlaceholder'))}" value="${esc((asset.tags || []).join(', '))}" />
    </div>
    <div class="pv-insp-section">
      <button id="pv-send-transfer" class="pv-btn-secondary" data-id="${esc(asset.id)}">${esc(t('pick.sendToTransfer'))}</button>
    </div>`;
}

function sendAssetToTransfer(assetId) {
  const asset = findAsset(assetId);
  if (!asset) return;
  const name = asset.name || (asset.path || '').split(/[/\\]/).pop();
  const ext = (name.split('.').pop() || '').toLowerCase();
  window.store.set('transferQueue', [{ path: asset.path, name, ext, size: asset.size, mtime: asset.mtime }]);
  if (window.router) window.router.load('transfer');
}

function saveInspectorFields() {
  const asset = _activeAsset ? findAsset(_activeAsset) : null;
  if (!asset) return;
  const notesEl = _hostEl && _hostEl.querySelector('#pv-notes');
  const tagsEl = _hostEl && _hostEl.querySelector('#pv-tags');
  if (notesEl) asset.notes = notesEl.value;
  if (tagsEl) asset.tags = tagsEl.value.split(',').map(s => s.trim()).filter(Boolean);
  saveProjects();
}

/* ================================================================== *
 *  Event wiring (delegated on the host element)
 * ================================================================== */
function wireEvents() {
  _abortCtrl = new AbortController();
  const sig = _abortCtrl.signal;
  const host = _hostEl;
  if (!host) return;

  host.addEventListener('click', e => {
    // Ignore clicks that originate on an inline rename input.
    if (e.target.classList && (e.target.classList.contains('pv-rename-input') || e.target.classList.contains('pv-title-input'))) return;

    // --- rename (works in both catalog + detail) ---
    const renameBtn = e.target.closest('.pv-rename');
    if (renameBtn) { e.stopPropagation(); const id = renameBtn.dataset.id;
      if (_mode === 'detail' && id === _activeProject) beginRenameTitle(id); else beginRenameInline(id);
      return;
    }
    // dbl not needed; single click on editable name in list/detail also edits
    const editName = e.target.closest('.pv-editable-name');
    if (editName && (_mode === 'detail')) { e.stopPropagation();
      if (editName.classList.contains('pv-detail-title')) beginRenameTitle(editName.dataset.id);
      else beginRenameInline(editName.dataset.id);
      return;
    }

    const exportBtn = e.target.closest('.pv-export, #pv-export-detail');
    if (exportBtn) { e.stopPropagation(); exportProject(exportBtn.dataset.id || _activeProject); return; }

    const removeBtn = e.target.closest('.pv-remove');
    if (removeBtn) { e.stopPropagation(); const id = removeBtn.dataset.id; const n = _tree.byId(id);
      if (n && confirm(t('projects.confirmRemove', { name: n.name }))) removeNode(id);
      return;
    }
    const removeFolderBtn = e.target.closest('.pv-remove-folder');
    if (removeFolderBtn) { e.stopPropagation(); const id = removeFolderBtn.dataset.id; const n = _tree.byId(id);
      if (n && confirm(t('projects.confirmRemoveFolder', { name: n.name }))) removeNode(id);
      return;
    }
    const removeAssetBtn = e.target.closest('.pv-remove-asset');
    if (removeAssetBtn) { e.stopPropagation(); if (confirm(t('projects.confirmRemoveAsset'))) removeAsset(removeAssetBtn.dataset.id); return; }

    const sendTransferBtn = e.target.closest('#pv-send-transfer');
    if (sendTransferBtn) { e.stopPropagation(); sendAssetToTransfer(sendTransferBtn.dataset.id); return; }

    // --- catalog: toolbar ---
    if (e.target.closest('#pv-new-project')) { createProject(); return; }
    if (e.target.closest('#pv-import')) { importProject(); return; }
    if (e.target.closest('#pv-view-card')) { setCatalogView('card'); return; }
    if (e.target.closest('#pv-view-list')) { setCatalogView('list'); return; }

    // --- catalog: open a project ---
    const openEl = e.target.closest('[data-open]');
    if (openEl) { enterProject(openEl.dataset.open); return; }

    // --- detail: header actions ---
    if (e.target.closest('#pv-back')) { goToCatalog(); return; }
    if (e.target.closest('#pv-add-folder')) { createFolder(_currentFolder); return; }
    if (e.target.closest('#pv-add-assets')) { addAssets(_currentFolder); return; }

    // --- detail: breadcrumb / folder open ---
    const crumb = e.target.closest('.pv-crumb');
    if (crumb) { openFolder(crumb.dataset.folder); return; }
    const folderOpen = e.target.closest('[data-folder-open]');
    if (folderOpen) { openFolder(folderOpen.dataset.folderOpen); return; }

    // --- detail: select asset ---
    const assetEl = e.target.closest('[data-asset]');
    if (assetEl) { selectAsset(assetEl.dataset.asset); return; }
  }, { signal: sig });

  // Catalog search
  host.addEventListener('input', e => {
    if (e.target.id === 'pv-search') { _search = e.target.value; renderCatalog(); const s = _hostEl.querySelector('#pv-search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    else if (e.target.id === 'pv-notes' || e.target.id === 'pv-tags') { clearTimeout(_saveTimer); _saveTimer = setTimeout(saveInspectorFields, 800); }
  }, { signal: sig });
}

function setCatalogView(mode) {
  _catalogView = mode;
  try { localStorage.setItem('ec_projects_view', mode); } catch (_) {}
  renderCatalog();
}

/* ================================================================== *
 *  Lifecycle
 * ================================================================== */
async function mount(viewHost) {
  const host = typeof viewHost === 'string' ? document.getElementById(viewHost) : viewHost;
  if (!host) return;
  _hostEl = host;
  _mode = 'catalog'; _activeProject = null; _currentFolder = null; _activeAsset = null; _search = '';
  try { const v = localStorage.getItem('ec_projects_view'); if (v === 'card' || v === 'list') _catalogView = v; } catch (_) {}

  injectCSS();
  const projects = await loadProjects();
  initTree(projects);
  render();
  wireEvents();
}

function unmount() {
  clearTimeout(_saveTimer);
  saveInspectorFields();
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
  _tree = null; _hostEl = null; _activeProject = null; _currentFolder = null; _activeAsset = null;
}

/* ------------------------------------------------------------------ *
 *  Scoped styles
 * ------------------------------------------------------------------ */
function injectCSS() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #viewHost { overflow: hidden; }
    .pv-catalog, .pv-detail { display: flex; flex-direction: column; height: 100%; background: var(--panel-bg, #fff); }

    /* Catalog toolbar */
    .pv-cat-toolbar { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--row-border, #e2e2e2); flex-wrap: wrap; }
    .pv-cat-title { margin: 0; font-size: 18px; font-weight: 600; }
    .pv-search-wrap { flex: 1; min-width: 160px; }
    .pv-search { width: 100%; padding: 8px 12px; border: 1px solid var(--row-border, #ddd); border-radius: 6px; font-size: 13px; background: var(--input-bg, #fff); }
    .pv-view-toggle { display: flex; border: 1px solid var(--row-border, #ddd); border-radius: 6px; overflow: hidden; }
    .pv-view-btn { background: var(--input-bg, #fff); border: none; padding: 7px 10px; cursor: pointer; color: var(--muted, #666); display: flex; }
    .pv-view-btn.active { background: var(--accent, #1976d2); color: #fff; }
    .pv-cat-actions { display: flex; gap: 8px; }

    .pv-btn-primary { background: var(--accent, #1976d2); color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
    .pv-btn-primary:hover { background: var(--accent-hover, #1565c0); }
    .pv-btn-ghost { background: var(--input-bg, #fff); color: var(--fg, #333); border: 1px solid var(--row-border, #ddd); padding: 8px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .pv-btn-ghost:hover { background: var(--hover-bg, #f3f3f3); }
    .pv-btn-secondary { width: 100%; background: var(--input-bg, #fff); color: var(--accent, #1976d2); border: 1px solid var(--accent, #1976d2); padding: 8px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .pv-btn-secondary:hover { background: var(--accent, #1976d2); color: #fff; }

    .pv-cat-body { flex: 1; overflow-y: auto; padding: 20px; }
    .pv-cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }

    .pv-card { position: relative; border: 1px solid var(--row-border, #e2e2e2); border-radius: 10px; overflow: hidden; cursor: pointer; background: var(--panel-bg, #fff); transition: box-shadow .15s, border-color .15s; }
    .pv-card:hover { border-color: var(--accent, #1976d2); box-shadow: 0 4px 14px rgba(0,0,0,.08); }
    .pv-card-thumb { height: 140px; display: flex; align-items: center; justify-content: center; background: var(--surface, #fafafa); border-bottom: 1px solid var(--row-border, #eee); padding: 10px; }
    .pv-card-thumb svg { max-width: 100%; max-height: 100%; }
    .pv-card-thumb-empty { color: var(--muted, #bbb); }
    .pv-card-body { padding: 10px 12px; }
    .pv-card-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pv-card-meta { font-size: 11px; color: var(--muted, #777); margin-top: 4px; }
    .pv-card-actions { position: absolute; top: 8px; right: 8px; display: none; gap: 2px; background: rgba(255,255,255,.9); border-radius: 6px; padding: 2px; }
    .pv-card:hover .pv-card-actions { display: flex; }

    /* Catalog list */
    .pv-list-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .pv-list-table th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--row-border, #e2e2e2); color: var(--muted, #666); font-weight: 600; }
    .pv-list-table td { padding: 8px 10px; border-bottom: 1px solid var(--row-border, #eee); }
    .pv-list-table tbody tr, .pv-list-table tr[data-open] { cursor: pointer; }
    .pv-list-table tr[data-open]:hover { background: var(--row-hover, #f5f5f5); }
    .pv-num { text-align: right; width: 80px; }
    .pv-list-name { font-weight: 500; }
    .pv-list-actions { text-align: right; width: 120px; white-space: nowrap; }

    /* Detail */
    .pv-detail-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--row-border, #e2e2e2); flex-wrap: wrap; }
    .pv-back { font-weight: 500; }
    .pv-detail-title-wrap { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 120px; }
    .pv-detail-title { font-size: 18px; font-weight: 700; cursor: text; padding: 2px 4px; border-radius: 4px; }
    .pv-detail-title:hover { background: var(--hover-bg, #f0f0f0); }
    .pv-detail-actions { display: flex; gap: 8px; }
    .pv-title-input { font-size: 18px; font-weight: 700; padding: 2px 6px; border: 1px solid var(--accent, #1976d2); border-radius: 4px; flex: 1; }

    .pv-breadcrumb { padding: 8px 20px; font-size: 12px; color: var(--muted, #777); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--row-border, #f0f0f0); }
    .pv-crumb { cursor: pointer; padding: 2px 4px; border-radius: 4px; }
    .pv-crumb:hover { background: var(--hover-bg, #f0f0f0); color: var(--accent, #1976d2); }
    .pv-crumb.current { color: var(--fg, #333); font-weight: 600; cursor: default; }
    .pv-crumb-sep { color: var(--muted, #ccc); }

    .pv-detail-body { flex: 1; display: grid; grid-template-columns: 1fr 320px; gap: 1px; background: var(--row-border, #eee); overflow: hidden; }
    .pv-items-grid { background: var(--panel-bg, #fff); overflow-y: auto; padding: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; align-content: start; }
    .pv-inspector { background: var(--panel-bg, #fff); overflow-y: auto; padding: 16px; }

    .pv-item { position: relative; border: 1px solid var(--row-border, #e2e2e2); border-radius: 8px; overflow: hidden; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
    .pv-item:hover { border-color: var(--accent, #1976d2); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .pv-item.active { border-color: var(--accent, #1976d2); background: var(--accent-subtle, #e9f2fd); }
    .pv-item-thumb { height: 96px; display: flex; align-items: center; justify-content: center; background: var(--surface, #fafafa); border-bottom: 1px solid var(--row-border, #eee); padding: 8px; }
    .pv-item-thumb svg { max-width: 100%; max-height: 100%; }
    .pv-item-icon { font-size: 34px; }
    .pv-item-info { padding: 8px; }
    .pv-item-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pv-item-sub { font-size: 11px; color: var(--muted, #777); margin-top: 2px; }
    .pv-folder-item .pv-item-thumb { background: var(--accent-subtle, #eef4fb); }
    .pv-item-actions { position: absolute; top: 6px; right: 6px; display: none; gap: 2px; background: rgba(255,255,255,.9); border-radius: 6px; padding: 2px; }
    .pv-item:hover .pv-item-actions { display: flex; }

    /* Inspector */
    .pv-inspector-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--row-border, #eee); }
    .pv-inspector-header h3 { margin: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pv-insp-section { margin-bottom: 18px; }
    .pv-insp-section h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted, #888); margin: 0 0 8px; }
    .pv-insp-table { width: 100%; font-size: 12px; border-collapse: collapse; }
    .pv-insp-table td { padding: 4px 0; vertical-align: top; }
    .pv-insp-table td:first-child { width: 74px; color: var(--muted, #888); font-weight: 500; }
    .pv-insp-table td:last-child { word-break: break-word; }
    .pv-notes { width: 100%; min-height: 100px; padding: 8px; border: 1px solid var(--row-border, #ddd); border-radius: 6px; font-family: inherit; font-size: 12px; resize: vertical; box-sizing: border-box; }
    .pv-tags-input { width: 100%; padding: 8px; border: 1px solid var(--row-border, #ddd); border-radius: 6px; font-size: 12px; box-sizing: border-box; }

    /* Shared */
    .pv-editable-name { cursor: text; }
    .pv-rename-input { font-size: inherit; font-weight: inherit; padding: 2px 6px; border: 1px solid var(--accent, #1976d2); border-radius: 4px; width: 90%; }
    .pv-icon { background: none; border: none; cursor: pointer; padding: 4px 6px; font-size: 13px; color: var(--fg, #444); opacity: .7; border-radius: 4px; }
    .pv-icon:hover { opacity: 1; background: var(--hover-bg, #eee); }
    .pv-empty { padding: 48px 20px; text-align: center; color: var(--muted, #999); font-size: 13px; grid-column: 1 / -1; }
    .pv-inspector-empty { padding: 40px 10px; }
  `;
  document.head.appendChild(style);
}

if (window.registerView) window.registerView('projects', { mount, unmount });

})();
