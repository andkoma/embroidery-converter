/**
 * Embroidery Converter - Reactive Store
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 * 
 * A minimal reactive store for shared state across views.
 * Subscribers are notified when state changes.
 */
'use strict';

/**
 * Store holds the entire app state and notifies listeners on mutation.
 */
class Store {
  constructor(initialState = {}) {
    this._state = initialState;
    this._listeners = new Set();
  }

  /**
   * Get current state (readonly - mutations via setState or patch).
   */
  getState() {
    return this._state;
  }

  /**
   * Replace entire state and notify.
   */
  setState(newState) {
    this._state = newState;
    this._notify();
  }

  /**
   * Merge updates into state and notify.
   * @param {Object} updates - partial state object to merge
   */
  patch(updates) {
    this._state = { ...this._state, ...updates };
    this._notify();
  }

  /**
   * Deep patch for nested state (e.g., settings.language).
   * @param {string} path - dot notation path (e.g., 'settings.language')
   * @param {*} value - value to set
   */
  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let target = this._state;
    
    // Navigate to parent
    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }
    
    target[last] = value;
    this._notify();
  }

  /**
   * Get nested value by path.
   * @param {string} path - dot notation path
   * @param {*} defaultValue - fallback if undefined
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.');
    let value = this._state;
    for (const key of keys) {
      if (value === undefined || value === null) return defaultValue;
      value = value[key];
    }
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Subscribe to state changes.
   * @param {Function} listener - callback(state)
   * @returns {Function} unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Notify all subscribers.
   */
  _notify() {
    this._listeners.forEach(fn => fn(this._state));
  }
}

/**
 * Initial application state.
 */
const initialState = {
  // Current view
  currentView: 'files',

  // Backend status
  backend: {
    available: false,
    mode: null, // 'bundled' | 'system-python'
    pythonFound: null,
    reason: '',
    checking: true
  },

  // Supported formats (from backend)
  formats: [],

  // Settings (persisted)
  settings: {
    language: 'en',
    theme: 'light',
    managedFolders: [],
    batchFolders: [],
    recentOutputDirs: [],
    gallery: {
      typeFilter: ['pes', 'dst', 'jef', 'vp3', 'hus', 'xxx', 'exp'],
      sort: 'name',
      thumbSize: 128
    },
    transfer: {
      favoriteDestinations: []
    }
  },

  // Files (FileRecord[]) - shared across views
  files: [],

  // Scan cache — folder path → { files: FileEntry[], scannedAt: number, dirMtime: number }
  // Lets Gallery/Batch skip re-scanning folders that have not changed since the
  // last scan. Survives view switching because it lives in the shared store.
  scanCache: {},

  // Batch hand-off queue — file paths marked in Gallery and sent to the Batch view.
  batchQueue: [],

  // Files hand-off queue — file paths sent from Gallery ("Convert") to the Files view.
  filesQueue: [],

  // Simulator hand-off — single file path sent from Gallery ("Open in Simulator").
  simulatorQueue: null,

  // Collections hand-off queue — files marked in Gallery and sent to the
  // Collections view. Each entry: { path, name, ext }.
  collectionsQueue: [],

  // Transfer hand-off queue — files sent from Collections/Projects to the
  // Transfer view as transfer sources. Each entry: { path, name, ext, size, mtime }.
  transferQueue: [],

  // Preview cache (path → preview data)
  previewCache: new Map(),

  // Thread cache (path → threads array)
  threadCache: new Map(),

  // Active jobs (convert/batch)
  jobs: [],

  // Current batch profile (optional shared overlay)
  batchProfile: {
    output_format: null,
    resize: { width_mm: null, height_mm: null, lock_aspect: true, resample: false },
    colors: { limit: null },
    output_dir: null,
    naming: { pattern: '{name}.{ext}', on_conflict: 'suffix' }
  }
};

/**
 * Global store instance.
 */
const store = new Store(initialState);

// Expose globally so lazily-loaded view scripts can reliably access the shared
// store via window.store (in addition to the bare `store` script-scope global).
if (typeof window !== 'undefined') {
  window.store = store;
}

// Export for use in views/components
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { store, Store };
}
