const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const media = require('./media');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mpg', '.mpeg', '.wmv', '.flv', '.mxf', '.m2ts', '.ts']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.aif', '.aiff', '.flac', '.m4a', '.ogg', '.aac', '.wma', '.opus']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff']);

let store;
let cacheDir;
let clipsDir;
let previewDir;
let win;

// Launcher behaviour: global shortcut toggles the window; after a drag-out the
// window auto-hides so the user can keep editing in Premiere.
function showAndFocus() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.center();
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  win.setAlwaysOnTop(false);
  send('focus-search');
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) win.hide();
  else showAndFocus();
}

function typeForExt(ext) {
  ext = ext.toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  return null;
}

function cachePathFor(filePath, name) {
  const dir = path.join(cacheDir, media.hashPath(filePath));
  return path.join(dir, name);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---- indexing queue (bounded concurrency) ----
const queue = [];
let active = 0;
const MAX_CONCURRENT = 3;

function enqueue(task) {
  queue.push(task);
  pump();
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    active++;
    task()
      .catch((e) => console.error('index task failed:', e.message))
      .finally(() => {
        active--;
        if (queue.length === 0 && active === 0) {
          send('index-progress', { done: true, remaining: 0 });
        } else {
          send('index-progress', { done: false, remaining: queue.length + active });
        }
        pump();
      });
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function walkDir(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, out);
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (typeForExt(ext)) out.push(full);
    }
  }
}

async function indexFile(filePath, folderId) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    return;
  }
  const ext = path.extname(filePath);
  const type = typeForExt(ext);
  if (!type) return;

  const existing = store.getItem(filePath);
  // Only treat as "unchanged" if the preview actually exists on disk -> self-heals
  // items that were marked ready but never got a thumbnail/waveform.
  const thumbOnDisk = fs.existsSync(cachePathFor(filePath, 'thumb.jpg'));
  const unchanged = existing && existing.mtime === stat.mtimeMs && existing.assetsReady && thumbOnDisk;

  const dir = path.dirname(cachePathFor(filePath, 'x'));
  ensureDir(dir);

  let meta = { duration: existing ? existing.duration : 0, width: existing ? existing.width : null, height: existing ? existing.height : null };
  if (!unchanged && (type === 'video' || type === 'audio')) {
    meta = await media.probe(filePath);
  }

  const thumbPath = cachePathFor(filePath, 'thumb.jpg');
  const spritePath = cachePathFor(filePath, 'sprite.jpg');

  if (!unchanged) {
    try {
      if (type === 'video') {
        await media.makeVideoThumb(filePath, thumbPath, meta.duration);
        media.makeVideoSprite(filePath, spritePath, meta.duration).then(() => {
          const it = store.patchItem(filePath, { spriteReady: true });
          if (it) send('item-updated', publicItem(it));
        }).catch(() => {});
      } else if (type === 'audio') {
        await media.makeAudioWave(filePath, thumbPath);
      } else if (type === 'image') {
        await media.makeImageThumb(filePath, thumbPath);
      }
    } catch (e) {
      // leave without thumb; UI shows placeholder
    }
  }

  const item = store.upsertItem({
    path: filePath,
    name: path.basename(filePath),
    ext: ext.toLowerCase(),
    type,
    size: stat.size,
    mtime: stat.mtimeMs,
    duration: meta.duration || 0,
    width: meta.width,
    height: meta.height,
    folderId,
    assetsReady: true,
    spriteReady: existing ? existing.spriteReady : false,
  });
  send('item-updated', publicItem(item));
}

function publicItem(item) {
  const thumbPath = cachePathFor(item.path, 'thumb.jpg');
  const spritePath = cachePathFor(item.path, 'sprite.jpg');
  return {
    path: item.path,
    name: item.name,
    ext: item.ext,
    type: item.type,
    size: item.size,
    duration: item.duration,
    width: item.width,
    height: item.height,
    folderId: item.folderId,
    favorite: !!item.favorite,
    color: item.color || null,
    tags: item.tags || [],
    thumb: fs.existsSync(thumbPath) ? fileUrl(thumbPath) : null,
    sprite: item.type === 'video' && item.spriteReady && fs.existsSync(spritePath) ? fileUrl(spritePath) : null,
    spriteCols: media.SPRITE_COLS,
    spriteRows: media.SPRITE_ROWS,
    spriteCount: media.SPRITE_COUNT,
    src: fileUrl(item.path),
  };
}

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20').replace(/#/g, '%23');
}

function scanFolder(folder) {
  const files = [];
  walkDir(folder.path, files);
  send('index-progress', { done: false, remaining: files.length });
  for (const f of files) {
    enqueue(() => indexFile(f, folder.id));
  }
  if (files.length === 0) send('index-progress', { done: true, remaining: 0 });
}

// ---------------- IPC ----------------
ipcMain.handle('get-state', () => {
  return {
    folders: store.getFolders(),
    items: store.allItems().map(publicItem),
  };
});

ipcMain.handle('add-folder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'] });
  if (res.canceled) return null;
  const added = [];
  for (const dir of res.filePaths) {
    const folder = store.addFolder(dir);
    added.push(folder);
    scanFolder(folder);
  }
  return added;
});

ipcMain.handle('rescan', async () => {
  for (const folder of store.getFolders()) scanFolder(folder);
  return true;
});

// Folders dropped onto the window from Explorer. Directories are added directly;
// dropped files add their containing folder.
ipcMain.handle('add-folders-by-path', (e, paths) => {
  const dirs = new Set();
  for (const p of (paths || [])) {
    try {
      const st = fs.statSync(p);
      dirs.add(st.isDirectory() ? p : path.dirname(p));
    } catch (_) { /* skip unreadable */ }
  }
  const added = [];
  for (const dir of dirs) {
    const folder = store.addFolder(dir);
    added.push(folder);
    scanFolder(folder);
  }
  return added;
});

ipcMain.handle('remove-folder', (e, folderId) => {
  store.removeFolder(folderId);
  return store.getFolders();
});

ipcMain.handle('remove-items', (e, paths) => {
  (paths || []).forEach((p) => store.removeItem(p));
  return true;
});

ipcMain.handle('toggle-favorite', (e, filePath) => {
  const item = store.getItem(filePath);
  if (!item) return null;
  const updated = store.patchItem(filePath, { favorite: !item.favorite });
  return publicItem(updated);
});

ipcMain.handle('set-color', (e, filePath, color) => {
  const updated = store.patchItem(filePath, { color: color || null });
  return updated ? publicItem(updated) : null;
});

ipcMain.handle('set-tags', (e, filePath, tags) => {
  const updated = store.patchItem(filePath, { tags: Array.isArray(tags) ? tags : [] });
  return updated ? publicItem(updated) : null;
});

ipcMain.handle('reveal', (e, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('export-clip', async (e, filePath, inPt, outPt) => {
  const item = store.getItem(filePath);
  const isVideo = item ? item.type === 'video' : true;
  const dur = Math.max(0.05, outPt - inPt);
  ensureDir(clipsDir);
  const base = path.basename(filePath, path.extname(filePath)).replace(/[^\w.-]+/g, '_');
  const stamp = `${Math.round(inPt * 1000)}-${Math.round(outPt * 1000)}`;

  let mode, ext;
  if (!isVideo) {
    mode = 'audio'; ext = path.extname(filePath) || '.wav';
  } else {
    const meta = await media.probe(filePath);
    if (media.hasAlpha(meta)) { mode = 'copy'; ext = path.extname(filePath) || '.mov'; } // keep transparency
    else { mode = 'h264'; ext = '.mp4'; }
  }
  const outPath = path.join(clipsDir, `${base}_${stamp}${ext}`);
  await media.exportClip(filePath, inPt, dur, outPath, mode);
  return outPath;
});

// Build (and cache) an H.264 proxy for sources the browser can't play (ProRes/alpha/MXF…).
ipcMain.handle('preview-proxy', async (e, filePath) => {
  ensureDir(previewDir);
  const out = path.join(previewDir, media.hashPath(filePath) + '.mp4');
  if (!fs.existsSync(out)) await media.makePreviewProxy(filePath, out);
  return fileUrl(out);
});

ipcMain.on('hide-window', () => { if (win) win.hide(); });

// OS-level drag of the REAL file(s) -> drops straight into the Premiere project/timeline.
ipcMain.on('drag-start', (e, paths) => {
  const arr = (Array.isArray(paths) ? paths : [paths]).filter((p) => p && fs.existsSync(p));
  if (!arr.length) return;

  const thumbPath = cachePathFor(arr[0], 'thumb.jpg');
  let icon;
  try {
    icon = fs.existsSync(thumbPath)
      ? nativeImage.createFromPath(thumbPath).resize({ width: 140 })
      : nativeImage.createEmpty();
  } catch (err) {
    icon = nativeImage.createEmpty();
  }
  if (icon.isEmpty()) {
    // startDrag requires a non-empty icon on most platforms; build a tiny fallback.
    icon = nativeImage.createFromBuffer(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ));
  }
  const item = arr.length > 1 ? { files: arr, icon } : { file: arr[0], icon };
  try {
    // On Windows startDrag runs a modal loop and BLOCKS until the drop completes.
    e.sender.startDrag(item);
    // Drag finished -> auto-hide so the user lands back in Premiere.
    if (process.platform === 'win32' && win && !win.isDestroyed()) win.hide();
  } catch (err) {
    console.error('startDrag failed:', err.message);
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0d0f14',
    title: 'ClipBay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Only allow one ClipBay instance — a second launch just focuses the running one.
// This also avoids userData cache locks (the "Unable to create cache" errors).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showAndFocus(); });

  app.whenReady().then(async () => {
    cacheDir = path.join(app.getPath('userData'), 'cache');
    clipsDir = path.join(app.getPath('userData'), 'clips');
    previewDir = path.join(app.getPath('userData'), 'preview');
    ensureDir(cacheDir);
    ensureDir(clipsDir);
    ensureDir(previewDir);
    store = new Store(path.join(app.getPath('userData'), 'clipbay-index.json'));

    const hasFfmpeg = await media.ffmpegAvailable();
    createWindow();
    win.webContents.once('did-finish-load', () => {
      if (!hasFfmpeg) send('ffmpeg-missing', true);
      // Auto-refresh on launch: picks up new files and regenerates missing previews.
      for (const f of store.getFolders()) scanFolder(f);
    });

    // Global launcher hotkey: toggle ClipBay from anywhere (e.g. while in Premiere).
    const reg = globalShortcut.register('CommandOrControl+Alt+C', toggleWindow);
    if (!reg) console.error('Globaler Shortcut Ctrl+Alt+C konnte nicht registriert werden.');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  if (store) store.flush();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
