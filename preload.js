'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Safe, minimal API exposed to the renderer via contextBridge.
 * No Node primitives are leaked to the page.
 */
contextBridge.exposeInMainWorld('api', {
  // backend
  backendStatus: () => ipcRenderer.invoke('backend:status'),
  listFormats: () => ipcRenderer.invoke('backend:formats'),
  inspect: (inputPath) => ipcRenderer.invoke('backend:inspect', inputPath),
  convert: (payload) => ipcRenderer.invoke('backend:convert', payload),

  // dialogs / fs
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  selectOutputDir: () => ipcRenderer.invoke('dialog:selectOutputDir'),
  defaultDir: () => ipcRenderer.invoke('fs:defaultDir'),

  // shell helpers
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  platform: process.platform,
});
