// Key↑ content script — forwards DOM events to the offscreen audio document
// and renders the Lv3 particle burst when offscreen announces it via storage.

(function () {
  'use strict';

  function send(type, extra) {
    try {
      // Relay via SW so the message reaches the offscreen audio document
      // (content-script → offscreen direct sendMessage is unreliable in MV3).
      chrome.runtime
        .sendMessage({ target: 'keyup-relay', type, ...extra })
        .catch(() => {});
    } catch (_) {
      /* extension context invalidated on reload */
    }
  }

  // --- keyboard ---
  // Tiers: small = regular char, mid = punctuation/space, big = Enter.
  const MID_KEYS = new Set([
    ' ', 'Tab',
    ',', '.', '!', '?', ';', ':',
    '、', '。', '！', '？', '「', '」', '・', '…',
  ]);

  document.addEventListener(
    'keydown',
    (e) => {
      // Enter is checked first so Cmd/Ctrl+Enter still fires KO even while
      // an IME is composing (where isComposing / keyCode 229 is true).
      if (e.key === 'Enter') {
        send(e.metaKey || e.ctrlKey ? 'cmdEnter' : 'enter');
        return;
      }
      if (e.isComposing || e.keyCode === 229) {
        send('key', { tier: 'small' });
        return;
      }
      if (
        e.key.length === 1 ||
        e.key === 'Backspace' ||
        e.key === 'Tab' ||
        e.key === ' '
      ) {
        const tier = MID_KEYS.has(e.key) ? 'mid' : 'small';
        send('key', { tier });
      }
    },
    true
  );

  // --- mouse ---
  document.addEventListener('mousedown', () => send('click'), true);

  // --- Lv3 particle burst (triggered by offscreen via storage broadcast) ---
  let lastSeenLevel = 0;
  try {
    chrome.storage.local.get(['keyupLevel'], (d) => {
      lastSeenLevel = d.keyupLevel || 0;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.keyupLevel) return;
      const level = changes.keyupLevel.newValue || 0;
      if (level === 3 && lastSeenLevel !== 3) {
        showMaxParticles();
      }
      lastSeenLevel = level;
    });
  } catch (_) {}

  function showMaxParticles() {
    if (!document.body) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.cssText = [
        'position:fixed',
        'inset:0',
        'width:100%',
        'height:100%',
        'z-index:2147483647',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(canvas);
      const ctx2d = canvas.getContext('2d');
      const colors = ['#ffeb3b', '#ff4081', '#00e5ff', '#7cff6b'];
      const particles = [];
      for (let i = 0; i < 6; i++) {
        particles.push({
          x: i % 2 === 0 ? 20 : canvas.width - 36,
          y: canvas.height * (0.2 + Math.random() * 0.6),
          vx: (i % 2 === 0 ? 1 : -1) * (1 + Math.random()),
          vy: -2 - Math.random() * 2,
          color: colors[i % colors.length],
        });
      }
      const start = performance.now();
      function frame(t) {
        const elapsed = t - start;
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.05;
          ctx2d.fillStyle = p.color;
          ctx2d.fillRect(p.x, p.y, 16, 16);
        });
        if (elapsed < 1000) {
          requestAnimationFrame(frame);
        } else {
          canvas.remove();
        }
      }
      requestAnimationFrame(frame);
    } catch (_) {}
  }
})();
