const COLORS = {
  red: '#ff5a5a', orange: '#ff9f3a', yellow: '#ffce4d',
  green: '#4dd07a', blue: '#5b9cff', purple: '#b48cff', gray: '#8a93a6',
};

const state = {
  items: new Map(),     // path -> item
  folders: [],
  filter: 'all',
  colorFilter: null,
  search: '',
  selection: new Set(), // selected paths
  lastClicked: null,    // for shift-range
  dirFilter: null,      // normalized directory path to show (null = all)
  expandedDirs: new Set(), // normalized dir paths that are expanded in the tree
};

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const baseName = (p) => norm(p).split('/').filter(Boolean).pop() || p;

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const folderListEl = document.getElementById('folderList');
const statusEl = document.getElementById('status');
const audioEl = document.getElementById('audioEl');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------- helpers ----------------
function fmtDuration(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  if (mb >= 1) return mb.toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}
function folderName(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return '';
  const parts = f.path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || f.path;
}

// ---------------- filtering ----------------
function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return [...state.items.values()].filter((it) => {
    if (state.filter === 'favorite' && !it.favorite) return false;
    if (['video', 'audio', 'image'].includes(state.filter) && it.type !== state.filter) return false;
    if (state.colorFilter && it.color !== state.colorFilter) return false;
    if (state.dirFilter) {
      const ip = norm(it.path);
      if (ip !== state.dirFilter && !ip.startsWith(state.dirFilter + '/')) return false;
    }
    if (q) {
      const hay = (it.name + ' ' + folderName(it.folderId) + ' ' + (it.tags || []).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------- rendering (virtualized) ----------------
let currentVisible = [];
const gridInner = document.getElementById('gridInner');
const GAP = 14, PAD = 16, BUFFER_ROWS = 3;
let layout = { cols: 1, cardW: 220, cardH: 200, rows: 0 };
let lastCardW = 0, lastCardH = 0;

function getCardSize() {
  return parseInt(sizeSlider.value, 10) || 220;
}

// Measure exact card height for a given width (constant per width since text is single-line).
function measureCardHeight(cardW) {
  if (cardW === lastCardW && lastCardH) return lastCardH;
  const sampleItem = currentVisible[0] || {
    path: '__sample__', name: 'Sample', ext: '.mp4', type: 'video', size: 0, duration: 0,
    folderId: '', favorite: false, color: null, tags: [], thumb: null,
    spriteCols: 5, spriteRows: 5, spriteCount: 25, src: '',
  };
  const sample = buildCard(sampleItem);
  sample.style.position = 'absolute'; sample.style.visibility = 'hidden';
  sample.style.left = '-9999px'; sample.style.top = '0'; sample.style.width = cardW + 'px';
  gridInner.appendChild(sample);
  const h = sample.offsetHeight || 200;
  sample.remove();
  lastCardW = cardW; lastCardH = h;
  return h;
}

function computeLayout() {
  const avail = Math.max(0, grid.clientWidth - PAD * 2);
  const cs = getCardSize();
  const cols = Math.max(1, Math.floor((avail + GAP) / (cs + GAP)));
  const cardW = Math.max(120, Math.floor((avail - (cols - 1) * GAP) / cols));
  const cardH = measureCardHeight(cardW);
  const rows = Math.ceil(currentVisible.length / cols);
  layout = { cols, cardW, cardH, rows };
  gridInner.style.height = (PAD * 2 + rows * cardH + Math.max(0, rows - 1) * GAP) + 'px';
}

// Render only the cards inside (or near) the viewport.
function renderWindow() {
  const { cols, cardW, cardH, rows } = layout;
  const rowStride = cardH + GAP;
  const scrollTop = grid.scrollTop;
  const vh = grid.clientHeight;
  const firstRow = Math.max(0, Math.floor((scrollTop - PAD) / rowStride) - BUFFER_ROWS);
  const lastRow = Math.min(rows - 1, Math.floor((scrollTop + vh - PAD) / rowStride) + BUFFER_ROWS);
  const start = firstRow * cols;
  const end = Math.min(currentVisible.length, (lastRow + 1) * cols);

  gridInner.innerHTML = '';
  for (let i = start; i < end; i++) {
    const it = currentVisible[i];
    if (!it) continue;
    const card = buildCard(it);
    const row = Math.floor(i / cols), col = i % cols;
    card.style.position = 'absolute';
    card.style.width = cardW + 'px';
    card.style.left = (PAD + col * (cardW + GAP)) + 'px';
    card.style.top = (PAD + row * rowStride) + 'px';
    gridInner.appendChild(card);
  }
}

function render() {
  currentVisible = visibleItems();
  for (const p of [...state.selection]) if (!state.items.has(p)) state.selection.delete(p);
  updateCount();
  emptyEl.classList.toggle('hidden', state.items.size > 0);
  computeLayout();
  renderWindow();
}

function renderTop() { grid.scrollTop = 0; render(); }

let scrollQueued = false;
grid.addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; renderWindow(); });
});
let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { lastCardW = 0; render(); }, 120); });

function updateCount() {
  const n = currentVisible.length;
  const sel = state.selection.size;
  countEl.textContent = sel > 0
    ? `${sel} ausgewählt · ${n} Asset${n === 1 ? '' : 's'}`
    : `${n} Asset${n === 1 ? '' : 's'}`;
}

function buildCard(it) {
  const card = document.createElement('div');
  card.className = 'card' + (state.selection.has(it.path) ? ' selected' : '');
  card.dataset.path = it.path;

  const colorbar = document.createElement('div');
  colorbar.className = 'colorbar';
  if (it.color) colorbar.style.background = COLORS[it.color] || it.color;

  const thumb = document.createElement('div');
  thumb.className = 'thumb' + (it.type === 'audio' ? ' audio' : '');
  thumb.draggable = true;
  if (it.thumb) thumb.style.backgroundImage = `url("${it.thumb}")`;
  else {
    const ph = document.createElement('div');
    ph.className = 'placeholder';
    ph.textContent = it.type === 'video' ? 'Vorschau wird erstellt…' : it.ext.toUpperCase();
    thumb.appendChild(ph);
  }

  const star = document.createElement('div');
  star.className = 'star' + (it.favorite ? ' on' : '');
  star.textContent = it.favorite ? '★' : '☆';
  star.title = 'Favorit';
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    const updated = await window.api.toggleFavorite(it.path);
    if (updated) { state.items.set(updated.path, updated); render(); }
  });
  thumb.appendChild(star);

  const badge = document.createElement('div');
  badge.className = 'badge';
  if (it.type === 'image') badge.textContent = it.width ? `${it.width}×${it.height}` : it.ext.replace('.', '');
  else badge.textContent = fmtDuration(it.duration) || it.ext.replace('.', '');
  thumb.appendChild(badge);

  const scrubLine = document.createElement('div');
  scrubLine.className = 'scrub-line';
  thumb.appendChild(scrubLine);

  wireThumbInteraction(thumb, scrubLine, it);
  wireCardSelection(card, thumb, it);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name'; name.textContent = it.name; name.title = it.name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.innerHTML = `<span>${folderName(it.folderId)}</span><span>${fmtSize(it.size)}</span>`;
  meta.appendChild(name);
  meta.appendChild(sub);
  meta.appendChild(buildColorDots(it));

  card.appendChild(colorbar);
  card.appendChild(thumb);
  card.appendChild(meta);
  return card;
}

function buildColorDots(it) {
  const dots = document.createElement('div');
  dots.className = 'dots';
  for (const [key, hex] of Object.entries(COLORS)) {
    const d = document.createElement('div');
    d.className = 'pick';
    d.style.background = hex;
    if (it.color === key) d.style.borderColor = '#fff';
    d.title = key;
    d.addEventListener('click', async (e) => {
      e.stopPropagation();
      const next = it.color === key ? null : key;
      const updated = await window.api.setColor(it.path, next);
      if (updated) { state.items.set(updated.path, updated); render(); }
    });
    dots.appendChild(d);
  }
  return dots;
}

// ---------------- grid hover scrubbing ----------------
function wireThumbInteraction(thumb, scrubLine, it) {
  if (it.type === 'video') {
    const cols = it.spriteCols, rows = it.spriteRows, count = it.spriteCount;
    let sprite = it.sprite;   // may be null until built lazily
    let requesting = false;
    thumb.addEventListener('mouseenter', async () => {
      if (!sprite && !requesting) {
        requesting = true;
        try { const url = await window.api.ensureSprite(it.path); if (url) { sprite = url; it.sprite = url; } } catch (_) {}
        requesting = false;
      }
      if (!sprite) return;
      thumb.style.backgroundImage = `url("${sprite}")`;
      thumb.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      scrubLine.style.display = 'block';
    });
    thumb.addEventListener('mousemove', (e) => {
      if (!sprite) return;
      const rect = thumb.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 0.999);
      const idx = Math.min(count - 1, Math.floor(ratio * count));
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      thumb.style.backgroundPositionX = cols > 1 ? `${(col / (cols - 1)) * 100}%` : '0%';
      thumb.style.backgroundPositionY = rows > 1 ? `${(row / (rows - 1)) * 100}%` : '0%';
      scrubLine.style.left = `${ratio * 100}%`;
    });
    thumb.addEventListener('mouseleave', () => {
      thumb.style.backgroundImage = it.thumb ? `url("${it.thumb}")` : '';
      thumb.style.backgroundSize = 'cover';
      thumb.style.backgroundPosition = 'center';
      scrubLine.style.display = 'none';
    });
  } else if (it.type === 'audio') {
    thumb.addEventListener('mousemove', (e) => {
      const rect = thumb.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 0.999);
      scrubLine.style.display = 'block';
      scrubLine.style.left = `${ratio * 100}%`;
      playAudioAt(it, ratio);
    });
    thumb.addEventListener('mouseleave', () => {
      scrubLine.style.display = 'none';
      stopAudioFor(it);
    });
  }
}

let currentAudioPath = null;
function playAudioAt(it, ratio) {
  if (currentAudioPath !== it.path) { audioEl.src = it.src; currentAudioPath = it.path; }
  const seek = () => { if (audioEl.duration && isFinite(audioEl.duration)) audioEl.currentTime = ratio * audioEl.duration; };
  if (audioEl.readyState >= 1) seek();
  else audioEl.addEventListener('loadedmetadata', seek, { once: true });
  if (audioEl.paused) audioEl.play().catch(() => {});
}
function stopAudioFor(it) { if (currentAudioPath === it.path) audioEl.pause(); }

// ---------------- selection + drag ----------------
function applySelectionClasses() {
  for (const card of gridInner.children) {
    card.classList.toggle('selected', state.selection.has(card.dataset.path));
  }
  updateCount();
}
function selectOnly(path) { state.selection = new Set([path]); state.lastClicked = path; applySelectionClasses(); }
function toggleSelect(path) {
  if (state.selection.has(path)) state.selection.delete(path); else state.selection.add(path);
  state.lastClicked = path; applySelectionClasses();
}
function selectRange(path) {
  const order = currentVisible.map((i) => i.path);
  const a = order.indexOf(state.lastClicked);
  const b = order.indexOf(path);
  if (a === -1 || b === -1) { selectOnly(path); return; }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) state.selection.add(order[i]);
  applySelectionClasses();
}
function selectAllVisible() {
  for (const it of currentVisible) state.selection.add(it.path);
  applySelectionClasses();
}
function clearSelection() { state.selection.clear(); applySelectionClasses(); }

// ---------------- context menu ----------------
let ctxEl = null;
function hideContextMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
function showContextMenu(x, y, items) {
  hideContextMenu();
  ctxEl = document.createElement('div');
  ctxEl.className = 'ctx-menu';
  for (const it of items) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; ctxEl.appendChild(s); continue; }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.danger ? ' danger' : '');
    row.textContent = it.label;
    row.addEventListener('click', () => { hideContextMenu(); it.action(); });
    ctxEl.appendChild(row);
  }
  document.body.appendChild(ctxEl);
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  ctxEl.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
}
window.addEventListener('click', hideContextMenu);
window.addEventListener('blur', hideContextMenu);
window.addEventListener('scroll', hideContextMenu, true);

function wireCardSelection(card, thumb, it) {
  card.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) toggleSelect(it.path);
    else if (e.shiftKey) selectRange(it.path);
    else selectOnly(it.path);
  });
  thumb.addEventListener('dblclick', () => openViewer(it));
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state.selection.has(it.path)) selectOnly(it.path);
    const n = state.selection.size;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Im Explorer anzeigen', action: () => window.api.reveal(it.path) },
      { label: 'Im Vorschaufenster öffnen', action: () => openViewer(it) },
      { sep: true },
      { label: n > 1 ? `${n} aus ClipBay entfernen` : 'Aus ClipBay entfernen', danger: true, action: () => deleteSelected() },
    ]);
  });
  thumb.addEventListener('dragstart', (e) => {
    e.preventDefault();
    if (!state.selection.has(it.path)) selectOnly(it.path);
    const paths = [...state.selection];
    card.classList.add('dragging');
    window.api.startDrag(paths.length ? paths : [it.path]);
    setTimeout(() => card.classList.remove('dragging'), 400);
  });
}

async function deleteSelected() {
  if (!state.selection.size) return;
  const n = state.selection.size;
  const ok = confirm(`${n} Clip${n === 1 ? '' : 's'} aus ClipBay entfernen?\n\nDie Dateien auf der Festplatte bleiben erhalten.`);
  if (!ok) return;
  await window.api.removeItems([...state.selection]);
  state.selection.clear();
  await reloadState();
}

grid.addEventListener('click', (e) => { if (e.target === grid || e.target === gridInner) clearSelection(); });

// ---------------- sidebar folder tree (Premiere-style) ----------------
// Build a directory tree from item paths, rooted at each added folder.
function buildTrees() {
  const roots = state.folders.map((f) => ({
    path: norm(f.path), name: baseName(f.path), folderId: f.id, children: new Map(), count: 0,
  }));
  for (const it of state.items.values()) {
    const ip = norm(it.path);
    const root = roots.find((r) => ip === r.path || ip.startsWith(r.path + '/'));
    if (!root) continue;
    const dir = ip.slice(0, ip.lastIndexOf('/'));
    let node = root; node.count++;
    if (dir.length > root.path.length) {
      const segs = dir.slice(root.path.length + 1).split('/');
      let acc = root.path;
      for (const seg of segs) {
        acc = acc + '/' + seg;
        let child = node.children.get(seg);
        if (!child) { child = { path: acc, name: seg, children: new Map(), count: 0 }; node.children.set(seg, child); }
        node = child; node.count++;
      }
    }
  }
  return roots;
}

function renderFolders() {
  folderListEl.innerHTML = '';

  // "Alle Ordner" reset entry
  const allLi = document.createElement('li');
  allLi.className = 'tree-row' + (state.dirFilter === null ? ' active' : '');
  allLi.innerHTML = `<span class="caret"></span><span class="fname">📁 Alle Ordner</span>`;
  allLi.addEventListener('click', () => { state.dirFilter = null; renderFolders(); renderTop(); });
  folderListEl.appendChild(allLi);

  for (const root of buildTrees()) renderTreeNode(root, 0, true);
}

function renderTreeNode(node, depth, isRoot) {
  const hasChildren = node.children.size > 0;
  const expanded = state.expandedDirs.has(node.path);

  const li = document.createElement('li');
  li.className = 'tree-row' + (state.dirFilter === node.path ? ' active' : '');
  li.style.paddingLeft = (8 + depth * 14) + 'px';

  const caret = document.createElement('span');
  caret.className = 'caret' + (hasChildren ? (expanded ? ' open' : ' closed') : '');
  caret.textContent = hasChildren ? (expanded ? '▾' : '▸') : '';
  caret.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hasChildren) return;
    if (expanded) state.expandedDirs.delete(node.path); else state.expandedDirs.add(node.path);
    renderFolders();
  });

  const name = document.createElement('span');
  name.className = 'fname';
  name.textContent = (isRoot ? '🗂 ' : '') + node.name;
  name.title = node.path;

  const count = document.createElement('span');
  count.className = 'fcount';
  count.textContent = node.count;

  li.appendChild(caret);
  li.appendChild(name);
  li.appendChild(count);

  if (isRoot) {
    const rm = document.createElement('button');
    rm.className = 'remove'; rm.textContent = '✕'; rm.title = 'Ordner aus ClipBay entfernen';
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = confirm(`Ordner aus ClipBay entfernen?\n\n${node.path}\n\nDeine Dateien auf der Festplatte bleiben unberührt.`);
      if (!ok) return;
      setBusy(true, 'Ordner wird entfernt…');
      if (state.dirFilter && (state.dirFilter === node.path || state.dirFilter.startsWith(node.path + '/'))) state.dirFilter = null;
      await window.api.removeFolder(node.folderId);
      await reloadState();
      setBusy(false, 'Bereit');
    });
    li.appendChild(rm);
  }

  li.addEventListener('click', () => { state.dirFilter = node.path; renderFolders(); renderTop(); });
  li.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    const items = [
      { label: 'Im Explorer öffnen', action: () => window.api.openPath(node.path) },
      { label: 'Nur diesen Ordner zeigen', action: () => { state.dirFilter = node.path; renderFolders(); renderTop(); } },
    ];
    if (isRoot) {
      items.push({ sep: true }, {
        label: 'Ordner aus ClipBay entfernen', danger: true, action: async () => {
          if (!confirm(`Ordner aus ClipBay entfernen?\n\n${node.path}\n\nDeine Dateien auf der Festplatte bleiben unberührt.`)) return;
          if (state.dirFilter && (state.dirFilter === node.path || state.dirFilter.startsWith(node.path + '/'))) state.dirFilter = null;
          setBusy(true, 'Ordner wird entfernt…');
          await window.api.removeFolder(node.folderId);
          await reloadState();
          setBusy(false, 'Bereit');
        },
      });
    }
    showContextMenu(e.clientX, e.clientY, items);
  });
  folderListEl.appendChild(li);

  if (hasChildren && expanded) {
    const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const child of kids) renderTreeNode(child, depth + 1, false);
  }
}

function renderColorFilter() {
  const wrap = document.getElementById('colorFilter');
  wrap.innerHTML = '';
  for (const [key, hex] of Object.entries(COLORS)) {
    const d = document.createElement('div');
    d.className = 'color-dot' + (state.colorFilter === key ? ' active' : '');
    d.style.background = hex; d.title = key;
    d.addEventListener('click', () => {
      state.colorFilter = state.colorFilter === key ? null : key;
      renderColorFilter(); renderTop();
    });
    wrap.appendChild(d);
  }
}

// ---------------- events ----------------
document.getElementById('addFolderBtn').addEventListener('click', async () => {
  const added = await window.api.addFolder();
  if (added) { state.folders = (await window.api.getState()).folders; renderFolders(); setBusy(true); }
});
document.getElementById('rescanBtn').addEventListener('click', () => { window.api.rescan(); setBusy(true); });
document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; renderTop(); });
document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderTop();
  });
});

function setBusy(busy, text) {
  statusEl.classList.toggle('busy', busy);
  statusEl.textContent = text || (busy ? 'Indiziere…' : 'Bereit');
}

window.api.onItemUpdated((item) => { state.items.set(item.path, item); scheduleRender(); });
window.api.onItemRemoved((p) => { if (state.items.delete(p)) { state.selection.delete(p); scheduleRender(); } });

// Throttle re-renders (max ~every 400ms) so big libraries indexing thousands of
// files stay responsive instead of rebuilding the grid every frame.
let lastRender = 0, renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  const since = performance.now() - lastRender;
  const delay = since > 400 ? 0 : 400 - since;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    lastRender = performance.now();
    render();
    renderFolders(); // keep the folder tree in sync with new/removed files
  }, delay);
}
window.api.onIndexProgress((p) => {
  if (p.done) setBusy(false, 'Bereit');
  else setBusy(true, `Indiziere… (${p.remaining} verbleibend)`);
});
window.api.onFfmpegMissing(() => {
  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.textContent = 'ffmpeg wurde nicht gefunden. Vorschauen können nicht erstellt werden. Bitte ffmpeg installieren (winget install Gyan.FFmpeg) und neu starten.';
  document.getElementById('main').prepend(banner);
});
window.api.onFocusSearch(() => {
  const s = document.getElementById('search');
  s.focus(); s.select();
});

async function reloadState() {
  const st = await window.api.getState();
  state.folders = st.folders;
  state.items = new Map();
  for (const it of st.items) state.items.set(it.path, it);
  for (const f of state.folders) state.expandedDirs.add(norm(f.path)); // roots expanded by default
  if (state.dirFilter && !state.folders.some((f) => state.dirFilter === norm(f.path) || state.dirFilter.startsWith(norm(f.path) + '/'))) {
    state.dirFilter = null;
  }
  renderFolders();
  render();
}

// ---------------- preview size slider ----------------
const sizeSlider = document.getElementById('sizeSlider');
sizeSlider.addEventListener('input', (e) => {
  try { localStorage.setItem('clipbay.cardSize', e.target.value); } catch (_) {}
  lastCardW = 0; // force re-measure of card height
  render();
});
(function initSize() {
  let px = 220;
  try { const saved = parseInt(localStorage.getItem('clipbay.cardSize'), 10); if (saved) px = saved; } catch (_) {}
  sizeSlider.value = String(px);
})();

// ---------------- drop folders into ClipBay ----------------
const dropZone = document.getElementById('dropZone');
let dropHideTimer = null;
function dragHasFiles(e) { return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); }
function showDrop() {
  dropZone.classList.remove('hidden');
  if (dropHideTimer) clearTimeout(dropHideTimer);
  dropHideTimer = setTimeout(hideDrop, 160); // self-heals if the drag ends off-window
}
function hideDrop() {
  if (dropHideTimer) { clearTimeout(dropHideTimer); dropHideTimer = null; }
  dropZone.classList.add('hidden');
}
// dragover fires continuously while over the window; the timer keeps it shown and
// auto-hides shortly after the cursor leaves or the drag is cancelled.
window.addEventListener('dragover', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; showDrop();
});
window.addEventListener('dragend', hideDrop);
window.addEventListener('drop', async (e) => {
  hideDrop();
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  setBusy(true, 'Ordner werden hinzugefügt…');
  await window.api.addFoldersByPath(paths);
  state.folders = (await window.api.getState()).folders;
  for (const f of state.folders) state.expandedDirs.add(norm(f.path));
  renderFolders();
});

// ---------------- global grid shortcuts ----------------
document.addEventListener('keydown', (e) => {
  if (!overlay.classList.contains('hidden')) return; // viewer handles its own keys
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (e.key === 'Escape') {
    if (ctxEl) { hideContextMenu(); return; }
    if (typing) { document.activeElement.blur(); return; }
    if (state.selection.size) clearSelection();
    else window.api.hideWindow();
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllVisible(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
});

// ================= Detail / Preview viewer =================
const overlay = document.getElementById('overlay');
const vStage = document.getElementById('vStage');
const vName = document.getElementById('vName');
const vPlay = document.getElementById('vPlay');
const vTimeEl = document.getElementById('vTime');
const vTimeline = document.getElementById('vTimeline');
const vPlayed = document.getElementById('vPlayed');
const vPlayhead = document.getElementById('vPlayhead');
const vRange = document.getElementById('vRange');
const vMarkIn = document.getElementById('vMarkIn');
const vMarkOut = document.getElementById('vMarkOut');
const vIO = document.getElementById('vIO');
const vSetIn = document.getElementById('vSetIn');
const vSetOut = document.getElementById('vSetOut');
const vClearIO = document.getElementById('vClearIO');
const vDragFull = document.getElementById('vDragFull');
const vDragClip = document.getElementById('vDragClip');

const viewer = { item: null, mediaEl: null, inPt: null, outPt: null, clipPath: null, fps: 30 };
let clipGen = 0;

function invalidateClip() { viewer.clipPath = null; clipGen++; vDragClip.disabled = true; }
function ensureClip() {
  const it = viewer.item;
  if (!it || it.type === 'image') return;
  if (viewer.inPt == null || viewer.outPt == null || !(viewer.outPt > viewer.inPt)) return;
  const my = ++clipGen;
  const inPt = viewer.inPt, outPt = viewer.outPt;
  setBusy(true, 'Schneide In/Out vor…');
  window.api.exportClip(it.path, inPt, outPt).then((p) => {
    if (my !== clipGen) return; // superseded by a newer in/out
    viewer.clipPath = p;
    vDragClip.disabled = false;
    setBusy(false, 'In/Out bereit – Bild greifen und in Premiere ziehen.');
  }).catch(() => { if (my === clipGen) setBusy(false, 'Fehler beim Ausschnitt.'); });
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function openViewer(it) {
  viewer.item = it; viewer.inPt = null; viewer.outPt = null; viewer.usingProxy = false;
  vName.textContent = it.name;
  vStage.innerHTML = '';
  overlay.classList.remove('hidden');
  invalidateClip();
  updateIOUi();

  if (it.type === 'image') {
    const img = document.createElement('img');
    img.src = it.src; img.draggable = true; img.style.cursor = 'grab';
    img.addEventListener('dragstart', (e) => { e.preventDefault(); window.api.startDrag([it.path]); });
    vStage.appendChild(img);
    viewer.mediaEl = null;
    setTransport(false);
    return;
  }

  let el, dragTarget;
  if (it.type === 'video') {
    el = document.createElement('video');
    el.src = it.src; el.controls = false;
    vStage.appendChild(el);
    dragTarget = el;
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'wave-big';
    if (it.thumb) { const im = document.createElement('img'); im.src = it.thumb; wrap.appendChild(im); }
    vStage.appendChild(wrap);
    el = document.createElement('audio');
    el.src = it.src;
    vStage.appendChild(el);
    dragTarget = wrap;
  }
  viewer.mediaEl = el;
  setTransport(true);

  el.addEventListener('loadedmetadata', () => {
    updateTransport(); updateIOUi();
    // Loaded but undecodable (e.g. ProRes) -> swap to proxy.
    if (it.type === 'video' && el.videoWidth === 0) maybeUseProxy(el);
  });
  if (it.type === 'video') el.addEventListener('error', () => maybeUseProxy(el), { once: true });
  el.addEventListener('timeupdate', onTimeUpdate);
  el.addEventListener('play', () => { vPlay.textContent = '❚❚ Pause'; });
  el.addEventListener('pause', () => { vPlay.textContent = '▶ Play'; });

  wireStage(dragTarget);
  el.play().catch(() => {});
}

// Chromium can't decode ProRes/alpha/MXF; build & play an H.264 proxy instead.
function maybeUseProxy(el) {
  if (!viewer.item || viewer.mediaEl !== el || viewer.usingProxy) return;
  viewer.usingProxy = true;
  setBusy(true, 'Vorschau wird konvertiert… (einmalig pro Datei)');
  window.api.previewProxy(viewer.item.path).then((url) => {
    if (viewer.mediaEl !== el) return; // viewer changed meanwhile
    el.src = url;
    el.load();
    el.play().catch(() => {});
    setBusy(false, 'Bereit');
  }).catch(() => setBusy(false, 'Vorschau-Konvertierung fehlgeschlagen.'));
}

function wireStage(target) {
  target.draggable = true;
  target.style.cursor = 'grab';
  // scrub by moving the mouse over the image while paused (Premiere-style jog)
  target.addEventListener('mousemove', (e) => {
    const el = viewer.mediaEl;
    if (!el || !el.paused || e.buttons !== 0 || !el.duration) return;
    const rect = target.getBoundingClientRect();
    seekTo(clamp((e.clientX - rect.left) / rect.width, 0, 1) * el.duration);
  });
  // plain click toggles play/pause
  target.addEventListener('click', () => togglePlay());
  // press + drag out = drag clip (In/Out if set) into Premiere
  target.addEventListener('dragstart', (e) => { e.preventDefault(); dragCurrentClip(); });
}

function dragCurrentClip() {
  const it = viewer.item; if (!it) return;
  if (it.type !== 'image' && viewer.inPt != null && viewer.outPt != null && viewer.outPt > viewer.inPt) {
    if (viewer.clipPath) { window.api.startDrag([viewer.clipPath]); return; }
    setBusy(true, 'Ausschnitt wird noch geschnitten – gleich nochmal ziehen.');
    ensureClip();
    return;
  }
  window.api.startDrag([it.path]);
}

function setTransport(enabled) {
  [vPlay, vSetIn, vSetOut, vClearIO].forEach((b) => { b.disabled = !enabled; });
  vTimeline.style.opacity = enabled ? '1' : '0.3';
}

function closeViewer() {
  if (viewer.mediaEl) { viewer.mediaEl.pause(); viewer.mediaEl.src = ''; }
  viewer.mediaEl = null;
  viewer.item = null;
  vStage.innerHTML = '';
  overlay.classList.add('hidden');
}

function onTimeUpdate() {
  const el = viewer.mediaEl;
  if (!el) return;
  if (viewer.outPt != null && !el.paused && el.currentTime >= viewer.outPt) {
    el.pause();
    el.currentTime = viewer.outPt;
  }
  updateTransport();
}

function updateTransport() {
  const el = viewer.mediaEl;
  if (!el || !el.duration || !isFinite(el.duration)) return;
  const ratio = el.currentTime / el.duration;
  vPlayed.style.width = `${ratio * 100}%`;
  vPlayhead.style.left = `${ratio * 100}%`;
  vTimeEl.textContent = `${fmtTime(el.currentTime)} / ${fmtTime(el.duration)}`;
}

function updateIOUi() {
  const el = viewer.mediaEl;
  const dur = el && el.duration && isFinite(el.duration) ? el.duration : (viewer.item ? viewer.item.duration : 0);
  const hasIn = viewer.inPt != null, hasOut = viewer.outPt != null;
  vMarkIn.style.display = hasIn ? 'block' : 'none';
  vMarkOut.style.display = hasOut ? 'block' : 'none';
  if (hasIn && dur) vMarkIn.style.left = `${(viewer.inPt / dur) * 100}%`;
  if (hasOut && dur) vMarkOut.style.left = `${(viewer.outPt / dur) * 100}%`;
  if (hasIn && hasOut && dur) {
    vRange.style.display = 'block';
    vRange.style.left = `${(viewer.inPt / dur) * 100}%`;
    vRange.style.width = `${((viewer.outPt - viewer.inPt) / dur) * 100}%`;
  } else {
    vRange.style.display = 'none';
  }
  vIO.textContent = (hasIn || hasOut)
    ? `In ${hasIn ? fmtTime(viewer.inPt) : '–'}  |  Out ${hasOut ? fmtTime(viewer.outPt) : '–'}`
    : '';
}

function seekTo(sec) {
  const el = viewer.mediaEl;
  if (!el || !el.duration) return;
  el.currentTime = clamp(sec, 0, el.duration);
  updateTransport();
}

function togglePlay() {
  const el = viewer.mediaEl; if (!el) return;
  if (el.paused) {
    if (viewer.inPt != null) {
      const out = viewer.outPt != null ? viewer.outPt : el.duration;
      if (el.currentTime < viewer.inPt || el.currentTime >= out - 0.02) el.currentTime = viewer.inPt;
    }
    el.play().catch(() => {});
  } else {
    el.pause();
  }
}

function setIn() {
  const el = viewer.mediaEl; if (!el) return;
  viewer.inPt = el.currentTime;
  if (viewer.outPt != null && viewer.outPt <= viewer.inPt) viewer.outPt = null;
  invalidateClip(); updateIOUi(); ensureClip();
}
function setOut() {
  const el = viewer.mediaEl; if (!el) return;
  viewer.outPt = el.currentTime;
  if (viewer.inPt != null && viewer.inPt >= viewer.outPt) viewer.inPt = null;
  invalidateClip(); updateIOUi(); ensureClip();
}

// timeline: click or drag the playhead
let tlScrub = { active: false, wasPlaying: false };
function timelineSeek(clientX) {
  const el = viewer.mediaEl; if (!el || !el.duration) return;
  const rect = vTimeline.getBoundingClientRect();
  seekTo(clamp((clientX - rect.left) / rect.width, 0, 1) * el.duration);
}
vTimeline.addEventListener('mousedown', (e) => {
  const el = viewer.mediaEl; if (!el) return;
  e.preventDefault();
  tlScrub.active = true;
  tlScrub.wasPlaying = !el.paused;
  el.pause();
  timelineSeek(e.clientX);
});
document.addEventListener('mousemove', (e) => { if (tlScrub.active) timelineSeek(e.clientX); });
document.addEventListener('mouseup', () => {
  if (!tlScrub.active) return;
  tlScrub.active = false;
  const el = viewer.mediaEl;
  if (el && tlScrub.wasPlaying) el.play().catch(() => {});
});

vPlay.addEventListener('click', togglePlay);
vSetIn.addEventListener('click', setIn);
vSetOut.addEventListener('click', setOut);
vClearIO.addEventListener('click', () => { viewer.inPt = null; viewer.outPt = null; invalidateClip(); updateIOUi(); });
document.getElementById('vClose').addEventListener('click', closeViewer);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeViewer(); });

vDragFull.addEventListener('dragstart', (e) => { e.preventDefault(); if (viewer.item) window.api.startDrag([viewer.item.path]); });
vDragClip.addEventListener('dragstart', (e) => { e.preventDefault(); if (viewer.clipPath) window.api.startDrag([viewer.clipPath]); });

// viewer keyboard
document.addEventListener('keydown', (e) => {
  if (overlay.classList.contains('hidden')) return;
  const el = viewer.mediaEl;
  if (e.key === 'Escape') { closeViewer(); return; }
  if (!el) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key.toLowerCase() === 'i') { setIn(); }
  else if (e.key.toLowerCase() === 'o') { setOut(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(el.currentTime - 1 / viewer.fps); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(el.currentTime + 1 / viewer.fps); }
});

// ---------------- init ----------------
(async function init() {
  renderColorFilter();
  await reloadState();
})();
