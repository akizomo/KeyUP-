// Key↑ — Fighting theme. Registered on window.KeyUpThemes.fighting.
// Tier is key-driven (small = char, mid = punct/space, large = Enter).
// Cmd+Enter = KO (gong + long cheer that fades after 3s).

// Guide metadata — registered before the Tone guard so the popup (which
// loads this file without Tone) can still read it.
(function () {
  'use strict';
  window.KeyUpThemes = window.KeyUpThemes || {};
  window.KeyUpThemes.fighting = window.KeyUpThemes.fighting || {};
  window.KeyUpThemes.fighting.guide = {
    ja: {
      title: '🥊 格闘ゲーム',
      groups: [
        {
          label: 'タイピング',
          items: [
            { keys: ['通常文字'], sound: '小パンチ / 小キック', icon: '👊' },
            { keys: ['、 。 , . ! ?', 'Space', 'Tab'], sound: '中パンチ / 中キック', icon: '🦵' },
            { keys: ['Enter'], sound: '大パンチ / 大キック', icon: '💥' },
          ],
        },
        {
          label: 'コンボ歓声',
          items: [
            { keys: ['5打'],  sound: '歓声 Lv1 (Short)', icon: '📣' },
            { keys: ['15打'], sound: '歓声 Lv2 (Mid)',   icon: '🎉' },
            { keys: ['30打'], sound: '歓声 Lv3 (Long)',  icon: '🔥' },
          ],
        },
        {
          label: 'フィニッシュ',
          items: [
            { keys: ['⌘/Ctrl + Enter'], sound: 'KOゴング + KOボイス + 歓声Long (3秒→フェード)', icon: '🛎️' },
          ],
        },
        {
          label: 'クリック',
          items: [
            { keys: ['マウス'], sound: 'パンチ素振り (空振り)', icon: '🖱️' },
          ],
        },
        {
          label: 'BGM',
          items: [
            { keys: ['最初のキー'], sound: 'スタジアムBGM開始 (ループ)', icon: '🏟️' },
            { keys: ['2秒無操作'],  sound: 'BGMフェードアウト (0.8秒)', icon: '🔇' },
          ],
        },
      ],
    },
    en: {
      title: '🥊 Fighting',
      groups: [
        {
          label: 'Typing',
          items: [
            { keys: ['Letters'], sound: 'Small punch / kick', icon: '👊' },
            { keys: [', . ! ?', 'Space', 'Tab'], sound: 'Mid punch / kick', icon: '🦵' },
            { keys: ['Enter'], sound: 'Big punch / kick', icon: '💥' },
          ],
        },
        {
          label: 'Combo cheers',
          items: [
            { keys: ['5 hits'],  sound: 'Cheer Lv1 (Short)', icon: '📣' },
            { keys: ['15 hits'], sound: 'Cheer Lv2 (Mid)',   icon: '🎉' },
            { keys: ['30 hits'], sound: 'Cheer Lv3 (Long)',  icon: '🔥' },
          ],
        },
        {
          label: 'Finisher',
          items: [
            { keys: ['⌘/Ctrl + Enter'], sound: 'KO gong + KO voice + long cheer (3s → fade)', icon: '🛎️' },
          ],
        },
        {
          label: 'Click',
          items: [
            { keys: ['Mouse'], sound: 'Punch whoosh (swing miss)', icon: '🖱️' },
          ],
        },
        {
          label: 'BGM',
          items: [
            { keys: ['First key'], sound: 'Stadium BGM starts (loop)', icon: '🏟️' },
            { keys: ['2s idle'],   sound: 'BGM fades out (0.8s)', icon: '🔇' },
          ],
        },
      ],
    },
  };
})();

(function () {
  'use strict';
  if (typeof Tone === 'undefined') return;

  const COMBO = {
    BREAK_TIMEOUT_MS: 500,
    LV1: 5,
    LV2: 15,
    LV3: 30,
  };
  const CHEER_COOLDOWN_MS = 3000;
  const BGM_IDLE_TIMEOUT_MS = 2000;
  const BGM_FADE_OUT_S = 0.8;
  const MASTER_OFFSET_DB = -4;

  let started = false;
  let userVolume = 0.5;
  let onLevelChange = null;

  // Hit sample bank: 6 real recordings (small/mid/large × punch/kick)
  // keyed by tier ('small'|'mid'|'large') and weapon ('punch'|'kick').
  const hitBuffers = {
    small: { punch: null, kick: null },
    mid:   { punch: null, kick: null },
    large: { punch: null, kick: null },
  };
  let hitBus = null;    // Native Web Audio GainNode — boosts the hit samples
  const HIT_BUS_BOOST = 1.5;
  let koGongBuffer = null;
  let koVoiceBuffer = null;
  let whooshBuffer = null;
  let lineKick = null;
  let clickPing = null;
  let cheerPlayers = null; // { 1, 2, 3 } -> Tone.Player
  let breakNoise = null;
  let breakFilter = null;
  let koBoom = null;
  let koCrash = null;
  let koCrashFilter = null;
  let siren = null;

  // Stadium BGM nodes (real recording, looped)
  let bgmPlayer = null;
  let bgmActive = false;
  let bgmIdleTimer = null;

  // Combo state
  const combo = {
    count: 0,
    level: 0,
    breakTimer: null,
    lastCheerAt: 0,
  };

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

    // --- Hit sample bank (6 real recordings, tiered by combo level) ---
    const _url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL : (p) => p;
    // Pure Web Audio routing for hits — bypass Tone wrappers entirely so per-hit
    // BufferSources can connect cleanly without going through Tone's input map.
    const _ctx = Tone.getContext().rawContext;
    hitBus = _ctx.createGain();
    hitBus.gain.value = HIT_BUS_BOOST * userVolume;
    hitBus.connect(_ctx.destination);
    const _loadHit = (tier, weapon, file) => {
      fetch(_url('assets/' + file))
        .then((r) => r.arrayBuffer())
        .then((ab) => _ctx.decodeAudioData(ab))
        .then((buf) => { hitBuffers[tier][weapon] = buf; })
        .catch((err) => console.warn('[Key↑] ' + file + ' load failed', err));
    };
    _loadHit('small', 'punch', 'punch_small.mp3');
    _loadHit('small', 'kick',  'kick_small.mp3');
    _loadHit('mid',   'punch', 'punch_mid.mp3');
    _loadHit('mid',   'kick',  'kick_mid.mp3');
    _loadHit('large', 'punch', 'punch_large.mp3');
    _loadHit('large', 'kick',  'kick_large.mp3');

    // KO gong sample — played through the same hit bus so setVolume applies.
    fetch(_url('assets/ko_gong.mp3'))
      .then((r) => r.arrayBuffer())
      .then((ab) => _ctx.decodeAudioData(ab))
      .then((buf) => { koGongBuffer = buf; })
      .catch((err) => console.warn('[Key↑] ko_gong.mp3 load failed', err));

    // KO voice shout — layered on top of the gong.
    fetch(_url('assets/ko_voice.mp3'))
      .then((r) => r.arrayBuffer())
      .then((ab) => _ctx.decodeAudioData(ab))
      .then((buf) => { koVoiceBuffer = buf; })
      .catch((err) => console.warn('[Key↑] ko_voice.mp3 load failed', err));

    // Click whoosh (punch swing) — used for mouse clicks.
    fetch(_url('assets/punch_whoosh.mp3'))
      .then((r) => r.arrayBuffer())
      .then((ab) => _ctx.decodeAudioData(ab))
      .then((buf) => { whooshBuffer = buf; })
      .catch((err) => console.warn('[Key↑] punch_whoosh.mp3 load failed', err));

    // Linebreak (plain Enter w/o KO context — soft body hit)
    lineKick = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 3,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.15 },
      volume: -8,
    }).toDestination();

    // Click — subtle stick tick
    clickPing = new Tone.MetalSynth({
      frequency: 600,
      envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
      harmonicity: 5.1,
      modulationIndex: 16,
      resonance: 1200,
      octaves: 0.5,
      volume: -28,
    }).toDestination();

    // --- Crowd cheer (real recordings, lazy-loaded via Tone.Player) ---
    const url = (p) => (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL(p) : p);
    cheerPlayers = {
      1: new Tone.Player({ url: url('assets/cheer_short.mp3'), autostart: false, volume: -8, fadeOut: 0.1 }).toDestination(),
      2: new Tone.Player({ url: url('assets/cheer_mid.mp3'), autostart: false, volume: -6, fadeOut: 0.1 }).toDestination(),
      3: new Tone.Player({ url: url('assets/cheer_long.mp3'), autostart: false, volume: -4, fadeOut: 0.1 }).toDestination(),
    };

    // --- Combo break (descending wash) ---
    breakFilter = new Tone.Filter({ frequency: 600, type: 'lowpass', Q: 0.7 }).toDestination();
    breakNoise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.05, decay: 0.4, sustain: 0, release: 0.2 },
      volume: -22,
    }).connect(breakFilter);

    // --- KO boom + crash ---
    koBoom = new Tone.MembraneSynth({
      pitchDecay: 0.08,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.4 },
      volume: -2,
    }).toDestination();
    koCrashFilter = new Tone.Filter({ frequency: 4000, type: 'highpass', Q: 0.5 }).toDestination();
    koCrash = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.2 },
      volume: -16,
    }).connect(koCrashFilter);

    // --- Finisher siren (rising tone) ---
    siren = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.01, decay: 0.6, sustain: 0.2, release: 0.4 },
      volume: -16,
    }).toDestination();
  }

  function setVolume(v) {
    userVolume = v;
    if (started) Tone.getDestination().volume.value = volToDb(v);
    if (hitBus) hitBus.gain.value = HIT_BUS_BOOST * userVolume;
  }

  // -------- SE primitives --------

  function playSampleAt(buf, rate, volDb) {
    if (!buf || !hitBus) return;
    try {
      const ctx = Tone.getContext().rawContext;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      if (typeof volDb === 'number' && volDb !== 0) {
        const g = ctx.createGain();
        g.gain.value = Math.pow(10, volDb / 20);
        src.connect(g);
        g.connect(hitBus);
      } else {
        src.connect(hitBus);
      }
      src.start(0);
    } catch (e) { console.warn(e); }
  }

  function playHit(tier) {
    if (!started) { ensureStarted(); return; }
    const t = (tier === 'mid' || tier === 'large') ? tier : 'small';
    const weapon = Math.random() < 0.5 ? 'punch' : 'kick';
    const buf = hitBuffers[t][weapon] || hitBuffers[t].punch || hitBuffers.small.punch;
    if (!buf) return;
    const variance = (Math.random() * 0.1) - 0.05;
    playSampleAt(buf, 1.0 + variance, 0);
  }

  function playLinebreak() {
    if (!started) { ensureStarted(); return; }
    try { lineKick.triggerAttackRelease(70, '8n'); } catch (_) {}
  }

  function playClickSE() {
    if (!started) { ensureStarted(); return; }
    if (whooshBuffer) {
      // ±8% pitch variance so repeated clicks don't sound robotic.
      const variance = (Math.random() * 0.16) - 0.08;
      playSampleAt(whooshBuffer, 1.0 + variance, 0);
      return;
    }
    try { clickPing.triggerAttackRelease('64n'); } catch (_) {}
  }

  let activeCheer = null;
  let koFadeTimer = null;
  function playCheer(level, volDb) {
    if (!started || !cheerPlayers) return;
    const now = Date.now();
    if (now - combo.lastCheerAt < CHEER_COOLDOWN_MS) return;
    combo.lastCheerAt = now;
    const player = cheerPlayers[level] || cheerPlayers[1];
    try {
      if (!player.loaded) return;
      // Cross-fade: previous cheer eases out over its fadeOut (0.1s).
      if (activeCheer && activeCheer !== player && activeCheer.state === 'started') {
        try { activeCheer.stop(); } catch (_) {}
      }
      if (player.state === 'started') player.stop();
      if (typeof volDb === 'number') player.volume.value = volDb;
      player.start();
      activeCheer = player;
    } catch (_) {}
  }

  function stopActiveCheer() {
    if (activeCheer && activeCheer.state === 'started') {
      try { activeCheer.stop(); } catch (_) {}
    }
    activeCheer = null;
  }

  function playComboBreak(count) {
    if (!started || count < COMBO.LV1) return;
    try {
      breakFilter.frequency.cancelScheduledValues(0);
      breakFilter.frequency.setValueAtTime(800, Tone.now());
      breakFilter.frequency.exponentialRampToValueAtTime(180, Tone.now() + 0.4);
      breakNoise.triggerAttackRelease('4n');
    } catch (_) {}
  }

  function playKO() {
    if (!started) { ensureStarted(); return; }
    // Real gong sample (vol ~0.90 → -0.9dB). Falls back to synth if still loading.
    if (koGongBuffer) {
      playSampleAt(koGongBuffer, 1.0, -0.9);
    } else {
      try {
        koBoom.triggerAttackRelease(38, '2n');
        koCrash.triggerAttackRelease('4n');
      } catch (_) {}
    }
    // KO shout — layered on top of the gong at vol ~0.85 (-1.4 dB).
    if (koVoiceBuffer) {
      playSampleAt(koVoiceBuffer, 1.0, -1.4);
    }
    // LONG cheer at vol 0.60 (-4.4dB). 3s, then 0.8s fade-out.
    const p = cheerPlayers && cheerPlayers[3];
    if (!p || !p.loaded) return;
    try {
      if (activeCheer && activeCheer !== p && activeCheer.state === 'started') {
        try { activeCheer.stop(); } catch (_) {}
      }
      if (p.state === 'started') p.stop();
      p.volume.cancelScheduledValues(Tone.now());
      p.volume.value = -4.4;
      p.start();
      activeCheer = p;
      combo.lastCheerAt = Date.now();
      if (koFadeTimer) clearTimeout(koFadeTimer);
      koFadeTimer = setTimeout(() => {
        koFadeTimer = null;
        try {
          if (p.state === 'started') {
            p.volume.rampTo(-60, BGM_FADE_OUT_S);
            setTimeout(() => {
              try { if (p.state === 'started') p.stop(); } catch (_) {}
            }, BGM_FADE_OUT_S * 1000 + 50);
          }
        } catch (_) {}
      }, 3000);
    } catch (_) {}
  }

  // -------- Stadium BGM --------

  async function startStadiumBGM() {
    await ensureStarted();
    if (bgmActive) return;
    if (!bgmPlayer) {
      const _url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL : (p) => p;
      bgmPlayer = new Tone.Player({
        url: _url('assets/stadium.mp3'),
        loop: true,
        autostart: false,
        fadeIn: 0.4,
        fadeOut: BGM_FADE_OUT_S,
        volume: -14, // ~vol 0.20 linear
      }).toDestination();
    }
    bgmActive = true;
    const startWhenReady = () => {
      if (!bgmActive) return;
      try {
        if (bgmPlayer.state !== 'started') bgmPlayer.start();
      } catch (_) {}
    };
    if (bgmPlayer.loaded) startWhenReady();
    else Tone.loaded().then(startWhenReady);
  }

  function stopStadiumBGM() {
    if (bgmIdleTimer) { clearTimeout(bgmIdleTimer); bgmIdleTimer = null; }
    if (!bgmActive) return;
    bgmActive = false;
    try { if (bgmPlayer && bgmPlayer.state === 'started') bgmPlayer.stop(); } catch (_) {}
  }

  function bumpBgmIdle() {
    if (bgmIdleTimer) clearTimeout(bgmIdleTimer);
    bgmIdleTimer = setTimeout(() => {
      bgmIdleTimer = null;
      stopStadiumBGM();
    }, BGM_IDLE_TIMEOUT_MS);
  }

  // -------- Combo state machine --------

  function comboLevel(count) {
    if (count >= COMBO.LV3) return 3;
    if (count >= COMBO.LV2) return 2;
    if (count >= COMBO.LV1) return 1;
    return 0;
  }

  function bumpCombo() {
    combo.count += 1;
    const newLevel = comboLevel(combo.count);
    if (newLevel > combo.level) {
      combo.level = newLevel;
      playCheer(newLevel);
      if (onLevelChange) onLevelChange(newLevel, newLevel - 1);
    }
    if (combo.breakTimer) clearTimeout(combo.breakTimer);
    combo.breakTimer = setTimeout(breakCombo, COMBO.BREAK_TIMEOUT_MS);
  }

  function breakCombo() {
    const wasCount = combo.count;
    const wasLevel = combo.level;
    if (combo.breakTimer) { clearTimeout(combo.breakTimer); combo.breakTimer = null; }
    combo.count = 0;
    combo.level = 0;
    if (wasCount >= COMBO.LV1) playComboBreak(wasCount);
    if (wasLevel > 0 && onLevelChange) onLevelChange(0, wasLevel);
    stopActiveCheer();
  }

  function resetCombo() {
    if (combo.breakTimer) { clearTimeout(combo.breakTimer); combo.breakTimer = null; }
    const wasLevel = combo.level;
    combo.count = 0;
    combo.level = 0;
    if (wasLevel > 0 && onLevelChange) onLevelChange(0, wasLevel);
  }

  // -------- Public theme API --------

  window.KeyUpThemes = window.KeyUpThemes || {};
  window.KeyUpThemes.fighting = {
    id: 'fighting',
    async init(opts) {
      onLevelChange = opts && opts.onLevelChange;
      await ensureStarted();
      // Stadium BGM is gated on the first keystroke (see onKey) so the page
      // stays silent until the user actually starts typing.
    },
    setVolume,
    onKey(opts) {
      bumpCombo();
      if (!opts || opts.typingSE !== false) playHit(opts && opts.tier);
      if (!bgmActive) startStadiumBGM();
      bumpBgmIdle();
    },
    onEnter(opts) {
      // Plain Enter = 大パンチ/大キック. Combo continues.
      bumpCombo();
      if (!opts || opts.typingSE !== false) playHit('large');
      if (!bgmActive) startStadiumBGM();
      bumpBgmIdle();
    },
    onCmdEnter(opts) {
      // KO — gong + long cheer. Combo/level reset.
      if (!opts || opts.typingSE !== false) playKO();
      resetCombo();
    },
    onClick(opts) {
      if (!opts || opts.clickSE !== false) playClickSE();
    },
    startBGM() { startStadiumBGM(); },
    stopBGM() { stopStadiumBGM(); },
    destroy() {
      stopStadiumBGM();
      resetCombo();
      onLevelChange = null;
    },
    getCurrentLevel() { return combo.level; },
  };
})();
