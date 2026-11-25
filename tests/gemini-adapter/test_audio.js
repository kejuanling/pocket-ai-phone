'use strict';
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// test_audio.js —— 2026-11-12 Gemini 订阅音频输入的 adapter 翻译与分档加工单测：
//   1) adapter·userPartsOf：input_audio data:URL → inlineData（mime 兜底）；站内 url → 「（语音）」占位；相邻文字合并
//   2) oauth-proxy·prepareCloudCodeAudio：gemini 档只内联最后一条（真实 voice wav）、其余剥占位；claude 档全剥；无音频返回 ''
// 运行： node tests/gemini-adapter/test_audio.js
const fs = require('fs');
const path = require('path');
const gm = require(require('path').join(PROJECT_ROOT, 'lib/gemini-adapter'));
const proxyInternal = require(require('path').join(PROJECT_ROOT, 'routes/oauth-proxy'))._internal;

let fail = 0;
function ok(name, cond) { console.log((cond ? 'ok ' : 'FAIL ') + name); if (!cond) fail++; }

// ---- 1) adapter ----
{
  const req = gm.toRequest({ messages: [{ role: 'user', content: [
    { type: 'text', text: '听一下这段' },
    { type: 'input_audio', input_audio: { data: 'data:;base64,' + 'QUJD', format: 'wav' } },
    { type: 'text', text: '然后回答' },
    { type: 'input_audio', input_audio: { url: '/uploads/voice-x.wav', format: 'wav' } },
  ] }] }, {});
  const parts = req.contents[0].parts;
  ok('data: 翻成 inlineData 且 audio/wav 兜底', parts.some(p => p.inlineData && p.inlineData.mimeType === 'audio/wav' && p.inlineData.data === 'QUJD'));
  const textPart = parts.filter(p => p.text).map(p => p.text).join('|');
  ok('站内 url 落占位（与图片一致并入相邻文字）', textPart === '听一下这段|然后回答（语音）');
}
{
  const req = gm.toRequest({ messages: [{ role: 'user', content: [
    { type: 'input_audio', input_audio: { data: 'data:audio/mpeg;base64,XYZ' } },
  ] }] }, {});
  const p = req.contents[0].parts[0];
  ok('data: 自带 mime 优先', p.inlineData && p.inlineData.mimeType === 'audio/mpeg');
}
{
  const req = gm.toRequest({ messages: [{ role: 'user', content: '纯文字不受影响' }] }, {});
  ok('纯文本无音频不产出 inlineData', req.contents[0].parts.every(p => !p.inlineData));
}

// ---- 2) prepareCloudCodeAudio（用真实 voice wav）----
(async () => {
  const dir = require('path').join(PROJECT_ROOT, 'data/uploads');
  const wav = fs.readdirSync(dir).filter(f => /^voice-[\w-]+\.wav$/.test(f))
    .map(f => ({ f, s: fs.statSync(path.join(dir, f)).size })).sort((a, b) => a.s - b.s)[0].f;
  const url = '/uploads/' + wav;
  const mkBody = () => ({ messages: [
    { role: 'user', content: [
      { type: 'text', text: '[语音消息 3秒 #old] 旧的语音转写' },
      { type: 'input_audio', input_audio: { url: url, format: 'wav' } },
    ] },
    { role: 'assistant', content: '好' },
    { role: 'user', content: [
      { type: 'text', text: '[语音消息 5秒 #new] 最新的语音转写' },
      { type: 'input_audio', input_audio: { url: url, format: 'wav' } },
    ] },
  ] });

  // gemini 档：只内联最后一条（input_audio 变 data:），旧的剥占位
  let body = mkBody();
  const m1 = await proxyInternal.prepareCloudCodeAudio(body, {}, 'gemini-3.8-flash-medium', 'antigravity');
  const c0 = body.messages[0].content, c2 = body.messages[2].content;
  ok('gemini 档返回 inline:2条(剥1)', m1 === 'inline:2条(剥1)');
  ok('旧语音剥成（语音）占位', c0.some(p => p.type === 'text' && p.text === '（语音）'));
  const last = c2.find(p => p.type === 'input_audio');
  ok('最后一条内联成 data:audio/wav;base64', !!(last && last.input_audio && /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/.test(last.input_audio.data)));

  // claude 档：全剥占位，不读文件
  body = mkBody();
  const m2 = await proxyInternal.prepareCloudCodeAudio(body, {}, 'claude-sonnet-5-5-medium', 'antigravity');
  const audioLeft = body.messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'input_audio'));
  ok('claude 档返回 placeholder:2条(剥2)', m2 === 'placeholder:2条(剥2)');
  ok('claude 档音频全部剥光', !audioLeft);

  // 无音频：空串零开销
  const m3 = await proxyInternal.prepareCloudCodeAudio({ messages: [{ role: 'user', content: 'hi' }] }, {}, 'gemini-3.8-flash-medium', 'antigravity');
  ok('无音频返回空串', m3 === '');

  // 文件不存在的引用：gemini 档也安全剥占位，不炸
  body = { messages: [{ role: 'user', content: [
    { type: 'input_audio', input_audio: { url: '/uploads/voice-gone-xxx.wav', format: 'wav' } },
  ] }] };
  const m4 = await proxyInternal.prepareCloudCodeAudio(body, {}, 'gemini-3.8-flash-medium', 'antigravity');
  ok('文件缺失时剥占位不炸', m4 === 'placeholder:1条(剥1)');

  console.log(fail ? 'FAIL ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST ERR', e); process.exit(1); });
