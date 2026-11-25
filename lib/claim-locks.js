'use strict';
// claim-locks.js —— 会话文件占用登记（AI 在回复里用 <claim> 标签声明要改哪些文件）。
// [位置:lib/claim-locks.js] [会话开工占坑 + 冲突检测] [10-31：多会话并行改同一仓库互相覆盖（当晚真实撞过：提交互卷、改动错归属）。
//   约定：开工改代码前 <claim>server.js、phone-pages.js</claim> 登记（10-31 二次拍板：只写文件名，动作不写；写了动作词也认，容错）（同会话重复写=覆盖清单，不用先清）；
//   完成写 <claim clear>，或会话状态标「已完成」（session-meta.applyStatus 里自动清）。
//   软提醒不拦工具：后登记的会话与在册的有交集 → data/claim-alerts.json 记告警（前端横幅轮询拉取）+ WebPush 浏览器通知，
//   由用户裁决暂停哪个会话。占用超 24h 自动清（2026-10-31 晚三次拍板，防忘退坑的登记永久占道）；
//   2026-11-07：过期改 3h——tool_ 登记常有人忘退坑，用户侧又没有清除入口，24h 挂太久，3h 自动让道。
//   2026-11-01（横幅一直在弹）：告警加两道闸——①点了「知道了」当天不再提醒（新告警+WebPush 都静默，跨天自动恢复）；
//   ②同会话 24h 内撞同一批文件只记一条。机制不动：仍按 data/claim-alerts.json 未读记录弹横幅。 [注释时间 2026-10-31；2026-11-01 加静默闸]

const fs = require('fs');
const path = require('path');

const LOCK_FILE = path.join(__dirname, '..', 'data', 'claim-locks.json');
const ALERT_FILE = path.join(__dirname, '..', 'data', 'claim-alerts.json');
const NAMES_FILE = path.join(__dirname, '..', 'data', 'session-names.json');
const ACK_DAY_FILE = path.join(__dirname, '..', 'data', 'claim-ack-day.json');
const ALERT_MAX = 20;

function readJson(file, fallback) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf-8')); return (j && typeof j === 'object') ? j : fallback; }
  catch (e) { return fallback; }
}
function writeJson(file, o) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

const ACTION_RE = /^(增|加|新增|新加|写入|写|改|编辑|修改|更新|删|删除|移除|add|create|write|edit|modify|update|del|delete|remove)$/i;
function normAction(a) {
  a = String(a || '').toLowerCase();
  if (/^(增|加|新增|新加|add|create)/.test(a)) return '增';
  if (/^(写入|写|write)/.test(a)) return '写';
  if (/^(删|删除|移除|del|delete|remove)/.test(a)) return '删';
  return '改';
}
// 清单文本 → [{path, action}]：顿号/逗号/分号/换行分段；动作词不要求写（10-31 产品确定只写文件名，缺省一律「改」），写了也容错识别；段内再按空格拆 token——
// 「编辑 server.js、写入 phone-pages.js」「a.js, b.css」「server.js:编辑 phone.py 增 new.js」「编辑 a.js b.js」都行；
// 动作词（增/写/改/删…）作用到其后紧跟的文件并延续，文件:动作 冒号写法也认。混进标签/引号的脏段丢弃。
function parseList(raw) {
  const out = [];
  String(raw || '').split(/[、,，;；\n]+/).forEach(function (seg) {
    let lastAct = '';
    seg.trim().split(/\s+/).forEach(function (tok0) {
      const tok = tok0.replace(/^[\[({<「『"']+|[\])}>」』"'.]+$/g, '');
      if (!tok) return;
      const m = tok.match(/^(\S+?)[:：=](\S+)$/);            // 文件:动作 / 文件=动作
      if (m && !ACTION_RE.test(m[1])) {
        const pp = m[1].replace(/^~?\.\//, '').trim();
        if (pp && !/[<>"']/.test(pp) && !/\s/.test(pp)) out.push({ path: pp.slice(0, 120), action: normAction(m[2]) });
        return;
      }
      if (ACTION_RE.test(tok)) { lastAct = normAction(tok); return; }   // 动作词：作用到后面的文件并延续
      const p = tok.replace(/^~?\.\//, '').trim();
      if (!p || /[<>"']/.test(p) || /\s/.test(p)) return;
      out.push({ path: p.slice(0, 120), action: lastAct || '改' });
    });
  });
  // 同文件重复保留第一个
  const seen = {};
  return out.filter(function (x) { const k = x.path.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 30);
}

const EXPIRE_MS = 3 * 3600 * 1000;   // 占用登记超 3h 自动清（10-31 拍板自动过期；11-07 改 24h→3h：tool_ 登记常忘退坑，别占道一整天）
// 过期清理：ts 距今 >3h 的登记删掉。挂在所有读写入口前，任一侧（标签/工具）进来都先清
function pruneExpired() {
  const db = lockMap();
  const now = Date.now();
  let n = 0;
  Object.keys(db).forEach(function (sid) {
    const rec = db[sid];
    if (rec && rec.ts && now - rec.ts > EXPIRE_MS) { delete db[sid]; n++; }
  });
  if (n) { writeJson(LOCK_FILE, db); console.log("[claim-locks] 自动清 " + n + " 条超过 3 小时的占用登记"); }
  return n;
}

function lockMap() { const j = readJson(LOCK_FILE, {}); return (j && !Array.isArray(j)) ? j : {}; }
function alertDb() { const j = readJson(ALERT_FILE, { list: [] }); return (j && Array.isArray(j.list)) ? j : { list: [] }; }
function baseName(p) { return String(p || '').split('/').pop().toLowerCase(); }

// [位置:lib/claim-locks.js·todayStr/ackedToday/markAckedToday] [当天已确认口径] [11-01：拍板「点了知道了，当天最多提醒一轮」——
//    ackAlert 清掉未读时把当天日期写进 data/claim-ack-day.json；pushAlert 看到当天已确认就整条静默（告警不落盘、WebPush 不发），
//    跨天 day 对不上自动恢复提醒；落盘所以重启不丢] [注释时间 2026-11-01]
function todayStr() {
  const d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function ackedToday() {
  const j = readJson(ACK_DAY_FILE, {});
  return !!(j && j.day === todayStr());
}
function markAckedToday() {
  writeJson(ACK_DAY_FILE, { day: todayStr(), ts: Date.now() });
}

// 登记（同 sid 重复=覆盖）。冲突按 basename 比（宽松宁可多报：AI 写相对/绝对路径常不一致）。
// 返回 { ok, count?, conflicts?, reason? }
function claim(sid, raw, nameHint) {
  pruneExpired();
  const items = parseList(raw);
  if (!sid || !items.length) return { ok: false, reason: 'empty' };
  const db = lockMap();
  let name = String(nameHint || '').trim();
  if (!name) { const names = readJson(NAMES_FILE, {}); name = String(names[sid] || ''); }
  db[sid] = { name: name.slice(0, 30), files: items, ts: Date.now() };
  writeJson(LOCK_FILE, db);
  const conflicts = [], seen = {};
  Object.keys(db).forEach(function (other) {
    if (other === sid) return;
    (db[other].files || []).forEach(function (of) {
      items.forEach(function (mf) {
        if (baseName(mf.path) !== baseName(of.path)) return;
        const key = mf.path + '|' + other;
        if (seen[key]) return;
        seen[key] = 1;
        conflicts.push({ file: mf.path, action: mf.action, other_sid: other, other_name: db[other].name || other, other_action: of.action, other_ts: db[other].ts });
      });
    });
  });
  if (conflicts.length) pushAlert(sid, name, conflicts);
  console.log("[claim-locks] 登记 sid=" + sid + " 文件x" + items.length + (conflicts.length ? " 冲突x" + conflicts.length : ""));
  return { ok: true, count: items.length, conflicts: conflicts };
}

function clear(sid) {
  pruneExpired();
  if (!sid) return { ok: false, reason: 'empty' };
  const db = lockMap();
  if (!db[sid]) return { ok: true, reason: 'none' };
  delete db[sid];
  writeJson(LOCK_FILE, db);
  console.log("[claim-locks] 清占用 sid=" + sid);
  return { ok: true };
}
// 会话状态变「已完成」时顺带清坑（lib/session-meta.applyStatus 调）
function clearIfDone(sid, status) {
  if (status === '已完成') return clear(sid);
  return { ok: false, reason: 'not-done' };
}

function pushAlert(sid, name, conflicts) {
  // [位置:lib/claim-locks.js·pushAlert 静默闸] [撞车提醒去重+当天静默] [11-01：横幅一直弹的根子是每次撞车都新增一条未读、点了知道了马上又有新的；
  //    ①当天已确认过（ackAlert 清过未读）→ 整条静默：告警不落盘、WebPush 不发，只留日志；
  //    ②24h 内同会话已提醒过且冲突文件 basename 有交集（同会话反复写 <claim> 同一批文件）→ 不再新增。记录机制与前端轮询口径不变] [注释时间 2026-11-01]
  try {
    if (ackedToday()) { console.log("[claim-locks] 当天已确认过撞车提醒，静默本次 sid=" + sid); return; }
    const bases = {};
    conflicts.forEach(function (c) { bases[baseName(c.file)] = 1; });
    const now = Date.now();
    const dup = alertDb().list.some(function (a) {
      if (a.sid !== sid || now - (a.ts || 0) > 24 * 3600 * 1000) return false;
      return (a.conflicts || []).some(function (c) { return bases[baseName(c.file)]; });
    });
    if (dup) { console.log("[claim-locks] 24h 内同会话同文件已提醒过，不重复记 sid=" + sid); return; }
    const db = alertDb();
    db.list.unshift({
      id: 'ca_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      sid: sid,
      name: String(name || '').slice(0, 30),
      conflicts: conflicts.slice(0, 8).map(function (c) { return { file: c.file, action: c.action, other_name: c.other_name, other_action: c.other_action }; }),
      read: false
    });
    db.list = db.list.slice(0, ALERT_MAX);
    writeJson(ALERT_FILE, db);
  } catch (e) { console.warn("[claim-locks] 告警落盘失败:", e.message); }
  // 浏览器通知（WebPush 全局广播，订阅不分会话；无订阅/依赖缺失静默，不影响主流程）
  try {
    const wp = require('./webpush');
    const files = conflicts.map(function (c) { return c.file; }).slice(0, 3).join('、');
    const txt = '会话「' + (name || sid) + '」要改 ' + files + (conflicts.length > 3 ? ' 等' : '') + '，跟其他会话占用撞了，去暂停一个';
    wp.sendToSession({ title: '文件占用冲突', body: txt, sessionId: sid }).catch(function () {});
  } catch (e) { /* 静默 */ }
}

// 前端横幅轮询：未读告警
function pendingAlerts() { pruneExpired(); return alertDb().list.filter(function (a) { return !a.read; }); }
function ackAlert(id) {
  const db = alertDb();
  let n = 0;
  db.list.forEach(function (a) { if (!id || a.id === id) { if (!a.read) { a.read = true; n++; } } });
  if (n) {
    writeJson(ALERT_FILE, db);
    // [位置:lib/claim-locks.js·ackAlert 记当天] [当天静默起点] [11-01：真的清掉了未读才算「今天确认过」，之后到今天结束不再弹新告警；一条都没清（n=0）不算] [注释时间 2026-11-01]
    markAckedToday();
  }
  return { ok: true, acked: n };
}

// 当前占用查询（GET /admin/claim-locks：用户/AI 看现在谁占了哪些文件）
function currentLocks() { pruneExpired(); return lockMap(); }

// 单会话占用查询（GET /admin/claim-locks?session_id=：聊天页「正在改的文件」浮球只关心本会话，没有就返回 null）
// [位置:lib/claim-locks.js·lockOf] [本会话占用] [11-06：浮球面板按会话隔离，前端只拿自己那条，不再从全量里挑] [注释时间 2026-11-06]
function lockOf(sid) { pruneExpired(); const db = lockMap(); return (sid && db[sid]) ? db[sid] : null; }

module.exports = { claim, clear, clearIfDone, parseList, normAction, pendingAlerts, ackAlert, currentLocks, lockOf, pruneExpired, ackedToday, markAckedToday, _files: { LOCK_FILE: LOCK_FILE, ALERT_FILE: ALERT_FILE, ACK_DAY_FILE: ACK_DAY_FILE } };
