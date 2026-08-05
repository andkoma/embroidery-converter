/**
 * Embroidery Converter - Convert View Module
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Self-contained view module for the single-file conversion screen.
 * Implements the view contract: mount(container, store) + unmount().
 *
 * Behaviour is identical to the original renderer.js — this is a
 * structural migration, not a feature change.
 */
'use strict';

const ConvertView = (() => {

  /* ---------------------------------------------------------------- *
   *  Constants
   * ---------------------------------------------------------------- */
  const BADGE_COLORS = {
    dst:'#c0392b', pes:'#8e44ad', pec:'#8e44ad', phb:'#8e44ad', phc:'#8e44ad', bro:'#8e44ad',
    jef:'#2980b9', sew:'#2980b9', jpx:'#2980b9', jbf:'#2980b9',
    vp3:'#16a085', hus:'#16a085', shv:'#16a085', ksm:'#d35400', max:'#d35400',
    exp:'#e67e22', xxx:'#27ae60', xyz:'#27ae60', u01:'#2c3e50', dat:'#2c3e50', dsb:'#2c3e50',
    tap:'#7f8c8d', emb:'#34495e', csv:'#95a5a6', json:'#95a5a6', gcode:'#95a5a6',
  };
  const NO_COLOR_FORMATS = new Set(['dst','exp','tap','10o','100','gcode']);
  const PREFERRED_ORDER  = ['pes','dst','jef','vp3','exp','xxx','u01','pec','tbf','csv','json','gcode','pmv'];

  /* ---------------------------------------------------------------- *
   *  Per-mount state (reset each time mount() is called)
   * ---------------------------------------------------------------- */
  let _store      = null;
  let _container  = null;
  let _seq        = 1;
  let _files      = [];       // FileRecord[]
  let _formats    = [];
  let _writable   = [];
  let _outputDir  = '';
  let _baseAspect = null;
  let _abortCtrl  = null;     // AbortController for event cleanup

  // DOM refs (populated in mount)
  let dropZone, fileListEl, emptyState, fileCountEl,
      outputFormatEl, formatDescEl,
      widthMm, heightMm, lockAspect, resample,
      limitColorsToggle, colorLimit, colorLimitField,
      paletteEl, colorHint,
      outputDirEl, convertBtn,
      progressWrap, progressFill, progressText;

  /* ---------------------------------------------------------------- *
   *  i18n helpers (delegates to shell-level I18N)
   * ---------------------------------------------------------------- */
  function getLang() {
    return (_store && _store.get('settings.language')) || 'en';
  }

  function t(key, params) {
    const lang = getLang();
    const dict = (window.I18N && window.I18N[lang]) || (window.I18N && window.I18N.en) || {};
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

  function tp(key, n, params) {
    return t(n === 1 ? key : key + '_plural', Object.assign({ n }, params || {}));
  }

  function applyI18n(root) {
    root.querySelectorAll('[data-i18n]').forEach(node => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(node => {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-ph')));
    });
  }

  /* ---------------------------------------------------------------- *
   *  HTML template
   * ---------------------------------------------------------------- */
  function buildHTML() {
    return `
      <main class="content">
        <!-- Left: drop zone + file list -->
        <section class="left">
          <div id="cv-dropZone" class="dropzone" tabindex="0">
            <div class="dropzone-inner">
              <svg class="drop-icon" viewBox="0 0 24 24" width="54" height="54" fill="none"
                   stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 16V4"/><path d="M7 9l5-5 5 5"/>
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
              </svg>
              <p class="drop-title" data-i18n="drop.title">Drag &amp; drop embroidery files here</p>
              <p class="drop-sub">
                <span data-i18n="drop.or">or</span>
                <button id="cv-browseBtn" class="link-btn" type="button" data-i18n="drop.browse">browse files</button>
              </p>
              <p class="drop-formats" data-i18n="drop.formats">DST · PES · JEF · VP3 · HUS · XXX · EXP · SEW · U01 · and more</p>
            </div>
          </div>

          <div class="filelist-header">
            <h2><span data-i18n="files.title">Files</span> <span id="cv-fileCount" class="count">0</span></h2>
            <button id="cv-clearBtn" class="ghost-btn" type="button" data-i18n="files.clear">Clear all</button>
          </div>
          <ul id="cv-fileList" class="filelist"></ul>
          <div id="cv-emptyState" class="empty-state" data-i18n="files.empty">No files added yet.</div>
        </section>

        <!-- Right: options panels -->
        <aside class="right">
          <div class="panel">
            <h3 class="panel-title" data-i18n="out.format">Output format</h3>
            <select id="cv-outputFormat" class="select"></select>
            <p id="cv-formatDesc" class="format-desc"></p>
          </div>

          <div class="panel">
            <h3 class="panel-title" data-i18n="resize.title">Resize &amp; resample</h3>
            <div class="row two">
              <label class="field">
                <span data-i18n="resize.width">Width (mm)</span>
                <input id="cv-widthMm" class="input" type="number" min="1" step="0.1"
                       placeholder="auto" data-i18n-ph="resize.auto" />
              </label>
              <label class="field">
                <span data-i18n="resize.height">Height (mm)</span>
                <input id="cv-heightMm" class="input" type="number" min="1" step="0.1"
                       placeholder="auto" data-i18n-ph="resize.auto" />
              </label>
            </div>
            <label class="check">
              <input id="cv-lockAspect" type="checkbox" checked />
              <span data-i18n="resize.lock">Lock aspect ratio</span>
            </label>
            <label class="check">
              <input id="cv-resample" type="checkbox" />
              <span data-i18n="resize.resample">Resample stitches
                <small data-i18n="resize.resampleHint">(keep stitch density when resizing)</small>
              </span>
            </label>
            <button id="cv-resetSize" class="ghost-btn small" type="button" data-i18n="resize.reset">
              Reset to original size
            </button>
          </div>

          <div class="panel" id="cv-colorPanel">
            <h3 class="panel-title" data-i18n="colors.title">Colors</h3>
            <label class="check">
              <input id="cv-limitColorsToggle" type="checkbox" />
              <span data-i18n="colors.limit">Limit color count</span>
            </label>
            <label class="field inline" id="cv-colorLimitField">
              <span data-i18n="colors.max">Max colors</span>
              <input id="cv-colorLimit" class="input small" type="number" min="1" step="1"
                     value="15" disabled />
            </label>
            <div class="palette-wrap">
              <span class="palette-label" data-i18n="colors.palette">Palette</span>
              <div id="cv-palette" class="palette"></div>
            </div>
            <p class="hint" id="cv-colorHint"></p>
          </div>
        </aside>
      </main>

      <!-- Bottom bar -->
      <footer class="bottombar">
        <div class="outdir">
          <span class="outdir-label" data-i18n="out.folder">Output folder</span>
          <div class="outdir-row">
            <input id="cv-outputDir" class="input" type="text" readonly
                   placeholder="Choose a folder…" data-i18n-ph="out.choosePh" />
            <button id="cv-chooseDirBtn" class="ghost-btn" type="button" data-i18n="out.choose">Choose…</button>
          </div>
        </div>
        <div class="convert-area">
          <div id="cv-progressWrap" class="progress-wrap hidden">
            <div class="progress-bar"><div id="cv-progressFill" class="progress-fill"></div></div>
            <span id="cv-progressText" class="progress-text"></span>
          </div>
          <button id="cv-convertBtn" class="primary-btn" type="button" disabled data-i18n="convert.btn">
            Convert
          </button>
        </div>
      </footer>
    `;
  }

  /* ---------------------------------------------------------------- *
   *  DOM helpers
   * ---------------------------------------------------------------- */
  function q(id) { return _container.querySelector('#' + id); }

  function grabRefs() {
    dropZone          = q('cv-dropZone');
    fileListEl        = q('cv-fileList');
    emptyState        = q('cv-emptyState');
    fileCountEl       = q('cv-fileCount');
    outputFormatEl    = q('cv-outputFormat');
    formatDescEl      = q('cv-formatDesc');
    widthMm           = q('cv-widthMm');
    heightMm          = q('cv-heightMm');
    lockAspect        = q('cv-lockAspect');
    resample          = q('cv-resample');
    limitColorsToggle = q('cv-limitColorsToggle');
    colorLimit        = q('cv-colorLimit');
    colorLimitField   = q('cv-colorLimitField');
    paletteEl         = q('cv-palette');
    colorHint         = q('cv-colorHint');
    outputDirEl       = q('cv-outputDir');
    convertBtn        = q('cv-convertBtn');
    progressWrap      = q('cv-progressWrap');
    progressFill      = q('cv-progressFill');
    progressText      = q('cv-progressText');
  }

  /* ---------------------------------------------------------------- *
   *  Init
   * ---------------------------------------------------------------- */
  async function init() {
    await loadFormats();
    _outputDir = (await window.api.defaultDir()) || '';
    outputDirEl.value = _outputDir;
    render();
  }

  async function loadFormats() {
    const res = await window.api.listFormats();
    if (res && res.success) {
      _formats  = res.formats;
      _writable = res.formats.filter(f => f.write).map(f => f.extension);
    } else {
      _writable = ['dst','pes','pec','exp','jef','vp3','xxx','u01','tbf','csv','json','gcode','pmv'];
      _formats  = _writable.map(e => ({ extension: e, description: '', write: true, read: true }));
    }

    const writable = _formats.filter(f => f.write);
    writable.sort((a, b) => {
      const ia = PREFERRED_ORDER.indexOf(a.extension);
      const ib = PREFERRED_ORDER.indexOf(b.extension);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.extension.localeCompare(b.extension);
    });

    outputFormatEl.innerHTML = '';
    for (const f of writable) {
      const opt = document.createElement('option');
      opt.value = f.extension;
      opt.textContent = '.' + f.extension.toUpperCase() + (f.description ? '  —  ' + f.description : '');
      outputFormatEl.appendChild(opt);
    }
    outputFormatEl.value = writable.some(f => f.extension === 'pes') ? 'pes' : (writable[0] || {}).extension;
    updateFormatDesc();
  }

  /* ---------------------------------------------------------------- *
   *  Event binding  (AbortController for clean unmount)
   * ---------------------------------------------------------------- */
  function bindEvents() {
    const sig = _abortCtrl.signal;
    const on   = (el, ev, fn, opts) => el.addEventListener(ev, fn, opts ? { ...opts, signal: sig } : { signal: sig });

    // Drag & drop on zone
    ['dragenter', 'dragover'].forEach(ev =>
      on(dropZone, ev, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); })
    );
    ['dragleave', 'dragend'].forEach(ev =>
      on(dropZone, ev, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); })
    );
    on(dropZone, 'drop', e => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.remove('dragover');
      const paths = [];
      for (const f of e.dataTransfer.files) { if (f.path) paths.push(f.path); }
      addFiles(paths);
    });

    // Prevent stray drops navigating the whole window
    on(window, 'dragover', e => e.preventDefault());
    on(window, 'drop',     e => e.preventDefault());

    // Browse / clear
    on(dropZone,         'click',   browse);
    on(dropZone,         'keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } });
    on(q('cv-browseBtn'), 'click',  e => { e.stopPropagation(); browse(); });
    on(q('cv-clearBtn'),  'click',  clearAll);

    // Format selector
    on(outputFormatEl, 'change', () => { updateFormatDesc(); updateColorHint(); });

    // Resize
    on(widthMm,          'input', () => onSizeInput('w'));
    on(heightMm,         'input', () => onSizeInput('h'));
    on(q('cv-resetSize'), 'click', resetSize);

    // Colors
    on(limitColorsToggle, 'change', () => { colorLimit.disabled = !limitColorsToggle.checked; });

    // Output dir + convert
    on(q('cv-chooseDirBtn'), 'click', chooseDir);
    on(convertBtn,           'click', convertAll);

    // Reflect language changes from the shell store
    _store.subscribe(state => {
      if (!_container) return;
      applyI18n(_container);
      updateFormatDesc();
      updateColorHint();
      render();
    });
  }

  /* ---------------------------------------------------------------- *
   *  File actions
   * ---------------------------------------------------------------- */
  async function browse() {
    const paths = await window.api.openFiles();
    if (paths && paths.length) addFiles(paths);
  }

  async function chooseDir() {
    const dir = await window.api.selectOutputDir();
    if (dir) { _outputDir = dir; outputDirEl.value = dir; render(); }
  }

  async function addFiles(paths) {
    for (const p of paths) {
      if (_files.some(f => f.path === p)) continue;
      const name = p.split(/[\\/]/).pop();
      const ext  = (name.split('.').pop() || '').toLowerCase();
      const file = { id: _seq++, path: p, name, ext, meta: null, threads: [], preview: null,
                     status: 'pending', result: null };
      _files.push(file);
      render();
      inspectFile(file);
    }
  }

  async function inspectFile(file) {
    try {
      const res = await window.api.inspect(file.path);
      if (res && res.success) {
        file.meta    = { stitches: res.stitch_count, colors: res.color_count,
                         width: res.width_mm, height: res.height_mm };
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
    refreshReference();
    render();
  }

  function refreshReference() {
    const ref = _files.find(f => f.meta && f.meta.width > 0 && f.meta.height > 0);
    if (ref) {
      _baseAspect = ref.meta.width / ref.meta.height;
      if (!widthMm.value && !heightMm.value) {
        widthMm.placeholder  = ref.meta.width.toFixed(1);
        heightMm.placeholder = ref.meta.height.toFixed(1);
      }
      const wt = _files.find(f => f.threads && f.threads.length);
      renderPalette(wt ? wt.threads : []);
    } else {
      renderPalette([]);
    }
  }

  function removeFile(id) {
    _files = _files.filter(f => f.id !== id);
    refreshReference();
    render();
  }

  function clearAll() {
    _files = []; _baseAspect = null;
    widthMm.value = ''; heightMm.value = '';
    renderPalette([]);
    render();
  }

  /* ---------------------------------------------------------------- *
   *  Resize / aspect
   * ---------------------------------------------------------------- */
  function onSizeInput(which) {
    if (!lockAspect.checked || !_baseAspect) return;
    if (which === 'w' && widthMm.value)  heightMm.value = (parseFloat(widthMm.value)  / _baseAspect).toFixed(1);
    if (which === 'h' && heightMm.value) widthMm.value  = (parseFloat(heightMm.value) * _baseAspect).toFixed(1);
  }

  function resetSize() {
    widthMm.value = ''; heightMm.value = '';
    refreshReference();
  }

  /* ---------------------------------------------------------------- *
   *  Format / color helpers
   * ---------------------------------------------------------------- */
  function updateFormatDesc() {
    if (!outputFormatEl) return;
    const f = _formats.find(x => x.extension === outputFormatEl.value);
    if (formatDescEl) formatDescEl.textContent = f && f.description ? f.description : '';
  }

  function updateColorHint() {
    if (!outputFormatEl || !colorHint) return;
    const tgt = outputFormatEl.value;
    colorHint.textContent = NO_COLOR_FORMATS.has(tgt)
      ? t('colors.noStore', { fmt: tgt.toUpperCase() }) : '';
  }

  function renderPalette(threads) {
    if (!paletteEl) return;
    paletteEl.innerHTML = '';
    if (!threads || !threads.length) {
      const span = document.createElement('span');
      span.className   = 'palette-empty';
      span.textContent = t('colors.noInfo');
      paletteEl.appendChild(span);
      return;
    }
    threads.forEach((th, i) => {
      const sw  = document.createElement('div');
      sw.className     = 'swatch';
      sw.style.background = th.hex || '#000';
      sw.title         = (th.description || ('Color ' + (i + 1))) + '  ' + (th.hex || '');
      const inp        = document.createElement('input');
      inp.type         = 'color';
      inp.value        = /^#[0-9a-f]{6}$/i.test(th.hex) ? th.hex : '#000000';
      inp.addEventListener('input', () => { sw.style.background = inp.value; th.hex = inp.value; });
      sw.appendChild(inp);
      paletteEl.appendChild(sw);
    });
  }

  /* ---------------------------------------------------------------- *
   *  Conversion
   * ---------------------------------------------------------------- */
  function buildOptions() {
    const opts = {};
    const w = parseFloat(widthMm.value);
    const h = parseFloat(heightMm.value);
    if (!isNaN(w) && w > 0) opts.resize_width_mm  = w;
    if (!isNaN(h) && h > 0) opts.resize_height_mm = h;
    opts.resample_stitches = !!resample.checked;
    if (limitColorsToggle.checked) {
      const c = parseInt(colorLimit.value, 10);
      if (!isNaN(c) && c > 0) opts.color_limit = c;
    }
    return opts;
  }

  function outputPathFor(file, fmt) {
    const sep  = window.api.platform === 'win32' ? '\\' : '/';
    const base = file.name.replace(/\.[^.]+$/, '');
    return _outputDir + sep + base + '.' + fmt;
  }

  async function convertAll() {
    if (!_files.length || !_outputDir) return;
    const fmt     = outputFormatEl.value;
    const options = buildOptions();

    convertBtn.disabled = true;
    progressWrap.classList.remove('hidden');
    const pending = _files.filter(f => f.meta);
    let done = 0;

    for (const file of _files) {
      if (!file.meta) continue;
      file.status = 'converting';
      file.result = null;
      render();
      progressText.textContent = t('progress.converting', { name: file.name });

      const payload = {
        input_path:    file.path,
        output_path:   outputPathFor(file, fmt),
        output_format: fmt,
        options,
      };
      try {
        const res = await window.api.convert(payload);
        if (res && res.success) {
          file.status = 'done';
          file.result = res;
          file.meta   = { stitches: res.stitch_count, colors: res.color_count,
                          width: res.width_mm, height: res.height_mm };
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
      ok:     _files.filter(f => f.status === 'done').length,
      failed: _files.filter(f => f.status === 'error').length,
    });
    convertBtn.disabled = false;
    updateConvertButton();
  }

  /* ---------------------------------------------------------------- *
   *  Render helpers
   * ---------------------------------------------------------------- */
  function badgeColor(ext) { return BADGE_COLORS[ext] || '#5b5bd6'; }

  function statusNode(file) {
    const wrap = document.createElement('div');
    wrap.className = 'file-status status-' + file.status;
    const icon = document.createElement('span');
    icon.className = 'status-icon';
    let label = '';
    if      (file.status === 'pending')    { icon.textContent  = '•';  label = t('status.ready'); }
    else if (file.status === 'converting') { icon.innerHTML    = '<span class="spinner"></span>'; label = t('status.converting'); }
    else if (file.status === 'done')       { icon.textContent  = '✓';  label = t('status.done'); }
    else if (file.status === 'error')      { icon.textContent  = '✕';  label = t('status.error'); }
    const text = document.createElement('span');
    text.textContent = label;
    wrap.appendChild(icon); wrap.appendChild(text);
    if (file.status === 'done' && file.result && file.result.output_path) {
      wrap.style.cursor = 'pointer';
      wrap.title = t('status.showInFolder');
      wrap.addEventListener('click', () => window.api.showItem(file.result.output_path));
    }
    if (file.status === 'error' && file.result) wrap.title = file.result.error || 'Error';
    return wrap;
  }

  function metaText(file) {
    if (file.status === 'error' && file.result)
      return t('meta.errorPrefix', { msg: (file.result.error || '').split('\n')[0] });
    if (!file.meta) return t('meta.reading');
    const m = file.meta;
    const parts = [
      t('meta.stitches', { n: m.stitches.toLocaleString() }),
      tp('meta.colors',  m.colors),
      t('meta.size', { w: m.width, h: m.height }),
    ];
    let extra = '';
    if (file.status === 'done' && file.result && file.result.warnings && file.result.warnings.length)
      extra = '  ⚠ ' + tp('meta.notes', file.result.warnings.length);
    return parts.join('  •  ') + extra;
  }

  function drawPreview(canvas, preview) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const pad = 6, pw = preview.width || 1, ph = preview.height || 1;
    const scale = Math.min((W - 2*pad) / pw, (H - 2*pad) / ph);
    const offX  = (W - pw * scale) / 2;
    const offY  = (H - ph * scale) / 2;
    const tx = x => offX + (x - preview.left) * scale;
    const ty = y => offY + (y - preview.top)  * scale;
    ctx.lineWidth = 0.9; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const line of preview.lines) {
      if (!line.pts || line.pts.length < 2) continue;
      ctx.strokeStyle = line.hex || '#333';
      ctx.beginPath();
      ctx.moveTo(tx(line.pts[0][0]), ty(line.pts[0][1]));
      for (let i = 1; i < line.pts.length; i++) ctx.lineTo(tx(line.pts[i][0]), ty(line.pts[i][1]));
      ctx.stroke();
    }
  }

  function render() {
    if (!fileCountEl) return; // guard for async race after unmount
    fileCountEl.textContent = _files.length;
    emptyState.style.display = _files.length ? 'none' : 'block';
    fileListEl.innerHTML = '';

    for (const file of _files) {
      const li   = document.createElement('li');
      li.className = 'file-item';

      // Thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'file-thumb';
      if (file.preview && file.preview.lines && file.preview.lines.length) {
        const canvas = document.createElement('canvas');
        canvas.width = 96; canvas.height = 96;
        canvas.className = 'thumb-canvas';
        thumb.appendChild(canvas);
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
      name.className = 'file-name'; name.textContent = file.name;
      const meta = document.createElement('div');
      meta.className = 'file-meta'; meta.textContent = metaText(file);
      main.appendChild(name); main.appendChild(meta);

      const remove = document.createElement('button');
      remove.className = 'remove-btn'; remove.innerHTML = '&times;';
      remove.title = t('status.remove');
      remove.addEventListener('click', () => removeFile(file.id));

      li.appendChild(thumb); li.appendChild(main);
      li.appendChild(statusNode(file)); li.appendChild(remove);
      fileListEl.appendChild(li);
    }

    outputDirEl.value = _outputDir || '';
    updateConvertButton();
    updateColorHint();
  }

  function updateConvertButton() {
    if (!convertBtn) return;
    convertBtn.disabled = !(_files.some(f => f.meta) && _outputDir);
  }

  /* ---------------------------------------------------------------- *
   *  View contract
   * ---------------------------------------------------------------- */
  async function mount(container, store) {
    _store     = store;
    _container = container;
    _files     = [];
    _seq       = 1;
    _baseAspect = null;
    _abortCtrl  = new AbortController();

    container.innerHTML = buildHTML();
    grabRefs();
    applyI18n(container);
    bindEvents();
    await init();
  }

  function unmount() {
    // Cancel all event listeners registered with this AbortController
    if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
    _container = null;
    // Clear DOM refs so stray async callbacks can bail out safely (render() checks fileCountEl)
    fileCountEl = null;
  }

  return { mount, unmount };
})();

// Register with shell router
window.registerView('convert', ConvertView);
