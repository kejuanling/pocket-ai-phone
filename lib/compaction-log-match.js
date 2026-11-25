// [位置:lib/compaction-log-match.js] [压缩/状态机日志的会话归属与清空过滤] [2026-11-06：状态机页底部要加「清空日志」（只清本会话）；判定逻辑抽成纯函数，便于测试且不与前端显示逻辑各写一份。归属规则：新条目带 session 字段精确匹配；2026-11-06 之前写的旧条目没有 session，回退按 label 里的会话尾号（session 末 12 字符）匹配；后台任务的 label 里没有会话尾号，自然不归任何会话] [注释时间 2026-11-06]

// 会话尾号：状态机日志的 label 一直写成「状态并入 · <sessionId 末 12 位>」
function sessionTail(sessionId) {
  const sid = String(sessionId || "").trim();
  return sid ? sid.slice(-12) : "";
}

// 这条日志是否属于该会话
function belongsTo(log, sessionId) {
  const sid = String(sessionId || "").trim();
  if (!log || !sid) return false;
  if (log.session) return String(log.session) === sid;
  const label = String(log.label || "");
  const tail = sessionTail(sid);
  return (!!tail && label.indexOf(tail) >= 0) || label.indexOf(sid) >= 0;
}

// 还在跑的任务：清空时必须留着，否则 worker 完成回调按 id 更新会找不到条目、重新长出一条
function isRunning(log) {
  return /^(pending|running)$/i.test(String((log && log.status) || "").trim());
}

// 清掉该会话的日志，返回新数组与计数（纯函数，不改入参）
function clearSession(logs, sessionId) {
  const arr = Array.isArray(logs) ? logs : [];
  const out = [];
  let removed = 0;
  let kept = 0;
  arr.forEach(function (l) {
    if (!belongsTo(l, sessionId)) { out.push(l); return; }
    if (isRunning(l)) { kept++; out.push(l); return; }   // 正在算的留着
    removed++;
  });
  return { logs: out, removed: removed, kept: kept };
}

module.exports = { belongsTo, isRunning, clearSession, sessionTail };
