#!/usr/bin/env bash
# Dylan Heartbeat 夜间备份（1018-12 重写）：聊天记录 + 所有实际在用的数据文件。
# 流程：先生成到 .partial 临时文件 → 校验（gzip 完整性 + 时间线数量 + 大小）→ 通过才改名为正式包 → 成功后才轮转删除旧包。
# 任何一步失败：不改名、不删旧备份，退出码非 0（backup_watch 次日 4:15 会发现断档并告警）。
# 备份目录：important-chat-system-backup/（恢复说明见该目录 README.txt）
set -u
BASE="${PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}"
BK="$BASE/important-chat-system-backup"
KEEP=1
STAMP="$(date +%Y%m%d_%H%M%S)"
FINAL="$BK/ops_$STAMP.tar.gz"
PARTIAL="$BK/.ops_$STAMP.tar.gz.partial"
log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "FAIL: $*"; rm -f "$PARTIAL"; exit 1; }

mkdir -p "$BK" || { echo "FAIL: 无法创建 $BK"; exit 1; }
STAGE="$(mktemp -d /tmp/ops-backup-stage.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
find "$BK" -maxdepth 1 -name '.ops_*.partial' -mtime +0 -delete 2>/dev/null

# 1) 磁盘余量：至少留出「上一份备份 ×2」，不够就不动手（不碰旧备份）
LAST="$(ls -1t "$BK"/ops_*.tar.gz 2>/dev/null | head -1)"
if [ -n "$LAST" ]; then
  LAST_SZ="$(stat -c %s "$LAST")"
  AVAIL_KB="$(df -Pk "$BK" | awk 'NR==2{print $4}')"
  [ "$AVAIL_KB" -gt $(( LAST_SZ * 2 / 1024 )) ] || fail "磁盘余量不足（可用 ${AVAIL_KB}KB，上一份 ${LAST_SZ}B）"
fi

# 2) SQLite 一致性快照（活库带 WAL，直接 tar 可能拿到半截状态；用 sqlite3 备份接口取）
mkdir -p "$STAGE/db_snapshots" "$STAGE/_external/phone_data"
snap() {  # snap <源库> <目标文件>
  /usr/bin/python3.11 - "$1" "$2" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1], timeout=20)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
}
[ -f "$BASE/data/context_msg_vectors.db" ] && { snap "$BASE/data/context_msg_vectors.db" "$STAGE/db_snapshots/context_msg_vectors.db" || log "WARN: context_msg_vectors.db 快照失败（该库可重建，继续）"; }
[ -f /opt/phone_data/records.db ] && { snap /opt/phone_data/records.db "$STAGE/_external/phone_data/records.db" || { log "WARN: phone records.db 快照失败，改为直接复制"; cp -p /opt/phone_data/records.db "$STAGE/_external/phone_data/records.db"; }; }
[ -d /opt/phone_data/chroma ] && cp -a /opt/phone_data/chroma "$STAGE/_external/phone_data/chroma"

# 3) 打包清单（相对 BASE；不存在的自动跳过）
CANDIDATES=(
  timeline_data                       # 聊天记录：所有会话时间线
  data                                # 网关数据：标星/记忆/日记/会话配置/快照/上传图片…
  .env config                         # 配置与密钥（.env 在根目录，其余在 config/）
  little-world/apps                   # 小世界全部小应用数据：用户的日记 / 待办心动 / 月历经期财务 / 恋爱日记 / 沙盒…
  ai-toolbox/tools_config.json ai-toolbox/proxy_tools.json ai-toolbox/tools_manifest.json ai-toolbox/tools_history.json   # 小机工具服务配置
  yun-mcp-v2/config.json
)
BODY=()
for c in "${CANDIDATES[@]}"; do [ -e "$BASE/$c" ] && BODY+=("$c"); done
EXCLUDES=(--exclude='*.bak*' --exclude='*.tmp' --exclude='*.partial' --exclude='_fix_backup_*' --exclude='*.migrated'
          --exclude='__pycache__' --exclude='data/backups' --exclude='data/_v1_archive_*' --exclude='data/timeline_guard'
          --exclude='data/context_msg_vectors.db*'
          --exclude='data/cache')   # 10-29 批C：检索缓存落盘目录（纯缓存可重建，25MB 级且天天变，不进备份）
[ ${#BODY[@]} -gt 0 ] || fail "没有任何可备份的内容"
tar czf "$PARTIAL" -C "$BASE" "${EXCLUDES[@]}" "${BODY[@]}" -C "$STAGE" db_snapshots _external 2>"$STAGE/tar.err"
RC=$?
[ $RC -le 1 ] || fail "tar 失败（rc=$RC）：$(tail -2 "$STAGE/tar.err" | tr '\n' ' ')"   # rc=1 只是「读取期间文件有变动」，可接受
[ $RC -eq 0 ] || log "WARN: tar rc=1（部分文件读取期间被改动）：$(head -2 "$STAGE/tar.err" | tr '\n' ' ')"

# 4) 校验：gzip 完整 + 时间线数量对得上 + 关键文件在 + 大小不异常缩水
gzip -t "$PARTIAL" 2>/dev/null || fail "gzip 校验未通过"
tar tzf "$PARTIAL" > "$STAGE/list.txt" 2>/dev/null || fail "无法读取包目录"
WANT_TL="$(ls -1 "$BASE/timeline_data"/enhanced_messages*.json 2>/dev/null | wc -l)"
GOT_TL="$(grep -cE '^timeline_data/enhanced_messages[^/]*\.json$' "$STAGE/list.txt")"
[ "$GOT_TL" -ge $(( WANT_TL - 2 )) ] || fail "时间线数量对不上（目录 $WANT_TL 个，包内 $GOT_TL 个）"
grep -q '^data/diary.json$' "$STAGE/list.txt" || fail "包内缺少 data/diary.json"
if [ -n "$LAST" ]; then
  NEW_SZ="$(stat -c %s "$PARTIAL")"
  [ "$NEW_SZ" -ge $(( LAST_SZ / 3 )) ] || fail "新包体积异常缩水（${NEW_SZ}B，上一份 ${LAST_SZ}B）"
fi

# 5) 通过 → 改名为正式包；密钥文件副本；成功后才轮转
chmod 600 "$PARTIAL" && mv "$PARTIAL" "$FINAL" || fail "改名失败"
log "OK backup: $(basename "$FINAL") ($(du -h "$FINAL" | cut -f1)) 时间线 $GOT_TL/$WANT_TL 个，条目 $(wc -l < "$STAGE/list.txt")"
if [ -f "$BASE/.env" ]; then
  cp "$BASE/.env" "$BK/env_$STAMP" && chmod 600 "$BK/env_$STAMP"
  ls -1t "$BK"/env_* 2>/dev/null | tail -n +2 | xargs -r rm -f
fi
ls -1t "$BK"/ops_*.tar.gz 2>/dev/null | tail -n +$(( KEEP + 1 )) | xargs -r rm -f
log "kept backups: $(ls -1 "$BK"/ops_*.tar.gz 2>/dev/null | wc -l)（保留最近 $KEEP 份）"
