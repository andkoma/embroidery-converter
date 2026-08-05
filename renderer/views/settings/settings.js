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

const TOPICS = [
  { id: 'general',    key: 'settings.topic.general',    icon: '⚙️' },
  { id: 'folders',    key: 'settings.topic.folders',    icon: '📁' },
  { id: 'conversion', key: 'settings.topic.conversion', icon: '🔄' },
  { id: 'transfer',   key: 'settings.topic.transfer',   icon: '📤' },
  { id: 'ai',         key: 'settings.topic.ai',         icon: '✨' },
  { id: 'about',      key: 'settings.topic.about',      icon: 'ℹ️' },
];

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
  s.ai         = s.ai         || { enabled: false, provider: 'openai', endpoint: '', apiKey: '', model: 'gpt-4o-mini', autoTag: true };
  s.managedFolders = Array.isArray(s.managedFolders) ? s.managedFolders : [];
  s.transferFavorites = Array.isArray(s.transferFavorites) ? s.transferFavorites : [];
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
 *  AI & VISION
 * ================================================================== */
function tplAI() {
  const a = _settings.ai;
  return section(t('settings.topic.ai'), t('settings.ai.desc'), `
    <label class="st-inline-check">
      <input type="checkbox" id="st-ai-enabled" ${a.enabled ? 'checked' : ''}/>
      <span>${esc(t('settings.ai.enable'))}</span>
    </label>
    <div class="st-ai-fields" style="${a.enabled ? '' : 'opacity:.5;pointer-events:none'}">
      <label class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.provider'))}</span>
        <select id="st-ai-provider" class="st-input">
          <option value="openai" ${a.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
          <option value="openai-compatible" ${a.provider === 'openai-compatible' ? 'selected' : ''}>OpenAI-compatible</option>
          <option value="ollama" ${a.provider === 'ollama' ? 'selected' : ''}>Ollama (local)</option>
        </select>
      </label>
      <label class="st-field" id="st-ai-endpoint-field" style="${a.provider === 'openai' ? 'display:none' : ''}">
        <span class="st-field-label">${esc(t('settings.ai.endpoint'))}</span>
        <input type="text" id="st-ai-endpoint" class="st-input"
               placeholder="${a.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}"
               value="${esc(a.endpoint || '')}"/>
      </label>
      <label class="st-field" id="st-ai-key-field" style="${a.provider === 'ollama' ? 'display:none' : ''}">
        <span class="st-field-label">${esc(t('settings.ai.apiKey'))}</span>
        <input type="password" id="st-ai-key" class="st-input" autocomplete="off"
               placeholder="sk-…" value="${esc(a.apiKey || '')}"/>
        <span class="st-field-hint">${esc(t('settings.ai.apiKeyHint'))}</span>
      </label>
      <label class="st-field">
        <span class="st-field-label">${esc(t('settings.ai.model'))}</span>
        <input type="text" id="st-ai-model" class="st-input"
               placeholder="gpt-4o-mini / llava" value="${esc(a.model || '')}"/>
        <span class="st-field-hint">${esc(t('settings.ai.modelHint'))}</span>
      </label>
      <label class="st-inline-check">
        <input type="checkbox" id="st-ai-autotag" ${a.autoTag ? 'checked' : ''}/>
        <span>${esc(t('settings.ai.autoTag'))}</span>
      </label>
      <div class="st-ai-test-row">
        <button id="st-ai-test" class="st-btn-secondary">${esc(t('settings.ai.test'))}</button>
        <span id="st-ai-test-result" class="st-ai-test-result"></span>
      </div>
    </div>
    <p class="st-ai-note">${esc(t('settings.ai.note'))}</p>
  `);
}

function wireAI() {
  const sig = _abort.signal;
  const save = () => persist({ ai: _settings.ai });
  document.getElementById('st-ai-enabled')?.addEventListener('change', (e) => {
    _settings.ai.enabled = e.target.checked; save(); renderTopic();
  }, { signal: sig });
  document.getElementById('st-ai-provider')?.addEventListener('change', (e) => {
    _settings.ai.provider = e.target.value; save(); renderTopic();
  }, { signal: sig });
  document.getElementById('st-ai-endpoint')?.addEventListener('change', (e) => {
    _settings.ai.endpoint = e.target.value.trim(); save();
  }, { signal: sig });
  document.getElementById('st-ai-key')?.addEventListener('change', (e) => {
    _settings.ai.apiKey = e.target.value.trim(); save();
  }, { signal: sig });
  document.getElementById('st-ai-model')?.addEventListener('change', (e) => {
    _settings.ai.model = e.target.value.trim(); save();
  }, { signal: sig });
  document.getElementById('st-ai-autotag')?.addEventListener('change', (e) => {
    _settings.ai.autoTag = e.target.checked; save();
  }, { signal: sig });

  document.getElementById('st-ai-test')?.addEventListener('click', async () => {
    const out = document.getElementById('st-ai-test-result');
    if (out) { out.className = 'st-ai-test-result'; out.textContent = t('settings.ai.testing'); }
    // Ensure the latest field values are saved before testing
    _settings.ai.endpoint = document.getElementById('st-ai-endpoint')?.value.trim() ?? _settings.ai.endpoint;
    _settings.ai.apiKey   = document.getElementById('st-ai-key')?.value.trim() ?? _settings.ai.apiKey;
    _settings.ai.model    = document.getElementById('st-ai-model')?.value.trim() ?? _settings.ai.model;
    await save();
    try {
      const r = window.api.aiTest ? await window.api.aiTest() : { ok: false, error: 'not-available' };
      if (out) {
        out.classList.add(r.ok ? 'ok' : 'bad');
        out.textContent = r.ok ? t('settings.ai.testOk') : (t('settings.ai.testFail') + (r.error ? ': ' + r.error : ''));
      }
    } catch (err) {
      if (out) { out.classList.add('bad'); out.textContent = t('settings.ai.testFail') + ': ' + (err.message || err); }
    }
  }, { signal: sig });
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
.st-about-name { font-size:18px; font-weight:700; }
.st-about-ver { font-size:12px; color:var(--muted,#8a90a0); font-weight:500; }
.st-about-list { list-style:none; padding:0; margin:14px 0; display:flex; flex-direction:column; gap:8px; font-size:13px; }
.st-about-list a { color:#7c5cff; text-decoration:none; }
.st-about-ai { font-size:12px; color:var(--muted,#8a90a0); font-style:italic; }
`;
  document.head.appendChild(style);
}

function removeCSS() { document.getElementById('st-styles')?.remove(); }

/* ------------------------------------------------------------------ *
 *  Register
 * ------------------------------------------------------------------ */
window.registerView('settings', { mount, unmount });
})();
