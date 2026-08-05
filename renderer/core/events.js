/**
 * core/events.js — Renderer-side event bus
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 *
 * Lightweight publish/subscribe bus for cross-view communication within
 * the renderer process.  Views use this to signal each other without
 * direct imports or tight coupling.
 *
 * Usage (any view or module loaded after this script):
 *
 *   // Subscribe:
 *   const handle = window.events.on('gallery:select', (paths) => { ... });
 *
 *   // Publish:
 *   window.events.emit('gallery:select', selectedPaths);
 *
 *   // Unsubscribe (e.g. in view unmount):
 *   window.events.off('gallery:select', handle);
 *
 *   // Remove ALL listeners for an event (e.g. when a view owns the channel):
 *   window.events.clear('gallery:select');
 *
 * Event names are free-form strings; the convention is "scope:action"
 * (e.g. "batch:scan-start", "gallery:thumb-ready", "convert:file-dropped").
 */

(function (root) {
  'use strict';

  const _listeners = new Map(); // eventName → Set<fn>

  const events = {
    /**
     * Subscribe to a named event.
     * @param {string}   name  Event name (e.g. "gallery:select").
     * @param {Function} fn    Callback — receives whatever args emit() passes.
     * @returns {Function}     The same fn, for easy off() calls.
     */
    on(name, fn) {
      if (!_listeners.has(name)) _listeners.set(name, new Set());
      _listeners.get(name).add(fn);
      return fn;
    },

    /**
     * Unsubscribe a specific listener.
     * @param {string}   name
     * @param {Function} fn
     */
    off(name, fn) {
      const set = _listeners.get(name);
      if (set) {
        set.delete(fn);
        if (set.size === 0) _listeners.delete(name);
      }
    },

    /**
     * Publish an event — calls all subscribers synchronously.
     * @param {string} name
     * @param {...*}   args  Passed through to each subscriber.
     */
    emit(name, ...args) {
      const set = _listeners.get(name);
      if (!set || set.size === 0) return;
      for (const fn of set) {
        try {
          fn(...args);
        } catch (e) {
          console.error('[events] Uncaught error in subscriber for "' + name + '":', e);
        }
      }
    },

    /**
     * Remove ALL listeners for a given event name.
     * Useful when a view that owns a channel is unmounted.
     * @param {string} name
     */
    clear(name) {
      _listeners.delete(name);
    },

    /**
     * Return the number of subscribers for an event (for debugging).
     * @param {string} name
     * @returns {number}
     */
    listenerCount(name) {
      const set = _listeners.get(name);
      return set ? set.size : 0;
    },
  };

  // Expose as window.events
  root.events = events;

}(window));
