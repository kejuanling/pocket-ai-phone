'use strict';
// 小手机「AI 在做什么」卡只读接口（10-20 第十七轮）：唤醒回执 + 最近工具调用。
// 只读、无写副作用；30 秒内存缓存（前端 loadWake 每 60 秒会带刷一次，别每次都全量扫时间线）。
const { wakeReceipts, recentTools } = require('../lib/phone-activity');

module.exports = function registerPhoneActivityRoutes(app, { basicAuth, baseDir }) {
  const rc = { t: 0, d: null }, tc = { t: 0, d: null };

  app.get('/admin/wake-receipts', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const limit = Math.min(parseInt(req.query?.limit) || 20, 50);
      if (!rc.d || Date.now() - rc.t > 30000) { rc.d = wakeReceipts(baseDir, limit); rc.t = Date.now(); }
      return reply.send({ items: rc.d });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  app.get('/admin/recent-tools', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const limit = Math.min(parseInt(req.query?.limit) || 30, 60);
      if (!tc.d || Date.now() - tc.t > 30000) { tc.d = recentTools(baseDir, limit); tc.t = Date.now(); }
      return reply.send({ items: tc.d });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });
};
