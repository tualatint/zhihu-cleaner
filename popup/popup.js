'use strict';

/* 与 content script 保持一致的默认值 */
const DEFAULT_SETTINGS = {
  ads: true,
  hotlist: true,
  search: true,
  recommend: true,
  video: true,
  lowquality: true,
  keywords: [
    '震惊', '速看', '全网都', '万万没想到', '绝了',
    '看完你就', '建议收藏', '一文看懂', '深度好文', '必看',
    '沸腾了', '彻底怒了'
  ]
};

const STORAGE_KEY = 'zhcSettings';

const TOGGLES = [
  { key: 'ads',        label: '广告',          hint: '信息流 / 侧栏广告' },
  { key: 'hotlist',    label: '热榜 · 热搜',   hint: '知乎热榜、热搜卡片' },
  { key: 'search',     label: '搜索推荐',      hint: '大家都在搜、搜索框提示' },
  { key: 'recommend',  label: '推荐内容',      hint: '相关推荐、推荐阅读' },
  { key: 'video',      label: '视频信息流',    hint: '视频卡片、短视频' },
  { key: 'lowquality', label: '低质内容',      hint: '按关键词隐藏标题党' }
];

const $ = (sel) => document.querySelector(sel);

let settings = Object.assign({}, DEFAULT_SETTINGS);

async function load() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  settings = Object.assign({}, DEFAULT_SETTINGS, stored[STORAGE_KEY] || {});
}

async function save() {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}

function renderToggles() {
  const list = $('#toggles');
  list.textContent = '';

  for (const t of TOGGLES) {
    const li = document.createElement('li');

    const label = document.createElement('label');
    label.className = 'toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!settings[t.key];
    input.addEventListener('change', async () => {
      settings[t.key] = input.checked;
      await save();
    });

    const text = document.createElement('span');
    text.className = 'toggle-text';

    const strong = document.createElement('strong');
    strong.textContent = t.label;

    const small = document.createElement('small');
    small.textContent = t.hint;

    text.append(strong, small);
    label.append(input, text);
    li.append(label);
    list.append(li);
  }
}

function renderKeywords() {
  const ta = $('#keywords');
  const count = $('#kw-count');

  ta.value = (settings.keywords || []).join('\n');
  count.textContent = String((settings.keywords || []).length);

  let timer = 0;
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      settings.keywords = ta.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      count.textContent = String(settings.keywords.length);
      await save();
    }, 400);
  });
}

/** 当前活动标签页，必须是知乎站点，否则返回 null */
async function activeZhihuTab() {
  let tabs;
  try {
    tabs = await browser.tabs.query({ active: true, currentWindow: true });
  } catch {
    return null;
  }
  const tab = tabs && tabs[0];
  if (!tab || !tab.url) return null;
  try {
    const host = new URL(tab.url).hostname;
    return /(^|\.)zhihu\.com$/.test(host) ? tab : null;
  } catch {
    return null;
  }
}

async function refreshStats() {
  const status = $('#status');
  const stats = $('#stats');
  const rescan = $('#rescan');

  const tab = await activeZhihuTab();
  if (!tab) {
    status.textContent = '当前不是知乎页面';
    status.classList.add('muted');
    stats.textContent = '—';
    $('#hidden-badge').textContent = '0';
    rescan.disabled = true;
    return;
  }

  status.textContent = '已生效';
  status.classList.remove('muted');
  rescan.disabled = false;

  try {
    const res = await browser.tabs.sendMessage(tab.id, { type: 'zhc:stats' });
    const n = (res && res.hidden) || 0;
    $('#hidden-badge').textContent = String(n);
    stats.textContent = n ? `已隐藏 ${n} 项` : '暂未发现可隐藏内容';
  } catch {
    stats.textContent = '请刷新知乎页面后重试';
  }
}

async function rescan() {
  const tab = await activeZhihuTab();
  if (!tab) return;
  try {
    await browser.tabs.sendMessage(tab.id, { type: 'zhc:rescan' });
  } catch {
    /* content script 尚未注入，忽略 */
  }
  await refreshStats();
}

function renderDiagnose() {
  const out = $('#diag-out');
  const copyBtn = $('#diag-copy');

  $('#diag-run').addEventListener('click', async () => {
    const tab = await activeZhihuTab();
    if (!tab) {
      out.textContent = '请先在知乎页面上打开本弹窗。';
      return;
    }
    out.textContent = '正在采集…';
    copyBtn.disabled = true;
    try {
      const report = await browser.tabs.sendMessage(tab.id, { type: 'zhc:report' });
      out.textContent = JSON.stringify(report, null, 2);
      copyBtn.disabled = false;
      $('#hidden-badge').textContent = String((report && report.hiddenCount) || 0);
    } catch {
      out.textContent = '无法连接到页面：请刷新知乎页面后重试。';
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(out.textContent || '');
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1200);
    } catch {
      // 剪贴板不可用时，退化为手动全选
      const range = document.createRange();
      range.selectNodeContents(out);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
}

(async function init() {
  await load();
  renderToggles();
  renderKeywords();
  renderDiagnose();
  $('#rescan').addEventListener('click', rescan);
  await refreshStats();
})();
