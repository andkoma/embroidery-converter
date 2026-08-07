/**
 * Diagnostic System für Embroidery Converter
 * Sammelt System-Info, Backend-Status, Architektur-Details
 * für bessere Fehleranalyse bei x64 und anderen Problemen
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

/**
 * Sammle alle System-Informationen
 */
function getSystemInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    memory: {
      total: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
      free: Math.round(os.freemem() / 1024 / 1024) + ' MB'
    },
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    v8Version: process.versions.v8,
    timestamp: new Date().toISOString()
  };
}

/**
 * Sammle Python-Backend Informationen
 */
function getPythonInfo() {
  const info = {
    available: false,
    version: null,
    path: null,
    pyembroidery: null,
    errors: []
  };
  
  try {
    // Versuche Python zu finden
    const pythonCmd = process.platform === 'win32' ? 'where python3' : 'which python3';
    const result = execSync(pythonCmd, { encoding: 'utf8' }).trim();
    info.path = result;
    
    // Version
    try {
      info.version = execSync('python3 --version', { encoding: 'utf8' }).trim();
    } catch (e) {
      info.errors.push('Could not get Python version');
    }
    
    // Check pyembroidery
    try {
      execSync('python3 -c "import pyembroidery; print(pyembroidery.__version__)"', { encoding: 'utf8' });
      info.pyembroidery = 'installed';
    } catch (e) {
      info.errors.push('pyembroidery not found or not working');
    }
    
    info.available = true;
  } catch (e) {
    info.errors.push('Python not found in PATH');
  }
  
  return info;
}

/**
 * Prüfe Bundled Binary Verfügbarkeit
 */
function checkBundledBinary(resourcesPath) {
  const checks = {
    path: null,
    exists: false,
    executable: false,
    fileSize: null,
    errors: []
  };
  
  try {
    const exe = process.platform === 'win32' ? 'convert.exe' : 'convert';
    const candidate = path.join(resourcesPath, 'pybin', exe);
    
    checks.path = candidate;
    
    if (fs.existsSync(candidate)) {
      checks.exists = true;
      
      // Check file size
      const stat = fs.statSync(candidate);
      checks.fileSize = Math.round(stat.size / 1024 / 1024) + ' MB';
      
      // Check if executable (on Unix)
      if (process.platform !== 'win32') {
        checks.executable = (stat.mode & 0o111) !== 0;
      } else {
        checks.executable = true; // Assume Windows exe is executable
      }
    } else {
      checks.errors.push(`Binary not found at ${candidate}`);
    }
  } catch (e) {
    checks.errors.push(`Error checking binary: ${e.message}`);
  }
  
  return checks;
}

/**
 * Check macOS Gatekeeper status
 */
function checkGatekeeperStatus() {
  if (process.platform !== 'darwin') {
    return null; // Not applicable
  }
  
  const status = {
    quarantineAttributes: [],
    codeSignature: null,
    errors: []
  };
  
  try {
    // Check für Electron.app Quarantine-Attribute
    try {
      const result = execSync(
        'xattr node_modules/electron/dist/Electron.app 2>/dev/null || echo "none"',
        { encoding: 'utf8' }
      ).trim();
      status.quarantineAttributes = result === 'none' ? [] : result.split('\n');
    } catch (e) {
      status.errors.push('Could not check quarantine attributes');
    }
    
    // Check Code Signature
    try {
      const result = execSync(
        'codesign -v node_modules/electron/dist/Electron.app 2>&1 || echo "unsigned"',
        { encoding: 'utf8' }
      ).trim();
      status.codeSignature = result;
    } catch (e) {
      status.errors.push('Could not check code signature');
    }
  } catch (e) {
    status.errors.push(`Gatekeeper check failed: ${e.message}`);
  }
  
  return status;
}

/**
 * Sammle alle Diagn-Infos in einem Report
 */
function generateDiagnosticReport(backendInfo, resourcesPath) {
  const report = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'unknown',
    isDev: !require('electron').app.isPackaged,
    system: getSystemInfo(),
    python: getPythonInfo(),
    bundledBinary: checkBundledBinary(resourcesPath),
    backend: backendInfo || null,
    gatekeeper: checkGatekeeperStatus(),
    issues: []
  };
  
  // Analysiere & flag Probleme
  if (!report.python.available && !report.bundledBinary.exists) {
    report.issues.push({
      severity: 'CRITICAL',
      title: 'No backend available',
      description: 'Neither Python nor bundled binary found',
      solution: 'Install Python 3 or build bundled binary with: npm run python:bundle'
    });
  }
  
  if (report.system.arch === 'x64' && !report.bundledBinary.exists) {
    report.issues.push({
      severity: 'WARNING',
      title: 'x64 backend mismatch',
      description: 'Running on x64 but no bundled binary available',
      solution: 'Build x64 binary or use system Python'
    });
  }
  
  if (report.gatekeeper && report.gatekeeper.quarantineAttributes.includes('com.apple.quarantine')) {
    report.issues.push({
      severity: 'WARNING',
      title: 'Gatekeeper block detected',
      description: 'Electron has quarantine attributes set',
      solution: 'Run: npm install (postinstall hook fixes this)'
    });
  }
  
  if (!report.python.available) {
    report.issues.push({
      severity: 'ERROR',
      title: 'Python not available',
      description: 'Python 3 not found in system PATH',
      solution: 'Install Python 3 from python.org or via Homebrew'
    });
  }
  
  return report;
}

/**
 * Formatiere Diagnostic Report als lesbar Text
 */
function formatReportAsText(report) {
  let text = '';
  
  text += '═══════════════════════════════════════════════════════\n';
  text += '  EMBROIDERY CONVERTER - DIAGNOSTIC REPORT\n';
  text += '═══════════════════════════════════════════════════════\n\n';
  
  text += `Generated: ${report.timestamp}\n`;
  text += `Environment: ${report.environment} (isDev: ${report.isDev})\n\n`;
  
  // System Info
  text += '📊 SYSTEM INFORMATION\n';
  text += '─────────────────────────────────────────────────────\n';
  text += `Platform: ${report.system.platform} (${report.system.arch})\n`;
  text += `CPUs: ${report.system.cpus}\n`;
  text += `Memory: ${report.system.memory.total} (Free: ${report.system.memory.free})\n`;
  text += `Node: ${report.system.nodeVersion}\n`;
  text += `Electron: ${report.system.electronVersion}\n\n`;
  
  // Python Info
  text += '🐍 PYTHON BACKEND\n';
  text += '─────────────────────────────────────────────────────\n';
  text += `Available: ${report.python.available ? '✓' : '✗'}\n`;
  if (report.python.path) text += `Path: ${report.python.path}\n`;
  if (report.python.version) text += `Version: ${report.python.version}\n`;
  text += `pyembroidery: ${report.python.pyembroidery || 'not found'}\n`;
  if (report.python.errors.length > 0) {
    text += `Errors:\n`;
    report.python.errors.forEach(e => text += `  • ${e}\n`);
  }
  text += '\n';
  
  // Bundled Binary
  text += '📦 BUNDLED BINARY\n';
  text += '─────────────────────────────────────────────────────\n';
  text += `Path: ${report.bundledBinary.path}\n`;
  text += `Exists: ${report.bundledBinary.exists ? '✓' : '✗'}\n`;
  if (report.bundledBinary.fileSize) text += `Size: ${report.bundledBinary.fileSize}\n`;
  if (report.bundledBinary.executable !== null) {
    text += `Executable: ${report.bundledBinary.executable ? '✓' : '✗'}\n`;
  }
  if (report.bundledBinary.errors.length > 0) {
    text += `Errors:\n`;
    report.bundledBinary.errors.forEach(e => text += `  • ${e}\n`);
  }
  text += '\n';
  
  // Gatekeeper (macOS only)
  if (report.gatekeeper) {
    text += '🔐 GATEKEEPER (macOS)\n';
    text += '─────────────────────────────────────────────────────\n';
    if (report.gatekeeper.quarantineAttributes.length > 0) {
      text += `Quarantine: ${report.gatekeeper.quarantineAttributes.join(', ')}\n`;
    } else {
      text += `Quarantine: None (✓)\n`;
    }
    text += `Signature: ${report.gatekeeper.codeSignature || 'unknown'}\n`;
    if (report.gatekeeper.errors.length > 0) {
      text += `Errors:\n`;
      report.gatekeeper.errors.forEach(e => text += `  • ${e}\n`);
    }
    text += '\n';
  }
  
  // Issues
  if (report.issues.length > 0) {
    text += '⚠️  DETECTED ISSUES\n';
    text += '─────────────────────────────────────────────────────\n';
    report.issues.forEach((issue, i) => {
      const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'ERROR' ? '🟠' : '🟡';
      text += `${i + 1}. ${icon} [${issue.severity}] ${issue.title}\n`;
      text += `   ${issue.description}\n`;
      text += `   💡 ${issue.solution}\n\n`;
    });
  } else {
    text += '✅ NO ISSUES DETECTED\n\n';
  }
  
  text += '═══════════════════════════════════════════════════════\n';
  
  return text;
}

module.exports = {
  getSystemInfo,
  getPythonInfo,
  checkBundledBinary,
  checkGatekeeperStatus,
  generateDiagnosticReport,
  formatReportAsText
};
