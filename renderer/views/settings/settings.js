(function () {
'use strict';
/**
 * Settings View — centralized personal settings across topics.
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Two-column layout:
 *  - Left: topic list (General, Folders, Conversion, Transfer, AI & Vision, About)
 *  - Right: the selected topic's form
 *
 * All settings are persisted via window.api.setSettings(patch) and mirrored
 * into the shared store so other views pick them up live.
 */

/* ------------------------------------------------------------------ *
 *  i18n helper
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

/* ------------------------------------------------------------------ *
 *  Module state
 * ------------------------------------------------------------------ */
let _abort = null;
let _settings = null;      // working copy of full settings object
let _activeTopic = 'general';
let _formats = [];         // available output formats
let _appVersion = '';      // packaged app version
let _editingProviderId = null; // provider card currently expanded for editing

/* ------------------------------------------------------------------ *
 *  AI provider kinds — mirrors PROVIDER_KINDS in main.js.
 *  canHaveKey=false  → local runtime, NEVER shows or stores a secret.
 *  requiresKey=true  → a secret MUST be set for the provider to work.
 *  external=true     → traffic leaves the machine (privacy-relevant).
 * ------------------------------------------------------------------ */
const PROVIDER_KINDS = {
  'openai':            { label: 'OpenAI',              requiresKey: true,  canHaveKey: true,  external: true,  defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  'openai-compatible': { label: 'OpenAI-compatible',   requiresKey: false, canHaveKey: true,  external: true,  defaultBaseUrl: '',                          defaultModel: '' },
  'ollama':            { label: 'Ollama (local)',      requiresKey: false, canHaveKey: false, external: false, defaultBaseUrl: 'http://localhost:11434',    defaultModel: 'llava' },
  'lmstudio':          { label: 'LM Studio (local)',   requiresKey: false, canHaveKey: false, external: false, defaultBaseUrl: 'http://localhost:1234/v1',  defaultModel: 'local-model' },
};

const TOPICS = [
  { id: 'general',    key: 'settings.topic.general',    icon: '⚙️' },
  { id: 'folders',    key: 'settings.topic.folders',    icon: '📁' },
  { id: 'conversion', key: 'settings.topic.conversion', icon: '🔄' },
  { id: 'transfer',   key: 'settings.topic.transfer',   icon: '📤' },
  { id: 'cache',      key: 'settings.topic.cache',      icon: '🗂️' },
  { id: 'ai',         key: 'settings.topic.ai',         icon: '✨' },
  { id: 'about',      key: 'settings.topic.about',      icon: 'ℹ️' },
];

/** Human-readable byte size. */
function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */
async function mount(container) {
  _abort = new AbortController();
  injectCSS();

  // Load a fresh copy of settings from the main process
  try {
    _settings = await window.api.getSettings();
  } catch (_) {
    _settings = window.store?.get('settings') || {};
  }
  // Deep-ensure nested objects exist so the forms never touch undefined
  _settings = normalize(_settings);

  // Formats for the conversion default dropdown
  try {
    const r = await window.api.listFormats();
    _formats = (r && r.formats) ? r.formats : [];
  } catch (_) { _formats = []; }

  try { _appVersion = window.api.getAppVersion ? await window.api.getAppVersion() : ''; }
  catch (_) { _appVersion = ''; }

  const host = container || document.getElementById('viewHost');
  host.innerHTML = buildHTML();
  renderTopic();
  wireTopicNav();
}

function unmount() {
  if (_abort) { _abort.abort(); _abort = null; }
  removeCSS();
  _settings = null;
  _formats = [];
}

function normalize(s) {
  s = s || {};
  s.gallery    = s.gallery    || {};
  s.transfer   = s.transfer   || {};
  s.conversion = s.conversion || { defaultFormat: 'dst', resample: false, colorLimit: null, onConflict: 'suffix' };
  s.ai = s.ai || {};
  if (typeof s.ai.enabled !== 'boolean') s.ai.enabled = false;
  if (typeof s.ai.autoTag !== 'boolean') s.ai.autoTag = true;
  if (!Array.isArray(s.ai.providers)) s.ai.providers = [];
  if (!('activeProviderId' in s.ai)) s.ai.activeProviderId = null;
  s.managedFolders = Array.isArray(s.managedFolders) ? s.managedFolders : [];
  s.transferFavorites = Array.isArray(s.transferFavorites) ? s.transferFavorites : [];
  s.cache = s.cache || {};
  if (typeof s.cache.dir !== 'string') s.cache.dir = '';
  if (!Number.isFinite(Number(s.cache.maxSizeMB))) s.cache.maxSizeMB = 500;
  return s;
}

/* ------------------------------------------------------------------ *
 *  Persist helper — patch main-process settings + mirror to store
 * ------------------------------------------------------------------ */
async function persist(patch) {
  try { await window.api.setSettings(patch); } catch (_) {}
  // Mirror into the shared store (shallow per top-level key)
  Object.entries(patch).forEach(([k, v]) => {
    window.store?.set(`settings.${k}`, v);
  });
}

/* ------------------------------------------------------------------ *
 *  Shell HTML
 * ------------------------------------------------------------------ */
function buildHTML() {
  const items = TOPICS.map(tp => `
    <button class="st-topic ${tp.id === _activeTopic ? 'active' : ''}" data-topic="${tp.id}">
      <span class="st-topic-icon">${tp.icon}</span>
      <span class="st-topic-label">${esc(t(tp.key))}</span>
    </button>`).join('');

  return `
<div class="st-root">
  <aside class="st-sidebar">
    <div class="st-sidebar-header">${esc(t('nav.settings'))}</div>
    <div class="st-topics">${items}</div>
  </aside>
  <main class="st-content" id="st-content"></main>
</div>`;
}

function wireTopicNav() {
  const sig = _abort.signal;
  document.querySelectorAll('.st-topic').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTopic = btn.dataset.topic;
      document.querySelectorAll('.st-topic').forEach(b =>
        b.classList.toggle('active', b.dataset.topic === _activeTopic));
      renderTopic();
    }, { signal: sig });
  });
}

/* ------------------------------------------------------------------ *
 *  Topic rendering dispatch
 * ------------------------------------------------------------------ */
function renderTopic() {
  const host = document.getElementById('st-content');
  if (!host) return;
  switch (_activeTopic) {
    case 'general':    host.innerHTML = tplGeneral();    wireGeneral();    break;
    case 'folders':    host.innerHTML = tplFolders();    wireFolders();    break;
    case 'conversion': host.innerHTML = tplConversion(); wireConversion(); break;
    case 'transfer':   host.innerHTML = tplTransfer();   wireTransfer();   break;
    case 'cache':      host.innerHTML = tplCache();      wireCache();      break;
    case 'ai':         host.innerHTML = tplAI();         wireAI();         break;
    case 'about':      host.innerHTML = tplAbout();      wireAbout();      break;
  }
}

function section(title, desc, body) {
  return `
  <section class="st-section">
    <h2 class="st-section-title">${esc(title)}</h2>
    ${desc ? `<p class="st-section-desc">${esc(desc)}</p>` : ''}
    <div class="st-section-body">${body}</div>
  </section>`;
}

/* ================================================================== *
 *  GENERAL
 * ================================================================== */
function tplGeneral() {
  const lang = window.store?.get('settings.language', 'en') || 'en';
  const theme = _settings.theme || 'light';
  return section(t('settings.topic.general'), t('settings.general.desc'), `
    <label class="st-field">
      <span class="st-field-label">${esc(t('settings.general.language'))}</span>
      <select id="st-lang" class="st-input">
        <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
        <option value="de" ${lang === 'de' ? 'selected' : ''}>Deutsch</option>
        <option value="fr" ${lang === 'fr' ? 'selected' : ''}>Français</option>
      </select>
    </label>
    <label class="st-field">
      <span class="st-field-label">${esc(t('settings.general.theme'))}</span>
      <select id="st-theme" class="st-input">
        <option value="light" ${theme === 'light' ? 'selected' : ''}>${esc(t('settings.general.themeLight'))}</option>
      </select>
      <span class="st-field-hint">${esc(t('settings.general.themeHint'))}</span>
    </label>
  `);
}

function wireGeneral() {
  const sig = _abort.signal;
  document.getElementById('st-lang')?.addEventListener('change', (e) => {
    const lang = e.target.value;
    window.store?.set('settings.language', lang);
    try { localStorage.setItem('ec_lang', lang); } catch (_) {}
    persist({ language: lang });
    const sel = document.getElementById('langSelect');
    if (sel) sel.value = lang;
    // Re-apply shell static labels + re-render this view in the new language
    document.querySelectorAll('[data-i18n]').forEach(node => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.documentElement.lang = lang;
    document.querySelector('.st-sidebar-header').textContent = t('nav.settings');
    document.querySelectorAll('.st-topic').forEach(btn => {
      const tp = TOPICS.find(x => x.id === btn.dataset.topic);
      btn.querySelector('.st-topic-label').textContent = t(tp.key);
    });
    renderTopic();
  }, { signal: sig });

  document.getElementById('st-theme')?.addEventListener('change', (e) => {
    _settings.theme = e.target.value;
    persist({ theme: e.target.value });
  }, { signal: sig });
}

/* ================================================================== *
 *  FOLDERS (managed folders shared with Gallery/Batch)
 * ================================================================== */
function tplFolders() {
  const folders = _settings.managedFolders || [];
  const rows = folders.length ? folders.map((f, i) => `
    <div class="st-folder-row" data-idx="${i}">
      <div class="st-folder-main">
        <div class="st-folder-alias">${esc(f.alias || tail(f.path))}</div>
        <div class="st-folder-path" title="${esc(f.path)}">${esc(f.path)}</div>
      </div>
      <label class="st-inline-check" title="${esc(t('settings.folders.recursive'))}">
        <input type="checkbox" class="st-folder-recursive" data-idx="${i}" ${f.recursive !== false ? 'checked' : ''}/>
        <span>${esc(t('settings.folders.recursive'))}</span>
      </label>
      <button class="st-btn-danger st-folder-remove" data-idx="${i}">${esc(t('common.remove'))}</button>
    </div>`).join('') : `<div class="st-empty">${esc(t('settings.folders.empty'))}</div>`;

  return section(t('settings.topic.folders'), t('settings.folders.desc'), `
    <div class="st-folder-list">${rows}</div>
    <button id="st-add-folder" class="st-btn-primary">+ ${esc(t('settings.folders.add'))}</button>
  `);
}

function wireFolders() {
  const sig = _abort.signal;
  document.getElementById('st-add-folder')?.addEventListener('click', async () => {
    const picked = await window.api.pickFolders?.();
    if (!picked || !picked.length) return;
    const existing = new Set((_settings.managedFolders || []).map(f => f.path));
    picked.forEach(p => {
      if (existing.has(p)) return;
      _settings.managedFolders.push({
        id: 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        path: p, recursive: true, alias: ''
      });
    });
    await persist({ managedFolders: _settings.managedFolders });
    renderTopic();
  }, { signal: sig });

  document.querySelectorAll('.st-folder-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      _settings.managedFolders.splice(idx, 1);
      await persist({ managedFolders: _settings.managedFolders });
      renderTopic();
    }, { signal: sig });
  });

  document.querySelectorAll('.st-folder-recursive').forEach(cb => {
    cb.addEventListener('change', async () => {
      const idx = parseInt(cb.dataset.idx, 10);
      _settings.managedFolders[idx].recursive = cb.checked;
      await persist({ managedFolders: _settings.managedFolders });
    }, { signal: sig });
  });

  // Double-click alias to edit
  document.querySelectorAll('.st-folder-alias').forEach(el => {
    el.addEventListener('dblclick', () => {
      const row = el.closest('.st-folder-row');
      const idx = parseInt(row.dataset.idx, 10);
      const input = document.createElement('input');
      input.className = 'st-input st-alias-input';
      input.value = _settings.managedFolders[idx].alias || '';
      input.placeholder = tail(_settings.managedFolders[idx].path);
      el.replaceWith(input);
      input.focus();
      const commit = async () => {
        _settings.managedFolders[idx].alias = input.value.trim();
        await persist({ managedFolders: _settings.managedFolders });
        renderTopic();
      };
      input.addEventListener('blur', commit, { once: true });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    }, { signal: sig });
  });
}

/* ================================================================== *
 *  CONVERSION DEFAULTS
 * ================================================================== */
function tplConversion() {
  const c = _settings.conversion;
  const fmtOpts = (_formats.length ? _formats : ['dst','pes','jef','vp3','hus','xxx','exp'])
    .map(f => {
      const id = (typeof f === 'string') ? f : (f.id || f.ext || f.format);
      return `<option value="${esc(id)}" ${c.defaultFormat === id ? 'selected' : ''}>${esc(String(id).toUpperCase())}</option>`;
    }).join('');
  return section(t('settings.topic.conversion'), t('settings.conversion.desc'), `
    <label class="st-field">
      <span class="st-field-label">${esc(t('settings.conversion.defaultFormat'))}</span>
      <select id="st-def-format" class="st-input">${fmtOpts}</select>
    </label>
    <label class="st-field">
      <span class="st-field-label">${esc(t('settings.conversion.colorLimit'))}</span>
      <input type="number" id="st-color-limit" class="st-input" min="1" max="255"
             placeholder="${esc(t('settings.conversion.noLimit'))}"
             value="${c.colorLimit != null ? c.colorLimit : ''}"/>
      <span class="st-field-hint">${esc(t('settings.conversion.colorLimitHint'))}</span>
    </label>
    <label class="st-inline-check">
      <input type="checkbox" id="st-resample" ${c.resample ? 'checked' : ''}/>
      <span>${esc(t('settings.conversion.resample'))}</span>
    </label>
    <label class="st-field">
      <span class="st-field-label">${esc(t('settings.conversion.onConflict'))}</span>
      <select id="st-conflict" class="st-input">
        <option value="suffix"    ${c.onConflict === 'suffix' ? 'selected' : ''}>${esc(t('settings.conversion.conflictSuffix'))}</option>
        <option value="overwrite" ${c.onConflict === 'overwrite' ? 'selected' : ''}>${esc(t('settings.conversion.conflictOverwrite'))}</option>
        <option value="skip"      ${c.onConflict === 'skip' ? 'selected' : ''}>${esc(t('settings.conversion.conflictSkip'))}</option>
      </select>
    </label>
  `);
}

function wireConversion() {
  const sig = _abort.signal;
  const save = () => persist({ conversion: _settings.conversion });
  document.getElementById('st-def-format')?.addEventListener('change', (e) => {
    _settings.conversion.defaultFormat = e.target.value; save();
  }, { signal: sig });
  document.getElementById('st-color-limit')?.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    _settings.conversion.colorLimit = Number.isFinite(v) && v > 0 ? v : null; save();
  }, { signal: sig });
  document.getElementById('st-resample')?.addEventListener('change', (e) => {
    _settings.conversion.resample = e.target.checked; save();
  }, { signal: sig });
  document.getElementById('st-conflict')?.addEventListener('change', (e) => {
    _settings.conversion.onConflict = e.target.value; save();
  }, { signal: sig });
}

/* ================================================================== *
 *  TRANSFER
 * ================================================================== */
const MACHINES = [
  ['', 'settings.transfer.autoDetect'],
  ['husqvarna', 'Husqvarna Viking'],
  ['brother', 'Brother'],
  ['singer', 'Singer'],
  ['pfaff', 'Pfaff'],
  ['janome', 'Janome'],
  ['bernina', 'Bernina'],
];

function tplTransfer() {
  const favs = _settings.transferFavorites || [];
  const def = _settings.defaultMachine || '';
  const machineOpts = MACHINES.map(([id, label]) =>
    `<option value="${esc(id)}" ${def === id ? 'selected' : ''}>${id ? esc(label) : esc(t(label))}</option>`).join('');
  const favRows = favs.length ? favs.map((f, i) => `
    <div class="st-folder-row" data-idx="${i}">
      <div class="st-folder-main">
        <div class="st-folder-alias">${esc(f.label || tail(f.path))}</div>
        <div class="st-folder-path" title="${esc(f.path)}">${esc(f.path)}</div>
      </div>
      <button class="st-btn-danger st-fav-remove" data-idx="${i}">${esc(t('common.remove'))}</button>
    </div>`).join('') : `<div class="st-empty">${esc(t('settings.transfer.noFavorites'))}</div>`;

  return section(t('settings.topic.transfer'), t('settings.transfer.desc'), `
    <label class="st-field">
      <span class="st-field-label">${esc(t('settings.transfer.defaultMachine'))}</span>
      <select id="st-def-machine" class="st-input">${machineOpts}</select>
    </label>
    <div class="st-subhead">${esc(t('settings.transfer.favorites'))}</div>
    <div class="st-folder-list">${favRows}</div>
    <button id="st-add-fav" class="st-btn-primary">+ ${esc(t('settings.transfer.addFavorite'))}</button>
  `);
}

function wireTransfer() {
  const sig = _abort.signal;
  document.getElementById('st-def-machine')?.addEventListener('change', (e) => {
    _settings.defaultMachine = e.target.value;
    persist({ defaultMachine: e.target.value });
  }, { signal: sig });
  document.getElementById('st-add-fav')?.addEventListener('click', async () => {
    const p = await window.api.selectOutputDir?.();
    if (!p) return;
    _settings.transferFavorites.push({ path: p, label: tail(p) });
    await persist({ transferFavorites: _settings.transferFavorites });
    renderTopic();
  }, { signal: sig });
  document.querySelectorAll('.st-fav-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      _settings.transferFavorites.splice(idx, 1);
      await persist({ transferFavorites: _settings.transferFavorites });
      renderTopic();
    }, { signal: sig });
  });
}

/* ================================================================== *
 *  CACHE — persistent thumbnail / preview storage
 * ================================================================== */
function tplCache() {
  const c = _settings.cache || { dir: '', maxSizeMB: 500 };
  const customDir = (c.dir || '').trim();
  return section(t('settings.topic.cache'), t('settings.cache.desc'), `
    <div class="st-field">
      <label class="st-field-label">${esc(t('settings.cache.location'))}</label>
      <p class="st-field-hint">${esc(t('settings.cache.locationHint'))}</p>
      <div class="st-cache-path-row">
        <input type="text" id="st-cache-dir" class="st-input" readonly
               value="${esc(customDir)}"
               placeholder="${esc(t('settings.cache.defaultLabel'))}"
               title="${esc(customDir)}"/>
        <button id="st-cache-choose" class="st-btn-secondary">${esc(t('settings.cache.choose'))}</button>
        <button id="st-cache-reset" class="st-btn-secondary" ${customDir ? '' : 'disabled'}>${esc(t('settings.cache.useDefault'))}</button>
      </div>
      <p class="st-cache-resolved" id="st-cache-resolved"></p>
    </div>

    <div class="st-field">
      <label class="st-field-label" for="st-cache-max">${esc(t('settings.cache.maxSize'))}</label>
      <p class="st-field-hint">${esc(t('settings.cache.maxSizeHint'))}</p>
      <div class="st-cache-size-row">
        <input type="number" id="st-cache-max" class="st-input st-input-narrow"
               min="0" step="50" value="${esc(String(c.maxSizeMB))}"/>
        <span class="st-unit">${esc(t('settings.cache.mbUnit'))}</span>
      </div>
    </div>

    <div class="st-field">
      <label class="st-field-label">${esc(t('settings.cache.usage'))}</label>
      <div class="st-cache-usage" id="st-cache-usage">${esc(t('settings.cache.calculating'))}</div>
      <button id="st-cache-clear" class="st-btn-danger">${esc(t('settings.cache.clear'))}</button>
    </div>
  `);
}

async function refreshCacheUsage() {
  const usageEl = document.getElementById('st-cache-usage');
  const resolvedEl = document.getElementById('st-cache-resolved');
  if (!usageEl && !resolvedEl) return;
  let info = null;
  try { info = window.api.cacheInfo ? await window.api.cacheInfo() : null; } catch (_) {}
  if (!info) {
    if (usageEl) usageEl.textContent = t('settings.cache.unavailable');
    return;
  }
  if (usageEl) {
    usageEl.textContent = t('settings.cache.usageValue', {
      size: fmtBytes(info.sizeBytes),
      count: info.fileCount,
    });
  }
  if (resolvedEl) {
    resolvedEl.textContent = (info.isDefault ? t('settings.cache.defaultLabel') + ' — ' : '') + info.dir;
  }
}

function wireCache() {
  const sig = _abort.signal;
  refreshCacheUsage();

  document.getElementById('st-cache-choose')?.addEventListener('click', async () => {
    const dir = await window.api.selectCacheDir?.();
    if (!dir) return;
    _settings.cache.dir = dir;
    await persist({ cache: _settings.cache });
    renderTopic();
  }, { signal: sig });

  document.getElementById('st-cache-reset')?.addEventListener('click', async () => {
    _settings.cache.dir = '';
    await persist({ cache: _settings.cache });
    renderTopic();
  }, { signal: sig });

  const maxEl = document.getElementById('st-cache-max');
  maxEl?.addEventListener('change', async () => {
    let v = parseInt(maxEl.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 0;
    _settings.cache.maxSizeMB = v;
    maxEl.value = String(v);
    await persist({ cache: _settings.cache });
    // Main process sweeps LRU on cache-config change; reflect new usage.
    refreshCacheUsage();
  }, { signal: sig });

  document.getElementById('st-cache-clear')?.addEventListener('click', async () => {
    if (!confirm(t('settings.cache.confirmClear'))) return;
    try { await window.api.cacheClear?.(); } catch (_) {}
    refreshCacheUsage();
  }, { signal: sig });
}

/* ================================================================== *
 *  AI & VISION
 * ================================================================== */
function tplAI() {
  const a = _settings.ai;
  const providers = a.providers || [];
  const list = providers.length
    ? providers.map(p => providerCard(p)).join('')
    : `<div class="st-empty">${esc(t('settings.ai.noProviders'))}</div>`;
  const kindOptions = Object.entries(PROVIDER_KINDS)
    .map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join('');
  return section(t('settings.topic.ai'), t('settings.ai.desc'), `
    <label class="st-inline-check">
      <input type="checkbox" id="st-ai-enabled" ${a.enabled ? 'checked' : ''}/>
      <span>${esc(t('settings.ai.enable'))}</span>
    </label>
    <div class="st-ai-fields" style="${a.enabled ? '' : 'opacity:.5;pointer-events:none'}">
      <div class="st-subhead-plain">${esc(t('settings.ai.providers'))}</div>
      <div class="st-prov-list">${list}</div>
      <div class="st-prov-add">
        <select id="st-prov-kind" class="st-input">${kindOptions}</select>
        <button id="st-prov-add" class="st-btn-secondary">${esc(t('settings.ai.addProvider'))}</button>
      </div>
      <label class="st-inline-check">
        <input type="checkbox" id="st-ai-autotag" ${a.autoTag ? 'checked' : ''}/>
        <span>${esc(t('settings.ai.autoTag'))}</span>
      </label>
    </div>
    <p class="st-ai-note">${esc(t('settings.ai.note'))}</p>
  `);
}

function providerCard(p) {
  const meta = PROVIDER_KINDS[p.kind] || {};
  const a = _settings.ai;
  const isActive = a.activeProviderId === p.id;
  const editing = _editingProviderId === p.id;
  const head = `
    <div class="st-prov-row">
      <label class="st-prov-active" title="${esc(t('settings.ai.setActive'))}">
        <input type="radio" name="st-prov-active" ${isActive ? 'checked' : ''} data-active="${esc(p.id)}"/>
      </label>
      <div class="st-prov-main">
        <div class="st-prov-name">${esc(p.name || meta.label || p.kind)}</div>
        <div class="st-prov-meta">
          <span class="st-prov-badge">${esc(meta.label || p.kind)}</span>
          ${meta.external
            ? `<span class="st-prov-badge ext">${esc(t('settings.ai.external'))}</span>`
            : `<span class="st-prov-badge local">${esc(t('settings.ai.local'))}</span>`}
          ${p.baseUrl ? `<span class="st-prov-url">${esc(p.baseUrl)}</span>` : ''}
        </div>
      </div>
      <label class="st-inline-check st-prov-en">
        <input type="checkbox" data-enable="${esc(p.id)}" ${p.enabled !== false ? 'checked' : ''}/>
        <span>${esc(t('settings.ai.enabledProv'))}</span>
      </label>
      <button class="st-btn-secondary st-prov-edit" data-edit="${esc(p.id)}">${esc(editing ? t('settings.ai.done') : t('settings.ai.edit'))}</button>
      <button class="st-btn-danger" data-remove="${esc(p.id)}">${esc(t('settings.ai.remove'))}</button>
    </div>`;
  const body = editing ? providerEditForm(p, meta) : '';
  return `<div class="st-prov-card ${isActive ? 'active' : ''}">${head}${body}</div>`;
}

function providerEditForm(p, meta) {
  const caps = p.capabilities || {};
  const allow = p.allow || {};
  const secretField = meta.canHaveKey ? `
      <div class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.secret'))}${meta.requiresKey ? ' *' : ''}</span>
        <div class="st-secret-row">
          <span id="st-secret-status-${esc(p.id)}" class="st-secret-status">${esc(t('settings.ai.secretChecking'))}</span>
        </div>
        <div class="st-secret-row">
          <input type="password" class="st-input st-secret-input" id="st-secret-input-${esc(p.id)}" autocomplete="off"
                 placeholder="${esc(meta.requiresKey ? 'sk-…' : t('settings.ai.secretOptional'))}"/>
          <button class="st-btn-secondary" data-secret-set="${esc(p.id)}">${esc(t('settings.ai.secretSave'))}</button>
          <button class="st-btn-danger" data-secret-del="${esc(p.id)}">${esc(t('settings.ai.secretRemove'))}</button>
        </div>
        <span class="st-field-hint">${esc(t('settings.ai.secretHint'))}</span>
      </div>`
    : `<div class="st-field"><span class="st-field-hint">🔒 ${esc(t('settings.ai.secretNotRequired'))}</span></div>`;
  return `
    <div class="st-prov-form">
      <label class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.name'))}</span>
        <input type="text" class="st-input" data-field="name" data-pid="${esc(p.id)}" value="${esc(p.name || '')}"/>
      </label>
      <label class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.baseUrl'))}</span>
        <input type="text" class="st-input" data-field="baseUrl" data-pid="${esc(p.id)}"
               placeholder="${esc(meta.defaultBaseUrl || '')}" value="${esc(p.baseUrl || '')}"/>
      </label>
      <label class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.model'))}</span>
        <input type="text" class="st-input" data-field="model" data-pid="${esc(p.id)}"
               placeholder="${esc(meta.defaultModel || '')}" value="${esc(p.model || '')}"/>
      </label>
      ${secretField}
      <div class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.capabilities'))}</span>
        <div class="st-check-group">
          <label class="st-inline-check"><input type="checkbox" data-cap="vision" data-pid="${esc(p.id)}" ${caps.vision !== false ? 'checked' : ''}/><span>${esc(t('settings.ai.capVision'))}</span></label>
          <label class="st-inline-check"><input type="checkbox" data-cap="chat" data-pid="${esc(p.id)}" ${caps.chat !== false ? 'checked' : ''}/><span>${esc(t('settings.ai.capChat'))}</span></label>
          <label class="st-inline-check"><input type="checkbox" data-cap="embeddings" data-pid="${esc(p.id)}" ${caps.embeddings ? 'checked' : ''}/><span>${esc(t('settings.ai.capEmbeddings'))}</span></label>
        </div>
      </div>
      <div class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.allowances'))}</span>
        <div class="st-check-group">
          <label class="st-inline-check"><input type="checkbox" data-allow="autoClassify" data-pid="${esc(p.id)}" ${allow.autoClassify !== false ? 'checked' : ''}/><span>${esc(t('settings.ai.allowAutoClassify'))}</span></label>
          <label class="st-inline-check"><input type="checkbox" data-allow="sendExternal" data-pid="${esc(p.id)}" ${allow.sendExternal ? 'checked' : ''}/><span>${esc(t('settings.ai.allowSendExternal'))}</span></label>
        </div>
        ${meta.external ? `<span class="st-field-hint">${esc(t('settings.ai.allowSendExternalHint'))}</span>` : ''}
      </div>
      <div class="st-ai-test-row">
        <button class="st-btn-secondary" data-test="${esc(p.id)}">${esc(t('settings.ai.test'))}</button>
        <span class="st-ai-test-result" id="st-test-result-${esc(p.id)}"></span>
      </div>
    </div>`;
}

function findProv(id) { return (_settings.ai.providers || []).find(p => p.id === id); }
function genId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function addProvider(kind) {
  const meta = PROVIDER_KINDS[kind] || PROVIDER_KINDS['openai'];
  const id = genId();
  const p = {
    id,
    name: meta.label || kind,
    kind,
    baseUrl: meta.defaultBaseUrl || '',
    model: meta.defaultModel || '',
    requiresKey: !!meta.requiresKey,
    secretRef: 'ai.provider.' + id,
    enabled: true,
    capabilities: { vision: true, chat: true, embeddings: false },
    // External providers default to NOT sending data outward until the user opts in.
    allow: { autoClassify: true, sendExternal: !meta.external },
  };
  _settings.ai.providers.push(p);
  if (!_settings.ai.activeProviderId) _settings.ai.activeProviderId = id;
  _editingProviderId = id;
  persist({ ai: _settings.ai });
  renderTopic();
}

async function refreshSecretStatus(p) {
  const el = document.getElementById('st-secret-status-' + p.id);
  if (!el) return;
  try {
    const s = window.api.secretsStatus ? await window.api.secretsStatus(p.secretRef) : { isSet: false };
    if (s && s.isSet) {
      const warn = s.protected === false;
      el.textContent = t('settings.ai.secretStatusSet', { last4: s.last4 || '••••' })
        + (warn ? ' — ' + t('settings.ai.secretUnprotected') : '');
      el.className = 'st-secret-status set' + (warn ? ' warn' : '');
    } else {
      el.textContent = t('settings.ai.secretStatusNone');
      el.className = 'st-secret-status none';
    }
  } catch (_) {
    el.textContent = t('settings.ai.secretStatusNone');
    el.className = 'st-secret-status none';
  }
}

function wireAI() {
  const sig = _abort.signal;
  const a = _settings.ai;
  const save = () => persist({ ai: _settings.ai });

  document.getElementById('st-ai-enabled')?.addEventListener('change', (e) => {
    a.enabled = e.target.checked; save(); renderTopic();
  }, { signal: sig });
  document.getElementById('st-ai-autotag')?.addEventListener('change', (e) => {
    a.autoTag = e.target.checked; save();
  }, { signal: sig });
  document.getElementById('st-prov-add')?.addEventListener('click', () => {
    const kind = document.getElementById('st-prov-kind')?.value || 'openai';
    addProvider(kind);
  }, { signal: sig });

  document.querySelectorAll('[data-active]').forEach(el => {
    el.addEventListener('change', () => {
      a.activeProviderId = el.getAttribute('data-active'); save(); renderTopic();
    }, { signal: sig });
  });
  document.querySelectorAll('[data-enable]').forEach(el => {
    el.addEventListener('change', () => {
      const p = findProv(el.getAttribute('data-enable'));
      if (p) { p.enabled = el.checked; save(); }
    }, { signal: sig });
  });
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-edit');
      _editingProviderId = (_editingProviderId === id) ? null : id;
      renderTopic();
    }, { signal: sig });
  });
  document.querySelectorAll('[data-remove]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-remove');
      const p = findProv(id);
      if (!p) return;
      if (!confirm(t('settings.ai.removeConfirm', { name: p.name || id }))) return;
      if (p.secretRef && window.api.secretsDelete) { try { await window.api.secretsDelete(p.secretRef); } catch (_) {} }
      a.providers = a.providers.filter(x => x.id !== id);
      if (a.activeProviderId === id) a.activeProviderId = a.providers[0]?.id || null;
      if (_editingProviderId === id) _editingProviderId = null;
      save(); renderTopic();
    }, { signal: sig });
  });

  document.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('change', () => {
      const p = findProv(el.getAttribute('data-pid'));
      if (p) { p[el.getAttribute('data-field')] = el.value.trim(); save(); }
    }, { signal: sig });
  });
  document.querySelectorAll('[data-cap]').forEach(el => {
    el.addEventListener('change', () => {
      const p = findProv(el.getAttribute('data-pid'));
      if (p) { p.capabilities = p.capabilities || {}; p.capabilities[el.getAttribute('data-cap')] = el.checked; save(); }
    }, { signal: sig });
  });
  document.querySelectorAll('[data-allow]').forEach(el => {
    el.addEventListener('change', () => {
      const p = findProv(el.getAttribute('data-pid'));
      if (p) { p.allow = p.allow || {}; p.allow[el.getAttribute('data-allow')] = el.checked; save(); }
    }, { signal: sig });
  });

  document.querySelectorAll('[data-secret-set]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-secret-set');
      const p = findProv(id);
      const input = document.getElementById('st-secret-input-' + id);
      if (!p || !input) return;
      const val = input.value.trim();
      if (!val) return;
      try { await window.api.secretsSet(p.secretRef, val); } catch (_) {}
      input.value = '';
      refreshSecretStatus(p);
    }, { signal: sig });
  });
  document.querySelectorAll('[data-secret-del]').forEach(el => {
    el.addEventListener('click', async () => {
      const p = findProv(el.getAttribute('data-secret-del'));
      if (!p) return;
      try { await window.api.secretsDelete(p.secretRef); } catch (_) {}
      refreshSecretStatus(p);
    }, { signal: sig });
  });

  document.querySelectorAll('[data-test]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-test');
      const out = document.getElementById('st-test-result-' + id);
      if (out) { out.className = 'st-ai-test-result'; out.textContent = t('settings.ai.testing'); }
      await save();
      try {
        const r = window.api.aiTest ? await window.api.aiTest(id) : { ok: false, error: 'not-available' };
        if (out) {
          out.classList.add(r.ok ? 'ok' : 'bad');
          out.textContent = r.ok ? t('settings.ai.testOk') : (t('settings.ai.testFail') + (r.error ? ': ' + r.error : ''));
        }
      } catch (err) {
        if (out) { out.classList.add('bad'); out.textContent = t('settings.ai.testFail') + ': ' + (err.message || err); }
      }
    }, { signal: sig });
  });

  // Populate the async secret status for the currently open edit form
  if (_editingProviderId) {
    const p = findProv(_editingProviderId);
    const meta = p ? (PROVIDER_KINDS[p.kind] || {}) : {};
    if (p && meta.canHaveKey) refreshSecretStatus(p);
  }
}

/* ================================================================== *
 *  ABOUT
 * ================================================================== */
function tplAbout() {
  const v = _appVersion || '';
  return section(t('settings.topic.about'), '', `
    <div class="st-about">
      <div class="st-about-name">Embroidery Converter${v ? ' <span class="st-about-ver">v' + esc(v) + '</span>' : ''}</div>
      <p>${esc(t('settings.about.tagline'))}</p>
      <ul class="st-about-list">
        <li><strong>${esc(t('settings.about.copyright'))}:</strong> © 2026 orgware.ai</li>
        <li><strong>${esc(t('settings.about.author'))}:</strong> <a href="mailto:andkoma@akopp.de">andkoma@akopp.de</a></li>
        <li><strong>${esc(t('settings.about.website'))}:</strong> <a href="https://orgware.ai" target="_blank">orgware.ai</a></li>
        <li><strong>${esc(t('settings.about.license'))}:</strong> Proprietary</li>
      </ul>
      <p class="st-about-ai">${esc(t('settings.about.aiNotice'))}</p>
    </div>
  `);
}

function wireAbout() { /* static */ }

/* ------------------------------------------------------------------ *
 *  Utilities
 * ------------------------------------------------------------------ */
function tail(p) {
  if (!p) return '';
  const parts = String(p).split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/* ------------------------------------------------------------------ *
 *  CSS
 * ------------------------------------------------------------------ */
function injectCSS() {
  if (document.getElementById('st-styles')) return;
  const style = document.createElement('style');
  style.id = 'st-styles';
  style.textContent = `
.st-root { display:grid; grid-template-columns: 220px 1fr; height:100%; background: var(--surface,#f6f7fb); color: var(--fg,#1f2430); }
.st-sidebar { background: var(--panel-bg,#fff); border-right:1px solid var(--border,#e2e5ee); display:flex; flex-direction:column; overflow-y:auto; }
.st-sidebar-header { padding:18px 18px 10px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--muted,#6b7280); }
.st-topics { display:flex; flex-direction:column; padding:4px 8px 16px; gap:2px; }
.st-topic { display:flex; align-items:center; gap:10px; padding:10px 12px; border:none; background:none; border-radius:8px; cursor:pointer; font-size:13px; color:var(--fg,#2a2f3a); text-align:left; transition:background .15s; }
.st-topic:hover { background:var(--hover-bg,#eef0f6); }
.st-topic.active { background:var(--accent-subtle,#ece9fb); color:#5b3fd6; font-weight:600; }
.st-topic-icon { font-size:15px; width:20px; text-align:center; }
.st-content { overflow-y:auto; padding:28px 34px; }
.st-section { max-width:640px; }
.st-section-title { margin:0 0 4px; font-size:20px; font-weight:700; }
.st-section-desc { margin:0 0 22px; font-size:13px; color:var(--muted,#6b7280); line-height:1.5; }
.st-section-body { display:flex; flex-direction:column; gap:18px; }
.st-field { display:flex; flex-direction:column; gap:6px; }
.st-field-label { font-size:13px; font-weight:600; }
.st-field-hint { font-size:11.5px; color:var(--muted,#8a90a0); }
.st-input { padding:9px 11px; border:1px solid var(--border,#d8dbe6); border-radius:7px; background:var(--input-bg,#fff); color:var(--fg,#1f2430); font-size:13px; max-width:420px; }
.st-input:focus { outline:none; border-color:#7c5cff; box-shadow:0 0 0 3px rgba(124,92,255,.15); }
.st-inline-check { display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; }
.st-inline-check input { width:16px; height:16px; cursor:pointer; }
.st-subhead { font-size:13px; font-weight:700; margin-top:6px; padding-top:14px; border-top:1px solid var(--border,#e2e5ee); }
.st-btn-primary { align-self:flex-start; padding:9px 16px; background:#7c5cff; color:#fff; border:none; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
.st-btn-primary:hover { background:#6b4ae6; }
.st-btn-secondary { padding:8px 14px; background:var(--panel-bg,#fff); color:var(--fg,#2a2f3a); border:1px solid var(--border,#d8dbe6); border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
.st-btn-secondary:hover { background:var(--hover-bg,#eef0f6); }
.st-btn-danger { padding:6px 12px; background:none; color:#d64545; border:1px solid #e6b8b8; border-radius:6px; font-size:12px; cursor:pointer; }
.st-btn-danger:hover { background:#fbeaea; }
.st-empty { padding:16px; font-size:13px; color:var(--muted,#8a90a0); background:var(--surface,#f6f7fb); border:1px dashed var(--border,#d8dbe6); border-radius:8px; text-align:center; }
.st-folder-list { display:flex; flex-direction:column; gap:8px; }
.st-folder-row { display:flex; align-items:center; gap:12px; padding:10px 12px; background:var(--panel-bg,#fff); border:1px solid var(--border,#e2e5ee); border-radius:8px; }
.st-folder-main { flex:1; min-width:0; }
.st-folder-alias { font-size:13px; font-weight:600; cursor:pointer; }
.st-folder-alias:hover { color:#7c5cff; }
.st-folder-path { font-size:11px; color:var(--muted,#8a90a0); font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.st-alias-input { max-width:220px; }
.st-ai-fields { display:flex; flex-direction:column; gap:16px; padding:16px; background:var(--panel-bg,#fff); border:1px solid var(--border,#e2e5ee); border-radius:10px; }
.st-ai-test-row { display:flex; align-items:center; gap:12px; }
.st-ai-test-result { font-size:12.5px; }
.st-ai-test-result.ok { color:#1f9d55; }
.st-ai-test-result.bad { color:#d64545; }
.st-ai-note { font-size:11.5px; color:var(--muted,#8a90a0); line-height:1.5; }
.st-subhead-plain { font-size:13px; font-weight:700; }
.st-prov-list { display:flex; flex-direction:column; gap:10px; }
.st-prov-card { border:1px solid var(--border,#e2e5ee); border-radius:10px; background:var(--surface,#f9fafc); overflow:hidden; }
.st-prov-card.active { border-color:#7c5cff; box-shadow:0 0 0 2px rgba(124,92,255,.12); }
.st-prov-row { display:flex; align-items:center; gap:12px; padding:12px 14px; }
.st-prov-active input { width:16px; height:16px; cursor:pointer; }
.st-prov-main { flex:1; min-width:0; }
.st-prov-name { font-size:13.5px; font-weight:600; }
.st-prov-meta { display:flex; align-items:center; gap:8px; margin-top:3px; flex-wrap:wrap; }
.st-prov-badge { font-size:10.5px; font-weight:600; padding:2px 7px; border-radius:20px; background:#eceafc; color:#5b3fd6; }
.st-prov-badge.ext { background:#fff1e6; color:#c2610c; }
.st-prov-badge.local { background:#e6f6ec; color:#1f9d55; }
.st-prov-url { font-size:11px; color:var(--muted,#8a90a0); font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.st-prov-en { font-size:12px; }
.st-prov-form { display:flex; flex-direction:column; gap:14px; padding:0 14px 16px; border-top:1px solid var(--border,#e8eaf1); padding-top:14px; }
.st-check-group { display:flex; flex-wrap:wrap; gap:14px; }
.st-secret-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.st-secret-input { flex:1; min-width:180px; max-width:320px; }
.st-secret-status { font-size:12px; font-weight:600; }
.st-secret-status.set { color:#1f9d55; }
.st-secret-status.set.warn { color:#c2610c; }
.st-secret-status.none { color:var(--muted,#8a90a0); }
.st-prov-add { display:flex; align-items:center; gap:10px; }
.st-prov-add .st-input { max-width:240px; }
.st-about-name { font-size:18px; font-weight:700; }
.st-about-ver { font-size:12px; color:var(--muted,#8a90a0); font-weight:500; }
.st-about-list { list-style:none; padding:0; margin:14px 0; display:flex; flex-direction:column; gap:8px; font-size:13px; }
.st-about-list a { color:#7c5cff; text-decoration:none; }
.st-about-ai { font-size:12px; color:var(--muted,#8a90a0); font-style:italic; }
.st-field-hint { margin:0; }
.st-cache-path-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.st-cache-path-row .st-input { flex:1; min-width:220px; max-width:none; }
.st-cache-size-row { display:flex; align-items:center; gap:8px; }
.st-input-narrow { max-width:120px; }
.st-unit { font-size:13px; color:var(--muted,#8a90a0); font-weight:600; }
.st-cache-resolved { margin:6px 0 0; font-size:11.5px; color:var(--muted,#8a90a0); word-break:break-all; }
.st-cache-usage { font-size:13px; font-weight:600; margin-bottom:8px; }
`;
  document.head.appendChild(style);
}

function removeCSS() { document.getElementById('st-styles')?.remove(); }

/* ------------------------------------------------------------------ *
 *  Register
 * ------------------------------------------------------------------ */
window.registerView('settings', { mount, unmount });
})();
