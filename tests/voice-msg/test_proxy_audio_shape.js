'use strict';
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// test_proxy_audio_shape.js —— 2026-11-15 语音识别音频形态按出口分档的离线单测（fetch 打桩，不发真请求）
//   1) resolveTarget 三类出口的 proxyKind：直连无 / 普通代理 egress-proxy / 订阅代理 subscription-proxy
//   2) voice-msg.describe 的实际音频参数：订阅代理落站内 /uploads 引用（请求后删临时文件）；普通代理与直连都用 data: base64
// 运行： node tests/voice-msg/test_proxy_audio_shape.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const router = require(path.join(ROOT, 'lib/model-router'));
const upstreamTarget = require(path.join(ROOT, 'lib/upstream-target'));
const voiceMsg = require(path.join(ROOT, 'lib/voice-msg'));

let fail = 0;
function ok(name, cond) { console.log((cond ? 'ok ' : 'FAIL ') + name); if (!cond) fail++; }

process.env.PORT = process.env.PORT || '3000';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

const UP = path.join(ROOT, 'data', 'uploads');
const B64 = 'QUJD';   // 'ABC' 的 base64，够短，也能看出形态
function voiceqCount() { try { return fs.readdirSync(UP).filter(function (n) { return /^voiceq-/.test(n); }).length; } catch (e) { return 0; } }

// ---------- 1) resolveTarget 三类出口的分档 ----------
const provDirect = { id: 'p_direct', name: '直连供应商', api_url: 'https://direct.example.com/v1', api_key: 'sk-direct' };
const provEgress = { id: 'p_egress', name: '普通供应商', api_url: 'https://egress.example.com/v1', api_key: 'sk-egress', proxy_models: ['omni-x'] };
const provSub = { id: 'p_sub', name: 'Gemini 订阅', oauth_provider: 'antigravity', via_anthropic_proxy: true, api_url: 'https://cloudcode.example.com/v1', proxy_models: ['gemini-3.8-flash-medium'] };

const tDirect = upstreamTarget.resolveTarget(provDirect, function (k) { return process.env[k]; }, 'omni-x');
const tEgress = upstreamTarget.resolveTarget(provEgress, function (k) { return process.env[k]; }, 'omni-x');
const tSub = upstreamTarget.resolveTarget(provSub, function (k) { return process.env[k]; }, 'gemini-3.8-flash-medium');

ok('直连：viaProxy=false 且不带 proxyKind', tDirect.viaProxy === false && !tDirect.proxyKind);
ok('普通代理：viaProxy=true + proxyKind=egress-proxy', tEgress.viaProxy === true && tEgress.proxyKind === 'egress-proxy');
ok('普通代理：出口是本机 http-proxy 转发口', /\/internal\/http-proxy\/chat\/completions$/.test(tEgress.url));
ok('订阅代理：viaProxy=true + proxyKind=subscription-proxy', tSub.viaProxy === true && tSub.proxyKind === 'subscription-proxy');
ok('订阅代理：出口是 oauth 翻译代理', /\/internal\/oauth\/chat\/completions$/.test(tSub.url));
ok('订阅代理即使列进 proxy_models 也不会被当成普通代理', upstreamTarget.resolveTarget(provSub, function (k) { return process.env[k]; }, 'omni-x').proxyKind === 'subscription-proxy');

// ---------- 2) describe 的音频形态（fetch 打桩）----------
const realFetch = global.fetch;
const realResolveRole = router.resolveRoleModel;
const calls = [];
global.fetch = async function (url, opts) {
  calls.push({
    url: String(url),
    headers: Object.assign({}, (opts && opts.headers) || {}),
    body: JSON.parse(String((opts && opts.body) || '{}')),
  });
  return { ok: true, status: 200, text: async function () { return JSON.stringify({ choices: [{ message: { content: '转写结果' } }] }); } };
};
function asProvider(prov, model) { router.resolveRoleModel = function () { return { provider: prov, model: model }; }; }

function lastAudioPart() {
  const c = calls[calls.length - 1];
  const part = c && c.body && c.body.messages && c.body.messages[0] && c.body.messages[0].content[0];
  return (part && part.input_audio) || {};
}

(async function () {
  try {
    // 订阅代理（Gemini 订阅，现网配置的那一类）：站内 /uploads 引用，请求完临时文件要删掉
    asProvider(provSub, 'gemini-3.8-flash-medium');
    const beforeSub = voiceqCount();
    await voiceMsg.describe(B64, 'plain');
    const subCall = calls[calls.length - 1];
    const subAudio = lastAudioPart();
    ok('订阅代理：出口是本机 oauth 翻译代理', /\/internal\/oauth\/chat\/completions$/.test(subCall.url));
    ok('订阅代理：音频走站内 /uploads/voiceq-*.wav 引用', /^\/uploads\/voiceq-[A-Za-z0-9-]+\.wav$/.test(String(subAudio.url || '')));
    ok('订阅代理：不带 data: base64（否则翻译代理会剥成「（语音）」占位）', subAudio.data === undefined);
    const tmpName = String(subAudio.url || '').replace(/^\/uploads\//, '');
    ok('订阅代理：请求结束即删临时文件', !tmpName || !fs.existsSync(path.join(UP, tmpName)));
    ok('订阅代理：临时文件数量回落到请求前', voiceqCount() === beforeSub);

    // 普通代理（走 routes/http-proxy.js 原样透传）：必须自带音频内容，不能再写站内引用
    asProvider(provEgress, 'omni-x');
    const beforeEgress = voiceqCount();
    await voiceMsg.describe(B64, 'plain');
    const egCall = calls[calls.length - 1];
    const egAudio = lastAudioPart();
    ok('普通代理：出口是本机 http-proxy 转发口', /\/internal\/http-proxy\/chat\/completions$/.test(egCall.url));
    ok('普通代理：音频走 data: base64（上游只认真实内容）', String(egAudio.data || '').indexOf('data:;base64,') === 0);
    ok('普通代理：不再出现站内 /uploads 引用', egAudio.url === undefined);
    ok('普通代理：不落任何临时文件', voiceqCount() === beforeEgress);
    ok('普通代理：仍带 x-provider-id / x-internal-key / Authorization', egCall.headers['x-provider-id'] === 'p_egress' && !!egCall.headers['x-internal-key'] && /^Bearer /.test(String(egCall.headers.Authorization || '')));

    // 直连（千问这类）：形态与改动前一致，零行为变化
    asProvider(provDirect, 'omni-x');
    const directOut = await voiceMsg.describe(B64, 'plain');
    const drCall = calls[calls.length - 1];
    const drAudio = lastAudioPart();
    ok('直连：补全到 /chat/completions', /\/chat\/completions$/.test(drCall.url));
    ok('直连：音频仍走 data: base64', String(drAudio.data || '').indexOf('data:;base64,') === 0);
    ok('转写结果照常解析', directOut === '转写结果');
  } finally {
    global.fetch = realFetch;
    router.resolveRoleModel = realResolveRole;
  }
  console.log(fail ? ('FAILED ' + fail) : 'ALL PASS');
  process.exitCode = fail ? 1 : 0;
})();
