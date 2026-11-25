'use strict';
// anthropic-proxy.js —— 把「OpenAI Chat Completions 兼容请求」翻译成 Anthropic 原生 Messages 请求并回译。
//
// 为什么是内部路由：聊天主链路 / MCP 工具循环 / 后台 postChatStream 三处出口都只会说
// OpenAI 兼容协议。claude 供应商的 api_url 指向本路由后，三处出口一行都不用改。
//
// 路由：POST /internal/anthropic/chat/completions
//   鉴权：沿用 server.js 全局 onRequest 钩子对 /internal/ 前缀的 x-internal-key 校验（本文件不另写）。
//   上游地址与密钥：不从请求体里取，而由请求头指定「供应商 id」，在服务端读 ai-providers.json，
//   密钥不经过任何调用方。请求头：x-provider-id。
//
// 供应商配置（ai-providers.json 里该条目的可选字段）：
//   anthropic_base   上游基地址，缺省 https://api.anthropic.com
//   auth_type        "api_key"（默认，x-api-key）或 "bearer"（Authorization: Bearer，另带 oauth beta 头）
//   thinking_budget  整数，>0 时开启扩展思考
//   max_tokens       缺省 max_tokens
//   anthropic_beta   额外的 anthropic-beta 头（逗号分隔）
//
// 注意：本文件只做转发与格式翻译，不做任何「伪装官方客户端」的处理。

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const adapter = require('../lib/anthropic-adapter');
const claudeToken = require('../lib/claude-token');
const oauthCommon = require('../lib/oauth-common');
const pool = require('../lib/oauth-pool');
const egressGuard = require('../lib/egress-guard');
const { HttpsProxyAgent } = require('https-proxy-agent');

const ANTHROPIC_VERSION = '2023-06-01';
const OAUTH_BETA = 'oauth-2025-04-20';
const DEFAULT_BASE = 'https://api.anthropic.com';
// OAuth（订阅账号）供应商的出海代理：火种 VPN 容器里的 xray mixed 入站。
// 大陆直连 Anthropic 会被回 region_unavailable，这是唯一能通的一条路。
function defaultOAuthProxy() { return require('../lib/egress-guard').requireProxyUrl(); }
const IDLE_TIMEOUT_MS = 600000;

function loadProvider(baseDir, id) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'ai-providers.json'), 'utf-8'));
    const list = Array.isArray(cfg) ? cfg : (Array.isArray(cfg.providers) ? cfg.providers : []);
    return list.find(function (p) { return p && p.id === id; }) || null;
  } catch (e) { return null; }
}

async function buildHeaders(prov, account, wantEffort) {
  const h = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  };
  let key = String(prov.api_key || '').trim();
  const betas = [];
  const isClaudeOAuth = String(prov.oauth_provider || '') === 'claude';
  if (isClaudeOAuth) {
    // 订阅账号的 access token 由账号池按需刷新（多账号时按传进来的账号取），前端永远不接触它
    key = await pool.token('claude', account);
  }
  if (isClaudeOAuth || String(prov.auth_type || 'api_key') === 'bearer') {
    h.authorization = 'Bearer ' + key;
    betas.push(OAUTH_BETA);
  } else {
    h['x-api-key'] = key;
  }
  if (isClaudeOAuth) {
    // 聊天端点也要带 CLI 指纹头 + 全套 beta。只带一个 oauth beta 时上游会按第三方流量处理，
    // 而"身份行"是另一道硬门槛（见 lib/anthropic-adapter.js 的 oauthIdentity）。
    // 指纹头与令牌端点共用 lib/claude-token 里的同一份定义，避免两边漂移。
    Object.assign(h, claudeToken.CLI_HEADERS);
    claudeToken.CLI_BETAS.forEach(function (b) { if (betas.indexOf(b) === -1) betas.push(b); });
  } else if (wantEffort && betas.indexOf('effort-2025-11-24') === -1) {
    // API Key 供应商经本代理开思考档位时也要带 effort beta（订阅路径 CLI_BETAS 已含）
    betas.push('effort-2025-11-24');
  }
  if (prov.anthropic_beta) {
    String(prov.anthropic_beta).split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (b) {
      if (betas.indexOf(b) === -1) betas.push(b);
    });
  }
  if (betas.length) h['anthropic-beta'] = betas.join(',');
  return h;
}

function upstreamUrl(prov) {
  const base = String(prov.anthropic_base || DEFAULT_BASE).replace(/\/+$/, '');
  return base.replace(/\/v1$/, '') + '/v1/messages';
}

// 发起上游请求，返回 Node IncomingMessage（调用方自行消费）
function postUpstream(url, headers, bodyStr, abortSignal, agent) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('上游 URL 非法: ' + url)); }
    const mod = u.protocol === 'http:' ? http : https;
    const buf = Buffer.from(bodyStr, 'utf8');
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: (u.pathname || '/') + (u.search || ''), method: 'POST',
      agent: agent || undefined,
      headers: Object.assign({ 'content-length': buf.length }, headers),
    }, resolve);
    req.setTimeout(IDLE_TIMEOUT_MS, function () {
      const e = new Error('Anthropic 上游空闲超时 [ETIMEDOUT]'); e.code = 'ETIMEDOUT'; req.destroy(e);
    });
    req.on('error', reject);
    if (abortSignal) {
      if (abortSignal.aborted) { req.destroy(new Error('已取消')); }
      else abortSignal.addEventListener('abort', function () { req.destroy(new Error('已取消')); }, { once: true });
    }
    req.write(buf);
    req.end();
  });
}

function readAll(res) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { raw += c; });
    res.on('end', function () { resolve(raw); });
    res.on('error', reject);
  });
}

// 把 Anthropic 的错误体整理成 OpenAI 风格错误，便于上层按既有逻辑（如 402/429 提醒）处理
function openaiError(status, raw) {
  let msg = String(raw || '').slice(0, 500);
  let type = 'upstream_error';
  try {
    const j = JSON.parse(raw);
    if (j && j.error) { msg = String(j.error.message || msg); type = String(j.error.type || type); }
  } catch (e) { /* 保持原文 */ }
  return { error: { message: msg, type: type, code: status } };
}

module.exports = function registerAnthropicProxy(app, ctx) {
  const baseDir = (ctx && ctx.baseDir) || path.join(__dirname, '..');

  app.post('/internal/anthropic/chat/completions', async function (req, reply) {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const pid = String(req.headers['x-provider-id'] || '').trim();
    const prov = pid ? loadProvider(baseDir, pid) : null;
    if (!prov) { reply.code(400).send({ error: { message: '缺少或未知的 x-provider-id', type: 'bad_request' } }); return; }
    const isClaudeOAuthEntry = String(prov.oauth_provider || '') === 'claude';
    if (!isClaudeOAuthEntry && !String(prov.api_key || '').trim()) { reply.code(400).send({ error: { message: '该供应商未配置令牌', type: 'bad_request' } }); return; }

    const wantStream = body.stream === true;
    const aReq = adapter.toAnthropicRequest(body, {
      maxTokens: Number.isInteger(prov.max_tokens) ? prov.max_tokens : undefined,
      thinkingBudget: Number.isInteger(prov.thinking_budget) ? prov.thinking_budget : undefined,
      // 订阅凭证的硬性要求：system 第一块必须是 Claude Code 身份行（API Key 供应商不受影响）
      oauthIdentity: isClaudeOAuthEntry ? claudeToken.OAUTH_IDENTITY_PROMPT : '',
      // 11-04 Claude 加强缓存：会话开关经请求头带过来；缺省 5 分钟缓存
      cacheTtl: String(req.headers['x-claude-cache-ttl'] || '').trim() === '1h' ? '1h' : '',
    });
    aReq.stream = wantStream;
    if (!aReq.model) aReq.model = String(prov.model || '');

    /* [位置:routes/anthropic-proxy.js·缓存断点日志] [每次请求打一行四层断点落点+内容指纹] [需求：11-06 主会话三次「命中 74464/新建约 4 万」，网关此前不落请求体、只能靠 token 数反推；这一行能直接看出是人设(sys0)/注入块(sys1)/状态块(msgN)/尾巴(msgM) 哪一层 hash 变了，也能看出两条出口（聊天/唤醒）同一份历史的图块数与断点是否一致。CACHE_BP_LOG=0 可关] [注释时间 2026-11-06] */
    try {
      if (String(process.env.CACHE_BP_LOG || '') !== '0') {
        const _bps = adapter.describeCacheBreakpoints(aReq);
        let _imgs = 0, _chars = 0;
        for (const _m of (aReq.messages || [])) {
          for (const _b of (_m.content || [])) {
            if (!_b) continue;
            if (_b.type === 'image') _imgs++;
            else if (typeof _b.text === 'string') _chars += _b.text.length;
          }
        }
        const _sid = String(req.headers['x-session-id'] || '').trim() || '-';
        console.log('[cache-bp] session=' + _sid + ' model=' + aReq.model + ' msgs=' + (aReq.messages || []).length
          + ' tools=' + ((aReq.tools && aReq.tools.length) || 0) + ' images=' + _imgs + ' textchars=' + _chars
          + ' | ' + _bps.map(function (b) { return b.where + '=' + b.hash + '/' + b.chars + '/' + b.ttl; }).join(' '));
      }
    } catch (_bpErr) { /* 诊断失败不影响请求 */ }

    const ctrl = new AbortController();
    // 客户端断开则取消上游，避免白白消耗额度。
    // 必须监听「响应」socket 的 close，不能监听请求：Node 新版本里请求体读完后 req 的 close 就会触发，
    // 此时响应还没开始，监听 req 会把刚发出的上游请求立刻取消（e2e 实测全部 502）。
    reply.raw.on('close', function () { if (!reply.raw.writableEnded) ctrl.abort(); });

    // 出口守卫：凡将挂代理出海的请求，代理不通或出口不符时本地拦下，绝不回退直连。
    // 2026-11-25：条件从「仅 oauth_provider===claude」改为「实际会走代理的路径」（含 oauth_proxy）。
    if (isClaudeOAuthEntry || prov.oauth_proxy) {
      const g = await egressGuard.ensure();
      if (!g.ok) {
        egressGuard.denyReply(reply, g, 'Claude 出口');
        return;
      }
    }

    // 打开上游连接。抽成函数是因为 401 兜底要原样重放一次同一个请求。
    /* [位置:routes/anthropic-proxy.js·openUpstream] [Claude 订阅的选号与 401/429 自愈] [多账号时自动挑能用的号、被限流就换下一个、令牌被作废就先强刷一次] [注释时间 2026-10-22] */
    async function openUpstream(account) {
      let agent = null;
      if (isClaudeOAuthEntry || prov.oauth_proxy) {
        const g = await egressGuard.ensure();
        if (!g.ok) throw egressGuard.deniedError(g);
        agent = new HttpsProxyAgent(String(prov.oauth_proxy || defaultOAuthProxy()));
      }
      return postUpstream(upstreamUrl(prov), await buildHeaders(prov, account, !!(aReq.output_config && aReq.output_config.effort)), JSON.stringify(aReq), ctrl.signal, agent);
    }

    // 账号池：同一家可能挂了多个号。按「能用的在前」的顺序试，最多 3 个。
    const accounts = isClaudeOAuthEntry ? pool.candidates('claude').ordered.slice(0, 3) : [null];
    if (isClaudeOAuthEntry && !accounts.length) {
      reply.code(503).send({
        error: { message: 'Claude 订阅还没有登录任何账号，到设置页点「登录」授权一下', type: 'oauth_reauth_required', code: 503 },
      });
      return;
    }

    let up = null;
    let status = 0;
    let preRead = null;
    let usedAccount = accounts[0];

    for (let idx = 0; idx < accounts.length; idx++) {
      const acct = accounts[idx];
      usedAccount = acct;
      try {
        up = await openUpstream(acct);
      } catch (e) {
        if (e && e.code === 'EGRESS_DENIED') {
          egressGuard.denyReply(reply, e.egress || { reason: e.message }, 'Claude 出口');
          return;
        }
        const authIssue = !!(e && (e.oauth || e.needsReauth || e.fatal));
        if (authIssue && idx < accounts.length - 1) continue; // 这个号取不到令牌：有下一个就换
        if (authIssue) {
          let hint = '';
          try {
            const st = claudeToken.status(acct);
            if (st && st.needs_reauth) hint = '登录已失效（' + (st.needs_reauth_reason || '令牌被拒') + '），到设置页点「登录」重新授权';
          } catch (e2) { /* 状态读不出来不影响报错 */ }
          reply.code(503).send({
            error: {
              message: 'Claude 订阅令牌不可用：' + (e && e.message || e) + (hint ? '；' + hint : ''),
              type: hint ? 'oauth_reauth_required' : 'oauth_token_error',
              code: 503,
            },
          });
          return;
        }
        // 连接层失败：让下次请求重新探测出口，避免缓存里那个「还活着」蒙混过关。
        // 令牌问题不算出口问题，别顺手把出口守卫的结果作废掉。
        if (isClaudeOAuthEntry) egressGuard.invalidate();
        reply.code(502).send({ error: { message: '连接 Anthropic 上游失败：' + (e && e.message || e), type: 'upstream_connect_error' } });
        return;
      }

      status = up.statusCode || 0;
      preRead = null;

      // 401 兜底（只重放一次，绝不循环）：令牌按本地时钟算还有效，但上游已经不认它了
      // （被吊销、在别处重新登录过、或时钟漂移）。强制刷一次再放一次，用户完全无感。
      // 403 只在响应体明确是鉴权错误时才当令牌问题——HTML 的 Cloudflare 拦截是线路问题，不是凭证问题。
      if (isClaudeOAuthEntry && (status === 401 || status === 403)) {
        preRead = await readAll(up).catch(function () { return ''; });
        const looksAuth = status === 401 || /invalid_token|authentication_error|invalid_grant/i.test(preRead);
        if (looksAuth) {
          oauthCommon.logLine('claude', 'auth-retry', { status: status, account: acct });
          let refreshed = false;
          try {
            await pool.token('claude', acct, { force: true });
            refreshed = true;
          } catch (e) {
            oauthCommon.logFail('claude', 'auth-retry-refresh', e, 0, { account: acct });
          }
          if (refreshed) {
            up = await openUpstream(acct);
            status = up.statusCode || 0;
            preRead = null;
            oauthCommon.logLine('claude', 'auth-retry', { status: status, replay: true, account: acct });
          }
        }
      }

      // 429 = 这个号额度/频率到顶：还有别的号就冷却它、换下一个；只有一个号就原样报给上层
      if (status === 429 && idx < accounts.length - 1) {
        pool.markQuota('claude', acct, '429');
        continue;
      }
      // 强刷后仍然 401/403：这个号的凭证废了，有下一个就换
      if ((status === 401 || status === 403) && idx < accounts.length - 1) {
        oauthCommon.logLine('claude', 'auth-switch', { status: status, account: acct });
        continue;
      }
      break;
    }

    if (status < 200 || status >= 300) {
      const raw = preRead !== null ? preRead : await readAll(up).catch(function () { return ''; });
      const body = openaiError(status, raw);
      // 凭证真废了就把话说明白：让用户看到「去重新登录」，而不是一个裸 401
      if (isClaudeOAuthEntry) {
        try {
          const st = pool.statusOf('claude', usedAccount);
          if (st && st.needs_reauth) {
            body.error.message = 'Claude 订阅登录已失效（' + (st.needs_reauth_reason || 'token 被拒') + '），到设置页点「登录」重新授权一下';
            body.error.type = 'oauth_reauth_required';
          }
        } catch (e) { /* ignore */ }
      }
      reply.code(status).send(body);
      return;
    }

    if (!wantStream) {
      const raw = await readAll(up).catch(function () { return ''; });
      let j;
      try { j = JSON.parse(raw); } catch (e) { reply.code(502).send({ error: { message: '上游返回非 JSON', type: 'upstream_bad_body' } }); return; }
      reply.send(adapter.fromAnthropicResponse(j));
      return;
    }

    // 流式：Anthropic SSE -> OpenAI SSE
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const tr = adapter.createStreamTranslator({ model: aReq.model });
    const parser = adapter.createSSEParser();
    let finished = false;

    function writeChunk(c) { if (!raw.writableEnded) raw.write('data: ' + JSON.stringify(c) + '\n\n'); }
    function finish() {
      if (finished) return; finished = true;
      if (!raw.writableEnded) { raw.write('\n\n'); raw.end(); }
    }

    up.setEncoding('utf8');
    up.on('data', function (chunk) {
      let events;
      try { events = parser.feed(chunk); } catch (e) { events = []; }
      for (const evt of events) {
        const out = tr.push(evt);
        for (const c of out) writeChunk(c);
        if (tr.error) {
          writeChunk({ error: { message: tr.error.message, type: tr.error.type } });
          finish();
          return;
        }
        if (tr.done) { finish(); return; }
      }
    });
    up.on('end', function () {
      // 没收到 message_stop 就结束：流被截断，明确报错而不是静默当成功
      if (!finished && !tr.done) writeChunk({ error: { message: 'Anthropic 流在中途断开（未收到 message_stop）', type: 'upstream_stream_truncated' } });
      finish();
    });
    up.on('error', function (e) {
      writeChunk({ error: { message: '上游流错误：' + (e && e.message || e), type: 'upstream_stream_error' } });
      finish();
    });
  });
};
