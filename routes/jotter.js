'use strict';
// jotter.js —— 随手记：把 工作流/00用户随手记 当数据文件，前端读、加一条、划掉（已完成）。
// [位置:routes/jotter.js] [GET /admin/jotter · POST /admin/jotter/add · toggle · edit · delete] [10-28：00 文件做成小手机「我的」里的随手记，能直接划掉显示已完成，主要给 AI 看，所以文件保持纯文本，不换格式] [10-28 设计稿：长按可编辑/删除] [注释时间 2026-10-28]
//
// 2026-11-01（#52 产品确定：划掉就自动移进归档文件，不然 AI 每回看到的都是全部）：
//   归档文件 = 工作流/归档/00用户随手记_已完成.md，格式与 00 完全一致（符号 + ~~原文~~ + 完成时间），AI 读归档也看得懂。
//   划掉（toggle done=true）→ 该行从 00 移除、追加进归档文件，两个文件同批原子写；
//   撤回（toggle done=false，00 里找不到时）→ 从归档文件移回 00 还原成未完成；
//   00 文件从此只剩未完成条目，AI 读 00 不再看历史。归档文件写前同样每天首次备份一份。
//
// 文件约定（保持原样，AI 直接读文件就看得懂）：
//   第一行 / 不以优先级符号开头的行 = 说明，原样保留
//   每条 = 以优先级符号开头的一行：☁️ 最高 · 🔖 · 🌱 · 🍃 最低
//   归档文件里：<符号>~~原文~~ ✅已完成 MM-DD HH:mm   （符号在行首；撤回时还原成原文移回 00）
//   新加的一条追加到文件末尾；每次操作都重新读文件（AI 也可能同时在改），原子写回，每天首次写前备份一份。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIS = ['☁️', '🔖', '🌱', '🍃'];
const FE0F = '\uFE0F';
const DONE_RE = /^~~([\s\S]*)~~ ✅已完成(?: (\d\d-\d\d \d\d:\d\d))?\s*$/;

function priOf(line) {
  for (const p of PRIS) {
    if (line.startsWith(p)) return { pri: p, rest: line.slice(p.length) };
    const bare = p.replace(FE0F, '');   // 手打时可能没带变体选择符
    if (bare !== p && line.startsWith(bare)) return { pri: p, rest: line.slice(bare.length).replace(/^\uFE0F/, '') };
  }
  return null;
}

// 解析：返回 {eol, lines:[{raw}|{raw,item:{id,pri,text,done,doneAt}}]}
function parse(raw) {
  const eol = raw.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const body = raw.replace(/\r\n/g, '\n');
  const trailing = body.endsWith('\n');
  const parts = body.split('\n');
  if (trailing) parts.pop();
  const seen = {};
  const lines = parts.map(l => {
    const po = priOf(l);
    if (!po) return { raw: l };
    let text = po.rest, done = false, doneAt = '';
    const m = DONE_RE.exec(text);
    if (m) { done = true; text = m[1]; doneAt = m[2] || ''; }
    const h = crypto.createHash('sha1').update(po.pri + '|' + text).digest('hex').slice(0, 10);
    seen[h] = (seen[h] || 0) + 1;
    const id = seen[h] > 1 ? h + '-' + seen[h] : h;
    return { raw: l, item: { id, pri: po.pri, text, done, doneAt } };
  });
  return { eol, trailing, lines };
}

function render(doc) {
  const s = doc.lines.map(l => l.raw).join(doc.eol);
  return doc.trailing ? s + doc.eol : s;
}

function view(doc) {
  const head = doc.lines.filter(l => !l.item).map(l => l.raw).filter(x => x.trim()).join('\n');
  return { head, items: doc.lines.filter(l => l.item).map(l => l.item) };
}

function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  d = d || new Date();
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function toggle(doc, id, want, now) {   // want: true 划掉 / false 取消 / undefined 翻转
  const l = doc.lines.find(x => x.item && x.item.id === id);
  if (!l) return null;
  const it = l.item;
  const to = want === undefined ? !it.done : !!want;
  if (to === it.done) return it;
  if (to) { it.done = true; it.doneAt = stamp(now); l.raw = it.pri + '~~' + it.text + '~~ ✅已完成 ' + it.doneAt; }
  else { it.done = false; it.doneAt = ''; l.raw = it.pri + it.text; }
  return it;
}

function add(doc, text, pri) {
  text = cleanText(text);
  if (!text) return null;
  doc.lines.push({ raw: normPri(pri, PRIS[1]) + text });
  doc.trailing = true;
  // 修复（10-29 #47）：push 进来的是纯 {raw} 行，不回填的话 /add 返回给前端的整表
  // 按「无 item = 说明行」归类，新条目被算进 head（页头小字）、items 里没有——前端照着
  // apply 重画，新条目就不在列表里，退出重进（重新 parse）才出现。与 edit() 同款回填。
  const nd = parse(render(doc));
  doc.lines = nd.lines;
  doc.trailing = nd.trailing;
  return doc.lines.filter(l => l.item).pop().item;
}

function cleanText(text) {
  text = String(text || '').replace(/[\r\n]+/g, ' ').trim();
  if (/^~~[\s\S]*~~ ✅已完成/.test(text)) text = text.replace(/^~~/, '');   // 防止手写成「已完成」格式
  return text;
}
function normPri(pri, dflt) {
  if (PRIS.indexOf(pri) >= 0) return pri;
  return PRIS.find(x => x.replace(FE0F, '') === String(pri || '').replace(FE0F, '')) || dflt;
}

// 改一条：text / pri 给哪个改哪个；已完成的保持已完成（时间不变）。id 随文字变，返回新条目
function edit(doc, id, text, pri) {
  const i = doc.lines.findIndex(x => x.item && x.item.id === id);
  if (i < 0) return null;
  const it = doc.lines[i].item;
  const t = text == null ? it.text : cleanText(text);
  if (!t) return null;
  const p = pri == null ? it.pri : normPri(pri, it.pri);
  doc.lines[i].raw = it.done ? p + '~~' + t + '~~ ✅已完成' + (it.doneAt ? ' ' + it.doneAt : '') : p + t;
  const nd = parse(render(doc));
  doc.lines = nd.lines;
  return doc.lines[i].item;
}

function remove(doc, id) {
  const i = doc.lines.findIndex(x => x.item && x.item.id === id);
  if (i < 0) return false;
  doc.lines.splice(i, 1);
  return true;
}

/* [位置:routes/jotter.js·archiveToggle] [划掉自动移入归档 / 撤回从归档移回] [11-01 #52：划掉的条目不该继续留在 00 里占 AI 的上下文——
   done=true：在 00 里标记完成（toggle 原逻辑），随后整行从 00 摘出追加进归档 doc；
   done=false 且 00 里没有这条：去归档 doc 找（id=sha1(pri|text) 两边一致），摘出还原成未完成追加回 00 末尾；
   纯函数不落盘，落盘由路由层 writeDoc/writeArch 做。返回 {it, moved:'arch'|'back'|null}，找不到返回 null] [注释时间 2026-11-01] */
function archiveToggle(doc, arch, id, want, now) {
  const inMain = doc.lines.some(x => x.item && x.item.id === id);
  if (inMain) {
    const it = toggle(doc, id, want, now);
    if (!it) return null;
    if (it.done) {
      const idx = doc.lines.findIndex(x => x.item && x.item.id === id);
      arch.lines.push(doc.lines.splice(idx, 1)[0]);
      arch.trailing = true;
      return { it: it, moved: 'arch' };
    }
    return { it: it, moved: null };
  }
  if (want === false) {
    const ai = arch.lines.findIndex(x => x.item && x.item.id === id);
    if (ai < 0) return null;
    const l2 = arch.lines.splice(ai, 1)[0];
    const it2 = l2.item;
    it2.done = false; it2.doneAt = '';
    l2.raw = it2.pri + it2.text;
    doc.lines.push(l2);
    doc.trailing = true;
    return { it: it2, moved: 'back' };
  }
  return null;
}

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;
  const FILE = deps.file || path.join(deps.baseDir, '工作流', '00用户随手记');
  const ARCH_FILE = deps.archiveFile || path.join(deps.baseDir, '工作流', '归档', '00用户随手记_已完成.md');
  const BAK_DIR = deps.backupDir || path.join(deps.baseDir, '工作流', '备份', 'jot');

  const readDoc = () => parse(fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '');
  const readArch = () => parse(fs.existsSync(ARCH_FILE) ? fs.readFileSync(ARCH_FILE, 'utf8') : '');

  /* [位置:routes/jotter.js·writeDoc/writeArch] [两个文件的原子写 + 每日首次备份] [11-01 #52：划掉会同时动 00 和归档两个文件；
     备份沿用原规矩——每天首次写前把当天原件存 工作流/备份/jot/，备份失败不挡写入] [注释时间 2026-11-01] */
  function writeDoc(doc) {
    const day = stamp().slice(0, 5);
    try {
      fs.mkdirSync(BAK_DIR, { recursive: true });
      const bak = path.join(BAK_DIR, '00用户随手记.' + new Date().getFullYear() + '-' + day + '.bak');
      if (fs.existsSync(FILE) && !fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
    } catch (e) { /* 备份失败不挡写入 */ }
    const tmp = FILE + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, render(doc), 'utf8');
    fs.renameSync(tmp, FILE);
  }
  function writeArch(doc) {
    const day = stamp().slice(0, 5);
    try {
      fs.mkdirSync(BAK_DIR, { recursive: true });
      const bak = path.join(BAK_DIR, '00用户随手记_已完成.' + new Date().getFullYear() + '-' + day + '.bak');
      if (fs.existsSync(ARCH_FILE) && !fs.existsSync(bak)) fs.copyFileSync(ARCH_FILE, bak);
    } catch (e) { /* 备份失败不挡写入 */ }
    fs.mkdirSync(path.dirname(ARCH_FILE), { recursive: true });
    const tmp = ARCH_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, render(doc), 'utf8');
    fs.renameSync(tmp, ARCH_FILE);
  }

  app.get('/admin/jotter', { preHandler: basicAuth }, async (req, reply) => {
    try { reply.send(Object.assign({ ok: true, pris: PRIS }, view(readDoc()))); }
    catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
  });
  app.post('/admin/jotter/add', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const doc = readDoc();
      const it = add(doc, b.text, b.pri);
      if (!it) return reply.code(400).send({ ok: false, msg: '写点什么再加' });
      writeDoc(doc);
      reply.send(Object.assign({ ok: true, added: it.id }, view(doc)));
    } catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
  });
  app.post('/admin/jotter/edit', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const doc = readDoc();
      if (!doc.lines.some(x => x.item && x.item.id === String(b.id || ''))) return reply.code(404).send({ ok: false, msg: '这条找不到了（文件可能刚被改过），刷新看看' });
      const it = edit(doc, String(b.id), b.text, b.pri);
      if (!it) return reply.code(400).send({ ok: false, msg: '写点什么再保存' });
      writeDoc(doc);
      reply.send(Object.assign({ ok: true, edited: it.id }, view(doc)));
    } catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
  });
  app.post('/admin/jotter/delete', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const doc = readDoc();
      if (!remove(doc, String(b.id || ''))) return reply.code(404).send({ ok: false, msg: '这条找不到了（文件可能刚被改过），刷新看看' });
      writeDoc(doc);
      reply.send(Object.assign({ ok: true }, view(doc)));
    } catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
  });

  /* [位置:routes/jotter.js·POST /admin/jotter/toggle] [划掉=移入归档，撤回=从归档移回] [11-01 #52：
     核心搬运在 archiveToggle（纯函数），这里只管读两个文件、落盘、回整表；
     moved=arch/back 时归档文件也写一份；返回的 view(doc) 里已没有划掉的条目，前端列表自然消失] [注释时间 2026-11-01] */
  app.post('/admin/jotter/toggle', { preHandler: basicAuth }, async (req, reply) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const doc = readDoc();
      const arch = readArch();
      const r = archiveToggle(doc, arch, String(b.id || ''), typeof b.done === 'boolean' ? b.done : undefined, new Date());
      if (!r) return reply.code(404).send({ ok: false, msg: '这条找不到了（文件可能刚被改过），刷新看看' });
      writeDoc(doc);
      if (r.moved) writeArch(arch);
      reply.send(Object.assign({ ok: true }, view(doc)));
    } catch (err) { reply.code(500).send({ ok: false, msg: err.message }); }
  });
};
module.exports.parse = parse;
module.exports.render = render;
module.exports.view = view;
module.exports.toggle = toggle;
module.exports.add = add;
module.exports.edit = edit;
module.exports.remove = remove;
module.exports.archiveToggle = archiveToggle;
module.exports.PRIS = PRIS;
