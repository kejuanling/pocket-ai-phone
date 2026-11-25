'use strict';
// http-proxy.js（路由）—— 让某个供应商下的某些模型「走代理」出海（10-24 需求 37）。
//   POST /internal/http-proxy/chat/completions
//   鉴权：沿用 server.js 全局 /internal/ 的 x-internal-key 校验。
//   供应商：由请求头 x-provider-id 指定，上游地址和密钥在服务端读 ai-providers.json（密钥不经过调用方）。
//   做法：把请求体原样 POST 到该供应商的 api_url，经已配置的本机代理（无默认地址，
//         环境变量 CLAUDE_OAUTH_PROXY 可改，与 Claude 订阅同一个）发出去，响应（含 SSE 流）原样流式传回。
//   代理不通：直接 502 报错「代理不通」，不会悄悄改成直连。
//   哪些模型走这里：由 lib/upstream-target.js 的 resolveTarget 按供应商的 proxy_models 决定。
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const geminiSig = require('../lib/gemini-tool-sig');
const egressGuard = require('../lib/egress-guard');

function loadProvider(baseDir, id) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'ai-providers.json'), 'utf-8'));
    const list = Array.isArray(cfg) ? cfg : (Array.isArray(cfg.providers) ? cfg.providers : []);
    return list.find(function (p) { return p && p.id === id; }) || null;
  } catch (e) { return null; }
}

module.exports = function (app, deps) {
  const baseDir = (deps && deps.baseDir) || path.join(__dirname, '..');
  app.post('/internal/http-proxy/chat/completions', async function (req, reply) {
    const id = String(req.headers['x-provider-id'] || '').trim();
    const prov = loadProvider(baseDir, id);
    if (!prov || !(prov.api_url || prov.base_url)) return reply.code(404).send({ error: { message: '供应商不存在：' + id } });
    let target;
    try { target = new URL(prov.api_url || prov.base_url); } catch (e) { return reply.code(400).send({ error: { message: '供应商地址不对：' + (prov.api_url || '') } }); }
    // Gemini 3 的 function calling 回放要求 tool_calls 带 thoughtSignature（缺了 400）。
    // 主链路的历史里没有签名载体，这里按上游真实端点判断后补占位签名（详见 lib/gemini-tool-sig.js）。
    // 放在本转发口而不是工具循环里：这里才拿得到「真实上游是哪里」（走代理后 upstreamUrl 已变成 127.0.0.1）。
    let outBody = (req.body && typeof req.body === 'object') ? req.body : {};
    const realUpstream = String(prov.api_url || prov.base_url || '');
    if (geminiSig.isGeminiEndpoint(realUpstream) && Array.isArray(outBody.messages)) {
      outBody = Object.assign({}, outBody, { messages: geminiSig.maybeStamp(outBody.messages, realUpstream) });
    }
    const body = Buffer.from(JSON.stringify(outBody));
    const key = String(prov.api_key || '').trim();
    const headers = { 'content-type': 'application/json', 'content-length': body.length, accept: String(req.headers.accept || 'application/json') };
    if (key) headers.authorization = 'Bearer ' + key;
    if (String(prov.profile || '') === 'claude') { if (key) headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
    // 本路由只转发「配置为走代理」的模型：先校验出口，http/https 都经已配置代理，失败不改直连。
    const g = await egressGuard.ensure();
    if (!g.ok) {
      return reply.code(503).send({ error: { message: egressGuard.denyReply(null, g, '出口'), type: 'egress_unavailable', code: 503 } });
    }
    const isHttps = target.protocol === 'https:';
    const opts = egressGuard.applyProxyOpts({ method: 'POST', hostname: target.hostname, port: target.port || undefined, path: target.pathname + target.search, headers: headers }, target);
    return new Promise(function (resolve) {
      const up = (isHttps ? https : http).request(opts, function (res) {
        try {
          reply.hijack();
          const h = Object.assign({}, res.headers); delete h['transfer-encoding']; delete h.connection;
          h['x-accel-buffering'] = 'no';
          reply.raw.writeHead(res.statusCode || 502, h);
          res.pipe(reply.raw);
          res.on('end', resolve); res.on('error', function () { try { reply.raw.destroy(); } catch (e) {} resolve(); });
        } catch (e) { resolve(); }
      });
      up.on('error', function (e) {
        const msg = '代理不通或上游连不上（走代理的模型）：' + (e && e.message ? e.message : e);
        console.warn('[http-proxy] ' + id + ' ' + msg);
        try {
          if (!reply.raw.headersSent && !reply.sent) reply.code(502).send({ error: { message: msg } });
          else reply.raw.destroy();
        } catch (e2) { /* 连接已断 */ }
        resolve();
      });
      // 调用方（网关别的出口）中途断开：别再替它拉上游。注意不能听 req.raw 的 close——POST 体读完它就触发，会把上游掐掉（socket hang up）
      reply.raw.on('close', function () { if (!reply.raw.writableFinished) { try { up.destroy(); } catch (e) {} } });
      up.end(body);
    });
  });
};
