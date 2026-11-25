'use strict';
// claude-token.js —— Claude 订阅 OAuth 凭证的读取、按需刷新与原子写回。
//
// 账号模型（2026-10-22 第二轮）：同一家可以挂多个账号。默认账号仍是 data/oauth/claude-token.json
// （零迁移），额外账号在 data/oauth/accounts/claude/<id>.json。所有函数都接受 { account }，
// 不传就是 default；账号池的选择与限流冷却在 lib/oauth-pool.js。
//
// 刷新必须走已配置的 HTTP 代理（EGRESS_PROXY / CLAUDE_OAUTH_PROXY），无默认地址：
// Anthropic 对大陆出口返回 403 region_unavailable，直连既不通也平白多一次风控面。
//
// 刷新策略：
//   · 只在 access token 距过期不足 5 分钟时才刷，401 兜底可强制刷一次（getAccessToken({force:true})）；
//   · 单飞：进程内同一账号同一时刻最多一个刷新；跨进程用文件锁（gateway / state-worker / 手工脚本）；
//   · 刷新失败先分类：只有上游明确拒了这份凭证才打「需要重新登录」标记，网络抖动不算；
//   · 永远不删凭证——标记可以靠一次重新登录自愈，删掉就找不回来了；
//   · 非致命失败后 60 秒内不再重试，避免每个请求都去撞上游；
//   · 成功后立刻清标记；标记用凭证签发时间当指纹，换了新凭证自动失效。
//
/* [位置:lib/claude-token.js·getAccessToken] [Claude 订阅令牌按需刷新（支持多账号）] [订阅账号的 access token 过期时自动换新，并把「凭证失效」与「网络抖动」分开处理] [注释时间 2026-10-22；改动：加账号参数、401 强制刷新、失败分类、重登标记、跨进程锁、60 秒冷却、刷新日志] */

const fs = require('fs');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egressGuard = require('./egress-guard');
const common = require('./oauth-common');

// 默认账号的路径（历史位置）；其他账号由 common.tokenFile 解析
const TOKEN_FILE = common.tokenFile('claude', 'default');
function PROXY() { return egressGuard.proxyUrl(); }
const TOKEN_URL = 'https://claude.ai/v1/oauth/token';
const CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID || '';
const FAIL_COOLDOWN_MS = 60 * 1000;

// Claude Code CLI 的客户端版本号。上游对部分新模型做「客户端版本门禁」：
// 2026-11-11 实测 claude-fable-5-2 回 400 claude_code_version_too_old，要求 >= 2.1.290；
// 同一个令牌、同一套头，只把这里的版本改成 2.1.290 就 200（其余模型对版本不敏感）。
// 想临时顶到别的版本，.env 里设 CLAUDE_CLI_VERSION=2.1.xxx 即可，不用改代码。
const CLI_VERSION = String(process.env.CLAUDE_CLI_VERSION || '').trim() || '2.1.290';

// Claude Code CLI 的客户端指纹：token 端点前面有 Cloudflare bot 管理，
// 不带这套头的请求会被回 "Just a moment" 的 403 HTML。刻意不含 anthropic-beta——
// 那是消息接口的协商头，真实的 CLI 在 token 请求上也不发它。
// 只在这里定义一份：登录流程（lib/oauth-login.js）、额度查询（lib/claude-usage.js）、
// 聊天转发（routes/anthropic-proxy.js）都 require 它，避免几处各写一份慢慢漂移。
/* [位置:lib/claude-token.js·CLI_HEADERS] [Claude Code 客户端指纹头] [订阅令牌刷新/额度查询/聊天转发共用一份，版本号按上游门禁可调；11-11 把 UA 版本 2.1.280 提到 2.1.290 并支持 CLAUDE_CLI_VERSION 覆盖，修 claude-fable-5-2 报「客户端版本过旧」400] [注释时间 2026-11-11] */
const CLI_HEADERS = {
  'User-Agent': 'claude-cli/' + CLI_VERSION + ' (external, cli)',
  'X-Stainless-Lang': 'js',
  'X-Stainless-Package-Version': '0.106.0',
  'X-Stainless-OS': 'Linux',
  'X-Stainless-Arch': 'arm64',
  'X-Stainless-Runtime': 'node',
  'X-Stainless-Runtime-Version': 'v24.18.0',
  'X-Stainless-Retry-Count': '0',
  'X-Stainless-Timeout': '600',
  'X-App': 'cli',
  'Anthropic-Dangerous-Direct-Browser-Access': 'true',
};

// 订阅 OAuth 的硬性门槛：messages 请求的 system 第一块必须是 Claude Code 的身份行。
// 实测（2026-10-22，同一令牌直连 api.anthropic.com）：
//   只带 oauth beta → 429 {"type":"rate_limit_error","message":"Error"}（不带原因）
//   加指纹头 + 全套 beta，但 system 没这一行 → 仍然 429
//   加上这一行 → 200；这一行 + 用户自己的系统提示词（第二块）→ 200
// 也就是说 429 未必是额度用尽，而是「上游不认这是 Claude Code」。OpenMinis 的构建配置里
// 写的是同一件事：OAuth 请求必须以这一行开头，否则端点拒绝。
const OAUTH_IDENTITY_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

// 官方 CLI 在 messages 请求上带的整套 beta。身份行是硬门槛，这套 beta 是「额度归属」的软门槛：
// 少带会被上游按第三方流量降级（参考 sub2api 常量注释里的报错原文）。与身份行一起带，
// 才和真实 CLI 流量一致；追加在调用方已有 beta 之后，不覆盖。
const CLI_BETAS = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'prompt-caching-scope-2026-01-05',
  'effort-2025-11-24',
  'context-management-2025-06-27',
  'extended-cache-ttl-2025-04-11',
];

// account -> { promise } / account -> { until, err }
const inFlight = new Map();
const cooldown = new Map();

function acc(account) {
  return String(account || 'default').trim() || 'default';
}

function fileOf(account) {
  return common.tokenFile('claude', acc(account));
}

function readState(account) {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(account), 'utf8'));
    if (!j || !j.access_token) return null;
    return j;
  } catch (e) {
    return null;
  }
}

function isExpired(st, now) {
  return common.isExpired(st, now);
}

function writeState(account, next) {
  const file = fileOf(account);
  fs.mkdirSync(require('path').dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function postJson(bodyObj) {
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(bodyObj);
    const u = new URL(TOKEN_URL);
    const headers = Object.assign(
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      CLI_HEADERS
    );
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname,
      headers: headers,
      timeout: 30000,
    };
    opts.agent = new HttpsProxyAgent(egressGuard.requireProxyUrl());
    const req = https.request(opts, function (res) {
      let buf = '';
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let j = {};
          try { j = JSON.parse(buf); } catch (e) { /* 非 JSON 按失败处理 */ }
          if (j && j.access_token) return resolve(j);
          // 2xx 却没有 token：按非致命解码失败处理，别误判成「凭证废了」
          return reject(new Error('claude oauth: 200 但没有 access_token: ' + String(buf).slice(0, 200)));
        }
        reject(common.makeError('claude', res.statusCode, buf));
      });
    });
    req.on('timeout', function () { req.destroy(new Error('claude token refresh timeout')); });
    req.on('error', reject);
    req.end(data);
  });
}

// 真正的换令牌动作：不带并发治理，调用方负责单飞与锁
async function refresh(st) {
  const rt = st && st.refresh_token;
  if (!rt) throw new Error('claude oauth: no refresh_token in ' + TOKEN_FILE);
  const j = await postJson({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: rt });
  return Object.assign({}, st, j, {
    access_token: j.access_token,
    // Anthropic 每次刷新都轮换 refresh_token；万一这次没回，沿用旧的，否则下次必挂
    refresh_token: j.refresh_token || rt,
    expires_in: j.expires_in || st.expires_in,
    obtained_at: Date.now(),
  });
}

// 刷新主流程：锁 → 双重检查 → 换 → 写 → 清标记；失败则分类 + 并发比价（别覆盖别人刚换的新令牌）
async function refreshGuarded(account, staleRecord, force) {
  const a = acc(account);
  return common.withRefreshLock('claude' + (a === 'default' ? '' : '-' + a), async function () {
    const before = readState(a);
    if (before && !force && !isExpired(before, Date.now())) return before; // 拿锁期间别人已刷好

    const base = before || staleRecord;
    const started = Date.now();
    try {
      const next = await refresh(base);
      writeState(a, next);
      common.clearNeedsReauth(common.markKey('claude', a));
      cooldown.delete(a);
      common.logOk('claude', 'refresh', Date.now() - started, { expires_in: next.expires_in || 0, account: a });
      return next;
    } catch (e) {
      // 并发比价：如果令牌文件已经被别人换过（obtained_at 变了），说明我这次失败的是过期请求
      const fresh = readState(a);
      if (fresh && base && Number(fresh.obtained_at) !== Number(base.obtained_at)) {
        common.logLine('claude', 'refresh', { ok: true, stale: true, ms: Date.now() - started, account: a });
        return fresh;
      }
      common.logFail('claude', 'refresh', e, Date.now() - started, { account: a });
      if (e && e.fatal) {
        // 只标记、不删：用户重登一次就好，删了反而没法自动恢复
        common.markNeedsReauth(common.markKey('claude', a), {
          status: e.status,
          code: e.code,
          cred_at: base && base.obtained_at,
          message: e.message,
        });
        e.needsReauth = true;
      } else {
        cooldown.set(a, { until: Date.now() + FAIL_COOLDOWN_MS, err: e });
      }
      throw e;
    }
  });
}

async function getAccessToken(opts) {
  const o = opts || {};
  const a = acc(o.account);
  const force = !!o.force;
  let st = readState(a);
  if (!st) throw new Error('claude oauth: token file missing or invalid (' + fileOf(a) + ')');
  if (!st.obtained_at) {
    // 首次接入：用文件 mtime 当签发时间，避免刚授权完就被判过期而去多刷一次。
    try { st.obtained_at = fs.statSync(fileOf(a)).mtimeMs; } catch (e) { st.obtained_at = Date.now(); }
    try { writeState(a, st); } catch (e) { /* 只读挂载时忽略 */ }
  }
  if (!force && !isExpired(st, Date.now())) return st.access_token;

  // 刚失败过就别再撞（force 是 401 兜底，必须真的去试一次）
  const cool = cooldown.get(a);
  if (!force && cool && Date.now() < cool.until) throw cool.err;

  if (!inFlight.has(a)) {
    const p = refreshGuarded(a, st, force).then(function (r) { inFlight.delete(a); return r; }, function (e) { inFlight.delete(a); throw e; });
    inFlight.set(a, p);
  }
  const next = await inFlight.get(a);
  return next.access_token;
}

// 给管理台/账号池用的只读状态（绝不返回 token 本体）
function status(account) {
  const a = acc(account);
  const st = readState(a);
  const markKey = common.markKey('claude', a);
  const mark = st ? common.needsReauth(markKey, st) : null;
  const reason = mark ? (mark.code || ('HTTP ' + (mark.status || '?'))) : '';
  if (!st) {
    return {
      connected: false,
      needs_reauth: !!mark,
      needs_reauth_reason: reason,
      last_error: mark ? String(mark.message || '') : '',
    };
  }
  const obtained = Number(st.obtained_at || 0);
  const ttl = Number(st.expires_in || 0) * 1000;
  return {
    connected: true,
    /* [2026-11-16 批4 M1] expired 的用户语义是「这份凭证不能用了」：有 refresh_token 的会在下次调用时自动续（getAccessToken 惰性刷新，oauth-login.js:475），access token 的 TTL 窗口过了不算过期。之前一律按 TTL 报 expired，四家订阅全显示「（已过期）」但模型照常可用，文案严重误导。只有真没有 refresh_token 的过期才报（届时通常也带 needs_reauth） */
    expired: isExpired(st, Date.now()) && !st.refresh_token,
    expires_at: obtained && ttl ? new Date(obtained + ttl).toISOString() : null,
    has_refresh: !!st.refresh_token,
    email: (st.account && st.account.email_address) || st.email || '',
    plan: st.plan || '',
    needs_reauth: !!mark,
    needs_reauth_reason: reason,
    last_error: mark ? String(mark.message || '') : '',
  };
}

// 登录成功后由 lib/oauth-login.js 调用：清掉可能残留的失效标记
function clearReauthMark(account) {
  const a = acc(account);
  common.clearNeedsReauth('claude' + (a === 'default' ? '' : '-' + a));
}

module.exports = {
  getAccessToken: getAccessToken,
  status: status,
  TOKEN_FILE: TOKEN_FILE,
  CLI_HEADERS: CLI_HEADERS,
  CLI_BETAS: CLI_BETAS,
  OAUTH_IDENTITY_PROMPT: OAUTH_IDENTITY_PROMPT,
  CLIENT_ID: CLIENT_ID,
  clearReauthMark: clearReauthMark,
  fileOf: fileOf,
};
