'use strict';
// oauth-login.js —— Gemini / Codex / Claude / Grok 的 OAuth 登录与令牌管理（服务端）。
//
// 为什么不用本地回调：这三家的 redirect_uri 都只认 localhost，而服务器在云端，
// 手机/桌面浏览器授权后跳不到服务器。所以流程是：
//   1) 后端生成 PKCE + state，给出授权链接
//   2) 你在浏览器里同意，浏览器跳到 localhost（打不开，正常）
//   3) 你把地址栏整条贴回前端，前端原样交给这里，后端自己解出 code + 换 token
//
// 三家都是借官方 CLI 的 client_id（Google 的还要一个公开的 client_secret），
// 属于非官方用法；这里只负责登录态，不假装成官方客户端发请求。
//
// 账号模型（2026-10-22 第二轮）：同一家可以挂多个账号。默认账号沿用历史路径
// （data/oauth/claude-token.json、data/oauth/<provider>.json），额外账号在
// data/oauth/accounts/<provider>/<id>.json。所有入口都接受 { account }，不传即 default。
//
// 令牌生命周期：按需刷新 + 5 分钟缓冲 + 进程内单飞 + 跨进程文件锁；刷新失败先分类
// （凭证废了 / 网络抖了），只有前者才打「需要重新登录」标记，且永远不删凭证；非致命失败 60 秒冷却。
//
/* [位置:lib/oauth-login.js·模块] [Gemini/Codex/Claude/Antigravity 订阅登录与令牌管理（多账号）] [三家订阅账号的 PKCE 授权、令牌落盘、按需刷新与失效状态，统一一份实现] [注释时间 2026-10-22；改动：加账号参数、Claude 支持、失败分类、重登标记、跨进程锁、冷却、脱敏日志、hasToken；2026-11-04：机场死透，gemini/codex 出海从机场7890切到火种1088；exchange 接受无协议前缀的 localhost 回调链接（手机复制的链接不带 http://，曾导致 gemini 登录始终 invalid_grant）；新增 antigravity（Gemini 个人版 Code Assist 被 Google 下线后的迁移路线，多 cclog/experimentsandconfigs 两个 scope），project 缓存按供应商分文件] */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egressGuard = require('./egress-guard');
const common = require('./oauth-common');
const claudeToken = require('./claude-token');

// 出海代理：读取 EGRESS_PROXY / CLAUDE_OAUTH_PROXY / AIRPORT_PROXY，无默认地址。未配置时不得直连。
const { projectRoot } = require('./project-root');
function PROXY() { return egressGuard.proxyUrl(); }
function CLAUDE_PROXY() { return egressGuard.proxyUrl(); }
const DIR = process.env.OAUTH_TOKEN_DIR || require('path').join(projectRoot(), 'data', 'oauth');
const PENDING_TTL_MS = 15 * 60 * 1000;
const FAIL_COOLDOWN_MS = 60 * 1000;

// 每家的差异只有四样：端点/客户端身份、body 形态、出海走哪条代理、令牌落哪个文件。
// tokenFile 由 common.tokenFile(provider, account) 统一解析，这里只留「这家长什么样」。
const PROVIDERS = {
  claude: {
    label: 'Claude',
    authUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://claude.ai/v1/oauth/token',
    clientId: claudeToken.CLIENT_ID,
    clientSecret: '',
    redirectUri: 'http://localhost:54545/callback',
    scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
    extra: {},
    // Claude 的令牌端点只吃 JSON（手工脚本验证过），且前面有 Cloudflare，必须带 CLI 指纹头
    tokenBody: 'json',
    tokenHeaders: claudeToken.CLI_HEADERS,
    proxy: CLAUDE_PROXY,
    form: false,
  },
  gemini: {
    label: 'Gemini',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: process.env.GEMINI_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GEMINI_OAUTH_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:8085/oauth2callback',
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    extra: { access_type: 'offline', prompt: 'consent' },
    tokenBody: 'form',
    tokenHeaders: { 'user-agent': 'google-api-nodejs-client/9.15.1' },
    proxy: PROXY,
    form: true,
  },
  // 2026-11-04 新增：Gemini 订阅的 Code Assist 个人版已被 Google 下线（UNSUPPORTED_CLIENT，
  // 官方要求迁移 Antigravity），改用 Antigravity 自己的 OAuth 客户端（多两个 scope：
  // cclog / experimentsandconfigs，这两条正是 GemmiCLI 的 token 永远拿不到、两家不互通的根因）。
  // client_id/secret 按源内此前说明是 Antigravity 桌面客户端随包发布的公开标识；本批未独立再核实该来源，改为环境变量，未配置则该供应商 OAuth 不可用。
  antigravity: {
    label: 'Antigravity',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:51121/oauth-callback',
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs',
    // prompt 用官方的 select_account consent：换号时能选账号，且稳定下发 refresh_token
    extra: { access_type: 'offline', prompt: 'select_account consent' },
    tokenBody: 'form',
    tokenHeaders: { 'user-agent': 'google-api-nodejs-client/9.15.1' },
    proxy: PROXY,
    form: true,
  },
  codex: {
    label: 'ChatGPT',
    authUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: process.env.CHATGPT_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.CHATGPT_OAUTH_CLIENT_SECRET || '',
    redirectUri: 'http://localhost:1455/auth/callback',
    scope: 'openid profile email offline_access',
    // 这三个参数让 id_token 里带上组织与 plan，并让授权页走 CLI 精简流程
    extra: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    },
    tokenBody: 'form',
    tokenHeaders: {},
    proxy: PROXY,
    form: true,
  },
  /* [位置:lib/oauth-login.js·PROVIDERS.grok] [Grok 订阅登录（借官方 Grok CLI 的公开 client_id）] [11-16：把 Grok CLI 的订阅 OAuth 接到设置页「Grok 订阅」，登录态走同一套 PKCE + 粘贴回调；client_id 是 CLI 随包公开的，无 secret，靠 PKCE 保护；redirect 必须是注册过的 127.0.0.1:56121/callback；换令牌只吃 form（JSON 会 415）；access_token 实测约 6 小时] [注释时间 2026-11-16] */
  grok: {
    label: 'Grok',
    authUrl: 'https://auth.x.ai/oauth2/authorize',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    clientId: process.env.GROK_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GROK_OAUTH_CLIENT_SECRET || '',
    redirectUri: 'http://127.0.0.1:56121/callback',
    scope: 'openid profile email offline_access grok-cli:access api:access',
    extra: {},
    tokenBody: 'form',
    tokenHeaders: { 'user-agent': 'grok-cli' },
    proxy: PROXY,
    form: true,
  },
};

// key = provider|account -> { verifier, state, at }；跨进程靠 pending 文件
const pending = new Map();
// key = provider|account -> Promise（进程内单飞）
const inflight = new Map();
// key = provider|account -> { until, err }（非致命失败冷却）
const cooldown = new Map();

function acc(a) {
  return String(a || 'default').trim() || 'default';
}

function key(provider, account) {
  return provider + '|' + acc(account);
}

function pendingFile(provider, account) {
  const a = acc(account);
  return path.join(DIR, 'pending-' + provider + (a === 'default' ? '' : '-' + a) + '.json');
}

function savePending(provider, account, obj) {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(pendingFile(provider, account), JSON.stringify(obj), { mode: 0o600 });
  } catch (e) { /* 写不进去就只留内存 */ }
}

function loadPending(provider, account) {
  try {
    const j = JSON.parse(fs.readFileSync(pendingFile(provider, account), 'utf8'));
    if (j && j.verifier && j.state) return j;
  } catch (e) { /* fallthrough */ }
  return null;
}

function clearPending(provider, account) {
  try { fs.unlinkSync(pendingFile(provider, account)); } catch (e) { /* ignore */ }
}

// 顺手清掉历史遗留的过期 pending 文件（以前只在成功后删，取消一次就永远留一份）
function sweepPending(maxAgeMs) {
  const ttl = maxAgeMs || PENDING_TTL_MS;
  try {
    fs.readdirSync(DIR).forEach(function (name) {
      if (name.indexOf('pending-') !== 0 || name.slice(-5) !== '.json') return;
      const full = path.join(DIR, name);
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs > ttl) fs.unlinkSync(full);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* 目录还不存在 */ }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readToken(provider, account) {
  const P = PROVIDERS[provider];
  if (!P) return null;
  try {
    const j = JSON.parse(fs.readFileSync(common.tokenFile(provider, acc(account)), 'utf8'));
    if (!j || !j.access_token) return null;
    return j;
  } catch (e) {
    return null;
  }
}

function writeToken(provider, account, obj) {
  const file = common.tokenFile(provider, acc(account));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isExpired(tok, now) {
  return common.isExpired(tok, now);
}

// 统一的令牌端点请求：body 形态、指纹头、出口代理全部按 provider 取。先校验出口，失败不改直连。
/* [位置:lib/oauth-login.js·postToken] [登录换票刷新出海闸门] [各家订阅 token 端点都走这里，先 ensure 再经已配置代理发出] [注释时间 2026-11-25；改动：去掉写死代理端口] */
async function postToken(provider, form) {
  const P = PROVIDERS[provider];
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    const asJson = P.tokenBody === 'json';
    const body = asJson
      ? JSON.stringify(form)
      : Object.keys(form).map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(String(form[k]));
        }).join('&');
    const u = new URL(P.tokenUrl);
    const headers = Object.assign({
      'content-type': asJson ? 'application/json' : 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(body),
    }, P.tokenHeaders || {});
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      agent: new HttpsProxyAgent(typeof P.proxy === 'function' ? P.proxy() : (P.proxy || PROXY())),
      timeout: 30000,
      headers: headers,
    }, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        let j = {};
        try { j = JSON.parse(buf); } catch (e) { /* 保留原文 */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && j.access_token) return resolve(j);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return reject(new Error(provider + ' oauth: 200 但响应里没有 access_token: ' + String(buf).slice(0, 200)));
        }
        reject(common.makeError(provider, res.statusCode, buf));
      });
    });
    req.on('timeout', function () { req.destroy(new Error(provider + ' oauth token timeout')); });
    req.on('error', reject);
    req.end(body);
  });
}

// 从 id_token（JWT）里取 chatgpt account id / plan，不解签名只看载荷
function decodeJwtClaims(idToken) {
  try {
    const part = String(idToken || '').split('.')[1];
    if (!part) return {};
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return {};
  }
}

// 把令牌端点响应整理成落盘记录。各家要留的额外字段不同：
//   claude → account/organization 供状态接口显示邮箱；codex → account_id/plan；gemini → email
function toRecord(provider, j, prev) {
  const now = Date.now();
  const base = prev || {};
  if (provider === 'claude') {
    return Object.assign({}, base, j, {
      access_token: j.access_token,
      refresh_token: j.refresh_token || base.refresh_token || '',
      expires_in: j.expires_in || base.expires_in || 28800,
      obtained_at: now,
      account: j.account || base.account || null,
      organization: j.organization || base.organization || null,
    });
  }
  const claims = decodeJwtClaims(j.id_token || base.id_token);
  const accountId = claims.chatgpt_account_id
    || (claims['https://api.openai.com/auth'] && claims['https://api.openai.com/auth'].chatgpt_account_id)
    || base.account_id
    || '';
  return Object.assign({}, base, j, {
    provider: provider,
    access_token: j.access_token,
    refresh_token: j.refresh_token || base.refresh_token || '',
    id_token: j.id_token || base.id_token || '',
    token_type: j.token_type || base.token_type || 'Bearer',
    scope: j.scope || base.scope || '',
    expires_in: j.expires_in || base.expires_in || (provider === 'grok' ? 21600 : 3600),
    obtained_at: now,
    account_id: accountId,
    email: base.email || claims.email || (j.email || ''),
    plan: base.plan || claims.chatgpt_plan_type || '',
  });
}

function start(provider, opts) {
  const P = PROVIDERS[provider];
  if (!P) throw new Error('未知的 OAuth 提供方：' + provider);
  const a = acc(opts && opts.account);
  sweepPending(PENDING_TTL_MS);

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  pending.set(key(provider, a), { verifier: verifier, state: state, at: Date.now() });
  savePending(provider, a, { verifier: verifier, state: state, at: Date.now() });

  const u = new URL(P.authUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', P.clientId);
  u.searchParams.set('redirect_uri', P.redirectUri);
  u.searchParams.set('scope', P.scope);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  Object.keys(P.extra || {}).forEach(function (k) { u.searchParams.set(k, P.extra[k]); });
  return { authUrl: u.toString(), redirectUri: P.redirectUri, label: P.label, account: a };
}

// 接受整条回调 URL、或只给 code 也行
async function exchange(provider, rawInput, opts) {
  const P = PROVIDERS[provider];
  if (!P) throw new Error('未知的 OAuth 提供方：' + provider);
  const a = acc(opts && opts.account);
  const p = pending.get(key(provider, a)) || loadPending(provider, a);
  if (!p) throw new Error('没有进行中的登录，请先点「登录」重新开始');
  if (Date.now() - p.at > PENDING_TTL_MS) {
    pending.delete(key(provider, a));
    clearPending(provider, a);
    throw new Error('登录已超时，请重新点「登录」');
  }

  let code = String(rawInput || '').trim();
  let state = '';
  // 手机浏览器复制地址栏经常把协议前缀省掉（贴回来是 localhost:8085/...），补上再解析。
  // 不补的话下面 /^https?:\/\// 匹配不上，整条链接会被当成 code 发给上游——
  // 上游回 invalid_grant(Malformed auth code)，且 state 解析为空会静默跳过校验。
  // 2026-11-04 Gemini 登录从未成功过的根因就是它。
  if (/^(localhost|127\.0\.0\.1)(:\d+)?\//i.test(code)) code = 'http://' + code;
  if (/^https?:\/\//i.test(code)) {
    let u;
    try { u = new URL(code); } catch (e) { throw new Error('粘贴的内容不是合法链接'); }
    code = u.searchParams.get('code') || '';
    state = u.searchParams.get('state') || '';
  }
  if (!code) throw new Error('链接里没有 code');

  // Google / OpenAI / Anthropic 都会回 state。给了就必须一致——这只是粘贴流程里唯一的 CSRF 防线。
  if (state && state !== p.state) throw new Error('state 不匹配，请重新登录');

  const form = {
    grant_type: 'authorization_code',
    client_id: P.clientId,
    code: code,
    redirect_uri: P.redirectUri,
    code_verifier: p.verifier,
  };
  if (P.clientSecret) form.client_secret = P.clientSecret;
  // Claude 的换令牌请求要求把 state 一起带上（手工脚本验证过）
  if (provider === 'claude') form.state = p.state;
  // xAI 换令牌时会再校验 PKCE 字段（公开实现普遍要带，漏了可能 invalid_grant）
  if (provider === 'grok') {
    form.code_challenge = b64url(crypto.createHash('sha256').update(p.verifier).digest());
    form.code_challenge_method = 'S256';
  }

  const started = Date.now();
  let j;
  try {
    j = await postToken(provider, form);
  } catch (e) {
    common.logFail(provider, 'exchange', e, Date.now() - started, { account: a });
    throw e;
  }

  const tok = toRecord(provider, j, readToken(provider, a));
  writeToken(provider, a, tok);
  pending.delete(key(provider, a));
  clearPending(provider, a);
  common.clearNeedsReauth(common.markKey(provider, a));
  cooldown.delete(key(provider, a));
  common.clearCooldown(provider, a);
  // Cloud Code project 绑定账号（gemini / antigravity 同一条链路），换了账号必须重新发现
  if (provider === 'gemini' || provider === 'antigravity') {
    try { fs.unlinkSync(projectCacheFile(a, provider)); } catch (e) { /* 没缓存过 */ }
  }
  common.logOk(provider, 'exchange', Date.now() - started, { email: tok.email || '', account: a });
  return publicStatus(provider, a, tok);
}

async function refresh(provider, tok, account) {
  const P = PROVIDERS[provider];
  const a = acc(account);
  const form = {
    grant_type: 'refresh_token',
    client_id: P.clientId,
    refresh_token: tok.refresh_token,
  };
  if (P.clientSecret) form.client_secret = P.clientSecret;
  if (provider === 'codex') form.scope = P.scope;

  const started = Date.now();
  try {
    const j = await postToken(provider, form);
    const next = toRecord(provider, j, tok);
    writeToken(provider, a, next);
    common.clearNeedsReauth(common.markKey(provider, a));
    common.logOk(provider, 'refresh', Date.now() - started, { expires_in: next.expires_in || 0, account: a });
    return next;
  } catch (e) {
    common.logFail(provider, 'refresh', e, Date.now() - started, { account: a });
    throw e;
  }
}

// 刷新主流程：锁 → 双重检查 → 换 → 写；失败则分类 + 并发比价
function refreshGuarded(provider, account, stale, force) {
  const a = acc(account);
  return common.withRefreshLock(provider + (a === 'default' ? '' : '-' + a), async function () {
    const before = readToken(provider, a);
    if (before && !force && !isExpired(before, Date.now())) return before;

    const base = before || stale;
    if (!base || !base.refresh_token) {
      const e = new Error(PROVIDERS[provider].label + ' 的令牌已过期且没有 refresh_token，请重新登录');
      e.needsReauth = true;
      common.markNeedsReauth(common.markKey(provider, a), {
        status: 0,
        code: 'no_refresh_token',
        cred_at: base && base.obtained_at,
        message: e.message,
      });
      throw e;
    }

    try {
      return await refresh(provider, base, a);
    } catch (e) {
      const fresh = readToken(provider, a);
      if (fresh && base && Number(fresh.obtained_at) !== Number(base.obtained_at)) {
        common.logLine(provider, 'refresh', { ok: true, stale: true, account: a });
        return fresh;
      }
      if (e && e.fatal) {
        common.markNeedsReauth(common.markKey(provider, a), {
          status: e.status,
          code: e.code,
          cred_at: base && base.obtained_at,
          message: e.message,
        });
        e.needsReauth = true;
      } else {
        cooldown.set(key(provider, a), { until: Date.now() + FAIL_COOLDOWN_MS, err: e });
      }
      throw e;
    }
  });
}

async function getAccessToken(provider, opts) {
  const P = PROVIDERS[provider];
  if (!P) throw new Error('未知的 OAuth 提供方：' + provider);
  const o = opts || {};
  const a = acc(o.account);
  const force = !!o.force;
  let tok = readToken(provider, a);
  if (!tok) {
    const e = new Error(P.label + ' 还没有登录' + (a === 'default' ? '' : '（账号 ' + a + '）'));
    e.needsReauth = true;
    throw e;
  }
  if (!tok.obtained_at) {
    try { tok.obtained_at = fs.statSync(common.tokenFile(provider, a)).mtimeMs; } catch (e) { tok.obtained_at = Date.now(); }
    try { writeToken(provider, a, tok); } catch (e) { /* ignore */ }
  }
  if (!force && !isExpired(tok, Date.now())) return tok.access_token;

  const cool = cooldown.get(key(provider, a));
  if (!force && cool && Date.now() < cool.until) throw cool.err;

  if (!inflight.has(key(provider, a))) {
    const p = refreshGuarded(provider, a, tok, force).finally(function () { inflight.delete(key(provider, a)); });
    inflight.set(key(provider, a), p);
  }
  const next = await inflight.get(key(provider, a));
  return next.access_token;
}

// 拿完整记录（Codex 需要 account_id 跟请求一起发）
async function getAuth(provider, opts) {
  await getAccessToken(provider, opts);
  return readToken(provider, (opts && opts.account));
}

// 账号池挑人用的最小判断：有令牌、没被标失效、不在冷却里
function accountUsable(provider, account) {
  const a = acc(account);
  const tok = readToken(provider, a);
  if (!tok) return false;
  if (common.needsReauth(common.markKey(provider, a), tok)) return false;
  if (common.cooldownLeft(provider, a) > 0) return false;
  return true;
}

function publicStatus(provider, account, tokArg) {
  const P = PROVIDERS[provider];
  if (!P) return { connected: false };
  const a = acc(account);
  const tok = tokArg || readToken(provider, a);
  const mark = tok ? common.needsReauth(common.markKey(provider, a), tok) : common.readMark(common.markKey(provider, a));
  const reason = mark ? (mark.code || ('HTTP ' + (mark.status || '?'))) : '';
  if (!tok) {
    return {
      connected: false,
      label: P.label,
      account: a,
      needs_reauth: !!mark,
      needs_reauth_reason: reason,
      last_error: mark ? String(mark.message || '') : '',
    };
  }
  const obtained = Number(tok.obtained_at || 0);
  const ttl = Number(tok.expires_in || 0) * 1000;
  return {
    connected: true,
    label: P.label,
    account: a,
    email: tok.email || (tok.account && tok.account.email_address) || '',
    plan: tok.plan || '',
    expires_at: obtained && ttl ? new Date(obtained + ttl).toISOString() : null,
    /* [2026-11-16 批4 M1] 同 lib/claude-token.js：有 refresh_token 就能自动续，TTL 窗口过了不算「过期」；只有真没有 refresh_token 的过期才报（届时通常也带 needs_reauth） */
    expired: isExpired(tok, Date.now()) && !tok.refresh_token,
    has_refresh: !!tok.refresh_token,
    needs_reauth: !!mark,
    needs_reauth_reason: reason,
    last_error: mark ? String(mark.message || '') : '',
    cooling: common.cooldownLeft(provider, a),
  };
}

// 这一家所有账号的状态（管理台/手机页用）
function listStatus(provider) {
  return common.listAccounts(provider).map(function (a) {
    return publicStatus(provider, a);
  });
}

// 令牌库里到底有没有可用的令牌（供 server.js 的凭证闸门用：
// 判「有没有凭证」只该问令牌库，不该问配置文件里那个会被前端整表回存的 oauth_provider）
function hasToken(provider) {
  return common.listAccounts(provider).some(function (a) {
    const t = readToken(provider, a);
    return !!(t && t.access_token);
  });
}

// 一家全都失效了吗（用于把报错改写成"去重新登录"）
function needsReauth(provider) {
  const list = common.listAccounts(provider);
  if (!list.length) return false;
  return list.every(function (a) {
    const t = readToken(provider, a);
    return !t || !!common.needsReauth(common.markKey(provider, a), t);
  });
}

function logout(provider, opts) {
  const P = PROVIDERS[provider];
  if (!P) return false;
  const a = acc(opts && opts.account);
  let ok = false;
  try { fs.unlinkSync(common.tokenFile(provider, a)); ok = true; } catch (e) { ok = false; }
  common.clearNeedsReauth(common.markKey(provider, a));
  common.clearCooldown(provider, a);
  cooldown.delete(key(provider, a));
  pending.delete(key(provider, a));
  clearPending(provider, a);
  common.logLine(provider, 'logout', { ok: ok, account: a });
  return ok;
}

// Cloud Code project 缓存按「供应商+账号」分文件（gemini 的 default 沿用老名字，零迁移）
function projectCacheFile(account, provider) {
  const a = acc(account);
  const prov = String(provider || 'gemini');
  if (prov === 'gemini') {
    return path.join(DIR, a === 'default' ? 'gemini-project.json' : 'gemini-project.' + a + '.json');
  }
  return path.join(DIR, prov + '-project' + (a === 'default' ? '' : '.' + a) + '.json');
}

module.exports = {
  start: start,
  exchange: exchange,
  getAccessToken: getAccessToken,
  getAuth: getAuth,
  status: publicStatus,
  listStatus: listStatus,
  accountUsable: accountUsable,
  logout: logout,
  hasToken: hasToken,
  needsReauth: needsReauth,
  projectCacheFile: projectCacheFile,
  PROVIDERS: PROVIDERS,
  PROXY: PROXY,
  sweepPending: sweepPending,
};
