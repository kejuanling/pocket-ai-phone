'use strict';
// routes/session-misc.js —— 会话杂项接口（跨设备同步用）：/admin/session-names、session-prompts、session-archive、session-pins、
//   wake-locked、session-branches、current-session，以及 /admin/subagent-detail|status|stop
// 2026-11-03 从 server.js 拆出（server.js 拆分批 2；原位置 8630-8891 行，逻辑一字未改：__dirname→deps.baseDir，fs-extra/path 就地 require，
//   归档名单读写改走 lib/session-archive.js）。
// 依赖注入：basicAuth、subagentRunner、writeJsonFileAtomic、sessionCfg、baseDir（项目根）、SESSION_NAMES_FILE（server.js 别处也用，定义留在 server.js）、
//   readSessionArchive/writeSessionArchive（来自 lib/session-archive.js）。
// 块内定义、只在本文件用：SESSION_PROMPTS_FILE/SESSION_PINS_FILE/WAKE_LOCKED_FILE/SESSION_BRANCHES_FILE/CURRENT_SESSION_FILE/inheritBranchCfg。
const fs = require('fs-extra');
const path = require('path');

module.exports = function (app, deps) {
const { basicAuth, subagentRunner, writeJsonFileAtomic, sessionCfg, baseDir, SESSION_NAMES_FILE, readSessionArchive, writeSessionArchive } = deps;

/* [位置:routes/session-misc.js·rejectBad] [识别不了的 body 一律拒收，不写盘] [11-15（技术债池 10-27 那条待拍板的落地）：本文件六个 PUT 里，唤醒名单两处「sessions 缺失/不是数组就落成 []」，五个映射接口「新旧两路都没命中就把读出来的旧表原样写回」，两边都回 saved:true。
   10-27 真丢过一次会话名（前端发裸键值格式）、一次形状不对的 PUT 能让唤醒名单整表清空——都是「出错了却报成功」。
   错误出口沿用 11-14 统一形状 { error: 人话, code: 机器码 }（见 routes/chat.js·fail），本文件没有 fail，就地写同形的一个；成功返回结构一字不动（前端依赖 count）。
   拒收一律「先判断、后写盘」：返回 400 时不碰任何文件。] [注释时间 2026-11-15] */
function rejectBad(reply, code, message) {
  return reply.code(400).send({ error: String(message || "请求格式不对"), code: code || "bad_body" });
}

/* [位置:routes/session-misc.js·pickSessionIds] [唤醒名单的入参校验] [11-15：两个唤醒名单 PUT 原来把「sessions 缺失/不是数组」当成「一个都不要」，落成 [] 整表覆盖还回 saved:true；元素不是字符串也会被静默过滤掉，一样能清空名单。
   现在：缺 sessions / 不是数组 → sessions_required；数组里有一项不是非空字符串 → bad_sessions（报第几项）；两种都整批拒收，盘上一个字节都不写。空数组 [] 仍是合法意图（她自己把会话全取消勾选）] [注释时间 2026-11-15] */
function pickSessionIds(body) {
  if (!Array.isArray(body.sessions)) return { ok: false, code: "sessions_required", message: "sessions 必须是会话 id 数组（清空请显式传 []）" };
  const bad = [];
  body.sessions.forEach(function (s, i) { if (typeof s !== "string" || !s.trim()) bad.push(i + 1); });
  if (bad.length) return { ok: false, code: "bad_sessions", message: "sessions 第 " + bad[0] + " 项不是会话 id（共 " + bad.length + " 项不对），整批不写" };
  return { ok: true, ids: body.sessions.slice() };
}

// 会话改名映射跨设备同步（存 data/session-names.json）
app.get("/admin/session-names", { preHandler: basicAuth }, async (req, reply) => {
  try {
    let names = {};
    try { if (fs.existsSync(SESSION_NAMES_FILE)) names = JSON.parse(fs.readFileSync(SESSION_NAMES_FILE, "utf-8")) || {}; } catch (e) { console.warn('[server.js:7420] optional read failed:', e.message || e); }
    reply.send({ ok: true, names });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/session-names", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    fs.ensureDirSync(path.dirname(SESSION_NAMES_FILE));
    let names = {};
    try { if (fs.existsSync(SESSION_NAMES_FILE)) names = JSON.parse(fs.readFileSync(SESSION_NAMES_FILE, "utf-8")) || {}; } catch (e) { names = {}; }
    if (!names || typeof names !== "object" || Array.isArray(names)) names = {};
    // 11-15：set 必须是对象（数组不算「命中」——那是不认识的形状，落到下面 else 拒收）
    const setObj = (body.set && typeof body.set === "object" && !Array.isArray(body.set)) ? body.set : null;
    const hasDelta = !!setObj || Array.isArray(body.unset);
    if (hasDelta) {
      // 新格式（2026-09-26 多端合并）：{ set: {会话: 名称}, unset: [会话...] } 按键合并，不做整表覆盖；
      // set/unset 均可单独出现（只改 / 只删），互不依赖
      if (setObj) {
        for (const k of Object.keys(setObj)) {
          const v = setObj[k];
          if (typeof v === "string") { if (v.trim()) names[k] = v.trim(); else delete names[k]; }
        }
      }
      if (Array.isArray(body.unset)) {
        for (const k of body.unset) { if (typeof k === "string") delete names[k]; }
      }
    } else if (body.names && typeof body.names === "object") {
      // 旧格式整表（兼容旧缓存页面）
      const clean = {};
      for (const k of Object.keys(body.names)) { if (typeof body.names[k] === "string") clean[k] = body.names[k]; }
      names = clean;
    } else {
      // 11-15：两路都没命中 = 不认识的 body。以前这里照样把旧表写回并回 saved:true（10-27 裸键值格式就是这样静默丢名的），
      // 现在拒收，盘上一个字节都不写
      console.warn("[session-names] 拒收：body 既不是 {set/unset} 也不是 {names}，本次不写盘");
      return rejectBad(reply, "bad_body", "认不出的请求格式：请用 {set:{会话:名称},unset:[会话]} 或 {names:{会话:名称}}");
    }
    fs.writeFileSync(SESSION_NAMES_FILE, JSON.stringify(names, null, 2), "utf-8");
    reply.send({ ok: true, saved: true, count: Object.keys(names).length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 会话级人设（提示词备份）选择跨设备同步（存 data/session-prompts.json）
const SESSION_PROMPTS_FILE = path.join(baseDir, "data", "session-prompts.json");
app.get("/admin/session-prompts", { preHandler: basicAuth }, async (req, reply) => {
  try {
    let prompts = {};
    try { if (fs.existsSync(SESSION_PROMPTS_FILE)) prompts = JSON.parse(fs.readFileSync(SESSION_PROMPTS_FILE, "utf-8")) || {}; } catch (e) { console.warn('[server.js:7460] optional read failed:', e.message || e); }
    reply.send({ ok: true, prompts });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/session-prompts", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    fs.ensureDirSync(path.dirname(SESSION_PROMPTS_FILE));
    let prompts = {};
    try { if (fs.existsSync(SESSION_PROMPTS_FILE)) prompts = JSON.parse(fs.readFileSync(SESSION_PROMPTS_FILE, "utf-8")) || {}; } catch (e) { prompts = {}; }
    if (!prompts || typeof prompts !== "object" || Array.isArray(prompts)) prompts = {};
    const prevPrompts = Object.assign({}, prompts);
    // 11-15：set 必须是对象（数组不算命中，落到下面 else 拒收）
    const setObj = (body.set && typeof body.set === "object" && !Array.isArray(body.set)) ? body.set : null;
    const hasDelta = !!setObj || Array.isArray(body.unset);
    if (hasDelta) {
      // 新格式（2026-09-26 多端合并）：{ set: {会话: 备份id}, unset: [会话...] } 按键合并，不做整表覆盖；
      // set/unset 均可单独出现（只改 / 只删），互不依赖
      if (setObj) {
        for (const k of Object.keys(setObj)) {
          const v = setObj[k];
          if (typeof v === "string") { if (v) prompts[k] = v; else delete prompts[k]; }
        }
      }
      if (Array.isArray(body.unset)) {
        for (const k of body.unset) { if (typeof k === "string") delete prompts[k]; }
      }
    } else if (body.prompts && typeof body.prompts === "object") {
      // 旧格式整表（兼容旧缓存页面）
      const clean = {};
      for (const k of Object.keys(body.prompts)) { if (typeof body.prompts[k] === "string") clean[k] = body.prompts[k]; }
      prompts = clean;
    } else {
      // 11-15：两路都没命中 = 不认识的 body，拒收且不写盘（同 session-names，见上方 rejectBad 注释）
      console.warn("[session-prompts] 拒收：body 既不是 {set/unset} 也不是 {prompts}，本次不写盘");
      return rejectBad(reply, "bad_body", "认不出的请求格式：请用 {set:{会话:备份id},unset:[会话]} 或 {prompts:{会话:备份id}}");
    }
    fs.writeFileSync(SESSION_PROMPTS_FILE, JSON.stringify(prompts, null, 2), "utf-8");
    /* [位置:routes/session-misc.js·PUT /admin/session-prompts 切换人设清快照] [11-21：人设在 B1 缓存层，切换人设本身就会导致上游缓存零命中，顺手清掉受影响会话的旧快照让下一轮自动重建（新建会话无快照幂等无副作用）] [注释时间 2026-11-21] */
    try {
      const sv2 = require("../context/context-snapshot-v2");
      const allKeys = new Set(Object.keys(prevPrompts).concat(Object.keys(prompts)));
      for (const sid of allKeys) {
        if ((prevPrompts[sid] || "") !== (prompts[sid] || "")) {
          if (sv2.hasSnapshot(baseDir, sid)) {
            sv2.deleteSnapshot(baseDir, sid);
            sv2.clearStale(baseDir, sid);
            console.log("[ctx-snapshot-v2] 切换会话人设，已清快照等待重建 session=" + sid);
          }
        }
      }
    } catch (e) { console.warn("[session-prompts] 清快照失败（不影响保存）:", e && e.message); }
    reply.send({ ok: true, saved: true, count: Object.keys(prompts).length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 会话归档跨设备同步（存 data/session-archive.json）：归档=收纳（数据完整保留），
// 从主列表收进「归档」区；新消息落库自动取消归档回主列表。
// 2026-10-26 子智能体批3 前端配套（产品确定）：过程抽屉只读详情 + 终止按钮（引擎侧 stopped 终态，见 lib/subagent-runner.js）
app.get("/admin/subagent-detail", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const sid = String((req.query || {}).session_id || "").trim();
    if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) return reply.code(400).send({ error: "session_id 缺失或不合法" });
    reply.send(subagentRunner.detail(sid, { meta: String((req.query || {}).meta || "") === "1", since: (req.query || {}).since }));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.get("/admin/subagent-status", { preHandler: basicAuth }, async (req, reply) => {
  try { reply.send({ ok: true, status: subagentRunner.statusAll() }); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});
app.post("/admin/subagent-stop", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const sid = String(((req.body && typeof req.body === "object" ? req.body : {}).session_id) || "").trim();
    if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) return reply.code(400).send({ error: "session_id 缺失或不合法" });
    reply.send(subagentRunner.stop({ session_id: sid }));
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.get("/admin/session-archive", { preHandler: basicAuth }, async (req, reply) => {
  try { reply.send({ ok: true, archived: readSessionArchive() }); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/session-archive", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    let arch = readSessionArchive();
    if (Array.isArray(body.add) || Array.isArray(body.remove)) {
      const add = Array.isArray(body.add) ? body.add.filter(function (s2) { return typeof s2 === "string" && s2; }) : [];
      const remove = Array.isArray(body.remove) ? body.remove.filter(function (s2) { return typeof s2 === "string" && s2; }) : [];
      for (const s2 of add) { if (arch.indexOf(s2) < 0) arch.push(s2); }
      arch = arch.filter(function (s2) { return remove.indexOf(s2) < 0; });
    } else if (Array.isArray(body.archived)) {
      arch = body.archived.filter(function (s2) { return typeof s2 === "string" && s2; });
    } else {
      // 11-15：既没有 add/remove 也没有 archived，以前会把旧名单原样写回并回 saved:true，现在拒收不写盘
      console.warn("[session-archive] 拒收：body 既不是 {add/remove} 也不是 {archived}，本次不写盘");
      return rejectBad(reply, "bad_body", "认不出的请求格式：请用 {add:[会话],remove:[会话]} 或 {archived:[会话]}");
    }
    writeSessionArchive(arch);
    reply.send({ ok: true, saved: true, count: arch.length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
// 会话置顶跨设备同步（存 data/session-pins.json）
const SESSION_PINS_FILE = path.join(baseDir, "data", "session-pins.json");
app.get("/admin/session-pins", { preHandler: basicAuth }, async (req, reply) => {
  try {
    let pins = [];
    try { if (fs.existsSync(SESSION_PINS_FILE)) { const v = JSON.parse(fs.readFileSync(SESSION_PINS_FILE, "utf-8")) || []; if (Array.isArray(v)) pins = v; } } catch (e) { console.warn('[server.js:7537] optional read failed:', e.message || e); }
    reply.send({ ok: true, pins });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/session-pins", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    fs.ensureDirSync(path.dirname(SESSION_PINS_FILE));
    let pins = [];
    try { if (fs.existsSync(SESSION_PINS_FILE)) { const v = JSON.parse(fs.readFileSync(SESSION_PINS_FILE, "utf-8")) || []; if (Array.isArray(v)) pins = v; } } catch (e) { pins = []; }
    if (Array.isArray(body.add) || Array.isArray(body.remove)) {
      // 新格式（2026-09-26 多端合并）：{ add: [会话], remove: [会话] } 逐项合并，不做整表覆盖
      const add = Array.isArray(body.add) ? body.add.filter(function (s) { return typeof s === "string" && s; }) : [];
      const remove = Array.isArray(body.remove) ? body.remove.filter(function (s) { return typeof s === "string" && s; }) : [];
      for (const s2 of add) { if (pins.indexOf(s2) < 0) pins.push(s2); }
      pins = pins.filter(function (s2) { return remove.indexOf(s2) < 0; });
    } else if (Array.isArray(body.pins)) {
      // 旧格式整表（兼容旧缓存页面）
      pins = body.pins.filter(function (s2) { return typeof s2 === "string" && s2; });
    } else {
      // 11-15：既没有 add/remove 也没有 pins，以前会把旧名单原样写回并回 saved:true，现在拒收不写盘
      console.warn("[session-pins] 拒收：body 既不是 {add/remove} 也不是 {pins}，本次不写盘");
      return rejectBad(reply, "bad_body", "认不出的请求格式：请用 {add:[会话],remove:[会话]} 或 {pins:[会话]}");
    }
    fs.writeFileSync(SESSION_PINS_FILE, JSON.stringify(pins, null, 2), "utf-8");
    reply.send({ ok: true, saved: true, count: pins.length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 会话锁定唤醒（存 data/wake-locked.json）：唤醒进程只对这些会话各自独立计时并唤醒；置顶时可选一并锁定，取消置顶即解锁
const WAKE_LOCKED_FILE = path.join(baseDir, "data", "wake-locked.json");
/* [位置:routes/session-misc.js·WAKE_EVENT_FILE] [事件唤醒名单的落盘路径] [11-15：这个路径原来写死在 lib/wake-subs.js（BASE 是项目根，指不进临时目录），
   为了能给路由写隔离测试，留一个 deps.wakeEventFile 口子；server.js 不传时取值与原来 require("../lib/wake-subs").EVSESS 逐字节相同] [注释时间 2026-11-15] */
const WAKE_EVENT_FILE = deps.wakeEventFile || require("../lib/wake-subs").EVSESS;
app.get("/admin/wake-locked", { preHandler: basicAuth }, async (req, reply) => {
  try {
    let sessions = [];
    try { if (fs.existsSync(WAKE_LOCKED_FILE)) { const v = JSON.parse(fs.readFileSync(WAKE_LOCKED_FILE, "utf-8")) || []; if (Array.isArray(v)) sessions = v; } } catch (e) { console.warn('[server.js:7567] optional read failed:', e.message || e); }
    reply.send({ ok: true, sessions });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/wake-locked", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const pick = pickSessionIds(body);
    if (!pick.ok) { console.warn("[wake-locked] 拒收：" + pick.message + "，本次不写盘（原来是写空名单）"); return rejectBad(reply, pick.code, pick.message); }
    const sessions = pick.ids;
    // 2026-09-13 审查修复：改原子写——裸 writeFileSync 的写盘窗口被唤醒侧读到半截 JSON 时，
    // readWakeLockedSessions 解析失败返回空，当轮唤醒（含到期显式闹钟）整体静默停摆
    writeJsonFileAtomic(WAKE_LOCKED_FILE, sessions);
    reply.send({ ok: true, saved: true, count: sessions.length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 事件唤醒的会话名单（存 data/wake-event-sessions.json；和上面的「锁定=定时唤醒」分开，11-04）：只有名单里的会话，会在她有动静/睡着/醒来时被叫醒
app.get("/admin/wake-event-sessions", { preHandler: basicAuth }, async (req, reply) => {
  try { reply.send({ ok: true, sessions: require("../lib/wake-subs").eventSessions() }); }
  catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/wake-event-sessions", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const pick = pickSessionIds(body);
    if (!pick.ok) { console.warn("[wake-event-sessions] 拒收：" + pick.message + "，本次不写盘（原来是写空名单）"); return rejectBad(reply, pick.code, pick.message); }
    const sessions = pick.ids;
    writeJsonFileAtomic(WAKE_EVENT_FILE, sessions);
    reply.send({ ok: true, saved: true, count: sessions.length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 会话分支父级跨设备同步（存 data/session-branches.json）
const SESSION_BRANCHES_FILE = path.join(baseDir, "data", "session-branches.json");
// 2026-10-15：建立/更换分支映射时，子会话继承父会话的会话级注入配置
// （data/session_cfg/<token>.json 整体复制：跨注入开关/注入块/标星条数/日记篇数）
const inheritBranchCfg = function (child, parent) {
  if (!child || !parent) return;
  try {
    if (sessionCfg.inheritFrom(parent, child)) console.log("[session-branches] " + child + " 继承父会话 " + parent + " 的注入配置");
  } catch (e) { console.warn("[session-branches] 继承注入配置失败:", e.message); }
};
app.get("/admin/session-branches", { preHandler: basicAuth }, async (req, reply) => {
  try {
    let branches = {};
    try { if (fs.existsSync(SESSION_BRANCHES_FILE)) branches = JSON.parse(fs.readFileSync(SESSION_BRANCHES_FILE, "utf-8")) || {}; } catch (e) { console.warn('[server.js:7595] optional read failed:', e.message || e); }
    reply.send({ ok: true, branches });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/session-branches", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    fs.ensureDirSync(path.dirname(SESSION_BRANCHES_FILE));
    let branches = {};
    try { if (fs.existsSync(SESSION_BRANCHES_FILE)) branches = JSON.parse(fs.readFileSync(SESSION_BRANCHES_FILE, "utf-8")) || {}; } catch (e) { branches = {}; }
    if (!branches || typeof branches !== "object" || Array.isArray(branches)) branches = {};
    const normBranch = function (v) {
      // 11-15：数组也算形状不对（typeof 是 object，原来会把 [] 归一成「fromSession 空的分支」登记进去）
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      return { fromSession: String(v.fromSession || ""), fromIndex: (Number(v.fromIndex) >= 0) ? Number(v.fromIndex) : 0, createdAt: String(v.createdAt || "") };
    };
    // 11-15：set 必须是对象（数组不算命中，落到下面 else 拒收）
    const setObj = (body.set && typeof body.set === "object" && !Array.isArray(body.set)) ? body.set : null;
    const hasDelta = !!setObj || Array.isArray(body.unset);
    if (hasDelta) {
      // 新格式（2026-09-26 多端合并）：{ set: {会话: 分支父级}, unset: [会话...] } 按键合并，不做整表覆盖；
      // set/unset 均可单独出现（只改 / 只删），互不依赖
      if (setObj) {
        for (const k of Object.keys(setObj)) {
          const raw = setObj[k];
          const nv = normBranch(raw);
          if (nv) { branches[k] = nv; inheritBranchCfg(k, nv.fromSession); }
          /* [位置:routes/session-misc.js·session-branches set 分支] [「值不是分支对象」的三种待遇] [11-15：这里原来一律 delete branches[k]，等于「发个垃圾值就把一条真实分支登记删掉」。
             查过调用方：旧 chat 端（workspace/_archive/20261031-claimlocks/chat.html·pushSessionParentsDelta）发 set 前显式过滤非对象、删除一律走 unset，
             现网新前端根本不调这个 PUT（登记由后端 lib/session-branches.register 写），所以 set:null 没有任何现存调用方，只是兜底容错。
             取舍：显式 null 仍按「取消分支」处理（值本身就是「没有父级」，留着兼容旧缓存页面/第三方脚本）；非 null 的形状错误（字符串/数字/布尔/数组）不再当删除，
             只 warn 跳过该键——把垃圾当删除正是这一批要堵的静默数据丢失] [注释时间 2026-11-15] */
          else if (raw === null || raw === undefined) { delete branches[k]; }
          else console.warn("[session-branches] set 里 " + k + " 的值不是分支对象，跳过（不删原登记）");
        }
      }
      if (Array.isArray(body.unset)) {
        for (const k of body.unset) { if (typeof k === "string") delete branches[k]; }
      }
    } else if (body.branches && typeof body.branches === "object") {
      // 旧格式整表（兼容旧缓存页面）
      const clean = {};
      for (const k of Object.keys(body.branches)) { const nv = normBranch(body.branches[k]); if (nv) clean[k] = nv; }
      for (const k of Object.keys(clean)) {
        const prev = branches[k];
        if (!prev || prev.fromSession !== clean[k].fromSession) inheritBranchCfg(k, clean[k].fromSession);
      }
      branches = clean;
    } else {
      // 11-15：既没有 set/unset 也没有 branches，以前会把旧表原样写回并回 saved:true，现在拒收不写盘
      console.warn("[session-branches] 拒收：body 既不是 {set/unset} 也不是 {branches}，本次不写盘");
      return rejectBad(reply, "bad_body", "认不出的请求格式：请用 {set:{会话:分支父级},unset:[会话]} 或 {branches:{会话:分支父级}}");
    }
    fs.writeFileSync(SESSION_BRANCHES_FILE, JSON.stringify(branches, null, 2), "utf-8");
    reply.send({ ok: true, saved: true, count: Object.keys(branches).length });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

// 当前会话跨设备同步（存 data/current-session.json；单用户最后打开的会话）
const CURRENT_SESSION_FILE = path.join(baseDir, "data", "current-session.json");
app.get("/admin/current-session", { preHandler: basicAuth }, async (req, reply) => {
  try {
    let cur = null;
    try { if (fs.existsSync(CURRENT_SESSION_FILE)) cur = JSON.parse(fs.readFileSync(CURRENT_SESSION_FILE, "utf-8")); } catch (e) { console.warn('[server.js:7644] optional read failed:', e.message || e); }
    reply.send({ ok: true, session: (cur && cur.session) || "", updatedAt: (cur && cur.updatedAt) || "" });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
app.put("/admin/current-session", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const sid = String(body.session || "").trim();
    if (!sid) return reply.code(400).send({ error: "session 不能为空" });
    fs.ensureDirSync(path.dirname(CURRENT_SESSION_FILE));
    fs.writeFileSync(CURRENT_SESSION_FILE, JSON.stringify({ session: sid, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
    reply.send({ ok: true, saved: true, session: sid });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
};
