'use strict';
// album.js —— 相册（10-23）：照片只存「引用」，图片本身还在 data/uploads/，从相册删除不删文件（聊天里那张还在）。
//   数据：data/album.json = { items: [ { id, img_id, file, url, source, by, note, note_by, desc, session_id, msg_id, ctx, added_at } ] }
//     img_id  = 上传文件名去掉扩展名（img-xxxx-xxxx），也是 AI 在上下文里看到的 [图片 id:xxx]（chat.js 注入），全局唯一，同一张图只入册一次；
//     source  = 'chat'（聊天里的图加入）| 'upload'（用户在相册页直接上传）；by = 'her' | 'ai'（谁加的）；
//     note    = 批注（谁写的记在 note_by：'ai' | 'her'）；desc = 描述（用户手填，非多模态模型看图时用）；
//     ctx     = 入册那一刻「当时的对话」快照（图所在那条消息前 2 条到后 3 条，只留文字），上传的没有；
//   AI 只能删自己加的（by === 'ai'），用户加的 AI 删不了。
const fs = require('fs');
const path = require('path');

function createAlbum(opts) {
  const baseDir = opts.baseDir;
  const loadTimeline = opts.loadTimeline;                       // (sessionId) => 消息数组
  const log = opts.log || function (m) { console.log('[album] ' + m); };
  const FILE = path.join(baseDir, 'data', 'album.json');
  const UPLOADS = path.join(baseDir, 'data', 'uploads');
  const listeners = [];                                         // 变更监听（订阅「相册更新」时接）：fn({type:'add'|'note'|'remove', item})

  function readAll() {
    try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); return (o && Array.isArray(o.items)) ? o.items : []; } catch (e) { return []; }
  }
  function writeAll(items) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify({ items: items }, null, 1));
    fs.renameSync(tmp, FILE);
  }
  function emit(ev) { listeners.forEach(function (fn) { try { fn(ev); } catch (e) { log('listener 异常: ' + e.message); } }); }

  // 从 URL / 路径 / 纯 id 里取 img_id（只认 img- 开头的上传图）
  function imgIdOf(x) {
    const s = String(x || '').trim();
    const m = s.match(/(?:\/uploads\/)?(img-[A-Za-z0-9]+-[A-Za-z0-9]+)(?:\.[A-Za-z0-9]+)?(?:[?#].*)?$/);
    return m ? m[1] : '';
  }
  function fileOfImg(imgId) {
    try { const f = fs.readdirSync(UPLOADS).find(function (n) { return n.indexOf(imgId + '.') === 0; }); return f || ''; } catch (e) { return ''; }
  }

  function textOfContent(c) {
    let t = '';
    if (Array.isArray(c)) t = c.map(function (p) { return p && p.type === 'text' ? String(p.text || '') : (p && (p.type === 'image_url' || p.type === 'image') ? '[图片]' : ''); }).join('\n');
    else t = String(c || '');
    t = t.replace(/\n?<current_time>[\s\S]*?<\/current_time>/gi, '');
    try { t = require('./tag-parser').stripTags(t); } catch (e) { /* 剥不了就原样 */ }
    return t.replace(/\[push\]|\[\/push\]/gi, '').trim();
  }
  // 找这张图在会话时间线里的那条用户消息，返回 {msg_id, ctx}
  function locate(sessionId, imgId) {
    if (!sessionId || !loadTimeline) return { msg_id: '', ctx: [] };
    let tl = [];
    try { tl = loadTimeline(sessionId) || []; } catch (e) { return { msg_id: '', ctx: [] }; }
    let idx = -1;
    for (let i = tl.length - 1; i >= 0; i--) {
      const m = tl[i];
      if (!m || m.role !== 'user') continue;
      let s = ''; try { s = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); } catch (e) { continue; }
      if (s.indexOf(imgId) >= 0) { idx = i; break; }
    }
    if (idx < 0) return { msg_id: '', ctx: [] };
    const out = [];
    for (let i = Math.max(0, idx - 2); i <= Math.min(tl.length - 1, idx + 3); i++) {
      const m = tl[i];
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || m.kind === 'diary' || m._ctxRep) continue;
      const text = textOfContent(m.content);
      if (!text) continue;
      out.push({ role: m.role, text: text.length > 300 ? text.slice(0, 300) + '…' : text, time: m.time || '' });
    }
    return { msg_id: tl[idx].id || '', ctx: out };
  }

  function pub(it) { return it; }

  /* 加入相册：args = { img（URL/路径/img_id）, by, source, note, desc, session_id, msg_id }；已在册的返回 existed:true（有新批注且原来没有则补上）。 */
  function add(args) {
    const imgId = imgIdOf(args.img || args.url || args.img_id);
    if (!imgId) return { ok: false, error: '图片 id 不对（要是上传图的 id，形如 img-xxxx-xxxx）' };
    const file = fileOfImg(imgId);
    if (!file) return { ok: false, error: '找不到这张图（可能已被清理）：' + imgId };
    const items = readAll();
    const hit = items.find(function (x) { return x.img_id === imgId; });
    const note = String(args.note || '').trim().slice(0, 500);
    if (hit) {
      if (note && !hit.note) { hit.note = note; hit.note_by = args.by === 'ai' ? 'ai' : 'her'; writeAll(items); emit({ type: 'note', item: hit }); }
      return { ok: true, existed: true, item: pub(hit) };
    }
    const by = args.by === 'ai' ? 'ai' : 'her';
    const source = args.source === 'upload' ? 'upload' : 'chat';
    const sid = String(args.session_id || '').trim();
    const loc = source === 'chat' ? locate(sid, imgId) : { msg_id: '', ctx: [] };
    const item = {
      id: 'al_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      img_id: imgId, file: file, url: '/uploads/' + file, source: source, by: by,
      note: note, note_by: note ? (by === 'ai' ? 'ai' : 'her') : '', desc: String(args.desc || '').trim().slice(0, 500),
      session_id: sid, msg_id: String(args.msg_id || loc.msg_id || ''), ctx: loc.ctx,
      added_at: new Date().toISOString()
    };
    items.push(item); writeAll(items);
    log('入册 ' + item.id + ' img=' + imgId + ' by=' + by + ' source=' + source + (sid ? ' session=' + sid : ''));
    emit({ type: 'add', item: item });
    return { ok: true, existed: false, item: pub(item) };
  }
  function find(idOrImg) {
    const k = String(idOrImg || '').trim(); if (!k) return null;
    const imgId = imgIdOf(k);
    return readAll().find(function (x) { return x.id === k || (imgId && x.img_id === imgId); }) || null;
  }
  function list(o) {
    o = o || {};
    const all = readAll().sort(function (a, b) { return a.added_at < b.added_at ? 1 : -1; });   // 新的在前
    const off = Math.max(0, +o.offset || 0), lim = Math.max(1, Math.min(500, +o.limit || 500));
    return { total: all.length, items: all.slice(off, off + lim).map(pub) };
  }
  function setField(idOrImg, field, value, by) {
    const items = readAll(), it = items.find(function (x) { return x.id === idOrImg || x.img_id === imgIdOf(idOrImg); });
    if (!it) return { ok: false, error: '相册里没有这张' };
    it[field] = String(value || '').trim().slice(0, 500);
    if (field === 'note') it.note_by = it.note ? (by === 'ai' ? 'ai' : 'her') : '';
    writeAll(items); emit({ type: 'note', item: it });
    return { ok: true, item: pub(it) };
  }
  function remove(idOrImg, by) {
    const items = readAll(), i = items.findIndex(function (x) { return x.id === idOrImg || x.img_id === imgIdOf(idOrImg); });
    if (i < 0) return { ok: false, error: '相册里没有这张' };
    if (by === 'ai' && items[i].by !== 'ai') return { ok: false, error: '这张是她放进相册的，你不能删；想删请她自己来' };
    const gone = items.splice(i, 1)[0];
    // 删除前自动备份一份整表
    try { const bk = path.join(baseDir, 'data', 'backups', 'album'); fs.mkdirSync(bk, { recursive: true }); fs.writeFileSync(path.join(bk, 'album-before-delete-' + Date.now() + '.json'), JSON.stringify({ items: readAll() })); } catch (e) { /* 备份失败不挡删除 */ }
    writeAll(items); emit({ type: 'remove', item: gone });
    log('删除 ' + gone.id + ' by=' + (by || 'her'));
    return { ok: true, removed: gone.id };
  }

  return { add, find, list, setNote: function (id, text, by) { return setField(id, 'note', text, by); }, setDesc: function (id, text) { return setField(id, 'desc', text, 'her'); }, remove, imgIdOf, onChange: function (fn) { listeners.push(fn); } };
}

// 单例：server.js 启动时 init（注入 loadTimeline），tag-parser / 路由用 get() 取
let _inst = null;
function init(opts) { _inst = createAlbum(opts); return _inst; }
function get() { return _inst; }

module.exports = { createAlbum, init, get };
