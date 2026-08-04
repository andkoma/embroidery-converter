'use strict';

/* ------------------------------------------------------------------ *
 *  State
 * ------------------------------------------------------------------ */
const state = {
  files: [],            // { id, path, name, ext, meta, status, threads, result, preview }
  formats: [],          // supported formats from backend
  writable: [],         // writable extensions
  outputDir: '',
  seq: 1,
  lang: 'en',
};

/* ------------------------------------------------------------------ *
 *  i18n helpers
 * ------------------------------------------------------------------ */
function detectLanguage() {
  const saved = (() => { try { return localStorage.getItem('ec_lang'); } catch (_) { return null; } })();
  if (saved && window.I18N && window.I18N[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return (window.I18N && window.I18N[nav]) ? nav : 'en';
}

function t(key, params) {
  const dict = (window.I18N && window.I18N[state.lang]) || (window.I18N && window.I18N.en) || {};
  let s = dict[key];
  if (s === undefined) {
    const en = (window.I18N && window.I18N.en) || {};
    s = en[key] !== undefined ? en[key] : key;
  }
  if (params) {
    for (const k of Object.keys(params)) {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
    }
  }
  return s;
}

// pluralised lookup: uses `${key}_plural` when n != 1
function tp(key, n, params) {
  const useKey = (n === 1) ? key : key + '_plural';
  return t(useKey, Object.assign({ n: n }, params || {}));
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((node) => {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-ph')));
  });
  document.documentElement.lang = state.lang;
}

function setLanguage(lang) {
  if (!window.I18N || !window.I18N[lang]) lang = 'en';
  state.lang = lang;
  try { localStorage.setItem('ec_lang', lang); } catch (_) {}
  applyStaticI18n();
  // re-render dynamic parts that contain translated text
  refreshBackendLabel();
  updateFormatDesc();
  render();
}

// Format badge colors (by vendor family)
const BADGE_COLORS = {
  dst: '#c0392b', pes: '#8e44ad', pec: '#8e44ad', phb: '#8e44ad', phc: '#8e44ad', bro: '#8e44ad',
  jef: '#2980b9', sew: '#2980b9', jpx: '#2980b9', jbf: '#2980b9',
  vp3: '#16a085', hus: '#16a085', shv: '#16a085', ksm: '#d35400', max: '#d35400',
  exp: '#e67e22', xxx: '#27ae60', xyz: '#27ae60', u01: '#2c3e50', dat: '#2c3e50', dsb: '#2c3e50',
  tap: '#7f8c8d', emb: '#34495e', csv: '#95a5a6', json: '#95a5a6', gcode: '#95a5a6',
};

// Formats that don't store color info (so color reduction / palette are limited)
const NO_COLOR_FORMATS = new Set(['dst', 'exp', 'tap', '10o', '100', 'gcode']);

/* ------------------------------------------------------------------ *
 *  Elements
 * ------------------------------------------------------------------ */
const el = (id) => document.getElementById(id);
const dropZone = el('dropZone');
const fileListEl = el('fileList');
const emptyState = el('emptyState');
const fileCountEl = el('fileCount');
const outputFormatEl = el('outputFormat');
const formatDescEl = el('formatDesc');
const widthMm = el('widthMm');
const heightMm = el('heightMm');
const lockAspect = el('lockAspect');
const resample = el('resample');
const limitColorsToggle = el('limitColorsToggle');
const colorLimit = el('colorLimit');
const paletteEl = el('palette');
const colorHint = el('colorHint');
const outputDirEl = el('outputDir');
const convertBtn = el('convertBtn');
const progressWrap = el('progressWrap');
const progressFill = el('progressFill');
const progressText = el('progressText');
const backendBadge = el('backendBadge');
const backendLabel = el('backendLabel');
const langSelect = el('langSelect');

let baseAspect = null; // width/height of the currently-selected reference file
let backendState = { available: false }; // last backend status result

/* ------------------------------------------------------------------ *
 *  Init
 * ------------------------------------------------------------------ */
async function init() {
  state.lang = detectLanguage();
  if (langSelect) langSelect.value = state.lang;
  applyStaticI18n();
  await checkBackend();
  await loadFormats();
  state.outputDir = (await window.api.defaultDir()) || '';
  outputDirEl.value = state.outputDir;
  bindEvents();
  render();
}

async function checkBackend() {
  try {
    backendState = await window.api.backendStatus();
  } catch (e) {
    // Handler is designed never to throw, but stay defensive.
    backendState = { available: false, reason: 'exception', error: (e && e.message) || String(e) };
  }
  if (!backendState.available && backendState.error) {
    console.warn('Backend not available:', backendState.error);
  }
  refreshBackendLabel();
}

function refreshBackendLabel() {
  backendBadge.classList.remove('ok', 'bad');
  const s = backendState || {};
  if (s.available) {
    backendBadge.classList.add('ok');
    backendLabel.textContent =
      s.mode === 'bundled' ? t('backend.ready.bundled') : t('backend.ready.system');
    backendBadge.removeAttribute('title');
  } else {
    backendBadge.classList.add('bad');
    backendLabel.textContent =
      s.reason === 'exception' || s.reason === 'engine-error'
        ? t('backend.error')
        : t('backend.unavailable');
    // Surface the actionable detail as a tooltip instead of a bare "error".
    backendBadge.title = s.error || t('backend.unavailable');
  }
}

async function loadFormats() {
  const res = await window.api.listFormats();
  if (res && res.success) {
    state.formats = res.formats;
    state.writable = res.formats.filter((f) => f.write).map((f) => f.extension);
  } else {
    // fallback writable set
    state.writable = ['dst', 'pes', 'pec', 'exp', 'jef', 'vp3', 'xxx', 'u01', 'tbf', 'csv', 'json', 'gcode', 'pmv'];
    state.formats = state.writable.map((e) => ({ extension: e, description: '', write: true, read: true }));
  }
  // Preferred ordering
  const preferred = ['pes', 'dst', 'jef', 'vp3', 'exp', 'xxx', 'u01', 'pec', 'tbf', 'csv', 'json', 'gcode', 'pmv'];
  const writable = state.formats.filter((f) => f.write);
  writable.sort((a, b) => {
    const ia = preferred.indexOf(a.extension); const ib = preferred.indexOf(b.extension);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.extension.localeCompare(b.extension);
  });
  outputFormatEl.innerHTML = '';
  for (const f of writable) {
    const opt = document.createElement('option');
    opt.value = f.extension;
    opt.textContent = '.' + f.extension.toUpperCase() + (f.description ? '  —  ' + f.description : '');
    outputFormatEl.appendChild(opt);
  }
  outputFormatEl.value = writable.some((f) => f.extension === 'pes') ? 'pes' : writable[0].extension;
  updateFormatDesc();
}

/* ------------------------------------------------------------------ *
 *  Events
 * ------------------------------------------------------------------ */
function bindEvents() {
  // Drag & drop
  ['dragenter', 'dragover'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.add('dragover');
    })
  );
  ['dragleave', 'dragend'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.remove('dragover');
    })
  );
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    dropZone.classList.remove('dragover');
    const paths = [];
    for (const f of e.dataTransfer.files) {
      if (f.path) paths.push(f.path);
    }
    addFiles(paths);
  });
  // Prevent whole-window navigation on stray drops
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  dropZone.addEventListener('click', browse);
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); }
  });
  el('browseBtn').addEventListener('click', (e) => { e.stopPropagation(); browse(); });
  el('clearBtn').addEventListener('click', clearAll);

  outputFormatEl.addEventListener('change', () => { updateFormatDesc(); updateColorHint(); });

  // Resize aspect linking
  widthMm.addEventListener('input', () => onSizeInput('w'));
  heightMm.addEventListener('input', () => onSizeInput('h'));
  el('resetSize').addEventListener('click', resetSize);

  // Colors
  limitColorsToggle.addEventListener('change', () => {
    colorLimit.disabled = !limitColorsToggle.checked;
  });

  el('chooseDirBtn').addEventListener('click', chooseDir);
  convertBtn.addEventListener('click', convertAll);

  // Language selector
  if (langSelect) {
    langSelect.addEventListener('change', () => setLanguage(langSelect.value));
  }
}

async function browse() {
  const paths = await window.api.openFiles();
  if (paths && paths.length) addFiles(paths);
}

async function chooseDir() {
  const dir = await window.api.selectOutputDir();
  if (dir) { state.outputDir = dir; outputDirEl.value = dir; render(); }
}

/* ------------------------------------------------------------------ *
 *  File management
 * ------------------------------------------------------------------ */
async function addFiles(paths) {
  for (const p of paths) {
    if (state.files.some((f) => f.path === p)) continue;
    const name = p.split(/[\\/]/).pop();
    const ext = (name.split('.').pop() || '').toLowerCase();
    const file = {
      id: state.seq++,
      path: p, name, ext,
      meta: null, threads: [], preview: null,
      status: 'pending', result: null,
    };
    state.files.push(file);
    render();
    inspectFile(file);
  }
}

async function inspectFile(file) {
  try {
    const res = await window.api.inspect(file.path);
    if (res && res.success) {
      file.meta = {
        stitches: res.stitch_count,
        colors: res.color_count,
        width: res.width_mm,
        height: res.height_mm,
      };
      file.threads = res.threads || [];
      file.preview = res.preview || null;
    } else {
      file.status = 'error';
      file.result = { error: (res && res.error) || 'Could not read file' };
    }
  } catch (e) {
    file.status = 'error';
    file.result = { error: e.message };
  }
  // Set reference aspect ratio from first successfully-read file
  refreshReference();
  render();
}

function refreshReference() {
  const ref = state.files.find((f) => f.meta && f.meta.width > 0 && f.meta.height > 0);
  if (ref) {
    baseAspect = ref.meta.width / ref.meta.height;
    if (!widthMm.value && !heightMm.value) {
      widthMm.placeholder = ref.meta.width.toFixed(1);
      heightMm.placeholder = ref.meta.height.toFixed(1);
    }
    // populate palette from first file that has threads
    const wt = state.files.find((f) => f.threads && f.threads.length);
    renderPalette(wt ? wt.threads : []);
  } else {
    renderPalette([]);
  }
}

function removeFile(id) {
  state.files = state.files.filter((f) => f.id !== id);
  refreshReference();
  render();
}

function clearAll() {
  state.files = [];
  baseAspect = null;
  widthMm.value = ''; heightMm.value = '';
  renderPalette([]);
  render();
}

/* ------------------------------------------------------------------ *
 *  Size handling (aspect lock)
 * ------------------------------------------------------------------ */
function onSizeInput(which) {
  if (!lockAspect.checked || !baseAspect) return;
  if (which === 'w' && widthMm.value) {
    heightMm.value = (parseFloat(widthMm.value) / baseAspect).toFixed(1);
  } else if (which === 'h' && heightMm.value) {
    widthMm.value = (parseFloat(heightMm.value) * baseAspect).toFixed(1);
  }
}

function resetSize() {
  widthMm.value = ''; heightMm.value = '';
  refreshReference();
}

/* ------------------------------------------------------------------ *
 *  Format / color helpers
 * ------------------------------------------------------------------ */
function updateFormatDesc() {
  const f = state.formats.find((x) => x.extension === outputFormatEl.value);
  formatDescEl.textContent = f && f.description ? f.description : '';
}

function updateColorHint() {
  const tgt = outputFormatEl.value;
  if (NO_COLOR_FORMATS.has(tgt)) {
    colorHint.textContent = t('colors.noStore', { fmt: tgt.toUpperCase() });
  } else {
    colorHint.textContent = '';
  }
}

function renderPalette(threads) {
  paletteEl.innerHTML = '';
  if (!threads || !threads.length) {
    const span = document.createElement('span');
    span.className = 'palette-empty';
    span.textContent = t('colors.noInfo');
    paletteEl.appendChild(span);
    return;
  }
  threads.forEach((th, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = th.hex || '#000';
    sw.title = (th.description || ('Color ' + (i + 1))) + '  ' + (th.hex || '');
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(th.hex) ? th.hex : '#000000';
    inp.addEventListener('input', () => {
      sw.style.background = inp.value;
      th.hex = inp.value; // editable palette (visual)
    });
    sw.appendChild(inp);
    paletteEl.appendChild(sw);
  });
}

/* ------------------------------------------------------------------ *
 *  Conversion
 * ------------------------------------------------------------------ */
function buildOptions() {
  const opts = {};
  const w = parseFloat(widthMm.value);
  const h = parseFloat(heightMm.value);
  if (!isNaN(w) && w > 0) opts.resize_width_mm = w;
  if (!isNaN(h) && h > 0) opts.resize_height_mm = h;
  opts.resample_stitches = !!resample.checked;
  if (limitColorsToggle.checked) {
    const c = parseInt(colorLimit.value, 10);
    if (!isNaN(c) && c > 0) opts.color_limit = c;
  }
  return opts;
}

function outputPathFor(file, fmt) {
  const dir = state.outputDir;
  const base = file.name.replace(/\.[^.]+$/, '');
  const sep = window.api.platform === 'win32' ? '\\' : '/';
  return dir + sep + base + '.' + fmt;
}

async function convertAll() {
  if (!state.files.length || !state.outputDir) return;
  const fmt = outputFormatEl.value;
  const options = buildOptions();

  convertBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  const pending = state.files.filter((f) => f.status !== 'error' || f.meta);
  let done = 0;

  for (const file of state.files) {
    if (!file.meta) { continue; } // unreadable
    file.status = 'converting';
    file.result = null;
    render();
    progressText.textContent = t('progress.converting', { name: file.name });

    const payload = {
      input_path: file.path,
      output_path: outputPathFor(file, fmt),
      output_format: fmt,
      options,
    };
    try {
      const res = await window.api.convert(payload);
      if (res && res.success) {
        file.status = 'done';
        file.result = res;
        file.meta = {
          stitches: res.stitch_count,
          colors: res.color_count,
          width: res.width_mm,
          height: res.height_mm,
        };
      } else {
        file.status = 'error';
        file.result = { error: (res && res.error) || 'Conversion failed' };
      }
    } catch (e) {
      file.status = 'error';
      file.result = { error: e.message };
    }
    done++;
    progressFill.style.width = Math.round((done / Math.max(pending.length, 1)) * 100) + '%';
    render();
  }

  progressText.textContent = t('progress.finished', {
    ok: state.files.filter((f) => f.status === 'done').length,
    failed: state.files.filter((f) => f.status === 'error').length,
  });
  convertBtn.disabled = false;
  updateConvertButton();
}

/* ------------------------------------------------------------------ *
 *  Rendering
 * ------------------------------------------------------------------ */
function badgeColor(ext) {
  return BADGE_COLORS[ext] || '#5b5bd6';
}

function statusNode(file) {
  const wrap = document.createElement('div');
  wrap.className = 'file-status status-' + file.status;
  const icon = document.createElement('span');
  icon.className = 'status-icon';
  let label = '';
  if (file.status === 'pending') { icon.textContent = '•'; label = t('status.ready'); }
  else if (file.status === 'converting') { icon.innerHTML = '<span class="spinner"></span>'; label = t('status.converting'); }
  else if (file.status === 'done') { icon.textContent = '✓'; label = t('status.done'); }
  else if (file.status === 'error') { icon.textContent = '✕'; label = t('status.error'); }
  const text = document.createElement('span');
  text.textContent = label;
  wrap.appendChild(icon); wrap.appendChild(text);
  if (file.status === 'done' && file.result && file.result.output_path) {
    wrap.style.cursor = 'pointer';
    wrap.title = t('status.showInFolder');
    wrap.addEventListener('click', () => window.api.showItem(file.result.output_path));
  }
  if (file.status === 'error' && file.result) {
    wrap.title = file.result.error || 'Error';
  }
  return wrap;
}

function metaText(file) {
  if (file.status === 'error' && file.result) {
    return t('meta.errorPrefix', { msg: (file.result.error || '').split('\n')[0] });
  }
  if (!file.meta) return t('meta.reading');
  const m = file.meta;
  const parts = [
    t('meta.stitches', { n: m.stitches.toLocaleString() }),
    tp('meta.colors', m.colors),
    t('meta.size', { w: m.width, h: m.height }),
  ];
  let extra = '';
  if (file.status === 'done' && file.result && file.result.warnings && file.result.warnings.length) {
    extra = '  ⚠ ' + tp('meta.notes', file.result.warnings.length);
  }
  return parts.join('  •  ') + extra;
}

/**
 * Draw a stitch preview onto a canvas. `preview` is the object returned by the
 * backend: { left, top, width, height, lines: [{hex, pts:[[x,y],...]}] } in
 * pattern units (1/10 mm). We normalise + fit into the canvas with padding.
 */
function drawPreview(canvas, preview) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // subtle background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const pad = 6;
  const pw = preview.width || 1;
  const ph = preview.height || 1;
  const scale = Math.min((W - 2 * pad) / pw, (H - 2 * pad) / ph);
  // centre the design
  const offX = (W - pw * scale) / 2;
  const offY = (H - ph * scale) / 2;

  const tx = (x) => offX + (x - preview.left) * scale;
  const ty = (y) => offY + (y - preview.top) * scale;

  ctx.lineWidth = 0.9;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const line of preview.lines) {
    if (!line.pts || line.pts.length < 2) continue;
    ctx.strokeStyle = line.hex || '#333';
    ctx.beginPath();
    ctx.moveTo(tx(line.pts[0][0]), ty(line.pts[0][1]));
    for (let i = 1; i < line.pts.length; i++) {
      ctx.lineTo(tx(line.pts[i][0]), ty(line.pts[i][1]));
    }
    ctx.stroke();
  }
}

function render() {
  fileCountEl.textContent = state.files.length;
  emptyState.style.display = state.files.length ? 'none' : 'block';
  fileListEl.innerHTML = '';

  for (const file of state.files) {
    const li = document.createElement('li');
    li.className = 'file-item';

    // Preview thumbnail (vector render of the stitches)
    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';
    if (file.preview && file.preview.lines && file.preview.lines.length) {
      const canvas = document.createElement('canvas');
      canvas.width = 96; canvas.height = 96;
      canvas.className = 'thumb-canvas';
      thumb.appendChild(canvas);
      // draw after it is in the DOM
      drawPreview(canvas, file.preview);
    } else {
      const badge = document.createElement('div');
      badge.className = 'fmt-badge thumb-badge';
      badge.style.background = badgeColor(file.ext);
      badge.textContent = file.ext;
      thumb.appendChild(badge);
    }

    const main = document.createElement('div');
    main.className = 'file-main';
    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.textContent = metaText(file);
    main.appendChild(name); main.appendChild(meta);

    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.innerHTML = '&times;';
    remove.title = t('status.remove');
    remove.addEventListener('click', () => removeFile(file.id));

    li.appendChild(thumb);
    li.appendChild(main);
    li.appendChild(statusNode(file));
    li.appendChild(remove);
    fileListEl.appendChild(li);
  }

  outputDirEl.value = state.outputDir || '';
  updateConvertButton();
  updateColorHint();
}

function updateConvertButton() {
  const hasReadable = state.files.some((f) => f.meta);
  convertBtn.disabled = !(hasReadable && state.outputDir);
}

window.addEventListener('DOMContentLoaded', init);
