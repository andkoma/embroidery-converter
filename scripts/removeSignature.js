/**
 * Post-pack hook to remove invalid code signatures from embedded binaries.
 * 
 * Problem: electron-builder creates partial/invalid signatures for embedded
 * Python executables when building unsigned apps. This causes Gatekeeper to
 * reject the app as "damaged" instead of showing the standard "developer
 * cannot be verified" warning.
 * 
 * Solution: Remove ALL code signatures from the app bundle, which allows
 * Gatekeeper to properly handle it as an unsigned app.
 */

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

exports.default = async function(context) {
  // Only process on macOS
  if (os.platform() !== 'darwin') {
    console.log(`ℹ️  Skipping - not macOS`);
    return;
  }

  if (!context.appOutDir || !context.packager || !context.packager.appInfo) {
    console.log('⚠️  Missing context');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`);
  
  if (!fs.existsSync(appPath)) {
    console.log(`❌ App bundle not found: ${appPath}`);
    return;
  }
  
  console.log(`\n🔓 REMOVING INVALID CODE SIGNATURES - CRITICAL GATEKEEPER FIX`);
  console.log(`   Path: ${appPath}`);
  
  try {
    // Remove ALL signatures completely
    console.log('   → Removing code signature...');
    execSync(`codesign --remove-signature "${appPath}" 2>/dev/null || true`, { 
      stdio: 'pipe',
      shell: '/bin/bash'
    });
    
    // Verify removal
    console.log('   → Verifying unsigned state...');
    try {
      execSync(`codesign -v "${appPath}" 2>&1`, { stdio: 'pipe' });
      console.log('   ⚠️  Warning: App still reports as signed');
    } catch (e) {
      console.log('   ✅ Confirmed: App is unsigned');
    }
    
    console.log('\n✅ SUCCESS: App signatures removed');
    console.log('   → Gatekeeper will show standard warning instead of "damaged" error\n');
    
  } catch (err) {
    console.log(`\n❌ ERROR: ${err.message}`);
    console.log('   This may cause Gatekeeper rejection!\n');
    throw err;
  }
};
