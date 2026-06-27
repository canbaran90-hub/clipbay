// Lightweight JSON-backed index. No native deps so it runs everywhere.
// For very large libraries this can later be swapped for SQLite.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { folders: [], items: {} };
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        folders: Array.isArray(parsed.folders) ? parsed.folders : [],
        items: parsed.items && typeof parsed.items === 'object' ? parsed.items : {},
      };
    } catch (e) {
      // first run or corrupt: start fresh
      this.data = { folders: [], items: {} };
    }
  }

  // Debounced write so rapid indexing doesn't hammer disk.
  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, 400);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  // --- folders ---
  getFolders() {
    return this.data.folders;
  }

  addFolder(folderPath) {
    const existing = this.data.folders.find((f) => f.path === folderPath);
    if (existing) return existing;
    const folder = { id: 'f_' + Buffer.from(folderPath).toString('hex').slice(0, 16), path: folderPath };
    this.data.folders.push(folder);
    this.save();
    return folder;
  }

  removeFolder(folderId) {
    this.data.folders = this.data.folders.filter((f) => f.id !== folderId);
    for (const key of Object.keys(this.data.items)) {
      if (this.data.items[key].folderId === folderId) delete this.data.items[key];
    }
    this.save();
  }

  // --- items ---
  getItem(filePath) {
    return this.data.items[filePath];
  }

  upsertItem(item) {
    const prev = this.data.items[item.path] || {};
    // preserve user metadata across re-scans
    this.data.items[item.path] = {
      ...prev,
      ...item,
      favorite: prev.favorite || false,
      color: prev.color || null,
      tags: prev.tags || [],
    };
    this.save();
    return this.data.items[item.path];
  }

  patchItem(filePath, patch) {
    const item = this.data.items[filePath];
    if (!item) return null;
    Object.assign(item, patch);
    this.save();
    return item;
  }

  removeItem(filePath) {
    delete this.data.items[filePath];
    this.save();
  }

  allItems() {
    return Object.values(this.data.items);
  }
}

module.exports = { Store };
