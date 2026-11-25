"use strict";
/*
 * 上下文替换模块（统一版）
 *
 * 说明：
 * - 所有「替换」统一为同一种记录：把一段原文对话替换成一段浓缩文字（回忆/摘要）。
 * - 来源只有展示意义：source = "ai"（AI 工具 context_replace 创建）| "manual"（后台手动创建）。
 * - 生效逻辑统一：发送前按内容锚点定位记录范围，替换成占位消息；源时间线不动。
 * - 旧压缩器（context-compactor）的发送路径已停用，由本模块统一处理。
 */

const fs = require("fs");
const path = require("path");
const ROOT_DIR = path.join(__dirname, "..");  // 1018-13：模块已搬进子目录，项目根 = 上一级
const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const { nowIso, parseMsgTimestamp } = require("../utils/time_utils");

const DATA_DIR = path.join(ROOT_DIR, "data");
const REPLACEMENTS_FILE = path.join(DATA_DIR, "context_replacements.json");
const TIMELINE_DIR = require("../lib/timeline-dir").TIMELINE_DIR; // 1018-12：时间线统一放 timeline_data/
const TIMELINE_FILE = path.join(TIMELINE_DIR, "enhanced_messages.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const MEMORY_POOL_CONFIG_FILE = path.join(DATA_DIR, "memory_pool_config.json");

const MAX_MEMORY_CHARS = 100000;

// ========================
// 每次请求的替换/压缩记录（供管理台查看；含对话/共影/唤醒等所有来源）
// ========================
const REPLACE_LOG_FILE = path.join(DATA_DIR, "context_replace_log.json");
const REPLACE_LOG_CAP = 10;
const REPLACE_LOG_FLUSH_MS = 5000;
let _replaceLogCache = null;
let _replaceLogDirty = false;
let _replaceLogTimer = null;

function _ensureReplaceLog(force) {
  if (_replaceLogCache === null || force) {
    let v = readJson(REPLACE_LOG_FILE, []);
    _replaceLogCache = Array.isArray(v) ? v : [];
  }
  return _replaceLogCache;
}

// 2026-09-22 审查 R14：原实现每次 append 都同步写整份文件，而「无替换」的请求占大多数
// （applyReplacements 三个分支各调一次 logNoReplace）→ 聊天高峰期每条消息一轮同步写盘。
// 改为内存聚合 + 5s debounce 刷盘；读侧 getReplaceLog 先 flush 保证查询不失真；
// 进程退出（含 pm2 重启）时在 exit 里兜底刷一次，最多丢最后 5s 的日志（日志用途，可接受）。
function flushReplaceLog() {
  if (!_replaceLogDirty) return;
  try {
    writeJsonAtomic(REPLACE_LOG_FILE, _ensureReplaceLog());
    _replaceLogDirty = false;
  } catch (e) {
    console.warn("[context-replacements] 替换日志刷盘失败:", e.message);
  }
}

function appendReplaceLog(entry) {
  try {
    const log = _ensureReplaceLog();
    log.push(entry);
    if (log.length > REPLACE_LOG_CAP) log.splice(0, log.length - REPLACE_LOG_CAP);
    _replaceLogDirty = true;
    if (!_replaceLogTimer) {
      _replaceLogTimer = setTimeout(function () { _replaceLogTimer = null; flushReplaceLog(); }, REPLACE_LOG_FLUSH_MS);
      if (typeof _replaceLogTimer.unref === "function") _replaceLogTimer.unref();   // 不因这个定时器拖住进程退出
    }
  } catch (e) {
    console.warn("[context-replacements] 替换日志记录失败:", e.message);
  }
}

// 进程退出兜底（pm2 restart / SIGINT / SIGTERM 均会触发 exit）：把 debounce 窗口内未刷的日志落盘
try { process.on("exit", function () { try { flushReplaceLog(); } catch (e) {} }); } catch (e) {}

// ========================
// 基础工具
// ========================
// mtime 感知文件缓存：文件未变化（mtime+size 相同）时复用内存结果，避免对同一份大盘内容反复读盘
const _readJsonCache = new Map();
const READ_JSON_CACHE_MAX = 50;                     // 条数上限，防止长期运行缓存无限膨胀
// 2026-09-22 审查 R11：原实现只有条数上限、不看体积——时间线单文件可达数 MB，几十个会话全读过后
// 常驻内存轻松上百 MB（解析后的对象通常比磁盘 JSON 大 1.5–3 倍）。改为按「总字节预算」淘汰：
// 单条大文件（如 18MB 的 context_replacements.json）仍可缓存，但累积超预算即按 LRU 丢最旧的。
const READ_JSON_CACHE_BUDGET = 48 * 1024 * 1024;
let _readJsonCacheBytes = 0;
function _readJsonCacheDrop(file) {
  const ev = _readJsonCache.get(file);
  if (ev) { _readJsonCacheBytes -= (Number(ev.size) || 0); _readJsonCache.delete(file); }
}
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const st = fs.statSync(file);
    const ck = st.mtimeMs + ':' + st.size;
    const hit = _readJsonCache.get(file);
    if (hit && hit.ck === ck) {
      // 命中即刷新热度（删除后重插，把该条移到 Map 尾部当作最近使用），用于后续 LRU 淘汰
      _readJsonCache.delete(file);
      _readJsonCache.set(file, hit);
      return hit.data;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (hit) _readJsonCacheDrop(file);   // 同文件旧版本先摘掉，避免字节计数重复累加
    _readJsonCache.set(file, { ck: ck, data: data, size: st.size });
    _readJsonCacheBytes += st.size;
    // 超限淘汰：条数超上限 或 总字节超预算 → 删 Map 头部（最久未使用）；至少保留当前这一条
    while ((_readJsonCache.size > READ_JSON_CACHE_MAX || _readJsonCacheBytes > READ_JSON_CACHE_BUDGET) && _readJsonCache.size > 1) {
      const oldest = _readJsonCache.keys().next().value;
      if (oldest === undefined) break;
      _readJsonCacheDrop(oldest);
    }
    return data;
  } catch (err) {
    console.warn("[context-replacements] 读取失败:", file, err.message);
    return fallback;
  }
}

// 2026-09-30 V10 收敛：原子写实现统一委托 json_atomic.writeJsonAtomic；
// 本模块的读缓存失效副作用在这里包一层保留。
const { writeJsonAtomic: _writeJsonAtomicBase } = require("../utils/json_atomic");
function writeJsonAtomic(file, data) {
  _writeJsonAtomicBase(file, data);
  _readJsonCache.delete(file);
}

// 2026-09-13 轻量缓解（用户拍板）：备份节流——14.5MB 存档每次写都全量 copyFileSync 会卡
// 事件循环；同文件 10 分钟内已备份过则跳过（原子写保证半截文件不会落盘，备份防的是内容
// 写错而非写坏，10 分钟数据窗口可接受；.bak-* 轮转仍保留最近 2 份）。
const _backupLastAt = new Map();
const BACKUP_THROTTLE_MS = 10 * 60 * 1000;
function backupFile(file) {
  try {
    if (!fs.existsSync(file)) return;
    const lastAt = _backupLastAt.get(file) || 0;
    if (Date.now() - lastAt < BACKUP_THROTTLE_MS) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(file, file + ".bak-" + ts);
    _backupLastAt.set(file, Date.now());
    // 轮转：同一基础文件的 .bak-* 仅保留最近 2 份，避免每次保存全量备份导致 data/ 无限膨胀
    try {
      const dir = path.dirname(file);
      const prefix = path.basename(file) + ".bak-";
      const keep = 2;
      const matches = fs.readdirSync(dir).filter(function (n) { return n.startsWith(prefix); }).sort().reverse();
      matches.slice(keep).forEach(function (n) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) {} });
    } catch (e) {}
  } catch (err) {
    console.warn("[context-replacements] 备份失败:", err.message);
  }
}

// nowIso 已统一到 time_utils 模块（原先本模块与 memory-pool 各有一份相同实现）

// 判断消息是否为「替换」生成的占位消息（压缩/唤醒等环节需保护，避免被吞掉）
// 与 routes/chat-context.js isSummaryPlaceholder、server.js token 估算跳过三处同口径，改一处必须同步其余
function isReplacementMemoryMessage(msg) {
  // 2026-09-28 压缩块改为 developer 段后，这里同步放行 developer（assistant 历史格式仍兼容）
  if (!msg || (msg.role !== "assistant" && msg.role !== "developer")) return false;
  const c = String(msg.content || "");
  return c.startsWith("## Historical Summary") || c.startsWith("（回忆 · ") || c.startsWith("（对话摘要");
}

// 解析消息时间（2026-09-30 V4 收敛）：本地两级链已删，统一引 time_utils 标准链。
// 行为增强=修复不一致：原版缺 <current_time> 标签与末尾时间缀分支，同一消息在这里与
// 压缩器（context-compactor）解析出不同时间，压缩块 range_label 与压缩页预览对不上。
const messageTime = parseMsgTimestamp;

// 解析时间范围边界的 parseRangeBound 已删（2026-09-19 统一消息 id 锚点，时间定位入口全清）

// ========================
// 消息判断（与旧压缩器口径一致，发送链路统一后迁到本模块）
// ========================

function contentToText(msg) {
  const c = msg && msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map(function (p) {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") return p.text || p.content || "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// 日记落库格式：（YYYY-MM-DD HH:MM diary）换行 [DIARY]正文[/DIARY]（lib/diary.js wrapDiaryTag）；兼容发上游追加的 · id:xxx 及无时间行格式
const DIARY_WRAPPED_RE = /^\s*（(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+)?diary(?:\s*·\s*id:\s*\d+)?）\s*\[DIARY\]/i;
function isSpecialEvent(msg) {
  if (!msg || msg.role !== "assistant") return false;
  const c = String(msg.content || "").replace(/\s+/g, " ").trim();
  if (!c) return false;
  /* [位置:context-replacements.js·isSpecialEvent] [日记消息永远不是特殊事件] [日记落库格式带「（日期 时间 diary）」时间行后以「（日期」开头，会命中 structuredStart；日记正文里若写到「记忆碎片/时间标记」等词就会被误判成特殊事件、被时间线过滤掉] [注释时间 2026-10-22] */
  if (msg.kind === "diary" || DIARY_WRAPPED_RE.test(c)) return false;
  const structuredStart = /^（\s*(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|刚刚|自动唤醒|醒来写了日记|自动写了日记|记忆浮现|时间标记|摘要|共影|截图|记忆碎片|容量提醒)/.test(c);
  if (!structuredStart) return false;
  return (
    c.indexOf("刚刚给宝宝发了 Bark") !== -1 ||
    /刚刚给[^：]*发了 Bark/.test(c) ||
    c.indexOf("自动唤醒：本次未发送 Bark") !== -1 ||
    c.indexOf("自动唤醒：本次未发送推送") !== -1 ||
    (/刚刚给[^：]*发了/.test(c) && c.indexOf("推送") !== -1) ||
    (/刚刚给宝宝发了/.test(c) && c.indexOf("推送") !== -1) ||
    c.indexOf("醒来写了日记") !== -1 ||
    c.indexOf("自动写了日记") !== -1 ||
    c.indexOf("记忆浮现）") !== -1 ||
    c.indexOf("时间标记") !== -1 ||
    c.indexOf("摘要）") !== -1 ||
    c.indexOf("共影）") !== -1 ||
    c.indexOf("截图）") !== -1 ||
    c.indexOf("截图唤醒）") !== -1 ||
    c.indexOf("记忆碎片") !== -1 ||
    c.indexOf("（容量提醒）") !== -1
  );
}

function isMemoryFlash(msg) {
  if (!msg || msg.role !== "assistant") return false;
  return isSpecialEvent(msg) && String(msg.content || "").indexOf("记忆浮现") !== -1;
}

// 日记特殊事件：AI 唤醒/后台自主时写的日记，永远不参与压缩，单独保留在上下文
// 事件名 2026-09-12 起「醒来写了日记」，旧数据兼容「自动写了日记」。
// 2026-09-21 补：唤醒 v2 落库改为 {kind:"diary", content:"[DIARY]（…醒来写了日记：…）"}——
// [DIARY] 前缀导致 isSpecialEvent 的 structuredStart（要求以「（」开头）认不出，
// 日记被当普通对话放行进压缩索引（实测 87 条里 77 条被收录）。此处改为不依赖
// isSpecialEvent 独立判定：认 kind 字段 / [DIARY] 前缀 / 旧格式文本三种形态。
// 注意 isSpecialEvent 本身刻意不动：日记当前以普通 assistant 消息内联进上下文，
// 若升格为特殊事件而注入机制不认回，日记会整段从上下文消失。
// 2026-09-29：真日记判定——只保护「AI 实际写的日记内容」（assistant 的 kind=diary / [DIARY] 前缀 /
// 「醒来写了日记/自动写了日记」事件）。developer 的写日记通知提示（[小世界] 涵写了日记（时间），无正文）
// 不算真日记：默认参与压缩，该压就压，避免在上下文里无限堆积。
function isRealDiary(msg) {
  if (!msg || msg.role !== "assistant") return false;
  if (msg.kind === "diary") return true;
  const c = String(msg.content || "");
  if (/^\s*\[DIARY\]/.test(c) || DIARY_WRAPPED_RE.test(c)) return true;
  return isSpecialEvent(msg) && (c.indexOf("醒来写了日记") !== -1 || c.indexOf("自动写了日记") !== -1);
}

// 记忆碎片特殊事件：跨窗口带走的标星正文，永不压缩
function isStarEvent(msg) {
  if (!msg || msg.role !== "assistant") return false;
  return isSpecialEvent(msg) && String(msg.content || "").indexOf("记忆碎片") !== -1;
}

// 特殊事件注入分类：一个事件可能命中多类，返回命中的所有分类 key（与 server.js 保持一致）
function classifySpecialEvent(msg) {
  if (!isSpecialEvent(msg)) return [];
  const c = String(msg.content || "");
  const out = [];
  if (/自动唤醒|本次未发送/.test(c)) out.push("wake");
  else if (/发了 Bark|推送/.test(c)) out.push("push");
  if (c.indexOf("醒来写了日记") !== -1 || c.indexOf("自动写了日记") !== -1) out.push("diary");
  if (c.indexOf("记忆浮现）") !== -1) out.push("memory");
  if (c.indexOf("时间标记") !== -1) out.push("time");
  if (c.indexOf("摘要）") !== -1) out.push("summary");
  if (c.indexOf("共影）") !== -1) out.push("co");
  if (c.indexOf("截图）") !== -1 || c.indexOf("截图唤醒）") !== -1) out.push("screenshot");
  if (c.indexOf("记忆碎片") !== -1) out.push("star");
  return out;
}

function eventKey(msg) {
  return ((msg && msg.role) || "") + "\u0000" + String((msg && msg.content) || "");
}

// 读取特殊事件注入所需配置（与 server.js 注入逻辑共用同一套口径）
function loadEventInjectConfig() {
  let cfg = {};
  try { cfg = readJson(CONFIG_FILE, {}); } catch (e) {}
  let pool = {};
  try { pool = readJson(MEMORY_POOL_CONFIG_FILE, {}); } catch (e) {}
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
  if (!pool || typeof pool !== "object" || Array.isArray(pool)) pool = {};
  const injectTypes = Array.isArray(cfg.event_inject_types) ? cfg.event_inject_types : null;
  const coEventInjectEnabled = cfg.co_event_inject_enabled !== false;
  const pushEnabled = pool.cross_inject_push !== false;
  return { injectTypes: injectTypes, coEventInjectEnabled: coEventInjectEnabled, pushEnabled: pushEnabled };
}

// 当前窗口起点：最新一次重建时间线里第一条真实 user 消息的时间。
// 「当前窗口」之后（含）的特殊事件才是本次会话真正相关的；更早的属于旧窗口，不注入、不进压缩页。
function currentWindowStartMs(timeline) {
  let ms = null;
  (Array.isArray(timeline) ? timeline : []).forEach(function (m) {
    if (ms !== null) return;
    if (!m || m.role !== "user") return;
    if (m._ctxRep || m._ccSummary || m.tool_calls) return;
    if (isSpecialEvent(m)) return;
    const t = messageTime(m);
    if (t) ms = t.getTime();
  });
  if (ms !== null) return ms;
  // 兜底：没有 user 时退到最早真实 assistant 消息
  (Array.isArray(timeline) ? timeline : []).forEach(function (m) {
    if (ms !== null) return;
    if (!m || m.role !== "assistant") return;
    if (m._ctxRep || m._ccSummary || m.tool_calls) return;
    if (isSpecialEvent(m)) return;
    const t = messageTime(m);
    if (t) ms = t.getTime();
  });
  return ms;
}

// 计算「真实请求会注入」的特殊事件集合（按内容键去重）。口径与 server.js 完全一致：
// 仅取当前窗口（第一条真实 user 消息之后）内的特殊事件，窗口内不限条数；按 event_inject_types 过滤，共影等见 co_event_inject_enabled。
function collectInjectionVisibleEvents(timeline) {
  const cfg = loadEventInjectConfig();
  const vis = new Set();
  const pushEnabled = cfg.pushEnabled;
  const injectTypes = cfg.injectTypes;
  const coEnabled = cfg.coEventInjectEnabled;
  const windowStartMs = currentWindowStartMs(timeline);
  (Array.isArray(timeline) ? timeline : []).forEach(function (m) {
    if (!isSpecialEvent(m)) return;
    if (windowStartMs !== null) {
      const t = messageTime(m);
      if (t && t.getTime() < windowStartMs) return;
    }
    if (!pushEnabled) {
      const cats = classifySpecialEvent(m) || [];
      if (cats.indexOf("push") >= 0) return;
    }
    if (!coEnabled && typeof m.content === "string" && m.content.indexOf("共影）") !== -1) return;
    if (Array.isArray(injectTypes) && injectTypes.length > 0) {
      const cats = classifySpecialEvent(m);
      if (cats.length && !cats.some(function (k) { return injectTypes.indexOf(k) >= 0; })) return;
    }
    vis.add(eventKey(m));
  });
  return vis;
}

let _eventVisCache = null;
function eventInjectionVisibleKeys() {
  const cfg = loadEventInjectConfig();
  // 2026-09-22 审查 R10：缓存键的 stat 必须用「当前活跃会话」自己的时间线文件，
  // 而不是主会话 default 的 enhanced_messages.json。缓存值 collectInjectionVisibleEvents(loadTimeline())
  // 是按 effectiveSession() 加载的当前会话时间线算的，键与值的失效源必须一致。
  const sid = effectiveSession();
  let timelineFile = TIMELINE_FILE;
  if (sid && sid !== "default") {
    const token = require("../lib/session-token").safeSessionToken(sid);
    timelineFile = path.join(TIMELINE_DIR, "enhanced_messages_" + token + ".json");
  }
  let stat;
  try { stat = fs.statSync(timelineFile); } catch (e) { stat = { mtimeMs: 0, size: 0 }; }
  const sidSafe = String(sid || "").replace(/[^A-Za-z0-9_-]/g, "");
  const ck = sidSafe + ":" + JSON.stringify(cfg) + ":" + stat.mtimeMs + ":" + stat.size;
  if (_eventVisCache && _eventVisCache.ck === ck) return _eventVisCache.keys;
  const keys = collectInjectionVisibleEvents(loadTimeline());
  _eventVisCache = { ck: ck, keys: keys };
  return keys;
}

// 该消息是否属于「真实请求会注入」的特殊事件；非特殊事件恒返回 true
function isEventInjectionVisible(msg) {
  if (!isSpecialEvent(msg)) return true;
  // 容量提醒恒视为可见（可被压缩块覆盖）：visibleKeys 基于主会话计算，多会话下会对不上
  if (msg && msg.kind === "ctx_limit") return true;
  return eventInjectionVisibleKeys().has(eventKey(msg));
}

function isCompressible(msg, includeEvents) {
  if (!msg) return false;
  // 2026-09-28 用户拍板：developer 默认参与压缩（判定记录/日记通知/唤醒提示该压就压），
  // 只排除顶部系统注入块与保护类消息；system（人设）仍不压缩。
  const role = msg.role;
  if (role !== "user" && role !== "assistant" && role !== "developer") return false;
  // 顶部系统注入块排除：
  if (role === "system") return false;                    // 人设（最顶，永不压缩）
  if (isReplacementMemoryMessage(msg)) return false;      // 压缩块替身（防自压缩）
  if (typeof msg.content === "string") {
    const t = String(msg.content).trim();
    // V2 注入块（## 英文名：Context Assembly / System Instructions / Core Identity / …）
    // 请求时注入不落盘，此处兜底防未来落盘；V1 旧块 [永久上下文]/[跨窗口] 同兜底（V2 已剔除）。
    if (t.startsWith("## ")) return false;
    if (t.startsWith("[永久上下文]") || t.startsWith("[跨窗口]")) return false;
  }
  // 2026-09-13 审查修复：软删除消息不进压缩索引——此前已删除的容量提醒仍占编号、
  // 计入容量估算，且原文被发给摘要模型导致摘要串味（compactor/findContentByKey 等处均已过滤）
  if (msg.deleted) return false;
  if (isRealDiary(msg)) return false; // 真日记永远不压缩（developer 写日记通知提示可压缩，0929）
  if (isStarEvent(msg)) return false; // 记忆碎片永远不压缩（与日记同级，跨窗口带走的标星正文）
  if (!includeEvents && msg.role === "assistant" && isSpecialEvent(msg)) return false;
  // 特殊事件只在当前事件窗口内才计入压缩索引：与真实请求注入口径一致，避免旧窗口事件残留在未覆盖区
  if (includeEvents && msg.role === "assistant" && isSpecialEvent(msg) && !isEventInjectionVisible(msg)) return false;
  if (msg.tool_calls || msg.tool_call_id) return false;
  return contentToText(msg).trim().length > 0;
}

// 内容定位锚点：去内部标签 + 去首尾空白，容忍清洗/标签差异
function normalizedCompareKey(msg) {
  const role = (msg && msg.role) || "";
  const c = String(contentToText(msg) || "");
  const stripped = c
    .replace(/<memory>[\s\S]*?<\/memory>/gi, "")
    .replace(/<pin>[\s\S]*?<\/pin>/gi, "")
    .replace(/<current_time>[\s\S]*?<\/current_time>/gi, "")
    .replace(/<star\b[^>]*>(?:\s*<\/star\s*>)?/gi, "")
    .replace(/<\s*paper\b[^>]*>(?:[\s\S]*?<\s*\/paper\s*>)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return role + "\u0000" + stripped;
}


function fmtWall(d) {
  const p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

// ========================
// 数据读写
// ========================
// 2026-10-01 性能：REPLACEMENTS_FILE 实测 9.8MB，JSON.parse 单次约 41ms，而一次聊天请求
// 会多次 loadItems（buildIncrementalContext / applyReplacements / 管理台等）。按 mtimeMs+size
// 缓存解析结果（mtime+size 双键），命中只付一次 statSync（≈0ms）。
// 安全性：本文件所有写路径均为「loadItems → 改 → saveItems」纯同步（见文件头并发约束），
// 且 saveItems 会主动清缓存，故返回缓存引用不会被「改了不落盘」污染；server.js 三处外部
// 调用（5079/5556/5965）均为 filter 只读。
let _itemsCache = { mtime: null, size: null, value: null };
function loadItems() {
  try {
    const st0 = fs.statSync(REPLACEMENTS_FILE);
    if (_itemsCache.value && _itemsCache.mtime === st0.mtimeMs && _itemsCache.size === st0.size) {
      return _itemsCache.value;
    }
  } catch (e) { /* 读不到 stat 就走原路径重新解析 */ }
  const items = readJson(REPLACEMENTS_FILE, []);
  const arr = Array.isArray(items) ? items : [];
  try {
    const st1 = fs.statSync(REPLACEMENTS_FILE);
    _itemsCache = { mtime: st1.mtimeMs, size: st1.size, value: arr };
  } catch (e) { _itemsCache = { mtime: null, size: null, value: null }; }
  return arr;
}

// 2026-09-13 并发约束（实测核实）：本文件所有「loadItems → 改 → saveItems」调用链必须保持
// 纯同步——同步段在事件循环内原子，天然无并发丢块；若未来任何链路中间夹了 await，
// 必须先引入写链（参照 server.js envWriteChain 的 promise 串行化）再动手，否则会产生
// 「后写者整份覆盖前写者」的丢失更新。
function saveItems(items) {
  // 2026-10-01：写前主动失效缓存——不依赖 mtime 精度，且写失败时下次 load 也会重解析拿盘上真实数据
  _itemsCache = { mtime: null, size: null, value: null };
  backupFile(REPLACEMENTS_FILE);
  writeJsonAtomic(REPLACEMENTS_FILE, items);
  pruneCoveredVersions(items);
}

// 压缩联动（2026-11-10 产品确定）：确认压缩后清掉被压区间内的版本存档。
// 挂在 saveItems（压缩记录唯一写入口）一处全覆盖：状态机 upsertSpanRecord、手动整理、迁移/继承
// 都经过这里；失败只告警不挡压缩。停用/删除块时同样会跑，但只删「启用块覆盖」的锚点，行为正确。
function pruneCoveredVersions(items) {
  let tv;
  try { tv = require("../lib/timeline-versions"); } catch (e) { return; }
  const bySession = {};
  (Array.isArray(items) ? items : []).forEach(function (it) {
    if (!it || it.removed || it.enabled === false || it.hidden === true) return;
    const sess = it.session || "default";
    (bySession[sess] = bySession[sess] || []).push(it);
  });
  Object.keys(bySession).forEach(function (sess) {
    const store = tv.load(ROOT_DIR, sess);
    if (!Object.keys(store).length) return;   // 没有版本存档的会话一次就出去（分支/合并写记录时基本都走这）
    const tl = loadTimeline(sess);
    const idPos = new Map();
    (Array.isArray(tl) ? tl : []).forEach(function (m, i) { if (m && m.id && !idPos.has(String(m.id))) idPos.set(String(m.id), i); });
    const ids = tv.coveredAnchors(store, idPos, bySession[sess]);
    if (ids.length && tv.dropAnchors(store, ids)) {
      tv.save(ROOT_DIR, sess, store);
      console.log("[context-replacements] 压缩联动：会话 " + sess + " 清掉被压区间内的版本锚点 " + ids.length + " 个（" + ids.slice(0, 3).map(function (x) { return String(x).slice(0, 8); }).join("、") + "…）");
    }
  });
}

// 取条目的替换正文（text/memory 双字段历史并存，同值读写，兼容旧数据）
function recordText(item) {
  const t = item && (item.text || item.memory);
  return typeof t === "string" ? t : "";
}

// 对外展示用的条目（不含完整 matched 原文，避免响应过大）
function publicItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    created_at: item.created_at,
    source: item.source || "ai",
    text: recordText(item),
    memory: recordText(item),
    range: item.range || {},
    range_label: item.range_label || "",
    count: item.count || 0,
    removed: !!item.removed,
    enabled: item.enabled !== false,
    hidden: item.hidden === true
  };
}

// listReplacements（loadItems→publicItem 的列表包装）已于 2026-09-28 删除：全仓零调用，server 直接组合两者

// ========================
// 时间线
// ========================
// 多会话：按 sessionId 读对应时间线文件；缺省走主会话（enhanced_messages.json）。
// 另支持"活跃会话"上下文：server.js 在请求入口 setActiveSession/清空，让所有内部 loadTimeline() 自动用对会话。
// 多会话并发安全：改用 AsyncLocalStorage 把"活跃会话"绑定到该请求自己的异步上下文，
// 而不是进程级单例 —— 不同会话的请求跨 await 交错时，各自读到自己的会话，避免跨会话串扰。
const _activeSessionAls = new AsyncLocalStorage();
function setActiveSession(sid) { _activeSessionAls.enterWith(sid || null); }
function getActiveSession() { return _activeSessionAls.getStore() || null; }
function activeSessionOr(sessionId) { return (sessionId !== undefined && sessionId !== null) ? sessionId : getActiveSession(); }

// MCP 工具回调的会话兜底：AI 在聊天中调 context_replace 时，工具服务器(8771)回调 /internal/apply
// 是独立请求，ALS 已丢（此前会错落到 default 会话/主会话时间线）。
// 聊天侧进入工具循环前 noteMcpChatSession(sessionId) 登记，回调 90 秒内用它兜底。
// 已知局限（单例残余面）：多设备并发各自进入工具循环时后登记者覆盖前者，先发起的回调可能拿到错误会话；
// 单用户场景概率极低，彻底修复需回调请求携带会话标识（改工具服务器协议），暂不展开。
let _mcpChatSession = null;
let _mcpChatAt = 0;
function noteMcpChatSession(sid) { _mcpChatSession = sid || null; _mcpChatAt = Date.now(); }
function recentMcpChatSession(maxAgeMs) {
  return (Date.now() - _mcpChatAt <= (maxAgeMs || 90000)) ? _mcpChatSession : null;
}
function effectiveSession(sessionId) { return activeSessionOr(sessionId) || recentMcpChatSession(); }

function loadTimeline(sessionId) {
  const sid = effectiveSession(sessionId);
  if (sid && sid !== "default") {
    // 2026-09-21 审查 R20：token 计算收敛到 lib/session-token.js（与 server.js / diary.js 同一实现）。
    // 原本地副本注释自称"与 safeSessionToken 完全同口径"，实际是第四份手抄，改一处漏三处。
    const token = require("../lib/session-token").safeSessionToken(sid);
    return readJson(path.join(TIMELINE_DIR, "enhanced_messages_" + token + ".json"), []);
  }
  return readJson(TIMELINE_FILE, []);
}

function nonSystemMessages(timeline) {
  return (Array.isArray(timeline) ? timeline : []).filter(m => m && m.role !== "system");
}

// 压缩索引空间：非 system 且可压缩的消息（与旧压缩器一致）
function compressibleItems() {
  const timeline = loadTimeline();
  const items = [];
  (Array.isArray(timeline) ? timeline : []).forEach(function (m, i) {
    if (m && m.role !== "system" && isCompressible(m, true)) items.push({ msg: m, idx: i });
  });
  return items;
}

// ========================
// 范围解析：只认「消息 id」（2026-09-19 统一锚点：时间/编号定位已删——编号随时间线增删漂移、
// 时间撞车，只有消息自带 id 全库唯一不漂移）。start_id/end_id 来自 context 工具（search）返回的 msg_id。
// ========================
function resolveRange(range) {
  const timeline = nonSystemMessages(loadTimeline());
  const rng = range || {};
  const startId = rng.start_id !== undefined && rng.start_id !== null ? String(rng.start_id).trim() : "";
  const endId = rng.end_id !== undefined && rng.end_id !== null ? String(rng.end_id).trim() : "";
  if (!startId || !endId) {
    return { ok: false, error: "需要提供消息 id（start_id/end_id）：先用 context 工具检索原文，取首尾两条的 msg_id" };
  }
  const idPos = new Map();
  for (let i = 0; i < timeline.length; i++) {
    const id = timeline[i] && timeline[i].id ? String(timeline[i].id) : null;
    if (id && !idPos.has(id)) idPos.set(id, i);
  }
  const s = idPos.get(startId);
  const e = idPos.get(endId);
  if (s === undefined || e === undefined) {
    return { ok: false, error: "消息 id 在当前会话时间线中不存在（可能换了会话或窗口）" };
  }
  if (s > e) {
    return { ok: false, error: "start_id 在时间线中的位置晚于 end_id，请调换" };
  }
  const matched = timeline.slice(s, e + 1);
  return {
    ok: true,
    matched: matched,
    count: matched.length,
    range_label: rangeLabelOf(matched.map(function (m) { return { msg: m }; })),
    start_index: s,
    end_index: e
  };
}

// 会话合并时复制压缩块到目标会话。目标时间线里的消息 id 与源会话不同，复制后先做一次
// 「内容认亲」：按内容顺序在目标时间线里逐条回找 matched，命中率达 90% 才把 matched 重锚到
// 目标消息 id（含 range 首尾 id）；达不到阈值保留原 matched（后续定位走内容匹配兜底 + 防错闸）。
// 认亲是唯一合法的跨会话内容匹配场景，认完即落回 id 通路。
// 多个源会话存在内容序列完全一致的块时合并为一个（matchedShareSig，与跨会话摘要复用的签名口径一致）。
// 复制语义：源会话的块保留（源会话继续显示摘要），同时复制一份归属到目标会话。
function migrateSessionBlocks(sourceIds, targetId) {
  const src = new Set(Array.isArray(sourceIds) ? sourceIds : []);
  if (src.size === 0 || !targetId) return { migrated: 0, skippedDup: 0, skippedNoMatch: 0 };
  const items = loadItems();
  const out = items.slice();
  const seenSig = new Set();
  let migrated = 0, skippedDup = 0, skippedNoMatch = 0, skippedManual = 0;
  // 1008 手动块失效：只迁移状态块（ctxrep_state_），与分支继承口径一致。
  // 目标会话可锚定序列（普通 user/assistant 对话，与分支继承的 real 口径一致）
  const targetTl = loadTimeline(targetId) || [];
  const anchorSeq = [];
  (Array.isArray(targetTl) ? targetTl : []).forEach(function (m) {
    if (!m || m.role === "system") return;
    if (m.tool_calls) return;
    if (isSpecialEvent(m)) return;
    const text = contentToText(m);
    if (m.role === "user" && String(text).trim().startsWith("<system>")) return;
    if (m.role !== "user" && m.role !== "assistant") return;
    anchorSeq.push(m);
  });
  const anchorKeys = anchorSeq.map(function (m) { return normalizedCompareKey(m); });
  items.forEach(function (it) {
    if (!it || it.removed) return;
    if (!it.session || !src.has(it.session)) return;
    if (!String(it.id || "").startsWith("ctxrep_state_")) { skippedManual++; return; }
    const matched = (Array.isArray(it.matched) && it.matched.length > 0) ? it.matched : [];
    if (matched.length === 0) { skippedNoMatch++; return; }
    const sig = matchedShareSig(matched);
    if (sig) {
      if (seenSig.has(sig)) { skippedDup++; return; }
      seenSig.add(sig);
    }
    // 内容认亲 + 重锚：顺序游标逐条回找，命中不足 90% 则放弃重锚（保留原 matched）
    let cursor = 0, hits = 0, attempts = 0;
    const reanchored = matched.map(function (m) {
      if (!m || isSpecialEvent(m)) return m;
      attempts++;
      const k = normalizedCompareKey(m);
      let p = -1;
      for (let q = cursor; q < anchorKeys.length; q++) {
        if (anchorKeys[q] === k) { p = q; break; }
      }
      if (p < 0) return Object.assign({}, m, { id: undefined });
      cursor = p + 1;
      hits++;
      const nid = anchorSeq[p] && anchorSeq[p].id != null && anchorSeq[p].id !== "" ? String(anchorSeq[p].id) : undefined;
      return Object.assign({}, m, { id: nid });
    });
    const copy = Object.assign({}, it, {
      session: targetId,
      id: "ctxrep_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      created_at: nowIso()
    });
    if (attempts > 0 && hits / attempts >= 0.9) {
      copy.matched = reanchored;
      // 源会话的存储编号在目标时间线无效，清掉走 id/内容定位；range 首尾换成重锚后的 id
      const r = Object.assign({}, copy.range || {});
      delete r.start_index;
      delete r.end_index;
      for (let i = 0; i < reanchored.length; i++) {
        if (reanchored[i] && !isSpecialEvent(reanchored[i]) && reanchored[i].id) { r.start_id = reanchored[i].id; break; }
      }
      for (let i = reanchored.length - 1; i >= 0; i--) {
        if (reanchored[i] && !isSpecialEvent(reanchored[i]) && reanchored[i].id) { r.end_id = reanchored[i].id; break; }
      }
      copy.range = r;
    }
    out.push(copy);
    migrated++;
  });
  saveItems(out);
  console.log("[context-replacements] 会话合并复制状态块: " + sourceIds.length + " 源会话 -> " + targetId +
    " 复制=" + migrated + " 去重=" + skippedDup + " 无匹配=" + skippedNoMatch + " 手动块跳过=" + skippedManual);
  return { migrated: migrated, skippedDup: skippedDup, skippedNoMatch: skippedNoMatch, skippedManual: skippedManual };
}

// 会话分支时继承压缩块：把源会话中「完全落在分支点之前」的块复制到新会话。
// 判定：块 matched 最后一条非特殊事件消息在源会话「真实消息」序列里的位置 ≤ 分支点位置。
// 索引空间与前端 msgs 一致（/v1/history 的 isRealMessageForTimeline 口径：排除 system/tool/特殊事件），
// 分支点用前端传入的 msgs 下标 branchIndex 直接定位，块用内容锚点定位。
// 跨边界块不继承（摘要不完整）。源会话块保留（复制语义），新块打新会话标签，只在新会话内套用。
function inheritSessionBlocks(srcSession, newSession, branchIndex, anchorId, branchIdxHint) {
  // 1008 分支会话继承改造（仅状态块）：
  // 手动块已失效不再继承；只认状态块（ctxrep_state_<src>）。
  // 分支点定位用「时间线数组下标」坐标（与状态块 range 同坐标系）：
  //   bIdx > 区间终点 end_index → 分支点在状态块之后 → 继承摘要（复制块到分支，锚点/range 原样保留）
  //   否则（无状态块 / 分支点在区间内或之前）→ 不继承，分支时间线 1..b 原文全量已含区间内容。
  if (!srcSession || !newSession || !Number.isInteger(branchIndex) || branchIndex < 0) {
    return { inherited: 0, skippedNoMatch: 0, skippedCross: 0 };
  }
  const items = loadItems();
  const out = items.slice();
  const timeline = loadTimeline(srcSession);
  // 分支点 = 时间线数组下标：branchIdxHint（服务端已定位）优先；否则 anchorId 反查；
  // 都失败回退 branchIndex（前端 msgs 可见序列下标 → 时间线数组下标映射）。
  let bIdx = (Number.isInteger(branchIdxHint) && branchIdxHint >= 0) ? branchIdxHint : -1;
  if (bIdx < 0 && anchorId && Array.isArray(timeline)) {
    for (let i = 0; i < timeline.length; i++) { if (timeline[i] && timeline[i].id === anchorId) { bIdx = i; break; } }
  }
  if (bIdx < 0) {
    const visible = [];
    (Array.isArray(timeline) ? timeline : []).forEach(function (m, i) {
      if (!m || m.role === "system") return;
      if (m.tool_calls) return;
      if (isSpecialEvent(m)) return;
      const text = contentToText(m);
      if (m.role === "user" && String(text).trim().startsWith("<system>")) return;
      if (m.role !== "user" && m.role !== "assistant") return;
      visible.push(i);
    });
    if (branchIndex < 0 || branchIndex >= visible.length) {
      return { inherited: 0, skippedNoMatch: 0, skippedCross: 0, error: "分支点下标超出源会话消息数" };
    }
    bIdx = visible[branchIndex];
  }
  if (bIdx < 0) {
    return { inherited: 0, skippedNoMatch: 0, skippedCross: 0, error: "分支点定位失败" };
  }
  let inherited = 0, skippedNoMatch = 0, skippedCross = 0;
  items.forEach(function (it) {
    if (!it || it.removed || it.enabled === false) return;
    if (it.session !== srcSession) return;
    if (!String(it.id || "").startsWith("ctxrep_state_")) { skippedNoMatch++; return; }
    // 区间终点：优先 range.end_index（时间线数组下标）；缺失时用 matched 末条 id 反查数组下标
    let eIdx = -1;
    if (it.range && Number.isFinite(it.range.end_index)) {
      eIdx = Number(it.range.end_index);
    } else {
      const matched = (Array.isArray(it.matched) && it.matched.length > 0) ? it.matched : [];
      for (let i = matched.length - 1; i >= 0; i--) {
        const mi = matched[i];
        if (mi && mi.id != null && mi.id !== "" && Array.isArray(timeline)) {
          const pi = timeline.findIndex(function (m) { return m && m.id === mi.id; });
          if (pi >= 0) { eIdx = pi; break; }
        }
      }
      if (eIdx < 0) { skippedNoMatch++; return; }
    }
    if (bIdx > eIdx) {
      const copy = Object.assign({}, it, {
        session: newSession,
        id: "ctxrep_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
        created_at: nowIso(),
        updated_at: nowIso()
      });
      delete copy.removed;
      out.push(copy);
      inherited++;
    } else {
      skippedCross++;
    }
  });
  if (inherited > 0) saveItems(out);
  console.log("[context-replacements] 会话分支继承状态块: " + srcSession + " -> " + newSession +
    " 继承=" + inherited + " 无匹配=" + skippedNoMatch + " 区间内不继承=" + skippedCross + " 分支点=" + bIdx);
  return { inherited: inherited, skippedNoMatch: skippedNoMatch, skippedCross: skippedCross };
}

// ========================
// 手工记录管理（后台）
// ========================

function rangeLabelOf(slice) {
  let minT = null;
  let maxT = null;
  slice.forEach(function (e) {
    const t = messageTime(e.msg);
    if (!t) return;
    const v = t.getTime();
    if (minT === null || v < minT) minT = v;
    if (maxT === null || v > maxT) maxT = v;
  });
  return (minT !== null ? fmtWall(new Date(minT)) : "?") + " ~ " + (maxT !== null ? fmtWall(new Date(maxT)) : "?");
}

function manualStart(it, compItems) {
  const r = recordCompRange(it, compItems);
  return r ? r.start : Number.MAX_SAFE_INTEGER;
}

function manualRecordsSorted() {
  // 多会话：手工块序号空间（blockIndex）按会话隔离，与 applyReplacements 套用口径一致
  //（无 session 字段的旧块视为通用，各会话均可见可操作）。不过滤时其他会话的块会占据
  // 全局序号，导致 blocks 路由按 blockIndex 错位命中别的会话的块。
  const cur = activeSessionOr() || "default";
  const compItems = compressibleItems(); // 只算一次：排序比较里复用，避免每次比较重载时间线
  return loadItems()
    .filter(it => it.source === "manual" && !it.removed)
    .filter(it => !it.session || it.session === cur)
    .sort((a, b) => manualStart(a, compItems) - manualStart(b, compItems));
}

// 按记录 id 取当前会话可见的手工块：id 全局唯一，操作不再依赖易变的列表序号
// （预览到点击之间块增删/吞并会让序号错位）。与 manualRecordsSorted 同口径过滤，
// 跨会话的 id 传进来也命中不了，防止误删别会话的块。
function manualRecordById(id) {
  const key = String(id == null ? "" : id);
  if (!key) return null;
  const cur = activeSessionOr() || "default";
  const rec = loadItems().find(it => it && it.source === "manual" && !it.removed && it.id === key && (!it.session || it.session === cur));
  return rec ? { record: rec } : null;
}

// 按 compressible 序号区间构造 range 字段（range/range_label/matched/count）——2026-09-22 审查 R13：
// 此前 buildManualRecord 与 updateAiRecordRange 各写一份逐字相同的「slice → 首尾 id 锚点」构造
// （后者还缩进错位、错误文案不同），已开始漂移。收敛到此单一实现，三处共用。
function buildRangeFields(items, start, end) {
  if (start < 0 || end < start) return { ok: false, message: "无效的范围" };
  if (start >= items.length) return { ok: false, message: "起始编号超出当前消息总数" };
  const ee = Math.min(end, items.length - 1);
  const slice = items.slice(start, ee + 1);
  if (slice.length === 0) return { ok: false, message: "范围内没有可压缩消息" };
  // 锚点=消息 id（2026-09-19 统一）：存储 range 只存首尾消息 id，定位一律由 matched[].id 解析
  const startId = slice[0].msg && slice[0].msg.id ? String(slice[0].msg.id) : "";
  const endId = slice[slice.length - 1].msg && slice[slice.length - 1].msg.id ? String(slice[slice.length - 1].msg.id) : "";
  if (!startId || !endId) return { ok: false, message: "该区间消息缺少 id 字段，无法锚定（需要消息自带 id）" };
  return {
    ok: true,
    range: { start_id: startId, end_id: endId },
    range_label: rangeLabelOf(slice),
    matched: slice.map(function (e) {
      return {
        role: e.msg.role,
        content: typeof e.msg.content === "string" ? e.msg.content : contentToText(e.msg),
        id: e.msg && e.msg.id ? String(e.msg.id) : undefined
      };
    }),
    count: slice.length,
    startIndex: start,
    endIndex: ee,
    slice: slice
  };
}

function buildManualRecord(start, end, enabled) {
  const items = compressibleItems();
  const built = buildRangeFields(items, start, end);
  if (!built.ok) return built;
  return {
    ok: true,
    record: {
      id: "ctxrep_manual_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      created_at: nowIso(),
      source: "manual",
      session: activeSessionOr() || "default",   // 多会话：记录归属当前会话，只在该会话内套用
      text: "",
      memory: "",
      range: built.range,
      range_label: built.range_label,
      matched: built.matched,
      count: built.count,
      enabled: enabled === true,
      removed: false
    },
    startIndex: built.startIndex,
    endIndex: built.endIndex,
    slice: built.slice
  };
}


// 按时间间隔自动切分 [start,end]（1-based 转 0-based），生成多个手工块
// ---- 自动分块评分：时间间隔 + 话题切换 + 说话人切换 ----
const TOPIC_STOP_CHARS = new Set("的了我是你他它她这在在有也就说都还被把让跟和与或但而而且还再不没这那们个种些去来到上下前后时次天点会能要想觉得自己什么怎么这样那样现在然后因为所以但是如果感觉时候东西应该可以已经知道看到听到想到".split(""));

function contentTopicTokens(msg) {
  const raw = String(contentToText(msg) || "").replace(/<[^>]+>/g, "").toLowerCase();
  const out = new Set();
  const runs = raw.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    if (/^[a-z0-9]+$/.test(run)) {
      if (run.length >= 2) out.add(run);
      continue;
    }
    for (let i = 0; i < run.length; i++) {
      if (TOPIC_STOP_CHARS.has(run[i])) continue;
      out.add(run[i]);
      if (i + 1 < run.length && !TOPIC_STOP_CHARS.has(run[i + 1])) out.add(run[i] + run[i + 1]);
    }
  }
  return out;
}

function topicOverlap(a, b) {
  const A = contentTopicTokens(a);
  const B = contentTopicTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function boundarySplitScore(prev, next, gapMs) {
  let score = 0;
  const t0 = messageTime(prev.msg);
  const t1 = messageTime(next.msg);
  if (t0 && t1 && Math.abs(t1.getTime() - t0.getTime()) >= gapMs) score += 5;
  const sim = topicOverlap(prev.msg, next.msg);
  const nextIsUser = next.msg.role === "user";
  if (sim < 0.12) score += 4;
  else if (sim < 0.3) score += 2;
  if (nextIsUser && sim < 0.35) score += 2;
  return score;
}

function splitRangeByGaps(start, end, cfg) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return { ok: false, message: "无效的范围" };
  }
  const items = compressibleItems();
  if (start >= items.length) return { ok: false, message: "起始编号超出当前消息总数" };
  const ee = Math.min(end, items.length - 1);
  const isObj = cfg && typeof cfg === "object";
  const gapMinutes = (isObj ? Number(cfg.gapMinutes) : Number(cfg)) || 30;
  const chunkSize = isObj ? Number(cfg.chunkSize) : NaN;
  const chunkMin = isObj ? Number(cfg.chunkMin) : NaN;
  const chunkMax = isObj ? Number(cfg.chunkMax) : NaN;
  const target = Math.max(10, Math.floor(chunkSize || 100));
  const minSize = Math.max(5, Math.floor(chunkMin || Math.floor(target / 2)));
  const maxSize = Math.max(minSize + 5, Math.floor(chunkMax || target * 2));
  const tgt = Math.max(minSize, Math.min(maxSize, target));
  const gapMs = gapMinutes * 60 * 1000;
  const CUT_THRESHOLD = 4;
  const segments = [];
  let segStart = start;
  while (segStart <= ee) {
    const remaining = ee - segStart + 1;
    const lo = Math.min(minSize, remaining);
    const hi = Math.min(maxSize, remaining);
    const loIdx = segStart + lo - 1;
    const hiIdx = segStart + hi - 1;
    let best = -1, bestScore = -Infinity;
    for (let i = loIdx; i <= hiIdx; i++) {
      const tail = ee - i;
      if (i >= ee) {
        if (0 > bestScore) { bestScore = 0; best = ee; }
        break;
      }
      const next = items[i + 1];
      if (!next) continue;
      if (next.msg && (next.msg.role === "tool" || next.msg.tool_call_id)) continue;
      const bs = boundarySplitScore(items[i], items[i + 1], gapMs);
      let score = bs >= CUT_THRESHOLD ? bs : 0;
      score -= Math.abs((i - segStart + 1) - tgt) * 0.05;
      if (tail > 0 && tail < minSize) score -= 9999;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) best = Math.min(segStart + lo - 1, ee);
    if (best > ee) best = ee;
    segments.push({ start: segStart, end: best });
    segStart = best + 1;
  }
  const created = [];
  let removedCount = 0;
  let itemsList = loadItems();
  for (const seg of segments) {
    const built = buildManualRecord(seg.start, seg.end, false);
    if (!built.ok) continue;
    const filtered = [];
    for (const it of itemsList) {
      // 只吞并同会话（或无 session 的通用旧块）的重叠手工块，与 addManualRecord 同口径：
      // 跨会话块序号空间互相独立，重叠很正常，不加过滤会把其他会话的块整批误删
      if (it.source === "manual" && (!it.session || it.session === built.record.session)) {
        // 吞并判定用「当前真实覆盖区间」（id 解析）而非存储 range：与 addManualRecord 同口径
        const cur = recordCompRange(it, items);
        if (cur && cur.start <= seg.end && cur.end >= seg.start) {
          removedCount++;
          continue;
        }
      }
      filtered.push(it);
    }
    filtered.push(built.record);
    itemsList = filtered;
    created.push(built.record);
  }
  // 2026-10-03 状态机借用切点计算：dryRun=true 只算边界不落盘（不建块、不吞并旧块），
  // 否则状态机「自动分块」会真的建出一批旧块，反过来撞 upsertSpanRecord 的重叠断言。
  // 注意本函数的参数名是 cfg（不是 opts）——首版就写错过，curl 实测才炸出来。
  if (!(cfg && cfg.dryRun === true)) saveItems(itemsList);
  return {
    ok: true,
    count: created.length,
    records: created.map(publicItem),
    removedCount: removedCount,
    segments: segments,                       // 0-based 闭区间，供前端直接填区间输入框
    dryRun: !!(cfg && cfg.dryRun === true),
  };
}

// ========================
// 历史版本（记录内 history 数组；编辑/覆盖前把旧版归档）
// ========================
const MAX_HISTORY_VERSIONS = 8;

function historyEntryOf(it) {
  return {
    summary: recordText(it),
    generatedAt: it.updated_at || it.created_at || nowIso(),
    mode: it.source === "manual" ? "edited" : "ai",
    manual: it.source === "manual"
  };
}

// 更新 newText 之前，把当前正文归档为新的历史版本
function archiveHistory(item, newText) {
  if (!item || newText === undefined) return;
  const cur = recordText(item);
  if (!cur) return; // 首次填写，无旧版可归档
  const hist = Array.isArray(item.history) ? item.history.slice() : [];
  hist.unshift(historyEntryOf(item));
  if (hist.length > MAX_HISTORY_VERSIONS) hist.length = MAX_HISTORY_VERSIONS;
  item.history = hist;
}

function setManualRecordTextById(id, text, markPending) {
  const found = manualRecordById(id);
  if (!found) return { ok: false, message: "块不存在" };
  const t = String(text || "").trim();
  if (!t) return { ok: false, message: "替换正文不能为空" };
  if (t.length > MAX_MEMORY_CHARS) {
    return { ok: false, message: "替换正文太长（" + t.length + " 字，上限 " + MAX_MEMORY_CHARS + "）" };
  }
  const items = loadItems();
  const it = items.find(x => x.id === found.record.id);
  if (!it) return { ok: false, message: "块不存在" };
  archiveHistory(it, t);
  it.text = t;
  it.memory = t;
  it.updated_at = nowIso();
  if (markPending === true) it.enabled = false; // 手写保存：新摘要待确认，需手动替换
  saveItems(items);
  return { ok: true, length: t.length, record: publicItem(it) };
}

// ========================
// 撤销 / 开关 / 编辑（对任意记录，按 id）
// ========================
function removeReplacement(id) {
  const items = loadItems();
  const idx = items.findIndex(it => it.id === id);
  if (idx < 0) return { ok: false, error: "未找到该记录" };
  const removed = items.splice(idx, 1)[0];
  saveItems(items);
  console.log("[context-replacements] 已撤销替换：", removed.id, removed.range_label || "");
  return { ok: true, removed: publicItem(removed) };
}

function updateReplacement(id, text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, error: "替换正文不能为空" };
  if (t.length > MAX_MEMORY_CHARS) {
    return { ok: false, error: "替换正文太长（" + t.length + " 字，上限 " + MAX_MEMORY_CHARS + "）" };
  }
  const items = loadItems();
  const idx = items.findIndex(it => it.id === id);
  if (idx < 0) return { ok: false, error: "未找到该记录" };
  archiveHistory(items[idx], t);
  items[idx].text = t;
  items[idx].memory = t;
  items[idx].updated_at = nowIso();
  saveItems(items);
  console.log("[context-replacements] 已更新替换正文：", id, items[idx].range_label || "", "->", t.slice(0, 40).replace(/\n/g, " "), "...");
  return { ok: true, item: publicItem(items[idx]) };
}

// ========================
// 状态区间记录 upsertSpanRecord（2026-10-03 新增，供 lib/conversation-state.js 用）
//
// 与 addReplacement / addManualRecord 的区别，以及为什么能这么做：
//   1) matched 只存首尾两条锚点消息。注入侧取 aStart/aEnd 之后就只用它们的 id 定位
//      （见下方 applyReplacements 的锚点段落），中间的正文一次都用不到。
//      所以状态记录的大小与它覆盖多长无关——覆盖 1894 条和覆盖 20 条，存盘一样大。
//      旧记录的 matched 存全量原文，是 scripts/regenerate-blocks.js 批量重算要用的；
//      状态记录不需要它（要原文按 id 区间从时间线现取）。
//   2) 写入前做区间重叠断言。applyReplacements 是按时间线位置单调推进定位的，
//      两条同会话记录的区间一旦相交，定位会错位并吞掉相邻区间——这是硬伤不是偏好，
//      所以宁可拒绝写入（阶段二迁移旧块时靠它挡住「状态前缀撞上还没退役的旧块」）。
//
// 本函数是纯新增，不改动任何既有函数的行为。
// ========================
function upsertSpanRecord(options) {
  const opts = options || {};
  const recId = String(opts.recordId || "").trim();
  const session = String(opts.session || "").trim();
  const text = String(opts.text || "").trim();
  const startMsg = opts.startMsg;
  const endMsg = opts.endMsg;
  if (!recId || !session) return { ok: false, error: "缺少 recordId 或 session" };
  if (!text) return { ok: false, error: "状态正文不能为空" };
  if (text.length > MAX_MEMORY_CHARS) return { ok: false, error: "状态正文太长（" + text.length + " 字，上限 " + MAX_MEMORY_CHARS + "）" };
  if (!startMsg || !startMsg.id || !endMsg || !endMsg.id) return { ok: false, error: "缺少首尾锚点消息 id" };

  const tl = Array.isArray(loadTimeline()) ? loadTimeline() : [];
  const idPos = new Map();
  for (let i = 0; i < tl.length; i++) {
    const id = tl[i] && tl[i].id ? String(tl[i].id) : null;
    if (id && !idPos.has(id)) idPos.set(id, i);
  }
  const s = idPos.get(String(startMsg.id));
  const e = idPos.get(String(endMsg.id));
  if (s === undefined) return { ok: false, error: "区间起点消息不在当前会话时间线里" };
  if (e === undefined) return { ok: false, error: "区间终点消息不在当前会话时间线里" };
  if (e < s) return { ok: false, error: "区间首尾顺序颠倒" };

  // 重叠检测：同会话、未停用、未隐藏、不是本记录，且区间与 [s,e] 有交集 → 拒绝
  const items = loadItems();
  const conflicts = [];
  items.forEach(function (it) {
    if (!it || it.removed || it.id === recId) return;
    if (it.session && it.session !== session) return;
    if (it.enabled === false || it.hidden === true) return;
    const m = Array.isArray(it.matched) && it.matched.length ? it.matched : null;
    if (!m) return;
    let a = null, b = null;
    for (let i = 0; i < m.length; i++) { if (!isSpecialEvent(m[i])) { a = m[i]; break; } }
    for (let i = m.length - 1; i >= 0; i--) { if (!isSpecialEvent(m[i])) { b = m[i]; break; } }
    if (!a || !b || !a.id || !b.id) return;
    const os = idPos.get(String(a.id));
    const oe = idPos.get(String(b.id));
    if (os === undefined || oe === undefined) return;   // 定位不到就当不相交（与注入侧兜底一致）
    if (os > e || oe < s) return;                       // 不相交
    conflicts.push(it.id);
  });
  if (conflicts.length) {
    return { ok: false, error: "区间与已有记录重叠，先把那些记录停用：" + conflicts.slice(0, 3).join("、") };
  }

  const now = nowIso();
  let rec = items.find(function (x) { return x && x.id === recId; });
  if (!rec) {
    rec = {
      id: recId,
      created_at: now,
      source: opts.source || "state",
      session: session,
      matched: [startMsg, endMsg],
      range: { start_index: s, end_index: e },
      range_label: String(opts.rangeLabel || "").trim(),
      count: opts.count != null ? Number(opts.count) : (e - s + 1),
      enabled: true,
      removed: false,
    };
    items.push(rec);
  } else {
    if (Array.isArray(rec.matched) && rec.matched.length) archiveHistory(rec, text);
    rec.matched = [startMsg, endMsg];
    rec.range = { start_index: s, end_index: e };
    if (String(opts.rangeLabel || "").trim()) rec.range_label = String(opts.rangeLabel).trim();
    if (opts.count != null) rec.count = Number(opts.count);
    rec.session = session;
    rec.enabled = true;
    rec.hidden = false;   // 状态记录不参与「隐藏」这套（那是老块堆太多时的权宜手段）
  }
  rec.text = text;
  rec.memory = text;
  rec.updated_at = now;
  saveItems(items);
  console.log("[context-replacements] 状态区间记录已写入：" + recId + "（第 " + s + "~" + e + " 条，" + text.length + " 字）");
  return { ok: true, item: publicItem(rec) };
}

// ========================
// 旧块自动退役（2026-10-04 新增，供 lib/conversation-state.js 用）
//
// 为什么需要：状态机的连续性/重叠两道断言与「存量旧块不迁移」直接冲突。
// 以 ke h3 为例：12 个启用旧块覆盖第 1798~5567 条，状态机从第 1 条并入吃到
// 第 1798 条就撞墙被拒 —— 不退役旧块，状态机在存量会话里基本并不动。
// 退役 = enabled=false（数据一行不删、随时可恢复），因此存量会在日常使用中
// 被一段段自然消化，不需要专门的迁移批次。
//
// 三条硬约束：
//   1. 只退役 source !== "state" 的旧块。另一条状态记录与本次区间相交属于
//      逻辑错误（一个会话只该有一条状态），那种情况必须拒绝而不是替它退役。
//   2. 返回原 enabled 值供回滚。commitMerge 后续任一步失败会用 restoreRetiredBlocks 复原。
//   3. 写后立即读回核对（_itemsCache 缓存键是 mtimeMs+size，同一毫秒内的连续写
//      可能命中过期缓存；不核对就会拿着「改了没落盘」的数组继续走）。
//      这是 1003-27 那类「内存态与盘上不一致」的同款问题的预防。
//
// 全程同步：与本文件所有写路径一致（见文件头并发约束），同步段在事件循环内原子。
// ========================

// 找出与 [s,e] 区间相交的活跃旧块（不含本记录、不含状态记录）。
// 只读，不改任何东西。位置用 matched 首尾锚点的 id 现查时间线，不信 range 快照
// （range 是写入时刻的下标，时间线增删后会漂）。
function findOverlappingLegacyBlocks(options) {
  const opts = options || {};
  const session = String(opts.session || "").trim();
  const excludeId = String(opts.excludeId || "").trim();
  const s = Number(opts.startIndex);
  const e = Number(opts.endIndex);
  if (!Number.isInteger(s) || !Number.isInteger(e) || e < s) {
    return { ok: false, error: "区间下标不合法" };
  }

  const tl = Array.isArray(loadTimeline()) ? loadTimeline() : [];
  const idPos = new Map();
  for (let i = 0; i < tl.length; i++) {
    const id = tl[i] && tl[i].id ? String(tl[i].id) : null;
    if (id && !idPos.has(id)) idPos.set(id, i);
  }

  const hits = [];
  const stateConflicts = [];
  loadItems().forEach(function (it) {
    if (!it || it.removed || it.id === excludeId) return;
    if (it.session && it.session !== session) return;
    if (it.enabled === false || it.hidden === true) return;
    const m = Array.isArray(it.matched) && it.matched.length ? it.matched : null;
    if (!m) return;
    let a = null, b = null;
    for (let i = 0; i < m.length; i++) { if (!isSpecialEvent(m[i])) { a = m[i]; break; } }
    for (let i = m.length - 1; i >= 0; i--) { if (!isSpecialEvent(m[i])) { b = m[i]; break; } }
    if (!a || !b || !a.id || !b.id) return;
    const os = idPos.get(String(a.id));
    const oe = idPos.get(String(b.id));
    if (os === undefined || oe === undefined) return;   // 定位不到当不相交（与注入侧兜底一致）
    if (os > e || oe < s) return;                       // 不相交
    if (it.source === "state") { stateConflicts.push(it.id); return; }
    hits.push({ id: it.id, source: it.source || "ai", prevEnabled: it.enabled !== false, range_label: it.range_label || "" });
  });

  return { ok: true, legacy: hits, stateConflicts: stateConflicts };
}

// 退役与 [startId,endId] 相交的旧块。返回 {ok, retired:[{id, prevEnabled, ...}], stateConflicts}。
// 无冲突时不写盘（避免无谓的 18MB 重写 + 备份）。
function retireOverlappingLegacyBlocks(options) {
  const opts = options || {};
  const session = String(opts.session || "").trim();
  const startId = String(opts.startId || "");
  const endId = String(opts.endId || "");
  if (!session || !startId || !endId) return { ok: false, error: "缺少 session / startId / endId" };

  const tl = Array.isArray(loadTimeline()) ? loadTimeline() : [];
  const idPos = new Map();
  for (let i = 0; i < tl.length; i++) {
    const id = tl[i] && tl[i].id ? String(tl[i].id) : null;
    if (id && !idPos.has(id)) idPos.set(id, i);
  }
  const s = idPos.get(startId);
  const e = idPos.get(endId);
  if (s === undefined) return { ok: false, error: "区间起点消息不在当前会话时间线里" };
  if (e === undefined) return { ok: false, error: "区间终点消息不在当前会话时间线里" };
  if (e < s) return { ok: false, error: "区间首尾顺序颠倒" };

  const found = findOverlappingLegacyBlocks({ session: session, startIndex: s, endIndex: e, excludeId: opts.excludeId || "" });
  if (!found.ok) return found;
  // 状态记录相交是逻辑错误（一个会话只该有一条状态链），不替它退役，直接拒。
  if (found.stateConflicts.length) {
    return {
      ok: false,
      error: "区间与本会话已有的状态记录重叠（" + found.stateConflicts.slice(0, 3).join("、") +
        "）。这说明状态链被分叉了，请先在管理台核对并入记录。",
    };
  }
  if (!found.legacy.length) return { ok: true, retired: [], stateConflicts: [] };

  const ids = new Set(found.legacy.map(function (x) { return x.id; }));
  const items = loadItems();
  items.forEach(function (it) {
    if (it && ids.has(it.id)) it.enabled = false;   // 只翻开关，正文/区间/matched 一律不动
  });
  saveItems(items);

  // 写后读回核对：确认盘上这批块真的已经是停用状态。
  const after = new Set(loadItems().filter(function (it) {
    return it && ids.has(it.id) && it.enabled === false;
  }).map(function (it) { return it.id; }));
  const missing = found.legacy.filter(function (x) { return !after.has(x.id); }).map(function (x) { return x.id; });
  if (missing.length) {
    console.error("[context-replacements] 退役写后核对失败（盘上未生效）：" + missing.join("、"));
    return { ok: false, error: "退役写盘后核对不一致（" + missing.slice(0, 3).join("、") + "），已中止", retired: [] };
  }

  console.log("[context-replacements] 已自动退役 " + found.legacy.length + " 个旧块：" +
    found.legacy.map(function (x) { return x.id; }).join("、"));
  return { ok: true, retired: found.legacy, stateConflicts: [] };
}

// 复原被退役的旧块（commitMerge 中途失败时调用）。只按清单复原，不做区间重算。
function restoreRetiredBlocks(retired) {
  const list = Array.isArray(retired) ? retired : [];
  if (!list.length) return { ok: true, restored: 0 };
  const ids = new Set(list.map(function (x) { return String(x.id); }));
  const items = loadItems();
  let n = 0;
  items.forEach(function (it) {
    if (!it || !ids.has(String(it.id))) return;
    it.enabled = true;
    n++;
  });
  saveItems(items);
  const back = loadItems().filter(function (it) { return it && ids.has(String(it.id)); }).length;
  if (back !== list.length) {
    console.error("[context-replacements] 退役复原核对不一致：期望 " + list.length + " 条，实际 " + back + " 条");
    return { ok: false, error: "退役复原核对不一致", restored: n };
  }
  console.log("[context-replacements] 已复原 " + n + " 个旧块（并入失败回滚）");
  return { ok: true, restored: n };
}

// ========================
// 应用到发送给 AI 的上下文（统一生效逻辑）
// ========================
// 1007-17 冻结块 gitid 的内容指纹：内容一变指纹就变，供快照/前缀缓存识别「这块内容动过」。
// 只取 8 位十六进制，够用且不会把上下文撑大；这些字段在出口被 sanitizeForUpstream 白名单剥掉，
// 不会发给上游，只存在于内部消息对象里。
function contentRevHash(s) {
  try {
    return crypto.createHash("sha256").update(String(s == null ? "" : s)).digest("hex").slice(0, 8);
  } catch (e) { return ""; }
}

function buildMemoryMessage(item) {
  // 占位头 0919 起改英文块头（Context Assembly 0918 定稿命名），时间段紧跟一个空格；旧「（对话摘要」头仅存在于历史会话
  // 2026-09-28 用户拍板：压缩替换块在上下文中显示为 developer 段（与其他 V2 注入块同层）；
  // 出口经 role-mapper default 映射为 system 发给上游。
  // 2026-10-03 状态机：source=state 的记录是「当前状态」而不是「历史摘要」，
  // 头写错会让模型按「回顾过去」的方式去读它，所以单开一个头。非 state 记录行为不变。
  const isState = item && item.source === "state";
  const header = isState ? "## Conversation State" : "## Historical Summary";
  const label = item.range_label ? " " + item.range_label : "";
  /* 11-03：状态机块标题下加一句说明（只给 Conversation State，Historical Summary 不动） */
  const stateDesc = isState
    ? "\nRunning state of this conversation, summarized by a model. Updated periodically, not in real time; some details may be missing."
    : "\nEarlier part of this conversation, compressed into a summary by a model; some details may be missing.";
  const body = header + label + stateDesc + "\n" + recordText(item);
  // 1007-17：_ctxRep 块运行时生成、不落盘，本身没有 id。这里补 repId = 记录 id + 内容指纹：
  // state 记录是 upsert 同一条（id 固定、内容会被状态机改写），只挂 item.id 检测不到内容变化，
  // 所以必须带指纹——内容一变 repId 就变，符合「改动即换 id」的 git 版本语义。
  const rid = (item && item.id) ? String(item.id) : "ctxrep";
  return { role: "developer", _ctxRep: true, repId: rid + ":" + contentRevHash(body), content: body };
}

// ---------------- 重要内容标记（星星） ----------------
// 与 context-compactor 共用 data/context_compaction_marks.json，key 用 contentKey
const MARKS_FILE = path.join(DATA_DIR, "context_compaction_marks.json");
// 走 readJson 的 mtime 缓存：该函数在压缩页预览/容量提醒的消息级循环里被高频调用，
// 之前的裸 readFileSync 在 matched 数百条时放大成数百次全量读盘
function loadMarks() {
  try {
    const data = readJson(MARKS_FILE, null);
    if (data && data.marks && typeof data.marks === "object") return data.marks;
  } catch (err) { /* 无标记 */ }
  return {};
}
function contentKey(msg) {
  const text = contentToText(msg);
  return crypto.createHash("sha256").update((msg && msg.role ? msg.role : "") + "\u0000" + text).digest("hex").slice(0, 32);
}

// 块内容共享签名：对齐 makeChunk 口径，只统计普通对话（role+content），特殊事件不计入，
// 用于判定「不同会话里内容序列完全一致」的块，从而跨会话复用摘要正文。
function matchedShareSig(matched) {
  const hash = crypto.createHash("sha256");
  (Array.isArray(matched) ? matched : []).forEach(function (m) {
    if (!m) return;
    try { if (isSpecialEvent(m)) return; } catch (e) { /* 单条失败不阻断 */ }
    hash.update(String(m.role || "") + "\u0000" + contentToText(m));
    hash.update("\u0001");
  });
  return hash.digest("hex").slice(0, 32);
}

const { cleanDialogText, sortMarks } = require("../lib/dialog-clean");
function saveMarks(marks) {
  try {
    marks = sortMarks(marks);   // 1018：存入即按真实时刻排好序
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // 2026-09-13 审查修复：tmp 名加进程/随机后缀（批注时 gateway 与 wake-up 双进程都会写 marks，
    // 固定共享 tmp 名会同写交错；2026-09-15 起 wake-up 退役为单进程，后缀机制保留作防御）
    const tmp = MARKS_FILE + ".tmp." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, marks: marks }, null, 2), "utf-8");
    fs.renameSync(tmp, MARKS_FILE);
  } catch (err) {
    console.error("[context-replacements] 标记保存失败:", err.message);
  }
}

function findContentByKey(key) {
  const k = String(key || "");
  if (!k) return null;
  try {
    const timeline = loadTimeline();
    // 1007-17 标星改 msgid：key 可能是消息 id（新标星）也可能是原内容键（存量/AI 自标星），
    // 两种都要能反查到原文，否则只传 key 没传 content 的调用会标星失败。
    for (const m of timeline) {
      if (!m || m.role === "system") continue;
      if (m.deleted === true) continue;
      if (m.id && String(m.id) === k) {
        const c0 = contentToText(m);
        if (c0) return { content: c0, role: m.role || "", time: m.time || "" };
      }
    }
    for (const m of timeline) {
      if (!m || m.role === "system") continue;
      if (m.deleted === true) continue;
      try {
        if (contentKey(m) === k) {
          const c = contentToText(m);
          if (c) return { content: c, role: m.role || "", time: m.time || "" };
        }
      } catch (e) { /* 单条失败忽略 */ }
    }
  } catch (err) { /* 反查失败不阻断标星 */ }
  return null;
}

// 标星命中判定：先按消息 id 查，查不到再按内容键查（兼容 1007-17 之前的存量条目）。
// 返回 true 表示该消息当前处于"已标星"状态。
function isMarkedMsg(msg, marks) {
  if (!msg) return false;
  const m = marks || loadMarks();
  if (!m || typeof m !== "object") return false;
  const byId = msg.id ? m[String(msg.id)] : null;
  if (byId) return true;
  let k = "";
  try { k = contentKey(msg); } catch (e) { return false; }
  return k ? !!m[k] : false;
}

function setMark(key, marked, opt) {
  const marks = loadMarks();
  // 1007-17：key 可能是消息 id 或内容键（存量）。取消标星时两种都要清，
  // 否则同一条消息会残留旧内容键条目，导致"取消后压缩仍按原句保留"。
  const altKey = (opt && opt.alt_key) ? String(opt.alt_key) : "";
  if (marked) {
    const entry = { markedAt: new Date().toISOString() };
    if (opt && opt.content) entry.content = cleanDialogText(opt.content);   // 1018：入库即清洗
    if (opt && opt.role) entry.role = opt.role;
    // 原消息时间（跨窗口注入按"会话创建时间之前"过滤用）：优先显式传 msg_time，其次时间线反查补
    if (opt && opt.msg_time) entry.time = String(opt.msg_time || "").trim();
    if (!entry.content || !entry.time) {
      const orig = findContentByKey(key);
      if (orig) {
        if (!entry.content && orig.content) { entry.content = cleanDialogText(orig.content); entry.role = entry.role || orig.role; }
        if (!entry.time && orig.time) entry.time = orig.time;
      }
    }
    if (!entry.content) {
      console.warn("[context-replacements] 标星失败：无法回溯到原文 key=" + key);
      return { ok: false, error: "无法回溯到这条消息的原文，标星失败（请刷新后重试）" };
    }
    marks[key] = entry;
  } else {
    delete marks[key];
    if (altKey && altKey !== key) delete marks[altKey];
  }
  saveMarks(marks);
  return { ok: true, marked: !!marked };
}

function updateMark(key, opt) {
  const marks = loadMarks();
  if (!marks[key]) return { ok: false, error: "该标星消息不存在，可能已被取消" };
  const content = cleanDialogText((opt && opt.content) || "");
  if (!content) return { ok: false, error: "正文内容不能为空" };
  marks[key].content = content;
  saveMarks(marks);
  return { ok: true, content: content };
}

// setMarkPoolId/getMarkPoolId（标星→记忆池联动 poolId 通道）已于 2026-09-28 删除：
// 写入方从未被接通（全仓零调用，marks 里从不存在 poolId 字段）。

// 1018：applyReplacements（内容锚点替换兜底，约 420 行：30 条偏移先验 / 区间膨胀 / 10 把内部钥匙 / 事件按时间清除 /
// 相邻同角色合并）已退役。块统一由 locateBlock 按消息 id 定位（id 缺失按锚点时间降级），
// 经 buildIncrementalContext / 会话快照套用。退役前对全部会话做了新旧组装逐条对照，差异均为旧逻辑的误吞或重复。

// ========================
// 检索完整上下文文件（时间线）
// ========================
/* [位置:context/context-replacements.js·CONTENT_CAP_DEFAULT] [每条命中给调用方的正文上限] [11-09：原来超过 500 字一律截断（关键词模式从第一个命中词前 100 字截 500），后台蒸馏/门卫/状态机拿到的是残缺材料；改成单条 6000 字封顶（实测可见消息 99.78% 不到 6000 字，只挡 8 万字的极端值撑爆模型窗口），超过时以最优窗口（lib/keyword-window）为中心截。opts.contentCap 可覆盖——AI 的 time_prefix/latest 走 /internal/context-search，路由默认仍给 500，行为不变] [注释时间 2026-11-09] */
const CONTENT_CAP_DEFAULT = 6000;
// 2026-09-30 V9c：imported 死路径整体删除（原 recentlyShown 外部导入通道）——恒空数组、
// 消费端遍历永不执行、生产数据零存量（context_replacements.json 无 source=imported 条目）且零新增来源。

function loadSearchableMessages() {
  return { timeline: nonSystemMessages(loadTimeline()) };
}


// ── 跨会话加载 ──
function loadAllSessionTimelines() {
  const fs = require("fs");
  const path = require("path");
  const dir = TIMELINE_DIR;
  const files = fs.readdirSync(dir).filter(function(f) {
    return f.startsWith("enhanced_messages_") && f.endsWith(".json") && f !== "enhanced_messages___diag__.json";
  });
  const all = [];
  /* [位置:context/context-replacements.js·loadAllSessionTimelines 检索口径过滤] [已归档、子会话、「不参与检索」组的会话在这里就读不进来] [11-09：除了手机上她自己的搜索，其他任何读原文的地方都不能碰到这三类会话。原来过滤只写在 searchContextEnhanced 里的带 q 搜索一处，按日期定位、最近 N 条、向量预热都漏了；放到统一的读取入口，以后新增调用方自动对齐。归档名单每次现读（会话有新消息会自动解归档）] [注释时间 2026-11-09] */
  const excl = require("../lib/search-exclude");
  const archived = new Set(require("../lib/session-archive").readSessionArchive());
  for (const f of files) {
    const sid = f.slice("enhanced_messages_".length, -".json".length);
    if (excl.isExcluded(sid) || archived.has(sid)) continue;
    try {
      const data = readJson(path.join(dir, f), []);
      // 必须拷贝后再打标记：readJson 命中缓存时返回的是缓存里的原对象，直接改会污染进程级缓存，
      // 让 loadTimeline 等其他链路读到的消息莫名带上 _session/_sidx
      const nonSys = (Array.isArray(data) ? data : []).filter(function(m) {
        return m && m.role !== "system";
      }).map(function(m, i) {
        return Object.assign({}, m, { _session: sid, _sidx: i });
      });
      all.push.apply(all, nonSys);
    } catch(e) { /* skip */ }
  }
  return all;
}

/* [位置:context/context-replacements.js·searchContextEnhanced] [后台读聊天原文的入口：蒸馏、状态机检索回合、记忆回填、AI 的 context 工具（按日期/最近 N 条）都走它] [11-09 重写：原来这里有一整套自己的找原文办法（向量语义、字面语义、关键词、合并分组、LLM 精排），后台和 AI/手机各用一套，后台那套对生僻词、专有名词、多个词很不准；现在分两种用法——①带关键词（q）：一律调网关的 /internal/search（lib/gateway-search.js，AI 和手机用的同一套），这里只做返回格式适配；②不带关键词：按日期（timePrefix）或最近 N 条（latest）直接读时间线，本来就不是搜索，原样保留。归档、子会话、「不参与检索」组的会话统一在 loadAllSessionTimelines 里排除（①由网关那边排除）] [注释时间 2026-11-09] */
async function searchContextEnhanced(query, options) {
  const q = String(query || "").trim();
  const opts = options || {};
  const timePrefix = String(opts.timePrefix || "").trim().replace(/[Tt]/g, " ") || null;
  const latestCount = Math.max(0, Math.min(100, Math.floor(Number(opts.latest) || 0))); // 1003-13：填数字=返回最近 N 条原文
  if (!q && !timePrefix && !latestCount) return { ok: false, error: "查询不能为空" };
  const allSessions = !!opts.allSessions;
  const maxReturn = Math.max(1, Math.min(100, Math.floor(Number(opts.limit) || 10)));
  const contentCap = Math.max(100, Math.floor(Number(opts.contentCap) || CONTENT_CAP_DEFAULT));
  const kw = require("../lib/keyword-window");

  if (q) {
    if (!allSessions) return { ok: false, error: "带关键词的检索只支持跨全部会话（allSessions）" };
    let body;
    try {
      body = await require("../lib/gateway-search").search({ q: q, limit: maxReturn, timePrefix: timePrefix });
    } catch (e) {
      return { ok: false, error: "检索失败（网关 /internal/search）：" + ((e && e.message) || e) };
    }
    const rows = Array.isArray(body.results) ? body.results : [];
    const matches = rows.map(function (r) {
      const text = String(r.text || "");
      return {
        role: r.role || null,
        time: r.time > 0 ? new Date(r.time).toISOString() : null,
        score: r.score,
        content: text.length > contentCap ? kw.clipAround(text, q, contentCap) : text,
        source: "timeline",
        session: r.sid,
        msg_id: r.msg_id,
        start_index: r.sidx,
        end_index: r.sidx
      };
    });
    return { ok: true, total: body.total != null ? body.total : matches.length, matches: matches, mode: "hybrid", all_sessions: true };
  }

  let allMsgs = [];
  if (allSessions) {
    // 归档、子会话、「不参与检索」组的会话已在 loadAllSessionTimelines 里统一排除（11-09）
    allMsgs = loadAllSessionTimelines().map(function (m) {
      return { content: contentToText(m), role: m.role, time: m.time || null, session: m._session, sidx: m._sidx, msg_id: m.id };
    });
  } else {
    const src = loadSearchableMessages();
    for (let i = 0; i < src.timeline.length; i++) {
      allMsgs.push({ content: contentToText(src.timeline[i]), role: src.timeline[i].role, time: src.timeline[i].time || null, session: "current", sidx: i, msg_id: src.timeline[i].id });
    }
  }

  // 1002-08: timePrefix 时间缀定位（本地 UTC+8 前缀匹配）：按消息时间倒序返回命中消息；1003-13：latest=N 不过滤，直接取最近 N 条（最新在前）
  function localTimeStr(m) {
    const t = new Date(m.time);
    if (isNaN(t.getTime())) return "";
    return new Date(t.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }
  let pool;
  if (timePrefix) {
    pool = allMsgs.filter(function (m) {
      if (!m.content || !m.time) return false;
      const lt = localTimeStr(m);
      return !!lt && lt.startsWith(timePrefix);
    });
  } else {
    pool = allMsgs.filter(function (m) { return m && m.content; });
  }
  pool.sort(function (a, b) { return String(b.time || "").localeCompare(String(a.time || "")); });
  const picked = timePrefix ? pool : pool.slice(0, latestCount);
  const matches = picked.slice(0, maxReturn).map(function (m) {
    return {
      role: m.role, time: m.time, score: 100,
      content: m.content.length > contentCap ? kw.clipAround(m.content, "", contentCap) : m.content,
      source: "timeline", session: m.session, msg_id: m.msg_id, start_index: m.sidx, end_index: m.sidx
    };
  });
  return { ok: true, total: picked.length, matches: matches, all_sessions: allSessions };
}

// ========================
// 压缩页搜索：搜全部原文，返回命中消息的原文编号(第X条) + 所属块
// ========================
// compactionKeyOf / locateCompIdx 内容锚点已删（2026-09-19 统一消息 id 锚点，见 recordCompRange）

// 解析记录在压缩索引空间(compressibleItems)中的覆盖范围
function recordCompRange(it, items) {
  const compItems = items || compressibleItems();
  // 2026-09-19 统一 id 锚点定位：块的真实覆盖区间由 matched[].id（消息自带 UUID，全库唯一、
  // 随时间线增删不漂移）解析——首条有 id 的 matched 定起点，末条有 id 的定终点。
  // 旧的时间/编号存储定位与内容锚点已删；matched 全无 id 的极老块视为不可定位（不显示不注入）。
  const matched = (Array.isArray(it && it.matched) && it.matched.length > 0) ? it.matched : [];
  if (!matched.length) return null;
  const idPos = new Map();
  for (let i = 0; i < compItems.length; i++) {
    const id = compItems[i].msg && compItems[i].msg.id ? String(compItems[i].msg.id) : null;
    if (id && !idPos.has(id)) idPos.set(id, i);
  }
  let s = -1;
  for (const m of matched) {
    const id = m && m.id ? String(m.id) : null;
    if (id && idPos.has(id)) { s = idPos.get(id); break; }
  }
  let e = -1;
  for (let k = matched.length - 1; k >= 0; k--) {
    const id = matched[k] && matched[k].id ? String(matched[k].id) : null;
    if (id && idPos.has(id)) { e = idPos.get(id); break; }
  }
  if (s < 0 || e < 0 || e < s) return null;
  return windowFilteredRange(s, e, compItems);
}

// 窗口隔离：范围首条消息早于当前窗口起点 → 旧窗口块，视为不在当前时间线（不显示、不注入）
function windowFilteredRange(s, e, compItems) {
  const windowStartMs = currentWindowStartMs(loadTimeline());
  if (windowStartMs !== null) {
    const firstMsg = compItems[s] && compItems[s].msg;
    const t = firstMsg ? messageTime(firstMsg) : null;
    if (t && t.getTime() < windowStartMs) return null;
  }
  return { start: s, end: e };
}

// 已标星消息列表：遍历原文池，返回所有被标星（marks 命中）的消息，统一管理、便于取消
function listMarked() {
  // 与跨窗口注入保持一致：优先用标星时已存的原生原文（marks[key].content），
  // 保证即使原文已被替换/删除也能显示；读不到再回落 matched 存档。
  // 时间线经压缩后，历史消息已移入 matched 存档，当前时间线里找不到，
  // 若只用 compressibleItems（当前时间线），大量标星会因原文不在时间线而显示不出来。
  const marks = loadMarks();
  const results = [];
  const seenKeys = new Set();
  let displayIndex = 0;

  // 第一遍：优先用 marks[key].content（标星时刻存的原文）——不依赖 matched 是否还在
  Object.keys(marks || {}).forEach(function (key) {
    const entry = marks[key];
    if (!entry || typeof entry.content !== "string" || !entry.content) return;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    displayIndex++;
    const t = entry.time || entry.markedAt;
    results.push({
      index: displayIndex,
      role: entry.role || "assistant",
      time: t ? fmtWall(new Date(t)) : "",
      content: entry.content,
      key: key,
      markedAt: t || "",
      // 1016-03：来源（chat / heart-moment）+ 心动标题，供标星管理分类显示
      source: entry.source || "chat",
      title: entry.momentTitle || "",
      // 无对应块信息，标记为"已存原文"
      chunk: null
    });
  });

  // 第二遍：已存原文的已处理，剩下的从 matched 档里补（对应标星时没存原文的存量）
  const records = (loadItems() || []).filter(function (it) { return !it.removed; });
  records.forEach(function (it) {
    const matched = Array.isArray(it.matched) ? it.matched : [];
    if (!matched.length) return;
    const info = {
      chunkIndex: 0,
      chunkId: it.id,
      source: it.source || "ai",
      enabled: it.enabled !== false,
      summary: recordText(it).slice(0, 80)
    };
    matched.forEach(function (m) {
      if (!m || m.role === "system") return;
      const key = contentKey(m);
      if (!marks[key]) return;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      const content = typeof m.content === "string" ? m.content : contentToText(m);
      if (!content) return;
      displayIndex++;
      const t = messageTime(m);
      results.push({
        index: displayIndex,
        role: m.role || "",
        time: t ? fmtWall(t) : "",
        content: content,
        key: key,
        markedAt: (marks[key] && marks[key].markedAt) || "",
        chunk: info
      });
    });
  });

  // 按标记时间倒序：最新标记在最前面；无标记时间的存量条目排最后，保证稳定
  results.sort(function (a, b) {
    const ta = a.markedAt ? (Number(new Date(a.markedAt)) || -Infinity) : -Infinity;
    const tb = b.markedAt ? (Number(new Date(b.markedAt)) || -Infinity) : -Infinity;
    return tb - ta;
  });
  // 排序后重新分配连续编号（1-based），保证前端「第 X 条」序号连续
  results.forEach(function (r, i) { r.index = i + 1; });
  return { ok: true, total: results.length, results: results };
}

// ========================
// 计算渲染起点（2026-09-29 前端"纯显示器"）：最后一个参与处理块的结束位置。
// 与 buildIncrementalContext 的定位/窗口/隐藏口径完全一致（matched id 锚点、窗口内、
// 含隐藏块——隐藏块区间同样不显示原文，因此其 end 计入 lastEnd）。
// 返回 { tailIndex, lastEndId, blockFp }：tailIndex = 时间线索引 lastEnd+1（其后的
// 未覆盖消息即前端要显示的未压缩原文起点）；lastEndId = 最后一块 end 消息 id
// （供 /v1/history 在过滤后可见序列中定位起点）；无块/无定位 → tailIndex=0, lastEndId=null。
// ========================
// 1018：块区间定位（buildIncrementalContext / computeTailStart / locateEnabledRanges 唯一实现，原三份同款循环）。
// 首尾锚点 = matched 里首/末条非特殊事件消息：
//   ① 按消息 id 定位（身份唯一，不受内容编辑/位置漂移影响）；
//   ② id 在时间线里已不存在（消息被删 / 时间线受损重建）→ 按该锚点的时间定位：
//      起点 = 第一条 time ≥ 起点锚点时间的消息，终点 = 最后一条 time ≤ 终点锚点时间的消息。
//      旧内容锚点兜底（applyReplacements）已退役，这是唯一的降级通道，宁可按时间收窄也不让摘要整块消失。
// 窗口隔离：区间首条非特殊事件早于当前事件窗口起点 → 旧窗口块，不定位（原文透传）。
// 返回 { s, e, byTime } 或 null。
function locateBlock(it, tl, idPos, windowStartMs) {
  const matched = (Array.isArray(it.matched) && it.matched.length > 0) ? it.matched : null;
  if (!matched) return null;
  let aStart = null;
  let aEnd = null;
  for (const m of matched) { if (!isSpecialEvent(m)) { aStart = m; break; } }
  for (let i = matched.length - 1; i >= 0; i--) { if (!isSpecialEvent(matched[i])) { aEnd = matched[i]; break; } }
  if (!aStart || !aEnd) return null;
  let s = aStart.id ? idPos.get(String(aStart.id)) : undefined;
  let e = aEnd.id ? idPos.get(String(aEnd.id)) : undefined;
  let byTime = false;
  if (s === undefined || e === undefined) {
    const tS = messageTime(aStart), tE = messageTime(aEnd);
    if (s === undefined && tS) {
      for (let i = 0; i < tl.length; i++) {
        const m = tl[i];
        if (!m || m.role === "system" || m.deleted) continue;
        const t = messageTime(m);
        if (t && t.getTime() >= tS.getTime()) { s = i; break; }
      }
      byTime = true;
    }
    if (e === undefined && tE) {
      for (let i = tl.length - 1; i >= 0; i--) {
        const m = tl[i];
        if (!m || m.role === "system" || m.deleted) continue;
        const t = messageTime(m);
        if (t && t.getTime() <= tE.getTime()) { e = i; break; }
      }
      byTime = true;
    }
  }
  if (s === undefined || e === undefined || e < s) return null;
  if (windowStartMs !== null) {
    let anchorM = null;
    for (let i = s; i <= e; i++) { if (!isSpecialEvent(tl[i])) { anchorM = tl[i]; break; } }
    if (anchorM) {
      const t = messageTime(anchorM);
      if (t && t.getTime() < windowStartMs) return null;
    }
  }
  return { s: s, e: e, byTime: byTime };
}

function computeTailStart(sessionId, timeline) {
  const tl = Array.isArray(timeline) ? timeline : [];
  if (!tl.length) return { tailIndex: 0, lastEndId: null, blockFp: "" };
  let blockFp = "";
  try {
    const st = fs.statSync(REPLACEMENTS_FILE);
    blockFp = String(st.mtimeMs) + ":" + String(st.size);
  } catch (e) { blockFp = ""; }
  const curSession = activeSessionOr() || sessionId || "default";
  let items = loadItems().filter(function (it) {
    if (it.removed || it.enabled === false) return false;
    if (!recordText(it)) return false;
    if (it.session && it.session !== curSession) return false;
    return true;
  });
  if (!items.length) return { tailIndex: 0, lastEndId: null, blockFp: blockFp };
  const idPos = new Map();
  for (let i = 0; i < tl.length; i++) {
    const m = tl[i];
    if (!m || m.role === "system" || m.deleted) continue;
    const id = m.id ? String(m.id) : "";
    if (id && !idPos.has(id)) idPos.set(id, i);
  }
  const windowStartMs = currentWindowStartMs(tl);
  let lastEnd = -1;
  let lastEndId = null;
  for (const it of items) {
    const _loc = locateBlock(it, tl, idPos, windowStartMs);
    if (!_loc) continue;
    const s = _loc.s, e = _loc.e;
    if (e > lastEnd) { lastEnd = e; lastEndId = (tl[e] && tl[e].id) ? String(tl[e].id) : null; }
  }
  return { tailIndex: lastEnd + 1, lastEndId: lastEndId, blockFp: blockFp };
}

// 2026-10-08 方案A：向调用方暴露「当前会话可见压缩块的定位区间」。
// 与 buildIncrementalContext 的 located 完全同口径（matched 首尾 id → 当前时间线下标 + 窗口过滤），
// 供编辑/删除/重生成的「区间禁止 / 截断点之后是否有 rep 块」判定使用。
// 返回 [{ id, s, e, hidden }]；hidden=true 的块区间原文本来就不进上下文，调用方按需过滤。
function locateEnabledRanges(sessionId, timeline) {
  const tl = Array.isArray(timeline) ? timeline : [];
  const out = [];
  if (!tl.length) return out;
  const curSession = activeSessionOr() || sessionId || "default";
  let items = loadItems().filter(function (it) {
    if (it.removed || it.enabled === false) return false;
    if (!recordText(it)) return false;
    if (it.session && it.session !== curSession) return false;
    return true;
  });
  if (!items.length) return out;
  const idPos = new Map();
  for (let i = 0; i < tl.length; i++) {
    const m = tl[i];
    if (!m || m.role === "system" || m.deleted) continue;
    const id = m.id ? String(m.id) : "";
    if (id && !idPos.has(id)) idPos.set(id, i);
  }
  const windowStartMs = currentWindowStartMs(tl);
  for (const it of items) {
    const _loc = locateBlock(it, tl, idPos, windowStartMs);
    if (!_loc) continue;
    const s = _loc.s, e = _loc.e;
    out.push({ id: it.id, s: s, e: e, hidden: it.hidden === true });
  }
  return out;
}

// ========================
// 增量上下文构建（2026-09-29）：keh3 5000+ 条会话提速——每请求只 prepare 尾部未覆盖对话
// 只摘要化「id 可定位 + 窗口内 + 非隐藏 + 非截断」的块区间；其余（窗口外/定位失败）区间原文透传，
// 由后续 applyReplacements 兜底（窗口外/定位失败跳过、隐藏/截断剔除），结果与全量路径一致。
// 区间内保留语义与 applyReplacements 同款：记忆浮现/工具剔除、标星前置、不可压缩（真日记等）保留。
// 返回 { head, tailStart, blockFp }：head = 原始消息引用（调用方 prepare；_ctxRep 摘要直接透传）；
// tailStart = 最后一个参与处理块 end+1（其后的尾部未覆盖消息由调用方现算）。
// blockFp = context_replacements.json 指纹（整体缓存键用，块记录未变时 head 稳定）。
// ========================
function buildIncrementalContext(sessionId, timeline) {
  const tl = Array.isArray(timeline) ? timeline : [];
  // 2026-10-01 修复 P0：无可用块（会话从未压缩 / 块全被 session 或窗口过滤掉）时
  // tailStart 必须回到 0 —— 原值 tl.length 会被调用方当成合法增量结果（head 空 + 尾部起点在末尾），
  // head/tail 双空导致整段历史被吞掉，上下文只剩 system（实测 302 条会话转发仅 7 条）。
  // tailStart=0 时调用方判定不可用，降级全量路径，语义与「无块＝原文透传」一致。
  const out = { head: [], tailStart: 0, blockFp: "" };
  if (!tl.length) return out;
  try {
    const st = fs.statSync(REPLACEMENTS_FILE);
    out.blockFp = String(st.mtimeMs) + ":" + String(st.size);
  } catch (e) { out.blockFp = ""; }

  const curSession = activeSessionOr() || sessionId || "default";
  let items = loadItems().filter(function (it) {
    if (it.removed || it.enabled === false) return false;
    if (!recordText(it)) return false;
    if (it.session && it.session !== curSession) return false;
    return true;
  });
  if (!items.length) return out;

  // id → idx 映射（非 system、未删除）
  const idPos = new Map();
  for (let i = 0; i < tl.length; i++) {
    const m = tl[i];
    if (!m || m.role === "system" || m.deleted) continue;
    const id = m.id ? String(m.id) : "";
    if (id && !idPos.has(id)) idPos.set(id, i);
  }

  const windowStartMs = currentWindowStartMs(tl);

  // 定位区间：优先用 matched 首尾非特殊事件消息的 id（与 applyReplacements 完全同口径——
  // 块记录里 range 是创建时快照，matched 会随消息编辑/边界微调更新，两者可能不一致）；
  // matched 缺 id / 查不到 → 该块整体透传，applyReplacements 兜底。
  const located = [];
  for (const it of items) {
    const _loc = locateBlock(it, tl, idPos, windowStartMs);
    if (!_loc) continue;
    const s = _loc.s, e = _loc.e;
    located.push({ it: it, s: s, e: e });
  }
  if (!located.length) return out;
  located.sort(function (a, b) { return a.s - b.s; });

  // 隐藏块（区间原文从上下文剔除，与 applyReplacements 同口径）。
  // 2026-10-04：原先这里还有一段「活跃块上限」截断（maxActive），随旧压缩系统一并下线。
  const hiddenIds = new Set(items.filter(function (it) { return it.hidden === true; }).map(function (it) { return it.id; }));
  const activeLocs = located.filter(function (l) { return !hiddenIds.has(l.it.id); });
  const truncatedIds = new Set();

  const marks = loadMarks();
  let cur = 0;
  let lastEnd = -1;
  for (const loc of located) {
    // 前缀/间隙：未覆盖消息透传（调用方 prepare）
    for (let i = cur; i < loc.s; i++) {
      const m = tl[i];
      if (!m || m.role === "system" || m.deleted) continue;
      out.head.push(m);
    }
    if (!hiddenIds.has(loc.it.id) && !truncatedIds.has(loc.it.id)) {
      // 正常块：标星前置 + 区间保留（记忆浮现/工具剔除、标星跳过、不可压缩保留）+ 摘要
      // 1004-09：保留原文（真日记等）挪到摘要之前——固定内容在前、易变的状态摘要在后，头部稳定利于缓存
      const starred = [];
      for (let i = loc.s; i <= loc.e; i++) {
        const m = tl[i];
        if (!m || m.role === "system" || m.deleted) continue;
        if (m.role === "tool" || m.tool_calls) continue;
        if (isMarkedMsg(m, marks)) starred.push(m);
      }
      starred.forEach(function (sm) { out.head.push(sm); });
      for (let i = loc.s; i <= loc.e; i++) {
        const m = tl[i];
        if (!m || m.role === "system" || m.deleted) continue;
        if (isMemoryFlash(m)) continue;
        if (m.role === "tool" || m.tool_calls) continue;
        if (isReplacementMemoryMessage(m)) { out.head.push(m); continue; }
        if (isMarkedMsg(m, marks)) continue;
        if (!isCompressible(m, true)) out.head.push(m);
      }
      out.head.push(buildMemoryMessage(loc.it));
    }
    // 隐藏/截断块：区间原文剔除（不输出）
    cur = loc.e + 1;
    if (loc.e > lastEnd) lastEnd = loc.e;
  }
  out.tailStart = lastEnd + 1;
  // 1002-21：增量路径真实替换留痕。此前增量摘要完成后 applyReplacements 兜底对已摘要化消息
  // 定位不到原文锚点 → 记 replaced:0，替换记录被"0 块"噪声覆盖真实替换数。
  // 现在由本处按实际摘要化的块数写日志；applyReplacements 兜底处检测到增量已处理则静默。
  const appliedBlocks = located.filter(function (l) { return !hiddenIds.has(l.it.id) && !truncatedIds.has(l.it.id); });
  if (appliedBlocks.length > 0) {
    try {
      appendReplaceLog({
        time: nowIso(),
        source: "对话",
        session: curSession,
        before: tl.length,
        after: out.head.length + (tl.length - out.tailStart),
        replaced: appliedBlocks.length,
        applied: appliedBlocks.map(function (l) {
          return {
            id: l.it.id,
            title: l.it.title || "",
            startIdx: l.s,
            endIdx: l.e,
            contentLen: String(recordText(l.it) || "").length
          };
        })
      });
    } catch (e) {
      console.warn("[context-replacements] 增量替换日志记录失败:", e.message);
    }
  }
  return out;
}

module.exports = {
  migrateSessionBlocks,
  inheritSessionBlocks,
  removeReplacement,
  updateReplacement,
  // 2026-10-03 状态机写入通道（lib/conversation-state.js 用）
  upsertSpanRecord,
  // 2026-10-04 状态机撞块自动退役（存量旧块不迁移，退役=停用不删）
  retireOverlappingLegacyBlocks,
  restoreRetiredBlocks,
  searchContextEnhanced,
  // 2026-09-28 收窄：isReplacementMemoryMessage/resolveRange/loadAllSessionTimelines/findContentByKey/
  // isEventInjectionVisible/classifySpecialEvent（均内部调用）；listReplacements/setMarkPoolId/getMarkPoolId 整函数删除
  loadItems,
  recordText,
  buildIncrementalContext,
  computeTailStart,
  locateEnabledRanges,
  buildMemoryMessage,
  contentRevHash,
  // 手工记录管理
  splitRangeByGaps,
  setManualRecordTextById,
  manualRecordsSorted,
  compressibleItems,
  loadTimeline,
  setActiveSession,
  getActiveSession,
  noteMcpChatSession,
  listMarked,
  loadMarks,
  setMark,
  updateMark,
  isMarkedMsg,
  contentKey,
  // 特殊事件结构化识别与注入窗口过滤（供 context-compactor / server 复用同一口径）
  messageTime,
  currentWindowStartMs,
  isSpecialEvent,
};
