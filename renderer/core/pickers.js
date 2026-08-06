(function () {
'use strict';
/**
 * Shared "add selection to …" pickers (window.Pickers).
 *
 * A small, dependency-free modal that lets any view push a set of files into
 * either a Project or a Collection — picking an existing target or creating a
 * new one on the spot. It reads/writes the persisted settings directly
 * (settings.projects / settings.collections) so it works identically from the
 * Batch, Collections, Gallery or Files views.
 *
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 *   window.Pickers.addToProject(files)     -> Promise<{ok, created, name}|null>
 *   window.Pickers.addToCollection(files)  -> Promise<{ok, created, name}|null>
 *
 * `files` items: { path, name, ext?, mtime?, size?, preview? }
 */

const t = (key, params = {}) => {
  const lang = (window.store && window.store.get('settings.language', 'en')) || 'en';
  let str = (window.I18N && window.I18N[lang] && window.I18N[lang][key]);
  if (str === undefined) str = window.I18N && window.I18N.en && window.I18N.en[key];
  if (str === undefined) str = key;
  Object.entries(params).forEach(([k, v]) => { str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v); });
  return str;
};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = (p) => (p || 'n_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tail = (p) => { const a = String(p || '').split(/[/\\]/).filter(Boolean); return a.length ? a[a.length - 1] : p; };
const extOf = (p) => { const m = String(p || '').match(/\.([^.\/\\]+)$/); return m ? m[1].toLowerCase() : ''; };

async function getSettings() {
  try { return (await window.api.getSettings()) || {}; }
  catch (_) { return (window.store && window.store.get('settings')) || {}; }
}

function injectCSS() {
  if (document.getElementById('pk-styles')) return;
  const s = document.createElement('style');
  s.id = 'pk-styles';
  s.textContent = `
.pk-overlay {
  position: fixed; inset: 0; z-index: 9000; display: flex;
  align-items: center; justify-content: center;
  background: rgba(20, 26, 45, .38);
}
.pk-modal {
  width: min(440px, 92vw); background: var(--panel-bg, #fff);
  border: 1px solid var(--border, #e3e7ef); border-radius: 12px;
  box-shadow: 0 18px 48px rgba(20,26,45,.22); overflow: hidden;
  color: var(--text, #1c2333); font-size: 13px;
}
.pk-head { padding: 15px 18px 6px; }
.pk-head h3 { margin: 0; font-size: 15px; font-weight: 600; }
.pk-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted, #6b7385); }
.pk-body { padding: 12px 18px 4px; display: flex; flex-direction: column; gap: 10px; }
.pk-label { font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--muted, #6b7385); }
.pk-select, .pk-input {
  width: 100%; box-sizing: border-box; padding: 8px 10px;
  border: 1px solid var(--border, #e3e7ef); border-radius: 7px;
  background: var(--input-bg, #fff); color: var(--text, #1c2333); font-size: 13px; outline: none;
}
.pk-select:focus, .pk-input:focus { border-color: var(--accent, #5b5bd6); }
.pk-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px 16px; }
.pk-btn {
  padding: 8px 16px; border-radius: 7px; border: 1px solid var(--border, #e3e7ef);
  background: var(--input-bg, #fff); color: var(--text, #1c2333); cursor: pointer; font-size: 13px;
}
.pk-btn:hover { background: var(--hover-bg, #f0f2f9); }
.pk-btn.pk-primary { background: var(--accent, #5b5bd6); border-color: var(--accent, #5b5bd6); color: #fff; }
.pk-btn.pk-primary:hover { background: var(--accent-hover, #4a4ac4); }
`;
  document.head.appendChild(s);
}

/**
 * Generic modal. `targets` = [{id,name}] existing; returns a Promise resolving
 * to { existingId|null, newName|null } or null if cancelled.
 */
function openModal({ title, sub, existingLabel, targets, newOptionLabel, newPlaceholder }) {
  injectCSS();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pk-overlay';
    const opts = targets.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    overlay.innerHTML = `
      <div class="pk-modal" role="dialog" aria-modal="true">
        <div class="pk-head">
          <h3>${esc(title)}</h3>
          <p class="pk-sub">${esc(sub)}</p>
        </div>
        <div class="pk-body">
          <div>
            <div class="pk-label">${esc(existingLabel)}</div>
            <select class="pk-select" id="pk-select">
              <option value="__new__">➕ ${esc(newOptionLabel)}</option>
              ${opts}
            </select>
          </div>
          <div id="pk-new-wrap">
            <input class="pk-input" id="pk-new-name" placeholder="${esc(newPlaceholder)}" />
          </div>
        </div>
        <div class="pk-foot">
          <button class="pk-btn" id="pk-cancel">${esc(t('pick.cancel'))}</button>
          <button class="pk-btn pk-primary" id="pk-ok">${esc(t('pick.add'))}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const sel = overlay.querySelector('#pk-select');
    const newWrap = overlay.querySelector('#pk-new-wrap');
    const newName = overlay.querySelector('#pk-new-name');
    const syncNew = () => { newWrap.style.display = (sel.value === '__new__') ? '' : 'none'; if (sel.value === '__new__') newName.focus(); };
    // If there are no existing targets, force "new".
    if (targets.length === 0) { sel.value = '__new__'; }
    syncNew();
    sel.addEventListener('change', syncNew);

    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#pk-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector('#pk-ok').addEventListener('click', () => {
      if (sel.value === '__new__') {
        const nm = (newName.value || '').trim();
        if (!nm) { newName.focus(); return; }
        close({ existingId: null, newName: nm });
      } else {
        close({ existingId: sel.value, newName: null });
      }
    });
    newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector('#pk-ok').click(); });
  });
}

function toEmbroideryAsset(f) {
  const path = f.path;
  const mtime = f.mtime || Date.now();
  const asset = {
    id: uid('a_'),
    name: f.name || tail(path),
    path,
    kind: 'embroidery',
    size: f.size || 0,
    mtime,
    addedAt: Date.now(),
    tags: [], category: '', notes: '',
    versions: [{ id: 'v1', path, mtime, label: 'Original', isActive: true }],
  };
  if (f.preview) asset.preview = f.preview;
  return asset;
}

function toCollectionFile(f) {
  return {
    path: f.path,
    name: f.name || tail(f.path),
    ext: f.ext || extOf(f.path),
    mtime: f.mtime || Date.now(),
    size: f.size || 0,
    tags: [], category: '',
    preview: f.preview || null,
  };
}

/* ------------------------------------------------------------------ *
 *  Public: add to Project
 * ------------------------------------------------------------------ */
async function addToProject(files) {
  files = (files || []).filter(f => f && f.path);
  if (!files.length) return null;

  const s = await getSettings();
  const nodes = Array.isArray(s.projects) ? s.projects : [];
  const tree = window.Grouping ? window.Grouping.createTree(nodes)
                               : { nodes, byId: (id) => nodes.find(n => n.id === id), addNode: null };
  const roots = tree.nodes.filter(n => !n.parentId).map(n => ({ id: n.id, name: n.name || t('projects.untitled') }));

  const choice = await openModal({
    title: t('pick.addToProject'),
    sub: t('pick.filesCount', { n: files.length }),
    existingLabel: t('pick.chooseProject'),
    targets: roots,
    newOptionLabel: t('pick.newProject'),
    newPlaceholder: t('pick.projectNamePh'),
  });
  if (!choice) return null;

  let node, created = false;
  if (choice.newName) {
    node = window.Grouping
      ? tree.addNode(null, choice.newName, { type: 'project', assets: [] })
      : (() => { const n = { id: uid('c_'), name: choice.newName, parentId: null, type: 'project', assets: [], createdAt: Date.now() }; tree.nodes.push(n); return n; })();
    created = true;
  } else {
    node = tree.byId(choice.existingId);
  }
  if (!node) return null;
  if (!Array.isArray(node.assets)) node.assets = [];

  const existingPaths = new Set(node.assets.map(a => a.path));
  let addedN = 0;
  for (const f of files) {
    if (existingPaths.has(f.path)) continue;
    node.assets.push(toEmbroideryAsset(f));
    existingPaths.add(f.path);
    addedN++;
  }

  try { await window.api.setSettings({ projects: tree.nodes }); } catch (_) {}
  if (window.store) window.store.set('settings.projects', tree.nodes);
  return { ok: true, created, name: node.name, added: addedN };
}

/* ------------------------------------------------------------------ *
 *  Public: add to Collection
 * ------------------------------------------------------------------ */
async function addToCollection(files) {
  files = (files || []).filter(f => f && f.path);
  if (!files.length) return null;

  const s = await getSettings();
  let nodes = Array.isArray(s.collections) ? s.collections : [];
  nodes.forEach(n => { n.files = Array.isArray(n.files) ? n.files : []; });
  const targets = nodes.map(n => ({ id: n.id, name: n.name || t('collections.untitled') }));

  const choice = await openModal({
    title: t('pick.addToCollection'),
    sub: t('pick.filesCount', { n: files.length }),
    existingLabel: t('pick.chooseCollection'),
    targets,
    newOptionLabel: t('pick.newCollection'),
    newPlaceholder: t('pick.collectionNamePh'),
  });
  if (!choice) return null;

  let node, created = false;
  if (choice.newName) {
    node = { id: uid('col_'), name: choice.newName, parentId: null, files: [], createdAt: Date.now() };
    nodes.push(node);
    created = true;
  } else {
    node = nodes.find(n => n.id === choice.existingId);
  }
  if (!node) return null;
  if (!Array.isArray(node.files)) node.files = [];

  const existingPaths = new Set(node.files.map(f => f.path));
  let addedN = 0;
  for (const f of files) {
    if (existingPaths.has(f.path)) continue;
    node.files.push(toCollectionFile(f));
    existingPaths.add(f.path);
    addedN++;
  }

  try { await window.api.setSettings({ collections: nodes }); } catch (_) {}
  if (window.store) window.store.set('settings.collections', nodes);
  return { ok: true, created, name: node.name, added: addedN };
}

window.Pickers = { addToProject, addToCollection };
})();
