/**
 * Embroidery Converter - Shell Initialization
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Responsibilities:
 *  - Bootstrap the store, router, and navigation rail
 *  - Own backend-status probe (updates topbar badge + store)
 *  - Own language selection (persists to localStorage + store)
 *  - Load & navigate to the initial view (Convert)
 */
'use strict';

(async function initShell() {
  /* ---------------------------------------------------------------- *
   *  DOM refs (topbar elements live here permanently)
   * ---------------------------------------------------------------- */
  const viewHost    = document.getElementById('viewHost');
  const backendBadge = document.getElementById('backendBadge');
  const backendLabel = document.getElementById('backendLabel');
  const langSelect   = document.getElementById('langSelect');

  /* ---------------------------------------------------------------- *
   *  i18n helpers (shell-level)
   * ---------------------------------------------------------------- */
  function t(key) {
    const lang = store.get('settings.language', 'en');
    const dict = (window.I18N && window.I18N[lang]) || (window.I18N && window.I18N.en) || {};
    return dict[key] !== undefined ? dict[key] : ((window.I18N && window.I18N.en && window.I18N.en[key]) || key);
  }

  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(node => {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(node => {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-ph')));
    });
    document.documentElement.lang = store.get('settings.language', 'en');
  }

  /* ---------------------------------------------------------------- *
   *  Settings bootstrap — load from main process, seed the store
   * ---------------------------------------------------------------- */
  let persistedSettings = {};
  try {
    persistedSettings = await window.api.getSettings();
  } catch (_) { /* first launch or IPC unavailable — use defaults */ }

  // Seed store with persisted settings (deep merge with store defaults)
  if (persistedSettings && typeof persistedSettings === 'object') {
    store.patch({ settings: { ...store.get('settings'), ...persistedSettings } });
  }

  /* ---------------------------------------------------------------- *
   *  Language initialisation (settings → localStorage → browser → 'en')
   * ---------------------------------------------------------------- */
  function detectLanguage() {
    // Priority: persisted settings > localStorage > browser lang > 'en'
    if (persistedSettings && persistedSettings.language &&
        window.I18N && window.I18N[persistedSettings.language]) {
      return persistedSettings.language;
    }
    const saved = (() => { try { return localStorage.getItem('ec_lang'); } catch (_) { return null; } })();
    if (saved && window.I18N && window.I18N[saved]) return saved;
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return (window.I18N && window.I18N[nav]) ? nav : 'en';
  }

  const initialLang = detectLanguage();
  store.set('settings.language', initialLang);
  if (langSelect) langSelect.value = initialLang;
  applyStaticI18n();

  if (langSelect) {
    langSelect.addEventListener('change', () => {
      const lang = langSelect.value;
      store.set('settings.language', lang);
      try { localStorage.setItem('ec_lang', lang); } catch (_) {}
      // Persist to main-process settings file
      window.api.setSettings({ language: lang }).catch(() => {});
      applyStaticI18n(); // re-apply nav labels; the view re-renders via store subscription
    });
  }

  /* ---------------------------------------------------------------- *
   *  Backend status probe
   * ---------------------------------------------------------------- */
  async function checkBackend() {
    let s;
    try { s = await window.api.backendStatus(); }
    catch (e) { s = { available: false, reason: 'exception', error: (e && e.message) || String(e) }; }

    store.patch({ backend: { ...s, checking: false } });

    backendBadge.classList.remove('ok', 'bad');
    if (s.available) {
      backendBadge.classList.add('ok');
      backendLabel.textContent = s.mode === 'bundled'
        ? t('backend.ready.bundled') : t('backend.ready.system');
      backendBadge.removeAttribute('title');
    } else {
      backendBadge.classList.add('bad');
      backendLabel.textContent = (s.reason === 'exception' || s.reason === 'engine-error')
        ? t('backend.error') : t('backend.unavailable');
      backendBadge.title = s.error || t('backend.unavailable');
    }
  }

  await checkBackend();

  /* ---------------------------------------------------------------- *
   *  Router setup
   * ---------------------------------------------------------------- */
  const router = new Router(viewHost, store);

  /** Load a view script by injecting a <script> tag. */
  function loadViewScript(viewId) {
    return new Promise((resolve, reject) => {
      // Skip if already loaded
      if (document.querySelector(`script[data-view="${viewId}"]`)) { resolve(); return; }
      const s  = document.createElement('script');
      s.src    = `views/${viewId}/${viewId}.js`;
      s.setAttribute('data-view', viewId);
      s.onload  = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load view script: ${viewId}`));
      document.body.appendChild(s);
    });
  }

  /** Views expose themselves via window.registerView(id, module). */
  window.registerView = function(id, module) {
    router.register(id, module);
  };

  /* ---------------------------------------------------------------- *
   *  Navigation helper (handles lazy loading)
   * ---------------------------------------------------------------- */
  const IMPLEMENTED_VIEWS = ['convert', 'batch', 'gallery']; // extend as phases are built

  async function navigateTo(viewId) {
    if (!IMPLEMENTED_VIEWS.includes(viewId)) {
      // Show a "coming soon" placeholder for unbuilt views
      store.patch({ currentView: viewId });
      updateNavActive(viewId);
      viewHost.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    height:100%;color:var(--text-dim);gap:12px;padding:40px">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor"
               stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"
               style="opacity:.35">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4l3 3"/>
          </svg>
          <p style="font-size:18px;font-weight:600;margin:0">${viewId.charAt(0).toUpperCase() + viewId.slice(1)}</p>
          <p style="font-size:13px;margin:0;opacity:.7">Coming soon — Phase ${phaseLabel(viewId)}</p>
        </div>`;
      return;
    }

    // Lazy-load the view script if not yet registered
    if (!router.views.has(viewId)) {
      viewHost.innerHTML = '<div class="view-loading"></div>';
      try { await loadViewScript(viewId); }
      catch (err) {
        viewHost.innerHTML = `<div style="padding:40px;text-align:center;color:#e74c3c">
          <h3>Failed to load view</h3><p>${err.message}</p></div>`;
        return;
      }
    }

    updateNavActive(viewId);
    await router.navigate(viewId);
  }

  function phaseLabel(viewId) {
    return { batch:'A (Batch)', gallery:'B (Gallery)', simulator:'C (Simulator)', transfer:'D (Transfer)' }[viewId] || '?';
  }

  function updateNavActive(viewId) {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
  }

  /* ---------------------------------------------------------------- *
   *  Wire navigation buttons
   * ---------------------------------------------------------------- */
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  /* ---------------------------------------------------------------- *
   *  Boot into Convert view
   * ---------------------------------------------------------------- */
  await navigateTo('convert');

})();
