'use strict';
// routes/worldbook.js —— 动态注入（原世界书）增删改查 + 会话级注入开关接口。
// [位置:routes/worldbook.js] [GET/POST /admin/worldbook · PUT/DELETE /admin/worldbook/:id] [条目全局共用，开关按 session_id 独立存储] [注释时间 2026-11-21]

const worldbook = require('../lib/worldbook');

module.exports = function registerWorldbookRoutes(app, deps) {
  const basicAuth = deps.basicAuth;
  const baseDir = deps.baseDir;

  app.get('/admin/worldbook', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const sid = String((req.query && req.query.session_id) || '').trim();
      const items = worldbook.listForSession(baseDir, sid);
      reply.send({ ok: true, session_id: sid, items });
    } catch (err) {
      reply.code(500).send({ ok: false, error: err.message });
    }
  });

  app.post('/admin/worldbook', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const res = worldbook.createItem(baseDir, body);
      reply.send({ ok: true, item: res.item, items: res.items });
    } catch (err) {
      reply.code(err.statusCode || 500).send({ ok: false, error: err.message });
    }
  });

  app.put('/admin/worldbook/:id', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const id = String((req.params && req.params.id) || '').trim();
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const res = worldbook.updateItem(baseDir, id, body);
      reply.send({ ok: true, item: res.item, items: res.items });
    } catch (err) {
      reply.code(err.statusCode || 500).send({ ok: false, error: err.message });
    }
  });

  app.delete('/admin/worldbook/:id', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const id = String((req.params && req.params.id) || '').trim();
      const sid = String((req.query && req.query.session_id) || (req.body && req.body.session_id) || '').trim();
      const res = worldbook.deleteItem(baseDir, id, sid);
      reply.send({ ok: true, items: res.items });
    } catch (err) {
      reply.code(err.statusCode || 500).send({ ok: false, error: err.message });
    }
  });
};
