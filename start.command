#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# 崩铁抽卡分析平台 · 启动器
# 双击本文件 → 起本地服务 → 自动打开浏览器
# 关掉这个终端窗口就停止服务（也可以在窗口里按 Control-C）
# ─────────────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
LOG="$ROOT/.server.log"
PORTFILE="$ROOT/.port"

# ── UID 从 data/ 里读，不写死在脚本里 ────────────────────────────────────────
# data/ 整个目录都被 .gitignore 排除，所以公开的仓库里不会有任何账号信息。
# 注意：记录是每行一条、每条都带 uid，所以 -o 会命中很多次，必须只取第一条。
UID_TXT="$(grep -o '"uid"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/data/records.json" 2>/dev/null \
           | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -n "$UID_TXT" ] || UID_TXT="尚未导入"

echo "════════════════════════════════════════"
echo "  崩铁抽卡分析平台"
echo "  UID $UID_TXT · 本地运行，数据不出本机"
echo "════════════════════════════════════════"
echo

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
echo "· Node: $NODE_BIN ($("$NODE_BIN" -v))"

# ── 上一个实例还在跑就先收掉 ────────────────────────────────────────────────
PORT_START=8799      # 与 server/server.js 里的 PORT_START 保持一致

# 只杀「本项目的」服务：须同时满足 ① 命令行含 server/server.js
# ② 工作目录就是本目录。两个条件都卡住，绝不会误伤别的程序占同一个端口。
is_our_server() {
  local PID="$1" CMD CWD
  CMD="$(ps -o command= -p "$PID" 2>/dev/null)"
  case "$CMD" in *server/server.js*) ;; *) return 1;; esac
  CWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [ "$CWD" = "$ROOT" ] || return 1
  return 0
}

FOUND=""
# ① 正规路径：上次留下的端口文件
if [ -f "$PORTFILE" ]; then
  # 只取数字，防止端口文件写入中途被打断留下残缺内容导致 kill 目标错乱
  OLD="$(tr -cd '0-9' < "$PORTFILE" 2>/dev/null)"
  if [ -n "$OLD" ] && lsof -ti "tcp:$OLD" >/dev/null 2>&1; then
    echo "· 发现旧的实例（端口 $OLD），先停掉它"
    for PID in $(lsof -ti "tcp:$OLD" 2>/dev/null); do
      is_our_server "$PID" && FOUND="$FOUND $PID"
    done
  fi
fi

# ② 兜底：端口文件丢了也要能收干净。
#    双击两次、或上次进程是被强杀（SIGKILL，EXIT trap 没跑到）都可能留下一个
#    「没人认领」的实例 —— 那时它照样占着 8799，新实例会顺延到 8800，
#    于是**两个服务同时写 data/records.json**，记录有串掉的风险。
for P in $(seq "$PORT_START" 8811); do
  for PID in $(lsof -ti "tcp:$P" -sTCP:LISTEN 2>/dev/null); do
    case " $FOUND " in *" $PID "*) continue;; esac
    if is_our_server "$PID"; then
      echo "· 发现残留的实例（PID $PID，端口 $P），一并停掉"
      FOUND="$FOUND $PID"
    fi
  done
done

if [ -n "$FOUND" ]; then
  for PID in $FOUND; do kill -9 "$PID" 2>/dev/null; done
  sleep 1
fi
rm -f "$PORTFILE"

# ── 起服务 ────────────────────────────────────────────────────────────────
: > "$LOG"
"$NODE_BIN" "$ROOT/server/server.js" >>"$LOG" 2>&1 &
SRV=$!

cleanup() {
  echo
  echo "· 正在停止服务…"
  kill "$SRV" 2>/dev/null
  wait "$SRV" 2>/dev/null
  rm -f "$PORTFILE"
  echo "· 已停止。"
}
trap cleanup EXIT INT TERM

# ── 等它真的起来（最多 15 秒）──────────────────────────────────────────────
# ⚠️ 端口以服务端写出的 .port 文件为准：它是真实绑定的端口，且在 'listening'
#    回调里写出，写到就代表端口已经在收连接了。
#    不要用 `grep -m1 READY` 去取日志的第一行：默认端口若被别的程序占着，
#    服务会顺延到下一个端口，日志里就不止一行 READY，取第一行会打开**错误的端口**。
URL=""
for i in $(seq 1 60); do
  if ! kill -0 "$SRV" 2>/dev/null; then
    echo "✗ 服务启动失败，日志如下："
    echo "────────────────────────────────────────"
    cat "$LOG"
    echo "────────────────────────────────────────"
    read -n 1 -s -r -p "按任意键关闭…"
    exit 1
  fi
  if [ -f "$PORTFILE" ]; then
    P="$(tr -cd '0-9' < "$PORTFILE" 2>/dev/null)"
    if [ -n "$P" ]; then URL="http://127.0.0.1:$P/"; break; fi
  fi
  sleep 0.25
done

# 兜底：端口文件万一没写出来，退回读日志 —— 但取**最后**一行 READY，不是第一行
if [ -z "$URL" ]; then
  URL="$(grep '^READY ' "$LOG" 2>/dev/null | tail -n1 | sed 's/^READY //')"
fi

if [ -z "$URL" ]; then
  echo "✗ 等了 15 秒服务还没就绪，日志："
  cat "$LOG"
  read -n 1 -s -r -p "按任意键关闭…"
  exit 1
fi

echo "· 服务已就绪：$URL"
open "$URL"
echo
echo "  ✔ 浏览器已打开。用完后关掉这个窗口即可停止服务。"
echo "  （想换端口/看日志：终端里输入 tail -f .server.log）"
echo
wait "$SRV"
