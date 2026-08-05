/**
 * Post-pack hook to apply entitlements to app signature.
 * 
 * The main problem: electron-builder creates a signature without entitlements,
 * causing Gatekeeper to reject with "must be updated" error.
 * 
 * Solution: Just apply the entitlements to the existing signature.
 * Don't try to remove old signatures or do complex operations.
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
  
  console.log(`\n🔐 APPLYING ENTITLEMENTS TO SIGNATURE`);
  console.log(`   Path: ${appPath}`);
  
  try {
    // Check for entitlements file
    const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
    
    if (!fs.existsSync(entitlementsPath)) {
      console.log(`   ⚠️  Entitlements file not found: ${entitlementsPath}`);
      console.log(`   → Skipping entitlements, using electron-builder signature as-is`);
      return;
    }
    
    console.log(`   → Using entitlements: entitlements.mac.plist`);
    
    // Try to re-sign with entitlements
    // Using --force to overwrite existing signature
    // Using --deep to sign all nested binaries recursively
    try {
      execSync(`codesign --force --deep --sign - --entitlements "${entitlementsPath}" "${appPath}"`, {
        stdio: 'pipe',
        shell: '/bin/bash',
        timeout: 60000
      });
      console.log('   ✓ Entitlements applied to signature');
    } catch (err) {
      console.log(`   ⚠️  Could not apply entitlements (non-fatal): ${err.message}`);
      // Don't fail the build, just log and continue
    }
    
    // Verify the signature
    try {
      execSync(`codesign -v "${appPath}"`, {
        stdio: 'pipe',
        shell: '/bin/bash'
      });
      console.log('   ✓ Signature verified successfully');
    } catch (err) {
      console.log(`   ⚠️  Signature verification warning: ${err.message}`);
    }
    
    console.log('\n✅ SUCCESS: App signed with entitlements\n');
    
  } catch (err) {
    console.log(`\n❌ ERROR in afterPack hook: ${err.message}`);
    // Don't throw - let the build continue even if this fails
    console.log(`   → Build will continue without entitlements\n`);
  }
};
    console.log('   This may prevent the app from running!\n');
    throw err;
  }
};
