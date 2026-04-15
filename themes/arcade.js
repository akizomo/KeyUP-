// Key↑ — Arcade theme (8-bit Tone.js synth, original Key↑ sound)
// Self-contained theme module. Registered onto window.KeyUpThemes.arcade.

// Guide metadata — registered before the Tone guard so the popup can read it.
(function () {
  'use strict';
  window.KeyUpThemes = window.KeyUpThemes || {};
  window.KeyUpThemes.arcade = window.KeyUpThemes.arcade || {};
  window.KeyUpThemes.arcade.guide = {
    ja: {
      title: '🕹️ アーケード',
      groups: [
        {
          label: 'タイピング',
          items: [
            { keys: ['通常文字'], sound: '8bitブリップ (ピッチ上昇)', icon: '🎵' },
            { keys: ['Enter'],   sound: 'キック + ノイズ',          icon: '⬇️' },
          ],
        },
        {
          label: '無敵タイム (連続打鍵)',
          items: [
            { keys: ['10秒'], sound: 'Lv1 アルペジオ開始', icon: '🌟' },
            { keys: ['30秒'], sound: 'Lv2 ベースライン追加', icon: '⚡' },
            { keys: ['60秒'], sound: 'Lv3 リード追加 (MAX)',  icon: '🔥' },
          ],
        },
        {
          label: 'クリック',
          items: [
            { keys: ['マウス'], sound: '決定SE', icon: '🖱️' },
          ],
        },
        {
          label: 'BGM',
          items: [
            { keys: ['2秒無操作'], sound: '全レイヤー停止', icon: '🔇' },
          ],
        },
      ],
    },
    en: {
      title: '🕹️ Arcade',
      groups: [
        {
          label: 'Typing',
          items: [
            { keys: ['Letters'], sound: '8-bit blip (pitch rises)', icon: '🎵' },
            { keys: ['Enter'],   sound: 'Kick + noise',             icon: '⬇️' },
          ],
        },
        {
          label: 'Invincible time (typing streak)',
          items: [
            { keys: ['10s'], sound: 'Lv1 arpeggio starts', icon: '🌟' },
            { keys: ['30s'], sound: 'Lv2 bass line added', icon: '⚡' },
            { keys: ['60s'], sound: 'Lv3 lead added (MAX)', icon: '🔥' },
          ],
        },
        {
          label: 'Click',
          items: [
            { keys: ['Mouse'], sound: 'Confirm SE', icon: '🖱️' },
          ],
        },
        {
          label: 'BGM',
          items: [
            { keys: ['2s idle'], sound: 'All layers stop', icon: '🔇' },
          ],
        },
      ],
    },
  };
})();

(function () {
  'use strict';
  if (typeof Tone === 'undefined') return;

  const CFG = {
    STOP_TIMEOUT_MS: 2000,
    LV1_THRESHOLD_MS: 10000,
    LV2_THRESHOLD_MS: 30000,
    LV3_THRESHOLD_MS: 60000,
  };

  const SCALE_HZ = [220, 261.63, 311.13, 349.23, 440, 523.25, 622.25, 698.46, 880];
  const MASTER_OFFSET_DB = -4;

  let started = false;
  let userVolume = 0.5;
  let bgmActive = false;
  let keySynth = null;
  let enterSynth = null;
  let clickSynth = null;

  const bgmNodes = [];
  let arpPattern = null, arpSynth = null;
  let bassPattern = null, bassSynth = null;
  let leadPattern = null, leadSynth = null;

  // typing-time level state
  let typingStartTime = null;
  let lastKeyTime = null;
  let currentLevel = 0;
  let pollTimer = null;
  let onLevelChange = null;

  function volToDb(v) {
    const c = Math.max(0, Math.min(1, v));
    if (c <= 0.001) return -60;
    return 20 * Math.log10(c) + MASTER_OFFSET_DB;
  }

  async function ensureStarted() {
    if (started) return;
    try { await Tone.start(); } catch (_) {}
    started = true;
    Tone.getDestination().volume.value = volToDb(userVolume);
    keySynth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0, decay: 0.04, sustain: 0, release: 0 },
      volume: -16,
    }).toDestination();
    enterSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'square' },
      envelope: { attack: 0, decay: 0.08, sustain: 0, release: 0 },
      volume: -12,
    }).toDestination();
    clickSynth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0, decay: 0.03, sustain: 0, release: 0 },
      volume: -20,
    }).toDestination();
  }

  function setVolume(v) {
    userVolume = v;
    if (started) Tone.getDestination().volume.value = volToDb(v);
  }

  function playTyping() {
    if (!started) { ensureStarted(); return; }
    const hz = SCALE_HZ[Math.floor(Math.random() * SCALE_HZ.length)];
    keySynth.volume.value = -16;
    try { keySynth.triggerAttackRelease(hz, '32n'); } catch (_) {}
  }

  function playEnter() {
    if (!started) { ensureStarted(); return; }
    const now = Tone.now();
    [440, 554.37, 659.25].forEach((hz, i) => {
      try { enterSynth.triggerAttackRelease(hz, '16n', now + i * 0.07); } catch (_) {}
    });
  }

  function playClick() {
    if (!started) { ensureStarted(); return; }
    try { clickSynth.triggerAttackRelease(311.13, '64n'); } catch (_) {}
  }

  // BGM layers — invincible mode
  const LV1 = ['A3', 'C4', 'Eb4', 'A3', 'C4', 'F4', 'Eb4', 'C4'];
  const LV2_BASS = ['A2', 'A2', 'F2', 'A2'];
  const LV3_LEAD = ['A5', 'C5', 'Eb5', 'F5', 'A5', 'Eb5', 'C5', 'F5'];

  async function startBGMLevel(level) {
    await ensureStarted();
    const transport = Tone.getTransport();
    if (!bgmActive) {
      stopBGMNow();
      arpSynth = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0, decay: 0.1, sustain: 0.1, release: 0.05 },
        volume: -18,
      }).toDestination();
      bgmNodes.push(arpSynth);
      arpPattern = new Tone.Pattern((t, n) => {
        try { arpSynth.triggerAttackRelease(n, '16n', t); } catch (_) {}
      }, LV1, 'up');
      arpPattern.interval = '16n';
      arpPattern.start(0);
      transport.bpm.value = 160;
      transport.start();
      bgmActive = true;
    }
    if (level >= 2 && !bassPattern) {
      transport.bpm.rampTo(190, 1.5);
      bassSynth = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0, decay: 0.15, sustain: 0, release: 0.05 },
        volume: -16,
      }).toDestination();
      bgmNodes.push(bassSynth);
      bassPattern = new Tone.Pattern((t, n) => {
        try { bassSynth.triggerAttackRelease(n, '8n', t); } catch (_) {}
      }, LV2_BASS, 'up');
      bassPattern.interval = '8n';
      bassPattern.start(0);
    }
    if (level >= 3 && !leadPattern) {
      transport.bpm.rampTo(220, 1.2);
      leadSynth = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0, decay: 0.06, sustain: 0.05, release: 0.02 },
        volume: -20,
      }).toDestination();
      bgmNodes.push(leadSynth);
      leadPattern = new Tone.Pattern((t, n) => {
        try { leadSynth.triggerAttackRelease(n, '32n', t); } catch (_) {}
      }, LV3_LEAD, 'up');
      leadPattern.interval = '16n';
      leadPattern.start(0);
    }
  }

  function stopBGMNow() {
    const transport = Tone.getTransport();
    try { transport.stop(); transport.cancel(); } catch (_) {}
    [arpPattern, bassPattern, leadPattern].forEach((p) => {
      if (p) { try { p.stop(); p.dispose(); } catch (_) {} }
    });
    bgmNodes.forEach((n) => { try { n.dispose(); } catch (_) {} });
    bgmNodes.length = 0;
    arpPattern = bassPattern = leadPattern = null;
    arpSynth = bassSynth = leadSynth = null;
    bgmActive = false;
    if (started) Tone.getDestination().volume.value = volToDb(userVolume);
  }

  function stopBGMFade() {
    if (!bgmActive) return;
    try {
      Tone.getDestination().volume.rampTo(-60, 0.8);
      setTimeout(stopBGMNow, 900);
    } catch (_) { stopBGMNow(); }
  }

  function setLevel(level) {
    if (level === currentLevel) return;
    const prev = currentLevel;
    currentLevel = level;
    if (onLevelChange) onLevelChange(level, prev);
    if (level >= 1) startBGMLevel(level);
    else stopBGMFade();
  }

  function checkLevel(elapsed) {
    let newLevel = 0;
    if (elapsed >= CFG.LV3_THRESHOLD_MS) newLevel = 3;
    else if (elapsed >= CFG.LV2_THRESHOLD_MS) newLevel = 2;
    else if (elapsed >= CFG.LV1_THRESHOLD_MS) newLevel = 1;
    setLevel(newLevel);
  }

  function registerTyping() {
    const now = Date.now();
    if (!typingStartTime) typingStartTime = now;
    lastKeyTime = now;
    checkLevel(now - typingStartTime);
  }

  function onTypingStop() {
    typingStartTime = null;
    lastKeyTime = null;
    setLevel(0);
  }

  window.KeyUpThemes = window.KeyUpThemes || {};
  window.KeyUpThemes.arcade = {
    id: 'arcade',
    async init(opts) {
      onLevelChange = opts && opts.onLevelChange;
      pollTimer = setInterval(() => {
        if (!typingStartTime || !lastKeyTime) return;
        const now = Date.now();
        if (now - lastKeyTime >= CFG.STOP_TIMEOUT_MS) { onTypingStop(); return; }
        checkLevel(now - typingStartTime);
      }, 250);
    },
    setVolume,
    onKey(opts) {
      registerTyping();
      if (!opts || opts.typingSE !== false) playTyping();
    },
    onEnter(opts) {
      registerTyping();
      if (!opts || opts.typingSE !== false) playEnter();
    },
    onCmdEnter(opts) {
      registerTyping();
      if (!opts || opts.typingSE !== false) playEnter();
    },
    onClick(opts) {
      if (!opts || opts.clickSE !== false) playClick();
    },
    startBGM() { /* arcade BGM is auto-driven by typing */ },
    stopBGM() { stopBGMFade(); },
    destroy() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      stopBGMNow();
      currentLevel = 0;
      typingStartTime = null;
      lastKeyTime = null;
      onLevelChange = null;
    },
    getCurrentLevel() { return currentLevel; },
  };
})();
