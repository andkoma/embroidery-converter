/**
 * Embroidery Converter - View Router
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 * 
 * Manages view lifecycle: mounting, unmounting, and switching between views.
 */
'use strict';

/**
 * Router manages the active view and handles transitions.
 */
class Router {
  constructor(viewHost, store) {
    this.viewHost = viewHost; // DOM element to mount views into
    this.store = store;
    this.views = new Map(); // viewId → { mount, unmount, module }
    this.currentView = null;
    this.currentViewId = null;
  }

  /**
   * Register a view module.
   * @param {string} id - unique view identifier
   * @param {Object} module - { mount(container, store), unmount() }
   */
  register(id, module) {
    if (!module.mount || typeof module.mount !== 'function') {
      throw new Error(`View ${id} must export a mount() function`);
    }
    this.views.set(id, module);
  }

  /**
   * Navigate to a view by ID.
   * @param {string} viewId - registered view ID
   */
  async navigate(viewId) {
    if (!this.views.has(viewId)) {
      console.error(`View "${viewId}" not registered`);
      return;
    }

    // Unmount current view
    if (this.currentView && this.currentView.unmount) {
      try {
        await this.currentView.unmount();
      } catch (err) {
        console.error('Error unmounting view:', err);
      }
    }

    // Clear container
    this.viewHost.innerHTML = '';

    // Update store
    this.store.patch({ currentView: viewId });
    this.currentViewId = viewId;

    // Mount new view
    const module = this.views.get(viewId);
    this.currentView = module;

    try {
      await module.mount(this.viewHost, this.store);
    } catch (err) {
      console.error(`Error mounting view "${viewId}":`, err);
      this.viewHost.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #e74c3c;">
          <h2>Error loading view</h2>
          <p>${err.message}</p>
        </div>
      `;
    }
  }

  /**
   * Get current view ID.
   */
  getCurrentView() {
    return this.currentViewId;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Router };
}
