(function () {
'use strict';
/**
 * Collections View — organize designs from any source into named groups
 * with unlimited nested subgroups. Files can be added manually (picker or
 * Gallery hand-off) and tagged manually or with an AI vision model.
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Three-column layout:
 *   Left   — collection tree (groups + unlimited subgroups, CRUD)
 *   Center — designs in the selected collection (thumbnails, tags, search)
 *   Right  — inspector / AI suggestions for the selected design(s)
 *
 * Data model (persisted in settings.collections — flat array, parentId links):
 *   node = { id, name, parentId, files: [{path,name,ext,mtime,size,tags:[],category}], createdAt }
 */

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */
const t = (key, params = {}) => {
  const lang = window.store?.get('settings.language', 'en') || 'en';
  let str = window.I18N?.[lang]?.[key];
  if (str === undefined) str = window.I18N?.en?.[key];
  if (str === undefined) str = key;
  Object.entries(params).forEach(([k, v]) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  });
  return str;
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tail = (p) => { const a = String(p || '').split(/[/\\]/).filter(Boolean); return a.length ? a[a.length - 1] : p; };

/* ------------------------------------------------------------------ *
 *  Module state
 * ------------------------------------------------------------------ */
let _abort = null;
let _nodes = [];           // flat collection nodes
let _selectedId = null;    // active collection id
let _expanded = new Set(); // expanded node ids
let _search = '';
let _tagFilter = null;     // active tag filter (string) or null
let _selectedFiles = new Set();  // selected file paths within current collection
let _thumbReq = null;

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */
async function mount(container) {
  _abort = new AbortController();
  injectCSS();

  await loadCollections();

  const host = container || document.getElementById('viewHost');
  host.innerHTML = buildHTML();
  wireStatic();

  // If nothing selected, pick the first root node
  if (!_selectedId && _nodes.length) {
    const firstRoot = _nodes.find(n => !n.parentId) || _nodes[0];
    _selectedId = firstRoot ? firstRoot.id : null;
  }
  renderTree();
  renderFiles();
  renderInspector();

  // Consume Gallery hand-off queue
  const q = window.store?.get('collectionsQueue', []) || [];
  if (q.length) { showQueueBanner(q); }

  window.events?.on('gallery:send-to-collections', onGalleryHandoff);
}

function unmount() {
  window.events?.off('gallery:send-to-collections', onGalleryHandoff);
  if (_thumbReq) { try { window.api.cancelStream?.(_thumbReq); } catch (_) {} _thumbReq = null; }
  if (_abort) { _abort.abort(); _abort = null; }
  removeCSS();
  _selectedFiles.clear();
}

function onGalleryHandoff(data) {
  const files = (data && data.files) ? data.files : [];
  if (files.length) showQueueBanner(files);
}

/* ------------------------------------------------------------------ *
 *  Persistence
 * ------------------------------------------------------------------ */
async function loadCollections() {
  let s;
  try { s = await window.api.getSettings(); } catch (_) { s = window.store?.get('settings') || {}; }
  _nodes = Array.isArray(s.collections) ? s.collections : [];
  // Ensure structural fields
  _nodes.forEach(n => {
    n.files = Array.isArray(n.files) ? n.files : [];
    n.files.forEach(f => { f.tags = Array.isArray(f.tags) ? f.tags : []; });
  });
}

async function persist() {
  try { await window.api.setSettings({ collections: _nodes }); } catch (_) {}
  window.store?.set('settings.collections', _nodes);
}

/* ------------------------------------------------------------------ *
 *  Tree helpers
 * ------------------------------------------------------------------ */
const byId = (id) => _nodes.find(n => n.id === id);
const childrenOf = (id) => _nodes.filter(n => n.parentId === (id || null));
function descendantIds(id) {
  const out = [];
  const visited = new Set();  // Prevent infinite recursion from circular refs
  const walk = (pid) => {
    if (visited.has(pid)) return;  // Skip if already visited
    visited.add(pid);
    childrenOf(pid).forEach(c => { 
      if (!visited.has(c.id)) {  // Additional check before recursing
        out.push(c.id); 
        walk(c.id); 
      }
    });
  };
  walk(id);
  return out;
}
function fileCount(id) {
  // Total files in this node + all descendants
  let n = byId(id);
  let total = n ? n.files.length : 0;
  descendantIds(id).forEach(d => { const nd = byId(d); if (nd) total += nd.files.length; });
  return total;
}

/* ------------------------------------------------------------------ *
 *  CRUD
 * ------------------------------------------------------------------ */
async function createNode(parentId, name) {
  const node = { id: uid('c_'), name: name || t('collections.rootName'), parentId: parentId || null, files: [], tags: [], createdAt: Date.now() };
  _nodes.push(node);
  if (parentId) _expanded.add(parentId);
  _selectedId = node.id;
  await persist();
  renderTree(); renderFiles(); renderInspector();
  // Immediately let the user rename it
  beginRename(node.id);
}

async function removeNode(id) {
  const ids = new Set([id, ...descendantIds(id)]);
  _nodes = _nodes.filter(n => !ids.has(n.id));
  if (ids.has(_selectedId)) _selectedId = _nodes.find(n => !n.parentId)?.id || null;
  await persist();
  renderTree(); renderFiles(); renderInspector();
}

async function renameNode(id, name) {
  const n = byId(id);
  if (n) { n.name = name.trim() || n.name; await persist(); renderTree(); renderFiles(); }
}

async function moveFilesToNode(paths, targetId) {
  const target = byId(targetId);
  if (!target) return;
  // Gather file objects from all nodes, remove from source, add to target
  paths.forEach(p => {
    let obj = null;
    for (const n of _nodes) {
      const i = n.files.findIndex(f => f.path === p);
      if (i >= 0) { obj = n.files[i]; if (n.id !== targetId) n.files.splice(i, 1); break; }
    }
    if (obj && !target.files.some(f => f.path === p)) target.files.push(obj);
  });
  await persist();
}

/* ------------------------------------------------------------------ *
 *  Adding files
 * ------------------------------------------------------------------ */
async function addFilesToSelected() {
  if (!_selectedId) return;
  const picked = await window.api.openFiles?.();
  if (!picked || !picked.length) return;
  addFileObjectsToNode(_selectedId, picked.map(p => ({ path: p, name: tail(p), ext: (tail(p).split('.').pop() || '').toLowerCase() })));
}

async function addFileObjectsToNode(nodeId, files) {
  const node = byId(nodeId);
  if (!node) return;
  const existing = new Set(node.files.map(f => f.path));
  files.forEach(f => {
    if (existing.has(f.path)) return;
    node.files.push({ path: f.path, name: f.name || tail(f.path), ext: f.ext || (tail(f.path).split('.').pop() || '').toLowerCase(),
                      mtime: f.mtime, size: f.size, tags: Array.isArray(f.tags) ? f.tags : [], category: f.category || '' });
  });
  await persist();
  renderTree(); renderFiles();
}

async function removeFileFromSelected(path) {
  const node = byId(_selectedId);
  if (!node) return;
  node.files = node.files.filter(f => f.path !== path);
  _selectedFiles.delete(path);
  await persist();
  renderTree(); renderFiles(); renderInspector();
}

/* ------------------------------------------------------------------ *
 *  Tags
 * ------------------------------------------------------------------ */
async function addTagToFile(path, tag) {
  tag = (tag || '').trim().toLowerCase();
  if (!tag) return;
  const node = byId(_selectedId);
  const f = node && node.files.find(x => x.path === path);
  if (f && !f.tags.includes(tag)) { f.tags.push(tag); await persist(); renderFiles(); renderInspector(); }
}
async function removeTagFromFile(path, tag) {
  const node = byId(_selectedId);
  const f = node && node.files.find(x => x.path === path);
  if (f) { f.tags = f.tags.filter(x => x !== tag); await persist(); renderFiles(); renderInspector(); }
}

/* ------------------------------------------------------------------ *
 *  Shell HTML
 * ------------------------------------------------------------------ */
function buildHTML() {
  return `
<div class="cl-root">
  <aside class="cl-tree-panel">
    <div class="cl-panel-header">
      <span>${esc(t('collections.title'))}</span>
      <button id="cl-new-root" class="cl-icon-btn" title="${esc(t('collections.new'))}">+</button>
    </div>
    <div id="cl-tree" class="cl-tree"></div>
  </aside>

  <main class="cl-files-panel">
    <div id="cl-queue-banner" class="cl-queue-banner" style="display:none"></div>
    <div class="cl-files-toolbar">
      <div class="cl-toolbar-left">
        <h3 id="cl-files-title">—</h3>
        <span id="cl-files-count" class="cl-files-count"></span>
      </div>
      <div class="cl-toolbar-right">
        <input id="cl-search" class="cl-search" type="search" placeholder="${esc(t('collections.searchPh'))}"/>
        <button id="cl-add-files" class="cl-btn-secondary" disabled>+ ${esc(t('collections.addFiles'))}</button>
        <button id="cl-ai" class="cl-btn-primary" disabled>✨ ${esc(t('collections.aiClassify'))}</button>
      </div>
    </div>
    <div id="cl-tag-chips" class="cl-tag-chips"></div>
    <div id="cl-selbar" class="cl-selbar" style="display:none"></div>
    <div id="cl-grid" class="cl-grid"></div>
  </main>

  <aside class="cl-inspector" id="cl-inspector"></aside>
</div>`;
}

function wireStatic() {
  const sig = _abort.signal;
  document.getElementById('cl-new-root')?.addEventListener('click', () => createNode(null), { signal: sig });
  document.getElementById('cl-add-files')?.addEventListener('click', addFilesToSelected, { signal: sig });
  document.getElementById('cl-ai')?.addEventListener('click', classifyWithAI, { signal: sig });
  document.getElementById('cl-search')?.addEventListener('input', (e) => { _search = e.target.value; renderFiles(); }, { signal: sig });
}

/* ------------------------------------------------------------------ *
 *  Tree rendering
 * ------------------------------------------------------------------ */
function renderTree() {
  const host = document.getElementById('cl-tree');
  if (!host) return;
  if (!_nodes.length) {
    host.innerHTML = `<div class="cl-empty-tree">${esc(t('collections.emptyTree'))}</div>`;
    return;
  }
  const roots = childrenOf(null);
  host.innerHTML = roots.map(r => renderNode(r, 0)).join('');
  wireTree();
}

function renderNode(node, depth, _visited = new Set()) {
  // Prevent infinite recursion from circular parent references
  if (_visited.has(node.id)) {
    console.warn('Circular reference detected in collections tree, skipping:', node.id);
    return '';
  }
  _visited.add(node.id);
  
  const kids = childrenOf(node.id);
  const hasKids = kids.length > 0;
  const isOpen = _expanded.has(node.id);
  const active = node.id === _selectedId;
  const count = fileCount(node.id);
  const caret = hasKids
    ? `<span class="cl-caret ${isOpen ? 'open' : ''}" data-toggle="${node.id}">▸</span>`
    : `<span class="cl-caret cl-caret-empty"></span>`;
  let html = `
    <div class="cl-node ${active ? 'active' : ''}" data-id="${node.id}" style="padding-left:${8 + depth * 14}px">
      ${caret}
      <svg class="cl-node-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      </svg>
      <span class="cl-node-name" data-id="${node.id}">${esc(node.name)}</span>
      <span class="cl-node-count">${count}</span>
      <span class="cl-node-actions">
        <button class="cl-node-btn" data-addsub="${node.id}" title="${esc(t('collections.newSub'))}">+</button>
        <button class="cl-node-btn" data-del="${node.id}" title="${esc(t('collections.delete'))}">🗑</button>
      </span>
    </div>`;
  if (hasKids && isOpen) html += kids.map(k => renderNode(k, depth + 1, _visited)).join('');
  return html;
}

function wireTree() {
  const sig = _abort.signal;
  document.querySelectorAll('.cl-node').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle]') || e.target.closest('[data-addsub]') ||
          e.target.closest('[data-del]') || e.target.closest('input')) return;
      _selectedId = el.dataset.id;
      _selectedFiles.clear(); _tagFilter = null; _search = '';
      const sb = document.getElementById('cl-search'); if (sb) sb.value = '';
      renderTree(); renderFiles(); renderInspector();
    }, { signal: sig });
  });
  document.querySelectorAll('[data-toggle]').forEach(c => {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = c.dataset.toggle;
      if (_expanded.has(id)) _expanded.delete(id); else _expanded.add(id);
      renderTree();
    }, { signal: sig });
  });
  document.querySelectorAll('[data-addsub]').forEach(b => {
    b.addEventListener('click', (e) => { e.stopPropagation(); createNode(b.dataset.addsub); }, { signal: sig });
  });
  document.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = byId(b.dataset.del);
      if (n && confirm(t('collections.confirmDelete', { name: n.name }))) removeNode(b.dataset.del);
    }, { signal: sig });
  });
  document.querySelectorAll('.cl-node-name').forEach(el => {
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); beginRename(el.dataset.id); }, { signal: sig });
  });
}

function beginRename(id) {
  const el = document.querySelector(`.cl-node-name[data-id="${id}"]`);
  if (!el) return;
  const node = byId(id);
  const input = document.createElement('input');
  input.className = 'cl-rename-input';
  input.value = node ? node.name : '';
  el.replaceWith(input);
  input.focus(); input.select();
  const commit = () => renameNode(id, input.value);
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = node.name; input.blur(); } });
}

/* ------------------------------------------------------------------ *
 *  Files rendering
 * ------------------------------------------------------------------ */
function currentFiles() {
  const node = byId(_selectedId);
  return node ? node.files : [];
}

function visibleFiles() {
  let files = currentFiles().slice();
  if (_tagFilter) files = files.filter(f => (f.tags || []).includes(_tagFilter));
  if (_search) {
    const q = _search.toLowerCase();
    files = files.filter(f => (f.name || '').toLowerCase().includes(q) ||
                              (f.tags || []).some(tg => tg.includes(q)) ||
                              (f.category || '').toLowerCase().includes(q));
  }
  return files;
}

function renderFiles() {
  const node = byId(_selectedId);
  const titleEl = document.getElementById('cl-files-title');
  const countEl = document.getElementById('cl-files-count');
  const addBtn = document.getElementById('cl-add-files');
  const aiBtn = document.getElementById('cl-ai');
  const grid = document.getElementById('cl-grid');
  if (!grid) return;

  if (!node) {
    if (titleEl) titleEl.textContent = '—';
    if (countEl) countEl.textContent = '';
    if (addBtn) addBtn.disabled = true;
    if (aiBtn) aiBtn.disabled = true;
    grid.innerHTML = `<div class="cl-empty-grid">${esc(t('collections.selectPrompt'))}</div>`;
    document.getElementById('cl-tag-chips').innerHTML = '';
    return;
  }

  if (titleEl) titleEl.textContent = node.name;
  if (countEl) countEl.textContent = t('collections.filesCount', { n: node.files.length });
  if (addBtn) addBtn.disabled = false;
  if (aiBtn) aiBtn.disabled = node.files.length === 0 || !resolveVisionProvider();

  renderTagChips();
  renderSelBar();

  const files = visibleFiles();
  if (!files.length) {
    grid.innerHTML = `<div class="cl-empty-grid">${node.files.length ? esc(t('collections.noMatch')) : esc(t('collections.emptyFiles'))}</div>`;
    return;
  }

  grid.innerHTML = files.map(f => {
    const sel = _selectedFiles.has(f.path);
    const preview = f.preview ? renderPreview(f.preview) : `<span class="cl-thumb-ph">${esc((f.ext || '').toUpperCase())}</span>`;
    const cat = f.category ? `<span class="cl-cat">${esc(f.category)}</span>` : '';
    const tags = (f.tags || []).map(tg => `<span class="cl-tag">${esc(tg)}<button class="cl-tag-x" data-rmtag="${esc(tg)}" data-path="${esc(f.path)}">×</button></span>`).join('');
    return `
    <div class="cl-card ${sel ? 'sel' : ''}" data-path="${esc(f.path)}">
      <input type="checkbox" class="cl-card-check" data-path="${esc(f.path)}" ${sel ? 'checked' : ''}/>
      <button class="cl-card-remove" data-remove="${esc(f.path)}" title="${esc(t('collections.removeFromCollection'))}">×</button>
      <div class="cl-thumb">${preview}</div>
      <div class="cl-card-name" title="${esc(f.name)}">${esc(f.name)}</div>
      ${cat}
      <div class="cl-card-tags">${tags}<button class="cl-add-tag" data-addtag="${esc(f.path)}">+ ${esc(t('collections.addTag'))}</button></div>
    </div>`;
  }).join('');

  wireFiles();
  loadThumbnails();
}

function renderTagChips() {
  const host = document.getElementById('cl-tag-chips');
  if (!host) return;
  const counts = {};
  currentFiles().forEach(f => (f.tags || []).forEach(tg => { counts[tg] = (counts[tg] || 0) + 1; }));
  const tags = Object.keys(counts).sort();
  if (!tags.length) { host.innerHTML = ''; return; }
  let html = `<div class="cl-chip ${_tagFilter === null ? 'active' : ''}" data-tag="__all__">${esc(t('collections.tagFilterAll'))}</div>`;
  html += tags.map(tg => `<div class="cl-chip ${_tagFilter === tg ? 'active' : ''}" data-tag="${esc(tg)}">${esc(tg)} (${counts[tg]})</div>`).join('');
  host.innerHTML = html;
  const sig = _abort.signal;
  host.querySelectorAll('.cl-chip').forEach(c => c.addEventListener('click', () => {
    _tagFilter = c.dataset.tag === '__all__' ? null : c.dataset.tag;
    renderFiles();
  }, { signal: sig }));
}

function renderSelBar() {
  const bar = document.getElementById('cl-selbar');
  if (!bar) return;
  if (!_selectedFiles.size) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  const moveOpts = _nodes.filter(n => n.id !== _selectedId)
    .map(n => `<option value="${n.id}">${esc(nodePath(n.id))}</option>`).join('');
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="cl-sel-count">${esc(t('collections.selectedCount', { n: _selectedFiles.size }))}</span>
    <button id="cl-sel-clear" class="cl-btn-link">${esc(t('collections.clearSel'))}</button>
    ${moveOpts ? `<span class="cl-move-wrap"><label>${esc(t('collections.moveTo'))}</label><select id="cl-move-select" class="cl-move-select"><option value="">—</option>${moveOpts}</select></span>` : ''}
    <button id="cl-sel-remove" class="cl-btn-danger">${esc(t('collections.removeFromCollection'))}</button>`;
  const sig = _abort.signal;
  document.getElementById('cl-sel-clear')?.addEventListener('click', () => { _selectedFiles.clear(); renderFiles(); renderInspector(); }, { signal: sig });
  document.getElementById('cl-sel-remove')?.addEventListener('click', async () => {
    const node = byId(_selectedId);
    if (node) { node.files = node.files.filter(f => !_selectedFiles.has(f.path)); _selectedFiles.clear(); await persist(); renderTree(); renderFiles(); renderInspector(); }
  }, { signal: sig });
  document.getElementById('cl-move-select')?.addEventListener('change', async (e) => {
    const target = e.target.value;
    if (target) { await moveFilesToNode([..._selectedFiles], target); _selectedFiles.clear(); renderTree(); renderFiles(); renderInspector(); }
  }, { signal: sig });
}

function nodePath(id) {
  const parts = [];
  let n = byId(id);
  while (n) { parts.unshift(n.name); n = n.parentId ? byId(n.parentId) : null; }
  return parts.join(' / ');
}

function wireFiles() {
  const sig = _abort.signal;
  document.querySelectorAll('.cl-card-check').forEach(cb => cb.addEventListener('change', () => {
    const p = cb.dataset.path;
    if (cb.checked) _selectedFiles.add(p); else _selectedFiles.delete(p);
    cb.closest('.cl-card')?.classList.toggle('sel', cb.checked);
    renderSelBar();
  }, { signal: sig }));
  document.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation(); removeFileFromSelected(b.dataset.remove);
  }, { signal: sig }));
  document.querySelectorAll('[data-rmtag]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation(); removeTagFromFile(b.dataset.path, b.dataset.rmtag);
  }, { signal: sig }));
  document.querySelectorAll('[data-addtag]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const path = b.dataset.addtag;
    const input = document.createElement('input');
    input.className = 'cl-tag-input';
    input.placeholder = t('collections.tagPh');
    b.replaceWith(input); input.focus();
    const commit = () => { const v = input.value; addTagToFile(path, v); };
    input.addEventListener('blur', () => { if (input.value.trim()) commit(); else renderFiles(); }, { once: true });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') renderFiles(); });
  }, { signal: sig }));
  document.querySelectorAll('.cl-card').forEach(card => card.addEventListener('click', (e) => {
    if (e.target.closest('input') || e.target.closest('button')) return;
    renderInspector(card.dataset.path);
  }, { signal: sig }));
}

/* ------------------------------------------------------------------ *
 *  Thumbnails
 * ------------------------------------------------------------------ */
async function loadThumbnails() {
  const files = currentFiles().filter(f => !f.preview && !f._thumbTried);
  if (!files.length) return;
  const items = files.map(f => ({ path: f.path, mtime: f.mtime || 0 }));
  const byPath = new Map(currentFiles().map(f => [f.path, f]));
  try {
    _thumbReq = await window.api.getThumbsCached(items, (entry) => {
      if (entry.type === 'thumb') {
        const f = byPath.get(entry.path);
        if (f) {
          f._thumbTried = true;
          f.preview = entry.preview || null;
          const m = entry.meta || {};
          f.stitches = m.stitch_count; f.colors = m.color_count;
          f.width = m.width_mm; f.height = m.height_mm; f.threads = m.threads || [];
        }
      } else if (entry.type === 'done') {
        _thumbReq = null;
        files.forEach(f => { f._thumbTried = true; });
        renderFiles();
      }
    });
  } catch (err) { console.error('Collections thumbnail error:', err); }
}

function renderPreview(preview) {
  if (!preview || !Array.isArray(preview.lines) || !preview.lines.length) return '';
  const left = preview.left || 0, top = preview.top || 0;
  const width = preview.width || 1, height = preview.height || 1;
  const strokeW = Math.max(Math.max(width, height) / 120, 0.4);
  const paths = preview.lines.map(line => {
    const pts = line.pts || [];
    if (pts.length < 2) return '';
    const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ');
    return `<path d="${d}" stroke="${esc(line.hex || '#888')}" fill="none" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<svg viewBox="${left} ${top} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

/* ------------------------------------------------------------------ *
 *  Inspector (right column)
 * ------------------------------------------------------------------ */
let _inspectPath = null;
function renderInspector(path) {
  if (path !== undefined) _inspectPath = path;
  const host = document.getElementById('cl-inspector');
  if (!host) return;
  const node = byId(_selectedId);
  const f = node && _inspectPath ? node.files.find(x => x.path === _inspectPath) : null;
  if (!f) {
    host.innerHTML = `<div class="cl-inspect-empty">${esc(t('collections.inspectEmpty'))}</div>`;
    return;
  }
  const preview = f.preview ? renderPreview(f.preview) : `<span class="cl-thumb-ph">${esc((f.ext || '').toUpperCase())}</span>`;
  const tags = (f.tags || []).map(tg => `<span class="cl-tag">${esc(tg)}<button class="cl-tag-x" data-rmtag="${esc(tg)}" data-path="${esc(f.path)}">×</button></span>`).join('');
  host.innerHTML = `
    <div class="cl-inspect-preview">${preview}</div>
    <div class="cl-inspect-name">${esc(f.name)}</div>
    <table class="cl-inspect-meta">
      <tr><td>${esc(t('gallery.detail.format'))}</td><td>${esc((f.ext || '').toUpperCase())}</td></tr>
      <tr><td>${esc(t('gallery.detail.stitches'))}</td><td>${f.stitches != null ? Number(f.stitches).toLocaleString() : '—'}</td></tr>
      <tr><td>${esc(t('gallery.detail.colors'))}</td><td>${f.colors != null ? f.colors : '—'}</td></tr>
      <tr><td>${esc(t('collections.category'))}</td><td>${f.category ? esc(f.category) : '—'}</td></tr>
    </table>
    <div class="cl-inspect-tags-label">${esc(t('collections.tags'))}</div>
    <div class="cl-inspect-tags">${tags}<button class="cl-add-tag" data-addtag="${esc(f.path)}">+ ${esc(t('collections.addTag'))}</button></div>`;
  wireFiles();
}

/* ------------------------------------------------------------------ *
 *  Queue banner (Gallery hand-off)
 * ------------------------------------------------------------------ */
function showQueueBanner(files) {
  const banner = document.getElementById('cl-queue-banner');
  if (!banner) return;
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span>${esc(t('collections.queueBanner', { n: files.length }))}</span>
    <span class="cl-banner-actions">
      <button id="cl-queue-add" class="cl-btn-primary" ${_selectedId ? '' : 'disabled'}>${esc(t('collections.addHere'))}</button>
      <button id="cl-queue-dismiss" class="cl-btn-link">${esc(t('collections.dismiss'))}</button>
    </span>`;
  const sig = _abort.signal;
  document.getElementById('cl-queue-add')?.addEventListener('click', async () => {
    if (_selectedId) {
      await addFileObjectsToNode(_selectedId, files);
      window.store?.set('collectionsQueue', []);
      banner.style.display = 'none';
    }
  }, { signal: sig });
  document.getElementById('cl-queue-dismiss')?.addEventListener('click', () => {
    window.store?.set('collectionsQueue', []);
    banner.style.display = 'none';
  }, { signal: sig });
}

/* ------------------------------------------------------------------ *
 *  AI classification (vision model on thumbnails)
 * ------------------------------------------------------------------ */
/**
 * Resolve the AI provider that should perform vision classification.
 * Requires: AI enabled globally, the active provider enabled, vision capability
 * on, and the autoClassify allowance granted. Returns null when unusable.
 */
function resolveVisionProvider() {
  const ai = window.store?.get('settings.ai') || {};
  if (!ai.enabled || !Array.isArray(ai.providers) || !ai.providers.length) return null;
  let p = ai.providers.find(x => x.id === ai.activeProviderId);
  if (!p) p = ai.providers.find(x => x.enabled !== false) || ai.providers[0];
  if (!p) return null;
  if (p.enabled === false) return null;
  if (p.capabilities && p.capabilities.vision === false) return null;
  if (p.allow && p.allow.autoClassify === false) return null;
  return { ai, provider: p };
}

async function classifyWithAI() {
  const resolved = resolveVisionProvider();
  if (!resolved) {
    alert(t('collections.aiDisabled'));
    return;
  }
  const { ai, provider } = resolved;
  const node = byId(_selectedId);
  if (!node || !node.files.length) return;

  const aiBtn = document.getElementById('cl-ai');
  const targets = _selectedFiles.size
    ? node.files.filter(f => _selectedFiles.has(f.path))
    : node.files.slice();

  // Ensure previews are available (needed to rasterize)
  const missing = targets.filter(f => !f.preview);
  if (missing.length) {
    await new Promise((resolve) => {
      const items = missing.map(f => ({ path: f.path, mtime: f.mtime || 0 }));
      const byPath = new Map(missing.map(f => [f.path, f]));
      window.api.getThumbsCached(items, (entry) => {
        if (entry.type === 'thumb') { const f = byPath.get(entry.path); if (f) { f.preview = entry.preview; f._thumbTried = true; } }
        else if (entry.type === 'done') resolve();
      }).catch(resolve);
    });
  }

  if (aiBtn) { aiBtn.disabled = true; aiBtn.textContent = '✨ ' + t('collections.aiClassifying'); }

  // Rasterize each preview to a PNG data URL
  const items = [];
  for (const f of targets) {
    const img = rasterize(f.preview, 256);
    if (img) items.push({ id: f.path, image: img });
  }

  if (!items.length) {
    if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '✨ ' + t('collections.aiClassify'); }
    alert(t('collections.aiNoPreview'));
    return;
  }

  // Existing categories (sibling collection names) to bias the model
  const categories = _nodes.map(n => n.name).filter((v, i, a) => a.indexOf(v) === i);

  try {
    const r = await window.api.aiClassify({ items, categories, autoTag: ai.autoTag !== false, providerId: provider.id });
    if (!r || !r.ok) throw new Error(r && r.error ? r.error : 'unknown');
    // Apply results
    const map = new Map(node.files.map(f => [f.path, f]));
    (r.results || []).forEach(res => {
      const f = map.get(res.id);
      if (!f) return;
      if (res.category) f.category = res.category;
      if (Array.isArray(res.tags)) {
        res.tags.forEach(tg => { const tt = String(tg).trim().toLowerCase(); if (tt && !f.tags.includes(tt)) f.tags.push(tt); });
      }
    });
    await persist();
    renderFiles(); renderInspector(_inspectPath);
    alert(t('collections.aiDone', { n: (r.results || []).length }));
  } catch (err) {
    console.error('AI classify error:', err);
    alert(t('collections.aiFailed') + ': ' + (err.message || err));
  } finally {
    if (aiBtn) { aiBtn.disabled = false; aiBtn.textContent = '✨ ' + t('collections.aiClassify'); }
  }
}

/** Render a preview (polylines) to a PNG data URL on a white background. */
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

/* ------------------------------------------------------------------ *
 *  CSS
 * ------------------------------------------------------------------ */
function injectCSS() {
  if (document.getElementById('cl-styles')) return;
  const style = document.createElement('style');
  style.id = 'cl-styles';
  style.textContent = `
.cl-root { display:grid; grid-template-columns: 260px 1fr 260px; height:100%; background:var(--surface,#f6f7fb); color:var(--fg,#1f2430); }
.cl-tree-panel { background:var(--panel-bg,#fff); border-right:1px solid var(--border,#e2e5ee); display:flex; flex-direction:column; overflow:hidden; }
.cl-panel-header { display:flex; align-items:center; justify-content:space-between; padding:14px 14px 10px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted,#6b7280); }
.cl-icon-btn { width:24px; height:24px; border:1px solid var(--border,#d8dbe6); border-radius:6px; background:var(--input-bg,#fff); color:var(--fg,#2a2f3a); font-size:16px; line-height:1; cursor:pointer; }
.cl-icon-btn:hover { background:var(--hover-bg,#eef0f6); border-color:#7c5cff; }
.cl-tree { flex:1; overflow-y:auto; padding:4px 6px 12px; }
.cl-empty-tree { padding:20px 14px; font-size:12.5px; color:var(--muted,#8a90a0); line-height:1.5; text-align:center; }
.cl-node { display:flex; align-items:center; gap:5px; padding:6px 8px; border-radius:7px; cursor:pointer; font-size:13px; position:relative; }
.cl-node:hover { background:var(--hover-bg,#eef0f6); }
.cl-node.active { background:var(--accent-subtle,#ece9fb); color:#5b3fd6; font-weight:600; }
.cl-caret { width:14px; font-size:10px; color:var(--muted,#9aa0ad); transition:transform .15s; flex-shrink:0; text-align:center; cursor:pointer; }
.cl-caret.open { transform:rotate(90deg); }
.cl-caret-empty { cursor:default; }
.cl-node-icon { width:16px; height:16px; flex-shrink:0; color:#a98bff; }
.cl-node.active .cl-node-icon { color:#7c5cff; }
.cl-node-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cl-node-count { font-size:11px; color:var(--muted,#9aa0ad); background:var(--surface,#eef0f6); border-radius:10px; padding:1px 7px; }
.cl-node-actions { display:none; gap:2px; }
.cl-node:hover .cl-node-actions { display:flex; }
.cl-node-btn { border:none; background:none; cursor:pointer; font-size:12px; padding:2px 4px; border-radius:4px; color:var(--muted,#6b7280); }
.cl-node-btn:hover { background:#fff; color:#7c5cff; }
.cl-rename-input, .cl-tag-input { font-size:13px; padding:2px 6px; border:1px solid #7c5cff; border-radius:5px; background:#fff; color:var(--fg,#1f2430); flex:1; min-width:0; }

.cl-files-panel { display:flex; flex-direction:column; overflow:hidden; }
.cl-queue-banner { align-items:center; justify-content:space-between; gap:12px; padding:10px 16px; background:#ece9fb; border-bottom:1px solid #d9d2f7; font-size:13px; color:#5b3fd6; }
.cl-banner-actions { display:flex; align-items:center; gap:10px; }
.cl-files-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 18px; border-bottom:1px solid var(--border,#e2e5ee); background:var(--panel-bg,#fff); }
.cl-toolbar-left { display:flex; align-items:baseline; gap:10px; min-width:0; }
.cl-toolbar-left h3 { margin:0; font-size:16px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cl-files-count { font-size:12px; color:var(--muted,#8a90a0); }
.cl-toolbar-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.cl-search { padding:7px 11px; border:1px solid var(--border,#d8dbe6); border-radius:7px; font-size:13px; background:var(--input-bg,#fff); color:var(--fg,#1f2430); width:180px; }
.cl-search:focus { outline:none; border-color:#7c5cff; }
.cl-btn-primary { padding:8px 14px; background:#7c5cff; color:#fff; border:none; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
.cl-btn-primary:hover:not(:disabled) { background:#6b4ae6; }
.cl-btn-primary:disabled { opacity:.45; cursor:not-allowed; }
.cl-btn-secondary { padding:8px 12px; background:var(--panel-bg,#fff); color:var(--fg,#2a2f3a); border:1px solid var(--border,#d8dbe6); border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
.cl-btn-secondary:hover:not(:disabled) { background:var(--hover-bg,#eef0f6); }
.cl-btn-secondary:disabled { opacity:.45; cursor:not-allowed; }
.cl-btn-danger { padding:6px 12px; background:none; color:#d64545; border:1px solid #e6b8b8; border-radius:6px; font-size:12px; cursor:pointer; }
.cl-btn-danger:hover { background:#fbeaea; }
.cl-btn-link { border:none; background:none; color:#7c5cff; font-size:12.5px; cursor:pointer; text-decoration:underline; }
.cl-tag-chips { display:flex; flex-wrap:wrap; gap:6px; padding:10px 18px; }
.cl-tag-chips:empty { display:none; }
.cl-chip { padding:3px 11px; border-radius:14px; font-size:11.5px; background:var(--panel-bg,#fff); border:1px solid var(--border,#d8dbe6); cursor:pointer; }
.cl-chip:hover { border-color:#7c5cff; }
.cl-chip.active { background:#7c5cff; color:#fff; border-color:#7c5cff; }
.cl-selbar { align-items:center; gap:14px; padding:8px 18px; background:#ece9fb; font-size:12.5px; }
.cl-sel-count { font-weight:600; color:#5b3fd6; }
.cl-move-wrap { display:flex; align-items:center; gap:6px; }
.cl-move-select { padding:4px 8px; border:1px solid var(--border,#d8dbe6); border-radius:6px; font-size:12px; background:#fff; }
.cl-grid { flex:1; overflow-y:auto; padding:16px 18px; display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; align-content:start; }
.cl-empty-grid { grid-column:1/-1; padding:50px 20px; text-align:center; color:var(--muted,#8a90a0); font-size:13.5px; }
.cl-card { position:relative; background:var(--panel-bg,#fff); border:1px solid var(--border,#e2e5ee); border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:7px; transition:box-shadow .15s,border-color .15s; }
.cl-card:hover { box-shadow:0 3px 12px rgba(80,60,160,.12); }
.cl-card.sel { border-color:#7c5cff; box-shadow:0 0 0 2px rgba(124,92,255,.2); }
.cl-card-check { position:absolute; top:8px; left:8px; width:16px; height:16px; cursor:pointer; z-index:2; }
.cl-card-remove { position:absolute; top:6px; right:6px; width:20px; height:20px; border:none; background:rgba(255,255,255,.85); border-radius:50%; color:#d64545; font-size:14px; line-height:1; cursor:pointer; z-index:2; }
.cl-card-remove:hover { background:#fbeaea; }
.cl-thumb { aspect-ratio:1/1; background:var(--surface,#f6f7fb); border-radius:7px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.cl-thumb svg { width:100%; height:100%; }
.cl-thumb-ph { font-size:12px; font-weight:700; color:var(--muted,#b3b8c4); }
.cl-card-name { font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cl-cat { display:inline-block; align-self:flex-start; font-size:10.5px; font-weight:600; color:#5b3fd6; background:#ece9fb; padding:1px 8px; border-radius:10px; }
.cl-card-tags { display:flex; flex-wrap:wrap; gap:4px; }
.cl-tag { display:inline-flex; align-items:center; gap:3px; font-size:10.5px; background:var(--surface,#eef0f6); border:1px solid var(--border,#dde0ea); border-radius:9px; padding:1px 4px 1px 8px; color:var(--fg,#4a4f5c); }
.cl-tag-x { border:none; background:none; color:#9aa0ad; cursor:pointer; font-size:12px; line-height:1; padding:0 2px; }
.cl-tag-x:hover { color:#d64545; }
.cl-add-tag { border:1px dashed var(--border,#cfd3df); background:none; border-radius:9px; font-size:10.5px; padding:1px 8px; color:var(--muted,#8a90a0); cursor:pointer; }
.cl-add-tag:hover { border-color:#7c5cff; color:#7c5cff; }

.cl-inspector { background:var(--panel-bg,#fff); border-left:1px solid var(--border,#e2e5ee); overflow-y:auto; padding:18px 16px; }
.cl-inspect-empty { color:var(--muted,#8a90a0); font-size:12.5px; text-align:center; padding-top:40px; line-height:1.5; }
.cl-inspect-preview { aspect-ratio:1/1; background:var(--surface,#f6f7fb); border:1px solid var(--border,#e2e5ee); border-radius:10px; display:flex; align-items:center; justify-content:center; overflow:hidden; margin-bottom:12px; }
.cl-inspect-preview svg { width:100%; height:100%; }
.cl-inspect-name { font-size:14px; font-weight:700; margin-bottom:12px; word-break:break-word; }
.cl-inspect-meta { width:100%; border-collapse:collapse; font-size:12.5px; margin-bottom:14px; }
.cl-inspect-meta td { padding:5px 0; border-bottom:1px solid var(--border,#eef0f4); }
.cl-inspect-meta td:first-child { color:var(--muted,#8a90a0); }
.cl-inspect-meta td:last-child { text-align:right; font-weight:600; }
.cl-inspect-tags-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted,#8a90a0); margin-bottom:8px; }
.cl-inspect-tags { display:flex; flex-wrap:wrap; gap:5px; }
`;
  document.head.appendChild(style);
}
function removeCSS() { document.getElementById('cl-styles')?.remove(); }

/* ------------------------------------------------------------------ *
 *  Register
 * ------------------------------------------------------------------ */
window.registerView('collections', { mount, unmount });
})();
