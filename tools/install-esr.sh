#!/usr/bin/env bash
#
# 永久安装「知乎净化器」—— 不需要 AMO 账号、不需要 sudo 的路线。
#
# 为什么不能用 snap 里那个正式版 Firefox：
#   正式版强制校验扩展签名（实测：把未签名 xpi 放进 profile/extensions/
#   会被直接删除，即使设了 xpinstall.signatures.required=false）。
#   Mozilla 只在 Developer Edition / Nightly / ESR 上允许关掉该校验。
#   而本机 snap 商店 CDN 被网络重置（connection reset by peer），
#   没法 `snap refresh --channel=esr/stable`，所以改用 Mozilla 官方
#   ESR tarball 装到 $HOME 下，纯用户级操作。
#
# 幂等：可以反复运行。已有 profile / 已装好的 ESR 不会被覆盖，
#       只更新扩展本体 —— 升级扩展时改 manifest.json 的 version 后重跑即可。
#
# 用法：
#   tools/install-esr.sh
#   ESR_VER=153.5.0esr tools/install-esr.sh      # 指定 ESR 版本
#   APP_DIR=... PROFILE_DIR=... tools/install-esr.sh
#
set -euo pipefail

ESR_VER="${ESR_VER:-153.5.0esr}"
ESR_LANG="${ESR_LANG:-zh-CN}"
APP_DIR="${APP_DIR:-$HOME/firefox-esr}"
PROFILE_DIR="${PROFILE_DIR:-$HOME/.mozilla/firefox/zhihu-esr}"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SNAP_PROFILES="$HOME/snap/firefox/common/.mozilla/firefox"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1
say "1/6 准备扩展包"
XPI="$(ls -1 "$REPO_DIR"/dist/zhihu-cleaner-*.xpi 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$XPI" ]; then
  echo "  dist/ 里没有 xpi，先用 web-ext 打包"
  mkdir -p "$REPO_DIR/dist"
  ( cd "$REPO_DIR" && npx --yes web-ext@8 build --source-dir . --artifacts-dir dist \
      --overwrite-dest --no-input \
      --ignore-files "tools/**" "test/**" "node_modules/**" "dist/**" >/dev/null )
  # web-ext 会把产物命名成 _-<version>.zip，改成正常名字
  for f in "$REPO_DIR"/dist/_-*.zip; do
    [ -e "$f" ] || continue
    v="$(basename "$f")"; v="${v#_-}"; v="${v%.zip}"
    mv -f "$f" "$REPO_DIR/dist/zhihu-cleaner-$v.xpi"
  done
  XPI="$(ls -1 "$REPO_DIR"/dist/zhihu-cleaner-*.xpi | sort -V | tail -1)"
fi
ADDON_ID="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["browser_specific_settings"]["gecko"]["id"])' "$REPO_DIR/manifest.json")"
echo "  扩展包: $XPI"
echo "  add-on id: $ADDON_ID"

# ---------------------------------------------------------------- 2
say "2/6 安装 Firefox ESR $ESR_VER → $APP_DIR"
if [ -x "$APP_DIR/firefox" ] && "$APP_DIR/firefox" --version 2>/dev/null | grep -qF "$ESR_VER"; then
  echo "  已经是 $ESR_VER，跳过下载"
else
  URL="https://ftp.mozilla.org/pub/firefox/releases/$ESR_VER/linux-x86_64/$ESR_LANG/firefox-$ESR_VER.tar.xz"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "  下载 $URL"
  curl -fL --retry 3 --retry-delay 2 -o "$TMP/fx.tar.xz" "$URL"
  echo "  解压…"
  tar -xf "$TMP/fx.tar.xz" -C "$TMP"
  [ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
  mkdir -p "$APP_DIR"
  cp -a "$TMP/firefox/." "$APP_DIR/"
  rm -rf "$APP_DIR.old"
fi
printf '  运行检查: '; "$APP_DIR/firefox" --version

# ---------------------------------------------------------------- 3
say "3/6 准备 profile → $PROFILE_DIR"
# 选源 profile：读 snap 的 profiles.ini 里 Default=1 的那个（不是目录名排第一的那个，
# 否则会挑到一个几乎为空的 profile，导致登录态丢失）；找不到就退而取最大的。
SRC="$(python3 -c '
import configparser, os, sys, glob
base = sys.argv[1]
best = None
try:
    c = configparser.ConfigParser()
    c.read(os.path.join(base, "profiles.ini"))
    for s in c.sections():
        if s.startswith("Profile") and c[s].get("Default") == "1":
            p = os.path.join(base, c[s].get("Path") or "")
            if os.path.isfile(os.path.join(p, "prefs.js")):
                best = p
except Exception:
    pass
if not best:
    cands = [d for d in glob.glob(os.path.join(base, "*"))
             if os.path.isfile(os.path.join(d, "prefs.js"))]
    if cands:
        best = max(cands, key=lambda d: os.path.getsize(os.path.join(d, "places.sqlite"))
                   if os.path.exists(os.path.join(d, "places.sqlite")) else 0)
print(best or "")
' "$SNAP_PROFILES" 2>/dev/null || echo "")"

if [ -f "$PROFILE_DIR/prefs.js" ]; then
  echo "  profile 已存在，保留现有数据（不复写）"
else
  mkdir -p "$(dirname "$PROFILE_DIR")"
  if [ -n "$SRC" ] && [ -f "$SRC/prefs.js" ]; then
    echo "  从 snap profile 复制登录态: $SRC"
    rm -rf "$PROFILE_DIR"
    cp -a "$SRC" "$PROFILE_DIR"
  else
    echo "  没有可复制的 profile，新建空的"
    rm -rf "$PROFILE_DIR"; mkdir -p "$PROFILE_DIR"
  fi
fi
# 清掉可能从源 profile 带过来的锁（否则新实例会以为 profile 正在被占用）
rm -f "$PROFILE_DIR/lock" "$PROFILE_DIR/.parentlock" "$PROFILE_DIR/parent.lock"

# ---------------------------------------------------------------- 4
say "4/6 关闭扩展签名校验"
cat > "$PROFILE_DIR/user.js" <<'EOF'
// 由 zhihu-cleaner/tools/install-esr.sh 写入。
// ESR / Developer Edition / Nightly 是 Mozilla 允许关闭扩展签名校验的通道；
// 正式版会无视这个 pref 并删掉未签名的扩展。
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
EOF
echo "  已写入 $PROFILE_DIR/user.js"

# ---------------------------------------------------------------- 5
say "5/6 永久安装扩展"
mkdir -p "$PROFILE_DIR/extensions"
rm -f "$PROFILE_DIR/extensions/$ADDON_ID.xpi"
cp -f "$XPI" "$PROFILE_DIR/extensions/$ADDON_ID.xpi"
ls -la "$PROFILE_DIR/extensions/" | tail -n +2

# ---------------------------------------------------------------- 6
say "6/6 建启动器"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
# rm -f 是必要的：这里可能残留一个旧版留下的「断链」符号链接，
# 那样 cat > 会以 ENOENT 失败（写穿了不存在的目标）。
rm -f "$HOME/.local/bin/firefox-esr"
cat > "$HOME/.local/bin/firefox-esr" <<EOF
#!/usr/bin/env bash
# 知乎净化器专用 Firefox ESR（profile 与 snap 的 Firefox 分开，互不干扰）
exec "$APP_DIR/firefox" --profile "$PROFILE_DIR" "\$@"
EOF
chmod +x "$HOME/.local/bin/firefox-esr"

rm -f "$HOME/.local/share/applications/firefox-esr.desktop"
cat > "$HOME/.local/share/applications/firefox-esr.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Firefox ESR（知乎净化器）
GenericName=Web Browser
Comment=自带「知乎净化器」扩展的 Firefox ESR
Exec=$HOME/.local/bin/firefox-esr %u
Icon=$APP_DIR/browser/chrome/icons/default/default128.png
Terminal=false
Categories=Network;WebBrowser;
StartupNotify=true
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

cat <<EOF

$(printf '\033[1m')完成。$(printf '\033[0m')
  启动： 应用菜单 →「Firefox ESR（知乎净化器）」  或终端执行 firefox-esr
  改为系统默认浏览器（可选，让别处点的链接也用它）：
      xdg-settings set default-web-browser firefox-esr.desktop
  改回 snap 的 Firefox：
      xdg-settings set default-web-browser firefox_firefox.desktop
EOF
