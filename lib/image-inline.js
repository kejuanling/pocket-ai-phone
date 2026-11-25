'use strict';
/* [位置:lib/image-inline.js·inlineLocalImagesForAnthropic] [本站图内联成 base64] [11-05：Claude 上游要自己去下载我们域名上的表情包/上传图，跨境链路超时后整包 400（"The request timed out while trying to download the file"），改成把图直接内联进请求体，上游不用再下载；只对走 Anthropic 翻译代理的供应商生效，其余上游（deepseek 只认 https 绝对 URL、base64 会被拒）保持原样] [注释时间 2026-11-05] */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const STICKER_DIR = path.join(ROOT, 'workspace', 'stickers', 't');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const CACHE_DIR = path.join(ROOT, 'data', 'image-inline-cache');

// 单请求内联预算（base64 字符数）：Anthropic 单请求总量上限 32MB，留足余量
const DEFAULT_BUDGET_CHARS = 8 * 1024 * 1024;
// 上传图长边上限：与 Anthropic 自己的 1568px 上限对齐，缩到人家同一档，不多损失细节
const UPLOAD_MAX_EDGE = 1568;
const UPLOAD_JPEG_QUALITY = 82;

const _memCache = new Map();   // cacheKey -> data URL（进程内热缓存）
const _MEM_CACHE_MAX = 300;

function _safeName(name) {
  // 只放行单层文件名，挡掉 ../ 路径穿越
  if (!name || name.indexOf('..') >= 0) return false;
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name);
}

// 本站资源 URL（相对路径或绝对 URL 都认）-> { kind, name, file }
function parseLocalAsset(url) {
  const s = String(url || '').split(/[?#]/)[0];
  const st = s.match(/\/stickers\/t\/([^/]+)$/);
  if (st && _safeName(st[1])) return { kind: 'sticker', name: st[1], file: path.join(STICKER_DIR, st[1]) };
  const up = s.match(/\/uploads\/([^/]+)$/);
  if (up && _safeName(up[1])) return { kind: 'upload', name: up[1], file: path.join(UPLOAD_DIR, up[1]) };
  return null;
}

function _cacheKey(kind, name, stat) {
  return kind + ':' + name + ':' + stat.size + ':' + Math.floor(stat.mtimeMs);
}

// 上传图：缩到长边 1400 的 jpeg，结果按「文件名+大小+修改时间」落盘缓存，同一张图只压一次
async function _shrinkUpload(asset, key) {
  const cacheFile = path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.jpg');
  try {
    const buf = await fs.promises.readFile(cacheFile);
    if (buf.length > 0) return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (e) { /* 无缓存，现压 */ }

  const sharp = require('sharp');
  const out = await sharp(asset.file, { failOn: 'none' })
    .rotate()
    .resize({ width: UPLOAD_MAX_EDGE, height: UPLOAD_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: UPLOAD_JPEG_QUALITY, chromaSubsampling: '4:2:0' })
    .toBuffer();

  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    const tmp = cacheFile + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, out);
    await fs.promises.rename(tmp, cacheFile);
  } catch (e) { /* 缓存写失败不影响本次请求 */ }

  return 'data:image/jpeg;base64,' + out.toString('base64');
}

async function _toDataUrl(asset) {
  const stat = await fs.promises.stat(asset.file);
  if (!stat.isFile() || stat.size <= 0) throw new Error('文件不存在或为空');
  const key = _cacheKey(asset.kind, asset.name, stat);

  const hit = _memCache.get(key);
  if (hit) return hit;

  let dataUrl;
  if (asset.kind === 'sticker') {
    // 表情包本身就是 160px 上下的小图（5~8KB），原样内联，重编码只会掉画质
    const buf = await fs.promises.readFile(asset.file);
    const mime = /\.png$/i.test(asset.name) ? 'image/png' : 'image/jpeg';
    dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
  } else {
    dataUrl = await _shrinkUpload(asset, key);
  }

  if (_memCache.size >= _MEM_CACHE_MAX) _memCache.clear();
  _memCache.set(key, dataUrl);
  return dataUrl;
}

function _imageUrlOf(part) {
  if (!part || part.type !== 'image_url') return '';
  const raw = part.image_url;
  const url = (typeof raw === 'string') ? raw : (raw && raw.url);
  return (typeof url === 'string') ? url : '';
}

/* 把 messages 里指向本站的表情包/上传图换成 data URL（就地替换数组元素，不改其它字段）。
   预算从后往前分配：最近的消息优先内联，预算用完了剩下的保持原 URL（上游仍可自己拉）。
   返回 { inlined, failed, bytes }。 */
async function inlineLocalImagesForAnthropic(messages, opts) {
  // 应急开关：IMAGE_INLINE_DISABLED=1 时完全退回「发 URL、上游自己下载」的老行为，不用改代码
  if (String(process.env.IMAGE_INLINE_DISABLED || '') === '1') return { inlined: 0, failed: 0, bytes: 0 };
  const o = opts || {};
  const budget = Number(o.budget) > 0 ? Number(o.budget) : DEFAULT_BUDGET_CHARS;
  const spots = [];

  if (Array.isArray(messages)) {
    for (let i = 0; i < messages.length; i++) {
      const content = messages[i] && messages[i].content;
      if (!Array.isArray(content)) continue;
      for (let j = 0; j < content.length; j++) {
        const url = _imageUrlOf(content[j]);
        if (!url || /^data:/i.test(url)) continue;
        const asset = parseLocalAsset(url);
        if (!asset) continue;
        spots.push({ i: i, j: j, asset: asset });
      }
    }
  }
  if (!spots.length) return { inlined: 0, failed: 0, bytes: 0 };

  let used = 0, inlined = 0, failed = 0;
  for (let k = spots.length - 1; k >= 0; k--) {
    const spot = spots[k];
    if (used >= budget) { failed++; continue; }
    let dataUrl;
    try {
      dataUrl = await _toDataUrl(spot.asset);
    } catch (e) {
      failed++;   // 图读不到就让上游自己试 URL，不影响这轮请求
      continue;
    }
    if (used + dataUrl.length > budget) { failed++; continue; }
    const content = messages[spot.i].content;
    content[spot.j] = Object.assign({}, content[spot.j], { image_url: { url: dataUrl } });
    used += dataUrl.length;
    inlined++;
  }
  return { inlined: inlined, failed: failed, bytes: used };
}

module.exports = { inlineLocalImagesForAnthropic, parseLocalAsset, DEFAULT_BUDGET_CHARS };
