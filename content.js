// Key↑ content script — forwards DOM events to the offscreen audio document
// and renders the Lv3 particle burst when offscreen announces it via storage.
//
// PRIVACY: This script does NOT log, store, or transmit keystroke content.
//   On keydown we only look at `e.key` to classify it into a small set of
//   audio triggers ('enter' | 'cmdEnter' | 'key' + tier 'small'|'mid'|'large').
//   The actual character typed is never sent anywhere. No data leaves the
//   user's device — there is no network call in this extension. Password
//   field keystrokes produce the same generic 'key' message as any other
//   keystroke. See docs/privacy.html for the full privacy policy.

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
  let hudEnabled = true;
  try {
    chrome.storage.local.get(['keyupLevel'], (d) => {
      lastSeenLevel = d.keyupLevel || 0;
    });
    chrome.storage.sync.get(['hudEffects'], (d) => {
      hudEnabled = d.hudEffects !== false;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.hudEffects) {
        hudEnabled = changes.hudEffects.newValue !== false;
        if (!hudEnabled) hideComboHUD();
        return;
      }
      if (area !== 'local') return;
      if (changes.keyupLevel) {
        const level = changes.keyupLevel.newValue || 0;
        if (level > lastSeenLevel && level >= 2 && hudEnabled) renderMaxBurst(level);
        lastSeenLevel = level;
      }
      if (changes.keyupCount && hudEnabled) {
        const count = changes.keyupCount.newValue || 0;
        renderComboHUD(count);
        const label = bonusLabelFor(count);
        if (label) renderMaxBurst('bonus', { label });
      }
      if (changes.keyupKoAt && hudEnabled) {
        renderKO();
      }
    });
  } catch (_) {}

  // --- HUD (combo counter + K.O. badge + burst effects) ---
  // Layout: combo counter at input's LEFT-top, K.O. at input's RIGHT-top,
  // burst (LV.2 / LV.3 MAX / GREAT / ...) at the TEXT CARET position so the
  // user never has to shift their gaze while typing.
  const HUD_CSS = `
    :host { all: initial; }
    .stage {
      position: fixed;
      inset: 0;
      pointer-events: none;
      font-family: "Tektur", "Rajdhani", system-ui, sans-serif;
      font-style: italic;
      font-weight: 900;
      text-transform: uppercase;
      line-height: 1;
      user-select: none;
      overflow: visible;
    }
    .combo, .ko, .burst {
      position: fixed;
      will-change: transform, opacity;
    }
    .combo {
      text-align: left;
      opacity: 0;
      transition: opacity 180ms ease-out;
      text-shadow: 0 0 10px rgba(0,252,202,0.6);
      transform-origin: left bottom;
    }
    .combo.show { opacity: 1; }
    .combo-hits {
      font-size: 20px;
      color: #00fcca;
      letter-spacing: -0.02em;
    }
    .combo-label {
      font-size: 9px;
      color: #0d0d16;
      background: #ffdd7c;
      padding: 1px 6px;
      letter-spacing: 0.2em;
      display: inline-block;
      margin-top: 2px;
      text-shadow: none;
    }
    @keyframes keyup-combo-pop {
      0% { transform: scale(0.85); }
      45% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    .combo.pop .combo-hits { animation: keyup-combo-pop 180ms ease-out; }
    .ko {
      opacity: 0;
      transform: rotate(-5deg) scale(0.5);
      background: #ffdd7c;
      color: #0d0d16;
      border: 4px solid #0d0d16;
      padding: 6px 16px;
      font-size: 36px;
      letter-spacing: -0.04em;
      box-shadow: 0 0 40px rgba(255,204,0,0.8);
      transform-origin: right bottom;
    }
    @keyframes keyup-ko-flash {
      0%   { opacity: 0; transform: rotate(-5deg) scale(0.5); }
      15%  { opacity: 1; transform: rotate(-5deg) scale(1.15); }
      85%  { opacity: 1; transform: rotate(-5deg) scale(1); }
      100% { opacity: 0; transform: rotate(-5deg) scale(1); }
    }
    .ko.play { animation: keyup-ko-flash 1.6s forwards; }
    /* Burst is a zero-sized fixed anchor point positioned at the caret. */
    .burst {
      width: 0;
      height: 0;
    }
    .burst-text {
      position: absolute;
      left: 10px;
      bottom: 4px;
      transform-origin: left bottom;
      opacity: 0;
      background: #ffdd7c;
      color: #0d0d16;
      border: 3px solid #0d0d16;
      padding: 3px 10px;
      font-size: 18px;
      letter-spacing: -0.02em;
      white-space: nowrap;
      box-shadow: 0 0 24px rgba(255,204,0,0.8);
    }
    .burst.flip-x .burst-text {
      left: auto;
      right: 10px;
      transform-origin: right bottom;
    }
    @keyframes keyup-burst-text {
      0%   { opacity: 0; transform: rotate(-6deg) scale(0.5); }
      20%  { opacity: 1; transform: rotate(-6deg) scale(1.2); }
      70%  { opacity: 1; transform: rotate(-6deg) scale(1); }
      100% { opacity: 0; transform: rotate(-6deg) scale(1); }
    }
    .burst-text.play { animation: keyup-burst-text 1.2s forwards; }
    .burst-particle {
      position: absolute;
      left: -4px;
      top: -4px;
      width: 8px;
      height: 8px;
      opacity: 1;
      will-change: transform, opacity;
      box-shadow: 0 0 6px currentColor;
    }
    @keyframes keyup-burst-fly {
      0%   { opacity: 1; transform: translate(0, 0) scale(1); }
      70%  { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.2); }
    }
    .burst-particle.play { animation: keyup-burst-fly 900ms cubic-bezier(0.2,0.7,0.3,1) forwards; }
    @media (prefers-reduced-motion: reduce) {
      .combo.pop .combo-hits, .ko.play, .burst-text.play, .burst-particle.play { animation: none; }
    }
  `;

  let hudHost = null;
  let hudRoot = null;
  let comboEl = null;
  let comboHitsEl = null;
  let koEl = null;
  let burstEl = null;
  let burstTextEl = null;
  let hudVisible = false;
  let hudAnchor = null;
  let hudReflowPending = false;

  function ensureHud() {
    if (hudHost && hudHost.isConnected) return;
    if (!document.body) return;
    hudHost = document.createElement('div');
    hudHost.setAttribute('aria-hidden', 'true');
    hudHost.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647';
    const shadow = hudHost.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    shadow.appendChild(style);
    hudRoot = document.createElement('div');
    hudRoot.className = 'stage';
    comboEl = document.createElement('div');
    comboEl.className = 'combo';
    comboHitsEl = document.createElement('div');
    comboHitsEl.className = 'combo-hits';
    const lbl = document.createElement('div');
    lbl.className = 'combo-label';
    lbl.textContent = 'COMBO';
    comboEl.appendChild(comboHitsEl);
    comboEl.appendChild(lbl);
    koEl = document.createElement('div');
    koEl.className = 'ko';
    koEl.textContent = 'K.O!!';
    burstEl = document.createElement('div');
    burstEl.className = 'burst';
    burstTextEl = document.createElement('div');
    burstTextEl.className = 'burst-text';
    burstTextEl.textContent = 'LV.3 MAX!';
    burstEl.appendChild(burstTextEl);
    hudRoot.appendChild(comboEl);
    hudRoot.appendChild(koEl);
    hudRoot.appendChild(burstEl);
    shadow.appendChild(hudRoot);
    document.body.appendChild(hudHost);
  }

  function isEditable(el) {
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.type || '').toLowerCase();
      return !['button','submit','reset','checkbox','radio','range','color','file','image'].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function focusedEditable() {
    const el = document.activeElement;
    return isEditable(el) ? el : null;
  }

  // Anchored to the focused input — reposition the combo & KO layers whenever
  // the input moves (scroll/resize/focus).
  function positionAnchored() {
    hudReflowPending = false;
    if (!hudAnchor || !hudAnchor.isConnected) { hideAnchored(); return; }
    const rect = hudAnchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { hideAnchored(); return; }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) {
      hideAnchored();
      return;
    }
    // Flip above→below if the input sits too close to the viewport top.
    const roomAbove = rect.top;
    const placeAbove = roomAbove >= 40;
    const vOffset = 6;
    // Combo: input's LEFT-top, aligned with left edge
    if (comboEl) {
      const left = Math.max(8, Math.min(rect.left, vw - 120));
      comboEl.style.left = left + 'px';
      comboEl.style.right = 'auto';
      if (placeAbove) {
        comboEl.style.bottom = (vh - rect.top + vOffset) + 'px';
        comboEl.style.top = 'auto';
        comboEl.style.transformOrigin = 'left bottom';
      } else {
        comboEl.style.top = (rect.bottom + vOffset) + 'px';
        comboEl.style.bottom = 'auto';
        comboEl.style.transformOrigin = 'left top';
      }
      comboEl.style.display = '';
    }
    // KO: input's RIGHT-top
    if (koEl) {
      const right = Math.max(8, Math.min(vw - rect.right, vw - 80));
      koEl.style.right = right + 'px';
      koEl.style.left = 'auto';
      if (placeAbove) {
        koEl.style.bottom = (vh - rect.top + vOffset) + 'px';
        koEl.style.top = 'auto';
        koEl.style.transformOrigin = 'right bottom';
      } else {
        koEl.style.top = (rect.bottom + vOffset) + 'px';
        koEl.style.bottom = 'auto';
        koEl.style.transformOrigin = 'right top';
      }
      koEl.style.display = '';
    }
    hudVisible = true;
  }

  function scheduleReflow() {
    if (hudReflowPending) return;
    hudReflowPending = true;
    requestAnimationFrame(positionAnchored);
  }

  function hideAnchored() {
    if (comboEl) comboEl.style.display = 'none';
    if (koEl) koEl.style.display = 'none';
    hudVisible = false;
  }

  // Position the burst element (zero-sized anchor point) at the caret. Returns
  // true if a caret was located.
  function positionBurstAtCaret(el) {
    if (!burstEl) return false;
    const cr = caretRect(el);
    if (!cr) {
      // Fallback: input right-top
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      burstEl.style.left = Math.min(rect.right, vw - 8) + 'px';
      burstEl.style.top = Math.max(rect.top, 8) + 'px';
      burstEl.classList.remove('flip-x');
      return false;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Clamp caret into viewport so the burst never lands offscreen.
    const x = Math.max(8, Math.min(cr.left, vw - 8));
    const y = Math.max(8, Math.min(cr.top, vh - 8));
    burstEl.style.left = x + 'px';
    burstEl.style.top = y + 'px';
    // If caret is near the right edge, flip the text to the LEFT of the caret.
    if (x > vw - 220) burstEl.classList.add('flip-x');
    else burstEl.classList.remove('flip-x');
    return true;
  }

  // --- Caret position helpers ---
  function caretRect(el) {
    if (!el) return null;
    try {
      if (el.isContentEditable) {
        const doc = el.ownerDocument || document;
        const sel = doc.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0).cloneRange();
        range.collapse(false);
        const rects = range.getClientRects();
        if (rects.length) return rects[rects.length - 1];
        // Degenerate ranges (e.g. empty contenteditable) have no rects — fall
        // back to the element's own top-right corner so the burst still lands.
        const r = el.getBoundingClientRect();
        return { left: r.right - 2, top: r.top, right: r.right, bottom: r.top + 16, width: 0, height: 16 };
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        return mirrorCaretRect(el);
      }
    } catch (_) {}
    return null;
  }

  // Offscreen-mirror technique: replicate the input's text metrics into a
  // hidden div, insert a marker span at the caret position, measure it. Works
  // for <input> and <textarea>, covers scrolled content via scrollLeft/Top.
  function mirrorCaretRect(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const mirror = document.createElement('div');
    const copyProps = [
      'direction','boxSizing',
      'width','height',
      'paddingTop','paddingRight','paddingBottom','paddingLeft',
      'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
      'fontFamily','fontSize','fontWeight','fontStyle','fontVariant',
      'letterSpacing','textTransform','textIndent',
      'lineHeight','textAlign','tabSize',
    ];
    copyProps.forEach((p) => { mirror.style[p] = style[p]; });
    mirror.style.position = 'absolute';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = el.tagName === 'INPUT' ? 'pre' : 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    const value = el.value != null ? String(el.value) : '';
    const pos = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    mirror.textContent = value.substring(0, pos);
    const marker = document.createElement('span');
    marker.textContent = value.substring(pos) || '.';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const mirrorRect = mirror.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    document.body.removeChild(mirror);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padT = parseFloat(style.paddingTop) || 0;
    const bdL = parseFloat(style.borderLeftWidth) || 0;
    const bdT = parseFloat(style.borderTopWidth) || 0;
    const lh = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.2;
    const relX = markerRect.left - mirrorRect.left - (el.scrollLeft || 0);
    const relY = markerRect.top - mirrorRect.top - (el.scrollTop || 0);
    const x = rect.left + relX;
    const y = rect.top + relY;
    // Clamp caret to the visible content area so scrolled-out carets don't
    // fling the burst outside the input.
    const minX = rect.left + bdL + padL;
    const maxX = rect.right - bdL;
    const minY = rect.top + bdT + padT;
    const maxY = rect.bottom - bdT;
    const cx = Math.max(minX, Math.min(x, maxX));
    const cy = Math.max(minY, Math.min(y, maxY));
    return { left: cx, top: cy, right: cx, bottom: cy + lh, width: 0, height: lh };
  }

  function hideComboHUD() {
    if (comboEl) comboEl.classList.remove('show', 'pop');
  }

  function renderComboHUD(count) {
    if (!hudEnabled) return;
    ensureHud();
    if (!comboEl) return;
    if (count <= 0) {
      comboEl.classList.remove('show', 'pop');
      return;
    }
    hudAnchor = focusedEditable();
    if (!hudAnchor) return;
    comboHitsEl.textContent = count + ' HIT';
    comboEl.classList.add('show');
    comboEl.classList.remove('pop');
    void comboEl.offsetWidth;
    comboEl.classList.add('pop');
    scheduleReflow();
  }

  function renderKO() {
    if (!hudEnabled) return;
    ensureHud();
    if (!koEl) return;
    hudAnchor = focusedEditable() || hudAnchor;
    if (!hudAnchor) return;
    koEl.classList.remove('play');
    void koEl.offsetWidth;
    koEl.classList.add('play');
    scheduleReflow();
  }

  const BURST_COLORS = ['#ffdd7c', '#00fcca', '#ff7074'];
  const BURST_CFG = {
    2: { label: 'LV.2', particles: 12, distMin: 60,  distMax: 110, fontSize: 15, particleSize: 7,  glow: 20 },
    3: { label: 'LV.3 MAX!', particles: 24, distMin: 110, distMax: 190, fontSize: 24, particleSize: 10, glow: 40 },
    bonus: { label: '', particles: 18, distMin: 90, distMax: 150, fontSize: 20, particleSize: 9, glow: 30 },
  };
  // Post-Lv3 bonus labels — cycle through fighting-game staples. 50 = LV.3 MAX,
  // then +30 each: 80 = GREAT!, 110 = EXCELLENT!, 140 = AMAZING!, ...
  const BONUS_LABELS = ['GREAT!', 'EXCELLENT!', 'AMAZING!', 'INCREDIBLE!', 'UNSTOPPABLE!', 'GODLIKE!!'];
  function bonusLabelFor(count) {
    if (count <= 50) return null;
    const d = count - 50;
    if (d % 30 !== 0) return null;
    const idx = (d / 30) - 1; // 80→0, 110→1, 140→2, ...
    if (idx < 0) return null;
    return BONUS_LABELS[Math.min(idx, BONUS_LABELS.length - 1)];
  }
  function renderMaxBurst(level, opts) {
    ensureHud();
    if (!burstEl || !burstTextEl) return;
    hudAnchor = focusedEditable() || hudAnchor;
    if (!hudAnchor) return;
    const cfg = BURST_CFG[level] || BURST_CFG[2];
    const label = (opts && opts.label) || cfg.label;
    // Pin the burst at the caret snapshot (don't track while animating).
    positionBurstAtCaret(hudAnchor);
    // Text flash
    burstTextEl.textContent = label;
    burstTextEl.style.fontSize = cfg.fontSize + 'px';
    burstTextEl.style.boxShadow = `0 0 ${cfg.glow}px rgba(255,204,0,0.85)`;
    burstTextEl.classList.remove('play');
    void burstTextEl.offsetWidth;
    burstTextEl.classList.add('play');
    // Radial pixel particles bursting from the HUD origin (input's right-top).
    const N = cfg.particles;
    for (let i = 0; i < N; i++) {
      const p = document.createElement('div');
      p.className = 'burst-particle';
      const baseAngle = (Math.PI * 2 * i) / N;
      const angle = baseAngle + (Math.random() - 0.5) * 0.3;
      const dist = cfg.distMin + Math.random() * (cfg.distMax - cfg.distMin);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - 30; // slight upward bias
      const color = BURST_COLORS[i % BURST_COLORS.length];
      p.style.setProperty('--dx', dx + 'px');
      p.style.setProperty('--dy', dy + 'px');
      p.style.width = cfg.particleSize + 'px';
      p.style.height = cfg.particleSize + 'px';
      p.style.background = color;
      p.style.color = color;
      p.style.animationDelay = Math.floor(Math.random() * 80) + 'ms';
      burstEl.appendChild(p);
      // Force reflow before adding 'play' so the animation restarts cleanly.
      void p.offsetWidth;
      p.classList.add('play');
      p.addEventListener('animationend', () => p.remove(), { once: true });
    }
  }

  document.addEventListener('focusin', () => {
    const el = focusedEditable();
    if (el) { hudAnchor = el; scheduleReflow(); }
  }, true);
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!focusedEditable()) hideAnchored(); }, 0);
  }, true);
  window.addEventListener('scroll', scheduleReflow, true);
  window.addEventListener('resize', scheduleReflow);
})();
