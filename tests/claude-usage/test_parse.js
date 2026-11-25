'use strict';
// lib/claude-usage.js 响应头解析 + routes/claude-usage.js 入参校验（不发真请求）
const assert = require('assert');
const Fastify = require('fastify');
const { parseHeaders } = require('../../lib/claude-usage');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('PASS ' + name); pass++; } catch (e) { console.log('FAIL ' + name + ' :: ' + e.message); fail++; } }

t('解析：小数转百分比保留一位，重置时间取整秒', () => {
  const r = parseHeaders({ 'anthropic-ratelimit-unified-5h-utilization': '0.153', 'anthropic-ratelimit-unified-5h-reset': '1794192600', 'anthropic-ratelimit-unified-7d-utilization': '0.9', 'anthropic-ratelimit-unified-7d-reset': '1794297600.4', 'anthropic-ratelimit-unified-status': 'allowed' });
  assert.strictEqual(r.five_hour.used_pct, 15.3); assert.strictEqual(r.five_hour.reset_at, 1794192600);
  assert.strictEqual(r.seven_day.used_pct, 90); assert.strictEqual(r.seven_day.reset_at, 1794297600); assert.strictEqual(r.status, 'allowed');
});
t('解析：缺头/脏值得 null，不抛', () => {
  const r = parseHeaders({ 'anthropic-ratelimit-unified-5h-utilization': 'abc' });
  assert.strictEqual(r.five_hour.used_pct, null); assert.strictEqual(r.seven_day.used_pct, null); assert.strictEqual(r.five_hour.reset_at, null);
});
t('解析：超过 1 夹到 100，负数夹到 0', () => {
  const r = parseHeaders({ 'anthropic-ratelimit-unified-5h-utilization': '1.7', 'anthropic-ratelimit-unified-7d-utilization': '-0.2' });
  assert.strictEqual(r.five_hour.used_pct, 100); assert.strictEqual(r.seven_day.used_pct, 0);
});
(async () => {
  const app = Fastify();
  require('../../routes/claude-usage')(app, { mcpManageAuth: (q, p, d) => d(), loadAiProviders: () => [{ id: 'p_cl', oauth_provider: 'claude' }, { id: 'p_ds' }] });
  const call = async (b) => { const r = await app.inject({ method: 'POST', url: '/admin/providers/claude-usage', payload: b }); return { c: r.statusCode, j: JSON.parse(r.body) }; };
  let r = await call({}); t('路由：缺 id → 400', () => assert.strictEqual(r.c, 400));
  r = await call({ id: 'zzz' }); t('路由：供应商不存在 → 404', () => assert.strictEqual(r.c, 404));
  r = await call({ id: 'p_ds' }); t('路由：非 Claude 订阅 → ok:false 不发请求', () => { assert.strictEqual(r.j.ok, false); assert.match(r.j.error, /Claude/); });
  r = await call({ id: 'p_cl', account: '../x' }); t('路由：账号 id 带路径字符 → 400', () => assert.strictEqual(r.c, 400));
  await app.close();
  console.log('\ntest_claude_usage: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
