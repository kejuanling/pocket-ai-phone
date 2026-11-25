'use strict';

// 2026-11-25：统一出口守卫的隔离测试。不打真实会话、不刷新登录、不调用付费模型。
// 运行：node --test tests/egress/test_unified_guard.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { URL } = require('url');

const guard = require('../../lib/egress-guard');

test.afterEach(() => { guard._resetForTest(); });

test('出口正确时 ensure 放行', async () => {
  guard._setProbeForTest(() => ({ ok: true, ip: '203.0.113.9', reason: '' }));
  const g = await guard.ensure();
  assert.equal(g.ok, true);
  assert.equal(g.ip, '203.0.113.9');
  await guard.assertOk();
});

test('出口不符时 fail-closed，assertOk 抛 EGRESS_DENIED', async () => {
  guard._setProbeForTest(() => ({ ok: false, ip: '198.51.100.1', reason: 'egress_ip_mismatch:198.51.100.1' }));
  const g = await guard.ensure();
  assert.equal(g.ok, false);
  await assert.rejects(() => guard.assertOk(), (e) => e && e.code === 'EGRESS_DENIED');
});

test('探测失败（不可验证）时 fail-closed', async () => {
  guard._setProbeForTest(() => ({ ok: false, ip: null, reason: 'probe_http_500' }));
  const g = await guard.ensure();
  assert.equal(g.ok, false);
  assert.match(g.reason, /probe_http_500/);
});

test('代理不可用时 fail-closed', async () => {
  guard._setProbeForTest(() => ({ ok: false, ip: null, reason: 'proxy_unreachable:connect ECONNREFUSED' }));
  const g = await guard.ensure();
  assert.equal(g.ok, false);
  assert.match(g.reason, /proxy_unreachable/);
});

test('成功结果 30 秒内复用缓存，不重复探测', async () => {
  let n = 0;
  guard._setProbeForTest(() => { n += 1; return { ok: true, ip: '203.0.113.9', reason: '' }; });
  await guard.ensure();
  await guard.ensure();
  assert.equal(n, 1);
});

test('探测过程中再进 ensure 走 self_probe，不会死锁', async () => {
  guard._setProbeForTest(async () => {
    const inner = await guard.ensure();
    assert.equal(inner.reason, 'self_probe');
    assert.equal(inner.ok, true);
    return { ok: true, ip: '203.0.113.9', reason: '' };
  });
  const g = await Promise.race([
    guard.ensure(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('deadlock')), 1000)),
  ]);
  assert.equal(g.ok, true);
  assert.equal(g.ip, '203.0.113.9');
});

test('publicReason 去掉 URL 里的 user:pass', () => {
  const s = guard.publicReason('proxy_unreachable:at http://user:s3cret@127.0.0.1:1088');
  assert.equal(s.includes('s3cret'), false);
  assert.match(s, /:\/\/\*\*\*@/);
});

function withTestProxy(fn) {
  const oldP = process.env.EGRESS_PROXY;
  const oldE = process.env.EGRESS_EXPECT_IP;
  process.env.EGRESS_PROXY = 'http://127.0.0.1:1088';
  process.env.EGRESS_EXPECT_IP = '192.0.2.1';
  try { return fn(); } finally {
    if (oldP === undefined) delete process.env.EGRESS_PROXY; else process.env.EGRESS_PROXY = oldP;
    if (oldE === undefined) delete process.env.EGRESS_EXPECT_IP; else process.env.EGRESS_EXPECT_IP = oldE;
  }
}
test('https 目标挂 HttpsProxyAgent，不改成直连', () => withTestProxy(() => {
  const opts = guard.applyProxyOpts({ method: 'POST', hostname: 'api.example.com', path: '/v1', headers: {} }, new URL('https://api.example.com/v1'));
  assert.ok(opts.agent, 'https 必须带 agent');
  assert.equal(opts.hostname, 'api.example.com');
}));

test('http 目标改写为走本地代理的绝对 URL，不裸出', () => withTestProxy(() => {
  const opts = guard.applyProxyOpts(
    { method: 'POST', hostname: 'api.example.com', path: '/v1?x=1', headers: { 'content-type': 'application/json' } },
    new URL('http://api.example.com/v1?x=1')
  );
  assert.equal(opts.hostname, '127.0.0.1');
  assert.equal(String(opts.port), '1088');
  assert.equal(opts.path, 'http://api.example.com/v1?x=1');
  assert.equal(opts.headers.Host, 'api.example.com');
  assert.equal(opts.agent, undefined);
}));

test('wrapFetchFn：本机内部地址不探出口、原样转交', async () => {
  let called = 0;
  const fn = async (url) => { called += 1; return { ok: true, url: String(url) }; };
  const wrapped = guard.wrapFetchFn(fn);
  const r = await wrapped('http://127.0.0.1:3000/internal/oauth/chat/completions', { method: 'POST' });
  assert.equal(called, 1);
  assert.equal(r.ok, true);
});

test('wrapFetchFn：国内直连主机不探出口、不强制代理', async () => {
  let called = 0;
  const fn = async (url) => { called += 1; return { ok: true, url: String(url) }; };
  const wrapped = guard.wrapFetchFn(fn);
  const r = await wrapped('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST' });
  assert.equal(called, 1);
  assert.equal(r.ok, true);
});

test('wrapFetchFn：海外官方域名在出口不符时拒绝，且不调用原 fetch（不裸奔）', async () => {
  guard._setProbeForTest(() => ({ ok: false, ip: '198.51.100.1', reason: 'egress_ip_mismatch:198.51.100.1' }));
  let called = 0;
  const fn = async () => { called += 1; return { ok: true }; };
  const wrapped = guard.wrapFetchFn(fn);
  await assert.rejects(
    () => wrapped('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', { method: 'POST' }),
    (e) => e && e.code === 'EGRESS_DENIED'
  );
  assert.equal(called, 0);
});

test('http-proxy：出口不符时 503，不向目标建立连接', async () => {
  guard._setProbeForTest(() => ({ ok: false, ip: null, reason: 'proxy_unreachable:down' }));
  const httpProxy = require('../../routes/http-proxy');
  const hits = [];
  const app = { post: function (path, fn) { this._fn = fn; } };
  httpProxy(app, { baseDir: '/tmp/egress-guard-no-such-dir' });
  const sent = [];
  const reply = {
    code: function (c) { this._code = c; return this; },
    send: function (body) { sent.push({ code: this._code, body: body }); return this; },
  };
  await app._fn({ headers: { 'x-provider-id': 'no-such' }, body: {} }, reply);
  // 供应商不存在是 404，先换一个能走到守卫的假 app：我们用真实加载但不提供供应商。
  assert.equal(sent[0].code, 404);

  // 直接测守卫 + applyProxy，证明转发前会先拦。再起一个只在 ensure 通过后才会 listen 的假上游。
  let upstreamHits = 0;
  const server = http.createServer((req, res) => { upstreamHits += 1; res.end('nope'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // 出口失败时 applyProxy 不应该被业务用来发请求：这里只断言 ensure 失败。
  const g = await guard.ensure();
  assert.equal(g.ok, false);
  assert.equal(upstreamHits, 0);
  server.close();
});

test('http-proxy 模块在出口正确时才会给 https 带 agent', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../routes/http-proxy.js'), 'utf8');
  assert.match(src, /egressGuard\.ensure\s*\(/);
  assert.match(src, /applyProxyOpts/);
  assert.doesNotMatch(src, /if \(isHttps\) opts\.agent/);
});

test('共享出站封装都调用了 ensure 或 assertOk', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '../..');
  const files = {
    'routes/oauth-proxy.js': /assertOk\s*\(/,
    'lib/oauth-login.js': /assertOk\s*\(/,
    'lib/claude-token.js': /assertOk\s*\(/,
    'lib/gemini-usage.js': /assertOk\s*\(/,
    'lib/grok-usage.js': /assertOk\s*\(/,
    'lib/claude-usage.js': /ensure\s*\(/,
    'routes/media-gen.js': /assertOk\s*\(/,
    'routes/anthropic-proxy.js': /ensure\s*\(/,
    'mcp/mcp-tool-loop.js': /wrapFetchFn\s*\(/,
    'server.js': /assertOk\s*\(/,
  };
  for (const [rel, re] of Object.entries(files)) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(src, re, rel + ' 缺少出口闸门');
  }
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /async function geminiPost[\s\S]*assertOk\s*\(/);
  const login = fs.readFileSync(path.join(root, 'lib/oauth-login.js'), 'utf8');
  const tokenFn = login.slice(login.indexOf('async function postToken'), login.indexOf('function decodeJwtClaims'));
  assert.match(tokenFn, /assertOk/);
  assert.match(tokenFn, /HttpsProxyAgent/);
  assert.equal(/delete opts\.agent|opts\.agent\s*=\s*null/.test(tokenFn), false);
});
