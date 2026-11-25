'use strict';
// gemini-usage.js —— 查 Gemini（Antigravity）订阅各模型的剩余额度。
// [位置:lib/gemini-usage.js·probe] [Gemini 订阅额度查询] [11-12：gemini 也做一个 claude 那样的额度查看；
//   与 Claude 版（lib/claude-usage.js）形状对齐，但数据源干净得多：上游模型目录 fetchAvailableModels
//   一次带回全部模型的 quotaInfo（剩余比例 + 重置时间），纯读目录、不消耗额度；
//   只支持 antigravity 身份（gemini-cli 身份 2026-06 被 Google 下线，出不来目录）；
//   前端显示口径与 Claude 版一致：条形 = 已用百分比（remainingFraction 反转），60 秒缓存防连点] [注释时间 2026-11-12]

const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egressGuard = require('./egress-guard');
const oauth = require('./oauth-login');
const pool = require('./oauth-pool');

function PROXY() { return egressGuard.requireProxyUrl(); }
const HOST = 'daily-cloudcode-pa.googleapis.com';
// 请求指纹与聊天链路同一份：routes/oauth-proxy.js 导出的 _internal.CLOUDCODE.antigravity。
// 从那里取是为了上游改指纹时只改一处；拿不到（被重构）就回落到快照常量。
let AG = null;
try { AG = require('../routes/oauth-proxy')._internal.CLOUDCODE.antigravity; } catch (e) { /* 用兜底 */ }
const FALLBACK_UA = 'antigravity/cli/1.5.14 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)';
const FALLBACK_META = { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' };

const TIMEOUT_MS = 20000;
const CACHE_MS = 60 * 1000;
const cache = new Map();   // account -> { at, val }

function getAgent() { return new HttpsProxyAgent(PROXY()); }

async function post(path, token, obj) {
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    const req = https.request({
      hostname: HOST, path: path, method: 'POST', agent: getAgent(), timeout: TIMEOUT_MS,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'authorization': 'Bearer ' + token,
        'user-agent': (AG && AG.ua && AG.ua()) || FALLBACK_UA,
      },
    }, function (res) {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { if (raw.length < 2000000) raw += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: raw }); });
      res.on('error', reject);
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end(body);
  });
}

// project 与聊天链路共用同一个缓存文件（oauth-proxy 的 ensureProject 没导出，这里按同格式读/写；
// 只写 {project, at} 两个字段，oauth-proxy 的 readProject 只认 project，互不影响）。
async function ensureProject(token, account) {
  const file = oauth.projectCacheFile(account, 'antigravity');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.project) return String(j.project);
  } catch (e) { /* 没缓存，走一次发现 */ }
  const r = await post('/v1internal:loadCodeAssist', token, { metadata: (AG && AG.meta) || FALLBACK_META });
  if (r.status === 403) throw validationErr(r.body);
  let j = {};
  try { j = JSON.parse(r.body); } catch (e) { /* 保原文 */ }
  const proj = j.cloudaicompanionProject ? (j.cloudaicompanionProject.id || j.cloudaicompanionProject) : '';
  if (!proj) throw new Error('没能拿到 project（HTTP ' + r.status + '）：' + String(r.body).slice(0, 120));
  try { fs.writeFileSync(file, JSON.stringify({ project: proj, at: Date.now() }), { mode: 0o600 }); } catch (e) { /* 写不进不拦路 */ }
  return proj;
}

function validationErr(body) {
  const e = new Error('需要验证：聊天里发条消息拿链接');
  e.validation_required = /VALIDATION_REQUIRED/i.test(String(body));
  return e;
}

// opts: { models: [配置里的模型 id 数组], account?, force? }
async function probe(opts) {
  const o = opts || {};
  const want = Array.isArray(o.models) ? o.models.filter(function (x) { return x && String(x); }) : [];
  const account = String(o.account || pool.candidates('antigravity').ordered[0] || 'default');
  const hit = cache.get(account);
  if (!o.force && hit && Date.now() - hit.at < CACHE_MS) return Object.assign({ cached: true }, hit.val);

  let token;
  try { token = await pool.token('antigravity', account); }
  catch (e) { return { ok: false, error: '拿不到登录凭证：' + String((e && e.message) || e).slice(0, 80) }; }

  let project;
  try { project = await ensureProject(token, account); }
  catch (e) {
    if (e && e.validation_required) return { ok: false, error: String(e.message), validation_required: true };
    return { ok: false, error: '查询失败：' + String((e && e.message) || e).slice(0, 80) };
  }

  let r;
  try { r = await post('/v1internal:fetchAvailableModels', token, { project: project }); }
  catch (e) { return { ok: false, error: '查询失败：' + String((e && e.message) || e).slice(0, 80) }; }
  if (r.status !== 200) {
    if (r.status === 403) {
      const ve = validationErr(r.body);
      if (ve.validation_required) return { ok: false, error: String(ve.message), validation_required: true };
      return { ok: false, error: '上游拒绝（HTTP 403）' };
    }
    return { ok: false, error: '上游 HTTP ' + r.status };
  }
  let j = {};
  try { j = JSON.parse(r.body); } catch (e) { return { ok: false, error: '上游返回非 JSON' }; }
  const bag = (j.response && j.response.models) || j.models || {};

  // 只显示这个供应商配置里有的模型；条形口径与 Claude 版一致（已用百分比 = 1 - 剩余比例）
  const picked = [];
  Object.keys(bag).forEach(function (id) {
    if (want.length && want.indexOf(id) < 0) return;
    const q = (bag[id] || {}).quotaInfo || {};
    const frac = Number(q.remainingFraction);
    const used = isFinite(frac) ? Math.max(0, Math.min(100, Math.round((1 - frac) * 1000) / 10)) : null;
    let reset = null;
    if (q.resetTime) { const t = new Date(q.resetTime).getTime(); if (isFinite(t) && t > 0) reset = Math.round(t / 1000); }
    if (used == null && reset == null) return;
    picked.push({ id: id, used_pct: used, reset_at: reset });
  });
  // 已用多的排前面（快用完的一眼能看到）；同额度按名字排
  picked.sort(function (a, b) { return (b.used_pct || 0) - (a.used_pct || 0) || (a.id < b.id ? -1 : 1); });

  let email = '';
  try { email = String((oauth.status('antigravity', account) || {}).email || ''); } catch (e) { /* 状态拿不到就算了 */ }

  const val = { ok: true, account: account, email: email, models: picked, http: r.status };
  cache.set(account, { at: Date.now(), val: val });
  return val;
}

module.exports = { probe, _cache: cache };
