const DEFAULTS = {
  volume: 0.7,
  typingSE: true,
  clickSE: true,
  invincibleBGM: true,
  activeTheme: 'fighting',
};

const $ = (id) => document.getElementById(id);

const LANG = (chrome.i18n.getUILanguage() || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en';
const t = (key) => chrome.i18n.getMessage(key) || key;
const JOIN = LANG === 'ja' ? '' : ' ';

function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
}

function todayKey() {
  const d = new Date();
  return `stats_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatMinutes(ms) {
  if (!ms) return t('zeroMin');
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}${JOIN}${t('unitSec')}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const minStr = `${min}${JOIN}${t('unitMin')}`;
  return sec > 0 ? `${minStr}${JOIN}${sec}${JOIN}${t('unitSec')}` : minStr;
}

function formatSeconds(ms) {
  if (!ms) return t('zeroSec');
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}${JOIN}${t('unitSec')}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}${JOIN}${t('unitMin')}${JOIN}${sec}${JOIN}${t('unitSec')}`;
}

function render(settings) {
  $('volume').value = Math.round(settings.volume * 100);
  $('volumeValue').textContent = `${Math.round(settings.volume * 100)}%`;
  $('typingSE').checked = !!settings.typingSE;
  $('clickSE').checked = !!settings.clickSE;
  $('invincibleBGM').checked = !!settings.invincibleBGM;
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
  render(settings);
});

$('volume').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100;
  $('volumeValue').textContent = `${e.target.value}%`;
  save({ volume: v });
});

['typingSE', 'clickSE', 'invincibleBGM'].forEach((id) => {
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
