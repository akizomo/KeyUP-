const DEFAULTS = {
  volume: 0.7,
  typingSE: true,
  clickSE: true,
  invincibleBGM: true,
  activeTheme: 'fighting',
};

const $ = (id) => document.getElementById(id);

function todayKey() {
  const d = new Date();
  return `stats_${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatMinutes(ms) {
  if (!ms) return '0分';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}分${sec}秒` : `${min}分`;
}

function formatSeconds(ms) {
  if (!ms) return '0秒';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}分${sec}秒`;
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
}

function save(patch) {
  chrome.storage.sync.set(patch);
}

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
  });
});

// Stats
chrome.storage.local.get([todayKey(), 'bestStreakMs'], (data) => {
  $('todayTime').textContent = formatMinutes(data[todayKey()] || 0);
  $('bestStreak').textContent = formatSeconds(data.bestStreakMs || 0);
});
