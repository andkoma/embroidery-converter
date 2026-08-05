/**
 * Embroidery Converter - API Wrapper
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 * 
 * Typed wrappers over window.api with error handling and logging.
 */
'use strict';

/**
 * Check if window.api is available (loaded via preload.js).
 */
function ensureAPI() {
  if (!window.api) {
    throw new Error('window.api not available - preload.js not loaded?');
  }
}

/**
 * Backend API
 */
const backend = {
  /**
   * Get backend status.
   * @returns {Promise<{available, mode, pythonFound, reason, error}>}
   */
  async status() {
    ensureAPI();
    return await window.api.backendStatus();
  },

  /**
   * List supported formats.
   * @returns {Promise<{success, formats, error}>}
   */
  async listFormats() {
    ensureAPI();
    return await window.api.listFormats();
  },

  /**
   * Inspect a file.
   * @param {string} inputPath - absolute file path
   * @returns {Promise<{success, meta, preview, error, warnings}>}
   */
  async inspect(inputPath) {
    ensureAPI();
    return await window.api.inspect(inputPath);
  },

  /**
   * Convert a file.
   * @param {Object} payload - {input_path, output_path, output_format, options}
   * @returns {Promise<{success, output_path, warnings, error}>}
   */
  async convert(payload) {
    ensureAPI();
    return await window.api.convert(payload);
  }
};

/**
 * Dialog API
 */
const dialog = {
  /**
   * Open file picker.
   * @returns {Promise<string[]>} selected file paths
   */
  async openFiles() {
    ensureAPI();
    return await window.api.openFiles();
  },

  /**
   * Select output directory.
   * @returns {Promise<string|null>} selected directory path
   */
  async selectOutputDir() {
    ensureAPI();
    return await window.api.selectOutputDir();
  },

  /**
   * Get default output directory.
   * @returns {Promise<string>} default directory path
   */
  async defaultDir() {
    ensureAPI();
    return await window.api.defaultDir();
  }
};

/**
 * Shell API
 */
const shell = {
  /**
   * Open a path in the default application.
   * @param {string} path - file or directory path
   * @returns {Promise<string>} error message or empty string
   */
  async openPath(path) {
    ensureAPI();
    return await window.api.openPath(path);
  },

  /**
   * Show a file in the file manager.
   * @param {string} path - file path
   * @returns {Promise<void>}
   */
  async showItem(path) {
    ensureAPI();
    return await window.api.showItem(path);
  }
};

/**
 * Platform info
 */
const platform = window.api?.platform || 'unknown';

/**
 * Combined API object.
 */
const api = {
  backend,
  dialog,
  shell,
  platform
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { api };
}
