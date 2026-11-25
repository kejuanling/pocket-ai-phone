'use strict';
// upstream-target.js —— 统一决定「这条供应商往哪里发、带什么凭证」。
// 主链路 / 唤醒 / MCP 工具循环三个出口都只会说 OpenAI 兼容协议；
// Claude 订阅（OAuth）只能走 Anthropic 原生协议，所以这里把三个出口统一指向
// 内部翻译代理 /internal/anthropic/chat/completions（routes/anthropic-proxy.js），
// 由它负责格式翻译、取 token、走代理出海。

function isAnthropicProxy(prov) {
  return !!(prov && (prov.via_anthropic_proxy === true || String(prov.oauth_provider || '') === 'claude'));
}

/* [位置:lib/upstream-target.js·isClaudeChat] [真·Claude 链路判据（Claude 专属开关用）] [isAnthropicProxy 是路由级判据，Gemini 订阅（antigravity）也走内部代理但出口是 Cloud Code Assist，x-claude-cache-ttl / reasoning_effort / x-session-id / effective_is_claude 这些 Claude 专属语义对它无效却恒命中（2026-11-12 用户发现：Gemini 会话显示「Claude 思考」）；窄口径与其共同判定收拢成这一份，outbound-images.isClaudeImageUpstream 委托至此] [注释时间 2026-11-12] */
function isClaudeChat(prov) {
  return !!(prov && (String(prov.oauth_provider || '') === 'claude' || (prov.via_anthropic_proxy === true && !prov.oauth_provider)));
}

/* [位置:lib/upstream-target.js·isGlmChat] [智谱 GLM 链路判据] [11-15：头像菜单按实际是否 GLM 显示「GLM 历史思考」开关；判定智谱 Coding Plan / GLM 开放平台（open.bigmodel.cn）或名称含 glm 的供应商] [注释时间 2026-11-15] */
function isGlmChat(prov) {
  if (!prov) return false;
  const url = String(prov.api_url || prov.base_url || '');
  if (/bigmodel\.cn/i.test(url)) return true;
  const name = String(prov.name || '');
  if (/glm/i.test(name)) return true;
  return false;
}

/* [位置:lib/upstream-target.js·isGrokChat] [Grok 订阅链路判据] [11-16：Grok 的思考档位与参数剔除只对 oauth_provider=grok 的供应商生效；不复用 isClaudeChat（Gemini/Codex 订阅也走同一个内部代理，但没有这两套语义）] [注释时间 2026-11-16] */
function isGrokChat(prov) {
  return !!(prov && String(prov.oauth_provider || '') === 'grok');
}

/* [位置:lib/upstream-target.js·isGrokThinkingModel] [Grok 4.x 才算思考模型] [官方：grok-4.x 一律带思考、不能关闭，且硬拒 presence_penalty / frequency_penalty / stop；grok-build 之类的非 4.x 发档位等于白发] [注释时间 2026-11-16] */
function isGrokThinkingModel(model) {
  return /^grok-4([.\-]|$)/i.test(String(model || ''));
}

/* [位置:lib/upstream-target.js·grokSupportsXhigh] [极高档只给 4.6 及以上] [官方：grok-4.7 / 4.6 支持 low/medium/high/xhigh，4.5 及以下把 xhigh 当 high；前端「极高」选项按这条显隐] [注释时间 2026-11-16] */
function grokSupportsXhigh(model) {
  const m = /^grok-4\.(\d+)/i.exec(String(model || ''));
  return !!(m && Number(m[1]) >= 6);
}

/* [位置:lib/upstream-target.js·grokEffortFor] [Grok 思考档位归一（聊天 / 唤醒 / 工具循环共用这一份）] [11-16：会话档位为空=不传参数（厂商默认 high，Grok 4.6/4.7 不能关思考）；只有 grok-4.x 认 reasoning_effort；xhigh 在 4.5 及以下夹回 high，防旧模型 400] [注释时间 2026-11-16] */
function grokEffortFor(model, effort) {
  const v = String(effort || '').toLowerCase();
  if (v !== 'low' && v !== 'medium' && v !== 'high' && v !== 'xhigh') return null;
  if (!isGrokThinkingModel(model)) return null;
  if (v === 'xhigh' && !grokSupportsXhigh(model)) return 'high';
  return v;
}

// 这个模型是否走代理（供应商 proxy_models 里列了它；10-24 需求 37：每个模型在「高级设置」里自己开关）
function isProxyModel(prov, model) {
  return !!(prov && Array.isArray(prov.proxy_models) && model && prov.proxy_models.indexOf(String(model)) >= 0);
}

/* [位置:lib/upstream-target.js·resolveTarget] [viaProxy 分两类（proxyKind）] [11-15：viaProxy 其实是两种完全不同的出口——subscription-proxy 走内部翻译代理（routes/oauth-proxy.js / routes/anthropic-proxy.js），会把站内 /uploads 引用内联成 data:URL，给 data: 反而被剥成占位；egress-proxy 走 routes/http-proxy.js，请求体原样透传给上游，上游不认识站内路径。调用方（lib/voice-msg.js 的音频形态）必须按 proxyKind 分档，不能只看 viaProxy] [注释时间 2026-11-15] */
function resolveTarget(prov, readEnvValue, model) {
  const read = typeof readEnvValue === 'function' ? readEnvValue : function (k) { return process.env[k]; };
  // 走代理的模型：不直连，交给本机转发口 /internal/http-proxy/chat/completions（routes/http-proxy.js）经代理出海
  if (!isAnthropicProxy(prov) && isProxyModel(prov, model)) {
    const port = Number(process.env.PORT) || 3000;
    const key = read('INTERNAL_API_KEY') || '';
    return {
      url: 'http://127.0.0.1:' + port + '/internal/http-proxy/chat/completions',
      key: key,
      headers: { 'x-internal-key': key, 'x-provider-id': String(prov.id || '') },
      viaProxy: true,
      proxyKind: 'egress-proxy',   // 普通代理：routes/http-proxy.js 原样透传，上游不认站内引用
    };
  }
  if (isAnthropicProxy(prov)) {
    const port = Number(process.env.PORT) || 3000;
    const key = read('INTERNAL_API_KEY') || '';
    // 三家订阅账号的协议都不一样，各自有翻译代理：
    //   claude                 -> Anthropic Messages（routes/anthropic-proxy.js）
    //   gemini / antigravity / codex / grok -> routes/oauth-proxy.js
    //     （Cloud Code Assist / Responses API / api.x.ai Chat Completions）
    //   2026-11-04：antigravity 必须在这里点名，漏了会落到 Anthropic 翻译代理上（协议完全不兼容）
    //   2026-11-16：grok 同理，漏了会落到 Anthropic 翻译代理
    const provider = String(prov.oauth_provider || '');
    const proxyPath = (provider === 'gemini' || provider === 'antigravity' || provider === 'codex' || provider === 'grok')
      ? '/internal/oauth/chat/completions'
      : '/internal/anthropic/chat/completions';
    return {
      url: 'http://127.0.0.1:' + port + proxyPath,
      key: key,
      headers: { 'x-internal-key': key, 'x-provider-id': String(prov.id || '') },
      viaProxy: true,
      proxyKind: 'subscription-proxy',   // 订阅代理：内部翻译代理会把站内引用内联成 data:URL
    };
  }
  return {
    url: (prov && (prov.api_url || prov.base_url)) || read('TARGET_API_URL'),
    key: (prov && prov.api_key) || read('TARGET_API_KEY'),
    headers: {},
    viaProxy: false,
  };
}

module.exports = { isAnthropicProxy: isAnthropicProxy, isClaudeChat: isClaudeChat, isGlmChat: isGlmChat, isGrokChat: isGrokChat, isGrokThinkingModel: isGrokThinkingModel, grokSupportsXhigh: grokSupportsXhigh, grokEffortFor: grokEffortFor, isProxyModel: isProxyModel, resolveTarget: resolveTarget };
