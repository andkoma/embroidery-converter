'use strict';

/**
 * Embroidery Converter - Preload Script
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * Exposes a safe, typed API surface to the renderer via contextBridge.
 * No Node.js primitives are leaked to the page.
 */

const { contextBridge, ipcRenderer } = require('electron');

/* ---------------------------------------------------------------- *
 *  Stream routing — demux backend:stream events by requestId
 *
 *  When a streaming IPC call (scan, thumbs) is started, the caller
 *  passes an `onEntry` callback and we store it in this map keyed by
 *  the auto-generated requestId.  The single global listener below
 *  dispatches each arriving NDJSON line to the right callback.
 * ---------------------------------------------------------------- */
const _streamCallbacks = new Map(); // requestId → fn(data)

ipcRenderer.on('backend:stream', (_e, { requestId, data }) => {
  const cb = _streamCallbacks.get(requestId);
  if (!cb) return;
  try { cb(data); } catch (_) { /* renderer callback threw — ignore */ }
  // Auto-remove when the stream sends a terminal event.
  // A per-file error has data.path set; a fatal/completion event does not.
  if (data.type === 'done' || (data.type === 'error' && data.path === undefined)) {
    _streamCallbacks.delete(requestId);
  }
});

/* ---------------------------------------------------------------- *
 *  Helper: generate a lightweight unique request ID
 * ---------------------------------------------------------------- */
function _newReqId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ---------------------------------------------------------------- *
 *  Public API surface
 * ---------------------------------------------------------------- */
contextBridge.exposeInMainWorld('api', {

  /* ---------------------------------------------------------------- *
   *  Backend (conversion engine)
   * ---------------------------------------------------------------- */
  backendStatus: ()          => ipcRenderer.invoke('backend:status'),
  listFormats:  ()           => ipcRenderer.invoke('backend:formats'),
  inspect:      (inputPath)  => ipcRenderer.invoke('backend:inspect', inputPath),
  convert:      (payload)    => ipcRenderer.invoke('backend:convert', payload),

  /* ---------------------------------------------------------------- *
   *  Streaming (scan + thumbs)
   *
   *  Both helpers auto-register the callback before invoking the IPC
   *  call, so no events are lost even if the first NDJSON line arrives
   *  before the invoke promise resolves.
   *
   *  Returns: Promise<string> — the requestId (pass to cancelStream to abort).
   * ---------------------------------------------------------------- */

  /**
   * Scan one or more folders for embroidery files.
   * @param {{ folders: string[], recursive?: boolean, extensions?: string[] }} opts
   * @param {function} onEntry  Called for each NDJSON line (file / error / done).
   * @returns {Promise<string>} requestId
   */
  scanFolders: async (opts, onEntry) => {
    const requestId = _newReqId();
    _streamCallbacks.set(requestId, onEntry);
    await ipcRenderer.invoke('backend:scan', { requestId, opts });
    return requestId;
  },

  /**
   * Generate thumbnail data (metadata + preview polylines) for a list of paths.
   * @param {string[]} paths
   * @param {function} onThumb  Called for each NDJSON line (thumb / error / done).
   * @returns {Promise<string>} requestId
   */
  makeThumbs: async (paths, onThumb) => {
    const requestId = _newReqId();
    _streamCallbacks.set(requestId, onThumb);
    await ipcRenderer.invoke('backend:thumbs', { requestId, paths: paths || [] });
    return requestId;
  },

  /**
   * Generate thumbnails with disk caching (userData/thumbcache). Cache hits
   * are returned instantly; only changed/new files hit the Python backend.
   * @param {{path:string, mtime:number}[]} items
   * @param {function} onThumb  Called for each NDJSON line (thumb / done).
   * @returns {Promise<string>} requestId
   */
  getThumbsCached: async (items, onThumb) => {
    const requestId = _newReqId();
    _streamCallbacks.set(requestId, onThumb);
    await ipcRenderer.invoke('backend:thumbsCached', { requestId, items: items || [] });
    return requestId;
  },

  /**
   * Get one cached thumbnail (generate + cache on miss).
   * @param {string} path
   * @param {number} mtime
   * @returns {Promise<{meta:object, preview:object}|null>}
   */
  getThumbnail: (path, mtime) => ipcRenderer.invoke('thumbnail:get', { path, mtime }),

  /**
   * Stat a directory to detect changes (for scan-cache invalidation).
   * @param {string} dirPath
   * @returns {Promise<{exists:boolean, mtime:number, isDir:boolean}>}
   */
  statDir: (dirPath) => ipcRenderer.invoke('fs:statDir', dirPath),

  /**
   * Run a batch conversion job.
   * @param {{ files: object[], profile: object }} job
   * @param {function} onProgress  Called for each progress event (running/done/error/skipped).
   * @returns {Promise<string>} requestId
   */
  runBatch: async (job, onProgress) => {
    const requestId = _newReqId();
    _streamCallbacks.set(requestId, onProgress);
    await ipcRenderer.invoke('backend:runBatch', { requestId, ...job });
    return requestId;
  },

  /**
   * Cancel a running scan, thumbs, or batch stream.
   * @param {string} requestId
   */
  cancelStream: (requestId) => {
    _streamCallbacks.delete(requestId);
    return ipcRenderer.invoke('backend:cancel', { requestId });
  },

  /* ---------------------------------------------------------------- *
   *  Settings (persisted to userData/settings.json)
   * ---------------------------------------------------------------- */
  /** Returns the full settings object (deep-merged with defaults). */
  getSettings: ()       => ipcRenderer.invoke('settings:get'),
  /** Patch-merges `patch` into stored settings; only provided keys change. */
  setSettings: (patch)  => ipcRenderer.invoke('settings:set', patch),
  /** Returns the packaged app version string. */
  getAppVersion: ()     => ipcRenderer.invoke('app:getVersion'),

  /* ---------------------------------------------------------------- *
   *  AI / vision (classification of design thumbnails)
   * ---------------------------------------------------------------- */
  /** Validate the configured AI provider/model with a tiny probe request. */
  aiTest: ()            => ipcRenderer.invoke('ai:test'),
  /**
   * Classify one or more design images.
   * @param {{ items: {id:string, image:string}[], categories?: string[], autoTag?: boolean }} payload
   *        image = data URL (data:image/png;base64,...)
   * @returns {Promise<{ok:boolean, results?:{id,category,tags}[], error?:string}>}
   */
  aiClassify: (payload) => ipcRenderer.invoke('ai:classify', payload),

  /* ---------------------------------------------------------------- *
   *  Dialogs & filesystem
   * ---------------------------------------------------------------- */
  openFiles:       ()    => ipcRenderer.invoke('dialog:openFiles'),
  selectOutputDir: ()    => ipcRenderer.invoke('dialog:selectOutputDir'),
  pickFolders:     ()    => ipcRenderer.invoke('dialog:pickFolders'),
  defaultDir:      ()    => ipcRenderer.invoke('fs:defaultDir'),

  /* ---------------------------------------------------------------- *
   *  Shell helpers
   * ---------------------------------------------------------------- */
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  /* ---------------------------------------------------------------- *
   *  Transfer utilities
   * ---------------------------------------------------------------- */
  listVolumes: ()                => ipcRenderer.invoke('fs:listVolumes'),
  joinPath:    (...segments)     => ipcRenderer.invoke('fs:joinPath', ...segments),
  ensureDir:   (dirPath)         => ipcRenderer.invoke('fs:ensureDir', dirPath),
  copyFile:    (srcPath, destPath) => ipcRenderer.invoke('fs:copyFile', srcPath, destPath),
  verifyFile:  (srcPath, destPath) => ipcRenderer.invoke('fs:verifyFile', srcPath, destPath),

  /* ---------------------------------------------------------------- *
   *  Platform info
   * ---------------------------------------------------------------- */
  platform: process.platform,
});
