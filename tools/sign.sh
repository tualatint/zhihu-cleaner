#!/usr/bin/env bash
#
# 用 Mozilla AMO 的 API 凭据给扩展签名（unlisted = 不公开上架），
# 产出的 .xpi 可以直接在正式版 Firefox 里**永久安装**，重启不会掉。
#
# 用法：
#   tools/sign.sh
#   WEB_EXT_API_KEY=xxx WEB_EXT_API_SECRET=yyy tools/sign.sh
#
# 凭据在 https://addons.mozilla.org/developers/addon/api/key/ 生成。
# 推荐写进 ~/.amo-keys（避免密钥进入命令行与 shell 历史）：
#   WEB_EXT_API_KEY=xxx
#   WEB_EXT_API_SECRET=yyy
# 然后 chmod 600 ~/.amo-keys
#
set -euo pipefail

cd "$(dirname "$0")/.."

KEY="${WEB_EXT_API_KEY:-}"
SECRET="${WEB_EXT_API_SECRET:-}"

if { [ -z "$KEY" ] || [ -z "$SECRET" ]; } && [ -f "$HOME/.amo-keys" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.amo-keys"
  KEY="${WEB_EXT_API_KEY:-}"
  SECRET="${WEB_EXT_API_SECRET:-}"
fi

if [ -z "$KEY" ] || [ -z "$SECRET" ]; then
  cat >&2 <<'EOF'
缺少 AMO API 凭据。任选一种提供方式：

  1) 环境变量
       export WEB_EXT_API_KEY=用户key
       export WEB_EXT_API_SECRET=用户secret

  2) 写进 ~/.amo-keys（推荐，密钥不进 shell 历史）
       WEB_EXT_API_KEY=用户key
       WEB_EXT_API_SECRET=用户secret
     然后： chmod 600 ~/.amo-keys

凭据生成地址：https://addons.mozilla.org/developers/addon/api/key/
（需要免费注册一个 AMO 账号，扩展会以 unlisted / 不公开 的形式签名。）
EOF
  exit 1
fi

mkdir -p dist

npx --yes web-ext@8 sign \
  --source-dir . \
  --artifacts-dir dist \
  --channel unlisted \
  --api-key "$KEY" \
  --api-secret "$SECRET" \
  --ignore-files "tools/**" "test/**" "node_modules/**" "dist/**" \
  "$@"

echo
echo "签名完成，产物在 dist/ 下（*.xpi）。"
echo "永久安装：about:addons → 右上角齿轮 → 从文件安装附加组件… → 选中该 .xpi"
