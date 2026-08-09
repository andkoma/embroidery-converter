const { app } = require('electron');
console.log('✓ Electron loaded');

app.whenReady().then(() => {
  console.log('✓ App ready');
  console.log('✓ userData path:', app.getPath('userData'));
  app.quit();
});

setTimeout(() => {
  console.error('✗ Timeout - app never ready');
  process.exit(1);
}, 5000);
