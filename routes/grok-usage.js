'use strict';
// grok-usage.js —— POST /admin/providers/grok-usage  { id, account?, force? }
// [位置:routes/grok-usage.js] [Grok 订阅额度查询接口] [11-18：grok 也做一个 claude/gemini 那样的额度查看；
//   只对 oauth_provider=grok 的供应商开放；查询见 lib/grok-usage.js（纯读 grok.com，不消耗额度，60 秒缓存）] [注释时间 2026-11-18]
const usage = require('../lib/grok-usage');

module.exports = function (app, deps) {
  app.post('/admin/providers/grok-usage', { preHandler: deps.mcpManageAuth }, async function (req, reply) {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const id = String(body.id || '').trim();
    if (!id) return reply.code(400).send({ ok: false, error: '缺少供应商 id' });
    const p = deps.loadAiProviders().find(function (x) { return x && String(x.id) === id; });
    if (!p) return reply.code(404).send({ ok: false, error: '供应商不存在' });
    if (String(p.oauth_provider || '') !== 'grok') return reply.send({ ok: false, error: '只有 Grok 订阅登录的供应商能查额度' });
    const account = String(body.account || '').trim();
    if (account && !/^[a-z0-9_-]{1,32}$/i.test(account)) return reply.code(400).send({ ok: false, error: '账号 id 不合法' });
    try {
      return reply.send(await usage.probe(account || null, { force: body.force === true }));
    } catch (e) {
      console.error('[grok-usage] error:', e && e.message);
      return reply.send({ ok: false, error: '查询失败' });
    }
  });
};
