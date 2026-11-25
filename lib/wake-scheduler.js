'use strict';
// 唤醒调度器（2026-09-15 批3收尾：wake-up 独立进程退役，调度并入 gateway）。
// 调度内核（沉默判定/定时闹钟/重启补触发/互斥）从 wake_up.js 原样搬入；
// 与独立进程期的差异：
//   - 上下文/模型调用改进程内直调 routes/wake-chat.js 的 runWakeCompletion（不再 HTTP 自环）；
//   - 唤醒产出落库直调 server.js 注入的 applyWakeEventV2（wake-event v2 同一实现）；
//   - 心跳直接更新 gateway 的 wakeUpLastHeartbeat（管理台在线状态同源）；
//   - 配置读 gateway 的 readEnvValue（cachedEnv，管理台保存即刷新，无需独立热重载）。
// 鉴权：本模块只在进程内被 server.js 启动，不暴露任何 HTTP 面。

const fs = require("fs");
const path = require("path");
const { formatDateTimeInTimeZone, getDatePartsInTimeZone, getHourInTimeZone, parseWakeTarget, parseCurrentTimeTagLoose, parseLeadingWallTime, parseTrailingWallTime } = require("../utils/time_utils");
const tagParser = require("./tag-parser");
const wakeSchedule = require("./wake-schedule");
const { timelineDirOf } = require("./timeline-dir"); // 1018-12：时间线统一放 timeline_data/
const wakeAlarms = require("./wake-alarms"); // 2026-10-25：wake 工具的多闹钟（与旧 <wake> 单槽并存）
const wakeSubs = require("./wake-subs");   // 第 9 条：唤醒订阅
const { createWakeGate } = require("./wake-gate");   // 批D·27：唤醒放行闸门
const sleepCfg = require("./sleep-wake-config");   // 2026-11-09：睡眠唤醒全局设置（沉默多久/概率/闹钟作废窗口/追加文字）

// 到点判定的统一宽限窗：setTimeout 的毫秒延时会被向零截断，定时器可能比闹钟时刻早 <=1ms 触发，
// 若「捕获」与「过期清理」严格用 next_wake_at <= now 判定，提前触发会两手空空、随后槽位被当过期删掉，闹钟静默蒸发
const WAKE_DUE_GRACE_MS = 2000;

// 兜底版 content → 纯文本：多模态分片转 [图片]/[文件] 占位；
// 正常链路用 server.js 注入的 normalizeContentToText，仅在未注入时落到本实现
function normalizeContentToTextLocal(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
        if (type === "text" || type === "input_text") return part.text || part.content || "";
        if (part.image_url || type.includes("image")) return "[图片]";
        if (part.file || type.includes("file")) return "[文件]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "[非文本内容]";
}

/* [位置:lib/wake-scheduler.js·buildWakeReceipt] [唤醒回执只报失败] [11-11 拍板：回执没什么用，整条删掉——成功的事（没推送及其原因、推送成功、日记写入成功、唤醒设置成功）一律不再回执，
   AI 自己那条回复里本来就有，回执再抄一遍只是重复占上下文。只有没做成的事才说一句：推送失败、日记标签写错没存上、<wake> 标签没设上（时间已过 / 格式不对，此前只打日志 AI 不知道）。
   多项失败用「。」连接；全部成功返回空串 = 不落 developer 回执。推送管理改读 assistant 消息的 push 字段（utils/push.js·pushEchoMeta），
   首页活动卡的「没动作 · 原因」改读 kind=noaction 的 assistant 消息（lib/phone-activity.js·wakeReceipts，noActionReasonOf 也搬到那边）] [注释时间 2026-11-11] */
function buildWakeReceipt(fails) {
  const f = fails || {};
  const parts = [];
  if (f.pushFail) parts.push("发送失败：" + f.pushFail);
  if (f.diaryTagError) parts.push("日记写入失败：标签解析错误");
  if (f.wakeSetFail) parts.push("唤醒设置失败：" + f.wakeSetFail);
  return parts.join("。");
}

module.exports = function createWakeScheduler(deps) {
  const {
    baseDir,
    readEnvValue,
    normalizeContentToText,
    touchHeartbeat,
    sendPushNotification,
    applyWakeEventV2,
    runWakeCompletion,
    wakeDeps,
    activeGenMap,
    ACTIVE_GEN_TTL_MS
  } = deps;
  const toText = normalizeContentToText || normalizeContentToTextLocal;
  const TIME_ZONE = require("../utils/time_utils").resolveTimeZone();

  // 2026-09-30：error.log 无时间戳，唤醒链路错误/警告统一带本地时间前缀，便于排障对照
  function wakeNow() {
    try { return formatDateTimeInTimeZone(new Date(), TIME_ZONE); }
    catch (e) { return new Date().toISOString(); }
  }
  function logErr(msg) { console.error("[wake-scheduler " + wakeNow() + "] " + msg); }
  function logWarn(msg) { console.warn("[wake-scheduler " + wakeNow() + "] " + msg); }

  // ---- 唤醒失败计数（2026-09-30）：连续失败达上限后放弃槽位并推送告警 ----
  // 背景：0930 10:20 闹钟失败后 runTimedWake 无条件 prune 了"保留待重试"的槽位，闹钟静默蒸发。
  // 本机制保证：失败 → 槽位保留等下轮重试；连续 WAKE_FAIL_MAX 次失败 → 清闹钟槽 + 睡眠唤醒记本轮已处理 + Bark 告警，防无限静默。
  // 计数存内存（gateway 重启清零重新计数），成功一次即清零。
  const WAKE_FAIL_MAX = 3;
  const wakeFailMap = new Map();   // sid -> { count, reason }
  function addWakeFailure(sessionId, reason) {
    const sid = String(sessionId || "default").trim() || "default";
    const cur = wakeFailMap.get(sid) || { count: 0, reason: "" };
    cur.count += 1;
    cur.reason = String(reason || cur.reason || "未知原因").slice(0, 160);
    wakeFailMap.set(sid, cur);
    console.log("[wake-scheduler] 唤醒失败计数 " + cur.count + "/" + WAKE_FAIL_MAX + "（会话 " + sid + "）：" + cur.reason);
    if (cur.count >= WAKE_FAIL_MAX) {
      wakeFailMap.delete(sid);
      const sessName = getSessionDisplayName(sessionId);
      try { wakeSchedule.clearSlot(sid); } catch (e) { logWarn("放弃槽位清理失败: " + e.message); }
      /* [位置:lib/wake-scheduler.js·addWakeFailure 放弃睡眠唤醒] [熔断对睡眠唤醒真生效] [原先放弃只 clearSlot（清 <wake> 闹钟槽），而睡眠唤醒没有槽位——到点是动态判定（她最后发言+afterMin；readLastWakeAt≥发言才了结），失败不写 lastWakeAt 就被 10 分钟兜底轮询永远判到点：2026-11-12 主会话连续 400 从 07:41 叫到 12:38 共 60 次，熔断触发了 4 次但只是空枪。现放弃时补 writeLastWakeAt(now)≈「本轮已醒过」，getSleepStart 判「已了结」本轮彻底安静；她下次发言 lastUserTime 变新自动重新计时；上游持续故障时约 afterMin 后再给一轮 3 次机会（不是永久静默）。对显式闹钟无副作用：到点判定不看 lastWakeAt，槽位照旧清] [注释时间 2026-11-12] */
      try { writeLastWakeAt(sid, new Date()); } catch (e) { logWarn("记录本轮睡眠唤醒放弃失败: " + e.message); }
      logErr("唤醒连续失败 " + WAKE_FAIL_MAX + " 次，已放弃会话 " + (sessName || sid) + " 本轮唤醒（防无限重试；睡眠唤醒等下次对话重新计时）。最近原因：" + cur.reason);
      notifyWakeGiveUp(sessionId, cur.reason, sessName);
    }
  }
  function clearWakeFailure(sessionId) {
    wakeFailMap.delete(String(sessionId || "default").trim() || "default");
  }
  function notifyWakeGiveUp(sessionId, reason, sessName) {
    Promise.resolve().then(async function () {
      const body = "自动唤醒连续失败 " + WAKE_FAIL_MAX + " 次，本轮唤醒已放弃（" + (sessName || sessionId || "会话未知") + "），等下次对话重新计时。最近原因：" + reason;
      const r = await sendPushNotification({ title: "", body: body, sessionId: sessionId, channel: "bark" });
      if (!r || !r.ok) logErr("唤醒放弃告警推送失败: " + ((r && r.reason) || "未知"));
    }).catch(function (e) { logErr("唤醒放弃告警推送异常: " + e.message); });
  }

  // 日记共享模块（2026-09-16）：日常聊天与唤醒共用，[DIARY] 提取/日记写入同一口径
  const diaryLib = require("./diary")({ baseDir, readEnvValue });
  const WAKE_SCHEDULE_PATH = path.join(baseDir, "data", "wake_schedule.json");
  const WAKE_ALARMS_PATH = path.join(baseDir, "data", "wake-alarms.json");   // 2026-10-26 工具闹钟文件（读写收口在 lib/wake-alarms.js，此处仅做文件感知指纹）
  const SESSION_NAMES_PATH = path.join(baseDir, "data", "session-names.json");
  const TIMELINE_DIR = timelineDirOf(baseDir);
  const TIMELINE_PATH = path.join(TIMELINE_DIR, "enhanced_messages.json");
  let timedWakeTimer = null;
  let catchUpBusy = false;   // 过期闹钟「补触发」进行中（见 armTimedWake 过期分支）
  // [位置:lib/wake-scheduler.js·wakeGate] [唤醒放行闸门接线] [批D·27：原来一把全局锁「忙就跳过」会丢唤醒；改成每个会话一条车道排队放行（同会话一个接一个、间隔 300 秒、用户在聊或刚聊完 180 秒内让路（2026-11-10 由 30/20 秒加大）、最长等 10 分钟），不同会话互不等待；数字可在 .env 用 WAKE_GATE_INTERVAL_SEC / WAKE_GATE_QUIET_SEC / WAKE_GATE_MAXWAIT_MIN 调] [注释时间 2026-10-22]
  const wakeInflight = new Set();   // 正在处理（含排队等待）的会话，同一会话不并发处理两遍
  const wakeGate = createWakeGate({
    activeGenMap: activeGenMap,
    genTtlMs: ACTIVE_GEN_TTL_MS,
    log: function (m) { console.log(m); },
    getConfig: function () {
      return {
        intervalMs: readNumberEnv("WAKE_GATE_INTERVAL_SEC", 300, { min: 0 }) * 1000,
        quietMs: readNumberEnv("WAKE_GATE_QUIET_SEC", 180, { min: 0 }) * 1000,
        maxWaitMs: readNumberEnv("WAKE_GATE_MAXWAIT_MIN", 10, { min: 1 }) * 60 * 1000
      };
    }
  });

  // ---- 配置（gateway cachedEnv 口径，默认值与 wake_up.js 期一致）----
  function readNumberEnv(key, fallback, options = {}) {
    const value = Number(readEnvValue(key));
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    if (Number.isFinite(value) && value >= min && value <= max) return value;
    return fallback;
  }
  // 2026-11-09 睡眠唤醒改造（产品确定）：原来按白天/夜间两套沉默阈值循环叫，现在改成「睡眠唤醒」——
  // 她在会话里最后一条发言之后聊天停满 afterMin 分钟叫一次，不分昼夜；阈值与概率读 data/sleep-wake.json（手机「唤醒设置」页改）。
  // 旧 .env 的 DAY/NIGHT_WAKE_AFTER_MINUTES、DAY/NIGHT_CHECK_INTERVAL_MINUTES、WAKE_DAY_START/END_HOUR 不再读取。
  function getWakeAfterMinutes() {
    return sleepCfg.read().afterMin;
  }
  // 兜底轮询间隔（精确定时器是主路径，轮询只管自愈：她发言后重挂定时器、漏掉的到点补上）
  function getCheckIntervalMinutes() {
    return readNumberEnv("WAKE_CHECK_INTERVAL_MINUTES", 10, { min: 1 });
  }
  function getCheckIntervalMs() {
    return getCheckIntervalMinutes(new Date()) * 60 * 1000;
  }

  // ---- 日记（实现已抽至 lib/diary.js 共享模块，2026-09-16）----
  function stripInternalTags(text) {
    return tagParser.stripTags(text).replace(/^\s+|\s+$/g, "");
  }

  // 2026-09-26 查岗改造：删除 fetchPhoneStateContext（唤醒提示词的手机状态占位符已由用户
  // 移除，本函数算出的文本无处注入，属死代码；手机信息改由 AI 按需调 phone_state 工具查看）。

  // ---- 多会话扫描 ----
  /* [位置:lib/wake-scheduler.js·getTimelineBySessionId] [唤醒侧时间线按需单读 + 指纹 LRU] [需求：唤醒判定一次只关心一两个会话，不要为它把全部会话时间线读进内存] [注释时间 2026-11-12]
     沿革：2026-09-22 审查 R5 把「每次调用都全量扫盘」改成了 5 秒 TTL 全量缓存，但全量解析本身没去掉。
     2026-11-12（会话退出后过一会儿就中断）实测：timeline_data 346 个文件共 236MB（其中 242 个是归档会话），
     JSON.parse 成对象约 2.1 倍膨胀，而一个唤醒周期内还有 3 处强制全量重载 → 单次 heap 尖峰 +337MB
     （19:41 rss 859MB / heapUsed 723MB），直接顶过 pm2 max_memory_restart 被 SIGINT 杀掉，
     生成中的回复只能落半截——这是「回复写一半没了」和排空窗口 503 的共同根因。
     现改为按需单读：谁被点名只读谁的文件；归档会话只有被显式点名（闹钟到点、事件订阅）才读，
     枚举类调用不再碰归档（归档的不用算）。指纹口径与 server.js 的 _timelineCache 一致
     （size:mtimeMs:ctimeMs:ino），文件一改下次必重读，不会把旧快照当新的用。 */
  const TL_CACHE_MAX_SESSIONS = 4;                  // 一个周期通常 1-2 个会话；留 4 给事件订阅批量叫醒
  const TL_CACHE_MAX_BYTES = 64 * 1024 * 1024;      // 字节预算：单会话最大 8.7MB（≈18MB 堆），超预算不进缓存只读一次
  const _tlCache = new Map();                       // sessionId -> { fp, data, cost }；插入顺序即 LRU（最旧在前）
  let _tlCacheBytes = 0;
  function _tlCacheDrop(sessionId) {
    const old = _tlCache.get(sessionId);
    if (old) { _tlCacheBytes -= old.cost; _tlCache.delete(sessionId); }
  }
  function invalidateTimelinesCache() { _tlCache.clear(); _tlCacheBytes = 0; }   // 保留原名：唤醒落库后整体失效
  function invalidateTimelineFor(sessionId) { _tlCacheDrop(sessionId || "default"); }   // 只失效一个会话（原先的 force 全量重载改用这个）
  function _tlFileFor(sessionId) {
    if (!sessionId || sessionId === "default") return TIMELINE_PATH;
    return path.join(TIMELINE_DIR, "enhanced_messages_" + sessionId + ".json");
  }
  function _tlFingerprint(file) {
    try {
      const st = fs.statSync(file);
      return st.size + ":" + st.mtimeMs + ":" + st.ctimeMs + ":" + st.ino;
    } catch (e) { return ""; }
  }
  function getTimelineBySessionId(sessionId) {
    const sid = sessionId || "default";
    // V8（0930）：与 context-replacements.js 会话枚举同款排除 diag 内部文件；
    // 2026-10-25：s_sub_ 前缀是子智能体子会话（lib/subagent-runner.js），不参与唤醒/订阅扫描
    if (sid !== "default" && (sid === "__diag__" || /^s_sub_/.test(sid))) return null;
    // 2026-11-12：按需读要拿 sid 拼路径，白名单校验防路径穿越（枚举时代天然安全，改按需后必须自己挡）
    if (sid !== "default" && !/^[A-Za-z0-9_-]+$/.test(sid)) return null;
    const file = _tlFileFor(sid);
    if (!fs.existsSync(file)) { _tlCacheDrop(sid); return null; }
    const fp = _tlFingerprint(file);
    const hit = _tlCache.get(sid);
    if (hit && fp && hit.fp === fp) {
      _tlCache.delete(sid); _tlCache.set(sid, hit);        // 命中挪到队尾（LRU）
      return hit.data;
    }
    let arr = null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      arr = Array.isArray(raw) ? raw : null;
    } catch (e) {
      logWarn("读取会话语失败: " + file + " " + e.message);
      _tlCacheDrop(sid);
      return null;
    }
    if (!arr) { _tlCacheDrop(sid); return null; }
    const entry = { sessionId: sid, file: file, messages: arr };
    const cost = (function () { try { return fs.statSync(file).size; } catch (e) { return 0; } })();
    _tlCacheDrop(sid);
    if (cost <= TL_CACHE_MAX_BYTES) {
      _tlCache.set(sid, { fp: fp, data: entry, cost: cost });
      _tlCacheBytes += cost;
      while (_tlCache.size > TL_CACHE_MAX_SESSIONS || _tlCacheBytes > TL_CACHE_MAX_BYTES) {
        const firstKey = _tlCache.keys().next().value;
        if (firstKey === undefined) break;
        _tlCacheDrop(firstKey);
      }
    }
    return entry;
  }
  // 2026-11-10 产品确定：睡眠唤醒并入事件唤醒——同一份名单（data/wake-event-sessions.json，菜单里的「事件唤醒」）；
  // 旧的 data/wake-locked.json 不再读。函数名沿用，免得改一串调用点。
  function readWakeLockedSessions() {
    try { return wakeSubs.eventSessions(); }
    catch (e) {
      logWarn("读取事件唤醒会话失败: " + e.message);
      return [];
    }
  }
  function collectWakeTargets() {
    const locked = readWakeLockedSessions();
    if (!locked.length) return [];
    const targets = [];
    for (const sid of locked) {
      const tl = getTimelineBySessionId(sid);
      if (tl && Array.isArray(tl.messages) && tl.messages.length) {
        targets.push({ sessionId: sid, messages: tl.messages });
      } else {
        logWarn("锁定会话不存在/已删，跳过: " + sid);
      }
    }
    return targets;
  }

  // ---- 时间解析（沉默判定）----
  // 消息正文时间戳解析（三级降级，链序保持唤醒侧语义）：<current_time> 标签 → 行首墙上时间 → 行尾日期串；
  // 2026-09-30 V4 收敛：正则统一从 time_utils 引（原本地三段正则已删，宽容度=各版并集）
  function parseTimelineTimestamp(value) {
    const text = String(value || "");
    return parseCurrentTimeTagLoose(text) || parseLeadingWallTime(text) || parseTrailingWallTime(text);
  }
  // 10-29：唤醒提示词新变量 ${lastChatGap} 用——会话里最后一次发言（不限角色）的时间，
  // 取法与 getLastUserTime 一致（msg.time 优先，缺失再从正文解析）
  function getLastMsgTime(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.time) {
        const d = new Date(msg.time);
        if (!isNaN(d.getTime())) return d;
      }
      const parsed = parseTimelineTimestamp(toText(msg.content));
      if (parsed) return parsed;
    }
    return null;
  }
  // 从会话尾部倒查最近一条用户消息的时间：优先 msg.time 字段，缺失再从正文解析
  function getLastUserTime(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== "user") continue;
      if (msg.time) {
        const d = new Date(msg.time);
        if (!isNaN(d.getTime())) return d;
      }
      const parsed = parseTimelineTimestamp(toText(msg.content));
      if (parsed) return parsed;
    }
    return null;
  }
  // 普通周期判定：距「周期起点」是否已达到该周期的阈值。
  // 起点口径（2026-09-25 改）：取「上一次唤醒完成时间」与「该会话最后一条用户消息时间」中较晚者——
  //   既吸收上游「用户越久没说话才越该唤醒」的语义（用户一发言就重新计时），
  //   又保留 09-23 的修复（唤醒完成也重新计时，避免用户不说话就每轮反复唤醒）。
  // 阈值口径（2026-09-25 改，口径B）：阈值锁定到「起点所在时段」，一个周期中途不随时钟跨时段而变。
  const WAKE_CYCLE_PATH = path.join(baseDir, "data", "wake_cycle.json");
  function readWakeCycleRaw() {
    try {
      if (!fs.existsSync(WAKE_CYCLE_PATH)) return {};
      const data = JSON.parse(fs.readFileSync(WAKE_CYCLE_PATH, "utf-8"));
      return (data && typeof data === "object") ? data : {};
    } catch (err) {
      logWarn("读取普通唤醒周期状态失败: " + err.message);
      return {};
    }
  }
  function readLastWakeAt(sessionId) {
    const sid = String(sessionId || "default").trim() || "default";
    const raw = readWakeCycleRaw();
    const value = raw.sessions && raw.sessions[sid];
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  function writeWakeCycleRaw(raw) {
    fs.mkdirSync(path.dirname(WAKE_CYCLE_PATH), { recursive: true });
    const tmp = WAKE_CYCLE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), "utf-8");
    fs.renameSync(tmp, WAKE_CYCLE_PATH);
  }
  function writeLastWakeAt(sessionId, at = new Date()) {
    const sid = String(sessionId || "default").trim() || "default";
    const raw = readWakeCycleRaw();
    if (!raw.sessions || typeof raw.sessions !== "object" || Array.isArray(raw.sessions)) raw.sessions = {};
    raw.version = 1;
    raw.sessions[sid] = new Date(at).toISOString();
    writeWakeCycleRaw(raw);
  }
  // 睡眠唤醒的计时起点 = 她最后一条发言的时间；返回 null 表示这条发言「已经了结」不用再等：
  //   ① 发言来自未来/解析不出（忽略，免得无限抑制）；
  //   ② 发言之后已经醒过一次（任何来源的唤醒成功，含闹钟/事件）→ 醒过了，不再为这条发言叫。
  // 她一发言，lastUserTime 变新，上面两条自然都对不上，重新计时。
  function getSleepStart(sessionId, lastUserTime) {
    if (!(lastUserTime instanceof Date) || isNaN(lastUserTime.getTime()) || lastUserTime.getTime() > Date.now()) return null;
    const sid = String(sessionId || "default").trim() || "default";
    const lw = readLastWakeAt(sid);
    if (lw && lw.getTime() >= lastUserTime.getTime()) return null;
    return lastUserTime;
  }
  function getWakeCycleStart(sessionId, lastUserTime) {
    const now = Date.now();
    // 来自「未来」的时间（正文时间戳解析异常等）忽略，否则会无限抑制唤醒
    const candidates = [readLastWakeAt(sessionId), lastUserTime]
      .filter(t => t instanceof Date && !isNaN(t.getTime()) && t.getTime() <= now);
    if (!candidates.length) return null;
    return new Date(Math.max.apply(null, candidates.map(t => t.getTime())));
  }
  // 普通周期的一次「唤醒计划」：起点 + 锁定阈值 → 确定的到点时刻（日志与精确定时器共用）
  function getNormalWakePlan(cycleStartTime) {
    const start = new Date(cycleStartTime);
    const thresholdMinutes = getWakeAfterMinutes();
    return {
      start: start,
      thresholdMinutes: thresholdMinutes,
      segment: "睡眠",
      dueAt: new Date(start.getTime() + thresholdMinutes * 60 * 1000)
    };
  }
  function shouldWake(cycleStartTime, now = new Date()) {
    if (!cycleStartTime) return false;
    const diffMinutes = Math.floor((now - new Date(cycleStartTime)) / 1000 / 60);
    return diffMinutes >= getWakeAfterMinutes();
  }

  // ---- 调度文件（只读路径；写路径收口 lib/wake-schedule.js）----
  function readWakeScheduleRaw() {
    try {
      if (!fs.existsSync(WAKE_SCHEDULE_PATH)) return null;
      const data = JSON.parse(fs.readFileSync(WAKE_SCHEDULE_PATH, "utf-8"));
      return (data && typeof data === "object") ? data : null;
    } catch (err) {
      logWarn("读取定时唤醒失败: " + err.message);
      return null;
    }
  }
  function readWakeScheduleFor(sessionId) {
    const sid = String(sessionId || "default").trim() || "default";
    const raw = readWakeScheduleRaw();
    if (!raw) return null;
    if (!raw.sessions) {
      if (sid !== "default") return null;
      return (raw.next_wake_at ? { next_wake_at: raw.next_wake_at, updated_at: raw.updated_at, session: "default" } : null);
    }
    const entry = raw.sessions[sid];
    return (entry && entry.next_wake_at) ? { ...entry, session: sid } : null;
  }
  function nextWakeFromAnySession() {
    const raw = readWakeScheduleRaw();
    if (!raw) return null;
    let best = null;
    for (const sid of Object.keys(raw.sessions || {})) {
      const e = raw.sessions[sid];
      if (!e || !e.next_wake_at) continue;
      const t = new Date(e.next_wake_at);
      if (isNaN(t.getTime())) continue;
      if (!best || t.getTime() < best.getTime()) best = t;
    }
    return best;
  }
  // 全局「下一次唤醒时刻」（精确定时器用，2026-09-25 加）：闹钟槽位 ∪ 开了睡眠唤醒的会话的睡眠到点时刻，取最早。
  // 2026-11-10 产品确定：闹钟（他设的/她设的/旧 <wake> 槽）与睡眠唤醒各管各的，互不让位；
  // 没开睡眠唤醒的会话只有显式闹钟能唤醒它。
  function nextWakeAtAcrossSessions() {
    let best = nextWakeFromAnySession();
    const consider = t => {
      if (t && !isNaN(t.getTime()) && (!best || t.getTime() < best.getTime())) best = t;
    };
    for (const sid of (sleepCfg.read().enabled ? readWakeLockedSessions() : [])) {   // 总开关关了 = 没有睡眠唤醒的到点时刻
      const tl = getTimelineBySessionId(sid);
      if (!tl || !Array.isArray(tl.messages) || !tl.messages.length) continue;
      const cycleStart = getSleepStart(sid, getLastUserTime(tl.messages));
      if (!cycleStart) continue;
      consider(getNormalWakePlan(cycleStart).dueAt);
    }
    return best;
  }
  function fmtTime(d) {
    try { return d ? formatDateTimeInTimeZone(new Date(d), TIME_ZONE) : "-"; } catch (e) { return String(d); }
  }
  function getDueWakeSessionIds() {
    const raw = readWakeScheduleRaw();
    if (!raw) return [];
    const now = Date.now();
    const out = [];
    for (const sid of Object.keys(raw.sessions || {})) {
      const e = raw.sessions[sid];
      const t = e && e.next_wake_at ? new Date(e.next_wake_at) : null;
      if (t && !isNaN(t.getTime()) && t.getTime() <= now + WAKE_DUE_GRACE_MS) out.push(sid);
    }
    return out;
  }
  function pruneExpiredSchedules() {
    return wakeSchedule.pruneExpired(WAKE_DUE_GRACE_MS);
  }
  function isUserActiveSinceFor(entry, sessionId) {
    if (!entry || !entry.updated_at) return false;
    const setTime = new Date(entry.updated_at);
    if (isNaN(setTime.getTime())) return false;
    const sid = String(sessionId || "default").trim() || "default";
    const tl = getTimelineBySessionId(sid);
    if (!tl) return false;
    const lastUserTime = getLastUserTime(tl.messages);
    return !!(lastUserTime && lastUserTime.getTime() > setTime.getTime());
  }
  function getSessionDisplayName(sessionId) {
    const sid = String(sessionId || "default").trim() || "default";
    try {
      if (fs.existsSync(SESSION_NAMES_PATH)) {
        const names = JSON.parse(fs.readFileSync(SESSION_NAMES_PATH, "utf-8"));
        const n = names && names[sid];
        if (typeof n === "string" && n.trim()) return n.trim();
      }
    } catch (e) {}
    return "";
  }

  // ---- 唤醒提示词 ----
  // 2026-09-26 查岗改造：phoneContext 参数随 fetchPhoneStateContext 一并删除（占位符已不存在）
  // lastChatGap：距本会话最后一次对话多久（「37 分钟前」，读不到=「无记录」）；10-29 要的变量
  // 2026-11-05：weatherContext 参数随 fetchWeatherContext 一并删除（提示词已无天气占位符，不再每次唤醒请求天气）
  function buildWakePrompt(currentTime, diffMinutes, lastChatGap = "无记录") {
    const promptFile = path.join(baseDir, "config", "wake_prompt.txt");
    if (fs.existsSync(promptFile)) {
      let out = fs.readFileSync(promptFile, "utf-8");
      out = out
        .replace(/\$\{currentTime\}/g, currentTime)
        .replace(/\$\{diffMinutes\}/g, diffMinutes)
        .replace(/\$\{lastChatGap\}/g, lastChatGap);
      return out;
    }
    const fromEnv = readEnvValue("WAKE_PROMPT_TEMPLATE");
    if (fromEnv) {
      return String(fromEnv)
        .replace(/\\n/g, "\n")
        .replace(/\$\{currentTime\}/g, currentTime)
        .replace(/\$\{diffMinutes\}/g, diffMinutes)
        .replace(/\$\{lastChatGap\}/g, lastChatGap);
    }
    return `
## 最高优先级规则
1. 这是一次后台自动唤醒，不是用户发起的对话。你没有收到任何新消息。
2. 你的唯一任务是决定是否主动联系用户。不能生成对话回复。
3. 输出格式必须严格遵守以下二选一。

## 唤醒信息
- 当前时间：${currentTime}
- 距离上一次自动唤醒完成：${diffMinutes} 分钟
- 距离上一次对话：${lastChatGap}

## 输出格式
- 如果想联系用户，直接写你想说的话。系统会自动打包成手机推送发送。可以是一句话，也可以第一行作为标题、第二行作为正文。
- 如果不想联系，只输出：[NO_ACTION]，可附带简短原因（10字以内）。
- 如果你想写日记，可以额外输出 [DIARY]...[/DIARY]。只有想写时才写，不必每次都写。
- 写前先用 diary_list 工具读本会话今天已写的日记：今天已经写过的话题不要重复写，可以接着写新段落，或写完全不同的新主题。
- 你可以设置下一次系统主动唤醒你的时间，格式为 <wake>数值</wake>，单位为分钟。时间一到会主动唤醒你一次；如果到点前她主动找过你，这个定时会自动作废。不想设置就不输出这个标签。
`;
  }

  // ---- 定时器 ----
  function armTimedWake() {
    if (timedWakeTimer) {
      clearTimeout(timedWakeTimer);
      timedWakeTimer = null;
    }
    let nextWakeAt = null;
    // 2026-09-25：候选 = 闹钟槽位 ∪ 锁定会话的普通周期到点时刻（普通周期也精确到分挂载）
    try { nextWakeAt = nextWakeAtAcrossSessions(); } catch (err) { /* 读取失败按无定时处理 */ }
    // 2026-10-25：wake 工具闹钟（多闹钟/daily）并入候选
    try {
      const alarmNext = wakeAlarms.nextAlarmAt();
      if (alarmNext && (!nextWakeAt || alarmNext.getTime() < nextWakeAt.getTime())) nextWakeAt = alarmNext;
    } catch (e) { /* 读失败按无闹钟处理 */ }
    if (!nextWakeAt) return;
    const delayMs = nextWakeAt.getTime() - Date.now();
    if (delayMs <= 0) {
      // 已过期（例如进程重启错过了到点时刻）：先捕获到点的显式 <wake> 闹钟并补触发一次唤醒，
      // 再清理过期调度——否则显式提醒会被静默丢弃，用户设的闹钟到点毫无反应。
      // 2026-09-25：此处只补触发「闹钟」，不补触发「已过期的普通周期」——普通周期到点即唤醒会与
      // 「唤醒失败不重置起点」叠加成热循环（失败→起点不变→立刻又到点）。过期的普通周期交给
      // scheduleNextCheck 轮询兜底，重试频率仍受检查间隔约束。
      let due = [];
      try { due = getDueWakeSessionIds(); } catch (e) { /* 忽略 */ }
      try { for (const s of wakeAlarms.dueAlarmSids()) if (due.indexOf(s) < 0) due.push(s); } catch (e) { /* 忽略 */ }
      if (timedWakeTimer) { clearTimeout(timedWakeTimer); timedWakeTimer = null; }
      /* [位置:lib/wake-scheduler.js·armTimedWake 过期分支] [补触发防空转 + 防重复唤醒] [10-28 反馈「唤醒很乱」，查日志 10-27 11:57~12:10：闹钟唤醒跑着（LLM 要 3~6 分钟，闹钟要成功后才推进，期间一直「已到点」），每次 armTimedWake 都命中本分支→setTimeout 0 补触发→撞 wakeInflight 跳过→runWakeUp 收尾又 armTimedWake→再命中，形成每秒约 500 轮的空转（3 分钟 ~9 万行日志，日志涨到 139MB）；空转队列里的旧到点名单在第一次唤醒结束后放行，又触发第二次整套唤醒（12:03 与 12:10 各一次，闹钟其实已经消费了）。改：①补触发同一时刻只允许一个（catchUpBusy）；②名单里正在处理的会话不重复触发——它结束后 runWakeUp 收尾会重算；③补触发没成功就隔 5 秒再重试，不空转；④runWakeUpInner 里到点名单按「此刻还到点」重新核对，已消费的丢弃] [注释时间 2026-10-28] */
      const idle = due.filter(s => !wakeInflight.has(s));
      if (catchUpBusy) return;
      if (idle.length) {
        due = idle;
        catchUpBusy = true;
        console.log(`[wake-scheduler] 检测到已到点的闹钟（进程重启错过），补触发唤醒：${due.join(", ")}`);
        // 2026-09-21 审查 R1：先补触发、确认执行成功后才清理槽位。原顺序先 prune 后触发，
        // 补触发撞互斥被跳过时槽位已删且无重试，闹钟静默蒸发（正是注释声称已修的问题）。
        setTimeout(async () => {
          // 2026-09-30 三态化：仅 "ok"（全部处理成功）才 prune；partial/failed 槽位保留待重试，
          // 失败计数达 WAKE_FAIL_MAX 后由 addWakeFailure 放弃并告警
          let res = "failed";
          try {
            res = await runWakeUp(due);
            if (res === "ok") {
              try { pruneExpiredSchedules(); } catch (err) { logWarn("清理过期定时失败: " + err.message); }
              try { wakeAlarms.advanceDueAlarms(); } catch (err) { logWarn("推进工具闹钟失败: " + err.message); }
            } else if (res === "skipped") {
              logWarn("补触发被互斥跳过，过期槽位保留待下轮重试");
            } else {
              logWarn("补触发未完全成功（" + res + "），过期槽位保留待下轮重试");
            }
          } finally {
            // 成功立刻重算下一个定时；没成功隔 5 秒再来，绝不空转
            setTimeout(() => { catchUpBusy = false; try { armTimedWake(); } catch (e) { /* 由轮询兜底 */ } }, res === "ok" ? 0 : 5000);
          }
        }, 0);
      } else if (!due.length) {
        // 无到点闹钟才直接清理（此时 prune 不会丢任何待触发的槽位）
        try { pruneExpiredSchedules(); } catch (err) { /* 忽略 */ }
      }
      return;
    }
    // 2026-09-21 审查 R2：setTimeout 延时超过 2^31-1ms（约 24.8 天）会被 Node 钳到 1ms 立即
    // 触发→runTimedWake→armTimedWake 重挂 1ms→全量扫盘热循环，gateway 自瘫。超过 24 小时
    // 只挂「重算定时器」：到点重读 nextWakeAt 重挂，不提前触发唤醒（避免沉默唤醒被提前拉响）。
    const WAKE_TIMER_CAP_MS = 24 * 60 * 60 * 1000;
    if (delayMs > WAKE_TIMER_CAP_MS) {
      timedWakeTimer = setTimeout(armTimedWake, WAKE_TIMER_CAP_MS);
      console.log(`[wake-scheduler] 定时唤醒超过 24 小时（${Math.round(delayMs / 3600000)} 小时后），24 小时后重算重挂：${formatDateTimeInTimeZone(nextWakeAt, TIME_ZONE)}`);
      return;
    }
    // Math.ceil：setTimeout 会把小数毫秒向零截断，不取整会让定时器比闹钟时刻早触发 <=1ms
    timedWakeTimer = setTimeout(runTimedWake, Math.max(1, Math.ceil(delayMs)));
    console.log(`[wake-scheduler] 已设定定时唤醒：${formatDateTimeInTimeZone(nextWakeAt, TIME_ZONE)}（${Math.round(delayMs / 60000)} 分钟后）`);
  }
  async function runTimedWake() {
    timedWakeTimer = null;
    const dueSids = getDueWakeSessionIds();
    // 2026-10-25：wake 工具到点的会话并入（进 dueSet = explicitWake 语义，跳过周期判定，照常过 wakeGate）
    try { for (const s of wakeAlarms.dueAlarmSids()) if (dueSids.indexOf(s) < 0) dueSids.push(s); } catch (e) { /* 忽略 */ }
    console.log("\n===== 定时唤醒到点 =====\n");
    const res = await runWakeUp(dueSids);
    // 2026-09-30 三态化：仅 "ok"（全部目标处理成功）才清理到点槽位。
    // 原实现只要"执行过"（含 LLM 失败）就 prune，把失败槽位一并删掉——与
    // "槽位已保留待重试"的设计相悖，正是 0930 10:20 闹钟静默丢失的第二现场。
    // partial/failed 时槽位保留，由重试 + 失败计数（WAKE_FAIL_MAX）兜底。
    if (res === "ok") {
      try { pruneExpiredSchedules(); } catch (e) { logWarn("清理过期定时失败: " + e.message); }
      try { wakeAlarms.advanceDueAlarms(); } catch (e) { logWarn("推进工具闹钟失败: " + e.message); }
    } else if (res !== "skipped") {
      logWarn("本轮唤醒未完全成功（" + res + "），到点槽位保留待下轮重试");
    }
    try { armTimedWake(); } catch (e) { /* 重挂失败由轮询兜底 */ }
  }

  // ---- 唤醒主流程（互斥）----
  async function runWakeUp(dueSids) {
    // 2026-09-30 返回值三态化："ok"（全部成功）/ "partial"（有目标本轮跳过）/ "failed"（有失败）/ "skipped"（网关退出中）
    // 批D·27：原来的全局互斥（上一次没跑完就整轮跳过）撤掉——并发与顺序交给 wakeGate（每会话车道）和 wakeInflight（同会话不重入）
    if (global.__GATEWAY_SHUTTING_DOWN) return "skipped";   // 1019 重启保护：排空期间不开新唤醒
    try {
      return await runWakeUpInner(dueSids);
    } catch (err) {
      // 统一记日志吃掉：定时入口由 setTimeout 触发无人兜底，异常会成为 unhandled rejection
      const detail = (err && err.stack) ? err.stack : String(err) + "\n[非 Error 抛出物，以下是捕获点调用栈]\n" + new Error("trace").stack;
      logErr("唤醒执行失败: " + detail);
      // 异常按 failed 处理：调用方不 prune，槽位保留待重试（原实现返回 true 会把失败槽位一并误清）
      return "failed";
    }
  }
  function skipChattyUserAlarms() {
    const quietMin = sleepCfg.read().userAlarmQuietMin;
    if (!quietMin) return;
    for (const sid of wakeAlarms.dueAlarmSids()) {
      const tl = getTimelineBySessionId(sid);
      const lu = tl && Array.isArray(tl.messages) ? getLastUserTime(tl.messages) : null;
      if (!lu || Date.now() - lu.getTime() >= quietMin * 60 * 1000) continue;
      const n = wakeAlarms.skipDueUserAlarms(sid);
      if (n) console.log("[wake-scheduler] 会话 " + sid + " 她 " + quietMin + " 分钟内聊过，她自己设的 " + n + " 个到点闹钟这一轮不响（每天的推到明天）");
    }
  }
  // 2026-11-10 概率闹钟：她自己设的、带概率的到点闹钟先掷骰子，没中这一轮不响（每天的推到明天，一次性的作废）
  function rollProbUserAlarms() {
    for (const sid of wakeAlarms.dueAlarmSids()) {
      const r = wakeAlarms.rollDueUserAlarms(sid);
      if (r.missed || r.hit) console.log("[wake-scheduler] 会话 " + sid + " 她设的概率闹钟到点掷骰子：命中 " + r.hit + " 个，没中 " + r.missed + " 个（没中的这一轮不响，每天的推到明天）");
    }
  }
  async function runWakeUpInner(dueSids) {
    const targets = collectWakeTargets();
    // 显式 <wake> 闹钟不受「锁定唤醒」影响：只要到现在点就必须被处理（未锁定的会话也并入）
    // 2026-10-28：传进来的到点名单只当「线索」，真正是否到点按此刻重新核对——排队/空转期间那个闹钟可能
    // 已被前一次唤醒消费，旧名单照单全收会再整套唤醒一次（10-27 12:03/12:10 的重复唤醒）
    // 2026-11-09 她自己设的闹钟：到点前 userAlarmQuietMin 分钟内她发过言 → 这一轮不响（每天的推到明天，一次性的作废）；AI 设的闹钟不受影响
    try { skipChattyUserAlarms(); } catch (e) { logWarn("用户闹钟聊天作废检查失败（按原样继续）: " + e.message); }
    try { rollProbUserAlarms(); } catch (e) { logWarn("用户闹钟概率检查失败（按原样继续）: " + e.message); }
    const dueSet = new Set();
    for (const sid of getDueWakeSessionIds()) dueSet.add(sid);
    // 2026-10-26 周期兜底把到点的工具闹钟也并入（此前工具闹钟只有精确定时器一条命，链断就哑到下次偶然重挂）
    try { for (const s of wakeAlarms.dueAlarmSids()) dueSet.add(s); } catch (e) { /* 忽略 */ }
    if (Array.isArray(dueSids)) {
      const stale = dueSids.filter(sid => !dueSet.has(sid));
      if (stale.length) console.log("[wake-scheduler] 到点名单里的 " + stale.join(", ") + " 已不再到点（被前一次唤醒消费了），不重复唤醒");
    }
    if (dueSet.size) {
      const sessionByTarget = new Map();
      for (const t of targets) sessionByTarget.set(t.sessionId || "default", t);
      for (const sid of dueSet) {
        const known = sessionByTarget.get(sid);
        if (known) { known.explicitWake = true; continue; }
        const tl = getTimelineBySessionId(sid);
        if (tl && Array.isArray(tl.messages) && tl.messages.length) {
          targets.push({ sessionId: sid, messages: tl.messages, explicitWake: true });
        } else {
          logWarn("显式闹钟会话不存在/已删，跳过: " + sid);
        }
      }
    }
    // 1002-22：无唤醒目标（未锁定会话且无到点闹钟）时静默返回，不再刷横幅日志——
    // 此前每轮「=====开始自动唤醒=====无唤醒目标」空转日志长期白刷新，日志只是噪声无信息量。
    if (!targets.length) return "ok";
    console.log("\n==========================");
    console.log("开始自动唤醒 " + formatDateTimeInTimeZone(new Date(), TIME_ZONE));
    console.log("==========================\n");
    // 多锁定会话同时到点：各会话各自走自己的车道（互不等待），起步错峰 1.5 秒避免同一瞬间连发
    const sleepMs = ms => new Promise(r => setTimeout(r, ms));
    let anyFail = false, anySkip = false;
    const results = await Promise.all(targets.map(async (t, i) => {
      if (i > 0) await sleepMs(1500 * i);
      return runWakeForTarget(t);
    }));
    for (let i = 0; i < targets.length; i++) {
      // runWakeForTarget 返回 { status: "ok"|"skip"|"fail", reason? }（2026-09-30）
      const r = results[i];
      const st = (r && r.status) || "skip";
      const sid = targets[i].sessionId || "default";
      if (st === "fail") { anyFail = true; addWakeFailure(sid, (r && r.reason) || "未知原因"); }
      else if (st === "ok") { clearWakeFailure(sid); }
      else { anySkip = true; }
    }
    // 2026-09-25：本轮唤醒已重置起点 → 普通周期的下一次到点时刻变了，重挂精确定时器
    try { armTimedWake(); } catch (e) { logWarn("唤醒后重挂定时器失败: " + e.message); }
    return anyFail ? "failed" : (anySkip ? "partial" : "ok");
  }
  /* [位置:lib/wake-scheduler.js·runWakeForTarget] [会话唤醒入口（带放行闸门）] [批D·27：判定（要不要唤醒）照旧不排队；判定通过、要调模型前才去闸门领号；等过一阵（>1.5 秒）说明期间用户可能聊过，拿到号后把时间线重读一遍、判定重走一次再决定要不要真唤醒；没真唤醒就把号还回去（idle，不占间隔）] [注释时间 2026-10-22] */
  async function runWakeForTarget(target) {
    const sid = target.sessionId || "default";
    if (wakeInflight.has(sid)) {
      console.log("[wake-scheduler] 会话 " + sid + " 已有一次唤醒在处理/排队中，本次跳过");
      return { status: "skip" };
    }
    wakeInflight.add(sid);
    let turn = null, passed = false;
    const hook = async function (explicit) {
      if (turn) { passed = true; return "go"; }
      const t = await wakeGate.acquire(sid, explicit === "event" ? "事件" : explicit ? "闹钟" : "周期");
      if (!t) return null;   // 网关退出中
      turn = t;
      if (t.waitedMs > 1500) return "again";
      passed = true; return "go";
    };
    try {
      let r = await runWakeForTargetInner(target, hook);
      if (r && r.status === "again") {
        try {
          invalidateTimelineFor(sid);          // 2026-11-12：原先 force 全量重载，改为只失效本会话
          const tl = getTimelineBySessionId(sid);
          if (tl && Array.isArray(tl.messages) && tl.messages.length) target = Object.assign({}, target, { messages: tl.messages });
        } catch (e) { logWarn("排队后重读时间线失败（按原内容继续判定）: " + e.message); }
        r = await runWakeForTargetInner(target, hook);
        if (r && r.status === "again") r = { status: "skip" };
      }
      return r;
    } finally {
      if (turn) turn.release({ idle: !passed });
      wakeInflight.delete(sid);
    }
  }
  /* [位置:lib/wake-scheduler.js·buildWakeTail] [唤醒提示词末尾「这次是因为…」] [2026-11-09：统一到一处——事件叫醒用事件文案；闹钟叫醒按到点闹钟逐个说明（她自己设的带她留的附言，AI 设的带 label，无 label 不加字）；睡眠唤醒说聊天停了多久并追加设置页那段全局文字。随 wake_block 一起落盘，压缩前 AI 一直能看到缘由] */
  function buildWakeTail(target, sid) {
    if (target.eventKey) return wakeSubs.eventText(target.eventKey);
    const parts = [];
    let alarms = [];
    try { alarms = wakeAlarms.dueAlarmsForTail(sid); } catch (e) { /* 读失败按无闹钟 */ }
    const aiLabels = [];
    for (const a of alarms) {
      if (a.by === "user") parts.push("这次唤醒是因为她设的闹钟到点了。" + (a.note ? "她留的话：「" + String(a.note).slice(0, 500) + "」" : ""));
      else if (a.label) aiLabels.push(String(a.label).slice(0, 60));
    }
    if (aiLabels.length) parts.push("这次唤醒是因为你设的闹钟「" + aiLabels.join("」「") + "」到点了。");
    if (!parts.length && target.sleepWake) {
      const note = sleepCfg.read().note;
      parts.push("这次是因为她好像睡着了。" + (note ? "\n" + note : ""));
    }
    return parts.join("\n");
  }
  async function runWakeForTargetInner(target, gateHook) {
    const messages = target.messages;
    const wakeSessionId = target.sessionId || "default";
    console.log("[wake-scheduler] 唤醒处理会话: " + wakeSessionId + "（共 " + messages.length + " 条）");

    /* [位置:lib/wake-scheduler.js·runWakeForTargetInner 用户消息时间前置] [显式闹钟/事件唤醒不被卡死] [2026-11-05：用户消息时间只有普通周期判定用得到；显式闹钟（explicitWake）到点、事件唤醒（eventKey）本身就是唤醒理由，不需要它。原实现解析不出就整次 fail，连败 3 次会放弃槽位并 Bark 告警，闹钟白设。改：显式闹钟/事件唤醒没有也照常醒；普通周期解析不出按 skip 安静跳过（不计失败、不告警）。任何一次唤醒成功仍照旧重置周期起点（醒过了就重新计时），本改动不碰] [注释时间 2026-11-05] */
    const lastMessageTime = getLastUserTime(messages);
    if (!lastMessageTime && !target.explicitWake && !target.eventKey) {
      console.log("[wake-scheduler] 未找到用户消息时间，普通周期无法判定起点，本次跳过");
      return { status: "skip" };
    }
    const now = new Date();
    let cycleStartTime = getWakeCycleStart(wakeSessionId, lastMessageTime);
    let diffMinutes = cycleStartTime
      ? Math.max(0, Math.floor((now - cycleStartTime) / 1000 / 60))
      : 0;
    let wakeExecutionSucceeded = false;

    let explicitWake = !!target.explicitWake;
    let dueSlotCleared = false;   // 2026-09-22 审查 R3：定时唤醒槽位必须在 LLM 成功执行后才清
    try {
      const schedule = target.eventKey ? null : readWakeScheduleFor(wakeSessionId);   // 订阅事件叫醒不看也不动闹钟槽位
      if (schedule) {
        // 2026-09-26：keep=true 的槽位是 AI 明确要求的「不受用户消息影响」→ 用户发言不作废，按绝对时刻处理
        const keepAlarm = schedule.keep === true;
        if (keepAlarm && isUserActiveSinceFor(schedule, wakeSessionId)) {
          console.log(`[wake-scheduler] 会话 ${wakeSessionId} 闹钟为 keep=true，用户发言不作废（${fmtTime(schedule.next_wake_at)}）`);
        }
        if (!keepAlarm && isUserActiveSinceFor(schedule, wakeSessionId)) {
          // 设定之后用户在该会话主动找过 AI → 定时作废，本次按正常节奏判断
          explicitWake = false;
          try { wakeSchedule.clearSlot(wakeSessionId); } catch (e) { logWarn("清理作废定时失败: " + e.message); }
          dueSlotCleared = true;
        } else {
          const nextWakeAt = new Date(schedule.next_wake_at);
          // 2026-11-10 产品确定：旧 <wake> 槽未到点不再压住睡眠唤醒（各管各的）；只有到点才算显式闹钟
          // （同一口径带宽限窗：定时器提前 <=1ms 触发时，槽位在毫秒级仍算到点）
          if (isNaN(nextWakeAt.getTime()) || nextWakeAt.getTime() <= Date.now() + WAKE_DUE_GRACE_MS) explicitWake = true;
          // R3：此处先不清槽位，等 runWakeCompletion 成功后再清；失败保留槽位待重试。
        }
      }
    } catch (scheduleErr) {
      logWarn("检查会话级下次唤醒时间失败（忽略）: " + scheduleErr.message);
    }
    // 2026-11-10 产品确定：未到点的闹钟（他设的/她设的）不再压住睡眠唤醒，两边各管各的；到点的闹钟已由 dueSet 带入 explicitWake。

    if (!explicitWake && !target.eventKey && !sleepCfg.read().enabled) return { status: "skip" };   // 睡眠唤醒总开关关着：不叫（静默，免得刷日志）
    if (!explicitWake && !target.eventKey) {   // 订阅事件叫醒：不走「安静多久」的睡眠判定，事件本身就是理由
      // 2026-11-09 睡眠唤醒：起点 = 她最后一条发言；停满 afterMin 分钟、且这条发言之后没醒过/没掷过骰子才叫
      let sleepStart = getSleepStart(wakeSessionId, lastMessageTime);
      if (!sleepStart || !shouldWake(sleepStart, now)) {
        const plan = sleepStart ? getNormalWakePlan(sleepStart) : null;
        console.log(plan
          ? `[wake-scheduler] 会话 ${wakeSessionId} 暂不需要睡眠唤醒：她最后发言 ${fmtTime(plan.start)}，要停满 ${plan.thresholdMinutes} 分钟，到点 ${fmtTime(plan.dueAt)}`
          : `[wake-scheduler] 会话 ${wakeSessionId} 暂不需要睡眠唤醒：她最后一条发言之后已经醒过/掷过骰子，等她再发言重新计时`);
        return { status: "skip" };
      }
      // 唤醒前复核：判定通过后、真正调模型前强制重读时间线，她刚好发了言就取消（专治检查点与发言撞在同一秒）
      try {
        invalidateTimelineFor(wakeSessionId);   // 2026-11-12：原先 force 全量重载，改为只失效本会话
        const freshTl = getTimelineBySessionId(wakeSessionId);
        if (freshTl && Array.isArray(freshTl.messages) && freshTl.messages.length) {
          const freshStart = getSleepStart(wakeSessionId, getLastUserTime(freshTl.messages));
          if (!freshStart || !shouldWake(freshStart, new Date())) {
            console.log(`[wake-scheduler] 会话 ${wakeSessionId} 唤醒前复核：她刚发过言（${fmtTime(freshStart)}），本轮跳过（未调模型）`);
            return { status: "skip" };
          }
          sleepStart = freshStart;
        }
      } catch (e) {
        logWarn("唤醒前复核失败（按原判定继续）: " + e.message);
      }
      cycleStartTime = sleepStart;
      diffMinutes = Math.max(0, Math.floor((Date.now() - sleepStart.getTime()) / 1000 / 60));
      target.sleepWake = true;
    }

    // 批D·27：到这里「确实要唤醒」，去闸门领号（同会话一个接一个、间隔、不抢用户的话）
    const gate = await gateHook(target.eventKey ? "event" : explicitWake);
    if (!gate) return { status: "skip" };
    if (gate === "again") return { status: "again" };

    /* [位置:lib/wake-scheduler.js·runWakeForTargetInner 天气注入移除] [唤醒不再请求天气] [2026-11-05 产品确定：wake_prompt.txt 已无天气占位符，每次唤醒请求 open-meteo 纯属死请求（超时 5 秒拖慢唤醒）；fetchWeatherContext 整个删除，唤醒提示词不再有天气。设置页天气开关接口（server.js）保留未动，之后想接回天气改 wake_prompt.txt 加占位符即可] [注释时间 2026-11-05] */
    // 10-29：${lastChatGap}——距本会话最后一次对话多久；时间线没加载就现拉一次，读不到给「无记录」，不挡唤醒
    let lastChatGap = "无记录";
    try {
      let tl0 = getTimelineBySessionId(wakeSessionId);
      if (!tl0) { invalidateTimelineFor(wakeSessionId); tl0 = getTimelineBySessionId(wakeSessionId); }
      if (tl0 && Array.isArray(tl0.messages) && tl0.messages.length) {
        const lm = getLastMsgTime(tl0.messages);
        if (lm) lastChatGap = Math.max(0, Math.floor((Date.now() - lm.getTime()) / 1000 / 60)) + " 分钟前";
      }
    } catch (e) { logWarn("计算距上次对话时长失败（按无记录继续）: " + e.message); }
    const wakePrompt = buildWakePrompt(formatDateTimeInTimeZone(new Date(), TIME_ZONE), diffMinutes, lastChatGap);

    // 统一唤醒链路（进程内直调，无 HTTP 自环）：上下文重建/工具循环全在 runWakeCompletion
    let rawAiTextFull = "";
    let wakeToolHistory = [];
    let wakeBlockId = null;
    let wakeReasoning = "";   // 2026-09-24 P3-3
    let wakeStreamTimeline = null;  /* 2026-10-28 R4：唤醒时间线（streamToolLoop → wake-chat → 这里 → applyWakeEventV2） */
    let wakeUsage = null;  /* 2026-11-01：唤醒 token 用量（wake-chat → 这里 → applyWakeEventV2），静默/唤醒消息抽屉统计行数据源 */
    try {
      const res = await runWakeCompletion(wakeDeps, {
        session_id: wakeSessionId,
        wake_block: wakePrompt,
        /* [位置:lib/wake-scheduler.js·runWakeUpInner sub_ask] [订阅询问已停] [11-02：事件唤醒去掉 AI 确认步骤，只留用户单边开关，不再向 AI 追加「你想被叫醒哪些」的询问（sub_ask/sub_ask_mark 不再传，routes/wake-chat.js 里对应分支自然不触发）] [注释时间 2026-11-02] */
        /* [位置:lib/wake-scheduler.js·runWakeUpInner wake_tail] [闹钟label带出] [2026-10-31：AI 用 wake 工具设的闹钟本来就存 label，此前后触发只报时间不报用途，AI 醒来不知道这次是谁叫的。事件叫醒照旧走 eventText；工具闹钟叫醒（无 eventKey）且到点闹钟带 label 时追加「这次唤醒是因为你设的闹钟「label」到点了。」（多闹钟用「」相连；无 label 不加字——产品确定）。dueAlarmsWithLabel 只读不消费，推进仍由唤醒成功后的 advanceDueAlarmsFor 负责；随 wake_block 一起落盘，下次压缩前 AI 一直能看到这次唤醒的缘由] [注释时间 2026-10-31] */
        wake_tail: buildWakeTail(target, wakeSessionId),
        with_tools: true
      });
      rawAiTextFull = String(res.text || "");
      wakeToolHistory = Array.isArray(res.toolHistory) ? res.toolHistory : [];
      wakeBlockId = res.wakeBlockId || null;
      wakeReasoning = String(res.reasoning || "");   // 2026-09-24 P3-3：唤醒思考链透出（与聊天链路对齐）
      wakeStreamTimeline = Array.isArray(res.streamTimeline) ? res.streamTimeline : null;  /* 2026-10-28 R4 */
      wakeUsage = (res && res.usage) || null;  /* 2026-11-01：与聊天链路对齐，回复落盘带 tokens */
      console.log("[wake-scheduler] 统一链路完成：工具 " + wakeToolHistory.length + " 个，正文 " + rawAiTextFull.length + " 字");
      // R3：定时唤醒到点且尚未清理的槽位，在 LLM 调用成功后才清理；失败保留槽位。
      if (explicitWake && !dueSlotCleared) {
        try { wakeSchedule.clearSlot(wakeSessionId); dueSlotCleared = true; }
        catch (e) { logWarn("唤醒成功后清理槽位失败: " + e.message); }
      }
      // 2026-10-26 工具闹钟按会话推进（对齐旧槽 R3「成功即清该会话槽位」粒度）：本会话唤醒成功即推进
      // 该会话到点的工具闹钟（once 删、daily 推明天），不再等整轮 ok——多会话并发时别的会话失败
      // 不该让已成功会话的闹钟重复响。函数只动到点的，无到点即空操作，无条件调用安全幂等；
      // 整轮 advanceDueAlarms 保留作双保险。
      try { wakeAlarms.advanceDueAlarmsFor(wakeSessionId); }
      catch (e) { logWarn("推进本会话工具闹钟失败: " + e.message); }
      // R5：唤醒链路已完成（含回复/日记落库）→ 作废本轮时间线缓存，后续步骤读到最新盘上内容
      invalidateTimelinesCache();
      // AI/工具统一链路成功后才允许重置普通周期；失败时保留上一轮起点。
      wakeExecutionSucceeded = true;
    } catch (e) {
      logErr("统一唤醒链路失败，本次唤醒中止（槽位已保留待重试）: " + e.message);
      return { status: "fail", reason: String(e.message || "未知错误").slice(0, 160) };
    }

    // <wake> 标签：AI 可设置下次主动唤醒时间；标签不进入推送正文，但必须保留在时间线原始流水中。
    const wakeTagMatch = rawAiTextFull.match(/<wake>([\s\S]*?)<\/wake>/i);
    let wakeSetFail = "";   // 2026-11-11：<wake> 没设上的原因（进失败回执）；设成功不再回执
    if (wakeTagMatch) {
      const parsed = parseWakeTarget(wakeTagMatch[1], TIME_ZONE);
      if (parsed) {
        const nextWakeAt = parsed.at || new Date(Date.now() + parsed.minutes * 60 * 1000);
        if (nextWakeAt.getTime() > Date.now()) {
          const label = parsed.at
            ? formatDateTimeInTimeZone(nextWakeAt, TIME_ZONE)
            : `${parsed.minutes} 分钟后（至 ${formatDateTimeInTimeZone(nextWakeAt, TIME_ZONE)}）`;
          try {
            wakeSchedule.saveSlot(nextWakeAt.toISOString(), wakeSessionId, { keep: !!parsed.keep });
            console.log(`[wake-scheduler] AI 设定主动唤醒时间：${label}（${nextWakeAt.toISOString()}，会话 ${wakeSessionId}${parsed.keep ? "，keep=true 不受用户发言影响" : ""}）`);
            armTimedWake();
          } catch (wakeErr) {
            logWarn("保存下次唤醒时间失败: " + wakeErr.message);
          }
        } else {
          console.log("[wake-scheduler] <wake> 时间已过（忽略）:", wakeTagMatch[1]);
          wakeSetFail = "时间已过";
        }
      } else {
        console.log("[wake-scheduler] <wake> 内容无效（忽略）:", wakeTagMatch[1]);
        wakeSetFail = "时间格式无效";
      }
    }
    const rawAiText = rawAiTextFull.replace(/<wake>[\s\S]*?<\/wake>/gi, "").trim();
    console.log("\nWake Result Summary:\n");
    console.log(JSON.stringify({ via_gateway: true, tools: wakeToolHistory.length, ai_text_chars: rawAiText.length }));

    const diaryResult = diaryLib.extractDiaryFromResponse(rawAiText);
    const diarySaved = diaryLib.appendDiaryEntry(diaryResult.diaryContent, wakeSessionId);
    // 2026-10-28 第6项：新写法 <push>/<noaction> 先转成旧的 [push]/[NO_ACTION]，后面的推送/静默判定沿用原逻辑（代码块/表格里的不转）
    const aiText = require("./tag-actions").normalizeWakeTags(diaryResult.remainingText);

    const wakeCompletedAt = new Date();
    const nowText = formatDateTimeInTimeZone(wakeCompletedAt, TIME_ZONE);
    // 2026-11-09：睡眠唤醒醒过一次就不再叫、要等她再发言才重新计时，不存在「下一次系统自动唤醒时间」，回执里不再写这一句。
    let pushFail = "";   // 2026-11-11：只有推送失败才进回执（见 buildWakeReceipt）
    let pushMeta = null;
    // 2026-10-08 用户拍板：推送改显式 [push] 标签制——只有 [push]...[/push] 包裹的内容才推送，
    // 无 push 标签一律不推送（AI 说的话照常落时间线，前端可见）；旧 [BARK] 解析完全移除。
    // 2026-10-28：[push] 也认「不解析」掩码——写在代码块/表格/反引号里的 [push] 只是展示，不推送
    const _pcm = require("../workspace/phone-tags.js").mask(aiText);
    const pushMatch = _pcm.text.match(/\[push\]\s*([\s\S]*?)\s*\[\/push\]/i);
    if (pushMatch) pushMatch[1] = _pcm.restore(pushMatch[1]);

    if (!aiText) {
      console.log("\n[wake-scheduler] AI 未返回推送内容，本次不发送推送\n");
    } else if (/^\[NO_ACTION\]/.test(aiText)) {
      console.log("\n[wake-scheduler] AI 选择不发送推送\n");
    } else if (!pushMatch) {
      console.log("\n[wake-scheduler] AI 未输出 [push] 标签，本次不发送推送\n");
    } else {
      console.log("\n[wake-scheduler] AI 选择发送推送（[push] 标签包裹）\n");
      let pushText = stripInternalTags(pushMatch[1]).replace(/\[DIARY\]|\[\/DIARY\]/gi, "");
      pushText = pushText
        .replace(/^标题[：:]\s*/gm, "")
        .replace(/^正文[：:]\s*/gm, "");
      const lines = pushText.split("\n").filter(line => line.trim() !== "");
      if (lines.length === 0) {
        console.log("\n[wake-scheduler] 推送内容清洗后为空，本次不发送推送\n");
      } else {
        // 2026-09-26 用户拍板：通知不显示标题行——原「标题+正文」拆分取消，AI 输出全文作为正文
        const sessName = getSessionDisplayName(wakeSessionId);
        const body = lines.map(l => l.trim()).filter(Boolean).join(" ");
        const safeBody = body.length > 800 ? body.substring(0, 797) + "..." : body;

        const pushResult = await sendPushNotification({ title: "", body: safeBody, sessionId: wakeSessionId, channel: "webpush" });
        if (!pushResult.ok) {
          console.log(`\n${pushResult.providerLabel || "推送"} 推送失败，本次不发送推送\n`);
          pushFail = `${pushResult.providerLabel || "推送"}：${pushResult.reason}`;
        } else {
          const { getUserDisplayName } = require("./display-names");
          pushMeta = { at: nowText, user: readEnvValue("USER_DISPLAY_NAME") || getUserDisplayName(), channel: pushResult.providerLabel, title: "", body: safeBody, session: wakeSessionId, session_name: sessName };
        }
      }
    }

    // 2026-11-11 产品确定：回执只报失败（推送失败 / 日记标签写错 / <wake> 没设上），成功的事不再回执；规则见文件顶部 buildWakeReceipt。
    // 严格标签校验（2026-09-21）：残缺标签不算日记，明确回传失败，不静默吞掉。
    const eventContent = buildWakeReceipt({ pushFail, diaryTagError: !diarySaved && !!diaryResult.tagError, wakeSetFail });

    // 保存 AI 的完整回复到时间线（进程内直调 wake-event v2 同一实现；幂等去重只在 HTTP 入口做）
    // 2026-09-20：判定记录（发推/未发/失败）也回写时间线（event → developer 系统层消息，前端不显示）；
    // 空回复轮此前整条跳过导致判定丢失，改为只要有判定就落库
    const _timelineSpeak0 = String(((diarySaved && diaryResult.diaryContent) ? diaryLib.extractDiaryFromResponse(rawAiTextFull).remainingText : rawAiTextFull) || "").trim();   // 与下面落时间线的 speak 同一份
    const _tagNotes = [];
    if (rawAiText || eventContent) {
      if (rawAiText) {
        try {
          // 2026-10-28：starContent=实际落盘的那份文本（唤醒回复同时带 <wake> 和 <star> 时标星键对得上，修已知缺陷）；notes=新写法标签失败说明，回复落盘后追加 developer 消息
          await tagParser.extractAndStore(rawAiText, { sessionId: wakeSessionId, starContent: _timelineSpeak0, notes: _tagNotes });
          console.log("[tag-parser] 唤醒时标签解析完成");
        } catch (tagErr) {
          logWarn("唤醒时标签解析失败: " + tagErr.message);
        }
      }
      try {
        // AI 完整输出原样落时间线；系统判定走 event
        // 2026-09-21：日记按唯一格式 [DIARY]正文[/DIARY] 单独落一条 kind=diary 消息（与日常聊天同口径），
        // 唤醒侧不再缺位；正文取 extractDiaryFromResponse 的干净内容，模型写错标签不落库
        // 2026-09-22 修复：speak 在日记成功单独落库时去掉 [DIARY] 块，避免时间线孪生；
        // 但不能使用 rawAiText（它已经剥掉 <wake>），否则 AI 设置的 <wake> 会从完整流水中消失。
        // 因此只从 rawAiTextFull 中剥离 [DIARY]，保留 <wake> 原文。
        // 2026-10-08 用户拍板：时间线是流水账记录层——[push] 标签与 <wake> 同口径原样写入，
        // 不剥不删（前端显示层 stripInnerTags 负责隐藏 [push] 标记、保留内容，与 <wake> 一致）。
        const timelineSpeak = (diarySaved && diaryResult.diaryContent)
          ? diaryLib.extractDiaryFromResponse(rawAiTextFull).remainingText
          : rawAiTextFull;
        const r = applyWakeEventV2({
          v2: true,
          session_id: wakeSessionId,
          speak: String(timelineSpeak || "").trim(),
          diary: (diarySaved && diaryResult.diaryContent) ? diaryLib.wrapDiaryTag(diaryResult.diaryContent) : undefined,
          diary_id: (diarySaved && diarySaved.id) || undefined,
          push: pushMeta,
          event: eventContent || undefined,
          tools: wakeToolHistory.length ? wakeToolHistory : undefined,
          wake_block_id: wakeBlockId || undefined,
          reasoning: wakeReasoning || undefined,
          stream_timeline: (wakeStreamTimeline && wakeStreamTimeline.length) ? wakeStreamTimeline : undefined,
          tokens: wakeUsage || undefined
        });
        if (r && r.ok) {
          console.log("\n[wake-scheduler] 已保存 AI 完整回复到时间线\n");
          // 2026-10-28：新写法标签没写成的说明，回复落盘后追加一条 developer 消息（下一轮 AI 看得到，前端不显示）
          if (_tagNotes.length) { try { wakeDeps.appendMessages(wakeSessionId, [{ role: "developer", content: _tagNotes.join("\n") }]); } catch (ne) { logWarn("追加标签失败说明失败: " + ne.message); } }
        } else {
          logErr("保存 AI 完整回复失败（本次唤醒产出可能未落时间线）: " + (r && r.error));
        }
      } catch (err) {
        logErr("保存 AI 完整回复失败: " + err.message);
      }
    }

    // 任意一次成功唤醒（普通周期或 <wake>）都会重置同一个周期起点；<wake> 只是覆盖下一次唤醒时间。
    if (wakeExecutionSucceeded) {
      try {
        writeLastWakeAt(wakeSessionId, wakeCompletedAt);
        console.log(`[wake-scheduler] 唤醒周期已重置：${wakeSessionId} → ${wakeCompletedAt.toISOString()}`);
      } catch (cycleErr) {
        logErr("保存普通唤醒周期起点失败: " + cycleErr.message);
      }
    }
    return { status: "ok" };
  }

  // ---- 周期检查 ----
  async function scheduleNextCheck() {
    try {
      touchHeartbeat();
      await runWakeUp();
    } catch (err) {
      logErr("唤醒检查出错: " + ((err && err.stack) ? err.stack : String(err)));
    }
    setTimeout(scheduleNextCheck, getCheckIntervalMs());
  }

  // 对话侧（gateway）写入 wake_schedule.json 后，靠轻量轮询感知变化并重新挂定时器
  let lastWakeScheduleFingerprint = null;
  /* [位置:lib/wake-scheduler.js·fingerprintWakeFiles] [唤醒文件感知指纹] [对话侧写入旧槽/工具闹钟后靠轻量轮询感知并重挂定时器；2026-10-26 感知范围从旧槽单文件扩到旧槽+工具闹钟两个文件（此前工具闹钟只靠 set/delete/clear 接口手动重挂兜底，接口异常时新设闹钟悬空）] [注释时间 2026-10-26] */
  function fingerprintWakeFiles() {
    const parts = [];
    for (const p of [WAKE_SCHEDULE_PATH, WAKE_ALARMS_PATH]) {
      try {
        const stat = fs.statSync(p);
        parts.push(`${stat.mtimeMs}:${stat.size}`);
      } catch (e) {
        parts.push("none");   // 不存在也是一种可感知状态（从存在变不存在同样触发重挂）
      }
    }
    return parts.join("|");
  }
  function pollWakeFiles() {
    const fp = fingerprintWakeFiles();
    if (fp !== lastWakeScheduleFingerprint) {
      lastWakeScheduleFingerprint = fp;
      armTimedWake();
    }
  }

  /* [位置:lib/wake-scheduler.js·fireEvent] [订阅事件叫醒入口] [10-23 第 9 条第二步：她发碎碎念/更新经期/记心情/上传相册，事件一来立刻（lib/wake-events.js，2026-11-10 去掉 5 分钟合并窗口）调这里；所有「订阅了这一项且她没关的锁定会话」都叫（只要锁定了、订阅了就叫，不挑最近聊过的），每个会话带 eventKey 走 runWakeForTarget（照常过 wake-gate：她在聊就让路、和上一次唤醒隔 WAKE_GATE_INTERVAL_SEC（默认 300 秒）；不看「安静多久」、不动闹钟槽位）；提示词＝唤醒提示词 + 询问(上下文里没有才问) + 「这次是因为她刚刚更新了碎碎念。」；only＝重试时只叫上次因为会话正忙没叫成的那几个] [注释时间 2026-10-23] */
  async function fireEvent(key, only) {
    let subs = wakeSubs.subscribers(key);
    if (Array.isArray(only)) subs = subs.filter(function (s) { return only.indexOf(s) >= 0; });
    if (!subs.length) return { status: "nosub" };
    try { for (const _s of subs) invalidateTimelineFor(_s); } catch (e) { logWarn("事件叫醒前失效时间线缓存失败: " + e.message); }   // 2026-11-12：原先 force 全量重载，改为只失效要叫的那几个会话
    const targets = [];
    for (const sid of subs) {
      const tl = getTimelineBySessionId(sid);
      if (!tl || !Array.isArray(tl.messages) || !tl.messages.length) { logWarn("订阅事件叫醒：会话不存在/已删，跳过: " + sid); continue; }
      targets.push({ sessionId: sid, messages: tl.messages, eventKey: key });
    }
    if (!targets.length) return { status: "nosub", reason: "订阅的会话都不存在" };
    console.log("[wake-scheduler] 订阅事件叫醒: " + key + " → " + targets.map(function (t) { return t.sessionId; }).join("、"));
    const results = await Promise.all(targets.map(function (t) {
      return runWakeForTarget(t).then(function (r) { return { sid: t.sessionId, r: r }; }, function (e) { logErr("订阅事件叫醒失败 " + t.sessionId + ": " + e.message); return { sid: t.sessionId, r: { status: "fail" } }; });
    }));
    const skipped = results.filter(function (x) { return x.r && x.r.status === "skip"; }).map(function (x) { return x.sid; });
    return { status: skipped.length ? "skip" : "ok", skipped: skipped, count: targets.length };
  }

  /* [位置:lib/wake-scheduler.js·describeNext] [「下一次叫醒是什么时候、为什么」只读视图] [10-28：手机桌面「距下次唤醒」倒计时原来靠解析日志里的「暂不需要唤醒」那一行，认不出闹钟/旧槽，没有锁定会话时数字停在旧值；改成后端直接说。口径与 nextWakeAtAcrossSessions 一致（2026-11-10 起闹钟与睡眠唤醒各管各的）：闹钟（工具闹钟/旧槽）和开了睡眠唤醒的会话的睡眠到点时刻都列出来、按时间排；没开睡眠唤醒的会话没有睡眠项。返回 locked（锁定会话数）、items（按时间排，最多 5 条：kind=alarm|slot|cycle、at、sid、name、label/thr）、next（第一条或 null）。订阅事件叫醒是即时的，不进这个视图] [注释时间 2026-10-28] */
  function describeNext() {
    const items = [];
    const locked = readWakeLockedSessions();
    try {
      const raw = JSON.parse(fs.readFileSync(WAKE_ALARMS_PATH, "utf-8"));
      for (const sid of Object.keys((raw && raw.sessions) || {})) {
        for (const a of (raw.sessions[sid].alarms || [])) {
          const t = new Date(a.at);
          if (isNaN(t.getTime())) continue;
          items.push({ kind: "alarm", at: t.toISOString(), sid: sid, name: getSessionDisplayName(sid), label: a.label || "", repeat: a.repeat || "once", by: a.by === "user" ? "user" : "ai" });
        }
      }
    } catch (e) { /* 没有闹钟文件按无闹钟 */ }
    try {
      const raw = readWakeScheduleRaw();
      for (const sid of Object.keys((raw && raw.sessions) || {})) {
        const e = raw.sessions[sid];
        const t = e && e.next_wake_at ? new Date(e.next_wake_at) : null;
        if (!t || isNaN(t.getTime())) continue;
        items.push({ kind: "slot", at: t.toISOString(), sid: sid, name: getSessionDisplayName(sid), keep: !!e.keep });
      }
    } catch (e) { /* 忽略 */ }
    for (const sid of (sleepCfg.read().enabled ? locked : [])) {
      try {
        const tl = getTimelineBySessionId(sid);
        if (!tl || !Array.isArray(tl.messages) || !tl.messages.length) continue;
        const cs = getSleepStart(sid, getLastUserTime(tl.messages));
        if (!cs) continue;
        const plan = getNormalWakePlan(cs);
        items.push({ kind: "cycle", at: plan.dueAt.toISOString(), sid: sid, name: getSessionDisplayName(sid), thr: plan.thresholdMinutes, segment: plan.segment });
      } catch (e) { /* 单个会话失败不影响其它 */ }
    }
    items.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    return { now: new Date().toISOString(), locked: locked.length, next: items[0] || null, items: items.slice(0, 5) };
  }

  function start() {
    armTimedWake();
    lastWakeScheduleFingerprint = fingerprintWakeFiles();
    setInterval(pollWakeFiles, 20_000);
    setTimeout(scheduleNextCheck, 10_000);
    console.log("[wake-scheduler] 唤醒调度器已在 gateway 内启动（wake-up 独立进程退役）");
  }

  return { start, runNow: runWakeUp, armTimedWake, fireEvent, describeNext, isBusy: function () { return wakeGate.runningCount() > 0; } };
};

// 单测入口（tests/unit/wake_receipt_fail_only.test.js）：仅暴露回执拼装这一个纯函数，业务调用照旧走 createWakeScheduler
module.exports.buildWakeReceipt = buildWakeReceipt;
