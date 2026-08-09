const { app, BrowserWindow } = require('electron');
const path = require('path');
const logger = require('./main/logger');

let mainWindow = null;

app.whenReady().then(() => {
  try {
    logger.init(app.getPath('userData'));
    logger.info('=== Test app started ===');
    
    mainWindow = new BrowserWindow({
      width: 400,
      height: 300,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    
    console.log('✓ Window opened, check browser console for errors');
    
    setTimeout(() => {
      app.quit();
    }, 3000);
  } catch (err) {
    console.error('✗ Error:', err);
    logger.error('App error', err);
    process.exit(1);
  }
});

app.on('quit', () => {
  logger.close();
});
