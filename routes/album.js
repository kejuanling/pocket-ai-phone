'use strict';
// album.js（路由）—— 相册接口（10-23，数据与逻辑在 lib/album.js）：
//   小手机用 /v1/album*（网关 key / 已登录，沿用 server.js 全局鉴权）：
//     GET  /v1/album?offset&limit          列表（新的在前）
//     POST /v1/album/add   {img|url, session_id?, msg_id?, source?('chat'|'upload'), note?}  加入相册（by=her）
//     POST /v1/album/note  {id, note}      改批注（她写的）
//     POST /v1/album/desc  {id, desc}      改描述
//     DELETE /v1/album/:id                 删除（只删引用，文件还在；删前自动备份整表）
//   AI 工具 album 用 /internal/album/*（x-internal-key，by=ai；AI 只能删自己加的）：
//     GET /internal/album/list  GET /internal/album/get?id=  POST /internal/album/add|note|delete
module.exports = function (app, deps) {
  const album = () => require('../lib/album').get();
  const send = (reply, r) => { if (r && r.ok === false) reply.code(400); reply.send(r); };

  app.get('/v1/album', async (req, reply) => {
    const q = req.query || {};
    reply.send(Object.assign({ ok: true }, album().list({ offset: q.offset, limit: q.limit })));
  });
  app.post('/v1/album/add', async (req, reply) => {
    const b = req.body || {};
    send(reply, album().add({ img: b.img || b.url, by: 'her', source: b.source, note: b.note, session_id: b.session_id, msg_id: b.msg_id }));
  });
  app.post('/v1/album/note', async (req, reply) => {
    const b = req.body || {};
    send(reply, album().setNote(b.id, b.note, 'her'));
  });
  app.post('/v1/album/desc', async (req, reply) => {
    const b = req.body || {};
    send(reply, album().setDesc(b.id, b.desc));
  });
  app.delete('/v1/album/:id', async (req, reply) => {
    send(reply, album().remove(String(req.params.id || ''), 'her'));
  });

  // ---- AI 工具用 ----
  app.get('/internal/album/list', async (req, reply) => {
    const q = req.query || {};
    reply.send(Object.assign({ ok: true }, album().list({ offset: q.offset, limit: q.limit || 30 })));
  });
  app.get('/internal/album/get', async (req, reply) => {
    const it = album().find((req.query || {}).id);
    if (!it) { reply.code(404).send({ ok: false, error: '相册里没有这张' }); return; }
    reply.send({ ok: true, item: it });
  });
  app.post('/internal/album/add', async (req, reply) => {
    const b = req.body || {};
    send(reply, album().add({ img: b.img || b.id, by: 'ai', source: 'chat', note: b.note, session_id: b.session_id }));
  });
  app.post('/internal/album/note', async (req, reply) => {
    const b = req.body || {};
    send(reply, album().setNote(b.id, b.note, 'ai'));
  });
  app.post('/internal/album/delete', async (req, reply) => {
    const b = req.body || {};
    send(reply, album().remove(String(b.id || ''), 'ai'));
  });
};
