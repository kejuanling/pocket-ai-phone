'use strict';
// oauth-proxy.js —— Gemini / ChatGPT(Codex) / Grok 订阅账号的内部翻译代理。
//
// 为什么需要：主链路 / MCP / 唤醒只会说 OpenAI Chat Completions。
// 这几家订阅账号的接口形状不一：
//   Gemini / Antigravity → Cloud Code Assist（v1internal:generateContent，要 project 包一层）
//   Codex → Responses API（chatgpt.com/backend-api/codex/responses）
//   Grok → api.x.ai/v1/chat/completions（本身就是 OpenAI 兼容，用订阅 OAuth bearer 计费，几乎原样转发）
// 所以请求统一打到本路由，由它翻译、取 token、从已配置代理出海，再翻译回来。
//
// 请求头 x-provider-id 指定供应商 id；供应商配置里 oauth_provider = gemini | antigravity | codex | grok。
// 令牌只在本进程内存和 data/oauth/*.json 之间流动，前端永远看不到。

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egressGuard = require('../lib/egress-guard');
const gemini = require('../lib/gemini-adapter');
const imageInline = require('../lib/image-inline');
const outboundImages = require('../lib/outbound-images');
const oauth = require('../lib/oauth-login');
const common = require('../lib/oauth-common');
const pool = require('../lib/oauth-pool');
const grokResponses = require('../lib/grok-responses');   // 2026-11-16：Grok 订阅走 Responses（思考摘要/加密思考），对外仍是 Chat Completions

// 出海代理由 EGRESS_PROXY / AIRPORT_PROXY / CLAUDE_OAUTH_PROXY 显式配置，无现网默认。
function getProxyAgent() { return new HttpsProxyAgent(egressGuard.requireProxyUrl()); }
const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const IDLE_TIMEOUT_MS = 600000;
const GEMINI_CLI_UA = 'GeminiCLI/0.30.0/';
const CODEX_UA = 'codex_cli_rs/0.48.0 (linux; x64)';

function loadProvider(baseDir, id) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(baseDir, 'config', 'ai-providers.json'), 'utf8'));
    const list = Array.isArray(cfg) ? cfg : (Array.isArray(cfg.providers) ? cfg.providers : []);
    return list.find(function (p) { return p && p.id === id; }) || null;
  } catch (e) { return null; }
}

// Cloud Code project 缓存按「供应商+账号」分文件（gemini / antigravity 各是各的 project）
function readProject(account, provider) {
  try {
    const j = JSON.parse(fs.readFileSync(oauth.projectCacheFile(account, provider), 'utf8'));
    return j && j.project ? String(j.project) : '';
  } catch (e) { return ''; }
}

function writeProject(project, account, provider) {
  try {
    const file = oauth.projectCacheFile(account, provider);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ project: project, at: Date.now() }), { mode: 0o600 });
  } catch (e) { /* 缓存写不进去不影响本次请求 */ }
}

/* [位置:routes/oauth-proxy.js·requestRaw] [订阅出海共用出口闸门] [Cloud Code / Codex / Grok / 目录与 401、429 重试都走这里；先 ensure，失败抛 EGRESS_DENIED，不剥代理改直连] [注释时间 2026-11-25] */
async function requestRaw(url, opts, bodyStr, abortSignal) {
  await egressGuard.assertOk();
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('上游 URL 非法: ' + url)); }
    const buf = Buffer.from(bodyStr || '', 'utf8');
    const req = https.request({
      hostname: u.hostname,
      path: (u.pathname || '/') + (u.search || ''),
      method: opts.method || 'POST',
      agent: getProxyAgent(),
      headers: Object.assign({ 'content-length': buf.length }, opts.headers || {}),
    }, resolve);
    req.setTimeout(IDLE_TIMEOUT_MS, function () {
      const e = new Error('上游空闲超时'); e.code = 'ETIMEDOUT'; req.destroy(e);
    });
    req.on('error', reject);
    if (abortSignal) {
      if (abortSignal.aborted) req.destroy(new Error('已取消'));
      else abortSignal.addEventListener('abort', function () { req.destroy(new Error('已取消')); }, { once: true });
    }
    req.end(buf);
  });
}

function readAll(res) {
  return new Promise(function (resolve, reject) {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { raw += c; });
    res.on('end', function () { resolve(raw); });
    res.on('error', reject);
  });
}

function openaiError(status, msg, type) {
  return { error: { message: String(msg || '').slice(0, 500), type: type || 'upstream_error', code: status } };
}

function providerLabel(provider) {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'antigravity') return 'Antigravity';
  if (provider === 'claude') return 'Claude';
  if (provider === 'grok') return 'Grok';
  return 'ChatGPT';
}

// 凭证真废了就把话说明白：让用户看到「去重新登录」，而不是一个裸 401/403
function decorateAuthError(provider, payload, status) {
  if (status !== 401 && status !== 403) return payload;
  try {
    if (oauth.needsReauth(provider)) {
      const label = providerLabel(provider);
      payload.error.message = label + ' 订阅登录已失效，到设置页点「登录」重新授权一下（' + String(payload.error.message || '').slice(0, 160) + '）';
      payload.error.type = 'oauth_reauth_required';
    }
  } catch (e) { /* 状态读不出来不影响报错 */ }
  return payload;
}

/* [位置:routes/oauth-proxy.js·validationPayload] [Gemini 403 验证透传] [Google 风控要求账号验证时把完整验证链接透传给调用方：openaiError 的 500 字截断会把链接切掉，手机上只能看到半句报错] [注释时间 2026-11-04] */
function validationPayload(raw) {
  try {
    const j = JSON.parse(String(raw));
    const dets = (j && j.error && Array.isArray(j.error.details)) ? j.error.details : [];
    const d = dets.find(function (x) { return x && x.metadata && x.metadata.validation_url; });
    if (!d) return null;
    return {
      error: {
        message: 'Gemini 订阅账号被 Google 要求验证：在浏览器打开下面的链接、登录该 Google 账号完成验证，之后重试即可恢复。\n' + String(d.metadata.validation_url),
        type: 'gemini_validation_required',
        code: 403,
      },
    };
  } catch (e) { return null; }
}

// 工具：gemini/antigravity 已支持（2026-11-04 functionDeclarations/functionCall 往返，
// 见 lib/gemini-adapter.js），Codex 仍只搬文本；图片：gemini/antigravity 2026-11-12 起支持
// （vision 模型内联 data URL、非 vision 剥占位，见 prepareCloudCodeImages），Codex 仍拒。
// 音频：gemini/antigravity 2026-11-12 起支持（gemini 系内联、claude/gpt 档剥占位，见 prepareCloudCodeAudio），Codex 仍拒。
// 与其让不支持的形态被静默丢掉（"看起来能用其实没用"），不如当场说清楚：调用方立刻知道该换供应商。
function unsupportedFeature(body, provider) {
  if (provider !== 'gemini' && provider !== 'antigravity' && provider !== 'grok' && Array.isArray(body.tools) && body.tools.length) return 'tools';
  if (provider === 'codex' && imagePartsCount(body.messages) > 0) return 'image';
  if (provider === 'codex' && audioPartsCount(body.messages) > 0) return 'audio';
  return '';
}

// messages 里 input_audio part 的总数（codex 拒音频用；Cloud Code 链路的分档加工在 prepareCloudCodeAudio）
function audioPartsCount(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  let n = 0;
  for (let i = 0; i < msgs.length; i++) {
    const c = msgs[i] && msgs[i].content;
    if (!Array.isArray(c)) continue;
    for (let k = 0; k < c.length; k++) if (c[k] && c[k].type === 'input_audio') n++;
  }
  return n;
}

/* [位置:routes/oauth-proxy.js·imagePartsCount/stripImagesToPlaceholders/prepareCloudCodeImages] [Cloud Code 链路图片加工] [11-12：Gemini 订阅发图整包 400（此前一律拒图，上游图片转写白做）。上游实测 gemini/claude 模型都收 inlineData（probe-gemini-image-e2e 全 200 且能描述），gpt-oss 收了也说看不见 → vision_models 勾了的模型把本站图内联成 data URL（上游不会来下我们域名，复用 image-inline 的缩图/缓存/预算），没勾的剥成「（图片 id:xxx）」占位——转写文字聊天侧已附在图后，模型仍读得到；内联不了的外链图由适配器落「（图片）」占位，整轮不再失败] [注释时间 2026-11-12] */
function imagePartsCount(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  let n = 0;
  for (let i = 0; i < msgs.length; i++) {
    const c = msgs[i] && msgs[i].content;
    if (!Array.isArray(c)) continue;
    for (let k = 0; k < c.length; k++) {
      const p = c[k];
      if (p && (p.type === 'image_url' || p.type === 'image' || p.type === 'input_image')) n++;
    }
  }
  return n;
}

function stripImagesToPlaceholders(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  let n = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || !Array.isArray(m.content)) continue;
    let changed = false;
    const parts = [];
    for (let k = 0; k < m.content.length; k++) {
      const p = m.content[k];
      const isImg = p && (p.type === 'image_url' || p.type === 'image' || p.type === 'input_image');
      if (!isImg) { parts.push(p); continue; }
      const raw = p.image_url !== undefined ? p.image_url : p.url;
      const url = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? raw.url : '');
      const id = outboundImages.imgIdOfUrl(url);
      parts.push({ type: 'text', text: id ? '（图片 id:' + id + '）' : '（图片）' });
      changed = true; n++;
    }
    if (changed) m.content = parts;
  }
  return n;
}

/* [位置:routes/oauth-proxy.js·prepareCloudCodeAudio] [Cloud Code 链路音频加工] [11-12：上游实测 gemini 系模型收 inlineData 音频（probe-gemini-audio-e2e 200 且能转述），claude/gpt-oss 档 400 → 按模型分档：gemini 系把最后一条 input_audio 的站内 wav 引用内联成 data:URL（复用 image-inline·parseLocalAsset 的 /uploads 映射与路径穿越防护；只内联最后一条，更早的剥占位——历史语音听转写文字兜底，控每轮请求体积），非 gemini 档全剥「（语音）」占位；内联不了（文件没了/超限）也剥占位，不让整轮失败] [注释时间 2026-11-12] */
const AUDIO_INLINE_MAX_BYTES = 20 * 1024 * 1024;   // Gemini inlineData 总量上限内留余量；超限当内联失败剥占位
// 遍历所有 input_audio：keepPart 之外的统统换「（语音）」占位，返回剥离条数
function stripAudiosKeep(messages, keepPart) {
  const msgs = Array.isArray(messages) ? messages : [];
  let n = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || !Array.isArray(m.content)) continue;
    let changed = false;
    const parts = [];
    for (let k = 0; k < m.content.length; k++) {
      const p = m.content[k];
      if (p && p.type === 'input_audio' && p !== keepPart) { parts.push({ type: 'text', text: '（语音）' }); changed = true; n++; continue; }
      parts.push(p);
    }
    if (changed) m.content = parts;
  }
  return n;
}
async function prepareCloudCodeAudio(body, prov, model, provider) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  let count = 0, last = null;   // last：从后往前第一条带站内 url 引用的 input_audio
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = msgs[i] && msgs[i].content;
    if (!Array.isArray(c)) continue;
    for (let k = c.length - 1; k >= 0; k--) {
      const p = c[k];
      if (!(p && p.type === 'input_audio')) continue;
      count++;
      if (!last) {
        const ia = (p.input_audio && typeof p.input_audio === 'object') ? p.input_audio : {};
        const url = typeof ia.url === 'string' ? ia.url : '';
        if (url && !/^data:/i.test(url)) last = { part: p, url: url };
      }
    }
  }
  if (count === 0) return '';
  const isGm = String(model).indexOf('gemini') === 0;
  let inlined = 0;
  if (isGm && last) {
    const asset = imageInline.parseLocalAsset(last.url);
    if (asset) {
      try {
        const st = await require('fs').promises.stat(asset.file);
        if (st.size <= AUDIO_INLINE_MAX_BYTES) {
          const b64 = (await require('fs').promises.readFile(asset.file)).toString('base64');
          last.part.input_audio = { data: 'data:audio/wav;base64,' + b64, format: 'wav' };
          inlined = 1;
        }
      } catch (e) { /* 文件没了/读不出：按内联失败走剥占位 */ }
    }
  }
  const stripped = stripAudiosKeep(msgs, inlined ? last.part : null);
  const done = { mode: inlined ? 'inline' : 'placeholder', count: count, stripped: stripped };
  common.logLine(provider, 'audios', done);
  return done.mode + ':' + done.count + '条(剥' + done.stripped + ')';
}

// vision 模型内联本站图、非 vision 剥占位；返回加工说明（如 inline:2 / placeholder:1），无图返回 ''
async function prepareCloudCodeImages(body, prov, model, provider) {
  if (imagePartsCount(body.messages) === 0) return '';
  const canSee = Array.isArray(prov && prov.vision_models) && prov.vision_models.indexOf(String(model)) >= 0;
  let done;
  if (canSee) {
    let inlined = 0, failed = 0;
    try {
      const r = await imageInline.inlineLocalImagesForAnthropic(body.messages);
      inlined = r.inlined; failed = r.failed;
    } catch (e) { failed = imagePartsCount(body.messages); }
    done = { mode: 'inline', inlined: inlined, failed: failed };
  } else {
    done = { mode: 'placeholder', count: stripImagesToPlaceholders(body.messages) };
  }
  common.logLine(provider, 'images', done);
  return done.mode + (done.mode === 'inline' ? ':' + done.inlined + '张(败' + done.failed + ')' : ':' + done.count);
}

// ---- Cloud Code Assist（Gemini / Antigravity 共用一条 v1internal 协议）----
// 两家只有四样不同：控制面域名、客户端指纹、信封字段、模型目录（Antigravity 的 id 带
// -low/-medium/-high 或 -tiered 档位后缀且随账号变化）。翻译层与流式翻译两家共用。
const CLOUDCODE = {
  gemini: {
    // gemini-cli 身份已被 Google 下线（UNSUPPORTED_CLIENT，2026-06-18 起个人版迁移 Antigravity）
    // 代码保留，门票回来或换 GCP 项目档时仍可用
    host: 'cloudcode-pa.googleapis.com',
    ua: function (m) { return GEMINI_CLI_UA + m + ' (linux; x64)'; },
    meta: { ideType: 'GEMINI_CLI', platform: 'LINUX_AMD64', pluginType: 'GEMINI' },
    clientMetaHeader: true,
    envelope: function (m, project, inner) {
      return { model: m, project: project, user_prompt_id: Math.random().toString(16).slice(2, 15), request: inner };
    },
    replaySignature: '',
  },
  antigravity: {
    // 生成固定走 daily 控制面（官方 agy 客户端就用它；prod 对订阅额度会回假 429）
    // 2026-11-23：升级至 1.5.14，旧版 1.1.23 被上游版本门槛隐藏 gemini-4-neon 等新模型
    host: 'daily-cloudcode-pa.googleapis.com',
    ua: function () { return 'antigravity/cli/1.5.14 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)'; },
    meta: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    // 社区实测：带旧 VS Code 扩展指纹（Client-Metadata / X-Goog-Api-Client）会拿到旧模型目录，
    // 新模型（3.8 等）一律 404；agy 的 wire 指纹不发这两个头
    clientMetaHeader: false,
    envelope: function (m, project, inner) {
      return {
        project: project, model: m, request: inner,
        requestType: 'agent', userAgent: 'antigravity',
        requestId: require('crypto').randomUUID(),
      };
    },
    replaySignature: 'skip_thought_signature_validator',
  },
};

// ---- Antigravity 模型目录：id 与档位后缀随账号变化，发请求前按账号目录解析 ----
const agCatalog = new Map(); // account -> { at, models }
const AG_CATALOG_TTL_MS = 10 * 60 * 1000;

async function fetchAgCatalog(cfg, token, project, account, force) {
  const hit = agCatalog.get(account);
  if (!force && hit && Date.now() - hit.at < AG_CATALOG_TTL_MS) return hit.models;
  let models = [];
  try {
    const res = await requestRaw('https://' + cfg.host + '/v1internal:fetchAvailableModels', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + token,
        'user-agent': cfg.ua(),
      },
    }, JSON.stringify(project ? { project: project } : {}), null);
    const raw = await readAll(res);
    const j = JSON.parse(raw);
    const bag = (j.response && j.response.models) || j.models || {};
    models = Object.keys(bag);
  } catch (e) { /* 目录拿不到就按配置原样发，真不行上游会报错 */ }
  agCatalog.set(account, { at: Date.now(), models: models });
  return models;
}

/* [位置:routes/oauth-proxy.js·pickAgModel] [配置模型名 → 账号实际发布的 id] [Antigravity 的模型 id 带档位后缀且随账号变化（-low/-medium/-high/-xhigh 或 -tiered），按目录挑同族同档，挑不到就降级，别把目录里不存在的 id 发上去 404。2026-11-17：4 系代号模型（gemini-4-hydrogen-sonar）族名不是 pro|flash，旧正则会漏，落进「所有 gemini」兜底里被挑成 3.8-flash——等于悄悄换模型；改成代号优先解析（同代号同变体 → 同代号档位 → 同代号 tiered/第一个），代号在目录里完全没有就原样发出去让上游明确报错，不跨代号、不跨代降级；族名兜底也加同代约束；2026-11-23：补上 neon 代号与 xhigh 档位] [注释时间 2026-11-04；2026-11-23 补 neon/xhigh] */
function pickAgModel(want, models) {
  const w = String(want || '').trim();
  if (!models.length) return { model: w, thinkingLevel: '' };
  if (models.indexOf(w) >= 0) return { model: w, thinkingLevel: '' };
  const gen = (w.match(/^(gemini-[\d.]+)/i) || [])[1] || '';
  const codename = (w.match(/-(argon|carbon|hydrogen|neon)(?:-|$)/i) || [])[1] || '';
  const variant = (w.match(/-(sonar|search)(?:-|$)/i) || [])[1] || '';
  const m = w.match(/^(gemini-[\d.]+(?:-[a-z]+)?-(?:pro|flash))(?:-.*)?$/i) || w.match(/^(gemini-[\d.]+-(?:pro|flash))(?:-.*)?$/i);
  const family = m ? m[1] : '';
  const wantLow = /lite|low/i.test(w);
  const wantXHigh = /xhigh/i.test(w);
  const wantHigh = !wantXHigh && /pro|high/i.test(w);
  const level = wantLow ? 'low' : (wantHigh || wantXHigh ? 'high' : 'medium');
  const suffixes = wantLow ? ['low', 'minimal', 'medium', 'high'] : (wantXHigh ? ['xhigh', 'high', 'medium', 'low'] : (wantHigh ? ['high', 'medium', 'low'] : ['medium', 'high', 'low']));
  const sameGen = gen ? models.filter(function (x) { return x === gen || x.indexOf(gen + '-') === 0; }) : [];
  const pickFrom = function (list) {
    for (let i = 0; i < suffixes.length; i++) {
      const exact = family ? list.find(function (x) { return x === family + '-' + suffixes[i]; }) : '';
      if (exact) return exact;
      const bySuffix = list.find(function (x) { return new RegExp('-' + suffixes[i] + '$').test(x); });
      if (bySuffix) return bySuffix;
    }
    return '';
  };
  // 代号族（gemini-4-hydrogen-sonar）：先同代号同变体，再同代号同档，再同代号 tiered/第一个
  if (codename) {
    const pool2 = sameGen.length ? sameGen : models;
    const codeList = pool2.filter(function (x) { return new RegExp('-' + codename + '(-|$)', 'i').test(x); });
    if (codeList.length) {
      const v = variant ? codeList.find(function (x) { return new RegExp('-' + variant + '(-|$)', 'i').test(x); }) : '';
      if (v) return { model: v, thinkingLevel: '' };
      const s = pickFrom(codeList);
      if (s) return { model: s, thinkingLevel: '' };
      const t = codeList.find(function (x) { return /-tiered$/.test(x); });
      if (t) return { model: t, thinkingLevel: level };
      return { model: codeList[0], thinkingLevel: '' };
    }
    return { model: w, thinkingLevel: '' };   // 目录里没有这个代号：原样发，让上游 404 说清楚，别悄悄换成别的代号/别的代
  }
  // pro/flash 族：同族同档；同族一个都没有就退同代，最后才是全 gemini 兜底
  const sameFamily = family ? models.filter(function (x) { return x === family || x.indexOf(family + '-') === 0; }) : [];
  const cands = sameFamily.length ? sameFamily : (sameGen.length ? sameGen : models.filter(function (x) { return /^gemini/.test(x); }));
  const s2 = pickFrom(cands);
  if (s2) return { model: s2, thinkingLevel: '' };
  const tiered = cands.find(function (x) { return /-tiered$/.test(x); });
  if (tiered) return { model: tiered, thinkingLevel: level };
  return { model: cands[0] || w, thinkingLevel: '' };
}
// ---- project 发现（loadCodeAssist）----
async function ensureProject(cfg, token, account, provider) {
  const p = readProject(account, provider);
  if (p) return p;
  const body = JSON.stringify({ metadata: cfg.meta });
  const res = await requestRaw('https://' + cfg.host + '/v1internal:loadCodeAssist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
      'user-agent': cfg.ua(),
    },
  }, body, null);
  const raw = await readAll(res);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error('loadCodeAssist HTTP ' + res.statusCode + ': ' + raw.slice(0, 300));
  }
  let j = {};
  try { j = JSON.parse(raw); } catch (e) { /* 保留原文 */ }
  const proj = j.cloudaicompanionProject
    || (j.cloudaicompanionProject && j.cloudaicompanionProject.id)
    || '';
  if (!proj) {
    // 个人版被下线时这里会带 ineligibleTiers.UNSUPPORTED_CLIENT，原话透出便于定位
    let why = raw.slice(0, 300);
    try {
      const t = (j.ineligibleTiers || [])[0];
      if (t && t.reasonMessage) why = t.reasonMessage;
    } catch (e) { /* ignore */ }
    throw new Error('没能拿到 Cloud Code project：' + why);
  }
  writeProject(proj, account, provider);
  return proj;
}

/* [位置:routes/oauth-proxy.js·handleCloudCode] [Gemini/Antigravity 订阅请求的翻译与 401 自愈] [令牌在时钟上没过期但已被上游作废时强制刷新一次并重放一次；Antigravity 先按账号目录解析模型 id 与档位；流式把文本与 functionCall 一起翻回 OpenAI 形状] [注释时间 2026-10-22；2026-11-04 改动：从 Gemini 专用改成两家通用（CLOUDCODE 配置），加 Antigravity 目录选型与 replaySignature] */
async function handleCloudCode(cfg, prov, body, reply, model) {
  const provider = String(prov.oauth_provider || '').trim();
  // 多账号：挑第一个能用的号（先只做选号，429 换号等真有第二个号实测过再加）
  const account = pool.candidates(provider).ordered[0] || 'default';
  let token = await oauth.getAccessToken(provider, { account: account });
  const project = await ensureProject(cfg, token, account, provider);

  // Antigravity：配置里的模型名解析成这个账号实际发布的 id（档位后缀/是否 tiered 都在目录里）
  let realModel = model;
  let thinkingLevel = '';
  if (provider === 'antigravity') {
    const catalog = await fetchAgCatalog(cfg, token, project, account);
    const picked = pickAgModel(model, catalog);
    realModel = picked.model || model;
    thinkingLevel = picked.thinkingLevel;
  }

  // 2026-11-12 图片：vision 模型内联本站图、非 vision 剥占位（gpt-oss 收图也说看不见）
  const _imgMode = await prepareCloudCodeImages(body, prov, model, provider);
  // 2026-11-12 音频：gemini 系内联最后一条站内语音、其余剥占位（claude/gpt 档收音频上游 400）
  const _audMode = await prepareCloudCodeAudio(body, prov, model, provider);

  /* [位置:routes/oauth-proxy.js·handleCloudCode 思考文本开关] [gemini 系模型请求思考文本] [上游对 gemini 模型默认只烧思考 token 不吐文本（usage thoughtsTokenCount 照计费），includeThoughts 后吐 thought part，流式/非流式分支现成的 thought 处理自动导进思考抽屉；claude/gpt-oss 系不传——上游翻译层不认（claude 实测无视该参数、连思考 token 都没有），gpt-oss 不带参数本来就吐思考] [注释时间 2026-11-12] */
  /* [位置:routes/oauth-proxy.js·handleCloudCode 4 系输出预算] [4 系不写死上限，一律走上游默认] [实测 maxOutputTokens 64 时正文为空（thoughts 61、MAX_TOKENS），2048 在 high 档被思考吃满截断；11-17 拍板「继续走上游默认」，所以这里不兜下限、不塞值。小手机发消息不带 max_tokens，正常路径没影响；第三方客户端或设置里手填过小值时正文会被思考吃空，那时要调用方自己带大值，别在网关里替人做主] [注释时间 2026-11-17] */
  const inner = gemini.toRequest(body, {
    maxTokens: Number(prov.max_tokens) || undefined,
    replaySignature: cfg.replaySignature,
    thinkingLevel: thinkingLevel,
    includeThoughts: String(realModel).indexOf('gemini') === 0,
  });
  if (_imgMode) console.log('[oauth-proxy] 图片加工 ' + _imgMode + ' model=' + model);
  if (_audMode) console.log('[oauth-proxy] 音频加工 ' + _audMode + ' model=' + model);
  const wantStream = body.stream === true;
  const payload = JSON.stringify(cfg.envelope(realModel, project, inner));

  const path = wantStream ? ':streamGenerateContent?alt=sse' : ':generateContent';
  const hdr = function (tok) {
    const h = {
      'content-type': 'application/json',
      authorization: 'Bearer ' + tok,
      'user-agent': cfg.ua(realModel),
    };
    if (cfg.clientMetaHeader) h['client-metadata'] = JSON.stringify(cfg.meta);
    return h;
  };
  const ctrl = new AbortController();
  reply.raw.on('close', function () { if (!reply.raw.writableEnded) ctrl.abort(); });

  const send = function (tok) {
    return requestRaw('https://' + cfg.host + '/v1internal' + path, { method: 'POST', headers: hdr(tok) }, payload, ctrl.signal);
  };
  let up = await send(token);
  // 401 兜底（只重放一次）：403 只在响应体明确是鉴权错误时才当令牌问题
  if (up.statusCode === 401 || up.statusCode === 403) {
    const first = await readAll(up).catch(function () { return ''; });
    if (up.statusCode === 401 || /invalid_token|authentication_error|invalid_grant/i.test(first)) {
      common.logLine(provider, 'auth-retry', { status: up.statusCode });
      try { token = await oauth.getAccessToken(provider, { force: true, account: account }); }
      catch (e) { common.logFail(provider, 'auth-retry-refresh', e, 0); }
      up = await send(token);
      common.logLine(provider, 'auth-retry', { status: up.statusCode, replay: true });
    } else {
      const vp = validationPayload(first);
      if (vp) { reply.code(403).send(vp); return; }
      reply.code(up.statusCode).send(decorateAuthError(provider, openaiError(up.statusCode, first), up.statusCode));
      return;
    }
  }
  if (up.statusCode < 200 || up.statusCode >= 300) {
    const raw = await readAll(up).catch(function () { return ''; });
    const vp = validationPayload(raw);
    if (vp) { reply.code(403).send(vp); return; }
    reply.code(up.statusCode).send(decorateAuthError(provider, openaiError(up.statusCode, raw), up.statusCode));
    return;
  }

  if (!wantStream) {
    const raw = await readAll(up);
    let j = {};
    try { j = JSON.parse(raw); } catch (e) {
      reply.code(502).send(openaiError(502, '上游返回非 JSON'));
      return;
    }
    reply.send(gemini.fromResponse(j, realModel));
    return;
  }

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  /* [位置:routes/oauth-proxy.js·handleCloudCode 流式] [流式翻译（文本+思考+工具+用量）] [正文与思考按各自的自适应差量转发（兼容上游累积/增量两种 chunk 行为；thought:true part 是思考链，导进 reasoning_content 给思考抽屉，不再混进正文）；functionCall 按 name+args 去重后整块发 tool_calls delta，mcp-tool-loop 聚合后进工具循环；finish 有工具调用时给 tool_calls] [注释时间 2026-11-04；改动：从纯文本差量升级为文本+工具，两家共用；2026-11-12：思考链分离进 reasoning_content；2026-11-16：尾帧补发使用量帧（choices:[]），聊天落盘与 Token 抽屉终于有数] */
  let buf = '';
  let sent = '';          // 已发正文文本
  let sentThought = '';   // 已发思考文本（thought part 单独一套累积/差量）
  const sentCalls = [];   // 已发 functionCall 的 name|args（跨 chunk 去重）
  let lastUsage = null; // 2026-11-16：上游把 usageMetadata 放在没有 candidate 的尾帧里，这里逐帧留最后一份，结束时补一帧用量
  up.setEncoding('utf8');
  up.on('data', function (chunk) {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line || line.indexOf('data:') !== 0) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j = null;
      try { j = JSON.parse(data); } catch (e) { continue; }
      /* [位置:routes/oauth-proxy.js·handleCloudCode 流式用量] [先取用量再判 candidate] [需求：只带 usageMetadata 的尾帧没有 candidate，原来的 if (!c) continue 会把它丢掉，导致整条流没有用量、聊天落盘 tokens=null；这里先接住用量，再按 candidate 处理正文/思考/工具] [注释时间 2026-11-16] */
      if (gemini.unwrap(j).usageMetadata) lastUsage = gemini.mergeUsage(lastUsage, gemini.usageOf(j));
      const c = gemini.candidateOf(j);
      if (!c) continue;
      // 思考与正文各自独立差量转发；实测思考 chunk 先于正文到达，输出顺序自然
      const tDelta = gemini.textDeltaAdaptive(gemini.thoughtFromCandidate(c), sentThought);
      if (tDelta) {
        sentThought += tDelta;
        raw.write('data: ' + JSON.stringify(gemini.openaiChunk(realModel, { reasoning_content: tDelta })) + '\n\n');
      }
      const delta = gemini.textDeltaAdaptive(gemini.textFromCandidate(c), sent);
      if (delta) {
        sent += delta;
        raw.write('data: ' + JSON.stringify(gemini.openaiChunk(realModel, { content: delta })) + '\n\n');
      }
      const calls = gemini.toolCallsFromParts(gemini.partsOf(c));
      for (let k = 0; k < calls.length; k++) {
        const ckey = calls[k].function.name + '|' + calls[k].function.arguments;
        if (sentCalls.indexOf(ckey) >= 0) continue;
        const callIndex = sentCalls.length;
        sentCalls.push(ckey);
        raw.write('data: ' + JSON.stringify(gemini.openaiChunk(realModel, {
          tool_calls: [{ index: callIndex, id: calls[k].id, type: 'function', function: calls[k].function }],
        })) + '\n\n');
      }
      if (c.finishReason) {
        const fin = sentCalls.length ? 'tool_calls' : gemini.finishOf(c);
        raw.write('data: ' + JSON.stringify(gemini.openaiChunk(realModel, {}, fin)) + '\n\n');
      }
    }
  });
  up.on('end', function () {
    /* [位置:routes/oauth-proxy.js·handleCloudCode 流式终帧] [补发用量帧] [需求：结束时补一帧 {choices:[], usage}（不依赖 stream_options.include_usage，Gemini 上游总会给 usageMetadata），工具循环按 evt.usage 接住、聊天落盘写进 tokens；客户端可能已断，写失败只忽略] [注释时间 2026-11-16] */
    if (lastUsage) { try { raw.write('data: ' + JSON.stringify(gemini.usageChunk(realModel, lastUsage)) + '\n\n'); } catch (e) { /* 客户端已断 */ } }
    raw.write('data: [DONE]\n\n');
    try { raw.end(); } catch (e) { /* 客户端可能已断 */ }
  });
  up.on('error', function () {
    try { raw.write('data: [DONE]\n\n'); raw.end(); } catch (e) { /* ignore */ }
  });
}

// ---- Codex 处理 ----
function messagesToResponsesInput(messages) {
  const out = [];
  for (const m of (messages || [])) {
    const role = String(m.role || 'user');
    if (role === 'system' || role === 'developer') continue;
    const content = Array.isArray(m.content)
      ? m.content.map(function (p) { return { type: 'input_text', text: String((p && p.text) || '') }; })
      : [{ type: 'input_text', text: String(m.content === null || m.content === undefined ? '' : m.content) }];
    out.push({ type: 'message', role: role === 'assistant' ? 'assistant' : 'user', content: content });
  }
  return out;
}

function systemOf(messages) {
  const parts = [];
  for (const m of (messages || [])) {
    const r = String(m.role || '');
    if (r === 'system' || r === 'developer') {
      const t = Array.isArray(m.content)
        ? m.content.map(function (p) { return String((p && p.text) || ''); }).join('')
        : String(m.content || '');
      if (t.trim()) parts.push(t);
    }
  }
  return parts.join('\n\n');
}

/* [位置:routes/oauth-proxy.js·handleCodex] [ChatGPT 订阅请求的 401 自愈] [令牌在时钟上没过期但已被上游作废时，强制刷新一次并重放一次，避免用户对着 401 无解] [注释时间 2026-10-22] */
async function handleCodex(prov, body, reply, model) {
  // 多账号：挑第一个能用的号（同上，先只做选号）
  const codexAccount = pool.candidates('codex').ordered[0] || 'default';
  let auth = await oauth.getAuth('codex', { account: codexAccount });
  const wantStream = body.stream === true;

  const payloadObj = {
    model: model,
    stream: wantStream,
    store: false,
    parallel_tool_calls: true,
    input: messagesToResponsesInput(body.messages),
    reasoning: { effort: String(prov.reasoning_effort || 'low') },
    include: ['reasoning.encrypted_content'],
  };
  const sys = systemOf(body.messages);
  if (sys) payloadObj.instructions = sys;

  const hdr = function (a) {
    const h = {
      'content-type': 'application/json',
      authorization: 'Bearer ' + a.access_token,
      'user-agent': CODEX_UA,
      originator: 'codex_cli_rs',
      'openai-beta': 'responses=experimental',
      session_id: 'minis-' + Math.random().toString(16).slice(2, 10),
    };
    if (a.account_id) h['chatgpt-account-id'] = String(a.account_id);
    return h;
  };

  const ctrl = new AbortController();
  reply.raw.on('close', function () { if (!reply.raw.writableEnded) ctrl.abort(); });

  const send = function (a) {
    return requestRaw(CODEX_URL, { method: 'POST', headers: hdr(a) }, JSON.stringify(payloadObj), ctrl.signal);
  };
  let up = await send(auth);
  // 401 兜底（只重放一次）：403 只在响应体明确是鉴权错误时才当令牌问题
  if (up.statusCode === 401 || up.statusCode === 403) {
    const first = await readAll(up).catch(function () { return ''; });
    if (up.statusCode === 401 || /invalid_token|authentication_error|invalid_grant/i.test(first)) {
      common.logLine('codex', 'auth-retry', { status: up.statusCode });
      try {
        await oauth.getAccessToken('codex', { force: true, account: codexAccount });
        auth = await oauth.getAuth('codex', { account: codexAccount });
      } catch (e) {
        common.logFail('codex', 'auth-retry-refresh', e, 0);
      }
      up = await send(auth);
      common.logLine('codex', 'auth-retry', { status: up.statusCode, replay: true });
    } else {
      reply.code(up.statusCode).send(decorateAuthError('codex', openaiError(up.statusCode, first), up.statusCode));
      return;
    }
  }
  if (up.statusCode < 200 || up.statusCode >= 300) {
    const raw = await readAll(up).catch(function () { return ''; });
    reply.code(up.statusCode).send(decorateAuthError('codex', openaiError(up.statusCode, raw), up.statusCode));
    return;
  }

  if (!wantStream) {
    const rawU = await readAll(up);
    let j = {};
    try { j = JSON.parse(rawU); } catch (e) { reply.code(502).send(openaiError(502, '上游返回非 JSON')); return; }
    let text = '';
    (j.output || []).forEach(function (item) {
      (item.content || []).forEach(function (c) { if (c && c.text) text += c.text; });
    });
    reply.send({
      id: j.id || 'chatcmpl-codex',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: (j.usage && j.usage.input_tokens) || 0,
        completion_tokens: (j.usage && j.usage.output_tokens) || 0,
        total_tokens: (j.usage && j.usage.total_tokens) || 0,
      },
    });
    return;
  }

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  let buf = '';
  up.setEncoding('utf8');
  up.on('data', function (chunk) {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line || line.indexOf('data:') !== 0) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j = null;
      try { j = JSON.parse(data); } catch (e) { continue; }
      if (j.type === 'response.output_text.delta' && typeof j.delta === 'string') {
        raw.write('data: ' + JSON.stringify(gemini.openaiChunk(model, { content: j.delta })) + '\n\n');
      }
    }
  });
  up.on('end', function () {
    raw.write('data: ' + JSON.stringify(gemini.openaiChunk(model, {}, 'stop')) + '\n\n');
    raw.write('data: [DONE]\n\n');
    try { raw.end(); } catch (e) { /* ignore */ }
  });
  up.on('error', function () { try { raw.end(); } catch (e) { /* ignore */ } });
}

const GROK_URL = 'https://api.x.ai/v1/chat/completions';
/* [位置:routes/oauth-proxy.js·GROK_RESPONSES_URL] [Grok 订阅的 Responses 端点] [11-16：Chat Completions 的 reasoning_content 只有碎片、拿不到思考摘要；Responses 的 reasoning 项自带 summary + encrypted_content（跨轮回传保思考质量）。对外仍是 Chat Completions，只在 handleGrok 里翻译] [注释时间 2026-11-16] */
const GROK_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const GROK_UA = 'grok-cli';

/* [位置:routes/oauth-proxy.js·handleGrok] [Grok 订阅请求：OpenAI 兼容原样转发] [11-16：订阅令牌可直接打 api.x.ai/v1/chat/completions 并计入套餐，不必再走 cli-chat-proxy；本站图先内联成 data URL；401 强刷重放一次，429 冷却当前号并换下一个再试一次] [注释时间 2026-11-16] */
async function handleGrok(prov, body, reply, model) {
  const wantStream = body.stream === true;
  if (Array.isArray(body.messages)) {
    await imageInline.inlineLocalImagesForAnthropic(body.messages);
  }
  /* [位置:routes/oauth-proxy.js·handleGrok 参数剔除] [思考模型不吃采样惩罚与 stop] [11-16：官方明确 reasoning 模型（grok-4.x）传 presence_penalty / frequency_penalty / stop 会 400；前端「生成定义·自定义参数」或第三方客户端会带这些，转发前统一删掉；非 4.x 保持原样不动] [注释时间 2026-11-16] */
  let _thinkingModel = false;
  try { _thinkingModel = require('../lib/upstream-target').isGrokThinkingModel(model); } catch (e) { _thinkingModel = false; }
  if (_thinkingModel) {
    delete body.presence_penalty;
    delete body.frequency_penalty;
    delete body.stop;
  }
  /* [位置:routes/oauth-proxy.js·handleGrok 上游选择] [默认走 Responses，配置 grok_api=chat 回退旧路径] [11-16：p_grok_sub 里 grok_api 填 responses/chat；chat 走原来的 /v1/chat/completions 原样转发，出问题一行改回来] [注释时间 2026-11-16] */
  const apiMode = String((prov && prov.grok_api) || 'responses').toLowerCase() === 'chat' ? 'chat' : 'responses';
  const payloadObj = apiMode === 'responses' ? grokResponses.toResponsesRequest(body, model) : Object.assign({}, body, { model: model });
  const payload = JSON.stringify(payloadObj);
  const upstreamUrl = apiMode === 'responses' ? GROK_RESPONSES_URL : GROK_URL;
  /* 思考项（encrypted_content）只在工具循环场景回传：mcp-tool-loop 固定发 stream_options.include_usage，
     而 chat.js 无工具直连会把 SSE 原样转给浏览器——那里不给，前端流里就不会有加密串 */
  const emitGrokItems = grokResponses.wantsReasoningItems(body);

  const hdr = function (a) {
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + a.access_token,
      'user-agent': GROK_UA,
    };
  };

  const ctrl = new AbortController();
  reply.raw.on('close', function () { if (!reply.raw.writableEnded) ctrl.abort(); });

  const cands = pool.candidates('grok');
  const ordered = (cands.ordered && cands.ordered.length) ? cands.ordered : ['default'];
  let account = ordered[0];
  let auth;
  try {
    auth = await oauth.getAuth('grok', { account: account });
  } catch (e) {
    reply.code(401).send(decorateAuthError('grok', openaiError(401, e && e.message || 'Grok 订阅未登录'), 401));
    return;
  }

  const send = function (a) {
    return requestRaw(upstreamUrl, { method: 'POST', headers: hdr(a) }, payload, ctrl.signal);
  };
  let up = await send(auth);

  if (up.statusCode === 401 || up.statusCode === 403) {
    const first = await readAll(up).catch(function () { return ''; });
    if (up.statusCode === 401 || /invalid_token|authentication_error|invalid_grant|unauthenticated/i.test(first)) {
      common.logLine('grok', 'auth-retry', { status: up.statusCode, account: account });
      try {
        await oauth.getAccessToken('grok', { force: true, account: account });
        auth = await oauth.getAuth('grok', { account: account });
      } catch (e) {
        common.logFail('grok', 'auth-retry-refresh', e, 0);
      }
      up = await send(auth);
      common.logLine('grok', 'auth-retry', { status: up.statusCode, replay: true, account: account });
    } else {
      reply.code(up.statusCode).send(decorateAuthError('grok', openaiError(up.statusCode, first), up.statusCode));
      return;
    }
  }

  if (up.statusCode === 429) {
    const first = await readAll(up).catch(function () { return ''; });
    pool.markQuota('grok', account, '429');
    const next = ordered.find(function (a) { return a !== account; });
    if (next) {
      common.logLine('grok', 'quota-retry', { from: account, to: next });
      try {
        auth = await oauth.getAuth('grok', { account: next });
        account = next;
        up = await send(auth);
      } catch (e) {
        reply.code(429).send(openaiError(429, first || (e && e.message) || 'Grok 订阅额度已用尽'));
        return;
      }
    } else {
      reply.code(429).send(openaiError(429, first || 'Grok 订阅额度已用尽'));
      return;
    }
  }

  if (up.statusCode < 200 || up.statusCode >= 300) {
    const rawErr = await readAll(up).catch(function () { return ''; });
    reply.code(up.statusCode).send(decorateAuthError('grok', openaiError(up.statusCode, rawErr), up.statusCode));
    return;
  }

  if (!wantStream) {
    const rawU = await readAll(up);
    try {
      const j = JSON.parse(rawU);
      /* [位置:routes/oauth-proxy.js·handleGrok 非流式回译] [Responses JSON → Chat Completions JSON] [11-16：output[] 里的 reasoning/message/function_call 拆回 message.reasoning_content / content / tool_calls，usage 按 completion=output-reasoning 对齐；思考项放顶层 grok_reasoning_items 只给工具循环回传] [注释时间 2026-11-16] */
      reply.send(apiMode === 'responses' ? grokResponses.toChatCompletion(j, model, { emitItems: emitGrokItems }) : j);
    } catch (e) {
      reply.code(502).send(openaiError(502, '上游返回非 JSON'));
    }
    return;
  }

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  if (apiMode !== 'responses') {
    up.setEncoding('utf8');
    up.on('data', function (chunk) { raw.write(chunk); });
    up.on('end', function () { try { raw.end(); } catch (e) { /* ignore */ } });
    up.on('error', function () { try { raw.end(); } catch (e) { /* ignore */ } });
    return;
  }
  /* [位置:routes/oauth-proxy.js·handleGrok 流式回译] [Responses SSE → Chat Completions chunk] [11-16：output_text.delta→content、reasoning_summary_text.delta/reasoning_text.delta→reasoning_content、output_item/function_call_arguments→tool_calls（带 index/id/name/arguments）、completed→usage 帧（带 grok_reasoning_items）；收尾帧补 finish_reason 与 [DONE]。思考项只在 chunk 顶层回传，绝不进 delta.content] [注释时间 2026-11-16] */
  const tr = grokResponses.createStreamTranslator(model, { emitItems: emitGrokItems });
  let sbuf = '';
  let closed = false;
  const finish = function () {
    if (closed) return;
    closed = true;
    try { for (const c of tr.finish()) raw.write(c); } catch (e) { /* ignore */ }
    try { raw.end(); } catch (e) { /* ignore */ }
  };
  up.setEncoding('utf8');
  up.on('data', function (chunk) {
    sbuf += chunk;
    let idx;
    while ((idx = sbuf.indexOf('\n')) !== -1) {
      const line = sbuf.slice(0, idx).trim();
      sbuf = sbuf.slice(idx + 1);
      if (!line || line.indexOf('data:') !== 0) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let evt = null;
      try { evt = JSON.parse(data); } catch (e) { continue; }
      if (evt && (evt.type === 'response.failed' || evt.type === 'error')) {
        common.logFail('grok', 'responses-stream', new Error((evt.response && evt.response.error && evt.response.error.message) || evt.message || evt.type), 0);
        finish();
        return;
      }
      for (const c of tr.handle(evt)) { try { raw.write(c); } catch (e) { /* ignore */ } }
    }
  });
  up.on('end', finish);
  up.on('error', finish);
  return;
}

/* [位置:routes/oauth-proxy.js·filterSubscriptionModels] [订阅目录里挑出能当聊天模型用的 id] [antigravity 目录混着 chat_23310、tab_flash_lite_preview 这类内部 id（不是可对话模型），Gemini 订阅只留 gemini-/claude-/gpt-oss- 前缀；Grok 目录里有 grok-imagine-image/video 这类出图出片模型，聊天列表不要，只留 grok- 且不含 image/video] [注释时间 2026-11-17] */
function filterSubscriptionModels(provider, ids) {
  const list = (ids || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  if (provider === 'grok') {
    return list.filter(function (id) { return /^grok-/i.test(id) && !/image|video/i.test(id); });
  }
  if (provider === 'claude') {
    return list.filter(function (id) { return /^claude-/i.test(id); });
  }
  return list.filter(function (id) { return /^(gemini-|claude-|gpt-oss-)/i.test(id); });
}

/* [位置:routes/oauth-proxy.js·listSubscriptionModels] [订阅类供应商拉模型目录（设置页「模型 → 获取」用）] [11-17：这条链路原来对订阅类一律回「没有模型列表接口」，其实上游都能列——antigravity 走 v1internal:fetchAvailableModels（2026-11-17 实测 24 个 id，含内部 chat_/tab_ 前缀，filterSubscriptionModels 滤掉）、Grok 订阅走 api.x.ai/v1/models（实测 13 个，含 imagine 出图/出片模型，同样滤掉）；Claude 订阅的 /v1/models 对 OAuth 令牌 403（实测），只能手动加。纯读目录，不消耗额度；账号取池里第一个可用的] [注释时间 2026-11-17] */
async function listSubscriptionModels(prov) {
  const provider = String((prov && prov.oauth_provider) || '').trim();
  if (!provider) throw new Error('这家不是订阅登录类供应商');
  const account = (pool.candidates(provider).ordered || [])[0] || 'default';
  if (provider === 'antigravity' || provider === 'gemini') {
    const cfg = CLOUDCODE[provider];
    const token = await oauth.getAccessToken(provider, { account: account });
    const project = await ensureProject(cfg, token, account, provider);
    const catalog = await fetchAgCatalog(cfg, token, project, account, true);
    if (!catalog.length) throw new Error('上游没回模型目录');
    return { provider: provider, models: filterSubscriptionModels(provider, catalog) };
  }
  if (provider === 'grok') {
    const token = await oauth.getAccessToken('grok', { account: account });
    const res = await requestRaw('https://api.x.ai/v1/models', {
      method: 'GET', headers: { authorization: 'Bearer ' + token, 'user-agent': GROK_UA },
    }, '', null);
    const raw = await readAll(res);
    if (res.statusCode !== 200) throw new Error('上游 HTTP ' + res.statusCode + '：' + String(raw).slice(0, 160));
    let j = {};
    try { j = JSON.parse(raw); } catch (e) { throw new Error('上游返回非 JSON：' + String(raw).slice(0, 120)); }
    const ids = ((j && (j.data || j.models)) || []).map(function (m) { return typeof m === 'string' ? m : (m && (m.id || m.name)); }).filter(Boolean);
    if (!ids.length) throw new Error('上游没回模型列表');
    return { provider: provider, models: filterSubscriptionModels(provider, ids) };
  }
  throw new Error(providerLabel(provider) + ' 订阅的模型目录接口对 OAuth 令牌不开放（实测 HTTP 403），只能手动添加');
}
module.exports = function registerOAuthProxy(app, ctx) {
  const baseDir = (ctx && ctx.baseDir) || path.join(__dirname, '..');

  app.post('/internal/oauth/chat/completions', async function (req, reply) {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const pid = String(req.headers['x-provider-id'] || '').trim();
    const prov = pid ? loadProvider(baseDir, pid) : null;
    if (!prov) { reply.code(400).send(openaiError(400, '缺少或未知的 x-provider-id', 'bad_request')); return; }
    const provider = String(prov.oauth_provider || '').trim();
    if (provider !== 'gemini' && provider !== 'antigravity' && provider !== 'codex' && provider !== 'grok') {
      reply.code(400).send(openaiError(400, '这条供应商不是 OAuth 类型', 'bad_request'));
      return;
    }
    const model = String(body.model || prov.model || '').trim();
    if (!model) { reply.code(400).send(openaiError(400, '缺少模型名', 'bad_request')); return; }

    // 明确拒绝当前适配器做不到的东西（见 unsupportedFeature 注释；gemini/antigravity 工具、图片均已支持，codex 仍拒）
    const missing = unsupportedFeature(body, provider);
    if (missing) {
      const label = providerLabel(provider);
      const what = missing === 'tools' ? '工具调用（MCP）' : (missing === 'audio' ? '语音' : '图片');
      reply.code(400).send(openaiError(
        400,
        label + ' 订阅这条链路目前只支持纯文本，不支持' + what + '。要么换一个供应商跑这条消息，要么在设置里把这家的' + (missing === 'tools' ? '工具' : (missing === 'audio' ? '语音' : '图片')) + '关掉。',
        'unsupported_feature'
      ));
      return;
    }

    try {
      if (provider === 'gemini' || provider === 'antigravity') await handleCloudCode(CLOUDCODE[provider], prov, body, reply, model);
      else if (provider === 'grok') await handleGrok(prov, body, reply, model);
      else await handleCodex(prov, body, reply, model);
    } catch (e) {
      if (reply.raw.headersSent) {
        try { reply.raw.end(); } catch (err) { /* ignore */ }
        return;
      }
      if (e && e.code === 'EGRESS_DENIED') {
        return reply.code(503).send(openaiError(503, e.message, 'egress_unavailable'));
      }
      reply.code(502).send(openaiError(502, '上游失败：' + (e && e.message || e)));
    }
  });
};

// 测试用：暴露纯函数（不对外）
module.exports._internal = {
  pickAgModel: pickAgModel,
  filterSubscriptionModels: filterSubscriptionModels,
  listSubscriptionModels: listSubscriptionModels,
  CLOUDCODE: CLOUDCODE,
  stripImagesToPlaceholders: stripImagesToPlaceholders,
  prepareCloudCodeImages: prepareCloudCodeImages,
  prepareCloudCodeAudio: prepareCloudCodeAudio,
};
