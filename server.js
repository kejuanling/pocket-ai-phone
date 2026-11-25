const PROJECT_ROOT = require('./lib/project-root').projectRoot();
require("dotenv").config();

// 2026-09-21 审查 H2：全局异常兜底。Node 15+ 未处理的 Promise rejection 默认杀进程，
// 本进程承载 HTTP/SSE/唤醒定时器/流式回写，任一异步异常都会整体退出——记录后继续运行。
process.on("unhandledRejection", (reason) => {
  const detail = reason && reason.stack ? String(reason.stack).slice(0, 500) : String(reason).slice(0, 500);
  console.error(JSON.stringify({ level: "error", event: "unhandled_rejection", detail }));
});
// 崩溃退出的判定依据（2026-10-29）：见下方 uncaughtException 的说明。
const _procStartedAt = Date.now();
let _crashExitCount = 0;
let _crashExitWindowAt = 0;

process.on("uncaughtException", (err) => {
  const detail = err && err.stack ? String(err.stack).slice(0, 500) : String(err).slice(0, 500);
  console.error(JSON.stringify({ level: "fatal", event: "uncaught_exception", detail }));

  // 2026-10-29 修复（审查 P1）：原实现只记日志、继续运行。
  // uncaughtException 意味着进程状态已不可信（可能写盘写到一半、某个 Map/结构被改坏），
  // 继续接流量会在坏状态上产出错误响应、甚至把错误数据写进时间线；而 pm2 完全看不出来
  // （进程没退出 → 重启计数不涨、告警不触发），问题会静默累积到下次重启才暴露。
  // 改为：标记停机 → 极短窗口把生成中的部分回复落盘（沿用 1025 拍板的「重启可以，字不能丢」）
  // → 以非 0 码退出，交 pm2 拉起干净进程。
  // 窗口只给 300ms 而非 gracefulShutdown 的 110s：异常状态下多待一秒就多一分写坏数据的风险，
  // 这 300ms 只用于跑一次同步的 flushPendingGens，并把上面的日志刷出去。
  // 逃生阀 1：.env 设 DISABLE_CRASH_EXIT=true → 完全回到「只记日志继续跑」的旧行为。
  if (String(process.env.DISABLE_CRASH_EXIT || "").trim().toLowerCase() === "true") {
    console.error(JSON.stringify({ level: "error", event: "uncaught_exception_kept_alive", note: "DISABLE_CRASH_EXIT=true，按旧行为继续运行" }));
    return;
  }
  // 逃生阀 2（防重启风暴）：两种情形下不退出，只记录。
  //   ① 进程启动不足 10s 就崩 —— 大概率「启动即崩」，退出只会让 pm2 反复拉起；
  //      而 ecosystem.config.js 未配 max_restarts，pm2 默认 1 分钟内 16 次重启后判 errored 停服，
  //      那比「带伤继续跑」更糟。
  //   ② 同一个进程内 1 分钟已崩超 3 次 —— 说明某条高频路径在持续抛错，退出救不了。
  // 注意：②的计数在进程重启后归零，所以它只覆盖「单进程内高频抛错」；
  // 覆盖不了「每次跑一阵就崩」的循环（那属 pm2 / 外部监控层面，需人工看致命日志）。
  const _now = Date.now();
  if (_now - _procStartedAt < 10 * 1000) {
    console.error(JSON.stringify({ level: "fatal", event: "uncaught_exception_during_startup", uptime_ms: _now - _procStartedAt, note: "启动 10s 内崩溃，不退出以免 pm2 重启风暴" }));
    return;
  }
  if (_now - _crashExitWindowAt > 60 * 1000) { _crashExitWindowAt = _now; _crashExitCount = 0; }
  _crashExitCount++;
  if (_crashExitCount > 3) {
    console.error(JSON.stringify({ level: "fatal", event: "uncaught_exception_not_exiting", count: _crashExitCount, note: "本进程 1 分钟内超过 3 次，暂停退出以免重启风暴；请查日志定位根因" }));
    return;
  }
  // flushPendingGens / activeGenMap 都在本文件后段声明：这里靠「function 声明提升 + 运行时才调用」，
  // 并整体 try/catch —— 万一异常发生在模块加载早期，兜底逻辑本身也不会二次抛出。
  try { global.__GATEWAY_SHUTTING_DOWN = true; } catch (e2) { /* 忽略 */ }
  try {
    const n = flushPendingGens();
    if (n) console.error(JSON.stringify({ level: "error", event: "uncaught_exception_flushed", count: n }));
  } catch (e2) { /* 落盘兜底失败也要退出，不能卡在坏状态 */ }
  setTimeout(function () { process.exit(1); }, 300);
});

const Fastify = require("fastify");
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
// Context V2 组装（预览接口与主聊天同源，2026-09-19）
const { buildContextBlocks } = require("./context/context-v2-builder");
const ctxV2Shadow = require("./context/context-v2-shadow");
// 会话级配置读写（2026-10-03 从下方抽出）：跨窗口开关要真正生效，
// context-v2-runtime.js 也得读同一份实现，而它是本文件 require 的——只能走 lib，不能反向引用。
const { createSessionCfg } = require("./lib/session-cfg");
const sessionCfg = createSessionCfg(__dirname);
const { readSessionArchive, writeSessionArchive, unarchiveSession } = require("./lib/session-archive");   // 2026-11-03 server.js 拆分批 2：归档名单读写拆出（原 8712-8727 行）
const { sessionCrossInjectOverride, saveSessionCrossInjectOverride, readInjectBlocks, saveInjectBlocks, readStarredDialogLimit, saveStarredDialogLimit, readSessionDiaryCount, saveSessionDiaryCount, readClaudeThinkingEffort, readClaudeCache1h, saveClaudeCache1h, saveClaudeThinkingEffort, readGlmDropHistReasoning, saveGlmDropHistReasoning, readGrokThinkingEffort, saveGrokThinkingEffort, readStripTraceToAi, saveStripTraceToAi } = sessionCfg;

// === MCP 工具循环接入（隔离式，ENABLE_MCP=true 才生效）===
const mcp = require("./mcp/mcp-tool-loop");
const { createClients: mcpCreateClients, probeServer: mcpProbeServer } = require("./mcp/mcp-client");
const MCP_SERVERS_CONFIG = path.join(__dirname, "config", "mcp-servers.json");
const MCP_ENABLED = () => readEnvValue("ENABLE_MCP") === "true";
let _mcpClientsCache = null;
function getMcpClients() {
  if (!_mcpClientsCache) {
    try { _mcpClientsCache = mcpCreateClients(MCP_SERVERS_CONFIG); }
    catch (e) { console.warn("[mcp] 加载配置失败:", e.message); _mcpClientsCache = []; }
  }
  return _mcpClientsCache;
}
// === end MCP ===

// ========================
// 实时推送（SSE）订阅注册表：/v1/events 按会话广播「有新消息」事件，
// 让已打开的聊天页实时收到别的设备发来的消息 / 唤醒主动消息，无需手动刷新。
// ========================
const sseSubscribers = new Map(); // sessionId -> Set<reply>
const SSE_HEARTBEAT_MS = 25000;
function sseSubscribe(sessionId, reply) {
  if (!sseSubscribers.has(sessionId)) sseSubscribers.set(sessionId, new Set());
  sseSubscribers.get(sessionId).add(reply);
}
function sseUnsubscribe(sessionId, reply) {
  const set = sseSubscribers.get(sessionId);
  if (set) { set.delete(reply); if (set.size === 0) sseSubscribers.delete(sessionId); }
}
// 广播一次「该会话有新消息」的轻量信号；聊天页收到后再去拉历史，避免把大 payload 推给所有客户端。
function sseNotify(sessionId) {
  const sid = String(sessionId || "default");
  const set = sseSubscribers.get(sid);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ type: "history_update", session_id: sid, at: Date.now() });
  for (const reply of Array.from(set)) {
    try { reply.raw.write("data: " + payload + "\n\n"); }
    catch (e) { set.delete(reply); } // 2026-09-21 审查 H13：写失败即摘除，死连接不再滞留 Set 反复遍历
  }
}

/* [位置:server.js·sseNotice] [给某个会话的聊天页推一条一次性提示] [模型回退等「后台悄悄换了」的事要让她当场看到；聊天页收到 type=model_fallback 弹 toast] [注释时间 2026-10-22] */
function sseNotice(sessionId, obj) {
  const sid = String(sessionId || "default");
  const set = sseSubscribers.get(sid);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(Object.assign({ session_id: sid, at: Date.now() }, obj));
  for (const reply of Array.from(set)) {
    try { reply.raw.write("data: " + payload + "\n\n"); }
    catch (e) { set.delete(reply); }
  }
}

// 僵尸连接清扫：客户端异常断开时若未触发 close 事件（半死 TCP），reply.raw.destroyed 会置位；
// 周期性扫描并移除，避免 sseSubscribers 里的 Set 无限累积。unref() 不阻止进程退出。
const SSE_ZOMBIE_SCAN_MS = 60 * 1000;
function sweepSseSubscribers() {
  for (const [sid, set] of sseSubscribers) {
    for (const reply of Array.from(set)) {
      // 2026-09-21 审查 H13：destroyed 之外补判 writableEnded/writableFinished（半开连接三选一命中即摘）
      try {
        const raw = reply.raw;
        if (!raw || raw.destroyed || raw.writableEnded || raw.writableFinished) set.delete(reply);
      }
      catch (e) { set.delete(reply); }
    }
    if (set.size === 0) sseSubscribers.delete(sid);
  }
}
setInterval(sweepSseSubscribers, SSE_ZOMBIE_SCAN_MS).unref();

// 客户端可见性（1021）：页面在前台/后台由前端 visibilitychange 上报。
// 推送判据从「有没有 SSE 连接」改成「她是不是真的在看」——iOS 把 PWA 冻到后台后，
// 那条 SSE 在服务端看起来仍然活着（半开 TCP 不会被 destroyed 标记），
// 旧判据会让每次回复完成都被判成「她在看」而跳过推送。
const clientVisible = new Map(); // sessionId -> { visible, at }
const CLIENT_VISIBLE_TTL_MS = 90 * 1000;
function setClientVisible(sessionId, visible) {
  const sid = String(sessionId || "default");
  clientVisible.set(sid, { visible: !!visible, at: Date.now() });
  if (clientVisible.size > 200) {
    const cutoff = Date.now() - CLIENT_VISIBLE_TTL_MS * 4;
    for (const [k, v] of clientVisible) if (!v || v.at < cutoff) clientVisible.delete(k);
  }
}
// 没上报过 = 保守当「没在看」（宁可多推一条，也不要漏）
function isClientWatching(sessionId) {
  const st = clientVisible.get(String(sessionId || "default"));
  if (!st) return false;
  if (Date.now() - (st.at || 0) > CLIENT_VISIBLE_TTL_MS) return false;
  return !!st.visible;
}

// ========================
// 沉底记忆自动清理（1010-17 用户需求）：archived（沉底）超过 7 天的记忆自动硬删除。
// 沉底时间取 superseded_at（updateStatus 归档时写入，revive 恢复时会清空该字段，天然不会被误删）。
// 删除不可恢复，删除前打日志留痕（id + 沉底时间）。每 6 小时扫一次，重启时先扫一遍兜底。
// ========================
const MEMORY_ARCHIVE_TTL_DAYS = 7;
const MEMORY_ARCHIVE_SCAN_MS = 6 * 60 * 60 * 1000;
function sweepArchivedMemories() {
  try {
    const store = require("./memory/memory-v2").createStore({ rootDir: __dirname, config: {} });
    const cutoff = Date.now() - MEMORY_ARCHIVE_TTL_DAYS * 24 * 3600 * 1000;
    const rows = store.list({ status: "archived" });
    const doomed = rows.filter(function (e) {
      if (!e.superseded_at) return false; // 缺沉底时间戳不删，保守兜底
      return new Date(e.superseded_at).getTime() < cutoff;
    });
    for (const e of doomed) {
      const r = store.hardDelete(e.id);
      console.log("[memory-archive-cleanup] 删除沉底超 " + MEMORY_ARCHIVE_TTL_DAYS + " 天记忆 id=" + e.id + " 沉底时间=" + (e.superseded_at || "") + " ok=" + r.ok);
    }
    if (doomed.length) console.log("[memory-archive-cleanup] 本次清理沉底记忆 " + doomed.length + " 条");
  } catch (err) {
    console.error("[memory-archive-cleanup] error:", err && err.message);
  }
}
setInterval(sweepArchivedMemories, MEMORY_ARCHIVE_SCAN_MS).unref();
sweepArchivedMemories(); // 启动先扫一次

// ========================
// 时间线守卫（1010-21 用户需求：会话记录文件被删除时自动强备份，防误删事故重演）。
// 两层：1) 写时保护——saveTimeline 每次落盘后同步副本到 data/timeline_guard/（每会话保留最近 N 份轮转）；
//       2) watchdog——每 5 分钟扫描，发现 enhanced_messages_*.json 缺失（guard 有副本且不在墓碑期）
//       即从副本自动恢复 + 落盘 sentinel_events（后台提醒栏可见）+ Bark 推送。
// 主动删除（墓碑期）不恢复，尊重用户删会话的意图。
// ========================
const TIMELINE_DIR_NAME = "timeline_data"; // 1018-12：时间线文件统一放 timeline_data/（相对 cwd=项目根，与旧 TIMELINE_FILE 约定一致）
const TIMELINE_GUARD_DIR = path.join(__dirname, "data", "timeline_guard");
const TIMELINE_GUARD_KEEP = 3;                 // 每会话保留最近 N 份副本（含最新，轮转）
const TIMELINE_GUARD_SCAN_MS = 5 * 60 * 1000;  // watchdog 巡检间隔

// 写时保护：saveTimeline 落盘后同步一份副本（JSON 字符串与盘上一致）。轮转：<name> → <name>.1 → .2 → .3，删 .4
function guardTimelineCopy(file, content) {
  try {
    fs.ensureDirSync(TIMELINE_GUARD_DIR);
    const gName = path.basename(file);
    if (gName.indexOf("enhanced_messages_s_sub_") === 0) return;  // 2026-10-27：子进程会话不写守护副本（主动清理不该被 watchdog 复活）
    // 旧副本 shift（最多 KEEP-1 份历史）
    for (let i = TIMELINE_GUARD_KEEP - 1; i >= 1; i--) {
      const from = path.join(TIMELINE_GUARD_DIR, gName + "." + i);
      const to = path.join(TIMELINE_GUARD_DIR, gName + "." + (i + 1));
      if (fs.existsSync(from)) { try { fs.renameSync(from, to); } catch (e) { console.warn('[server.js:135] cleanup failed:', e.message); } }
    }
    const latest = path.join(TIMELINE_GUARD_DIR, gName + ".1");
    if (fs.existsSync(path.join(TIMELINE_GUARD_DIR, gName))) {
      try { fs.renameSync(path.join(TIMELINE_GUARD_DIR, gName), latest); } catch (e) { console.warn('[server.js:139] cleanup failed:', e.message); }
    }
    // 最新主副本原子写
    const tmp = path.join(TIMELINE_GUARD_DIR, gName + ".tmp");
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, path.join(TIMELINE_GUARD_DIR, gName));
  } catch (e) { console.warn("[timeline-guard] 写保护失败:", e.message); }
}

// 事件落盘（与 log_sentinel.py 同格式，后台活动「后台提醒」栏 24h 窗口可见；保留最近 50 条）
function appendSentinelEvent(rule, title, body) {
  try {
    const file = path.join(__dirname, "data", "sentinel_events.json");
    let data = { events: [] };
    try {
      const o = readJsonFileSafe(file, null);
      if (o && Array.isArray(o.events)) data = o;
    } catch (e) { console.warn('[server.js:156] optional read failed:', e.message || e); }
    data.events.push({ ts: Date.now(), rule: rule, title: title, body: body });
    data.events = data.events.slice(-50);
    // 用 function 声明的 atomicWriteFileSync（const _writeJsonAtomicBase 在启动兜底时尚未初始化，TDZ）
    atomicWriteFileSync(file, JSON.stringify(data));
  } catch (e) { console.warn("[timeline-guard] 事件落盘失败:", e.message); }
}

// watchdog：巡检根目录时间线 vs guard 副本，缺失即恢复（墓碑期跳过）
function scanTimelineGuard() {
  try {
    if (!fs.existsSync(TIMELINE_GUARD_DIR)) return;
    const guardFiles = fs.readdirSync(TIMELINE_GUARD_DIR).filter(function (f) {
      if (!/^enhanced_messages_.*\.json$/.test(f)) return false;
      if (f.indexOf(".") !== f.lastIndexOf(".")) return false;  // 只认最新主副本（不带 .N 后缀）
      return f.indexOf("enhanced_messages_s_sub_") !== 0;       // 2026-10-27：子进程会话不参与恢复（同 guardTimelineCopy）
    });
    for (const g of guardFiles) {
      const target = path.join(__dirname, TIMELINE_DIR_NAME, g);
      if (fs.existsSync(target)) continue;           // 正常存在
      const token = g.replace(/^enhanced_messages_/, "").replace(/\.json$/, "");
      if (isSessionTombstoned(token)) continue;      // 主动删除（墓碑期）不恢复
      const src = path.join(TIMELINE_GUARD_DIR, g);
      let content = "";
      try { content = fs.readFileSync(src, "utf8"); JSON.parse(content); } catch (e) { console.warn("[timeline-guard] 副本损坏，跳过恢复:", g); continue; }
      atomicWriteFileSync(target, content);
      appendSentinelEvent("timeline-guard-restore", "会话记录文件被删除，已自动恢复", "会话 " + token + " 的时间线文件缺失，已从自动备份恢复（" + g + "）。若非误删请人工确认。");
      sendPushNotification({
        title: "会话记录文件被删，已自动恢复",
        body: "会话 " + token + " 的时间线文件缺失，已从自动备份恢复。若非误删请人工确认。",
        channel: "bark"
      }).catch(function (e) { console.error("[timeline-guard] 推送失败:", e.message); });
      console.warn("[timeline-guard] 已恢复缺失时间线: " + g);
    }
  } catch (e) { console.warn("[timeline-guard] 扫描异常:", e.message); }
}
setInterval(scanTimelineGuard, TIMELINE_GUARD_SCAN_MS).unref();
scanTimelineGuard(); // 启动兜底先扫一次

// ========================
// 幂等回放：同一 client_msg_id 的重复请求直接回放上次已生成的回复，
// 避免网络重发导致上游重复生成 + 时间线重复写入。
// ========================
// client_msg_id -> {text, reasoning, tools, usage, ts}
//                或 {pending:true, ts, waiters:[fn]}（生成中的占位，2026-09-23 F8）
const recentReplies = new Map();
// 1004-05：进行中生成的实时快照（sessionId -> {text, reasoning, tools, ts, done}）。
// 前端断流/切后台回来后轮询 /v1/chat/status 拉这里续显，不再要求用户手动刷新。
// done=true 表示本轮已落盘，保留 10 分钟供最后一次补拉后清理。
const activeGenMap = new Map();
const ACTIVE_GEN_TTL_MS = 10 * 60 * 1000;

// ============================================================
// 生成快照回收者（1021）——参照 TanStack AI 的 lease/reaper：生产者续租（刷新 ts），
// 独立回收者把「租约过期」的快照标成明确终态（done+aborted），读者看到的永远是终态而不是靠猜。
// 全局唯一一个定时器（不是每次生成一个），所以不存在「某条收尾路径漏 clear 造出僵尸」。
// GEN_REAPER_MODE：off 不扫 / dry 只记日志不改状态（默认，先量误判） / reap 真回收。
// GEN_REAPER_STALE_MS：多久没动静算过期，默认 45s（续租补全后 reasoning/工具事件也刷新 ts）。
// ============================================================
const GEN_REAPER_SCAN_MS = 10 * 1000;
function sweepStaleGenerations() {
  const mode = String(process.env.GEN_REAPER_MODE || "dry").toLowerCase();
  if (mode === "off") return 0;
  const staleMs = Number(process.env.GEN_REAPER_STALE_MS) > 0 ? Number(process.env.GEN_REAPER_STALE_MS) : 45 * 1000;
  const now = Date.now();
  let hit = 0;
  for (const [sid, g] of activeGenMap) {
    if (!g) { activeGenMap.delete(sid); continue; }
    // 2026-10-29 修复（审查 P1）：原实现只处理未完成项（g.done 直接 continue），
    // 已完成的快照**没有任何周期回收路径**——唯一的删除点在 routes/chat.js:538，
    // 挂在前端轮询 /v1/chat/status 的请求里；不轮询（或断线后没再拉）的会话，
    // 其快照（整轮 text/reasoning/tools/parts）会永久驻留堆内存。
    // 按 242 行注释承诺的语义「done 后保留 10 分钟供最后一次补拉」到期即回收。
    // 已完成项不涉及在途生成、无中断风险，故不受 GEN_REAPER_MODE=dry 约束
    // （dry 模式的用意是观察「误判在途生成为陈旧」，与已完项无关）。
    if (g.done) {
      if (now - (g.ts || 0) > ACTIVE_GEN_TTL_MS) activeGenMap.delete(sid);
      continue;
    }
    const idle = now - (g.ts || 0);
    if (idle < staleMs) continue;
    hit++;
    if (mode === "reap") {
      g.done = true;
      g.aborted = true;
      g.abortReason = "stale";
      g.ts = now;
      console.warn("[gen-reaper] 回收陈旧生成快照 session=" + sid + " idle=" + Math.round(idle / 1000) + "s chars=" + String(g.text || "").length);
    } else {
      if (!g._reaperNoted) { g._reaperNoted = true; console.warn("[gen-reaper:dry] 会被回收（未改状态） session=" + sid + " idle=" + Math.round(idle / 1000) + "s chars=" + String(g.text || "").length + " reasoning=" + String(g.reasoning || "").length + " tools=" + (g.tools || []).length); }
    }
  }
  return hit;
}
setInterval(sweepStaleGenerations, GEN_REAPER_SCAN_MS).unref();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 分钟内重复请求视为同一条
const RECENT_REPLIES_MAX = 200; // 上限，防止长期运行膨胀（配合 TTL 过期仍会残留，故再加硬上限）
// 2026-09-23 审查 F8：pending 占位的等待上限。首个请求失败/崩溃时要靠它兜底降级，
// 否则重入请求会一直挂到连接超时。取 90s，与客户端「静默超时」同量级。
const IDEMPOTENCY_PENDING_WAIT_MS = 90 * 1000;
// 1003-27：同 client_msg_id 重入请求等待首轮的总上限（5 分钟）。
// 首轮仍在生成时（前端断连自动重发 + 长生成/工具循环）不得降级重调上游，
// 否则会产生双份上游调用、两个一模一样的回复；到总上限仍无结果才允许降级。
const IDEMPOTENCY_PENDING_TOTAL_MS = 5 * 60 * 1000;
// 2026-10-29 新增（审查 P1）：pending 占位的悬挂上限。
// 淘汰时跳过 pending 的原意是「正在生成的占位不能被淘汰，否则同一消息会重复打上游」，
// 但不能没有任何兜底——上游挂起或客户端消失且首轮永不收尾时，pending 只增不减，
// 200 条硬上限完全失效，recentReplies 可无界增长（每条含 text/tools/usage 等完整快照）。
// 取「总等待上限 + 5 分钟」余量：正常生成远早于此时结束，只有真悬挂才会被回收。
const PENDING_EVICT_MS = IDEMPOTENCY_PENDING_TOTAL_MS + 5 * 60 * 1000;
function isRecentReplyCacheable(r) {
  return r && typeof r.text === "string" && r.text.length > 0;
}
// 唤醒某占位的全部等待者（payload=null 表示「降级为新请求处理」）
function _wakeReplyWaiters(entry, payload) {
  if (!entry || !Array.isArray(entry.waiters)) return;
  const ws = entry.waiters;
  entry.waiters = [];
  for (const w of ws) { try { w(payload); } catch (e) { /* client/stream cleanup */ } }
}
// 按 ts 淘汰最旧一条（超上限时）；被淘汰者若是 pending 占位，一并唤醒其等待者
function _evictOldestReply() {
  if (recentReplies.size <= RECENT_REPLIES_MAX) return;
  let oldestKey = null, oldestTs = Infinity;
  for (const [k, v] of recentReplies) {
    if (v && v.pending) continue; // 正在生成的占位不能被硬上限淘汰，否则同一消息会重复打上游
    if (v && typeof v.ts === "number" && v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  // 全是 pending 占位时的兜底：淘汰已悬挂超过 PENDING_EVICT_MS 的最旧一个。
  // 原实现走到这里直接 return，等于「一旦 pending 堆积就再也淘汰不掉」。
  if (oldestKey === null) {
    const now = Date.now();
    for (const [k, v] of recentReplies) {
      if (!v || !v.pending) continue;
      const ts = typeof v.ts === "number" ? v.ts : 0;
      if (ts < oldestTs && (now - ts) > PENDING_EVICT_MS) { oldestTs = ts; oldestKey = k; }
    }
    if (oldestKey !== null) {
      console.warn("[idempotency] 回收悬挂过久的 pending 占位（超过 " + Math.round(PENDING_EVICT_MS / 1000) + "s），避免 recentReplies 无界增长");
    }
  }
  if (oldestKey === null) return;
  const victim = recentReplies.get(oldestKey);
  recentReplies.delete(oldestKey);
  _wakeReplyWaiters(victim, null);
}
// 写入结果并做「按 ts 淘汰最旧」的硬上限；若同 id 存在 pending 占位，唤醒其等待者。
function setRecentReply(id, entry) {
  if (!id) return;
  const prev = recentReplies.get(id);
  recentReplies.set(id, entry);
  _evictOldestReply();
  // 2026-09-23（F8）：唤醒等待同 client_msg_id 的重入请求，让它们回放本次结果而非重复调上游
  if (prev && prev.pending) _wakeReplyWaiters(prev, entry);
}
// 请求开始登记 pending 占位。返回 owner 对象代表本请求取得生成权；false 表示已有结果/请求占位。
// owner 身份必须一路传到 clearPendingReply，避免旧请求迟到收尾时删除新请求的占位。
function beginPendingReply(id) {
  if (!id) return false;
  const cur = recentReplies.get(id);
  if (cur && !cur.pending && isRecentReplyCacheable(cur) && (Date.now() - cur.ts) < IDEMPOTENCY_TTL_MS) return false;
  if (cur && cur.pending) return false;
  const owner = { pending: true, ts: Date.now(), waiters: [] };
  recentReplies.set(id, owner);
  _evictOldestReply();
  return owner;
}
// 等待同 id 的首个请求产出结果；超时或占位消失则返回 null（调用方降级为新请求处理）。
function waitPendingReply(id, timeoutMs) {
  return new Promise(function (resolve) {
    const cur = recentReplies.get(id);
    if (!cur || !cur.pending) { resolve(cur || null); return; }
    let done = false;
    let waiter = null;
    const timer = setTimeout(function () {
      if (done) return; done = true;
      // 1003-27：超时不再删除占位——占位是否仍 pending 由调用方判断（首轮还活着 → 继续等，
      // 不降级重调上游）；删除占位的责任归 clearPendingReply（失败）/setRecentReply（成功覆盖）/
      // 调用方总上限兜底。原实现超时即删占位，会令「首轮 >90s 仍在生成」的重入请求误判首轮已死
      // 而再次调用上游，产生双份相同回复。
      // 2026-10-29 修复（审查 P1）：但**必须把 waiter 自己从数组摘除**——原实现只 resolve
      // 不移除，每个超时的重入请求都会在 waiters 里留一个闭包（持有 resolve 与 timer 引用），
      // 长期运行下该数组只增不减。（成功路径由 _wakeReplyWaiters 整批清空，不受影响。）
      if (waiter) { const i = cur.waiters.indexOf(waiter); if (i >= 0) cur.waiters.splice(i, 1); }
      resolve(null);
    }, Math.max(1000, Number(timeoutMs) || IDEMPOTENCY_PENDING_WAIT_MS));
    waiter = function (entry) {
      if (done) return; done = true;
      clearTimeout(timer);
      resolve(entry || null);
    };
    cur.waiters.push(waiter);
  });
}
// 生成失败时只允许占位所有者释放自己的 pending，避免迟到的旧请求清掉替代状态。
function clearPendingReply(id, owner) {
  if (!id || !owner) return;
  const cur = recentReplies.get(id);
  if (cur === owner && cur.pending) { recentReplies.delete(id); _wakeReplyWaiters(cur, null); }
}

// ---- 模型供应商（多供应商路由）----
const AI_PROVIDERS_CONFIG = path.join(__dirname, "config", "ai-providers.json");
// 1021：发送前来源白名单。单独一个文件，避免被前端「整体保存设置」覆盖掉。
const IP_ALLOW_CONFIG = path.join(__dirname, "config", "ip-allow.json");
function readSendAllowlist() {
  try {
    const j = JSON.parse(fs.readFileSync(IP_ALLOW_CONFIG, "utf-8"));
    const a = Array.isArray(j && j.send_allowlist) ? j.send_allowlist : [];
    return a.map(function (x) { return String(x).trim(); }).filter(Boolean);
  } catch (e) {
    return [];
  }
}
function loadAiProviders() {
  try {
    const raw = fs.readFileSync(AI_PROVIDERS_CONFIG, "utf-8");
    const cfg = JSON.parse(raw);
    return Array.isArray(cfg) ? cfg : (Array.isArray(cfg.providers) ? cfg.providers : []);
  } catch (e) { return []; }
}
function saveAiProviders(list, roleModels) {
  // role_models 随 providers 同文件保存：调用方传入则用传入值，否则保留盘上现值
  let rm = (roleModels && typeof roleModels === "object") ? roleModels : loadRoleModelsRaw();
  writeJsonFileAtomic(AI_PROVIDERS_CONFIG, { providers: list || [], role_models: rm || {} });
}
// 按用途路由模型（2026-09-24）：抽到独立 model-router.js，server.js API 与后台任务模块共用同一份解析
const {
  KNOWN_MODEL_ROLES,
  loadRoleModelsRaw,
  saveRoleModel,
  resolveRoleModel,
  providerUsable
} = require("./lib/model-router");

// ---- 人设权威（2026-09-24 B 方案）：服务端自己决定该会话该用哪个人设，前端请求带的 system 不再决定盘上存什么 ----
// 解析顺序：data/session-prompts.json(sid->backupId) -> data/prompt-backups.json 内容 -> chat-settings.json 全局 system_prompt
// 1007-17 人设 gitid：把「该会话当前引用哪份人设备份」单独抽出来，供人设版本化取标识。
// 原逻辑就藏在 resolveSessionSystemPrompt 里，抽出来后两边共用同一口径，不会漂移。
function sessionPromptBackupId(sessionId) {
  try {
    const sid = String(sessionId || "default").trim() || "default";
    const spFile = path.join(__dirname, "data", "session-prompts.json");
    if (fs.existsSync(spFile)) {
      const j = JSON.parse(fs.readFileSync(spFile, "utf-8"));
      // 0929-30：session-prompts.json 是顶层结构 {sid: backupId}（无 prompts 包裹），
      // 旧读取 j.prompts[sid] 永远读不到 → 会话级人设一直回退全局。兼容两种结构。
      if (j && typeof j === "object") {
        if (typeof j[sid] === "string") return j[sid];
        if (j.prompts && typeof j.prompts[sid] === "string") return j.prompts[sid];
      }
    }
  } catch (e) { console.error('[server.js:326]', e.message || e); }
  return "";
}
function resolveSessionSystemPrompt(sessionId) {
  try {
    const sid = String(sessionId || "default").trim() || "default";
    // 1) 会话级映射
    const backupId = sessionPromptBackupId(sid);
    if (backupId) {
      try {
        const pbFile = path.join(__dirname, "data", "prompt-backups.json");
        if (fs.existsSync(pbFile)) {
          const arr = JSON.parse(fs.readFileSync(pbFile, "utf-8"));
          const hit = Array.isArray(arr) ? arr.find(function (b) { return b && b.id === backupId && typeof b.content === "string"; }) : null;
          if (hit && hit.content && hit.content.trim()) return hit.content.trim();
          console.warn("[resolveSessionSystemPrompt] 会话人设引用的备份缺失，回退全局人设: session=" + sid + " backupId=" + backupId);
        } else {
          console.warn("[resolveSessionSystemPrompt] 会话人设引用的备份缺失（备份文件不存在），回退全局人设: session=" + sid + " backupId=" + backupId);
        }
      } catch (e) { console.error('[server.js:345]', e.message || e); }
    }
  } catch (e) { console.error('[server.js:347]', e.message || e); }
  // 2) 全局人设（chat-settings.json）
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "chat-settings.json"), "utf-8"));
    if (cs && typeof cs.system_prompt === "string" && cs.system_prompt.trim()) return cs.system_prompt.trim();
  } catch (e) { console.warn('[server.js:352] optional read failed:', e.message || e); }
  return "";
}
// 1021：有没有可用的凭证。OAuth 订阅供应商没有 api_key（令牌在服务端自己管），
// 但它是可用的——此前的判断只看 api_key，会把 Claude 订阅当成「不可用」静默回退到别的供应商。
// 1022：判据从「配置里写着 oauth_provider」改成「令牌库里真的有令牌」。
// 老写法把凭证的存在性押在一个会被前端整表回存的字段上，配置页漏带一次就把有令牌的供应商判死
// （10-22 事故：Claude 订阅被回存丢了 oauth_provider，会话静默回退默认模型）。
// 三处调用问的是同一个问题，所以只在这里判一次；文件很小，5 秒缓存兜住每请求调用。
/* [位置:server.js·providerHasCredential] [凭证闸门的判据] [判「能不能用」只问令牌库，不问会被前端回存抹掉的配置字段] [注释时间 2026-10-22；改动：oauth 供应商改为查令牌库 + 5 秒缓存] */
const _oauthCredCache = new Map();
function oauthCredentialUsable(op) {
  const at = Date.now();
  const hit = _oauthCredCache.get(op);
  if (hit && at - hit.at < 5000) return hit.ok;
  let ok = false;
  try {
    // 三家同一口径：令牌库里有令牌，且不是「全部账号都失效」的状态
    ok = !!require('./lib/oauth-login').hasToken(op) && !require('./lib/oauth-pool').needsReauth(op);
  } catch (e) { ok = false; }
  _oauthCredCache.set(op, { at: at, ok: ok });
  return ok;
}
function providerHasCredential(p) {
  if (!p) return false;
  const op = String(p.oauth_provider || '').trim();
  if (op) return oauthCredentialUsable(op);
  return !!(p.api_key && String(p.api_key).trim());
}
// 取「标记为默认」或第一个已启用的供应商（未配置则回退 TARGET_API_*）
function resolveActiveProvider() {
  const ps = loadAiProviders();
  const def = ps.find(function (p) { return p.is_default === true && p.enabled !== false && (p.api_url || p.base_url) && providerHasCredential(p); });
  if (def) return def;
  return ps.find(function (p) { return p.enabled !== false && (p.api_url || p.base_url) && providerHasCredential(p); }) || null;
}
/* [位置:server.js·providerUnusableReason] [供应商现在能不能用，不能用说原因] [设置会话模型时当场拒绝并说明；与 resolveChatModel 的 usable 判断同口径] [注释时间 2026-10-22] */
function providerUnusableReason(pid) {
  const p = loadAiProviders().find(function (x) { return x && x.id === pid; });
  if (!p) return "这个供应商已经不存在了";
  if (p.enabled === false) return "这个供应商是停用状态";
  if (!(p.api_url || p.base_url)) return "这个供应商没填地址";
  if (!providerHasCredential(p)) {
    // 订阅登录类：把「还没登录」和「登录已失效」分开说，前端和回退提示都靠这句话
    const op = String(p.oauth_provider || '').trim();
    if (op) {
      let st = null;
      try {
        st = op === 'claude' ? require('./lib/claude-token').status() : require('./lib/oauth-login').status(op);
      } catch (e) { st = null; }
      if (st && st.needs_reauth) return '订阅登录已失效（' + (st.needs_reauth_reason || '令牌被拒') + '），去设置页点「登录」重新授权一下';
      return '订阅登录还没连上（令牌库里没有令牌），去设置页点「登录」授权一下';
    }
    return "这个供应商没有可用的凭证（没填 Key，或订阅登录信息丢了）";
  }
  return "";
}
const _fallbackNoticeAt = new Map();
// 统一聊天模型解析（2026-09-08）：会话级设置(供应商+模型) → 全局默认供应商 → env 兜底。
// 直通路径与 MCP 工具循环共用同一口径；模型名必须属于供应商模型列表，不在则回退供应商默认并告警。
function resolveChatModel(sessionId, bodyModel, opts) {
  const quiet = !!(opts && opts.quiet);   // 2026-10-28：菜单只读解析时不弹 fallback 提示、不刷告警
  const sessPid = sessionModelProviderOverride(sessionId);
  const sessModel = sessionModelNameOverride(sessionId);
  const providers = loadAiProviders();
  const usable = function (p) { return p && p.enabled !== false && (p.api_url || p.base_url) && providerHasCredential(p); };
  const modelsOf = function (p) {
    if (Array.isArray(p.models) && p.models.length) return p.models;
    if (p.model) return [p.model];
    return [];
  };
  // L1 会话级显式设置
  if (sessPid) {
    const hit = providers.find(function (p) { return p.id === sessPid && usable(p); });
    if (hit) {
      const list = modelsOf(hit);
      if (sessModel && list.length && list.indexOf(sessModel) < 0) {
        console.warn("[resolveChatModel] 会话指定模型不在该供应商列表，回退供应商默认: " + sessModel);
      } else if (sessModel) {
        return { provider: hit, model: sessModel };
      }
      return { provider: hit, model: hit.model || list[0] || sessModel || bodyModel || "" };
    }
    if (!quiet) console.warn("[resolveChatModel] 会话指定供应商不可用，回退全局默认: " + sessPid);
    // 2026-10-22：不再只写后台日志——聊天页弹提示说清楚「设的是什么、实际用的是什么、为什么」（同一会话 60 秒内只提示一次）
    if (!quiet) try {
      const _now = Date.now();
      if (sessionId && _now - (_fallbackNoticeAt.get(sessionId) || 0) > 60000) {
        _fallbackNoticeAt.set(sessionId, _now);
        const _want = providers.find(function (p) { return p.id === sessPid; });
        const _act = resolveActiveProvider();
        sseNotice(sessionId, {
          type: "model_fallback",
          text: "这个会话设的「" + ((_want && _want.name) || sessPid) + (sessModel ? " · " + sessModel : "") + "」现在用不了（" + (providerUnusableReason(sessPid) || "原因不明") + "），这次先用默认的「" + ((_act && _act.name) || "默认") + " · " + ((_act && _act.model) || "") + "」",
        });
      }
    } catch (e) { /* 提示失败不影响回复 */ }
  }
  // L2 全局默认供应商
  const active = resolveActiveProvider();
  if (active) {
    const list = modelsOf(active);
    const bm = bodyModel && (!list.length || list.indexOf(bodyModel) >= 0) ? bodyModel : "";
    if (bodyModel && list.length && list.indexOf(bodyModel) < 0) {
      console.warn("[resolveChatModel] 请求模型不在默认供应商列表，回退供应商默认: " + bodyModel);
    }
    return { provider: active, model: bm || active.model || list[0] || "" };
  }
  // L3 env 兜底
  return { provider: null, model: bodyModel || readEnvValue("MODEL_NAME") || "" };
}
// 2026-09-30 V4 收敛：消息时间戳原子件统一引 time_utils（本地四份正则实现已删），
// 别名保持原函数名，调用点零改动。parseCurrentTimeTagLoose/parseLeadingWallTime/parseTrailingWallTime
// 为原 extractCurrentTimeTagLabel/parseTimestampLabel/extractTrailingTimestampLabel 的并集增强版。
const {
  getDatePartsInTimeZone,
  formatDateTimeInTimeZone,
  parseWakeTarget,
  resolveTimeZone,
  zonedWallTimeToDate,
  parseCurrentTimeTagLoose: extractCurrentTimeTagLabel,
  parseLeadingWallTime: parseTimestampLabel,
  parseLeadingWallTime: extractTimestamp,
  parseTrailingWallTime: extractTrailingTimestampLabel
} = require("./utils/time_utils");
const { writeJsonAtomic: _writeJsonAtomicBase } = require("./utils/json_atomic");

const contextCompactor = require("./context/context-compactor");
const sendQueue = require("./lib/send-queue");   // 11-04 发送排队
const traceLib = require("./lib/trace");   // 11-04 此刻 <trace>：落盘处剥离
const traceNotes = require("./lib/trace-notes");   // 11-07 此刻记录库（整句存，一条一个 msg_id）
const phoneTags = require("./workspace/phone-tags.js");   // 11-06：卡片 <card> JSON 容错（与前端同一份：落库前修 + 比对归一）
const contextReplacements = require("./context/context-replacements");
const conversationState = require("./lib/conversation-state");
const compactionLogMatch = require("./lib/compaction-log-match");
const { httpPostJson } = require("./lib/http_json"); // 1007-05：状态机独立进程转发 worker 用
// 状态机日志接进压缩页悬浮球（addCompactionLog 是函数声明，提升可用；闭包隔开 compactionLogs 的 TDZ）
conversationState.setLogFn(function (entry) {
  // 1004-12：状态机日志统一打 action=state 标签，前端压缩页日志按"状态机压缩"分组
  if (entry && typeof entry === "object" && !entry.action) entry = Object.assign({}, entry, { action: "state" });
  return addCompactionLog(entry);
});

const DEFAULT_BODY_LIMIT_MB = 50;

// 请求体大小上限（MB → 字节）：REQUEST_BODY_LIMIT_MB 可调，默认 50MB（大 base64 附件需要）
function readBodyLimitBytes() {
  const configured = Number(process.env.REQUEST_BODY_LIMIT_MB);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BODY_LIMIT_MB;
  return Math.floor(mb * 1024 * 1024);
}

const app = Fastify({
  logger: true,
  bodyLimit: readBodyLimitBytes()
});

app.register(require("@fastify/formbody"));

// [位置:server.js·octet-stream 流式解析器] [工作流大文件直传通道] [11-10：上传 exe（98MB）走原 JSON+base64 通道过不去（nginx 20m+base64 膨胀）；新增 /admin/workflow/upload-raw 直传端点，body 用原始字节流（fastify 5 自定义 parser 不传 parseAs 时默认拿 stream，路由侧 pipe 落盘，不整读进内存）；parser 级 bodyLimit 220MB 覆盖全局 50MB，只对声明 Content-Type: application/octet-stream 的请求生效，现有 JSON/text 接口不受影响] [注释时间 2026-11-10]
app.addContentTypeParser("application/octet-stream", { bodyLimit: 220 * 1024 * 1024 }, (req, payload, done) => done(null, payload));

// 多会话：压缩/上下文替换按会话时间线工作。对 /admin/context-compaction/* 与 /admin/context-replacements/* 请求，从 query 的 session_id 设置活跃会话；响应后复位（无 session_id 则回退主会话）。
// 2026-10-03：/admin/conversation-state/*（状态机）也按会话工作，接进同一个机制——
// 否则 compressibleItems()/loadTimeline() 读到的是「上一个请求留下的活跃会话」，
// 并入的原文会取错会话。对已有两个前缀的行为零改动（它们只传 session_id）。
app.addHook("onRequest", async (req, reply) => {
  if (req.url && (req.url.startsWith("/admin/context-compaction") || req.url.startsWith("/admin/context-replacements") || req.url.startsWith("/admin/conversation-state"))) {
    const sidRaw = req.query && (req.query.session_id !== undefined ? req.query.session_id : req.query.session);
    const sid = sidRaw ? String(sidRaw) : null;
    req.__ctxWasSet = sid != null;
    contextReplacements.setActiveSession(sid);
  }
});
app.addHook("onResponse", async (req, reply) => {
  if (req.__ctxWasSet) {
    contextReplacements.setActiveSession(null);
    req.__ctxWasSet = false;
  }
});

const PORT = Number(process.env.PORT) || 3000;
const TARGET_API_URL = process.env.TARGET_API_URL;
const TIME_ZONE = resolveTimeZone();
const IS_RAILWAY_RUNTIME = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID
);
const TIMELINE_FILE = path.join(TIMELINE_DIR_NAME, "enhanced_messages.json");
try { fs.ensureDirSync(TIMELINE_DIR_NAME); } catch (e) { console.error("[timeline] 建 timeline_data 失败:", e.message); }
// 多会话：按 sessionId 计算对应的时间线文件。
// 空/缺省 sessionId 走默认主会话（enhanced_messages.json），100% 兼容旧行为。
// 清洗后为空的会话ID（如纯中文）用哈希生成稳定文件名：否则不同会话会共用 enhanced_messages_.json 串数据。
// 2026-09-21 审查 R20：实现收敛到 lib/session-token.js（diary.js / context-replacements.js 同源副本已一并收敛）
const { safeSessionToken } = require("./lib/session-token");
const upstreamAlert = require("./lib/upstream-alert"); // 2026-09-28 上游 402（余额不足）提醒
upstreamAlert.setPushFn(function (opts) { return sendPushNotification(opts); });

// 1021：Claude 订阅的出海线路看护。每 5 分钟探一次出口，断了且已配置可选集成时重连；
// 连续 3 次失败就停手并发 Bark，把状态交回给人。只影响 Claude 那条供应商，
// 出口守卫会继续拦着不让裸奔，其它聊天完全不受影响。
try {
  const egressKeeper = require("./lib/egress-keeper");
  egressKeeper.setPushFn(function (opts) { return sendPushNotification(opts); });
  egressKeeper.start();
} catch (e) {
  console.warn("[egress-keeper] 启动失败（不影响主服务）:", e.message);
}
function timelineFileFor(sessionId) {
  // 1009-06：default「主会话」概念已清理（早期遗留，无主/副之分）——default 不再映射主时间线，
  // 与其他会话同一路径 enhanced_messages_<token>.json
  const token = safeSessionToken(sessionId);
  return path.join(TIMELINE_DIR_NAME, "enhanced_messages_" + token + ".json");
}
// 批注 2026-07-17：管理页保存 .env 后要让 PM2 刷新进程环境；保留原进程名，
// 只补 --update-env，避免用户改完推送配置却继续运行旧值。
const DEFAULT_RESTART_COMMAND = "cd " + PROJECT_ROOT + " && pm2 restart gateway --update-env 2>&1";
// 上游模型请求超时（毫秒），防止上游挂起时 /v1 请求永久阻塞
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 180000;

// 布尔环境读取：注意这里直读 process.env（非 readEnvValue 的 cachedEnv 口径），
// 管理台改 .env 后要等重启才对本函数生效
function readBooleanEnv(key, fallback = false) {
  const raw = String(process.env[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function publicApiEnabled() {
  const raw = String(readEnvValue("ALLOW_PUBLIC_API") || "").trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(raw);
}

function configuredModelName() {
  // 批注 2026-07-15：/v1/models 要暴露部署者实际配置的模型名；
  // 不能继续硬编码示例模型，否则 Kelivo 模型选择会和真实上游不一致。
  return String(readEnvValue("MODEL_NAME") || "gateway-model").trim() || "gateway-model";
}

// ========================
// 多模态消息处理
// ========================

function isImageContentPart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.image_url) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("image");
}

function isFileContentPart(part) {
  if (!part || typeof part !== "object") return false;
  if (part.file) return true;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  return type.includes("file");
}

// 文件 part → 文本摘要：LLM/时间线/日志共用（LLM 不解析 file 结构，只感知"用户发了文件"）
function filePartSummary(part) {
  const f = (part && typeof part === "object" && part.file) || null;
  if (f && typeof f === "object") {
    const name = String(f.name || "文件").trim() || "文件";
    const mime = String(f.mime || "").trim();
    const size = typeof f.size === "number" && f.size > 0 ? f.size : 0;
    let s = "[文件] " + name;
    if (mime) s += "（" + mime + "）";
    if (size) s += "，" + (size >= 1048576 ? (size / 1048576).toFixed(1) + "MB" : size >= 1024 ? Math.round(size / 1024) + "KB" : size + "B");
    return s;
  }
  return "[文件]";
}


// ========================
// 文件内容注入（2026-09-10 方案A）：文本类文件把正文读进模型上下文，
// 让 AI 真正"看到"文件内容；非文本保留元信息摘要，正文读取失败会明确标注。
// 仅 LLM 转发链路使用；时间线/日志仍走 filePartSummary 纯摘要，防 localStorage 膨胀。
// ========================
const UPLOADS_DIR = path.join(__dirname, "data", "uploads");
const TEXT_FILE_EXTS = new Set([
  "txt", "md", "markdown", "csv", "json", "log", "py", "js", "mjs", "ts", "tsx", "jsx",
  "html", "htm", "css", "xml", "yaml", "yml", "ini", "conf", "cfg", "sh", "bash", "zsh",
  "java", "c", "h", "cpp", "hpp", "go", "rs", "sql", "toml", "env", "properties", "rst",
  "tex", "vue", "svelte", "dockerfile", "gradle", "lock"
]);
function isTextFilePart(fileObj) {
  const f = fileObj && typeof fileObj === "object" ? fileObj : {};
  const m = String(f.name || "").match(/\.([a-zA-Z0-9]{1,12})$/);
  const ext = m ? m[1].toLowerCase() : "";
  if (TEXT_FILE_EXTS.has(ext)) return true;
  const mt = String(f.mime || "").toLowerCase();
  return mt.startsWith("text/") ||
    mt === "application/json" || mt === "application/xml" ||
    mt === "application/javascript" || mt === "application/x-javascript" ||
    mt === "application/yaml" || mt === "application/x-yaml";
}
// 1008-20：文档类文件（PDF/Word docx）——正文走上传时提取的 <原文件>.txt 缓存，模型可见内容
function isDocFilePart(fileObj) {
  const f = fileObj && typeof fileObj === "object" ? fileObj : {};
  const m = String(f.name || "").match(/\.([a-zA-Z0-9]{1,12})$/);
  const ext = m ? m[1].toLowerCase() : "";
  if (ext === "pdf" || ext === "docx") return true;
  const mt = String(f.mime || "").toLowerCase();
  return mt === "application/pdf" || mt.indexOf("wordprocessingml") >= 0;
}
// 读文档正文缓存（<原文件>.txt，上传时由 /v1/upload-file 生成；旧文件/解析失败无缓存返回 null）
function readDocCacheFile(fileObj) {
  const f = fileObj && typeof fileObj === "object" ? fileObj : {};
  const url = String(f.url || "");
  const m = url.match(/\/uploads\/([^/?#]+)/);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; }
  const fp = path.join(UPLOADS_DIR, path.basename(name)) + ".txt";
  try {
    const s = fs.readFileSync(fp, "utf8");
    return s || null;
  } catch (e) { return null; }
}
// 从 /uploads/<file> URL 读取本地文件正文（同步，只读前 maxLen+1 字节，超长截断）。失败返回 null。
function readUploadedFileContent(fileObj, maxLen) {
  maxLen = maxLen || 10000;
  const f = fileObj && typeof fileObj === "object" ? fileObj : {};
  const url = String(f.url || "");
  const m = url.match(/\/uploads\/([^/?#]+)/);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; }
  const fp = path.join(UPLOADS_DIR, path.basename(name));
  try {
    const fd = fs.openSync(fp, "r");
    let s = "";
    try {
      const buf = Buffer.alloc(maxLen + 1);
      const n = fs.readSync(fd, buf, 0, maxLen + 1, 0);
      if (n > 0) s = buf.toString("utf8", 0, n);
    } finally { fs.closeSync(fd); }
    if (s.length > maxLen) s = s.slice(0, maxLen) + "\n…(内容过长已截断)";
    return s;
  } catch (e) { return null; }
}
// 文件 part -> LLM 文本：可读文本注入正文；必需正文缺失时显式告知，不再静默降级为摘要。
function filePartTextForLLM(part) {
  const summary = filePartSummary(part);
  const f = part && typeof part === "object" && part.file ? part.file : null;
  if (!f) return summary;
  if (!isTextFilePart(f) && !isDocFilePart(f)) return summary;
  if (isTextFilePart(f)) {
    const content = readUploadedFileContent(f);
    if (content === null || !content.trim()) return summary + "\n【正文读取失败：当前只有文件元信息，未读取到正文；不要声称已阅读文件全文。】";
    return summary + "\n【文件内容】\n" + content;
  }
  // 上传阶段应已提取 PDF/DOCX 正文；旧附件或缓存丢失时显式标注，绝不静默伪装成已读取全文。
  const docText = readDocCacheFile(f);
  if (docText && docText.trim()) return summary + "\n【文件内容】\n" + docText;
  return summary + "\n【正文读取失败：当前只有文件元信息，未读取到正文；不要声称已阅读文件全文。】";
}

function getTextFromContentPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (type === "text" || type === "input_text") return part.text || part.content || "";
  if (typeof part.text === "string") return part.text;
  return "";
}

// 从 assistant 消息提取思考链文本：依次找 reasoning_content/reasoning/thinking 字段
// （字符串或分片数组），再找 content 里的 think/reason 类型分片；取第一个非空来源
function extractAssistantThinking(message) {
  if (!message || typeof message !== "object") return "";
  const direct = [message.reasoning_content, message.reasoning, message.thinking];
  for (const v of direct) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) {
      const s = v.map(p => (typeof p === "string" ? p : (p && (p.text || p.content)) || "")).filter(Boolean).join("\n").trim();
      if (s) return s;
    }
  }
  if (Array.isArray(message.content)) {
    const parts = message.content.filter(p => p && typeof p === "object" && typeof p.type === "string" && (p.type.toLowerCase().includes("think") || p.type.toLowerCase().includes("reason")));
    const s = parts.map(p => p.text || p.content || "").filter(Boolean).join("\n").trim();
    if (s) return s;
  }
  return "";
}

// 任意 content 形态（字符串/多模态数组/null）→ 纯文本：文本分片取文本、图片→[图片]、
// 文件→元信息摘要、其他→[非文本内容]。全文件最常用的内容归一函数，时间线/日志/扣住等都靠它
function normalizeContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    const parts = content
      .map(part => {
        const text = getTextFromContentPart(part).trim();
        if (text) return text;
        if (isImageContentPart(part)) return "[图片]";
        if (isFileContentPart(part)) return filePartSummary(part);
        return "";
      })
      .filter(Boolean);
    return parts.join("\n");
  }

  if (isImageContentPart(content)) return "[图片]";
  if (isFileContentPart(content)) return filePartSummary(content);
  return "[非文本内容]";
}

// 截掉 Kelivo 客户端 system prompt 自带的「## search_web 工具使用说明」及之后内容
// （第三方 App 注入的宣传段，与本项目人设无关，不进时间线/不进模型）
function stripKelivoSystemBloat(text) {
  const marker = '## search_web 工具使用说明';
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  return text.substring(0, idx).trimEnd();
}

// 时间线落盘前的消息归一：content 转纯文本；system 额外剥 Kelivo 自带说明段
function normalizeMessageForTimeline(msg) {
  const raw = normalizeContentToText(msg.content);
  const cleaned = msg.role === 'system' ? stripKelivoSystemBloat(raw) : raw;
  return { ...msg, content: cleaned };
}


/* [位置:server.js·getContextHiddenDiaryIds / formatTimelineDiaryForLLM] [时间线日记按 id 隐藏与展示 id] [按 diary.json mtime 缓存 context_hidden 集合；发给模型前过滤掉已取消上下文固定展示的时间线日记（不影响聊天记录和检索），未隐藏的在日记时间行补带 id 供 AI 识别] [注释时间 2026-11-24] */
let _diaryCtxHiddenCache = { mtimeMs: -1, ids: new Set() };
function getContextHiddenDiaryIds() {
  try {
    const p = diaryStore.storePath(__dirname);
    const st = fs.statSync(p);
    if (st.mtimeMs === _diaryCtxHiddenCache.mtimeMs) return _diaryCtxHiddenCache.ids;
    const entries = diaryStore.listEntries(__dirname);
    const ids = new Set();
    for (const e of entries) {
      if (e && (e.context_hidden === true || e.hidden === true)) ids.add(String(e.id));
    }
    _diaryCtxHiddenCache = { mtimeMs: st.mtimeMs, ids };
    return ids;
  } catch (e) {
    return _diaryCtxHiddenCache.ids;
  }
}

function formatTimelineDiaryForLLM(msg) {
  if (!msg || msg.kind !== "diary" || msg.diary_id == null) return msg;
  const idStr = String(msg.diary_id);
  if (getContextHiddenDiaryIds().has(idStr)) return null;
  if (typeof msg.content !== "string" || !msg.content) return msg;
  const firstLine = msg.content.split("\n")[0] || "";
  if (/\bid:\s*\d+/i.test(firstLine)) return msg;
  if (/^\s*（(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) diary）/.test(msg.content)) {
    return { ...msg, content: msg.content.replace(/^(\s*（\d{4}-\d{2}-\d{2} \d{2}:\d{2} diary）)/, (m) => m.slice(0, -1) + " · id:" + idStr + "）") };
  }
  return { ...msg, content: "（diary · id:" + idStr + "）\n" + msg.content };
}

// 消息 → LLM 可用形态（发模型前的统一入口）：system 清洗、文件 part 转文本（文本类注入正文，
// 见「文件内容注入」节）、多模态数组透传/转文本、空内容返回 null 由调用方丢弃
function prepareMessageForLLM(msg) {
  if (msg.role === "assistant" && msg.tool_calls) return msg;
  if (msg.role === "tool") return msg;
  if (msg.role === "system") {
    // 系统时间不再追加到 system prompt，改为动态注入到最后一条 user 之后（方案A）
    let content = stripKelivoSystemBloat(normalizeContentToText(msg.content));
    return { ...msg, content };
  }
  if (msg.kind === "diary" && msg.diary_id != null) {
    const formatted = formatTimelineDiaryForLLM(msg);
    if (!formatted) return null;
    msg = formatted;
  }
  if (typeof msg.content === "string") return msg;

  if (Array.isArray(msg.content)) {
    // 2026-09-10：文件 part 上游模型不解析（可能拒收未知结构），转文本摘要；图片 part 原样透传。
    // 2026-09-10 方案A：文本类文件把正文读进上下文（readUploadedFileContent），AI 真正可见文件内容；
    // 非文本附件保持元信息摘要；文本/PDF/DOCX 正文缺失时注入明确警告，避免误称已读全文；图片 part 原样透传。
    if (!msg.content.some(isFileContentPart)) return msg;
    return { ...msg, content: msg.content.map(function (p) {
      if (isFileContentPart(p)) return { type: "text", text: filePartTextForLLM(p) };
      return p;
    }) };
  }

  const textContent = normalizeContentToText(msg.content);
  if (!textContent) return null;
  return { ...msg, content: textContent };
}

// 单条消息的日志摘要（只记角色/形态/字数/分片数，内容不进 pm2 日志）
function summarizeMessageForLog(msg) {
  const parts = Array.isArray(msg?.content) ? msg.content : [msg?.content];
  const textChars = parts.reduce((sum, part) => sum + getTextFromContentPart(part).length, 0);
  return {
    role: msg?.role || "",
    content_type: Array.isArray(msg?.content) ? "multimodal" : typeof msg?.content,
    text_chars: textChars || normalizeContentToText(msg?.content).length,
    image_parts: parts.filter(isImageContentPart).length,
    file_parts: parts.filter(isFileContentPart).length,
    tool_calls: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : 0
  };
}

function summarizeMessagesForLog(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  const roles = {};
  let imageParts = 0;
  let fileParts = 0;
  let textChars = 0;
  for (const msg of list) {
    const item = summarizeMessageForLog(msg);
    roles[item.role] = (roles[item.role] || 0) + 1;
    imageParts += item.image_parts;
    fileParts += item.file_parts;
    textChars += item.text_chars;
  }
  return { total: list.length, roles, text_chars: textChars, image_parts: imageParts, file_parts: fileParts };
}

// ========================
// Streaming tag filter helper
// 上游（如 DeepSeek）会把 <memory>/<pin> 拆成 <、memory、> 等多个 SSE 事件，
// 字节层找不到完整标签，必须在 content 文本层做带缓冲的过滤。
// ========================
// 与唤醒调度器（lib/wake-scheduler.js，2026-09-15 起同在 gateway 进程内）共用同一份
// wake_schedule.json（v2 多会话 per-session 槽位）：读写已收口到 lib/wake-schedule.js
// （文件锁 + 锁内重读合并 + 损坏拒写），调度器以 20s 轻量轮询文件指纹感知变化后重挂定时器
// （原 wake-up 独立进程轮询，进程已退役）。批注 2026-09-13（审查 D3）。
const wakeSchedule = require("./lib/wake-schedule");
function saveWakeSchedule(nextWakeAtIso, sessionId, options) {
  return wakeSchedule.saveSlot(nextWakeAtIso, sessionId, options);
}

// 对话侧 <wake> 闹钟标签：AI 在对话里设置闹钟（日期时间或分钟）；标签不显示给用户。
// 返回剥离标签后的文本；同时把闹钟写入 wake_schedule.json（唤醒调度器轮询感知后挂定时器）。
// 2026-09-26：支持尾部 keep=true —— 该闹钟不受「用户中途发言即作废」影响（落 keep 字段）。
function parseWakeTagAndSchedule(text, sessionId) {
  // 2026-10-25 代码块保护：反引号/代码块内的 <wake> 只算展示不设闹钟（与 tag-parser.codeMask 同源判定）
  const cm = require("./lib/tag-parser").codeMask(text);
  /* [位置:server.js·parseWakeTagAndSchedule 子会话] [子会话只剥 <wake> 不排闹钟] [2026-11-01 审查：子会话回复若正文提到 <wake> 会真给子会话定闹钟（显式闹钟能叫醒未锁定会话，白跑一轮模型）；子会话不需要唤醒，剥掉标签即可，不落调度] [注释时间 2026-11-01] */
  if (/^s_sub_/.test(String(sessionId || ""))) return cm.restore(String(cm.text || "").replace(/<wake>[\s\S]*?<\/wake>/gi, "").trim());

  const cleaned = String(cm.text || "").replace(/<wake>[\s\S]*?<\/wake>/gi, "").trim();
  const m = String(cm.text || "").match(/<wake>([\s\S]*?)<\/wake>/i);
  if (!m) return cm.restore(cleaned);
  const target = parseWakeTarget(cm.restore(m[1]), TIME_ZONE);
  if (!target) {
    console.log("[wake] <wake> 内容无效（忽略）:", m[1]);
    return cm.restore(cleaned);
  }
  const nextWakeAt = target.at || new Date(Date.now() + target.minutes * 60 * 1000);
  if (nextWakeAt.getTime() <= Date.now()) {
    console.log("[wake] <wake> 时间已过（忽略）:", m[1]);
    return cm.restore(cleaned);
  }
  try {
    saveWakeSchedule(nextWakeAt.toISOString(), sessionId, { keep: !!target.keep });
    console.log(`[wake] 对话设置闹钟：${formatDateTimeInTimeZone(nextWakeAt, TIME_ZONE)}（${nextWakeAt.toISOString()}，会话 ${sessionId || "default"}${target.keep ? "，keep=true 不受用户发言影响" : ""}）`);
  } catch (err) {
    console.warn("[wake] 保存闹钟失败:", err.message);
  }
  return cm.restore(cleaned);
}


function createContentTagFilter() {
  /* [位置:server.js·createContentTagFilter] [流式标签过滤改成注册表驱动] [10-28 第6项：原来这里是手写前缀状态机（标签名写死、不认代码块/表格）；现在实现在 lib/tag-stream.js——每来一段增量就在全文上用与收尾相同的 strip（workspace/phone-tags.js）算该显示的字，只发新增的一截，写了一半的标签/没收尾的整段标签/没配对的反引号/疑似表格先扣着。接口不变：push(delta, emit) / flush。旧实现见 git 历史] [注释时间 2026-10-28] */
  return require("./lib/tag-stream").createTagStreamFilter();
}

// ========================
// 读取 timeline
// ========================
// 时间线读缓存：按 mtime/size 指纹失效。返回的永远是深拷贝（structuredClone），
// 调用方（appendMessages/appendRequestMessages/历史接口等）原地增删改的是克隆，
// 绝不污染缓存里的共享数组，避免跨请求/跨异步共享可变引用导致串扰。
// 任何 saveTimeline 都会改动文件 mtime/size → 指纹变化 → 下次自动重读，无需显式失效。
const _timelineCache = new Map(); // sessionId -> { fp, data, cost }；Map 插入顺序即 LRU 顺序（最旧在前）
const _TIMELINE_CACHE_MAX = 60;
// 1111 内存治理：除条数外再按「文件字节」设预算。原先只限 60 条，时间线 JSON.parse 后堆占用约为文件的 2.1 倍，
// top60 文件合计 129MB → 缓存写满可吃 ~270MB，是 gateway 反复顶到 900M 被 pm2 杀的主因之一。
// 48MB 文件字节 ≈ 100MB 堆。单个文件超预算则不进缓存（每次直接读盘，慢一点但不占常驻）。
const _TIMELINE_CACHE_MAX_BYTES = 48 * 1024 * 1024;
let _timelineCacheBytes = 0;
function _timelineCacheDrop(sessionId) {
  const old = _timelineCache.get(sessionId);
  if (old) { _timelineCacheBytes -= old.cost; _timelineCache.delete(sessionId); }
}
function _timelineCachePut(sessionId, fp, data) {
  _timelineCacheDrop(sessionId);
  const cost = parseInt(fp, 10) || 0;   // fp 形如 size:mtime:ctime:ino，首段即文件字节数，零额外 IO
  if (cost > _TIMELINE_CACHE_MAX_BYTES) return;
  _timelineCache.set(sessionId, { fp, data, cost });
  _timelineCacheBytes += cost;
  while (_timelineCache.size > _TIMELINE_CACHE_MAX || _timelineCacheBytes > _TIMELINE_CACHE_MAX_BYTES) {
    const firstKey = _timelineCache.keys().next().value;
    if (firstKey === undefined) break;
    _timelineCacheDrop(firstKey);
  }
}
// 1111：每 5 分钟记一行内存快照（RSS/堆/堆外/缓存），下次再顶内存时能直接看出是谁在涨。
setInterval(() => {
  try {
    const m = process.memoryUsage(), mb = n => Math.round(n / 1048576);
    console.log("[mem] rss=" + mb(m.rss) + "MB heapUsed=" + mb(m.heapUsed) + "MB heapTotal=" + mb(m.heapTotal) +
      "MB external=" + mb(m.external) + "MB arrayBuffers=" + mb(m.arrayBuffers) +
      "MB timelineCache=" + _timelineCache.size + "条/" + mb(_timelineCacheBytes) + "MB(文件字节)");
  } catch (e) { /* 自检日志失败不影响主流程 */ }
}, 5 * 60 * 1000).unref();
const _corruptBackupDone = new Set(); // 已做过 .corrupt-* 备份的文件：同一轮损坏只备份一次，防反复 load 堆积备份
// 时间线文件指纹（size:mtime:ctime:ino）：读缓存失效与写守卫「过期快照拒写」共用。
// 2026-09-22 审查 M8：原只用 size:mtimeMs，同毫秒内等长编辑指纹不变 → 读缓存返回陈旧数据、
// 写守卫失效。补 ctimeMs 与 ino（同一次 statSync 拿，零额外 IO）。
function timelineFingerprint(file) {
  try {
    const st = fs.statSync(file);
    return st.size + ":" + st.mtimeMs + ":" + st.ctimeMs + ":" + st.ino;
  } catch (e) { return ""; }
}
// 时间线深拷贝（structuredClone 优先，退 JSON 往返）
function cloneTimeline(data) {
  try { return structuredClone(data); } catch (e) { return JSON.parse(JSON.stringify(data)); }
}
// 盘上是否已存在与该文件**内容相同**的 .corrupt-* 备份（2026-09-23 审查 M9）：
// 内存去重集 _corruptBackupDone 在进程重启后清空，若文件仍损坏会再备份一份、逐次堆积；
// 改为比对最近一份备份的内容哈希——同内容跳过，内容不同（新损坏）仍会新建备份。
function hasSameCorruptBackup(file) {
  try {
    const dir = path.dirname(file);
    const prefix = path.basename(file) + ".corrupt-";
    const cands = fs.readdirSync(dir).filter(n => n.startsWith(prefix)).sort();   // 名字含 ISO 时间戳，字典序＝时间序
    if (!cands.length) return false;
    const last = path.join(dir, cands[cands.length - 1]);
    const h = f => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
    return h(file) === h(last);
  } catch (e) {
    return false;   // 异常按「没有同内容备份」处理——宁可多备一份，也不漏掉损坏现场
  }
}
// 守卫标记（2026-09-19 审查 P1-2 配套）：loadTimeline 返回的克隆统一在「clone 之后」挂 __fp
// （load 时刻的盘上指纹），因此 structuredClone 与 JSON fallback 两条克隆路径拿到的快照都带
// 标记。数组自定义属性不进 JSON.stringify，不会落盘污染文件；saveTimeline 据此识别过期快照。
function tagTimelineSnapshot(cloned, fp) {
  try { cloned.__fp = fp; } catch (e) { /* client/stream cleanup */ }
  return cloned;
}
function loadTimeline(sessionId) {
  const file = timelineFileFor(sessionId);
  if (!fs.existsSync(file)) return [];
  const fp = timelineFingerprint(file);
  const hit = _timelineCache.get(sessionId);
  if (hit && hit.fp === fp) {
    _timelineCache.delete(sessionId); _timelineCache.set(sessionId, hit);   // 命中则挪到队尾（LRU）
    return tagTimelineSnapshot(cloneTimeline(hit.data), fp);
  }
  if (hit) _timelineCacheDrop(sessionId);   // 指纹变了：旧数据已过期，立即释放，别等淘汰
  try {
    const data = fs.readJsonSync(file);
    _corruptBackupDone.delete(file); // 文件能正常解析＝已从损坏中恢复，下次再损坏要重新备份
    _timelineCachePut(sessionId, fp, data);
    return tagTimelineSnapshot(cloneTimeline(data), fp);
  } catch (err) {
    /* [位置:server.js·loadTimeline 读取失败] [先落一条 warn 再按损坏处理] [11-15 护栏测试踩到：代码缺陷（ReferenceError/TypeError，例如 11-11 内存治理新增的缓存符号没同步进测试的 parts 清单）也会落进这个 catch，被当成「文件损坏」备一份再返回空时间线——整个错误静默成 return []，除了一条 13 个月没人看的日志没有任何信号。这里补一条 warn 把错误名带出来；损坏分支的判定与行为一律不动] [注释时间 2026-11-15] */
    console.warn("[timeline] 读取时间线失败（按损坏处理）: " + ((err && err.name) || "Error") + ": " + ((err && err.message) || String(err)) + " | file=" + file);
    // 文件损坏：先备份（同一文件只备一次），返回带 __corrupt 标记的空时间线——
    // saveTimeline 见标记且原文件仍在即拒写，绝不能用空数组覆盖损坏的历史文件。
    if (!_corruptBackupDone.has(file)) {
      try {
        // 2026-09-23 审查 M9：去重集只在内存，进程重启后清空 → 文件仍损坏时会重复备份、
        // .corrupt-* 逐次堆积。补一层「盘上已有同内容备份则跳过」（比对最近一份的 md5）。
        if (!hasSameCorruptBackup(file)) {
          const bak = file + ".corrupt-" + new Date().toISOString().replace(/[:.]/g, "-");
          fs.copySync(file, bak);
          console.error("[timeline] 时间线文件损坏，已备份到 " + bak + "，本次按空时间线处理；该文件的后续写入将被拒绝直至人工恢复:", err.message);
          notifyTimelineWriteRejected("时间线文件损坏已备份(.corrupt-*)，该会话后续写入将被拒", sessionId);
        } else {
          console.error("[timeline] 时间线文件损坏，盘上已有同内容 .corrupt-* 备份，跳过重复备份；本次按空时间线处理:", err.message);
        }
        _corruptBackupDone.add(file);   // 本轮已处理（同内容备份已存在时也标记，避免反复扫盘）
      } catch (bakErr) {
        console.error("[timeline] 时间线文件损坏且备份失败（写入守卫仍会拒绝覆盖）:", err.message, "|", bakErr.message);
      }
    }
    const empty = [];
    try { empty.__corrupt = true; } catch (e) { /* client/stream cleanup */ }
    return empty;
  }
}

// ── 会话删除墓碑（2026-09-20 审查 F-3 配套）──
// 删除会话后，迟到的写入（生成中回复收尾/唤醒事件等）会用「空时间线+新消息」把已删会话
// 以残骸文件复活。删除时在此记墓碑（相对路径，与 TIMELINE_FILE 同一 cwd 约定），saveTimeline
// 见墓碑且文件不存在即拒写；TTL 过期自动失效（此后同 id 重建不再拦截）。单用户场景 cap 50 条。
const TOMBSTONE_FILE = path.join("data", "deleted_sessions.json");
const SESSION_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
function readDeletedSessionsMap() {
  try {
    const v = fs.readJsonSync(TOMBSTONE_FILE);
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}
function writeDeletedSessionsMap(map) {
  try {
    fs.mkdirSync(path.dirname(TOMBSTONE_FILE), { recursive: true });
    atomicWriteJsonSync(TOMBSTONE_FILE, map);
  } catch (e) { console.warn("[timeline] 写会话删除墓碑失败:", e.message); }
}
function pruneDeletedSessions(map, now) {
  const out = {};
  for (const k of Object.keys(map)) {
    const t = Number(map[k]);
    if (Number.isFinite(t) && now - t < SESSION_TOMBSTONE_TTL_MS) out[k] = t;
  }
  return out;
}
function isSessionTombstoned(token, now) {
  if (!token || token === "default") return false;
  const map = readDeletedSessionsMap();
  const t = Number(map[token]);
  return Number.isFinite(t) && (now || Date.now()) - t < SESSION_TOMBSTONE_TTL_MS;
}
function markSessionDeleted(sessionId) {
  const token = safeSessionToken(sessionId);
  if (!token || token === "default") return false;
  const now = Date.now();
  const map = pruneDeletedSessions(readDeletedSessionsMap(), now);
  map[token] = now;
  const keys = Object.keys(map);
  if (keys.length > 50) {
    keys.sort((a, b) => map[a] - map[b]);
    for (let i = 0; i < keys.length - 50; i++) delete map[keys[i]];
  }
  writeDeletedSessionsMap(map);
  return true;
}

// 原子写入：先写临时文件再 rename，避免进程被杀/崩溃时把 JSON 写坏。
// 2026-09-30 V10 收敛：实现统一委托 json_atomic.writeJsonAtomic（七份重复实现唯一来源），函数名保留。
function atomicWriteJsonSync(file, data) {
  _writeJsonAtomicBase(file, data);
}

function atomicWriteFileSync(file, content) {
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp";
  try {
    // 2026-09-22 审查 M3：rename 前补 fsync——否则数据可能仍在页缓存，掉电/断电后
    // rename 已生效但内容截断（.env、时间线、墓碑等关键小文件都走这里）
    const fd = fs.openSync(tmp, "w");
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) { console.warn('[server.js:1049] cleanup failed:', e.message); }
  }
}




// ========================
// 保存 timeline（保留 SP）
// ========================
// 2026-09-21 审查 H3②+H4：拒写/损坏对管理员必须可见——此前只有 console.error，
// 调用方又不检查 saveTimeline 返回值，会话冻结/消息丢弃完全静默。Bark 推送 fire-and-forget。
function notifyTimelineWriteRejected(reason, sessionId) {
  try {
    sendPushNotification({
      title: "⚠️ 时间线写入被拒",
      body: `会话 ${sessionId || "default"}：${reason}。该会话可能已冻结/消息未落盘，请尽快人工处理。`,
      channel: "bark"
    }).catch(e => console.error("[timeline] 拒写告警推送失败:", e.message));
  } catch (e) { console.error("[timeline] 拒写告警推送异常:", e.message); }
}
function saveTimeline(messages, sessionId) {
  const file = timelineFileFor(sessionId);
  // ── 写守卫（2026-09-19 审查 P1-2 配套）：两条拒写规则，先 corrupt 后过期快照。──
  // 1) 损坏守卫：loadTimeline 因文件损坏返回的空时间线（带 __corrupt）绝不能写回，
  //    否则一次普通 append 就把整份历史覆盖成「空 + 新消息」（原文件已有 .corrupt-* 备份）。
  if (messages && messages.__corrupt === true && fs.existsSync(file)) {
    console.error("[timeline] 拒绝写入：会话 " + (sessionId || "default") + " 的时间线文件此前读取损坏（.corrupt-* 已备份），本次写入已丢弃以保护原文件。请人工核对恢复后重试。");
    notifyTimelineWriteRejected("时间线文件损坏，写入被拒（会话冻结中）", sessionId);
    return false;
  }
  // 2) 过期快照守卫：克隆数组带 __fp（load 时刻的盘上指纹）。盘上指纹已变＝load 与 save
  //    之间发生过其他写入（跨 await 携带旧快照的调用方式），放行会覆盖掉那些新写入——
  //    拒写并要求重新 load。现有同步原语（load→改→save 无 await）指纹必然一致，不受影响。
  if (messages && messages.__fp !== undefined && fs.existsSync(file)) {
    const curFp = timelineFingerprint(file);
    if (curFp && curFp !== messages.__fp) {
      console.error("[timeline] 拒绝写入：会话 " + (sessionId || "default") + " 的快照已过期（load 时指纹 " + messages.__fp + " ≠ 盘上当前 " + curFp + "，期间有其他写入）。本次写入已丢弃以避免覆盖新消息，请重新 loadTimeline 后再修改。");
      notifyTimelineWriteRejected("快照过期冲突，写入被拒（本条修改未落盘）", sessionId);
      return false;
    }
  }
  // 3) 墓碑守卫：文件已删除且仍在墓碑期内 → 拒绝重建（防迟到写入复活已删会话，见 markSessionDeleted）
  if (!fs.existsSync(file)) {
    if (isSessionTombstoned(safeSessionToken(sessionId))) {
      console.error("[timeline] 拒绝写入：会话 " + (sessionId || "default") + " 已删除且在墓碑期内，本次写入已丢弃（防迟到写入复活已删会话）。");
      notifyTimelineWriteRejected("会话已删除（墓碑期），迟到写入被拒", sessionId);
      return false;
    }
  }
  // 稳定 id：任何写盘路径都保证每条消息有唯一 id（老数据首次被写时补齐），
  // 供「编辑/删除 diff 协议」按 id 定点 patch，position 不动、不再重排。system 也统一给 id。
  for (const m of messages) { if (m && !m.id) m.id = crypto.randomUUID(); }
  // 1007-17 日记版本化（gitid）：日记消息 id 稳定，但正文会经 /xie-diary 编辑后同步回时间线
  // （syncDiaryTimelineMessages 改 content、不动 id）。只按 id 认就察觉不到内容变了。
  // 统一放在写盘出口补：覆盖全部创建路径（对话/MCP/唤醒）+ 编辑同步路径，不会漏打。
  // 指纹是确定性的：内容没变时重算值不变，重复写盘不会产生假变更。
  for (const m of messages) {
    if (!m || m.kind !== "diary") continue;
    try {
      const _dt = (typeof m.content === "string") ? m.content : normalizeContentToText(m.content);
      const _dh = contextReplacements.contentRevHash ? contextReplacements.contentRevHash(_dt) : "";
      if (_dh) m.diaryRev = "diary:" + ((m.diary_id != null) ? String(m.diary_id) : "") + ":" + _dh;
    } catch (e) { /* 单条失败不阻断写盘 */ }
  }
  const sp = messages.find(m => m.role === "system");
  const nonSP = messages.filter(m => m.role !== "system");
  // 兜底：任何写入路径都补齐缺失的 time（system 除外），避免历史消息/特殊事件缺时间
  backfillMissingTimes(nonSP);
  // 不再截断：完全保留客户端发送的全部消息（仅将 SP 放在首位）
  const final = sp ? [sp, ...nonSP] : nonSP;
  // 1010-21 写时保护：同步副本到 data/timeline_guard/（watchdog 巡检自动恢复，防误删）
  try { guardTimelineCopy(file, JSON.stringify(final)); } catch (e) { console.warn("[timeline-guard] 写保护失败:", e.message); }
  atomicWriteJsonSync(file, final);
  return true;
}

// ========================
// 提取时间戳（支持多种格式）
// 2026-09-30 V4 收敛：以下四个解析函数的本地实现已删，统一从 time_utils 引入
// （见顶部 require 的别名映射：parseTimestampLabel/extractTimestamp/extractTrailingTimestampLabel/
// extractCurrentTimeTagLabel）。extractTimestampWithMemory 的调用链保持不变。
// ========================

// 消息时间解析：优先 time 字段（客户端已传）→ <current_time> 标签 → 末尾时间缀 → 开头时间戳（AI 抄的）
function extractTimestampWithMemory(msg) {
  if (msg && msg.time) {
    const d = new Date(msg.time);
    if (!isNaN(d.getTime())) return d;
  }
  const text = normalizeContentToText(msg.content);
  // 特殊事件：优先取内容【开头】的墙上时间（事件发生时间），
  // 避免末尾「，且设定了主动唤醒时间：…」被误当成消息末尾的时间缀，导致事件被排到上下文最底部。
  if (typeof isSpecialEvent === "function" && isSpecialEvent(msg)) {
    const fromContent = extractTimestamp(text);
    if (fromContent) return fromContent;
  }
  const fromTag = extractCurrentTimeTagLabel(text);
  if (fromTag) return fromTag;
  const fromTrailing = extractTrailingTimestampLabel(text);
  if (fromTrailing) return fromTrailing;
  const fromContent = extractTimestamp(text);
  if (fromContent) return fromContent;
  return null;
}

// 共影记录是整段观影的合并消息，开头是「（共影）2026-08-14 23:31 一起看《…》」；
// 用首行时间作为整段记录的起始时间，注入主上下文时按这个时间落位，避免被推到末尾
function extractCoRecordEventTime(msg) {
  if (!msg || typeof msg.content !== "string") return null;
  const m = msg.content.match(/^（共影）\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]?)\d{1,2}[:：]\d{2})/);
  return m ? parseTimestampLabel(m[1]) : null;
}

// ========================
// 消息判断
// ========================
function isSpecialEvent(msg) {
  // 结构化识别：与 context-replacements / context-compactor 统一，避免把真实对话里提到“记忆碎片/自动写了日记/推送”等词误判成事件
  return contextReplacements.isSpecialEvent(msg);
}

// 特殊事件注入分类：一个事件可能命中多类，返回命中的所有分类 key
// 「真实对话消息」判定（时间线写入/计数/搜索的统一口径）：排除 system、工具调用、
// 特殊事件、<system> 开头的 user 伪装消息，只认 user/assistant
function isRealMessageForTimeline(msg) {
  if (msg.role === "system") return false;
  // 1018：新建会话时从上一个会话原样复制来的对话（只给 AI 看）——不显示、不计数、不参与合并/分支下标
  if (msg.kind === "recent_inherit") return false;
  if (msg.tool_calls) return false;
  if (isSpecialEvent(msg)) return false;
  const contentText = normalizeContentToText(msg.content);
  if (msg.role === "user" && contentText.trim().startsWith("<system>")) return false;
  return msg.role === "user" || msg.role === "assistant";
}

// ========================
// 补齐缺失 time 字段
// 规则：优先取紧随其后的用户消息时间（末尾时间缀），没有就取前面最近一条用户消息时间，再兜底服务器当前时间。
// 只补一次（此后由 oldByContent 保持稳定），保证所有消息（含特殊事件）都有时间，可按时间段定位与压缩。
// ========================
function backfillMissingTimes(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  const n = arr.length;
  // 每条消息“后面最近一条用户消息的时间”
  const nextUserTime = new Array(n).fill(null);
  let pending = null;
  for (let i = n - 1; i >= 0; i--) {
    nextUserTime[i] = pending;
    const m = arr[i];
    if (m && m.role === "user" && m.time) {
      const d = new Date(m.time);
      if (!isNaN(d.getTime())) pending = d;
    }
  }
  let prevUserTime = null;
  for (let i = 0; i < n; i++) {
    const m = arr[i];
    if (!m) continue;
    if (m.time) {
      const d = new Date(m.time);
      if (m.role === "user" && !isNaN(d.getTime())) prevUserTime = d;
      continue;
    }
    const pick = nextUserTime[i] || prevUserTime || new Date();
    m.time = pick instanceof Date ? pick.toISOString() : String(pick);
  }
  return arr;
}

// ========================
// 构建 Timeline
// ========================
function buildTimeline(kelivoMessages, sessionId) {
  const oldTimeline = loadTimeline(sessionId);
  // position → 旧时间线消息，用于找回已保存的 time，避免历史消息每次都回落为服务器时间
  // 按 role+content 匹配旧时间线找回已保存的 time（position 在客户端增删后会错位，内容匹配更鲁棒）
  const oldByContent = new Map();
  for (const m of oldTimeline) {
    if (!m.time) continue;
    const key = m.role + "\u0000" + cardCanon(normalizeContentToText(m.content));   /* 11-06：与 keyOf 同口径 */
    if (!oldByContent.has(key)) oldByContent.set(key, m);
  }
  // 本批最后一条实时 user 消息的下标（接收时刻≈真实时间，供唤醒判断使用）；
  // 用下标而不是对象引用：map 展开后是新对象，引用比较永远为 false
  let lastUserFallbackIdx = -1;
  function toValidDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  function resolveMessageTime(msg, idx) {
    const direct = toValidDate(msg.time);
    if (direct) return direct;
    const old = oldByContent.get(msg.role + "\u0000" + cardCanon(normalizeContentToText(msg.content)));
    const oldTime = toValidDate(old && old.time);
    if (oldTime) return oldTime;
    const fromContent = extractTimestampWithMemory(msg);
    if (fromContent) return fromContent;
    // 只有本批最后一条实时 user 消息才回填服务器接收时刻（Kelivo 实时推送≈真实时间）；
    // 其余消息不再盖伪时间，避免历史消息全部堆在同一时刻导致时间感失真
    if (idx != null && idx === lastUserFallbackIdx) return new Date();
    return null;
  }
  function timeIsoOrUndefined(msg) {
    const d = resolveMessageTime(msg);
    return d ? d.toISOString() : undefined;
  }
  const newSystemMessages = kelivoMessages
    .filter(msg => msg.role === "system")
    .map(normalizeMessageForTimeline);
  const latestSP = newSystemMessages.length > 0 ? newSystemMessages[newSystemMessages.length - 1] : null;
  const oldSP = oldTimeline.find(msg => msg.role === "system");

  // 时间线图片原样保留：不裁剪、不压 [图片] 占位（2026-09-08）
  const realForTimeline = kelivoMessages.filter(isRealMessageForTimeline);
  const hasAnyImagePart = function (msg) { return Array.isArray(msg && msg.content) && msg.content.some(p => p && isImageContentPart(p)); };
  // 提前算好"本批最后一条实时 user 消息"的下标：resolveMessageTime 在下面 map 时就要用它，
  // 原实现赋值晚于使用导致回填分支永不生效
  lastUserFallbackIdx = -1;
  for (let i = realForTimeline.length - 1; i >= 0; i--) {
    if (realForTimeline[i].role === "user") { lastUserFallbackIdx = i; break; }
  }
  // 2026-09-08：时间线图片原样保留，不做历史裁剪/占位（keep_recent_image_turns 已移除）
  const newRealMessages = realForTimeline
    .map(function (m) {
      if (hasAnyImagePart(m)) return { ...m, content: m.content };      // 保留真实 image_url
      return normalizeMessageForTimeline(m);
    })
    .map(function (m, i) { return { ...m, _t: resolveMessageTime(m, i) }; });

  const oldSpecialEvents = oldTimeline.filter(isSpecialEvent).sort((a, b) => {
    const timeA = extractTimestampWithMemory(a);
    const timeB = extractTimestampWithMemory(b);
    if (timeA && timeB) return timeA - timeB;
    return 0;
  });

  const merged = [...newRealMessages];
  for (const event of oldSpecialEvents) {
    const eventTime = extractTimestampWithMemory(event);
    if (!eventTime) { merged.push(event); continue; }
    let inserted = false;
    for (let i = 0; i < merged.length; i++) {
      const msgTime = merged[i]._t || extractTimestampWithMemory(merged[i]);
      if (msgTime && msgTime >= eventTime) {
        merged.splice(i, 0, event);
        inserted = true;
        break;
      }
    }
    if (!inserted) merged.push(event);
  }

  const seen = new Set();
  const unique = merged.filter(msg => {
    const key = JSON.stringify({ role: msg.role, content: msg.content });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // lastUserFallback 已在上方（map 之前）提前计算，这里不再赋值（原赋值晚于使用，是死代码）

  const result = [];
  if (latestSP) result.push({ ...latestSP, position: 0, time: timeIsoOrUndefined(latestSP) });
  else if (oldSP) result.push({ ...oldSP, position: 0, time: timeIsoOrUndefined(oldSP) });

  let realPos = 1;
  const finalMessages = [];
  let pendingSpecial = [];
  for (const msg of unique) {
    if (isSpecialEvent(msg)) {
      pendingSpecial.push(msg);
    } else {
      if (pendingSpecial.length > 0) {
        const prevRealPos = realPos - 1;
        const step = 1 / (pendingSpecial.length + 1);
        for (let i = 0; i < pendingSpecial.length; i++) {
          const { _t: _t1, ...cleanEvent } = pendingSpecial[i];
      finalMessages.push({ ...cleanEvent, position: parseFloat((prevRealPos + step * (i + 1)).toFixed(4)), time: timeIsoOrUndefined(pendingSpecial[i]) });
        }
        pendingSpecial = [];
      }
      const { _t, ...cleanMsg } = msg;
      finalMessages.push({ ...cleanMsg, position: realPos, time: timeIsoOrUndefined(msg) });
      realPos++;
    }
  }
  if (pendingSpecial.length > 0) {
    const lastRealPos = realPos - 1;
    for (let i = 0; i < pendingSpecial.length; i++) {
      const { _t: _t3, ...cleanEventTail } = pendingSpecial[i];
      finalMessages.push({ ...cleanEventTail, position: parseFloat((lastRealPos + 0.3 * (i + 1)).toFixed(4)), time: timeIsoOrUndefined(pendingSpecial[i]) });
    }
  }

  result.push(...finalMessages);
  return backfillMissingTimes(result);
}


/* [位置:server.js·cardCanon] [卡片 JSON 归一（一切按正文比对的地方都过它）] [11-06选方案B：落库前把 AI 写坏的卡片 JSON 修好再存。改正文会牵动按内容比对的逻辑（重试防重 tailHasReply、请求对齐 appendRequestMessages 的 keyOf、buildTimeline 按 role+content 找回旧时间）——客户端手里可能还拿着没修的原文，不归一会「盘上修过的回复在请求里找不到」而被当成被换掉的旧回复清尾。统一口径：比对前两边都过 cardCanon] [注释时间 2026-11-06] */
function cardCanon(s) {
  if (typeof s !== "string" || s.indexOf("<card") < 0) return s;
  const r = phoneTags.fixCardTags(s);
  return r ? r.text : s;
}
/* [位置:server.js·repairMessageCards] [落库前修正卡片 JSON] [11-06：AI 写卡片偶发漏最外层 }（全量历史 195 张卡里 17 张语法错），此前只有前端渲染时就地兜，正文与历史数据一直是坏的、还会回灌给 AI 自己看。落库处修一遍再存：只修能修好的、掩码（代码块/反引号讲解里的示例）不动；修不好原样保留（前端照旧在正文留提示）。content / segments / stream_timeline 文本节点同口径] [注释时间 2026-11-06] */
function repairMessageCards(msg) {
  if (!msg || msg.role !== "assistant") return 0;   /* 只改 AI 回复：用户正文里的字不许动 */
  let n = 0;
  const fixOne = function (s) { const r = phoneTags.fixCardTags(s); if (!r) return s; n += r.fixed; return r.text; };
  if (typeof msg.content === "string") msg.content = fixOne(msg.content);
  if (Array.isArray(msg.segments)) msg.segments = msg.segments.map(function (s) { return typeof s === "string" ? fixOne(s) : s; });
  if (Array.isArray(msg.stream_timeline)) msg.stream_timeline = msg.stream_timeline.map(function (nd) { return (nd && nd.type === "text" && typeof nd.text === "string") ? Object.assign({}, nd, { text: fixOne(nd.text) }) : nd; });
  return n;
}
// ========================
// 追加消息（增量原语）
// ========================
// 方案二核心：把「每次写时间线 = 整文件重建覆盖」拆成「只往后追加」。
// 批量版一次读盘/写盘/通知；新消息 position 依次 maxPos+0.5+i，绝不改动已有消息的
// position —— 增量写入后 position 单调稳定，可作后续 patch 定位键。
// opts.silent=true 时不推送前端；任一非 hidden 消息落库才会 sseNotify（与特殊事件 hidden 语义一致）。
function appendMessages(sessionId, msgs, opts) {
  opts = opts || {};
  const list = (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean);
  if (!list.length) return [];
  const timeline = loadTimeline(sessionId);
  let maxPos = 0;
  for (const m of timeline) {
    if (m && m.position && m.position > maxPos) maxPos = m.position;
  }
  const out = list.map(function (m, i) {
    const nm = { time: new Date().toISOString(), ...m, position: maxPos + 0.5 + i, id: m.id || crypto.randomUUID() };
    /* [位置:server.js·appendMessages·trace] [11-08 产品确定 trace 落盘保留（显示给 AI）：正文里的 <trace>…</trace> 原样留在时间线，AI 后续上下文看得到自己写过的此刻；提取照旧挂 nm.trace（前端气泡）+ 整句存 data/trace_notes.json 并带 msg_id（召回）。前端显示不变——流式 srv:drop 与历史渲染 fe:drop 照剥，只显 ✦ 气泡。keepBody 第三参在 lib/trace.js；回滚=去掉第三参（原版 data/backups/trace-keep-20261108/，git 上一个提交也可回）；失败不影响落盘] [注释时间 2026-11-08] */
    try { if (nm.role === "assistant" && typeof nm.content === "string" && nm.content.indexOf("<trace") >= 0) { if (traceLib.extractFromMessage(nm, sessionId, true) && nm.trace && nm.trace.content) { try { traceNotes.add({ content: nm.trace.content, session_id: sessionId, msg_id: nm.id, at: nm.trace.at || nm.time }); } catch (_) {} } } } catch (e) { console.warn("[trace] 剥离失败:", e.message); }
    /* [位置:server.js·appendMessages·card] [落库前修卡片 JSON] [11-06 方案B：实现见 repairMessageCards；只处理 assistant，修不好原样存] [注释时间 2026-11-06] */
    try { const _cf = repairMessageCards(nm); if (_cf) console.log("[card] 落库前修好 " + _cf + " 段卡片 JSON session=" + (sessionId || "default")); } catch (e) { console.warn("[card] 落库前修卡片失败:", e && e.message); }
    timeline.push(nm);
    return nm;
  });
  saveTimeline(timeline, sessionId);
  unarchiveSession(sessionId);   // 新消息落库 → 自动取消归档
  if (!opts.silent && out.some(m => !m.hidden)) sseNotify(sessionId);
  return out;
}

function appendMessage(sessionId, msg, opts) {
  return appendMessages(sessionId, [msg], opts)[0] || null;
}

// 按稳定 id 定点修改一条消息（编辑同步）——只改这一条，保留其余消息 position，不重排。
// patch 只覆盖传入的键（前端 diff 只发 {op:'edit', id, newContent} 类，不传 position/id）。
function patchMessage(sessionId, id, patch) {
  if (!id) return null;
  const timeline = loadTimeline(sessionId);
  const idx = timeline.findIndex(m => m && m.id === id);
  if (idx < 0) return null;
  timeline[idx] = { ...timeline[idx], ...patch, id };
  saveTimeline(timeline, sessionId);
  sseNotify(sessionId);
  return timeline[idx];
}

// 剥掉日记正文开头的「## 时间」头行（时间线 [DIARY] 消息从不带该头，见 lib/diary.js 落库格式）
function diaryBodyOnly(content) {
  return String(content || "").replace(/^##[^\n]*\n+/, "").trim();
}

// 日记 ↔ 时间线同步（2026-10-19，替代恒返回 0 的 syncDiarySpecialEvents）：按 diary_id 外键
// 定点更新时间线里的 kind=diary 消息正文。页面编辑/恢复日记后调用，保证「聊天上下文」面
// 与「谢的日记页面」面一致（跨窗口注入面直接读 diary.json，天然同步；隐藏按拍板不动时间线）。
// 时间线消息不存在（存量未回填/旧消息无外键）时返回 missing:true，由调用方决定是否提示。
function syncDiaryTimelineMessages(sessionId, diaryId, newWrappedContent) {
  if (diaryId == null) return { patched: 0, missing: true };
  try {
    const sid = sessionId || "default";
    const timeline = loadTimeline(sid);
    let patched = 0;
    const next = timeline.map(function (m) {
      if (m && m.kind === "diary" && m.diary_id === diaryId) {
        patched++;
        return Object.assign({}, m, { content: newWrappedContent });
      }
      return m;
    });
    if (!patched) return { patched: 0, missing: true };
    saveTimeline(next, sid);
    sseNotify(sid);
    console.log("[diary] 已按 diary_id=" + diaryId + " 同步时间线 " + patched + " 条消息");
    return { patched: patched, missing: false };
  } catch (e) {
    console.warn("[diary] 时间线同步失败 (diary_id=" + diaryId + "):", e.message);
    return { patched: 0, missing: true, error: e.message };
  }
}

// 工具调用记录消息判定（服务器写入格式：assistant + 「【工具调用记录】」开头）
function isToolNoteMessage(m) {
  return !!m && m.role === "assistant" && typeof m.content === "string" && m.content.startsWith("【工具调用记录】");
}

// 盘尾最后一条真实回复是否与新回复同内容（重试/断线重发防重：命中则跳过追加，不重复写）
function tailHasReply(sessionId, content) {
  const timeline = loadTimeline(sessionId);
  for (let i = timeline.length - 1; i >= 0; i--) {
    const m = timeline[i];
    if (!m || m.role === "system") continue;
    if (isToolNoteMessage(m)) continue;
    if (isSpecialEvent(m)) continue;
    const _c0 = normalizeContentToText(content);
    const _c = cardCanon((typeof _c0 === "string" && _c0.indexOf("<trace") >= 0) ? traceLib.stripTrace(_c0).text : _c0);   /* 11-06：落库时卡片 JSON 已修，比对前两边都过 cardCanon，防重不失效 */
    return m.role === "assistant" && cardCanon(traceLib.stripTrace(normalizeContentToText(m.content)).text) === _c;   /* 11-08：trace 落盘保留原文（产品确定），库存新消息正文含 <trace>，比对前两边都剥（旧数据正文无 trace，剥=原样），重试防重不失效 */
  }
  return false;
}

// 剥离前端为「给上游模型看」而拼进 content 的工具记录段（buildMessages 加的「【本回复前调用工具记录】…」）。
// 只应存在于转发给上游时，绝不落进时间线（否则刷新后会当正文显示、工具胶囊丢失）。
function stripFrontendToolNote(content) {
  if (typeof content !== "string") return content;
  const idx = content.indexOf("\n\n【本回复前调用工具记录】");
  if (idx < 0) return content;
  return content.slice(0, idx);
}

// 以盘上为基同步「请求消息」：人设同步 + 去重补齐 + 尾部对齐，替代拿请求全量重建覆盖。
// 用于发消息首保存 / MCP 写回：盘上永远是完整历史，请求里缺的补、多的（重生成换掉的旧回复）按覆盖语义清尾。
function appendRequestMessages(sessionId, reqMsgs, opts) {
  opts = opts || {};
  const existing = loadTimeline(sessionId);
  const reqList = Array.isArray(reqMsgs) ? reqMsgs : [];
  const keyOf = function (m) { return m.role + "\u0000" + cardCanon(normalizeContentToText(m.content)); };   /* 11-06：卡片 JSON 落库时已修，键也归一，客户端拿原文也能对上 */
  const reqReal = reqList.filter(function (m) {
    return m && !m.tool_calls && !m.tool_call_id && !isSpecialEvent(m) && (m.role === "user" || m.role === "assistant");
  }).map(function (m) {
    // 落盘前剥离前端拼段，避免污染时间线（content 保持干净，刷新靠 tools 富字段渲染胶囊）
    const c = stripFrontendToolNote(m.content);
    return c === m.content ? m : { ...m, content: c };
  });
  const reqKeys = new Set(reqReal.map(keyOf));
  const reqLastReal = reqReal.length ? reqReal[reqReal.length - 1] : null;
  let changed = false;

  // 0) 重生成锚点截断（2026-09-23 新增）
  //    语义：移除锚点 user 消息**之后的全部时间线内容**（含特殊事件，用户拍板），保留锚点本身。
  //    为什么必须新增：下方第 2 步的「尾部对齐」按内容键匹配且**遇到 user 就停**
  //    （原设计是为防止局部窗口请求误删历史——请求只带尾部 UPLOAD_WINDOW 条时，
  //     前面消息都不在 reqKeys 里，一路清到底会误删）。副作用是**从中间重生成清不干净**：
  //    盘上会残留被移除的旧回复及其后的 user 消息，刷新/SSE 补拉时它们会「复活」并插到新回复之后。
  //    改为由前端显式上报锚点 id、服务端按 id 硬截断：边界明确、与上传窗口无关、不会误删历史。
  //    防御：锚点须存在、须是 user（只删「该 user 之后的回复」）、且不能在盘尾（无内容可删则跳过）。
  //    不传该参数时行为与改动前**完全一致**（旧客户端/第三方客户端不受影响）。
  /* [位置:server.js·appendRequestMessages 步骤0·版本存档] [重新生成 / 编辑后重新生成：截断前把旧内容存成一个版本] [11-10：opts.regenVersion 为真（前端显式「重新生成」或「编辑后重新生成」才传；发送失败的重试不传，免得残缺回复被存成版本）时，截断前把「锚点用户消息内容 + 它之后的整段」记入 pendingArchive，等时间线落盘成功后再写 lib/timeline-versions；opts.regenEdit 是编辑后的新内容，存档后换到锚点上。锚点之后已有压缩块则不存档（照旧截断，避免版本里带着对不上的压缩区间）。同一次请求的第二次调用（MCP 写回）尾巴已空且内容已是新的，不会重复存档] [注释时间 2026-11-10] */
  const _anchorId = String(opts.regenAnchorId || "").trim();
  let _regenAnchorIdx = null;   // 2026-10-08 方案A：重生成锚点 index（清尾后快照处理用）
  let _regenRemoved = 0;
  let _regenEdited = false;
  let _pendingArchive = null;
  if (_anchorId) {
    const _ai = existing.findIndex(function (m) { return m && m.id === _anchorId; });
    const _anchorOk = _ai >= 0 && existing[_ai].role === "user";
    const _hasEdit = _anchorOk && opts.regenEdit !== undefined && opts.regenEdit !== null;
    const _editChanged = _hasEdit && JSON.stringify(opts.regenEdit) !== JSON.stringify(existing[_ai].content);
    if (_anchorOk && (_ai < existing.length - 1 || _editChanged)) {
      const _removed = existing.length - (_ai + 1);
      if (opts.regenVersion) {
        let _blocked = false;
        try {
          const _rg = contextReplacements.locateEnabledRanges ? contextReplacements.locateEnabledRanges(sessionId, existing) : [];
          _blocked = _rg.some(function (r) { return !r.hidden && r.e > _ai; });
        } catch (e) { _blocked = true; }
        if (!_blocked) _pendingArchive = { anchorId: _anchorId, content: existing[_ai].content, tail: existing.slice(_ai + 1) };
        else console.warn("[regen] 锚点之后有压缩块，本次不存版本: session=" + (sessionId || "default") + " anchor=" + _anchorId.slice(0, 8));
      }
      if (_editChanged) { existing[_ai] = Object.assign({}, existing[_ai], { content: opts.regenEdit }); _regenEdited = true; }
      existing.splice(_ai + 1);
      _regenAnchorIdx = _ai;
      _regenRemoved = _removed;
      changed = true;
      console.log("[regen] 按锚点 id 截断时间线: session=" + (sessionId || "default") +
        " anchor=" + _anchorId.slice(0, 8) + " 移除=" + _removed + (_regenEdited ? " 已换新内容" : "") + (_pendingArchive ? " 存版本" : ""));
    } else if (_ai >= 0) {
      console.warn("[regen] 锚点不合法，忽略截断（回退原尾部对齐）: idx=" + _ai +
        " role=" + (existing[_ai] && existing[_ai].role) + " len=" + existing.length);
    } else {
      console.warn("[regen] 锚点 id 未在盘上找到，忽略截断: " + _anchorId.slice(0, 8));
    }
  }

  // 1) 人设同步（2026-09-24 B 方案）：以服务端权威 system 为准写盘上，忽略请求里带的 system。
  //    旧逻辑拿前端拼的 system 覆盖盘上，前端异步加载/换设备/备份缺失时会把会话专属人设冲成全局。
  //    现在权威来源是 session-prompts.json -> prompt-backups.json -> chat-settings.json，前端带什么都不再改盘上。
  const authoritativeSP = (typeof resolveSessionSystemPrompt === "function")
    ? (resolveSessionSystemPrompt(sessionId) || "") : "";
  if (authoritativeSP.trim()) {
    // 1007-17 人设版本化（gitid）：人设是原地改 content、id 不变的（见下面 diskSP.content = ...），
    // 只按消息 id 认不出「人设换过了」。故打 spRev = 备份标识 + 内容指纹：
    // 换人设（backupId 变）/ 编辑同一份备份的正文（指纹变）都会落成不同版本。
    // 该字段在出口被 sanitizeForUpstream 剥掉，不进上游；只供内部识别版本。
    const _spGit = "sp:" + (sessionPromptBackupId(sessionId) || "global") + ":"
      + (contextReplacements.contentRevHash ? contextReplacements.contentRevHash(authoritativeSP) : "");
    const diskSP = existing.find(function (m) { return m && m.role === "system"; });
    if (!diskSP) {
      existing.unshift({ role: "system", content: authoritativeSP, position: 0, spRev: _spGit });
      changed = true;
    } else if (normalizeContentToText(diskSP.content) !== authoritativeSP) {
      diskSP.content = authoritativeSP;
      diskSP.spRev = _spGit;
      changed = true;
    } else if (diskSP.spRev !== _spGit) {
      // 内容一致但标识缺失或过期（存量数据 / 换了备份但正文恰好相同）→ 只补标识，不动内容
      diskSP.spRev = _spGit;
      changed = true;
    }
  }

  // 2) 尾部对齐（重生成覆盖语义）：仅当请求最后一条真实消息是 user（用户在等一条新回复）才做；
  //    连播/后台续写（请求尾是 assistant）不对齐，历史原样保留。
  //    从盘尾往前收集「不在请求键集的 assistant 真实回复」（【工具调用记录】视为附属一并入段），
  //    遇到请求内消息 / user / 特殊事件即停。收集到的整段只有在其前一条锚点消息属于请求键集
  //    （= 重生成：user 消息双方都在，仅回复被换掉）时才清除；锚点也不在请求集
  //    （= 跨设备/局部请求滞后，别端刚写的回复）则原样保留，绝不误删。
  let cut = existing.length;
  let anchor = -1;   // 1010-31 紧急修复：原 let 声明在内层块、下方 _tailAnchorIdx = anchor 外层引用
                     // → 尾部切割一旦发生必抛 ReferenceError: anchor is not defined → 聊天请求 500（消息"秒没了"）
  if (reqLastReal && reqLastReal.role === "user") {
    for (let i = existing.length - 1; i >= 0; i--) {
      const m = existing[i];
      if (!m || m.role === "system") continue;
      if (m.kind === "recent_inherit") break;   // 1018：承接来的原消息是边界，绝不当作「被换掉的旧回复」清掉
      if (isToolNoteMessage(m)) continue;
      if (m.role === "assistant" && !isSpecialEvent(m) && !reqKeys.has(keyOf(m))) { cut = i; continue; }
      break;
    }
    if (cut < existing.length) {
      anchor = -1;
      for (let i = cut - 1; i >= 0; i--) {
        const m = existing[i];
        if (!m || m.role === "system" || isToolNoteMessage(m) || isSpecialEvent(m)) continue;
        anchor = i;
        break;
      }
      const anchorInReq = anchor >= 0 && reqKeys.has(keyOf(existing[anchor]));
      if (!anchorInReq) cut = existing.length;
    }
  }
  let removedTail = 0;
  let _tailAnchorIdx = null;   // 2026-10-08 方案A：尾部对齐场景的锚点 index（清尾后快照处理用）
  if (cut < existing.length) {
    removedTail = existing.length - cut;
    _tailAnchorIdx = anchor;
    existing.splice(cut);
    changed = true;
  }

  // 3) 去重补齐：请求里盘上还缺的真实消息按序追加（user 与 assistant 都补，防旧缓存设备回补丢消息）。
  //    按 id 防重优先：有 id 的消息只按 id 判存在（真正重复消息跳过；连发同句两条不同 id 都保留，
  //    不再被 role+content 键并掉）；无 id 的请求消息（前端未赋 id）回退 role+content 键防重（保留旧行为）。
  const diskById = new Set(existing.filter(function (m) { return m && m.id; }).map(function (m) { return m.id; }));
  // 1018：承接来的原消息不参与内容键防重（新会话第一句恰好与它同文时不被吞）
  const diskKeys = new Set(existing.filter(function (m) { return m && m.content != null && m.kind !== "recent_inherit"; }).map(keyOf));
  const appended = [];
  for (const m of reqReal) {
    if (m.id && diskById.has(m.id)) continue;
    const k = keyOf(m);
    if (!m.id && diskKeys.has(k)) continue;
    if (m.id) diskById.add(m.id);
    diskKeys.add(k);
    appended.push(m);
  }
  if (appended.length) {
    let maxPos = 0;
    for (const m of existing) {
      if (m && m.position && m.position > maxPos) maxPos = m.position;
    }
    for (let i = 0; i < appended.length; i++) {
      existing.push({ time: new Date().toISOString(), ...appended[i], position: maxPos + 0.5 + i });
    }
    changed = true;
  }

  if (changed) {
    const _saved = saveTimeline(existing, sessionId);
    /* 版本存档：时间线落盘成功才写（落盘被拒时版本文件保持原样，不会出现「存了版本但时间线没变」）；存档失败只记日志，不挡重新生成 */
    if (_pendingArchive && _saved !== false) {
      try {
        const _tv = require("./lib/timeline-versions");
        const _store = _tv.load(__dirname, sessionId);
        const _r = _tv.archive(_store, _pendingArchive.anchorId, { content: _pendingArchive.content, tail: _pendingArchive.tail });
        _tv.save(__dirname, sessionId, _store);
        console.log("[regen] 版本已存档: session=" + (sessionId || "default") + " anchor=" + _pendingArchive.anchorId.slice(0, 8) + " 共" + _r.count + "个版本");
      } catch (e) { console.warn("[regen] 版本存档失败（不影响重新生成）:", e && e.message); }
    }
    unarchiveSession(sessionId);   // 新消息落库 → 自动取消归档
    sseNotify(sessionId);
    // 2026-10-08 方案A：清尾（重生成）后按锚点位置处理快照——
    // 尾部区 → 无操作（读取侧收缩自愈）；content 区且其后无 rep 块 → 截断；其后有 rep 块 → 全量重建。
    const _cutAnchor = (_regenAnchorIdx !== null) ? _regenAnchorIdx : _tailAnchorIdx;
    if ((_regenRemoved > 0 || _regenEdited || removedTail > 0) && _cutAnchor !== null) {
      handleSnapshotAfterTailCut(sessionId, existing, _cutAnchor);
    }
  }
  return { appended: appended.length, removedTail: removedTail, changed: changed };
}

// 2026-10-08 方案A：清尾（重生成截断/尾部对齐）后的 v2 快照处理。
// 语义：重生成删掉了锚点之后的消息。若锚点在 content 区 → 冻结内容里残留旧回复，必须截断/重建；
// 若在尾部区 → 快照不含尾部，只需在时间线变短时收缩 snap_point（写回保持自洽）。
function handleSnapshotAfterTailCut(sessionId, timeline, anchorIdx) {
  try {
    const sv2 = require("./context/context-snapshot-v2");
    const snap = sv2.loadSnapshot(__dirname, sessionId);
    if (!snap || !Array.isArray(snap.content) || !Number.isFinite(snap.snap_point)) return;
    const sp = Number(snap.snap_point);
    const tl = Array.isArray(timeline) ? timeline : [];
    if (anchorIdx === null || anchorIdx === undefined || anchorIdx < 0) {
      sv2.markStale(__dirname, sessionId, "tail-cut-no-anchor");
      return;
    }
    if (anchorIdx < sp) {
      // content 区：其后有 rep 块 → 全量重建（避免摘要丢失）；否则截断
      const ranges = (contextReplacements.locateEnabledRanges ? contextReplacements.locateEnabledRanges(sessionId, tl) : []);
      const hasRepAfter = ranges.some(function (r) { return !r.hidden && r.e > anchorIdx; });
      if (hasRepAfter) {
        sv2.markStale(__dirname, sessionId, "regen-content-rep");
        console.log("[ctx-snapshot-v2] 清尾后快照全量重建（锚点后仍有 rep 块） session=" + (sessionId || 'default') + " anchor=" + anchorIdx);
        return;
      }
      const keepIds = [];
      for (let i = 0; i < anchorIdx && i < tl.length; i++) { const m = tl[i]; if (m && m.id) keepIds.push(m.id); }
      const okT = sv2.truncateSnapshot(__dirname, sessionId, keepIds, anchorIdx);
      console.log(okT
        ? ("[ctx-snapshot-v2] 清尾快照已截断 session=" + (sessionId || 'default') + " snap_point=" + anchorIdx)
        : ("[ctx-snapshot-v2] 清尾快照截断失败（读取侧自愈兜底） session=" + (sessionId || 'default')));
    } else if (tl.length < sp) {
      // 尾部区删除且时间线变短 → 收缩 snap_point 写回（保持快照自洽，读取侧不再每次收缩）
      snap.snap_point = tl.length;
      sv2.saveSnapshot(__dirname, sessionId, snap);
      console.log("[ctx-snapshot-v2] 清尾后 snap_point 收缩 " + sp + "→" + tl.length + " session=" + (sessionId || 'default'));
    }
    // anchorIdx >= sp 且时间线未短于快照点 → 尾部区操作，无处理
  } catch (e) {
    console.warn("[ctx-snapshot-v2] 清尾快照处理失败:", e && e.message);
  }
}

// ========================
// 追加特殊事件
// ========================
function appendSpecialEvent(content, extra, sessionId) {
  let newEvent;
  // 按事件内容自带的墙上时间戳插位（唤醒/日记/推送回显/共影首段时间），
  // 而不是一律追加到末尾——否则事件落库晚于其后消息时会被排到错误时间位置。
  // 容量提醒（（容量提醒）…）不带开段时间戳，解析失败回退原 appendMessage 行为。
  const evTime = extractTimestamp(content) || extractCoRecordEventTime({ content });
  if (evTime && !isNaN(evTime.getTime())) {
    const evMs = evTime.getTime();
    const timeline = loadTimeline(sessionId);
    let insertAt = timeline.length;
    for (let i = 0; i < timeline.length; i++) {
      const m = timeline[i];
      if (!m) continue;
      const mt = extractTimestampWithMemory(m) || extractCoRecordEventTime(m);
      if (mt && !isNaN(mt.getTime()) && mt.getTime() >= evMs) { insertAt = i; break; }
    }
    const prev = insertAt > 0 ? timeline[insertAt - 1] : null;
    const next = insertAt < timeline.length ? timeline[insertAt] : null;
    let pos;
    if (prev && next) pos = (Number(prev.position || 0) + Number(next.position || 0)) / 2;
    else if (prev) pos = Number(prev.position || 0) + 0.5;
    else if (next) pos = Math.max(0, Number(next.position || 0) - 0.5);
    else pos = 1;
    const msg = { time: evTime.toISOString(), role: "assistant", content, ...(extra || {}), position: pos, id: crypto.randomUUID ? crypto.randomUUID() : (String(Date.now()) + '-' + Math.random().toString(36).slice(2)) };
    timeline.splice(insertAt, 0, msg);
    saveTimeline(timeline, sessionId);
    newEvent = msg;
  } else {
    newEvent = appendMessage(sessionId, { role: "assistant", content, ...(extra || {}) });
  }
  // 插位分支已手动触发保存，此处需按 hidden 决定是否推前端刷新；
  // appendMessage 分支已在其内部处理过 sseNotify，不再重复。
  if (evTime && !(newEvent && newEvent.hidden)) sseNotify(sessionId);
  // 特殊事件（唤醒/日记/共影/推送）落库后只保留长度日志（可能含推送正文，避免泄漏）。
  console.log(`\n已记录特殊事件 (session ${sessionId || "default"}, position ${newEvent.position}, chars ${normalizeContentToText(content).length})\n`);
}


// 剥离内部标签（用于把客户端清洗版和时间线原始版互相匹配）
// 剥离模型抄进正文的「工具回声」块【工具 · NAME】{.../[...]/(...)}：
// 权威工具结果由 toolHistory(tools 字段) 与「【工具调用记录】」承担，模型重复抄写会造成冗余/刷屏，故服务端删除。
// 与前端 extractToolEchoBlocks 同判据（标签后紧跟 { [ （ 才当作工具结果块）。
function stripToolEchoBlocks(content) {
  const s = String(content || "");
  if (s.indexOf("【工具") < 0) return s;
  const re = /【工具\s*[·．.]?\s*[^】\n]+】/g;
  let rebuilt = "", last = 0, m, found = false;
  while ((m = re.exec(s)) !== null) {
    const after = s.slice(re.lastIndex);
    if (!/^\s*\n?\s*[{\[（]/.test(after)) continue;
    const restAfter = s.slice(re.lastIndex);
    const nextTool = restAfter.search(/【工具\s*[·．.]?\s*[^】\n]+】/);
    const sep = restAfter.search(/\n\s*---\s*\n/);
    let end = restAfter.length;
    if (nextTool >= 0) end = Math.min(end, nextTool);
    if (sep >= 0) end = Math.min(end, sep);
    rebuilt += s.slice(last, m.index);   // 去掉该工具回声块
    last = re.lastIndex + end;
    re.lastIndex = last;
    found = true;
  }
  if (!found) return s;
  rebuilt += s.slice(last);
  return rebuilt.replace(/\n{3,}/g, "\n\n");
}

function stripPosition(messages) {
  // 只保留消息正文，剥离内部排序与时间字段（position/time 等内部字段不外泄给上游/前端）
  return messages.map(({ position, time, ...rest }) => rest);
}

let wakeUpLastHeartbeat = null;
let lastLLMMessages = null;
let lastLLMCaptureTime = null;
let lastLoggedContextCaptureTime = null; // 后台活动页同一份上下文只记一次，避免反复打开重复落盘
// 供拆到 routes/chat.js 的 /v1/chat/completions 回写「当前请求上下文」捕获，
// 保持与 server.js 内的 lastLLMMessages/lastLLMCaptureTime 同一引用(管理台 /admin/logs/context 读取)。
// 1021：捕获落盘（data/last_llm_context.json），网关重启后「当前请求上下文」不再是空的。异步写，失败不影响聊天。
const LAST_LLM_FILE = path.join(__dirname, "data", "last_llm_context.json");
try {
  const _j = JSON.parse(fs.readFileSync(LAST_LLM_FILE, "utf8"));
  if (_j && Array.isArray(_j.messages)) { lastLLMMessages = _j.messages; lastLLMCaptureTime = _j.captureTime || null; }
} catch (e) { /* 没有就算了 */ }
// 1021：按会话各存一份最近一次真正发出去的请求（小手机「当前请求上下文」只看当前会话，不看全局最后一次）。
// 一个会话一个文件，覆盖写；会话 id 只取安全字符，避免路径穿越。
const LAST_LLM_BY_SESSION_DIR = path.join(__dirname, "data", "last_llm_by_session");
function lastLLMSessionFile(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid || !/^[A-Za-z0-9_.-]{1,80}$/.test(sid) || sid === "." || sid === "..") return null;
  return path.join(LAST_LLM_BY_SESSION_DIR, sid + ".json");
}
function readLastLLMOfSession(sessionId) {
  const f = lastLLMSessionFile(sessionId);
  if (!f) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    return j && Array.isArray(j.messages) ? j : null;
  } catch (e) { return null; }
}
/* [位置:server.js·setLastLLMCapture tools] [会话存档带上实际发出的工具定义] [10-29 #46：上游实报 token 含工具定义，页面「工具定义」行却一直是空的——真正发的 tools 只在工具循环内部（快照 v2 的 tools 自 1026 解冻后恒为 null）；加第 4 可选参数带出来，只写会话存档文件（全局 last_llm_context.json 不写，管理台全局分支不用 tools，省体积）；/admin/logs/context 优先读这里、回落快照] [注释时间 2026-10-29] */
function setLastLLMCapture(messages, time, sessionId, tools) {
  lastLLMMessages = messages;
  lastLLMCaptureTime = time;
  try {
    fs.writeFile(LAST_LLM_FILE, JSON.stringify({ messages: messages, captureTime: time }), function (e) { if (e) console.warn("[last-llm-context] 落盘失败:", e.message); });
  } catch (e) { /* ignore */ }
  const sf = lastLLMSessionFile(sessionId);
  if (sf) {
    try {
      fs.mkdirSync(LAST_LLM_BY_SESSION_DIR, { recursive: true });
      fs.writeFile(sf, JSON.stringify({ session: String(sessionId), messages: messages, captureTime: time, tools: (Array.isArray(tools) && tools.length) ? tools : undefined }), function (e) { if (e) console.warn("[last-llm-context] 会话落盘失败:", e.message); });
    } catch (e) { /* ignore */ }
  }
}

// ========================
// 网易云环境（网易云 MCP 会话管理）
// ========================
const ENV_FILE = ".env";
const PREFERRED_ENV_ORDER = [
  "TARGET_API_URL",
  "TARGET_API_KEY",
  "GATEWAY_API_KEY",
  "MODEL_NAME",
  "BARK_KEY",
  "CUSTOM_ICON_URL",
  "ALLOW_PUBLIC_API",
  "PUSH_PROVIDER",
  "DIARY_ENABLED",
  "DIARY_DIR",
  "REQUEST_BODY_LIMIT_MB",
  "DAY_WAKE_AFTER_MINUTES",
  "NIGHT_WAKE_AFTER_MINUTES",
  "DAY_CHECK_INTERVAL_MINUTES",
  "NIGHT_CHECK_INTERVAL_MINUTES",
  "WAKE_DAY_START_HOUR",
  "WAKE_DAY_END_HOUR",
  "WEATHER_ENABLED",
  "WEATHER_LOCATION_NAME",
  "WEATHER_LAT",
  "WEATHER_LON",
  "WEATHER_UNITS",
  "PORT",
  "GATEWAY_BASE_URL",
  "TIME_ZONE",
  "RESTART_COMMAND",
  "ADMIN_USER",
  "ADMIN_PASSWORD"
];

// 网易云会话/账号辅助（2026-11-03 server.js 拆分批 3：原 1959-2020 行拆到 lib/netease-session.js，路由与告警扫描共用）
const { NETEASE_SESSION_FILE, readNetEaseEnv, readNeteaseSession, writeNeteaseSession, fetchNeteaseAccount } = require("./lib/netease-session");

// 请求是否期望 JSON 响应（Content-Type 或 Accept 含 application/json）
function wantsJsonResponse(req) {
  const contentType = req.headers["content-type"] || "";
  const accept = req.headers.accept || "";
  return contentType.includes("application/json") || accept.includes("application/json");
}

// 2026-10-29 修复（审查 P1）：把取值解析与写入侧 serializeEnvValue 对齐，并遵循 dotenv 17.4.2 的实际规则。
// 原实现是 `trimmed.slice(eqIndex + 1).trim()`——**不认任何引号**，而写侧（见下方 serializeEnvValue）
// 对含 `#` 或首尾空白的值会加引号包裹，于是：
//   写侧把口令 p#x 落盘为 'p#x' → 这里读回的是**带引号的** 'p#x'（长度都变了）→
//   下次保存以它为基底再包一层 → 值逐轮畸变，最终表现是「口令没改却突然登不进 / 上游 key 莫名失效」。
// dotenv 规则（与 serializeEnvValue 上方注释同源，实测核对）：
//   单引号包裹 → 原样保留，不做任何还原；
//   双引号包裹 → 只还原 \n 与 \r（不还原 \" 与 \\）；
//   无引号     → 第一个 # 之后视为行内注释并截断，再 trim。
// 兼容性：现有 .env 中若无 quoted 值、也无未加引号的 `#`，行为与改动前逐字一致。
function parseEnvValue(raw) {
  const v = String(raw == null ? "" : raw).trim();
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1);
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  }
  const hashIdx = v.indexOf("#");
  return (hashIdx >= 0 ? v.slice(0, hashIdx) : v).trim();
}

// 解析 .env 文件为键值对象（忽略空行与 # 注释行）
function loadEnvFileObject() {
  const result = {};
  try {
    const envContent = fs.readFileSync(ENV_FILE, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      result[key] = parseEnvValue(value);
    }
  } catch (e) { console.error('[server.js:1859]', e.message || e); }
  return result;
}

// 启动时把 .env 读进内存一次，readEnvValue 之后只读缓存，避免每次调用都读盘。
// 任何写路径（/admin/save、改密码等）都会经过 writeEnvUpdates，写完后刷新该缓存。
let cachedEnv = loadEnvFileObject();

function serializeEnvValue(value) {
  const raw = String(value ?? "");
  // 2026-09-22 审查 M4：原实现只把换行转成 \n——含 `#` 的值写入 .env 后会被 dotenv 当**行内注释截断**
  // （如口令 p@ss#word 读回只剩 p@ss），首尾空白也会被 trim 掉。
  // 实测 dotenv 17.4.2 规则：解析时**只还原 `\n`/`\r`，不还原 `\"` 与 `\\`**——所以「转义引号」无效，
  // 唯一安全做法是加引号包裹。包裹策略：
  //   ① 值不含单引号 → 用**单引号**包裹（dotenv 对单引号值不做任何还原，值可原样保留，含双引号也安全）；
  //   ② 否则值不含双引号 → 用双引号包裹；
  //   ③ 两者都含（或含换行）→ 无法安全包裹，按原样写入并告警。
  // 其余情况保持原路径，行为与改动前逐字一致（含换行的值仍写为字面 \n，不改其语义）。
  const needQuote = raw.indexOf("#") !== -1 || /^\s|\s$/.test(raw);
  if (needQuote) {
    const hasNl = raw.indexOf("\n") !== -1 || raw.indexOf("\r") !== -1;
    if (!hasNl) {
      if (raw.indexOf("'") === -1) return "'" + raw + "'";
      if (raw.indexOf('"') === -1) return '"' + raw + '"';
    }
    console.warn("[env] 配置值含 # / 首尾空白，且同时含引号或换行，无法安全加引号包裹，按原样写入（回读可能被截断）");
  }
  return raw.replace(/\r?\n/g, "\\n");
}

// serialize .env read-merge-write to avoid concurrent /admin/save overwrite
let envWriteChain = Promise.resolve();
function writeEnvUpdates(updates) {
  const task = async () => {
    const merged = { ...loadEnvFileObject(), ...updates };
    const orderedKeys = [
      ...PREFERRED_ENV_ORDER.filter(key => Object.prototype.hasOwnProperty.call(merged, key)),
      ...Object.keys(merged)
        .filter(key => !PREFERRED_ENV_ORDER.includes(key))
        .sort()
    ];
    const lines = orderedKeys.map(key => `${key}=${serializeEnvValue(merged[key])}`);
    atomicWriteFileSync(ENV_FILE, lines.join("\n") + "\n");
    // 2026-09-22 审查 M3：原子写经临时文件 rename，权限随 umask（实测线上 .env 为 0644，
    // 任何本地用户可读全部密钥）。.env 强制 0600。
    try { fs.chmodSync(ENV_FILE, 0o600); } catch (e) { console.warn("[env] chmod 0600 失败:", e.message); }
    cachedEnv = { ...merged };
    // 2026-09-21 审查 H8：同步 process.env，否则 isAuthorized/validSessionToken 仍读旧值，
    // 管理台改完口令出现「新口令登不进、旧口令照样能进」直到 pm2 restart
    for (const key of Object.keys(updates)) {
      const v = updates[key];
      if (v === undefined || v === null) delete process.env[key];
      else process.env[key] = String(v);
    }
  };
  envWriteChain = envWriteChain.then(task, task);
  return envWriteChain;
}

function readRestartCommand() {
  return readEnvValue("RESTART_COMMAND") || DEFAULT_RESTART_COMMAND;
}

// ========================
// 安全：放行 /admin，其他仅本地/局域网
// ========================
app.addHook("onRequest", (req, reply, done) => {
  if (req.url.startsWith("/admin")) return done();
  // 内部接口：若配置了 INTERNAL_API_KEY 则必须携带
  const isInternalPath = req.url.startsWith("/internal/");
  if (isInternalPath) {
    const internalKey = readEnvValue("INTERNAL_API_KEY");
    // 2026-09-21 审查 H6：fail-closed——未配置 INTERNAL_API_KEY 时直接拒绝（原为放行落到网络判断）
    if (!internalKey) {
      reply.code(403).send({ error: "INTERNAL_API_KEY 未配置，内部接口已封锁" });
      return;
    }
    const supplied = String(req.headers["x-internal-key"] || "").trim();
    if (supplied !== internalKey) {
      reply.code(401).send({ error: "Invalid internal key" });
      return;
    }
    return done();
  }
  // 批注 2026-07-15：公网部署常经过反代，真实公网请求可能在 Node 侧显示为 127/10 网段；
  // 所以 ALLOW_PUBLIC_API=true 后必须先验 /v1 的网关 key，避免被云平台内网 IP 绕过。
  if (publicApiEnabled() && req.url.startsWith("/v1/")) {
    const configuredKey = readEnvValue("GATEWAY_API_KEY");
    if (!configuredKey) {
      reply.code(401).send({ error: "公网 /v1 已开启，但 GATEWAY_API_KEY 未配置" });
      return;
    }
    const auth = String(req.headers.authorization || "");
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    const headerKey = String(req.headers["x-gateway-api-key"] || req.headers["x-api-key"] || "").trim();
    if (bearer === configuredKey || headerKey === configuredKey) return done();
    // 批注 2026-08-29：多浏览器/跨设备同步。聊天页登录后夹带 admin_session cookie，
    // 登录本身就用管理员账号密码校验（与 GATEWAY key 同等级或更强），
    // 所以允许"已登录会话"访问 /v1/*（读历史 + 发消息），
    // 避免每个浏览器都要在 localStorage 里单独存一份 GATEWAY key。
    try {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.admin_session && validSessionToken(cookies.admin_session)) return done();
    } catch (e) { console.error('[server.js:1962]', e.message || e); }
    // 批注 2026-07-30：Kelivo 可能在模型探测或旧预设里继续带错 key；
    // 只记路径和 header 类型，帮助排查缓存/重复请求，绝不把任意密钥写入日志。
    console.warn(JSON.stringify({
      event: "gateway_auth_rejected",
      path: req.url.split("?")[0],
      auth_source: bearer ? "bearer" : headerKey ? "x-api-key" : "missing"
    }));
    reply.code(401).send({ error: "Gateway API Key 无效或缺失" });
    return;
  }
  // 客户端真实 IP：只有直连来源是可信内网（本机/内网）时才信任 nginx 转发的
  // X-Real-IP / X-Forwarded-For，避免公网直连时伪造转发头绕过内网判断。
  const rawIp = req.ip || req.connection.remoteAddress || "";
  // Node 双栈环境下 IPv4 常被映射为 ::ffff:x.x.x.x，先归一化再判断
  const directIp = String(rawIp).replace(/^::ffff:/i, "");
  const isLocalPeer = directIp === "127.0.0.1" || directIp === "::1" || directIp === "localhost" || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(directIp);
  let ip = directIp;
  if (isLocalPeer) {
    // 2026-09-21 审查 H6：只信 X-Real-IP，弃用 X-Forwarded-For 末段兜底——
    // 链路上多一跳未改写 XFF 的代理时，攻击者自造 XFF 首段即可伪造可信 IP。
    // 线上 nginx 反代到 3000 的全部 location 均已设 X-Real-IP（2026-09-21 核实）。
    const realIp = String(req.headers["x-real-ip"] || "").trim();
    if (realIp) {
      ip = String(realIp).replace(/^::ffff:/i, "");
    }
  }
  // 1021：发送前来源白名单。只管会真的发上游的入口——不在白名单就当场拒绝，
  // 不进入上游、不消耗额度、不落消息。列表为空时完全不干预（默认行为）。
  if (req.url && req.url.split("?")[0] === "/v1/chat/completions") {
    const allow = readSendAllowlist();
    if (allow.length && !require("./lib/ip-allow").isAllowed(ip, allow)) {
      reply.code(403).send({ error: "CLIENT_IP_DENIED", message: "当前网络未被允许发送消息", client_ip: ip });
      return done();
    }
  }
  const isTrustedNetwork = ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
  if (isTrustedNetwork) return done();
  reply.code(403).send("Forbidden");
});

// ========================
// Models
// ========================
// ---- 快照过期检测（1008-10：会话列表「重建快照」红点，纯只读）----
// 判定「快照冻结前缀与最新实际状态有变化」（新消息追加不算）：
//   format 旧格式快照（无 v3 content/snap_point）；edited 失效标记（编辑/状态机/压缩）；
//   system 当前系统提示 vs 快照。（1026 起 tools 不再冻进快照，不参与本检测）
// 1010-11 阶段4a改：注入块红点改为「内容指纹（token 序列）真变」判断。
// 与主聊天同源组装当前注入块（assembleInput + buildContextBlocks，与 /admin/cross-window-inject 预览同链），
// 供 snapshotStaleOf 与快照冻结的 fixed_blocks 逐块比对：当前内容以冻结内容为前缀（startsWith）
// = 冻结 token 仍是当前前缀 → 不红；冻结块被替换/修改/消失 → 红。
// 新日记追加在 diary 块末尾（或 cutoff 不注入）→ 前缀不变 → 不红。不再用源文件 mtime（碰一下/追加即误红）。
// 缓存：按 (会话, 源文件 mtime 签名) 短 TTL，避免会话列表逐会话重复读大文件。
const _injBlkCache = new Map(); // sessionId -> { sig, at, map }
function buildCurrentInjectBlocksFor(sessionId) {
  try {
    const sid = String(sessionId || "default").trim() || "default";
    let sig = "";
    // papers.json 一并计入（1031）：笔记本目录行来源，笔记一改就要用新数据算目录行集合
    const _srcFiles = ["pinned.json", "memory_v2.json", "cross_inject_config.json", "diary.json", "memory_summary_cache.json", "context_compaction_marks.json", "papers.json"];
    for (const fn of _srcFiles) {
      try { sig += fs.statSync(path.join(__dirname, "data", fn)).mtimeMs + "|"; } catch (e) { sig += "0|"; }
    }
    try {
      const _ps = sessionCfg.readPinnedScope(sid);
      sig += (_ps.scope || "") + ":" + String(_ps.enabled) + ":" + (_ps.scope ? require("./lib/preset-pinned").mtimeMs(__dirname, _ps.scope) : 0) + "|";
    } catch (e) { sig += "0|"; }
    try {
      const _nb = require("./lib/notebooks").resolveForSession(__dirname, sid);
      sig += _nb.id + ":" + require("./lib/notebooks").mtimeMs(__dirname, _nb.id) + "|";
    } catch (e) { sig += "0|"; }
    const _now = Date.now();
    const c = _injBlkCache.get(sid);
    if (c && c.sig === sig && _now - c.at < 4000 && c.map) return c.map;
    const input = ctxV2Shadow.assembleInput({
      baseDir: __dirname,
      sessionId: sid,
      llmMessages: [],
      loadTimeline: loadTimeline,
      normalizeContentToText: normalizeContentToText,
    });
    // 1018：日记/标星/笔记本按本会话冻结成员渲染（只读，不登记）——成员被改才会和快照不同；没成员的块不比
    let _cap = null;
    try { _cap = require("./lib/frozen-blocks").prepareInput(__dirname, sid, input, null, { loadTimeline: loadTimeline, starredLimit: sessionCfg.readStarredDialogLimit(sid) }); } catch (e) { _cap = null; }
    const built = buildContextBlocks(input);
    const map = { __frozenMembers: (_cap && _cap.store && _cap.store.members) || {} };
    for (const b of (built.blocks || [])) {
      if (b && b.key && !b.empty && typeof b.content === "string" && b.content) map[b.key] = b.content;
    }
    if (_injBlkCache.size > 30) _injBlkCache.clear();
    _injBlkCache.set(sid, { sig: sig, at: _now, map: map });
    return map;
  } catch (e) {
    return null;
  }
}
// 1031：笔记本目录「目录行集合」签名——只取目录行（文件夹行 fid｜路径｜摘要 / 文件行 id｜标题｜摘要），
// 做排序无关的集合比（排序已改按创建时间，编辑不挪行；稳妥起见仍不比顺序）。头部说明、「N 个文件夹、共 M 篇」
// 计数行、「更早的 X 篇」提示不参与——文件夹里加减笔记只动计数，按10-31 拍板不算目录变化、不提醒。
function _indexRowsSig(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const head = String(line.replace(/^[　\s]+/, "")).split("｜")[0] || "";
    if (line.indexOf("｜") >= 0 && /^(f\d+|\d+)$/.test(head)) rows.push(line.trim());
  }
  return rows.sort().join("\n");
}
async function snapshotStaleOf(sessionId) {
  try {
    const sv2 = require("./context/context-snapshot-v2");
    const snap = sv2.loadSnapshot(__dirname, sessionId);
    if (!snap) return { stale: false, reasons: [] };
    const reasons = [];
    if (!Array.isArray(snap.content) || !Number.isFinite(snap.snap_point)) reasons.push("format");
    if (sv2.isStale(__dirname, sessionId)) reasons.push("edited");
    // 1026：工具列表冻结已取消（不再冻进快照），tools 维度从快照过期检测移除——工具变化即时生效，不再要求重建快照
    try {
      const cur = (typeof resolveSessionSystemPrompt === "function") ? (resolveSessionSystemPrompt(sessionId) || "") : "";
      // 1008-13 修复：快照 system 是 {role,content} 对象，String 化恒为 "[object Object]" → 恒红误报；改为比 content
      if (String((snap.system && snap.system.content) || "") !== cur) reasons.push("system");
    } catch (e) { console.error('[server.js:2074]', e.message || e); }
    try {
      // 1018 跨窗口注入定稿：红点只看「会变的」——按块内容指纹逐块比对，哪块变了报哪块。
      //   会变：永久上下文（system_instructions）、core、long（人设见上方 system；
      //        状态机更新已自动重建，不需要提示）。
      //   建好即固定：日记 / 标星——只比有冻结成员的（以前日记块参与比对，AI 写篇日记就亮）。
      //   笔记本目录（1031 产品确定）：改比「目录行集合」，见下方 _indexRowsSig。
      //   置顶笔记（1102 产品确定）：不冻结、重建时按当前置顶重出，比块内容指纹（置顶/取消置顶会同时动目录行和本块）。
      //   结构：本会话勾选 vs 快照生成时的勾选（inject_meta.selected）；存量快照无记录时按「勾了且现在有内容
      //        但快照里没有 / 快照里有但没勾」推断。跨窗口注入总开关关闭时不提示（请求时已按开关过滤）。
      if (Array.isArray(snap.fixed_blocks) && sessionCfg.sessionCrossInjectOverride(sessionId) !== false) {
        const _fp = function (s) { return (typeof s === "string" && s) ? crypto.createHash("sha256").update(s).digest("hex").slice(0, 16) : ""; };
        const _frozenMap = {};
        for (const fb of snap.fixed_blocks) { if (fb && fb.key) _frozenMap[fb.key] = fb.content; }
        const _inj = sessionCfg.readInjectBlocks(sessionId);
        const _want = new Set(Array.isArray(_inj) ? _inj : sessionCfg.DEFAULT_INJECT_BLOCKS);
        const _curMap = buildCurrentInjectBlocksFor(sessionId) || {};
        const CHANGEABLE = ["system_instructions", "core_identity", "long_term_understanding"];
        for (const k of CHANGEABLE) {
          if (!_want.has(k)) continue;
          if (_fp(_frozenMap[k]) !== _fp(_curMap[k])) reasons.push("block:" + k);
        }
        // 固定块：只比有冻结成员的（成员内容被手动修改/删除才会不同；新写的进不来，不会误报）
        const _mem = _curMap.__frozenMembers || {};
        for (const k of ["conversation_continuity", "starred_dialog"]) {
          if (!Object.prototype.hasOwnProperty.call(_mem, k) || !_want.has(k)) continue;
          if (_fp(_frozenMap[k]) !== _fp(_curMap[k])) reasons.push("block:" + k);
        }
        // 笔记本目录（1031）：不看冻结成员（10-22 起不再登记），按「目录行集合」比——
        // 根目录文件行、文件夹行、标题/摘要改动 → 亮；只改笔记正文（行不变）→ 不亮；
        // 文件夹里加减笔记只有「共N篇」计数变、文件夹之间挪动（目录行不变）→ 不亮（AI 本来看不到子文件）。
        // 2026-11-01 审查修复：去掉「快照里必须有非空目录块」的前置——快照时本子为空（装配层不产出该块）
        // 也按空目录比，之后写第一篇笔记同样会亮；否则那种会话永远不提示重建。
        if (_want.has("notebook_index")) {
          if (_fp(_indexRowsSig(_frozenMap.notebook_index || "")) !== _fp(_indexRowsSig(_curMap.notebook_index || ""))) {
            reasons.push("block:notebook_index");
          }
        }
        // 置顶笔记（1102）：同笔记本目录——不冻结，直接比块内容指纹；快照里没有本块（老快照/还没置顶过）也按空比，
        // 之后第一篇置顶同样会亮（同 11-01 notebook_index 审查修复的思路）
        if (_want.has("pinned_notes")) {
          if (_fp(_frozenMap.pinned_notes || "") !== _fp(_curMap.pinned_notes || "")) {
            reasons.push("block:pinned_notes");
          }
        }
        // 记忆池关键词（1102 产品确定）：同置顶笔记——不冻结、重建时按当前记忆池重出，比块内容指纹。
        // 默认关（不在 DEFAULT_INJECT_BLOCKS），没勾的会话完全不参与红点；勾了的会话记忆池关键词汇总变化才亮。
        if (_want.has("memory_keywords")) {
          if (_fp(_frozenMap.memory_keywords || "") !== _fp(_curMap.memory_keywords || "")) {
            reasons.push("block:memory_keywords");
          }
        }
        // 结构：只看会产出注入块的键（state_machine 走替换通道、recent_dialog 是建会话时的一次性动作）
        const STRUCT_KEYS = ["core_identity", "long_term_understanding", "conversation_continuity", "starred_dialog", "notebook_index", "pinned_notes", "memory_keywords", "state_inherit"];
        const _sel = (snap.inject_meta && Array.isArray(snap.inject_meta.selected)) ? new Set(snap.inject_meta.selected) : null;
        let _structChanged = false;
        for (const k of STRUCT_KEYS) {
          const nowOn = _want.has(k);
          if (_sel) { if (nowOn !== _sel.has(k)) { _structChanged = true; break; } continue; }
          if (k === "state_inherit") continue;   // 存量快照无从推断，不报
          const inSnap = typeof _frozenMap[k] === "string" && !!_frozenMap[k];
          const hasNow = typeof _curMap[k] === "string" && !!_curMap[k];
          if ((nowOn && !inSnap && hasNow) || (!nowOn && inSnap)) { _structChanged = true; break; }
        }
        if (_structChanged) reasons.push("structure");
      }
    } catch (e) { console.error('[snapshotStaleOf blocks]', e.message || e); }
    return { stale: reasons.length > 0, reasons: reasons.slice(0, 6) };
  } catch (e) {
    return { stale: false, reasons: [] };
  }
}


require("./routes/chat")(app, {
  baseDir: __dirname,
  providerUnusableReason,
  configuredModelName,
  loadTimeline,
  isRealMessageForTimeline,
  timelineFileFor,
  normalizeMessageForTimeline,
  buildTimeline,
  saveTimeline,
  appendMessage,
  appendMessages,
  appendRequestMessages,
  handleSnapshotAfterTailCut,   // 2026-11-10 版本切换后要按锚点处理快照
  readSessionArchive,
  tailHasReply,
  markSessionDeleted,
  sseSubscribe,
  sseUnsubscribe,
  sseNotify,
  SSE_HEARTBEAT_MS,
  setClientVisible,
  isClientWatching,
  recentReplies,
  activeGenMap,

  ACTIVE_GEN_TTL_MS,
  sweepStaleGenerations,
  isRecentReplyCacheable,
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_PENDING_WAIT_MS,
  IDEMPOTENCY_PENDING_TOTAL_MS,
  setRecentReply,
  beginPendingReply,
  waitPendingReply,
  clearPendingReply,
  sessionCrossInjectOverride,
  saveSessionCrossInjectOverride,
  readInjectBlocks,
  saveInjectBlocks,
  readStarredDialogLimit,
  saveStarredDialogLimit,
  readSessionDiaryCount,
  saveSessionDiaryCount,
  readClaudeThinkingEffort,
  saveClaudeThinkingEffort,
  readGrokThinkingEffort,
  saveGrokThinkingEffort,
  readClaudeCache1h,
  saveClaudeCache1h,
  readGlmDropHistReasoning,
  saveGlmDropHistReasoning,
  prepareMessageForLLM,
  normalizeContentToText,
  isSpecialEvent,
  extractTimestampWithMemory,
  stripPosition,
  resolveChatModel,
  resolveSessionSystemPrompt,
  snapshotStaleOf,
  sessionModelProviderOverride,
  saveSessionModelProviderOverride,
  sessionModelNameOverride,
  saveSessionModelNameOverride,
  // 1025 时间缀开关（会话级三态 + 生效值 + 剥离函数），/v1/sessions/:id/time-tag-to-ai 与主聊剥离用
  sessionTimeTagOverride,
  saveSessionTimeTagOverride,
  resolveTimeTagToAi,
  stripTimeTagsFromMessages,
  // 2026-11-21 trace 剥离开关（会话级），/v1/sessions/:id/strip-trace 与主聊/唤醒剥离用
  readStripTraceToAi,
  saveStripTraceToAi,
  stripTraceFromMessages,
  // 10-29 #49 elapsed 标签开关（同款三态），/v1/sessions/:id/elapsed-tag 与主聊注入用
  sessionElapsedTagOverride,
  saveSessionElapsedTagOverride,
  resolveElapsedTagToAi,
  readEnvValue,
  UPSTREAM_TIMEOUT_MS,
  handleMcpRequest,
  getMcpClients,
  splitMultimodalContent,
  extractAssistantThinking,
  parseWakeTagAndSchedule,
  createContentTagFilter,
  appendSpecialEvent,
  removeTimelineMessages,   /* 2026-11-12 唤醒失败回滚 [唤醒] 块用（wakeChatDeps 透传给 wake-chat） */
  MCP_ENABLED,
  summarizeMessagesForLog,
  setLastLLMCapture
});

// ========================
// 统一唤醒调用器（2026-09-15 唤醒并入网关）：进程内直调 wakeChatModule.runWakeCompletion
// 与对话侧同一套上下文加工（chat-context.js）；唤醒特有行为仍在调用方。
// （原 POST /internal/wake-completions HTTP 端点零消费者，2026-09-21 审查清理删除）
// ========================
const wakeChatModule = require("./routes/wake-chat");

// diary_add 工具写日记 → 时间线落库（2026-09-29 起，2026-10-03 提为具名函数）。
// 日记正文只在工具参数 args.content 里，工具端回执不返正文，服务端必须自己补一条 kind=diary
// 隐藏消息，否则 AI 重建上下文时看不到自己写过什么（isRealDiary 让它永不压缩）。
// 对话侧两条工具循环（streamToolLoop 主路径 + runWithTools 兜底）与唤醒侧工具循环共用这一个实现。
// 注：diaryLib 在下方 .env 读取区之后才初始化（const 有 TDZ），本函数只在请求期被调用，运行期安全。
function onDiaryToolWritten(sid, dContent, diaryId) {
  try {
    if (!sid || !dContent) return false;
    if (diaryId != null) {
      const existing = loadTimeline(sid);
      for (let i = existing.length - 1; i >= Math.max(0, existing.length - 30); i--) {
        const m = existing[i];
        if (m && m.kind === "diary" && m.diary_id != null && String(m.diary_id) === String(diaryId)) {
          return true;   // 2026-11-24：防重，跨客户端 /internal/diary 与网关工具循环不重复落同一篇日记
        }
      }
    }
    const msg = { role: "assistant", content: diaryLib.wrapDiaryTag(dContent), kind: "diary", time: new Date().toISOString() };
    if (diaryId != null) msg.diary_id = diaryId;   // 2026-10-19：外键，页面编辑/恢复按它定点同步
    appendMessages(sid, [msg], { silent: true });
    console.log("[diary] diary_add 已落库时间线 (session=" + sid + ", chars=" + dContent.length + ", diary_id=" + diaryId + ")");
    return true;
  } catch (e) { console.warn("[diary] diary_add 落库时间线失败:", e.message); return false; }
}

const wakeChatDeps = {
  baseDir: __dirname,
  loadTimeline,
  saveTimeline,
  appendMessages,
  appendSpecialEvent,
  isSpecialEvent,
  removeTimelineMessages,   /* 2026-11-12：唤醒失败时撤回已落盘的 [唤醒] 块（复用通知撤回的同一实现，splice 原地删保指纹） */
  normalizeContentToText,
  stripPosition,
  resolveChatModel,
  resolveSessionSystemPrompt,
  readEnvValue,
  UPSTREAM_TIMEOUT_MS,
  setLastLLMCapture,
  splitMultimodalContent,
  prepareMessageForLLM,
  extractTimestampWithMemory,   // 2026-09-22 审查 §3.5：唤醒侧时间反查与对话侧统一口径（原只认 tm.time）
  resolveTimeTagToAi,           // 1025 时间缀开关：唤醒上下文同样按开关剥 <current_time>
  stripTimeTagsFromMessages,
  readStripTraceToAi,           // 2026-11-21 trace 剥离开关：唤醒上下文同样按开关剥 <trace>
  stripTraceFromMessages,
  onDiaryWritten: onDiaryToolWritten,   // 2026-10-03：唤醒侧 streamToolLoop 与对话侧同一实现，不再漏 diary_add 日记
  readClaudeThinkingEffort,   // 10-30：唤醒与聊天一致——Claude 思考档位按会话读
  readGrokThinkingEffort,     // 11-16：唤醒与聊天一致——Grok 思考档位按会话读
  readClaudeCache1h,          // 11-04：唤醒同样按会话决定缓存 1h
  readGlmDropHistReasoning,   // 11-15：唤醒与聊天一致——GLM 历史思考按会话读
  incrementalContext: contextReplacements.buildIncrementalContext,   // 0929 增量：块摘要化+尾部现算
  fullCache: false   // 10-30：唤醒与聊天一模一样——同样只走增量缓存（原来唤醒走整体缓存，两侧上下文在 fp 命中时可能走不同路径）
};
wakeChatModule(app, wakeChatDeps);

// ========================
// 唤醒调度器（2026-09-15 批3收尾）：wake-up 独立进程退役，调度内核并入 gateway，
// 进程内直调 runWakeCompletion / applyWakeEventV2 / sendPushNotification（无 HTTP 自环）。
// 仅构建闭包；定时器与检查循环在下方 listen 回调里 start()。
// ========================
const wakeScheduler = require("./lib/wake-scheduler")({
  baseDir: __dirname,
  readEnvValue,
  normalizeContentToText,
  touchHeartbeat() { wakeUpLastHeartbeat = Date.now(); },
  sendPushNotification,
  applyWakeEventV2,
  runWakeCompletion: wakeChatModule.runWakeCompletion,
  wakeDeps: wakeChatDeps,
  activeGenMap,
  ACTIVE_GEN_TTL_MS
});

// ========================
// Chat Completions
// ========================
// 会话级配置（模型供应商 / 模型名 / 跨窗口注入开关）读写：
// 实现已搬到 lib/session-cfg.js——跨窗口开关 1003-19 起真正生效，context-v2-runtime.js 也要读同一份。
// 2026-10-03：V1「跨窗口自动注入」整条链路（跨窗口记忆快照 data/cross_snapshot_<sid>.json +
// 相关记忆/近期日记文本计算）随 ctx_v2 全面启用一并删除，此处不再有注入实现。
// 现存注入只有 V2 的 conversation_continuity（Earlier Days）块，见 context-v2-runtime.js。
// 历史沿革：标星「记忆碎片」注入 2026-09-05 移除；跨窗口快照 2026-08-30 引入、09-28 拆除。
// ========================
const SESSION_CFG_DIR = sessionCfg.SESSION_CFG_DIR;   // 2026-10-03 随会话级配置读写一起搬到 lib/session-cfg.js
// 会话级模型供应商覆盖：返回该会话指定的供应商 id，null=跟随全局。
function sessionModelProviderOverride(sessionId) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  try {
    if (fs.existsSync(file)) {
      const o = fs.readJsonSync(file);
      if (o && typeof o.model_provider_id === "string" && o.model_provider_id) return o.model_provider_id;
    }
  } catch (e) { console.warn("[session-cfg] 读取模型供应商覆盖失败:", e.message); }
  return null;
}
function saveSessionModelProviderOverride(sessionId, providerId) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  let o = {};
  try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
  if (providerId === null || providerId === undefined || providerId === "") delete o.model_provider_id;
  else o.model_provider_id = String(providerId);
  fs.ensureDirSync(SESSION_CFG_DIR);
  fs.writeJsonSync(file, o);
  return o;
}
// ========================
// 1025（产品确定）：时间缀开关——她消息末尾的 <current_time> 标签是否发给模型。
// 三层：会话级覆盖（data/session_cfg/<sid>.json，null=跟随全局）→ 全局 cfg.time_tag_to_ai（缺省 true）。
// 关 = 发给模型的 user 消息剥掉标签；时间线落盘、唤醒调度（msg.time 字段）、压缩账本均不受影响。
// ========================
function sessionTimeTagOverride(sessionId) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  try {
    if (fs.existsSync(file)) {
      const o = fs.readJsonSync(file);
      if (o && typeof o.time_tag_to_ai === "boolean") return o.time_tag_to_ai;
    }
  } catch (e) { /* ignore */ }
  return null;
}
function saveSessionTimeTagOverride(sessionId, val) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  let o = {};
  try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
  if (val !== true && val !== false) delete o.time_tag_to_ai;
  else o.time_tag_to_ai = val;
  fs.ensureDirSync(SESSION_CFG_DIR);
  fs.writeJsonSync(file, o);
  return o;
}
function resolveTimeTagToAi(sessionId) {
  const o = sessionTimeTagOverride(sessionId);
  if (o !== null) return o;
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "chat-settings.json"), "utf-8"));
    if (cs && cs.cfg && cs.cfg.time_tag_to_ai === false) return false;
  } catch (e) { /* 读不到按默认开 */ }
  return true;
}
// ========================
// 10-29（用户 #49）：[elapsed:45s] 距上一轮时间差标签——发送前动态注入最后一条 user 消息末尾。
// 会话级三态（data/session_cfg/<sid>.json 的 elapsed_tag_to_ai，null=跟随）→ 人设级（11-15：rp 预设组
// 统一关——prompt-backups.json 条目的 elapsed_tag_to_ai，缺省=跟随）→ 全局默认开。
// 优先级：会话显式设置 > 人设设置 > 全局默认；动态注入不落盘：关了直接不加、无需剥离；
// 时间线落盘、压缩、唤醒、快照均不带，只在主聊对话出口出现一次（状态机块不受影响）。
// ========================
function sessionElapsedTagOverride(sessionId) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  try {
    if (fs.existsSync(file)) {
      const o = fs.readJsonSync(file);
      if (o && typeof o.elapsed_tag_to_ai === "boolean") return o.elapsed_tag_to_ai;
    }
  } catch (e) { /* ignore */ }
  return null;
}
function saveSessionElapsedTagOverride(sessionId, val) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  let o = {};
  try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
  if (val !== true && val !== false) delete o.elapsed_tag_to_ai;
  else o.elapsed_tag_to_ai = val;
  fs.ensureDirSync(SESSION_CFG_DIR);
  writeJsonFileAtomic(file, o);
  return o;
}
/* [位置:server.js·personaElapsedTag] [人设级时间差标签开关] [11-15：rp 预设组统一关 [elapsed]——读该会话引用的人设条目的 elapsed_tag_to_ai（false=关/true=开/缺省=跟随）；与 resolveSessionSystemPrompt 同口径每次现读盘上，人设改了下一条消息即生效] [注释时间 2026-11-15] */
function personaElapsedTag(sessionId) {
  try {
    const backupId = sessionPromptBackupId(sessionId);
    if (!backupId) return undefined;
    const pbFile = path.join(__dirname, "data", "prompt-backups.json");
    if (!fs.existsSync(pbFile)) return undefined;
    const arr = JSON.parse(fs.readFileSync(pbFile, "utf-8"));
    const hit = Array.isArray(arr) ? arr.find(function (b) { return b && b.id === backupId; }) : null;
    if (hit && typeof hit.elapsed_tag_to_ai === "boolean") return hit.elapsed_tag_to_ai;
  } catch (e) { /* 读不到按未设置 */ }
  return undefined;
}
function resolveElapsedTagToAi(sessionId) {
  const o = sessionElapsedTagOverride(sessionId);
  if (o !== null) return o;              /* 会话里显式设过的以会话为准 */
  const p = personaElapsedTag(sessionId); /* 11-15：没设过再看人设（rp 预设组统一关），人设也没说才走全局默认开 */
  if (p !== undefined) return p;
  return true;
}
const _TIME_TAG_RE = /\n?<current_time>[\s\S]*?<\/current_time>/gi;
function stripTimeTagText(t) {
  return String(t || "").replace(_TIME_TAG_RE, "").replace(/\s+$/, "");
}
// 就地剥离 messages 里 user 消息正文的 <current_time>（string / multimodal parts 两种形态）。
// 剥后正文变空的消息保留原样（防纯时间戳消息被剥成空正文发上游）。
function stripTimeTagsFromMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  for (const m of messages) {
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") {
      if (m.content.indexOf("current_time") === -1) continue;
      const s = stripTimeTagText(m.content);
      if (s.trim()) m.content = s;
    } else if (Array.isArray(m.content)) {
      m.content = m.content.map(function (p) {
        if (p && p.type === "text" && typeof p.text === "string" && p.text.indexOf("current_time") !== -1) {
          const s = stripTimeTagText(p.text);
          if (s.trim()) return Object.assign({}, p, { text: s });
        }
        return p;
      });
    }
  }
  return messages;
}
/* [位置:server.js·stripTraceFromMessages] [发给模型前就地剥离 assistant 消息里的 <trace>] [11-21：trace 剥离开关开启时，发给 AI 的上下文剥掉 <trace>…</trace>（时间线落盘与前端显示不受影响）；剥后变空的消息保留原样避免发出空 assistant 消息] [注释时间 2026-11-21] */
function stripTraceFromMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  for (const m of messages) {
    if (!m || m.role !== "assistant") continue;
    if (typeof m.content === "string") {
      if (m.content.toLowerCase().indexOf("<trace") === -1) continue;
      const s = traceLib.stripTrace(m.content).text;
      if (s && s.trim()) m.content = s;
    } else if (Array.isArray(m.content)) {
      m.content = m.content.map(function (p) {
        if (p && p.type === "text" && typeof p.text === "string" && p.text.toLowerCase().indexOf("<trace") !== -1) {
          const s = traceLib.stripTrace(p.text).text;
          if (s && s.trim()) return Object.assign({}, p, { text: s });
        }
        return p;
      });
    }
  }
  return messages;
}
function sessionModelNameOverride(sessionId) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  try {
    if (fs.existsSync(file)) {
      const o = fs.readJsonSync(file);
      if (o && typeof o.model_name === "string" && o.model_name) return o.model_name;
    }
  } catch (e) { /* ignore */ }
  return null;
}
function saveSessionModelNameOverride(sessionId, modelName) {
  const token = safeSessionToken(sessionId || "default");
  const file = path.join(SESSION_CFG_DIR, token + ".json");
  let o = {};
  try { if (fs.existsSync(file)) o = fs.readJsonSync(file) || {}; } catch (e) { o = {}; }
  if (modelName === null || modelName === undefined || modelName === "") delete o.model_name;
  else o.model_name = String(modelName);
  fs.ensureDirSync(SESSION_CFG_DIR);
  fs.writeJsonSync(file, o);
  return o;
}
// ========================
// 跨窗口注入参数（2026-09-28：V1 memory_pool_config.json 归档后独立存储 data/cross_inject_config.json；
// V2 Earlier Days 篇数（context-v2-shadow）与回退路径/预览同源，管理台配置页可调）
// ========================
const CROSS_INJECT_CONFIG_FILE = path.join(__dirname, "data", "cross_inject_config.json");
function readCrossInjectConfig() {
  const base = { cross_inject_enabled: true, cross_inject_memory: true, cross_inject_diary: true, cross_inject_diary_count: 3 };
  try {
    const o = fs.readJsonSync(CROSS_INJECT_CONFIG_FILE) || {};
    if (o.cross_inject_diary_count != null) base.cross_inject_diary_count = Math.max(1, Number(o.cross_inject_diary_count) || 3);
    return base;
  } catch (e) { return base; }
}
function saveCrossInjectConfig(patch) {
  const cur = readCrossInjectConfig();
  if (patch && patch.cross_inject_diary_count != null) cur.cross_inject_diary_count = Math.max(1, Number(patch.cross_inject_diary_count) || 3);
  fs.ensureDirSync(path.dirname(CROSS_INJECT_CONFIG_FILE));
  writeJsonFileAtomic(CROSS_INJECT_CONFIG_FILE, { cross_inject_diary_count: cur.cross_inject_diary_count });
  return cur;
}
// === MCP_TOOL_LOOP_BEGIN ===
// MCP 工具循环入口：如果启用，则用 mcp-tool-loop 处理；返回 true 表示已处理并写完响应。
// messages 为已处理好的 sanitizedMessages（含记忆/时间线/替换/裁剪）
async function handleMcpRequest(body, reply, req, messages, sessionId, kelivoMessages) {
  if (!MCP_ENABLED()) return false;
  const clients = getMcpClients();
  if (!clients || clients.length === 0) return false;
  // 统一模型解析（2026-09-08）：与直通路径同口径，会话级设置 → 全局默认 → env 兜底
  const { provider: prov, model } = resolveChatModel(sessionId, body.model);
  const _ut = require("./lib/upstream-target").resolveTarget(prov, readEnvValue, model);
  const targetApiUrl = _ut.url;
  const targetApiKey = _ut.key;
  const targetExtraHeaders = _ut.headers;
  /* 11-04 补：Claude 加强缓存——工具循环此前丢头（断点全是 5 分钟），与 chat.js 直通路径/wake-chat 同口径按会话开关带 1h；产品确定按会话隔离，子会话也在 subagent-runner 同款处理（2026-11-12 收紧为 isClaudeChat：Gemini 订阅无人读此头） */
  if (_ut.headers && typeof readClaudeCache1h === 'function' && require("./lib/upstream-target").isClaudeChat(prov) && readClaudeCache1h(sessionId)) _ut.headers['x-claude-cache-ttl'] = '1h';
  if (!targetApiUrl || !targetApiKey) return false;
  /* [位置:server.js·handleMcpRequest 思考档位] [工具循环按实际供应商归一思考档位] [11-16：Grok 订阅在工具循环里也要带顶层 reasoning_effort（流式与非流式兜底共用同一个值）；判据用 upstream-target.grokEffortFor，grok-4.x 才发、空=不传；其它供应商沿用 body 里已注入/客户端自带的值，行为不变] [注释时间 2026-11-16] */
  let _reasoningEffort = (body && body.reasoning_effort) || null;
  try {
    const _utg2 = require("./lib/upstream-target");
    if (_utg2.isGrokChat(prov)) {
      _reasoningEffort = _utg2.grokEffortFor(model, (typeof readGrokThinkingEffort === 'function') ? readGrokThinkingEffort(sessionId) : null);
    }
  } catch (e) { /* 归一失败就按原值走，不挡生成 */ }

  // 方案2：工具循环逐轮即时回传。onEvent 把「本轮正文/思考 + 每工具 start/end」实时写成 SSE，
  // 前端据此渲染工具卡与正文交错 + running→done 状态；显式停止也复用同一快照落盘。
  let streamStarted = false;
  // 新一轮先清空旧快照，避免“刚点停止、尚未收到首个 token”时误存上一轮回复。
  if (sessionId) {
    // 1025 补 replyMsgId：此处无条件先建快照，onEvent 的 lazy init（对象已存在非 done）永远走不到，
    // 上一轮只修 lazy init 不生效——生成中退出重进拿 status 的 reply_msg_id 仍为空，前端停不了（根修）
    activeGenMap.set(sessionId, { text: "", reasoning: "", tools: [], ts: Date.now(), startedAt: Date.now(), done: false, persisted: false, phase: "waiting", phaseAt: Date.now(), replyMsgId: (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim()) ? body.reply_msg_id.trim().slice(0, 64) : "" });
  }
  /* [位置:server.js·streamDelta 非流式静默] [非流式请求不写 SSE，但进度照常更新] [2026-11-01：子会话派单是 stream:false，原来 onEvent 只挂给流式请求，非流式时 activeGenMap 的 chars/ts 从头到尾不动，上游其实在正常吐字，看门狗却按「180 秒没数据」把整轮掐掉，时间线一个字不落 -> 前端零响应；手动「继续」是流式请求，所以正常。现在 onEvent 恒挂（_ag 有进度、状态页/抽屉可见、被掐也能存半截），SSE 只在流式时写] [注释时间 2026-11-01] */
  const streamDelta = (deltaObj) => {
    if (body.stream !== true) return;   // 非流式（子会话后台派单）不写 SSE
    if (!streamStarted) {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      try { reply.raw.flushHeaders(); } catch (e) { /* client/stream cleanup */ }
      streamStarted = true;
    }
    // 1004-04（覆盖原 R7）：客户端断开后不再中断生成循环——改为静默丢弃 SSE 事件，让模型跑完并
    // 照常落盘。原实现抛 client gone → 工具循环中止 → assistant 回复半途丢弃不落盘，用户切后台/关页面
    // 回来刷新就看不到回复。代价是真关页面也会跑完这一轮（用户已确认接受 A 方案）。
    if (reply.raw.destroyed || reply.raw.writableEnded || reply.raw.writableFinished) {
      return;
    }
    try { reply.raw.write("data: " + JSON.stringify({
      id: "chatcmpl-mcp",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: deltaObj, finish_reason: null }]
    }) + "\n\n"); } catch (e) { /* socket 半死写失败：静默丢弃，不中断生成 */ }
  };
  const _finishCancelledMcp = async () => {
    const _ag = activeGenMap.get(sessionId) || { text: "", reasoning: "", tools: [], ts: Date.now(), startedAt: Date.now(), done: false, persisted: false, phase: "waiting", phaseAt: Date.now(), replyMsgId: (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim()) ? body.reply_msg_id.trim().slice(0, 64) : "" };
    const _partial = String(_ag.text || "");
    const _rid = (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim()) ? body.reply_msg_id.trim().slice(0, 64) : null;
    // 2026-10-27 补口（用户实测「终止以后聊天记录也没了」）：正文为空但思考/工具已有内容时也落盘，固定标记占正文——
    // 原先整轮跳过，停止/重启后这轮在时间线里完全消失，看起来像聊天记录丢了。
    const _hasExtras = !!String(_ag.reasoning || "").trim() || (Array.isArray(_ag.tools) && _ag.tools.some(Boolean)) || (Array.isArray(_ag.parts) && _ag.parts.length > 0);
    const _content = _partial.trim() ? _partial : (_hasExtras ? "（回复在此中断，未生成正文——思考与工具步骤已保留）" : "");
    /* [位置:server.js·_finishCancelledMcp 占位符进时间线] [中断占位文案同步写进 parts + running 工具收尾] [占位文案此前只进 content 不进 parts，前端 tlCheck 判不等 → 思考工具全堆开头；同步推进 parts 最后一个 text 节点，还在 running 的工具标 failed 不再空转] [注释时间 2026-10-28] */
    if (!_partial.trim() && _hasExtras && Array.isArray(_ag.parts)) {
      const _hasText = _ag.parts.some(n => n && n.type === "text" && String(n.text || "").trim());
      if (!_hasText) _ag.parts.push({ type: "text", text: _content, ts: Date.now() });
      _ag.parts.forEach(n => { if (n && n.type === "tool" && n.tool && n.tool.status === "running") { n.tool.status = "failed"; if (!n.tool.error) n.tool.error = "回复被中断"; } });
    }
    let _persisted = false;
    try {
      if (_content.trim()) {
        const _timeline = loadTimeline(sessionId);
        const _exists = _timeline.some(m => m && !m.deleted && m.role === "assistant" && (_rid ? m.id === _rid : m.content === _content));
        // 1024-02（2026-10-24）：停止落盘补齐 segments/stream_timeline，与正常完成同口径——
        // 此前只存正文+思考+工具平铺、没存顺序，刷新后小手机退化成「工具全在前」的旧排版，与实时不一致。
        if (!_exists) appendMessages(sessionId, [{ id: _rid || undefined, role: "assistant", content: _content, reasoning: _ag.reasoning || "", tools: _ag.tools || [], tokens: null, segments: String(_content).split(/\n\s*\n/).map(function (s) { return stripToolEchoBlocks(tagParser.stripTags(s)); }).filter(Boolean), stream_timeline: (Array.isArray(_ag.parts) && _ag.parts.length) ? _ag.parts.slice() : undefined }]);
        _persisted = true;
      }
    } catch (_saveErr) {
      console.warn("[mcp] 用户中断后的部分回复落盘失败:", _saveErr.message);
    }
    _ag.done = true;
    _ag.persisted = _persisted;
    _ag.ts = Date.now();
    activeGenMap.set(sessionId, _ag);
    console.warn("[mcp] 用户已停止生成，部分回复已收尾 (session=" + (sessionId || "default") + ", chars=" + _content.length + ", persisted=" + _persisted + ")");
    if (body.stream !== true) {
      try { reply.code(200).send({ choices: [{ message: { role: "assistant", content: _content }, finish_reason: "stop" }] }); } catch (e) { /* client/stream cleanup */ }
      return true;
    }
    if (!streamStarted) {
      try { reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" }); } catch (e) { /* client/stream cleanup */ }
    }
    try {
      if (_content) reply.raw.write("data: " + JSON.stringify({ id: "chatcmpl-mcp", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], final_content: _content, final_stream_timeline: (Array.isArray(_ag.parts) && _ag.parts.length) ? _ag.parts : undefined }) + "\n\n");   // 1024-02：终帧带时间线，前端当场渲染即正确
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    } catch (e) { /* client/stream cleanup */ }
    return true;
  };

  // 1021：失败收尾。此前上游报错会直接 throw 出去交给外层 502，
  // 快照停在 done=false（客户端永远「正在思考」，只能等看门狗或回收者兜）。
  /* [位置:server.js·persistPartialOnFail] [上游中途断流 / 报错时，已经流给她看的正文要存下来] [以前只有「用户点停止」会把已生成的正文落库；失败路径（如上游 terminated）直接抛错，前端已显示的正文刷新后就没了，像整条回复都没发。现在失败也按同口径落盘；2026-10-27 再补：正文空但有思考/工具时也落占位标记，失败不再整轮蒸发（见函数内注释）] [注释时间 2026-10-22 改 2026-10-27] */
  const persistPartialOnFail = (err) => {
    try {
      const _ag = activeGenMap.get(sessionId);
      if (!_ag) return false;
      const _partial = String(_ag.text || "");
      // 2026-10-27 补口：失败路径同停止/重启口径——正文空但有思考/工具时也落占位标记（原担心空 assistant 消息
      // 触发上游 400；占位是非空纯文本，history→messages 只发字符串，不会触发）
      const _hasExtras = !!String(_ag.reasoning || "").trim() || (Array.isArray(_ag.tools) && _ag.tools.some(Boolean)) || (Array.isArray(_ag.parts) && _ag.parts.length > 0);
      if (!_partial.trim() && !_hasExtras) return false;
      const _content = _partial.trim() ? _partial : "（回复在此中断，未生成正文——思考与工具步骤已保留）";
      const _rid = (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim()) ? body.reply_msg_id.trim().slice(0, 64) : null;
      /* 同 _finishCancelledMcp：占位文案进 parts + running 工具收尾 */
      if (!_partial.trim() && _hasExtras && Array.isArray(_ag.parts)) {
        const _hasText = _ag.parts.some(n => n && n.type === "text" && String(n.text || "").trim());
        if (!_hasText) _ag.parts.push({ type: "text", text: _content, ts: Date.now() });
        _ag.parts.forEach(n => { if (n && n.type === "tool" && n.tool && n.tool.status === "running") { n.tool.status = "failed"; if (!n.tool.error) n.tool.error = "回复被中断"; } });
      }
      const _timeline = loadTimeline(sessionId);
      const _exists = _timeline.some(m => m && !m.deleted && m.role === "assistant" && (_rid ? m.id === _rid : m.content === _content));
      // 1024-02（2026-10-24）：失败落盘同停止路径口径，补 segments/stream_timeline（快照里已按到达顺序记 parts）
      if (!_exists) appendMessages(sessionId, [{ id: _rid || undefined, role: "assistant", content: _content, reasoning: _ag.reasoning || "", tools: _ag.tools || [], tokens: null, segments: String(_content).split(/\n\s*\n/).map(function (s) { return stripToolEchoBlocks(tagParser.stripTags(s)); }).filter(Boolean), stream_timeline: (Array.isArray(_ag.parts) && _ag.parts.length) ? _ag.parts.slice() : undefined }]);
      if (_ag) _ag.persisted = true;
      console.warn("[mcp] 工具循环失败，已把已生成的部分正文落库 (session=" + (sessionId || "default") + ", chars=" + _content.length + ", err=" + String((err && err.message) || err || "").slice(0, 80) + ")");
      return true;
    } catch (e) {
      console.warn("[mcp] 失败后的部分回复落盘失败:", e && e.message);
      return false;
    }
  };
  const markGenFailed = (err) => {
    try {
      const _ag = activeGenMap.get(sessionId);
      if (_ag && !_ag.done) { _ag.done = true; _ag.error = String((err && err.message) || err || "unknown").slice(0, 200); _ag.ts = Date.now(); }
    } catch (e) { /* 收尾失败不该盖掉原始错误 */ }
  };
  const onEvent = (evt) => {
    if (!evt) return;
    // 1004-05：实时累积快照（断流续显用）——lazy init，按 sessionId 一份
    let _ag = activeGenMap.get(sessionId);
    // 1025：lazy init 补 replyMsgId——生成中退出重进的前端靠 /v1/chat/status 吐的 reply_msg_id 调 /v1/chat/stop；
    // 此前只有直通路径（routes/chat.js _partialGen）带 id，工具路径快照一直没有，重进后停止必失效（用户 1025：暂停任何时候都要能停）
    if (!_ag || _ag.done) { _ag = { text: "", reasoning: "", tools: [], ts: Date.now(), startedAt: Date.now(), done: false, phase: "waiting", phaseAt: Date.now(), replyMsgId: (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim()) ? body.reply_msg_id.trim().slice(0, 64) : "" }; activeGenMap.set(sessionId, _ag); }
    try {
      if (evt.type === "text") {
        // 逐段正文先剥标签/工具回声再下发，保证用户看不到 <memory> 等标签与模型自抄的工具结果；
        // 存记忆副作用仍由收尾对完整文本做一次（extractAndStore）。
        const clean = stripToolEchoBlocks(tagParser.stripTags(evt.text));
        _ag.text += clean;
        // 1024-02（2026-10-24）：快照加一份按到达顺序的 parts（思考/正文/工具交错），与 streamToolLoop
        // 的 streamTimeline 同构——停止/失败落盘时带上，前端刷新后才能按实时顺序还原（此前只有平铺数组）。
        if (!_ag.parts) _ag.parts = [];
        const _lp = _ag.parts[_ag.parts.length - 1];
        // 2026-11-18：parts 节点带 ts（进入时间线的时刻）——极简主题思考行算耗时用；与 mcp-tool-loop.js 的 streamTimeline 同口径，合并增量不改 ts
        if (_lp && _lp.type === "text") _lp.text += clean; else _ag.parts.push({ type: "text", text: clean, ts: Date.now() });
        _ag.ts = Date.now();
        _ag.phase = "writing"; _ag.phaseAt = _ag.ts;
        for (let i = 0; i < clean.length; i += 24) streamDelta({ content: clean.slice(i, i + 24) });
      } else if (evt.type === "reasoning") {
        const clean = tagParser.stripTags(evt.text);
        _ag.reasoning += clean;
        if (!_ag.parts) _ag.parts = [];
        const _rp = _ag.parts[_ag.parts.length - 1];
        if (_rp && _rp.type === "reasoning") _rp.text += clean; else _ag.parts.push({ type: "reasoning", text: clean, ts: Date.now() });
        _ag.ts = Date.now();   // 1021 续租：思考阶段也算「生产者还活着」，否则深度思考会被当成已死
        if (_ag.phase !== "writing" && _ag.phase !== "tool") { _ag.phase = "reasoning"; }
        _ag.phaseAt = _ag.ts;
        for (let i = 0; i < clean.length; i += 60) streamDelta({ reasoning_content: clean.slice(i, i + 60) });
      } else if (evt.type === "tool_start") {
        const p = { index: evt.index, id: evt.id, name: evt.name, args: evt.args };
        _ag.tools.push({ id: evt.id, name: evt.name, args: evt.args, status: "running" });
        if (!_ag.parts) _ag.parts = [];
        _ag.parts.push({ type: "tool", tool: { index: evt.index, id: evt.id, name: evt.name, args: evt.args || "", status: "running", result: "", error: null }, ts: Date.now() });
        _ag.ts = Date.now();
        _ag.phase = "tool"; _ag.phaseAt = _ag.ts;
        streamDelta({ tool_start: p });
      } else if (evt.type === "tool_args_delta") {
        _ag.ts = Date.now();
        // 参数增量同步进 parts 的工具节点（落盘后详情可见），与 SSE 下发同源
        if (Array.isArray(_ag.parts)) {
          const _dp = _ag.parts.find(function (n) { return n && n.type === "tool" && n.tool && n.tool.id === evt.id; });
          if (_dp) _dp.tool.args = (_dp.tool.args || "") + (evt.delta || "");
        }
        streamDelta({ tool_args_delta: { index: evt.index, id: evt.id, delta: evt.delta || "" } });
      } else if (evt.type === "tool_end") {
        const p = { index: evt.index, id: evt.id, name: evt.name, args: evt.args, result: evt.result, error: evt.error, ok: evt.ok };
        const _ti = _ag.tools.findIndex(function (t) { return t.id === evt.id; });
        if (_ti >= 0) { _ag.tools[_ti].status = evt.error ? "error" : "ok"; _ag.tools[_ti].result = evt.result; }
        if (Array.isArray(_ag.parts)) {
          const _pp = _ag.parts.find(function (n) { return n && n.type === "tool" && n.tool && n.tool.id === evt.id; });
          if (_pp) { _pp.tool.status = evt.error ? "error" : "done"; _pp.tool.result = evt.result || ""; _pp.tool.error = evt.error || null; }
        }
        _ag.ts = Date.now();
        streamDelta({ tool_end: p });
      }
    } catch (e) {
      // streamDelta 把客户端断开作为异常抛出；必须继续上抛给 streamToolLoop.emit，
      // 由其将 clientGone 置位并停止后续工具/上游请求。
      throw e;
    }
  };

  /* [位置:server.js·上游空闲看门狗] [上游一段时间没有任何数据就主动断开，已写的正文落库] [10-23：glm 在「写完正文要调工具」这一步会卡住，网关傻等到 undici 的 5 分钟才断，前端干等还丢了消息；现在 60 秒（环境变量 GEN_IDLE_ABORT_MS，0=关）没有任何数据就中断：正文、思考、工具参数、工具结果任何一种都算有数据；等首字阶段放宽到 180 秒，有工具在跑放宽到 300 秒（工具自己有超时）；中断后走和 terminated 一样的失败收尾（落已写的正文、标 failed），前端提示重试] [注释时间 2026-10-23] */
  let _idleAborted = false;
  const _idleLimit = (process.env.GEN_IDLE_ABORT_MS !== undefined && process.env.GEN_IDLE_ABORT_MS !== "" && Number.isFinite(Number(process.env.GEN_IDLE_ABORT_MS))) ? Number(process.env.GEN_IDLE_ABORT_MS) : 60000;
  if (_idleLimit > 0 && sessionId && req && req.chatAbortController) {
    const _idleT = setInterval(() => {
      try {
        const g = activeGenMap.get(sessionId), ac = req.chatAbortController;
        if (!g || g.done || ac.signal.aborted) { clearInterval(_idleT); return; }
        const idle = Date.now() - (g.ts || 0);
        const running = (g.tools || []).some(t => t && t.status === "running");
        /* [位置:server.js·上游空闲看门狗 子会话放宽] [子会话首字/工具阶段放宽到 10 分钟] [2026-11-01：子会话是异步任务，派单时主会话/唤醒常在同一账号上生成，上游首字被排队 3 分钟以上就撞 180 秒阈值被掐断，failover 再从零等一轮 -> 时间线只有 user 没有 assistant，前端看着就是零响应；子会话没人盯着界面，放宽到 10 分钟（30 分钟绝对超时仍在）] [注释时间 2026-11-01] */
        const _subGen = /^s_sub_/.test(String(sessionId || ""));
        const lim = _subGen ? Math.max(_idleLimit, 600000) : (g.phase === "waiting" ? Math.max(_idleLimit, 180000) : (running ? Math.max(_idleLimit, 300000) : _idleLimit));
        if (idle >= lim) {
          _idleAborted = true;
          console.warn("[gen-idle] 上游 " + Math.round(idle / 1000) + " 秒没有任何数据，主动中断 session=" + sessionId + " phase=" + g.phase + " chars=" + String(g.text || "").length + " tools=" + (g.tools || []).length);
          clearInterval(_idleT);
          ac.abort();
        }
      } catch (e) { /* 看门狗自己出错不影响生成 */ }
    }, 5000);
    _idleT.unref();
  }
  const _idleErr = () => new Error("上游 " + Math.round(_idleLimit / 1000) + " 秒没有任何数据，已中断（已写出的部分已保存）");
  const _subUpstreamTimeoutMs = /^s_sub_/.test(String(sessionId || "")) ? 600000 : undefined;   // 子会话派单等首字放宽（2026-11-01）
  let r;
    // 2026-09-09 工具路径改流式：优先走 streamToolLoop（全程 stream:true，正文/思考链实时回传，
    // 工具就地执行并继续流式），避免「检测到工具就整轮非流式等待」导致的慢。失败则回退 runWithTools（非流式兜底）。
    try {
      r = await mcp.streamToolLoop({
        upstreamUrl: targetApiUrl,
        upstreamKey: targetApiKey,
        upstreamHeaders: targetExtraHeaders,
        model,
        messages: messages || body.messages || [],
        serverClients: clients,
        temperature: body.temperature,
        top_p: body.top_p,
        max_tokens: body.max_tokens,
        reasoningEffort: _reasoningEffort,
        pullInjected: function () { return sendQueue.take(sessionId); },   // 11-04 发送排队：每轮请求前取走中途排队的消息
        hasInjected: function () { return sendQueue.status(sessionId).pending.length > 0; },
        onEvent,
        sessionId,
        upstreamTimeoutMs: _subUpstreamTimeoutMs,
        onDiaryWritten: onDiaryToolWritten,
        // 1007 上下文快照 v2：工具冻死
        // 1007-17 修复：此处原写裸 baseDir，全文件无该变量 → ReferenceError，
        // 导致流式工具循环必失败、回退非流式后又必失败（工具功能整体失效）。
        snapshotV2: Object.assign(require("./context/context-snapshot-v2"), { baseDir: __dirname }),
        baseDir: __dirname,
        /* [位置:server.js·handleMcpRequest streamToolLoop] [主聊天不限工具轮数] [2026-10-28：「主聊天50轮限制去掉」，原默认 50（DEFAULT_MAX_TOOL_ROUNDS）；Infinity 下循环只靠「模型不再要工具/用户停止/客户端断开」退出，轮次截断提醒恒不可达；兜底仍是 gen-idle 看门狗 + 每轮 180s 超时 + 停止按钮] [注释时间 2026-10-28] */
        maxToolRounds: toolMaxRounds(),
        signal: req && req.chatAbortController ? req.chatAbortController.signal : null
      });
    } catch (toolLoopErr) {
      // 显式停止：保存已生成的快照，再结束本轮；绝不降级重跑一遍模型。
      if (_idleAborted) { const _ie = _idleErr(); persistPartialOnFail(_ie); markGenFailed(_ie); throw _ie; }
      if (req && req.chatAbortController && req.chatAbortController.signal.aborted) {
        return await _finishCancelledMcp();
      }
      // 一旦已经向客户端发出 SSE，就不能再从头跑一遍 runWithTools：
      // 否则客户端会收到两套事件，正文/工具卡可能重复或顺序损坏。
      if (streamStarted) { persistPartialOnFail(toolLoopErr); markGenFailed(toolLoopErr); throw toolLoopErr; }
      /* [位置:server.js·限流不回退] 10-24：429（对面限流）/ 401 / 403 再发一次非流式只会叠加限流或同样被拒，直接按失败收尾；超时、断流这类才回退重试 */
      if (/HTTP (429|401|403)\b/.test(String((toolLoopErr && toolLoopErr.message) || ""))) { persistPartialOnFail(toolLoopErr); markGenFailed(toolLoopErr); throw toolLoopErr; }
      console.warn("[mcp] 流式工具循环失败，回退 runWithTools (非流式):", toolLoopErr.message);
      try {
        r = await mcp.runWithTools({
        upstreamUrl: targetApiUrl,
        upstreamKey: targetApiKey,
        // 2026-10-22：非流式兜底漏传上游附加头（x-internal-key / x-provider-id）——走本机 Anthropic 代理的供应商，
        // 流式失败回退到这里就必 401「Invalid internal key」，把真实错误盖掉。与上面 streamToolLoop 保持一致。
        upstreamHeaders: targetExtraHeaders,
        model,
        messages: messages || body.messages || [],
        serverClients: clients,
        reasoningEffort: _reasoningEffort,
        onEvent,
        sessionId,
        onDiaryWritten: onDiaryToolWritten,
        // 1007 上下文快照 v2：工具冻死
        // 1007-17 修复：同上，原裸 baseDir 未定义
        snapshotV2: Object.assign(require("./context/context-snapshot-v2"), { baseDir: __dirname }),
        baseDir: __dirname,
        maxToolRounds: toolMaxRounds(),   // 1028-01：非流式兜底与上方 streamToolLoop 同口径（主聊天不限轮，产品确定）；2026-10-29 起走 TOOL_MAX_ROUNDS 可配置，默认仍 Infinity
        upstreamTimeoutMs: _subUpstreamTimeoutMs,
        signal: req && req.chatAbortController ? req.chatAbortController.signal : null
      });
      } catch (fallbackErr) {
        if (_idleAborted) { const _ie = _idleErr(); persistPartialOnFail(_ie); markGenFailed(_ie); throw _ie; }
        if (req && req.chatAbortController && req.chatAbortController.signal.aborted) return await _finishCancelledMcp();
        persistPartialOnFail(fallbackErr);
        markGenFailed(fallbackErr);
        throw fallbackErr;
      }
    }

  // 1004-05 兜底：不管本轮有没有正文，生成结束就把快照标 done（空回复/异常也别让前端一直轮询）。
  // 有正文时上面落盘块会用最终 r.text 覆盖；这里先按已累积的 text 收尾。
  const _agFinal = activeGenMap.get(sessionId);
  if (_agFinal && !_agFinal.done) { _agFinal.done = true; _agFinal.ts = Date.now(); }
  // 工具循环跑完后，把「完整消息序列」捕获进 lastLLMMessages，
  // 让「当前请求上下文」如实展示带 tool_calls / tool 结果的真实链路（而非基础上下文）。
  try {
    const finalMsgs = r && r.finalMessages;
    if (Array.isArray(finalMsgs) && finalMsgs.length) {
      setLastLLMCapture(finalMsgs.map(m => {
        const cap = splitMultimodalContent(m.content);
        return {
          role: m.role,
          content: cap.content,
          images: cap.images && cap.images.length ? cap.images : undefined,
          attachments: cap.attachments || undefined,
          tool_calls: m.tool_calls || undefined,
          tool_call_id: m.tool_call_id || undefined,
          /* 10-29 #46：存档保留思考链（reasoning_content / Claude 思考块原样回传）——上游计 token，统计页并入「最近对话」 */
          reasoning_content: m.reasoning_content || undefined,
          thinking_blocks: (Array.isArray(m.thinking_blocks) && m.thinking_blocks.length) ? m.thinking_blocks : undefined,
          anthropic_content_blocks: (Array.isArray(m.anthropic_content_blocks) && m.anthropic_content_blocks.length) ? m.anthropic_content_blocks : undefined
        };
      }), new Date().toISOString(), sessionId, r && r.tools);
    }
  } catch (capErr) {
    console.warn("[mcp] 捕获最终上下文失败:", capErr.message);
  }

  // 提取 <memory>/<pin>/<wake>/<quiet> 标签：存记忆池并剥离，避免标签显示给用户
  let aiClean = (r && r.text) || "";
  const _tagNotes = [];   // 2026-10-28 第6项：新写法标签没写成的说明，回复落盘后追加 developer 消息
  if (aiClean) {
    // 对话侧 <wake>/<quiet> 调度必须用剥离前的原始文本解析；此前 MCP 分支只剥标签不落调度，
    // 对话内闹钟/免打扰静默失效（2026-09-11 修复），与非 MCP 路径（routes/chat.js）同口径。
    try {
      parseWakeTagAndSchedule(aiClean, sessionId);
    } catch (e) {
      console.warn("[mcp] 闹钟调度解析失败:", e.message);
    }
    try {
      const cleaned = await tagParser.extractAndStore(aiClean, { sessionId, notes: _tagNotes });
      if (typeof cleaned === "string" && cleaned) aiClean = cleaned;
    } catch (e) {
      console.warn("[mcp] 标签解析失败:", e.message);
    }
  }
  // 剥离工具回声（权威结果走 toolHistory，避免模型重复抄写/刷屏）
  aiClean = stripToolEchoBlocks(aiClean);

  // 2026-09-24 B3（M1 提级）：最终落盘版数据在函数级构造一次——时间线写回（下方 if 块内）
  // 与 SSE 终止帧（块外，try-catch 包裹）必须共用同一份。此前 storedText/timeline 映射都在
  // if 块内，终止帧直接引用会 ReferenceError 且被终止帧的 try-catch 静默吞掉
  // → 表现为"字段永远不下发、前端静默退回旧行为"，测试还可能假通过。
  // 1004-11：与落盘同口径——落盘 visibleStored 剥日记块，终止帧此前不剥 → 前端本地缓存
  // 含 [DIARY] 与时间线字节不一致（补拉每次校准）。这里统一剥掉。
  const _storedBase = stripToolEchoBlocks((r && r.text) ? r.text : (aiClean || ""));
  /* [位置:server.js·_storedDiary 子会话] [子会话不写日记] [2026-11-01 审查：报告正文若引用 [DIARY] 写法会真写日记文件；子会话不该动日记，只做「剥块」不做「落盘」] [注释时间 2026-11-01] */
  const _storedDiary = (_storedBase && !/^s_sub_/.test(String(sessionId || ""))) ? diaryLib.extractDiaryFromResponse(_storedBase) : { diaryContent: "", remainingText: _storedBase };

  const finalStoredText = _storedDiary.diaryContent ? _storedDiary.remainingText : _storedBase;
  const finalTimelinePayload = (r && Array.isArray(r.streamTimeline))
    ? r.streamTimeline.map(function (n) {
        if (!n || !n.type) return null;
        /* 2026-11-18：透传 ts（节点时刻）——极简主题思考行显示「Thought · 5s」；旧节点无 ts 则 undefined（JSON 序列化自动省略，前端自然降级不显示秒数） */
        if (n.type === "text") return { type: "text", text: String(n.text || ""), ts: n.ts };
        if (n.type === "tool" && n.tool) return { type: "tool", tool: n.tool, ts: n.ts };
        if (n.type === "reasoning") return n.text ? { type: "reasoning", text: String(n.text), ts: n.ts } : null;   // 1021：思考节点（仅显示用，小手机抽屉交替渲染）
        return null;
      }).filter(Boolean)
    : undefined;   // runWithTools 回退无 streamTimeline → 不下发，前端退回自己的映射

  // 修复：MCP 分支此前拦截了主流程的"AI 回复写回时间线"，导致刷新后回复丢失。
  // 这里把最终回复也写回当前会话的时间线。
  if (r && r.text) {
    try {
      // 1004-05：标记快照完成，前端补拉拿到最终内容
      const _agDone = activeGenMap.get(sessionId);
      if (_agDone) { _agDone.text = r.text; _agDone.reasoning = r.reasoning || _agDone.reasoning; _agDone.done = true; _agDone.persisted = true; _agDone.ts = Date.now(); }
      // 1004-06：服务端主动推送——iOS 后台会冻结前端 JS，前端 notify fetch 发不出去。
      // 落盘时检查该会话有无在线 SSE 订阅：无订阅=用户不在看这个会话（切后台/关页面）→ 直接发推送。
      try {
        const _subs = sseSubscribers.get(sessionId);
        const _watching = isClientWatching(sessionId);
        console.log("[push] reply-done 判定 session=" + sessionId + " watching=" + _watching + " subs=" + ((_subs && _subs.size) || 0));
        /* [位置:server.js·reply-done 推送] [回复完成推送默认关闭] [10-23：正在聊天页里聊，回复完成后仍收到系统通知（服务端只看 SSE 订阅判断在不在看，小手机页面不一定挂订阅，判不准）；先关掉，.env 设 REPLY_DONE_PUSH=1 才恢复；判断方案见需求文档] [注释时间 2026-10-23] */
        if (!_watching && readEnvValue("REPLY_DONE_PUSH") === "1" && !/^s_sub_/.test(String(sessionId || ""))) {   // 2026-10-27：子会话回复不推送（第 12 项）
          const _pushBody = String(r.text || "").replace(/<[^>]+>/g, "").replace(/[#*`>\n]/g, " ").trim().slice(0, 200);
          if (_pushBody) sendPushNotification({ title: "", body: _pushBody, sessionId, channel: "webpush" }).then(function (pr) { console.log("[push] 结果 " + JSON.stringify(pr)); }).catch(function (e) { console.error('[server.js:2541] push failed:', e.message || e); });
        }
      } catch (e) { console.error('[server.js:2547]', e.message || e); }
      // 方案二增量：以盘上为基同步请求差量（人设同步/去重补齐/重生成尾部对齐），
      // 不再拿请求消息数组全量重建覆盖——前端只带局部历史（分页/懒加载）也不会丢服务器完整历史。
      const reqMsgs = Array.isArray(kelivoMessages) && kelivoMessages.length
        ? kelivoMessages
        : (messages || body.messages || []);
      // 2026-09-23：透传重生成锚点 id（前端点「重新生成」时上报），服务端据此按 id 截断
      // 该 user 消息之后的全部时间线内容，替代原先「按内容尾部对齐」在中间重生成时清不干净的问题
      const syncRes = appendRequestMessages(sessionId, reqMsgs, { regenAnchorId: body.regen_anchor_id });
      /* 11-04 发送排队：本轮中途被取走的排队消息，落在用户本轮消息之后、AI 回复之前（id 沿用前端给的，下一次请求带上它不会重复） */
      try {
        const _inj = sendQueue.drainTaken(sessionId);
        if (_inj.length) appendMessages(sessionId, _inj.map(function (x) { return { id: x.id, role: "user", content: x.text, time: x.time }; }));
      } catch (e) { console.warn("[send-queue] 排队消息落盘失败:", e.message); }
      // 稳定 id 沿用（2026-09-22）：自建前端预生成 reply_msg_id 随请求上行，落盘沿用同一 id——
      // 回复落库前后端 id 一致，落库后、SSE 补拉前的编辑/删除也能被 /v1/timeline/sync 的 diff 分支按 id 定点命中。
      // 冲突兜底：盘上已存在同 id 则弃用客户端 id（appendMessages 回退服务端 uuid），防时间线出现重复 id。
      let replyMsgId = (typeof body.reply_msg_id === "string" && body.reply_msg_id.trim())
        ? body.reply_msg_id.trim().slice(0, 64) : null;
      if (replyMsgId && loadTimeline(sessionId).some(function (m) { return m && m.id === replyMsgId; })) replyMsgId = null;
      // 工具结果已经由 assistant.tools 结构化保存，不再额外写入旧式「【工具调用记录】」assistant 消息。
      const toAppend = [];
      // 富字段一并落时间线：reasoning/tools/tokens，跨设备刷新不再丢（前端 /v1/history 读取这些字段）。
      // 盘尾已有同内容回复（重试/重复写回）则跳过，不重复追写。
      // 存储用原始文本但去工具回声：保留 <wake>/<memory> 等标签作为上下文一部分；下发/回放仍用 aiClean。
      // 2026-09-24 B3：storedText/timeline 映射提级为函数级 finalStoredText/finalTimelinePayload（与终止帧共用）
      const storedText = finalStoredText;
      // 1005 修复：此前 finalStoredText 已剥过一次 DIARY，这里又对剥过的文本再提取一次 → 永远为空。
      // 改为直接复用首次提取的 _storedDiary。
      const _diaryResult = _storedDiary;
      const visibleStored = storedText;
      if (!tailHasReply(sessionId, visibleStored)) {
        if (_diaryResult.diaryContent) {
          const _diarySaved = diaryLib.appendDiaryEntry(_diaryResult.diaryContent, sessionId);
          toAppend.push({ role: "assistant", content: diaryLib.wrapDiaryTag(_diaryResult.diaryContent), kind: "diary", diary_id: (_diarySaved && _diarySaved.id) || undefined });
        }
        toAppend.push({
          id: replyMsgId || undefined,
          // 1005 改：后端流水账落原始完整文本（r.text 含[DIARY]标签），不剥；下发前端时剥。
          role: "assistant", content: (r && r.text) ? r.text : aiClean, reasoning: r.reasoning || "", tools: r.toolHistory || [], tokens: r.usage || null,
          segments: (r.toolHistory && r.toolHistory.length) ? (r.segments || []).map(function(s){ return stripToolEchoBlocks(tagParser.stripTags(s)); }) : undefined,
          stream_timeline: finalTimelinePayload   // 真实事件时间线：刷新时按 text/tool 原顺序重建（与终止帧下发同一份）
        });
      }
      if (toAppend.length) { appendMessages(sessionId, toAppend); if (_tagNotes.length) appendMessages(sessionId, [{ role: "developer", content: _tagNotes.join("\n") }]); }
      console.log("[mcp] AI 回复已写回时间线 (session=" + (sessionId || "default") + ", chars=" + r.text.length + ", 补齐=" + syncRes.appended + ", 清尾=" + syncRes.removedTail + ", 追加=" + toAppend.length + ", rid=" + (replyMsgId ? replyMsgId.slice(0, 8) : "-") + ")");
    } catch (wr) {
      console.warn("[mcp] 写回时间线失败:", wr.message);
    }
  }

  // 缓存本次已生成的回复，供同 client_msg_id 的重复请求直接回放。
  if (aiClean && body && body.client_msg_id) {
    setRecentReply(String(body.client_msg_id).trim(), {
      text: aiClean, model, reasoning: r.reasoning || "", tools: r.toolHistory || [], usage: r.usage || null, ts: Date.now(),
      // 2026-09-24 B3（M2）：回放时 final 字段的数据源。text 保持 aiClean（剥标签版，回放下行
      // 正文与实时口径一致）；storedText（含标签，与时间线同源）单独存、专供 final_content——
      // 否则回放落盘=剥标签版 ≠ 时间线含标签版 → 补拉照样校准（回放是重试/断线重发的高频场景）。
      storedText: finalStoredText,
      streamTimeline: finalTimelinePayload || null
    });
  }

  // 把最终文本转成 OpenAI 兼容 SSE 流（工具轮次已结束，这里流式回传最终结果）
  if (body.stream === true) {
    if (streamStarted) {
      // 2026-09-13 审查修复：onEvent 逐轮流式回传后补终止 chunk——此前裸 end 无
      // finish_reason/usage/[DONE]，与 buildSSE 收尾口径不一致，依赖终止事件的客户端会卡住、usage 丢失
      try {
        reply.raw.write("data: " + JSON.stringify({
          id: "chatcmpl-mcp",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: (r && r.usage) || null,
          // 2026-09-24 B3：最终落盘版随流下发（与时间线写回共用 finalStoredText/finalTimelinePayload，
          // 见上方 M1 提级注释），自建前端据此落盘、与服务器时间线字节级一致。
          // 顶层字段第三方客户端忽略；空/undefined 时不下发，前端退回自己的映射（向后兼容）。
          ...(finalStoredText ? { final_content: finalStoredText } : {}),
          ...(finalTimelinePayload ? { final_stream_timeline: finalTimelinePayload } : {})
        }) + "\n\n");
        reply.raw.write("data: [DONE]\n\n");
      } catch (e) { /* client/stream cleanup */ }
      try { reply.raw.end(); } catch (e) { /* client/stream cleanup */ }
      return true;
    }   // 方案2：已用 onEvent 逐轮流式回传，避免 buildSSE 重复
    // 2026-09-24 B3：runWithTools 回退出口（未发过 SSE 才会走到）同样下发 final——与上方时间线
    // 写回共用同一份（runWithTools 无 streamTimeline → finalTimelinePayload 为 undefined 不下发）
    const stream = mcp.buildSSE(aiClean, { model, usage: r.usage, reasoning: r.reasoning, toolHistory: r.toolHistory, finalContent: finalStoredText || undefined, finalTimeline: finalTimelinePayload || undefined });
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
      reply.raw.end();
    } catch (e) {
      try { reply.raw.end(); } catch (e) { /* client/stream cleanup */ }
    }
    return true;
  }

  // 非流式：返回 OpenAI JSON
  reply.send({
    id: "chatcmpl-mcp",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: aiClean },
      finish_reason: "stop"
    }],
    usage: r.usage
  });
  return true;
}
// === MCP_TOOL_LOOP_END ===


// ========================
// 内部接口：记录唤醒事件
// ========================
// 2026-09-13 审查修复：唤醒事件幂等去重——HTTP 重试会把同一唤醒事件/回复重复落库
// （appendSpecialEvent 无内容查重，buildTimeline 的视图去重掩盖不了盘上累积）。
// 进程内指纹窗口 10 分钟：同会话+同内容组合的重复请求直接跳过。

// ========================
// 内部：小世界事件落时间线（2026-09-19 批6 D4）
// unified_server.py 在「用户写日记 / 经期开始结束」时回调：往「最新请求的会话」时间线末尾追加一条
// developer(kind=diary) 隐藏消息——前端不显示、模型可见（与 [唤醒] 块同一展示过滤口径）。
// 鉴权：/internal/ 路径统一走 X-Internal-Key（见顶部 onRequest 钩子），不另设账号。
// 最新会话口径 = 项目根 enhanced_messages*.json 中 mtime 最新者（重启不丢，与「最新请求」字面语义一致）。
// ========================
// 小世界事件总开关（2026-10-01 用户拍板：暂时关闭）。
// 开关文件：data/timeline-event.json —— 写 {"enabled":false} 即丢弃全部事件
// （不落时间线、不进模型上下文）；文件缺失或 enabled 不为 false 时保持原行为。
// 每次请求读一次文件判定，改完即时生效，无需重启 gateway。
function timelineEventEnabled() {
  try {
    const p = path.join(__dirname, "data", "timeline-event.json");
    if (!fs.existsSync(p)) return true;
    const j = JSON.parse(fs.readFileSync(p, "utf-8"));
    return (j && j.enabled === false) ? false : true;
  } catch (e) { return true; }
}
// 按谓词移除时间线消息（2026-10-01 通知撤回用）。
// 用 splice 原地删而非 filter：loadTimeline 返回的数组带 __fp（盘上指纹），
// filter 会产出新数组丢掉该属性，可能绕过 saveTimeline 的过期快照守卫；splice 保留数组身份与指纹。
function removeTimelineMessages(sessionId, predicate) {
  const tl = loadTimeline(sessionId);
  if (!Array.isArray(tl)) return 0;
  const hit = [];
  for (let i = tl.length - 1; i >= 0; i--) {
    let ok = false;
    try { ok = !!predicate(tl[i]); } catch (e) { ok = false; }
    if (ok) hit.push(i);
  }
  for (const i of hit) tl.splice(i, 1);
  if (hit.length) saveTimeline(tl, sessionId);
  return hit.length;
}
function latestRequestedSessionId() {
  let best = { mtimeMs: -1, sid: "default" };
  try {
    for (const f of fs.readdirSync(path.join(__dirname, TIMELINE_DIR_NAME))) {
      const m = f.match(/^enhanced_messages(?:[_-]([A-Za-z0-9_-]+))?\.json$/);
      if (!m) continue;
      let mt = 0;
      try { mt = fs.statSync(path.join(__dirname, TIMELINE_DIR_NAME, f)).mtimeMs; } catch (e) { continue; }
      if (mt > best.mtimeMs) best = { mtimeMs: mt, sid: m[1] || "default" };
    }
  } catch (e) { console.error('[server.js:2721]', e.message || e); }
  return best.sid;
}
function fmtEventDateTime(iso) {
  try {
    const p = getDatePartsInTimeZone(new Date(iso), TIME_ZONE);
    return p.month + "-" + p.day + " " + p.hour + ":" + p.minute;
  } catch (e) { return ""; }
}
// 状态机 worker 日志回调（1007-05）：state-worker 进程不直接写 compaction_log
//（避免与 gateway 双进程覆盖，日志唯一写者仍是 gateway），统一走这里更新。
// 鉴权沿用 /internal/ 的 X-Internal-Key（顶部 onRequest 钩子）。
app.post("/internal/state-log", async (req, reply) => {
  const entry = req.body || {};
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return reply.send({ ok: false, error: "bad entry" });
  }
  try {
    const r = addCompactionLog(Object.assign({ action: "state" }, entry));
    return reply.send(r || { ok: true });
  } catch (err) {
    reply.code(500).send({ ok: false, error: (err && err.message) || String(err) });
  }
});

app.post("/internal/timeline-event", async (req, reply) => {
  try {
    const body = req.body || {};
    const type = String(body.type || "").trim();
    // 撤回通知（2026-10-01）：用户删日记后由 unified_server.py 回调。
    // 刻意放在通知开关判定**之前**——开关只管「要不要落新通知」，撤回是清理动作，
    // 即使通知已关闭也要能清掉历史遗留的失效通知。
    if (type === "diary_undo") {
      const undoSid = latestRequestedSessionId();
      const undoEid = (body.entry_id != null && String(body.entry_id) !== "") ? String(body.entry_id) : "";
      const undoT = body.time ? new Date(body.time) : null;
      const undoLabel = (undoT && !isNaN(undoT.getTime())) ? fmtEventDateTime(undoT.toISOString()) : "";
      const refKey = undoEid ? ("han_diary:" + undoEid) : "";
      const removed = removeTimelineMessages(undoSid, function (m) {
        if (!m || m.role !== "developer" || m.kind !== "diary") return false;
        // 新数据带 event_ref → 按 entry_id 精确匹配；老数据无 event_ref → 回退按时间标签匹配
        if (refKey) return m.event_ref === refKey;
        if (undoLabel) return String(m.content || "").indexOf("写了日记（" + undoLabel + "）") !== -1;
        return false;
      });
      console.log("[timeline-event] diary_undo entry_id=" + (undoEid || "-") + " 会话 " + undoSid + " 撤回=" + removed);
      return reply.send({ success: true, session: undoSid, removed: removed });
    }
    if (!timelineEventEnabled()) {
      console.log("[timeline-event] 开关已关闭，丢弃事件 type=" + type);
      return reply.send({ success: false, disabled: true, type: type });
    }
    const parsed = body.time ? new Date(body.time) : new Date();
    const timeIso = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
    const { getUserDisplayName } = require("./lib/display-names");
    const userLabel = getUserDisplayName();
    let content = "";
    let eventRef = "";   // 可回溯标记：删日记时据此精确撤回本条通知
    if (type === "han_diary") {
      content = "[小世界] " + userLabel + "写了日记（" + fmtEventDateTime(timeIso) + "）";
      if (body.entry_id != null && String(body.entry_id) !== "") eventRef = "han_diary:" + String(body.entry_id);
    } else if (type === "period_start") {
      if (!isDate(body.start)) return reply.code(400).send({ error: "start 日期格式应为 YYYY-MM-DD" });
      content = "[小世界] " + userLabel + "记录了经期开始（" + String(body.start).slice(5) + "）";
    } else if (type === "period_end") {
      if (!isDate(body.start) || !isDate(body.end)) return reply.code(400).send({ error: "start/end 日期格式应为 YYYY-MM-DD" });
      const days = Math.round((new Date(body.end) - new Date(body.start)) / 86400000) + 1;
      content = "[小世界] " + userLabel + "记录了经期结束（" + String(body.start).slice(5) + "～" + String(body.end).slice(5) + "，共 " + days + " 天）";
    } else {
      return reply.code(400).send({ error: "未知事件类型：" + type });
    }
    const sid = latestRequestedSessionId();
    const added = appendMessages(sid, [{ role: "developer", kind: "diary", content, time: timeIso, event_ref: eventRef || undefined }], { silent: true });
    console.log("[timeline-event] " + type + " -> 会话 " + sid);
    reply.send({ success: true, session: sid, id: added[0] ? added[0].id : null });
  } catch (err) {
    console.error("[timeline-event] 落时间线失败:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 日记落库唯一格式（2026-09-21 用户拍板）：[DIARY]日记内容[/DIARY]。
// 不管调用方传什么形态（裸正文/自带标签），剥净标签后统一重包裹；剥完为空则返回空串由调用方跳过。
function normalizeDiaryForStore(raw) {
  // 2026-10-22：统一交给 diaryLib.wrapDiaryTag（带「（日期 时间 diary）」时间行；入参已带时间行则沿用）
  return diaryLib.wrapDiaryTag(raw);
}

// wake-event v2 落库实现（2026-09-15 批3收尾抽出）：网关内唤醒调度器（lib/wake-scheduler.js）进程内直调，无 HTTP 入口。
function applyWakeEventV2(body) {
  try {
    const { session_id, speak, diary, diary_id: diaryId, push, event, tools, wake_block_id, reasoning, stream_timeline, tokens } = body || {};
    const evSession = typeof session_id === "string" && session_id.trim() ? String(session_id).trim() : null;
    const speakRaw = String(speak || "").trim();
    const diaryRaw = normalizeDiaryForStore(diary);
    const eventRaw = String(event || "").trim();
    const pushMeta = (push && typeof push === "object") ? push : null;
    const wakeTools = Array.isArray(tools) ? tools.filter(t => t && t.name) : [];
    const appended = [];
    if (diaryRaw) appended.push({ role: "assistant", content: diaryRaw, kind: "diary", diary_id: (diaryId != null) ? diaryId : undefined });
    // 2026-09-24（用户拍板 B 案）：时间线是流水账记录层，AI 所有输出原样入库不可改写（0920 拍板核心）。
    // [NO_ACTION] 开头的静默输出同样原样落 assistant 行、打 kind=noaction——
    // /v1/history 与 sidx 下发层按 kind 过滤（与 kind=diary 同款机制），前端不显示；
    // 服务端上下文重建（buildConversation 读盘上全量）仍能看到，AI 不再"失忆"上次的静默决定。
    // （旧拦截"跳过 [NO_ACTION] 原文"是 0829 加的，0920 拍板时漏撤，导致该类输出实际未入库。）
    if (speakRaw) {
      const msg = { role: "assistant", content: speakRaw };
      /* [位置:server.js·applyWakeEventV2 kind] [noaction 不在开头也打 kind] [2026-11-19：唤醒常先写 <trace> 再写 <noaction>，只认开头时 kind 空，首页活动卡读不到原因。判定在 lib/tag-actions.js·speakIsNoaction（先剥一个 <wake>，代码块里的不算）。正文原样落盘，不改写] [注释时间 2026-11-19] */
      if (require("./lib/tag-actions").speakIsNoaction(speakRaw)) msg.kind = "noaction";
      if (tokens) msg.tokens = tokens;   // 2026-11-01：唤醒 token 用量随回复落盘（抽屉统计行），静默消息与普通消息同待遇
      if (pushMeta) msg.push = pushMeta;
      if (wakeTools.length) msg.tools = wakeTools;
      // 2026-09-24 P3-3：唤醒思考链落盘（聊天链路 MCP 路径同样落 reasoning），前端刷新后可见思考链区块
      const wakeReasoning = typeof reasoning === "string" && reasoning.trim() ? String(reasoning).trim() : "";
      if (wakeReasoning) msg.reasoning = wakeReasoning;
      /* [位置:server.js·applyWakeEventV2 stream_timeline] [唤醒回复带时间线] [10-27：唤醒路径此前不写 stream_timeline，带工具的消息永远退化为思考工具全堆开头；routes/wake-chat.js 把 streamToolLoop 返回的时间线传过来，落盘同主聊天口径] [注释时间 2026-10-28] */
      if (Array.isArray(stream_timeline) && stream_timeline.length) msg.stream_timeline = stream_timeline;
      appended.push(msg);
    }
    // 2026-09-20 恢复判定回写：event=唤醒判定记录（发推/未发/失败，沿用文本格式，推送管理读端直接解析）
    // → developer 系统层消息落时间线，前端不显示（与 [唤醒] 块同层）
    if (eventRaw) appended.push({ role: "developer", content: eventRaw });
    if (appended.length) appendMessages(evSession, appended);
    // 静默但调过工具：工具记录回填到本次的 developer [唤醒] 块上，不丢工具痕迹。
    // 1008-19 修复：event 判定记录（发送成功/未推送）恒有值，原 !appended.length 判断是死代码，
    // AI 完全无正文输出（speak/diary 均空）但调过工具时工具痕迹会丢——改为按"有无 assistant 输出"判断。
    const hasAssistantOut = appended.some(function (m) { return m && m.role === "assistant"; });
    if (!hasAssistantOut && wakeTools.length && wake_block_id) {
      try { patchMessage(evSession, wake_block_id, { tools: wakeTools }); } catch (e) { console.error('[server.js:2847]', e.message || e); }
    }
    console.log(`[wake-event] v2 落库 (session ${evSession || "default"}, speak=${speakRaw ? 1 : 0}, diary=${diaryRaw ? 1 : 0}, push=${pushMeta ? 1 : 0}, event=${eventRaw ? 1 : 0}, tools=${wakeTools.length})`);
    return { ok: true, v2: true, appended: appended.length };
  } catch (err) {
    console.error("[wake-event] v2 落库失败:", err.message);
    return { ok: false, error: err.message };
  }
}

// ========================
// 读取 .env 值
// ========================
function readEnvValue(key) {
  // 批注 2026-07-30：Railway Variables 是云端部署的权威配置源；
  // 容器内 .env 只作兜底，避免管理页保存出的临时文件覆盖平台变量。
  if (IS_RAILWAY_RUNTIME && process.env[key]) return process.env[key];
  // 启动时已把 .env 读进内存缓存，避免热路径每次读盘；/admin/save 等写路径后已刷新。
  if (Object.prototype.hasOwnProperty.call(cachedEnv, key)) return cachedEnv[key];
  return process.env[key] || "";
}

function readEnvValueOrDefault(key, fallback) {
  const value = readEnvValue(key);
  return value === "" ? fallback : value;
}

// 日记共享模块（2026-09-26）：MCP 工具循环分支的 [DIARY] 提取/落库，与 routes/chat.js、
// lib/wake-scheduler.js 同一实现（lib/diary.js），杜绝三路径口径漂移。
// 依赖 readEnvValue，故在 .env 读取区之后初始化；请求期才被 handleMcpRequest 调用。
const diaryLib = require("./lib/diary")({ baseDir: __dirname, readEnvValue });
// 2026-10-03：日记 JSON 存储（data/diary.json）统一读写模块
const diaryStore = require("./lib/diary-store");

function normalizePositiveInteger(value, key, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1) return String(Math.floor(n));
  return readEnvValueOrDefault(key, fallback);
}

function normalizeHour(value, key, fallback, min, max) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= min && n <= max) return String(Math.floor(n));
  return readEnvValueOrDefault(key, fallback);
}

function normalizeBooleanString(value, key, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return "true";
  if (["false", "0", "no", "off"].includes(raw)) return "false";
  return readEnvValueOrDefault(key, fallback);
}

function normalizePushProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "bark" || raw === "webpush") return raw;
  return readEnvValueOrDefault("PUSH_PROVIDER", "bark");
}

function normalizeWeatherUnits(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "fahrenheit") return "fahrenheit";
  if (raw === "metric" || raw === "celsius") return "metric";
  // 空值或非法值：保留 .env 原配置，避免保存表单时把单位意外重置
  return readEnvValueOrDefault("WEATHER_UNITS", "metric");
}

function readDiaryEntries(limit) {
  // 2026-10-03：日记改存 data/diary.json（lib/diary-store）；返回 id 倒序（最新在前，兼容旧行为）
  const out = diaryStore.listEntries(__dirname).slice().sort((a, b) => b.id - a.id);
  return limit ? out.slice(0, limit) : out;
}

// ========================
// 管理台：修改日记（文件 + 时间线特殊事件同步）
// 编辑日记文件后，把时间线里同日的「醒来写了日记」特殊事件一并更新（旧事件「自动写了日记」同样匹配），
// 保证注入 LLM 上下文的内容与日记文件一致。
// ========================
// ========================
// HTTP Basic Auth
// ========================
// ========================
// 管理台会话（记住登录）
// ========================
const SESSION_MAX_AGE_DAYS = 30;
const SESSION_SECRET_FILE = path.join(__dirname, "data", "session_secret.txt");
let sessionSecret = null;
function getSessionSecret() {
  if (sessionSecret) return sessionSecret;
  try {
    const saved = fs.readFileSync(SESSION_SECRET_FILE, "utf-8").trim();
    if (saved) {
      sessionSecret = saved;
      return saved;
    }
  } catch (e) { console.error('[server.js:2942]', e.message || e); }
  sessionSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(SESSION_SECRET_FILE, sessionSecret, { mode: 0o600 });
  } catch (e) { console.error('[server.js:2946]', e.message || e); }
  return sessionSecret;
}
// 签发管理台会话 token（有效期 30 天，HMAC-SHA256 签名；密钥持久化于 data/session_secret.txt）
function createSessionToken(maxAgeMs) {
  const exp = Date.now() + (maxAgeMs || SESSION_MAX_AGE_DAYS * 24 * 3600 * 1000);
  const payload = `${exp}.${process.env.ADMIN_USER}`;
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}
function validSessionToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expS, user, sig] = parts;
  if (user !== process.env.ADMIN_USER) return false;
  if (!/^\d+$/.test(expS) || Number(expS) < Date.now()) return false;
  const expected = crypto.createHmac("sha256", getSessionSecret()).update(`${expS}.${user}`).digest("hex");
  // 非hex签名会让 Buffer.from(...,"hex") 解析成空/短buffer，timingSafeEqual 直接抛错变 500——先校验字符集，异常一律按 401 拒绝
  if (!/^[0-9a-f]+$/i.test(sig) || sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
}
function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}
function ensureCsrfCookie(req, reply) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session && validSessionToken(cookies.admin_session) && !cookies.admin_csrf) {
    reply.header("Set-Cookie", `admin_csrf=${createCsrfToken()}; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 3600}`);
  }
}
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch (e) {
      out[key] = val;
    }
  }
  return out;
}
function adminBasePath(req) {
  return req.url.startsWith("/heartbeat/admin") ? "/heartbeat/admin" : "/admin";
}
let _warnedNoAdminCred = false;
function isAuthorized(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session && validSessionToken(cookies.admin_session)) return true;
  const auth = req.headers.authorization || "";
  const spIdx = auth.indexOf(" ");
  const scheme = spIdx >= 0 ? auth.slice(0, spIdx) : auth;
  const encoded = spIdx >= 0 ? auth.slice(spIdx + 1) : "";
  // 2026-09-22 审查 M6：scheme 按 HTTP 规范大小写不敏感（原 `!== "Basic"` 会拒掉 "basic"/"BASIC"，
  // 某些客户端/代理会改大小写）；同时改用 indexOf+slice 取凭据，不再依赖 split 的段数。
  if (scheme.toLowerCase() !== "basic" || !encoded) return false;
  const decoded = Buffer.from(encoded, "base64").toString();
  const colonIndex = decoded.indexOf(":");
  const user = decoded.substring(0, colonIndex);
  const password = decoded.substring(colonIndex + 1);
  // 2026-09-21 审查 H7：改恒定时间比较，与 validSessionToken 同标准；长度不等先拒（长度本身不构成秘密）
  const expUser = String(process.env.ADMIN_USER || "");
  const expPass = String(process.env.ADMIN_PASSWORD || "");
  // 2026-09-22 审查 M6：口令未配置时 fail-closed。原实现两者皆空时 `timingSafeEqual("","")` 为真，
  // 于是「空用户名 + 空密码」即可进入管理台（配置残缺的部署存在认证绕过）。
  if (!expUser || !expPass) {
    if (!_warnedNoAdminCred) {
      _warnedNoAdminCred = true;
      console.error("[auth] ADMIN_USER/ADMIN_PASSWORD 未配置，管理台已拒绝全部请求（fail-closed）");
    }
    return false;
  }
  const ok = user.length === expUser.length && password.length === expPass.length
    && crypto.timingSafeEqual(Buffer.from(user), Buffer.from(expUser))
    && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expPass));
  return ok;
}

function basicAuth(req, reply, done) {
  if (isAuthorized(req)) {
    ensureCsrfCookie(req, reply);
    done();
    return;
  }
  // 2026-09-21 审查 H7：带了凭据但错误才计失败（未带凭据的普通访问不计，避免浏览者把自己锁死）
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Basic ") && authHeader.length > 6) {
    loginFail();
  }
  reply.code(401).header("WWW-Authenticate", 'Basic realm="Admin"').send("Unauthorized");
}

function mobileAuth(req, reply, done) {
  if (isAuthorized(req)) {
    ensureCsrfCookie(req, reply);
    done();
    return;
  }
  reply.redirect(adminBasePath(req) + "/mobile/login");
}

// 管理台 CSRF 双提交校验：仅当请求携带有效会话 cookie 时，要求 X-CSRF-Token 与 admin_csrf cookie 一致。
// 使用 Basic 认证的脚本/客户端不受影响；登录接口与 /internal/ 内部工具接口不参与校验。
app.addHook("preHandler", (req, reply, done) => {
  const url = req.url || "";
  const isAdmin = url.startsWith("/admin") || url.startsWith("/heartbeat/admin") || url.startsWith("/v1/");
  if (!isAdmin) return done();
  const method = (req.method || "").toUpperCase();
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(method)) return done();
  if (url.endsWith("/mobile/login")) return done();
  if (url.endsWith("/chat-login")) return done();
  // 聊天页语音接口：已过 mcpManageAuth 鉴权，豁免 CSRF（前端读 cookie 易错）
  if (url.endsWith("/admin/tts") || url.endsWith("/admin/voice-config")) return done();
  const cookies = parseCookies(req.headers.cookie);
  if (!(cookies.admin_session && validSessionToken(cookies.admin_session))) return done();
  const cookieToken = cookies.admin_csrf || "";
  const headerToken = String(req.headers["x-csrf-token"] || "");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    reply.code(403).type("text/plain").send("CSRF token invalid");
    return done();
  }
  return done();
});

const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>管理台登录</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  .card{width:100%;max-width:360px;background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
  h1{font-size:20px;margin-bottom:6px}
  p.sub{font-size:13px;color:#888;margin-bottom:24px}
  label{display:block;font-size:13px;color:#555;margin:14px 0 6px}
  input{width:100%;padding:11px 12px;border:1px solid #dde1e7;border-radius:10px;font-size:15px;outline:none}
  input:focus{border-color:#d8a8b0;box-shadow:0 0 0 3px rgba(216,168,176,0.25)}
  button{width:100%;margin-top:24px;padding:12px;border:none;border-radius:10px;background:#4a6cf7;color:#fff;font-size:16px;cursor:pointer}
  button:active{opacity:.85}
  .err{background:#fdecec;color:#c0392b;font-size:13px;padding:10px 12px;border-radius:8px;margin-top:16px}
  .hint{font-size:12px;color:#aaa;margin-top:14px;text-align:center}
</style>
</head>
<body>
  <form class="card" method="post" action="">
    <h1>管理台</h1>
    <p class="sub">登录后 30 天内免登录</p>
    <label>用户名</label>
    <input type="text" name="user" autocomplete="username" required autofocus>
    <label>密码</label>
    <input type="password" name="password" autocomplete="current-password" required>
    <!--ERROR-->
    <button type="submit">登 录</button>
    <p class="hint">登录状态保留 30 天，仅本机浏览器有效</p>
  </form>
</body>
</html>`;

// ========================
// 管理台登录接口
// ========================
// 批注 2026-09-13（审查 S3）：管理台登录防爆破。经两层反代后所有请求在 Node 侧同源
// （X-Real-IP 被二跳覆盖为 127.0.0.1，见 0913-02 审查 S2），无法按来源 IP 区分，
// 故按「账号」全局锁定：连续 5 次失败锁 15 分钟，成功登录即清零。个人系统单管理员账号，此口径够用。
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
let loginFails = 0;
let loginLockedUntil = 0;
function loginLocked() { return Date.now() < loginLockedUntil; }
function loginFail() {
  loginFails++;
  if (loginFails >= LOGIN_MAX_FAILS) {
    loginLockedUntil = Date.now() + LOGIN_LOCK_MS;
    loginFails = 0;
    console.warn("[login] 连续失败过多，管理台登录锁定 15 分钟");
  }
}
function loginOk() { loginFails = 0; loginLockedUntil = 0; }
function loginRemainingLockMinutes() { return Math.max(1, Math.ceil((loginLockedUntil - Date.now()) / 60000)); }

app.get("/admin/mobile/login", async (req, reply) => {
  reply.type("text/html").send(LOGIN_PAGE_HTML.replace("<!--ERROR-->", ""));
});

app.post("/admin/mobile/login", async (req, reply) => {
  if (loginLocked()) {
    await new Promise(r => setTimeout(r, 500));
    reply.type("text/html").send(LOGIN_PAGE_HTML.replace("<!--ERROR-->", '<div class="err">失败次数过多，已锁定 ' + loginRemainingLockMinutes() + ' 分钟</div>'));
    return;
  }
  const body = req.body || {};
  const ok = String(body.user || "") === process.env.ADMIN_USER
    && String(body.password || "") === process.env.ADMIN_PASSWORD;
  if (ok) {
    loginOk();
    const csrf = createCsrfToken();
    reply.header("Set-Cookie", [
      `admin_session=${createSessionToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 3600}`,
      `admin_csrf=${csrf}; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 3600}`
    ]);
    reply.redirect(adminBasePath(req) + "/mobile");
    return;
  }
  await new Promise(r => setTimeout(r, 500));
  loginFail();
  reply.type("text/html").send(LOGIN_PAGE_HTML.replace("<!--ERROR-->", '<div class="err">用户名或密码错误</div>'));
});

// 聊天前端登录：复用管理台账号密码校验（JSON 接口，供 /chat 页做密码登录用）
app.post("/admin/chat-login", async (req, reply) => {
  if (loginLocked()) {
    return reply.code(429).send({ ok: false, error: "失败次数过多，已锁定 " + loginRemainingLockMinutes() + " 分钟" });
  }
  const body = req.body || {};
  console.log("[chat-login] got user=" + JSON.stringify(String(body.user || "")) + " pwLen=" + String(body.password || "").length + " at=" + new Date().toISOString());
  const ok = String(body.user || "") === process.env.ADMIN_USER
    && String(body.password || "") === process.env.ADMIN_PASSWORD;
  if (ok) {
    loginOk();
    // 让 /chat 页也能走管理台会话：登录成功后下发 admin_session + admin_csrf cookie，
    // chat.html 内置卡片即可直接调 /heartbeat/admin/*（cookie 认证 + CSRF 双提交）。
    const csrf = createCsrfToken();
    reply.header("Set-Cookie", [
      `admin_session=${createSessionToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 3600}`,
      `admin_csrf=${csrf}; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 3600}`
    ]);
    reply.send({ ok: true });
    return;
  }
  await new Promise(r => setTimeout(r, 500));
  loginFail();
  console.log("[chat-login] rejected user=" + JSON.stringify(String(body.user || "") ));
  reply.code(401).send({ ok: false, error: "账号或密码错误" });
});

// [位置:server.js·POST /admin/chat-logout] [聊天页/小手机退出登录] [退出时让服务端把 admin_session / admin_csrf 两个 cookie 立即过期——admin_session 是 HttpOnly，前端 JS 删不掉，只能服务端下发过期 Set-Cookie] [注释时间 2026-10-21]
// 鉴权：不加白名单。它是 POST，走上面的 CSRF 钩子——只有带着有效 admin_session 且 X-CSRF-Token 与 admin_csrf 一致的请求才能退出，防跨站诱导退出。
// 只清当前这台设备的 cookie，不轮换会话密钥（改密才轮换，见 change-password），所以不影响她别的设备。
app.post("/admin/chat-logout", async (req, reply) => {
  const gone = "Path=/; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  reply.header("Set-Cookie", [
    "admin_session=; HttpOnly; " + gone,
    "admin_csrf=; " + gone
  ]);
  reply.send({ ok: true });
});

// [位置:server.js·GET /admin/session-check] [nginx auth_request 探测端点] [2026-11-10 晚：
// 日记/月历等锁内页面从 basic auth 换成挂小手机登录态——iOS/PWA 记不住 basic auth 凭据，
// 用户每次进日记都被弹原生密码框。nginx 锁内请求经 auth_request 转到这里：带有效 admin_session
// cookie → 204 放行；否则 401（不带 WWW-Authenticate，浏览器不会弹原生框：页面请求由 nginx
// 302 到 /login 中转页登录后跳回，锁内 API 由 nginx 回 JSON 401、小手机 phone-net 弹样式
// 登录框并自动重试）。GET 不参与 CSRF 校验（3557 钩子只拦写方法），本路由无 preHandler——
// 它本身就是鉴权探测器，勿加鉴权。]
app.get("/admin/session-check", async (req, reply) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.admin_session && validSessionToken(cookies.admin_session)) {
      return reply.code(204).send();
    }
  } catch (e) { /* cookie 解析异常按未登录处理 */ }
  reply.code(401).send();
});

/* [位置:server.js·GET /internal/shot-session] [给截图工具签发 1 小时短期登录态] [11-12：screenshot 老是截到登录页——无头浏览器没有 admin_session cookie；这里按 x-internal-key（顶部 /internal/ 钩子）签发，worker 只给本站域名注入，不用让 MCP 去读 session_secret] [注释时间 2026-11-12] */
app.get("/internal/shot-session", async (req, reply) => {
  const ttl = 3600 * 1000;
  const hosts = ["127.0.0.1", "localhost"];
  try { const h = new URL(readEnvValue("PUBLIC_BASE_URL") || "").hostname; if (h) hosts.push(h); } catch (e) { /* 没配就只放本机 */ }
  reply.send({ ok: true, hosts, session: createSessionToken(ttl), csrf: createCsrfToken(), expires_in: ttl / 1000 });
});

// 修改登录密码（管理台/聊天页共用）：校验旧密码，写回 .env 并热更新 process.env
app.post("/admin/change-password", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const oldPw = String(body.old_password || "");
    const newPw = String(body.new_password || "").trim();
    if (oldPw !== (process.env.ADMIN_PASSWORD || "")) {
      return reply.code(400).send({ ok: false, error: "旧密码不正确" });
    }
    if (!newPw) return reply.code(400).send({ ok: false, error: "新密码不能为空" });
    if (newPw.length < 4) return reply.code(400).send({ ok: false, error: "新密码至少 4 位" });
    await writeEnvUpdates({ ADMIN_PASSWORD: newPw });
    process.env.ADMIN_PASSWORD = newPw;   // 热生效：basicAuth/chat-login 直接读取该值
    // 批注 2026-09-13（审查 S5）：改密成功即轮换会话密钥——所有已签发的 admin_session
    // （HMAC 用旧密钥）立即失效，包括可能已泄漏的 token；所有设备需重新登录（预期行为）。
    sessionSecret = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(SESSION_SECRET_FILE, sessionSecret, { mode: 0o600 });
    } catch (e) {
      console.error("[change-password] 轮换会话密钥失败:", e.message);
    }
    console.log("[change-password] 登录密码已更新，会话密钥已轮换（所有登录态失效）");
    reply.send({ ok: true });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// ========================
// 管理页面 GET /admin
// ========================
// 管理台入口：桌面版已移除，统一跳转到移动端管理台
app.get("/admin", { preHandler: mobileAuth }, async (req, reply) => {
  reply.redirect(adminBasePath(req) + "/mobile");
});

app.post("/admin/save", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const {
      target_url,
      target_key,
      gateway_api_key,
      model_name,
      bark_key,
      custom_icon,
      day_wake_after,
      night_wake_after,
      day_check_interval,
      night_check_interval,
      wake_day_start_hour,
      wake_day_end_hour,
      weather_enabled,
      weather_location_name,
      weather_lat,
      weather_lon,
      weather_units,
      all_public_api,
      push_provider,
      user_display_name,
      ai_display_name,
      diary_enabled
    } = req.body || {};

    if (!target_url || !model_name) {
      return reply.code(400).send({ error: "target_url / model_name 必填" });
    }

    const finalTargetKey = target_key || readEnvValue("TARGET_API_KEY");
    const finalGatewayKey = gateway_api_key || readEnvValue("GATEWAY_API_KEY");
    const finalBarkKey = bark_key || readEnvValue("BARK_KEY");

    // 批注 2026-06-26：公开版把唤醒策略和天气信息开放到管理页；保存时做轻量校验，避免空值把运行中的唤醒节奏写坏。
    // 批注 2026-07-15：GATEWAY_API_KEY 是公开 /v1 的客户端鉴权 key，不能和上游 TARGET_API_KEY 混在一起展示或返回。
    await writeEnvUpdates({
      TARGET_API_URL: target_url,
      TARGET_API_KEY: finalTargetKey,
      GATEWAY_API_KEY: finalGatewayKey,
      MODEL_NAME: model_name,
      BARK_KEY: finalBarkKey,
      CUSTOM_ICON_URL: custom_icon ?? readEnvValue("CUSTOM_ICON_URL"),
      DAY_WAKE_AFTER_MINUTES: normalizePositiveInteger(day_wake_after, "DAY_WAKE_AFTER_MINUTES", "60"),
      NIGHT_WAKE_AFTER_MINUTES: normalizePositiveInteger(night_wake_after, "NIGHT_WAKE_AFTER_MINUTES", "180"),
      DAY_CHECK_INTERVAL_MINUTES: normalizePositiveInteger(day_check_interval, "DAY_CHECK_INTERVAL_MINUTES", "60"),
      NIGHT_CHECK_INTERVAL_MINUTES: normalizePositiveInteger(night_check_interval, "NIGHT_CHECK_INTERVAL_MINUTES", "180"),
      WAKE_DAY_START_HOUR: normalizeHour(wake_day_start_hour, "WAKE_DAY_START_HOUR", "10", 0, 23),
      WAKE_DAY_END_HOUR: normalizeHour(wake_day_end_hour, "WAKE_DAY_END_HOUR", "24", 1, 24),
      WEATHER_ENABLED: normalizeBooleanString(weather_enabled, "WEATHER_ENABLED", "false"),
      WEATHER_LOCATION_NAME: weather_location_name ?? readEnvValue("WEATHER_LOCATION_NAME"),
      WEATHER_LAT: weather_lat ?? readEnvValue("WEATHER_LAT"),
      WEATHER_LON: weather_lon ?? readEnvValue("WEATHER_LON"),
      WEATHER_UNITS: normalizeWeatherUnits(weather_units),
      ALLOW_PUBLIC_API: normalizeBooleanString(all_public_api, "ALLOW_PUBLIC_API", "false"),
      PUSH_PROVIDER: normalizePushProvider(push_provider),
      USER_DISPLAY_NAME: user_display_name ?? readEnvValue("USER_DISPLAY_NAME"),
      AI_DISPLAY_NAME: ai_display_name ?? readEnvValue("AI_DISPLAY_NAME"),
      DIARY_ENABLED: normalizeBooleanString(diary_enabled, "DIARY_ENABLED", "true"),
      ADMIN_USER: readEnvValue("ADMIN_USER"),
      ADMIN_PASSWORD: readEnvValue("ADMIN_PASSWORD")
    });
    console.log("\n✅ .env 已更新（热生效，无需重启）\n");

    if (wantsJsonResponse(req)) {
      return reply.send({ success: true });
    }

    reply.type("text/html").send(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>已保存</title></head>
<body style="text-align:center;font-family:-apple-system,sans-serif;padding:40px;">
  <h2>✅ 配置已保存</h2>
  <p>现在可以返回管理页，点击重启按钮让新配置生效。</p>
  <a href="/admin">← 返回设置</a>
</body></html>`);
  } catch (err) {
    console.error(err);
    reply.code(500).send({ error: err.message });
  }
});

// ========================
// 网易云管理接口（2026-11-03 server.js 拆分批 3：整段原 3823-3942 行已拆到 routes/netease-admin.js，逻辑未改）
// ========================
require("./routes/netease-admin")(app, { basicAuth, readNetEaseEnv, readNeteaseSession, writeNeteaseSession, fetchNeteaseAccount, NETEASE_SESSION_FILE, TIME_ZONE, formatDateTimeInTimeZone });

// ========================
// 管理页一键重启
// ========================
app.post("/admin/restart", { preHandler: basicAuth }, async (req, reply) => {
  const restartCommand = readRestartCommand();

  // 立即回复，避免重启时连接中断
  reply.send({ success: true, output: `重启指令已发送：${restartCommand}` });
  
  // 稍后重启。默认只重启本项目的两个进程；可通过 RESTART_COMMAND 自定义。
  // 安全校验：允许白名单内的重启命令，也允许「cd <指定目录> && <白名单命令>」形式。
  // 管理台重启按钮使用  pm2 restart ...，确保在项目目录下执行，pm2 能可靠找到进程。
  const ALLOWED_RESTART_DIRS = [PROJECT_ROOT];
  const ALLOWED_RESTART_CMDS = ["pm2 restart ", "pm2 reload ", "systemctl restart ", "service restart ", "supervisorctl restart "];
  const trimmedCmd = String(restartCommand || "").trim();
  // 若为「cd <dir> && <cmd>」形式，拆分校验：目录必须在白名单内，且后续命令须为白名单命令
  const cdMatch = trimmedCmd.match(/^cd\s+([^\s&]+)\s*&&\s*(.+)$/);
  if (cdMatch) {
    const dir = cdMatch[1];
    const rest = cdMatch[2].trim();
    if (!ALLOWED_RESTART_DIRS.includes(dir) || !ALLOWED_RESTART_CMDS.some(prefix => rest.startsWith(prefix))) {
      console.error("重启命令不在白名单内，已拒绝:", trimmedCmd);
      return;
    }
  } else if (!ALLOWED_RESTART_CMDS.some(prefix => trimmedCmd.startsWith(prefix))) {
    console.error("重启命令不在白名单内，已拒绝:", trimmedCmd);
    return;
  }
  // 剥掉「cd <dir> && 」前缀后，剩余命令不允许再出现命令拼接/管道/替换符（2>&1 重定向除外）：
  // 否则 "pm2 restart gateway && <任意命令>" 可借前缀白名单绕过校验
  const execPart = (cdMatch ? cdMatch[2] : trimmedCmd).replace(/2>&1/g, "");
  if (/[;&|`]|\$\(/.test(execPart)) {
    console.error("重启命令含拼接/管道等非法片段，已拒绝:", trimmedCmd);
    return;
  }
  // 经 sh -c 执行：支持 cd && 与 2>&1 重定向；白名单已在上方校验，避免任意命令注入。
  const { spawn } = require("child_process");
  const child = spawn("sh", ["-c", trimmedCmd], { cwd: PROJECT_ROOT });
  let out = "", errOut = "";
  child.stdout.on("data", d => out += d);
  child.stderr.on("data", d => errOut += d);
  child.on("close", code => {
    if (code !== 0) console.error("重启失败:", errOut || String(code));
    else console.log("服务已重启:", out);
  });
});

// ========================

// ========================
// 记忆管理 API
// ========================

// 记忆语义检索（MCP 工具调用，AI 主动检索记忆；只读，不触碰冷却/浮现状态）

// ========================
// 心动时刻同步（heart 网页为唯一真源，记忆池只做检索镜像）
// ========================
// 按网页 id (source_moment_id) 增量同步：新增 / 更新 / 复活



/* [位置:server.js·/internal/context-search] [只按日期 / 最近 N 条取原文，不做关键词检索] [11-09：AI 的 context 工具按关键词找原文走 /internal/search（和手机同一套），这个接口现在只剩「time_prefix 按日期定位」「latest 最近 N 条」两种用法；原来的 q / mode / threshold / use_latest_user（没传 q 时拿最新用户消息当检索词）都没有调用方了，连同老检索一起删。单条正文上限默认 500 字，可用 cap= 覆盖。归档、子会话、「不参与检索」组的会话读不到（context-replacements.loadAllSessionTimelines 统一排除）] [注释时间 2026-11-09] */
app.get("/internal/context-search", async (req, reply) => {
  try {
    const allSessions = req.query.all_sessions === "1" || req.query.all_sessions === "true";
    const limit = Number(req.query.limit) || undefined;
    const timePrefix = req.query.time_prefix !== undefined ? String(req.query.time_prefix) : undefined;
    const latest = req.query.latest !== undefined ? Number(req.query.latest) : 0;
    const contentCap = Number(req.query.cap) || 500;
    const result = await contextReplacements.searchContextEnhanced("", { allSessions, limit, timePrefix, latest, contentCap });
    reply.send(result);
  } catch (err) {
    console.error("[GET /internal/context-search] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});


// 记忆池检索：MCP 工具 memory_search 用（x-internal-key 鉴权）
// 0919 用户拍板「换新」：数据源切 V2 集合（旧池退役为迁移源，不再写入）。
// memory_search 纯关键词检索，不调用向量模型，不读取 triggers/vibe；默认跨 fact/rule/event。
// category 兼容旧分类名 → V2 kind。向量模型只供 event 相关注入与管理台相似分组使用。
// 恒只读：不计数、不自动置顶（旧池检索写状态的污染在 V2 结构性根除）。
const MEMORY_CATEGORY_TO_KIND = { "关于她": "fact", "认账": "rule", "拓本": "fact", "压缩摘要": "fact", "对话碎片": "fact", "关于我们": "fact", "锚点": "fact", "信号": "fact", "对话摘要": "fact" };
app.get("/internal/memory-pool/retrieve", async (req, reply) => {
  try {
    const { createStore } = require("./memory/memory-v2");
    const v2vectors = require("./memory/memory-v2-vectors");
    const q = String(req.query.q || "").trim();
    const topK = Number(req.query.limit) || 5;
    const category = String(req.query.category || "").trim();
    const breath = req.query.breath === "1" || req.query.breath === "true";
    const kind = MEMORY_CATEGORY_TO_KIND[category] || category || null;
    // 特殊分类：「最近」=按正文更新时间倒序（浏览式，忽略关键词）；「已置顶」=只在 anchor 置顶里
    // 每请求新建 store（与 /admin/memory-v2/* 同款）：admission 等旁路实例各自持内存副本，避免读到陈旧缓存
    /* [位置:server.js·/internal/memory-pool/retrieve id] [按记忆 id 直接取一条] [11-03：关键词地图每行带记忆 id，AI 要能凭 id 直接看；不限 status（沉底/被替代的也能看，带 status 字段）] [注释时间 2026-11-03] */
    const byId = String(req.query.id || "").trim();
    if (byId) {
      const e = createStore({ config: {} }).list({}).find(x => String(x.id) === byId);
      return reply.send(e
        ? { ok: true, total: 1, items: [{ id: e.id, content: e.text, kind: e.kind, status: e.status, created_at: e.created_at }] }
        : { ok: true, total: 0, items: [] });
    }
    const rows = createStore({ config: {} }).list({ status: "active" });
    let items;
    if (category === "最近") {
      items = v2vectors.recent(rows, { topK });
    } else if (category === "已置顶") {
      items = q
        ? await v2vectors.retrieveHybrid(rows, q, { topK, pinnedOnly: true })
        : v2vectors.recent(rows, { topK, pinnedOnly: true });
    } else if (breath && !q) {
      // breath 模式：无 q 时只浮现记忆（未沉底，优先置顶/最近更新）
      items = v2vectors.breath(rows, { limit: topK, kind: kind || undefined });
    } else {
      items = await v2vectors.retrieveHybrid(rows, q, { topK, kind: kind || undefined });
    }
    reply.send({ ok: true, total: items.length, items });
  } catch (err) {
    console.error("[GET /internal/memory-pool/retrieve] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 记忆池新增记忆：MCP 工具 memory_add 用（x-internal-key 鉴权）
// 0918 起：v2 总闸任一开启时改道 V2 admission（tool 入口），双闸全关时原路直灌旧池（回滚通道）
app.post("/internal/memory-pool/add", async (req, reply) => {
  try {
    const b = req.body || {};
    const content = String(b.content || "").trim();
    if (!content) return reply.code(400).send({ error: "content 必填" });
    if (memoryV2Admission) {
      const v2 = await memoryV2Admission.submitMemoryAdd(
        { content, kind: b.kind || b.category, vibe: b.vibe, triggers: b.triggers },
        { sessionId: String(b.session_id || "").trim() }
      );
      if (v2.action === "review") {
        return reply.send({
          success: true, v2: true, action: v2.action,
          id: v2.candidate && v2.candidate.id || null,
          queue_id: v2.queue_id || null,
          note: "已进入人工待审队列，门卫评分在后台进行",
        });
      }
      if (v2.action === "reject") return reply.code(400).send({ error: "记忆未受理", validation: v2.validation || null });
      if (v2.action === "error") return reply.code(500).send({ error: v2.error || "记忆提交失败" });
    }
    // 2026-09-28：V1 记忆池删除，旧池直灌回滚通道移除——V2 admission 不可用即失败
    reply.code(503).send({ error: "V2 记忆通道未就绪" });
  } catch (err) {
    console.error("[POST /internal/memory-pool/add] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 记忆池按 id 置顶/取消置顶：MCP 工具 memory_pin 用（x-internal-key 鉴权）
// 0919 换新：写 V2 anchor（memory_search 数据源已切 V2，返回 V2 集合条目 id，迁移条目保留 mp_ 原id）；anchor=注入层常驻标记
app.post("/internal/memory-pool/pin", async (req, reply) => {
  try {
    const b = req.body || {};
    const id = String(b.id || "").trim();
    if (!id) return reply.code(400).send({ error: "id 必填：记忆 id（memory_search 返回）" });
    const store = require("./memory/memory-v2").createStore({ config: {} });
    // 0920 扩展：可选 sunk（true=沉底 archive，false=恢复 revive）；pinned 缺省 true 保持旧契约
    if (b.sunk !== undefined) {
      const r = store.updateStatus(id, b.sunk ? "archived" : "active", { reason: b.sunk ? "archived" : "revive" });
      if (!r.ok) return reply.code(404).send({ error: "找不到这条记忆：id=" + id });
      const e0 = r.entry;
      let e = e0;
      if (b.pinned !== undefined) {
        const r2 = store.updateFields(id, { anchor: !!b.pinned });
        if (r2.ok) e = r2.entry;
      }
      return reply.send({ success: true, entry: { id: e.id, content: e.text, pinned: e.anchor === true, sunk: e.status === "archived" } });
    }
    const pinned = b.pinned === undefined ? true : !!b.pinned;
    const r = store.updateFields(id, { anchor: pinned });
    if (!r.ok) return reply.code(404).send({ error: "找不到这条记忆：id=" + id });
    const e = r.entry;
    reply.send({ success: true, entry: { id: e.id, content: e.text, pinned: e.anchor === true, sunk: e.status === "archived" } });
  } catch (err) {
    console.error("[POST /internal/memory-pool/pin] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 记忆池按 id 改写正文：MCP 工具 memory_update 用（x-internal-key 鉴权）
// 1018 用户拍板：不再直接覆盖——新正文与原记忆一起进待审（backfill.action=update，待审页改前改后对照），
// 批准 = 新条入池 + 原条沉底（superseded/updated，与老数据重跑同一通道）；驳回 = 原条不动。
app.post("/internal/memory-v2/update", async (req, reply) => {
  try {
    const b = req.body || {};
    const id = String(b.id || "").trim();
    const content = String(b.content || "").trim();
    if (!id) return reply.code(400).send({ error: "id 必填：记忆 id（memory_search 返回）" });
    if (!content) return reply.code(400).send({ error: "content 必填：覆盖后的记忆正文" });
    const old = require("./memory/memory-v2").createStore({ config: {} }).get(id);
    if (!old) return reply.code(404).send({ error: "找不到这条记忆：id=" + id });
    if (old.status !== "active") return reply.code(400).send({ error: "这条记忆不是生效状态（" + old.status + "），不能改写" });
    if (content === String(old.text || "").trim()) return reply.send({ success: true, unchanged: true, entry: { id: old.id, content: old.text } });
    if (!memoryV2Admission || !memoryV2Admission.executorMain) return reply.code(503).send({ error: "memory-v2 admission 未初始化" });
    const draft = { text: content, backfill: { action: "update", target_id: old.id, old_text: old.text, reason: "AI 通过 memory_update 提议改写" } };
    for (const k of ["kind", "direction", "origin", "provenance", "established_at", "sensitive", "triggers", "vibe", "worth", "worth_reason", "volatility", "volatility_reason"]) {
      if (old[k] !== undefined && old[k] !== null) draft[k] = old[k];
    }
    const q = memoryV2Admission.executorMain.review(draft, "memory_update 提议改写；须人工审核（通过后原记忆沉底）", { details: ["memory_update"], source: "memory_update" });
    if (!q || !q.ok) return reply.code(500).send({ error: "进待审失败：" + ((q && q.error) || "unknown") });
    reply.send({ success: true, queued: true, queue_id: q.queue_id, entry: { id: old.id, content: old.text } });
  } catch (err) {
    console.error("[POST /internal/memory-v2/update] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});


// ========================
// 记忆池（8 分类结构化记忆）管理
// ========================
// Memory V2 admission（C5）：惰性轻量初始化，失败仅停用 V2（v2_enabled 默认 false，旧池行为不变）
// 2026-09-28：V2 记忆向量后台预热（启动 8s + 每 10 分钟增量，对齐旧池机制；新增即算由 memory-v2 写入路径负责）
try { require("./memory/memory-v2-vectors").startWarmup(); } catch (e) { console.warn("[memory-v2] 向量预热启动失败:", e.message); }

let memoryV2Admission = null;
try {
  memoryV2Admission = require("./memory/memory-admission").createAdmission({});
} catch (err) {
  console.warn("[memory-v2] admission 初始化失败，V2 停用:", err.message);
}

// 按 msg_id 直捞时间线原文（11-08：蒸馏出处抓拍、重跑查证共用；时间线快照会被清理，活着的才能捞到）
const { createMessageLookup } = require("./lib/message-lookup");
const msgLookup = createMessageLookup({ baseDir: __dirname });

// 记忆蒸馏调度器（1002 记忆改造 §8 第 3 项）：配置 data/memory_distill_config.json；路由 /admin/memory-distill/*
// 3.1 配置+调度骨架+手动触发；3.2 起分批/预取/抽取/校验/落待审接入
let memoryDistill = null;
let memorySummary = null;
let memoryBackfill = null;
try {
  memoryDistill = require("./lib/memory-distill")({
    baseDir: __dirname,
    addCompactionLog: addCompactionLog,
    persistCompactionLogs: persistCompactionLogs,
    // 3.3 预取通道：直接调 contextReplacements.searchContextEnhanced（11-09 起 AI 的内容检索已改走 /internal/search，这条是后台专用）
    searchContext: function (q, o) { return contextReplacements.searchContextEnhanced(q, o); },
    // 11-08：按 evidence uuid 直捞时间线原文（证据没命中时抓拍出处，记忆自带 quote）
    lookupMessage: msgLookup.lookup,
    // 3.6 落待审通道：Memory V2 admission 单例（promotion 通道一律进 review，不直接入池）
    admission: memoryV2Admission,
  });
  } catch (err) { console.warn("[memory-distill] 初始化失败，蒸馏停用:", err.message); }

  // 两块 LLM 总结调度器（1002 记忆改造 §8 第 6 项）：Core Identity / Long-term Understanding
  // 选材 = 记忆池全部活跃记忆（rule→Core，fact→Understanding），不是置顶几条；
  // 每晚定时按指纹判断：池子没变就不调 LLM，变了才重生成并写缓存。
  try {
    memorySummary = require("./lib/memory-summary")({
      baseDir: __dirname,
      addCompactionLog: addCompactionLog,
      persistCompactionLogs: persistCompactionLogs,
    });
  } catch (err) { console.warn("[memory-summary] 初始化失败，两块总结停用:", err.message); }

  // 老数据重跑（1002 记忆改造 §8 第 5 项；2026-11-08 重构为「记忆清洗器」）：
  // 六动作 keep/tag/update/supplement/merge/sink 全部落待审（sink 通过=旧条归档，不再写建议列表）；
  // 输入一行一条带出处（记忆自带 quote），模型拿不准可用 memory_search / context_search（后台 JSON 协议里的名字，不是 MCP 工具）查证（上限 10 轮）。
  try {
    memoryBackfill = require("./lib/memory-backfill")({
      baseDir: __dirname,
      addCompactionLog: addCompactionLog,
      persistCompactionLogs: persistCompactionLogs,
      // context_search（后台 JSON 协议名）：与蒸馏同源，直接调 searchContextEnhanced
      searchContext: function (q, o) { return contextReplacements.searchContextEnhanced(q, o); },
      // memory_search：池内检索（查全局重复/矛盾），数据源与 MCP memory_search 同款（V2 + retrieveHybrid）
      memorySearch: async function (q, limit) {
        const { createStore } = require("./memory/memory-v2");
        const v2vectors = require("./memory/memory-v2-vectors");
        const rows = createStore({ config: {} }).list({ status: "active" });
        return v2vectors.retrieveHybrid(rows, String(q || "").trim(), { topK: Math.max(1, Math.min(10, Number(limit) || 5)) });
      },
      // 3.6 同款落待审通道：Memory V2 admission 单例（promotion 通道一律进 review）
      admission: memoryV2Admission,
    });
  } catch (err) { console.warn("[memory-backfill] 初始化失败，老数据重跑停用:", err.message); }

// 2026-09-28：V1 记忆池删除——旧池静默迁移（startMemoryBackgroundMigration）与 routes/memory-pool 挂载已移除

// 记忆流水线 judge 判定提示词（2026-11-03 server.js 拆分批 4c：3 条路由 + judgeAdapter 已拆到 routes/memory-judge-prompt.js，逻辑未改）
require("./routes/memory-judge-prompt")(app, { basicAuth, admission: memoryV2Admission, baseDir: __dirname });
require("./routes/memory-review")(app, {
  basicAuth,
  admission: memoryV2Admission,
  // 11-08：backfill 卡通过后新条继承已跑标记（防止替换出的新 id 立刻被下一批重选中）
  onBackfillResolved: function (info) {
    try {
      if (memoryBackfill && info && info.new_id) {
        const oldIds = (Array.isArray(info.old) ? info.old : []).map(function (x) { return x && x.old_id; }).filter(Boolean);
        const r = memoryBackfill.inheritDone(oldIds, info.new_id);
        if (r.ok) addCompactionLog({ action: "system", label: "后台任务", status: "success", message: "[memory-backfill] 新记忆 " + info.new_id + " 继承已跑标记（" + r.done_at + "）" });
      }
    } catch (e) { console.warn("[memory-review] inheritDone 失败:", e.message); }
  },
});
// 记忆 V2 管理台：集合查看 + 聊天页入池（manual_review 走流水线进 review）
require("./routes/memory-v2-admin")(app, { basicAuth, admission: memoryV2Admission, baseDir: __dirname });
// 聊天页主题云同步 + 背景图/头像转存（/v1/themes, /v1/upload-image, /uploads/:file）
require("./routes/themes")(app, { baseDir: __dirname });
// 1019 Anthropic 原生协议翻译代理（/internal/anthropic/chat/completions，x-internal-key 鉴权由全局钩子负责）：
// claude 供应商的 api_url 指向本路由后，主链路/MCP 工具循环/后台 postChatStream 三处出口不用改。
require("./routes/anthropic-proxy")(app, { baseDir: __dirname });
require("./routes/send-queue")(app, { baseDir: __dirname, activeGenMap });   // 11-04 发送排队
// 1021：Gemini / ChatGPT 订阅账号的翻译代理（主链路只会说 OpenAI 协议）
require("./routes/oauth-proxy")(app, { baseDir: __dirname });
/* [位置:server.js·生图生视频注册] [订阅出图出片链路] [11-17 拍板先只做后端接口：POST /v1/media/gen（kind=image|video）、GET /v1/media/gen/:id、GET /v1/media/items、POST /v1/media/collect、POST /v1/media/prune；入口页后面单说] [注释时间 2026-11-17] */
require("./routes/media-gen")(app, { baseDir: __dirname });

// ===== 相关记忆注入配置/预览 + 两块总结版本存档（2026-11-03 server.js 拆分批 4b：整段（原 4364-4470 行，7 条路由 + _SUMMARY_HIST_* 三个小函数）已拆到 routes/memory-summary-tools.js，逻辑未改）=====
require("./routes/memory-summary-tools")(app, { basicAuth, baseDir: __dirname });

// ========================
// 记忆蒸馏 / 两块总结 / 老数据重跑 管理接口（2026-11-03 server.js 拆分批 4a：整段（原 4481-4710 行 + requireDistill）已拆到 routes/memory-pipelines.js，逻辑未改；三个调度器对象已在上面赋值，按值传入）
// ========================
require("./routes/memory-pipelines")(app, { basicAuth, memoryDistill, memorySummary, memoryBackfill });

// ========================
// 推送管理（时间线里的推送回显）
// ========================
// 解析推送回显内容
// 2026-09-22 审查 R19：注入 loadTimeline/saveTimeline，让推送编辑/删除走时间线四道守卫 + 快照指纹
// 2026-10-06 1006-03 恢复：df1b765 误删 routes/push-events.js 与挂载行，前端推送管理卡仍在调用，恢复挂载
require("./routes/push-events")(app, { basicAuth, baseDir: __dirname, loadTimeline, saveTimeline });
// 10-20 第十七轮：小手机「AI 在做什么」卡只读接口（唤醒回执 + 最近工具调用，无写副作用）
require("./routes/phone-activity")(app, { basicAuth, baseDir: __dirname });
// 1021：小手机设置页「网络」分组后端（火种 VPN 登录 + 机场订阅导入）；凭证只在服务端流动，状态接口不回显
require("./routes/network-admin")(app, { basicAuth, baseDir: __dirname });
// 1021：会话级 MCP 工具开关（聊天页「+」面板的 MCP 入口；全局开关仍在 /admin/mcp/servers）
require("./routes/session-mcp")(app, { basicAuth, baseDir: __dirname });
// 2026-10-27 会话进展状态（进行中/待回复/待反馈/已完成）读写，AI 用 <status> 标签写（lib/tag-parser → lib/session-meta）
// 2026-11-06 闹钟浮球：多传 wakeScheduler，删闹钟后立刻重挂定时器
require("./routes/session-status")(app, { basicAuth, wakeScheduler });
// 2026-10-27 工具集：本机自建 MCP 服务器的工具清单 + 工具说明/参数覆盖（小手机桌面「工具集」；8771 那台仍走上面的 /admin/tools）
require("./routes/mcp-tool-overrides")(app, { basicAuth, baseDir: __dirname });
// 2026-10-28 随手记：工作流/00用户随手记 当数据文件，小手机「我的」里读/加/划掉（已完成）
require("./routes/jotter")(app, { basicAuth, baseDir: __dirname });
// 2026-11-01 颜文字：表情面板「颜文字」标签页的清单，存 data/kaomoji.json（长按编辑/置顶/删除、可新增），见 routes/kaomoji.js
require("./routes/kaomoji")(app, { basicAuth, baseDir: __dirname });
// 2026-11-21 世界书（动态注入指令）：存 data/worldbook.json，增删改查+注入开关，出站前按开关动态注入不落盘，见 routes/worldbook.js、lib/worldbook.js
require("./routes/worldbook")(app, { basicAuth, baseDir: __dirname });
// 2026-11-08 表情包管理：表情面板「表情包」页上传（识图自动生成 id/描述/tags，跟「图片转写」同款模型）
//   + 长按移到最前/改描述/删除（全量回存），见 routes/stickers.js
require("./routes/stickers")(app, { basicAuth, baseDir: __dirname });
// 2026-11-05 聊天主题配置云同步：气泡主题/输入框/背景/字体字号等存 data/chat-theme.json，手机以云端为准，见 routes/theme-sync.js
require("./routes/theme-sync")(app, { basicAuth, baseDir: __dirname });
// 2026-10-23 相册：照片引用存 data/album.json，小手机用 /v1/album*，AI 工具 album 用 /internal/album*（见 lib/album.js、routes/album.js）
require("./lib/album").init({ baseDir: __dirname, loadTimeline });
require("./routes/album")(app, {});
// 2026-11-07 痕迹页（小手机「痕迹」app，桌面第三页游戏胶囊位）：trace_notes 列表+关键词+召回文案、msg_id 上下文窗口（逻辑在 routes/trace-notes.js，与召回同源）
require("./routes/trace-notes")(app, { loadTimeline, normalizeContentToText, isRealMessageForTimeline });
/* [位置:server.js·挂载] [命中页接口] [11-14 随手记15：召回命中记录列表（context-v2-runtime 钩子月度 jsonl + 时间线历史浮现增量索引），给小手机痕迹页「命中」分段；上下文窗口复用上面 trace-notes 的 /v1/trace-context（新增 at 时间锚定）] [注释时间 2026-11-14] */
require("./routes/recall-hits")(app, { loadTimeline, normalizeContentToText, isRealMessageForTimeline });
// 2026-10-23 唤醒订阅（第 9 条）：手机「唤醒设置」的开关接口，数据与规则见 lib/wake-subs.js
require("./routes/wake-subs")(app, { wakeScheduler });   // 2026-10-28：/v1/wake-next 要读调度器
// 2026-10-23 语音消息：千问 Omni 转写+标注（豆包识别下线），见 lib/voice-msg.js
require("./routes/voice-msg")(app, { auth: mcpManageAuth });
// 2026-10-27 图片转写：用途模型走 /admin/model-roles，这里只管提示词
require("./routes/image-desc")(app, { auth: mcpManageAuth });
// 2026-10-24 供应商里某个模型「走代理」：本机转发口，经火种 VPN 出口发出去（需求 37，见 routes/http-proxy.js / lib/upstream-target.js）
require("./routes/http-proxy")(app, { baseDir: __dirname });
// 2026-10-23 月历每天的统计（需求 44）：GET /v1/daily-stats?month=YYYY-MM，按时间线现状算，见 lib/daily-stats.js
require("./routes/daily-stats")(app, { baseDir: __dirname });
// 2026-10-23 订阅事件叫醒（第 9 条第二步）：unified-backend 回调 /internal/wake-event {key}（x-internal-key 由全局 /internal hook 验）；相册由 album.onChange 直接触发（只认她自己放的）
try { const mg = require("./lib/wake-subs").migrateSleepIntoEvent(); if (mg && mg.migrated) console.log("[sleep-wake] 一次性迁移：旧睡眠唤醒名单并入事件唤醒名单 →", mg.migrated.join("、") || "（空）"); else if (mg && mg.error) console.warn("[sleep-wake] 迁移失败:", mg.error); } catch (e) { console.warn("[sleep-wake] 迁移异常:", e.message); }   // 2026-11-10 睡眠唤醒并入事件唤醒（同一份名单），必须在 wakeEvents 之前
const wakeEvents = require("./lib/wake-events")({ baseDir: __dirname, wakeSubs: require("./lib/wake-subs"), fire: wakeScheduler.fireEvent });   // 2026-11-10 去掉合并窗口：事件一来立刻叫（lib/wake-events.js）
try { require("./lib/location-detect")({ baseDir: __dirname, notify: function (k) { return wakeEvents.notify(k); }, getToken: function () { return readEnvValue("PHONE_STATE_TOKEN") || ""; } }).start(); } catch (e) { console.warn("[location-detect] 启动失败:", e.message); }   // 11-04 位置变了叫醒（1 小时内最多一次）
// 2026-11-09：lib/sleep-detect.js（按手机 App 记录猜睡着/醒来）不再启动——手机上报不准，睡眠改由聊天判断（睡眠唤醒，见 wake-scheduler 的 getSleepStart），醒来改为她自己设的每天闹钟。文件保留备查。
app.post("/internal/wake-event", async (req, reply) => {
  const r = wakeEvents.notify(String((req.body && req.body.key) || ""));
  if (r && r.ok === false) reply.code(400);
  reply.send(r);
});
try {
  require("./lib/album").get().onChange(function (ev) { if (ev && ev.type === "add" && ev.item && ev.item.by === "her") wakeEvents.notify("album"); });
} catch (e) { console.warn("[wake-events] 相册事件挂接失败:", e.message); }

// 2026-10-25 子智能体（需求单 26 重设计版）：8771 的 subagent 工具转调这三口（鉴权走全局 /internal hook 的 x-internal-key）。
// 引擎 lib/subagent-runner.js：子会话只带云服务器+DeepSeek搜索，跑完按 <标签> 出报告、自动归档、
// 会话名加「子进程 · 」前缀；状态全落盘 data/subagent/<sid>.json，重启后 running→interrupted 惰性判定。
const subagentLegacy = require("./lib/subagent-runner")({
  baseDir: __dirname,
  readEnvValue,
  appendMessages,
  streamToolLoop: mcp.streamToolLoop,
  normalizeContentToText
});
/* [位置:server.js·subagentRunner 引擎分发] [子智能体 = 用预设开的普通会话] [10-27（需求单第 12 项）：新引擎 lib/subagent-preset-runner.js 用 from-preset 建会话 + 内部发普通聊天请求，报告/log 读时间线，与普通会话同一条流水线；旧引擎保留，老的 s_sub_ 会话（有 data/subagent 记录）继续走旧引擎；data/subagent-engine.json {"engine":"legacy"} 可一键切回旧引擎，不用重启] [注释时间 2026-10-27] */
const subagentPreset = require("./lib/subagent-preset-runner")({
  baseDir: __dirname,
  readEnvValue,
  inject: (o) => app.inject(o),
  loadTimeline,
  getGen: (sid) => activeGenMap.get(sid)
});
const subagentRunner = require("./lib/subagent-engine")({ legacy: subagentLegacy, preset: subagentPreset, baseDir: __dirname });
app.post("/internal/subagent/start", async (req, reply) => {
  const b = (req.body && typeof req.body === "object") ? req.body : {};
  const r = await subagentRunner.start({ task: b.task, session_id: b.session_id, parent_session: b.parent_session, preset: b.preset, model: b.model });   // 11-14 随手记 #24：model 透传给引擎（两套引擎各自校验+覆盖）
  if (r && r.ok === false) reply.code(400);
  reply.send(r);
});
app.get("/internal/subagent/report", async (req, reply) => {
  reply.send(subagentRunner.report({ session_id: (req.query || {}).session_id, tag: (req.query || {}).tag }));
});
app.get("/internal/subagent/log", async (req, reply) => {
  reply.send(subagentRunner.log({ session_id: (req.query || {}).session_id, start_line: (req.query || {}).start_line, end_line: (req.query || {}).end_line }));
});
/* [位置:server.js·GET /internal/models] [启用中的供应商与模型清单] [随手记 #24：yun-mcp-v2 的 models 工具转调这口（鉴权走全局 /internal 钩子的 x-internal-key），判据与设置页 /admin/model-roles 同源（model-router.listEnabledModels），只回名字与模型，不带密钥] [注释时间 2026-11-14] */
app.get("/internal/models", async (req, reply) => {
  reply.send({ ok: true, providers: require("./lib/model-router").listEnabledModels() });
});

// 2026-10-25 wake 工具（多闹钟 + daily 循环）：8771 转调这四口；旧 <wake> 单槽标签不动，两套并存。
// 工具设的闹钟不受她发言影响（产品确定写死），取消只走 delete/clear。
app.post("/internal/wake-alarms/set", async (req, reply) => {
  const b = (req.body && typeof req.body === "object") ? req.body : {};
  const sid = String(b.session_id || "").trim();
  if (!sid) { reply.code(400); return reply.send({ ok: false, error: "缺少 session_id" }); }
  const rep = String(b.repeat || "once").trim() || "once";
  const timeStr = String(b.time || "").trim();
  let intervalMin = b.interval_min !== undefined ? b.interval_min : b.intervalMin;
  let at = null;
  if (timeStr) {
    const target = parseWakeTarget(timeStr, TIME_ZONE);
    if (!target) { reply.code(400); return reply.send({ ok: false, error: "time 无法解析（支持 分钟数 / HH:MM / YYYY-MM-DD HH:MM）" }); }
    at = target.at || new Date(Date.now() + target.minutes * 60 * 1000);
    if (rep === "interval" && (intervalMin === undefined || intervalMin === null || intervalMin === "") && target.minutes) {
      intervalMin = target.minutes;
    }
  } else if (rep !== "interval" || !intervalMin) {
    reply.code(400); return reply.send({ ok: false, error: "缺少 time（分钟数 / HH:MM / YYYY-MM-DD HH:MM）" });
  }
  const r = wakeAlarms.setAlarm(sid, {
    at: at ? at.toISOString() : undefined,
    repeat: rep,
    days: b.days,
    intervalMin: intervalMin,
    quietStart: b.quiet_start !== undefined ? b.quiet_start : b.quietStart,
    quietEnd: b.quiet_end !== undefined ? b.quiet_end : b.quietEnd,
    label: b.label
  });
  if (!r.ok) { reply.code(400); return reply.send(r); }
  try { wakeScheduler.armTimedWake(); } catch (e) {}
  const finalAt = new Date(r.alarm.at);
  console.log(`[wake-alarms] ${sid} 设闹钟 ${r.alarm_id}：${formatDateTimeInTimeZone(finalAt, TIME_ZONE)}（${r.alarm.repeat}${b.label ? "，" + b.label : ""}）`);
  reply.send(Object.assign(r, { at_iso: r.alarm.at }));
});
app.get("/internal/wake-alarms/list", async (req, reply) => {
  const sid = String((req.query || {}).session_id || "").trim();
  if (!sid) { reply.code(400); return reply.send({ ok: false, error: "缺少 session_id" }); }
  let legacy = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "wake_schedule.json"), "utf-8"));
    const e = raw && raw.sessions && raw.sessions[sid];
    if (e && e.next_wake_at) legacy = { at: e.next_wake_at, keep: !!e.keep, source: "旧 <wake> 标签（单槽）" };
  } catch (err) { /* 没有旧槽就 null */ }
  reply.send({ ok: true, alarms: wakeAlarms.listAlarms(sid), legacy_wake_slot: legacy });
});
app.post("/internal/wake-alarms/delete", async (req, reply) => {
  const b = (req.body && typeof req.body === "object") ? req.body : {};
  const r = wakeAlarms.deleteAlarm(String(b.session_id || "").trim(), b.alarm_id);
  if (!r.ok) { reply.code(400); return reply.send(r); }
  try { wakeScheduler.armTimedWake(); } catch (e) {}
  reply.send(r);
});
app.post("/internal/wake-alarms/clear", async (req, reply) => {
  const b = (req.body && typeof req.body === "object") ? req.body : {};
  const sid = String(b.session_id || "").trim();
  if (!sid) { reply.code(400); return reply.send({ ok: false, error: "缺少 session_id" }); }
  const r = wakeAlarms.clearAlarms(sid);
  try { wakeSchedule.clearSlot(sid); } catch (e) {}   // clear 连旧 <wake> 单槽一起清
  try { wakeScheduler.armTimedWake(); } catch (e) {}
  reply.send(r);
});
const wakeAlarms = require("./lib/wake-alarms");

// 2026-10-06 1006-03 恢复：df1b765 误删 /admin/cross-window-inject，前端后台活动「跨窗口注入」卡仍在调用，
// 原实现自 df1b765^ 恢复。生产恒为 V2：与主聊天同源（assembleInput + buildContextBlocks 实时拼注入内容），
// Relevant 块依赖当轮用户消息，预览不含；mode 恒为 v2，前端仅用于一行 tip 文案。
app.get("/admin/cross-window-inject", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const sid = String(req.query && req.query.session_id ? req.query.session_id : "").trim() || "default";
    let v2Text = "";
    try {
      const v2Input = ctxV2Shadow.assembleInput({
        baseDir: __dirname,
        sessionId: sid,
        llmMessages: [],
        loadTimeline: loadTimeline,
        normalizeContentToText: normalizeContentToText,
      });
      const built = buildContextBlocks(v2Input);
      v2Text = (built.blocks || [])
        .filter(function (b) { return b && !b.empty && b.key !== "relevant_memories"; })
        .map(function (b) { return b.content; }).join("\n\n");
    } catch (cx) { console.warn("[cross-inject] V2 预览失败:", cx.message); }
    reply.send({ text: v2Text, session_id: sid, mode: "v2" });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.get("/admin/cross-inject/config", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const c = readCrossInjectConfig();
    reply.send({ cross_inject_diary_count: c.cross_inject_diary_count, default_count: 3 });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/cross-inject/config", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const c = saveCrossInjectConfig((req.body || {}));
    reply.send({ ok: true, cross_inject_diary_count: c.cross_inject_diary_count });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});



// 2026-10-08 方案A：压缩块内容/启停变化 → 对应会话快照全量重建。
// 快照 content 冻结了 rep 块（摘要），块被撤销/停用/隐藏/改正文而快照不重建 = 改动永远不生效。
function snapshotSessionOfBlock(id) {
  try {
    const it = contextReplacements.loadItems().find(function (x) { return x && x.id === id; });
    return (it && it.session) ? String(it.session) : "";
  } catch (e) { return ""; }
}
function invalidateSnapshotForSession(sid, reason) {
  if (!sid) return;
  try {
    require("./context/context-snapshot-v2").markStale(__dirname, sid, reason);
    console.log("[ctx-snapshot-v2] 压缩块变化已标快照失效 session=" + sid + " reason=" + reason);
  } catch (e) {
    console.warn("[ctx-snapshot-v2] 压缩块变化标失效失败:", e && e.message);
  }
}






// ========================
// 工具集管理（mcp-tools）：停用工具 / 改说明 / 改 schema + 服务启停
// ========================
const MCP_TOOLS_DIR = require('path').join(PROJECT_ROOT, "ai-toolbox");
const MCP_TOOLS_CONFIG = path.join(MCP_TOOLS_DIR, "tools_config.json");
const MCP_TOOLS_MANIFEST = path.join(MCP_TOOLS_DIR, "tools_manifest.json");
const MCP_TOOLS_HISTORY = path.join(MCP_TOOLS_DIR, "tools_history.json");

// 覆盖项合并：新值 null 表示“清除覆盖”，其余按 key 覆盖；返回全新对象
function mergeOverrideObj(oldObj, newObj) {
  const merged = Object.assign({}, oldObj || {});
  if (newObj && typeof newObj === "object") {
    Object.keys(newObj).forEach(function (k) {
      if (newObj[k] === null || newObj[k] === undefined) delete merged[k];
      else merged[k] = newObj[k];
    });
  }
  return merged;
}

function readToolsHistory() {
  const list = readJsonFileSafe(MCP_TOOLS_HISTORY, []);
  return Array.isArray(list) ? list : [];
}

let toolsWriteChain = Promise.resolve();
function appendToolsHistory(entries) {
  const task = async () => {
    if (!entries || !entries.length) return readToolsHistory().slice(0, 300);
    const hist = entries.concat(readToolsHistory()).slice(0, 300); // 新的在前
    writeJsonFileAtomic(MCP_TOOLS_HISTORY, hist);
    return hist;
  };
  toolsWriteChain = toolsWriteChain.then(task, task);
  return toolsWriteChain;
}

// 对比旧/新配置，生成修改记录
function buildToolsHistory(oldDisabled, oldDesc, oldSchema, newDisabled, newDesc, newSchema) {
  const now = new Date().toISOString();
  const entries = [];
  const oldD = new Set(oldDisabled || []);
  const newD = new Set(newDisabled || []);
  newD.forEach(function (n) {
    if (!oldD.has(n)) entries.push({ time: now, tool: n, field: "enabled", old: true, new: false, source: "工具页" });
  });
  oldD.forEach(function (n) {
    if (!newD.has(n)) entries.push({ time: now, tool: n, field: "enabled", old: false, new: true, source: "工具页" });
  });
  const descKeys = new Set(Object.keys(oldDesc || {}).concat(Object.keys(newDesc || {})));
  descKeys.forEach(function (name) {
    const oldV = (oldDesc && oldDesc[name]) || "";
    const newV = (newDesc && newDesc[name]) || "";
    if (oldV !== newV) entries.push({ time: now, tool: name, field: "description", old: oldV, new: newV, source: "工具页" });
  });
  const schemaKeys = new Set(Object.keys(oldSchema || {}).concat(Object.keys(newSchema || {})));
  schemaKeys.forEach(function (name) {
    const oldS = JSON.stringify((oldSchema && oldSchema[name]) || {});
    const newS = JSON.stringify((newSchema && newSchema[name]) || {});
    if (oldS !== newS) entries.push({ time: now, tool: name, field: "schema", old: oldS, new: newS, source: "工具页" });
  });
  return entries;
}


const MANAGED_SERVICES = [
  { name: "mcp-tools", type: "systemd", label: "工具集 MCP（8771）" },
  { name: "zzf-mcp", type: "systemd", label: "远程玩具 MCP（8890）" },
  { name: "gateway", type: "pm2", label: "网关 gateway" },
  { name: "state-worker", type: "pm2", label: "状态机 state-worker" },   // 1025：后台页补 state-worker 重启入口（需求池第5条后半）

  { name: "netease-music-mcp", type: "port", port: 3303, label: "网易云 MCP（3303）", cmd: "cd /opt/netease-music-mcp && PORT=3303 nohup node src/http-server.js > http-server.log 2>&1 &", pattern: "netease-music-mcp" },
  { name: "spicy-monopoly", type: "port", port: 8773, label: "涩涩大富翁 MCP（8773）", cmd: `cd ${PROJECT_ROOT}/spicy-monopoly && SPICY_MONOPOLY_MCP_TRANSPORT=streamable-http SPICY_MONOPOLY_MCP_HOST=${process.env.LISTEN_HOST || "127.0.0.1"} SPICY_MONOPOLY_MCP_PORT=8773 SPICY_MONOPOLY_MCP_PATH=/mcp SPICY_MONOPOLY_MCP_BEARER_TOKEN=${process.env.SPICY_MONOPOLY_MCP_BEARER_TOKEN || ""} nohup node mcp-server.js > mcp_spicy.log 2>&1 &`, pattern: "spicy-monopoly" },
  { name: "yun-mcp-v2", type: "systemd", label: "云文件 MCP yun（9010）" },
  { name: "unified-backend", type: "systemd", label: "统一后端（8777）" },
  { name: "nginx", type: "systemd", label: "nginx 网关（80/443）" },
  { name: "email-mcp", type: "pm2", label: "邮箱 MCP email-mcp" },
  { name: "embed-server", type: "pm2", label: "向量服务 embed-server" }
];

function readJsonFileSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    return fallback;
  }
}

// 原子写 JSON（tmp+rename）。2026-09-30 V10 收敛：与上方 atomicWriteJsonSync 的历史重复已合并，
// 统一委托 json_atomic.writeJsonAtomic；函数名保留（10 处调用点零改动）。
function writeJsonFileAtomic(file, data) {
  _writeJsonAtomicBase(file, data);
}

// 同步执行 shell 命令（20s 超时），返回 {ok, output}。
// ⚠ 会同步阻塞事件循环，**不要**在请求路径上调用。
// 2026-10-29 起，管理台的服务状态/控制（serviceStatus / serviceControl）与 /admin/alerts
// 均已改用下方的 runShellAsync；本函数目前**无调用点**，保留作为同步参考实现
// （万一异步版出问题，改回同步只需把 await runShellAsync( 换回 runShellCommand( ）。
function runShellCommand(cmd) {
  const { execSync } = require("child_process");
  try {
    const out = execSync(cmd, { encoding: "utf-8", timeout: 20000 }).trim();
    return { ok: true, output: out };
  } catch (err) {
    return { ok: false, output: String(err.stdout || err.message || "").trim() };
  }
}

// 2026-10-29 新增（审查 P1）：runShellCommand 的异步版，**返回结构与它完全一致**（{ok, output}），
// 便于把请求路径上的同步调用机械替换为 await，下游取值不用改。
// exec 走子进程，不阻塞事件循环——同步版单次最长 20s，串行跑十几次会把整个网关冻结数分钟。
// 口径与下方 GET /admin/services 的 runAsync 一致：systemctl is-active 对非活跃服务以非零退出码
// 输出 "inactive"，故以 stdout 为准，无 stdout 才退回错误消息。
function runShellAsync(cmd) {
  const { exec } = require("child_process");
  return new Promise(function (resolve) {
    exec(cmd, { encoding: "utf-8", timeout: 20000 }, function (err, stdout) {
      const out = String(stdout || "").trim();
      resolve({ ok: !err, output: out || (err ? String(err.message || "").trim() : "") });
    });
  });
}

// 2026-10-29：工具轮数改为可配置，**默认仍是 Infinity**（2026-10-28 拍板「主聊天 50 轮限制去掉」，
// 见 2782 行注释）。这里只留一个环境变量出口，需要时不必改代码就能临时设成有限值
// （排查工具死循环、控上游费用）。取值规则：
//   不设 / 空 / 0 / off / infinity / inf → Infinity（保持现有行为）
//   正整数 → 该值
//   其他非法值 → Infinity（保守：不因写错配置改变现有行为）
// 用函数声明而非顶层 const：本函数在请求路径上调用（此时模块早已加载完成），
// 既避免本项目已踩过 4 次的「const 声明前引用」TDZ，也让改 .env 后下一次请求即时生效。
function toolMaxRounds() {
  const v = String(readEnvValue("TOOL_MAX_ROUNDS") || "").trim().toLowerCase();
  if (!v || v === "0" || v === "off" || v === "infinity" || v === "inf") return Infinity;
  const n = Number(v);
  return (Number.isFinite(n) && n > 0) ? Math.floor(n) : Infinity;
}

// 2026-10-29 修复（审查 P1）：serviceStatus / serviceControl 由同步 execSync 改为异步。
// 原实现每个动作要**串行**跑多条 shell（执行动作 + 再查一次状态确认），单条最长 20s，
// 期间整个 gateway 进程冻结——聊天、SSE 流、上游转发全部停摆。这一族接口就是管理台「服务」面板，
// `restart nginx` 这类操作卡住时能冻结全站 20~40s。
// 改用 runShellAsync 后逐条行为等价，只是不再阻塞事件循环。
// ⚠ 调用方必须 await serviceControl(...)：漏掉会拿到 Promise 对象而不是结果。
async function serviceStatus(svc) {
  if (svc.type === "systemd") {
    const r = await runShellAsync("systemctl is-active " + svc.name);
    return r.output || "unknown";
  }
  if (svc.type === "pm2") {
    const r = await runShellAsync("pm2 jlist");
    try {
      const list = JSON.parse(r.output || "[]");
      const app = list.find(function (a) { return a.name === svc.name; });
      if (!app) return "stopped";
      return app.pm2_env && app.pm2_env.status || "unknown";
    } catch (e) { return "unknown"; }
  }
  if (svc.type === "port") {
    const r = await runShellAsync("ss -ltn 2>/dev/null | grep -c ':" + svc.port + " ' || true");
    return Number(r.output || 0) > 0 ? "running" : "stopped";
  }
  return "unknown";
}

async function serviceControl(svc, action) {
  if (action === "status") return { ok: true, status: await serviceStatus(svc) };
  if (svc.type === "systemd") {
    const r = await runShellAsync("systemctl " + action + " " + svc.name);
    return { ok: r.ok, status: await serviceStatus(svc), output: r.output };
  }
  if (svc.type === "pm2") {
    if (action === "restart") {
      const r = await runShellAsync("pm2 restart " + svc.name + " --update-env");
      return { ok: r.ok, status: await serviceStatus(svc), output: r.output };
    }
    if (action === "start" || action === "stop") {
      const r = await runShellAsync("pm2 " + action + " " + svc.name);
      return { ok: r.ok, status: await serviceStatus(svc), output: r.output };
    }
    return { ok: false, error: "不支持的操作" };
  }
  if (svc.type === "port") {
    if (action === "start") {
      if ((await serviceStatus(svc)) === "running") return { ok: true, status: "running", output: "已在运行" };
      const r = await runShellAsync(svc.cmd + " ; sleep 1; echo started");
      return { ok: r.ok, status: await serviceStatus(svc), output: r.output };
    }
    if (action === "stop") {
      // pattern 首字符转字符类（如 pm2 → [p]m2）：pkill -f 按正则匹配整条命令行时不再命中执行中的 sh -c 自身
      const killPat = "[" + String(svc.pattern).slice(0, 1) + "]" + String(svc.pattern).slice(1);
      await runShellAsync("pkill -f " + killPat + " || true; sleep 1");
      return { ok: true, status: await serviceStatus(svc), output: "已发送停止信号" };
    }
    if (action === "restart") {
      const killPat = "[" + String(svc.pattern).slice(0, 1) + "]" + String(svc.pattern).slice(1);
      await runShellAsync("pkill -f " + killPat + " || true; sleep 1");
      const r = await runShellAsync(svc.cmd + " ; sleep 1; echo restarted");
      return { ok: true, status: await serviceStatus(svc), output: r.output };
    }
    return { ok: false, error: "不支持的操作" };
  }
  return { ok: false, error: "未知服务类型" };
}

// 2026-10-06 1006-03 恢复：df1b765 误删 /admin/alerts，前端后台活动「后台提醒」卡仍在调用，原实现自 df1b765^ 恢复。
// 批次4 C5：后台活动「提醒」板块数据源：网易云 Cookie 失效 / 会话上下文达容量上限 / 服务异常
app.get("/admin/alerts", { preHandler: basicAuth }, async (req, reply) => {
  const alerts = [];
  // 1) 网易云 Cookie 失效：配置了 MUSIC_U 但网易云账号接口取不到资料
  try {
    const session = readNeteaseSession();
    if (session && session.musicU) {
      const cookieHeader = "MUSIC_U=" + session.musicU + (session.csrf ? "; __csrf=" + session.csrf : "");
      const account = await fetchNeteaseAccount(cookieHeader);
      if (!account || !account.nickname) {
        alerts.push({ type: "netease", level: "warn", title: "网易云 Cookie 失效", desc: "登录会话已失效，需重新设置 MUSIC_U" });
      }
    }
  } catch (e) { console.warn("[alerts] netease:", e.message); }
  // 2) 会话 token 达提醒上限：最近活跃会话时间线按容量守卫同口径估算用量，达到「提醒上限」（ctx_limit_alert_tokens，独立配置，与容量提醒/压缩无关）即报，带会话 id/名称/用量
  const sessNames = {};
  try { Object.assign(sessNames, readJsonFileSafe(SESSION_NAMES_FILE, {})); } catch (e) { console.warn('[server.js:4605] optional read failed:', e.message || e); }
  try {
    const limit = Number(contextCompactor.loadConfig().ctx_limit_alert_tokens) || 0;
    if (limit) {
      const files = [];
      try { files.push({ f: "enhanced_messages.json", m: fs.statSync(TIMELINE_FILE).mtimeMs }); } catch (e) { console.warn('[server.js:4610] optional read failed:', e.message || e); }
      for (const f of fs.readdirSync(path.join(__dirname, TIMELINE_DIR_NAME))) {
        if (/^enhanced_messages_s_.*\.json$/.test(f)) {
          try { files.push({ f: f, m: fs.statSync(path.join(__dirname, TIMELINE_DIR_NAME, f)).mtimeMs }); } catch (e) { console.warn('[server.js:4613] optional read failed:', e.message || e); }
        }
      }
      files.sort(function (a, b) { return b.m - a.m; });
      const recent = files.slice(0, 9);
      for (const { f } of recent) {
        try {
          const tl = JSON.parse(fs.readFileSync(path.join(__dirname, TIMELINE_DIR_NAME, f), "utf-8"));
          if (!Array.isArray(tl)) continue;
          const actual = latestActualPromptTokens(tl);
          const used = actual != null ? actual : estimateAlertTokens(tl);
          if (used < limit) continue; // 用量达到上限才提醒（不依赖是否已塞容量提醒；降回上限以下自动消失）
          const sid = f === "enhanced_messages.json" ? "default" : f.replace(/^enhanced_messages_/, "").replace(/\.json$/, "");
          alerts.push({ type: "capacity", level: "warn", title: "会话 token 达提醒上限", session_id: sid, session_name: sessNames[sid] || null, token_used: used, token_limit: limit, token_source: actual != null ? "actual" : "estimate", desc: actual != null ? "最近一轮上游实际 prompt_tokens" : "估算（无最近 usage 记录）" });
        } catch (e) { console.error('[server.js:4627]', e.message || e); }
      }
    }
  } catch (e) { console.warn("[alerts] capacity:", e.message); }
  // 4) 日志哨兵事件（ops/log_sentinel.py 落盘 data/sentinel_events.json）：24h 内的新IP登录/SSH爆破/MCP入口异常/服务掉线
  try {
    const sentEv = readJsonFileSafe(path.join(__dirname, "data", "sentinel_events.json"), null);
    const evList = sentEv && Array.isArray(sentEv.events) ? sentEv.events : [];
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const fresh = evList.filter(function (ev) { return ev && typeof ev.ts === "number" && ev.ts >= cutoff; });
    fresh.slice(-10).forEach(function (ev) {
      const d = new Date(ev.ts);
      const when = (d.getMonth() + 1) + "月" + d.getDate() + "日 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      alerts.push({ type: "sentinel", level: "warn", title: ev.title || "哨兵事件", desc: when + " · " + (ev.body || "") });
    });
  } catch (e) { console.warn("[alerts] sentinel:", e.message); }
  // 5) 上游余额不足：最近 402 记录（24h 窗口），数据来自 lib/upstream-alert（各上游调用点 note402）
  try {
    const ua = upstreamAlert.snapshot();
    if (ua.last402At && (Date.now() - ua.last402At) < 24 * 3600 * 1000) {
      const d = new Date(ua.last402At);
      const when = (d.getMonth() + 1) + "月" + d.getDate() + "日 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      alerts.push({ type: "balance", level: "warn", title: "上游模型余额不足", desc: when + " · " + (ua.lastModel || "模型未知") + "（24h 内累计 " + (ua.count || 0) + " 次 402）" });
    }
  } catch (e) { console.warn("[alerts] balance:", e.message); }
  // 3) 服务状态：列出全部实际部署的服务（pm2 存在 / systemd unit 存在 / 端口型全部），异常高亮
  const services = [];
  try {
    // 2026-10-29 修复（审查 P1）：原实现在此处**串行**跑十几次同步 execSync
    // （pm2 jlist + ss + 每个 systemd 服务各 2 条 systemctl），单次请求最坏把整个网关事件循环
    // 冻结 240s——期间聊天/SSE/上游转发全部停摆。改为异步并行，逐条行为与原来等价，只是不再阻塞。
    const systemdSvcs = MANAGED_SERVICES.filter(function (s) { return s.type === "systemd"; });
    const [pm2Res, ssRes, ...enabledRes] = await Promise.all([
      runShellAsync("pm2 jlist"),
      runShellAsync("ss -ltn 2>/dev/null"),
      ...systemdSvcs.map(function (s) { return runShellAsync("systemctl is-enabled " + s.name + " 2>/dev/null"); })
    ]);
    const pm2ByName = {};
    try { JSON.parse(pm2Res.output || "[]").forEach(function (a) { pm2ByName[a.name] = a.pm2_env && a.pm2_env.status; }); } catch (e) { console.error("[alerts] pm2 jlist 解析失败:", e.message || e); }
    const ports = new Set();
    const mm = String(ssRes.output || "").match(/:(\d{2,5})\s/g) || [];
    mm.forEach(function (s) { ports.add(s.replace(/[:\s]/g, "")); });
    // 第二段：只对 unit 存在的（is-enabled 返回 enabled/disabled）并行查 is-active，其余跳过（与原逻辑一致）
    const existIdx = [];
    systemdSvcs.forEach(function (s, i) {
      const en = String((enabledRes[i] && enabledRes[i].output) || "").trim();
      if (en === "enabled" || en === "disabled") existIdx.push(i);
    });
    const activeRes = await Promise.all(existIdx.map(function (i) {
      return runShellAsync("systemctl is-active " + systemdSvcs[i].name);
    }));
    const statusBySvc = {};
    existIdx.forEach(function (i, k) {
      statusBySvc[systemdSvcs[i].name] = String((activeRes[k] && activeRes[k].output) || "").trim() || "unknown";
    });
    for (const svc of MANAGED_SERVICES) {
      let ok = true, status = "unknown";
      if (svc.type === "pm2") {
        if (!(svc.name in pm2ByName)) continue; // 未部署，跳过
        status = pm2ByName[svc.name] || "unknown";
        ok = status === "online";
      } else if (svc.type === "port") {
        status = ports.has(String(svc.port)) ? "running" : "stopped";
        ok = status === "running";
      } else if (svc.type === "systemd") {
        if (!(svc.name in statusBySvc)) continue; // unit 不存在，跳过
        status = statusBySvc[svc.name];
        ok = status === "active";
      }
      services.push({ name: svc.name, label: svc.label || svc.name, status: status, ok: ok });
    }
  } catch (e) { console.warn("[alerts] services:", e.message); }
  reply.send({ ok: true, alerts: alerts, services: services, ts: Date.now() });
});

app.get("/admin/backup/status", { preHandler: basicAuth }, async (req, reply) => {
  // 1010-20 备份状态：important-chat-system-backup/ 最新 ops_*.tar.gz + 断档天数（配套 ops/backup_watch.py 每日守卫）
  try {
    const dir = path.join(__dirname, "important-chat-system-backup");
    let files = [];
    try {
      files = fs.readdirSync(dir)
        .filter(function (f) { return /^ops_\d{8}_\d{6}\.tar\.gz$/.test(f); })
        .map(function (f) {
          const st = fs.statSync(path.join(dir, f));
          return { file: f, ymd: f.slice(4, 12), mtime: st.mtimeMs, size: st.size };
        })
        .sort(function (a, b) { return b.mtime - a.mtime; });
    } catch (e) { console.warn("[backup-status] scan:", e.message); }
    const latest = files[0] || null;
    let stale_days = null;
    if (latest) {
      const y = Number(latest.ymd.slice(0, 4)), mo = Number(latest.ymd.slice(4, 6)) - 1, d = Number(latest.ymd.slice(6, 8));
      const d1 = new Date(y, mo, d); d1.setHours(0, 0, 0, 0);
      const now = new Date(); now.setHours(0, 0, 0, 0);
      stale_days = Math.round((now - d1) / 86400000);
    }
    const nowd = new Date();
    const today = "" + nowd.getFullYear() + String(nowd.getMonth() + 1).padStart(2, "0") + String(nowd.getDate()).padStart(2, "0");
    reply.send({ ok: true, latest: latest, count: files.length, stale_days: stale_days, today: today, is_today: latest ? latest.ymd === today : false });
  } catch (e) { reply.send({ ok: false, error: e.message }); }
});

app.get("/admin/tools", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const manifest = readJsonFileSafe(MCP_TOOLS_MANIFEST, null);
    const config = readJsonFileSafe(MCP_TOOLS_CONFIG, {});
    reply.send({
      manifest: manifest,
      config: config,
      history: readToolsHistory().slice(0, 100),
      config_path: MCP_TOOLS_CONFIG,
      manifest_path: MCP_TOOLS_MANIFEST,
      note: manifest ? null : "工具清单还没生成：请先重启 mcp-tools 服务（或点下方「重启」）"
    });
  } catch (err) {
    console.error("[GET /admin/tools] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 2026-09-24：优先取最近一轮上游真实返回的 prompt_tokens（routes/chat.js 落盘 assistant.tokens=usage），
// 这才是"实际发给上游的 token"；老会话/没跑过一轮的才 fallback 到 estimateAlertTokens 估算。
function latestActualPromptTokens(timeline) {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const m = timeline[i];
    if (!m || m.role !== "assistant" || m.deleted) continue;
    const u = m.tokens;
    if (u && typeof u === "object" && Number.isFinite(u.prompt_tokens) && u.prompt_tokens > 0) {
      return u.prompt_tokens;
    }
  }
  return null;
}

// 批次4 C5：容量提醒 token 估算（与容量提醒守卫 countUncompressedTokens 同口径）
// 2026-09-22 审查 H10：计入 system/developer 头部块与 tool/tool_calls 往返，避免守卫失效。
function estimateAlertTokens(timeline) {
  let tok = 0;
  for (const m of timeline) {
    if (!m) continue;
    if (m._ctxRep || m._ccSummary) continue;
    if (isSpecialEvent(m)) continue;
    const c = m.content;
    if (typeof c === "string") {
      if (c.startsWith("## Historical Summary") || c.startsWith("（回忆 · ") || c.startsWith("（对话摘要")) continue;
      tok += contextCompactor.estimateTokens(c);
    } else if (Array.isArray(c)) {
      for (const part of c) {
        if (!part) continue;
        if (part.type === "text" && typeof part.text === "string") tok += contextCompactor.estimateTokens(part.text);
        else if (part.type === "image" || part.type === "image_url") tok += contextCompactor.EST_IMAGE_TOKENS;   // §3.5：去掉 `|| 1200` 兜底字面（EST_IMAGE_TOKENS 恒有值，两口径统一）
        else if (part.type === "file" && part.file && typeof part.file.name === "string") tok += contextCompactor.estimateTokens("[文件] " + part.file.name);
        else tok += 1;
      }
    }
    // tool_calls 本身也占 token（名称 + 参数 JSON）
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (!tc || !tc.function) continue;
        if (tc.function.name) tok += contextCompactor.estimateTokens(tc.function.name);
        if (typeof tc.function.arguments === "string") tok += contextCompactor.estimateTokens(tc.function.arguments);
        else if (tc.function.arguments) tok += contextCompactor.estimateTokens(JSON.stringify(tc.function.arguments));
      }
    }
  }
  return tok;
}

// 批次4 C5：后台活动「提醒」板块数据源：网易云 Cookie 失效 / 会话上下文达容量上限 / 服务异常



app.put("/admin/tools", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const existing = readJsonFileSafe(MCP_TOOLS_CONFIG, {});
    const oldDisabled = Array.isArray(existing.disabled) ? existing.disabled : [];
    const oldDescriptions = (existing.descriptions && typeof existing.descriptions === "object") ? existing.descriptions : {};
    const oldSchemas = (existing.schemas && typeof existing.schemas === "object") ? existing.schemas : {};
    const disabled = Array.isArray(body.disabled) ? body.disabled.filter(function (n) { return typeof n === "string"; }) : oldDisabled;
    const descriptions = mergeOverrideObj(oldDescriptions, body.descriptions);
    const schemas = mergeOverrideObj(oldSchemas, body.schemas);
    writeJsonFileAtomic(MCP_TOOLS_CONFIG, { disabled: disabled, descriptions: descriptions, schemas: schemas });
    /* [位置:server.js·PUT /admin/tools] [改完说明立即生效] [10-27：工具清单走 30 秒缓存（mcp-tool-loop getToolsForSession），管理台/小手机改完说明原本最多晚半分钟才到 AI；这里改完就清缓存，和「工具集」里其他服务器保存后一致] [注释时间 2026-10-27] */
    try { require("./mcp/mcp-tool-loop").invalidateToolsCache(); } catch (e) { console.warn("[PUT /admin/tools] 清工具缓存失败:", e.message); }
    const history = buildToolsHistory(oldDisabled, oldDescriptions, oldSchemas, disabled, descriptions, schemas);
    // 历史在 appendToolsHistory 内串行化（读-改-写同链），并返回最新历史供展示
    const newestHistory = await appendToolsHistory(history);
    // 配置已热加载生效（tools_server 监控配置文件自动重载），无需重启服务
    const manifest = readJsonFileSafe(MCP_TOOLS_MANIFEST, null);
    reply.send({
      ok: true,
      restart: "hot-reload",
      manifest: manifest,
      config: readJsonFileSafe(MCP_TOOLS_CONFIG, {}),
      history: (newestHistory || readToolsHistory()).slice(0, 100)
    });
  } catch (err) {
    console.error("[PUT /admin/tools] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// MCP 服务器注册表管理（聊天客户端"设置→连接"或管理台调用）
// 鉴权：管理台/聊天页会话（admin_session cookie，聊天页经 chat-login 下发）或 admin basicAuth。
// 批注 2026-09-13（审查 S1）：不再接受 GATEWAY_API_KEY——那是下发给聊天客户端的 /v1 key，
// 若可进管理接口，等于一个泄露的聊天 key 就能读走全部上游凭据并注册任意 MCP command（RCE 面）。
// 聊天页登录后已持有 admin_session cookie（mcpAuthHeaders 同时带 credentials:include），功能不受影响。
function mcpManageAuth(req, reply, done) {
  if (isAuthorized(req)) return done();
  return basicAuth(req, reply, done);
}

// [位置:server.js·mcpProbeCached] [GET /admin/mcp/servers 探测结果 60 秒缓存 + 并发合并]
// [11-21：原接口每次都逐台现连探测 5~8 秒，前端 30 秒后台轮询会压垮网关；照 routes/session-mcp.js probeCached 模式，
// 按服务器配置指纹缓存 60 秒、并发合并、成功才缓存、?refresh=1 强刷、PUT /admin/mcp/servers 后清缓存；返回浅拷贝防下游改写 probe.tools 污染缓存]
const MCP_PROBE_TTL_MS = 60000;
const _mcpProbeCache = new Map();
function mcpProbeCached(server, force) {
  const key = String(server.id || "") + "|" + JSON.stringify([server.url, server.command, server.args, server.env, server.headers, server.transport, server.type]);
  const hit = _mcpProbeCache.get(key);
  if (!force && hit) {
    if (hit.pending) return hit.pending.then((r) => Object.assign({}, r));
    if (Date.now() - hit.at < MCP_PROBE_TTL_MS) return Promise.resolve(Object.assign({}, hit.res));
  }
  const pending = mcpProbeServer(server).then(function (res) {
    if (res && res.connected && !res.error && Array.isArray(res.tools)) _mcpProbeCache.set(key, { at: Date.now(), res: res });
    else _mcpProbeCache.delete(key);
    return Object.assign({}, res);
  }, function (e) { _mcpProbeCache.delete(key); throw e; });
  _mcpProbeCache.set(key, { pending: pending });
  return pending;
}

app.get("/admin/mcp/servers", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const force = String((req.query && req.query.refresh) || "") === "1";
    const cfg = JSON.parse(fs.readFileSync(MCP_SERVERS_CONFIG, "utf-8"));
    const list = (cfg.servers || []).map(async function (s) {
      const base = { id: s.id, name: s.name, type: s.type, url: s.url, command: s.command, args: s.args || [], headers: s.headers || {}, enabled: s.enabled !== false };
      // 工具白名单原样带回前端，避免管理台保存时丢失（PUT 端会保留该字段）
      if (Array.isArray(s.allowTools)) base.allowTools = s.allowTools.map(String);
      // 工具级黑名单（聊天端工具查看页的每工具开关）同样带回，避免保存时丢失
      if (Array.isArray(s.blockTools)) base.blockTools = s.blockTools.map(String);
      // 超时配置同样带回前端，整表回存时不丢（PUT 端透传保留）
      if (Number(s.callTimeoutMs) > 0) base.callTimeoutMs = Number(s.callTimeoutMs);
      if (s.retryOnTimeout === true) base.retryOnTimeout = true;
      if (s.enabled === false) return Object.assign(base, { connected: false, tools: [], toolCount: 0, note: "已停用" });
      try {
        const probe = await mcpProbeCached(s, force);
        // 「工具集合」服务器：用 mcp-tools 的 manifest/config 丰富每个工具（启用/描述/参数）
        if (s.name === "工具集合" || /:8771\b/.test(String(s.url || ""))) {
          const manifest = readJsonFileSafe(MCP_TOOLS_MANIFEST, null);
          const tcfg = readJsonFileSafe(MCP_TOOLS_CONFIG, {});
          const disabled = Array.isArray(tcfg.disabled) ? tcfg.disabled : [];
          const descs = (tcfg.descriptions && typeof tcfg.descriptions === "object") ? tcfg.descriptions : {};
          const schemas = (tcfg.schemas && typeof tcfg.schemas === "object") ? tcfg.schemas : {};
          const mtools = (manifest && Array.isArray(manifest.tools)) ? manifest.tools : [];
          const enriched = mtools.map(function (t) {
            const nm = t && t.name;
            const schema = schemas[nm] || (t && t.inputSchema) || null;
            const params = (schema && schema.properties && typeof schema.properties === "object") ? Object.keys(schema.properties) : [];
            return { name: nm, description: (descs[nm] != null ? descs[nm] : (t && t.description) || ""), enabled: disabled.indexOf(nm) < 0, params: params };
          }).filter(function (t) { return t.name; });
          return Object.assign(base, probe, { tools: enriched, toolCount: enriched.length, managedTools: true });
        }
        // 工具全部返回、逐个标 enabled（聊天端工具查看页按此渲染开关）：
        // allowTools 白名单外的 / blockTools 黑名单内的工具注入侧会被滤掉，这里标 enabled:false
        if (Array.isArray(probe.tools)) {
          const allow = Array.isArray(base.allowTools) ? base.allowTools : null;
          const block = Array.isArray(base.blockTools) ? base.blockTools : null;
          probe.tools = probe.tools.map((t) => Object.assign({}, t, {
            enabled: (!allow || allow.indexOf(t && t.name) >= 0) && (!block || block.indexOf(t && t.name) < 0)
          }));
          probe.toolCount = probe.tools.filter((t) => t.enabled !== false).length;
        }
        return Object.assign(base, probe);
      } catch (e) {
        return Object.assign(base, { connected: false, tools: [], toolCount: 0, error: String((e && e.message) || e) });
      }
    });
    const servers = await Promise.all(list);
    // 批注 2026-09-13（审查 S1）：headers 常含 Authorization token，不回明文——
    // 非空值置空并列入 headers_set，PUT 端空值按 id 从旧配置恢复（回传即保留）。
    const safeServers = servers.map(function (s) {
      if (!s || !s.headers || typeof s.headers !== "object") return s;
      const out = Object.assign({}, s, { headers: {} });
      const set = [];
      for (const k of Object.keys(s.headers)) {
        if (String(s.headers[k] || "").trim()) { out.headers[k] = ""; set.push(k); }
        else out.headers[k] = s.headers[k];
      }
      if (set.length) out.headers_set = set;
      return out;
    });
    reply.send({ ok: true, servers: safeServers, config_path: MCP_SERVERS_CONFIG });
  } catch (err) {
    console.error("[GET /admin/mcp/servers] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

app.put("/admin/mcp/servers", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const arr = Array.isArray(body.servers) ? body.servers : [];
    // 批注 2026-09-13（审查 S1）：GET 已不回明文 headers，客户端回传的空值视为「未改动」，
    // 按 id 从旧配置恢复非空值，避免脱敏回写把真实凭据抹掉。
    let _oldServers = [];
    try { _oldServers = (JSON.parse(fs.readFileSync(MCP_SERVERS_CONFIG, "utf-8")).servers) || []; } catch (e) { console.warn('[server.js:4891] optional read failed:', e.message || e); }
    const clean = arr.map(function (s) {
      const o = { id: String(s.id || ""), name: String(s.name || ""), type: String(s.type || "auto"), enabled: s.enabled !== false };
      if (s.url) o.url = String(s.url);
      if (s.command) o.command = String(s.command);
      if (Array.isArray(s.args)) o.args = s.args.map(String);
      if (s.headers && typeof s.headers === "object") {
        const old = _oldServers.find(function (x) { return x && x.id === o.id; });
        const merged = {};
        for (const k of Object.keys(s.headers)) {
          const v = String(s.headers[k] || "").trim();
          merged[k] = v ? v : String((old && old.headers && old.headers[k]) || "");
        }
        if (Object.keys(merged).some(function (k) { return String(merged[k] || "").trim(); })) o.headers = merged;
      }
      // 工具白名单：透传保留（mcp-service.loadTools 据此过滤注入给模型的工具）
      if (Array.isArray(s.allowTools)) o.allowTools = s.allowTools.map(String);
      // 工具级黑名单：透传保留（每工具开关，关闭的工具不注入模型）
      if (Array.isArray(s.blockTools)) o.blockTools = s.blockTools.map(String);
      // 单次调用超时 / 超时重试：透传保留（mcp-client.callTool 读取；此前整表保存会把它们抹掉）
      if (Number(s.callTimeoutMs) > 0) o.callTimeoutMs = Number(s.callTimeoutMs);
      if (s.retryOnTimeout === true) o.retryOnTimeout = true;
      return o;
    }).filter(function (s) { return s.id && s.name; });
    writeJsonFileAtomic(MCP_SERVERS_CONFIG, { servers: clean });
    _mcpClientsCache = null; // 强制下次重载
    _mcpProbeCache.clear(); // 11-21：配置变更清探测缓存
    require("./mcp/mcp-tool-loop").invalidateToolsCache(); // 1026：工具缓存同步失效（原工具指纹缓存已随冻结取消删除）
    reply.send({ ok: true, restart: "hot-reload", count: clean.length });
  } catch (err) {
    console.error("[PUT /admin/mcp/servers] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 1021：Gemini / ChatGPT 的 OAuth 登录（前端点一下就出授权链接，粘贴回调链接自动解析）。
// 令牌只存服务端 data/oauth/<provider>.json，前端永远拿不到。
app.get("/admin/oauth/:provider/start", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const r = require("./lib/oauth-login").start(String(req.params.provider), {
      account: String((req.query && req.query.account) || "default"),
    });
    reply.send({ ok: true, auth_url: r.authUrl, redirect_uri: r.redirectUri, label: r.label });
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

app.post("/admin/oauth/:provider/exchange", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const url = String((req.body && (req.body.url || req.body.code)) || "").trim();
    if (!url) return reply.code(400).send({ error: "缺少回调链接" });
    const r = await require("./lib/oauth-login").exchange(String(req.params.provider), url, {
      account: String((req.body && req.body.account) || "default"),
    });
    reply.send({ ok: true, status: r });
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

app.get("/admin/oauth/:provider/status", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const _p = String(req.params.provider);
    const _pool = require("./lib/oauth-pool");
    const _acct = String((req.query && req.query.account) || "default");
    reply.send({ ok: true, status: _pool.statusOf(_p, _acct), accounts: _pool.list(_p) });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

app.post("/admin/oauth/:provider/logout", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const ok = require("./lib/oauth-login").logout(String(req.params.provider), {
      account: String((req.body && req.body.account) || "default"),
    });
    reply.send({ ok: ok });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 1021：出口线路状态（只读）。前端/我自己排查用，不返回任何凭证。
app.get("/admin/claude-egress", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const keeper = require("./lib/egress-keeper");
    const guard = require("./lib/egress-guard");
    reply.send({ ok: true, guard: guard.status(), keeper: keeper.status() });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 手动触发一次「探测 + 必要重连」，给小手机后台页的按钮用。
app.post("/admin/claude-egress/check", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const keeper = require("./lib/egress-keeper");
    const guard = require("./lib/egress-guard");
    const r = await keeper.tick();
    reply.send({ ok: true, result: r, guard: guard.status(), keeper: keeper.status() });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

app.get("/admin/client-ip", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const raw = req.ip || req.connection.remoteAddress || "";
    let ip = String(raw).replace(/^::ffff:/i, "");
    const isLocalPeer = ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
    if (isLocalPeer) {
      const real = String(req.headers["x-real-ip"] || "").trim();
      if (real) ip = String(real).replace(/^::ffff:/i, "");
    }
    const allow = readSendAllowlist();
    reply.send({ ok: true, ip: ip, allowlist: allow, allowed: !allow.length || require("./lib/ip-allow").isAllowed(ip, allow) });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

app.get("/admin/ai-providers", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    // 批注 2026-09-13（审查 S1）：api_key 不回明文，只回 api_key_set 布尔；PUT 端空值按 id 保留旧值。
    const providers = loadAiProviders().map(function (p) {
      if (!p || typeof p !== "object") return p;
      const has = !!(p.api_key && String(p.api_key).trim());
      const prov = Object.assign({}, p, { api_key: "", api_key_set: has });
      // 1021：Claude 订阅（OAuth）供应商补一个只读状态，前端据此显示「已连接/已过期」。
      // 1022：gemini / codex 走同一套状态（lib/oauth-login 现在也会出 needs_reauth），三家口径一致。
      // token 本体永远不出这个进程。
      {
        const _op = String(p.oauth_provider || "").trim();
        if (_op) {
          try {
            // 账号池：默认账号的状态 + 一共挂了几个号；全都没了才算需要重登
            const _list = require("./lib/oauth-pool").list(_op);
            const _main = _list.find(function (x) { return x.account === 'default'; }) || _list[0] || { connected: false };
            prov.oauth_status = Object.assign({}, _main, {
              accounts: _list.length,
              needs_reauth: _list.length ? _list.every(function (x) { return !x.connected || x.needs_reauth; }) : false,
            });
          } catch (e) { prov.oauth_status = { connected: false }; }
        }
      }
      return prov;
    });
    reply.send({ ok: true, providers: providers });
  } catch (err) {
    console.error("[GET /admin/ai-providers] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 2026-09-13 审查修复（前后端不对齐）：前端「自动导入心跳唤醒模型」此前期望从 /admin/env
// 拿 TARGET_API_KEY 明文，但该接口出于安全从不回密钥（响应结构也对不上），该功能自上线起
// 永不生效。改为后端专属端点：密钥不出服务器，前端只在供应商列表为空时触发导入。
app.post("/admin/ai-providers/import-heartbeat", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const list = loadAiProviders();
    if (list.length) { reply.send({ ok: true, imported: false, reason: "已有供应商，跳过导入" }); return; }
    const url = readEnvValue("TARGET_API_URL");
    const key = readEnvValue("TARGET_API_KEY");
    const model = readEnvValue("MODEL_NAME") || "deepseek-v4-flash-vision-exp";
    if (!url || !key) { reply.send({ ok: true, imported: false, reason: "缺少 TARGET_API_URL/TARGET_API_KEY 配置" }); return; }
    const prov = {
      id: "p_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name: model || "心跳唤醒模型", api_url: url, api_key: key, model: model, models: [model], enabled: true
    };
    saveAiProviders([prov]);
    console.log("[ai-providers] 已自动导入心跳唤醒模型作为聊天模型（model=" + model + "）");
    reply.send({ ok: true, imported: true });
  } catch (err) {
    console.error("[import-heartbeat] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

app.put("/admin/ai-providers", { preHandler: mcpManageAuth }, async (req, reply) => {  try {
    const arr = Array.isArray(req.body && req.body.providers) ? req.body.providers : [];
    // 批注 2026-09-13（审查 S1）：GET 已不回明文 api_key，客户端回传空值视为「未改动」，
    // 按 id 从旧配置恢复，避免脱敏回写抹掉真实凭据（也顺带修复「编辑不改 key 即被清空」）。
    const oldList = loadAiProviders();
    const clean = arr.map(function (p) {
      const o = { id: String(p.id || ""), name: String(p.name || ""), enabled: p.enabled !== false };
      if (p.api_url || p.base_url) o.api_url = String(p.api_url || p.base_url);
      if (p.api_key && String(p.api_key).trim()) {
        o.api_key = String(p.api_key);
      } else {
        const old = oldList.find(function (x) { return x && x.id === o.id && x.api_key; });
        if (old) o.api_key = String(old.api_key);
      }
      if (p.is_default === true || p.is_default === "true") o.is_default = true;
      if (p.profile && String(p.profile).trim()) o.profile = String(p.profile).trim();
      if (p.balance_url && String(p.balance_url).trim()) o.balance_url = String(p.balance_url).trim();
      // 1021：Claude 订阅（OAuth）供应商的鉴权与上游形状。
      // token 不在这里存，由 data/oauth/claude-token.json + lib/claude-token 管理。
      ["auth_type", "oauth_provider", "oauth_proxy", "anthropic_base", "anthropic_beta"].forEach(function (k) {
        if (p[k] !== undefined && p[k] !== null && String(p[k]).trim()) o[k] = String(p[k]).trim();
      });
      if (p.via_anthropic_proxy === true || p.via_anthropic_proxy === "true") o.via_anthropic_proxy = true;
      ["max_tokens", "thinking_budget"].forEach(function (k) {
        const n = Number(p[k]);
        if (Number.isInteger(n) && n > 0) o[k] = n;
      });
      let _models = [];
      if (Array.isArray(p.models)) _models = p.models.map(function(s){ return String(s).trim(); }).filter(Boolean);
      else if (p.model) _models = [String(p.model).trim()].filter(Boolean);
      if (_models.length) o.models = _models;
      if (p.model) o.model = String(p.model).trim();
      else if (_models.length) o.model = _models[0];
      else o.model = "";
      // 1019 修复：前端 payload 不管理的服务端专属字段，按 id 从旧配置带回（否则每次全量 PUT 都会把它们抹掉，
      // 与 10-01 profile/balance_url 事故同类；kimi/kimiplan 的 sampling_override 曾因此在管理页点一次开关就丢失）。
      // 仅白名单透传：前端若显式传了同名字段则以前端为准。新增服务端专属字段时在此补一项。
      const _oldP = oldList.find(function (x) { return x && x.id === o.id; });
      // 2026-10-24 需求 37：每个模型自己的「走代理」开关（高级设置）→ 供应商的 proxy_models 数组；只留还在 models 里的；前端没传就从旧配置带回，传了空数组 = 全部关掉
      if (Array.isArray(p.proxy_models)) {
        const _pm = p.proxy_models.map(function (s) { return String(s).trim(); }).filter(function (m) { return m && _models.indexOf(m) >= 0; });
        if (_pm.length) o.proxy_models = _pm;
      } else if (_oldP && Array.isArray(_oldP.proxy_models)) {
        o.proxy_models = _oldP.proxy_models.filter(function (m) { return _models.indexOf(m) >= 0; });
        if (!o.proxy_models.length) delete o.proxy_models;
      }
      // 2026-10-27 图片转写：高级设置「直接看图」的模型清单；保存口径与 proxy_models 一致
      if (Array.isArray(p.vision_models)) {
        const _vm = p.vision_models.map(function (s) { return String(s).trim(); }).filter(function (m) { return m && _models.indexOf(m) >= 0; });
        if (_vm.length) o.vision_models = _vm;
      } else if (_oldP && Array.isArray(_oldP.vision_models)) {
        o.vision_models = _oldP.vision_models.filter(function (m) { return _models.indexOf(m) >= 0; });
        if (!o.vision_models.length) delete o.vision_models;
      }
      ["sampling_override"].forEach(function (k) {
        if (p[k] !== undefined && p[k] !== null && typeof p[k] === "object") o[k] = p[k];
        else if (_oldP && _oldP[k] !== undefined) o[k] = _oldP[k];
      });
      // 2026-10-22：订阅登录类的鉴权字段同理——前端漏带就从旧配置带回，别让回存把 Claude 订阅抹成「没有凭证」
      // （事故：phone 配置页 pvFrom 没带 oauth_provider，改存一次就丢，providerHasCredential 变 false，会话静默回退默认模型）
      ["oauth_provider", "via_anthropic_proxy", "auth_type"].forEach(function (k) {
        if (o[k] === undefined && _oldP && _oldP[k] !== undefined) o[k] = _oldP[k];
      });
      return o;
    }).filter(function (p) { return p.name && p.api_url; });
    saveAiProviders(clean);
    reply.send({ ok: true, restart: "hot-reload", count: clean.length });
  } catch (err) {
    console.error("[PUT /admin/ai-providers] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// ===== 供应商测试连接（2026-09-30）：GET /models 优先（零消耗），不支持则回退最小 chat 请求 =====
function provBaseOf(urlStr) {
  const u = String(urlStr || "").trim();
  if (!u) return "";
  // 去掉尾部路径（/chat/completions 或 /messages），得到基地址
  let b = u;
  if (b.endsWith("/chat/completions")) b = b.slice(0, -"/chat/completions".length);
  else if (b.endsWith("/messages")) b = b.slice(0, -"/messages".length);
  return b.replace(/\/+$/, "");
}
app.post("/admin/providers/test", { preHandler: mcpManageAuth }, async (req, reply) => {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  let apiUrl = String(body.api_url || "").trim(), apiKey = String(body.api_key || "").trim(), model = String(body.model || "").trim();
  let profile = String(body.profile || "").trim() || "default";
  if (body.id) {
    const p = loadAiProviders().find(function (x) { return x && String(x.id) === String(body.id); });
    if (p) { apiUrl = String(p.api_url || ""); apiKey = String(p.api_key || ""); model = String(p.model || ""); profile = String(p.profile || "") || "default"; }
  }
  if (!apiUrl || !apiKey) return reply.code(400).send({ ok: false, error: "缺少 API 地址或 Key" });
  const base = provBaseOf(apiUrl);
  const started = Date.now();
  const lat = function () { return Date.now() - started; };
  try {
    if (profile === "claude") {
      // Anthropic 原生：POST {base}/v1/messages（x-api-key 头）
      const url = (base || apiUrl) + "/v1/messages";
      const ctrl = new AbortController(); const t = setTimeout(function(){ ctrl.abort(); }, 15000);
      const resp = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: model || "claude-3-5-sonnet-latest", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }) });
      clearTimeout(t);
      if (resp.ok) return reply.send({ ok: true, latency_ms: lat(), note: "连通（Anthropic /v1/messages）" });
      const j = await resp.json().catch(function(){ return {}; });
      return reply.send({ ok: false, latency_ms: lat(), error: (j && (j.error && (j.error.message || j.error.type))) || ("HTTP " + resp.status) });
    }
    // OpenAI 兼容：先 GET /models（免费）
    try {
      const url = base + "/models";
      const ctrl = new AbortController(); const t = setTimeout(function(){ ctrl.abort(); }, 15000);
      const resp = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "Authorization": "Bearer " + apiKey } });
      clearTimeout(t);
      if (resp.ok) {
        const j = await resp.json().catch(function(){ return {}; });
        const n = (j && Array.isArray(j.data)) ? j.data.length : 0;
        return reply.send({ ok: true, latency_ms: lat(), note: "连通（GET /models" + (n ? "，拉取 " + n + " 个模型）" : "）") });
      }
    } catch (e) { /* 网络异常走 chat 回退 */ }
    // 回退最小 chat 请求
    const url = base + "/chat/completions";
    const ctrl = new AbortController(); const t = setTimeout(function(){ ctrl.abort(); }, 20000);
    const resp = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey }, body: JSON.stringify({ model: model || "default", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }) });
    clearTimeout(t);
    if (resp.ok) return reply.send({ ok: true, latency_ms: lat(), note: "连通（最小 chat 请求）" });
    const j = await resp.json().catch(function(){ return {}; });
    return reply.send({ ok: false, latency_ms: lat(), error: (j && (j.error && (j.error.message || j.error.type))) || ("HTTP " + resp.status) });
  } catch (err) {
    return reply.send({ ok: false, latency_ms: lat(), error: "请求失败：" + (err && err.name === "AbortError" ? "超时(15s)" : (err && err.message || err)) });
  }
});

// ===== 供应商余额查询（2026-09-30）：读 balance_url，兼容 DeepSeek / one-api 等格式 =====
function pickBalance(json) {
  if (json == null) return null;
  // DeepSeek 官方：{ balance_infos:[{total_balance, currency,...}] }
  if (Array.isArray(json.balance_infos) && json.balance_infos.length) {
    const b = json.balance_infos[0];
    return { balance: b.total_balance, currency: b.currency || "CNY" };
  }
  // StepFun 官方（2026-10-07 实测）：{object:"account",type:"prepaid",balance:14.35,total_cash_balance,total_voucher_balance}
  if (json.object === "account" && (typeof json.balance === "number" || (typeof json.balance === "string" && String(json.balance).trim() !== ""))) {
    return { balance: json.balance, currency: "CNY" };
  }
  // one-api/new-api 系：{ balance, quota } 或 { data:{balance} }
  for (const k of ["balance", "total_balance", "amount", "balance_usd"]) {
    if (typeof json[k] === "number" || typeof json[k] === "string") {
      if (String(json[k]).trim() !== "") return { balance: json[k], currency: "USD" };
    }
  }
  if (json.data && typeof json.data === "object") {
    // Kimi 官方（2026-10-01 实测）：{code,data:{available_balance(元),cash_balance,...}}
    if (typeof json.data.available_balance === "number") return { balance: json.data.available_balance, currency: "CNY" };
    // OpenRouter（2026-10-01 实测）：{data:{limit_remaining,limit,usage,...}}——limit_remaining=剩余信用额度
    if (typeof json.data.limit_remaining === "number" && typeof json.data.limit === "number") return { balance: json.data.limit_remaining, currency: "USD" };
    return pickBalance(json.data);
  }
  // MiniMax Token Plan（2026-10-07 实测）：{model_remains:{...},base_resp:{status_code,status_msg}}；未开通返回 status_code 2062
  if (json.base_resp && typeof json.base_resp === "object") {
    const sc = json.base_resp.status_code;
    if (sc != null && String(sc) !== "0") {
      return { balance: null, note: String(json.base_resp.status_msg || ("套餐状态码 " + sc)) };
    }
    if (json.model_remains && typeof json.model_remains === "object") {
      const keys = Object.keys(json.model_remains);
      if (keys.length) {
        const v = json.model_remains[keys[0]];
        const b = (v && typeof v === "object") ? (v.remaining != null ? v.remaining : (v.quota != null ? v.quota : null)) : (typeof v === "number" ? v : null);
        if (b != null) return { balance: b, currency: "CNY", note: "MiniMax 套餐剩余（" + keys[0] + "）" };
      }
    }
    return null;
  }
  return null;
}
/* [位置:server.js·POST /admin/providers/models] [拉取供应商模型列表] [服务端用已保存的 Key 转发 GET /models，前端不用再填 Key，也不受浏览器跨域限制；响应与日志都不含 Key] [注释时间 2026-10-21] */
app.post("/admin/providers/models", { preHandler: mcpManageAuth }, async (req, reply) => {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  let apiUrl = String(body.api_url || "").trim(), apiKey = String(body.api_key || "").trim();
  let profile = String(body.profile || "").trim() || "default", oauth = "";
  let p = null;
  if (body.id) {
    p = loadAiProviders().find(function (x) { return x && String(x.id) === String(body.id); }) || null;
    if (p) {
      apiUrl = String(p.api_url || p.base_url || apiUrl);
      if (!apiKey) apiKey = String(p.api_key || "");   // 表单里显式填了就以填的为准（改 Key 试拉）
      profile = String(p.profile || "") || profile;
      oauth = String(p.oauth_provider || "");
    }
  }
  /* [位置:server.js·POST /admin/providers/models 订阅类分支] [订阅登录类也能拉模型目录] [11-17：原来这里一律回「没有模型列表接口」，但上游其实都能列（Gemini 订阅走 antigravity 的 fetchAvailableModels、Grok 订阅走 api.x.ai/v1/models），只是没有 Key 也没有 /models 这种通用接口；改成转给 routes/oauth-proxy 的 listSubscriptionModels，由它按供应商取目录并滤掉内部/出图出片 id。Claude 订阅对 OAuth 令牌 403，仍旧只能手动加，错误原话透出] [注释时间 2026-11-17；改动 2026-11-20：把 p 提到外层作用域，修复 listSubscriptionModels(p) ReferenceError] */
  if (oauth || /\/internal\//.test(apiUrl)) {
    if (!body.id || !p) return reply.send({ ok: false, error: "订阅登录类供应商要先保存，再拉目录" });
    try {
      const oauthProxy = require("./routes/oauth-proxy");
      const r = await oauthProxy._internal.listSubscriptionModels(p);
      return reply.send({ ok: true, models: r.models, provider: r.provider });
    } catch (e) {
      return reply.send({ ok: false, error: String((e && e.message) || e) });
    }
  }
  if (!apiUrl) return reply.code(400).send({ ok: false, error: "缺少 API 地址" });
  if (!apiKey) return reply.send({ ok: false, error: "这个供应商还没有保存 Key" });
  const base = provBaseOf(apiUrl);
  const hasVer = /\/v\d+$/.test(base);
  const isClaude = profile === "claude";
  const headers = isClaude ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { "Authorization": "Bearer " + apiKey };
  const urls = isClaude ? [(hasVer ? base : base + "/v1") + "/models?limit=1000"] : (hasVer ? [base + "/models"] : [base + "/models", base + "/v1/models"]);
  let lastErr = "没拉到";
  for (const url of urls) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(function () { ctrl.abort(); }, 15000);
      const resp = await fetch(url, { method: "GET", signal: ctrl.signal, headers: headers });
      clearTimeout(t);
      if (resp.ok) {
        const j = await resp.json().catch(function () { return {}; });
        const arr = (j && (j.data || j.models)) || [];
        const ids = (Array.isArray(arr) ? arr : []).map(function (x) { return typeof x === "string" ? x : (x && (x.id || x.model || x.name)); }).filter(Boolean);
        return reply.send({ ok: true, models: ids });
      }
      lastErr = (resp.status === 401 || resp.status === 403) ? ("Key 被对方拒绝（HTTP " + resp.status + "）") : ("HTTP " + resp.status);
      if (resp.status === 401 || resp.status === 403) break;
    } catch (e) { lastErr = (e && e.name === "AbortError") ? "对方 15 秒没响应" : String((e && e.message) || e); }
  }
  return reply.send({ ok: false, error: lastErr });
});
app.post("/admin/providers/balance", { preHandler: mcpManageAuth }, async (req, reply) => {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const id = String(body.id || "").trim();
  if (!id) return reply.code(400).send({ ok: false, error: "缺少供应商 id" });
  const p = loadAiProviders().find(function (x) { return x && String(x.id) === id; });
  if (!p) return reply.code(404).send({ ok: false, error: "供应商不存在" });
  // 2026-10-01：接受前端按类型预设传来的兜底余额接口（历史保存值被 PUT 副作用抹掉/从未填写时，列表按钮也能直接查）
  const bu = String((body.balance_url && String(body.balance_url).trim()) || p.balance_url || "").trim();
  if (!bu) return reply.send({ ok: false, error: "该供应商未配置余额接口" });
  if (!p.api_key) return reply.send({ ok: false, error: "供应商未配置 API Key" });
  const started = Date.now();
  try {
    const ctrl = new AbortController(); const t = setTimeout(function(){ ctrl.abort(); }, 15000);
    const resp = await fetch(bu, { method: "GET", signal: ctrl.signal, headers: { "Authorization": "Bearer " + String(p.api_key), "Accept": "application/json" } });
    clearTimeout(t);
    if (!resp.ok) return reply.send({ ok: false, error: "余额接口 HTTP " + resp.status });
    const j = await resp.json().catch(function(){ return {}; });
    const hit = pickBalance(j);
    if (hit) return reply.send({ ok: true, balance: hit.balance, currency: hit.currency, note: hit.note || "", latency_ms: Date.now() - started });
    return reply.send({ ok: false, error: "无法解析余额（接口返回格式未知）", raw: JSON.stringify(j).slice(0, 300) });
  } catch (err) {
    return reply.send({ ok: false, error: "余额查询失败：" + (err && err.name === "AbortError" ? "超时(15s)" : (err && err.message || err)) });
  }
});

// 2026-11-09：Claude 订阅额度（5 小时 / 7 天窗口已用百分比），点一下才查（见 routes/claude-usage.js）
require("./routes/claude-usage")(app, { mcpManageAuth, loadAiProviders });
// 2026-11-12：Gemini 订阅额度（各模型剩余比例 + 重置时间，纯读上游模型目录不消耗额度），同款「点一下才查」
require("./routes/gemini-usage")(app, { mcpManageAuth, loadAiProviders });
// 2026-11-18：Grok 订阅额度（周额度总已用% + 重置时间 + 各产品占比，纯读 grok.com GetGrokCreditsConfig），同款「点一下才查」
require("./routes/grok-usage")(app, { mcpManageAuth, loadAiProviders });

// ---- 按用途路由模型：列出所有用途当前选择 + 可用供应商/模型（供设置页渲染） ----
app.get("/admin/model-roles", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    /* [位置:server.js·GET /admin/model-roles providers 过滤] [可用判据与 model-router 收拢对齐] [11-14 审查 C 批第 2 块：原过滤要求 p.api_key，订阅类供应商（Claude/Gemini 订阅走内部代理、配置里没有 api_key 字段）在「用途模型」下拉里永远不出现——而 resolveExplicitModel 早已按 providerUsable（api_key 或订阅类凭据）放行，选不了是链路断在数据源。改与 model-router 同判据，普通供应商显示不变，只是把订阅类补进来] [注释时间 2026-11-14] */
    const providers = loadAiProviders().filter(function (p) {
      return providerUsable(p);
    }).map(function (p) {
      return {
        id: p.id, name: p.name, is_default: p.is_default === true,
        models: Array.isArray(p.models) && p.models.length ? p.models : (p.model ? [p.model] : [])
      };
    });
    const rm = loadRoleModelsRaw();
    const out = {};
    Object.keys(KNOWN_MODEL_ROLES).forEach(function (role) {
      const e = rm[role] || {};
      const prov = e.provider_id ? providers.find(function (x) { return x.id === e.provider_id; }) : null;
      out[role] = {
        label: KNOWN_MODEL_ROLES[role],
        provider_id: e.provider_id || "",
        model: e.model || "",
        provider_name: prov ? prov.name : "",
        model_display: (prov && e.model) ? e.model : "（跟随聊天模型）"
      };
    });
    reply.send({ ok: true, roles: out, providers: providers });
  } catch (err) {
    console.error("[GET /admin/model-roles] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// 设置单个用途的模型（provider_id/model 均空 = 跟随全局聊天模型）
app.put("/admin/model-roles/:role", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const role = String(req.params.role || "");
    if (!KNOWN_MODEL_ROLES[role]) return reply.code(400).send({ error: "unknown role: " + role });
    const providerId = String((req.body && req.body.provider_id) || "").trim();
    const modelName = String((req.body && req.body.model) || "").trim();
    if (!saveRoleModel(role, { provider_id: providerId, model: modelName })) {
      return reply.code(400).send({ error: "save failed" });
    }
    reply.send({ ok: true, restart: "hot-reload" });
  } catch (err) {
    console.error("[PUT /admin/model-roles] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// ---- 语音服务（TTS 文字转语音；MiniMax t2a_v2）----
const VOICE_CONFIG = path.join(__dirname, "config", "voice-config.json");
function loadVoiceConfig() {
  let c = {};
  try {
    c = JSON.parse(fs.readFileSync(VOICE_CONFIG, "utf-8"));
    if (!c || typeof c !== "object") c = {};
  } catch (e) { c = {}; }
  return migrateVoiceConfig(c);
}
// 旧版单供应商扁平结构 -> 新版 providers[] 结构（兼容历史配置，迁移一次即稳定）
/* [位置:server.js·TTS_DEFAULT_MODELS/ttsDefaultModel] [四类语音服务的默认模型表] [11-15：保存语音配置时 tts_model 被一刀切成了 MiniMax 的 speech-2.6-turbo，Gemini 清空模型再保存就存进错名字，之后每次清空保存又写回同一个错值、自己走不出来。默认值收敛成一张表，保存兜底与三条合成分支共用。OpenAI 兼容一类各家模型名不通用（mosi.cn 只认 moss-tts-1.5-flash，OpenAI 官方只认 gpt-4o-mini-tts），按基址域名自动选，认不出用官方通用值] [注释时间 2026-11-15] */
const TTS_DEFAULT_MODELS = { doubao: "", minimax: "speech-2.8-turbo", openai: "gpt-4o-mini-tts", gemini: "gemini-2.5-flash-preview-tts" };
/* OpenAI 兼容按基址认服务商：键是域名片段，命中取对应模型（具体的在前） */
const TTS_OPENAI_MODEL_BY_BASE = [["mosi.cn", "moss-tts-1.5-flash"]];
function ttsDefaultModel(type, apiBase) {
  const t = String(type || "");
  if (t === "openai") {
    const base = String(apiBase || "").toLowerCase();
    for (let i = 0; i < TTS_OPENAI_MODEL_BY_BASE.length; i++) {
      if (base.indexOf(TTS_OPENAI_MODEL_BY_BASE[i][0]) >= 0) return TTS_OPENAI_MODEL_BY_BASE[i][1];
    }
    return TTS_DEFAULT_MODELS.openai;
  }
  return Object.prototype.hasOwnProperty.call(TTS_DEFAULT_MODELS, t) ? TTS_DEFAULT_MODELS[t] : "";
}
function migrateVoiceConfig(c) {
  if (c && Array.isArray(c.providers) && c.providers.length) return c;
  const v = c || {};
  const prov = {
    id: "vp_doubao",
    type: "doubao",
    name: v.name || "豆包",
    enabled: v.enabled !== false,
    api_key: v.api_key || "",
    api_base: v.api_base || "https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional",
    resource_id: v.resource_id || "seed-tts-2.0",
    asr_resource_id: v.asr_resource_id || "volc.seedasr.sauc.duration",
    sample_rate: Number(v.sample_rate || 24000),
    audio_format: v.audio_format || "mp3",
    speed: Number(v.speed != null ? v.speed : 0),
    active_voice: v.speaker || v.voice_id || "",
    voices: Array.isArray(v.speakers) && v.speakers.length ? v.speakers.map(function (s) {
      return (typeof s === "string") ? { value: s, label: s } : s;
    }) : []
  };
  // 若旧配置明显是 MiniMax（api_base 指向 minimaxi 且无豆包 resource_id），转成 minimax 类型
  if (prov.api_base && /minimaxi\.com/i.test(prov.api_base) && !v.resource_id) {
    prov.type = "minimax";
    prov.tts_model = v.tts_model || ttsDefaultModel("minimax", prov.api_base);
    prov.emotion = v.emotion || "calm";
    prov.vol = Number(v.vol != null ? v.vol : 1.0);
    prov.pitch = Number(v.pitch != null ? v.pitch : 0);
    prov.bitrate = Number(v.bitrate || 128000);
    prov.channels = Number(v.channels || 1);
    prov.sample_rate = Number(v.sample_rate || 32000);
  }
  return { enabled: v.enabled !== false, active_provider: v.active_provider || prov.id, providers: [prov] };
}
function saveVoiceConfig(cfg) { writeJsonFileAtomic(VOICE_CONFIG, cfg); }
// 取当前生效的语音供应商（活动且启用 -> 否则首个启用 -> 否则首个）
function resolveActiveVoiceProvider(cfg) {
  const ps = (cfg && Array.isArray(cfg.providers)) ? cfg.providers : [];
  let active = ps.find(function (p) { return p.id === cfg.active_provider && p.enabled !== false; });
  if (!active) active = ps.find(function (p) { return p.enabled !== false; });
  return active || (ps[0] || null);
}

app.get("/admin/voice-config", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    // 批注 2026-09-13（审查 S1）：api_key 不回明文，只回 api_key_set 布尔；PUT 端空值按 id 保留旧值。
    const cfg = loadVoiceConfig();
    if (Array.isArray(cfg.providers)) {
      cfg.providers = cfg.providers.map(function (p) {
        if (!p || typeof p !== "object") return p;
        const has = !!(p.api_key && String(p.api_key).trim());
        return Object.assign({}, p, { api_key: "", api_key_set: has });
      });
    }
    if (cfg.asr_api_key) { cfg.asr_api_key_set = true; delete cfg.asr_api_key; }
    reply.send({ ok: true, config: cfg });
  }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

app.put("/admin/voice-config", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const b = req.body || {};
    // 批注 2026-09-13（审查 S1）：GET 已不回明文 api_key，客户端回传空值视为「未改动」，
    // 按 id 从旧配置恢复，避免脱敏回写抹掉真实凭据。
    const prevCfg = loadVoiceConfig();
    const prevProviders = Array.isArray(prevCfg.providers) ? prevCfg.providers : [];
    const clean = {
      enabled: b.enabled !== false,
      active_provider: String(b.active_provider || ""),
      providers: Array.isArray(b.providers) ? b.providers.map(function (p) {
        const pid = String(p.id || "");
        let apiKey = String(p.api_key || "").trim();
        if (!apiKey) {
          const old = prevProviders.find(function (x) { return x && String(x.id || "") === pid && x.api_key; });
          if (old) apiKey = String(old.api_key);
        }
        const _vtype = (p.type === "minimax" || p.type === "openai" || p.type === "gemini") ? p.type : "doubao";
        return {
          id: String(p.id || ("vp_" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36))),
          type: _vtype,
          name: String(p.name || (p.type === "minimax" ? "MiniMax" : (p.type === "openai" ? "OpenAI 兼容" : (p.type === "gemini" ? "Gemini" : "豆包")))),
          enabled: p.enabled !== false,
          api_key: apiKey,
          api_base: String(p.api_base || ""),
          resource_id: String(p.resource_id || "seed-tts-2.0"),
          asr_resource_id: String(p.asr_resource_id || "volc.seedasr.sauc.duration"),
          sample_rate: Number(p.sample_rate || 24000),
          audio_format: String(p.audio_format || "mp3"),
          speed: Number(p.speed != null ? p.speed : 0),
          active_voice: String(p.active_voice || ""),
          voices: Array.isArray(p.voices) ? p.voices.map(function (v) {
            return { value: String(v.value || ""), label: String(v.label || v.value || "") };
          }) : [],
          tts_model: String(p.tts_model || ttsDefaultModel(_vtype, p.api_base)),
          style_prompt: String(p.style_prompt || ""),
          emotion: String(p.emotion || "calm"),
          vol: Number(p.vol != null ? p.vol : 1.0),
          pitch: Number(p.pitch != null ? p.pitch : 0),
          bitrate: Number(p.bitrate || 128000),
          channels: Number(p.channels || 1)
        };
      }) : []
    };
    if (!clean.active_provider && clean.providers.length) clean.active_provider = clean.providers[0].id;
    // 保留独立的豆包 ASR 配置（前端只回传 providers，别误清掉 asr_api_key/asr_resource_id）
    const curCfg = loadVoiceConfig();
    if (!clean.asr_api_key && curCfg.asr_api_key) clean.asr_api_key = curCfg.asr_api_key;
    if (!clean.asr_resource_id && curCfg.asr_resource_id) clean.asr_resource_id = curCfg.asr_resource_id;
    saveVoiceConfig(clean);
    reply.send({ ok: true });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 裸 PCM（s16le 单声道）包 44 字节 WAV 头：Gemini TTS 只回裸流，包成 WAV 前端 data:audio/wav 才能直接播
function pcmToWav(pcm, sampleRate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// Gemini TTS 出海：官方域名国内直连不通（2026-11-13 实测 12s 超时），同 lib/oauth-login.js 口径走火种代理（AIRPORT_PROXY）；
// 用户填的中转等其他地址直连不动。响应拼成 fetch 形状（ok/status/json），与下面 gemini 分支的处理逻辑兼容。
async function geminiPost(url, headers, bodyStr) {
  if (!/generativelanguage\.googleapis\.com/i.test(url)) return fetch(url, { method: "POST", headers: headers, body: bodyStr });
  await require("./lib/egress-guard").assertOk();
  return new Promise(function (resolve, reject) {
    const u = new (require("url").URL)(url);
    const buf = Buffer.from(bodyStr, "utf8");
    const rq = require("https").request({
      hostname: u.hostname, path: u.pathname + (u.search || ""), method: "POST",
      agent: new (require("https-proxy-agent").HttpsProxyAgent)(require("./lib/egress-guard").requireProxyUrl()),
      headers: Object.assign({ "content-length": buf.length }, headers)
    }, function (rs) {
      const chunks = [];
      rs.on("data", function (c) { chunks.push(c); });
      rs.on("end", function () {
        const body = Buffer.concat(chunks);
        resolve({
          ok: rs.statusCode >= 200 && rs.statusCode < 300, status: rs.statusCode,
          json: function () { try { return Promise.resolve(JSON.parse(body.toString("utf8"))); } catch (e) { return Promise.reject(e); } }
        });
      });
    });
    rq.setTimeout(30000, function () { rq.destroy(new Error("Gemini TTS 上游超时（30s）")); });
    rq.on("error", reject);
    rq.end(buf);
  });
}
// 文字 → 语音（base64 mp3）。前端 POST JSON { text, speaker?, resource_id? }，返回 { ok, audio(base64), format }
// 供应商四支持：doubao=火山豆包（seed-tts，X-Api-Key）；minimax=t2a_v2；openai=OpenAI 兼容 /audio/speech（Bearer）；gemini=Google generateContent（x-goog-api-key，裸 PCM 包 WAV 返回）。
app.post("/admin/tts", { preHandler: mcpManageAuth }, async (req, reply) => {
  try {
    const cfg = loadVoiceConfig();
    let p = resolveActiveVoiceProvider(cfg);
    // 试听覆盖：请求带 provider_id 时用指定供应商（编辑表单里试听非当前生效供应商的音色），
    // 找不到或已停用则忽略，回落当前生效。
    const reqPid = String((req.body && req.body.provider_id) || "");
    if (reqPid) {
      const ovP = (Array.isArray(cfg.providers) ? cfg.providers : []).find(function (x) { return x && x.id === reqPid && x.enabled !== false; });
      if (ovP) p = ovP;
    }
    if (!p || !p.api_key) return reply.code(400).send({ error: "未配置语音供应商 API Key" });
    const text = String((req.body && req.body.text) || "").trim();
    if (!text) return reply.code(400).send({ error: "内容为空" });
    const speaker = String((req.body && req.body.speaker) || p.active_voice || "").trim();
    const isDoubao = p.type === "doubao"; // 只按类型判定，避免 MiniMax 带 seed-* 资源ID被误判成豆包

    if (isDoubao) {
      // ---- 火山豆包 语音合成（seed-tts-2.0 / seed-icl-2.0）----
      const url = String(p.api_base || "https://openspeech.bytedance.com/api/v3/tts/unidirectional").replace(/\/$/, "");
      const sampleRate = Number(p.sample_rate || 24000);
      const enc = String(p.audio_format || "mp3");
      const speechRate = Number(p.speed != null ? p.speed : 0);
      const payload = {
        user: { uid: "dylan-heartbeat" },
        req_params: {
          text: text.slice(0, 1500),
          speaker: speaker || "zh_female_vv_uranus_bigtts",
          sample_rate: sampleRate,
          audio_params: { format: enc, speech_rate: speechRate }
        }
      };
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": p.api_key,
          "X-Api-Resource-Id": String(p.resource_id || "seed-tts-2.0"),
          "X-Api-Request-Id": (require("crypto").randomUUID ? require("crypto").randomUUID() : String(Date.now()))
        },
        body: JSON.stringify(payload)
      });
      const txt = await r.text();
      // 豆包 seed-tts 返回的是「分块流式」：多个 {"code":0,...,"data":"<base64片段>"} 拼接，最后 {"code":20000000,...,"data":null} 结束。
      // 需把所有 code==0 的 data 片段(base64)按顺序拼接成完整音频。
      let audio = "";
      if (!r.ok) {
        return reply.code(502).send({ error: "豆包TTS失败: HTTP " + r.status + " " + String(txt).slice(0, 200) });
      }
      const dataPat = /\{"code":0,"message":"[^"]*","data":"([^"]*)"\}/g;
      let mm;
      while ((mm = dataPat.exec(txt))) {
        audio += mm[1] || "";
      }
      if (!audio) {
        const errM = /"message":"([^"]*)"/.exec(txt);
        return reply.code(502).send({ error: "豆包TTS失败: " + String((errM && errM[1]) || "无音频返回").slice(0, 200) });
      }
      // audio 已是拼接好的 base64
      reply.send({ ok: true, audio: audio, format: enc || "mp3", sample_rate: sampleRate, extra: null, provider: p.name });
      return;
    }

    // ---- OpenAI 兼容 TTS（如 api.mosi.cn：POST {api_base}，Bearer 鉴权，体 {model,input,voice}，返回音频二进制）----
    if (p.type === "openai") {
      const url = String(p.api_base || "").replace(/\/$/, "");
      if (!/^https?:\/\//.test(url)) return reply.code(400).send({ error: "OpenAI 兼容供应商未配置接口地址（api_base 应为完整 /audio/speech 地址）" });
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + p.api_key },
        body: JSON.stringify({
          model: p.tts_model || ttsDefaultModel("openai", p.api_base),
          input: text.slice(0, 1500),
          voice: speaker,
          response_format: p.audio_format || "mp3"
        })
      });
      if (!r.ok) {
        const errTxt = await r.text();
        return reply.code(502).send({ error: "TTS失败: HTTP " + r.status + " " + String(errTxt).slice(0, 200) });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return reply.code(502).send({ error: "TTS 失败: 无音频返回" });
      reply.send({ ok: true, audio: buf.toString("base64"), format: p.audio_format || "mp3", sample_rate: p.sample_rate || 24000, extra: null, provider: p.name });
      return;
    }

    // ---- Gemini TTS（Google 官方 generateContent + responseModalities=AUDIO；2026-11-13）----
    // preview 模型偶发回文字而非音频（官方文档明确）：ok-但-无音频 / 5xx 时自动重试一次；401/400 类配置错不重试直接报。
    if (p.type === "gemini") {
      const base = String(p.api_base || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
      const model = p.tts_model || ttsDefaultModel("gemini", p.api_base);
      // 语气指令（可选）：Gemini 特色，非空时前缀到文本前让它照着念；空则原样念
      const style = String(p.style_prompt || "").trim();
      const sayText = (style ? style + "：" : "") + text;
      const payload = {
        contents: [{ parts: [{ text: sayText.slice(0, 1500) }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker || "Kore" } } }
        }
      };
      async function geminiOnce() {
        return geminiPost(base + "/models/" + model + ":generateContent", {
          "Content-Type": "application/json", "x-goog-api-key": p.api_key
        }, JSON.stringify(payload));
      }
      function pickPart(rj) {
        const parts = rj && rj.candidates && rj.candidates[0] && rj.candidates[0].content && rj.candidates[0].content.parts;
        return Array.isArray(parts) ? parts.find(function (x) { return x && x.inlineData && x.inlineData.data; }) : null;
      }
      let r = await geminiOnce();
      let j = null;
      try { j = await r.json(); } catch (e) { j = null; }
      let part = pickPart(j);
      if (!part && (r.ok || r.status >= 500)) {
        r = await geminiOnce();
        try { j = await r.json(); } catch (e) { j = null; }
        part = pickPart(j);
      }
      if (!part) {
        const msg = (j && j.error && j.error.message) || ("HTTP " + r.status);
        return reply.code(502).send({ error: "Gemini TTS失败: " + String(msg).slice(0, 200) });
      }
      const rm = /rate=(\d+)/.exec(String((part.inlineData && part.inlineData.mimeType) || ""));
      const rate = rm ? Number(rm[1]) : 24000;
      // 返回裸 PCM：包 WAV 头再回（format=wav），试听 / 语音气泡 / 长按朗读三处播放链零改动
      const wav = pcmToWav(Buffer.from(part.inlineData.data, "base64"), rate);
      reply.send({ ok: true, audio: wav.toString("base64"), format: "wav", sample_rate: rate, extra: null, provider: p.name });
      return;
    }

    // ---- MiniMax t2a_v2 ----
    const payload = {
      model: p.tts_model || ttsDefaultModel("minimax", p.api_base),
      text: text.slice(0, 1200),
      stream: false,
      voice_setting: {
        voice_id: speaker || "ttv-voice-2026070919184726-re9oBNKY",
        speed: p.speed != null ? p.speed : 0.8,
        vol: p.vol != null ? p.vol : 1.0,
        pitch: p.pitch != null ? p.pitch : 0
        // 不带 emotion：用户实测该情感参数效果假，情绪走文本内标记
      },
      audio_setting: {
        format: p.audio_format || "mp3",
        sample_rate: p.sample_rate || 32000,
        bitrate: p.bitrate || 128000,
        channel: p.channels != null ? p.channels : 1
      },
      pronunciation_dict: { tone: Array.isArray(p.pronunciation_tone) ? p.pronunciation_tone : [] },
      subtitle_enable: false
    };
    const base = (p.api_base || "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const r = await fetch(base + "/t2a_v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + p.api_key },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    let audio = (j && j.data && j.data.audio) || "";
    if (!audio) return reply.code(502).send({ error: "TTS 失败: " + ((j && j.base_resp && j.base_resp.status_msg) || "unknown") });
    if (/^[0-9a-fA-F]+$/.test(audio) && audio.length % 2 === 0) {
      try { audio = Buffer.from(audio, "hex").toString("base64"); } catch (e) { /* client/stream cleanup */ }
    }
    reply.send({ ok: true, audio: audio, format: p.audio_format || "mp3", sample_rate: p.sample_rate || 32000, extra: (j && j.data && j.data.extra_info) || null, provider: p.name });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 文字 → 语音已在上方；这里是 语音 → 文字（豆包流式 ASR）
// 前端把 16kHz/单声道/16bit PCM WAV 以 base64 POST 上来，后端连豆包 bigmodel_nostream 识别。
// ASR 独立使用豆包 key（cfg.asr_api_key），不再复用"当前激活的 TTS 供应商"的 key。
app.post("/admin/asr", { preHandler: mcpManageAuth }, async (req, reply) => {
  // 2026-10-23 豆包识别下线：统一走千问 Omni（用途 voice_desc），旧调用方（chat.html 等）接口不变
  try {
    const b64 = String((req.body && (req.body.audio || req.body.data)) || "").trim();
    if (!b64) return reply.code(400).send({ error: "缺少音频数据" });
    const text = await require("./lib/voice-msg").describe(b64, "plain");
    reply.send({ ok: true, text: text || "" });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.get("/admin/services", { preHandler: basicAuth }, async (req, reply) => {
  try {
    // 并行查状态，替代串行 execSync：后者会同步阻塞事件循环（9 个服务逐条跑，
    // systemd 异常时单条最多 20s，期间所有聊天/SSE/上游转发全部冻结）
    const { exec } = require("child_process");
    const runAsync = (cmd) => new Promise((resolve) => {
      exec(cmd, { encoding: "utf-8", timeout: 20000 }, (err, stdout) => {
        // systemctl is-active 对非活跃服务以非零退出码输出 "inactive"：以 stdout 为准（与原 execSync 口径一致），
        // 无 stdout 才退回错误消息
        const out = String(stdout || "").trim();
        resolve(out || (err ? String(err.message || "").trim() : ""));
      });
    });
    // pm2 型服务只跑一次 jlist，从进程表 JSON 解析状态（pm2 jlist 输出整表，逐条跑太浪费）
    const hasPm2 = MANAGED_SERVICES.some(s => s.type === "pm2");
    const [pm2Raw, ...statuses] = await Promise.all([
      hasPm2 ? runAsync("pm2 jlist") : Promise.resolve("[]"),
      ...MANAGED_SERVICES.map(function (svc) {
        if (svc.type === "systemd") return runAsync("systemctl is-active " + svc.name);
        if (svc.type === "pm2") return Promise.resolve("");
        return runAsync("ss -ltn 2>/dev/null | grep -c ':" + svc.port + " ' || true");
      })
    ]);
    let pm2List = [];
    try { pm2List = JSON.parse(pm2Raw || "[]"); } catch (e) { console.error('[server.js:5469]', e.message || e); }
    const list = MANAGED_SERVICES.map(function (svc, i) {
      if (svc.type === "pm2") {
        const app = pm2List.find(p => p && p.name === svc.name);
        const status = app ? ((app.pm2_env && app.pm2_env.status) || "unknown") : "stopped";
        return { name: svc.name, label: svc.label, type: svc.type, status: status };
      }
      if (svc.type === "port") {
        const n = Number(statuses[i] || 0);
        const status = n > 0 ? "running" : "stopped";
        return { name: svc.name, label: svc.label, type: svc.type, status: status };
      }
      return { name: svc.name, label: svc.label, type: svc.type, status: statuses[i] || "unknown" };
    });
    reply.send({ services: list });
  } catch (err) {
    console.error("[GET /admin/services] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

app.post("/admin/services/:name/:action", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const name = String(req.params.name || "");
    const action = String(req.params.action || "");
    const svc = MANAGED_SERVICES.find(function (s) { return s.name === name; });
    if (!svc) return reply.code(404).send({ error: "未知服务: " + name });
    if (!["start", "stop", "restart", "status"].includes(action)) return reply.code(400).send({ error: "不支持的操作: " + action });
    // 1025：重启/停止的对象是 gateway 自己（本接口就跑在 gateway 里）时，serviceControl 的
    // execSync("pm2 restart gateway") 会先杀死正在处理本请求的进程，response 永远发不出去，
    // 前端必然拿到断连报「网络错误」——而 pm2 实际 1 秒就完成了（04:30 实锤：每次必报失败）。
    // 改为先回包，500ms 后 detached 执行：响应先飞出去，进程随后就义。start/status 不自杀，走原路径。
    if (svc.type === "pm2" && (action === "restart" || action === "stop") && svc.name === String(process.env.name || "")) {
      reply.send({ ok: true, status: action === "restart" ? "restarting" : "stopping", output: "指令已发送（" + svc.name + " " + action + " 中，状态几秒后刷新）" });
      setTimeout(function () {
        try {
          const { spawn } = require("child_process");
          const args = action === "restart" ? ["restart", svc.name, "--update-env"] : ["stop", svc.name];
          const child = spawn("pm2", args, { detached: true, stdio: "ignore" });
          child.unref();
          console.log("[services] 已 detached 执行 pm2 " + args.join(" "));
        } catch (e) { console.error("[services] detached 执行失败:", e.message); }
      }, 500);
      return;
    }
    reply.send(await serviceControl(svc, action));
  } catch (err) {
    console.error("[POST /admin/services] error:", err.message);
    reply.code(500).send({ error: err.message });
  }
});

// ========================
// 上下文压缩（分块预览 / 摘要生成 / 边界调整）
// ========================

// ========================
// 统一替换预览（管理台「上下文压缩」页）：所有记录（AI + 手工）合并成块视图
// ========================
// 归一化内容键：去 memory/pin/current_time 块 + 压缩空白（与发送侧 applyReplacements 同口径）
function nKeyOfMsg(m) {
  const c = typeof (m && m.content) === "string" ? m.content : JSON.stringify((m && m.content) || "");
  const stripped = c
    .replace(/<memory>[\s\S]*?<\/memory>/gi, "")
    .replace(/<pin>[\s\S]*?<\/pin>/gi, "")
    .replace(/<current_time>[\s\S]*?<\/current_time>/gi, "")
    .replace(/<star\b[^>]*>(?:\s*<\/star\s*>)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return String((m && m.role) || "") + "\u0000" + stripped;
}

// 压缩索引位置表：非特殊事件的可压缩消息 -> 压缩空间下标（0 起）
function compressiblePosMap() {
  const items = contextReplacements.compressibleItems();
  const map = new Map();
  items.forEach(function (e, idx) {
    if (contextReplacements.isSpecialEvent(e.msg)) return;
    const k = nKeyOfMsg(e.msg);
    if (!map.has(k)) map.set(k, idx);
  });
  return map;
}

function buildUnifiedReplacementPreview(includeMessages, excludeGapMsgs) {
  // 多会话：记录显式按当前会话过滤（与 applyReplacements 套用、blocks 路由 manualRecordsSorted 同口径），
  // 不再只靠"锚点锚不到就跳过"的软隔离——跨会话内容撞键时其他会话的块会被误显示/误操作。
  const curSession = contextReplacements.getActiveSession() || "default";
  // 手工块序号单一来源：manualRecordsSorted()（按会话过滤+排序）的下标，
  // 预览中因锚点/窗口被跳过的块不占序号，避免后续块 blockIndex 漂移导致 blocks 路由错位。
  const manualOrdinals = new Map();
  contextReplacements.manualRecordsSorted().forEach(function (rec, i) { manualOrdinals.set(rec.id, i); });
  const records = contextReplacements.loadItems().filter(it => !it.removed && (!it.session || it.session === curSession));
  const items = contextReplacements.compressibleItems();
  const totalCompressible = items.length;
  const compactCount = totalCompressible;
  const timeline = contextReplacements.loadTimeline() || [];
  const nonSys = timeline.filter(m => m && m.role !== "system");
  // 当前窗口起点：旧窗口块不显示（首条锚点消息早于窗口起点的块视为不在当前时间线）
  const windowStartMs = contextReplacements.currentWindowStartMs(timeline);

  function keyOf(m) {
    return String(m.role || "") + "\u0000" + String(m.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  // 与发送侧 applyReplacements 同口径的归一化键，用于锚点定位（见模块级 nKeyOfMsg）
  const nKeyOf = nKeyOfMsg;
  // 压缩索引位置表：非特殊事件消息按归一化键定位（与发送侧 tlKeyToPos 同口径）
  const itemPosByKey = compressiblePosMap();
  // 消息 id -> 压缩下标：与发送侧同口径的 id 优先定位（id 唯一，不受内容编辑/位置漂移/短消息撞键影响）
  const idPosByKey = new Map();
  items.forEach(function (e, idx) {
    if (e && e.msg && e.msg.id != null && e.msg.id !== "") idPosByKey.set(String(e.msg.id), idx);
  });

  const chunks = [];
  let totalChars = 0;
  items.forEach(function (e) { totalChars += String(e.msg.content || "").length; });

  records.forEach(function (it) {
    const matched = (Array.isArray(it.matched) && it.matched.length > 0) ? it.matched : [];
    if (matched.length === 0) return;
    // 锚点定位（与发送侧一致）：取首/末条非特殊压缩消息在时间线中的实际位置作为块边界。
    // 命中则显示为“已覆盖”，未命中则视为“未覆盖”（此时发送侧同样不会替换）。
    let aStart = null;
    for (let i = 0; i < matched.length; i++) {
      const m = matched[i];
      if (m && m.role !== "system" && !contextReplacements.isSpecialEvent(m)) { aStart = m; break; }
    }
    let aEnd = null;
    for (let i = matched.length - 1; i >= 0; i--) {
      const m = matched[i];
      if (m && m.role !== "system" && !contextReplacements.isSpecialEvent(m)) { aEnd = m; break; }
    }
    if (!aStart || !aEnd) return;
    // 手工块：优先信任创建时落库的精确压缩索引（0 起）。锚点定位在块首尾含特殊事件、
    // 或短消息归一化后撞键（如「哥哥 <current_time>…」）时会漂移，导致块被削头尾或整块丢弃。
    // 但存储编号只在时间线未重建/未换窗口时有效：首条 matched 与同编号消息内容一致才信任，
    // 否则退回内容锚点定位，避免旧窗口块的编号漂移到新窗口消息上（与发送侧 recordCompRange 同口径）。
    const storedStart = it.range && it.range.start_index;
    const storedEnd = it.range && it.range.end_index;
    const hasStoredIdx = Number.isInteger(storedStart) && Number.isInteger(storedEnd);
    let storedValid = false;
    if (hasStoredIdx) {
      const m0 = matched[0];
      const atStart = items[storedStart];
      storedValid = !!(m0 && atStart && nKeyOf(m0) === nKeyOf(atStart.msg));
    }
    let compStart = -1;
    let compEnd = -1;
    if (hasStoredIdx && storedValid) {
      compStart = Math.max(0, storedStart);
      compEnd = Math.min(storedEnd, items.length - 1);
      if (compStart >= items.length || compEnd < compStart) return;
    } else {
      // id 精确匹配优先（与发送侧 applyReplacements 同口径）：matched 首尾带 id 且时间线可查时
      // 直接定位区间，内容搜索跳过——「哥哥」等高频短语内容撞键从根上消失。
      const sId = aStart && aStart.id != null && aStart.id !== "" ? String(aStart.id) : "";
      const eId = aEnd && aEnd.id != null && aEnd.id !== "" ? String(aEnd.id) : "";
      const kIdStart = sId ? idPosByKey.get(sId) : undefined;
      const kIdEnd = eId ? idPosByKey.get(eId) : undefined;
      if (kIdStart !== undefined && kIdEnd !== undefined && kIdEnd >= kIdStart) {
        compStart = kIdStart;
        compEnd = kIdEnd;
      } else {
        // id 查不到（第三方导入/旧记录未迁移）才回退内容锚点匹配。
        // 与发送侧 applyReplacements 同口径：用首/末条非特殊事件 matched 定位块边界。
        // 不整段扫描 matched，避免短消息归一化撞键（如「哥哥」）把旧窗口块错配到新窗口。
        const kStart = itemPosByKey.get(nKeyOf(aStart));
        if (kStart === undefined) return;
        compStart = kStart;
        let kEnd = itemPosByKey.get(nKeyOf(aEnd));
        if (kEnd === undefined) {
          for (let i = matched.length - 2; i >= 0; i--) {
            const m = matched[i];
            if (!m || m.role === "system" || contextReplacements.isSpecialEvent(m)) continue;
            kEnd = itemPosByKey.get(nKeyOf(m));
            if (kEnd !== undefined) break;
          }
        }
        if (kEnd === undefined || kEnd < compStart) return;
        compEnd = kEnd;
      }
      // 区间膨胀闸（与发送侧同口径）：首尾之一误匹配到远处重复内容时整块拒绝（发送侧同样不注入），
      // 显示为未覆盖区而不是假范围。
      if (matched.length > 0 && (compEnd - compStart + 1) > matched.length * 1.5 + 20) return;
    }
    // 窗口隔离：块首条消息的实际时间早于当前窗口起点 → 旧窗口块，不显示（发送侧同样不注入）
    if (windowStartMs !== null) {
      const firstMsg = items[compStart] && items[compStart].msg;
      const t = firstMsg ? contextReplacements.messageTime(firstMsg) : null;
      if (t && t.getTime() < windowStartMs) return;
    }
    const headK = keyOf(aStart);
    const tailK = keyOf(aEnd);
    let nsHi = -1, nsTi = -1;
    for (let i = 0; i < nonSys.length; i++) if (keyOf(nonSys[i]) === headK) { nsHi = i; break; }
    for (let i = (nsHi >= 0 ? nsHi : 0); i < nonSys.length; i++) if (keyOf(nonSys[i]) === tailK) { nsTi = i; break; }
    const text = contextReplacements.recordText(it);
    const tl = String(it.range_label || "").split(" ~ ");
    const manual = it.source === "manual";
    chunks.push({
      aiRep: !manual,
      repId: manual ? undefined : it.id,
      id: it.id,
      source: it.source || "ai",
      index: 0,
      blockStart: compStart,
      blockEnd: compEnd,
      firstIdx: nsHi,
      lastIdx: nsTi,
      count: compEnd - compStart + 1,
      chars: text.length,
      startTime: tl[0] || "",
      endTime: tl[1] || "",
      head: text.slice(0, 40),
      tail: "",
      signature: "ctxrep_" + it.id,
      cached: !!text,
      summary: text,
      generatedAt: it.created_at || null,
      mode: manual ? "manual" : "ai",
      manual: manual,
      enabled: it.enabled !== false,
      manualHidden: it.hidden === true,
      range_label: it.range_label || "",
      // 消息 id 边界（批量导入识别用）：首/尾非特殊压缩消息的自带 id，id 稳定不受内容编辑/位置漂移影响
      first_id: (aStart && aStart.id) ? String(aStart.id) : undefined,
      last_id: (aEnd && aEnd.id) ? String(aEnd.id) : undefined,
      original_preview: matched.slice(0, 2).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 150) })),
      history: (Array.isArray(it.history) ? it.history : []).map(function (h, i) { return { index: i, summary: h.summary, generatedAt: h.generatedAt, mode: h.mode || (manual ? "edited" : "ai"), manual: h.manual === true || manual }; }).slice(0, 8),
      msgs: includeMessages ? matched.map((function () {
        // loadMarks 提到循环外：matched 数百条时逐条调用会放大读盘（现走缓存，仍省每条的重复调用）
        const _marks = contextReplacements.loadMarks ? contextReplacements.loadMarks() : {};
        return function (m, i) {
        const _key = contextReplacements.contentKey(m);
        // 手工块：编号=存储起点+块内序号（matched 与压缩切片一一对应），避免锚点撞键漂移；
        // 存储编号失效（换窗口）时退回内容锚点编号
        const _num = (hasStoredIdx && storedValid) ? (storedStart + i) : (itemPosByKey.has(nKeyOf(m)) ? itemPosByKey.get(nKeyOf(m)) : null);
        // 1007-17：标星判定改双查（先 msgid 后内容键），兼容存量条目
        const _mk = contextReplacements.isMarkedMsg ? contextReplacements.isMarkedMsg(m, _marks) : !!_marks[_key];
        return { role: m.role, content: typeof m.content === "string" ? m.content : "", key: _key, marked: _mk, num: _num, id: m && m.id ? String(m.id) : undefined };
        };
      })()) : undefined,
      pos: compStart
    });
  });

  chunks.sort(function (a, b) { return a.pos - b.pos; });
  chunks.forEach(function (c, i) { c.index = i + 1; c.pos = undefined; });

  // 隐藏块：与发送侧 applyReplacements 同口径——手动隐藏块标记 hidden，摘要与区间原文都不进上下文。
  // 2026-10-04：原先这里还有「活跃块上限」截断（previewMaxActive），随旧压缩系统一并下线。
  // 只剩手动隐藏这一条用户可控路径。
  let hiddenCount = 0;
  chunks.forEach(function (c) {
    if (c.manualHidden) { c.hidden = true; hiddenCount++; }
  });

  // 手工块序号：直接用 manualRecordsSorted()（按会话过滤+排序）的下标，与 blocks 路由同源；
  // 服务端保证每个通过会话过滤的手工 chunk 都能查到序号（records 与 manualRecordsSorted 过滤口径一致）
  chunks.forEach(function (c) {
    if (c.source === "manual") {
      const ord = manualOrdinals.get(c.id);
      if (ord !== undefined) c.blockIndex = ord;
    }
  });

  // 未覆盖区：union 覆盖范围取补集
  const ranges = chunks.map(function (c) { return { start: c.blockStart, end: c.blockEnd }; }).sort(function (a, b) { return a.start - b.start; });
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  }
  const gapRanges = [];
  let prevEnd = -1;
  for (const m of merged) {
    if (m.start > prevEnd + 1) gapRanges.push({ start: prevEnd + 1, end: m.start - 1 });
    prevEnd = Math.max(prevEnd, m.end);
  }
  if (prevEnd < compactCount - 1) gapRanges.push({ start: prevEnd + 1, end: compactCount - 1 });

  let uncovered = null;
  if (gapRanges.length > 0) {
    uncovered = {
      startIdx: gapRanges[0].start + 1,
      endIdx: gapRanges[0].end + 1,
      count: gapRanges[0].end - gapRanges[0].start + 1,
      gaps: gapRanges.map(function (g) {
        const gInfo = {
          startIdx: g.start + 1,
          endIdx: g.end + 1,
          count: g.end - g.start + 1
        };
        if (includeMessages && !excludeGapMsgs) {
          try {
            const rp = contextCompactor.rangePreview(g.start + 1, g.end + 1);
            if (rp) {
              gInfo.msgs = rp.items || [];
              gInfo.startTime = rp.startTime || "";
              gInfo.endTime = rp.endTime || "";
            }
          } catch (e) {
            console.warn("[preview] 未覆盖区预览失败:", e.message);
          }
        }
        return gInfo;
      })
    };
  }

  // 「实际约」口径：已启用且有摘要的块计摘要字数；取消替换/未生成摘要的块与未覆盖区计原文
  // （与发送侧 applyReplacements「enabled!==false 且有摘要才套用」一致）；隐藏块不进上下文不计入
  const rangeChars = function (s, e) {
    let n = 0;
    for (let i = Math.max(0, s); i <= Math.min(items.length - 1, e); i++) n += String(items[i].msg.content || "").length;
    return n;
  };
  const estCompressedChars = chunks.reduce(function (s, c) {
    if (c.hidden) return s;
    if (c.enabled !== false && c.summary) return s + String(c.summary).length;
    return s + rangeChars(c.blockStart, c.blockEnd);
  }, 0) + gapRanges.reduce(function (s, g) { return s + rangeChars(g.start, g.end); }, 0);

  // 容量提醒 token 分解（2026-09-04 起，管理台展示用）：让用户看清"实际发送"里
  // 未覆盖积压 / 标星原句 / 置顶记忆（永久上下文）/ 图片 各占多少。
  // 均为估算（estimateTokens：中文≈1字/token，其余≈4字符/token；图片每张 EST_IMAGE_TOKENS）。
  const textToken = function (t) { return contextCompactor.estimateTokens(String(t || '')); };
  const rangeText = function (s, e) {
    let out = '';
    for (let i = Math.max(0, s); i <= Math.min(items.length - 1, e); i++) {
      const c = items[i] && items[i].msg && items[i].msg.content;
      if (typeof c === 'string') out += c;
    }
    return out;
  };
  const msgTextTokens = function (m) {
    if (!m) return 0;
    if (typeof m.content === 'string') return textToken(m.content);
    if (Array.isArray(m.content)) {
      let n = 0;
      for (const p of m.content) if (p && p.type === 'text') n += textToken(p.text);
      return n;
    }
    return 0;
  };
  const msgImageCount = function (m) {
    if (!Array.isArray(m.content)) return 0;
    return m.content.filter(function (p) { return p && (p.type === 'image' || p.type === 'image_url'); }).length;
  };
  let _previewMarks = {};
  try { _previewMarks = (contextReplacements.loadMarks && contextReplacements.loadMarks()) || {}; } catch (e) { _previewMarks = {}; }
  let markedTokens = 0, imageTokens = 0;
  (nonSys || []).forEach(function (m) {
    if (!m) return;
    try { if (contextReplacements.isMarkedMsg ? contextReplacements.isMarkedMsg(m, _previewMarks) : !!_previewMarks[contextReplacements.contentKey(m)]) markedTokens += msgTextTokens(m); } catch (e) { /* 单条失败忽略 */ }
    imageTokens += msgImageCount(m) * contextCompactor.EST_IMAGE_TOKENS;
  });
  let pinnedTokens = 0;
  try { pinnedTokens = textToken(memoryEngine.buildPinnedContext ? memoryEngine.buildPinnedContext() : ''); } catch (e) { pinnedTokens = 0; }
  const uncoveredTokens = gapRanges.reduce(function (s, g) { return s + textToken(rangeText(g.start, g.end)); }, 0)
    + chunks.filter(function (c) { return !c.hidden && !(c.enabled !== false && c.summary); })
        .reduce(function (s, c) { return s + textToken(rangeText(c.blockStart, c.blockEnd)); }, 0);
  const activeSummaryTokens = chunks.filter(function (c) { return !c.hidden && c.enabled !== false && c.summary; })
    .reduce(function (s, c) { return s + textToken(c.summary); }, 0);
  const estTotalTokens = uncoveredTokens + activeSummaryTokens + markedTokens + imageTokens + pinnedTokens;
  return {
    enabled: chunks.length > 0,
    config: contextCompactor.loadConfig(),
    totalCompressible: totalCompressible,
    compactCount: compactCount,
    keptRawCount: totalCompressible - chunks.reduce(function (s, c) { return s + (c.blockEnd - c.blockStart + 1); }, 0),
    cutPointsActive: chunks.some(function (c) { return c.source === "manual"; }),
    cutPointConfig: { id: null, matched: 0, configCount: 0 },
    uncovered: uncovered,
    chunks: chunks,
    totals: {
      chunkCount: chunks.length,
      aiCount: chunks.filter(function (c) { return c.source === "ai"; }).length,
      cachedCount: chunks.filter(function (c) { return c.cached; }).length,
      totalChars: totalChars,
      estCompressedChars: estCompressedChars,
      hiddenCount: hiddenCount,
      manualHiddenCount: chunks.filter(function (c) { return c.manualHidden; }).length,
      estSavedChars: Math.max(0, totalChars - estCompressedChars),
      estUncoveredTokens: uncoveredTokens,
      markedTokens: markedTokens,
      imageTokens: imageTokens,
      pinnedTokens: pinnedTokens,
      estTotalTokens: estTotalTokens
    }
  };
}

app.get("/admin/context-compaction/preview", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const includeMessages = req.query.includeMessages === "1";
    const excludeGapMsgs = req.query.excludeGapMsgs === "1";
    const out = buildUnifiedReplacementPreview(includeMessages, excludeGapMsgs);
    // [位置:server.js·GET /admin/context-compaction/preview] [会话级状态机模型合并进概览 config] [用户 1027：概览数据本身早按会话算（onRequest 钩子绑活跃会话），但返回的 config 一直是全局的、不带会话模型，手机端拿它显示总变成「跟随全局」；带 session_id 时补上合并，不带的旧调用（电脑管理台）行为不变] [注释时间 2026-10-27]
    const sid = req.query && (req.query.session_id || req.query.session);
    if (sid && out && out.config) {
      const m = require("./lib/session-cfg").createSessionCfg(__dirname).readCompactionModel(String(sid));
      out.config = Object.assign({}, out.config, { compaction_model_provider: (m && m.provider_id) || "", compaction_model: (m && m.model) || "" });
    }
    reply.send(out);
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});


// 已标星消息列表：统一管理所有被标星的原正文


// 编号范围预览（1-based）：返回范围内每条原文，供未覆盖区滚动窗使用
app.get("/admin/context-compaction/range-preview", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 0;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
    const out = contextCompactor.rangePreview(start, end, { limit: limit, offset: offset });
    // [位置:server.js·range-preview] [附上实际送入模型的字数] [2026-11-06：状态机页按字数提示分块；必须走 conversation-state 的 formatMessages 口径（含工具调用结果），只算消息正文会少一个量级] [注释时间 2026-11-06]
    try {
      const sid = String((req.query && (req.query.session_id || req.query.session)) || "").trim();
      out.chars = conversationState.rangeCharsOf(sid, start, end);
    } catch (e) { out.chars = 0; }
    reply.send(out);
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 读取压缩参数配置
app.get("/admin/context-compaction/config", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const cfg = contextCompactor.loadConfig();
    // 1024-24 需求1：会话级状态机模型（面板「模型选择」）存 session_cfg，不进全局 config.json；GET 按会话合并返回
    const sid = req.query && (req.query.session_id || req.query.session);
    if (sid) {
      const sc = require("./lib/session-cfg").createSessionCfg(__dirname);
      const m = sc.readCompactionModel(String(sid));
      cfg.compaction_model_provider = (m && m.provider_id) || "";
      cfg.compaction_model = (m && m.model) || "";
      // 11-01 #60：会话级状态机提示词选择一并合并返回（套被删时读侧回落，这里如实给空）
      cfg.compaction_prompt_id = sc.readCompactionPrompt(String(sid)) || "";
    }
    reply.send(cfg);
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 保存压缩参数配置
app.post("/admin/context-compaction/config", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    // 1024-24 需求1：compaction_model* 两个字段按会话写 session_cfg（不进全局 config.json）
    const sid = req.query && (req.query.session_id || req.query.session);
    let mdl = null;
    if (sid && (body.compaction_model !== undefined || body.compaction_model_provider !== undefined)) {
      mdl = { provider_id: String(body.compaction_model_provider || ""), model: String(body.compaction_model || "") };
      delete body.compaction_model;
      delete body.compaction_model_provider;
      require("./lib/session-cfg").createSessionCfg(__dirname).saveCompactionModel(String(sid), mdl.provider_id, mdl.model);
    }
    const r = contextCompactor.saveConfig(body);
    if (!r.ok && !mdl) return reply.code(400).send({ error: r.message });
    const cfg = Object.assign(r.ok ? r.config : contextCompactor.loadConfig(), mdl ? { compaction_model_provider: mdl.provider_id, compaction_model: mdl.model } : {});
    reply.send({ ok: true, config: cfg });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 重要内容标记（恢复：前端按消息 key 标记，引擎 buildCompactionPrompt 会重点保留）
app.post("/admin/context-compaction/mark", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  // 1007-17 标星改 msgid：优先用 msg_id 作 marks 主键（稳定、编辑不漂移）；
  // 无 msg_id（老前端/存量调用）时回落原内容键，行为与改动前完全一致。
  // 取消标星时两种 key 都要清（alt_key），避免残留旧内容键导致"取消后仍按原句保留"。
  const key = String(body.msg_id || body.key || "").trim();
  if (!key) return reply.code(400).send({ error: "msg_id/key 无效" });
  const altKey = String(body.key || "").trim();
  try {
    // 标星时把原文一并传给 setMark 存进 marks 文件，
    // 跨窗口注入就能直接读原文，不再依赖回查时间线/替换池
    let content = String(body.content || "");
    let role = String(body.role || "").trim();
    if (!content.trim()) {
      content = "";
      try {
        const items = (contextReplacements.loadItems ? contextReplacements.loadItems() : []) || [];
      for (const it of items) {
        const matched = Array.isArray(it.matched) ? it.matched : [];
        for (const m of matched) {
          if (!m) continue;
          let k = null;
          try { k = contextReplacements.contentKey(m); } catch (e) { console.error('[server.js:5949]', e.message || e); }
          if (k === key) {
            content = typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.map(function(p){return p&&(p.text||p.content)||"";}).join("") : "");
            role = m.role || "";
            break;
          }
        }
        if (content) break;
      }
      } catch (e) { /* 查找失败不阻断标星 */ }
    }
    // 标星与记忆池完全拆开（I5，2026-09-12）：标星只做「原文保留在上下文」，
    // 不再自动写入记忆池；想存记忆走长按菜单「入池」或 AI 工具，池内去重兜底。
    const markRes = contextReplacements.setMark(key, body.marked === true, { content: content, role: role, msg_time: String(body.msg_time || ""), alt_key: body.marked === true ? "" : altKey });
    if (!markRes || markRes.ok === false) {
      return reply.code(400).send({ error: (markRes && markRes.error) || "标星失败" });
    }
    reply.send({ ok: true, key: key, marked: markRes.marked !== false });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 更新已标星消息正文（管理台"已标星消息"编辑）：只更新 content，保留角色与标星时间

// 容量提醒提示词（会话超上限时塞给 AI 的整条提醒；独立配置，与压缩提示词互不关联）
app.get("/admin/context-compaction/ctx-limit-prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    reply.send({ template: contextCompactor.loadCtxLimitPrompt() });
  } catch (err) {
    reply.send({ error: err.message });
  }
});

app.post("/admin/context-compaction/ctx-limit-prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const r = contextCompactor.saveCtxLimitPrompt(req.body && req.body.template);
    if (!r.ok) return reply.code(400).send({ error: r.message });
    reply.send({ ok: true, template: r.template });
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

app.delete("/admin/context-compaction/ctx-limit-prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const r = contextCompactor.resetCtxLimitPrompt();
    reply.send(r);
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});



// ========================
// 会话状态机（2026-10-03 新增， lib/conversation-state.js）
//
// 与上面那套 /admin/context-compaction/* 是两条独立的路：老的仍是「块」语义（并列摘要），
// 新的是「状态」语义（每会话一份持续演化的状态）。阶段一两条并存，存量不动。
// 压缩页用 mode=state 时走这里，mode=block 时走老的那套。
// ========================

function _csSessionOf(req) {
  const q = req.query || {};
  const b = req.body || {};
  return String(q.session || q.session_id || b.session || b.session_id || "").trim();
}

// ── 状态机任务文件（1007-05：独立 worker 进程）──
// gateway 登记任务（status running）→ worker 完成后翻 done/error；
// gateway 启动钩子据它判断「这条 pending 是不是 worker 还在跑」（避免误标中断）。
const STATE_TASKS_FILE = path.join(__dirname, "data", "state_tasks.json");
function readStateTasks() {
  try { return JSON.parse(fs.readFileSync(STATE_TASKS_FILE, "utf8")); } catch (e) { return []; }
}
function writeStateTasks(tasks) {
  const tmp = STATE_TASKS_FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(tasks));
  fs.renameSync(tmp, STATE_TASKS_FILE); // 原子换名，防双进程并发读读到半个文件
}
function stateWorkerUrl() {
  const port = Number(process.env.STATE_WORKER_PORT || 3110);
  return "http://127.0.0.1:" + port;
}

app.get("/admin/conversation-state", { preHandler: basicAuth }, async (req, reply) => {
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    // 顺带回带候选状态：省得管理台再发一次请求就能同时拿到「当前状态 + 待确认候选」
    const st = conversationState.getState(sid);
    st.candidate = conversationState.getCandidate(sid);
    reply.send(st);
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

// 1007 上下文快照 v2：状态查询 + 手动重建（管理台按钮）
// 快照 = 前缀缓存（人设+V2块+工具+历史冻死）。三类自动重建：状态摘要更新/编辑消息/历史摘要更新；
// 其余（工具定义/人设变化）一律不重建，靠这里手动重建。
app.get("/admin/ctx-snapshot-v2", { preHandler: basicAuth }, async (req, reply) => {
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    const sv = require("./context/context-snapshot-v2");
    const snap = sv.loadSnapshot(__dirname, sid);
    return reply.send({
      ok: true,
      session_id: sid,
      exists: !!snap,
      stale: sv.isStale(__dirname, sid),
      created_at: snap && snap.created_at || null,
      updated_at: snap && snap.updated_at || null,
      // 1007-17 第三步：新结构存 entries（id 列表），旧结构存 history；1008 方案A：v3 存 content+snap_point。
      // 三个都给，便于诊断迁移状态。
      entries_len: snap && Array.isArray(snap.entries) ? snap.entries.length : 0,
      history_len: snap && Array.isArray(snap.history) ? snap.history.length : 0,
      content_len: snap && Array.isArray(snap.content) ? snap.content.length : 0,
      snap_point: snap && Number.isFinite(snap.snap_point) ? Number(snap.snap_point) : null,
      v2_blocks: snap && Array.isArray(snap.v2_blocks) ? snap.v2_blocks.length : 0,
      tools: snap && Array.isArray(snap.tools) ? snap.tools.length : (snap && snap.tools === null ? "pending(未回填)" : 0),
      tail_start: snap ? (Number(snap.tail_start) || 0) : null,
      fp: snap && snap.fp || "",
      state_fp: snap && snap.state_fp || "",
      tools_fp: snap && snap.tools_fp || "",
    });
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

app.post("/admin/ctx-snapshot-v2/rebuild", { preHandler: basicAuth }, async (req, reply) => {
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    const sv = require("./context/context-snapshot-v2");
    // 手动重建：删除快照文件 + 清失效标记 → 下次请求懒生成全新快照
    sv.deleteSnapshot(__dirname, sid);
    sv.clearStale(__dirname, sid);
    console.log("[ctx-snapshot-v2] 手动重建已触发 session=" + sid);
    return reply.send({ ok: true, session_id: sid, message: "快照已删除，下次请求自动重建" });
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

// 丢弃某会话的待确认候选（用户不想要这份了；不调模型、不可恢复——要留着就点确认并入）
app.post("/admin/conversation-state/candidate/discard", { preHandler: basicAuth }, async (req, reply) => {
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    reply.send(conversationState.clearCandidate(sid));
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

app.get("/admin/conversation-state/version", { preHandler: basicAuth }, async (req, reply) => {
  const sid = _csSessionOf(req);
  const v = Number((req.query || {}).version);
  if (!sid || !Number.isInteger(v)) return reply.code(400).send({ error: "缺少 session 或 version" });
  try {
    reply.send(conversationState.getVersionText(sid, v));
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

// 预览：调 LLM 出候选状态 + 操作清单。前端拿去做 diff 面板。
// 1007-05 异步化：原实现是 gateway 进程内同步长请求（nginx 620s 超时 + gateway 重启/推送即掐断，
// 10-07 实测两次被断）。现改为：登记任务（写 pending 日志 + 任务文件）→ 转发独立进程
// state-worker（后台调 LLM）→ 立即返回 submitted。候选由 worker 落盘 CANDIDATE_FILE，
// 日志由 worker 回调 /internal/state-log 更新，前端轮询 /admin/conversation-state 收结果。
app.post("/admin/conversation-state/preview", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  const start = Number(body.start);
  const end = Number(body.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return reply.code(400).send({ error: "区间参数不正确" });
  }
  if (end - start + 1 > 1000) {
    return reply.code(400).send({ error: "区间过大（1000 条以内），分几次并入" });
  }
  // 同一会话已有任务在跑 → 拒绝（worker 侧还有 running 判重，双保险）
  try {
    const tasksNow = readStateTasks();
    if (tasksNow.some(function (t) { return t && t.session === sid && t.status === "running"; })) {
      return reply.code(409).send({ error: "这个会话已经有一个生成任务在跑，等它出结果再试" });
    }
  } catch (e) { /* 任务文件读失败不阻断，worker 侧兜底 */ }
  // 1011-03：已有未确认候选时禁止静默覆盖——除非前端确认后显式带 overwrite:true。
  // 10-11 事故：旧候选被自动重算无条件覆盖丢失，用户没点丢弃的候选必须一直保留。
  try {
    const candNow = conversationState.getCandidate(sid);
    if (candNow && candNow.ok && candNow.exists && body.overwrite !== true) {
      const ex = candNow.candidate || {};
      return reply.code(409).send({
        error: "这个会话已有一份未确认的候选（" + String(ex.state || "").length + " 字，" +
          (ex.created_at || "时间未知") + " 生成）。重新生成会覆盖它；确认覆盖请带 overwrite 重新提交",
        conflict: true,
        existing_candidate: {
          chars: String(ex.state || "").length,
          created_at: ex.created_at || null,
        },
      });
    }
  } catch (e) { /* 读候选失败不阻断，worker 侧 previewMerge 兜底 */ }
  // 1) 登记 pending 日志（id 传给 worker，跨进程更新同一日志条目）
  const entry = addCompactionLog({
    label: "状态并入 · " + sid.slice(-12),
    session: sid,
    status: "pending",
    action: "state",
    message: "正在算新状态：第 " + start + "~" + end + " 条（" + (end - start + 1) + " 条，后台计算中）",
  });
  // 2) 写任务文件（带 overwrite 标记，worker 执行 previewMerge 时透传）
  try {
    const tasks = readStateTasks();
    tasks.push({ id: entry.id, session: sid, start: start, end: end, overwrite: body.overwrite === true, status: "running", createdAt: new Date().toISOString() });
    writeStateTasks(tasks);
  } catch (e) { console.warn("[state-worker] 任务文件写入失败:", e.message); }
  // 3) 转发 worker（不可达/拒绝 → 日志翻 error，前端能看到）
  try {
    const r = await httpPostJson(stateWorkerUrl() + "/state/run", JSON.stringify({
      logId: entry.id, session: sid, start: start, end: end, overwrite: body.overwrite === true,
    }), { "X-Internal-Key": readEnvValue("INTERNAL_API_KEY") }, 8000);
    if (r && r.ok === false) {
      addCompactionLog({ id: entry.id, status: "error", message: String(r.error || "worker 拒绝任务") });
    }
  } catch (e) {
    addCompactionLog({ id: entry.id, status: "error", message: "生成服务（state-worker）不可达：" + ((e && e.message) || String(e)) });
  }
  reply.send({ ok: true, submitted: true, logId: entry.id });
});

// 确认并入：blocked 里列出的 remove 不生效（前端「阻止删除」）
app.post("/admin/conversation-state/commit", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    // 1007 上下文快照 v2：状态摘要更新 → 标记快照失效（下次请求重建）
    require("./context/context-snapshot-v2").markStale(__dirname, sid, "state-commit");
    const r = conversationState.commitMerge({
      session: sid,
      state: body.state,
      ops: body.ops,
      blocked: body.blocked,
      start_msg: body.start_msg,
      end_msg: body.end_msg,
      range_label: body.range_label,
      label_start: body.label_start,
      label_end: body.label_end,
      count: body.count,
      source: body.source,
    });
    reply.send(r);
  } catch (err) {
    reply.code(400).send({ error: (err && err.message) || String(err) });
  }
});

// 手动改当前状态正文（2026-10-04）：直接覆盖当前版、保存即生效、不产生新版本。
// 与 undo 一样是破坏性写操作，但改的是正文不是状态记录——加同样的 confirm 闸，
// 避免「探测接口存在性」这类空 body 请求真的把状态正文清空。
app.post("/admin/conversation-state/edit", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  if (body.confirm !== true) {
    return reply.code(400).send({ error: "改写状态正文需要显式确认：请带 confirm:true（会直接覆盖当前版本的正文）" });
  }
  try {
    // 1007 上下文快照 v2：状态正文编辑 → 标记快照失效
    require("./context/context-snapshot-v2").markStale(__dirname, sid, "state-edit");
    reply.send(conversationState.editStateText({ session: sid, text: body.text }));
  } catch (err) {
    reply.code(400).send({ error: (err && err.message) || String(err) });
  }
});

app.post("/admin/conversation-state/rollback", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    // 1007 上下文快照 v2：状态回滚 → 标记快照失效
    require("./context/context-snapshot-v2").markStale(__dirname, sid, "state-rollback");
    reply.send(conversationState.rollback({ session: sid, version: body.version }));
  } catch (err) {
    reply.code(400).send({ error: (err && err.message) || String(err) });
  }
});

// 撤销最后一次并入：覆盖区间退回，被吃掉的那段原文回到未覆盖区
//
// 2026-10-04 加 confirm 闸（1004-03 事故的根因修复）：
//   原实现只凭 URL 的 session_id 就能执行——一个空 body 的 POST 就会把整条状态删掉。
//   探测接口存在性（curl 空 body 看返回码）这种完全无害的操作，真的会删生产数据。
//   undo 删的是不可逆的东西（版本链虽保留，但用户视角状态直接消失），所以要求调用方
//   显式声明「我知道这会撤销」，前端在 confirm 弹窗通过后带 confirm:true。
app.post("/admin/conversation-state/undo", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  if (body.confirm !== true) {
    return reply.code(400).send({ error: "撤销需要显式确认：请带 confirm:true（撤销会移除当前状态，被吃掉的那段原文回到未覆盖区）" });
  }
  try {
    reply.send(conversationState.undoLastMerge({ session: sid }));
  } catch (err) {
    reply.code(400).send({ error: (err && err.message) || String(err) });
  }
});

/* [位置:server.js·POST /admin/conversation-state/cancel] [暂停压缩] [/compact 收尾入口的「暂停」（随手记 #20，11-14）：转发 state-worker /state/cancel，worker 内存取消集合 + previewMerge 模型循环批间检查；命中走既有失败路径，不落候选、不动时间线。先看任务文件没有 running 就不转发，省一趟；手动面板「并入状态」跑的任务同样能被它停] [注释时间 2026-11-14] */
app.post("/admin/conversation-state/cancel", { preHandler: basicAuth }, async (req, reply) => {
  const sid = _csSessionOf(req);
  if (!sid) return reply.code(400).send({ error: "缺少 session 参数" });
  try {
    const tasksNow = readStateTasks();
    if (!tasksNow.some(function (t) { return t && t.session === sid && t.status === "running"; })) {
      return reply.send({ ok: false, error: "这个会话没有在跑的压缩任务" });
    }
  } catch (e) { /* 任务文件读失败不阻断，worker 侧兜底 */ }
  try {
    const r = await httpPostJson(stateWorkerUrl() + "/state/cancel", JSON.stringify({ session: sid }),
      { "X-Internal-Key": readEnvValue("INTERNAL_API_KEY") }, 8000);
    if (!r || r.ok === false) return reply.code(502).send({ error: (r && r.error) || "worker 拒绝取消" });
    return reply.send(r);
  } catch (e) {
    return reply.code(502).send({ error: "生成服务（state-worker）不可达：" + ((e && e.message) || String(e)) });
  }
});

// 状态机提示词：读 / 存 / 恢复默认
app.get("/admin/conversation-state/prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    reply.send(conversationState.loadPromptConfig());
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

app.post("/admin/conversation-state/prompt", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  try {
    if (String(body.action || "") === "reset") {
      return reply.send(conversationState.resetPromptConfig());
    }
    reply.send(conversationState.savePromptConfig(body.system, body.user_template));
  } catch (err) {
    reply.code(400).send({ error: err.message });
  }
});

// 状态机提示词多套清单（11-01 #60）：GET = 全部套 + 本会话选中；POST = save 新建/编辑一套、delete 删一套、select 换本会话用哪套。
// 旧的全局单套路由（/admin/conversation-state/prompt）原样保留：全局默认仍从它读，会话没选套时生效逻辑不变。
app.get("/admin/context-compaction/prompts", { preHandler: basicAuth }, async (req, reply) => {
  try {
    /* [位置:server.js·GET /admin/context-compaction/prompts] [多套状态机提示词读] [11-01 #60：清单+本会话选中一次带回；选中的套已被删时按空返回（生效侧 loadPromptConfig 同样回落全局，两边口径一致）] [注释时间 2026-11-01] */
    const sid = String((req.query && (req.query.session_id || req.query.session)) || "").trim();
    const list = conversationState.listPrompts();
    let selected = "";
    if (sid) {
      const pid = require("./lib/session-cfg").createSessionCfg(__dirname).readCompactionPrompt(sid);
      if (pid && list.some((p) => p && p.id === pid)) selected = pid;
    }
    reply.send({ list: list, selected: selected });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

app.post("/admin/context-compaction/prompts", { preHandler: basicAuth }, async (req, reply) => {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const action = String(body.action || "");
  try {
    /* [位置:server.js·POST /admin/context-compaction/prompts] [多套状态机提示词写] [11-01 #60：save/delete 走 listPrompts 同源的清单函数（迁移内置）；select 把套 id 落 session_cfg（分支继承自动带上），选空=回到跟随默认；select 的 id 必须真实存在，防止下拉之外写进死引用] [注释时间 2026-11-01] */
    if (action === "save") {
      const rec = conversationState.savePromptRec(body.id, body.name, body.system, body.user_template);
      return reply.send({ ok: true, rec: rec, list: conversationState.listPrompts() });
    }
    if (action === "delete") {
      if (!conversationState.deletePromptRec(body.id)) return reply.code(404).send({ error: "这套提示词不存在或已删过" });
      return reply.send({ ok: true, list: conversationState.listPrompts() });
    }
    if (action === "select") {
      const sid = String((req.query && (req.query.session_id || req.query.session)) || "").trim();
      if (!sid) return reply.code(400).send({ error: "select 需要 session_id" });
      const id = String(body.id || "").trim();
      if (id && !conversationState.listPrompts().some((p) => p && p.id === id)) {
        return reply.code(404).send({ error: "这套提示词不存在" });
      }
      const selected = require("./lib/session-cfg").createSessionCfg(__dirname).saveCompactionPrompt(sid, id);
      return reply.send({ ok: true, selected: selected });
    }
    return reply.code(400).send({ error: "action 要是 save / delete / select" });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 状态机「自动分块」的切点计算（只算切点、不建块）。旧压缩块的 reset/remove_at/toggle/hide/add 等操作已随压缩块功能下线（11-04 清理），
// 存量旧块只由状态机并入时自动 retire/restore，不再有手工管理入口。
app.post("/admin/context-compaction/blocks", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const action = String(body.action || "");
  try {
    if (action !== "split_range") {
      return reply.code(400).send({ error: "只支持 action=split_range（dryRun，只算切点）；压缩块的手工管理已下线" });
    }
    if (body.dryRun !== true) {
      return reply.code(400).send({ error: "自动分块只支持 dryRun（只算切点，供状态机并入用）" });
    }
    const start = Number(body.start);
    const end = Number(body.end);
    const gapMinutes = Number(body.gapMinutes);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return reply.code(400).send({ error: "start/end 必须是 start<=end 的正整数（编号 1-based）" });
    }
    const ccCfg = contextCompactor.loadConfig ? (contextCompactor.loadConfig() || {}) : {};
    const r = contextReplacements.splitRangeByGaps(start - 1, end - 1, {
      gapMinutes: gapMinutes,
      chunkSize: Number(body.chunkSize) || Number(ccCfg.compaction_chunk_size) || 100,
      chunkMin: Number(body.chunkMin) || Number(ccCfg.compaction_chunk_min) || 40,
      chunkMax: Number(body.chunkMax) || Number(ccCfg.compaction_chunk_max) || 160,
      dryRun: true
    });
    if (!r.ok) return reply.send({ ok: false, message: r.message });
    return reply.send({
      ok: true, action: "split_range", count: r.count, gapMinutes: gapMinutes,
      segments: r.segments || [],
      dryRun: true
    });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// 摘要生成：gap = 未覆盖区按范围新建手工记录并生成替换正文（默认不启用，需点「替换」才生效）；
// block = 已有手工记录重新生成正文
// 2026-09-02 起摘要生成/替换不再自动解析入池：入池统一由管理台手动触发
//（「解析入池」= LLM 提炼；「一键入池」= 摘要全文直接入库，均不自动跑）


// ---------------- 摘要生成日志（文件持久化，保留当天；重启不丢） ----------------
// 2026-09-29：原「最近 10 条」改「当天」——生成任务多时 10 条放不下（keh3 一次批量 35 块），
// 当天 00:00（服务器本地时区，+8）之后的条目全保留，跨天自动清出；已读角标逻辑不受影响（不清日志）。
const COMPACTION_LOG_FILE = path.join(__dirname, "data", "compaction_log.json");
function compactionLogDayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function inCompactionLogDay(l) {
  try { return !!(l && new Date(l.time).getTime() >= compactionLogDayStart()); }
  catch (e) { return false; }
}
let compactionLogs = [];
try {
  const loaded = JSON.parse(fs.readFileSync(COMPACTION_LOG_FILE, "utf8"));
  if (Array.isArray(loaded)) compactionLogs = loaded.filter(inCompactionLogDay);
} catch (e) { compactionLogs = []; }
function persistCompactionLogs() {
  try { fs.writeFileSync(COMPACTION_LOG_FILE, JSON.stringify(compactionLogs.filter(inCompactionLogDay))); } catch (e) { /* 持久化失败不影响运行 */ }
}

// 1007-05：启动时把"残留 pending"标为中断——生成/状态机任务是内存态，gateway 重启即中断，
// 但 pending 日志条目不翻状态会永远显示"进行中"（02:43/17:18 两次实测）。规则：
// status=pending 且 无同 id 已被翻状态的条目（同 id 更新=同一任务的 pending→success/error）
// 且 无更晚的同 action 成功/失败条目（distill「开始跑」与「完成」是两条独立条目，有后继=已完成）
// → 判定为重启中断，标 status=interrupted，前端显示「中断」。
(function markInterruptedOnBoot(){
  try {
    // 1007-05：任务文件里还在 running 的（独立进程 state-worker 还活着在算）不标中断，
    // 等 worker 完成回调翻状态；无任务记录的残留 pending（老路径）照旧标中断。
    const runningTaskIds = (function () {
      try {
        return readStateTasks().filter(function (t) { return t && t.status === "running"; }).map(function (t) { return t.id; });
      } catch (e) { return []; }
    })();
    let changed = false;
    compactionLogs.forEach(function (l) {
      if (!l || l.status !== "pending") return;
      if (runningTaskIds.indexOf(l.id) !== -1) return;
      const idUpdated = compactionLogs.some(function (o) { return o !== l && o.id === l.id && o.status !== "pending"; });
      if (idUpdated) return;
      const laterDone = compactionLogs.some(function (o) {
        return o !== l && o.action === l.action && (o.status === "success" || o.status === "error" || o.status === "skipped") &&
          new Date(o.time).getTime() > new Date(l.time).getTime();
      });
      if (laterDone) return;
      l.status = "interrupted";
      l.message = "（服务重启中断）" + String(l.message || "");
      changed = true;
    });
    if (changed) persistCompactionLogs();
  } catch (e) { /* 标记失败不影响启动 */ }
})();
function addCompactionLog(entry) {
  const now = new Date().toISOString();
  // 1003-25：防字符串入参（memory-summary/backfill 的 log 曾直接传字符串，
  // 被 Object.assign 按字符索引拆成 {"0":"[","1":"m"...} 垃圾，前端显示「未知操作进行中」）
  if (entry == null) return null;
  if (typeof entry !== "object") {
    entry = { label: "后台任务", status: "success", message: String(entry) };
  }
  // 2026-09-29 修复：带 id 的 entry 是"更新已有日志"（生成任务的 pending→success/error 翻状态），
  // 原实现总是 unshift 新建 → 同一次生成产生 pending+success 两条、且前端 trackedGenId 只匹配
  // logs[0]，多点几次生成后 id 错位 → 消息栏永远"进行中"。更新时原地替换并移到最前
  // （保持"最新状态"在 logs[0]），time 刷新为本次更新时间（前端显示完成时刻）。
  if (entry && entry.id) {
    const idx = compactionLogs.findIndex(function (l) { return l && l.id === entry.id; });
    if (idx >= 0) {
      const old = compactionLogs[idx];
      compactionLogs.splice(idx, 1);
      const merged = Object.assign({}, old, entry, { id: old.id, time: now });
      compactionLogs.unshift(merged);
      persistCompactionLogs();
      return merged;
    }
  }
  // 1004-12：调度启动日志去重——gateway 每次重启各模块都写一条，同一天同模块只保留一条（刷新时间不新增）
  if (entry.action === "system" && String(entry.message || "").indexOf("调度已启动") >= 0) {
    const prefix = String(entry.message || "").split("：")[0];
    const dup = compactionLogs.find(function (l) {
      return l && l.action === "system" && String(l.message || "").indexOf("调度已启动") >= 0 &&
        String(l.message || "").split("：")[0] === prefix;
    });
    if (dup) {
      dup.time = now;
      persistCompactionLogs();
      return dup;
    }
  }
  const log = Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), time: now }, entry);
  compactionLogs.unshift(log);
  compactionLogs = compactionLogs.filter(inCompactionLogDay);
  persistCompactionLogs();
  return log;
}

app.get("/admin/context-compaction/logs", { preHandler: basicAuth }, (req, reply) => {
  reply.send({ logs: compactionLogs, max: compactionLogs.length });
});

// [位置:server.js·logs/clear] [清空本会话日志] [2026-11-06：状态机页底部「清空」按钮；只删该会话的记录（新条目按 session 精确匹配、旧条目按 label 尾号回退），别的会话与后台任务不动；正在算（pending）的留着——worker 完成回调还要按 id 更新它，删了会重新长出一条] [注释时间 2026-11-06]
app.post("/admin/context-compaction/logs/clear", { preHandler: basicAuth }, (req, reply) => {
  const sid = String((req.body && req.body.session) || "").trim();
  if (!sid) return reply.code(400).send({ error: "缺少 session（只支持清本会话日志）" });
  const before = compactionLogs.length;
  const r = compactionLogMatch.clearSession(compactionLogs, sid);
  compactionLogs = r.logs;
  persistCompactionLogs();
  reply.send({ ok: true, removed: r.removed, kept: r.kept, left: compactionLogs.length, before: before });
});


// 环境变量获取
app.get("/admin/env", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const diaryEntries = readDiaryEntries();
    // 2026-10-03：日记改 data/diary.json，字段 id/session/hidden/created_at/content
    const diaryData = diaryEntries.map(e => ({
      id: e.id, session: e.session,
      time: formatDateTimeInTimeZone(new Date(e.created_at), TIME_ZONE),
      content: e.content, hidden: e.hidden
    }));
    reply.send({
      uptime: Math.floor(process.uptime()),
      wakeStatus: wakeUpLastHeartbeat ? "在线（上次心跳: " + formatDateTimeInTimeZone(new Date(wakeUpLastHeartbeat), TIME_ZONE) + "）" : "离线或未启动",
      apiUrl: readEnvValue("TARGET_API_URL"),
      model: readEnvValue("MODEL_NAME"),
      icon: readEnvValue("CUSTOM_ICON_URL"),
      gatewayKey: !!readEnvValue("GATEWAY_API_KEY"),
      wake: {
        dayWakeAfter: readEnvValueOrDefault("DAY_WAKE_AFTER_MINUTES", "60"),
        nightWakeAfter: readEnvValueOrDefault("NIGHT_WAKE_AFTER_MINUTES", "180"),
        dayCheckInterval: readEnvValueOrDefault("DAY_CHECK_INTERVAL_MINUTES", "60"),
        nightCheckInterval: readEnvValueOrDefault("NIGHT_CHECK_INTERVAL_MINUTES", "180"),
        dayStartHour: readEnvValueOrDefault("WAKE_DAY_START_HOUR", "10"),
        dayEndHour: readEnvValueOrDefault("WAKE_DAY_END_HOUR", "24")
      },
      weather: {
        enabled: readEnvValueOrDefault("WEATHER_ENABLED", "false"),
        locationName: readEnvValue("WEATHER_LOCATION_NAME"),
        lat: readEnvValue("WEATHER_LAT"),
        lon: readEnvValue("WEATHER_LON"),
        units: readEnvValueOrDefault("WEATHER_UNITS", "metric")
      },
      env: {
        // 非敏感字段明文返回；密钥类只回传是否已配置，避免把凭据发给前端（表单留空=保存时保留原值）
        TARGET_API_URL: readEnvValue("TARGET_API_URL"),
        TARGET_API_KEY: "",
        TARGET_API_KEY_SET: Boolean(readEnvValue("TARGET_API_KEY")),
        MODEL_NAME: readEnvValue("MODEL_NAME"),
        BARK_KEY: "",
        BARK_KEY_SET: Boolean(readEnvValue("BARK_KEY")),
        GATEWAY_API_KEY: "",
        GATEWAY_API_KEY_SET: Boolean(readEnvValue("GATEWAY_API_KEY")),
        CUSTOM_ICON_URL: readEnvValue("CUSTOM_ICON_URL"),
        DAY_WAKE_AFTER_MINUTES: readEnvValueOrDefault("DAY_WAKE_AFTER_MINUTES", "60"),
        NIGHT_WAKE_AFTER_MINUTES: readEnvValueOrDefault("NIGHT_WAKE_AFTER_MINUTES", "180"),
        DAY_CHECK_INTERVAL_MINUTES: readEnvValueOrDefault("DAY_CHECK_INTERVAL_MINUTES", "60"),
        NIGHT_CHECK_INTERVAL_MINUTES: readEnvValueOrDefault("NIGHT_CHECK_INTERVAL_MINUTES", "180"),
        WAKE_DAY_START_HOUR: readEnvValueOrDefault("WAKE_DAY_START_HOUR", "10"),
        WAKE_DAY_END_HOUR: readEnvValueOrDefault("WAKE_DAY_END_HOUR", "24"),
        WEATHER_ENABLED: readEnvValueOrDefault("WEATHER_ENABLED", "false"),
        WEATHER_LOCATION_NAME: readEnvValue("WEATHER_LOCATION_NAME"),
        WEATHER_LAT: readEnvValue("WEATHER_LAT"),
        WEATHER_LON: readEnvValue("WEATHER_LON"),
        WEATHER_UNITS: readEnvValueOrDefault("WEATHER_UNITS", "metric"),
        ALLOW_PUBLIC_API: readEnvValueOrDefault("ALLOW_PUBLIC_API", "false"),
        PUSH_PROVIDER: readEnvValueOrDefault("PUSH_PROVIDER", "bark"),
        USER_DISPLAY_NAME: readEnvValue("USER_DISPLAY_NAME"),
        AI_DISPLAY_NAME: readEnvValue("AI_DISPLAY_NAME"),
        DIARY_ENABLED: readEnvValueOrDefault("DIARY_ENABLED", "true"),
        DIARY_DIR: readEnvValueOrDefault("DIARY_DIR", "diary"),
        PORT: readEnvValueOrDefault("PORT", "3000")
      },
      diary: diaryData
    });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});



// 小世界门户「留纸」页 API（2026-09-12）：与站点其它门户 API 同口径公开（单人流站点，nginx SSL 层）
app.get("/papers/api/list", async (req, reply) => {
  try {
    // 2026-10-03：留纸改 data/papers.json，接口按 id 点名
    const papers = require("./lib/papers");
    const list = papers.listPapers().slice(0, 100).map(e => ({
      id: e.id, session: e.session, title: e.title, time: e.time
    }));
    reply.send({ papers: list });
  } catch (err) {
    console.error("[papers] 门户列表失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

app.get("/papers/api/read", async (req, reply) => {
  try {
    const paperStore = require("./lib/paper-store");
    const e = paperStore.getEntry(__dirname, (req.query || {}).id);
    if (!e) return reply.code(404).send({ error: "纸不存在" });
    reply.send({ id: e.id, title: e.title, content: e.content });
  } catch (err) {
    console.error("[papers] 门户读取失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// ===== MCP 工具（tools_server.py）经内部接口读写留纸（2026-10-03；2026-11-25 支持按会话绑定多本笔记本隔离）=====
// 写操作集中在网关单进程，避免多进程并发写 papers.json；鉴权由全局 /internal 钩子处理。
function _paperNbBase(req) {
  const sid = String((req.query && req.query.session_id) || (req.body && req.body.session_id) || "").trim();
  const nb = require("./lib/notebooks").resolveForSession(__dirname, sid);
  return nb.baseDir; // null 表示当前会话未绑定笔记本
}
app.post("/internal/paper", async (req, reply) => {
  try {
    const body = req.body || {};
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    // 10-29：AI add 带 folder（完整路径，不存在会自动出现）；关键词 tags 与分类 category 不收（关键词只有用户能写）
    const papers = require("./lib/papers");
    const r = papers.withBaseDir(nbBase, () => papers.portalAdd({
      content: body.content, title: body.title, summary: body.summary, reason: body.reason, folder: body.folder,
    }));
    if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "留纸失败" });
    /* [位置:routes/server.js·/internal/paper 回包] [超长拆篇要把 ids 全回给工具] [11-16：正文超 20000 字会拆成多篇（标题·1/·2），只回一个 id 的话 AI 不知道后面还有几篇] [注释时间 2026-11-16] */
    reply.send({ success: true, id: r.id, ids: r.ids || [r.id], parts: r.parts || 1, titles: r.titles || [r.title],
      title: r.title, summary: r.summary || "", reason: r.reason || "",
      folder: body.folder ? String(body.folder).trim() : "",
      created_at: r.created_at, updated_at: r.updated_at, chars: r.chars, time: r.time });
  } catch (err) {
    console.error("[internal/paper] 留纸失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
// 读留纸：不带参=最近 10 张列表（id/标题/时间/会话）；带 id=N=那一张全文
app.get("/internal/paper/view", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const papers = require("./lib/papers");
    const id = String((req.query || {}).id || "").trim();
    if (id) {
      const paperStore = require("./lib/paper-store");
      const e = paperStore.getEntry(nbBase, id);
      if (!e) return reply.code(404).send({ error: "纸不存在：id=" + id });
      // 1003-20：补创建时间（与列表同口径）
      const _tu = require("./utils/time_utils");
      const _dp = _tu.getDatePartsInTimeZone(new Date(e.created_at), _tu.resolveTimeZone());
      return reply.send({ id: e.id, title: e.title || "", summary: e.summary || "", reason: e.reason || "",
        folder: e.folder || "",
        created_at: e.created_at, updated_at: e.updated_at || e.created_at,
        time: _dp.year + "-" + _dp.month + "-" + _dp.day + " " + _dp.hour + ":" + _dp.minute,
        content: String(e.content || "").trim() });
    }
    // 1009-10：limit 控制列表张数（默认 10，上限 50），tools_server view_paper 透传
    let limit = parseInt(String((req.query || {}).limit || "10"), 10);
    if (!Number.isInteger(limit) || limit < 1) limit = 10;
    if (limit > 50) limit = 50;
    const all = papers.withBaseDir(nbBase, () => papers.listPapers());
    const list = all.filter(e => !e.is_index).slice(0, limit).map(e => ({
      id: e.id, title: e.title, summary: e.summary, folder: e.folder || "",
      time: e.time, created_at: e.created_at, updated_at: e.updated_at,
    }));
    reply.send({ papers: list, total: all.length,
      message: "带 id=编号 可看对应那张全文；limit 控制列表张数（默认10，最多50）" });
  } catch (err) {
    console.error("[internal/paper/view] 读留纸失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 2026-10-16 工具集 v2：notebook 工具的分类概览 / 查询搜索 / 编辑（鉴权同上，走全局 /internal 钩子）
app.get("/internal/paper/overview", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const papers = require("./lib/papers");
    reply.send(papers.withBaseDir(nbBase, () => papers.categoryOverview()));
  } catch (err) {
    console.error("[internal/paper/overview] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
app.get("/internal/paper/query", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const q = req.query || {};
    const papers = require("./lib/papers");
    reply.send(papers.withBaseDir(nbBase, () => papers.queryPapers({ q: q.q, limit: q.limit, offset: q.offset, folder: q.folder })));
  } catch (err) {
    console.error("[internal/paper/query] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
app.post("/internal/paper/edit", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const b = req.body || {};
    const papers = require("./lib/papers");
    const r = papers.withBaseDir(nbBase, () => papers.editPaper({
      id: b.id, mode: b.mode, content: b.content, old: b.old, new: b.new, replace_all: b.replace_all, title: b.title, summary: b.summary, reason: b.reason,   // 不收 category / tags（见上）；2026-11-21 新增 old/new/replace_all 局部替换
    }));
    if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "编辑失败" });
    reply.send(Object.assign({ success: true }, r));
  } catch (err) {
    console.error("[internal/paper/edit] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 10-29：AI 工具的文件夹操作（notebook action=folder_add / edit 改文件夹摘要）。
// folder 参数认 fid（目录清单里的 f1/f2…，随增删漂移，以当前概览为准）或完整路径（稳定，推荐）。
function paperFolderRef(v, nbBase) {
  const s = String(v == null ? "" : v).trim();
  if (!/^f\d+$/i.test(s)) return s;
  const papers = require("./lib/papers");
  const hit = papers.withBaseDir(nbBase, () => papers.portalFoldersBrief()).find(r => r.fid.toLowerCase() === s.toLowerCase());
  return hit ? hit.path : null;
}
app.post("/internal/paper/folder/add", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const papers = require("./lib/papers");
    const r = papers.withBaseDir(nbBase, () => papers.portalFolderAddDeep((req.body || {}).path));
    if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "新建文件夹失败" });
    reply.send(Object.assign({ success: true }, r));
  } catch (err) {
    console.error("[internal/paper/folder/add] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
app.post("/internal/paper/folder/edit", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const b = req.body || {};
    const ref = paperFolderRef(b.folder, nbBase);
    if (!ref) return reply.code(400).send({ error: "没有这个文件夹（fid 要用目录清单里当前的；或直接给完整路径）" });
    const papers = require("./lib/papers");
    const r = papers.withBaseDir(nbBase, () => papers.portalFolderSummary(ref, b.summary));
    if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "改摘要失败" });
    reply.send(Object.assign({ success: true, folder: r.path }, r));
  } catch (err) {
    console.error("[internal/paper/folder/edit] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

/* [位置:server.js·/internal/paper/pin] [AI 工具置顶/取消置顶笔记] [11-02：notebook edit 传 pinned；置顶的笔记全文进上下文 Pinned Notes 块（重建快照时更新），目录行标题带·已置顶] [注释时间 2026-11-02] */
app.post("/internal/paper/pin", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const b = req.body || {};
    const papers = require("./lib/papers");
    const r = papers.withBaseDir(nbBase, () => papers.pinPaper(b.id, b.pinned));
    if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "置顶失败" });
    reply.send(Object.assign({ success: true }, r));
  } catch (err) {
    console.error("[internal/paper/pin] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 2026-10-22 批 B：小手机笔记本页的读写（用户视角：关键词 / 目录笔记 / 增删改 / 本机笔记迁入）；auth 同 /xie-diary/api
require("./routes/papers-portal")(app, { auth: xieDiaryAuth, baseDir: __dirname });

// ========================
// 门户：谢的日记（2026-09-13 只读；2026-09-19 批6 D1 增隐藏状态与切换）
// 数据源 = diary/ 全目录（共享层 + 各会话目录），与跨窗口注入同一扫描口径但**不做日期边界**：
// 这是用户自己的阅览页，已隐藏篇置灰标出（hidden=true），可一键恢复；隐藏只影响注入给 AI。
// ========================
function xieDiaryAuth(req, reply, done) {
  // 门户日记口令门（2026-09-20）：Bearer GATEWAY_API_KEY / X-API-Key，或已登录管理台会话 cookie 放行
  const configuredKey = readEnvValue("GATEWAY_API_KEY");
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const headerKey = String(req.headers["x-api-key"] || "").trim();
  if (configuredKey && (bearer === configuredKey || headerKey === configuredKey)) return done();
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.admin_session && validSessionToken(cookies.admin_session)) return done();
  } catch (e) { console.error('[server.js:6730]', e.message || e); }
  reply.code(401).send({ error: "需要访问口令" });
}
// ===== MCP 工具（tools_server.py）经内部接口读写日记（2026-10-03）=====
// 写操作集中在网关单进程，避免多进程并发写 diary.json；鉴权由全局 /internal 钩子处理。
app.post("/internal/diary", async (req, reply) => {
  try {
    const body = req.body || {};
    const sid = body.session_id ? String(body.session_id).trim() : "";
    const saved = diaryLib.appendDiaryEntry(body.content, sid || null, { kind: body.kind === "letter" ? "letter" : "diary", title: body.title });
    // 2026-11-24：跨客户端传了 session_id 时同步落入目标会话时间线（内部按 diary_id 去重，不会与网关工具循环双写）
    let timelineSynced = false;
    if (saved && sid && body.content) {
      timelineSynced = !!onDiaryToolWritten(sid, String(body.content), saved.id);
    }
    // 2026-10-19：多返回新条目 id——tools_server.py 把它塞进工具回执，网关工具循环据此给
    // 时间线消息打 diary_id 外键（success 仍为布尔，旧判断不受影响）
    reply.send({ success: !!saved, id: (saved && saved.id) || undefined, timeline_synced: timelineSynced });
  } catch (err) {
    console.error("[internal/diary] 写日记失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
// 读日记：只返回正文（自带「## 时间」头 = 时间+正文），不带会话编号/文件路径
app.get("/internal/diary/view", async (req, reply) => {
  try {
    const all = diaryStore.listEntries(__dirname).filter(e => !e.hidden);
    // 1025 两段式检索：id=看某篇全文；q+limit=关键词搜索（返回 id+date+片段，省上下文）；
    // 优先级 id > q > date > 默认最近 count 篇。片段=第一个命中位置前后各约 12 字（共约 25 字），
    // 隐去换行；命中大小写不敏感。每条带 date（正文 ## 日期行，取不到回退 created_at），AI 判断时间线用。
    const _did = req.query.id !== undefined ? Number(req.query.id) : null;
    if (_did !== null && Number.isFinite(_did)) {
      const one = all.find(e => e.id === _did);
      if (!one) return reply.code(404).send({ error: "没有 id=" + _did + " 的日记" });
      const _m = String(one.content || "").match(/^##\s*(\d{4}-\d{2}-\d{2})/);
      return reply.send({ id: one.id, date: _m ? _m[1] : String(one.created_at || "").slice(0, 10), content: String(one.content || "").trim() });
    }
    const _q = String(req.query.q || "").trim();
    if (_q) {
      let _limit = 10;
      try { _limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 30)); } catch (e) { /* 兜底默认 */ }
      /* [位置:server.js·/internal/diary/view 关键词检索] [多词也能搜到 + 片段落在命中处] [11-09 检索质量批：原来整句 q 当子串找，「蓝鲸 饲养」这类分开写的多词永远 0 篇；现在按空白/标点切词，命中 = 所有词都出现在这篇里（单词与旧行为一致，整句连写是它的子集，所以旧结果只增不减），片段用共享的多词最优窗口（lib/keyword-window.js，前后各 30 字，词离得远给两段；锚不上取开头 26 字）] [注释时间 2026-11-09] */
      const _kw = require("./lib/keyword-window");
      const _terms = _kw.terms(_q);
      const _hits = _terms.length ? all.filter(e => { const low = String(e.content || "").toLowerCase(); return _terms.every(t => low.indexOf(t) >= 0); }) : [];
      const _picked = _hits.slice(-_limit);
      const _snip = (text) => _kw.snippet(text, _q, { head: 26 });
      return reply.send({
        total: _hits.length,
        returned: _picked.length,
        entries: _picked.map(e => {
          const _m = String(e.content || "").match(/^##\s*(\d{4}-\d{2}-\d{2})/);
          return { id: e.id, date: _m ? _m[1] : String(e.created_at || "").slice(0, 10), snippet: _snip(e.content) };
        }),
        message: "关键词「" + _q + "」共命中 " + _hits.length + " 篇，返回最近 " + _picked.length + " 篇（每条为 id+日期+片段）；要看哪篇全文，带 id 再调一次",
      });
    }
    const date = String(req.query.date || "").trim();
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: "date 格式应为 YYYY-MM-DD" });
      const day = all.filter(e => {
        const p = getDatePartsInTimeZone(new Date(e.created_at), TIME_ZONE);
        return `${p.year}-${p.month}-${p.day}` === date;
      });
      if (!day.length) return reply.code(404).send({ error: "没有 " + date + " 的日记" });
      return reply.send({ date, content: day.map(e => String(e.content).trim()).join("\n\n"), entries: day.map(e => ({ id: e.id, content: String(e.content).trim() })) });
    }
    let count = 1;
    try { count = Math.max(1, Math.min(Number(req.query.count) || 1, 30)); } catch (e) { /* client/stream cleanup */ }
    const picked = all.slice(-count);
    return reply.send({
      entries: picked.map(e => ({ id: e.id, content: String(e.content).trim() })),
      count: picked.length,
      message: "共 " + all.length + " 篇日记，返回最近 " + picked.length + " 篇；带 date=YYYY-MM-DD 可看某天",
    });
  } catch (err) {
    console.error("[internal/diary/view] 读日记失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

/* [位置:server.js·/internal/diary/delete、/internal/paper/delete] [AI 的日记 / 笔记本工具删除] [10-24 需求 54：lovediary / notebook 加 action=delete；删之前把整份数据备份到 data/backups/tool-delete/<时间戳>/；日记只在 data/diary.json（AI 自己的日记和信封）里删，她的碎碎念是另一份存储，碰不到；笔记本沿用 papers 的删除（整篇先进 papers-history.json 再删，目录笔记不能删），注意笔记本里没有记「谁写的」，AI 能删任何一篇普通笔记；鉴权同其它 /internal 接口] [注释时间 2026-10-24] */
function backupBeforeToolDelete(tag, files) {
  const dir = path.join(__dirname, "data", "backups", "tool-delete", new Date().toISOString().replace(/[:.]/g, "-") + "-" + tag);
  fs.mkdirSync(dir, { recursive: true });
  files.forEach(function (fp) { try { if (fs.existsSync(fp)) fs.copyFileSync(fp, path.join(dir, path.basename(fp))); } catch (e) { console.warn("[tool-delete] 备份失败 " + fp + ": " + e.message); throw e; } });
  return dir;
}
app.post("/internal/diary/delete", async (req, reply) => {
  try {
    const id = Number((req.body || {}).id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "id 必填（取自 list 返回的 id）" });
    const e = diaryStore.getEntry(__dirname, id);
    if (!e) return reply.code(404).send({ error: "没有这一条日记：id=" + id });
    const dir = backupBeforeToolDelete("diary-" + id, [diaryStore.storePath(__dirname)]);
    const st = diaryStore.loadStore(__dirname);
    st.entries = st.entries.filter(x => Number(x.id) !== id);
    diaryStore.saveStore(__dirname, st);
    console.warn("[tool-delete] AI 删除日记 id=" + id + " kind=" + (e.kind || "diary") + " 备份=" + dir);
    reply.send({ success: true, id, kind: e.kind === "letter" ? "letter" : "diary", preview: String(e.content || "").trim().replace(/\s+/g, " ").slice(0, 40), backup: dir });
  } catch (err) {
    console.error("[internal/diary/delete] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
/* [位置:server.js·/internal/diary/context-hide] [按日记 id 移出或恢复上下文固定展示] [仅更新 context_hidden 字段：移出后 Earlier Days 与时间线上下文均不再注入该日记，但 lovediary 检索与读取仍可查到] [注释时间 2026-11-24] */
app.post("/internal/diary/context-hide", async (req, reply) => {
  try {
    const body = req.body || {};
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "id 必填（取自上下文或 list 返回的日记 id）" });
    const e = diaryStore.getEntry(__dirname, id);
    if (!e) return reply.code(404).send({ error: "没有这一条日记：id=" + id });
    const wantHidden = body.hidden !== false;
    diaryStore.updateEntry(__dirname, e.id, { context_hidden: wantHidden });
    _diaryCtxHiddenCache.mtimeMs = -1;
    try {
      if (e.session) require("./context/context-snapshot-v2").markStale(__dirname, e.session, "diary-context-hide");
    } catch (_) {}
    console.log("[diary] 上下文展示状态更新 id=" + e.id + " context_hidden=" + wantHidden);
    reply.send({ success: true, id: e.id, context_hidden: wantHidden });
  } catch (err) {
    console.error("[internal/diary/context-hide] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
app.post("/internal/paper/delete", async (req, reply) => {
  try {
    const nbBase = _paperNbBase(req);
    if (!nbBase) return reply.code(400).send({ error: "当前会话未绑定笔记本" });
    const id = Number((req.body || {}).id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "id 必填（取自 list 返回的 id）" });
    const paperStore = require("./lib/paper-store");
    const e = paperStore.getEntry(nbBase, id);
    if (!e) return reply.code(404).send({ error: "没有这一篇：id=" + id });
    if (e.is_index) return reply.code(400).send({ error: "笔记本目录由系统维护，不能删" });
    const dir = backupBeforeToolDelete("paper-" + id, [paperStore.storePath(nbBase), paperStore.historyPath(nbBase)]);
    const papers = require("./lib/papers");
    const r = papers.withBaseDir(nbBase, () => papers.portalDelete(id));
    if (!r || !r.ok) return reply.code(400).send({ error: (r && r.error) || "删除失败" });
    console.warn("[tool-delete] AI 删除笔记 id=" + id + " 标题=" + (e.title || "") + " 备份=" + dir);
    reply.send({ success: true, id, title: e.title || "", backup: dir });
  } catch (err) {
    console.error("[internal/paper/delete] 失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

app.get("/xie-diary/api/list", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    // 2026-10-03：日记改 data/diary.json，按 id 点名；list 回 id/session/hidden/created_at/content/vc
    const entries = diaryStore.listEntries(__dirname).slice().sort((a, b) => b.id - a.id).map(e => ({
      id: e.id, session: e.session, hidden: e.hidden, pin: e.pin === true, created_at: e.created_at,
      kind: e.kind === "letter" ? "letter" : "diary", title: e.title || "",
      content: e.content, vc: countDiaryVersions(e.id)
    }));
    reply.send({ entries });
  } catch (err) {
    console.error("[xie-diary] 门户列表失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 小世界门户：切换某篇日记隐藏状态（2026-09-19 批6 D1）。与 /xie-diary/api/list 同级公开；
// 与已删的管理台 /admin/diary/hide（2026-09-20 清理）曾操作同一份 data/diary_hidden.json，语义=不参与跨窗口注入、可恢复。
app.post("/xie-diary/api/hide", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const e = diaryStore.getEntry(__dirname, body.id);
    if (!e) return reply.code(404).send({ error: "日记不存在：id=" + body.id });
    const wantHidden = body.hidden !== false;
    diaryStore.updateEntry(__dirname, e.id, { hidden: wantHidden });
    reply.send({ success: true, id: e.id, hidden: wantHidden });
  } catch (err) {
    console.error("[xie-diary] 切换隐藏失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 小世界门户：置顶/取消置顶某篇日记（1010-13）。置顶日记在跨窗口注入（Earlier Days）固定排最前、占份数；
// 置顶上限 = cross_inject_diary_count（管理台跨窗口注入日记条数）。与 list/hide 同级公开。
app.post("/xie-diary/api/pin", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const e = diaryStore.getEntry(__dirname, body.id);
    if (!e) return reply.code(404).send({ error: "日记不存在：id=" + body.id });
    const wantPin = body.pin === true;
    if (wantPin) {
      const limit = Math.max(1, Number(readCrossInjectConfig().cross_inject_diary_count) || 3);
      const curPinned = diaryStore.listEntries(__dirname).filter(x => x.pin === true).length;
      if (!e.pin && curPinned >= limit) {
        return reply.code(400).send({ error: "置顶已满（最多 " + limit + " 条），先取消一条再置顶" });
      }
    }
    diaryStore.updateEntry(__dirname, e.id, { pin: wantPin });
    const after = diaryStore.listEntries(__dirname).filter(x => x.pin === true).length;
    reply.send({ success: true, id: e.id, pin: wantPin, pinned_count: after, limit: Math.max(1, Number(readCrossInjectConfig().cross_inject_diary_count) || 3) });
  } catch (err) {
    console.error("[xie-diary] 切换置顶失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// ========================
// 门户日记历史版本（2026-10-02；2026-10-03 改按日记 id 归档）
// 编辑保存前把整份旧内容另存一份 → 编辑不再是不可逆覆盖。
// 存 data/diary_versions/d<id>/v<ISO>.md：刻意不放在 diary 下，
// 不会被跨窗口注入扫到（文件名也不匹配日记正则，双保险）。
// ========================
const DIARY_VERSIONS_DIR = path.join(__dirname, "data", "diary_versions");
const DIARY_VERSION_MAX = 50;   // 每篇最多留 50 份，超出删最旧
function diaryVersionDir(id) { return path.join(DIARY_VERSIONS_DIR, "d" + id); }
function saveDiaryVersion(id, content) {
  const dir = diaryVersionDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const name = "v" + new Date().toISOString().replace(/[:.]/g, "-") + ".md";
  fs.writeFileSync(path.join(dir, name), String(content == null ? "" : content), "utf-8");
  try {   // 超出上限删最旧
    const all = fs.readdirSync(dir).filter(n => /^v.+\.md$/.test(n)).sort();
    for (let i = 0; i < all.length - DIARY_VERSION_MAX; i++) fs.unlinkSync(path.join(dir, all[i]));
  } catch (e) { console.warn('[server.js:6846] cleanup failed:', e.message); }
  return name;
}
function listDiaryVersions(id) {
  const dir = diaryVersionDir(id);
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => /^v.+\.md$/.test(n)); } catch (e) { return []; }
  const pad = (x) => String(x).padStart(2, "0");
  return names.sort().reverse().map((n) => {
    let time = n.slice(1, -3), chars = 0;
    try {
      const st = fs.statSync(path.join(dir, n));
      const d = new Date(st.mtimeMs);
      time = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " "
           + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    } catch (e) { console.error('[server.js:6861]', e.message || e); }
    try { chars = fs.readFileSync(path.join(dir, n), "utf-8").length; } catch (e) { console.error('[server.js:6862]', e.message || e); }
    return { ts: n, time, chars };
  });
}
function countDiaryVersions(id) {
  try { return fs.readdirSync(diaryVersionDir(id)).filter(n => /^v.+\.md$/.test(n)).length; } catch (e) { return 0; }
}
function findDiaryVersion(id, ts) {
  const n = String(ts || "");
  if (!/^v[A-Za-z0-9_.:-]+\.md$/.test(n)) return null;    // 防目录穿越
  const dir = diaryVersionDir(id);
  const full = path.join(dir, n);
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  return fs.existsSync(full) ? { full, name: n } : null;
}
// 门户：编辑日记（2026-09-20；2026-10-03 改 id + 只提交正文，头行按 created_at 保持）。
app.post("/xie-diary/api/update", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const e = diaryStore.getEntry(__dirname, body.id);
    if (!e) return reply.code(404).send({ error: "日记不存在：id=" + body.id });
    const newText = String(body.text === undefined ? "" : body.text).trim();
    if (!newText) return reply.code(400).send({ error: "正文不能为空" });
    // 落盘前把整份旧内容另存为历史版本（编辑不再是不可逆覆盖）
    try { saveDiaryVersion(e.id, e.content); }
    catch (ve) { console.error("[xie-diary] 保存历史版本失败:", ve.message); }
    // 头行保持 created_at 的本地时间（与原格式一致），正文替换
    const p = getDatePartsInTimeZone(new Date(e.created_at), TIME_ZONE);
    const newContent = `## ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}\n\n${newText}\n`;
    diaryStore.updateEntry(__dirname, e.id, { content: newContent });
    // 2026-10-19：按 diary_id 外键同步时间线（syncedEvents 字段保留 = 同步条数，旧前端字段兼容）
    const sync = syncDiaryTimelineMessages(e.session, e.id, diaryLib.wrapDiaryTag(newText, e.created_at));
    reply.send({ success: true, id: e.id, syncedEvents: sync.patched, timelineMissing: sync.missing, chars: newContent.length });
  } catch (err) {
    console.error("[xie-diary] 编辑日记失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 门户：某篇日记的历史版本列表（2026-10-02；2026-10-03 改 id）。只回时间与字数，不回正文。
app.get("/xie-diary/api/versions", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    const e = diaryStore.getEntry(__dirname, req.query.id);
    if (!e) return reply.code(404).send({ error: "日记不存在：id=" + req.query.id });
    reply.send({ versions: listDiaryVersions(e.id) });
  } catch (err) {
    console.error("[xie-diary] 版本列表失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
// 门户：某个历史版本的正文（点「查看」时才取，避免列表一次拉几十份全文）
app.get("/xie-diary/api/version", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    const e = diaryStore.getEntry(__dirname, req.query.id);
    if (!e) return reply.code(404).send({ error: "日记不存在：id=" + req.query.id });
    const v = findDiaryVersion(e.id, req.query.ts);
    if (!v) return reply.code(404).send({ error: "历史版本不存在" });
    reply.send({ content: fs.readFileSync(v.full, "utf-8") });
  } catch (err) {
    console.error("[xie-diary] 版本正文失败:", err);
    reply.code(500).send({ error: err.message });
  }
});
// 门户：把某篇日记恢复到指定历史版本（2026-10-02；2026-10-03 改 id）。
// 恢复前先把「当前内容」存为一个新版本 —— 恢复本身也可逆，永不丢内容。
app.post("/xie-diary/api/restore", { preHandler: xieDiaryAuth }, async (req, reply) => {
  try {
    const body = req.body || {};
    const e = diaryStore.getEntry(__dirname, body.id);
    if (!e) return reply.code(404).send({ error: "日记不存在：id=" + body.id });
    const v = findDiaryVersion(e.id, body.ts);
    if (!v) return reply.code(404).send({ error: "历史版本不存在" });
    saveDiaryVersion(e.id, e.content);
    const old = fs.readFileSync(v.full, "utf-8");
    diaryStore.updateEntry(__dirname, e.id, { content: old });
    // 2026-10-19：按 diary_id 外键同步时间线（恢复的正文剥掉「## 时间」头行后重包裹）
    const sync = syncDiaryTimelineMessages(e.session, e.id, diaryLib.wrapDiaryTag(diaryBodyOnly(old), e.created_at));
    reply.send({ success: true, id: e.id, chars: old.length, syncedEvents: sync.patched, timelineMissing: sync.missing });
  } catch (err) {
    console.error("[xie-diary] 恢复历史版本失败:", err);
    reply.code(500).send({ error: err.message });
  }
});

// 移动端管理页面
app.get("/admin/mobile", { preHandler: mobileAuth }, async (req, reply) => {
  const fss = require("fs");
  const pathh = require("path");
  const template = fss.readFileSync(pathh.join(__dirname, "admin", "admin-mobile.html"), "utf-8");
  reply.type("text/html").header("Cache-Control", "no-store, no-cache, must-revalidate").header("Pragma", "no-cache").send(template);
});
app.get("/admin/mobile.css", async (req, reply) => {
  reply.type("text/css").header("Cache-Control", "no-store, no-cache, must-revalidate").send(require("fs").readFileSync(path.join(__dirname, "admin", "admin-mobile.css"), "utf-8"));
});
app.get("/admin/mobile.js", async (req, reply) => {
  reply.type("application/javascript").header("Cache-Control", "no-store, no-cache, must-revalidate").send(require("fs").readFileSync(path.join(__dirname, "admin", "admin-mobile.js"), "utf-8"));
});

// ========================
// 日志与上下文查看 API
// ========================

// 获取唤醒提示词（wake_prompt.txt 当前内容）
app.get("/admin/logs/wake-prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const promptPath = path.join(__dirname, "config", "wake_prompt.txt");
    reply.send({ text: fs.readFileSync(promptPath, "utf-8") });
  } catch (err) {
    reply.send({ text: "", error: err.message });
  }
});

// 保存唤醒提示词
app.post("/admin/logs/wake-prompt", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const text = String((req.body && req.body.text) || "").trim();
    if (!text) return reply.code(400).send({ error: "内容不能为空" });
    atomicWriteFileSync(path.join(__dirname, "config", "wake_prompt.txt"), text + "\n");
    reply.send({ ok: true });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});



// 1005 补回：永久注入上下文（pinned memories）CRUD
// [位置:server.js·/admin/logs/pinned*] [永久上下文按 preset_id 隔离读写] [11-25：不传 preset_id 走全局 data/pinned.json，传 preset_id 走 lib/preset-pinned 独立文件；补 counts / clone / scope 清理接口] [注释时间 2026-11-25]
function _pinnedPresetId(req) {
  const q = (req.query && req.query.preset_id) || (req.body && req.body.preset_id) || "";
  return String(q || "").trim();
}
app.get("/admin/logs/pinned/counts", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const presetPinned = require("./lib/preset-pinned");
    reply.send({ ok: true, counts: presetPinned.counts(__dirname) });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/logs/pinned/clone", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const presetPinned = require("./lib/preset-pinned");
    const { from_preset_id, to_preset_id } = req.body || {};
    const list = await presetPinned.clone(__dirname, from_preset_id, to_preset_id);
    reply.send({ ok: true, count: list.length });
  } catch (err) { reply.code(400).send({ error: err.message }); }
});
app.delete("/admin/logs/pinned/scope/:preset_id", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const presetPinned = require("./lib/preset-pinned");
    const ok = await presetPinned.removeScope(__dirname, req.params.preset_id);
    reply.send({ ok });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.get("/admin/logs/pinned", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const pid = _pinnedPresetId(req);
    if (pid) {
      const presetPinned = require("./lib/preset-pinned");
      return reply.send({ list: presetPinned.list(__dirname, pid), preset_id: pid });
    }
    const engine = require("./memory/memory-engine");
    const list = engine.getPinnedMemories ? engine.getPinnedMemories() : [];
    reply.send({ list });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/logs/pinned", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const { title, content, order } = req.body || {};
    const pid = _pinnedPresetId(req);
    if (pid) {
      const presetPinned = require("./lib/preset-pinned");
      const mem = await presetPinned.add(__dirname, pid, { title, content, order });
      return reply.send({ success: true, memory: mem });
    }
    const engine = require("./memory/memory-engine");
    const mem = await engine.addPinnedMemory({ title, content, order }, { allowDeleted: true });
    reply.send({ success: true, memory: mem });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/logs/pinned/:id", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const { title, content, order } = req.body || {};
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (order !== undefined) updates.order = order;
    const pid = _pinnedPresetId(req);
    if (pid) {
      const presetPinned = require("./lib/preset-pinned");
      const mem = await presetPinned.update(__dirname, pid, req.params.id, updates);
      if (!mem) return reply.code(404).send({ error: "not found" });
      return reply.send({ success: true, memory: mem });
    }
    const engine = require("./memory/memory-engine");
    const mem = await engine.updatePinnedMemory(req.params.id, updates);
    if (!mem) return reply.code(404).send({ error: "not found" });
    reply.send({ success: true, memory: mem });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/logs/pinned/reorder", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const ids = (req.body || {}).ids;
    const pid = _pinnedPresetId(req);
    if (pid) {
      const presetPinned = require("./lib/preset-pinned");
      const list = await presetPinned.reorder(__dirname, pid, ids);
      if (!list) return reply.code(400).send({ error: "无效的排序数据" });
      return reply.send({ success: true, list });
    }
    const engine = require("./memory/memory-engine");
    const list = await engine.reorderPinnedMemory(ids);
    if (!list) return reply.code(400).send({ error: "无效的排序数据" });
    reply.send({ success: true, list });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.delete("/admin/logs/pinned/:id", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const pid = _pinnedPresetId(req);
    if (pid) {
      const presetPinned = require("./lib/preset-pinned");
      const ok = await presetPinned.remove(__dirname, pid, req.params.id);
      return reply.send({ ok });
    }
    const engine = require("./memory/memory-engine");
    const ok = await engine.deletePinnedMemory(req.params.id);
    reply.send({ ok });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 1005 补回：最后一次发给 LLM 的完整上下文
app.get("/admin/logs/context", { preHandler: basicAuth }, async (req, reply) => {
  try {
    // 1021：带 session_id 时只返回该会话自己最近一次真正发出去的请求；没有就如实返回空，不回退到全局那份
    const _qSid = String((req.query || {}).session_id || "").trim();
    if (_qSid) {
      const cap = readLastLLMOfSession(_qSid);
      if (!cap) { reply.send({ messages: [], total: 0, captureTime: null, session_id: _qSid }); return; }
      const ms = cap.messages.map(m => {
        if (m.role === "_divider") return { role: "_divider", content: m.content };
        return { role: m.role, content: m.content, images: m.images, attachments: m.attachments, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id,
          reasoning_content: m.reasoning_content || undefined, thinking_blocks: m.thinking_blocks || undefined, anthropic_content_blocks: m.anthropic_content_blocks || undefined };
      });
      // 2026-10-23 需求 50：把该会话快照里的工具定义一并带回，小手机「当前请求上下文」多一行「工具定义」
      //（上游实报的 token 含工具定义，只数 messages 就对不上）。没有快照就不带。
      // 10-29 #46：优先读会话存档文件里实际发出的 tools（setLastLLMCapture 第 4 参带来的，10-29 起才有）；
      // 旧存档没有这个字段时回落快照（历史快照的 tools 自 1026 解冻后恒为 null，等于没有）。
      let _tn = 0, _tt = "";
      if (Array.isArray(cap.tools) && cap.tools.length) { _tn = cap.tools.length; _tt = JSON.stringify(cap.tools); }
      else try {
        const _sf = lastLLMSessionFile(_qSid);
        const _snap = _sf && JSON.parse(fs.readFileSync(path.join(__dirname, "data", "session_ctx_snapshots_v2", path.basename(_sf)), "utf8"));
        if (_snap && Array.isArray(_snap.tools) && _snap.tools.length) { _tn = _snap.tools.length; _tt = JSON.stringify(_snap.tools); }
      } catch (e) { /* 没有快照就不带 */ }
      reply.send({ messages: ms, total: ms.length, captureTime: cap.captureTime || null, session_id: _qSid, tools_n: _tn, tools_text: _tt });
      return;
    }
    if (!lastLLMMessages) { reply.send({ messages: [], total: 0, captureTime: null }); return; }
    const messages = lastLLMMessages.map(m => {
      if (m.role === "_divider") return { role: "_divider", content: m.content };
      return { role: m.role, content: m.content, images: m.images, attachments: m.attachments, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id,
        reasoning_content: m.reasoning_content || undefined, thinking_blocks: m.thinking_blocks || undefined, anthropic_content_blocks: m.anthropic_content_blocks || undefined };
    });
    if (lastLLMCaptureTime && lastLLMCaptureTime !== lastLoggedContextCaptureTime) {
      lastLoggedContextCaptureTime = lastLLMCaptureTime;
      try {
        require("./lib/llm_log").record("activity_last_request", {
          url: "/admin/logs/context",
          request: JSON.stringify({ captureTime: lastLLMCaptureTime }),
          response: JSON.stringify({ messages, total: messages.length, captureTime: lastLLMCaptureTime }),
          meta: { captureTime: lastLLMCaptureTime }
        });
      } catch (e) { /* 诊断日志不影响管理台读取上下文 */ }
    }
    reply.send({ messages, total: messages.length, captureTime: lastLLMCaptureTime });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
// 1005 补回：标星列表（含 in_context 标记）
app.get("/admin/context-compaction/marked-list", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const res = contextReplacements.listMarked();
    try {
      const norm = function (s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); };
      let captureText = "";
      if (Array.isArray(lastLLMMessages)) {
        captureText = lastLLMMessages.map(function (m) {
          const c = m && m.content;
          if (typeof c === "string") return c;
          if (Array.isArray(c)) return c.map(function (p) { return (p && typeof p.text === "string") ? p.text : ""; }).join("");
          return "";
        }).join("\n");
        captureText = norm(captureText);
      }
      if (captureText) {
        (res.results || []).forEach(function (r) {
          const full = norm(r.content);
          if (!full) { r.in_context = false; return; }
          const probe = full.length > 100 ? full.slice(0, 100) : full;
          r.in_context = captureText.indexOf(probe) >= 0;
        });
      } else {
        (res.results || []).forEach(function (r) { r.in_context = false; });
      }
    } catch (e) {
      (res.results || []).forEach(function (r) { if (r.in_context === undefined) r.in_context = false; });
    }
    reply.send(res);
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/context-compaction/marked/update", { preHandler: basicAuth }, async (req, reply) => {
  const body = req.body || {};
  const key = String(body.key || "").trim();
  const content = String(body.content || "").trim();
  if (!key) return reply.code(400).send({ error: "key 无效" });
  if (!content) return reply.code(400).send({ error: "正文内容不能为空" });
  try {
    const r = contextReplacements.updateMark(key, { content: content });
    if (!r.ok) return reply.code(400).send({ error: r.error || "更新失败" });
    reply.send({ ok: true, content: r.content });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 1005 补回：唤醒日志
app.get("/admin/logs/wake-up", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const lines = parseInt(req.query.lines) || 200;
    const logPath = process.env.WAKE_UP_LOG_PATH || require("path").join(PROJECT_ROOT, "data", "gateway-out.log");
    try {
      let raw = "";
      try {
        const st = fs.statSync(logPath);
        const readBytes = Math.min(st.size, 3 * 1024 * 1024);
        const buf = Buffer.alloc(readBytes);
        const fd = fs.openSync(logPath, "r");
        try { fs.readSync(fd, buf, 0, readBytes, st.size - readBytes); } finally { fs.closeSync(fd); }
        raw = buf.toString("utf-8");
        if (readBytes < st.size) raw = raw.slice(raw.indexOf("\n") + 1);
      } catch (e) {
        raw = fs.readFileSync(logPath, "utf-8");
      }
      const allLines = raw.split("\n").filter(l => l.trim());
      const KEEP = ["开始自动唤醒", "====", "[wake-scheduler]", "[wake-chat]", "[diary]"];
      const DROP = ["块已落盘", "直连完成", "已设定定时唤醒", "唤醒周期已重置",
        "唤醒调度器已在 gateway 内启动", "wake_completion_forward", "Wake Result",
        "[tag-parser]", "[wake-event]"];
      const filtered = allLines.filter(l => KEEP.some(k => l.includes(k)) && !DROP.some(k => l.includes(k)));
      const tailLines = filtered.slice(-lines);
      reply.send({ lines: tailLines, total: filtered.length });
    } catch {
      reply.send({ lines: [], total: 0, error: "日志文件不存在" });
    }
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 多模态 content 拆分：文字保留原文，图片/音频/文件只留标记，
// 避免 base64 大字符串进入管理台上下文面板导致手机渲染卡死
function splitMultimodalContent(content) {
  if (typeof content === "string") return { content, images: null, attachments: 0 };
  if (Array.isArray(content)) {
    const texts = [];
    const images = [];
    let attachments = 0;
    for (const part of content) {
      if (!part) continue;
      if (typeof part === "string") { texts.push(part); continue; }
      const type = part.type;
      if (type === "text") {
        const t = part.text;
        if (typeof t === "string" && t.trim()) texts.push(t);
      } else if (type === "image_url") {
        const raw = part.image_url;
        const url = typeof raw === "string" ? raw : (raw && raw.url);
        const mime = (typeof url === "string" && url.indexOf(";") > 0)
          ? url.slice(0, url.indexOf(";")).replace("data:", "")
          : (typeof url === "string" && url.startsWith("http") ? "image/url" : "image");
        const bytes = (typeof url === "string" && url.startsWith("data:"))
          ? Math.round((url.length - url.indexOf(",") - 1) * 3 / 4) : 0;
        images.push({ mime: mime || "image", bytes });
      } else {
        attachments++;
      }
    }
    return { content: texts.join("\n"), images, attachments };
  }
  return { content: String(content == null ? "" : content) };
}

// 推送（Bark / WebPush，与唤醒系统同一套配置）
// sessionId：目标会话（WebPush 通道按会话定向订阅；bark 忽略此字段）。
// 唤醒/告警类调用方必须传；后台回复类由 /v1/notify/reply-done 带入。
// 待办到点提醒：与 wake scheduler 独立，时间和发送状态保存在统一后端数据文件。
const TODO_REMINDER_CLAIM_URL = "http://127.0.0.1:8777/todo/api/reminders/claim";
const TODO_REMINDER_RESULT_URL = "http://127.0.0.1:8777/todo/api/reminders/result";
let todoReminderScanRunning = false;
async function scanTodoReminders() {
  if (todoReminderScanRunning) return;
  todoReminderScanRunning = true;
  try {
    const key = readEnvValue("INTERNAL_API_KEY");
    if (!key) {
      console.warn("[todo-reminder] INTERNAL_API_KEY 未配置，暂不扫描");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(TODO_REMINDER_CLAIM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Key": key },
        body: JSON.stringify({ now_ms: Date.now() }),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error("claim HTTP " + response.status);
    const data = await response.json();
    const reminders = Array.isArray(data.reminders) ? data.reminders : [];
    for (const item of reminders) {
      let pushResult = { ok: false, reason: "推送未执行" };
      try {
        const detail = String(item.text || "待办事项").replace(/^📌\s*/, "").trim();
        pushResult = await sendPushNotification({
          title: "待办提醒",
          body: detail ? ("到时间啦：" + detail.slice(0, 350)) : "你有一条待办事项到时间啦。",
          sessionId: latestRequestedSessionId(),
          channel: "webpush"
        });
      } catch (e) {
        pushResult = { ok: false, reason: e && e.message ? e.message : String(e) };
      }
      try {
        const resultResponse = await fetch(TODO_REMINDER_RESULT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Key": key },
          body: JSON.stringify({ id: item.id, ok: !!(pushResult && pushResult.ok), error: pushResult && pushResult.reason })
        });
        if (!resultResponse.ok) throw new Error("result HTTP " + resultResponse.status);
      } catch (e) {
        // 结果写回失败时租约到期后自动重试；极端情况下可能重复推送，但不会永久丢提醒。
        console.error("[todo-reminder] 状态写回失败 id=" + item.id + ": " + e.message);
      }
      console.log("[todo-reminder] id=" + item.id + " push=" + (!!(pushResult && pushResult.ok)) + (pushResult && pushResult.reason ? " reason=" + pushResult.reason : ""));
    }
  } catch (e) {
    console.error("[todo-reminder] 扫描失败：", e && e.message ? e.message : e);
  } finally {
    todoReminderScanRunning = false;
  }
}

async function sendPushNotification({ title, body, sessionId, channel } = {}) {
  // 15s 超时：Bark 对端挂起时不能卡住免打扰释放等调用方
  const pushController = new AbortController();
  const pushTimer = setTimeout(() => pushController.abort(), 15000);
  const doBark = async function () {
    const barkKey = readEnvValue("BARK_KEY");
    if (!barkKey) return { ok: false, reason: "Bark Key 未配置" };
    const response = await fetch("https://api.day.app/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, device_key: barkKey, icon: readEnvValue("CUSTOM_ICON_URL") }),
      signal: pushController.signal
    });
    const responseText = await response.text();
    let result = {};
    try { result = JSON.parse(responseText); } catch (e) { console.error('[server.js:7274]', e.message || e); }
    if (!response.ok || (result.code && result.code !== 200)) {
      return { ok: false, reason: result.message || `HTTP ${response.status}` };
    }
    return { ok: true };
  };
  try {
    // 2026-10-09 双渠道分流：channel 显式指定时按类型走（AI 消息提醒=webpush、后台告警=bark），
    // 未指定时按 PUSH_PROVIDER 兜底（旧行为不变）。webpush 失败自动回退 Bark 保底，不漏提醒。
    const provider = (channel || readEnvValue("PUSH_PROVIDER") || "bark").trim().toLowerCase();
    if (provider === "webpush") {
      const r = await require("./lib/webpush").sendToSession({ title, body, sessionId });
      if (r && r.ok) return r;
      // webpush 失败回退 Bark（timer 仍有效，bark 受 15s 超时保护；成功路径由 finally 统一清 timer）
      const br = await doBark();
      if (br.ok) return { ok: true, providerLabel: "Bark", fallback: "webpush", fallbackReason: (r && r.reason) || "webpush 失败" };
      return r;
    }
    if (provider !== "bark") return { ok: false, reason: `不支持的 PUSH_PROVIDER：${provider}` };
    return await doBark();
  } catch (err) {
    return { ok: false, reason: err.name === "AbortError" ? "推送超时(15s)" : err.message };
  } finally {
    clearTimeout(pushTimer);
  }
}

// 前端在聊天页切后台时，AI 回复结束后调这个接口弹 Bark 通知
app.post("/v1/notify/reply-done", async (req, reply) => {
  try {
    const preview = String((req.body && req.body.preview) || "").trim();
    if (!preview) return reply.send({ ok: false, reason: "empty" });
    const sessionId = String((req.body && req.body.session_id) || "").trim() || "default";
    // 2026-09-26 用户拍板：通知不显示标题行，preview 全文作为正文（title 置空）
    const r = await sendPushNotification({ title: "", body: preview.slice(0, 200), sessionId, channel: "webpush" });
    reply.send(r);
  } catch (e) { reply.code(500).send({ error: e.message }); }
});

// iOS 桌面 PWA 系统通知（WebPush 通道）：VAPID 公钥下发 + 订阅上报
// 鉴权走全局 /v1 hook（公网需 GATEWAY_API_KEY 或管理员登录态），与聊天页其他 /v1 接口同口径
app.get("/v1/push/vapid-public-key", async (req, reply) => {
  reply.send({ ok: true, publicKey: require("./lib/webpush").getPublicKey() });
});
app.post("/v1/push/subscribe", async (req, reply) => {
  const body = req.body || {};
  const r = require("./lib/webpush").upsertSubscription(body.session_id, body.subscription);
  if (!r.ok) return reply.code(400).send(r);
  reply.send(r);
});




// ======================== 聊天页设置云端同步 ========================
// 把 chat.html 的前端设置（api_key / system_prompt / cfg）整体存到服务器，
// 换浏览器输入同一 key 后自动拉取覆盖本地，保持一致。用 basicAuth（管理台会话 cookie 亦可）。
const CHAT_SETTINGS_FILE = path.join(__dirname, "config", "chat-settings.json");
// 参数归属表：设置页(chat-settings.json.cfg)只该改「界面/聊天显示类」参数；凡属管理台专属的行为参数
// （记忆池/跨窗口注入/容量提醒/上下文上限/历史分页等）一律拒绝从设置页接口写入与下发，杜绝"同名摆设"假开关。
function consoleOwnedCfgKeys() {
  const blocked = new Set([
    // 容量提醒 / 上下文上限 / 历史分页：管理台唯一权威（设置页不显示假开关）
    "capacity_remind_enabled", "capacity_remind_threshold", "context_limit", "history_limit",
    "pagination", "history_pagination", "conversation_pagination", "max_history",
    // 记忆池 / 跨窗口注入：由控制台 /config 与 /memory-pool/config 管理
    "cross_inject_enabled", "cross_inject_diary", "cross_inject_diary_count", "cross_inject_diary_days",
    "cross_inject_memory", "cross_inject_memory_per_category", "cross_inject_push",
    "cross_inject_summary_days",
    // 记忆解析 / 清理 / 去重（reparse_enabled/warm/max_chars/max_items 已于 0928 删除，无功能读取点）
    "reparse_merge_max_chars",
    "reparse_system_prompt", "reparse_user_prompt",
    "clean_enabled", "clean_max_items", "clean_ref_dup_threshold", "clean_ref_threshold", "clean_ref_topk",
    "clean_system_prompt", "clean_temperature", "clean_user_prompt",
    "dedup_anchor_threshold", "dedup_cross_threshold", "dedup_threshold",
    "retrieval_top_k", "decay_days", "auto_pin_retrieval_count"
  ]);
  // 2026-09-28：V1 记忆池删除，不再从 memory_pool_config.json 运行时并入拦截键
  return blocked;
}
app.get("/admin/chat-settings", { preHandler: basicAuth }, async (req, reply) => {
  try {
    if (!fs.existsSync(CHAT_SETTINGS_FILE)) return reply.send({ ok: true, exists: false });
    const data = JSON.parse(fs.readFileSync(CHAT_SETTINGS_FILE, "utf-8")) || {};
    // api_key（GATEWAY key）不回明文：置空+api_key_set 布尔（2026-09-20 审查 P1-1 收尾）；
    // PUT 端空值视为「未改动」保留现值，脱敏回写不会抹掉真 key
    if (typeof data.api_key === "string") {
      data.api_key_set = !!data.api_key.trim();
      data.api_key = "";
    }
    if (data.cfg && typeof data.cfg === "object") {
      const blocked = consoleOwnedCfgKeys();
      const cleanCfg = {};
      for (const k of Object.keys(data.cfg)) if (!blocked.has(k)) cleanCfg[k] = data.cfg[k];
      data.cfg = cleanCfg;
    }
    reply.send({ ok: true, exists: true, data });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/chat-settings", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    // 以现文件为基合并（此前整份覆盖：PUT 不带 api_key/system_prompt 会把现值抹掉）；
    // api_key 空串=未改动，保留现值（配合 GET 脱敏回写协议）
    let clean = {};
    try { if (fs.existsSync(CHAT_SETTINGS_FILE)) clean = JSON.parse(fs.readFileSync(CHAT_SETTINGS_FILE, "utf-8")) || {}; } catch (e) { clean = {}; }
    if (!clean || typeof clean !== "object" || Array.isArray(clean)) clean = {};
    if (typeof body.api_key === "string" && body.api_key.trim()) clean.api_key = body.api_key;
    if (typeof body.system_prompt === "string") clean.system_prompt = body.system_prompt;
    // 设置页只提交本次变化字段，按键合并到服务器权威配置；旧版 cfg 整包写入仍兼容，
    // 但同样合并而不是整对象替换，避免旧浏览器/另一设备缺少新字段时把云端配置抹掉。
    const cfgPatch = (body.cfg_patch && typeof body.cfg_patch === "object" && !Array.isArray(body.cfg_patch))
      ? body.cfg_patch
      : ((body.cfg && typeof body.cfg === "object" && !Array.isArray(body.cfg)) ? body.cfg : null);
    if (cfgPatch) {
      const blocked = consoleOwnedCfgKeys();
      const cfg = (clean.cfg && typeof clean.cfg === "object" && !Array.isArray(clean.cfg)) ? { ...clean.cfg } : {};
      for (const k of Object.keys(cfgPatch)) {
        const v = cfgPatch[k];
        // 背景图/透明度按主题独立存放；用 dotted patch 精确设置或删除一项，
        // 避免一个设备改 warm 主题时覆盖另一设备刚改的 dark 主题。
        const bgMatch = /^(bg_by_theme|bg_opacity_by_theme)\.([a-z0-9_-]+)$/.exec(k);
        if (bgMatch) {
          const mapKey = bgMatch[1], themeKey = bgMatch[2];
          if (blocked.has(mapKey)) continue;
          const map = (cfg[mapKey] && typeof cfg[mapKey] === "object" && !Array.isArray(cfg[mapKey])) ? { ...cfg[mapKey] } : {};
          if (v === null || v === undefined || v === "") delete map[themeKey];
          else map[themeKey] = v;
          cfg[mapKey] = map;
          continue;
        }
        if (blocked.has(k)) { console.warn("[chat-settings] 拦截管理台专属参数从设置页写入:", k); continue; }
        cfg[k] = v;
      }
      clean.cfg = cfg;
    }
    const _prevTTGlobal = (function () { try { const _o = JSON.parse(fs.readFileSync(CHAT_SETTINGS_FILE, "utf-8")); return (_o && _o.cfg) ? _o.cfg.time_tag_to_ai : undefined; } catch (e) { return undefined; } })();
    writeJsonFileAtomic(CHAT_SETTINGS_FILE, clean);
    // 1025：全局时间缀开关变化 → 影响所有「跟随默认」会话的固化历史 → 清全部快照（下轮懒生成）
    if (cfgPatch && Object.prototype.hasOwnProperty.call(cfgPatch, "time_tag_to_ai") && cfgPatch.time_tag_to_ai !== _prevTTGlobal) {
      try {
        const sv2 = require("./context/context-snapshot-v2");
        const _dir = path.join(__dirname, "data", "session_ctx_snapshots_v2");
        let _n = 0;
        if (fs.existsSync(_dir)) {
          for (const _f of fs.readdirSync(_dir)) {
            if (!_f.endsWith(".json") || _f.startsWith(".stale-")) continue;
            const _sid = _f.replace(/\.json$/, "");
            try { sv2.deleteSnapshot(__dirname, _sid); sv2.clearStale(__dirname, _sid); _n++; } catch (e) {}
          }
        }
        console.log("[chat-settings] time_tag_to_ai 全局开关变化，已清全部快照 " + _n + " 个（下轮懒生成）");
      } catch (e) { console.warn("[chat-settings] 时间缀开关清快照失败:", e.message); }
    }
    reply.send({ ok: true, saved: true });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// [位置:server.js·/admin/world-pages] [小世界页面清单（只读）] [10-24：手机「我的 → 小世界」列出他用 world 工具摆的页面；实现见 lib/world-pages.js（注意：这是 AI 的 world 沙盒目录，和旧门户 workspace/index.html「小世界·月下」无关）] [注释时间 2026-10-24]
app.get("/admin/world-pages", { preHandler: basicAuth }, async (req, reply) => {
  try { reply.send({ ok: true, pages: require("./lib/world-pages").list() }); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});

// [2026-11-25：小世界右上角 + 上传 HTML 页面，落盘为 little-world/apps/world/<name>/index.html]
app.post("/admin/world-pages/upload", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const { name, data } = req.body || {};
    if (!name || !data) return reply.code(400).send({ ok: false, msg: "缺名字或内容" });
    const safe = String(name).replace(/[^\w\u4e00-\u9fa5.-]/g, "_").slice(0, 40);
    if (!safe) return reply.code(400).send({ ok: false, msg: "名字无效" });
    const dir = path.join(__dirname, "little-world", "apps", "world", safe);
    await fs.promises.mkdir(dir, { recursive: true });
    const html = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ""), "base64").toString("utf8");
    if (!/<html|<!doctype/i.test(html.slice(0, 200))) return reply.code(400).send({ ok: false, msg: "看起来不像 HTML" });
    await fs.promises.writeFile(path.join(dir, "index.html"), html, "utf8");
    reply.send({ ok: true, path: safe + "/" });
  } catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
});

// ================= [位置:server.js·会话杂项接口] [会话改名/人设/归档/置顶/锁定唤醒/分支/当前会话 + 子智能体详情/状态/终止] [2026-11-03 server.js 拆分批 2：路由整段（原 8630-8891 行）已拆到 routes/session-misc.js，归档名单读写拆到 lib/session-archive.js，逻辑未改；SESSION_NAMES_FILE 别处也用（约 5354 行），定义留在这里] [注释时间 2026-11-03]
// 会话改名映射跨设备同步（存 data/session-names.json）
const SESSION_NAMES_FILE = path.join(__dirname, "data", "session-names.json");
require("./routes/session-misc")(app, { basicAuth, subagentRunner, writeJsonFileAtomic, sessionCfg, baseDir: __dirname, SESSION_NAMES_FILE, readSessionArchive, writeSessionArchive });

// 唤醒原始日志（wake-up 独立进程的 pm2 日志尾读）：2026-09-15 进程退役后日志不再增长，
// 仅剩历史排查价值；路径可经 WAKE_UP_LOG_PATH 覆盖

// ========================
// 启动服务
// ========================
// ========================
// 初始化记忆引擎
// ========================
const tagParser = require("./lib/tag-parser");
const memoryEngine = require("./memory/memory-engine");

require("./memory/memory-engine").init().then(() => {
  console.log("[memory] 记忆引擎就绪");
}).catch(err => {
  console.error("[memory] 记忆引擎初始化失败:", err.message);
});

// 2026-09-28：V1 记忆池删除——memory-pool require/init/shutdown 全部移除
// （memory-engine 空壳 shutdown 已于 1335d36 删除；退出仅保留 V2 记忆闪存兜底）
// 1019 重启保护：收到退出信号时先排空——有回复在生成就等它落盘再退（最长 110s，pm2 kill_timeout=125s）。
// 排空期间新的聊天请求直接 503（前端稍后重试），不再开新生成。第二次信号立即退出。
function busyWork() {
  const now = Date.now();
  const items = [];
  for (const [sid, g] of activeGenMap) {
    if (g && !g.done && now - (g.ts || 0) < ACTIVE_GEN_TTL_MS) items.push("生成中:" + sid);
  }
  for (const [id, r] of recentReplies) {
    if (r && r.pending && now - (r.ts || 0) < IDEMPOTENCY_TTL_MS) items.push("待回复:" + String(id).slice(0, 12));
  }
  try { if (wakeScheduler && wakeScheduler.isBusy && wakeScheduler.isBusy()) items.push("唤醒进行中"); } catch (e) { /* ignore */ }
  return items;
}
// 1025 产品确定：排空超时强杀前，把生成中的部分回复先落盘——重启可以，字不能丢。
// 口径与用户手动停止的 partial 收尾一致（正文+思考+工具+segments+stream_timeline），但不回写 HTTP（进程都要退了）。
function flushPendingGens() {
  let n = 0;
  for (const [sid, g] of activeGenMap) {
    try {
      if (!g || g.done || g.persisted) continue;
      const partial = String(g.text || "");
      // 2026-10-27 补口（「重启可以，字不能丢」的延伸）：正文空但思考/工具已有内容时也落盘占位，
      // 否则重启后这轮在时间线里完全消失——10-27 凌晨实测事故：生成中重启，整轮回复蒸发。
      const hasExtras = !!String(g.reasoning || "").trim() || (Array.isArray(g.tools) && g.tools.some(Boolean)) || (Array.isArray(g.parts) && g.parts.length > 0);
      if (!partial.trim() && !hasExtras) continue;
      const content = partial.trim() ? partial : "（回复在此中断，未生成正文——思考与工具步骤已保留）";
      /* 同 _finishCancelledMcp：占位文案进 parts + running 工具收尾 */
      if (!partial.trim() && hasExtras && Array.isArray(g.parts)) {
        const _hasText = g.parts.some(n => n && n.type === "text" && String(n.text || "").trim());
        if (!_hasText) g.parts.push({ type: "text", text: content });
        g.parts.forEach(n => { if (n && n.type === "tool" && n.tool && n.tool.status === "running") { n.tool.status = "failed"; if (!n.tool.error) n.tool.error = "回复被中断"; } });
      }
      const _frid = g.replyMsgId || null;
      const timeline = loadTimeline(sid);
      const exists = timeline.some(m => m && !m.deleted && m.role === "assistant" && (_frid ? m.id === _frid : m.content === content));
      if (!exists) {
        appendMessages(sid, [{ role: "assistant", content: content, reasoning: g.reasoning || "", tools: g.tools || [], tokens: null, segments: content.split(/\n\s*\n/).map(function (s2) { return stripToolEchoBlocks(tagParser.stripTags(s2)); }).filter(Boolean), stream_timeline: (Array.isArray(g.parts) && g.parts.length) ? g.parts.slice() : undefined }]);
      }
      g.persisted = true; g.done = true; g.ts = Date.now();
      n++;
      console.warn("[shutdown] 强杀前落盘部分回复 (session=" + sid + ", chars=" + content.length + ")");
    } catch (e) { console.warn("[shutdown] 强杀前落盘失败 (session=" + sid + "):", e && e.message); }
  }
  return n;
}
const gracefulShutdown = require("./lib/graceful-shutdown").createGracefulShutdown({
  getBusy: busyWork,
  drainMs: Number(process.env.SHUTDOWN_DRAIN_MS) || 110000,
  flushPending: flushPendingGens,
  exit: (code) => process.exit(code),
});
app.addHook("onRequest", async (req, reply) => {
  if (gracefulShutdown.isShuttingDown() && req.method === "POST" && req.url && (req.url.startsWith("/v1/chat/completions") || req.url.startsWith("/v1/chat/"))) {
    reply.header("Retry-After", "8");
    return reply.code(503).send({ error: "服务正在重启，请几秒后重试" });
  }
});
app.get("/internal/busy", async () => ({ ok: true, shuttingDown: gracefulShutdown.isShuttingDown(), busy: busyWork() }));
process.on("SIGINT", () => { gracefulShutdown.handle("SIGINT"); });
process.on("SIGTERM", () => { gracefulShutdown.handle("SIGTERM"); });


// ================= [位置:server.js·工作流文件管理] [小手机「我的 → 工作流」文件管理接口] [2026-11-03 server.js 拆分批 1：整段（原 9014-9280 行，11 条 /admin/workflow/* 路由 + wf* 辅助函数）已拆到 routes/workflow-files.js，逻辑未改] [注释时间 2026-11-03]
require("./routes/workflow-files")(app, { basicAuth, atomicWriteFileSync, baseDir: __dirname });

app.listen({ port: PORT, host: process.env.LISTEN_HOST || "127.0.0.1" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`✅ Gateway 运行在 ${address}`);
  // 批3收尾（2026-09-15）：wake-up 独立进程退役，唤醒调度器在 gateway 内启动。
  // 心跳不再 HTTP 自环自拍，直接置位（管理台在线状态同源）；调度器周期检查时持续刷新。
  setTimeout(() => {
    try {
      wakeScheduler.start();
      // 启动后先扫描一次；之后每 15 秒检查。调度只扫描落盘的 pending 提醒。
      setTimeout(() => { scanTodoReminders(); }, 1500);
      setInterval(() => { scanTodoReminders(); }, 15000).unref();
      wakeUpLastHeartbeat = Date.now();
      try { if (memoryDistill) memoryDistill.start(); } catch (e) { console.error("[memory-distill] 启动失败:", e && e.message); }
      try { if (memorySummary) memorySummary.start(); } catch (e) { console.error("[memory-summary] 启动失败:", e && e.message); }
      try { if (memoryBackfill) memoryBackfill.start(); } catch (e) { console.error("[memory-backfill] 启动失败:", e && e.message); }
      console.log('心跳状态已恢复');
    } catch (e) {
      console.error("[wake-scheduler] 启动失败:", e && e.message);
    }
  }, 3000);
});
