#!/usr/bin/env bash
# 安全重启（1019 重启保护）：先看有没有回复在生成，再 pm2 restart。
# gateway / state-worker 收到重启信号后会自己「排空」——等生成中的回复写完才退出（最长 110s，pm2 kill_timeout=125s），
# 所以直接 `pm2 restart gateway` 也是安全的；本脚本只是多打印一行进度，方便确认。
# 用法：bash ops/safe_restart.sh [gateway|state-worker|all]    （默认 gateway）
set -u
BASE="${PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
WHAT="${1:-gateway}"
IK="$(grep -E '^INTERNAL_API_KEY=' "$BASE/.env" | cut -d= -f2-)"
busy="$(curl -s -m 5 -H "X-Internal-Key: $IK" http://127.0.0.1:3000/internal/busy 2>/dev/null)"
echo "当前进行中：${busy:-（网关未响应）}"
case "$WHAT" in
  gateway) pm2 restart gateway --update-env ;;
  state-worker) pm2 restart state-worker --update-env ;;
  all) pm2 restart gateway state-worker --update-env ;;
  *) echo "用法：$0 [gateway|state-worker|all]"; exit 1 ;;
esac
echo "已重启 $WHAT（若有回复在生成，已等其收尾后才退出）"
