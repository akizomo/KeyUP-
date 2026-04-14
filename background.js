// Key↑ background service worker.
// - Owns the offscreen audio document.
// - Proxies chrome.storage for the offscreen document (which has no storage
//   API access).

const OFFSCREEN_URL = 'offscreen.html';

const DEFAULT_SETTINGS = {
  volume: 0.7,
  typingSE: true,
  clickSE: true,
  invincibleBGM: true,
  activeTheme: 'fighting',
};

// --- offscreen lifecycle ---
async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return contexts.length > 0;
  }
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  return false;
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification:
        'Play Key↑ typing SE and invincible BGM independent of page navigation.',
    })
    .catch((e) => {
      console.warn('[Key↑] offscreen create failed', e);
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...stored });
  });
  ensureOffscreen();
});
chrome.runtime.onStartup.addListener(ensureOffscreen);

// --- message router ---
function todayKey() {
  const d = new Date();
  return `stats_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content-script event → wake offscreen, then relay.
  if (msg && msg.target === 'keyup-relay') {
    (async () => {
      await ensureOffscreen();
      try {
        await chrome.runtime.sendMessage({
          ...msg,
          target: 'keyup-offscreen',
        });
      } catch (e) {
        console.warn('[Key↑ SW] relay failed', e);
      }
    })();
    return false;
  }

  // Offscreen-initiated requests that need chrome.storage access.
  if (!msg || msg.target !== 'keyup-sw') return false;

  if (msg.type === 'get-settings') {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      sendResponse({ ...DEFAULT_SETTINGS, ...stored });
    });
    return true; // keep channel open for async response
  }

  if (msg.type === 'set-level') {
    chrome.storage.local.set({
      keyupLevel: msg.level || 0,
      keyupLevelAt: Date.now(),
    });
    return false;
  }

  if (msg.type === 'add-stat' && typeof msg.ms === 'number' && msg.ms > 0) {
    const k = todayKey();
    chrome.storage.local.get([k, 'bestStreakMs'], (data) => {
      const cur = data[k] || 0;
      const best = Math.max(data.bestStreakMs || 0, msg.ms);
      chrome.storage.local.set({ [k]: cur + msg.ms, bestStreakMs: best });
    });
    return false;
  }

  return false;
});

// Broadcast settings changes to the offscreen document.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const patch = {};
  for (const k in changes) patch[k] = changes[k].newValue;
  chrome.runtime
    .sendMessage({ target: 'keyup-offscreen', type: 'settings-update', patch })
    .catch(() => {
      /* offscreen not up yet */
    });
});
