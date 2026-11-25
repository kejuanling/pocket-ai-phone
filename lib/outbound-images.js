'use strict';
/* [位置:lib/outbound-images.js·decorateOutboundMessages/fillAndInlineImages] [出站图片加工唯一入口] [需求：聊天与唤醒两条出口此前各自散装加工出站图片（图片 id 注入 / 表情包转真图 / 相对路径补全 / 本站图内联 base64），口令不一致——11-06 晚实测同一会话同一份历史：19:05 聊天出站 5 个图块，19:09 唤醒 0 个（连她发的照片都没有），两条链路的前缀从第一张表情包就分叉，提示词缓存从 B3 断点（74464）往后的约 4 万 token 每轮重写（cache_creation 40776）；收敛成一个函数，两条链路只准调它，顺序与口径由这里写死] [注释时间 2026-11-06] */

const fs = require('fs');
const path = require('path');
const imageInline = require('./image-inline');

// ---------------- 表情包编号清单（workspace/stickers/index.json，mtime 缓存，清单更新免重启） ----------------
const STICKER_JSON = path.join(__dirname, '..', 'workspace', 'stickers', 'index.json');
let _stickerIds = null, _stickerIdsMtime = 0;
function stickerIdSet() {
  try {
    const st = fs.statSync(STICKER_JSON);
    if (!_stickerIds || st.mtimeMs !== _stickerIdsMtime) {
      const arr = JSON.parse(fs.readFileSync(STICKER_JSON, 'utf8'));
      _stickerIds = new Set((Array.isArray(arr) ? arr : []).map(function (sv) { return (sv && sv.id) || ''; }).filter(Boolean));
      _stickerIdsMtime = st.mtimeMs;
    }
  } catch (e) { if (!_stickerIds) _stickerIds = new Set(); }
  return _stickerIds;
}

const STICKER_TAG_RE = /<\s*sticker\b[^>]*?\bid\s*=\s*["']?([\w-]+)["']?[^>]*>/gi;

// 一条消息里出现的合法表情包编号（去重，保持出现顺序）；无效编号不转，不给上游塞 404 图
function stickerIdsInText(content) {
  const set = stickerIdSet();
  if (!set.size) return [];
  const ids = [];
  const scan = function (t) {
    STICKER_TAG_RE.lastIndex = 0;
    let m;
    while ((m = STICKER_TAG_RE.exec(String(t))) !== null) {
      if (set.has(m[1]) && ids.indexOf(m[1]) < 0) ids.push(m[1]);
    }
  };
  if (typeof content === 'string') scan(content);
  else if (Array.isArray(content)) {
    for (const p of content) { if (p && p.type === 'text' && typeof p.text === 'string') scan(p.text); }
  }
  return ids;
}

// 表情包标签 → 追加真图 part（相对路径，由 fillAndInlineImages 统一补全/内联）；文字一个字节都不动
function contentWithStickerImages(content, ids) {
  const imgs = ids.map(function (id) { return { type: 'image_url', image_url: { url: '/stickers/t/' + encodeURIComponent(id) + '.jpg' } }; });
  if (typeof content === 'string') return [{ type: 'text', text: content }].concat(imgs);
  return content.concat(imgs);
}

// ---------------- 上传图 id ----------------
/* [位置:lib/outbound-images.js·imgIdOfUrl] [从图片 URL 解析上传图 id] [需求：出站 id 注入与 chat-context 历史图分流共用同一个解析口径（img- 两段式，新旧文件名格式都认——11-07 文件名缩短后第一段不再是 base36 时间戳）] [注释时间 2026-11-08] */
const IMG_URL_RE = /\/uploads\/(img-([A-Za-z0-9]+)-[A-Za-z0-9]+)\.[A-Za-z0-9]+/;
function imgIdOfUrl(url) {
  const m = String(url || '').match(IMG_URL_RE);
  return m ? m[1] : '';
}

/* [位置:lib/outbound-images.js·decorateOutboundMessages] [同步加工：图片 id + 表情包转图] [必须在「捕获发给模型的上下文」之前调：存档里要能看到这两类文字/图块，管理台日志页与两侧口径一致；2026-11-12 起 opts.vision 为真时跳过表情包转图，只留标签文字（vision 模型不需要图字节，产品确定）] */
// 只改数组元素（新对象），不动传进来的消息本体。
// 表情包只转 user 消息：assistant 带图会被 deepseek 整包拒（s_mvo5eqoq_zt7gmy 10-25 晚起每发必炸），
// 且 AI 自己发的表情包编号清单在永久上下文里，画面无信息增量。
function decorateOutboundMessages(messages, opts) {
  const o = opts || {};
  const stats = { imageIds: 0, stickers: 0 };
  if (!Array.isArray(messages)) return stats;

  // 1) 图片 id 注入（相册按 id 存图）；已注入过的不重复加（MCP 工具循环会复用同一份 outbound）
  // 11-08：删除「第一段 base36 解码 >= 2026-10-23」门槛——11-07 文件名缩短（img-cyfa-rh4o 两段各 4 位随机）后
  // 第一段不再是时间戳，短名解码≈1970 永远过不了门槛，11-07 起新图全部漏注 id（主会话 AI 看不到图片 id 的根因）。
  // 门槛原意是「老图不加，避免老会话前缀整体变化」，但 11-08 起历史图在出口按模型分流（chat-context.js·shapeHistoryImagesForModel），
  // 不能看图模型的图在 decorate 之前已变占位文字、能看图模型历史图保真本来就要带 id——出站图块只剩当轮新图，一律注入没有副作用。
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    const seen = new Set();
    for (const p of m.content) {
      if (p && p.type === 'text' && typeof p.text === 'string') {
        const sm = p.text.match(/^\[图片 id:(.+?)\]$/);
        if (sm) seen.add(sm[1]);
      }
    }
    let changed = false;
    const parts = [];
    for (const p of m.content) {
      const u = (p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string') ? p.image_url.url : '';
      const id = imgIdOfUrl(u);
      if (id && !seen.has(id)) {
        parts.push({ type: 'text', text: '[图片 id:' + id + ']' });
        seen.add(id);
        changed = true;
        stats.imageIds++;
      }
      parts.push(p);
    }
    if (changed) messages[i] = Object.assign({}, m, { content: parts });
  }

  // 2) 表情包转真图（只 user，见函数头注释）；已附过同编号图的不重复附
  // 2026-11-12：vision 模型（opts.vision）跳过转图，表情包标签保持纯文字——编号清单在永久上下文里，
  // 图对能看图的模型没有信息增量（11-12 拍板），还省上传图字节与 token
  if (!o.vision) for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const attached = new Set();
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (!p || p.type !== 'image_url' || !p.image_url) continue;
        const u = typeof p.image_url === 'string' ? p.image_url : p.image_url.url;
        const sm = String(u || '').match(/\/stickers\/t\/([^/?#]+?)\.(?:jpg|jpeg|png)$/i);
        if (sm) attached.add(decodeURIComponent(sm[1]));
      }
    }
    const ids = stickerIdsInText(m.content).filter(function (id) { return !attached.has(id); });
    if (!ids.length) continue;
    messages[i] = Object.assign({}, m, { content: contentWithStickerImages(m.content, ids) });
    stats.stickers += ids.length;
  }

  return stats;
}

// ---------------- 是否「真正的 Claude 翻译代理」 ----------------
// 判定收拢在 upstreamTarget.isClaudeChat（isAnthropicProxy 是路由级判据，Gemini 订阅也命中）。
// 两条链路同一份判定，不许各写一遍。Gemini 订阅的图片加工 2026-11-12 起移到
// routes/oauth-proxy.js·prepareCloudCodeImages（vision 内联 / 非 vision 剥占位），不走这里。
function isClaudeImageUpstream(prov) {
  try { return require('./upstream-target').isClaudeChat(prov); } catch (e) { return false; }
}

// 没有 req 的出口（唤醒）用配置里的公开基址；取不到就返回空串（调用方跳过补全，不做 localhost 兜底）
function publicOrigin() {
  const b = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (!b) return '';
  try { return new URL(b).origin; } catch (e) { return b.replace(/\/+$/, ''); }
}

// 把相对路径拼成绝对 URL（已是绝对/dataURL 的原样返回）
function makeUrlResolver(base) {
  const b = String(base || '').replace(/\/+$/, '');
  if (!b) return null;
  return function (u) {
    const s = String(u || '');
    if (!s || /^(https?:)?\/\//.test(s) || /^data:/i.test(s)) return u;
    return b + (s.charAt(0) === '/' ? s : '/' + s);
  };
}

/* [位置:lib/outbound-images.js·fillAndInlineImages] [相对路径补全 + 本站图内联 base64] [两条出口共用的最后一步：补全给所有上游（deepseek 只认 https 绝对 URL），内联只给 Claude 翻译代理（上游在美国，跨境拉本站图会超时整包 400；deepseek 收 base64 直接整包拒）] [注释时间 2026-11-06；原逻辑分处 routes/chat.js·本地图内联 / routes/wake-chat.js·本地图内联] */
// opts: { resolveUrl?: (u)=>string, isAnthropicProxy?: bool, budget?: number }
// 返回 { urlFilled, imageBlocks, inlined, inlineFailed, inlineBytes, inlineError? }
async function fillAndInlineImages(messages, opts) {
  const o = opts || {};
  const stats = { urlFilled: 0, imageBlocks: 0, inlined: 0, inlineFailed: 0, inlineBytes: 0 };
  if (!Array.isArray(messages)) return stats;

  // 1) 相对路径 → 绝对 URL（file 附件同口径）
  const resolveUrl = typeof o.resolveUrl === 'function' ? o.resolveUrl : null;
  if (resolveUrl) {
    for (const m of messages) {
      const c = m && m.content;
      if (!Array.isArray(c)) continue;
      for (const p of c) {
        if (!p) continue;
        if (p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string') {
          const after = resolveUrl(p.image_url.url);
          if (after && after !== p.image_url.url) { p.image_url.url = after; stats.urlFilled++; }
        } else if (p.type === 'file' && p.file && typeof p.file.url === 'string') {
          const after = resolveUrl(p.file.url);
          if (after && after !== p.file.url) { p.file.url = after; stats.urlFilled++; }
        }
      }
    }
  }

  // 2) 图块计数（内联前口径，便于和上游 usage 对齐核对）
  for (const m of messages) {
    const c = m && m.content;
    if (!Array.isArray(c)) continue;
    for (const p of c) if (p && p.type === 'image_url') stats.imageBlocks++;
  }

  // 3) 本站图内联 base64（只 Claude 翻译代理）
  if (o.isAnthropicProxy) {
    try {
      const r = await imageInline.inlineLocalImagesForAnthropic(messages, Number(o.budget) > 0 ? { budget: Number(o.budget) } : undefined);
      stats.inlined = r.inlined;
      stats.inlineFailed = r.failed;
      stats.inlineBytes = r.bytes;
    } catch (e) {
      stats.inlineError = (e && e.message) || String(e);
    }
  }

  return stats;
}

/* [位置:lib/outbound-images.js·stripAudioPartsFromMessages] [出站音频剥离（聊天/唤醒两条出口共用）] [11-12：语音消息的 input_audio part（站内 wav 引用）只有 Gemini 订阅的 Cloud Code 链路认——gemini 系模型内联、claude/gpt 档剥占位（都在 routes/oauth-proxy.js·prepareCloudCodeAudio）；其余供应商（直连商/Claude 翻译代理）不认这 part，转发前在这里剥成占位文字。转写文字一直附在「[语音消息 N秒 #id]」标签后，剥掉音频模型无信息损失] [注释时间 2026-11-12] */
const AUDIO_PLACEHOLDER = '（语音）';
function stripAudioPartsFromMessages(messages) {
  const msgs = Array.isArray(messages) ? messages : [];
  let n = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || !Array.isArray(m.content)) continue;
    let changed = false;
    const parts = [];
    for (let k = 0; k < m.content.length; k++) {
      const p = m.content[k];
      if (p && p.type === 'input_audio') { parts.push({ type: 'text', text: AUDIO_PLACEHOLDER }); changed = true; n++; continue; }
      parts.push(p);
    }
    if (changed) m.content = parts;
  }
  return n;
}

module.exports = {
  decorateOutboundMessages,
  fillAndInlineImages,
  imgIdOfUrl,
  isClaudeImageUpstream,
  publicOrigin,
  makeUrlResolver,
  stickerIdsInText,
  contentWithStickerImages,
  stripAudioPartsFromMessages,
};
