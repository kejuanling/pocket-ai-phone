'use strict';
// wake-subs.js（路由）—— 小手机「唤醒设置 → 你有动静时」的开关（10-23，数据与规则在 lib/wake-subs.js）：
//   GET  /v1/wake-subs                 → { ok, items:[{key,name,on}] }   她的总开关（on=没被她关）
//   GET  /v1/wake-next                 → { ok, locked, next, items }   下一次叫醒是什么时候、为什么（2026-10-28）
//   POST /v1/wake-subs/switch {key,on} → 关/开某一项（只影响这一项；AI 各自的订阅选择不动，重新打开就恢复）
module.exports = function (app, deps) {
  const subs = () => require('../lib/wake-subs');
  app.get('/v1/wake-subs', async (req, reply) => {
    reply.send({ ok: true, items: subs().settings() });
  });
  // 2026-10-28：手机桌面「距下次唤醒」倒计时读这里（原来解析日志）：{ locked, next:{kind,at,sid,name,...}|null, items:[…] }
  app.get('/v1/wake-next', async (req, reply) => {
    try {
      const sch = deps && deps.wakeScheduler;
      if (!sch || typeof sch.describeNext !== 'function') return reply.send({ ok: false, error: 'scheduler not ready' });
      reply.send(Object.assign({ ok: true }, sch.describeNext()));
    } catch (e) { reply.code(500).send({ ok: false, error: e.message }); }
  });
  // 2026-11-09 睡眠唤醒的全局设置（lib/sleep-wake-config.js）：总开关/沉默多久/用户闹钟作废窗口/追加文字（概率已挪到她自己设的闹钟上）
  //   GET  /v1/sleep-wake → { ok, config }
  //   POST /v1/sleep-wake {enabled?,afterMin?,userAlarmQuietMin?,note?} → 只改传来的字段，返回完整 config
  app.get('/v1/sleep-wake', async (req, reply) => {
    reply.send({ ok: true, config: require('../lib/sleep-wake-config').read() });
  });
  app.post('/v1/sleep-wake', async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const bad = [];
      ['afterMin', 'userAlarmQuietMin'].forEach(function (k) { if (k in b && !Number.isFinite(Number(b[k]))) bad.push(k); });
      if ('enabled' in b && typeof b.enabled !== 'boolean') bad.push('enabled');
      if ('note' in b && typeof b.note !== 'string') bad.push('note');
      if (bad.length) { reply.code(400).send({ ok: false, error: '字段不合法: ' + bad.join('、') }); return; }
      const cfg = require('../lib/sleep-wake-config').write(b);
      try { if (deps && deps.wakeScheduler && deps.wakeScheduler.armTimedWake) deps.wakeScheduler.armTimedWake(); } catch (e) { /* 沉默阈值变了，重挂精确定时器 */ }
      reply.send({ ok: true, config: cfg });
    } catch (e) { reply.code(500).send({ ok: false, error: e.message }); }
  });
  // 2026-11-10 位置唤醒（lib/location-detect.js）：设置页读冷却分钟 + 最近一次的问题说明（读不到/隔太久没比较），只能改冷却
  //   GET  /v1/location-wake → { ok, config:{cooldownMin,maxGapMin}, problem:{msg,at}|null }
  //   POST /v1/location-wake {cooldownMin} → 1~1440 的整数，越界 400
  const LOC_BASE = require('path').join(__dirname, '..');
  app.get('/v1/location-wake', async (req, reply) => {
    const ld = require('../lib/location-detect');
    reply.send({ ok: true, config: ld.readConfig(LOC_BASE), problem: ld.readProblem(LOC_BASE) });
  });
  app.post('/v1/location-wake', async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const n = Number(b.cooldownMin);
      if (!Number.isInteger(n) || n < 1 || n > 1440) { reply.code(400).send({ ok: false, error: 'cooldownMin 要是 1~1440 的整数' }); return; }
      const ld = require('../lib/location-detect');
      reply.send({ ok: true, config: ld.writeConfig(LOC_BASE, { cooldownMin: n }), problem: ld.readProblem(LOC_BASE) });
    } catch (e) { reply.code(500).send({ ok: false, error: e.message }); }
  });
  app.post('/v1/wake-subs/switch', async (req, reply) => {
    const b = req.body || {};
    const r = subs().setSwitch(String(b.key || ''), !!b.on);
    if (!r.ok) reply.code(400);
    reply.send(r);
  });
};
