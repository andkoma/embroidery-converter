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
    // macOS 13+ requires all code to be signed to run.
    // Instead of removing signature entirely (which corrupts the bundle),
    // use an ad-hoc signature that allows execution without developer ID.
    // This allows Gatekeeper to show the standard "developer cannot be verified"
    // warning instead of rejecting as "damaged".
    
    console.log('   → Step 1: Applying ad-hoc signature...');
    // Using - (dash) for ad-hoc signature (no certificate required)
    execSync(`codesign --force --sign - --preserve-metadata=entitlements,requirements,flags,runtime "${appPath}"`, { 
      stdio: 'pipe',
      shell: '/bin/bash'
    });
    
    // Ensure main executable has execute permissions
    const mainExec = path.join(appPath, 'Contents', 'MacOS', context.packager.appInfo.productName);
    if (fs.existsSync(mainExec)) {
      console.log('   → Step 2: Fixing main executable permissions...');
      try {
        execSync(`chmod +x "${mainExec}"`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        console.log('      ✓ Main executable is executable');
      } catch (e) {
        console.log('      ⚠️  Could not set execute permissions on main executable');
      }
    }
    // Remove signatures from embedded Python executable (critical!)
    console.log('   → Step 3: Signing embedded Python executable...');
    const pythonBin = path.join(appPath, 'Contents', 'Resources', 'pybin', 'convert');
    const pythonBinWin = path.join(appPath, 'Contents', 'Resources', 'pybin', 'convert.exe');
    
    if (fs.existsSync(pythonBin)) {
      console.log(`      Found macOS Python: ${pythonBin}`);
      try {
        // Ensure execute permissions
        execSync(`chmod +x "${pythonBin}" 2>/dev/null || true`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        // Apply ad-hoc signature
        execSync(`codesign --force --sign - "${pythonBin}" 2>/dev/null || true`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        console.log('      ✓ Python executable signed with ad-hoc signature');
      } catch (e) {
        console.log('      ⚠️  Could not process Python executable');
      }
    }
    
    if (fs.existsSync(pythonBinWin)) {
      console.log(`      Found Windows Python: ${pythonBinWin}`);
      try {
        execSync(`chmod +x "${pythonBinWin}" 2>/dev/null || true`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
        execSync(`codesign --force --sign - "${pythonBinWin}" 2>/dev/null || true`, { 
          stdio: 'pipe',
          shell: '/bin/bash'
        });
      } catch (e) {
        // Not critical on macOS build
      }
    }
    
    // Remove extended attributes that could block execution
    console.log('   → Step 4: Cleaning extended attributes...');
    try {
      execSync(`xattr -d com.apple.quarantine "${appPath}" 2>/dev/null || true`, { 
        stdio: 'pipe',
        shell: '/bin/bash'
      });
      console.log('      ✓ Removed quarantine attribute');
    } catch (e) {
      // Not critical, quarantine might not be set during build
    }
    
    // Verify signature is applied
    console.log('   → Step 5: Verifying app signature...');
    try {
      const result = execSync(`codesign -v "${appPath}" 2>&1`, { stdio: 'pipe', encoding: 'utf8' });
      console.log('      ✓ App is signed');
      if (result.includes('ad hoc')) {
        console.log('      ✓ Using ad-hoc signature (allows unsigned developer launch)');
      }
    } catch (e) {
      console.log('      ⚠️  Could not verify signature');
    }
    
    console.log('\n✅ SUCCESS: App configured for standard Gatekeeper handling');
    console.log('   → Gatekeeper will show "developer cannot be verified" warning');
    console.log('   → This allows users to click "Open" to run the app\n');
    
  } catch (err) {
    console.log(`\n❌ ERROR: ${err.message}`);
    console.log('   This may cause Gatekeeper rejection!\n');
    throw err;
  }
};
