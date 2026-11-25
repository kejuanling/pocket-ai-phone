'use strict';
// 工具闹钟存储（2026-10-25，需求单 wake 工具）：AI 用 wake 工具给会话设多个定时唤醒，支持 daily 每天循环。
// 与旧 <wake> 标签的单槽（data/wake_schedule.json）并存互不干扰：旧槽逻辑一行不动，本文件只管 data/wake-alarms.json。
// 10-25 拍板：工具设的闹钟不受她发言影响（写死——本文件不提供任何「用户发言清除」入口；
// wake_schedule.clearSlotUnlessKeep 只动旧槽文件，天然碰不到这里）；取消一律走 delete/clear。
// 触发并入 lib/wake-scheduler.js 的 armTimedWake / runTimedWake（到点会话并进 dueSids，享受 explicitWake 语义与 wakeGate 排队）。
// 读写照 lib/wake-schedule.js：文件锁 + 锁内重读 + 带 pid 原子写 + 损坏拒写。
// 2026-10-26 触发链对齐（产品确定「工具与旧 <wake> 标签同优先级，周期兜底无条件让位」）：
//   - 新增 nextAlarmAtFor（该会话最早闹钟；2026-11-10 起调度器不再用它让位——闹钟与睡眠唤醒各管各的，保留供查询）；
//   - advanceDueAlarms 抽出 advanceSidLocked 收拢推进循环，新增 advanceDueAlarmsFor（按会话推进：
//     本会话唤醒成功即推进该会话到点闹钟，不再等整轮 ok——防多会话并发时已成功会话的 once 重复响、daily 多推）。

const fs = require("fs");
const path = require("path");

const FILE_PATH = path.join(__dirname, "..", "data", "wake-alarms.json");
const LOCK_PATH = FILE_PATH + ".lock";
const MAX_PER_SESSION = 10;

function withLock(fn, timeoutMs) {
  if (timeoutMs === undefined) timeoutMs = 2000;
  const start = Date.now();
  let fd = null;
  for (;;) {
    try { fd = fs.openSync(LOCK_PATH, "wx"); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (Date.now() - start > timeoutMs) {
        try { fs.unlinkSync(LOCK_PATH); } catch (e2) {}
        continue;
      }
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 10);
    }
  }
  try { return fn(); }
  finally {
    try { if (fd !== null) fs.closeSync(fd); } catch (e) {}
    try { fs.unlinkSync(LOCK_PATH); } catch (e) {}
  }
}
function readRawOrThrow() {
  if (!fs.existsSync(FILE_PATH)) return null;
  const data = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
  return (data && typeof data === "object") ? data : null;
}
function writeRawLocked(data) {
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  const tmp = FILE_PATH + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, FILE_PATH);
}
function alarmsOf(data, sid) {
  return (data && data.sessions && data.sessions[sid] && Array.isArray(data.sessions[sid].alarms)) ? data.sessions[sid].alarms : [];
}

// 设闹钟。opts: { at(ISO 或 Date), repeat("once"|"daily"|"weekly"|"interval"，默认 once), days(weekly 用: 0..6 数组), intervalMin(interval 用: 1..10080), quietStart/quietEnd(interval 可选免打扰 "HH:MM"), label, by("user"=她自己在手机里设；缺省=AI 设), note(附言，≤500 字，到点追加进唤醒提示词) }
// 2026-11-09：by=user 的闹钟享受「她到点前 N 分钟内发过言 → 这一轮不响」规则（见 skipDueUserAlarms），AI 设的不受影响。
const NOTE_MAX = 500;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;   // 北京时间 Asia/Shanghai（无夏令时）
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_REPEATS = new Set(["once", "daily", "weekly", "interval"]);

// 概率（2026-11-10）：只有她自己设的闹钟可带，1~99 的整数=到点时按这个百分比掷骰子；空/100/不合法=每次都响
function normProb(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  return (Number.isFinite(n) && n >= 1 && n <= 99) ? n : null;
}
function normDays(v) {
  let arr = v;
  if (typeof arr === "string") arr = arr.split(/[,，\s]+/).filter(Boolean);
  if (!Array.isArray(arr)) return null;
  const set = new Set();
  for (const x of arr) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 6) return null;
    set.add(n);
  }
  const out = Array.from(set).sort((a, b) => a - b);
  return out.length ? out : null;
}
function normIntervalMin(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Math.round(Number(v));
  return (Number.isFinite(n) && n >= 1 && n <= 10080) ? n : null;
}
function normHHMM(v) {
  if (v === undefined || v === null || v === "") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
}
function hhmmToMin(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function bjDayOfWeek(ms) {
  return new Date(ms + TZ_OFFSET_MS).getUTCDay();
}
// 如果 ms 落在北京时间免打扰区间 [quietStart, quietEnd) 内，顺延到 quietEnd 时刻
function adjustQuietMs(ms, quietStart, quietEnd) {
  const qs = hhmmToMin(quietStart), qe = hhmmToMin(quietEnd);
  if (qs === null || qe === null || qs === qe) return ms;
  const bj = new Date(ms + TZ_OFFSET_MS);
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  const baseUtcMs = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - TZ_OFFSET_MS;
  if (qs < qe) {
    if (mins >= qs && mins < qe) return baseUtcMs + qe * 60000;
  } else {
    if (mins >= qs) return baseUtcMs + DAY_MS + qe * 60000;
    if (mins < qe) return baseUtcMs + qe * 60000;
  }
  return ms;
}
// 对齐 weekly 初始时刻：从 atMs 起（含当天），找第一个命中 days 且 > now + 2000 的时刻
function alignWeeklyMs(atMs, days, now) {
  let nt = atMs;
  for (let i = 0; i < 8; i++) {
    if (nt > now + 2000 && days.includes(bjDayOfWeek(nt))) return nt;
    nt += DAY_MS;
  }
  return nt;
}
// 推进循环闹钟到下一次触发时刻（> now + grace）；once 返回 null
function nextOccurrenceMs(a, now, grace) {
  const t = new Date(a.at).getTime();
  if (!Number.isFinite(t)) return null;
  if (a.repeat === "daily") {
    let nt = t;
    if (nt <= now + grace) {
      const steps = Math.floor((now + grace - nt) / DAY_MS) + 1;
      nt += steps * DAY_MS;
    }
    return nt;
  }
  if (a.repeat === "weekly") {
    const days = normDays(a.days);
    if (!days) return null;
    let nt = t;
    if (nt <= now + grace) {
      const steps = Math.floor((now + grace - nt) / DAY_MS) + 1;
      nt += steps * DAY_MS;
    }
    for (let i = 0; i < 8; i++) {
      if (days.includes(bjDayOfWeek(nt))) return nt;
      nt += DAY_MS;
    }
    return nt;
  }
  if (a.repeat === "interval") {
    const iv = normIntervalMin(a.intervalMin);
    if (!iv) return null;
    const stepMs = iv * 60 * 1000;
    let nt = t;
    if (nt <= now + grace) {
      const steps = Math.floor((now + grace - nt) / stepMs) + 1;
      nt += steps * stepMs;
    }
    if (a.quietStart && a.quietEnd) {
      nt = adjustQuietMs(nt, a.quietStart, a.quietEnd);
    }
    return nt;
  }
  return null;
}

function setAlarm(sessionId, opts) {
  const sid = String(sessionId || "default").trim() || "default";
  const repeat = (opts && VALID_REPEATS.has(opts.repeat)) ? opts.repeat : "once";
  let days = null, intervalMin = null, quietStart = null, quietEnd = null;
  if (repeat === "weekly") {
    days = normDays(opts && opts.days);
    if (!days) return { ok: false, error: "按星期闹钟至少选一天（days: 0~6）" };
  }
  if (repeat === "interval") {
    intervalMin = normIntervalMin(opts && (opts.intervalMin !== undefined ? opts.intervalMin : opts.interval_min));
    if (!intervalMin) return { ok: false, error: "间隔循环需要合法的间隔分钟数（1~10080）" };
    const qsRaw = opts && (opts.quietStart !== undefined ? opts.quietStart : opts.quiet_start);
    const qeRaw = opts && (opts.quietEnd !== undefined ? opts.quietEnd : opts.quiet_end);
    if ((qsRaw !== undefined && qsRaw !== null && qsRaw !== "") || (qeRaw !== undefined && qeRaw !== null && qeRaw !== "")) {
      quietStart = normHHMM(qsRaw);
      quietEnd = normHHMM(qeRaw);
      if (!quietStart || !quietEnd) return { ok: false, error: "免打扰时段格式需为 HH:MM" };
      if (quietStart === quietEnd) { quietStart = null; quietEnd = null; }
    }
  }
  const now = Date.now();
  let atMs = (opts && opts.at !== undefined && opts.at !== null && opts.at !== "")
    ? new Date(opts.at).getTime()
    : (repeat === "interval" ? now + intervalMin * 60 * 1000 : NaN);
  if (!Number.isFinite(atMs)) return { ok: false, error: "at 不是合法时间" };
  if (repeat === "weekly") atMs = alignWeeklyMs(atMs, days, now);
  if (repeat === "interval" && quietStart && quietEnd) atMs = adjustQuietMs(atMs, quietStart, quietEnd);
  if (atMs <= now + 2000) return { ok: false, error: "闹钟时间已过去" };
  const label = String((opts && opts.label) || "").slice(0, 60);
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); }
    catch (e) { return { ok: false, error: "闹钟文件损坏，拒绝写回: " + e.message }; }
    if (!data || typeof data !== "object") data = {};
    const sessions = (data.sessions && typeof data.sessions === "object") ? data.sessions : {};
    const list = alarmsOf({ sessions: sessions }, sid);
    if (list.length >= MAX_PER_SESSION) {
      return { ok: false, error: "该会话闹钟已达上限 " + MAX_PER_SESSION + " 个，先用 delete/clear 腾位置" };
    }
    const alarm = { id: "wa_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date(atMs).toISOString(), repeat: repeat };
    if (days) alarm.days = days;
    if (intervalMin) alarm.intervalMin = intervalMin;
    if (quietStart && quietEnd) { alarm.quietStart = quietStart; alarm.quietEnd = quietEnd; }
    if (label) alarm.label = label;
    if (opts && opts.by === "user") alarm.by = "user";
    const note = String((opts && opts.note) || "").replace(/\r\n/g, "\n").trim().slice(0, NOTE_MAX);
    if (note) alarm.note = note;
    const prob = (opts && opts.by === "user") ? normProb(opts.prob) : null;
    if (prob) alarm.prob = prob;
    list.push(alarm);
    sessions[sid] = { alarms: list };
    data.version = 1;
    data.sessions = sessions;
    writeRawLocked(data);
    return { ok: true, alarm_id: alarm.id, alarm: alarm };
  });
}

// 编辑她自己设的闹钟（by=user）：可改 at / repeat / days / intervalMin / quietStart / quietEnd / note / prob。AI 设的闹钟归 AI 管，这里不让改。
function updateAlarm(sessionId, alarmId, patch) {
  const sid = String(sessionId || "default").trim() || "default";
  const id = String(alarmId || "").trim();
  if (!id) return { ok: false, error: "缺少 alarm_id" };
  const p = (patch && typeof patch === "object") ? patch : {};
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); } catch (e) { return { ok: false, error: "闹钟文件损坏，拒绝写回: " + e.message }; }
    const list = alarmsOf(data, sid);
    const a = list.find(function (x) { return x.id === id; });
    if (!a) return { ok: false, error: "找不到闹钟 " + id };
    if (a.by !== "user") return { ok: false, error: "这个闹钟是他自己设的，不能在这里改" };
    const nextRepeat = (p.repeat !== undefined) ? (VALID_REPEATS.has(p.repeat) ? p.repeat : "once") : (a.repeat || "once");
    let nextDays = nextRepeat === "weekly" ? (p.days !== undefined ? normDays(p.days) : normDays(a.days)) : null;
    if (nextRepeat === "weekly" && !nextDays) return { ok: false, error: "按星期闹钟至少选一天（days: 0~6）" };
    let nextIv = nextRepeat === "interval"
      ? ((p.intervalMin !== undefined || p.interval_min !== undefined) ? normIntervalMin(p.intervalMin !== undefined ? p.intervalMin : p.interval_min) : normIntervalMin(a.intervalMin))
      : null;
    if (nextRepeat === "interval" && !nextIv) return { ok: false, error: "间隔循环需要合法的间隔分钟数（1~10080）" };
    let nextQs = null, nextQe = null;
    if (nextRepeat === "interval") {
      const hasQs = ("quietStart" in p) || ("quiet_start" in p);
      const hasQe = ("quietEnd" in p) || ("quiet_end" in p);
      const qsRaw = hasQs ? (p.quietStart !== undefined ? p.quietStart : p.quiet_start) : a.quietStart;
      const qeRaw = hasQe ? (p.quietEnd !== undefined ? p.quietEnd : p.quiet_end) : a.quietEnd;
      if ((qsRaw !== undefined && qsRaw !== null && qsRaw !== "") || (qeRaw !== undefined && qeRaw !== null && qeRaw !== "")) {
        nextQs = normHHMM(qsRaw);
        nextQe = normHHMM(qeRaw);
        if (!nextQs || !nextQe) return { ok: false, error: "免打扰时段格式需为 HH:MM" };
        if (nextQs === nextQe) { nextQs = null; nextQe = null; }
      }
    }
    const now = Date.now();
    let atMs = (p.at !== undefined) ? new Date(p.at).getTime() : new Date(a.at).getTime();
    if (!Number.isFinite(atMs)) return { ok: false, error: "at 不是合法时间" };
    if (nextRepeat === "weekly") atMs = alignWeeklyMs(atMs, nextDays, now);
    if (nextRepeat === "interval" && nextQs && nextQe) atMs = adjustQuietMs(atMs, nextQs, nextQe);
    if (p.at !== undefined || p.repeat !== undefined || p.days !== undefined || p.intervalMin !== undefined || p.quietStart !== undefined || p.quietEnd !== undefined) {
      if (atMs <= now + 2000) return { ok: false, error: "闹钟时间已过去" };
      a.at = new Date(atMs).toISOString();
    }
    a.repeat = nextRepeat;
    if (nextDays) a.days = nextDays; else delete a.days;
    if (nextIv) a.intervalMin = nextIv; else delete a.intervalMin;
    if (nextQs && nextQe) { a.quietStart = nextQs; a.quietEnd = nextQe; } else { delete a.quietStart; delete a.quietEnd; }
    if (p.note !== undefined) {
      const note = String(p.note || "").replace(/\r\n/g, "\n").trim().slice(0, NOTE_MAX);
      if (note) a.note = note; else delete a.note;
    }
    if (p.prob !== undefined) {
      const prob = normProb(p.prob);
      if (prob) a.prob = prob; else delete a.prob;
    }
    if (p.at !== undefined || p.prob !== undefined || p.repeat !== undefined) delete a.rolled;   // 改了时间/概率/类型，之前掷过的结果作废，到点重新掷
    writeRawLocked(data);
    return { ok: true, alarm: a };
  });
}

// 她到点前刚聊过 → 本会话到点的「她自己设的」闹钟这一轮不响：循环类推到下一次，once 作废。
// 只动 by=user 且已到点的；AI 设的闹钟（她发言不影响，10-25 拍板）一概不碰。返回跳过的个数。
function skipDueUserAlarms(sessionId, graceMs) {
  const sid = String(sessionId || "default").trim() || "default";
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const now = Date.now();
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); } catch (e) { return 0; }
    if (!data || !data.sessions || !data.sessions[sid]) return 0;
    const kept = [];
    let n = 0;
    for (const a of alarmsOf(data, sid)) {
      const t = new Date(a.at).getTime();
      if (a.by !== "user" || !Number.isFinite(t) || t > now + grace) { kept.push(a); continue; }
      n++;
      const nt = nextOccurrenceMs(a, now, grace);
      if (nt !== null) {
        a.at = new Date(nt).toISOString();
        delete a.rolled;
        kept.push(a);
      }
    }
    if (!n) return 0;
    if (kept.length) data.sessions[sid].alarms = kept; else delete data.sessions[sid];
    writeRawLocked(data);
    return n;
  });
}

// 概率闹钟到点掷骰子（只管她自己设的、带 prob 的、已到点且这一轮还没掷过的）：
//   命中 → 记 rolled=本轮到点时刻，照常响（排队重试时不再重掷）；没中 → 循环类推到下一次、once 作废。
// rand 可注入（测试用），默认 Math.random()*100。返回 { missed, hit }。
function rollDueUserAlarms(sessionId, graceMs, rand) {
  const sid = String(sessionId || "default").trim() || "default";
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const roll = (typeof rand === "function") ? rand : function () { return Math.random() * 100; };
  const now = Date.now();
  return withLock(function () {
    const res = { missed: 0, hit: 0 };
    let data;
    try { data = readRawOrThrow(); } catch (e) { return res; }
    if (!data || !data.sessions || !data.sessions[sid]) return res;
    const kept = [];
    let dirty = false;
    for (const a of alarmsOf(data, sid)) {
      const t = new Date(a.at).getTime();
      const prob = normProb(a.prob);
      if (a.by !== "user" || !prob || !Number.isFinite(t) || t > now + grace || a.rolled === a.at) { kept.push(a); continue; }
      dirty = true;
      if (roll() < prob) { a.rolled = a.at; res.hit++; kept.push(a); continue; }
      res.missed++;
      const nt = nextOccurrenceMs(a, now, grace);
      if (nt !== null) {
        a.at = new Date(nt).toISOString();
        delete a.rolled;
        kept.push(a);
      }
    }
    if (!dirty) return res;
    if (kept.length) data.sessions[sid].alarms = kept; else delete data.sessions[sid];
    writeRawLocked(data);
    return res;
  });
}

function listAlarms(sessionId) {
  const sid = String(sessionId || "default").trim() || "default";
  try { return alarmsOf(readRawOrThrow(), sid).slice(); } catch (e) { return []; }
}

function deleteAlarm(sessionId, alarmId) {
  const sid = String(sessionId || "default").trim() || "default";
  const id = String(alarmId || "").trim();
  if (!id) return { ok: false, error: "缺少 alarm_id" };
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); } catch (e) { return { ok: false, error: "闹钟文件损坏，拒绝写回: " + e.message }; }
    if (!data || !data.sessions || !data.sessions[sid]) return { ok: false, error: "该会话没有闹钟" };
    const list = alarmsOf(data, sid);
    const i = list.findIndex(function (a) { return a.id === id; });
    if (i < 0) return { ok: false, error: "找不到闹钟 " + id + "（用 list 核对 id）" };
    list.splice(i, 1);
    if (list.length) data.sessions[sid].alarms = list;
    else delete data.sessions[sid];
    writeRawLocked(data);
    return { ok: true, removed: id };
  });
}

function clearAlarms(sessionId) {
  const sid = String(sessionId || "default").trim() || "default";
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); } catch (e) { return { ok: false, error: "闹钟文件损坏，拒绝写回: " + e.message }; }
    if (!data || !data.sessions || !data.sessions[sid]) return { ok: true, removed: 0 };
    const n = data.sessions[sid].alarms ? data.sessions[sid].alarms.length : 0;
    delete data.sessions[sid];
    writeRawLocked(data);
    return { ok: true, removed: n };
  });
}

// 最早的一个到点时刻（armTimedWake 并进候选）
function nextAlarmAt() {
  try {
    const data = readRawOrThrow();
    if (!data || !data.sessions) return null;
    let min = null;
    for (const sid of Object.keys(data.sessions)) {
      for (const a of alarmsOf(data, sid)) {
        const t = new Date(a.at).getTime();
        if (Number.isFinite(t) && (min === null || t < min)) min = t;
      }
    }
    return min === null ? null : new Date(min);
  } catch (e) { return null; }
}

// 该会话最早的闹钟时刻（2026-10-26 加，当时给调度器做「工具闹钟在场 → 普通周期让位」；2026-11-10 产品确定各管各的、不再让位，保留作查询）。
// 不分到没到点（到点的由 dueAlarmSids 负责触发）。
function nextAlarmAtFor(sessionId) {
  const sid = String(sessionId || "default").trim() || "default";
  try {
    const list = alarmsOf(readRawOrThrow(), sid);
    let min = null;
    for (const a of list) {
      const t = new Date(a.at).getTime();
      if (Number.isFinite(t) && (min === null || t < min)) min = t;
    }
    return min === null ? null : new Date(min);
  } catch (e) { return null; }
}

// 已到点（<= now + grace）的会话 id 列表（runTimedWake 并进 dueSids）
function dueAlarmSids(graceMs) {
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const now = Date.now();
  const out = [];
  try {
    const data = readRawOrThrow();
    if (!data || !data.sessions) return out;
    for (const sid of Object.keys(data.sessions)) {
      for (const a of alarmsOf(data, sid)) {
        const t = new Date(a.at).getTime();
        if (Number.isFinite(t) && t <= now + grace) { out.push(sid); break; }
      }
    }
    return out;
  } catch (e) { return out; }
}

// 推进单个会话的到点闹钟（2026-10-26 从 advanceDueAlarms 抽出收拢；调用方必须已持锁）。
// once 删除、daily / weekly / interval 按规则推到未来（Asia/Shanghai 无夏令时）。
// 返回计数；data.sessions[sid] 不存在时由调用方保证（ alarmsOf 返回空列表 → 循环零次 → delete sessions[sid] 无害）。
function advanceSidLocked(data, sid, grace, now) {
  const list = alarmsOf(data, sid);
  const kept = [];
  let onceRemoved = 0, dailyAdvanced = 0;
  for (const a of list) {
    const t = new Date(a.at).getTime();
    if (!Number.isFinite(t) || t > now + grace) { kept.push(a); continue; }
    const nt = nextOccurrenceMs(a, now, grace);
    if (nt !== null) {
      a.at = new Date(nt).toISOString();
      delete a.rolled;
      dailyAdvanced++; kept.push(a);
    } else {
      onceRemoved++;   // once 到点即删（补触发成功路径）
    }
  }
  if (kept.length) data.sessions[sid].alarms = kept;
  else delete data.sessions[sid];
  return { once_removed: onceRemoved, daily_advanced: dailyAdvanced };
}

// 到点收尾（整轮）：once 删除、daily 推到未来。
// 只在唤醒真正执行成功（runWakeUp 返回 "ok"）后调用——失败/partial 保留到点状态，下一轮重试，与旧槽三态语义一致。
// 2026-10-26 保留作按会话推进（advanceDueAlarmsFor）之外的双保险，幂等无害。
function advanceDueAlarms(graceMs) {
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const now = Date.now();
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); } catch (e) { return { ok: false, error: e.message }; }
    if (!data || !data.sessions) return { ok: false };
    let onceRemoved = 0, dailyAdvanced = 0, changed = false;
    for (const sid of Object.keys(data.sessions)) {
      const r = advanceSidLocked(data, sid, grace, now);
      onceRemoved += r.once_removed;
      dailyAdvanced += r.daily_advanced;
      if (r.once_removed || r.daily_advanced) changed = true;
    }
    if (changed) writeRawLocked(data);
    return { ok: true, once_removed: onceRemoved, daily_advanced: dailyAdvanced };
  });
}

// 按会话推进到点闹钟（2026-10-26 加，对齐旧槽 R3「LLM 成功即清该会话槽位」的按会话粒度）：
// 该会话唤醒成功后由 wake-scheduler 调用——once 删、daily 推到未来；其他会话的闹钟一概不动。
// 修复：此前只有整轮 ok 才推进，多会话并发时别的会话失败（partial/failed）会让已成功会话
// 的到点闹钟不推进 → 下轮重复响。只动到点的（t <= now + grace），未到点/无闹钟即空操作，无条件调用安全幂等。
function advanceDueAlarmsFor(sessionId, graceMs) {
  const sid = String(sessionId || "default").trim() || "default";
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const now = Date.now();
  return withLock(function () {
    let data;
    try { data = readRawOrThrow(); } catch (e) { return { ok: false, error: e.message }; }
    if (!data || !data.sessions || !data.sessions[sid]) return { ok: true, once_removed: 0, daily_advanced: 0 };
    const r = advanceSidLocked(data, sid, grace, now);
    if (r.once_removed || r.daily_advanced) writeRawLocked(data);
    return Object.assign({ ok: true }, r);
  });
}

/* [位置:lib/wake-alarms.js·dueAlarmsWithLabel] [到点闹钟label查询] [2026-10-31：AI 设闹钟本来就带 label（setAlarm 落库），但唤醒触发时没读——醒来不知道这次是谁叫的。给 wake-scheduler 组装唤醒内容用：返回本会话到点（t <= now + grace，口径同 dueAlarmSids）且带 label 的闹钟快照（id/label/at/repeat），只读不动存储；推进仍由 advanceDueAlarmsFor 在唤醒成功后做，此处不提前消费。无 label 闹钟不返回（产品确定：无 label 不加字，避免每次工具闹钟都多一句废话）。2026-11-01 复核：due 集合本身就是触发集合（逾期闹钟仍会触发唤醒），label 与本次唤醒一致，故不加“陈旧”过滤（过滤反而会漏掉真正由旧闹钟触发的唤醒）] [注释时间 2026-10-31；2026-11-01 复核] */
function dueAlarmsWithLabel(sessionId, graceMs) {
  const sid = String(sessionId || "default").trim() || "default";
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const now = Date.now();
  const out = [];
  try {
    const list = alarmsOf(readRawOrThrow(), sid);
    for (const a of list) {
      const t = new Date(a.at).getTime();
      if (Number.isFinite(t) && t <= now + grace && a.label) {
        out.push({ id: a.id, label: a.label, at: a.at, repeat: a.repeat || "once" });
      }
    }
  } catch (e) { /* 读失败按无闹钟处理，不挡唤醒 */ }
  return out;
}

// 唤醒提示词末尾要带的「这次是谁叫的」：本会话所有到点闹钟（含没 label 的她自己设的）的 by/label/note 快照；只读不动存储
function dueAlarmsForTail(sessionId, graceMs) {
  const sid = String(sessionId || "default").trim() || "default";
  const grace = (graceMs === undefined) ? 2000 : graceMs;
  const now = Date.now();
  const out = [];
  try {
    for (const a of alarmsOf(readRawOrThrow(), sid)) {
      const t = new Date(a.at).getTime();
      if (Number.isFinite(t) && t <= now + grace) out.push({ id: a.id, by: a.by === "user" ? "user" : "ai", label: a.label || "", note: a.note || "", at: a.at, repeat: a.repeat || "once" });
    }
  } catch (e) { /* 读失败按无闹钟处理，不挡唤醒 */ }
  return out;
}

module.exports = { setAlarm, updateAlarm, skipDueUserAlarms, rollDueUserAlarms, listAlarms, deleteAlarm, clearAlarms, nextAlarmAt, nextAlarmAtFor, dueAlarmSids, advanceDueAlarms, advanceDueAlarmsFor, dueAlarmsWithLabel, dueAlarmsForTail, NOTE_MAX };
