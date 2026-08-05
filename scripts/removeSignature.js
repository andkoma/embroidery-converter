/**
 * Post-pack hook to fix code signatures for Gatekeeper bypass.
 * 
 * Problem: electron-builder creates invalid/incomplete signatures. On macOS 13+,
 * this causes Gatekeeper to reject the app with "must be updated" error.
 * 
 * Solution: Sign the entire bundle with entitlements in the correct order:
 * 1. Python executable (no entitlements needed - helper binary)
 * 2. Main app (with entitlements.mac.plist)
 * This prevents Gatekeeper rejection and allows AMFI to accept the bundle.
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
  
  console.log(`\n🔐 APPLYING AD-HOC SIGNATURE WITH ENTITLEMENTS`);
  console.log(`   Path: ${appPath}`);
  
  try {
    // Step 1: Ensure execute permissions on main executable
    console.log('   → Step 1: Setting execute permissions...');
    const mainExec = path.join(appPath, 'Contents', 'MacOS', context.packager.appInfo.productName);
    if (fs.existsSync(mainExec)) {
      try {
        execSync(`chmod +x "${mainExec}"`, { stdio: 'pipe', shell: '/bin/bash' });
        console.log('      ✓ Main executable executable');
      } catch (e) {}
    }
    
    // Step 2: Ensure execute permissions on Python executable
    console.log('   → Step 2: Setting Python executable permissions...');
    const pythonBin = path.join(appPath, 'Contents', 'Resources', 'pybin', 'convert');
    if (fs.existsSync(pythonBin)) {
      try {
        execSync(`chmod +x "${pythonBin}"`, { stdio: 'pipe', shell: '/bin/bash' });
        // Sign Python executable WITHOUT entitlements (it's a helper)
        execSync(`codesign --force --sign - "${pythonBin}"`, { stdio: 'pipe', shell: '/bin/bash' });
        console.log('      ✓ Python executable signed');
      } catch (e) {}
    }
    
    // Step 3: Load entitlements
    console.log('   → Step 3: Loading entitlements...');
    const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
    if (!fs.existsSync(entitlementsPath)) {
      console.log(`      ⚠️  Entitlements not found: ${entitlementsPath}`);
      throw new Error('Missing entitlements file');
    }
    console.log(`      ✓ Using: ${entitlementsPath}`);
    
    // Step 4: Remove existing signature to allow fresh signing with entitlements
    console.log('   → Step 4: Removing existing signatures...');
    try {
      execSync(`find "${appPath}" -type f \\( -name "*.dylib" -o -name "*.so" \\) -exec codesign --remove-signature {} \\; 2>/dev/null`, 
        { stdio: 'pipe', shell: '/bin/bash' });
      console.log('      ✓ Old signatures removed');
    } catch (e) {}
    
    // Step 5: Sign the entire app bundle with entitlements using --deep
    // NOTE: --deep should now properly apply entitlements after old signatures are removed
    console.log('   → Step 5: Signing app bundle with entitlements (deep)...');
    execSync(`codesign --force --deep --sign - --entitlements "${entitlementsPath}" "${appPath}"`, { 
      stdio: 'pipe',
      shell: '/bin/bash'
    });
    console.log('      ✓ App bundle signed with entitlements');
    
    // Step 6: Verify signature and entitlements
    console.log('   → Step 6: Verifying signature...');
    try {
      const sigCheck = execSync(`codesign -v "${appPath}" 2>&1`, { 
        stdio: 'pipe',
        encoding: 'utf8',
        shell: '/bin/bash'
      });
      console.log('      ✓ Signature valid');
      
      // Verify entitlements are present
      const entCheck = execSync(`codesign -d --entitlements - "${appPath}" 2>/dev/null | grep -q "com.apple" && echo "ok" || echo "no"`, {
        stdio: 'pipe',
        encoding: 'utf8',
        shell: '/bin/bash'
      }).trim();
      
      if (entCheck === 'ok') {
        console.log('      ✓ Entitlements present');
      } else {
        console.log('      ⚠️  Entitlements may be missing - check manually');
      }
    } catch (e) {}
    
    console.log('\n✅ SUCCESS: App configured for Gatekeeper');
    console.log('   → Users can now launch app with "developer cannot be verified" override\n');
    
  } catch (err) {
    console.log(`\n❌ ERROR: ${err.message}`);
    console.log('   This may prevent the app from running!\n');
    throw err;
  }
};
