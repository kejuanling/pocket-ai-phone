'use strict';
// daily-stats.js（路由）—— 月历每天的统计（10-23 需求 44，逻辑在 lib/daily-stats.js）：
//   GET /v1/daily-stats?month=YYYY-MM → { ok, month, days: { 'YYYY-MM-DD': { u, a, in, out, hit } } }（小手机月历详情用，沿用 /v1 的全局鉴权）
module.exports = function (app, deps) {
  const stats = require('../lib/daily-stats').createDailyStats({ baseDir: deps.baseDir });
  app.get('/v1/daily-stats', async (req, reply) => {
    const ym = String((req.query && req.query.month) || '');
    if (!/^\d{4}-\d{2}$/.test(ym)) return reply.code(400).send({ ok: false, error: 'month 格式应为 YYYY-MM' });
    try {
      const days = await stats.month(ym);
      reply.send({ ok: true, month: ym, days: days });
    } catch (e) {
      reply.code(500).send({ ok: false, error: e.message });
    }
  });
};
