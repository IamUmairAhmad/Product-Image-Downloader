const $ = (id) => document.getElementById(id);

let images = [];
let title = '';
let selected = new Set();
let currentJob = null;

function slugify(s) {
  const slug = (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'product-images';
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

async function loadSettings() {
  const s = await chrome.storage.local.get({ mode: 'fit', format: 'jpg' });
  $('mode').value = s.mode;
  $('format').value = s.format;
}

function saveSettings() {
  chrome.storage.local.set({ mode: $('mode').value, format: $('format').value });
}

async function scan() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
    $('siteBadge').textContent = 'N/A';
    setStatus('Open a product page (http/https) and click the extension again.', true);
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['extractor.js'] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => window.__pidExtract()
    });
    const r = res && res.result;
    if (!r) throw new Error('No result from page');
    images = r.images || [];
    title = r.title || tab.title || '';
    $('siteBadge').textContent = r.site;
    if (!images.length) {
      setStatus('No product images found on this page.', true);
      return;
    }
    setStatus(`Found ${images.length} image${images.length === 1 ? '' : 's'}.`);
    $('actions').hidden = false;
  } catch (e) {
    $('siteBadge').textContent = 'Error';
    setStatus('Could not read this page: ' + (e && e.message ? e.message : e), true);
  }
}

function renderGrid() {
  const grid = $('grid');
  grid.textContent = '';
  images.forEach((img, i) => {
    const tile = document.createElement('label');
    tile.className = 'tile' + (selected.has(i) ? ' on' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(i);
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(i) : selected.delete(i);
      tile.classList.toggle('on', cb.checked);
      updateCount();
    });

    const im = document.createElement('img');
    im.referrerPolicy = 'no-referrer';
    im.loading = 'lazy';
    im.src = img.url;
    let tried = 0;
    im.addEventListener('error', () => {
      if (img.fallbacks && tried < img.fallbacks.length) im.src = img.fallbacks[tried++];
      else tile.classList.add('broken');
    });

    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(i + 1);

    tile.append(cb, im, n);
    grid.appendChild(tile);
  });
  updateCount();
}

function updateCount() {
  $('selCount').textContent = `${selected.size} of ${images.length} selected`;
  $('btnSelected').disabled = selected.size === 0;
  $('btnSelected').textContent = selected.size ? `Download selected (${selected.size})` : 'Download selected';
}

function setBusy(busy) {
  ['btnAll', 'btnSelect', 'btnSelected'].forEach((id) => ($(id).disabled = busy || (id === 'btnSelected' && selected.size === 0)));
}

async function startDownload(list) {
  if (!list.length) return;
  saveSettings();
  currentJob = String(Date.now());
  setBusy(true);
  $('progress').hidden = false;
  $('barFill').style.width = '0%';
  $('progressText').textContent = `Processing 0 / ${list.length}…`;

  const res = await chrome.runtime.sendMessage({
    type: 'START_DOWNLOAD',
    jobId: currentJob,
    images: list,
    slug: slugify(title),
    mode: $('mode').value,
    format: $('format').value
  });
  if (!res || !res.ok) {
    setStatus('Could not start: ' + ((res && res.error) || 'unknown error'), true);
    setBusy(false);
    $('progress').hidden = true;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.jobId !== currentJob) return;
  if (msg.type === 'PROGRESS') {
    $('barFill').style.width = Math.round((msg.done / msg.total) * 100) + '%';
    $('progressText').textContent = `Processing ${msg.done} / ${msg.total}…`;
  } else if (msg.type === 'JOB_FINISHED') {
    $('barFill').style.width = '100%';
    const skipped = (msg.failed || []).length;
    $('progressText').textContent =
      `Done — ${msg.ok} image${msg.ok === 1 ? '' : 's'} saved to ZIP` + (skipped ? ` (${skipped} could not be fetched)` : '.');
    setBusy(false);
    currentJob = null;
  } else if (msg.type === 'JOB_ERROR') {
    $('progress').hidden = true;
    setStatus(msg.error || 'Download failed.', true);
    setBusy(false);
    currentJob = null;
  }
});

$('btnAll').addEventListener('click', () => startDownload(images));

$('btnSelect').addEventListener('click', () => {
  const sel = $('selector');
  sel.hidden = !sel.hidden;
  if (!sel.hidden) {
    if (!selected.size) images.forEach((_, i) => selected.add(i));
    renderGrid();
  }
});

$('selAll').addEventListener('click', () => {
  images.forEach((_, i) => selected.add(i));
  renderGrid();
});
$('selNone').addEventListener('click', () => {
  selected.clear();
  renderGrid();
});
$('btnSelected').addEventListener('click', () => startDownload(images.filter((_, i) => selected.has(i))));
$('mode').addEventListener('change', saveSettings);
$('format').addEventListener('change', saveSettings);

loadSettings().then(scan);
