/*
 * 知乎净化器 / Zhihu Cleaner — content script
 *
 * 在 zhihu.com 上移除：
 *   1. 广告（信息流卡片、侧栏、百度/搜狗联盟广告位、知乎自营推广）
 *   2. 热榜 / 热搜
 *   3. 推荐内容（相关推荐、推荐阅读）
 *   4. 视频信息流
 *   5. 标题命中用户关键词的低质内容
 *
 * 广告选择器来源：AdGuard ChineseFilter / EasyList China（zhihu.com 段）现网维护的规则，
 * 例如 zhihu.com#?#.TopstoryItem:-abp-has(.Popover > .TopstoryItem-advertButton)
 *
 * 设计要点：
 *   - document_start 注入 <style>，命中选择器的元素首帧即隐藏，不闪广告。
 *   - 文本/徽标规则用 TreeWalker 单次遍历，用于兜住类名改版。
 *   - MutationObserver 监听 document（不是 documentElement —— 后者在 document_start
 *     可能还不存在，会导致监听器永远没装上），负责 SPA 路由与无限滚动。
 *   - 只监听 childList（不含 attributes），所以自己加 class 不会触发死循环。
 */
(() => {
  'use strict';

  if (window.__zhcLoaded__) return;
  window.__zhcLoaded__ = true;

  const VERSION = '1.3.0';
  const STYLE_ID = 'zhc-style';
  const HIDDEN_CLASS = 'zhc-hidden';
  const MARK_ATTR = 'data-zhc-hidden';
  const STORAGE_KEY = 'zhcSettings';

  /** 默认设置，与 popup 中的开关一一对应 */
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

  /** 按类别组织的 CSS 选择器（每个选择器单独成规则，避免个别选择器不兼容时整条规则失效） */
  const SELECTORS = {
    ads: [
      // ---- 来自 AdGuard / EasyList 中文规则的 zhihu.com 段 ----
      '.TopstoryItem--advertCard',
      '.TopstoryItem:has(.TopstoryItem-advertButton)',
      'div[data-type="ad"]',
      '.Card.Banner',
      '.Banner-link',
      '.Pc-word',
      '.Pc-word-new',
      '.MBannerAd',
      '.MHotFeedAd',
      '.MRelateFeedAd',
      '.QuestionAdBanner',
      '.RelatedReadings-adItem',
      '.RichText-Ecommerce',
      '.GoodsRecommendCard',
      '.LinkCard-ecommerceLoadingCard',
      '.WeiboAd-wrap',
      '.ZhiHuAdCard',
      // ---- 知乎自营 / 信息流广告（历史与现网常见类名）----
      '.Adblock',
      '.ZhihuAd',
      '.Pc-feedAd',
      '.Pc-feedAd-container',
      '.FeedAd',
      '.AnswerAd',
      '.SidebarAd',
      '.Question-sideColumnAdCard',
      '.Question-sideColumn--advertCard',
      '.KfeCollection-PcCollegeCard',
      '.KfeCollection-PcCustomCard',
      '.KfeCollection-PcInfoFlowCard',
      '.KfeCollection-AnswerBottomAd',
      '.RichContent--ads',
      '.RichText--ads',
      '[data-za-detail-view-path-module="Ad"]',
      '[data-za-detail-view-path-module="WithAd"]',
      '[data-za-module="AdItem"]',
      '[data-ad]'
    ],
    hotlist: [
      '.HotList',
      '.HotItem',
      '.HotList-item',
      '.Topstory-hot-list',
      '.TopstoryHotList',
      '.HotFeedAd',
      '.HotSearch',
      '.SearchBar-hotSearch',
      '.SearchBar-hotSearchItem',
      '[data-za-detail-view-path-module="HotList"]',
      // 类名改版兜底：只要包含 HotList / HotItem 就命中
      '[class*="HotList"]',
      '[class*="hotList"]',
      '[class*="HotItem"]',
      '[class*="hotItem"]'
    ],
    search: [
      // 搜索框下拉的“热门搜索 / 大家都在搜”
      '.SearchBar-hotSearch',
      '.SearchBar-hotSearchItem',
      '.SearchBar-relatedSearch',
      '.SearchResult-relatedSearch',
      '.SearchResult-recommendSearch',
      '.SearchRecommend',
      '.HotSearchKeywords',
      // 有的版本把提示文字做成浮层而不是 placeholder
      '.SearchBar-placeholder',
      '.SearchBar [class*="laceholder"]'
    ],
    recommend: [
      '.Recommendation',
      '.RecommendationList',
      '.RelatedReadings',
      '.RelatedReadItem',
      '.QuestionRecommend',
      '.TopstoryItem--recommend',
      '[data-za-detail-view-path-module="Recommend"]',
      '[data-za-detail-view-path-module="RelatedRead"]'
    ],
    video: [
      '.ZVideoItem',
      '.VideoCard',
      '.TopstoryItem--zvideo',
      '.VideoAnswerPlayer',
      '[data-za-detail-view-path-module="VideoList"]',
      '[data-za-module="ZVideoItem"]'
    ]
  };

  /** “卡片”容器：文本/徽标命中后向上找到它，整张隐藏 */
  const CARD_SELECTORS = [
    '.TopstoryItem',
    '.List-item',
    '.ContentItem',
    '.AnswerItem',
    '.QuestionItem',
    '.SearchResult-Card',
    '.RelatedReadings',
    '.Card',
    'article'
  ];

  /** 广告标记元素：命中后隐藏卡片（climb=true）或隐藏元素自身（climb=false） */
  const AD_MARKERS = [
    { sel: '.TopstoryItem-advertButton', climb: true },
    { sel: '.Adblock', climb: true },
    { sel: '.adTag', climb: true },
    { sel: 'div[data-type="ad"]', climb: false }
  ];

  /** 知乎搜索框（用于清掉里面的占位/推荐提示文字） */
  const SEARCH_INPUT_SELECTORS = [
    '.SearchBar-input',
    'input[class*="SearchBar"]',
    '.SearchBar input',
    'input[name="q"]',
    'input[type="search"]',
    'input[aria-label*="搜索"]',
    'input[placeholder*="搜索"]'
  ];

  /** 模块标题 → 需要整卡隐藏 */
  const HEADING_RULES = [
    { re: /^知乎热榜$/, key: 'hotlist' },
    { re: /^热榜$/, key: 'hotlist' },
    { re: /^热搜榜?$/, key: 'hotlist' },
    { re: /^大家都在搜$/, key: 'search' },
    { re: /^大家还在搜$/, key: 'search' },
    { re: /^相关搜索$/, key: 'search' },
    { re: /^热门搜索$/, key: 'search' },
    { re: /^相关推荐$/, key: 'recommend' },
    { re: /^推荐阅读$/, key: 'recommend' },
    { re: /^热门推荐$/, key: 'recommend' },
    { re: /^为你推荐$/, key: 'recommend' },
    { re: /^更多推荐$/, key: 'recommend' }
  ];

  /** 广告徽标文案 */
  const AD_BADGE_RE = /^(广告|推广|赞助|赞助内容|品牌广告|商业推广|商业内容|AD)$/i;

  /** 可被当作“徽标”的标签，避免把正文里恰好是“广告”的词整段隐藏 */
  const BADGE_TAGS = new Set(['SPAN', 'DIV', 'A', 'I', 'B', 'EM', 'LABEL', 'SMALL', 'STRONG']);

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let styleEl = null;
  let observer = null;
  let phObserver = null;
  let scanTimer = 0;

  /* ------------------------------- 样式 ------------------------------- */

  function buildCss(s) {
    // 每个选择器单独一条规则：个别选择器不被支持时只影响它自己
    const chunks = ['.' + HIDDEN_CLASS + '{display:none!important}'];
    for (const key of Object.keys(SELECTORS)) {
      if (!s[key]) continue;
      for (const sel of SELECTORS[key]) {
        chunks.push(sel + '{display:none!important}');
      }
    }
    return chunks.join('\n');
  }

  function applyCss() {
    if (!document.documentElement) return false;
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.getElementById(STYLE_ID);
    }
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    const css = buildCss(settings);
    if (styleEl.textContent !== css) styleEl.textContent = css;
    return true;
  }

  /* ------------------------------ 隐藏工具 ----------------------------- */

  function hide(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (el.hasAttribute(MARK_ATTR)) return false;
    el.setAttribute(MARK_ATTR, '1');
    el.classList.add(HIDDEN_CLASS);
    return true;
  }

  /** 从节点向上找最近的卡片容器；限制 10 层，避免吞掉整页 */
  function closestCard(node) {
    let el = node;
    for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      for (const sel of CARD_SELECTORS) {
        if (el.matches(sel)) return el;
      }
    }
    return null;
  }

  /**
   * 比 closestCard 更宽松的“模块”容器查找，用于标题类规则。
   *
   * 关键点：不能只靠类名子串判断，否则 “Card-header” 会被 /Card/ 命中，
   * 结果只把标题隐藏掉、下面的列表还在。改为「内容量」优先：
   * 往上找到第一个“明显比标题大”的祖先（含多条链接/列表），那才是整个模块。
   */
  function closestModule(node) {
    const card = closestCard(node);
    if (card) return card;

    const headingLen = Math.max(1, (node.textContent || '').trim().length);
    let el = node;

    for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;

      const cls = (el.className || '').toString();
      const textLen = (el.textContent || '').trim().length;
      const links = el.querySelectorAll('a').length;
      const isHeaderish = /header|title|tab/i.test(cls);

      // 1) 内容量明显超过标题、且有多条链接 → 这就是整个模块
      if (textLen > headingLen * 3 && links >= 3) return el;

      // 2) 像模块容器，且不是标题容器本身
      if (!isHeaderish && /(^|[-_ ])(card|module|block|section)([-_ ]|$)/i.test(cls)) {
        return el;
      }
      if (!isHeaderish && /SearchBar|SearchResult|Recommend/i.test(cls)) return el;

      // 3) 含列表且不止一个链接（搜索框下拉那类）
      const list = el.querySelector('ul, ol');
      if (!isHeaderish && list && list.querySelectorAll('a').length >= 2) return el;
    }
    return null;
  }

  function unmarkAll() {
    document.querySelectorAll('[' + MARK_ATTR + ']').forEach((el) => {
      el.removeAttribute(MARK_ATTR);
      el.classList.remove(HIDDEN_CLASS);
    });
  }

  function hiddenCount() {
    return document.querySelectorAll('[' + MARK_ATTR + ']').length;
  }

  /* ------------------------------ 规则实现 ----------------------------- */

  /** 广告标记元素（.TopstoryItem-advertButton 等） */
  function hideMarkerAds() {
    if (!settings.ads) return;
    for (const { sel, climb } of AD_MARKERS) {
      document.querySelectorAll(sel).forEach((el) => {
        hide(climb ? (closestCard(el) || el) : el);
      });
    }
  }

  /**
   * 清掉知乎搜索框里的占位 / 推荐提示文字。
   *
   * 知乎会把热搜词当作 placeholder 轮播写进搜索框，而且会不断重设，
   * 所以这里既要在每次扫描时清一次，也要靠 startPlaceholderObserver()
   * 盯着 placeholder 属性变化再清。
   */
  function clearSearchPlaceholders() {
    if (!settings.search) return;
    for (const sel of SEARCH_INPUT_SELECTORS) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.tagName === 'INPUT' && el.placeholder) {
          el.placeholder = ''; // 只清文案，不影响搜索功能
        }
      });
    }
  }

  /**
   * 单次 TreeWalker 遍历文本节点，处理：
   *   - 广告徽标（广告 / 推广 / 赞助 …）
   *   - 模块标题（知乎热榜 / 相关推荐 …）
   */
  function walkTextRules() {
    const headingRules = HEADING_RULES.filter((r) => settings[r.key]);
    const wantAds = !!settings.ads;
    if (!wantAds && headingRules.length === 0) return;
    if (!document.documentElement) return;

    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.nodeValue || '').trim();
      if (!text || text.length > 8) continue; // 徽标/模块标题都很短
      const el = node.parentElement;
      if (!el || !BADGE_TAGS.has(el.tagName)) continue;

      if (wantAds && AD_BADGE_RE.test(text)) {
        hide(closestCard(el));
        continue;
      }

      for (const rule of headingRules) {
        if (rule.re.test(text)) {
          hide(closestModule(el));
          break;
        }
      }
    }
  }

  /** 标题命中用户关键词的卡片 = 低质内容 */
  function hideKeywordCards() {
    if (!settings.lowquality) return;
    const keywords = (settings.keywords || []).filter(Boolean);
    if (!keywords.length) return;

    const titleSel = '.ContentItem-title, .Card-title, .ContentItem-headline, h2, h3';
    const cards = document.querySelectorAll(
      '.TopstoryItem, .List-item, .ContentItem, .SearchResult-Card, article'
    );
    cards.forEach((card) => {
      const titleEl = card.querySelector(titleSel);
      const text = (titleEl ? titleEl.textContent : '').trim();
      if (!text) return;
      if (keywords.some((k) => text.includes(k))) hide(card);
    });
  }

  /* ------------------------------ 扫描调度 ----------------------------- */

  function scan() {
    if (!document.documentElement) return;
    if (!styleEl || !styleEl.isConnected) applyCss(); // head 被 React 重建时补回样式
    hideMarkerAds();
    walkTextRules();
    hideKeywordCards();
    clearSearchPlaceholders();
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scan();
    }, 200);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      // 样式被移除就补回来（例如 <head> 被框架重建）
      if (!styleEl || !styleEl.isConnected) applyCss();
      scheduleScan();
    });
    // 监听 document 本身：document_start 阶段 documentElement 可能还不存在，
    // 监听 document 才能在其出现时收到通知。
    observer.observe(document, { childList: true, subtree: true });
  }

  /**
   * 单独盯 placeholder 属性：主 observer 为了不产生死循环，只监听 childList，
   * 而搜索框提示是属性变化（而且会被知乎反复重设），所以需要一个 attributes 观察器。
   * clearSearchPlaceholders() 只在非空时才写，因此不会自激。
   */
  function startPlaceholderObserver() {
    if (phObserver) return;
    phObserver = new MutationObserver(() => clearSearchPlaceholders());
    // 同样监听 document：document_start 阶段 documentElement 可能还不存在。
    // subtree 对「之后才插入」的后代同样生效，所以不需要监听 childList。
    phObserver.observe(document, {
      attributes: true,
      attributeFilter: ['placeholder'],
      subtree: true
    });
  }

  /* -------------------------------- 诊断 ------------------------------- */

  function buildReport() {
    const nodes = document.querySelectorAll(
      '.TopstoryItem, .Card, .List-item, .ContentItem, [data-type="ad"], .Adblock'
    );
    const candidates = [];
    for (const el of nodes) {
      if (candidates.length >= 20) break;
      if (el.offsetParent === null && el.offsetWidth === 0) continue; // 当前不可见
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const cls = (el.className || '').toString();
      const hit =
        /(^|[^一-龥])广告([^一-龥]|$)/.test(text.slice(0, 120)) ||
        el.matches('[data-type="ad"]') ||
        /advert|Adblock|adTag/i.test(cls) ||
        !!el.querySelector('.TopstoryItem-advertButton, .Adblock');
      if (!hit) continue;
      candidates.push({
        tag: el.tagName.toLowerCase(),
        cls: cls.slice(0, 220),
        parentCls: ((el.parentElement && el.parentElement.className) || '').toString().slice(0, 140),
        hidden: el.hasAttribute(MARK_ATTR),
        text: text.slice(0, 60)
      });
    }
    return {
      version: VERSION,
      url: location.href,
      settings,
      styleInjected: !!(styleEl && styleEl.isConnected),
      hiddenCount: hiddenCount(),
      candidates
    };
  }

  /* -------------------------------- 设置 ------------------------------- */

  async function loadSettings() {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, stored[STORAGE_KEY] || {});
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    settings = Object.assign({}, DEFAULT_SETTINGS, changes[STORAGE_KEY].newValue || {});
    unmarkAll();
    applyCss();
    scan();
  }

  function onMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'zhc:stats') {
      sendResponse({ hidden: hiddenCount() });
      return true;
    }
    if (msg.type === 'zhc:report') {
      sendResponse(buildReport());
      return true;
    }
    if (msg.type === 'zhc:rescan') {
      unmarkAll();
      applyCss();
      scan();
      sendResponse({ ok: true, hidden: hiddenCount() });
      return true;
    }
  }

  /* -------------------------------- 启动 ------------------------------- */

  try {
    // 1) 尽可能早地注入样式并扫描
    applyCss();
    scan();

    // 2) 监听变化（必须最早装上，别再因为 documentElement 不存在而漏掉）
    startObserver();
    startPlaceholderObserver();

    // 3) 几个安全网性质的补扫：框架 hydration / 路由切换偶尔不产生 childList 变化
    document.addEventListener('DOMContentLoaded', () => { applyCss(); scan(); }, { once: true });
    window.addEventListener('load', () => { applyCss(); scan(); }, { once: true });
    for (const ms of [300, 1000, 3000]) {
      window.setTimeout(() => { applyCss(); scan(); }, ms);
    }

    // 4) 读取用户设置后覆盖并重扫
    loadSettings()
      .then((s) => {
        settings = s;
        unmarkAll();
        applyCss();
        scan();
      })
      .catch(() => { /* 读取失败则沿用默认设置 */ });

    browser.storage.onChanged.addListener(onStorageChanged);
    browser.runtime.onMessage.addListener(onMessage);
  } catch (err) {
    console.error('[知乎净化器] 初始化失败', err);
  }
})();
