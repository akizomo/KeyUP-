const DEFAULTS = {
  volume: 0.5,
  typingSE: true,
  clickSE: true,
  invincibleBGM: true,
  hudEffects: true,
  activeTheme: 'fighting',
};

const $ = (id) => document.getElementById(id);

const LANG = (chrome.i18n.getUILanguage() || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en';
const UNIT = LANG === 'ja'
  ? { min: '分', sec: '秒' }
  : { min: ' min', sec: ' sec' };

function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg; // keep HTML fallback on miss
  });
}

function todayKey() {
  const d = new Date();
  return `stats_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatMinutes(ms) {
  if (!ms) return `0${UNIT.min}`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}${UNIT.sec}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}${UNIT.min}${sec}${UNIT.sec}` : `${min}${UNIT.min}`;
}

function formatSeconds(ms) {
  if (!ms) return `0${UNIT.sec}`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}${UNIT.sec}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}${UNIT.min}${sec}${UNIT.sec}`;
}

function render(settings) {
  $('volume').value = Math.round(settings.volume * 100);
  $('volumeValue').textContent = `${Math.round(settings.volume * 100)}%`;
  $('typingSE').checked = !!settings.typingSE;
  $('clickSE').checked = !!settings.clickSE;
  $('invincibleBGM').checked = !!settings.invincibleBGM;
  $('hudEffects').checked = !!settings.hudEffects;
  document.querySelectorAll('.theme-option').forEach((el) => {
    el.classList.toggle('active', el.dataset.theme === settings.activeTheme);
  });
  renderGuide(settings.activeTheme);
}

function renderGuide(themeId) {
  const body = $('guideBody');
  if (!body) return;
  const themes = window.KeyUpThemes || {};
  const raw = (themes[themeId] && themes[themeId].guide)
    || (themes.fighting && themes.fighting.guide);
  if (!raw) { body.textContent = ''; return; }
  // guide may be { ja, en } or a flat legacy object.
  const guide = raw[LANG] || raw.en || raw.ja || raw;
  const parts = [`<div class="guide-title">${guide.title}</div>`];
  for (const g of guide.groups) {
    parts.push(`<div class="guide-group"><div class="guide-group-label">${g.label}</div>`);
    for (const it of g.items) {
      const keys = it.keys.map((k) => `<kbd>${k}</kbd>`).join(' ');
      parts.push(
        `<div class="guide-item">` +
          `<span class="guide-icon">${it.icon || ''}</span>` +
          `<span class="guide-keys">${keys}</span>` +
          `<span class="guide-arrow">→</span>` +
          `<span class="guide-sound">${it.sound}</span>` +
        `</div>`
      );
    }
    parts.push(`</div>`);
  }
  body.innerHTML = parts.join('');
}

function save(patch) {
  chrome.storage.sync.set(patch);
}

applyStaticI18n();

chrome.storage.sync.get(DEFAULTS, (stored) => {
  const settings = { ...DEFAULTS, ...stored };
  if (settings.activeTheme === 'arcade') {
    settings.activeTheme = 'fighting';
    save({ activeTheme: 'fighting' });
  }
  render(settings);
});

$('volume').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100;
  $('volumeValue').textContent = `${e.target.value}%`;
  save({ volume: v });
});

['typingSE', 'clickSE', 'invincibleBGM', 'hudEffects'].forEach((id) => {
  $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
});

document.querySelectorAll('.theme-option').forEach((el) => {
  el.addEventListener('click', () => {
    const themeId = el.dataset.theme;
    save({ activeTheme: themeId });
    document.querySelectorAll('.theme-option').forEach((o) => o.classList.remove('active'));
    el.classList.add('active');
    renderGuide(themeId);
  });
});

// Stats
chrome.storage.local.get([todayKey(), 'bestStreakMs'], (data) => {
  $('todayTime').textContent = formatMinutes(data[todayKey()] || 0);
  $('bestStreak').textContent = formatSeconds(data.bestStreakMs || 0);
});
