/*
 * 规则自测：用 jsdom 模拟知乎 DOM，验证 content.js 会隐藏目标元素、保留正常内容。
 * 特别覆盖：
 *   - 现网信息流广告结构 .TopstoryItem > .Popover > .TopstoryItem-advertButton
 *   - div[data-type="ad"]
 *   - 广告徽标文字 / 热榜标题 / 关键词
 *   - 动态插入（模拟 SPA + 无限滚动）——验证 MutationObserver 真的在工作
 *
 *   npm install --no-save jsdom
 *   node test/content-rules.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENT = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 模拟无限滚动新增的卡片；初始为空，验证监听器是在文档加载后装上的 */
const laterMarkup = `
  <!-- 1) 现网信息流广告：.TopstoryItem 内含 .TopstoryItem-advertButton -->
  <div class="TopstoryItem" id="ad-advert">
    <div class="Popover"><span class="TopstoryItem-advertButton">广告</span></div>
    <h2 class="ContentItem-title">某品牌推广内容</h2>
  </div>

  <!-- 2) 百度/搜狗联盟广告位 -->
  <div class="Pc-word" id="ad-pcword">广告位</div>

  <!-- 3) data-type="ad" -->
  <div id="ad-datatype" data-type="ad"><h2 class="ContentItem-title">广告内容</h2></div>

  <!-- 4) 带“广告”徽标的信息流卡片 -->
  <div class="TopstoryItem" id="ad-badge">
    <span class="ContentItem-meta"><span>广告</span></span>
    <h2 class="ContentItem-title">某某品牌新品发布</h2>
  </div>

  <!-- 5) 侧栏“知乎热榜”卡片 -->
  <div class="Card" id="hotlist">
    <div class="Card-header">知乎热榜</div>
    <ul class="HotList"><li class="HotItem">热榜条目一</li></ul>
  </div>

  <!-- 6) “大家都在搜”模块 -->
  <div class="Card" id="dajia">
    <div class="Card-header">大家都在搜</div>
    <ul><li><a href="#">词一</a></li><li><a href="#">词二</a></li></ul>
  </div>

  <!-- 6b) 搜索框下拉里的“大家都在搜”（没有 .Card 祖先，走 closestModule 兜底） -->
  <div class="XDropdown" id="dajia-drop">
    <div>大家都在搜</div>
    <ul><li><a href="#">词三</a></li><li><a href="#">词四</a></li></ul>
  </div>

  <!-- 9) 搜索框：占位 / 推荐提示文字 -->
  <div class="SearchBar">
    <input class="SearchBar-input" id="q" type="text" placeholder="大家都在搜：某热点话题">
  </div>

  <!-- 8) 热榜模块：标题与 换一换 同级，列表在另一个兄弟节点里。
       类名里含 Module/Title 但没有精确的 .Card —— 复现
       “只把标题隐藏了、换一换和列表还在” 的现象 -->
  <div class="RankModule" id="hotmod">
    <div class="RankModule-header">
      <div class="RankModule-title">知乎热榜</div>
      <div class="RankModule-extra">换一换</div>
    </div>
    <div class="RankModule-body">
      <a href="#">话题一 673 万</a>
      <a href="#">话题二 587 万</a>
      <a href="#">话题三 544 万</a>
    </div>
  </div>

  <!-- 7) 标题命中关键词的低质内容 -->
  <div class="TopstoryItem" id="lowq">
    <h2 class="ContentItem-title">震惊！万万没想到，看完你就懂了</h2>
  </div>

  <!-- 7) 正常内容，必须保留 -->
  <div class="TopstoryItem" id="normal">
    <h2 class="ContentItem-title">如何评价 Rust 1.90 的新特性？</h2>
  </div>
`;

(async function main() {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>知乎</title></head><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  // 最小化的 WebExtension API 桩
  window.browser = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} }
    },
    runtime: { onMessage: { addListener: () => {} } }
  };

  // 在“文档还是空的”时候注入，模拟 run_at: document_start
  window.eval(CONTENT);

  // 之后才把内容塞进 DOM，模拟 SPA 渲染 / 无限滚动
  window.document.body.innerHTML = laterMarkup;
  await sleep(600); // 等待 MutationObserver + 200ms 去抖

  /** 判定元素是否被隐藏：JS 标记的 class，或注入样式表带来的 display:none */
  const hidden = (id) => {
    const el = window.document.getElementById(id);
    if (!el) throw new Error('missing #' + id);
    if (el.classList.contains('zhc-hidden')) return true;
    return window.getComputedStyle(el).display === 'none';
  };

  const results = [
    ['信息流广告 .TopstoryItem-advertButton', hidden('ad-advert'), true],
    ['联盟广告位 .Pc-word', hidden('ad-pcword'), true],
    ['div[data-type="ad"]', hidden('ad-datatype'), true],
    ['“广告”徽标卡片', hidden('ad-badge'), true],
    ['侧栏“知乎热榜”卡片', hidden('hotlist'), true],
    ['“大家都在搜”模块', hidden('dajia'), true],
    ['搜索下拉的“大家都在搜”', hidden('dajia-drop'), true],
    ['热榜模块整体（标题+列表）', hidden('hotmod'), true],
    ['标题命中关键词的卡片', hidden('lowq'), true],
    ['正常问答卡片（必须保留）', hidden('normal'), false]
  ];

  let failed = 0;
  for (const [name, got, want] of results) {
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} hidden=${got} (期望 ${want})`);
  }

  const style = window.document.getElementById('zhc-style');
  console.log(`${style ? 'PASS' : 'FAIL'}  ${'注入 <style>'.padEnd(34)}`);
  if (!style) failed++;

  // 搜索框占位提示文字
  const q = window.document.getElementById('q');
  const phOk = !!q && q.placeholder === '';
  console.log(`${phOk ? 'PASS' : 'FAIL'}  ${'搜索框提示文字被清空'.padEnd(34)} placeholder=${JSON.stringify(q && q.placeholder)}`);
  if (!phOk) failed++;

  // 知乎会反复重设 placeholder，这里验证被重设后仍会被清掉
  q.placeholder = '换一个热搜词';
  await sleep(300);
  const phOk2 = q.placeholder === '';
  console.log(`${phOk2 ? 'PASS' : 'FAIL'}  ${'被重设后再次清空'.padEnd(34)} placeholder=${JSON.stringify(q.placeholder)}`);
  if (!phOk2) failed++;

  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})();
