#!/usr/bin/env node

/**
 * Post-Install Hook für macOS Entwicklung
 * Repariert Gatekeeper-Blocks auf Electron und bundled Python Binary nach npm install
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
const PYBIN_DIR = path.join(__dirname, '../pybuild/dist');

if (!fs.existsSync(ELECTRON_PATH) && !fs.existsSync(PYBIN_DIR)) {
  console.log('ℹ️  Post-install: Electron und PyBin nicht gefunden, übersprungen');
  process.exit(0);
}

console.log('🔧 Post-Install: Repariere Gatekeeper-Blocks...');

try {
  // ===== Entferne xattr und signiere Electron =====
  if (fs.existsSync(ELECTRON_PATH)) {
    console.log('  • Verarbeite Electron.app...');
    try {
      execSync(`find "${ELECTRON_PATH}" -type f -exec xattr -c {} \\; 2>/dev/null || true`, {
        stdio: 'pipe'
      });
      console.log('    ✓ Extended attributes entfernt');
    } catch (_) {}
    
    // Versuche ad-hoc signieren
    const ENTITLEMENTS = path.join(__dirname, '../build/entitlements.mac.plist');
    if (fs.existsSync(ENTITLEMENTS)) {
      try {
        execSync(`codesign --force --deep -s - --entitlements "${ENTITLEMENTS}" "${ELECTRON_PATH}" 2>/dev/null`, {
          stdio: 'pipe'
        });
        console.log('    ✓ Ad-hoc Signatur angewendet');
      } catch (_) {
        // Signieren kann fehlschlagen, ist aber nicht kritisch
      }
    }
  }
  
  // ===== Repariere bundled Python Binary (falls vorhanden) =====
  if (fs.existsSync(PYBIN_DIR)) {
    console.log('  • Verarbeite Python Binaries...');
    try {
      // Rekursiv alle Binaries reparieren (arm64/convert, x64/convert, etc.)
      const binaries = [];
      
      const scanDir = (dir) => {
        try {
          const entries = fs.readdirSync(dir);
          entries.forEach(entry => {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isFile()) {
              binaries.push(full);
            } else if (stat.isDirectory()) {
              scanDir(full);
            }
          });
        } catch (_) {}
      };
      
      scanDir(PYBIN_DIR);
      
      if (binaries.length > 0) {
        binaries.forEach(bin => {
          try {
            // Entferne Quarantine-Attribute
            execSync(`xattr -c "${bin}" 2>/dev/null || true`, { stdio: 'pipe' });
            
            // Stelle sicher dass Binary ausführbar ist
            execSync(`chmod +x "${bin}" 2>/dev/null || true`, { stdio: 'pipe' });
            
            // Ad-hoc signieren
            const ENTITLEMENTS = path.join(__dirname, '../build/entitlements.mac.plist');
            if (fs.existsSync(ENTITLEMENTS)) {
              execSync(`codesign --force -s - "${bin}" 2>/dev/null || true`, {
                stdio: 'pipe'
              });
            }
            
            const basename = path.basename(bin);
            console.log(`    ✓ ${basename} repariert`);
          } catch (_) {}
        });
      }
    } catch (err) {
      console.warn('    ⚠️  Python Binaries reparieren fehlgeschlagen:', err.message);
    }
  }
  
  console.log('✅ Post-Install: Entwicklungsumgebung ist bereit');
  console.log('💡 Starte die App mit: npm start');
} catch (err) {
  console.error('⚠️  Post-Install Fehler:', err.message);
  console.error('💡 Versuche manuell:');
  console.error('   xattr -c node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  console.error('   chmod +x pybuild/dist/*/convert');
}
