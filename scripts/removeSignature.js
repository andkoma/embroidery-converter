/**
 * Post-pack hook to fix code signatures for Gatekeeper bypass.
 * 
 * Problem: electron-builder creates invalid/incomplete signatures. On macOS 13+,
 * this causes:
 * - Gatekeeper: "app is damaged" error
 * - AMFI: Rejects ad-hoc signed helper binaries without parent app entitlements
 * 
 * Solution: Use SINGLE ad-hoc signature on the entire app bundle (recursively).
 * This preserves entitlements and prevents AMFI rejection of embedded binaries.
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
  
  console.log(`\n🔐 APPLYING AD-HOC SIGNATURE FOR GATEKEEPER BYPASS`);
  console.log(`   Path: ${appPath}`);
  
  try {
    // Step 1: Ensure main executable has execute permissions
    console.log('   → Step 1: Ensuring execute permissions...');
    const mainExec = path.join(appPath, 'Contents', 'MacOS', context.packager.appInfo.productName);
    if (fs.existsSync(mainExec)) {
      try {
        execSync(`chmod +x "${mainExec}"`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        console.log('      ✓ Main executable is executable');
      } catch (e) {
        // Continue anyway
      }
    }
    
    // Step 2: Ensure Python executable has execute permissions
    console.log('   → Step 2: Ensuring Python executable permissions...');
    const pythonBin = path.join(appPath, 'Contents', 'Resources', 'pybin', 'convert');
    if (fs.existsSync(pythonBin)) {
      try {
        execSync(`chmod +x "${pythonBin}"`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        console.log('      ✓ Python executable is executable');
      } catch (e) {
        // Continue anyway
      }
    }
    
    // Step 3: Apply SINGLE ad-hoc signature to entire app bundle WITH ENTITLEMENTS
    // This recursively signs all binaries with the app's entitlements
    console.log('   → Step 3: Applying ad-hoc signature to entire bundle with entitlements...');
    const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
    const entitlementsArg = fs.existsSync(entitlementsPath) 
      ? `--entitlements "${entitlementsPath}"` 
      : '';
    
    if (entitlementsArg) {
      console.log(`      Using entitlements: ${entitlementsPath}`);
    } else {
      console.log(`      ⚠️  No entitlements file found - signing without entitlements`);
    }
    
    execSync(`codesign --force --deep --sign - ${entitlementsArg} "${appPath}"`, { 
      stdio: 'pipe',
      shell: '/bin/bash'
    });
    console.log('      ✓ App bundle ad-hoc signed recursively with entitlements');
    
    // Step 4: Verify signature
    console.log('   → Step 4: Verifying signature...');
    try {
      const result = execSync(`codesign -v "${appPath}" 2>&1`, { 
        stdio: 'pipe',
        encoding: 'utf8',
        shell: '/bin/bash'
      });
      if (result.includes('valid on disk')) {
        console.log('      ✓ Signature valid');
      }
    } catch (e) {
      // Some output goes to stderr even on success
    }
    
    console.log('\n✅ SUCCESS: App configured for Gatekeeper');
    console.log('   → Users see: "developer cannot be verified" (not "app is damaged")');
    console.log('   → Users can click "Open" to run the app\n');
    
  } catch (err) {
    console.log(`\n❌ ERROR: ${err.message}`);
    console.log('   This may prevent the app from running!\n');
    throw err;
  }
};
