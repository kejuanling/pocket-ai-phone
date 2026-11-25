'use strict';
// claude-usage.js —— POST /admin/providers/claude-usage  { id, account?, force? }
// [位置:routes/claude-usage.js] [Claude 订阅额度查询接口] [11-09：供应商详情页「订阅额度」点一下查；
//   只对 oauth_provider=claude 的供应商开放；探测本身见 lib/claude-usage.js（真实消耗极少额度，60 秒缓存）] [注释时间 2026-11-09]
const usage = require('../lib/claude-usage');

module.exports = function (app, deps) {
  app.post('/admin/providers/claude-usage', { preHandler: deps.mcpManageAuth }, async function (req, reply) {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const id = String(body.id || '').trim();
    if (!id) return reply.code(400).send({ ok: false, error: '缺少供应商 id' });
    const p = deps.loadAiProviders().find(function (x) { return x && String(x.id) === id; });
    if (!p) return reply.code(404).send({ ok: false, error: '供应商不存在' });
    if (String(p.oauth_provider || '') !== 'claude') return reply.send({ ok: false, error: '只有 Claude 订阅登录的供应商能查额度' });
    const account = String(body.account || '').trim();
    if (account && !/^[a-z0-9_-]{1,32}$/i.test(account)) return reply.code(400).send({ ok: false, error: '账号 id 不合法' });
    try {
      return reply.send(await usage.probe(account || null, { force: body.force === true }));
    } catch (e) {
      console.error('[claude-usage] error:', e && e.message);
      return reply.send({ ok: false, error: '查询失败' });
    }
  });
};
