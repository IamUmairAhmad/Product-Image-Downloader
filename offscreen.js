// Runs in an offscreen document so work continues even if the popup is closed.
// Fetches each image, converts it to a 1080x1080 canvas, and packs a ZIP.

const SIZE = 1080;
const CONCURRENCY = 4;

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function fetchBitmap(item) {
  const candidates = [item.url, ...(item.fallbacks || [])];
  for (const u of candidates) {
    try {
      const res = await fetch(u, { credentials: 'omit' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size < 200) continue;
      return await createImageBitmap(blob);
    } catch (e) {
      // try next candidate
    }
  }
  return null;
}

async function toSquare(bitmap, mode, format) {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const w = bitmap.width;
  const h = bitmap.height;
  // fit  = whole image visible, white padding (no distortion, no cropping)
  // fill = square crop that covers the canvas (no padding, edges may be cut)
  const scale = mode === 'fill' ? Math.max(SIZE / w, SIZE / h) : Math.min(SIZE / w, SIZE / h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  ctx.drawImage(bitmap, Math.round((SIZE - dw) / 2), Math.round((SIZE - dh) / 2), dw, dh);

  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await canvas.convertToBlob({ type, quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function runJob({ jobId, images, slug, mode, format }) {
  const total = images.length;
  const results = new Array(total).fill(null);
  const failed = [];
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < total) {
      const i = next++;
      try {
        const bmp = await fetchBitmap(images[i]);
        if (!bmp) throw new Error('fetch failed');
        results[i] = await toSquare(bmp, mode, format);
        bmp.close && bmp.close();
      } catch (e) {
        failed.push(images[i].url);
      }
      done++;
      send({ type: 'PROGRESS', jobId, done, total });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  const ext = format === 'png' ? 'png' : 'jpg';
  const files = [];
  results.forEach((data) => {
    if (data) {
      const n = String(files.length + 1).padStart(2, '0');
      files.push({ name: `${slug}-${n}.${ext}`, data });
    }
  });

  if (!files.length) {
    send({ type: 'JOB_ERROR', jobId, error: 'None of the images could be downloaded.' });
    return;
  }

  const blob = new Blob(PIDZip.buildZipParts(files), { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(blob);
  send({
    type: 'DONE_BLOB',
    jobId,
    blobUrl,
    filename: `${slug}-1080x1080.zip`,
    ok: files.length,
    failed
  });
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'OFFSCREEN_PROCESS') {
    sendResponse({ started: true });
    runJob(msg).catch((e) => send({ type: 'JOB_ERROR', jobId: msg.jobId, error: String(e) }));
  }
  return false;
});
