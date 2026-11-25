'use strict';
// session-status.js —— 会话进展状态读写。
// [位置:routes/session-status.js] [GET/PUT /admin/session-status] [10-27：小手机会话列表在会话名旁显示 进行中/待回复/待反馈/已完成；AI 用 <status> 标签写（lib/tag-parser → lib/session-meta），
//   这里给前端读，也允许手动设置/清除：PUT {set:{会话:状态}, unset:[会话]}] [注释时间 2026-10-27]

const meta = require('../lib/session-meta');

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;
  app.get('/admin/session-status', { preHandler: basicAuth }, async (req, reply) => {
    reply.send({ ok: true, status: meta.readStatusMap(), statuses: meta.STATUSES });
  });
  app.put('/admin/session-status', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      reply.send({ ok: true, status: meta.patchStatus(body.set, body.unset) });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  // [位置:routes/session-status.js·claim 告警/占用] [文件占用冲突：横幅轮询 + 确认 + 占用查询] [10-31：AI 用 <claim> 登记要改的文件（lib/claim-locks.js），
  //   撞车记告警；前端聊天页/手机页轮询 claim-alerts 弹全局横幅，「知道了」ack 全部未读；claim-locks 给用户/AI 查当前谁占着什么。挂在会话元信息路由里，不再动 server.js] [注释时间 2026-10-31]
  const claimLocks = require('../lib/claim-locks');
  app.get('/admin/claim-alerts', { preHandler: basicAuth }, async (req, reply) => {
    reply.send({ ok: true, list: claimLocks.pendingAlerts() });
  });
  app.post('/admin/claim-alerts/ack', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      reply.send(claimLocks.ackAlert(body.id));   // id 空 = 全部未读标已读（横幅一次只显示一条，点「知道了」全清）
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });
  app.get('/admin/claim-locks', { preHandler: basicAuth }, async (req, reply) => {
    // [位置:routes/session-status.js·claim-locks] [按会话取占用] [11-06：聊天页浮球只要本会话那条；带 session_id 返回 {lock}，不带保持原来的全量 {locks}（兼容旧调用方）] [注释时间 2026-11-06]
    const sid = String((req.query && req.query.session_id) || '').trim();
    if (sid) { reply.send({ ok: true, lock: claimLocks.lockOf(sid) }); return; }
    reply.send({ ok: true, locks: claimLocks.currentLocks() });
  });
  // [位置:routes/session-status.js·claim-locks/clear] [前端清本会话占用] [11-06：面板上的「清除」等于替 AI 发 <claim clear>，只清这个会话，别的不动] [注释时间 2026-11-06]
  app.post('/admin/claim-locks/clear', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(body.session_id || '').trim();
      if (!sid) { reply.code(400).send({ ok: false, error: 'session_id required' }); return; }
      reply.send(claimLocks.clear(sid));
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  // [位置:routes/session-status.js·wake-alarms] [闹钟球：本会话闹钟的读与取消] [11-06：聊天页闹钟浮球只看本会话；两类合起来显示——wake 工具的多闹钟（data/wake-alarms.json）+ 旧 <wake> 标签单槽（data/wake_schedule.json）。取消等同于 AI 自己删：调现成的 deleteAlarm / clearSlot，删完重挂定时器（不然定时器还按删掉的时刻空跑一轮）] [注释时间 2026-11-06]
  const wakeAlarms = require('../lib/wake-alarms');
  const wakeSchedule = require('../lib/wake-schedule');
  const sleepCfg = require('../lib/sleep-wake-config');
  const VALID_REPEATS = new Set(['once', 'daily', 'weekly', 'interval']);
  function armWake() {
    try { if (deps && deps.wakeScheduler && deps.wakeScheduler.armTimedWake) deps.wakeScheduler.armTimedWake(); } catch (e) {}
  }
  function checkOnceQuietWindow(atVal, repeatVal) {
    const rep = repeatVal || 'once';
    if (rep !== 'once') return null;
    const quietMin = sleepCfg.read().userAlarmQuietMin;
    if (!quietMin) return null;
    const atMs = new Date(atVal).getTime();
    if (Number.isFinite(atMs) && atMs > Date.now() && atMs - Date.now() <= quietMin * 60 * 1000) {
      return '当前设置了响铃前 ' + quietMin + ' 分钟内聊过不响，这个时间在跳过范围内，请设更晚或在唤醒设置里调小';
    }
    return null;
  }
  app.get('/admin/wake-alarms', { preHandler: basicAuth }, async (req, reply) => {
    const sid = String((req.query && req.query.session_id) || '').trim();
    if (!sid) { reply.code(400).send({ ok: false, error: 'session_id required' }); return; }
    reply.send({ ok: true, alarms: wakeAlarms.listAlarms(sid), slot: wakeSchedule.slotOf(sid) });
  });
  /* [位置:routes/session-status.js·wake-alarms add/update] [她自己设/改闹钟] [2026-11-09：聊天页「…」菜单里的「闹钟」弹窗可添加、编辑；by=user 的闹钟享受「到点前 N 分钟内她发过言这一轮不响」，note 是她留的附言（≤500 字，到点追加进唤醒提示词）。2026-11-20 扩展支持 weekly（days）/ interval（intervalMin + 可选 quietStart/quietEnd 免打扰时段），单次闹钟落在静默跳过窗口内时报错提醒] */
  const SID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  app.post('/admin/wake-alarms/add', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(b.session_id || '').trim();
      if (!SID_RE.test(sid)) { reply.code(400).send({ ok: false, error: 'session_id 不合法' }); return; }
      if (b.repeat !== undefined && !VALID_REPEATS.has(b.repeat)) { reply.code(400).send({ ok: false, error: 'repeat 只能是 once / daily / weekly / interval' }); return; }
      if (b.note !== undefined && typeof b.note !== 'string') { reply.code(400).send({ ok: false, error: 'note 必须是文字' }); return; }
      if (b.prob !== undefined && b.prob !== null && !(Number.isFinite(Number(b.prob)) && Number(b.prob) >= 1 && Number(b.prob) <= 100)) { reply.code(400).send({ ok: false, error: 'prob 要是 1~100' }); return; }
      const qErr = checkOnceQuietWindow(b.at, b.repeat);
      if (qErr) { reply.code(400).send({ ok: false, error: qErr }); return; }
      const r = wakeAlarms.setAlarm(sid, {
        at: b.at, repeat: b.repeat, days: b.days,
        intervalMin: b.intervalMin !== undefined ? b.intervalMin : b.interval_min,
        quietStart: b.quietStart !== undefined ? b.quietStart : b.quiet_start,
        quietEnd: b.quietEnd !== undefined ? b.quietEnd : b.quiet_end,
        note: b.note, prob: b.prob, by: 'user'
      });
      if (!r.ok) { reply.code(400).send(r); return; }
      armWake();
      reply.send(r);
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });
  app.post('/admin/wake-alarms/update', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(b.session_id || '').trim();
      if (!SID_RE.test(sid)) { reply.code(400).send({ ok: false, error: 'session_id 不合法' }); return; }
      if (b.repeat !== undefined && !VALID_REPEATS.has(b.repeat)) { reply.code(400).send({ ok: false, error: 'repeat 只能是 once / daily / weekly / interval' }); return; }
      if (b.note !== undefined && typeof b.note !== 'string') { reply.code(400).send({ ok: false, error: 'note 必须是文字' }); return; }
      if (b.prob !== undefined && b.prob !== null && !(Number.isFinite(Number(b.prob)) && Number(b.prob) >= 1 && Number(b.prob) <= 100)) { reply.code(400).send({ ok: false, error: 'prob 要是 1~100' }); return; }
      if (b.at !== undefined) {
        const qErr = checkOnceQuietWindow(b.at, b.repeat);
        if (qErr) { reply.code(400).send({ ok: false, error: qErr }); return; }
      }
      const patch = { at: b.at, repeat: b.repeat, note: b.note, prob: b.prob };
      if ('days' in b) patch.days = b.days;
      if ('intervalMin' in b || 'interval_min' in b) patch.intervalMin = b.intervalMin !== undefined ? b.intervalMin : b.interval_min;
      if ('quietStart' in b || 'quiet_start' in b) patch.quietStart = b.quietStart !== undefined ? b.quietStart : b.quiet_start;
      if ('quietEnd' in b || 'quiet_end' in b) patch.quietEnd = b.quietEnd !== undefined ? b.quietEnd : b.quiet_end;
      const r = wakeAlarms.updateAlarm(sid, String(b.alarm_id || '').trim(), patch);
      if (!r.ok) { reply.code(400).send(r); return; }
      armWake();
      reply.send(r);
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });
  app.post('/admin/wake-alarms/delete', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(body.session_id || '').trim();
      if (!sid) { reply.code(400).send({ ok: false, error: 'session_id required' }); return; }
      const r = wakeAlarms.deleteAlarm(sid, String(body.alarm_id || '').trim());
      if (r.ok) armWake();
      reply.send(r);
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });
  app.post('/admin/wake-alarms/slot/clear', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const sid = String(body.session_id || '').trim();
      if (!sid) { reply.code(400).send({ ok: false, error: 'session_id required' }); return; }
      const changed = wakeSchedule.clearSlot(sid);
      armWake();
      reply.send({ ok: true, cleared: !!changed });
    } catch (err) { reply.code(500).send({ ok: false, error: err.message }); }
  });
};
