const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function(context) {
  if (process.platform !== 'darwin') {
    console.log('Skipping afterPack codesign (not macOS)');
    return;
  }

  // afterPack context differs from afterSign
  // Get the app bundle path based on electron-builder structure
  let electronApp;
  
  if (context.appOutDir) {
    // afterPack context
    const appName = context.packager.appInfo.productName || 'Embroidery Converter';
    electronApp = path.join(context.appOutDir, `${appName}.app`);
  } else if (context.electronApp) {
    // afterSign context
    electronApp = context.electronApp;
  } else {
    console.log('Warning: Cannot determine app path');
    return;
  }
  
  if (!fs.existsSync(electronApp)) {
    console.log(`Warning: App not found at ${electronApp}, skipping entitlements`);
    return;
  }

  console.log(`✓ Applying ad-hoc signature with entitlements to ${electronApp}`);
  
  // Get absolute path to entitlements file
  let entitlementsPath;
  if (context.packager && context.packager.projectDir) {
    entitlementsPath = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist');
  } else {
    // Fallback: assume we're in project root
    entitlementsPath = path.join(process.cwd(), 'build', 'entitlements.mac.plist');
  }
  
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
    console.log('✓ Signature created. Verifying entitlements:');
    const verifyCmd = `codesign -d --entitlements - "${electronApp}"`;
    execSync(verifyCmd, { stdio: 'inherit' });
    console.log('✅ Entitlements verified in signature');
    
  } catch (error) {
    console.error(`❌ Code signing failed: ${error.message}`);
    console.error('⚠️ Continuing anyway - app will not have proper entitlements');
    // Don't throw - allow build to continue
  }
};
