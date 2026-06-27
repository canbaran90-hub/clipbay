const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
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
let win;

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
  const unchanged = existing && existing.mtime === stat.mtimeMs && existing.assetsReady;

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

ipcMain.handle('remove-folder', (e, folderId) => {
  store.removeFolder(folderId);
  return store.getFolders();
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
  const ext = isVideo ? '.mp4' : path.extname(filePath);
  const outPath = path.join(clipsDir, `${base}_${stamp}${ext}`);
  await media.exportClip(filePath, inPt, dur, outPath, isVideo);
  return outPath;
});

// OS-level drag of the REAL file -> drops straight into the Premiere project/timeline.
ipcMain.on('drag-start', (e, filePath) => {
  const thumbPath = cachePathFor(filePath, 'thumb.jpg');
  let icon;
  try {
    icon = fs.existsSync(thumbPath)
      ? nativeImage.createFromPath(thumbPath).resize({ width: 120 })
      : nativeImage.createEmpty();
  } catch (err) {
    icon = nativeImage.createEmpty();
  }
  if (icon.isEmpty()) {
    // startDrag requires a non-empty icon on most platforms; build a 1x1 fallback.
    icon = nativeImage.createFromBuffer(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ));
  }
  e.sender.startDrag({ file: filePath, icon });
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

app.whenReady().then(async () => {
  cacheDir = path.join(app.getPath('userData'), 'cache');
  clipsDir = path.join(app.getPath('userData'), 'clips');
  ensureDir(cacheDir);
  ensureDir(clipsDir);
  store = new Store(path.join(app.getPath('userData'), 'clipbay-index.json'));

  const hasFfmpeg = await media.ffmpegAvailable();
  createWindow();
  win.webContents.once('did-finish-load', () => {
    if (!hasFfmpeg) send('ffmpeg-missing', true);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (store) store.flush();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
