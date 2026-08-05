(function () {
'use strict';
/**
 * Simulator View — Stitch-by-stitch playback of embroidery files
 *
 * Three-panel layout:
 *  - Left: Controls (file selector, playback controls, speed, color navigation)
 *  - Center: Canvas (animated stitch rendering)
 *  - Right: Info panel (file metadata, color palette)
 *
 * Features:
 *  - Progressive stitch rendering on HTML canvas
 *  - Play/Pause with adjustable speed (0.5x - 10x)
 *  - Timeline scrubber for jumping to any stitch
 *  - Color navigation (jump to prev/next color block)
 *  - Hand-off from Gallery view
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
let _animationFrameId = null;
let _canvas = null;
let _ctx = null;

// Animation state
let _file = null;            // Current embroidery file metadata (from inspect)
let _segments = [];          // [{hex, pts:[[x,y]...], startIndex, endIndex}]
let _totalPoints = 0;        // Total number of preview points across all segments
let _colors = [];            // Array of {hex, name, startIndex, endIndex, stitchCount}
let _currentIndex = 0;       // Current point index being drawn (0.._totalPoints-1)
let _isPlaying = false;      // Animation playing state
let _speed = 1;              // Playback speed multiplier
let _lastFrameTime = 0;      // For frame timing
let _stitchesPerSecond = 200; // Base speed: 200 stitches/sec at 1x

// Canvas rendering state
let _bounds = null;          // {minX, minY, maxX, maxY}
let _scale = 1;              // Canvas scale factor
let _offsetX = 0;            // Canvas pan offset
let _offsetY = 0;

/* ------------------------------------------------------------------ *
 *  i18n initialization
 * ------------------------------------------------------------------ */
function initI18nText() {
  const setText = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  };
  
  setText('sim-load-btn', 'simulator.loadFile');
  setText('sim-file-name', 'simulator.noFile');
  setText('sim-playback-title', 'simulator.playback');
  setText('sim-speed-label', 'simulator.speed');
  setText('sim-color-nav-title', 'simulator.colorNav');
  setText('sim-prev-color-btn', 'simulator.prevColor');
  setText('sim-next-color-btn', 'simulator.nextColor');
  setText('sim-color-info', 'simulator.noColorData');
  setText('sim-overlay-text', 'simulator.emptyCanvas');
  setText('sim-info-title', 'simulator.fileInfo');
  setText('sim-no-file-text', 'simulator.noFile');
  
  const playBtn = document.getElementById('sim-play-btn');
  if (playBtn) playBtn.title = t('simulator.play');
  
  const resetBtn = document.getElementById('sim-reset-btn');
  if (resetBtn) resetBtn.title = t('simulator.reset');
}

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */
async function mount(container) {
  _abortCtrl = new AbortController();
  
  injectCSS();
  const host = container || document.getElementById('viewHost');
  host.innerHTML = buildHTML();
  
  // Initialize i18n text
  initI18nText();
  
  // Get canvas references
  _canvas = document.getElementById('sim-canvas');
  _ctx = _canvas?.getContext('2d');
  
  if (_canvas && _ctx) {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas, { signal: _abortCtrl.signal });
  }
  
  wireEvents();
  
  // Listen for Gallery hand-off
  window.events?.on('gallery:send-to-simulator', handleGalleryHandoff);
  
  // Check if we have a file path in URL or state
  const urlParams = new URLSearchParams(window.location.hash.substring(1));
  const filePath = urlParams.get('file');
  if (filePath) {
    await loadFile(filePath);
  }
}

function unmount() {
  stopAnimation();
  
  window.events?.off('gallery:send-to-simulator', handleGalleryHandoff);
  
  if (_abortCtrl) {
    _abortCtrl.abort();
    _abortCtrl = null;
  }
  
  removeCSS();
  
  _canvas = null;
  _ctx = null;
  _file = null;
  _segments = [];
  _totalPoints = 0;
  _colors = [];
  _currentIndex = 0;
}

/* ------------------------------------------------------------------ *
 *  HTML template
 * ------------------------------------------------------------------ */
function buildHTML() {
  return `
<div class="sim-root">
  <!-- Left: Controls -->
  <aside class="sim-controls-panel">
    <div class="sim-panel-header">
      <h3>Simulator</h3>
    </div>
    
    <div class="sim-file-selector">
      <button id="sim-load-btn" class="sim-btn-primary"></button>
      <div id="sim-file-name" class="sim-file-name"></div>
    </div>
    
    <div class="sim-playback">
      <h4 id="sim-playback-title"></h4>
      <div class="sim-playback-controls">
        <button id="sim-play-btn" class="sim-icon-btn" disabled>▶</button>
        <button id="sim-reset-btn" class="sim-icon-btn">⏮</button>
      </div>
      <div class="sim-timeline">
        <input type="range" id="sim-scrubber" class="sim-scrubber" min="0" max="100" value="0" disabled />
        <div class="sim-progress-text">
          <span id="sim-current-stitch">0</span> / <span id="sim-total-stitches">0</span>
        </div>
      </div>
      <div class="sim-speed-control">
        <label id="sim-speed-label"></label>
        <select id="sim-speed-select" disabled>
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
          <option value="5">5×</option>
          <option value="10">10×</option>
        </select>
      </div>
    </div>
    
    <div class="sim-color-nav">
      <h4 id="sim-color-nav-title"></h4>
      <div class="sim-color-controls">
        <button id="sim-prev-color-btn" class="sim-btn-secondary" disabled></button>
        <button id="sim-next-color-btn" class="sim-btn-secondary" disabled></button>
      </div>
      <div id="sim-color-info" class="sim-color-info"></div>
    </div>
  </aside>

  <!-- Center: Canvas -->
  <main class="sim-canvas-panel">
    <canvas id="sim-canvas"></canvas>
    <div id="sim-canvas-overlay" class="sim-canvas-overlay">
      <p id="sim-overlay-text"></p>
    </div>
  </main>

  <!-- Right: Info -->
  <aside class="sim-info-panel">
    <div class="sim-panel-header">
      <h3 id="sim-info-title"></h3>
    </div>
    <div id="sim-info-content" class="sim-info-content">
      <p class="sim-empty-state" id="sim-no-file-text"></p>
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
  style.id = 'sim-styles';
  style.textContent = `
/* ── Simulator root ── */
.sim-root {
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  gap: 0;
  height: 100%;
  background: var(--bg, #0f1419);
  color: var(--fg, #e6edf3);
}

/* ── Left: Controls panel ── */
.sim-controls-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: var(--panel-bg, #161b22);
  border-right: 1px solid var(--border, #30363d);
  padding: 16px;
  overflow-y: auto;
}
.sim-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--muted, #8b949e);
  border-bottom: 1px solid var(--border, #30363d);
  padding-bottom: 8px;
}

.sim-file-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sim-btn-primary {
  padding: 10px 16px;
  background: var(--accent, #4a6ef5);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.sim-btn-primary:hover {
  background: var(--accent-hover, #6485ff);
}
.sim-file-name {
  font-size: 11px;
  color: var(--muted, #8b949e);
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-playback h4,
.sim-color-nav h4 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #e6edf3);
}
.sim-playback-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.sim-icon-btn {
  padding: 8px 12px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  color: var(--fg, #e6edf3);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.sim-icon-btn:hover:not(:disabled) {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}
.sim-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sim-icon-btn.playing {
  background: var(--accent, #4a6ef5);
  color: #fff;
  border-color: var(--accent, #4a6ef5);
}

.sim-timeline {
  margin-bottom: 12px;
}
.sim-scrubber {
  width: 100%;
  height: 4px;
  background: var(--input-bg, #0d1117);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
  margin-bottom: 8px;
}
.sim-scrubber::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: var(--accent, #4a6ef5);
  border-radius: 50%;
  cursor: pointer;
}
.sim-scrubber::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--accent, #4a6ef5);
  border-radius: 50%;
  cursor: pointer;
  border: none;
}
.sim-scrubber:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sim-progress-text {
  font-size: 11px;
  color: var(--muted, #8b949e);
  text-align: center;
  font-family: monospace;
}

.sim-speed-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.sim-speed-control label {
  color: var(--muted, #8b949e);
}
.sim-speed-control select {
  flex: 1;
  padding: 6px 8px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  color: var(--fg, #e6edf3);
  font-size: 12px;
}
.sim-speed-control select:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sim-color-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.sim-btn-secondary {
  padding: 8px 12px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 6px;
  color: var(--fg, #e6edf3);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.sim-btn-secondary:hover:not(:disabled) {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}
.sim-btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sim-color-info {
  font-size: 11px;
  color: var(--muted, #8b949e);
}

/* ── Center: Canvas panel ── */
.sim-canvas-panel {
  position: relative;
  background: var(--bg, #0f1419);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
#sim-canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  background: #fff;
  border: 1px solid var(--border, #30363d);
}
.sim-canvas-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 20, 25, 0.9);
  color: var(--muted, #8b949e);
  font-size: 14px;
  pointer-events: none;
}
.sim-canvas-overlay.hidden {
  display: none;
}

/* ── Right: Info panel ── */
.sim-info-panel {
  background: var(--panel-bg, #161b22);
  border-left: 1px solid var(--border, #30363d);
  overflow-y: auto;
}
.sim-info-content {
  padding: 16px;
}
.sim-empty-state {
  color: var(--muted, #8b949e);
  font-size: 12px;
  text-align: center;
  padding: 40px 16px;
}
.sim-info-meta {
  font-size: 11px;
  color: var(--muted, #8b949e);
  margin-bottom: 16px;
}
.sim-info-meta dt {
  font-weight: 600;
  color: var(--fg, #e6edf3);
  margin-top: 8px;
}
.sim-info-meta dd {
  margin: 2px 0 0 0;
}
.sim-color-palette {
  margin-top: 16px;
}
.sim-color-palette h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #e6edf3);
}
.sim-palette-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sim-palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  background: var(--input-bg, #0d1117);
  border: 1px solid var(--border, #30363d);
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}
.sim-palette-item:hover {
  background: var(--hover-bg, #161b22);
  border-color: var(--accent, #4a6ef5);
}
.sim-palette-item.active {
  border-color: var(--accent, #4a6ef5);
  background: var(--hover-bg, #161b22);
}
.sim-palette-swatch {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border, #30363d);
  border-radius: 3px;
  flex-shrink: 0;
}
.sim-palette-label {
  flex: 1;
  color: var(--fg, #e6edf3);
}
.sim-palette-count {
  color: var(--muted, #8b949e);
  font-family: monospace;
}
`;
  document.head.appendChild(style);
}

function removeCSS() {
  document.getElementById('sim-styles')?.remove();
}

/* ------------------------------------------------------------------ *
 *  Canvas management
 * ------------------------------------------------------------------ */
function resizeCanvas() {
  if (!_canvas) return;
  
  const container = _canvas.parentElement;
  if (!container) return;
  
  const rect = container.getBoundingClientRect();
  const maxWidth = rect.width - 40;
  const maxHeight = rect.height - 40;
  
  if (_bounds && _totalPoints > 0) {
    // Fit stitches to canvas
    const width = _bounds.maxX - _bounds.minX;
    const height = _bounds.maxY - _bounds.minY;
    
    const scaleX = maxWidth / width;
    const scaleY = maxHeight / height;
    _scale = Math.min(scaleX, scaleY, 2); // Cap at 2x zoom
    
    _canvas.width = width * _scale;
    _canvas.height = height * _scale;
    
    _offsetX = -_bounds.minX * _scale;
    _offsetY = -_bounds.minY * _scale;
    
    // Redraw current state
    redrawCanvas();
  } else {
    // Default empty canvas
    _canvas.width = maxWidth;
    _canvas.height = maxHeight;
    _ctx.fillStyle = '#fff';
    _ctx.fillRect(0, 0, _canvas.width, _canvas.height);
  }
}

function clearCanvas() {
  if (!_ctx || !_canvas) return;
  _ctx.fillStyle = '#fff';
  _ctx.fillRect(0, 0, _canvas.width, _canvas.height);
}

function redrawCanvas() {
  if (!_ctx || _totalPoints === 0) return;
  
  clearCanvas();
  
  // Draw all segments' points up to the current global point index.
  _ctx.save();
  _ctx.translate(_offsetX, _offsetY);
  _ctx.scale(_scale, _scale);
  
  _ctx.lineWidth = Math.max(0.6 / _scale, 0.5); // Thread thickness (pattern units)
  _ctx.lineCap = 'round';
  _ctx.lineJoin = 'round';
  
  for (const seg of _segments) {
    if (seg.startIndex > _currentIndex) break; // segments are ordered
    const pts = seg.pts;
    // How many points of this segment are visible?
    const visible = Math.min(pts.length, _currentIndex - seg.startIndex + 1);
    if (visible < 2) continue;
    
    _ctx.strokeStyle = seg.hex || '#333333';
    _ctx.beginPath();
    _ctx.moveTo(pts[0][0], pts[0][1]);
    for (let j = 1; j < visible; j++) {
      _ctx.lineTo(pts[j][0], pts[j][1]);
    }
    _ctx.stroke();
  }
  
  _ctx.restore();
}

/* ------------------------------------------------------------------ *
 *  File loading
 * ------------------------------------------------------------------ */
async function loadFile(filePath) {
  try {
    const overlay = document.getElementById('sim-canvas-overlay');
    if (overlay) overlay.textContent = 'Loading file...';
    
    // Inspect file to get full data
    const result = await window.api.inspect(filePath);
    
    if (!result.success) {
      alert('Failed to load file: ' + (result.error || 'Unknown error'));
      return;
    }
    
    _file = result;
    // Derive name/ext from the file path (inspect returns neither).
    const baseName = filePath.split(/[\\/]/).pop() || filePath;
    const dotIdx = baseName.lastIndexOf('.');
    _file.name = baseName;
    _file.path = filePath;
    _file.ext = dotIdx >= 0 ? baseName.slice(dotIdx + 1) : '';
    _currentIndex = 0;
    _isPlaying = false;
    
    // Build render segments from the backend preview polylines.
    // preview = { left, top, width, height, lines: [{hex, pts:[[x,y]...]}] }  (1/10 mm units)
    const preview = result.preview || {};
    const lines = Array.isArray(preview.lines) ? preview.lines : [];
    _segments = [];
    _totalPoints = 0;
    for (const line of lines) {
      const pts = Array.isArray(line.pts) ? line.pts : [];
      if (pts.length === 0) continue;
      const startIndex = _totalPoints;
      const endIndex = startIndex + pts.length - 1;
      _segments.push({
        hex: line.hex || '#333333',
        pts,
        startIndex,
        endIndex
      });
      _totalPoints += pts.length;
    }
    
    // Bounds come directly from the preview extents.
    if (typeof preview.left === 'number' && typeof preview.width === 'number') {
      _bounds = {
        minX: preview.left,
        minY: preview.top,
        maxX: preview.left + preview.width,
        maxY: preview.top + preview.height
      };
    } else {
      _bounds = null;
    }
    
    // Extract color blocks
    _colors = extractColorBlocks();
    
    // Update UI
    updateFileInfo();
    resizeCanvas();
    if (overlay) overlay.classList.add('hidden');
    
    // Enable controls
    document.getElementById('sim-play-btn')?.removeAttribute('disabled');
    document.getElementById('sim-reset-btn')?.removeAttribute('disabled');
    document.getElementById('sim-scrubber')?.removeAttribute('disabled');
    document.getElementById('sim-speed-select')?.removeAttribute('disabled');
    document.getElementById('sim-prev-color-btn')?.removeAttribute('disabled');
    document.getElementById('sim-next-color-btn')?.removeAttribute('disabled');
    
  } catch (err) {
    console.error('Error loading file:', err);
    alert('Error loading file: ' + (err.message || String(err)));
  }
}

function extractColorBlocks() {
  if (!_segments.length) return [];
  
  const blocks = [];
  let current = null;
  
  for (const seg of _segments) {
    const count = seg.endIndex - seg.startIndex + 1;
    if (current && current.hex === seg.hex) {
      // Merge consecutive segments sharing the same thread color.
      current.endIndex = seg.endIndex;
      current.stitchCount += count;
    } else {
      current = {
        hex: seg.hex,
        name: seg.hex,
        startIndex: seg.startIndex,
        endIndex: seg.endIndex,
        stitchCount: count
      };
      blocks.push(current);
    }
  }
  
  return blocks;
}

function updateFileInfo() {
  const nameEl = document.getElementById('sim-file-name');
  if (nameEl && _file) {
    nameEl.textContent = _file.name || 'Unknown';
    nameEl.title = _file.path || '';
  }
  
  // Real stitch count from the backend, falling back to preview point count.
  const stitchCount = (typeof _file?.stitch_count === 'number') ? _file.stitch_count : _totalPoints;
  
  const totalEl = document.getElementById('sim-total-stitches');
  if (totalEl) totalEl.textContent = stitchCount.toLocaleString();
  
  const scrubber = document.getElementById('sim-scrubber');
  if (scrubber) scrubber.max = Math.max(0, _totalPoints - 1);
  
  // Update info panel
  const infoContent = document.getElementById('sim-info-content');
  if (!infoContent || !_file) return;
  
  const w = _file.width_mm, h = _file.height_mm;
  const hasDims = (typeof w === 'number' && typeof h === 'number');
  const metaHTML = `
    <dl class="sim-info-meta">
      <dt>File</dt>
      <dd>${_file.name || 'Unknown'}</dd>
      <dt>Format</dt>
      <dd>${(_file.ext || '').toUpperCase()}</dd>
      <dt>Stitches</dt>
      <dd>${stitchCount.toLocaleString()}</dd>
      <dt>Colors</dt>
      <dd>${(typeof _file.color_count === 'number' ? _file.color_count : _colors.length)}</dd>
      ${hasDims ? `<dt>Dimensions</dt><dd>${w.toFixed(1)} × ${h.toFixed(1)} mm</dd>` : ''}
    </dl>
  `;
  
  const paletteHTML = _colors.length > 0 ? `
    <div class="sim-color-palette">
      <h4>Color Palette</h4>
      <div class="sim-palette-list">
        ${_colors.map((c, i) => `
          <div class="sim-palette-item" data-color-index="${i}">
            <div class="sim-palette-swatch" style="background: ${c.hex}"></div>
            <span class="sim-palette-label">${c.name || 'Color ' + (i + 1)}</span>
            <span class="sim-palette-count">${c.stitchCount}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';
  
  infoContent.innerHTML = metaHTML + paletteHTML;
  
  // Update color info
  updateColorInfo();
}

function updateColorInfo() {
  const colorInfo = document.getElementById('sim-color-info');
  if (!colorInfo || _colors.length === 0) return;
  
  const currentBlock = _colors.find(c => _currentIndex >= c.startIndex && _currentIndex <= c.endIndex);
  if (currentBlock) {
    const colorIndex = _colors.indexOf(currentBlock);
    colorInfo.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="width: 16px; height: 16px; background: ${currentBlock.hex}; border: 1px solid var(--border, #30363d); border-radius: 3px;"></div>
        <span>Color ${colorIndex + 1} / ${_colors.length}: ${currentBlock.name || 'Unknown'}</span>
      </div>
    `;
    
    // Highlight in palette
    document.querySelectorAll('.sim-palette-item').forEach((el, i) => {
      el.classList.toggle('active', i === colorIndex);
    });
  }
}

/* ------------------------------------------------------------------ *
 *  Animation
 * ------------------------------------------------------------------ */
function startAnimation() {
  if (_isPlaying || _totalPoints === 0) return;
  
  _isPlaying = true;
  _lastFrameTime = performance.now();
  
  const playBtn = document.getElementById('sim-play-btn');
  if (playBtn) {
    playBtn.textContent = '⏸';
    playBtn.classList.add('playing');
  }
  
  animate();
}

function stopAnimation() {
  _isPlaying = false;
  
  if (_animationFrameId) {
    cancelAnimationFrame(_animationFrameId);
    _animationFrameId = null;
  }
  
  const playBtn = document.getElementById('sim-play-btn');
  if (playBtn) {
    playBtn.textContent = '▶';
    playBtn.classList.remove('playing');
  }
}

function animate(timestamp) {
  if (!_isPlaying) return;
  
  if (typeof timestamp !== 'number') {
    // First frame (called without a rAF timestamp) — schedule the real one.
    _lastFrameTime = performance.now();
    _animationFrameId = requestAnimationFrame(animate);
    return;
  }
  
  const elapsed = timestamp - _lastFrameTime;
  const stitchesPerFrame = (_stitchesPerSecond * _speed * elapsed) / 1000;
  
  _currentIndex = Math.min(_currentIndex + Math.ceil(stitchesPerFrame), _totalPoints - 1);
  _lastFrameTime = timestamp;
  
  redrawCanvas();
  updateProgress();
  
  if (_currentIndex >= _totalPoints - 1) {
    stopAnimation();
  } else {
    _animationFrameId = requestAnimationFrame(animate);
  }
}

function updateProgress() {
  const currentEl = document.getElementById('sim-current-stitch');
  if (currentEl) currentEl.textContent = _currentIndex.toLocaleString();
  
  const scrubber = document.getElementById('sim-scrubber');
  if (scrubber && !scrubber.matches(':active')) {
    scrubber.value = _currentIndex;
  }
  
  updateColorInfo();
}

function resetAnimation() {
  stopAnimation();
  _currentIndex = 0;
  redrawCanvas();
  updateProgress();
}

function seekToStitch(index) {
  _currentIndex = Math.max(0, Math.min(index, _totalPoints - 1));
  redrawCanvas();
  updateProgress();
}

function jumpToColor(direction) {
  if (_colors.length === 0) return;
  
  const currentBlock = _colors.find(c => _currentIndex >= c.startIndex && _currentIndex <= c.endIndex);
  if (!currentBlock) return;
  
  const currentIndex = _colors.indexOf(currentBlock);
  let targetIndex = currentIndex + direction;
  
  // Wrap around
  if (targetIndex < 0) targetIndex = _colors.length - 1;
  if (targetIndex >= _colors.length) targetIndex = 0;
  
  const targetBlock = _colors[targetIndex];
  seekToStitch(targetBlock.startIndex);
}

/* ------------------------------------------------------------------ *
 *  Gallery hand-off
 * ------------------------------------------------------------------ */
function handleGalleryHandoff(data) {
  if (data && data.file && data.file.path) {
    loadFile(data.file.path);
  }
}

/* ------------------------------------------------------------------ *
 *  Event wiring
 * ------------------------------------------------------------------ */
function wireEvents() {
  const sig = _abortCtrl.signal;
  
  // Load file
  document.getElementById('sim-load-btn')
    ?.addEventListener('click', async () => {
      const files = await window.api.openFiles();
      if (files && files.length > 0) {
        await loadFile(files[0]);
      }
    }, { signal: sig });
  
  // Play/Pause
  document.getElementById('sim-play-btn')
    ?.addEventListener('click', () => {
      if (_isPlaying) {
        stopAnimation();
      } else {
        startAnimation();
      }
    }, { signal: sig });
  
  // Reset
  document.getElementById('sim-reset-btn')
    ?.addEventListener('click', resetAnimation, { signal: sig });
  
  // Scrubber
  document.getElementById('sim-scrubber')
    ?.addEventListener('input', (e) => {
      seekToStitch(parseInt(e.target.value, 10));
    }, { signal: sig });
  
  // Speed
  document.getElementById('sim-speed-select')
    ?.addEventListener('change', (e) => {
      _speed = parseFloat(e.target.value);
    }, { signal: sig });
  
  // Color navigation
  document.getElementById('sim-prev-color-btn')
    ?.addEventListener('click', () => jumpToColor(-1), { signal: sig });
  
  document.getElementById('sim-next-color-btn')
    ?.addEventListener('click', () => jumpToColor(1), { signal: sig });
  
  // Palette item click
  document.getElementById('sim-info-content')
    ?.addEventListener('click', (e) => {
      const item = e.target.closest('.sim-palette-item');
      if (item) {
        const colorIndex = parseInt(item.dataset.colorIndex, 10);
        if (!isNaN(colorIndex) && _colors[colorIndex]) {
          seekToStitch(_colors[colorIndex].startIndex);
        }
      }
    }, { signal: sig });
}

/* ------------------------------------------------------------------ *
 *  Register with shell router
 * ------------------------------------------------------------------ */
window.registerView('simulator', { mount, unmount });
})();
