'use strict';
// oauth-common.js —— 订阅登录（claude / gemini / codex）的共用底座。
//
// 为什么要有这一层：刷新失败到底算「网络抖了」还是「令牌废了」，如果每个 provider 各写一份，
// 迟早漂移成两套口径（参考项目 OpenMinis 里就残留过一处 msg.contains('400') 没跟着迁移的旧判定）。
// 这里只放四件事，全部与具体供应商无关：
//   1. 结构化错误分类：只看真实 HTTP status + body 里的机器码，不拿整串消息做子串匹配；
//   2. 「需要重新登录」标记：只标记、绝不删凭证，换了新凭证自动失效；
//   3. 跨进程刷新锁：gateway / state-worker / 手工脚本同时刷新时，只让一个真的去换 token；
//   4. 脱敏日志：一行一条，只带 provider / 操作 / 状态码 / 机器码 / 耗时，不带任何令牌或 verifier。
//
/* [位置:lib/oauth-common.js·模块] [订阅登录共用底座] [三个 OAuth 供应商共享同一套失效判定/重登标记/刷新锁/脱敏日志，避免各写一份漂移] [注释时间 2026-10-22] */

const fs = require('fs');
const path = require('path');

// 标记文件统一放令牌目录（claude 的标记也放这，它自己的令牌仍在 data/oauth）
const { projectRoot } = require('./project-root');
const MARK_DIR = process.env.OAUTH_MARK_DIR || process.env.OAUTH_TOKEN_DIR || path.join(projectRoot(), 'data', 'oauth');

// 与两个 token 模块保持同一个缓冲：距过期不足 5 分钟就按「该刷了」处理
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// 只有这些机器码才说明「这个 refresh_token 本身不能用了」。
// 注意不要把 invalid_request 放进来：它多半是请求体写错（我们自己的 bug），不是用户该重登。
const FATAL_CODES = [
  'invalid_grant',
  'invalid_token',
  'invalid_client',
  'unauthorized_client',
  'refresh_token_reused',
  'expired_token',
];

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ---- 账号池：同一家可以挂多个账号 ----
// 账号 = 一份令牌文件。默认账号沿用历史路径（零迁移），额外账号放 ACCOUNTS_DIR/<provider>/<id>.json。
// 账号目录与冷却表都在令牌目录旁边，备份/清理规则与令牌一致。
const ACCOUNTS_DIR = process.env.OAUTH_ACCOUNTS_DIR || path.join(MARK_DIR, 'accounts');
const LEGACY_CLAUDE_FILE = process.env.CLAUDE_TOKEN_FILE || path.join(projectRoot(), 'data', 'oauth', 'claude-token.json');

function tokenFile(provider, account) {
  const acc = String(account || 'default').trim() || 'default';
  if (acc === 'default') {
    // default 账号保持历史位置：claude 在 data/oauth/claude-token.json，另两家在 data/oauth/<provider>.json
    return provider === 'claude' ? LEGACY_CLAUDE_FILE : path.join(MARK_DIR, provider + '.json');
  }
  return path.join(ACCOUNTS_DIR, provider, acc + '.json');
}

function accountDir(provider) {
  return path.join(ACCOUNTS_DIR, provider);
}

function ensureAccountDir(provider) {
  try { fs.mkdirSync(accountDir(provider), { recursive: true, mode: 0o700 }); } catch (e) { /* ignore */ }
}

// 列出这一家现存的所有账号 id（default 在前）。只看文件在不在，可用性由上层再判。
function listAccounts(provider) {
  const out = [];
  try {
    if (fs.existsSync(tokenFile(provider, 'default'))) out.push('default');
  } catch (e) { /* ignore */ }
  let names = [];
  try { names = fs.readdirSync(accountDir(provider)); } catch (e) { names = []; }
  names.sort().forEach(function (n) {
    if (!/\.json$/.test(n)) return;
    const id = n.replace(/\.json$/, '');
    if (!id || id === 'default') return;
    out.push(id);
  });
  return out;
}

// ---- 限流冷却：某个号被上游 429 了，暂时别再用它，轮到下一个 ----
// 只落在文件里（多进程共享）；30 分钟是保守默认：Claude 订阅的 5 小时窗口没法从 429 里读出来，
// 宁可早点把号放回来试，也不要把它永久判死。
const COOLDOWN_FILE = path.join(MARK_DIR, 'cooldowns.json');

function readCooldowns() {
  try {
    const j = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) {
    return {};
  }
}

function cdKey(provider, account) {
  return provider + ':' + (account || 'default');
}

// 标记文件按「provider-账号」区分：default 账号沿用老名字（reauth-claude.json），
// 额外账号是 reauth-claude-<id>.json，互不覆盖。
function markKey(provider, account) {
  const a = String(account || 'default').trim() || 'default';
  return a === 'default' ? provider : provider + '-' + a;
}

function setCooldown(provider, account, ms, reason) {
  const all = readCooldowns();
  const now = Date.now();
  Object.keys(all).forEach(function (k) {
    const v = all[k];
    if (!v || !v.until || v.until <= now) delete all[k];
  });
  all[cdKey(provider, account)] = { until: now + Number(ms || 0), reason: String(reason || '').slice(0, 80), at: now };
  try {
    fs.mkdirSync(MARK_DIR, { recursive: true, mode: 0o700 });
    const tmp = COOLDOWN_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, COOLDOWN_FILE);
  } catch (e) { /* 写不进去就只影响下次选择 */ }
  return all[cdKey(provider, account)];
}

function cooldownLeft(provider, account) {
  const v = readCooldowns()[cdKey(provider, account)];
  if (!v || !v.until) return 0;
  return Math.max(0, Number(v.until) - Date.now());
}

function clearCooldown(provider, account) {
  const all = readCooldowns();
  if (!all[cdKey(provider, account)]) return;
  delete all[cdKey(provider, account)];
  try {
    const tmp = COOLDOWN_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, COOLDOWN_FILE);
  } catch (e) { /* ignore */ }
}

// 只读 body 里的机器码。兼容 RFC 6749 的 {"error":"invalid_grant"} 和 Anthropic 风格的
// {"type":"error","error":{"type":"...","code":"..."}}。读不出来就返回空串，绝不做子串猜测。
function parseErrorCode(body) {
  try {
    const j = JSON.parse(String(body || ''));
    if (!j || typeof j !== 'object') return '';
    if (typeof j.error === 'string') return j.error.toLowerCase();
    if (j.error && typeof j.error === 'object') {
      if (typeof j.error.code === 'string') return j.error.code.toLowerCase();
      if (typeof j.error.type === 'string') return j.error.type.toLowerCase();
    }
    return '';
  } catch (e) {
    return '';
  }
}

// 判定一次令牌端点失败是「凭证废了」还是「可以再试」。
// 原则：宁可少判致命，也不要让一次瞬时故障把用户轰去重登（凭证始终保留，标记可自愈）。
//   - body 里给出的机器码在致命集合里 → 致命；
//   - 401 且 body 是 JSON 错误对象 → 致命（授权服务器明确拒了这份凭证）；
//   - 403 必须是 JSON 错误对象才算，HTML 的 "Just a moment" 是 Cloudflare 拦路，不是令牌问题；
//   - 5xx / 网络错误 / 非 JSON 的 400 → 非致命。
function classify(status, body) {
  const st = Number(status) || 0;
  const code = parseErrorCode(body);
  const looksJsonError = /^\s*\{/.test(String(body || '')) && !!code;
  const fatal = FATAL_CODES.indexOf(code) >= 0
    || (st === 401 && looksJsonError)
    || (st === 403 && looksJsonError);
  return { status: st, code: code, fatal: fatal };
}

// 统一错误对象：带 status / code / fatal，消息里保留上游原文的前 300 字（方便排查，且这段不含令牌）。
function makeError(provider, status, body, extra) {
  const c = classify(status, body);
  const err = new Error(
    provider + ' oauth: HTTP ' + c.status + (c.code ? ' ' + c.code : '') + ' ' + String(body || '').slice(0, 300)
  );
  err.oauth = true;
  err.status = c.status;
  err.code = c.code;
  err.fatal = c.fatal;
  if (extra) Object.keys(extra).forEach(function (k) { err[k] = extra[k]; });
  return err;
}

function isExpired(record, now) {
  if (!record || !record.access_token) return true;
  const obtained = Number(record.obtained_at || 0);
  const ttl = Number(record.expires_in || 0) * 1000;
  if (!obtained || !ttl) return true;
  return (now || Date.now()) >= obtained + ttl - REFRESH_BUFFER_MS;
}

// ---- 「需要重新登录」标记 ----
// 只记「哪一份凭证被拒了」，不记凭证本身：用凭证的签发时间（obtained_at）当指纹，
// 新凭证一落盘 obtained_at 就变，标记自动失效，不需要任何人去清。
function markFile(provider) {
  return path.join(MARK_DIR, 'reauth-' + provider + '.json');
}

function readMark(provider) {
  try {
    const j = JSON.parse(fs.readFileSync(markFile(provider), 'utf8'));
    return (j && j.at) ? j : null;
  } catch (e) {
    return null;
  }
}

function markNeedsReauth(provider, info) {
  const payload = {
    provider: provider,
    at: Date.now(),
    status: Number((info && info.status) || 0),
    code: String((info && info.code) || ''),
    cred_at: Number((info && info.cred_at) || 0),
    message: String((info && info.message) || '').slice(0, 200),
  };
  try {
    fs.mkdirSync(MARK_DIR, { recursive: true, mode: 0o700 });
    const tmp = markFile(provider) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, markFile(provider));
  } catch (e) {
    // 标记写不进去不影响主流程：本次仍会抛错，只是 UI 上少一个红标
    console.error('[oauth] mark write failed provider=' + provider + ': ' + (e && e.message));
  }
  return payload;
}

function clearNeedsReauth(provider) {
  try { fs.unlinkSync(markFile(provider)); } catch (e) { /* 本来就没有 */ }
}

// 当前这份凭证是否就是被拒的那一份。换了令牌（obtained_at 变了）就自动清标记并返回 null。
function needsReauth(provider, record) {
  const mark = readMark(provider);
  if (!mark) return null;
  const credAt = Number((record && record.obtained_at) || 0);
  if (mark.cred_at && credAt && Number(mark.cred_at) !== credAt) {
    clearNeedsReauth(provider);
    return null;
  }
  return mark;
}

// ---- 跨进程刷新锁 ----
// 为什么需要：gateway 与 state-worker 是两个进程，手工脚本（oauth finish 脚本）也可能
// 同时换 token。Anthropic 每次刷新都会轮换 refresh_token，两次并发刷新各自拿着同一个旧 token，
// 后到的那个必吃 invalid_grant。锁只是「劝告式」的：拿不到锁也不阻塞请求，由调用方先重读令牌。
function lockFile(provider) {
  return path.join(MARK_DIR, provider + '.refresh.lock');
}

async function withRefreshLock(provider, fn, opts) {
  const o = opts || {};
  const waitMs = o.waitMs == null ? 1500 : o.waitMs;
  const staleMs = o.staleMs == null ? 30000 : o.staleMs;
  const file = lockFile(provider);
  const deadline = Date.now() + waitMs;

  try { fs.mkdirSync(MARK_DIR, { recursive: true, mode: 0o700 }); } catch (e) { /* ignore */ }

  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // 持锁进程被杀掉时没人删锁，超过 staleMs 直接接管
      try {
        const st = fs.statSync(file);
        if (Date.now() - st.mtimeMs > staleMs) { fs.unlinkSync(file); continue; }
      } catch (e2) { /* 锁刚好被删了，继续抢 */ }
      if (Date.now() >= deadline) return fn({ locked: false });
      await sleep(150);
    }
  }
  try {
    return await fn({ locked: true });
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
}

// ---- 脱敏日志 ----
// 只允许出现：provider / 操作名 / 成败 / HTTP 状态 / 机器码 / 耗时 / 是否还能再试。
// 令牌、refresh_token、verifier、code 一律不进日志（这些值只在内存和 0600 文件之间流动）。
// msg 字段（上游错误原文）2026-11-04 起放宽到 400 字符：上游 4xx 的 error_description
// 是排查关键（如 Google 的 "Malformed auth code."），此前 160 截断把原因截没了，
// gemini 登录排查因此多绕一圈；其余字段仍是短枚举，维持 120。
function logLine(provider, op, fields) {
  const parts = ['[oauth]', 'provider=' + provider, 'op=' + op];
  const f = fields || {};
  Object.keys(f).forEach(function (k) {
    const v = f[k];
    if (v === undefined || v === null) return;
    const cap = k === 'msg' ? 400 : 120;
    parts.push(k + '=' + String(v).slice(0, cap));
  });
  console.log(parts.join(' '));
}

function logOk(provider, op, ms, extra) {
  const f = Object.assign({ ok: true, ms: Math.round(ms || 0) }, extra || {});
  logLine(provider, op, f);
}

function logFail(provider, op, err, ms, extra) {
  const f = Object.assign({
    ok: false,
    ms: Math.round(ms || 0),
    status: (err && err.status) || 0,
    code: (err && err.code) || '',
    fatal: !!(err && err.fatal),
    msg: String((err && err.message) || err || '').slice(0, 400),
  }, extra || {});
  logLine(provider, op, f);
}

module.exports = {
  MARK_DIR: MARK_DIR,
  ACCOUNTS_DIR: ACCOUNTS_DIR,
  REFRESH_BUFFER_MS: REFRESH_BUFFER_MS,
  FATAL_CODES: FATAL_CODES,
  sleep: sleep,
  parseErrorCode: parseErrorCode,
  classify: classify,
  makeError: makeError,
  isExpired: isExpired,
  readMark: readMark,
  markNeedsReauth: markNeedsReauth,
  clearNeedsReauth: clearNeedsReauth,
  needsReauth: needsReauth,
  withRefreshLock: withRefreshLock,
  logLine: logLine,
  logOk: logOk,
  logFail: logFail,
  tokenFile: tokenFile,
  accountDir: accountDir,
  ensureAccountDir: ensureAccountDir,
  listAccounts: listAccounts,
  markKey: markKey,
  readCooldowns: readCooldowns,
  setCooldown: setCooldown,
  cooldownLeft: cooldownLeft,
  clearCooldown: clearCooldown,
};
