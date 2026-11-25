'use strict';
// tool-images.js —— 工具返回的图片（2026-10-27 产品确定）
//
// 背景：云服务器的 screenshot / view_image 返回 MCP image 块（base64）。原来 mcp-service 的 _flattenToolResult
//   只写一句「[图片: image/jpeg]」把图丢了，所有模型（包括能看图的）都看不到。
// 做法：图存进 data/uploads/（公开可访问，nginx alias 直出），文件名 shot-<内容哈希>.<ext>（同一张图只存一份），
//   工具结果里写 ![](https://…/uploads/shot-xxx.jpg)（前端据此显示缩略图）；
//   模型能看图：网关把这条链接当 image_url 发上游（上游只认 https 绝对链接，data URL 会被拒，见 routes/imgurl.js 头注释）；
//   模型不能看图：用后台「图片转写」模型转成文字追加进工具结果，转写结果存同名 .txt，同一张图不重复转。
// 保留期：shot-* 超过 7 天、或超过最新 200 张的删掉（每小时最多清一次，写新图时顺带清）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 15 * 1024 * 1024;
const KEEP_DAYS = 7;
const KEEP_COUNT = 200;
let _lastClean = 0;

function publicBase() {
  const b = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (!b) return '';
  try { return new URL(b).origin; } catch (e) { return b.replace(/\/+$/, ''); }
}

// 清理：只动 shot-*（含同名 .txt 转写）；dir 可传（测试用）
function cleanup(dir, opts) {
  const d = dir || UPLOADS_DIR, o = opts || {};
  const days = o.days || KEEP_DAYS, keep = o.keep || KEEP_COUNT, now = Date.now();
  let names = [];
  try { names = fs.readdirSync(d).filter(function (n) { return /^shot-[0-9a-f]+\.(png|jpg|webp|gif)$/.test(n); }); } catch (e) { return 0; }
  const items = names.map(function (n) { try { return { n: n, m: fs.statSync(path.join(d, n)).mtimeMs }; } catch (e) { return null; } }).filter(Boolean)
    .sort(function (a, b) { return b.m - a.m; });
  let removed = 0;
  items.forEach(function (it, i) {
    if (i >= keep || now - it.m > days * 86400000) {
      try { fs.unlinkSync(path.join(d, it.n)); removed++; } catch (e) {}
      try { fs.unlinkSync(path.join(d, it.n + '.txt')); } catch (e) {}
    }
  });
  return removed;
}

// 存一张 MCP image 块的图；返回 {file, url, absUrl, mime} 或 null（不认的类型/过大/写盘失败）
function saveToolImage(mime, b64, dir) {
  const d = dir || UPLOADS_DIR;
  const ext = MIME_EXT[String(mime || '').toLowerCase()];
  if (!ext || !b64) return null;
  let buf;
  try { buf = Buffer.from(String(b64), 'base64'); } catch (e) { return null; }
  if (!buf.length || buf.length > MAX_BYTES) return null;
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const file = 'shot-' + hash + '.' + ext;
  try {
    fs.mkdirSync(d, { recursive: true });
    const fp = path.join(d, file);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf); else { const t = new Date(); fs.utimesSync(fp, t, t); }   // 同一张图再出现：刷新时间，保留期重新算
  } catch (e) { return null; }
  if (Date.now() - _lastClean > 3600000) { _lastClean = Date.now(); try { cleanup(d); } catch (e) {} }
  const base = publicBase();
  return { file: file, url: '/uploads/' + file, absUrl: base ? base + '/uploads/' + file : '', mime: String(mime), dir: d };
}

// 给不能看图的模型：取转写文字（同名 .txt 缓存）；返回 {text} 或 {error}
async function describeFor(img) {
  const d = (img && img.dir) || UPLOADS_DIR;
  const side = path.join(d, img.file + '.txt');
  try { const t = fs.readFileSync(side, 'utf-8').trim(); if (t) return { text: t }; } catch (e) {}
  try {
    const imageDesc = require('./image-desc');
    const text = await imageDesc.describe(img.absUrl || img.url);
    try { fs.writeFileSync(side, text, 'utf-8'); } catch (e) {}
    return { text: text };
  } catch (e) { return { error: (e && e.message) ? e.message : String(e) }; }
}

module.exports = { saveToolImage, describeFor, cleanup, UPLOADS_DIR };
