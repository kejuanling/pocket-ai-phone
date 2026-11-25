'use strict';
// [位置:lib/wake-gate.js] [唤醒放行闸门] [批D·27 唤醒排队：每个会话一条车道，同一会话的唤醒一个接一个，不撞车、不丢上下文，也不和用户的聊天抢话；不同会话上下文各自独立，互不等待] [注释时间 2026-10-22]
//
// 放行条件（同一会话内，FIFO）：
//   ① 这个会话没有别的唤醒正在跑（租约 leaseMs 到了视为卡死，放行下一个并记日志）；
//   ② 距这个会话上一个唤醒结束 ≥ intervalMs；
//   ③ 用户没在聊：该会话没有进行中的生成（activeGenMap），且离「最后一次聊天活动」≥ quietMs
//      （聊天活动 = 用户发消息 noteUser / 一轮生成结束的时间）；
//   等待超过 maxWaitMs 后只剩「用户这一轮没在进行」一条（不再要求间隔/静默期），防止被一直聊天饿死。
// 只管「何时放行、顺序」，不碰唤醒内容。用户主动发消息的链路完全不经过这里。
//
// 用法：const turn = await gate.acquire(sid, "闹钟"); if (!turn) return;（网关退出中）
//       try { ...调模型... } finally { turn.release(); }

const userAt = new Map();   // sid -> 用户最后一次发消息的时间（routes/chat.js 在请求开始时 noteUser）
function noteUser(sessionId) {
  const sid = String(sessionId || "default").trim() || "default";
  userAt.set(sid, Date.now());
}

function createWakeGate(opts) {
  const o = opts || {};
  const activeGenMap = o.activeGenMap || new Map();
  const genTtlMs = o.genTtlMs || 10 * 60 * 1000;
  const cfg = typeof o.getConfig === "function" ? o.getConfig : function () { return {}; };
  const log = typeof o.log === "function" ? o.log : function (m) { console.log(m); };
  const POLL_MS = o.pollMs || 2000;
  const lanes = new Map();   // sid -> { running: {token, startedAt, source}|null, lastEnd: ms, waiters: [] }
  let timer = null;
  let seq = 0;

  function conf() {
    const c = cfg() || {};
    return {
      intervalMs: Number.isFinite(c.intervalMs) ? c.intervalMs : 30 * 1000,
      quietMs: Number.isFinite(c.quietMs) ? c.quietMs : 20 * 1000,
      maxWaitMs: Number.isFinite(c.maxWaitMs) ? c.maxWaitMs : 10 * 60 * 1000,
      leaseMs: Number.isFinite(c.leaseMs) ? c.leaseMs : 20 * 60 * 1000
    };
  }
  function lane(sid) {
    let l = lanes.get(sid);
    if (!l) { l = { running: null, lastEnd: 0, waiters: [] }; lanes.set(sid, l); }
    return l;
  }
  // 用户在聊：返回 { busy, lastAt }，lastAt = 最近一次聊天活动的时间
  function chatState(sid, now) {
    let busy = false, lastAt = userAt.get(sid) || 0;
    const g = activeGenMap.get(sid);
    if (g) {
      if (!g.done && now - (g.ts || 0) < genTtlMs) busy = true;
      else if (g.done && g.ts > lastAt) lastAt = g.ts;
    }
    return { busy: busy, lastAt: lastAt };
  }
  function why(sid, l, w, now, c) {
    // 返回 "" 表示可放行，否则是等待原因（写日志用）
    if (l.running) {
      if (now - l.running.startedAt < c.leaseMs) return "前一个唤醒还在跑";
      log("[wake-gate] 会话 " + sid + " 上一个唤醒（" + l.running.source + "）超过 " + Math.round(c.leaseMs / 60000) + " 分钟未结束，视为卡住，放行下一个");
      l.running = null;
    }
    const cs = chatState(sid, now);
    if (cs.busy) return "用户这一轮还在进行";
    if (now - w.since >= c.maxWaitMs) return "";
    if (l.lastEnd && now - l.lastEnd < c.intervalMs) return "离上一个唤醒不足 " + Math.round(c.intervalMs / 1000) + " 秒";
    if (cs.lastAt && now - cs.lastAt < c.quietMs) return "用户刚聊完，静默 " + Math.round(c.quietMs / 1000) + " 秒";
    return "";
  }
  function grant(sid, l, w, now) {
    const token = ++seq;
    l.running = { token: token, startedAt: now, source: w.source };
    const waitedMs = now - w.since;
    if (waitedMs > 1500) log("[wake-gate] 会话 " + sid + " 的唤醒（" + w.source + "）等了 " + Math.round(waitedMs / 1000) + " 秒后放行");
    let released = false;
    w.resolve({
      waitedMs: waitedMs,
      release: function (ro) {
        if (released) return; released = true;
        const cur = lanes.get(sid);
        if (cur && cur.running && cur.running.token === token) cur.running = null;
        if (cur && !(ro && ro.idle)) cur.lastEnd = Date.now();   // idle=拿到车道后发现不用唤醒了，不算一次唤醒，不占间隔
        pump();
      }
    });
  }
  function pump() {
    const now = Date.now(), c = conf();
    const down = !!global.__GATEWAY_SHUTTING_DOWN;
    let pending = 0;
    for (const [sid, l] of lanes) {
      if (down) { while (l.waiters.length) l.waiters.shift().resolve(null); continue; }
      while (l.waiters.length) {
        const w = l.waiters[0];
        const reason = why(sid, l, w, now, c);
        if (reason) { w.reason = reason; break; }
        l.waiters.shift();
        grant(sid, l, w, now);
      }
      pending += l.waiters.length;
    }
    if (pending && !timer) { timer = setInterval(pump, POLL_MS); if (timer.unref) timer.unref(); }
    if (!pending && timer) { clearInterval(timer); timer = null; }
  }
  function acquire(sessionId, source) {
    const sid = String(sessionId || "default").trim() || "default";
    if (global.__GATEWAY_SHUTTING_DOWN) return Promise.resolve(null);
    return new Promise(function (resolve) {
      const l = lane(sid);
      const w = { source: source || "唤醒", since: Date.now(), resolve: resolve, reason: "" };
      l.waiters.push(w);
      pump();
      if (l.waiters.indexOf(w) >= 0) log("[wake-gate] 会话 " + sid + " 的唤醒（" + w.source + "）排队等待：" + (w.reason || "前面还有唤醒"));
    });
  }
  function runningCount() {
    let n = 0;
    for (const l of lanes.values()) if (l.running) n++;
    return n;
  }
  function waitingCount() {
    let n = 0;
    for (const l of lanes.values()) n += l.waiters.length;
    return n;
  }
  return { acquire: acquire, runningCount: runningCount, waitingCount: waitingCount, _pump: pump };
}

module.exports = { createWakeGate: createWakeGate, noteUser: noteUser };
