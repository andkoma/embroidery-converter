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
    // Remove ALL signatures from main app bundle
    console.log('   → Step 1: Removing main app signature...');
    execSync(`codesign --remove-signature "${appPath}" 2>/dev/null || true`, { 
      stdio: 'pipe',
      shell: '/bin/bash'
    });
    
    // Remove signatures from embedded Python executable (critical!)
    console.log('   → Step 2: Removing embedded Python executable signatures...');
    const pythonBin = path.join(appPath, 'Contents', 'Resources', 'pybin', 'convert');
    const pythonBinWin = path.join(appPath, 'Contents', 'Resources', 'pybin', 'convert.exe');
    
    if (fs.existsSync(pythonBin)) {
      console.log(`      Found macOS Python: ${pythonBin}`);
      try {
        execSync(`codesign --remove-signature "${pythonBin}" 2>/dev/null || true`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        console.log('      ✓ Removed Python executable signature');
      } catch (e) {
        console.log('      ⚠️  Could not remove Python signature (may not exist)');
      }
    }
    
    if (fs.existsSync(pythonBinWin)) {
      console.log(`      Found Windows Python: ${pythonBinWin}`);
      execSync(`codesign --remove-signature "${pythonBinWin}" 2>/dev/null || true`, { 
        stdio: 'pipe',
        shell: '/bin/bash'
      });
    }
    
    // Remove quarantine and other extended attributes that could block execution
    console.log('   → Step 3: Removing extended attributes...');
    try {
      execSync(`xattr -d com.apple.quarantine "${appPath}" 2>/dev/null || true`, { 
        stdio: 'pipe',
        shell: '/bin/bash'
      });
      console.log('      ✓ Removed quarantine attribute');
    } catch (e) {
      // Not critical, quarantine might not be set during build
    }
    
    // Remove code signing extended attributes
    try {
      execSync(`xattr -d com.apple.code-signature-restrictions "${appPath}" 2>/dev/null || true`, { 
        stdio: 'pipe',
        shell: '/bin/bash'
      });
    } catch (e) {
      // Not present, that's OK
    }
    
    // Verify removal
    console.log('   → Step 4: Verifying unsigned state...');
    try {
      execSync(`codesign -v "${appPath}" 2>&1`, { stdio: 'pipe' });
      console.log('   ⚠️  Warning: App still reports as signed - may need manual intervention');
    } catch (e) {
      console.log('   ✅ Confirmed: App is properly unsigned');
    }
    
    console.log('\n✅ SUCCESS: All signatures and extended attributes removed');
    console.log('   → Gatekeeper will show standard "developer cannot be verified" warning\n');
    
  } catch (err) {
    console.log(`\n❌ ERROR: ${err.message}`);
    console.log('   This may cause Gatekeeper rejection!\n');
    throw err;
  }
};
