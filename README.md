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
| 右侧栏 | 整条右栏（推荐关注、盐言作者平台、创作中心、付费咨询、知乎知学堂…），并把主列补满 |
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
- **认 data 属性、不认类名**：知乎现在把容器类名编译成 `css-xxxx` 哈希，每次发
  版都会变；早先按 `sideColumn` / `SideBar` 这类名字写的选择器，在首页一个都
  匹配不到。关键位置改用知乎自己的埋点属性，例如右栏的
  `[data-za-detail-view-path-module="RightSideBar"]`（首页 / 问题页均已实测）。
- **适配 SPA**：知乎是单页应用，`MutationObserver`（`childList + subtree`）负责
  路由切换与无限滚动新增的节点，扫描做了 200ms 合并。只监听结构变化、不监听
  `attributes`，所以脚本自己加的 class 不会触发死循环。

## 安装

### 永久安装（推荐）：自带一份 ESR，不需要任何账号

Firefox **正式版强制校验扩展签名**：把未签名的 xpi 放进 profile 的
`extensions/` 会被直接删掉（153.0.3 实测如此，即便设了
`xpinstall.signatures.required = false`）。Mozilla 只在 **Developer Edition /
Nightly / ESR** 上允许关掉这个校验。

所以 `tools/install-esr.sh` 用 Mozilla 官方 **ESR tarball** 在 `$HOME` 下装一份
Firefox，并把扩展永久装进它自己的 profile —— 不需要 AMO 账号，也不需要 sudo：

```bash
tools/install-esr.sh
```

脚本做的事：

1. 从 `ftp.mozilla.org` 下载 ESR（默认 `153.5.0esr`，可用 `ESR_VER=` 覆盖），解压到 `~/firefox-esr`
2. 把现有 snap profile 复制到 `~/.mozilla/firefox/zhihu-esr`（登录态、书签、密码都带过来）
3. 在该 profile 写 `user.js`，设 `xpinstall.signatures.required = false`
4. 把 `dist/` 里最新的 xpi 放进该 profile 的 `extensions/`（永久安装，重启不掉）
5. 生成启动器 `~/.local/bin/firefox-esr` 与菜单项「Firefox ESR（知乎净化器）」

启动：应用菜单里那一项，或终端 `firefox-esr`。设成系统默认浏览器（可选，别处
点的链接也走它）：

```bash
xdg-settings set default-web-browser firefox-esr.desktop
```

升级扩展：改 `manifest.json` 的 `version` → 打包 → 重跑 `tools/install-esr.sh`
（脚本幂等，不会覆盖已有 profile）。

> **代价**：ESR 的 profile 是独立的，和 snap 那份 Firefox 互不影响；关掉签名
> 校验也意味着该 profile 什么扩展都能装。想彻底撤销：删掉 `~/firefox-esr`、
> `~/.mozilla/firefox/zhihu-esr`、`~/.local/bin/firefox-esr` 和
> `~/.local/share/applications/firefox-esr.desktop`。

### 另一种永久安装：走 AMO 签名，继续用系统原来的 Firefox

如果不想多装一份浏览器，就让 Mozilla 给扩展签一次名 —— 走 AMO 的
**unlisted**（不公开上架）渠道，免费。

1. 注册 / 登录 [addons.mozilla.org](https://addons.mozilla.org/)，在
   <https://addons.mozilla.org/developers/addon/api/key/> 生成 API key 与 secret
2. 把凭据写进 `~/.amo-keys`（避免密钥进入 shell 历史）：

   ```bash
   cat > ~/.amo-keys <<'EOF'
   WEB_EXT_API_KEY=你的key
   WEB_EXT_API_SECRET=你的secret
   EOF
   chmod 600 ~/.amo-keys
   ```

3. 签名：

   ```bash
   tools/sign.sh
   ```

4. **永久安装**：`about:addons` → 右上角齿轮 → **从文件安装附加组件…** →
   选中 `dist/` 下新出现的 `.xpi`

之后重启 Firefox 扩展都还在。升级时改 `manifest.json` 里的 `version` 再跑一次
`tools/sign.sh`、重新安装即可。

### 临时加载（开发调试用，重启浏览器后失效）

1. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`
2. 点击 **临时载入附加组件 / Load Temporary Add-on…**
3. 选择本目录下的 `manifest.json`
4. 打开或刷新 `https://www.zhihu.com/`

> 载入后已经打开的知乎页面需要刷新一次，content script 才会注入。

### 打包成 xpi（不签名）

`dist/` 是构建产物（未纳入版本控制），用下面的命令生成：

```bash
cd zhihu-cleaner
npx web-ext build --source-dir . --artifacts-dir dist --overwrite-dest \
  --ignore-files "tools/**" "test/**" "node_modules/**" "dist/**"
```

未签名的 xpi 只能在 Developer Edition / Nightly 里永久安装
（`xpinstall.signatures.required = false`）。

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
├── tools/
│   ├── make-icons.py      # 生成图标
│   ├── install-esr.sh     # 装一份 ESR 并永久装入扩展（方式一，无需账号 / sudo）
│   └── sign.sh            # 走 AMO unlisted 渠道签名（方式二，继续用原 Firefox）
└── dist/                  # 构建产物（.gitignore，由 web-ext build/sign 生成）
```
