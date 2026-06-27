const COLORS = {
  red: '#ff5a5a', orange: '#ff9f3a', yellow: '#ffce4d',
  green: '#4dd07a', blue: '#5b9cff', purple: '#b48cff', gray: '#8a93a6',
};

const state = {
  items: new Map(),   // path -> item
  folders: [],
  filter: 'all',
  colorFilter: null,
  search: '',
};

const grid = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const folderListEl = document.getElementById('folderList');
const statusEl = document.getElementById('status');
const audioEl = document.getElementById('audioEl');

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
function render() {
  const items = visibleItems();
  countEl.textContent = `${items.length} Asset${items.length === 1 ? '' : 's'}`;
  grid.innerHTML = '';
  emptyEl.classList.toggle('hidden', state.items.size > 0);

  for (const it of items) {
    grid.appendChild(buildCard(it));
  }
}

function buildCard(it) {
  const card = document.createElement('div');
  card.className = 'card';
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

  // star
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

  // badge (duration / dimensions)
  const badge = document.createElement('div');
  badge.className = 'badge';
  if (it.type === 'image') badge.textContent = it.width ? `${it.width}×${it.height}` : it.ext.replace('.', '');
  else badge.textContent = fmtDuration(it.duration) || it.ext.replace('.', '');
  thumb.appendChild(badge);

  // scrub indicator line
  const scrubLine = document.createElement('div');
  scrubLine.className = 'scrub-line';
  thumb.appendChild(scrubLine);

  wireThumbInteraction(thumb, scrubLine, it);
  wireDrag(thumb, card, it);

  // meta
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

// ---------------- hover scrubbing ----------------
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
      const ratio = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width));
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
    // Hover to scrub + listen; leave to stop.
    thumb.addEventListener('mousemove', (e) => {
      const rect = thumb.getBoundingClientRect();
      const ratio = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width));
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
  if (currentAudioPath !== it.path) {
    audioEl.src = it.src;
    currentAudioPath = it.path;
  }
  const seek = () => {
    if (audioEl.duration && isFinite(audioEl.duration)) {
      audioEl.currentTime = ratio * audioEl.duration;
    }
  };
  if (audioEl.readyState >= 1) seek();
  else audioEl.addEventListener('loadedmetadata', seek, { once: true });
  if (audioEl.paused) audioEl.play().catch(() => {});
}
function stopAudioFor(it) {
  if (currentAudioPath === it.path) {
    audioEl.pause();
  }
}

// ---------------- drag-out to Premiere ----------------
function wireDrag(thumb, card, it) {
  thumb.addEventListener('dragstart', (e) => {
    e.preventDefault();           // hand control to Electron's native drag
    card.classList.add('dragging');
    window.api.startDrag(it.path);
    setTimeout(() => card.classList.remove('dragging'), 400);
  });
}

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
    rm.className = 'remove'; rm.textContent = '×'; rm.title = 'Entfernen';
    rm.addEventListener('click', async () => {
      state.folders = await window.api.removeFolder(f.id);
      for (const [p, it] of state.items) if (it.folderId === f.id) state.items.delete(p);
      renderFolders(); render();
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

document.getElementById('rescanBtn').addEventListener('click', () => {
  window.api.rescan(); setBusy(true);
});

document.getElementById('search').addEventListener('input', (e) => {
  state.search = e.target.value; render();
});

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

window.api.onItemUpdated((item) => {
  state.items.set(item.path, item);
  // light-touch update: re-render (cheap for typical libraries)
  scheduleRender();
});

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

// ---------------- init ----------------
(async function init() {
  renderColorFilter();
  const st = await window.api.getState();
  state.folders = st.folders;
  for (const it of st.items) state.items.set(it.path, it);
  renderFolders();
  render();
})();
