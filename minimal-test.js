const { app } = require('electron');
const logger = require('./main/logger');

console.log('✓ 1: App & Logger loaded');

app.whenReady().then(() => {
  console.log('✓ 2: App ready');
  
  try {
    logger.init(app.getPath('userData'));
    console.log('✓ 3: Logger init');
  } catch (err) {
    console.error('✗ Logger error:', err.message);
  }
  
  logger.info('Test message');
  console.log('✓ 4: Logged message');
  
  setTimeout(() => {
    console.log('✓ 5: About to quit');
    logger.close();
    app.quit();
  }, 2000);
});

app.on('quit', () => {
  console.log('✓ 6: Quit event fired');
});
