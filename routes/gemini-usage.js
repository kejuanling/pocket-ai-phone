'use strict';
// gemini-usage.js —— POST /admin/providers/gemini-usage  { id, account?, force? }
// [位置:routes/gemini-usage.js] [Gemini 订阅额度查询接口] [11-12：gemini 也做一个 claude 那样的额度查看；
//   只对 oauth_provider=antigravity 的供应商开放；形状照抄 routes/claude-usage.js，
//   查询见 lib/gemini-usage.js（纯读上游模型目录、不消耗额度，60 秒缓存）] [注释时间 2026-11-12]
const usage = require('../lib/gemini-usage');

module.exports = function (app, deps) {
  app.post('/admin/providers/gemini-usage', { preHandler: deps.mcpManageAuth }, async function (req, reply) {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const id = String(body.id || '').trim();
    if (!id) return reply.code(400).send({ ok: false, error: '缺少供应商 id' });
    const p = deps.loadAiProviders().find(function (x) { return x && String(x.id) === id; });
    if (!p) return reply.code(404).send({ ok: false, error: '供应商不存在' });
    if (String(p.oauth_provider || '') !== 'antigravity') return reply.send({ ok: false, error: '只有 Gemini 订阅（Antigravity）供应商能查这个额度' });
    const account = String(body.account || '').trim();
    if (account && !/^[a-z0-9_-]{1,32}$/i.test(account)) return reply.code(400).send({ ok: false, error: '账号 id 不合法' });
    try {
      return reply.send(await usage.probe({ models: Array.isArray(p.models) ? p.models : [], account: account || null, force: body.force === true }));
    } catch (e) {
      console.error('[gemini-usage] error:', e && e.message);
      return reply.send({ ok: false, error: '查询失败' });
    }
  });
};
