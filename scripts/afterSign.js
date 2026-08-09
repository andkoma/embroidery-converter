const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function(context) {
  // Use the BUILD TARGET platform (context.electronPlatformName), not the host
  // process.platform - they differ when cross-building (e.g. Windows target on a macOS host).
  if (context.electronPlatformName !== 'darwin') {
    console.log(`ℹ️  afterSign: Target platform is ${context.electronPlatformName}, not macOS, skipping`);
    return;
  }

  console.log('🔐 afterSign hook: Applying entitlements to Electron app');

  // Determine the app path from context
  let electronApp;
  
  if (context.electronApp) {
    // afterSign context (correct hook)
    electronApp = context.electronApp;
    console.log(`  Path from electronApp: ${electronApp}`);
  } else if (context.appOutDir) {
    // Fallback for afterPack context
    const appName = context.packager?.appInfo?.productName || 'Embroidery Converter';
    electronApp = path.join(context.appOutDir, `${appName}.app`);
    console.log(`  Path from appOutDir: ${electronApp}`);
  } else {
    console.log('⚠️  afterSign: Cannot determine app path from context');
    return;
  }
  
  if (!fs.existsSync(electronApp)) {
    console.error(`❌ afterSign: App not found at ${electronApp}`);
    return;
  }

  // Determine entitlements path
  let entitlementsPath;
  if (context.packager?.projectDir) {
    entitlementsPath = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist');
  } else {
    entitlementsPath = path.join(process.cwd(), 'build', 'entitlements.mac.plist');
  }
  
  if (!fs.existsSync(entitlementsPath)) {
    console.error(`❌ afterSign: Entitlements file not found at ${entitlementsPath}`);
    return;
  }

  try {
    // Re-apply ad-hoc signature with entitlements after electron-builder signed it
    console.log('  • Applying entitlements with ad-hoc signature...');
    const signCmd = `codesign --force --deep --strict --options=runtime -s - --entitlements "${entitlementsPath}" "${electronApp}"`;
    execSync(signCmd, { stdio: 'inherit' });
    console.log('  ✓ Ad-hoc signature applied');
    
    // Verify the signature
    console.log('  • Verifying signature...');
    const verifyCmd = `codesign -dv "${electronApp}"`;
    execSync(verifyCmd, { stdio: 'inherit' });
    console.log('  ✓ Signature verified');
    
    console.log('✅ afterSign hook complete');
    
  } catch (error) {
    console.error(`❌ afterSign failed: ${error.message}`);
    console.error('⚠️  Continuing build - app may not have proper entitlements');
  }
};

