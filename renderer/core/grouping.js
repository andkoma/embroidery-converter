'use strict';

/**
 * Embroidery Converter — Shared "grouping" core
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * A small, dependency-free toolkit shared by the Collections and Projects
 * views. Both organise items into a nested tree stored as a FLAT array of
 * nodes linked by `parentId` (null = root). This module owns:
 *
 *   • Tree algorithms  — byId, childrenOf, descendantIds, nodePath, CRUD.
 *   • Asset-kind detection — classify a file path into embroidery / image /
 *     document / note so views can render mixed asset types consistently.
 *   • Preview helpers  — render backend polyline previews to SVG, and
 *     rasterize them to a PNG data URL (used for AI vision classification).
 *
 * Exposed as `window.Grouping`. No DOM ownership lives here — views keep
 * their own rendering; this is pure logic so it is trivially reusable and
 * testable.
 */
(function () {

  /* ------------------------------------------------------------------ *
   *  Small string / id helpers
   * ------------------------------------------------------------------ */
  const uid = (p) => (p || 'n_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const tail = (p) => {
    const a = String(p == null ? '' : p).split(/[/\\]/).filter(Boolean);
    return a.length ? a[a.length - 1] : String(p == null ? '' : p);
  };

  const extOf = (p) => {
    const t = tail(p);
    const i = t.lastIndexOf('.');
    return i >= 0 ? t.slice(i + 1).toLowerCase() : '';
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ------------------------------------------------------------------ *
   *  Asset-kind detection
   *
   *  Projects hold a mixture of file types; each is classified so the UI
   *  can decide what to show (stitch metadata + vision only make sense for
   *  embroidery/image kinds).
   * ------------------------------------------------------------------ */
  const EMBROIDERY_EXTS = new Set([
    'dst','pes','pec','jef','vp3','hus','xxx','exp','sew','emb','u01','tap',
    'phb','phc','bro','dat','dsb','dsz','emd','10o','100','shv','jpx','ksm',
    'max','tbf','gt','inb','zxy','stx','pmv','csv','json','gcode',
  ]);
  const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','bmp','webp','svg','tiff','tif']);
  const DOCUMENT_EXTS = new Set([
    'pdf','txt','md','rtf','doc','docx','odt','xls','xlsx','ods','ppt','pptx',
    'csv','html','htm',
  ]);

  /**
   * Classify a file path into a coarse asset kind.
   * Note: embroidery formats win over the generic document/csv overlap.
   * @param {string} p  file path or name
   * @returns {'embroidery'|'image'|'document'|'note'}
   */
  function assetKind(p) {
    const e = extOf(p);
    if (EMBROIDERY_EXTS.has(e) && e !== 'csv' && e !== 'json') return 'embroidery';
    if (e === 'csv' || e === 'json' || e === 'gcode') return 'embroidery';
    if (IMAGE_EXTS.has(e)) return 'image';
    if (DOCUMENT_EXTS.has(e)) return 'document';
    return 'document';
  }

  /** Whether a vision model can meaningfully look at this asset kind. */
  function isVisualKind(kind) { return kind === 'embroidery' || kind === 'image'; }

  /* ------------------------------------------------------------------ *
   *  Tree factory
   *
   *  Wrap a flat node array (each node: { id, name, parentId, ... }) with
   *  read + mutate helpers. The array is used by reference, so callers can
   *  read `tree.nodes` after mutations and persist it.
   * ------------------------------------------------------------------ */
  function createTree(initialNodes) {
    let nodes = Array.isArray(initialNodes) ? initialNodes : [];

    const byId = (id) => nodes.find(n => n.id === id) || null;
    const childrenOf = (id) => nodes.filter(n => n.parentId === (id || null));

    function descendantIds(id) {
      const out = [];
      const seen = new Set();
      const walk = (pid) => {
        if (seen.has(pid)) return;
        seen.add(pid);
        childrenOf(pid).forEach(c => {
          if (!seen.has(c.id)) { out.push(c.id); walk(c.id); }
        });
      };
      walk(id);
      return out;
    }

    /** "Root / Child / Grandchild" breadcrumb for a node id. */
    function nodePath(id) {
      const parts = [];
      const seen = new Set();
      let n = byId(id);
      while (n && !seen.has(n.id)) {
        seen.add(n.id);
        parts.unshift(n.name);
        n = n.parentId ? byId(n.parentId) : null;
      }
      return parts.join(' / ');
    }

    /**
     * Add a node under parentId. `extra` seeds view-specific fields.
     * @returns the created node.
     */
    function addNode(parentId, name, extra) {
      const node = Object.assign(
        { id: uid('c_'), name: name || '', parentId: parentId || null, createdAt: Date.now() },
        extra || {}
      );
      nodes.push(node);
      return node;
    }

    /** Remove a node and all its descendants. @returns removed id set. */
    function removeNode(id) {
      const ids = new Set([id, ...descendantIds(id)]);
      nodes = nodes.filter(n => !ids.has(n.id));
      return ids;
    }

    function renameNode(id, name) {
      const n = byId(id);
      if (n && String(name || '').trim()) { n.name = String(name).trim(); return true; }
      return false;
    }

    /**
     * Reparent a node, guarding against cycles (cannot move a node into one
     * of its own descendants, nor onto itself).
     * @returns {boolean} whether the move was applied.
     */
    function moveNode(id, newParentId) {
      if (id === newParentId) return false;
      const n = byId(id);
      if (!n) return false;
      if (newParentId && (newParentId === id || descendantIds(id).includes(newParentId))) return false;
      n.parentId = newParentId || null;
      return true;
    }

    return {
      get nodes() { return nodes; },
      set nodes(v) { nodes = Array.isArray(v) ? v : []; },
      byId, childrenOf, descendantIds, nodePath,
      addNode, removeNode, renameNode, moveNode,
    };
  }

  /* ------------------------------------------------------------------ *
   *  Preview helpers (backend polyline shape → SVG / PNG)
   *
   *  The Python backend's `inspect`/`thumbs` return a preview of the shape:
   *    { left, top, width, height, lines: [{ hex, pts:[[x,y],...] }] }
   * ------------------------------------------------------------------ */
  function renderPreviewSVG(preview) {
    if (!preview || !Array.isArray(preview.lines) || !preview.lines.length) return '';
    const left = preview.left || 0, top = preview.top || 0;
    const width = preview.width || 1, height = preview.height || 1;
    const strokeW = Math.max(Math.max(width, height) / 120, 0.4);
    const paths = preview.lines.map(line => {
      const pts = line.pts || [];
      if (pts.length < 2) return '';
      const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ');
      return `<path d="${d}" stroke="${esc(line.hex || '#888')}" fill="none" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    return `<svg viewBox="${left} ${top} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
  }

  /** Render a polyline preview to a PNG data URL on a white background. */
  function rasterizePreview(preview, size) {
    size = size || 256;
    if (!preview || !Array.isArray(preview.lines) || !preview.lines.length) return null;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const left = preview.left || 0, top = preview.top || 0;
    const w = preview.width || 1, h = preview.height || 1;
    const pad = size * 0.08;
    const scale = Math.min((size - 2 * pad) / w, (size - 2 * pad) / h);
    const offX = (size - w * scale) / 2 - left * scale;
    const offY = (size - h * scale) / 2 - top * scale;
    ctx.lineWidth = Math.max(size / 200, 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    preview.lines.forEach(line => {
      const pts = line.pts || [];
      if (pts.length < 2) return;
      ctx.strokeStyle = line.hex || '#333';
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const x = pt[0] * scale + offX, y = pt[1] * scale + offY;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    return canvas.toDataURL('image/png');
  }

  /* ------------------------------------------------------------------ *
   *  Export
   * ------------------------------------------------------------------ */
  window.Grouping = {
    uid, tail, extOf, esc,
    assetKind, isVisualKind,
    EMBROIDERY_EXTS, IMAGE_EXTS, DOCUMENT_EXTS,
    createTree,
    renderPreviewSVG, rasterizePreview,
  };

})();
