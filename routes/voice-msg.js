'use strict';
// voice-msg.js（路由）—— 语音消息（10-23，逻辑在 lib/voice-msg.js）
//   POST /v1/voice/send {audio:<16k 单声道 wav 的 base64>, dur:秒}
//        → { ok, id, dur, text }   text=转写+说话方式标注；音频存 data/uploads/voice-<id>.wav，只留最近几条
//   POST /v1/voice/asr {audio}     → { ok, text }   只转文字，不存音频（输入框麦克风用）
module.exports = function (app, deps) {
  const auth = deps && deps.auth;
  const vm = () => require('../lib/voice-msg');
  function wavOf(body) {
    const b64 = String((body && (body.audio || body.data)) || '').trim();
    if (!b64) return { err: '缺少音频数据' };
    let buf; try { buf = Buffer.from(b64, 'base64'); } catch (e) { return { err: '音频解码失败' }; }
    if (!buf || buf.length < 44) return { err: '音频过短或格式错误' };
    return { b64, buf };
  }
  app.post('/v1/voice/send', async (req, reply) => {
    const w = wavOf(req.body); if (w.err) return reply.code(400).send({ error: w.err });
    try {
      const text = await vm().describe(w.b64, 'annotated');
      const id = (!text || text === '［无人声］') ? '' : vm().save(w.buf);   // 没人声的不存，别占那几个保留位
      const dur = Math.max(1, Math.round(Number(req.body.dur) || (w.buf.length - 44) / 32000));
      reply.send({ ok: true, id, dur, text });
    } catch (e) { reply.code(500).send({ error: e.message }); }
  });
  app.post('/v1/voice/asr', async (req, reply) => {
    const w = wavOf(req.body); if (w.err) return reply.code(400).send({ error: w.err });
    try { reply.send({ ok: true, text: await vm().describe(w.b64, 'plain') }); }
    catch (e) { reply.code(500).send({ error: e.message }); }
  });
  // 手机「用途提示词」页（/heartbeat/admin/ 前缀由 nginx 去掉）：GET 读生效中的、POST 存、DELETE 恢复默认
  if (auth) {
    app.get('/admin/voice-desc/prompt', { preHandler: auth }, async (req, reply) => reply.send(vm().adminGet()));
    app.post('/admin/voice-desc/prompt', { preHandler: auth }, async (req, reply) => {
      try { vm().adminSave(req.body || {}); reply.send({ ok: true }); } catch (e) { reply.code(400).send({ ok: false, error: e.message }); }
    });
    app.delete('/admin/voice-desc/prompt', { preHandler: auth }, async (req, reply) => { vm().adminReset(); reply.send({ ok: true }); });
  }
};
