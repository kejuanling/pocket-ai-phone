'use strict';
// wake-subs.js —— 唤醒订阅（10-23 第 9 条；2026-11-03 清掉旧的「问 AI」逻辑）：
//   叫不叫只看用户在小手机「唤醒设置」里的单边开关：某一项没关，所有锁定唤醒的会话就都会被叫醒；
//   不再问 AI、也不再解析 AI 回复里的 <active> 标签（标签只在前端/服务端 strip 里照旧剥掉，不显示）。
//   数据：data/wake-subs.json = { off: { <key>: true }, sessions: {...} }
//     off      = 她在手机里关掉的项（全局，关一项只停那一项，再打开恢复）；
//     sessions = 旧版 AI 自选的记录，不再读也不再写，数据留着不删。
//   只有锁定唤醒的会话（data 下 locked 列表）才会收到事件叫醒。
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const FILE = path.join(BASE, 'data', 'wake-subs.json');
const LOCKED = path.join(BASE, 'data', 'wake-locked.json');
const EVSESS = path.join(BASE, 'data', 'wake-event-sessions.json');   // 11-04：开了「事件唤醒」的会话（和「定时唤醒=锁定」分开，各管各的）

// 已接好的活动（位置、停留 app 还没接，接好后在这里加一行）
const ITEMS = [
  { key: 'her_murmurs', name: '碎碎念', phrase: '发碎碎念', event: '更新了碎碎念' },
  { key: 'period', name: '经期', phrase: '更新经期状态', event: '更新了经期状态' },
  { key: 'mood', name: '心情', phrase: '记录当天心情', event: '记录了今天的心情' },
  { key: 'album', name: '相册', phrase: '上传相册', event: '上传了相册图片' },
];
/* [位置:lib/wake-subs.js·ITEMS sleep/wakeup] [11-04：按手机 App 记录猜她睡着/醒来（lib/sleep-detect.js），两个点各叫醒一次；提示词不下定论，只写「好像」] [注释时间 2026-11-04] */
/* 11-04：睡着和醒来合并成一个「睡眠」开关（key=sleep 管开关；醒来事件 wakeup 没有自己的开关，跟 sleep 走）；位置变了（lib/location-detect.js，1 小时内最多叫一次） */
ITEMS.push({ key: 'location', name: '位置', phrase: '位置变了', event: '', text: '这次是因为她的位置好像变了。' });
/* 2026-11-09：睡眠/醒来不再是「事件唤醒」——不再看手机 App，改成「睡眠唤醒」（聊天停满 N 分钟叫一次，见 lib/sleep-wake-config.js 与 wake-scheduler 的睡眠判定）；醒来 = 她自己设每天固定时间的闹钟。这里的 sleep/wakeup 两项随之删除。 */
const EXTRA = {};   // 没有自己开关的事件：开关跟 sw 走（目前没有）
const KEYS = ITEMS.map(function (x) { return x.key; }).concat(Object.keys(EXTRA));

function read() {
  try {
    const o = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { off: (o && o.off && typeof o.off === 'object') ? o.off : {}, sessions: (o && o.sessions && typeof o.sessions === 'object') ? o.sessions : {} };
  } catch (e) { return { off: {}, sessions: {} }; }
}
function write(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 1));
  fs.renameSync(tmp, FILE);
}
function lockedList() {
  try { const v = JSON.parse(fs.readFileSync(LOCKED, 'utf8')); return Array.isArray(v) ? v.filter(function (s) { return typeof s === 'string' && s; }) : []; } catch (e) { return []; }
}
function isLocked(sid) { return !!sid && lockedList().indexOf(String(sid)) >= 0; }

// 手机设置页用：每一项 + 现在开没开（她的总开关）
function settings() {
  const d = read();
  return ITEMS.map(function (x) { return { key: x.key, name: x.name, on: !d.off[x.key] }; });
}
function setSwitch(key, on) {
  if (!ITEMS.some(function (x) { return x.key === key; })) return { ok: false, error: '没有这一项' };
  const d = read();
  if (on) delete d.off[key]; else d.off[key] = true;
  write(d);
  return { ok: true, key: key, on: !!on };
}

/* [位置:lib/wake-subs.js·subscribers] [事件叫醒的收件会话] [11-02：去掉「AI 自己确认订阅」这一步，只剩用户的单边开关——这一项她没关，所有锁定唤醒的会话就都会被叫醒；原来还要求会话里 AI 用 <active> 回过 yes，现在不看 sessions 里 AI 的选择（数据留着不再生效，<active> 标签仍可解析但不影响叫不叫）] [注释时间 2026-11-02] */
/* 11-04：定时唤醒和事件唤醒分开——长按菜单里各有一项：「定时唤醒」=锁定（只管按间隔自动叫），「事件唤醒」=这里（只管她有动静/睡着/醒来时叫）。首次没有这个文件时，沿用当时锁定的会话（保持原来行为），之后各自独立。 */
function eventSessions() {
  try { const v = JSON.parse(fs.readFileSync(EVSESS, 'utf8')); return Array.isArray(v) ? v.filter(function (s) { return typeof s === 'string' && s; }) : []; }
  catch (e) { const seed = lockedList(); try { fs.mkdirSync(path.dirname(EVSESS), { recursive: true }); fs.writeFileSync(EVSESS, JSON.stringify(seed)); } catch (e2) { /* 写不了就当临时 */ } return seed; }
}
function subscribers(key) {
  const d = read();
  if (d.off[EXTRA[key] ? EXTRA[key].sw : key]) return [];
  return eventSessions();
}
function eventText(key) { if (EXTRA[key]) return EXTRA[key].text; const it = ITEMS.filter(function (x) { return x.key === key; })[0]; if (!it) return ''; return it.text ? it.text : '这次是因为她刚刚' + it.event + '。'; }

/* 2026-11-09 一次性迁移（网关启动时调用，flag 文件保证只跑一次）：「定时唤醒」(锁定名单) 复用成「睡眠唤醒」，
   原来开了「事件唤醒」的会话靠『睡着/醒来』事件享受过睡眠这一推——事件唤醒里这两项已删，把这些会话并进睡眠唤醒名单，行为不丢。
   放在启动时而不是现在直接改：旧代码还在跑时先写锁定名单，会让旧的白天/夜间周期立刻去叫它。 */
/* 2026-11-10 产品确定：睡眠唤醒并入事件唤醒，菜单只剩「事件唤醒」一项。启动时一次性把旧「睡眠唤醒」名单（wake-locked.json）并进事件名单，
   之后睡眠唤醒读事件名单，wake-locked.json 留着不再读。flag 保证只跑一次；比 11-09 那次迁移的 flag 另起一个。 */
const MERGED_FLAG = path.join(BASE, 'data', 'sleep-into-event.flag');
function migrateSleepIntoEvent() {
  try {
    if (fs.existsSync(MERGED_FLAG)) return { skipped: true };
    const merged = Array.from(new Set(eventSessions().concat(lockedList())));
    fs.mkdirSync(path.dirname(EVSESS), { recursive: true });
    const tmp = EVSESS + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(merged));
    fs.renameSync(tmp, EVSESS);
    fs.writeFileSync(MERGED_FLAG, new Date().toISOString());
    return { migrated: merged };
  } catch (e) { return { error: e.message }; }
}

module.exports = { ITEMS, KEYS, isLocked, settings, setSwitch, subscribers, eventText, eventSessions, EVSESS, migrateSleepIntoEvent };
