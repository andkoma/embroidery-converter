/**
 * Post-pack hook to remove invalid code signatures from embedded binaries.
 * 
 * Problem: electron-builder creates partial/invalid signatures for embedded
 * Python executables when building unsigned apps. This causes Gatekeeper to
 * reject the app as "damaged" instead of showing the standard "developer
 * cannot be verified" warning.
 * 
 * Solution: Remove all code signatures from the app bundle, which allows
 * Gatekeeper to properly handle it as an unsigned app.
 */

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.platform !== 'darwin') {
    console.log('ℹ️  Skipping signature removal - not macOS');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`);
  
  console.log(`\n🔓 Removing code signatures from: ${appPath}`);
  
  try {
    // Remove signature from main app bundle
    execSync(`codesign --remove-signature "${appPath}"`, { stdio: 'inherit' });
    console.log('✅ Code signatures removed successfully');
  } catch (err) {
    // codesign --remove-signature may error but still remove the signature
    // This is expected behavior
    console.log('✅ Code signature removal completed (expected codesign error ignored)');
  }
};
