/**
 * Embroidery Converter - Shell Initialization
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 * 
 * Initializes the app shell: router, navigation, and loads the initial view.
 */
'use strict';

(async function initShell() {
  const viewHost = document.getElementById('viewHost');
  const router = new Router(viewHost, store);

  // Register view modules (we'll load them dynamically)
  // For now, we'll register Convert first and add others as we build them
  
  /**
   * Dynamically load a view module by creating a script tag.
   * Views export themselves by calling window.registerView(id, module).
   */
  function loadViewModule(viewId) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `views/${viewId}/${viewId}.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load view: ${viewId}`));
      document.body.appendChild(script);
    });
  }

  /**
   * Global function for views to register themselves.
   */
  window.registerView = function(id, module) {
    router.register(id, module);
  };

  // Load Convert view module
  try {
    await loadViewModule('convert');
  } catch (err) {
    console.error('Failed to load Convert view:', err);
    viewHost.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #e74c3c;">
        <h2>Failed to load application</h2>
        <p>${err.message}</p>
      </div>
    `;
    return;
  }

  // Set up navigation
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      const viewId = item.dataset.view;
      
      // If view not yet loaded, try loading it
      if (!router.views.has(viewId)) {
        // For now, only Convert is implemented
        if (viewId !== 'convert') {
          alert(`${viewId} view is not yet implemented (coming in Phase A${viewId === 'batch' ? '' : 'B/C/D'})`);
          return;
        }
        
        try {
          await loadViewModule(viewId);
        } catch (err) {
          alert(`Failed to load ${viewId} view: ${err.message}`);
          return;
        }
      }
      
      // Navigate to view
      await router.navigate(viewId);
      
      // Update active state
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Navigate to initial view (Convert)
  await router.navigate('convert');

  // Initialize i18n (apply translations to static nav elements)
  if (typeof applyTranslations === 'function') {
    applyTranslations();
  }
})();
