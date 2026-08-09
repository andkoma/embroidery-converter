const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('./main/logger');

console.log('✓ App module loaded');

try {
  console.log('✓ Logger module loaded');
  
  app.whenReady().then(() => {
    console.log('✓ App is ready');
    
    try {
      logger.init(app.getPath('userData'));
      console.log('✓ Logger initialized');
    } catch (err) {
      console.error('✗ Logger init failed:', err);
      process.exit(1);
    }
    
    try {
      const window = new BrowserWindow({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      console.log('✓ Window created');
      window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
      console.log('✓ File loaded');
      
      setTimeout(() => {
        window.destroy();
        app.quit();
      }, 2000);
    } catch (err) {
      console.error('✗ Window init failed:', err);
      process.exit(1);
    }
  });
} catch (err) {
  console.error('✗ Fatal error:', err);
  process.exit(1);
}
