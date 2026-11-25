'use strict';
// 按用途路由模型（2026-09-24）：压缩/记忆/rerank 等后台任务可各自指定供应商+模型，
// role_models 空 = 跟随全局默认聊天供应商。配置与 providers 同存 ai-providers.json。
// 所有后台 LLM 调用点统一从这里取 {provider, model}，不再各自读 env TARGET_API_*。
const fs = require("fs");
const path = require("path");
const ROOT_DIR = path.join(__dirname, "..");  // 1018-13：模块已搬进子目录，项目根 = 上一级
const { writeJsonAtomic } = require("../utils/json_atomic"); // V10 收敛：本地重复实现已删

const AI_PROVIDERS_CONFIG = path.join(ROOT_DIR, "config", "ai-providers.json");

const KNOWN_MODEL_ROLES = {
  compaction:      "状态机llm",
  memory_admit:    "门卫llm",
  memory_summary:  "两大块总结",
  backfill:        "老数据重跑",
  distill:         "每日蒸馏",
  voice_desc:      "语音识别与描述",
  image_desc:      "图片转写",          /* 2026-10-27：给不能看图的聊天模型生成图片文字转写 */
  subagent:        "子智能体",          /* 2026-10-25：派杂活的子会话模型（建议便宜模型）；未配时 subagent-runner 报错引导，不回退全局 */
  notebook_meta:   "笔记摘要与关键词"   /* 2026-11-21：笔记新建/正文变动后，后台小模型自动整理摘要与关键词 */
};

function loadProviders() {
  try {
    const cfg = JSON.parse(fs.readFileSync(AI_PROVIDERS_CONFIG, "utf-8"));
    return Array.isArray(cfg) ? cfg : (Array.isArray(cfg.providers) ? cfg.providers : []);
  } catch (e) { return []; }
}
function loadProvidersConfigRaw() {
  try {
    const cfg = JSON.parse(fs.readFileSync(AI_PROVIDERS_CONFIG, "utf-8"));
    return (cfg && typeof cfg === "object") ? cfg : {};
  } catch (e) { return {}; }
}
function loadRoleModelsRaw() {
  const cfg = loadProvidersConfigRaw();
  const rm = cfg.role_models;
  return (rm && typeof rm === "object") ? rm : {};
}
function saveRoleModel(role, entry) {
  if (!KNOWN_MODEL_ROLES[role]) return false;
  const cfg = loadProvidersConfigRaw();
  const rm = (cfg.role_models && typeof cfg.role_models === "object") ? cfg.role_models : {};
  if (!entry || (!entry.provider_id && !entry.model)) delete rm[role];
  else rm[role] = { provider_id: String(entry.provider_id || ""), model: String(entry.model || "") };
  writeJsonAtomic(AI_PROVIDERS_CONFIG, { providers: loadProviders(), role_models: rm });
  return true;
}
/* [位置:model-router.js·isOAuthProvider/providerUsable] [订阅类供应商的可用判据] [11-12：后台任务选订阅供应商（Claude/Gemini 订阅这类 OAuth 登录的）被静默降级——原 usable 判据要求 p.api_key，而订阅类凭据在令牌库（oauth_provider 非空 / via_anthropic_proxy），配置里没有 api_key 字段，两块总结选了 Gemini 订阅实际跑在奇异果默认模型上（渠道已死必失败）。判据收拢成 providerUsable：api_key 或订阅类凭据任一即可，resolveRoleModel / resolveActiveProvider / resolveExplicitModel 三处统一用它。注意：这层只判「能不能用」；往哪发、带什么凭证由 lib/upstream-target.js·resolveTarget 统一决定，后台调用方必须走它，不许手拼 Authorization] [注释时间 2026-11-12] */
function isOAuthProvider(p) {
  return !!(p && (String(p.oauth_provider || "").trim() || p.via_anthropic_proxy === true));
}
function providerUsable(p, opt) {
  if (!p) return false;
  if (!(opt && opt.ignoreEnabled) && p.enabled === false) return false;
  if (!(p.api_url || p.base_url)) return false;
  return !!p.api_key || isOAuthProvider(p);
}
function resolveActiveProvider() {
  const ps = loadProviders();
  const def = ps.find(p => p.is_default === true && providerUsable(p));
  if (def) return def;
  return ps.find(p => providerUsable(p)) || null;
}
// 返回 {provider, model}；都没有时 provider=null, model=""（调用方决定是否抛错）
function resolveRoleModel(role, opt) {
  const providers = loadProviders();
  const noEn = !!(opt && opt.ignoreEnabled);   // 语音识别：供应商开关关着也能用（它不进聊天下拉，只给这个用途）
  const usable = p => providerUsable(p, { ignoreEnabled: noEn });
  const entry = loadRoleModelsRaw()[role];
  if (entry && entry.provider_id) {
    const hit = providers.find(p => p.id === entry.provider_id && usable(p));
    if (hit) {
      const list = Array.isArray(hit.models) && hit.models.length ? hit.models : (hit.model ? [hit.model] : []);
      const m = entry.model && (noEn || list.indexOf(entry.model) >= 0) ? entry.model : (hit.model || list[0] || "");
      return { provider: hit, model: m };
    }
    console.warn("[resolveRoleModel] role " + role + " provider unavailable, fallback default: " + entry.provider_id);
  }
  const active = resolveActiveProvider();
  if (active) return { provider: active, model: active.model || (Array.isArray(active.models) ? active.models[0] : "") || "" };
  return { provider: null, model: "" };
}

// 2026-10-27 图片转写：供应商的 vision_models 里勾选的模型视为“能直接看图”，发图时不调用转写。
// 不做模型名猜测——看图能力由她在设置里逐模型确认，未勾选的模型按需要走转写。
function modelSupportsVision(provider, model) {
  const list = provider && Array.isArray(provider.vision_models) ? provider.vision_models : [];
  return !!model && list.indexOf(String(model)) >= 0;
}

// 1024-24 需求1（状态机面板会话级模型选择）：按 provider_id + model 直取，不查角色路由；
// 供应商不在/禁用/无凭证（api_key 且非订阅类）时返回 {provider:null, model:""}，调用方回落全局「压缩摘要」角色
function resolveExplicitModel(providerId, model) {
  const ps = loadProviders();
  const p = ps.find(x => x.id === providerId && providerUsable(x));
  if (!p || !model) return { provider: null, model: "" };
  return { provider: p, model: String(model) };
}
/* [位置:model-router.js·modelNameSupportsVision] [只知道模型名时判断能不能看图] [10-27：工具返回图片时，工具循环手里只有模型名（没有供应商对象，三条调用链各自解析供应商）；按「任一启用的供应商把这个模型勾成能看图」判断——用户在供应商里勾的 vision_models 就是依据；同名模型在两个供应商里一个勾一个没勾时按勾了的算（极少见）] [注释时间 2026-10-27] */
function modelNameSupportsVision(model) {
  const name = String(model || '');
  if (!name) return false;
  return loadProviders().some(function (p) { return p && p.enabled !== false && Array.isArray(p.vision_models) && p.vision_models.indexOf(name) >= 0; });
}
/* [位置:model-router.js·thinkingPatch] [后台 LLM 显式开思考] [11-09：后台任务裸调时思考开不开全看厂商默认，厂商一改默认就悄悄降质；统一按供应商发「显式开启思考」的请求体补丁——Claude 翻译代理/deepseek 官方发 reasoning_effort（前者由 anthropic-adapter 消费成 adaptive+effort，Claude 固定 high=产品确定，不跟随聊天档位；2026-11-09 实测两家都接受），智谱/豆包发 thinking.enabled（实测接受，且与 temperature 共存不 400），qwen 发 enable_thinking（voice-msg 同款先例）；未知供应商返回空对象不发参数防 400。精简 provider 对象（只有 api_url/api_key/model，如 rerank）走 url 兜底判断] [注释时间 2026-11-09] */
function thinkingPatch(provider, opt) {
  const effort = (opt && opt.effort) || "high";
  const url = String((provider && (provider.api_url || provider.base_url)) || "").toLowerCase();
  const isAnthropic = (() => {
    try { return require("./upstream-target").isClaudeChat(provider); } catch (e) { return false; }
  })() || url.indexOf("/internal/anthropic/") >= 0;
  if (isAnthropic) return { reasoning_effort: effort };   // anthropic-adapter（393 行）消费
  /* [位置:model-router.js·thinkingPatch grok] [后台任务给 Grok 显式开思考] [11-16：Grok 订阅走 api.x.ai Chat Completions，顶层 reasoning_effort 认 low/medium/high/xhigh；只有 grok-4.x 认（grok-build 之类返回空对象不发），xhigh 在 4.5 及以下由 grokEffortFor 夹回 high] [注释时间 2026-11-16] */
  const isGrok = (() => { try { return require("./upstream-target").isGrokChat(provider); } catch (e) { return false; } })()
    || (url.indexOf("/internal/oauth/") >= 0 && /grok/i.test(String((provider && (provider.name || provider.id)) || "")));
  if (isGrok) {
    let v = null;
    try { v = require("./upstream-target").grokEffortFor(provider && provider.model, effort); } catch (e) { v = null; }
    return v ? { reasoning_effort: v } : {};
  }
  if (url.indexOf("api.deepseek.com") >= 0) return { reasoning_effort: effort };   // 2026-11-09 实测接受
  if (url.indexOf("bigmodel.cn") >= 0 || url.indexOf("zhipu") >= 0) return { thinking: { type: "enabled" } };   // 智谱实测接受
  if (url.indexOf("volces.com") >= 0 || url.indexOf(".ark.") >= 0) return { thinking: { type: "enabled" } };   // 豆包/火山实测接受
  if (url.indexOf("qianwen") >= 0 || url.indexOf("dashscope") >= 0) return { enable_thinking: true };   // qwen compatible-mode
  return {};   // 未知供应商不发，防 400
}

/* [位置:model-router.js·listEnabledModels] [启用中的供应商与模型清单] [随手记 #24：给 AI 查「能选哪些模型」的口子——判据与 providerUsable 同源，设置页 /admin/model-roles 与 MCP models 工具共用这一份；只回 id/name/默认标记/模型名，不带密钥] [注释时间 2026-11-14] */
function listEnabledModels() {
  return loadProviders().filter(function (p) { return providerUsable(p); }).map(function (p) {
    return {
      id: p.id, name: p.name, is_default: p.is_default === true,
      models: Array.isArray(p.models) && p.models.length ? p.models : (p.model ? [p.model] : [])
    };
  });
}
/* [位置:model-router.js·resolveModelByName] [按模型名在启用供应商里定位] [随手记 #24：subagent 传 model 时的校验落点——裸模型名必须在任一启用供应商的 models（或其默认 model）里，找不到返回 null 由调用方报错不盲跑；支持「providerId|模型名」直写（供应商也须启用）；同名多供应商取第一个启用的] [注释时间 2026-11-14] */
function resolveModelByName(name) {
  const want = String(name || "").trim();
  if (!want) return null;
  const bar = want.indexOf("|");
  if (bar >= 0) {
    const pid = want.slice(0, bar).trim();
    const m = want.slice(bar + 1).trim();
    if (!pid || !m) return null;
    const hit = loadProviders().find(function (p) { return p && String(p.id || "") === pid && providerUsable(p); });
    return hit ? { provider: hit, model: m } : null;
  }
  const hit = loadProviders().find(function (p) {
    if (!p || !providerUsable(p)) return false;
    const ms = Array.isArray(p.models) && p.models.length ? p.models : (p.model ? [p.model] : []);
    return ms.indexOf(want) >= 0;
  });
  return hit ? { provider: hit, model: want } : null;
}

module.exports = { modelNameSupportsVision, KNOWN_MODEL_ROLES, loadRoleModelsRaw, saveRoleModel, resolveRoleModel, resolveActiveProvider, resolveExplicitModel, modelSupportsVision, thinkingPatch, isOAuthProvider, providerUsable, listEnabledModels, resolveModelByName };
