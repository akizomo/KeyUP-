// Key↑ offscreen document — owns the audio engine and routes events to the
// active theme. Themes register themselves onto window.KeyUpThemes.
//
// Note: offscreen documents have NO chrome.storage access. All storage
// reads/writes are proxied through the background service worker.

(function () {
  'use strict';

  console.log('[Key↑ offscreen] loaded, themes =', Object.keys(window.KeyUpThemes || {}));

  const THEMES = window.KeyUpThemes || {};
  const DEFAULT_THEME = 'fighting';

  const DEFAULT_SETTINGS = {
    volume: 0.5,
    typingSE: true,
    clickSE: true,
    invincibleBGM: true,
    activeTheme: DEFAULT_THEME,
  };
  let settings = { ...DEFAULT_SETTINGS };
  let activeTheme = null;

  // --- SW proxy ---
  function askSW(type, extra) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ target: 'keyup-sw', type, ...extra }, (res) => {
          void chrome.runtime.lastError;
          resolve(res);
        });
      } catch (_) { resolve(undefined); }
    });
  }
  function tellSW(type, extra) {
    try { chrome.runtime.sendMessage({ target: 'keyup-sw', type, ...extra }); } catch (_) {}
  }

  // --- theme lifecycle ---
  async function loadTheme(id) {
    const next = THEMES[id] || THEMES[DEFAULT_THEME];
    if (!next) {
      console.error('[Key↑ offscreen] no themes available');
      return;
    }
    if (activeTheme === next) return;
    if (activeTheme) {
      try { activeTheme.destroy(); } catch (e) { console.warn('[Key↑] theme destroy failed', e); }
    }
    activeTheme = next;
    try {
      await activeTheme.init({
        onLevelChange: (level) => {
          tellSW('set-level', { level });
        },
      });
      activeTheme.setVolume(settings.volume);
    } catch (e) {
      console.error('[Key↑ offscreen] theme init failed', e);
    }
  }

  // Boot: pull settings, then load active theme.
  askSW('get-settings').then(async (stored) => {
    if (stored) settings = { ...DEFAULT_SETTINGS, ...stored };
    await loadTheme(settings.activeTheme);
  });

  // --- message bus ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;

    if (msg.target === 'keyup-offscreen' && msg.type === 'settings-update') {
      const patch = msg.patch || {};
      const themeChanged = 'activeTheme' in patch && patch.activeTheme !== settings.activeTheme;
      Object.assign(settings, patch);
      if (activeTheme) activeTheme.setVolume(settings.volume);
      if (!settings.invincibleBGM && activeTheme) activeTheme.stopBGM();
      if (themeChanged) loadTheme(settings.activeTheme);
      return;
    }

    if (msg.target !== 'keyup-offscreen' || !activeTheme) return;
    const themeOpts = {
      typingSE: settings.typingSE,
      clickSE: settings.clickSE,
      invincibleBGM: settings.invincibleBGM,
    };
    switch (msg.type) {
      case 'key':
        try { activeTheme.onKey({ ...themeOpts, tier: msg.tier }); } catch (e) { console.warn(e); }
        break;
      case 'enter':
        try { activeTheme.onEnter(themeOpts); } catch (e) { console.warn(e); }
        break;
      case 'cmdEnter':
        try { activeTheme.onCmdEnter(themeOpts); } catch (e) { console.warn(e); }
        break;
      case 'click':
        try { activeTheme.onClick(themeOpts); } catch (e) { console.warn(e); }
        break;
    }
  });
})();
