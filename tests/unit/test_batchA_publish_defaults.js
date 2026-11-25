'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function exampleKeys() {
  const text = read('.env.example');
  const keys = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]+)=/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

test('缺代理或预期 IP 时 ensure fail-closed，不缓存、不回退旧默认', async () => {
  const oldP = process.env.EGRESS_PROXY;
  const oldC = process.env.CLAUDE_OAUTH_PROXY;
  const oldA = process.env.AIRPORT_PROXY;
  const oldE = process.env.EGRESS_EXPECT_IP;
  const oldCE = process.env.CLAUDE_EGRESS_EXPECT_IP;
  delete process.env.EGRESS_PROXY;
  delete process.env.CLAUDE_OAUTH_PROXY;
  delete process.env.AIRPORT_PROXY;
  delete process.env.EGRESS_EXPECT_IP;
  delete process.env.CLAUDE_EGRESS_EXPECT_IP;
  delete require.cache[require.resolve('../../lib/egress-guard')];
  const guard = require('../../lib/egress-guard');
  try {
    guard._resetForTest();
    const g = await guard.ensure();
    assert.equal(g.ok, false);
    assert.equal(g.reason, 'proxy_not_configured');
    const g2 = await guard.ensure();
    assert.equal(g2.reason, 'proxy_not_configured');
    process.env.EGRESS_PROXY = 'http://127.0.0.1:1088';
    guard._resetForTest();
    const g3 = await guard.ensure();
    assert.equal(g3.ok, false);
    assert.equal(g3.reason, 'expect_ip_not_configured');
    process.env.EGRESS_EXPECT_IP = '192.0.2.1';
    assert.equal(guard.proxyUrl(), 'http://127.0.0.1:1088');
    assert.doesNotThrow(() => guard.applyProxyOpts({ method: 'GET' }, new URL('https://api.example.com/v1')));
  } finally {
    if (oldP === undefined) delete process.env.EGRESS_PROXY; else process.env.EGRESS_PROXY = oldP;
    if (oldC === undefined) delete process.env.CLAUDE_OAUTH_PROXY; else process.env.CLAUDE_OAUTH_PROXY = oldC;
    if (oldA === undefined) delete process.env.AIRPORT_PROXY; else process.env.AIRPORT_PROXY = oldA;
    if (oldE === undefined) delete process.env.EGRESS_EXPECT_IP; else process.env.EGRESS_EXPECT_IP = oldE;
    if (oldCE === undefined) delete process.env.CLAUDE_EGRESS_EXPECT_IP; else process.env.CLAUDE_EGRESS_EXPECT_IP = oldCE;
    try { require('../../lib/egress-guard')._resetForTest(); } catch (e) { /* ignore */ }
  }
});

test('未配置代理时 applyProxyOpts 抛错且不把保护放开', () => {
  const oldP = process.env.EGRESS_PROXY;
  const oldC = process.env.CLAUDE_OAUTH_PROXY;
  const oldA = process.env.AIRPORT_PROXY;
  delete process.env.EGRESS_PROXY;
  delete process.env.CLAUDE_OAUTH_PROXY;
  delete process.env.AIRPORT_PROXY;
  delete require.cache[require.resolve('../../lib/egress-guard')];
  const guard = require('../../lib/egress-guard');
  try {
    guard._resetForTest();
    let thrown = null;
    try {
      guard.applyProxyOpts({ method: 'POST' }, new URL('https://api.example.com/v1'));
    } catch (e) { thrown = e; }
    assert.ok(thrown, 'missing proxy must throw');
    assert.equal(thrown.code, 'EGRESS_DENIED');
    assert.equal(thrown.egress && thrown.egress.reason, 'proxy_not_configured');
    assert.equal(guard.proxyUrl(), '');
    assert.equal(guard.expectIp(), '');
  } finally {
    if (oldP === undefined) delete process.env.EGRESS_PROXY; else process.env.EGRESS_PROXY = oldP;
    if (oldC === undefined) delete process.env.CLAUDE_OAUTH_PROXY; else process.env.CLAUDE_OAUTH_PROXY = oldC;
    if (oldA === undefined) delete process.env.AIRPORT_PROXY; else process.env.AIRPORT_PROXY = oldA;
  }
});

test('守卫源码不再硬编码代理地址或现网预期 IP 默认', () => {
  const src = read('lib/egress-guard.js');
  assert.equal(src.includes("|| 'http://127.0.0.1:1088'"), false);
  assert.equal(src.includes('|| "http://127.0.0.1:1088"'), false);
  assert.match(src, /proxy_not_configured/);
  assert.match(src, /expect_ip_not_configured/);
  assert.equal(/EXPECT_IP = process\.env\.[^;]+ '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+'/.test(src), false);
});

test('.env.example 含本批键且无现网赋值', () => {
  const text = read('.env.example');
  const keys = exampleKeys();
  for (const k of [
    'PROJECT_ROOT', 'LISTEN_HOST', 'EGRESS_PROXY', 'EGRESS_EXPECT_IP',
    'EGRESS_KEEPER_CONTAINER', 'EGRESS_KEEPER_NODE',
    'AIRPORT_YAML', 'AIRPORT_URL_FILE', 'MIHOMO_BIN', 'MIHOMO_HOME',
    'OAUTH_TOKEN_DIR', 'GEMINI_OAUTH_CLIENT_ID', 'GEMINI_OAUTH_CLIENT_SECRET',
    'ANTIGRAVITY_OAUTH_CLIENT_ID', 'CLAUDE_OAUTH_CLIENT_ID', 'CHATGPT_OAUTH_CLIENT_ID',
    'GROK_OAUTH_CLIENT_ID', 'PUBLIC_BASE_URL', 'WORLD_URL', 'LOCAL_MCP_HOSTS',
    'NETEASE_PLAYLIST_ID', 'MCP_PATH_SECRETS', 'SENTINEL_KNOWN_IP_PREFIXES',
    'WAKE_UP_LOG_PATH', 'GATEWAY_CALLBACK_URL', 'MCP_SECRETS_FILE',
  ]) {
    assert.ok(keys.includes(k), 'missing key ' + k);
  }
  assert.match(text, /^LISTEN_HOST=127\.0\.0\.1$/m);
  assert.match(text, /^EGRESS_PROXY=\s*$/m);
  assert.match(text, /^EGRESS_EXPECT_IP=\s*$/m);
  assert.equal(/=\s*\/opt\/dylan-heartbeat/.test(text), false);
  assert.equal(/GOCSPX-/.test(text), false);
});

test('gitignore 发布 .env.example，忽略 .env，私人 daily 路径已中性化', () => {
  const gi = read('.gitignore');
  const lines = gi.split(/\n/);
  assert.ok(lines.includes('.env'));
  assert.ok(lines.includes('!.env.example') || !lines.includes('.env.example'));
  assert.equal(gi.includes('daily-涵'), false);
  assert.ok(gi.includes('workspace/daily-user/'));
});

test('本批敏感字面量不在可发布源码中（跳过已声明未改的个人世界页）', () => {
  const skip = /han-diary|love-diary|monthly|todo-heart|xie-sandbox|apps\/world|apps\/sea/;
  const hits = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      const rel = path.relative(SRC, p);
      if (skip.test(rel)) continue;
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        if (rel.includes('test_batchA_publish_defaults.js')) continue;
        walk(p);
        continue;
      }
      if (!ent.isFile()) continue;
        if (ent.name === 'test_batchA_publish_defaults.js') continue;
      let text;
      try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
      if (rel !== '.env.example' && text.includes('127.0.0.1:1088') && /\| *['\"]http:\/\/127\.0\.0\.1:1088['\"]/.test(text)) {
        hits.push(rel + ': baked 1088 default');
      }
      if (text.includes('/opt/dylan-heartbeat')) hits.push(rel + ': prod abs path');
    }
  }
  walk(SRC);
  assert.deepEqual(hits, []);
});
