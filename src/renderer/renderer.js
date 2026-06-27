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
};

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

// ---------------- rendering ----------------
let currentVisible = [];
function render() {
  currentVisible = visibleItems();
  // prune selection to visible+existing
  for (const p of [...state.selection]) if (!state.items.has(p)) state.selection.delete(p);
  updateCount();
  grid.innerHTML = '';
  emptyEl.classList.toggle('hidden', state.items.size > 0);
  for (const it of currentVisible) grid.appendChild(buildCard(it));
}

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
  if (it.type === 'video' && it.sprite) {
    const cols = it.spriteCols, rows = it.spriteRows, count = it.spriteCount;
    thumb.addEventListener('mouseenter', () => {
      thumb.style.backgroundImage = `url("${it.sprite}")`;
      thumb.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      scrubLine.style.display = 'block';
    });
    thumb.addEventListener('mousemove', (e) => {
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
  for (const card of grid.children) {
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

function wireCardSelection(card, thumb, it) {
  card.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) toggleSelect(it.path);
    else if (e.shiftKey) selectRange(it.path);
    else selectOnly(it.path);
  });
  thumb.addEventListener('dblclick', () => openViewer(it));
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

grid.addEventListener('click', (e) => { if (e.target === grid) clearSelection(); });

// ---------------- sidebar ----------------
function renderFolders() {
  folderListEl.innerHTML = '';
  for (const f of state.folders) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = f.path.split(/[\\/]/).filter(Boolean).pop() || f.path;
    name.title = f.path;
    const rm = document.createElement('button');
    rm.className = 'remove'; rm.textContent = '✕'; rm.title = 'Ordner aus ClipBay entfernen';
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = confirm(`Ordner aus ClipBay entfernen?\n\n${f.path}\n\nDeine Dateien auf der Festplatte bleiben unberührt.`);
      if (!ok) return;
      setBusy(true, 'Ordner wird entfernt…');
      await window.api.removeFolder(f.id);
      await reloadState();
      setBusy(false, 'Bereit');
    });
    li.appendChild(name); li.appendChild(rm);
    folderListEl.appendChild(li);
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
      renderColorFilter(); render();
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
document.getElementById('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    render();
  });
});

function setBusy(busy, text) {
  statusEl.classList.toggle('busy', busy);
  statusEl.textContent = text || (busy ? 'Indiziere…' : 'Bereit');
}

window.api.onItemUpdated((item) => { state.items.set(item.path, item); scheduleRender(); });
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
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
  renderFolders();
  render();
}

// ---------------- preview size slider ----------------
const sizeSlider = document.getElementById('sizeSlider');
function applyCardSize(px) { grid.style.setProperty('--card-size', px + 'px'); }
sizeSlider.addEventListener('input', (e) => {
  const px = parseInt(e.target.value, 10);
  applyCardSize(px);
  try { localStorage.setItem('clipbay.cardSize', String(px)); } catch (_) {}
});
(function initSize() {
  let px = 220;
  try { const saved = parseInt(localStorage.getItem('clipbay.cardSize'), 10); if (saved) px = saved; } catch (_) {}
  sizeSlider.value = String(px);
  applyCardSize(px);
})();

// ---------------- global grid shortcuts ----------------
document.addEventListener('keydown', (e) => {
  if (!overlay.classList.contains('hidden')) return; // viewer handles its own keys
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (e.key === 'Escape') {
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
  viewer.item = it; viewer.inPt = null; viewer.outPt = null;
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

  el.addEventListener('loadedmetadata', () => { updateTransport(); updateIOUi(); });
  el.addEventListener('timeupdate', onTimeUpdate);
  el.addEventListener('play', () => { vPlay.textContent = '❚❚ Pause'; });
  el.addEventListener('pause', () => { vPlay.textContent = '▶ Play'; });

  wireStage(dragTarget);
  el.play().catch(() => {});
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
