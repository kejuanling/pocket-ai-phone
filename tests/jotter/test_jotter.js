'use strict';
// [位置:tests/jotter/test_jotter.js] [随手记解析/划掉/新增] [10-28 随手记] [注释时间 2026-10-28]
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const J = require('../../routes/jotter');

const real = fs.readFileSync(path.join(__dirname, '../../工作流/00用户随手记'), 'utf8');
let doc = J.parse(real);
assert.strictEqual(J.render(doc), real, '无改动时 render 必须与原文逐字节一致');
let v = J.view(doc);
assert.ok(v.head.startsWith('优先级'), '首行作为说明');
assert.ok(v.items.length >= 5 && v.items.every(i => J.PRIS.includes(i.pri)));
assert.strictEqual(new Set(v.items.map(i => i.id)).size, v.items.length, 'id 唯一');

// 划掉 → 还原
const it = v.items[0];
const raw0 = doc.lines.find(l => l.item && l.item.id === it.id).raw;
J.toggle(doc, it.id, true, new Date(2026, 9, 28, 9, 5));
let s1 = J.render(doc);
assert.ok(s1.includes(it.pri + '~~' + it.text + '~~ ✅已完成 10-28 09:05'));
doc = J.parse(s1);
assert.ok(doc.lines.find(l => l.item && l.item.id === it.id).item.done, '重新解析后仍是已完成，id 不变');
J.toggle(doc, it.id, false);
assert.strictEqual(J.render(doc), real, '取消划掉后回到原文');
assert.strictEqual(doc.lines.find(l => l.item && l.item.id === it.id).raw, raw0);

// 重复文本 id
const dup = J.parse('说明\n🔖abc\n🔖abc\n');
const ids = J.view(dup).items.map(i => i.id);
assert.strictEqual(ids.length, 2); assert.notStrictEqual(ids[0], ids[1]);
J.toggle(dup, ids[1], true);
assert.ok(dup.lines[1].raw === '🔖abc' && dup.lines[2].raw.startsWith('🔖~~abc~~'));

// 新增：追加到末尾，缺省优先级 🔖，换行压成空格，无末尾换行的文件也不粘行
const d2 = J.parse('说明\n☁️a');
const a = J.add(d2, '  新的\n一条 ', '🌱');
assert.strictEqual(a.text, '新的 一条'); assert.strictEqual(a.pri, '🌱');
assert.strictEqual(J.render(d2), '说明\n☁️a\n🌱新的 一条\n');
assert.strictEqual(J.add(d2, '   ', '🌱'), null);
assert.strictEqual(J.add(d2, 'x', 'zzz').pri, '🔖');

// 没带变体选择符的 ☁ 也认
const d3 = J.parse('☁abc\n');
assert.strictEqual(J.view(d3).items[0].pri, '☁️'); assert.strictEqual(J.view(d3).items[0].text, 'abc');

// CRLF 保持
const d4 = J.parse('说明\r\n🍃x\r\n');
J.toggle(d4, J.view(d4).items[0].id, true);
assert.ok(J.render(d4).includes('\r\n') && !/[^\r]\n/.test(J.render(d4)));

// 编辑 / 删除
const d5 = J.parse('说明\n☁️甲\n🔖~~乙~~ ✅已完成 10-27 21:00\n🍃丙\n');
const [i1, i2] = J.view(d5).items;
const e1 = J.edit(d5, i1.id, ' 甲改\n一下 ', '🌱');
assert.strictEqual(d5.lines[1].raw, '🌱甲改 一下'); assert.strictEqual(e1.text, '甲改 一下');
const e2 = J.edit(d5, i2.id, '乙改', null);
assert.strictEqual(d5.lines[2].raw, '🔖~~乙改~~ ✅已完成 10-27 21:00'); assert.ok(e2.done && e2.doneAt === '10-27 21:00');
assert.strictEqual(J.edit(d5, i2.id, '', null), null, '旧 id 已失效');
assert.strictEqual(J.edit(d5, e2.id, '   ', null), null, '空文本不改');
assert.strictEqual(J.edit(d5, e2.id, null, '🍃').pri, '🍃', '只改分类');
assert.ok(J.remove(d5, e1.id) && !J.remove(d5, e1.id));
assert.strictEqual(J.render(d5), '说明\n🍃~~乙改~~ ✅已完成 10-27 21:00\n🍃丙\n');

// 路由层：临时文件 + 假 app
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jot-'));
const f = path.join(tmp, '00');
fs.writeFileSync(f, real);
const routes = {};
const app = { get: (p, o, h) => routes['GET ' + p] = h, post: (p, o, h) => routes['POST ' + p] = h };
J(app, { basicAuth: () => {}, baseDir: tmp, file: f, archiveFile: path.join(tmp, 'arch.md'), backupDir: path.join(tmp, 'bak') });   // 归档功能加入后路由需要 archiveFile
const call = async (k, body) => { let out, code = 200; await routes[k]({ body }, { send: x => out = x, code: c => ({ send: x => { code = c; out = x; } }) }); return { code, out }; };
(async () => {
  let r = await call('GET /admin/jotter');
  assert.strictEqual(r.out.items.length, v.items.length);
  r = await call('POST /admin/jotter/toggle', { id: it.id });
  // 11-03 起「完成」= 移进归档文件（工作流/归档/00用户随手记_已完成.md），不再留在原文件里打勾
  assert.ok(!r.out.items.find(i => i.id === it.id), '完成的条目从列表消失');
  assert.ok(fs.existsSync(path.join(tmp, 'arch.md')) && fs.readFileSync(path.join(tmp, 'arch.md'), 'utf8').length > 0, '归档文件里有了');
  assert.ok(fs.readdirSync(path.join(tmp, 'bak')).length === 1, '当天首次写入前备份');
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'bak', fs.readdirSync(path.join(tmp, 'bak'))[0]), 'utf8'), real);
  fs.writeFileSync(f, real);   // 归档后复位原文，继续测下面的增删改
  r = await call('POST /admin/jotter/toggle', { id: 'nope' });
  assert.strictEqual(r.code, 404);
  r = await call('POST /admin/jotter/add', { text: '测试条目', pri: '🍃' });
  assert.ok(r.out.ok && fs.readFileSync(f, 'utf8').endsWith('🍃测试条目\n'));
  r = await call('POST /admin/jotter/add', { text: '' });
  assert.strictEqual(r.code, 400);
  r = await call('POST /admin/jotter/add', { text: '要改的', pri: '🍃' });
  r = await call('POST /admin/jotter/edit', { id: r.out.added, text: '改好了', pri: '☁️' });
  assert.ok(r.out.ok && fs.readFileSync(f, 'utf8').endsWith('☁️改好了\n'));
  assert.strictEqual((await call('POST /admin/jotter/edit', { id: 'nope', text: 'x' })).code, 404);
  assert.strictEqual((await call('POST /admin/jotter/edit', { id: r.out.edited, text: '' })).code, 400);
  r = await call('POST /admin/jotter/delete', { id: r.out.edited });
  assert.ok(r.out.ok && !fs.readFileSync(f, 'utf8').includes('改好了'));
  assert.strictEqual((await call('POST /admin/jotter/delete', { id: 'nope' })).code, 404);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('jotter: all ok');
})().catch(e => { console.error(e); process.exit(1); });
