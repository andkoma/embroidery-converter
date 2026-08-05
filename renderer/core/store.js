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
  currentView: 'convert',

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

// Export for use in views/components
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { store, Store };
}
