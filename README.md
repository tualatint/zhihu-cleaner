# 知乎净化器 (Zhihu Cleaner)

一个 Firefox 扩展，用来清理 **zhihu.com** 上的广告和低质量内容。

## 功能

| 开关 | 清理内容 |
| --- | --- |
| 广告 | 信息流广告卡片、侧栏广告、知乎自营推广（含标有“广告”徽标的卡片） |
| 热榜 · 热搜 | 知乎热榜、热搜列表、搜索页热搜卡片 |
| 搜索推荐 | 大家都在搜 / 相关搜索，以及搜索框里的占位提示文字 |
| 推荐内容 | 相关推荐、推荐阅读、热门推荐等模块 |
| 视频信息流 | 视频卡片 / 短视频信息流 |
| 右侧栏 | 整条右栏（推荐关注、盐言作者平台、创作中心、付费咨询、知乎知学堂…） |
| 低质内容 | 卡片**标题**命中自定义关键词（标题党之类）的内容 |

弹窗里可以逐个开关，并编辑关键词列表（每行一个）。

## 实现原理

- **首帧不闪广告**：`content script` 以 `run_at: document_start` 注入 `src/content.js`，
  立即把一条 `<style>` 写进 `<html>`/`<head>`，命中选择器的元素在第一帧就被
  `display:none` 掉。
- **三层规则**：
  1. CSS 选择器（分类组织在 `src/content.js` 的 `SELECTORS` 里）；
  2. 文本规则：用一次 `TreeWalker` 遍历文本节点，匹配“广告”徽标和
     「知乎热榜 / 相关推荐」这类模块标题，再向上找到最近的卡片整张隐藏；
  3. 关键词规则：信息流 / 搜索卡片标题命中关键词即隐藏。
- **适配 SPA**：知乎是单页应用，`MutationObserver`（`childList + subtree`）负责
  路由切换与无限滚动新增的节点，扫描做了 200ms 合并。只监听结构变化、不监听
  `attributes`，所以脚本自己加的 class 不会触发死循环。

## 安装

### 临时加载（开发 / 自用，重启浏览器后失效）

1. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`
2. 点击 **临时载入附加组件 / Load Temporary Add-on…**
3. 选择本目录下的 `manifest.json`
4. 打开或刷新 `https://www.zhihu.com/`

> 载入后已经打开的知乎页面需要刷新一次，content script 才会注入。

### 打包成 xpi

`dist/` 是构建产物（未纳入版本控制），用下面的命令生成：

```bash
cd zhihu-cleaner
npx web-ext build --source-dir . --artifacts-dir dist --overwrite-dest \
  --ignore-files "tools/**" "test/**" "node_modules/**" "dist/**"
```

未签名的 xpi 只能在 Developer Edition / Nightly 里永久安装
（`xpinstall.signatures.required = false`）。要在正式版里长期使用需要用
[web-ext](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
签名：

```bash
npx web-ext sign --api-key=... --api-secret=...
```

## 测试

用 jsdom 模拟知乎 DOM，验证规则会隐藏目标元素、并保留正常内容：

```bash
npm install --no-save jsdom
node test/content-rules.test.js
```

当前 15 项全部通过，覆盖：`.TopstoryItem-advertButton` 信息流广告、`.Pc-word`
联盟广告位、`[data-type="ad"]`、「广告」徽标、知乎热榜（整块，含标题与列表）、
大家都在搜（含搜索框下拉）、搜索框提示文字（含被重设后再清空）、右侧栏（含类名
兜底）、关键词命中，以及正常内容不被误伤。

测试是在「文档为空时注入脚本、之后再插入 DOM」的前提下跑的，所以也覆盖了
SPA 渲染 / 无限滚动的场景。旧版逻辑跑同一份测试会在「热榜模块整体」一条上
FAIL（只隐藏了标题、列表还在），可用来做回归验证。

## 诊断 / 反馈

如果页面上还有没被清掉的内容：点扩展弹窗里的 **诊断 / 反馈 → 生成报告 → 复制**，
把内容贴出来。报告里会列出当前可见、且看起来像广告的元素及其 `class`，
据此就能把选择器补进 `src/content.js` 的 `SELECTORS`。

## 自定义

- **改选择器**：编辑 `src/content.js` 里的 `SELECTORS`（按 `ads / hotlist /
  search / recommend / video` 分组），知乎改版后在这里补充对应类名即可。
- **改默认关键词**：同时改 `src/content.js` 与 `popup/popup.js` 里的
  `DEFAULT_SETTINGS.keywords`。
- **重新生成图标**：`python3 tools/make-icons.py`。

> 注意：content script 运行在隔离环境里，页面控制台默认看不到 `__zhc` 之类的
> 变量（需要手动切换 DevTools 控制台的执行上下文）。所以调试/反馈请用弹窗里的
> **诊断 / 反馈** 面板，不依赖控制台。

## 已知限制

- 选择器和模块标题依赖知乎现网 DOM，改版后可能需要更新；`SELECTORS`
  已按类别集中放置，便于维护。
- 关键词规则只匹配卡片标题，不会误伤正文。
- 无法访问知乎或其登录后内容时无法实测，规则依据现网 DOM 与主流中文过滤规则
  （uBlock / AdGuard）整理。

## 目录结构

```
zhihu-cleaner/
├── manifest.json          # Manifest V3（Firefox）
├── src/content.js         # 内容脚本：样式注入 + 三层规则 + SPA 监听
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js           # 开关 / 关键词设置，读写 browser.storage.local
├── test/
│   └── content-rules.test.js   # jsdom 规则自测
├── icons/                 # 由 tools/make-icons.py 生成
├── tools/make-icons.py
└── dist/                  # 构建产物（.gitignore，由 web-ext build 生成）
```
