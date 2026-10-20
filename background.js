// Service worker: starts the offscreen processor, triggers the ZIP download,
// and shows progress on the toolbar badge (so it works with the popup closed).

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');
let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Convert product images to 1080x1080 and build a ZIP file.'
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color: color || '#2563eb' });
  chrome.action.setBadgeText({ text });
}

function clearBadgeLater(ms) {
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), ms);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === 'START_DOWNLOAD') {
    badge('0');
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ ...msg, type: 'OFFSCREEN_PROCESS' }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        badge('!', '#dc2626');
        clearBadgeLater(4000);
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  if (msg.type === 'PROGRESS') {
    badge(String(msg.done));
    return false;
  }

  if (msg.type === 'DONE_BLOB') {
    chrome.downloads
      .download({ url: msg.blobUrl, filename: msg.filename, saveAs: false })
      .then(() => {
        badge('✓', '#16a34a');
        clearBadgeLater(4000);
        chrome.runtime
          .sendMessage({ type: 'JOB_FINISHED', jobId: msg.jobId, ok: msg.ok, failed: msg.failed })
          .catch(() => {});
      })
      .catch((e) => {
        badge('!', '#dc2626');
        clearBadgeLater(4000);
        chrome.runtime
          .sendMessage({ type: 'JOB_ERROR', jobId: msg.jobId, error: String(e) })
          .catch(() => {});
      });
    return false;
  }

  if (msg.type === 'JOB_ERROR') {
    badge('!', '#dc2626');
    clearBadgeLater(4000);
    return false;
  }

  return false;
});
