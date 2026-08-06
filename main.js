/**
 * Embroidery Converter - Electron Main Process
 * Copyright © 2024 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const zipModule = require('./main/zip');
const logger = require('./main/logger');

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
 *  Streaming backend (NDJSON)
 *
 *  `runBackendStream` spawns the Python backend in streaming mode.
 *  The backend emits one JSON object per line (NDJSON) to stdout;
 *  each parsed line is forwarded to the renderer via the `backend:stream`
 *  IPC channel, tagged with a caller-supplied `requestId` so multiple
 *  concurrent streams can be demultiplexed.
 * ------------------------------------------------------------------ */

const _activeStreams = new Map(); // requestId → ChildProcess

/**
 * Spawn the backend and stream NDJSON lines to the renderer.
 * Returns the ChildProcess (or null if the backend cannot be resolved).
 */
function runBackendStream(requestId, subcommand, payload) {
  const backend = resolveBackend();

  const _send = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:stream', { requestId, data });
    }
  };

  if (!backend) {
    _send({ type: 'error', message: 'No Python backend found. Install Python 3 and pyembroidery, or build the bundled binary.' });
    _send({ type: 'done', count: 0 });
    return null;
  }

  const args = [...backend.baseArgs, subcommand, JSON.stringify(payload || {})];
  let child;
  try {
    child = spawn(backend.command, args, { windowsHide: true });
  } catch (e) {
    _send({ type: 'error', message: 'Failed to start backend: ' + e.message });
    _send({ type: 'done', count: 0 });
    return null;
  }

  let lineBuffer = '';

  child.stdout.on('data', (chunk) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop(); // keep partial last line
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try { _send(JSON.parse(t)); } catch (_) { /* malformed line — skip */ }
    }
  });

  child.on('close', () => {
    // Flush any remaining buffered content after process exit
    const t = lineBuffer.trim();
    if (t) { try { _send(JSON.parse(t)); } catch (_) {} }
    _activeStreams.delete(requestId);
  });

  child.on('error', (e) => {
    _send({ type: 'error', message: 'Backend process error: ' + e.message });
  });

  return child;
}

/* ------------------------------------------------------------------ *
 *  Settings service
 *
 *  Persists application settings as JSON in the platform's userData dir.
 *  Settings are read on first access and written on every mutation.
 *  The IPC handlers (settings:get / settings:set) below let the renderer
 *  sync to and from this file.
 * ------------------------------------------------------------------ */

/**
 * Metadata for each provider kind. Drives both the defaults applied when a
 * provider is created and the secret-requirement policy:
 *   requiresKey  — a key is mandatory (hosted OpenAI)
 *   canHaveKey   — a key is accepted but optional (custom OpenAI-compatible)
 *   external     — requests leave the local machine (privacy-relevant)
 * Local kinds (ollama, lmstudio) never require or send a key, so the UI hides
 * the secret field entirely to avoid confusing servers that reject auth.
 */
const PROVIDER_KINDS = {
  'openai': {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true, canHaveKey: true, external: true,
  },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    defaultBaseUrl: '',
    defaultModel: '',
    requiresKey: false, canHaveKey: true, external: true,
  },
  'ollama': {
    label: 'Ollama (local)',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llava',
    requiresKey: false, canHaveKey: false, external: false,
  },
  'lmstudio': {
    label: 'LM Studio (local)',
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    requiresKey: false, canHaveKey: false, external: false,
  },
};

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
  transferFavorites: [],       // { label, path }[] (legacy key used by transfer view)
  conversion: {
    defaultFormat: 'dst',
    resample: false,
    colorLimit: null,          // null = no limit
    onConflict: 'suffix',      // suffix | overwrite | skip
  },
  // AI vision configuration. Secrets (API keys) are NOT stored here — they
  // live in the encrypted secrets store and are referenced by `secretRef`.
  ai: {
    enabled: false,
    autoTag: true,             // suggest tags in addition to a category
    activeProviderId: null,    // which provider Collections uses by default
    // Registry of configured providers. A provider only carries a secretRef
    // when its kind actually requires a key (see PROVIDER_KINDS).
    providers: [],             // { id, name, kind, baseUrl, model, requiresKey,
                               //   secretRef, enabled,
                               //   capabilities:{vision,chat,embeddings},
                               //   allow:{autoClassify,sendExternal} }
  },
  // Collections tree — flat array of nodes with parentId (null = root).
  // node: { id, name, parentId, files: [{path,name,ext}], tags: [], createdAt }
  collections: [],
  // Projects tree — flat array of nodes with parentId (null = root). A project
  // node bundles heterogeneous assets (embroidery / image / document / note),
  // organised into subfolders, each asset optionally version-tracked.
  // node: { id, name, parentId, kind:'project'|'folder', assets:[...],
  //         subfolders:[string], meta:{client,status,notes,hoop}, createdAt }
  // asset: { id, name, ext, akind, folder, tags:[], category,
  //          versions:[{id,path,name,size,mtime,savedAt,note}], activeVersion }
  projects: [],
  defaultMachine: '',          // default machine profile id for transfer
  // On-disk cache for thumbnails / generated preview images. Persists across
  // sessions (NOT under the OS temp dir). `dir` empty = platform default
  // (userData/thumbcache); users may relocate it. `maxSizeMB` caps total size —
  // when exceeded, least-recently-used entries are evicted. 0 = unlimited.
  cache: {
    dir: '',
    maxSizeMB: 500,
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
  migrateAiSettings(_settingsCache);
  return _settingsCache;
}

/**
 * Migrate the legacy single-provider `ai` shape
 * ({provider, endpoint, apiKey, model}) into the provider registry.
 * Runs once — subsequent loads see `providers` already populated.
 * Any legacy plaintext apiKey is moved into the encrypted secrets store.
 */
function migrateAiSettings(s) {
  if (!s || !s.ai) return;
  const ai = s.ai;
  if (Array.isArray(ai.providers) && (ai.providers.length || ai._migrated)) return;
  if (!Array.isArray(ai.providers)) ai.providers = [];

  const legacyKind = ai.provider;         // may be undefined on fresh installs
  if (legacyKind) {
    const kind = ['openai', 'openai-compatible', 'ollama', 'lmstudio'].includes(legacyKind)
      ? legacyKind : 'openai';
    const meta = PROVIDER_KINDS[kind];
    const id = 'p_' + crypto.randomBytes(5).toString('hex');
    let secretRef = '';
    if (ai.apiKey && meta.canHaveKey) {
      secretRef = 'ai_' + id;
      try { setSecretValue(secretRef, ai.apiKey); } catch (_) {}
    }
    ai.providers.push({
      id,
      name: meta.label,
      kind,
      baseUrl: ai.endpoint || meta.defaultBaseUrl,
      model: ai.model || meta.defaultModel,
      requiresKey: kind === 'openai-compatible' ? !!ai.apiKey : meta.requiresKey,
      secretRef,
      enabled: true,
      capabilities: { vision: true, chat: true, embeddings: false },
      allow: { autoClassify: true, sendExternal: meta.external },
    });
    if (ai.activeProviderId == null) ai.activeProviderId = id;
  }
  // Drop legacy scalar fields so they never leak plaintext again.
  delete ai.provider; delete ai.endpoint; delete ai.apiKey; delete ai.model;
  ai._migrated = true;
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
  // Initialize logging system
  logger.init(app.getPath('userData'));
  logger.info('=== Application started ===', {
    version: app.getVersion(),
    platform: process.platform,
    isDev,
    isPackaged: app.isPackaged
  });
  
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  logger.info('=== Application quit ===');
  logger.close();
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
      logger.error('Backend not available', {
        pythonFound: false,
        scriptOk,
        reason: 'no-python'
      });
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
    
    logger.info('Backend resolved', {
      mode: backend.mode,
      command: backend.command.split('/').pop() // Log just the executable name for privacy
    });
    
    // A backend was resolved; confirm the engine actually runs (imports the
    // bundled pyembroidery and returns the format list).
    const res = await runBackend('formats', {});
    
    if (res.success) {
      logger.info('Backend engine test passed', { mode: backend.mode });
    } else {
      logger.error('Backend engine test failed', { 
        mode: backend.mode, 
        error: res.error ? res.error.substring(0, 200) : 'unknown error' 
      });
    }
    
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
    logger.error('backend:status exception', {
      message: e.message,
      code: e.code
    });
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
 *  File System Utilities for Transfer
 * ------------------------------------------------------------------ */

/**
 * List removable volumes (USB drives, SD cards, etc.)
 * Returns array of {mountPoint, label, capacity, available, removable}
 */
ipcMain.handle('fs:listVolumes', async () => {
  const os = require('os');
  const volumes = [];
  
  try {
    if (process.platform === 'win32') {
      // Windows: check drive letters using wmic or fsutil
      const { execSync } = require('child_process');
      try {
        const output = execSync('wmic logicaldisk get caption,drivetype,volumename,size,freespace', {
          encoding: 'utf8',
          windowsHide: true
        });
        const lines = output.split('\n').slice(1); // Skip header
        
        for (const line of lines) {
          const parts = line.trim().split(/\s{2,}/);
          if (parts.length >= 2) {
            const [caption, driveType, volumeName, size, freeSpace] = parts;
            // DriveType 2 = Removable, 3 = Fixed, 4 = Network, 5 = CD-ROM
            if (caption && driveType === '2') {
              volumes.push({
                mountPoint: caption,
                label: volumeName || caption,
                capacity: parseInt(size, 10) || 0,
                available: parseInt(freeSpace, 10) || 0,
                removable: true
              });
            }
          }
        }
      } catch (err) {
        console.error('Error listing Windows volumes:', err);
      }
    } else if (process.platform === 'darwin') {
      // macOS: check /Volumes
      const volumesDir = '/Volumes';
      if (fs.existsSync(volumesDir)) {
        const entries = fs.readdirSync(volumesDir);
        for (const entry of entries) {
          const mountPoint = path.join(volumesDir, entry);
          try {
            const stats = fs.statSync(mountPoint);
            if (stats.isDirectory() && entry !== 'Macintosh HD') {
              volumes.push({
                mountPoint,
                label: entry,
                capacity: 0, // Would need platform-specific calls for capacity
                available: 0,
                removable: true
              });
            }
          } catch (err) {
            // Skip inaccessible volumes
          }
        }
      }
    } else {
      // Linux: check /media and /mnt
      const mediaDirs = ['/media', '/mnt'];
      for (const mediaDir of mediaDirs) {
        if (fs.existsSync(mediaDir)) {
          const entries = fs.readdirSync(mediaDir);
          for (const entry of entries) {
            const mountPoint = path.join(mediaDir, entry);
            try {
              const stats = fs.statSync(mountPoint);
              if (stats.isDirectory()) {
                volumes.push({
                  mountPoint,
                  label: entry,
                  capacity: 0,
                  available: 0,
                  removable: true
                });
              }
            } catch (err) {
              // Skip inaccessible volumes
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error listing volumes:', err);
  }
  
  return volumes;
});

/**
 * Join path segments (platform-aware)
 */
ipcMain.handle('fs:joinPath', async (_e, ...segments) => {
  return path.join(...segments);
});

/**
 * Ensure directory exists (create if missing)
 */
ipcMain.handle('fs:ensureDir', async (_e, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Copy file from source to destination
 */
ipcMain.handle('fs:copyFile', async (_e, srcPath, destPath) => {
  try {
    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.copyFileSync(srcPath, destPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Verify file copy by comparing sizes
 * (Simple verification - could be extended with checksums)
 */
ipcMain.handle('fs:verifyFile', async (_e, srcPath, destPath) => {
  try {
    if (!fs.existsSync(srcPath) || !fs.existsSync(destPath)) {
      return false;
    }
    
    const srcStats = fs.statSync(srcPath);
    const destStats = fs.statSync(destPath);
    
    return srcStats.size === destStats.size;
  } catch (err) {
    console.error('Error verifying file:', err);
    return false;
  }
});

/* ------------------------------------------------------------------ *
 *  Settings IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('settings:get', async () => {
  return loadSettings();
});

/** Return the packaged application version (from package.json). */
ipcMain.handle('app:getVersion', async () => {
  try { return app.getVersion(); } catch (_) { return ''; }
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
  // If the cache config changed (smaller size cap or relocated dir), sweep now
  // so the on-disk footprint immediately respects the new limit.
  if (patch.cache) { try { enforceCacheLimit(); } catch (_) {} }
  return { success: true };
});

/* ------------------------------------------------------------------ *
 *  Encrypted secrets store
 *
 *  API keys and other credentials are NEVER kept in settings.json. They live
 *  in userData/secrets.enc, encrypted with Electron's safeStorage which is
 *  backed by the OS keychain (macOS Keychain / Windows DPAPI / Linux libsecret).
 *  Settings only reference a secret by `secretRef`; the plaintext value is
 *  resolved here in the main process and is never returned to the renderer —
 *  the renderer only ever sees { isSet, last4, protected }.
 *
 *  If the OS has no keyring available (some headless Linux setups), we fall
 *  back to a base64-obfuscated value flagged `protected:false` so the UI can
 *  warn the user it is not hardware-protected.
 * ------------------------------------------------------------------ */

let _secretsCache = null;

function secretsPath() {
  return path.join(app.getPath('userData'), 'secrets.enc');
}

function encryptionAvailable() {
  try { return safeStorage && safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
}

function loadSecrets() {
  if (_secretsCache) return _secretsCache;
  try {
    _secretsCache = JSON.parse(fs.readFileSync(secretsPath(), 'utf8'));
  } catch (_) {
    _secretsCache = {};
  }
  return _secretsCache;
}

function saveSecrets(map) {
  _secretsCache = map;
  try {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true });
    fs.writeFileSync(secretsPath(), JSON.stringify(map), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.error('Failed to save secrets:', e.message);
  }
}

/** Store a plaintext secret under `ref`. Returns its public status. */
function setSecretValue(ref, plain) {
  if (!ref) throw new Error('missing secret ref');
  const map = loadSecrets();
  const value = String(plain == null ? '' : plain);
  const last4 = value.slice(-4);
  if (encryptionAvailable()) {
    const buf = safeStorage.encryptString(value);
    map[ref] = { v: buf.toString('base64'), last4, protected: true };
  } else {
    map[ref] = { v: Buffer.from(value, 'utf8').toString('base64'), last4, protected: false };
  }
  saveSecrets(map);
  return { isSet: !!value, last4, protected: map[ref].protected };
}

/** Resolve the plaintext secret for `ref` (main-process only). */
function getSecretValue(ref) {
  if (!ref) return '';
  const rec = loadSecrets()[ref];
  if (!rec || !rec.v) return '';
  try {
    if (rec.protected) return safeStorage.decryptString(Buffer.from(rec.v, 'base64'));
    return Buffer.from(rec.v, 'base64').toString('utf8');
  } catch (_) { return ''; }
}

function deleteSecretValue(ref) {
  const map = loadSecrets();
  if (ref in map) { delete map[ref]; saveSecrets(map); }
}

function secretStatus(ref) {
  const rec = ref ? loadSecrets()[ref] : null;
  return rec
    ? { isSet: true, last4: rec.last4 || '', protected: !!rec.protected }
    : { isSet: false, last4: '', protected: encryptionAvailable() };
}

ipcMain.handle('secrets:available', async () => ({ available: encryptionAvailable() }));
ipcMain.handle('secrets:status', async (_e, { ref } = {}) => secretStatus(ref));
ipcMain.handle('secrets:set', async (_e, { ref, value } = {}) => {
  if (!ref) return { isSet: false, error: 'missing ref' };
  try { return setSecretValue(ref, value); }
  catch (e) { return { isSet: false, error: e.message || String(e) }; }
});
ipcMain.handle('secrets:delete', async (_e, { ref } = {}) => {
  deleteSecretValue(ref);
  return { isSet: false };
});

/* ------------------------------------------------------------------ *
 *  Projects IPC – Export/Import .ecproj packages
 * 
 *  Projects hold a mixture of embroidery files, images, documents, and
 *  notes, organized in a folder tree. The .ecproj package is a ZIP-based
 *  format (manifest.json + assets/ + previews/) written by main/zip.js.
 *  
 *  Copy-on-export: assets are referenced by path while editing; they are
 *  copied into the .ecproj only on export. This keeps the package lean
 *  and allows users to organize their source files independently.
 * ------------------------------------------------------------------ */

/**
 * Export a project (or subtree) to an .ecproj ZIP package.
 * @param {Object} params
 * @param {Object} params.manifest - Full manifest: {version, name, tree, assets}
 * @param {Array}  params.assets - [{id, path, ...asset metadata}]
/* ------------------------------------------------------------------ *
 *  Application & Logging Handlers
 * ------------------------------------------------------------------ */

/**
 * Get application logs for debugging/support
 * Returns: { success, logs, logFile }
 */
ipcMain.handle('app:get-logs', async () => {
  try {
    const logs = logger.exportLogs();
    const logFile = logger.getLogFile();
    return {
      success: true,
      logs,
      logFile,
      logsDir: logger.getLogsDir()
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
});

/**
 * Open logs folder in file explorer
 */
ipcMain.handle('app:open-logs-folder', async () => {
  try {
    const logsDir = logger.getLogsDir();
    if (!logsDir) {
      return { success: false, error: 'Logs directory not initialized' };
    }
    shell.openPath(logsDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/* ================================================================== *
 *  Project Handlers
 * ================================================================== */

ipcMain.handle('project:export', async (_e, { manifest, assets = [], previews = [] } = {}) => {
  if (!manifest) return { success: false, error: 'Missing manifest' };
  
  try {
    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Project',
      defaultPath: `${manifest.name || 'project'}.ecproj`,
      filters: [{ name: 'Embroidery Project', extensions: ['ecproj'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    
    const zipEntries = [];
    
    // 1. Write manifest.json
    zipEntries.push({
      name: 'manifest.json',
      data: JSON.stringify(manifest, null, 2),
      mtime: new Date()
    });
    
    // 2. Copy assets into assets/ folder (copy-on-export)
    for (const asset of assets) {
      if (!asset.path || !fs.existsSync(asset.path)) {
        console.warn(`Skipping missing asset: ${asset.id} (${asset.path})`);
        continue;
      }
      
      try {
        const data = fs.readFileSync(asset.path);
        const stats = fs.statSync(asset.path);
        const ext = path.extname(asset.path);
        zipEntries.push({
          name: `assets/${asset.id}${ext}`,
          data,
          mtime: stats.mtime
        });
      } catch (err) {
        console.warn(`Failed to read asset ${asset.id}:`, err.message);
      }
    }
    
    // 3. Write previews as JSON (for embroidery/image assets)
    for (const prev of previews) {
      if (!prev.id || !prev.preview) continue;
      zipEntries.push({
        name: `previews/${prev.id}.json`,
        data: JSON.stringify(prev.preview),
        mtime: new Date()
      });
    }
    
    // 4. Build ZIP using our zero-dependency zip module
    const zipBuf = zipModule.zipSync(zipEntries);
    fs.writeFileSync(result.filePath, zipBuf);
    
    return { success: true, path: result.filePath };
    
  } catch (error) {
    console.error('Project export failed:', error);
    return { success: false, error: error.message || String(error) };
  }
});

/**
 * Import a .ecproj package: extract assets, return manifest + updated paths.
 * @param {Object} params
 * @param {string} params.zipPath - Path to .ecproj file (optional; shows dialog if omitted)
 * @returns {Promise<{success: boolean, manifest?: Object, error?: string}>}
 */
ipcMain.handle('project:import', async (_e, { zipPath } = {}) => {
  try {
    let importPath = zipPath;
    
    // Show open dialog if no path provided
    if (!importPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import Project',
        filters: [{ name: 'Embroidery Project', extensions: ['ecproj'] }],
        properties: ['openFile']
      });
      
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: 'Cancelled' };
      }
      importPath = result.filePaths[0];
    }
    
    if (!fs.existsSync(importPath)) {
      return { success: false, error: 'File not found' };
    }
    
    // 1. Unzip the .ecproj package
    const zipBuf = fs.readFileSync(importPath);
    const entries = zipModule.unzipSync(zipBuf);
    
    // 2. Extract manifest
    const manifestEntry = entries.find(e => e.name === 'manifest.json');
    if (!manifestEntry) {
      return { success: false, error: 'Invalid .ecproj: missing manifest.json' };
    }
    
    const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
    
    // 3. Create extraction directory: userData/projects/imported_<timestamp>_<name>
    const timestamp = Date.now();
    const safeName = (manifest.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
    const extractDir = path.join(app.getPath('userData'), 'projects', `imported_${timestamp}_${safeName}`);
    fs.mkdirSync(extractDir, { recursive: true });
    
    // 4. Extract all assets from assets/ folder
    const assetMap = {}; // id -> extracted local path
    for (const entry of entries) {
      if (!entry.name.startsWith('assets/')) continue;
      
      const fileName = path.basename(entry.name);
      const destPath = path.join(extractDir, fileName);
      fs.writeFileSync(destPath, entry.data);
      
      // Map asset ID (filename without extension) to extracted path
      const assetId = path.basename(fileName, path.extname(fileName));
      assetMap[assetId] = destPath;
    }
    
    // 5. Rewrite asset paths in manifest to point to extracted files
    if (manifest.assets && Array.isArray(manifest.assets)) {
      for (const asset of manifest.assets) {
        if (asset.id && assetMap[asset.id]) {
          asset.path = assetMap[asset.id];
          // Update mtime/size from extracted file
          try {
            const stats = fs.statSync(asset.path);
            asset.mtime = stats.mtime.getTime();
            asset.size = stats.size;
          } catch (_) {}
        }
      }
    }
    
    // 6. Return updated manifest (renderer will merge into settings.projects)
    return { success: true, manifest };
    
  } catch (error) {
    console.error('Project import failed:', error);
    return { success: false, error: error.message || String(error) };
  }
});

/**
 * Open file picker for any file type (documents, images, embroidery, etc.)
 * Used by Projects view to add non-embroidery assets.
 */
ipcMain.handle('dialog:openAnyFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'] }
    ]
  });
  
  if (result.canceled) return [];
  return result.filePaths;
});

/**
 * Read a text file (for inline note editing in Projects).
 * Notes can be stored as inline text in settings or as .txt assets; this
 * helper allows reading existing text files.
 */
ipcMain.handle('fs:readText', async (_e, { path: filePath } = {}) => {
  if (!filePath) return { success: false, error: 'Missing path' };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

/* ------------------------------------------------------------------ *
 *  AI vision IPC (auto-classification & tagging for Collections)
 *
 *  Providers are configured in Settings → AI & Vision as a registry. Each
 *  provider has a kind (see PROVIDER_KINDS), a base URL, a model, capability
 *  flags (vision/chat/embeddings) and functional allowances (autoClassify,
 *  sendExternal). Secrets are pulled from the encrypted store by secretRef and
 *  only attached for provider kinds that actually use a key.
 *  Uses the global fetch bundled with Electron's Node (>=18). No extra deps.
 * ------------------------------------------------------------------ */

function aiConfig() {
  const s = loadSettings();
  return (s && s.ai) ? s.ai : {};
}

/** Find a provider by id, falling back to the active provider. */
function resolveProvider(ai, providerId) {
  const providers = Array.isArray(ai.providers) ? ai.providers : [];
  let p = null;
  if (providerId) p = providers.find((x) => x.id === providerId);
  if (!p && ai.activeProviderId) p = providers.find((x) => x.id === ai.activeProviderId);
  if (!p) p = providers.find((x) => x.enabled) || providers[0];
  return p || null;
}

/** Resolve the base URL for a provider (custom value or kind default). */
function providerBaseUrl(p) {
  const meta = PROVIDER_KINDS[p.kind] || {};
  const custom = (p.baseUrl || '').trim().replace(/\/+$/, '');
  return custom || meta.defaultBaseUrl || '';
}

/** Split a data URL into { mime, base64 }. Accepts raw base64 too. */
function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (m) return { mime: m[1], base64: m[2] };
  return { mime: 'image/png', base64: (dataUrl || '').replace(/^data:.*?,/, '') };
}

/** Call an OpenAI-style /chat/completions endpoint with an optional image. */
async function aiChatOpenAI(p, base, apiKey, promptText, dataUrl) {
  const url = base.replace(/\/+$/, '') + '/chat/completions';
  const content = [{ type: 'text', text: promptText }];
  if (dataUrl) content.push({ type: 'image_url', image_url: { url: dataUrl } });
  const headers = { 'Content-Type': 'application/json' };
  // Only send auth when the provider kind uses a key AND one is configured.
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: 'user', content }],
      max_tokens: 300,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + (txt ? ': ' + txt.slice(0, 300) : ''));
  }
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

/** Call a local Ollama /api/chat endpoint with an optional image. */
async function aiChatOllama(p, base, promptText, dataUrl) {
  const url = base.replace(/\/+$/, '') + '/api/chat';
  const msg = { role: 'user', content: promptText };
  if (dataUrl) msg.images = [splitDataUrl(dataUrl).base64];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      messages: [msg],
      stream: false,
      options: { temperature: 0 },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + (txt ? ': ' + txt.slice(0, 300) : ''));
  }
  const data = await res.json();
  return (data.message && data.message.content) || '';
}

/** Dispatch a single vision request to a provider. */
async function aiVisionCall(p, promptText, dataUrl) {
  const meta = PROVIDER_KINDS[p.kind] || {};
  const base = providerBaseUrl(p);
  if (!base) throw new Error('No endpoint configured for this provider.');
  if (!p.model) throw new Error('No model configured.');
  // Resolve the key only for kinds that accept one.
  let apiKey = '';
  if (meta.canHaveKey && p.secretRef) apiKey = getSecretValue(p.secretRef);
  if (meta.requiresKey && !apiKey) throw new Error('This provider requires an API key.');
  if (p.kind === 'ollama') return aiChatOllama(p, base, promptText, dataUrl);
  // openai, openai-compatible and lmstudio all speak the OpenAI chat API.
  return aiChatOpenAI(p, base, apiKey, promptText, dataUrl);
}

/** Best-effort parse of a JSON object from a model response. */
function parseAiJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  // Strip markdown code fences if present.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(s); } catch (_) {}
  // Fall back to the first {...} block.
  const m = /\{[\s\S]*\}/.exec(s);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

/** Probe a provider with a tiny text request. payload: { providerId? } */
ipcMain.handle('ai:test', async (_e, payload = {}) => {
  const ai = aiConfig();
  if (!ai.enabled) return { ok: false, error: 'AI features are disabled.' };
  const p = resolveProvider(ai, payload && payload.providerId);
  if (!p) return { ok: false, error: 'No provider configured.' };
  try {
    const out = await aiVisionCall(p, 'Reply with the single word: ok', null);
    return { ok: true, sample: String(out || '').slice(0, 120) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

/**
 * Classify & tag a batch of design thumbnails.
 * payload: { items:[{id,image(dataURL)}], categories:string[], autoTag:bool, providerId? }
 * returns: { ok, results:[{id,category,tags}], error? }
 */
ipcMain.handle('ai:classify', async (_e, payload) => {
  const ai = aiConfig();
  if (!ai.enabled) return { ok: false, error: 'AI features are disabled.' };
  const p = resolveProvider(ai, payload && payload.providerId);
  if (!p) return { ok: false, error: 'No provider configured.' };
  if (!p.enabled) return { ok: false, error: 'Selected provider is disabled.' };
  if (p.capabilities && p.capabilities.vision === false) {
    return { ok: false, error: 'Selected provider is not allowed to process images (vision capability off).' };
  }
  if (p.allow && p.allow.autoClassify === false) {
    return { ok: false, error: 'Auto-classification is not permitted for this provider.' };
  }

  const items = (payload && Array.isArray(payload.items)) ? payload.items : [];
  const categories = (payload && Array.isArray(payload.categories) && payload.categories.length)
    ? payload.categories
    : ['Animals', 'Flowers', 'Lettering', 'Geometric', 'Holiday', 'Nautical', 'Other'];
  const autoTag = payload ? payload.autoTag !== false : true;

  const catList = categories.join(', ');
  const tagLine = autoTag
    ? ' Also provide up to 5 short lowercase descriptive tags (single words or short phrases).'
    : ' Do not provide tags; return an empty tags array.';
  const prompt =
    'You are classifying an embroidery design shown in the image. ' +
    'Choose the SINGLE best matching category from this list: ' + catList + '.' +
    tagLine +
    ' Respond ONLY with a compact JSON object of the form ' +
    '{"category":"<one of the categories>","tags":["..."]} and nothing else.';

  const results = [];
  let anyOk = false;
  let lastError = '';
  for (const it of items) {
    if (!it || !it.image) {
      results.push({ id: it && it.id, category: '', tags: [], error: 'no-image' });
      continue;
    }
    try {
      const raw = await aiVisionCall(p, prompt, it.image);
      const parsed = parseAiJson(raw) || {};
      let category = typeof parsed.category === 'string' ? parsed.category.trim() : '';
      // Snap to a known category (case-insensitive) when possible.
      const match = categories.find((c) => c.toLowerCase() === category.toLowerCase());
      if (match) category = match;
      let tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      tags = tags.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 5);
      if (!autoTag) tags = [];
      results.push({ id: it.id, category, tags });
      anyOk = true;
    } catch (e) {
      lastError = e.message || String(e);
      results.push({ id: it.id, category: '', tags: [], error: lastError });
    }
  }
  return { ok: anyOk, results, error: anyOk ? undefined : lastError };
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

/* ------------------------------------------------------------------ *
 *  Batch conversion IPC
 *
 *  Runs sequential conversions for multiple files, streaming per-file
 *  progress back to the renderer.
 * ------------------------------------------------------------------ */

/**
 * Run a batch conversion job.
 * @param {Object} job - { requestId, files: FileEntry[], profile: BatchProfile }
 * @returns {Promise<{started: true, requestId}>}
 */
ipcMain.handle('backend:runBatch', async (_e, job) => {
  const { requestId, files, profile } = job;
  if (!requestId || !Array.isArray(files) || files.length === 0) {
    return { started: false, error: 'Invalid batch job' };
  }

  const _send = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:stream', { requestId, data });
    }
  };

  // Run conversions sequentially (to avoid overwhelming the system)
  setImmediate(async () => {
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const inputPath = file.path;

      try {
        // 1. Resolve output path
        const outputPath = await _resolveOutputPath(inputPath, profile);
        
        if (!outputPath) {
          // Conflict mode was 'skip'
          _send({
            type: 'progress',
            index: i,
            total: files.length,
            path: inputPath,
            status: 'skipped',
            message: 'File already exists (skip mode)',
          });
          continue;
        }

        // 2. Build conversion payload
        const payload = {
          input_path: inputPath,
          output_path: outputPath,
          output_format: profile.outputFormat || 'pes',
          options: {},
        };

        // Apply resize options
        if (profile.resizeWidthMm)  payload.options.resize_width_mm  = profile.resizeWidthMm;
        if (profile.resizeHeightMm) payload.options.resize_height_mm = profile.resizeHeightMm;
        if (profile.resampleStitches) payload.options.resample_stitches = true;
        if (profile.colorLimit) payload.options.color_limit = profile.colorLimit;

        // 3. Convert
        _send({
          type: 'progress',
          index: i,
          total: files.length,
          path: inputPath,
          status: 'running',
          outputPath,
        });

        const result = await runBackend('convert', payload);

        if (result.success) {
          completed++;
          _send({
            type: 'progress',
            index: i,
            total: files.length,
            path: inputPath,
            status: 'done',
            outputPath,
            warnings: result.warnings || [],
          });
        } else {
          failed++;
          _send({
            type: 'progress',
            index: i,
            total: files.length,
            path: inputPath,
            status: 'error',
            error: result.error || 'Conversion failed',
          });
        }
      } catch (err) {
        failed++;
        _send({
          type: 'progress',
          index: i,
          total: files.length,
          path: inputPath,
          status: 'error',
          error: err.message || String(err),
        });
      }
    }

    // Send completion event
    _send({
      type: 'done',
      total: files.length,
      completed,
      failed,
    });
  });

  return { started: true, requestId };
});

/**
 * Resolve the output path for a file based on the batch profile.
 * Handles conflict modes: suffix, overwrite, skip.
 * @returns {Promise<string|null>} output path, or null if skipped
 */
async function _resolveOutputPath(inputPath, profile) {
  const ext = profile.outputFormat || 'pes';
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputDir = profile.outputDir || path.dirname(inputPath);

  let outputPath = path.join(outputDir, `${baseName}.${ext}`);

  // Check for conflicts
  if (fs.existsSync(outputPath)) {
    const mode = profile.conflictMode || 'suffix';

    if (mode === 'skip') {
      return null; // Signal to skip this file
    } else if (mode === 'overwrite') {
      // Use the path as-is (will overwrite)
      return outputPath;
    } else if (mode === 'suffix') {
      // Add (1), (2), ... until we find a free name
      let counter = 1;
      while (fs.existsSync(outputPath)) {
        outputPath = path.join(outputDir, `${baseName} (${counter}).${ext}`);
        counter++;
        if (counter > 999) break; // Safety limit
      }
    }
  }

  return outputPath;
}

/* ------------------------------------------------------------------ *
 *  Streaming IPC — scan + thumbs + cancel
 * ------------------------------------------------------------------ */

/** Start a folder scan; NDJSON lines arrive via `backend:stream`. */
ipcMain.handle('backend:scan', async (_e, { requestId, opts }) => {
  const child = runBackendStream(requestId, 'scan', opts || {});
  if (child) _activeStreams.set(requestId, child);
  return { started: true, requestId };
});

/** Start thumbnail generation; NDJSON lines arrive via `backend:stream`. */
ipcMain.handle('backend:thumbs', async (_e, { requestId, paths }) => {
  const child = runBackendStream(requestId, 'thumbs', { paths: paths || [] });
  if (child) _activeStreams.set(requestId, child);
  return { started: true, requestId };
});

/** Abort a running stream by requestId. */
ipcMain.handle('backend:cancel', async (_e, { requestId }) => {
  const child = _activeStreams.get(requestId);
  if (child) {
    try { child.kill(); } catch (_) {}
    _activeStreams.delete(requestId);
    return { success: true };
  }
  return { success: false, reason: 'not-found' };
});

/* ------------------------------------------------------------------ *
 *  Thumbnail cache
 *
 *  Thumbnails (metadata + vector preview polylines produced by the
 *  Python backend) are cached on disk in the platform userData dir —
 *  NEVER inside the user's source folders. Cache entries are keyed by a
 *  SHA-256 hash of the source path + its last-modified time, so a file
 *  that changes on disk automatically invalidates its cached thumbnail.
 * ------------------------------------------------------------------ */

/** Platform default cache directory (used when the user hasn't chosen one). */
function defaultCacheDir() {
  return path.join(app.getPath('userData'), 'thumbcache');
}

/**
 * Resolve the active cache directory. Honors settings.cache.dir when set
 * (persistent, user-chosen location); otherwise falls back to the platform
 * default. Never returns an OS temp path, so cached data survives sessions.
 */
function thumbcacheDir() {
  let dir = defaultCacheDir();
  try {
    const s = loadSettings();
    const custom = s && s.cache && typeof s.cache.dir === 'string' ? s.cache.dir.trim() : '';
    if (custom) dir = custom;
  } catch (_) {}
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

/** SHA-256 hash of "<path>|<mtime>" — the cache key for a file's thumbnail. */
function thumbHash(filePath, mtime) {
  return crypto.createHash('sha256')
    .update(String(filePath) + '|' + String(mtime || 0))
    .digest('hex');
}

function thumbCachePath(filePath, mtime) {
  return path.join(thumbcacheDir(), thumbHash(filePath, mtime) + '.json');
}

function readThumbCache(filePath, mtime) {
  try {
    const cp = thumbCachePath(filePath, mtime);
    const raw = fs.readFileSync(cp, 'utf8');
    // Touch the cache file's timestamp so LRU eviction treats a cache HIT as
    // "recently used" (ordering is by the cache file's own mtime, independent
    // of the source-file mtime baked into the cache key/filename).
    try { const now = new Date(); fs.utimesSync(cp, now, now); } catch (_) {}
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeThumbCache(filePath, mtime, data) {
  try {
    fs.writeFileSync(thumbCachePath(filePath, mtime), JSON.stringify(data), 'utf8');
    scheduleCacheEviction();
  } catch (e) {
    console.error('Failed to write thumb cache:', e.message);
  }
}

/* ------------------------------------------------------------------ *
 *  Cache accounting & LRU eviction
 *
 *  Total on-disk size is capped by settings.cache.maxSizeMB. When a write
 *  pushes the cache over the limit, the least-recently-used entries (oldest
 *  cache-file mtime) are deleted until it fits. maxSizeMB = 0 → unlimited.
 * ------------------------------------------------------------------ */

/** List cache entries with size + mtime. Never throws. */
function listCacheEntries() {
  const dir = thumbcacheDir();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return { dir, entries: [] }; }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fp = path.join(dir, name);
    try { const st = fs.statSync(fp); if (st.isFile()) entries.push({ fp, size: st.size, mtime: st.mtimeMs }); }
    catch (_) {}
  }
  return { dir, entries };
}

/** Aggregate cache stats: { dir, sizeBytes, fileCount, maxSizeMB }. */
function cacheInfo() {
  const { dir, entries } = listCacheEntries();
  let sizeBytes = 0;
  for (const e of entries) sizeBytes += e.size;
  let maxSizeMB = 500;
  try { const s = loadSettings(); if (s && s.cache && Number.isFinite(Number(s.cache.maxSizeMB))) maxSizeMB = Number(s.cache.maxSizeMB); } catch (_) {}
  return { dir, sizeBytes, fileCount: entries.length, maxSizeMB, isDefault: dir === defaultCacheDir() };
}

/** Evict least-recently-used entries until total size ≤ the configured cap. */
function enforceCacheLimit() {
  let maxMB = 500;
  try { const s = loadSettings(); if (s && s.cache && Number.isFinite(Number(s.cache.maxSizeMB))) maxMB = Number(s.cache.maxSizeMB); } catch (_) {}
  if (!(maxMB > 0)) return { evicted: 0, freedBytes: 0 };  // 0/invalid = unlimited
  const limit = maxMB * 1024 * 1024;
  const { entries } = listCacheEntries();
  let total = 0;
  for (const e of entries) total += e.size;
  if (total <= limit) return { evicted: 0, freedBytes: 0 };
  entries.sort((a, b) => a.mtime - b.mtime);  // oldest (LRU) first
  let evicted = 0, freed = 0;
  for (const e of entries) {
    if (total <= limit) break;
    try { fs.unlinkSync(e.fp); total -= e.size; freed += e.size; evicted++; } catch (_) {}
  }
  return { evicted, freedBytes: freed };
}

let _evictTimer = null;
/** Debounced eviction so a large batch of writes only triggers one sweep. */
function scheduleCacheEviction() {
  if (_evictTimer) return;
  _evictTimer = setTimeout(() => { _evictTimer = null; try { enforceCacheLimit(); } catch (_) {} }, 3000);
}

/** Report cache location + usage for the Settings UI. */
ipcMain.handle('cache:info', async () => cacheInfo());

/** Delete every cached entry in the active cache directory. */
ipcMain.handle('cache:clear', async () => {
  const { entries } = listCacheEntries();
  let cleared = 0, freed = 0;
  for (const e of entries) {
    try { fs.unlinkSync(e.fp); cleared++; freed += e.size; } catch (_) {}
  }
  return { cleared, freedBytes: freed };
});

/** Pick a folder to use as the persistent cache directory. */
ipcMain.handle('dialog:selectCacheDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select cache folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

/**
 * Spawn the backend once to generate thumbnails for the given paths.
 * Resolves with a Map<path, { meta, preview }>. Never rejects — missing
 * or failed paths are simply absent from the returned map.
 */
function spawnThumbsOnce(paths) {
  return new Promise((resolve) => {
    const backend = resolveBackend();
    const out = new Map();
    if (!backend || !paths || paths.length === 0) { resolve(out); return; }

    const args = [...backend.baseArgs, 'thumbs', JSON.stringify({ paths })];
    let child;
    try {
      child = spawn(backend.command, args, { windowsHide: true });
    } catch (_) { resolve(out); return; }

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        try {
          const d = JSON.parse(s);
          if (d.type === 'thumb') out.set(d.path, { meta: d.meta || {}, preview: d.preview || null });
        } catch (_) {}
      }
    });
    child.on('close', () => {
      const s = buf.trim();
      if (s) { try { const d = JSON.parse(s); if (d.type === 'thumb') out.set(d.path, { meta: d.meta || {}, preview: d.preview || null }); } catch (_) {} }
      resolve(out);
    });
    child.on('error', () => resolve(out));
  });
}

/**
 * Return a directory's last-modified time (ms). Used by Gallery/Batch to
 * decide whether a folder needs re-scanning. Returns { mtime, exists }.
 */
ipcMain.handle('fs:statDir', async (_e, dirPath) => {
  try {
    const st = fs.statSync(dirPath);
    return { exists: true, mtime: st.mtimeMs, isDir: st.isDirectory() };
  } catch (_) {
    return { exists: false, mtime: 0, isDir: false };
  }
});

/**
 * Get a single cached thumbnail (metadata + vector preview) for a file.
 * If not cached, generate it via the backend, cache it, and return it.
 * Returns { meta, preview } or null.
 */
ipcMain.handle('thumbnail:get', async (_e, { path: filePath, mtime }) => {
  const cached = readThumbCache(filePath, mtime);
  if (cached) return cached;
  const map = await spawnThumbsOnce([filePath]);
  const data = map.get(filePath);
  if (data) { writeThumbCache(filePath, mtime, data); return data; }
  return null;
});

/**
 * Streaming thumbnail generation with disk caching.
 *
 * payload.items: [{ path, mtime }]
 * Emits (via backend:stream, keyed by requestId):
 *   { type:'thumb', path, meta, preview, cached:bool } per file
 *   { type:'done' } when finished
 *
 * Cache hits are emitted immediately; only cache misses are sent to the
 * Python backend, and their results are written back to the cache.
 */
ipcMain.handle('backend:thumbsCached', async (_e, { requestId, items }) => {
  const _send = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:stream', { requestId, data });
    }
  };

  const list = Array.isArray(items) ? items : [];
  const mtimeByPath = new Map();
  const misses = [];

  for (const it of list) {
    if (!it || !it.path) continue;
    mtimeByPath.set(it.path, it.mtime);
    const cached = readThumbCache(it.path, it.mtime);
    if (cached) {
      _send({ type: 'thumb', path: it.path, meta: cached.meta, preview: cached.preview, cached: true });
    } else {
      misses.push(it.path);
    }
  }

  if (misses.length > 0) {
    const map = await spawnThumbsOnce(misses);
    for (const p of misses) {
      const data = map.get(p);
      if (data) {
        writeThumbCache(p, mtimeByPath.get(p), data);
        _send({ type: 'thumb', path: p, meta: data.meta, preview: data.preview, cached: false });
      }
    }
  }

  _send({ type: 'done', count: list.length });
  return { started: true, requestId };
});
