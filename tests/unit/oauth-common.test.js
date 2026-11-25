'use strict';
// 订阅登录的纯逻辑单测：分类矩阵、重登标记自愈、刷新锁互斥与陈旧接管、未过期不刷新。
// 只碰临时目录，不联网、不读线上令牌。npm test 会一起跑（tests/**/*.js）。
/* [位置:tests/unit/oauth-common.test.js·模块] [订阅登录纯逻辑回归] [把「什么算凭证废了」「标记怎么自愈」「锁怎么互斥」钉成测试，防止以后改回子串匹配或误删凭据] [注释时间 2026-10-22] */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-test-'));
const tokenFile = path.join(tmp, 'token.json');
process.env.OAUTH_MARK_DIR = tmp;
process.env.OAUTH_TOKEN_DIR = tmp;
process.env.CLAUDE_TOKEN_FILE = tokenFile;

const common = require('../../lib/oauth-common');
const claude = require('../../lib/claude-token');
const login = require('../../lib/oauth-login');

test('错误分类：只有上游明确拒了凭证才算致命', function () {
  const cases = [
    [400, '{"error":"invalid_grant"}', true],
    [400, '{"error":"invalid_request"}', false],
    [401, '{"error":"invalid_token"}', true],
    [401, '<html>nope</html>', false],
    [403, '<html>Just a moment…</html>', false],
    [403, '{"error":"unauthorized_client"}', true],
    [500, '{"error":"boom"}', false],
    [200, '{"request_id":"req-400-abc"}', false],
    [400, '{"type":"error","error":{"type":"invalid_grant"}}', true],
  ];
  cases.forEach(function (c) {
    const r = common.classify(c[0], c[1]);
    assert.strictEqual(r.fatal, c[2], 'classify(' + c[0] + ', ' + c[1] + ') 应为 fatal=' + c[2]);
  });
});

test('重登标记：同一份凭证才算数，新凭证自动失效', function () {
  common.markNeedsReauth('claude', { status: 400, code: 'invalid_grant', cred_at: 111 });
  assert.ok(common.readMark('claude'));
  assert.ok(common.needsReauth('claude', { obtained_at: 111 }));
  assert.strictEqual(common.needsReauth('claude', { obtained_at: 222 }), null);
  assert.strictEqual(fs.existsSync(path.join(tmp, 'reauth-claude.json')), false);
  common.clearNeedsReauth('claude');
});

test('刷新锁：互斥；陈旧锁（>30s）自动接管', async function () {
  const order = [];
  const p1 = common.withRefreshLock('gemini', async function (l) {
    order.push('a:' + l.locked);
    await common.sleep(400);
  });
  const p2 = common.withRefreshLock('gemini', async function (l) {
    order.push('b:' + l.locked);
  }, { waitMs: 100 });
  await Promise.all([p1, p2]);
  assert.ok(order.indexOf('a:true') >= 0);
  assert.ok(order.indexOf('b:false') >= 0);

  const lockPath = path.join(tmp, 'gemini.refresh.lock');
  fs.writeFileSync(lockPath, '999');
  const old = new Date(Date.now() - 40000);
  fs.utimesSync(lockPath, old, old);
  let got = null;
  await common.withRefreshLock('gemini', async function (l) { got = l.locked; }, { waitMs: 500, staleMs: 30000 });
  assert.strictEqual(got, true);
});

test('未过期时直接返回缓存令牌，不触发刷新', async function () {
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'fake-access',
    refresh_token: 'fake-refresh',
    expires_in: 3600,
    obtained_at: Date.now(),
  }), { mode: 0o600 });
  assert.strictEqual(await claude.getAccessToken(), 'fake-access');
  assert.strictEqual(login.hasToken('claude'), true);
});

test('状态接口把「需要重新登录」透出来，两个模块同源', function () {
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'fake-access',
    refresh_token: 'fake-refresh',
    expires_in: 3600,
    obtained_at: 555,
    email: 'x@example.com',
  }), { mode: 0o600 });
  common.markNeedsReauth('claude', { status: 400, code: 'invalid_grant', cred_at: 555, message: 'rejected' });
  const a = claude.status();
  assert.strictEqual(a.needs_reauth, true);
  assert.strictEqual(a.needs_reauth_reason, 'invalid_grant');
  const b = login.status('claude');
  assert.strictEqual(b.needs_reauth, true);
  assert.strictEqual(b.connected, true);
  assert.strictEqual(b.email, 'x@example.com');

  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 3600,
    obtained_at: 777,
    email: 'x@example.com',
  }), { mode: 0o600 });
  assert.strictEqual(claude.status().needs_reauth, false);
});

test('登录与运行时读写同一份 Claude 令牌文件，且走各自的出口代理', function () {
  assert.strictEqual(common.tokenFile('claude', 'default'), claude.TOKEN_FILE);
  assert.equal(typeof login.PROVIDERS.claude.proxy, 'function');
  assert.equal(login.PROVIDERS.claude.proxy(), '');
  assert.strictEqual(login.PROVIDERS.claude.tokenBody, 'json');
  assert.strictEqual(login.PROVIDERS.gemini.tokenBody, 'form');
  assert.strictEqual(login.PROVIDERS.codex.extra.codex_cli_simplified_flow, 'true');
});

test('账号池：默认账号优先，冷却的排到后面兜底，路径按账号分文件', function () {
  const pool = require('../../lib/oauth-pool');
  const accDir = path.join(tmp, 'accounts', 'claude');
  fs.mkdirSync(accDir, { recursive: true });
  fs.writeFileSync(path.join(accDir, 'a1.json'), JSON.stringify({
    access_token: 'a1-token', refresh_token: 'a1-refresh', expires_in: 3600, obtained_at: Date.now(),
  }), { mode: 0o600 });
  fs.writeFileSync(tokenFile, JSON.stringify({
    access_token: 'd-token', refresh_token: 'd-refresh', expires_in: 3600, obtained_at: Date.now(),
  }), { mode: 0o600 });

  assert.deepStrictEqual(common.listAccounts('claude'), ['default', 'a1']);
  assert.deepStrictEqual(pool.candidates('claude').ordered, ['default', 'a1']);

  common.setCooldown('claude', 'default', 60000, '429');
  assert.deepStrictEqual(pool.candidates('claude').ordered, ['a1', 'default']);
  assert.ok(common.cooldownLeft('claude', 'default') > 0);
  common.clearCooldown('claude', 'default');

  assert.strictEqual(common.tokenFile('claude', 'default'), tokenFile);
  assert.ok(common.tokenFile('claude', 'a1').indexOf(path.join('accounts', 'claude', 'a1.json')) >= 0);
  assert.ok(common.tokenFile('gemini', 'a2').indexOf(path.join('accounts', 'gemini', 'a2.json')) >= 0);
  assert.ok(common.tokenFile('gemini', 'default').indexOf('gemini.json') >= 0);
});

test('订阅身份行：system 变成 [身份行, 原系统提示词] 两块，非订阅仍是字符串', function () {
  const adapter = require('../../lib/anthropic-adapter');
  const msgs = [
    { role: 'system', content: '你是涵。' },
    { role: 'user', content: '在吗' },
  ];
  const oauth = adapter.toAnthropicRequest({ model: 'claude-x', messages: msgs }, { oauthIdentity: 'IDENT' });
  assert.ok(Array.isArray(oauth.system));
  assert.strictEqual(oauth.system[0].text, 'IDENT');
  assert.strictEqual(oauth.system.length, 2);
  assert.strictEqual(oauth.system[1].text, '你是涵。');
  assert.strictEqual(oauth.system[1].cache_control.type, 'ephemeral');

  const plain = adapter.toAnthropicRequest({ model: 'claude-x', messages: msgs }, {});
  assert.strictEqual(typeof plain.system, 'string');

  const onlyIdentity = adapter.toAnthropicRequest(
    { model: 'claude-x', messages: [{ role: 'user', content: '在吗' }] },
    { oauthIdentity: 'IDENT' }
  );
  assert.deepStrictEqual(onlyIdentity.system, [{ type: 'text', text: 'IDENT' }]);
});
