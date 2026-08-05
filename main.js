/**
 * Embroidery Converter - Electron Main Process
 * Copyright © 2024 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const isDev = process.argv.includes('--dev') || !app.isPackaged;

let mainWindow = null;

/* ------------------------------------------------------------------ *
 *  Python / backend resolution
 *
 *  In development we call the system Python with scripts/convert.py.
 *  In a packaged build we prefer a PyInstaller bundle (pybin/convert)
 *  so no Python install is required on the user's machine.
 * ------------------------------------------------------------------ */

function resourcePath(...p) {
  // In packaged app, extraResources live in process.resourcesPath.
  const base = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname);
  return path.join(base, ...p);
}

function findBundledBinary() {
  const exe = process.platform === 'win32' ? 'convert.exe' : 'convert';
  const candidate = resourcePath('pybin', exe);
  return fs.existsSync(candidate) ? candidate : null;
}

// Cache the resolved interpreter so we do not probe the filesystem repeatedly.
let _cachedPython = undefined; // undefined = not searched yet, null = not found

/**
 * Verify that a given command/path is a working Python 3 interpreter.
 * Returns true only when `--version` reports Python 3.x.
 */
function isWorkingPython(cmd) {
  try {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf8', windowsHide: true });
    const out = ((res.stdout || '') + (res.stderr || '')).trim();
    return /python\s+3\./i.test(out);
  } catch (_) {
    return false;
  }
}

/**
 * Build the list of candidate interpreters to probe. We include BOTH bare
 * command names (resolved via PATH) AND absolute paths at the well-known
 * install locations, because a GUI-launched app on macOS/Windows often does
 * NOT inherit the user's shell PATH (this is the usual cause of a backend
 * that works from a terminal but fails when double-clicked).
 */
function pythonCandidates() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'win32') {
    const list = ['py', 'python', 'python3', 'python.exe', 'python3.exe'];
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
      'C:\\Program Files\\Python312', 'C:\\Program Files\\Python311',
      'C:\\Program Files\\Python310', 'C:\\Program Files\\Python39',
      'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
    ].filter(Boolean);
    for (const r of roots) {
      // LocalAppData Programs/Python contains PythonXY subfolders
      list.push(path.join(r, 'python.exe'));
      for (const v of ['312', '311', '310', '39']) {
        list.push(path.join(r, 'Python' + v, 'python.exe'));
      }
    }
    return list;
  }
  // macOS + Linux
  const list = ['python3', 'python'];
  const abs = [
    '/usr/bin/python3',
    '/usr/local/bin/python3',
    '/opt/homebrew/bin/python3',            // Apple-silicon Homebrew
    '/opt/local/bin/python3',               // MacPorts
    '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  ];
  // python.org framework installs (versioned)
  for (const v of ['3.12', '3.11', '3.10', '3.9']) {
    abs.push('/Library/Frameworks/Python.framework/Versions/' + v + '/bin/python3');
    abs.push('/usr/local/bin/python' + v);
    abs.push('/opt/homebrew/bin/python' + v);
  }
  if (home) {
    abs.push(path.join(home, '.pyenv', 'shims', 'python3'));
    abs.push(path.join(home, 'anaconda3', 'bin', 'python3'));
    abs.push(path.join(home, 'miniconda3', 'bin', 'python3'));
  }
  return list.concat(abs);
}

function findSystemPython() {
  if (_cachedPython !== undefined) return _cachedPython;
  for (const c of pythonCandidates()) {
    // For absolute paths, make sure the file exists before spawning.
    if (path.isAbsolute(c) && !fs.existsSync(c)) continue;
    if (isWorkingPython(c)) {
      _cachedPython = c;
      return c;
    }
  }
  _cachedPython = null;
  return null;
}

/**
 * Returns { command, baseArgs } describing how to invoke the backend.
 * Bundled binary:   command=<binary>,          baseArgs=[]
 * System python:    command=<python>,          baseArgs=[convert.py]
 */
function resolveBackend() {
  const bundled = findBundledBinary();
  if (bundled) {
    return { command: bundled, baseArgs: [], mode: 'bundled' };
  }
  const py = findSystemPython();
  const script = resourcePath('scripts', 'convert.py');
  if (py && fs.existsSync(script)) {
    return { command: py, baseArgs: [script], mode: 'system-python' };
  }
  return null;
}

/**
 * Run the backend with a sub-command + JSON payload, resolve parsed JSON.
 */
function runBackend(subcommand, payload) {
  return new Promise((resolve) => {
    const backend = resolveBackend();
    if (!backend) {
      resolve({
        success: false,
        error:
          'No Python backend found. Install Python 3 and `pip install pyembroidery`, ' +
          'or build the bundled binary (npm run python:bundle).',
        warnings: [],
      });
      return;
    }

    const args = [...backend.baseArgs, subcommand, JSON.stringify(payload || {})];
    let stdout = '';
    let stderr = '';

    let child;
    try {
      child = spawn(backend.command, args, { windowsHide: true });
    } catch (e) {
      resolve({ success: false, error: 'Failed to start backend: ' + e.message, warnings: [] });
      return;
    }

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (e) => {
      resolve({ success: false, error: 'Backend error: ' + e.message, warnings: [] });
    });

    child.on('close', (code) => {
      const trimmed = (stdout || '').trim();
      if (!trimmed) {
        resolve({
          success: false,
          error:
            'Backend produced no output (exit ' + code + ').' +
            (stderr ? ' ' + stderr.trim() : ''),
          warnings: [],
        });
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (e) {
        resolve({
          success: false,
          error: 'Could not parse backend output: ' + e.message + '\n' + trimmed,
          warnings: [],
        });
      }
    });
  });
}

/* ------------------------------------------------------------------ *
 *  Settings service
 *
 *  Persists application settings as JSON in the platform's userData dir.
 *  Settings are read on first access and written on every mutation.
 *  The IPC handlers (settings:get / settings:set) below let the renderer
 *  sync to and from this file.
 * ------------------------------------------------------------------ */

const SETTINGS_DEFAULTS = {
  language: 'en',
  theme: 'light',
  managedFolders: [],          // { id, path, recursive, watch }[]
  recentOutputDirs: [],        // string[] — last used output dirs
  gallery: {
    typeFilter: ['pes','dst','jef','vp3','hus','xxx','exp','sew'],
    sort: 'name',
    thumbSize: 128,
  },
  transfer: {
    favoriteDestinations: [],  // { label, path }[]
  },
};

let _settingsCache = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  if (_settingsCache) return _settingsCache;
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    // Deep-merge with defaults so new keys added in future releases are
    // automatically present without requiring migration logic.
    _settingsCache = deepMerge(SETTINGS_DEFAULTS, JSON.parse(raw));
  } catch (_) {
    // File doesn't exist yet or is corrupt — start fresh.
    _settingsCache = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
  }
  return _settingsCache;
}

function saveSettings(settings) {
  _settingsCache = settings;
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e.message);
  }
}

/** Shallow+deep merge: new keys from source fill gaps in target. */
function deepMerge(defaults, overrides) {
  const result = Object.assign({}, defaults);
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(defaults[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

/** Add a dir to the recent-output-dirs list (capped at 10, most-recent first). */
function recordRecentOutputDir(dir) {
  const s = loadSettings();
  const recent = [dir, ...(s.recentOutputDirs || []).filter(d => d !== dir)].slice(0, 10);
  saveSettings({ ...s, recentOutputDirs: recent });
}

/* ------------------------------------------------------------------ *
 *  Window
 * ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#f4f6fb',
    title: 'Embroidery Converter',
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ *
 *  IPC handlers
 * ------------------------------------------------------------------ */

ipcMain.handle('backend:status', async () => {
  try {
    const backend = resolveBackend();
    if (!backend) {
      // No bundled binary AND no Python interpreter found on the machine.
      const scriptOk = fs.existsSync(resourcePath('scripts', 'convert.py'));
      return {
        available: false,
        mode: null,
        pythonFound: false,
        reason: 'no-python',
        error: !scriptOk
          ? 'Conversion engine files are missing from the installation.'
          : 'Python 3 could not be found on this computer. Install Python 3 ' +
            '(python.org) and reopen the app — the bundled conversion engine ' +
            'needs a Python 3 runtime.',
      };
    }
    // A backend was resolved; confirm the engine actually runs (imports the
    // bundled pyembroidery and returns the format list).
    const res = await runBackend('formats', {});
    return {
      available: !!res.success,
      mode: backend.mode,
      pythonFound: backend.mode !== 'bundled',
      command: backend.command,
      reason: res.success ? null : 'engine-error',
      error: res.success ? null : (res.error || 'The conversion engine failed to start.'),
    };
  } catch (e) {
    // Never let this throw — the renderer treats a thrown status as a hard
    // "Backend error", which is unhelpful. Return a structured failure.
    return {
      available: false,
      mode: null,
      pythonFound: false,
      reason: 'exception',
      error: 'Unexpected backend error: ' + (e && e.message ? e.message : String(e)),
    };
  }
});

ipcMain.handle('backend:formats', async () => {
  return runBackend('formats', {});
});

ipcMain.handle('backend:inspect', async (_e, inputPath) => {
  return runBackend('inspect', { input_path: inputPath });
});

ipcMain.handle('backend:convert', async (_e, payload) => {
  return runBackend('convert', payload);
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select embroidery files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Embroidery files',
        extensions: [
          'dst', 'pes', 'pec', 'jef', 'vp3', 'hus', 'xxx', 'exp', 'sew',
          'emb', 'u01', 'tap', 'phb', 'phc', 'bro', 'dat', 'dsb', 'dsz',
          'emd', '10o', '100', 'shv', 'jpx', 'ksm', 'max', 'tbf', 'gt',
          'inb', 'zxy', 'stx', 'csv', 'json', 'gcode',
        ],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:selectOutputDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:defaultDir', async () => {
  return app.getPath('documents') || app.getPath('home');
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  return shell.openPath(p);
});

ipcMain.handle('shell:showItem', async (_e, p) => {
  shell.showItemInFolder(p);
  return true;
});

/* ------------------------------------------------------------------ *
 *  Settings IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('settings:get', async () => {
  return loadSettings();
});

/**
 * Patch-merge incoming updates into the stored settings and persist.
 * The renderer sends only the fields it wants to change; existing fields
 * not present in `patch` are left untouched.
 */
ipcMain.handle('settings:set', async (_e, patch) => {
  if (!patch || typeof patch !== 'object') return { success: false, error: 'Invalid patch' };
  const current = loadSettings();
  const updated  = deepMerge(current, patch);
  saveSettings(updated);
  // If the output dir changed, record it in the recents list too.
  if (patch.lastOutputDir) recordRecentOutputDir(patch.lastOutputDir);
  return { success: true };
});

/* ------------------------------------------------------------------ *
 *  Folder-picker IPC (for Batch & Gallery managed folders)
 * ------------------------------------------------------------------ */

ipcMain.handle('dialog:pickFolders', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select folders',
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});
