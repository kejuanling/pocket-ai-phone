'use strict';
// image-desc.js（路由）—— 手机「用途提示词」页图片转写提示词的读/存/恢复默认。
// 转写本体在 lib/image-desc.js；模型选择走 /admin/model-roles/:role（role=image_desc）。
module.exports = function (app, deps) {
  const auth = deps && deps.auth;
  if (!auth) return;
  const lib = () => require('../lib/image-desc');
  app.get('/admin/image-desc/prompt', { preHandler: auth }, async (req, reply) => reply.send(lib().adminGet()));
  app.post('/admin/image-desc/prompt', { preHandler: auth }, async (req, reply) => {
    try { lib().adminSave(req.body || {}); reply.send({ ok: true }); }
    catch (e) { reply.code(400).send({ ok: false, error: e.message }); }
  });
  app.delete('/admin/image-desc/prompt', { preHandler: auth }, async (req, reply) => { lib().adminReset(); reply.send({ ok: true }); });
};
