const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  removeFolder: (id) => ipcRenderer.invoke('remove-folder', id),
  rescan: () => ipcRenderer.invoke('rescan'),
  toggleFavorite: (p) => ipcRenderer.invoke('toggle-favorite', p),
  setColor: (p, color) => ipcRenderer.invoke('set-color', p, color),
  setTags: (p, tags) => ipcRenderer.invoke('set-tags', p, tags),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  exportClip: (p, inPt, outPt) => ipcRenderer.invoke('export-clip', p, inPt, outPt),
  startDrag: (p) => ipcRenderer.send('drag-start', p),
  onItemUpdated: (cb) => ipcRenderer.on('item-updated', (e, item) => cb(item)),
  onIndexProgress: (cb) => ipcRenderer.on('index-progress', (e, p) => cb(p)),
  onFfmpegMissing: (cb) => ipcRenderer.on('ffmpeg-missing', (e, v) => cb(v)),
});
