#!/usr/bin/env node

/**
 * Pre-Release Validation Script
 * 
 * Validates package.json configuration before creating a release.
 * Prevents common mistakes that break macOS or Windows builds.
 * 
 * Usage: npm run validate:release
 */

const fs = require('fs');
const path = require('path');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[36m';

let errorCount = 0;
let warningCount = 0;

function check(condition, message, isError = true) {
  if (condition) {
    console.log(`${GREEN}✓${RESET} ${message}`);
  } else {
    if (isError) {
      console.log(`${RED}✗${RESET} ${message}`);
      errorCount++;
    } else {
      console.log(`${YELLOW}⚠${RESET} ${message}`);
      warningCount++;
    }
  }
}

function header(title) {
  console.log(`\n${BLUE}═══ ${title} ═══${RESET}`);
}

function footer() {
  console.log('');
  if (errorCount > 0) {
    console.log(`${RED}❌ Validation failed with ${errorCount} error(s)${RESET}`);
    process.exit(1);
  }
  if (warningCount > 0) {
    console.log(`${YELLOW}⚠️  Validation passed with ${warningCount} warning(s)${RESET}`);
  } else {
    console.log(`${GREEN}✅ All checks passed! Ready for release.${RESET}`);
  }
}

// Load package.json
const pkgPath = path.join(__dirname, '../package.json');
let pkg = {};
try {
  const content = fs.readFileSync(pkgPath, 'utf8');
  pkg = JSON.parse(content);
} catch (e) {
  console.error(`${RED}✗ Failed to read package.json: ${e.message}${RESET}`);
  process.exit(1);
}

// ===== CHECKS =====

header('📦 Package.json Configuration');

// Version check
check(pkg.version && /^\d+\.\d+\.\d+$/.test(pkg.version), 
      `Version format: ${pkg.version || 'MISSING'}`);

// Build config exists
check(pkg.build && typeof pkg.build === 'object', 
      'Build configuration exists');

if (pkg.build) {
  // afterSign MUST be on global level (electron-builder hook, applies to all platforms;
  // the script itself checks process.platform and skips on non-macOS)
  check(pkg.build.afterSign === 'scripts/afterSign.js', 
        'afterSign: "scripts/afterSign.js" (on global level - not a mac-only schema property)', true);

  check(!pkg.build.mac?.afterSign, 
        'afterSign is NOT inside mac section (invalid schema property there)', true);

  // mac section exists
  check(pkg.build.mac && typeof pkg.build.mac === 'object', 
        'mac section exists', true);

  if (pkg.build.mac) {
    // macOS required settings
    check(pkg.build.mac.hardenedRuntime === true, 
          'hardenedRuntime: true (required for code signing)');

    // "signingIdentity" is NOT a valid mac schema property - the correct name is "identity".
    // Ad-hoc signing is performed manually in afterSign.js via `codesign -s -`,
    // so identity must be null to stop electron-builder from attempting its own signing.
    check(!pkg.build.mac.hasOwnProperty('signingIdentity'), 
          'mac section does NOT use invalid property "signingIdentity" (use "identity" instead)', true);

    check(pkg.build.mac.identity === null, 
          'identity: null (disables electron-builder auto-signing; afterSign.js does ad-hoc signing manually)');
    
    check(typeof pkg.build.mac.entitlements === 'string', 
          `entitlements file specified: ${pkg.build.mac.entitlements || 'MISSING'}`);
    
    check(typeof pkg.build.mac.entitlementsInherit === 'string', 
          `entitlementsInherit specified: ${pkg.build.mac.entitlementsInherit || 'MISSING'}`);
  }

  // Windows section exists
  check(pkg.build.win && typeof pkg.build.win === 'object', 
        'win section exists', true);

  // Windows should NOT have macOS-specific properties
  check(!pkg.build.win.hardenedRuntime && !pkg.build.win.signingIdentity && !pkg.build.win.identity, 
        'Windows section has no macOS-specific properties');
}

header('🔐 File Resources');

// Entitlements file
const entitlePath = path.join(__dirname, '../build/entitlements.mac.plist');
check(fs.existsSync(entitlePath), 
      `Entitlements file exists: build/entitlements.mac.plist`);

// afterSign script
const afterSignPath = path.join(__dirname, '../scripts/afterSign.js');
check(fs.existsSync(afterSignPath), 
      `afterSign script exists: scripts/afterSign.js`);

// Check entitlements content
if (fs.existsSync(entitlePath)) {
  const content = fs.readFileSync(entitlePath, 'utf8');
  check(content.includes('com.apple.security.cs.allow-jit'), 
        'Entitlements contains allow-jit', false);
  check(content.includes('com.apple.security.cs.disable-library-validation'), 
        'Entitlements contains disable-library-validation', false);
}

header('🔗 Dependencies');

// Check Node version
const nodeVersion = require('child_process').spawnSync('node', ['--version']).stdout.toString().trim();
check(nodeVersion, `Node.js version: ${nodeVersion}`);

// electron-builder should be installed
try {
  require.resolve('electron-builder');
  check(true, 'electron-builder is installed');
} catch (_) {
  check(false, 'electron-builder is NOT installed (run: npm install)', true);
}



header('🔍 Code Quality');

// afterSign script should check the BUILD TARGET platform, not process.platform
// (process.platform is the host OS, which differs from the target when cross-building,
// e.g. building a Windows artifact on a macOS host)
if (fs.existsSync(afterSignPath)) {
  const script = fs.readFileSync(afterSignPath, 'utf8');
  check(script.includes('electronPlatformName'), 
        'afterSign script checks context.electronPlatformName (target), not process.platform (host)', true);
}

header('🧪 electron-builder Schema Validation');

// Run the SAME schema validation electron-builder itself runs before a build.
// This is the authoritative check: it catches unknown/misplaced properties
// (e.g. "signingIdentity" instead of "identity", or hooks in the wrong section)
// regardless of which platform triggered the build, since electron-builder
// validates the ENTIRE config object even for single-platform builds.
(async () => {
  try {
    const { validateConfig } = require('app-builder-lib/out/util/config');
    await validateConfig(pkg.build || {}, () => ({ error: () => {} }));
    check(true, 'electron-builder accepts the "build" config (matches API schema)');
  } catch (e) {
    check(false, `electron-builder REJECTS the "build" config:\n${e.message}`, true);
  }
  footer();
})();
