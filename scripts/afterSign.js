const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Sign a single file/bundle with an ad-hoc identity ("-"), non-deep.
 * `--deep` is intentionally NEVER used here: Apple's codesign documentation
 * explicitly warns it is "for testing purposes only" on complex bundles,
 * because it can produce inconsistent signatures on nested code. For a
 * multi-process app like Electron (Frameworks + several Helper.app bundles),
 * a bad --deep signature manifests as the OS being unable to validate/exec
 * a nested helper (e.g. the crashpad_handler or a renderer Helper.app) once
 * the bundle is re-validated from scratch - which happens whenever macOS
 * "translocates" a quarantined app (i.e. launched directly from a mounted
 * DMG instead of /Applications). Symptom: main process starts, dock icon
 * bounces, but no window ever appears because the child process it is
 * waiting on failed to launch.
 *
 * The correct approach (and what electron-builder itself does when given a
 * real identity) is to sign nested code first, then the enclosing bundle.
 */
function signOne(targetPath, entitlementsPath) {
  const cmd = `codesign --force --options=runtime --timestamp=none -s - --entitlements "${entitlementsPath}" "${targetPath}"`;
  execSync(cmd, { stdio: 'inherit' });
}

module.exports = async function(context) {
  // Use the BUILD TARGET platform (context.electronPlatformName), not the host
  // process.platform - they differ when cross-building (e.g. Windows target on a macOS host).
  if (context.electronPlatformName !== 'darwin') {
    console.log(`ℹ️  afterSign: Target platform is ${context.electronPlatformName}, not macOS, skipping`);
    return;
  }

  console.log('🔐 afterSign hook: Signing Electron app (inside-out, no --deep)');

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
    const frameworksDir = path.join(electronApp, 'Contents', 'Frameworks');

    // 1. Sign the bundled PyInstaller Python binary, if present (extraResources/pybin).
    //    It's a plain executable spawned as a subprocess, not exec'd by the OS at
    //    app launch, but signing it individually avoids library-validation issues.
    const resourcesDir = path.join(electronApp, 'Contents', 'Resources');
    const pybinDir = path.join(resourcesDir, 'pybin');
    if (fs.existsSync(pybinDir)) {
      const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(p);
        // Only executables need a signature; skip data files.
        if (entry.name === 'convert' || entry.name === 'convert.exe') {
          console.log(`  • Signing bundled binary: ${path.relative(electronApp, p)}`);
          signOne(p, entitlementsPath);
        }
      });
      walk(pybinDir);
    }

    // 2. Sign nested Frameworks (.framework) and Helper apps (.app) individually,
    //    BEFORE signing the outer bundle (Apple's required inside-out order).
    if (fs.existsSync(frameworksDir)) {
      for (const entry of fs.readdirSync(frameworksDir)) {
        if (entry.endsWith('.framework') || entry.endsWith('.app')) {
          const p = path.join(frameworksDir, entry);
          console.log(`  • Signing nested component: ${entry}`);
          signOne(p, entitlementsPath);
        }
      }
    }

    // 3. Finally, sign the outer app bundle (references the already-signed
    //    nested code via their existing signatures - no --deep needed/wanted).
    console.log('  • Signing outer app bundle...');
    signOne(electronApp, entitlementsPath);
    console.log('  ✓ Ad-hoc signature applied (inside-out)');

    // Verify the signature, including nested code (--deep is safe for verification).
    console.log('  • Verifying signature...');
    execSync(`codesign --verify --deep --strict -v "${electronApp}"`, { stdio: 'inherit' });
    execSync(`codesign -dv "${electronApp}"`, { stdio: 'inherit' });
    console.log('  ✓ Signature verified');
    
    console.log('✅ afterSign hook complete');
    
  } catch (error) {
    console.error(`❌ afterSign failed: ${error.message}`);
    console.error('⚠️  Continuing build - app may not have proper entitlements');
  }
};

