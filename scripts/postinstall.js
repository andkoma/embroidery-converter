#!/usr/bin/env node

/**
 * Post-Install Hook für macOS Entwicklung
 * Repariert Gatekeeper-Blocks auf Electron nach npm install
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLATFORM = process.platform;

if (PLATFORM !== 'darwin') {
  console.log('ℹ️  Post-install: Nicht macOS, übersprungen');
  process.exit(0);
}

const ELECTRON_PATH = path.join(__dirname, '../node_modules/electron/dist/Electron.app');

if (!fs.existsSync(ELECTRON_PATH)) {
  console.log('ℹ️  Post-install: Electron nicht gefunden, übersprungen');
  process.exit(0);
}

console.log('🔧 Post-Install: Repariere Gatekeeper-Blocks...');

try {
  // Entferne ALL extended attributes (including quarantine)
  execSync(`find "${ELECTRON_PATH}" -type f -exec xattr -c {} \\; 2>/dev/null || true`, {
    stdio: 'pipe'
  });
  
  // Versuche ad-hoc signieren
  const ENTITLEMENTS = path.join(__dirname, '../build/entitlements.mac.plist');
  if (fs.existsSync(ENTITLEMENTS)) {
    try {
      execSync(`codesign --force --deep -s - --entitlements "${ENTITLEMENTS}" "${ELECTRON_PATH}" 2>/dev/null`, {
        stdio: 'pipe'
      });
    } catch (_) {
      // Signieren kann fehlschlagen, ist aber nicht kritisch
    }
  }
  
  console.log('✅ Post-Install: Electron ist bereit für lokale Entwicklung');
  console.log('💡 Starte die App mit: npm start');
} catch (err) {
  console.error('⚠️  Post-Install Fehler:', err.message);
  console.error('💡 Versuche manuell: xattr -c node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
}
