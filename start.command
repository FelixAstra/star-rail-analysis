#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# 崩铁抽卡分析平台 · 启动器（macOS / Linux）
# 双击本文件 → 起本地服务 → 自动打开浏览器
# 关掉这个终端窗口就停止服务（也可以在窗口里按 Control-C）
#
# 启动逻辑全部在 tools/launch.js（跨平台、可在 macOS 上完整测试），
# 本文件只负责找到 node 并转交。
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1

# ── 找一个可用的 node ──────────────────────────────────────────────────────
NODE_BIN=""
for CAND in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)" \
            "$HOME/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"; do
  if [ -n "$CAND" ] && [ -x "$CAND" ]; then NODE_BIN="$CAND"; break; fi
done
# 再兜底：扫一遍托管目录
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.workbuddy/binaries/node/versions" ]; then
  NODE_BIN="$(ls -1 "$HOME/.workbuddy/binaries/node/versions"/*/bin/node 2>/dev/null | tail -1)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "✗ 没找到 node（本平台零 npm 依赖，但需要一个 Node 运行时）"
  echo
  echo "  装一个就行："
  echo "    · 官网下载 LTS 版：https://nodejs.org/"
  echo "    · 或者用 Homebrew：brew install node"
  echo
  echo "  装完之后重新双击本文件即可。"
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

exec "$NODE_BIN" "$(pwd)/tools/launch.js"
