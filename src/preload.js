const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Resolve the absolute path of a dropped File (File.path is removed in newer Electron).
function pathForFile(file) {
  try { if (webUtils && webUtils.getPathForFile) return webUtils.getPathForFile(file); } catch (_) {}
  return file && file.path ? file.path : null;
}

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  addFoldersByPath: (paths) => ipcRenderer.invoke('add-folders-by-path', paths),
  getPathForFile: (file) => pathForFile(file),
  removeFolder: (id) => ipcRenderer.invoke('remove-folder', id),
  removeItems: (paths) => ipcRenderer.invoke('remove-items', paths),
  rescan: () => ipcRenderer.invoke('rescan'),
  toggleFavorite: (p) => ipcRenderer.invoke('toggle-favorite', p),
  setColor: (p, color) => ipcRenderer.invoke('set-color', p, color),
  setTags: (p, tags) => ipcRenderer.invoke('set-tags', p, tags),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  exportClip: (p, inPt, outPt) => ipcRenderer.invoke('export-clip', p, inPt, outPt),
  previewProxy: (p) => ipcRenderer.invoke('preview-proxy', p),
  ensureSprite: (p) => ipcRenderer.invoke('ensure-sprite', p),
  startDrag: (paths) => ipcRenderer.send('drag-start', paths),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onItemUpdated: (cb) => ipcRenderer.on('item-updated', (e, item) => cb(item)),
  onItemRemoved: (cb) => ipcRenderer.on('item-removed', (e, p) => cb(p)),
  onIndexProgress: (cb) => ipcRenderer.on('index-progress', (e, p) => cb(p)),
  onFfmpegMissing: (cb) => ipcRenderer.on('ffmpeg-missing', (e, v) => cb(v)),
  onFocusSearch: (cb) => ipcRenderer.on('focus-search', () => cb()),
});
