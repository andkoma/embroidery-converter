(function () {
'use strict';
/**
 * Transfer View — Send embroidery files to machines
 *
 * Three-panel layout:
 *  - Left: Source files (from Gallery/Batch or direct file picker)
 *  - Center: Destination picker (removable drives, network, favorites)
 *  - Right: Machine profile & transfer settings
 *
 * Features:
 *  - Auto-detect removable drives (USB sticks, SD cards via USB reader)
 *  - Custom destination picker (network shares, local folders)
 *  - Favorites/recent destinations with persistence
 *  - Machine profile database (format validation, limitations)
 *  - Auto-convert if source format doesn't match machine profile
 *  - Copy verification (size/checksum comparison)
 *  - Batch transfer with progress tracking
 */

/* ------------------------------------------------------------------ *
 *  i18n helper
 * ------------------------------------------------------------------ */
const t = (key, params = {}) => {
  const lang = window.store?.get('settings.language', 'en') || 'en';
  let str = window.I18N?.[lang]?.[key] || key;
  Object.entries(params).forEach(([k, v]) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  });
  return str;
};

let _abortCtrl = null;

// Transfer state
let _sourceFiles = [];       // Array of {path, name, ext, format}
let _selectedDest = null;    // Current destination {type, path, label, machine}
let _destinations = [];      // Available destinations (drives + favorites)
let _machineProfile = null;  // Selected machine profile
let _transferInProgress = false;

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */
async function mount(container) {
  _abortCtrl = new AbortController();
  
  injectCSS();
  const host = container || document.getElementById('viewHost');
  host.innerHTML = buildHTML();
  
  wireEvents();
  
  // Listen for hand-offs from Gallery/Batch
  window.events?.on('gallery:send-to-transfer', handleGalleryHandoff);
  window.events?.on('batch:send-to-transfer', handleBatchHandoff);
  
  // Load destinations and favorites
  await refreshDestinations();
  loadFavorites();
}

function unmount() {
  window.events?.off('gallery:send-to-transfer', handleGalleryHandoff);
  window.events?.off('batch:send-to-transfer', handleBatchHandoff);
  
  if (_abortCtrl) {
    _abortCtrl.abort();
    _abortCtrl = null;
  }
  
  removeCSS();
  
  _sourceFiles = [];
  _selectedDest = null;
  _destinations = [];
  _machineProfile = null;
}

/* ------------------------------------------------------------------ *
 *  HTML template
 * ------------------------------------------------------------------ */
function buildHTML() {
  return `
<div class="tr-root">
  <!-- Left: Source Files -->
  <aside class="tr-source-panel">
    <div class="tr-panel-header">
      <h3>${t('transfer.sourceFiles')}</h3>
      <button id="tr-add-files-btn" class="tr-icon-btn" title="${t('transfer.addFiles')}">+</button>
    </div>
    <div id="tr-source-list" class="tr-source-list">
      <div class="tr-empty-state">
        <p>${t('transfer.noFiles')}</p>
        <p class="tr-hint">${t('transfer.filesHint')}</p>
      </div>
    </div>
  </aside>

  <!-- Center: Destination Picker -->
  <main class="tr-dest-panel">
    <div class="tr-panel-header">
      <h3>${t('transfer.destination')}</h3>
      <button id="tr-refresh-dest-btn" class="tr-icon-btn" title="${t('transfer.refreshDrives')}">⟳</button>
    </div>
    
    <div class="tr-dest-sections">
      <!-- Removable Drives -->
      <section class="tr-dest-section">
        <h4>${t('transfer.removableDrives')}</h4>
        <div id="tr-drives-list" class="tr-dest-list">
          <div class="tr-scanning">${t('transfer.scanning')}</div>
        </div>
      </section>
      
      <!-- Favorites -->
      <section class="tr-dest-section">
        <h4>${t('transfer.favorites')}</h4>
        <div id="tr-favorites-list" class="tr-dest-list">
          <div class="tr-empty-hint">${t('transfer.noFavorites')}</div>
        </div>
      </section>
      
      <!-- Custom Path -->
      <section class="tr-dest-section">
        <h4>${t('transfer.customDest')}</h4>
        <div class="tr-custom-picker">
          <button id="tr-pick-custom-btn" class="tr-btn-secondary">${t('transfer.browse')}</button>
          <div id="tr-custom-path" class="tr-custom-path"></div>
        </div>
      </section>
    </div>
    
    <!-- Selected Destination Display -->
    <div id="tr-selected-dest" class="tr-selected-dest hidden">
      <div class="tr-selected-label">
        <strong>${t('transfer.selected')}</strong> <span id="tr-selected-path"></span>
      </div>
      <button id="tr-add-favorite-btn" class="tr-btn-favorite">★ ${t('transfer.addFavorite')}</button>
    </div>
  </main>

  <!-- Right: Machine Profile & Settings -->
  <aside class="tr-settings-panel">
    <div class="tr-panel-header">
      <h3>${t('transfer.settings')}</h3>
    </div>
    
    <div class="tr-settings-content">
      <!-- Machine Profile -->
      <div class="tr-setting-group">
        <h4>${t('transfer.machineProfile')}</h4>
        <select id="tr-machine-select" class="tr-select">
          <option value="">${t('transfer.autoDetect')}</option>
          <option value="brother">Brother (PES)</option>
          <option value="janome">Janome (JEF)</option>
          <option value="pfaff">Pfaff (VP3)</option>
          <option value="husqvarna">Husqvarna (HUS/VIP/VP3)</option>
          <option value="singer">Singer (XXX)</option>
          <option value="toyota">Toyota (10O)</option>
          <option value="melco">Melco (EXP)</option>
          <option value="tajima">Tajima (DST)</option>
          <option value="generic">Generic</option>
        </select>
        <div id="tr-machine-info" class="tr-machine-info"></div>
      </div>
      
      <!-- Transfer Options -->
      <div class="tr-setting-group">
        <h4>${t('transfer.options')}</h4>
        <label class="tr-checkbox">
          <input type="checkbox" id="tr-auto-convert" checked />
          <span>${t('transfer.autoConvert')}</span>
        </label>
        <label class="tr-checkbox">
          <input type="checkbox" id="tr-verify-copy" checked />
          <span>${t('transfer.verifyCopy')}</span>
        </label>
        <label class="tr-checkbox">
          <input type="checkbox" id="tr-create-subfolder" />
          <span>${t('transfer.createSubfolder')}</span>
        </label>
      </div>
      
      <!-- Transfer Button -->
      <button id="tr-transfer-btn" class="tr-btn-primary" disabled>${t('transfer.transferBtn')}</button>
      
      <!-- Progress -->
      <div id="tr-progress" class="tr-progress hidden">
        <div class="tr-progress-bar">
          <div id="tr-progress-fill" class="tr-progress-fill"></div>
        </div>
        <div id="tr-progress-text" class="tr-progress-text">${t('transfer.preparing')}</div>
      </div>
    </div>
  </aside>
</div>
`;
}

/* ------------------------------------------------------------------ *
 *  CSS injection
 * ------------------------------------------------------------------ */
function injectCSS() {
  const style = document.createElement('style');
  style.id = 'tr-styles';
  style.textContent = `
/* ── Transfer root ── */
.tr-root {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  gap: 0;
  height: 100%;
  background: var(--bg, #0f1419);
  color: var(--fg, #e6edf3);
}

/* ── Panel commons ── */
.tr-source-panel,
.tr-settings-panel {
  background: var(--panel-bg, #161b22);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.tr-source-panel {
  border-right: 1px solid var(--border, #30363d);
}
.tr-settings-panel {
  border-left: 1px solid var(--border, #30363d);
}
.tr-dest-panel {
  background: var(--bg, #0f1419);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.tr-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--border, #30363d);
}
.tr-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--muted, #8b949e);
}
.tr-icon-btn {
  padding: 6px 10px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  color: var(--fg, #e6edf3);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.tr-icon-btn:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}

/* ── Source files list ── */
.tr-source-list {
  flex: 1;
  padding: 12px;
}
.tr-empty-state {
  text-align: center;
  padding: 40px 16px;
  color: var(--muted, #8b949e);
}
.tr-empty-state p {
  margin: 8px 0;
  font-size: 12px;
}
.tr-hint {
  font-size: 11px;
  opacity: 0.7;
}
.tr-source-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  margin-bottom: 6px;
  font-size: 11px;
}
.tr-source-item-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.tr-source-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg, #e6edf3);
}
.tr-source-item-ext {
  color: var(--muted, #8b949e);
  font-family: monospace;
  font-size: 10px;
}
.tr-source-item-remove {
  background: none;
  border: none;
  color: var(--danger, #f85149);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 14px;
}
.tr-source-item-remove:hover {
  opacity: 0.7;
}

/* ── Destination sections ── */
.tr-dest-sections {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.tr-dest-section h4 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #e6edf3);
  border-bottom: 1px solid var(--border, #30363d);
  padding-bottom: 6px;
}
.tr-dest-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tr-scanning,
.tr-empty-hint {
  font-size: 11px;
  color: var(--muted, #8b949e);
  padding: 12px;
  text-align: center;
}

.tr-dest-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.tr-dest-item:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}
.tr-dest-item.selected {
  background: var(--accent-dim, rgba(74, 110, 245, 0.1));
  border-color: var(--accent, #4a6ef5);
}
.tr-dest-icon {
  font-size: 24px;
  flex-shrink: 0;
}
.tr-dest-info {
  flex: 1;
  min-width: 0;
}
.tr-dest-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg, #e6edf3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tr-dest-path {
  font-size: 10px;
  color: var(--muted, #8b949e);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tr-dest-capacity {
  font-size: 10px;
  color: var(--muted, #8b949e);
}

.tr-custom-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tr-btn-secondary {
  padding: 10px 16px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  color: var(--fg, #e6edf3);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.tr-btn-secondary:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}
.tr-custom-path {
  font-size: 11px;
  color: var(--muted, #8b949e);
  padding: 8px;
  min-height: 20px;
  font-family: monospace;
}

.tr-selected-dest {
  margin-top: 16px;
  padding: 12px;
  background: var(--accent-dim, rgba(74, 110, 245, 0.1));
  border: 1px solid var(--accent, #4a6ef5);
  border-radius: 6px;
}
.tr-selected-dest.hidden {
  display: none;
}
.tr-selected-label {
  font-size: 12px;
  color: var(--fg, #e6edf3);
  margin-bottom: 8px;
}
.tr-selected-path {
  font-family: monospace;
  color: var(--accent, #4a6ef5);
}
.tr-btn-favorite {
  padding: 6px 12px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--warning, #d29922);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.tr-btn-favorite:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--warning, #d29922);
}

/* ── Settings panel ── */
.tr-settings-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.tr-setting-group h4 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #e6edf3);
}
.tr-select {
  width: 100%;
  padding: 8px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--fg, #e6edf3);
  font-size: 12px;
}
.tr-machine-info {
  margin-top: 8px;
  font-size: 11px;
  color: var(--muted, #8b949e);
  line-height: 1.5;
}

.tr-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--fg, #e6edf3);
  margin-bottom: 8px;
  cursor: pointer;
}
.tr-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.tr-btn-primary {
  padding: 12px 20px;
  background: var(--accent, #4a6ef5);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.tr-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover, #6485ff);
}
.tr-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tr-progress {
  margin-top: 12px;
}
.tr-progress.hidden {
  display: none;
}
.tr-progress-bar {
  height: 6px;
  background: var(--input-bg, #0d1117);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
.tr-progress-fill {
  height: 100%;
  background: var(--accent, #4a6ef5);
  transition: width 0.3s;
  width: 0%;
}
.tr-progress-text {
  font-size: 11px;
  color: var(--muted, #8b949e);
  text-align: center;
}
`;
  document.head.appendChild(style);
}

function removeCSS() {
  document.getElementById('tr-styles')?.remove();
}

/* ------------------------------------------------------------------ *
 *  Destination management
 * ------------------------------------------------------------------ */
async function refreshDestinations() {
  const drivesList = document.getElementById('tr-drives-list');
  if (!drivesList) return;
  
  drivesList.innerHTML = `<div class="tr-scanning">${t('transfer.scanning')}</div>`;
  
  try {
    // Call backend to list removable volumes
    const volumes = await window.api.listVolumes?.() || [];
    
    _destinations = volumes.map(v => ({
      type: 'drive',
      path: v.mountPoint,
      label: v.label || v.mountPoint,
      capacity: v.capacity,
      available: v.available,
      removable: v.removable
    }));
    
    if (_destinations.length === 0) {
      drivesList.innerHTML = `<div class="tr-empty-hint">${t('transfer.noDrives')}</div>`;
    } else {
      renderDestinations();
    }
  } catch (err) {
    console.error('Error listing volumes:', err);
    drivesList.innerHTML = `<div class="tr-empty-hint">${t('transfer.scanError')}</div>`;
  }
}

function renderDestinations() {
  const drivesList = document.getElementById('tr-drives-list');
  if (!drivesList) return;
  
  const drives = _destinations.filter(d => d.type === 'drive');
  
  if (drives.length === 0) {
    drivesList.innerHTML = `<div class="tr-empty-hint">${t('transfer.noDrives')}</div>`;
    return;
  }
  
  drivesList.innerHTML = drives.map((dest, idx) => `
    <div class="tr-dest-item ${_selectedDest?.path === dest.path ? 'selected' : ''}" data-dest-index="${idx}">
      <div class="tr-dest-icon">💾</div>
      <div class="tr-dest-info">
        <div class="tr-dest-label">${dest.label}</div>
        <div class="tr-dest-path">${dest.path}</div>
        ${dest.capacity ? `<div class="tr-dest-capacity">${formatBytes(dest.available)} / ${formatBytes(dest.capacity)} free</div>` : ''}
      </div>
    </div>
  `).join('');
}

function loadFavorites() {
  const settings = window.store?.get('settings') || {};
  const favorites = settings.transferFavorites || [];
  
  const favoritesList = document.getElementById('tr-favorites-list');
  if (!favoritesList) return;
  
  if (favorites.length === 0) {
    favoritesList.innerHTML = `<div class="tr-empty-hint">${t('transfer.noFavorites')}</div>`;
    return;
  }
  
  favoritesList.innerHTML = favorites.map((fav, idx) => `
    <div class="tr-dest-item ${_selectedDest?.path === fav.path ? 'selected' : ''}" data-favorite-index="${idx}">
      <div class="tr-dest-icon">⭐</div>
      <div class="tr-dest-info">
        <div class="tr-dest-label">${fav.label || fav.path}</div>
        <div class="tr-dest-path">${fav.path}</div>
      </div>
    </div>
  `).join('');
}

async function addToFavorites() {
  if (!_selectedDest) return;
  
  const settings = window.store?.get('settings') || {};
  const favorites = settings.transferFavorites || [];
  
  // Check if already in favorites
  if (favorites.some(f => f.path === _selectedDest.path)) {
    alert(t('transfer.alreadyFavorite'));
    return;
  }
  
  favorites.push({
    path: _selectedDest.path,
    label: _selectedDest.label
  });
  
  await window.api.setSettings?.({ transferFavorites: favorites });
  window.store?.set('settings', { ...settings, transferFavorites: favorites });
  
  loadFavorites();
}

function selectDestination(dest) {
  _selectedDest = dest;
  
  // Update UI
  renderDestinations();
  loadFavorites();
  
  const selectedDiv = document.getElementById('tr-selected-dest');
  const selectedPath = document.getElementById('tr-selected-path');
  
  if (selectedDiv && selectedPath) {
    selectedDiv.classList.remove('hidden');
    selectedPath.textContent = dest.path;
  }
  
  updateTransferButton();
}

/* ------------------------------------------------------------------ *
 *  Source file management
 * ------------------------------------------------------------------ */
async function addSourceFiles() {
  const files = await window.api.openFiles?.();
  if (!files || files.length === 0) return;
  
  for (const filePath of files) {
    // Avoid duplicates
    if (_sourceFiles.some(f => f.path === filePath)) continue;
    
    const name = filePath.split(/[/\\]/).pop();
    const ext = name.split('.').pop().toLowerCase();
    
    _sourceFiles.push({
      path: filePath,
      name,
      ext,
      format: ext.toUpperCase()
    });
  }
  
  renderSourceList();
  updateTransferButton();
}

function removeSourceFile(index) {
  _sourceFiles.splice(index, 1);
  renderSourceList();
  updateTransferButton();
}

function renderSourceList() {
  const sourceList = document.getElementById('tr-source-list');
  if (!sourceList) return;
  
  if (_sourceFiles.length === 0) {
    sourceList.innerHTML = `
      <div class="tr-empty-state">
        <p>${t('transfer.noFiles')}</p>
        <p class="tr-hint">${t('transfer.filesHint')}</p>
      </div>
    `;
    return;
  }
  
  sourceList.innerHTML = _sourceFiles.map((file, idx) => `
    <div class="tr-source-item">
      <div class="tr-source-item-icon">📄</div>
      <div class="tr-source-item-name" title="${file.path}">${file.name}</div>
      <div class="tr-source-item-ext">${file.ext.toUpperCase()}</div>
      <button class="tr-source-item-remove" data-remove-index="${idx}">×</button>
    </div>
  `).join('');
}

/* ------------------------------------------------------------------ *
 *  Machine profiles
 * ------------------------------------------------------------------ */
const MACHINE_PROFILES = {
  brother: {
    name: 'Brother',
    formats: ['PES'],
    maxColors: 127,
    notes: 'PES format, up to 127 colors'
  },
  janome: {
    name: 'Janome',
    formats: ['JEF'],
    maxColors: 127,
    notes: 'JEF format, up to 127 colors'
  },
  pfaff: {
    name: 'Pfaff',
    formats: ['VP3'],
    maxColors: 127,
    notes: 'VP3 format, up to 127 colors'
  },
  husqvarna: {
    name: 'Husqvarna Viking',
    formats: ['HUS', 'VIP', 'VP3'],
    maxColors: 127,
    notes: 'HUS, VIP, or VP3 formats'
  },
  singer: {
    name: 'Singer',
    formats: ['XXX'],
    maxColors: 127,
    notes: 'XXX format, up to 127 colors'
  },
  toyota: {
    name: 'Toyota',
    formats: ['10O'],
    maxColors: 127,
    notes: '10O format'
  },
  melco: {
    name: 'Melco',
    formats: ['EXP'],
    maxColors: 127,
    notes: 'EXP format for commercial machines'
  },
  tajima: {
    name: 'Tajima',
    formats: ['DST'],
    maxColors: 15,
    notes: 'DST format, limited to 15 color changes'
  },
  generic: {
    name: 'Generic',
    formats: ['DST', 'PES', 'JEF'],
    maxColors: 127,
    notes: 'No specific machine, use common formats'
  }
};

function updateMachineInfo() {
  const select = document.getElementById('tr-machine-select');
  const info = document.getElementById('tr-machine-info');
  
  if (!select || !info) return;
  
  const machineKey = select.value;
  
  if (!machineKey) {
    info.textContent = t('transfer.autoDetectInfo');
    _machineProfile = null;
    return;
  }
  
  _machineProfile = MACHINE_PROFILES[machineKey];
  
  if (_machineProfile) {
    info.innerHTML = `
      <strong>${_machineProfile.name}</strong><br/>
      Formats: ${_machineProfile.formats.join(', ')}<br/>
      ${_machineProfile.notes}
    `;
  }
}

/* ------------------------------------------------------------------ *
 *  Transfer workflow
 * ------------------------------------------------------------------ */
async function executeTransfer() {
  if (!_selectedDest || _sourceFiles.length === 0 || _transferInProgress) return;
  
  _transferInProgress = true;
  
  const progressDiv = document.getElementById('tr-progress');
  const progressFill = document.getElementById('tr-progress-fill');
  const progressText = document.getElementById('tr-progress-text');
  const transferBtn = document.getElementById('tr-transfer-btn');
  
  if (progressDiv) progressDiv.classList.remove('hidden');
  if (transferBtn) transferBtn.disabled = true;
  
  const autoConvert = document.getElementById('tr-auto-convert')?.checked;
  const verifyCopy = document.getElementById('tr-verify-copy')?.checked;
  const createSubfolder = document.getElementById('tr-create-subfolder')?.checked;
  
  try {
    let destPath = _selectedDest.path;
    
    // Create subfolder if requested
    if (createSubfolder) {
      const date = new Date().toISOString().split('T')[0];
      destPath = await window.api.joinPath?.(destPath, `embroidery_${date}`);
      await window.api.ensureDir?.(destPath);
    }
    
    const total = _sourceFiles.length;
    
    for (let i = 0; i < total; i++) {
      const file = _sourceFiles[i];
      
      if (progressText) {
        progressText.textContent = t('transfer.progressTransfer', { current: i + 1, total, name: file.name });
      }
      if (progressFill) {
        progressFill.style.width = `${((i / total) * 100)}%`;
      }
      
      let sourcePath = file.path;
      
      // Auto-convert if needed
      if (autoConvert && _machineProfile) {
        const targetFormat = _machineProfile.formats[0].toLowerCase();
        
        if (!_machineProfile.formats.includes(file.ext.toUpperCase())) {
          if (progressText) {
            progressText.textContent = t('transfer.progressConvert', { name: file.name, format: targetFormat.toUpperCase() });
          }
          
          // Use convert API (stub - needs implementation in main.js)
          const converted = await window.api.convert?.({
            input: file.path,
            format: targetFormat,
            output: await window.api.joinPath?.(destPath, file.name.replace(/\.\w+$/, `.${targetFormat}`))
          });
          
          if (converted?.success) {
            sourcePath = converted.output;
          }
        }
      }
      
      // Copy file
      const destFile = await window.api.joinPath?.(destPath, file.name);
      await window.api.copyFile?.(sourcePath, destFile);
      
      // Verify if requested
      if (verifyCopy) {
        const verified = await window.api.verifyFile?.(sourcePath, destFile);
        if (!verified) {
          throw new Error(`Verification failed for ${file.name}`);
        }
      }
    }
    
    if (progressFill) progressFill.style.width = '100%';
    if (progressText) progressText.textContent = t('transfer.progressComplete', { count: total });
    
    setTimeout(() => {
      if (progressDiv) progressDiv.classList.add('hidden');
      if (progressFill) progressFill.style.width = '0%';
    }, 3000);
    
    alert(t('transfer.successAlert', { count: total, path: _selectedDest.path }));
    
  } catch (err) {
    console.error('Transfer error:', err);
    alert(t('transfer.failedAlert', { error: err.message || String(err) }));
  } finally {
    _transferInProgress = false;
    if (transferBtn) transferBtn.disabled = false;
  }
}

function updateTransferButton() {
  const btn = document.getElementById('tr-transfer-btn');
  if (!btn) return;
  
  btn.disabled = _sourceFiles.length === 0 || !_selectedDest || _transferInProgress;
}

/* ------------------------------------------------------------------ *
 *  Hand-off handlers
 * ------------------------------------------------------------------ */
function handleGalleryHandoff(data) {
  if (data && data.file) {
    const file = data.file;
    
    // Avoid duplicates
    if (_sourceFiles.some(f => f.path === file.path)) return;
    
    _sourceFiles.push({
      path: file.path,
      name: file.name,
      ext: file.ext,
      format: file.ext.toUpperCase()
    });
    
    renderSourceList();
    updateTransferButton();
  }
}

function handleBatchHandoff(data) {
  if (data && data.files && Array.isArray(data.files)) {
    for (const file of data.files) {
      // Avoid duplicates
      if (_sourceFiles.some(f => f.path === file.path)) continue;
      
      _sourceFiles.push({
        path: file.path,
        name: file.name,
        ext: file.ext,
        format: file.ext.toUpperCase()
      });
    }
    
    renderSourceList();
    updateTransferButton();
  }
}

/* ------------------------------------------------------------------ *
 *  Event wiring
 * ------------------------------------------------------------------ */
function wireEvents() {
  const sig = _abortCtrl.signal;
  
  // Add files
  document.getElementById('tr-add-files-btn')
    ?.addEventListener('click', addSourceFiles, { signal: sig });
  
  // Refresh destinations
  document.getElementById('tr-refresh-dest-btn')
    ?.addEventListener('click', refreshDestinations, { signal: sig });
  
  // Pick custom destination
  document.getElementById('tr-pick-custom-btn')
    ?.addEventListener('click', async () => {
      const path = await window.api.selectOutputDir?.();
      if (path) {
        const customPath = document.getElementById('tr-custom-path');
        if (customPath) customPath.textContent = path;
        
        selectDestination({
          type: 'custom',
          path,
          label: path.split(/[/\\]/).pop() || path
        });
      }
    }, { signal: sig });
  
  // Add to favorites
  document.getElementById('tr-add-favorite-btn')
    ?.addEventListener('click', addToFavorites, { signal: sig });
  
  // Machine profile change
  document.getElementById('tr-machine-select')
    ?.addEventListener('change', updateMachineInfo, { signal: sig });
  
  // Transfer button
  document.getElementById('tr-transfer-btn')
    ?.addEventListener('click', executeTransfer, { signal: sig });
  
  // Delegated events for dynamic lists
  document.getElementById('tr-source-list')
    ?.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-index]');
      if (removeBtn) {
        const idx = parseInt(removeBtn.dataset.removeIndex, 10);
        removeSourceFile(idx);
      }
    }, { signal: sig });
  
  document.getElementById('tr-drives-list')
    ?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-dest-index]');
      if (item) {
        const idx = parseInt(item.dataset.destIndex, 10);
        selectDestination(_destinations[idx]);
      }
    }, { signal: sig });
  
  document.getElementById('tr-favorites-list')
    ?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-favorite-index]');
      if (item) {
        const settings = window.store?.get('settings') || {};
        const favorites = settings.transferFavorites || [];
        const idx = parseInt(item.dataset.favoriteIndex, 10);
        if (favorites[idx]) {
          selectDestination({
            type: 'favorite',
            path: favorites[idx].path,
            label: favorites[idx].label
          });
        }
      }
    }, { signal: sig });
}

/* ------------------------------------------------------------------ *
 *  Utilities
 * ------------------------------------------------------------------ */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/* ------------------------------------------------------------------ *
 *  Register with shell router
 * ------------------------------------------------------------------ */
window.registerView('transfer', { mount, unmount });
})();
