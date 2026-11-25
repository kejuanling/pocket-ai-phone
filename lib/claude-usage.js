'use strict';
// claude-usage.js —— 查 Claude 订阅账号的额度（5 小时窗口 / 7 天窗口已用百分比）。
// [位置:lib/claude-usage.js·probe] [Claude 订阅额度探测] [11-09 随手记：供应商页里查看 Claude 额度；
//   官方没有公开的额度接口，社区实测做法：向 /v1/messages 发一条 max_tokens:1 的最小请求，读响应头里的
//   anthropic-ratelimit-unified-{5h,7d}-{utilization,reset}（需 oauth beta + CLI 身份行，同聊天链路）。
//   每次探测会真实消耗极少量额度，所以前端只在用户点一下时才查，这里再加 60 秒缓存防连点。] [注释时间 2026-11-09]
// 只读响应头，不读 body 的内容；出错时把上游的错误类型带回，但不回显任何令牌/请求头。

const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const claudeToken = require('./claude-token');
const pool = require('./oauth-pool');
const egressGuard = require('./egress-guard');

function PROXY() { return egressGuard.requireProxyUrl(); }
const PROBE_MODEL = process.env.CLAUDE_USAGE_PROBE_MODEL || 'claude-haiku-4-5';
const TIMEOUT_MS = 20000;
const CACHE_MS = 60 * 1000;
const cache = new Map();   // account -> { at, val }

function pct(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 1000) / 10));   // 0.153 -> 15.3
}
function resetAt(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n) : null;   // unix 秒
}

function parseHeaders(h) {
  const g = function (k) { return h['anthropic-ratelimit-unified-' + k]; };
  const five = { used_pct: pct(g('5h-utilization')), reset_at: resetAt(g('5h-reset')) };
  const seven = { used_pct: pct(g('7d-utilization')), reset_at: resetAt(g('7d-reset')) };
  return { five_hour: five, seven_day: seven, status: String(g('status') || ''), representative: String(g('representative-claim') || '') };
}

function request(token) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: PROBE_MODEL, max_tokens: 1,
      system: [{ type: 'text', text: claudeToken.OAUTH_IDENTITY_PROMPT }],
      messages: [{ role: 'user', content: '.' }],
    });
    const headers = Object.assign({
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'anthropic-version': '2023-06-01',
      'authorization': 'Bearer ' + token,
      'anthropic-beta': claudeToken.CLI_BETAS.join(','),
    }, claudeToken.CLI_HEADERS);
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      agent: new HttpsProxyAgent(PROXY()), headers: headers, timeout: TIMEOUT_MS,
    }, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { if (raw.length < 4000) raw += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, raw: raw }); });
      res.on('error', reject);
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// account 不传 = 聊天链路当前会挑的那个号（能用的排前面）
async function probe(account, opts) {
  const force = !!(opts && opts.force);
  const acc = account || (pool.candidates('claude').ordered[0]) || '';
  if (!acc) return { ok: false, error: 'Claude 订阅还没有登录任何账号' };
  const hit = cache.get(acc);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return Object.assign({ cached: true }, hit.val);
  const g = await egressGuard.ensure();
  if (!g.ok) return { ok: false, error: 'Claude 出口线路不可用：' + g.reason };
  let token;
  try { token = await pool.token('claude', acc); }
  catch (e) { return { ok: false, error: '拿不到登录凭证：' + String((e && e.message) || e).slice(0, 80) }; }
  let r;
  try { r = await request(token); }
  catch (e) { return { ok: false, error: '请求失败：' + String((e && e.message) || e).slice(0, 80) }; }
  const parsed = parseHeaders(r.headers);
  const has = parsed.five_hour.used_pct != null || parsed.seven_day.used_pct != null;
  if (!has) {
    let et = ''; try { et = (JSON.parse(r.raw).error || {}).type || ''; } catch (e) {}
    return { ok: false, error: '上游没给额度信息（HTTP ' + r.status + (et ? ' ' + et : '') + '）' };
  }
  const val = Object.assign({ ok: true, account: acc, http: r.status }, parsed);
  cache.set(acc, { at: Date.now(), val: val });
  return val;
}

module.exports = { probe, parseHeaders, _cache: cache };
