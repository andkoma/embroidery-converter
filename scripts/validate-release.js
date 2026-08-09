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
  // afterSign MUST be global (electron-builder schema requirement)
  check(pkg.build.afterSign === 'scripts/afterSign.js', 
        'afterSign: "scripts/afterSign.js" (on global level)', true);

  // afterSign should NOT be in mac section
  check(!pkg.build.mac?.afterSign, 
        'afterSign is NOT in mac section (global hook with platform check)', true);

  // mac section exists
  check(pkg.build.mac && typeof pkg.build.mac === 'object', 
        'mac section exists', true);

  if (pkg.build.mac) {
    // macOS required settings
    check(pkg.build.mac.hardenedRuntime === true, 
          'hardenedRuntime: true (required for code signing)');
    
    check(pkg.build.mac.signingIdentity === '-', 
          'signingIdentity: "-" (ad-hoc signing enabled)');
    
    check(typeof pkg.build.mac.entitlements === 'string', 
          `entitlements file specified: ${pkg.build.mac.entitlements || 'MISSING'}`);
    
    check(typeof pkg.build.mac.entitlementsInherit === 'string', 
          `entitlementsInherit specified: ${pkg.build.mac.entitlementsInherit || 'MISSING'}`);
  }

  // Windows section exists
  check(pkg.build.win && typeof pkg.build.win === 'object', 
        'win section exists', true);

  // Windows should NOT have macOS-specific properties
  check(!pkg.build.win.hardenedRuntime && !pkg.build.win.signingIdentity, 
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

// afterSign script should check for macOS
if (fs.existsSync(afterSignPath)) {
  const script = fs.readFileSync(afterSignPath, 'utf8');
  check(script.includes('darwin') || script.includes('process.platform'), 
        'afterSign script checks platform (should exit early on non-macOS)', false);
}

// Footer with summary
footer();
