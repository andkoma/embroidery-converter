/**
 * Projects View
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Manage embroidery projects: organize designs, images, documents, and notes
 * into a hierarchical folder structure with versioning support. Export to
 * .ecproj packages for sharing and archival.
 *
 * Three-column layout: tree | assets | inspector
 */
(function() {
'use strict';

const STYLE_ID = 'pv-styles';
const HOST_ID = 'projects';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Localization helper */
function t(key, params) {
  const lang = window.store ? window.store.get('language', 'en') : 'en';
  const dict = window.I18N ? window.I18N[lang] || {} : {};
  let val = dict[key] || key;
  if (params) {
    Object.keys(params).forEach(k => {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
  }
  return val;
}

/** HTML-escape */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Generate unique ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Get asset kind using window.Grouping helper */
function assetKind(path) {
  return window.Grouping ? window.Grouping.assetKind(path) : 'document';
}

/** Check if kind has visual preview */
function isVisualKind(kind) {
  return window.Grouping ? window.Grouping.isVisualKind(kind) : kind === 'embroidery' || kind === 'image';
}

/** Render preview SVG using window.Grouping helper */
function renderPreviewSVG(preview) {
  return window.Grouping ? window.Grouping.renderPreviewSVG(preview) : '';
}

// ----------------------------------------------------------------
// State
// ----------------------------------------------------------------

let _tree = null;           // Grouping tree instance
let _activeProject = null;  // Currently selected project ID
let _activeAsset = null;    // Currently inspected asset ID
let _abortCtrl = null;      // AbortController for event cleanup
let _hostEl = null;         // Host DOM element for this view

// ----------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------

function loadProjects() {
  const settings = window.api ? window.api.getSettings().then(s => s.projects || []) : Promise.resolve([]);
  return settings;
}

function saveProjects(nodes) {
  if (!window.api) return;
  window.api.setSettings({ projects: nodes });
}

// ----------------------------------------------------------------
// Tree Management
// ----------------------------------------------------------------

function initTree(nodes) {
  if (!window.Grouping) {
    console.error('window.Grouping not loaded — tree helpers unavailable');
    _tree = { nodes: [] };
    return;
  }
  _tree = window.Grouping.createTree(nodes || []);
}

function getTreeNodes() {
  return _tree ? _tree.nodes : [];
}

function addProject(name) {
  if (!_tree) return;
  const id = uid();
  _tree.addNode(null, name || t('projects.newProject'), {
    id,
    type: 'project',
    createdAt: Date.now(),
    assets: [],
    subfolders: []
  });
  saveProjects(getTreeNodes());
  renderTree();
  selectProject(id);
}

function addFolder(parentId, name) {
  if (!_tree) return;
  const id = uid();
  _tree.addNode(parentId, name || t('projects.newFolder'), {
    id,
    type: 'folder',
    createdAt: Date.now(),
    assets: []
  });
  saveProjects(getTreeNodes());
  renderTree();
}

function removeNode(id) {
  if (!_tree) return;
  _tree.removeNode(id);
  saveProjects(getTreeNodes());
  if (_activeProject === id || _tree.descendantIds(id).includes(_activeProject)) {
    _activeProject = null;
  }
  renderTree();
  renderAssets();
}

function renameNode(id, newName) {
  if (!_tree) return;
  _tree.renameNode(id, newName);
  saveProjects(getTreeNodes());
  renderTree();
}

function selectProject(id) {
  _activeProject = id;
  _activeAsset = null;
  renderTree();
  renderAssets();
  renderInspector();
}

// ----------------------------------------------------------------
// Asset Management
// ----------------------------------------------------------------

async function addAssets(projectId) {
  if (!window.api) return;
  
  const paths = await window.api.openAnyFiles();
  if (!paths || paths.length === 0) return;
  
  const node = _tree.byId(projectId);
  if (!node) return;
  
  if (!node.assets) node.assets = [];
  
  // Add each file as an asset
  for (const path of paths) {
    try {
      const stats = await window.api.statDir(path);
      if (!stats.exists || stats.isDir) continue;
      
      const kind = assetKind(path);
      const assetId = uid();
      
      const asset = {
        id: assetId,
        name: path.split('/').pop().split('\\').pop(),
        path,
        kind,
        size: stats.size || 0,
        mtime: stats.mtime || Date.now(),
        addedAt: Date.now(),
        versions: [{
          id: uid(),
          path,
          mtime: stats.mtime || Date.now(),
          label: 'Original',
          isActive: true
        }],
        tags: [],
        category: '',
        notes: ''
      };
      
      // Fetch preview for visual assets
      if (isVisualKind(kind) && kind === 'embroidery' && window.api.getThumbnail) {
        try {
          const thumb = await window.api.getThumbnail(path, asset.mtime);
          if (thumb && thumb.preview) {
            asset.preview = thumb.preview;
          }
        } catch (err) {
          console.warn('Failed to get thumbnail for', path, err);
        }
      }
      
      node.assets.push(asset);
    } catch (err) {
      console.error('Failed to add asset', path, err);
    }
  }
  
  saveProjects(getTreeNodes());
  renderAssets();
}

function removeAsset(assetId) {
  if (!_activeProject || !_tree) return;
  
  const node = _tree.byId(_activeProject);
  if (!node || !node.assets) return;
  
  node.assets = node.assets.filter(a => a.id !== assetId);
  saveProjects(getTreeNodes());
  
  if (_activeAsset === assetId) {
    _activeAsset = null;
  }
  
  renderAssets();
  renderInspector();
}

function selectAsset(assetId) {
  _activeAsset = assetId;
  renderAssets();
  renderInspector();
}

// ----------------------------------------------------------------
// Export / Import
// ----------------------------------------------------------------

async function exportProject(projectId) {
  if (!window.api || !_tree) return;
  
  const project = _tree.byId(projectId);
  if (!project) {
    console.error('Project not found:', projectId);
    return;
  }
  
  // Build manifest
  const manifest = {
    version: 1,
    name: project.name,
    createdAt: project.createdAt,
    exportedAt: Date.now(),
    tree: project,
    assets: project.assets || []
  };
  
  // Collect previews
  const previews = (project.assets || [])
    .filter(a => a.preview)
    .map(a => ({ id: a.id, preview: a.preview }));
  
  const result = await window.api.projectExport({ manifest, assets: project.assets || [], previews });
  
  if (result.success) {
    alert(t('projects.exportSuccess').replace('{path}', result.path));
  } else {
    alert(t('projects.exportFailed').replace('{error}', result.error || 'Unknown error'));
  }
}

async function importProject() {
  if (!window.api || !_tree) return;
  
  const result = await window.api.projectImport();
  
  if (result.success && result.manifest) {
    const imported = result.manifest.tree;
    imported.id = uid(); // Generate new ID to avoid conflicts
    imported.name = `${imported.name} (Imported)`;
    
    _tree.addNode(imported);
    saveProjects(getTreeNodes());
    renderTree();
    selectProject(imported.id);
    
    alert(t('projects.importSuccess'));
  } else if (result.error && result.error !== 'Cancelled') {
    alert(t('projects.importFailed').replace('{error}', result.error));
  }
}

// ----------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------

function renderTree() {
  const container = document.getElementById('pv-tree');
  if (!container) return;
  
  const nodes = getTreeNodes();
  const projectNodes = nodes.filter(n => !n.parentId);
  
  let html = `
    <div class="pv-tree-header">
      <h3>${esc(t('projects.title'))}</h3>
      <div class="pv-tree-actions">
        <button id="pv-btn-new-project" class="btn-icon" title="${esc(t('projects.newProject'))}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3v10M3 8h10"/>
          </svg>
        </button>
        <button id="pv-btn-import" class="btn-icon" title="${esc(t('projects.import'))}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 12V4m0 8l-3-3m3 3l3-3M3 13h10"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="pv-tree-list">
  `;
  
  if (projectNodes.length === 0) {
    html += `<div class="pv-empty">${esc(t('projects.empty'))}</div>`;
  } else {
    projectNodes.forEach(proj => {
      const isActive = proj.id === _activeProject;
      const assetCount = (proj.assets || []).length;
      html += `
        <div class="pv-tree-node ${isActive ? 'active' : ''}" data-id="${esc(proj.id)}">
          <div class="pv-tree-node-content">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="3" width="12" height="10" rx="1"/>
              <path d="M2 6h12"/>
            </svg>
            <span class="pv-tree-node-name">${esc(proj.name)}</span>
            <span class="pv-tree-node-count">${assetCount}</span>
          </div>
          <div class="pv-tree-node-actions">
            <button class="btn-icon pv-btn-export" data-id="${esc(proj.id)}" title="${esc(t('projects.export'))}">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 4v8m0-8l-3 3m3-3l3 3M3 3h10"/>
              </svg>
            </button>
            <button class="btn-icon pv-btn-rename" data-id="${esc(proj.id)}" title="${esc(t('projects.rename'))}">✎</button>
            <button class="btn-icon pv-btn-remove" data-id="${esc(proj.id)}" title="${esc(t('projects.remove'))}">×</button>
          </div>
        </div>
      `;
    });
  }
  
  html += '</div>';
  container.innerHTML = html;
}

function renderAssets() {
  const container = document.getElementById('pv-assets');
  if (!container) return;
  
  if (!_activeProject || !_tree) {
    container.innerHTML = `<div class="pv-empty">${esc(t('projects.selectProject'))}</div>`;
    return;
  }
  
  const project = _tree.byId(_activeProject);
  if (!project) {
    container.innerHTML = `<div class="pv-empty">${esc(t('projects.projectNotFound'))}</div>`;
    return;
  }
  
  const assets = project.assets || [];
  
  let html = `
    <div class="pv-assets-header">
      <h3>${esc(project.name)} — ${t('projects.assets')}</h3>
      <button id="pv-btn-add-assets" class="btn-primary">${esc(t('projects.addAssets'))}</button>
    </div>
    <div class="pv-assets-grid">
  `;
  
  if (assets.length === 0) {
    html += `<div class="pv-empty">${esc(t('projects.noAssets'))}</div>`;
  } else {
    assets.forEach(asset => {
      const isActive = asset.id === _activeAsset;
      const kindLabel = t(`projects.kind.${asset.kind}`) || asset.kind;
      
      let previewHTML = '';
      if (asset.kind === 'embroidery' || asset.kind === 'image') {
        if (asset.preview) {
          previewHTML = `<div class="pv-asset-preview">${renderPreviewSVG(asset.preview)}</div>`;
        } else {
          previewHTML = `<div class="pv-asset-preview pv-asset-icon">🖼</div>`;
        }
      } else if (asset.kind === 'document') {
        previewHTML = `<div class="pv-asset-preview pv-asset-icon">📄</div>`;
      } else if (asset.kind === 'note') {
        previewHTML = `<div class="pv-asset-preview pv-asset-icon">📝</div>`;
      }
      
      html += `
        <div class="pv-asset-card ${isActive ? 'active' : ''}" data-id="${esc(asset.id)}">
          ${previewHTML}
          <div class="pv-asset-info">
            <div class="pv-asset-name" title="${esc(asset.path)}">${esc(asset.name)}</div>
            <div class="pv-asset-kind">${esc(kindLabel)}</div>
          </div>
        </div>
      `;
    });
  }
  
  html += '</div>';
  container.innerHTML = html;
}

function renderInspector() {
  const container = document.getElementById('pv-inspector');
  if (!container) return;
  
  if (!_activeAsset || !_activeProject || !_tree) {
    container.innerHTML = `<div class="pv-empty">${esc(t('projects.selectAsset'))}</div>`;
    return;
  }
  
  const project = _tree.byId(_activeProject);
  if (!project || !project.assets) {
    container.innerHTML = `<div class="pv-empty">${esc(t('projects.assetNotFound'))}</div>`;
    return;
  }
  
  const asset = project.assets.find(a => a.id === _activeAsset);
  if (!asset) {
    container.innerHTML = `<div class="pv-empty">${esc(t('projects.assetNotFound'))}</div>`;
    return;
  }
  
  let html = `
    <div class="pv-inspector-header">
      <h3>${esc(asset.name)}</h3>
      <button class="btn-icon pv-btn-remove-asset" data-id="${esc(asset.id)}" title="${esc(t('projects.removeAsset'))}">×</button>
    </div>
    
    <div class="pv-inspector-section">
      <h4>${esc(t('projects.details'))}</h4>
      <table class="pv-inspector-table">
        <tr><td>${esc(t('projects.path'))}:</td><td title="${esc(asset.path)}">${esc(asset.path)}</td></tr>
        <tr><td>${esc(t('projects.kind'))}:</td><td>${esc(t(`projects.kind.${asset.kind}`) || asset.kind)}</td></tr>
        <tr><td>${esc(t('projects.size'))}:</td><td>${formatBytes(asset.size)}</td></tr>
        <tr><td>${esc(t('projects.modified'))}:</td><td>${formatDate(asset.mtime)}</td></tr>
      </table>
    </div>
    
    <div class="pv-inspector-section">
      <h4>${esc(t('projects.notes'))}</h4>
      <textarea id="pv-notes" class="pv-notes-input" placeholder="${esc(t('projects.notesPlaceholder'))}">${esc(asset.notes || '')}</textarea>
    </div>
    
    <div class="pv-inspector-section">
      <h4>${esc(t('projects.tags'))}</h4>
      <input id="pv-tags" type="text" class="pv-input" placeholder="${esc(t('projects.tagsPlaceholder'))}" value="${esc((asset.tags || []).join(', '))}">
    </div>
  `;
  
  container.innerHTML = html;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ----------------------------------------------------------------
// Event Wiring
// ----------------------------------------------------------------

function wireEvents() {
  _abortCtrl = new AbortController();
  const sig = _abortCtrl.signal;
  const host = _hostEl;
  if (!host) return;
  
  // Tree events
  host.addEventListener('click', e => {
    const btn = e.target.closest('#pv-btn-new-project');
    if (btn) {
      e.preventDefault();
      addProject();
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const btn = e.target.closest('#pv-btn-import');
    if (btn) {
      e.preventDefault();
      importProject();
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const node = e.target.closest('.pv-tree-node-content');
    if (node) {
      const parent = node.closest('.pv-tree-node');
      if (parent) {
        e.preventDefault();
        const id = parent.dataset.id;
        selectProject(id);
      }
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const btn = e.target.closest('.pv-btn-export');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      exportProject(id);
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const btn = e.target.closest('.pv-btn-rename');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const node = _tree ? _tree.byId(id) : null;
      if (node) {
        const newName = prompt(t('projects.renamePrompt'), node.name);
        if (newName && newName.trim()) {
          renameNode(id, newName.trim());
        }
      }
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const btn = e.target.closest('.pv-btn-remove');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const node = _tree ? _tree.byId(id) : null;
      if (node && confirm(t('projects.confirmRemove').replace('{name}', node.name))) {
        removeNode(id);
      }
    }
  }, { signal: sig });
  
  // Asset events
  host.addEventListener('click', e => {
    const btn = e.target.closest('#pv-btn-add-assets');
    if (btn && _activeProject) {
      e.preventDefault();
      addAssets(_activeProject);
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const card = e.target.closest('.pv-asset-card');
    if (card) {
      e.preventDefault();
      const id = card.dataset.id;
      selectAsset(id);
    }
  }, { signal: sig });
  
  host.addEventListener('click', e => {
    const btn = e.target.closest('.pv-btn-remove-asset');
    if (btn) {
      e.preventDefault();
      const id = btn.dataset.id;
      if (confirm(t('projects.confirmRemoveAsset'))) {
        removeAsset(id);
      }
    }
  }, { signal: sig });
  
  // Inspector input events (debounced save)
  let _saveTimer = null;
  function schedSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      saveInspectorFields();
    }, 1000);
  }
  
  host.addEventListener('input', e => {
    if (e.target.id === 'pv-notes' || e.target.id === 'pv-tags') {
      schedSave();
    }
  }, { signal: sig });
}

function saveInspectorFields() {
  if (!_activeAsset || !_activeProject || !_tree) return;
  
  const project = _tree.byId(_activeProject);
  if (!project || !project.assets) return;
  
  const asset = project.assets.find(a => a.id === _activeAsset);
  if (!asset) return;
  
  const notesEl = document.getElementById('pv-notes');
  const tagsEl = document.getElementById('pv-tags');
  
  if (notesEl) {
    asset.notes = notesEl.value;
  }
  
  if (tagsEl) {
    asset.tags = tagsEl.value.split(',').map(s => s.trim()).filter(Boolean);
  }
  
  saveProjects(getTreeNodes());
}

// ----------------------------------------------------------------
// View Lifecycle
// ----------------------------------------------------------------

async function mount(viewHost) {
  const host = typeof viewHost === 'string' ? document.getElementById(viewHost) : viewHost;
  if (!host) return;
  _hostEl = host;
  
  // Inject scoped CSS
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      display: grid;
      grid-template-columns: 280px 1fr 320px;
      gap: 1px;
      height: 100%;
      background: var(--row-border, #ddd);
      overflow: hidden;
    }
    
    #pv-tree, #pv-assets, #pv-inspector {
      background: var(--panel-bg, #fff);
      overflow-y: auto;
      padding: 16px;
    }
    
    .pv-tree-header, .pv-assets-header, .pv-inspector-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--row-border, #ddd);
    }
    
    .pv-tree-header h3, .pv-assets-header h3, .pv-inspector-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    
    .pv-tree-actions {
      display: flex;
      gap: 4px;
    }
    
    .pv-tree-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .pv-tree-node {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
    }
    
    .pv-tree-node:hover {
      background: var(--row-hover, #f5f5f5);
    }
    
    .pv-tree-node.active {
      background: var(--row-sel, #e3f2fd);
    }
    
    .pv-tree-node-content {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    
    .pv-tree-node-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    
    .pv-tree-node-count {
      font-size: 11px;
      color: var(--muted, #666);
      padding: 2px 6px;
      background: var(--chip-bg, #f0f0f0);
      border-radius: 10px;
    }
    
    .pv-tree-node-actions {
      display: none;
      gap: 2px;
    }
    
    .pv-tree-node:hover .pv-tree-node-actions {
      display: flex;
    }
    
    .pv-assets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
    }
    
    .pv-asset-card {
      border: 1px solid var(--row-border, #ddd);
      border-radius: 6px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.15s;
    }
    
    .pv-asset-card:hover {
      border-color: var(--accent, #1976d2);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .pv-asset-card.active {
      border-color: var(--accent, #1976d2);
      background: var(--accent-subtle, #e3f2fd);
    }
    
    .pv-asset-preview {
      width: 100%;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface, #fafafa);
      border-bottom: 1px solid var(--row-border, #ddd);
    }
    
    .pv-asset-preview svg {
      max-width: 100%;
      max-height: 100%;
    }
    
    .pv-asset-icon {
      font-size: 48px;
    }
    
    .pv-asset-info {
      padding: 8px;
    }
    
    .pv-asset-name {
      font-size: 12px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 4px;
    }
    
    .pv-asset-kind {
      font-size: 11px;
      color: var(--muted, #666);
    }
    
    .pv-inspector-section {
      margin-bottom: 20px;
    }
    
    .pv-inspector-section h4 {
      font-size: 12px;
      font-weight: 600;
      margin: 0 0 8px 0;
      color: var(--muted, #666);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .pv-inspector-table {
      width: 100%;
      font-size: 12px;
      border-collapse: collapse;
    }
    
    .pv-inspector-table td {
      padding: 4px 0;
      vertical-align: top;
    }
    
    .pv-inspector-table td:first-child {
      font-weight: 500;
      width: 80px;
      color: var(--muted, #666);
    }
    
    .pv-inspector-table td:last-child {
      word-break: break-word;
    }
    
    .pv-notes-input {
      width: 100%;
      min-height: 120px;
      padding: 8px;
      border: 1px solid var(--row-border, #ddd);
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      resize: vertical;
    }
    
    .pv-input {
      width: 100%;
      padding: 8px;
      border: 1px solid var(--row-border, #ddd);
      border-radius: 4px;
      font-size: 12px;
    }
    
    .pv-empty {
      padding: 40px 20px;
      text-align: center;
      color: var(--muted, #999);
      font-size: 13px;
    }
    
    .btn-icon {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: var(--fg, #333);
      opacity: 0.7;
      transition: opacity 0.15s;
    }
    
    .btn-icon:hover {
      opacity: 1;
    }
    
    .btn-primary {
      background: var(--accent, #1976d2);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    
    .btn-primary:hover {
      background: var(--accent-hover, #1565c0);
    }
  `;
  document.head.appendChild(style);
  
  // Inject HTML
  host.innerHTML = `
    <div id="pv-tree"></div>
    <div id="pv-assets"></div>
    <div id="pv-inspector"></div>
  `;
  
  // Load projects and initialize tree
  const projects = await loadProjects();
  initTree(projects);
  
  // Render
  renderTree();
  renderAssets();
  renderInspector();
  
  // Wire events
  wireEvents();
}

function unmount() {
  // Save any pending inspector edits
  saveInspectorFields();
  
  // Cleanup
  if (_abortCtrl) {
    _abortCtrl.abort();
    _abortCtrl = null;
  }
  
  // Remove styles
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
  
  // Clear state
  _tree = null;
  _activeProject = null;
  _activeAsset = null;
  _hostEl = null;
}

// ----------------------------------------------------------------
// Register View
// ----------------------------------------------------------------

if (window.registerView) {
  window.registerView('projects', { mount, unmount });
}

})();
