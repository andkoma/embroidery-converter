/**
 * Gallery View — Browse embroidery files with thumbnail grid
 *
 * Three-panel layout:
 *  - Left: Managed folders
 *  - Center: Thumbnail grid with filter/search/sort
 *  - Right: Detail pane (file metadata + actions)
 *
 * Features:
 *  - Folder watchers (manual re-scan for now)
 *  - Lazy-loaded thumbnail grid
 *  - Filter by extension, search by name, sort by metadata
 *  - Detail view with hand-off to Convert/Batch/Simulator
 */

let _abortCtrl = null;
let _scanRequestId = null;
let _thumbObserver = null; // IntersectionObserver for lazy thumbnail loading

// State
let _managedFolders = [];  // [{path, label}]
let _allFiles = [];        // FileEntry[]
let _filtered = [];        // FileEntry[] after filter/search/sort
let _selected = null;      // FileEntry currently shown in detail pane

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */
export async function mount() {
  _abortCtrl = new AbortController();
  
  injectCSS();
  document.getElementById('view-host').innerHTML = buildHTML();
  
  // Initialize lazy loading observer for thumbnails
  initThumbObserver();
  
  // Restore managed folders from settings
  const settings = await window.api.getSettings();
  _managedFolders = settings.galleryFolders || [];
  
  renderFolderList();
  wireEvents();
  
  // Auto-scan if folders exist
  if (_managedFolders.length > 0) {
    scanAllFolders();
  }
}

export function unmount() {
  if (_scanRequestId) {
    window.api.cancelStream(_scanRequestId);
    _scanRequestId = null;
  }
  if (_thumbObserver) {
    _thumbObserver.disconnect();
    _thumbObserver = null;
  }
  if (_abortCtrl) {
    _abortCtrl.abort();
    _abortCtrl = null;
  }
  removeCSS();
  _managedFolders = [];
  _allFiles = [];
  _filtered = [];
  _selected = null;
}

/* ------------------------------------------------------------------ *
 *  HTML template
 * ------------------------------------------------------------------ */
function buildHTML() {
  return `
<div class="gv-root">
  <!-- Left: Folders -->
  <aside class="gv-folders-panel">
    <div class="gv-panel-header">
      <h3>Folders</h3>
      <button id="gv-add-folder-btn" class="gv-icon-btn" title="Add folders">+</button>
    </div>
    <div id="gv-folder-list" class="gv-folder-list"></div>
    <div class="gv-panel-footer">
      <button id="gv-refresh-btn" class="gv-btn-secondary">Re-scan Folders</button>
    </div>
  </aside>

  <!-- Center: Grid -->
  <main class="gv-grid-panel">
    <div class="gv-toolbar">
      <input type="text" id="gv-search" class="gv-search" placeholder="Search by name…" />
      <div class="gv-filters" id="gv-filter-chips"></div>
      <div class="gv-sort">
        <label>Sort:</label>
        <select id="gv-sort-select">
          <option value="name-asc">Name (A-Z)</option>
          <option value="name-desc">Name (Z-A)</option>
          <option value="size-asc">Size (smallest)</option>
          <option value="size-desc">Size (largest)</option>
          <option value="stitches-asc">Stitches (fewest)</option>
          <option value="stitches-desc">Stitches (most)</option>
        </select>
      </div>
    </div>
    <div id="gv-scan-status" class="gv-scan-status"></div>
    <div id="gv-grid" class="gv-grid"></div>
  </main>

  <!-- Right: Detail -->
  <aside class="gv-detail-panel">
    <div id="gv-detail" class="gv-detail"></div>
  </aside>
</div>
`;
}

/* ------------------------------------------------------------------ *
 *  CSS injection
 * ------------------------------------------------------------------ */
function injectCSS() {
  const style = document.createElement('style');
  style.id = 'gv-styles';
  style.textContent = `
/* ── Gallery root ── */
.gv-root {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  gap: 0;
  height: 100%;
  background: var(--bg, #0f1419);
  color: var(--fg, #e6edf3);
}

/* ── Left: Folders panel ── */
.gv-folders-panel {
  display: flex;
  flex-direction: column;
  background: var(--panel-bg, #161b22);
  border-right: 1px solid var(--border, #30363d);
}
.gv-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #30363d);
}
.gv-panel-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--muted, #8b949e);
}
.gv-icon-btn {
  background: var(--accent, #4a6ef5);
  color: #fff;
  border: none;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gv-icon-btn:hover { background: var(--accent-hover, #6485ff); }

.gv-folder-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.gv-folder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  margin-bottom: 4px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  font-size: 12px;
  color: var(--fg, #e6edf3);
}
.gv-folder-item:hover {
  background: var(--hover-bg, #161b22);
}
.gv-folder-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 11px;
}
.gv-folder-remove {
  background: transparent;
  border: none;
  color: var(--error, #f85149);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.gv-folder-remove:hover { color: var(--error-hover, #ff6b6b); }

.gv-panel-footer {
  padding: 12px;
  border-top: 1px solid var(--border, #30363d);
}
.gv-btn-secondary {
  width: 100%;
  padding: 8px 12px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  color: var(--fg, #e6edf3);
  font-size: 12px;
  cursor: pointer;
}
.gv-btn-secondary:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}

/* ── Center: Grid panel ── */
.gv-grid-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg, #0f1419);
}
.gv-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--panel-bg, #161b22);
  border-bottom: 1px solid var(--border, #30363d);
}
.gv-search {
  flex: 1;
  padding: 6px 10px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  color: var(--fg, #e6edf3);
  font-size: 13px;
}
.gv-filters {
  display: flex;
  gap: 6px;
}
.gv-filter-chip {
  padding: 4px 10px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 12px;
  font-size: 11px;
  color: var(--muted, #8b949e);
  cursor: pointer;
  user-select: none;
}
.gv-filter-chip:hover {
  border-color: var(--accent, #4a6ef5);
  color: var(--fg, #e6edf3);
}
.gv-filter-chip.active {
  background: var(--accent, #4a6ef5);
  color: #fff;
  border-color: var(--accent, #4a6ef5);
}
.gv-sort {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted, #8b949e);
}
.gv-sort select {
  padding: 4px 8px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--fg, #e6edf3);
  font-size: 12px;
}

.gv-scan-status {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--muted, #8b949e);
  background: var(--panel-bg, #161b22);
  border-bottom: 1px solid var(--border, #30363d);
}

.gv-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 16px;
  align-content: start;
}

.gv-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: var(--panel-bg, #161b22);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.gv-grid-item:hover {
  border-color: var(--accent, #4a6ef5);
  background: var(--hover-bg, #1c2128);
}
.gv-grid-item.selected {
  border-color: var(--accent, #4a6ef5);
  background: var(--hover-bg, #1c2128);
}

.gv-thumb {
  width: 100px;
  height: 100px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  overflow: hidden;
}
.gv-thumb svg {
  width: 100%;
  height: 100%;
}
.gv-thumb-placeholder {
  color: var(--muted, #8b949e);
  font-size: 10px;
}
.gv-thumb-placeholder:first-child:last-child {
  /* Loading animation for lazy-loaded thumbs */
  animation: gv-pulse 1.5s ease-in-out infinite;
}
@keyframes gv-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}

.gv-grid-label {
  width: 100%;
  text-align: center;
  font-size: 11px;
  color: var(--fg, #e6edf3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gv-grid-ext {
  font-size: 9px;
  color: var(--muted, #8b949e);
  font-family: monospace;
  margin-top: 2px;
}

/* ── Right: Detail panel ── */
.gv-detail-panel {
  background: var(--panel-bg, #161b22);
  border-left: 1px solid var(--border, #30363d);
  overflow-y: auto;
}
.gv-detail {
  padding: 16px;
}
.gv-detail-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--muted, #8b949e);
  font-size: 12px;
}
.gv-detail h4 {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--fg, #e6edf3);
  border-bottom: 1px solid var(--border, #30363d);
  padding-bottom: 8px;
}
.gv-detail-preview {
  width: 100%;
  height: 200px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.gv-detail-preview svg {
  width: 100%;
  height: 100%;
}
.gv-detail-meta {
  font-size: 11px;
  color: var(--muted, #8b949e);
  margin-bottom: 16px;
}
.gv-detail-meta dt {
  font-weight: 600;
  color: var(--fg, #e6edf3);
  margin-top: 8px;
}
.gv-detail-meta dd {
  margin: 2px 0 0 0;
}
.gv-detail-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gv-action-btn {
  padding: 8px 12px;
  background: var(--accent, #4a6ef5);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.gv-action-btn:hover {
  background: var(--accent-hover, #6485ff);
}
.gv-action-btn.secondary {
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  color: var(--fg, #e6edf3);
}
.gv-action-btn.secondary:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}

/* ── Empty states ── */
.gv-empty-folders {
  padding: 48px 16px;
  text-align: center;
  color: var(--muted, #8b949e);
  font-size: 12px;
}
.gv-empty-grid {
  grid-column: 1 / -1;
  padding: 48px 16px;
  text-align: center;
  color: var(--muted, #8b949e);
  font-size: 13px;
}
`;
  document.head.appendChild(style);
}

function removeCSS() {
  document.getElementById('gv-styles')?.remove();
}

/* ------------------------------------------------------------------ *
 *  Lazy loading observer for thumbnails
 * ------------------------------------------------------------------ */
function initThumbObserver() {
  if (!window.IntersectionObserver) {
    console.warn('IntersectionObserver not available, thumbnails will load immediately');
    return;
  }
  
  _thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const thumb = entry.target;
        const previewData = thumb.dataset.preview;
        
        if (previewData && previewData !== 'null') {
          try {
            const preview = JSON.parse(previewData);
            thumb.innerHTML = renderPreview(preview);
          } catch (err) {
            console.error('Error parsing preview data:', err);
            thumb.innerHTML = '<span class="gv-thumb-placeholder">Preview error</span>';
          }
        } else {
          thumb.innerHTML = '<span class="gv-thumb-placeholder">No preview</span>';
        }
        
        // Stop observing once loaded
        _thumbObserver.unobserve(thumb);
      }
    });
  }, {
    root: document.getElementById('gv-grid'),
    rootMargin: '100px', // Pre-load 100px before entering viewport
    threshold: 0.01
  });
}

/* ------------------------------------------------------------------ *
 *  Folder management
 * ------------------------------------------------------------------ */
async function addFolders() {
  const paths = await window.api.pickFolders();
  if (!paths || paths.length === 0) return;
  
  for (const p of paths) {
    if (!_managedFolders.some(f => f.path === p)) {
      _managedFolders.push({ path: p, label: p.split('/').pop() || p });
    }
  }
  
  await saveFolders();
  renderFolderList();
  scanAllFolders();
}

async function removeFolder(path) {
  _managedFolders = _managedFolders.filter(f => f.path !== path);
  await saveFolders();
  renderFolderList();
  
  // Remove files from this folder
  _allFiles = _allFiles.filter(f => !f.path.startsWith(path));
  applyFilters();
}

async function saveFolders() {
  await window.api.setSettings({ galleryFolders: _managedFolders });
}

function renderFolderList() {
  const container = document.getElementById('gv-folder-list');
  if (!container) return;
  
  if (_managedFolders.length === 0) {
    container.innerHTML = '<div class="gv-empty-folders">No folders added yet.<br>Click + to add folders.</div>';
    return;
  }
  
  const frag = document.createDocumentFragment();
  _managedFolders.forEach(folder => {
    const div = document.createElement('div');
    div.className = 'gv-folder-item';
    div.innerHTML = `
      <span class="gv-folder-path" title="${folder.path}">${folder.path}</span>
      <button class="gv-folder-remove" data-path="${folder.path}">×</button>
    `;
    frag.appendChild(div);
  });
  container.replaceChildren(frag);
}

/* ------------------------------------------------------------------ *
 *  Folder scanning
 * ------------------------------------------------------------------ */
async function scanAllFolders() {
  if (_managedFolders.length === 0) {
    _allFiles = [];
    applyFilters();
    return;
  }
  
  const statusEl = document.getElementById('gv-scan-status');
  if (statusEl) statusEl.textContent = 'Scanning folders…';
  
  _allFiles = [];
  const paths = _managedFolders.map(f => f.path);
  
  try {
    _scanRequestId = await window.api.scanFolders({ paths }, (entry) => {
      if (entry.type === 'file') {
        _allFiles.push(entry);
      } else if (entry.type === 'done') {
        _scanRequestId = null;
        if (statusEl) statusEl.textContent = `${_allFiles.length} files found`;
        applyFilters();
      }
    });
  } catch (err) {
    console.error('Scan error:', err);
    if (statusEl) statusEl.textContent = 'Scan failed';
  }
}

/* ------------------------------------------------------------------ *
 *  Filter/search/sort
 * ------------------------------------------------------------------ */
let _activeExtFilter = null;
let _searchQuery = '';
let _sortMode = 'name-asc';

function applyFilters() {
  let result = [..._allFiles];
  
  // Extension filter
  if (_activeExtFilter) {
    result = result.filter(f => f.ext === _activeExtFilter);
  }
  
  // Search
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    result = result.filter(f => f.name.toLowerCase().includes(q));
  }
  
  // Sort
  result.sort((a, b) => {
    switch (_sortMode) {
      case 'name-asc':  return a.name.localeCompare(b.name);
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'size-asc':  return (a.size || 0) - (b.size || 0);
      case 'size-desc': return (b.size || 0) - (a.size || 0);
      case 'stitches-asc':  return (a.stitches || 0) - (b.stitches || 0);
      case 'stitches-desc': return (b.stitches || 0) - (a.stitches || 0);
      default: return 0;
    }
  });
  
  _filtered = result;
  renderGrid();
  renderFilterChips();
}

function renderFilterChips() {
  const container = document.getElementById('gv-filter-chips');
  if (!container) return;
  
  // Count files by extension
  const extCounts = {};
  _allFiles.forEach(f => {
    extCounts[f.ext] = (extCounts[f.ext] || 0) + 1;
  });
  
  const exts = Object.keys(extCounts).sort();
  const frag = document.createDocumentFragment();
  
  exts.forEach(ext => {
    const chip = document.createElement('div');
    chip.className = 'gv-filter-chip';
    chip.textContent = `${ext.toUpperCase()} (${extCounts[ext]})`;
    chip.dataset.ext = ext;
    if (_activeExtFilter === ext) chip.classList.add('active');
    frag.appendChild(chip);
  });
  
  container.replaceChildren(frag);
}

/* ------------------------------------------------------------------ *
 *  Grid rendering
 * ------------------------------------------------------------------ */
function renderGrid() {
  const grid = document.getElementById('gv-grid');
  if (!grid) return;
  
  if (_filtered.length === 0) {
    grid.innerHTML = '<div class="gv-empty-grid">No files to display.<br>Add folders or adjust filters.</div>';
    return;
  }
  
  const frag = document.createDocumentFragment();
  _filtered.forEach(file => {
    const item = document.createElement('div');
    item.className = 'gv-grid-item';
    item.dataset.path = file.path;
    if (_selected && _selected.path === file.path) {
      item.classList.add('selected');
    }
    
    const thumb = document.createElement('div');
    thumb.className = 'gv-thumb';
    
    // Store preview data for lazy loading
    if (file.preview) {
      thumb.dataset.preview = JSON.stringify(file.preview);
      thumb.innerHTML = '<span class="gv-thumb-placeholder">⋯</span>'; // Loading placeholder
      
      // Observe for lazy loading
      if (_thumbObserver) {
        _thumbObserver.observe(thumb);
      } else {
        // Fallback: load immediately if observer not available
        thumb.innerHTML = renderPreview(file.preview);
      }
    } else {
      thumb.innerHTML = '<span class="gv-thumb-placeholder">No preview</span>';
    }
    
    item.appendChild(thumb);
    
    const label = document.createElement('div');
    label.className = 'gv-grid-label';
    label.title = file.name;
    label.textContent = file.name;
    item.appendChild(label);
    
    const ext = document.createElement('div');
    ext.className = 'gv-grid-ext';
    ext.textContent = file.ext.toUpperCase();
    item.appendChild(ext);
    
    frag.appendChild(item);
  });
  
  grid.replaceChildren(frag);
}

function renderPreview(preview) {
  if (!preview || !preview.polylines) return '<span class="gv-thumb-placeholder">No preview</span>';
  
  const { bounds, polylines } = preview;
  const [minX, minY, maxX, maxY] = bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  const viewBox = `${minX} ${minY} ${width} ${height}`;
  
  const paths = polylines.map(line => {
    const d = line.points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ');
    const color = line.thread?.hex || '#888';
    return `<path d="${d}" stroke="${color}" fill="none" stroke-width="0.3"/>`;
  }).join('');
  
  return `<svg viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

/* ------------------------------------------------------------------ *
 *  Detail pane
 * ------------------------------------------------------------------ */
function showDetail(file) {
  _selected = file;
  const container = document.getElementById('gv-detail');
  if (!container) return;
  
  if (!file) {
    container.innerHTML = '<div class="gv-detail-empty">Select a file to view details</div>';
    return;
  }
  
  const preview = file.preview ? renderPreview(file.preview) : '<span class="gv-thumb-placeholder">No preview</span>';
  
  container.innerHTML = `
    <h4>${file.name}</h4>
    <div class="gv-detail-preview">${preview}</div>
    <dl class="gv-detail-meta">
      <dt>Path</dt>
      <dd>${file.path}</dd>
      <dt>Format</dt>
      <dd>${file.ext.toUpperCase()}</dd>
      <dt>Size</dt>
      <dd>${formatSize(file.size || 0)}</dd>
      ${file.stitches ? `<dt>Stitches</dt><dd>${file.stitches.toLocaleString()}</dd>` : ''}
      ${file.colors ? `<dt>Colors</dt><dd>${file.colors}</dd>` : ''}
      ${file.width && file.height ? `<dt>Dimensions</dt><dd>${file.width} × ${file.height} mm</dd>` : ''}
    </dl>
    <div class="gv-detail-actions">
      <button class="gv-action-btn" data-action="convert">Send to Convert</button>
      <button class="gv-action-btn secondary" data-action="batch">Add to Batch</button>
      <button class="gv-action-btn secondary" data-action="simulate">Open in Simulator</button>
      <button class="gv-action-btn secondary" data-action="show">Show in Folder</button>
    </div>
  `;
  
  // Update grid selection
  renderGrid();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ------------------------------------------------------------------ *
 *  Event wiring
 * ------------------------------------------------------------------ */
function wireEvents() {
  const sig = _abortCtrl.signal;
  
  // Add folders
  document.getElementById('gv-add-folder-btn')
    ?.addEventListener('click', addFolders, { signal: sig });
  
  // Remove folder (delegated)
  document.getElementById('gv-folder-list')
    ?.addEventListener('click', (e) => {
      const btn = e.target.closest('.gv-folder-remove');
      if (btn) removeFolder(btn.dataset.path);
    }, { signal: sig });
  
  // Re-scan
  document.getElementById('gv-refresh-btn')
    ?.addEventListener('click', scanAllFolders, { signal: sig });
  
  // Search
  document.getElementById('gv-search')
    ?.addEventListener('input', (e) => {
      _searchQuery = e.target.value.trim();
      applyFilters();
    }, { signal: sig });
  
  // Filter chips (delegated)
  document.getElementById('gv-filter-chips')
    ?.addEventListener('click', (e) => {
      const chip = e.target.closest('.gv-filter-chip');
      if (chip) {
        const ext = chip.dataset.ext;
        _activeExtFilter = _activeExtFilter === ext ? null : ext;
        applyFilters();
      }
    }, { signal: sig });
  
  // Sort
  document.getElementById('gv-sort-select')
    ?.addEventListener('change', (e) => {
      _sortMode = e.target.value;
      applyFilters();
    }, { signal: sig });
  
  // Grid item click (delegated)
  document.getElementById('gv-grid')
    ?.addEventListener('click', (e) => {
      const item = e.target.closest('.gv-grid-item');
      if (item) {
        const file = _filtered.find(f => f.path === item.dataset.path);
        if (file) showDetail(file);
      }
    }, { signal: sig });
  
  // Detail actions (delegated)
  document.getElementById('gv-detail')
    ?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || !_selected) return;
      
      const action = btn.dataset.action;
      switch (action) {
        case 'convert':
          // Navigate to Convert view and pre-load this file
          window.events && window.events.emit('gallery:send-to-convert', { file: _selected });
          window.router && window.router.load('convert');
          break;
        case 'batch':
          // Navigate to Batch view and add to selection
          window.events && window.events.emit('gallery:send-to-batch', { file: _selected });
          window.router && window.router.load('batch');
          break;
        case 'simulate':
          // Navigate to Simulator view and send file
          window.events && window.events.emit('gallery:send-to-simulator', { file: _selected });
          window.router && window.router.load('simulator');
          break;
        case 'show':
          await window.api.showItem(_selected.path);
          break;
      }
    }, { signal: sig });
}

/* ------------------------------------------------------------------ *
 *  Register with shell router
 * ------------------------------------------------------------------ */
window.registerView('gallery', { mount, unmount });
