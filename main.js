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

function findSystemPython() {
  const candidates =
    process.platform === 'win32'
      ? ['python.exe', 'python3.exe', 'python', 'python3']
      : ['python3', 'python'];
  for (const c of candidates) {
    try {
      const res = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (res.status === 0 || (res.stdout || res.stderr || '').toLowerCase().includes('python')) {
        return c;
      }
    } catch (_) {
      /* keep trying */
    }
  }
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
  const backend = resolveBackend();
  if (!backend) {
    return { available: false, mode: null };
  }
  // confirm pyembroidery is importable when using system python
  const res = await runBackend('formats', {});
  return {
    available: !!res.success,
    mode: backend.mode,
    error: res.success ? null : res.error,
  };
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
