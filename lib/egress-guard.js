'use strict';
// egress-guard.js —— 出海流量的出口守卫（fail-closed）。
//
// 海外模型请求必须经已配置的 HTTP 代理发出。代理地址与预期出口 IP 都来自环境变量，
// 发布树不包含任何现网节点、供应商实例或出口地址默认值。未配置、探测失败或出口不符时，
// 在本地拦截，绝不回退直连。可选的供应商容器/节点重连不在本模块写死。
//
// 环境变量（从前往后取第一个非空）：
//   代理 URL：EGRESS_PROXY / CLAUDE_OAUTH_PROXY / AIRPORT_PROXY
//   预期出口 IP：EGRESS_EXPECT_IP / CLAUDE_EGRESS_EXPECT_IP
// 探测：经代理请求 api.ipify.org。探测本身走裸 https.request + 代理，不调用 ensure()。
// 缓存：成功 30 秒，失败 10 秒；配置缺失不缓存。

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { HttpsProxyAgent } = require('https-proxy-agent');

function proxyUrl() {
  return String(process.env.EGRESS_PROXY || process.env.CLAUDE_OAUTH_PROXY || process.env.AIRPORT_PROXY || '').trim();
}
function expectIp() {
  return String(process.env.EGRESS_EXPECT_IP || process.env.CLAUDE_EGRESS_EXPECT_IP || '').trim();
}
function requireProxyUrl() {
  const p = proxyUrl();
  if (!p) {
    const e = new Error('出口代理未配置，已在本地拦截（请求未发出）');
    e.code = 'EGRESS_DENIED';
    e.egress = { ok: false, reason: 'proxy_not_configured' };
    throw e;
  }
  return p;
}
const PROBE_TIMEOUT_MS = 8000;
const OK_TTL_MS = 30000;
const FAIL_TTL_MS = 10000;

let cache = { at: 0, ok: false, ip: null, reason: 'not_probed' };
let inflight = null;
let probing = false;
let testProbe = null;

function probeOnce() {
  if (typeof testProbe === 'function') {
    return Promise.resolve().then(function () { return testProbe(); });
  }
  return new Promise(function (resolve) {
    let req;
    try {
      req = https.request({
        hostname: 'api.ipify.org',
        path: '/',
        method: 'GET',
        agent: new HttpsProxyAgent(proxyUrl()),
        timeout: PROBE_TIMEOUT_MS,
        headers: { 'user-agent': 'minis-egress-guard' },
      }, function (res) {
        let buf = '';
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          const ip = String(buf || '').trim();
          if (res.statusCode === 200 && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            if (ip === expectIp()) return resolve({ ok: true, ip: ip, reason: '' });
            return resolve({ ok: false, ip: ip, reason: 'egress_ip_mismatch:' + ip });
          }
          resolve({ ok: false, ip: null, reason: 'probe_http_' + res.statusCode });
        });
      });
    } catch (e) {
      return resolve({ ok: false, ip: null, reason: 'probe_init:' + e.message });
    }
    req.on('timeout', function () { req.destroy(new Error('probe_timeout')); });
    req.on('error', function (e) { resolve({ ok: false, ip: null, reason: 'proxy_unreachable:' + e.message }); });
    req.end();
  });
}

// 返回 { ok, ip, reason, at }；永不抛错——调用方按 ok 决定放行还是拦截
async function ensure() {
  // 探测过程中若有人把 https.request 钩进 ensure，直接放行这次自探测，绝不对 inflight 再等待（会死锁）。
  if (probing) return { ok: true, ip: cache.ip, reason: 'self_probe', at: Date.now() };
  const now = Date.now();
  const ttl = cache.ok ? OK_TTL_MS : FAIL_TTL_MS;
  if (cache.at && now - cache.at < ttl) return cache;
  if (inflight) return inflight;
  if (typeof testProbe !== 'function') {
    if (!proxyUrl()) {
      return { at: Date.now(), ok: false, ip: null, reason: 'proxy_not_configured' };
    }
    if (!expectIp()) {
      return { at: Date.now(), ok: false, ip: null, reason: 'expect_ip_not_configured' };
    }
  }
  /* 网络层失败时立即重试一次（出口 IP 不符不重试）。 */
  probing = true;
  inflight = probeOnce().then(function (r) {
    if (!r.ok && /proxy_unreachable|probe_http_5|probe_error|timeout/i.test(String(r.reason || ''))) {
      return probeOnce().then(function (r2) { return r2.ok ? r2 : r; });
    }
    return r;
  }).then(function (r) {
    cache = { at: Date.now(), ok: !!r.ok, ip: r.ip, reason: r.reason };
    inflight = null;
    probing = false;
    return cache;
  }, function (e) {
    cache = { at: Date.now(), ok: false, ip: null, reason: 'probe_error:' + (e && e.message || e) };
    inflight = null;
    probing = false;
    return cache;
  });
  return inflight;
}

function status() {
  return {
    proxy: proxyUrl(),
    expected_ip: expectIp(),
    ok: cache.ok,
    ip: cache.ip,
    reason: cache.reason,
    checked_at: cache.at ? new Date(cache.at).toISOString() : null,
    age_ms: cache.at ? Date.now() - cache.at : null,
  };
}

// 主动让缓存失效（例如刚发生过一次上游连接错误）
function invalidate() { cache = { at: 0, ok: false, ip: null, reason: 'invalidated' }; }

/* [位置:lib/egress-guard.js·publicReason] [对外原因脱敏] [API/日志里只保留守卫原因，去掉 URL 里的 user:pass，避免把代理凭证带出去] [注释时间 2026-11-25] */
function publicReason(reason) {
  let s = String(reason == null ? 'egress_denied' : reason).slice(0, 200);
  s = s.replace(/:\/\/[^/@\s]+:[^/@\s]+@/g, '://***@');
  return s;
}

function deniedError(g) {
  const reason = publicReason(g && g.reason);
  const e = new Error('出口线路不可用，已在本地拦截（请求未发出）：' + reason);
  e.code = 'EGRESS_DENIED';
  e.egress = { ok: false, reason: reason };
  return e;
}

async function assertOk() {
  const g = await ensure();
  if (!g.ok) throw deniedError(g);
  return g;
}

function denyReply(reply, g, label) {
  const msg = (label || '出口') + '线路不可用，已在本地拦截（请求未发出）：' + publicReason(g && g.reason);
  if (reply && typeof reply.code === 'function') {
    reply.code(503).send({ error: { message: msg, type: 'egress_unavailable', code: 503 } });
  }
  return msg;
}

function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\[|\]/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1';
}

// 已知必须走代理的海外 API 主机。工具循环若把这类地址交给默认 fetch（不经内部代理），不得裸出。
const OVERSEAS_HOST_RE = /(^|\.)(googleapis\.com|anthropic\.com|openai\.com|chatgpt\.com|x\.ai|claude\.ai|openai\.azure\.com)$/i;

function isOverseasApiHost(hostname) {
  return OVERSEAS_HOST_RE.test(String(hostname || ''));
}

/* [位置:lib/egress-guard.js·applyProxyOpts] [给出站请求挂上已配置代理] [https 用 HttpsProxyAgent；http 目标改写为向代理发绝对 URL，避免声明走代理却裸出] [注释时间 2026-11-25；改动：代理 URL 必填，无现网默认] */
function applyProxyOpts(opts, target) {
  const u = (typeof target === 'string') ? new URL(target) : target;
  opts = opts || {};
  const proxy = requireProxyUrl();
  if (u.protocol === 'https:') {
    opts.agent = new HttpsProxyAgent(proxy);
    return opts;
  }
  if (u.protocol === 'http:') {
    const p = new URL(proxy);
    const headers = Object.assign({}, opts.headers || {});
    if (!headers.Host && !headers.host) headers.Host = u.host;
    opts.hostname = p.hostname;
    opts.port = p.port || (p.protocol === 'https:' ? 443 : 80);
    opts.path = u.href;
    opts.headers = headers;
    if (opts.agent) delete opts.agent;
    return opts;
  }
  return opts;
}

async function fetchViaProxy(url, init) {
  let undici = null;
  try { undici = require('undici'); } catch (e) { undici = null; }
  if (undici && undici.ProxyAgent && typeof undici.fetch === 'function') {
    const dispatcher = new undici.ProxyAgent(requireProxyUrl());
    const opts = Object.assign({}, init || {}, { dispatcher: dispatcher });
    return undici.fetch(url, opts);
  }
  return fetchViaHttpsAgent(url, init || {});
}

function fetchViaHttpsAgent(url, init) {
  const u = new URL(String(url));
  const isHttps = u.protocol === 'https:';
  const method = String((init && init.method) || 'GET').toUpperCase();
  const body = init && init.body != null ? Buffer.from(String(init.body)) : null;
  const headers = Object.assign({}, (init && init.headers) || {});
  if (body && headers['content-length'] == null && headers['Content-Length'] == null) {
    headers['content-length'] = body.length;
  }
  const opts = applyProxyOpts({
    method: method,
    hostname: u.hostname,
    port: u.port || undefined,
    path: u.pathname + u.search,
    headers: headers,
  }, u);
  const transport = isHttps ? https : http;
  return new Promise(function (resolve, reject) {
    const req = transport.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const buf = Buffer.concat(chunks);
        resolve(new Response(buf, { status: res.statusCode, headers: res.headers }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (init && init.signal) {
      if (init.signal.aborted) req.destroy(new Error('已取消'));
      else init.signal.addEventListener('abort', function () { req.destroy(new Error('已取消')); }, { once: true });
    }
    if (body) req.end(body);
    else req.end();
  });
}

/* [位置:lib/egress-guard.js·wrapFetchFn] [工具循环出海闸门] [海外官方域名若被直接 fetch，先 ensure 再经已配置代理发出，绝不裸奔；本机与国内直连主机不改] [注释时间 2026-11-25；改动：去掉写死代理端口] */
function wrapFetchFn(fetchFn) {
  const fn = fetchFn || fetch;
  return async function protectedFetch(url, init) {
    let u;
    try { u = new URL(String(url)); } catch (e) { return fn(url, init); }
    if (isLocalHost(u.hostname)) return fn(url, init);
    if (!isOverseasApiHost(u.hostname)) return fn(url, init);
    await assertOk();
    return fetchViaProxy(url, init);
  };
}

function _setProbeForTest(fn) { testProbe = fn; }
function _resetForTest() {
  testProbe = null;
  cache = { at: 0, ok: false, ip: null, reason: 'not_probed' };
  inflight = null;
  probing = false;
}
function _isProbing() { return probing; }

module.exports = {
  ensure: ensure,
  assertOk: assertOk,
  deniedError: deniedError,
  denyReply: denyReply,
  publicReason: publicReason,
  applyProxyOpts: applyProxyOpts,
  wrapFetchFn: wrapFetchFn,
  isLocalHost: isLocalHost,
  isOverseasApiHost: isOverseasApiHost,
  status: status,
  invalidate: invalidate,
  proxyUrl: proxyUrl,
  expectIp: expectIp,
  requireProxyUrl: requireProxyUrl,
  _setProbeForTest: _setProbeForTest,
  _resetForTest: _resetForTest,
  _isProbing: _isProbing,
};
Object.defineProperty(module.exports, 'PROXY', { enumerable: true, get: proxyUrl });
Object.defineProperty(module.exports, 'EXPECT_IP', { enumerable: true, get: expectIp });
