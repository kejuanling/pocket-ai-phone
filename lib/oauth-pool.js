'use strict';
// oauth-pool.js —— 订阅账号池（claude / gemini / codex 通用）。
//
// 一个「账号」= 一份令牌文件。请求进来先按顺序挑一个能用的；某个号被上游 429 就冷却它，
// 换下一个重试一次。只有一个号时冷却不会让它不可用（candidates 会把冷却的号放回最后兜底）。
//
// 为什么把 claude 和另外两家统一到这一层：三家在代理里要做的事一模一样（挑号、取令牌、
// 429 换号、401 强刷），分开写迟早漂移成两套语义。
//
/* [位置:lib/oauth-pool.js·模块] [订阅账号池] [同一家多账号时统一挑号/取令牌/429 换号/冷却，代理层不再各自判断] [注释时间 2026-10-22] */

const common = require('./oauth-common');
const claudeToken = require('./claude-token');
const oauthLogin = require('./oauth-login');

// 429 之后的冷却时长：Claude 订阅的 5 小时窗口读不出来，30 分钟是保守值——
// 宁可早点把号放回来试，也不要因为一条 429 就把号永久判死。
const QUOTA_COOLDOWN_MS = Number(process.env.OAUTH_QUOTA_COOLDOWN_MS) > 0
  ? Number(process.env.OAUTH_QUOTA_COOLDOWN_MS)
  : 30 * 60 * 1000;

function statusOf(provider, account) {
  if (provider === 'claude') {
    const st = claudeToken.status(account);
    // account 必须是账号 id（default / a1…），不能被状态里的邮箱字段盖掉
    return Object.assign({}, st, { account: account, cooling: common.cooldownLeft(provider, account) });
  }
  return oauthLogin.status(provider, account);
}

function list(provider) {
  return common.listAccounts(provider).map(function (a) { return statusOf(provider, a); });
}

function usable(provider, account) {
  const st = statusOf(provider, account);
  if (!st || !st.connected) return false;
  if (st.needs_reauth) return false;
  if (common.cooldownLeft(provider, account) > 0) return false;
  return true;
}

// 候选账号：能用的在前，其余（失效/冷却）按原顺序排后面兜底。
function candidates(provider) {
  const all = common.listAccounts(provider);
  const ok = all.filter(function (a) { return usable(provider, a); });
  const rest = all.filter(function (a) { return ok.indexOf(a) < 0; });
  return { all: all, usable: ok, ordered: ok.concat(rest) };
}

function token(provider, account, opts) {
  const o = Object.assign({ account: account }, opts || {});
  if (provider === 'claude') return claudeToken.getAccessToken(o);
  return oauthLogin.getAccessToken(provider, o);
}

async function auth(provider, account, opts) {
  const o = Object.assign({ account: account }, opts || {});
  if (provider === 'claude') return { access_token: await claudeToken.getAccessToken(o) };
  return oauthLogin.getAuth(provider, o);
}

// 上游 429：把这个号冷一段时间，交给下一个
function markQuota(provider, account, why) {
  common.setCooldown(provider, account, QUOTA_COOLDOWN_MS, why || '429');
  common.logLine(provider, 'quota-cooldown', {
    account: account,
    until_min: Math.round(QUOTA_COOLDOWN_MS / 60000),
  });
}

// 有没有任何可用账号（凭证闸门用）
function hasAny(provider) {
  return common.listAccounts(provider).length > 0;
}

function needsReauth(provider) {
  const all = common.listAccounts(provider);
  if (!all.length) return false;
  return all.every(function (a) { return !usable(provider, a) && statusOf(provider, a).needs_reauth; });
}

module.exports = {
  QUOTA_COOLDOWN_MS: QUOTA_COOLDOWN_MS,
  list: list,
  statusOf: statusOf,
  usable: usable,
  candidates: candidates,
  token: token,
  auth: auth,
  markQuota: markQuota,
  hasAny: hasAny,
  needsReauth: needsReauth,
};
