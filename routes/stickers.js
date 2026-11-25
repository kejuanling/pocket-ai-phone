'use strict';
// stickers.js —— 表情包管理：小手机表情面板「表情包」标签页的上传与清单维护。
// [位置:routes/stickers.js] [POST /admin/stickers/upload · POST /admin/stickers/save]
// [11-08：表情包页补齐管理能力——新增走微信式裁剪（前端出 160x160 jpeg dataURL），上传后自动调
//   「图片转写」同款看图模型（model-router·image_desc 角色）生成语义 id + 中文描述 + tags，对齐现有清单风格；
//   识图失败整张不加入（文件不落盘、清单不动），返回错误由前端提示重试；
//   长按=移到最前/改描述/删除（删除只出清单，图片文件保留，聊天历史照常显示）] [注释时间 2026-11-08]
//
// 清单：workspace/stickers/index.json，[{id, desc, tags}]，数组顺序=面板展示顺序（最前=数组头）。
// 图片：workspace/stickers/t/<id>.jpg，nginx 静态直出；URL 一律由 id 拼 /stickers/t/<id>.jpg，不单独存。
// 上游：lib/outbound-images.js 读同一份清单（mtime 缓存）决定哪些 <sticker id> 出口转真图——改清单免重启生效。

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../utils/json_atomic');

/* [位置:routes/stickers.js·常量] [清单与图片约束] [id 白名单对齐现有清单风格（cat-shy / mua）；
   条数上限与颜文字页一致（200）；图片 2MB 封顶（前端已压成 160 方图实际几十 KB，这里只防异常大包）]
   [注释时间 2026-11-08] */
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LIST = 200;
const MAX_DESC = 60;
const MAX_TAGS = 4;
const MAX_BYTES = 2 * 1024 * 1024;
const DATAURL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/;

/* [位置:routes/stickers.js·META_PROMPT] [识图生成 id/描述/tags 的提示词] [11-08 拍板：每新增一张自动调
   「图片转写」用途模型补 id+描述+tags；文案已给用户过目，改前先问她] [注释时间 2026-11-08] */
const META_PROMPT = [
  '你是表情包清单管理员。看这张表情包图片，为它生成一条清单记录。',
  '',
  '现有清单风格示例：',
  '{"id":"cry-pillow","desc":"云团抱着枕头嚎啕大哭，旁边有只绿色小恐龙","tags":["委屈","大哭","难过"]}',
  '',
  '要求：',
  '1. id：英文小写短名，只能含 a-z、0-9 和中划线，形如 cat-shy、dog-happy、mua，用「主体+情绪或动作」，2 到 24 个字符。',
  '2. desc：一句中文，40 字以内，说清画面主体、动作和情绪；图上有文字要放进「」里带出来；语气口语、可爱一点，参考示例。',
  '3. tags：2 到 3 个中文短词，概括情绪或使用场景。',
  '只输出一个 JSON 对象，不要代码块标记，不要解释。'
].join('\n');

function listFile(baseDir) { return path.join(baseDir, 'workspace', 'stickers', 'index.json'); }
function imgDir(baseDir) { return path.join(baseDir, 'workspace', 'stickers', 't'); }

/* [位置:routes/stickers.js·cleanEntry/cleanList] [条目与清单清洗] [id 是全链路钥匙（文件名/URL/AI 编号），
   必须过白名单；desc/tags 只收纳干净文本；cleanList 去重保序、上限 200——save 全量回存与上传插入共用同一套规则] [注释时间 2026-11-08] */
function cleanEntry(it) {
  if (!it || typeof it !== 'object') return null;
  const id = String(it.id || '').trim().toLowerCase();
  if (!ID_RE.test(id) || id.length < 2 || id.length > 40) return null;
  const desc = String(it.desc || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESC);
  const tags = (Array.isArray(it.tags) ? it.tags : [])
    .map(function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); })
    .filter(function (t, i, a) { return t && a.indexOf(t) === i; }).slice(0, MAX_TAGS);
  return { id: id, desc: desc, tags: tags };
}
function cleanList(list) {
  if (!Array.isArray(list)) return null;
  const out = [], seen = {};
  for (const it of list) {
    const e = cleanEntry(it);
    if (!e || seen[e.id]) continue;
    seen[e.id] = 1;
    out.push(e);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

function readList(baseDir) {
  try {
    const arr = JSON.parse(fs.readFileSync(listFile(baseDir), 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/* [位置:routes/stickers.js·uniqueId] [撞名加后缀] [识图给出的 id 与清单/磁盘撞名时加 -2、-3……
   绝不覆盖旧图——旧 id 被聊天历史和 AI 上下文引用，图一换历史就变脸] [注释时间 2026-11-08] */
function uniqueId(baseDir, want) {
  const have = {};
  readList(baseDir).forEach(function (e) { have[e.id] = 1; });
  if (!have[want]) return want;
  for (let n = 2; n < 50; n++) { if (!have[want + '-' + n]) return want + '-' + n; }
  return want + '-' + Date.now().toString(36);
}

/* [位置:routes/stickers.js·parseMeta] [识图返回解析] [剥 markdown 代码块/多余文字后取 JSON；
   解析不出或字段不合法返回 null（上层视为本次尝试失败）] [注释时间 2026-11-08] */
function parseMeta(text) {
  let t = String(text || '').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m) t = m[1].trim();
  const b = t.match(/\{[\s\S]*\}/); if (b) t = b[0];
  let o = null; try { o = JSON.parse(t); } catch (e) { return null; }
  return cleanEntry(o);
}

/* [位置:routes/stickers.js·genMeta] [识图生成 id/desc/tags] [模型跟后台「图片转写」同款
   （resolveRoleModel('image_desc')，用户换模型这里自动跟随）；超时复用图片转写的 timeout_sec 配置；
   网络与配置错误直接抛（重试也没用），只有「模型没按 JSON 格式回」才自动再试一次] [注释时间 2026-11-08] */
async function genMeta(dataURL) {
  const router = require('../lib/model-router');
  const upstreamTarget = require('../lib/upstream-target');
  const imageDesc = require('../lib/image-desc');
  const { provider, model } = router.resolveRoleModel('image_desc', { ignoreEnabled: true });
  if (!provider || !model) throw new Error('没配图片转写模型（后台·模型·用途模型·图片转写）');
  const target = upstreamTarget.resolveTarget(provider, function (k) { return process.env[k] || ''; }, model);
  if (!target.url || !target.key) throw new Error('图片转写供应商未配置 API 地址或 Key');
  const timeoutSec = Math.max(10, Math.min(120, Number(imageDesc.prompts().timeout_sec) || 60));
  const body = {
    model: model, stream: false, temperature: 0.2,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: dataURL } },
      { type: 'text', text: META_PROMPT }
    ] }]
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutSec * 1000);
    let resp;
    try {
      resp = await fetch(target.url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + target.key }, target.headers || {}),
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '识图超时了，再试一次' : ('识图连不上：' + e.message));
    } finally { clearTimeout(timer); }
    const raw = await resp.text();
    let j = null; try { j = JSON.parse(raw); } catch (e) {}
    if (!resp.ok) throw new Error('识图失败 HTTP ' + resp.status + '：' + ((j && j.error && (j.error.message || j.error)) || String(raw).slice(0, 120)));
    const out = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    const meta = parseMeta(typeof out === 'string' ? out : '');
    if (meta) return meta;
    lastErr = new Error('识图没按格式回，再试一次');
  }
  throw lastErr;
}

module.exports = function (app, deps) {
  const baseDir = deps.baseDir;
  const basicAuth = deps.basicAuth;

  /* [位置:routes/stickers.js·withLock] [清单写操作串行化] [upload 在「识图 await」期间若有长按 save 进来，
     两次「读-改-写」会互相覆盖；promise 链把 upload/save 的读改写排队，快路径几乎无感] [注释时间 2026-11-08] */
  let _chain = Promise.resolve();
  function withLock(fn) {
    const run = _chain.then(fn, fn);
    _chain = run.then(function () {}, function () {});
    return run;
  }

  /* [位置:routes/stickers.js·upload] [新增表情：识图→写图→清单置顶] [识图失败=什么都不写（产品确定）；
     先写图后写清单：写清单失败把刚写的图删掉再抛，不留孤儿；清单先落的话 AI 短暂引用不存在的图] [注释时间 2026-11-08] */
  app.post('/admin/stickers/upload', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const m = String(b.data || '').match(DATAURL_RE);
      if (!m) return reply.code(400).send({ ok: false, error: '只认 png/jpg/webp/gif 的图片' });
      const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
      if (!buf.length) return reply.code(400).send({ ok: false, error: '图片内容是空的' });
      if (buf.length > MAX_BYTES) return reply.code(400).send({ ok: false, error: '图片太大（上限 2MB）' });

      const meta = await genMeta(m[0]);
      const item = await withLock(async function () {
        const id = uniqueId(baseDir, meta.id);
        const file = path.join(imgDir(baseDir), id + '.jpg');
        if (fs.existsSync(file)) throw new Error('同名图片已存在：' + id);
        fs.mkdirSync(imgDir(baseDir), { recursive: true });
        fs.writeFileSync(file, buf);
        const entry = { id: id, desc: meta.desc, tags: meta.tags };
        try {
          const list = readList(baseDir);
          list.unshift(entry);
          writeJsonAtomic(listFile(baseDir), list.slice(0, MAX_LIST));
        } catch (e) { try { fs.unlinkSync(file); } catch (e2) {} throw e; }
        return entry;
      });
      reply.send({ ok: true, item: item });
    } catch (err) {
      reply.code(502).send({ ok: false, error: String(err && err.message || '识图没成功').slice(0, 160) });
    }
  });

  /* [位置:routes/stickers.js·save] [清单全量回存] [长按三操作（移到最前/改描述/删除）都由前端改完全量交上来，
     与颜文字页同一模式；空数组放行=删光也是用户的选择；返回清洗后的清单为准] [注释时间 2026-11-08] */
  app.post('/admin/stickers/save', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!Array.isArray(b.list)) return reply.code(400).send({ ok: false, error: 'list 要是数组' });
      const list = await withLock(async function () {
        const cleaned = cleanList(b.list) || [];
        writeJsonAtomic(listFile(baseDir), cleaned);
        return cleaned;
      });
      reply.send({ ok: true, list: list });
    } catch (err) {
      reply.code(500).send({ ok: false, error: String(err && err.message || '没存上').slice(0, 160) });
    }
  });
};

module.exports.META_PROMPT = META_PROMPT;
module.exports.cleanList = cleanList;
