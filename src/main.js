const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, globalShortcut, screen } = require('electron');
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
// We never hide synchronously during a drag (that cancels it). Instead we "arm"
// on drag-start and hide only once the window loses focus (= the drop landed in
// another app), with a short delay so we never hide mid-drag.
let dragArmed = false;
let dragArmedAt = 0;
let dragArmTimer = null;

function armDragHide() {
  dragArmed = true;
  dragArmedAt = Date.now();
  if (dragArmTimer) clearTimeout(dragArmTimer);
  dragArmTimer = setTimeout(() => { dragArmed = false; }, 6000);
}

function showAndFocus() {
  dragArmed = false;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  // No centering: reappear where the user last left it (e.g. docked to one side).
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
let scanning = 0; // number of in-flight directory walks
const MAX_CONCURRENT = 4;

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
        if (queue.length === 0 && active === 0 && scanning === 0) {
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

// Does this file actually need (re)indexing? Skips files that are already done so
// re-scans of huge libraries only do real work (no 14k-item queue / IPC flood).
async function needsIndex(filePath) {
  const existing = store.getItem(filePath);
  if (!existing || !existing.assetsReady) return true;
  if (!fs.existsSync(cachePathFor(filePath, 'thumb.jpg'))) return true; // missing preview
  try {
    const st = await fs.promises.stat(filePath);
    if (st.mtimeMs !== existing.mtime) return true; // changed
  } catch (e) {
    return false; // unreadable -> leave as is
  }
  return false;
}

// Async, non-blocking recursive walk. Enqueues only files that need work and
// yields to the event loop between directories so the UI never freezes.
async function walkAndEnqueue(dir, folderId) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkAndEnqueue(full, folderId);
    } else if (e.isFile() && typeForExt(path.extname(e.name))) {
      if (await needsIndex(full)) enqueue(() => indexFile(full, folderId));
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
        // Only the cheap single-frame thumbnail at index time. The 25-frame
        // hover-scrub sprite is built lazily on first hover (ensure-sprite),
        // which keeps indexing of huge libraries fast.
        await media.makeVideoThumb(filePath, thumbPath, meta.duration);
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

async function scanFolder(folder) {
  scanning++;
  send('index-progress', { done: false, remaining: queue.length + active + 1 });
  try {
    await walkAndEnqueue(folder.path, folder.id);
  } finally {
    scanning--;
    if (queue.length === 0 && active === 0 && scanning === 0) {
      send('index-progress', { done: true, remaining: 0 });
    }
  }
}

// ---- live file watching (keeps ClipBay in sync with Explorer) ----
const watchers = new Map();        // folderId -> FSWatcher
const watchDebounce = new Map();   // fullPath -> timer

function handleFsEvent(folder, filename) {
  if (!filename) return;
  const full = path.join(folder.path, filename);
  if (watchDebounce.has(full)) clearTimeout(watchDebounce.get(full));
  watchDebounce.set(full, setTimeout(() => {
    watchDebounce.delete(full);
    fs.stat(full, (err, st) => {
      if (err) {
        // deleted or moved away -> drop it from ClipBay
        if (store.getItem(full)) { store.removeItem(full); send('item-removed', full); }
        return;
      }
      if (st.isFile() && typeForExt(path.extname(full))) {
        enqueue(() => indexFile(full, folder.id));   // new/changed -> (re)index
      }
    });
  }, 400));
}

function startWatching(folder) {
  if (watchers.has(folder.id)) return;
  try {
    const w = fs.watch(folder.path, { recursive: true }, (evt, filename) => handleFsEvent(folder, filename));
    w.on('error', () => {});
    watchers.set(folder.id, w);
  } catch (e) {
    console.error('watch failed for', folder.path, e.message);
  }
}

function stopWatching(folderId) {
  const w = watchers.get(folderId);
  if (w) { try { w.close(); } catch (_) {} watchers.delete(folderId); }
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
    startWatching(folder);
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
    startWatching(folder);
  }
  return added;
});

ipcMain.handle('remove-folder', (e, folderId) => {
  stopWatching(folderId);
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

ipcMain.handle('open-path', (e, p) => shell.openPath(p));

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

// Build (and cache) the hover-scrub sprite on demand (first hover).
ipcMain.handle('ensure-sprite', async (e, filePath) => {
  const item = store.getItem(filePath);
  if (!item || item.type !== 'video') return null;
  const spritePath = cachePathFor(filePath, 'sprite.jpg');
  try {
    if (!fs.existsSync(spritePath)) {
      ensureDir(path.dirname(spritePath));
      const dur = item.duration || (await media.probe(filePath)).duration;
      await media.makeVideoSprite(filePath, spritePath, dur);
    }
    if (!item.spriteReady) store.patchItem(filePath, { spriteReady: true });
    return fileUrl(spritePath);
  } catch (err) {
    return null;
  }
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
    armDragHide();            // arm BEFORE the drag so the drop-time blur is caught
    e.sender.startDrag(item); // do NOT hide here — that would cancel the drag
  } catch (err) {
    console.error('startDrag failed:', err.message);
  }
});

// Remember window position/size so the shortcut reopens it where the user left it.
function windowStateFile() { return path.join(app.getPath('userData'), 'clipbay-window.json'); }
function loadBounds() { try { return JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')); } catch (_) { return null; } }
let saveBoundsTimer = null;
function saveBounds() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  try { fs.writeFileSync(windowStateFile(), JSON.stringify(win.getBounds())); } catch (_) {}
}
function scheduleSaveBounds() { if (saveBoundsTimer) clearTimeout(saveBoundsTimer); saveBoundsTimer = setTimeout(saveBounds, 500); }
function boundsOnScreen(b) {
  if (!b || b.x == null || b.y == null) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 60 && b.x + (b.width || 0) > a.x + 60 &&
           b.y < a.y + a.height - 40 && b.y + (b.height || 0) > a.y + 10;
  });
}

function createWindow() {
  const b = loadBounds();
  const useB = boundsOnScreen(b);
  win = new BrowserWindow({
    width: (b && b.width) || 1280,
    height: (b && b.height) || 820,
    x: useB ? b.x : undefined,
    y: useB ? b.y : undefined,
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

  win.on('move', scheduleSaveBounds);
  win.on('resize', scheduleSaveBounds);
  win.on('close', saveBounds);

  // Auto-hide after a drag: only once focus is lost (drop landed in Premiere),
  // and only if at least 250ms passed since drag-start (never mid-drag).
  win.on('blur', () => {
    if (dragArmed && Date.now() - dragArmedAt > 250) {
      dragArmed = false;
      if (dragArmTimer) clearTimeout(dragArmTimer);
      win.hide();
    }
  });
  win.on('focus', () => { dragArmed = false; });

  // Reload shortcuts handled in the main process, so they work even if the
  // renderer is busy: Ctrl/Cmd+R and F5 reload the window.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    if (k === 'f5' || ((input.control || input.meta) && k === 'r')) {
      event.preventDefault();
      win.webContents.reload();
    }
  });
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
      // Auto-refresh on launch + keep watching for Explorer changes.
      for (const f of store.getFolders()) { scanFolder(f); startWatching(f); }
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
