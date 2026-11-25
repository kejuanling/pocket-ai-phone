'use strict';
// grok-usage.js —— 查 Grok 订阅的周额度（总已用% + 重置时间 + 各产品占比）。
// [位置:lib/grok-usage.js·probe] [Grok 订阅额度查询] [11-18：grok 也做一个 claude/gemini 那样的额度查看；
//   官方没有额度接口，数据源借官方 Grok CLI /usage 背后的 grok.com GetGrokCreditsConfig（gRPC-Web unary，
//   Bearer 现有 OAuth 令牌，纯读不消耗额度）：f1 float=周额度总已用%、f4/f5 Timestamp=周期起止（7 天），
//   f7 repeated{f1 产品id, f2 float}=各产品对同一周池的份额（加总=f1）；protobuf 无公开 schema，
//   手写防御式解析，未知字段跳过、解析不出返回明确错误不抛异常；60 秒缓存防连点] [注释时间 2026-11-18]

const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egressGuard = require('./egress-guard');
const oauth = require('./oauth-login');
const pool = require('./oauth-pool');

function PROXY() { return egressGuard.requireProxyUrl(); }
const HOST = 'grok.com';
const RPC_PATH = '/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';
const TIMEOUT_MS = 20000;
const CACHE_MS = 60 * 1000;
const cache = new Map();   // account -> { at, val }

function getAgent() { return new HttpsProxyAgent(PROXY()); }

async function rpc(token) {
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    const body = Buffer.from('0000000000', 'hex');   // grpc-web unary 空帧：1 字节 flag + 4 字节长度
    const req = https.request({
      hostname: HOST, path: RPC_PATH, method: 'POST', agent: getAgent(), timeout: TIMEOUT_MS,
      headers: {
        'content-type': 'application/grpc-web+proto',
        'content-length': body.length,
        'x-grpc-web': '1',
        'connect-protocol-version': '1',
        'x-user-agent': 'connect-es/2.1.1',
        'user-agent': 'grok-cli',
        origin: 'https://grok.com',
        referer: 'https://grok.com/',
        authorization: 'Bearer ' + token,
      },
    }, function (res) {
      const chunks = [];
      let total = 0;
      res.on('data', function (c) { total += c.length; if (total > 65536) { res.destroy(); return; } chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks) }); });
      res.on('error', reject);
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end(body);
  });
}

// 防御式 protobuf 单层解析：任何越界/不认识的 wiretype 都返回 null，由调用方兜底。
// 数值用 pow2 累加（时间戳 < 2^35，安全）；子消息不在这里递归，返回原始 Buffer 由上层按需再解。
function walk(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const f = tag >> 3;
    const wt = tag & 7;
    if (!f || (wt !== 0 && wt !== 2 && wt !== 5)) return null;
    i += 1;
    if (wt === 0) {
      let v = 0, s = 0;
      for (;;) {
        if (i >= buf.length) return null;
        const b = buf[i++];
        v += (b & 0x7f) * Math.pow(2, s);
        s += 7;
        if (!(b & 0x80)) break;
        if (s > 42) return null;
      }
      out.push({ f: f, v: v });
    } else if (wt === 5) {
      if (i + 4 > buf.length) return null;
      out.push({ f: f, fx: buf.readFloatLE(i) });
      i += 4;
    } else {
      let len = 0, s = 0;
      for (;;) {
        if (i >= buf.length) return null;
        const b = buf[i++];
        len += (b & 0x7f) * Math.pow(2, s);
        s += 7;
        if (!(b & 0x80)) break;
        if (s > 42) return null;
      }
      if (i + len > buf.length) return null;
      out.push({ f: f, sub: buf.slice(i, i + len) });
      i += len;
    }
  }
  return out;
}

function pct(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

// google.protobuf.Timestamp：f1=seconds（>1e9 才认，防把别的 varint 当时间）
function tsOf(buf) {
  const nodes = walk(buf);
  if (!nodes) return 0;
  for (const m of nodes) {
    if (m.f === 1 && m.v !== undefined && m.v > 1e9 && m.v < 1e11) return Math.round(m.v);
  }
  return 0;
}

// GetGrokCreditsConfig 应答 → { used_pct, reset_at, period_start, products:[{id,used_pct}] }；解不出返回 null
function parseCredits(msg) {
  const top = walk(msg);
  if (!top) return null;
  let cfg = null;
  for (const n of top) {
    if (n.f === 1 && n.sub) {
      const inner = walk(n.sub);
      if (inner) { cfg = inner; break; }
    }
  }
  if (!cfg) return null;
  let used = null, start = 0, end = 0;
  const products = [];
  for (const n of cfg) {
    if (n.f === 1 && n.fx !== undefined) used = pct(n.fx);
    else if (n.f === 4 && n.sub) start = tsOf(n.sub) || start;
    else if (n.f === 5 && n.sub) end = tsOf(n.sub) || end;
    else if (n.f === 7 && n.sub) {
      const inner = walk(n.sub);
      if (!inner) continue;
      let pid = null, share = null;
      for (const m of inner) {
        if (m.f === 1 && m.v !== undefined) pid = m.v;
        else if (m.f === 2 && m.fx !== undefined) share = pct(m.fx);
      }
      if (pid != null && share != null) products.push({ id: pid, used_pct: share });
    }
  }
  if (used == null) return null;
  products.sort(function (a, b) { return (b.used_pct || 0) - (a.used_pct || 0) || (a.id < b.id ? -1 : 1); });
  return { used_pct: used, reset_at: end || null, period_start: start || null, products: products };
}

// account 不传 = 聊天链路当前会挑的那个号（能用的排前面）
async function probe(account, opts) {
  const force = !!(opts && opts.force);
  const acc = account || (pool.candidates('grok').ordered[0]) || '';
  if (!acc) return { ok: false, error: 'Grok 订阅还没有登录任何账号' };
  const hit = cache.get(acc);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return Object.assign({ cached: true }, hit.val);

  let token;
  try { token = await pool.token('grok', acc); }
  catch (e) { return { ok: false, error: '拿不到登录凭证：' + String((e && e.message) || e).slice(0, 80) }; }

  let r;
  try { r = await rpc(token); }
  catch (e) { return { ok: false, error: '请求失败：' + String((e && e.message) || e).slice(0, 80) }; }
  if (r.status === 401 || r.status === 403) {
    let needs = '';
    try { needs = (oauth.status('grok', acc) || {}).needs_reauth ? '，到设置页点「登录」重新授权一下' : ''; } catch (e) { /* 状态读不到不影响报错 */ }
    return { ok: false, error: '上游拒绝（HTTP ' + r.status + '）' + needs };
  }
  if (r.status !== 200) return { ok: false, error: '上游 HTTP ' + r.status };
  // grpc-web 帧：1 字节 flag + 4 字节大端长度 + 消息；trailers 帧跟在后面不用管
  if (r.body.length < 5) return { ok: false, error: '上游没给额度数据（空应答）' };
  const flag = r.body[0];
  const len = r.body.readUInt32BE(1);
  if ((flag & 0x80) || len <= 0 || 5 + len > r.body.length) return { ok: false, error: '上游没给额度数据' };
  const parsed = parseCredits(r.body.slice(5, 5 + len));
  if (!parsed) return { ok: false, error: '上游没给额度数据（解析失败）' };

  let email = '';
  try { email = String((oauth.status('grok', acc) || {}).email || ''); } catch (e) { /* 状态拿不到就算了 */ }

  const val = Object.assign({ ok: true, account: acc, email: email, http: r.status }, parsed);
  cache.set(acc, { at: Date.now(), val: val });
  return val;
}

module.exports = { probe, parseCredits, _cache: cache };
