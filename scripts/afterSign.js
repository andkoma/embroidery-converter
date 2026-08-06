const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function(context) {
  if (process.platform !== 'darwin') {
    console.log('Skipping afterSign (not macOS)');
    return;
  }

  const appPath = context.appOutDir;
  const appName = context.packager.appInfo.productName || 'Embroidery Converter';
  const electronApp = path.join(appPath, `${appName}.app`);
  
  if (!fs.existsSync(electronApp)) {
    console.log(`Warning: App not found at ${electronApp}`);
    return;
  }

  console.log(`✓ Applying ad-hoc signature with entitlements to ${electronApp}`);
  
  // Get absolute path to entitlements file
  const entitlementsPath = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist');
  
  if (!fs.existsSync(entitlementsPath)) {
    console.error(`❌ Entitlements file not found: ${entitlementsPath}`);
    return;
  }

  try {
    // Use ad-hoc signing (-) with entitlements
    const cmd = `codesign --entitlements "${entitlementsPath}" -fs - --deep --force "${electronApp}"`;
    console.log(`Running: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
    
    // Verify signature includes entitlements
    console.log('');
    console.log('✓ Signature created. Entitlements:');
    const verifyCmd = `codesign -d --entitlements - "${electronApp}"`;
    execSync(verifyCmd, { stdio: 'inherit' });
    
  } catch (error) {
    console.error(`❌ Code signing failed: ${error.message}`);
    throw error;
  }
};
