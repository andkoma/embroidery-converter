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

contextBridge.exposeInMainWorld('api', {
  /* ---------------------------------------------------------------- *
   *  Backend (conversion engine)
   * ---------------------------------------------------------------- */
  backendStatus: ()          => ipcRenderer.invoke('backend:status'),
  listFormats:  ()           => ipcRenderer.invoke('backend:formats'),
  inspect:      (inputPath)  => ipcRenderer.invoke('backend:inspect', inputPath),
  convert:      (payload)    => ipcRenderer.invoke('backend:convert', payload),

  /* ---------------------------------------------------------------- *
   *  Settings (persisted to userData/settings.json)
   * ---------------------------------------------------------------- */
  /** Returns the full settings object (deep-merged with defaults). */
  getSettings: ()       => ipcRenderer.invoke('settings:get'),
  /** Patch-merges `patch` into stored settings; only provided keys change. */
  setSettings: (patch)  => ipcRenderer.invoke('settings:set', patch),

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
   *  Platform info
   * ---------------------------------------------------------------- */
  platform: process.platform,
});
