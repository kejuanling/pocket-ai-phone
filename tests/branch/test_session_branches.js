/* [位置:tests/branch/test_session_branches.js] [会话分支父子登记 + trace_notes 会话维度单测] [11-10：lib/session-branches 的 register/read/removeChild（旧 15 条数据原样保留、非法 id 拒绝、原子写不留 tmp）、lib/trace-notes 的 msg_id+会话匹配（同 msg_id 跨会话互不影响、旧数据 session_id 为空仍可匹配）] [隔离：全部在 os.tmpdir 临时目录里跑；trace-notes 的 FILE 是模块内写死的线上库路径，测试前把源码里那一行改写成临时路径再从临时目录 require（同一份代码逻辑，不碰 data/trace_notes.json），跑完比对线上两个数据文件的 md5 未变] [注释时间 2026-11-10] */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const REAL_BRANCHES = path.join(ROOT, 'data', 'session-branches.json');
const REAL_TRACE_NOTES = path.join(ROOT, 'data', 'trace_notes.json');

function md5(p) {
  try { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); } catch (_) { return null; }
}
const beforeBranchesMd5 = md5(REAL_BRANCHES);
const beforeTraceMd5 = md5(REAL_TRACE_NOTES);

let failed = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ok  ' + msg); return; }
  console.error('  FAIL ' + msg);
  failed++;
}
function eq(a, b, msg) { ok(a === b, msg + '（实际 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b) + '）'); }
function finish() {
  const afterBranchesMd5 = md5(REAL_BRANCHES);
  const afterTraceMd5 = md5(REAL_TRACE_NOTES);
  ok(afterBranchesMd5 === beforeBranchesMd5, '线上 data/session-branches.json 未被改动');
  ok(afterTraceMd5 === beforeTraceMd5, '线上 data/trace_notes.json 未被改动');
  if (failed) { console.error('\n失败 ' + failed + ' 项（临时目录保留:' + TMP + '）'); process.exit(1); }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log('\ntest_session_branches 全部通过');
  process.exit(0);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-ut-'));
const BASE = path.join(TMP, 'base');
fs.mkdirSync(path.join(BASE, 'data'), { recursive: true });

/* ================= 1. lib/session-branches ================= */
const branches = require(path.join(ROOT, 'lib', 'session-branches.js'));
const BRANCH_FILE = path.join(BASE, 'data', 'session-branches.json');

// 用线上那份真实的 15 条旧数据当夹具（只读复制，不写线上）
if (fs.existsSync(REAL_BRANCHES)) fs.copyFileSync(REAL_BRANCHES, BRANCH_FILE);
const legacy = JSON.parse(fs.readFileSync(BRANCH_FILE, 'utf-8'));
const legacyCount = Object.keys(legacy).length;
console.log('[1] session-branches（夹具 ' + legacyCount + ' 条旧数据）');
ok(legacyCount >= 15, '夹具里有旧数据（' + legacyCount + ' 条）');

const readBack = branches.read(BASE);
eq(Object.keys(readBack).length, legacyCount, 'read() 读回全部旧条目');
const anyOldKey = Object.keys(legacy)[0];
eq(readBack[anyOldKey].fromSession, legacy[anyOldKey].fromSession, '旧条目 fromSession 原样');
eq(readBack[anyOldKey].fromIndex, legacy[anyOldKey].fromIndex, '旧条目 fromIndex 原样');
ok(!('anchorId' in readBack[anyOldKey]), '旧条目没有被凭空加上 anchorId');

// register：新增一条，旧条目一字不改
eq(branches.register(BASE, 's_child_new_1', { fromSession: 's_parent_1', fromIndex: 7 }), true, 'register 正常写入');
const afterReg = JSON.parse(fs.readFileSync(BRANCH_FILE, 'utf-8'));
eq(Object.keys(afterReg).length, legacyCount + 1, '文件条目数 +1');
let legacyIntact = true;
for (const k of Object.keys(legacy)) {
  if (JSON.stringify(afterReg[k]) !== JSON.stringify(legacy[k])) legacyIntact = false;
}
ok(legacyIntact, '旧 ' + legacyCount + ' 条数据逐条原样保留');
eq(afterReg.s_child_new_1.fromSession, 's_parent_1', '新条目 fromSession 正确');
eq(afterReg.s_child_new_1.fromIndex, 7, '新条目 fromIndex 正确');
ok(typeof afterReg.s_child_new_1.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(afterReg.s_child_new_1.createdAt), '新条目 createdAt 是 ISO 时间');
ok(!('anchorId' in afterReg.s_child_new_1), '没传 anchorId 就不写该字段');

// anchorId 有则带上
branches.register(BASE, 's_child_new_2', { fromSession: 's_parent_1', fromIndex: 3, anchorId: 'msg_abc' });
eq(JSON.parse(fs.readFileSync(BRANCH_FILE, 'utf-8')).s_child_new_2.anchorId, 'msg_abc', 'anchorId 落盘');

// 非法输入一律拒绝且不写盘
const beforeBad = md5(BRANCH_FILE);
eq(branches.register(BASE, 'bad id', { fromSession: 's_parent_1', fromIndex: 1 }), false, '子会话 id 带空格 → 拒绝');
eq(branches.register(BASE, 'a/b', { fromSession: 's_parent_1', fromIndex: 1 }), false, '子会话 id 带斜杠 → 拒绝');
eq(branches.register(BASE, '中文会话', { fromSession: 's_parent_1', fromIndex: 1 }), false, '子会话 id 中文 → 拒绝');
eq(branches.register(BASE, '', { fromSession: 's_parent_1', fromIndex: 1 }), false, '子会话 id 空 → 拒绝');
eq(branches.register(BASE, 's_x', { fromSession: 'bad id', fromIndex: 1 }), false, '父会话 id 非法 → 拒绝');
eq(branches.register(BASE, 's_x', { fromSession: 's_p', fromIndex: -1 }), false, 'fromIndex 负数 → 拒绝');
eq(branches.register(BASE, 's_x', { fromSession: 's_p', fromIndex: 1.5 }), false, 'fromIndex 小数 → 拒绝');
eq(branches.register(BASE, 's_x', { fromSession: 's_p' }), false, 'fromIndex 缺失 → 拒绝');
eq(md5(BRANCH_FILE), beforeBad, '非法输入没改文件');

// removeChild
eq(branches.removeChild(BASE, 's_child_new_2'), true, 'removeChild 删掉已登记项');
eq(branches.removeChild(BASE, 's_child_new_2'), false, 'removeChild 再删 → false');
eq(branches.removeChild(BASE, 'bad id'), false, 'removeChild 非法 id → false');
const afterRm = JSON.parse(fs.readFileSync(BRANCH_FILE, 'utf-8'));
ok(!('s_child_new_2' in afterRm), '文件里已无该条目');
eq(Object.keys(afterRm).length, legacyCount + 1, '删一条后条目数正确');
ok(Object.keys(afterRm).every((k) => k === 's_child_new_1' ? true : JSON.stringify(afterRm[k]) === JSON.stringify(legacy[k])), '删除没伤到旧条目');

// 原子写：目录里不留 tmp 文件
const leftovers = fs.readdirSync(path.join(BASE, 'data')).filter((f) => f.indexOf('.tmp-') >= 0);
eq(leftovers.length, 0, '原子写没有残留 tmp 文件');

// 坏文件 / 文件不存在 → 空表且不抛
const CASE_DIR = path.join(TMP, 'broken');
fs.mkdirSync(path.join(CASE_DIR, 'data'), { recursive: true });
eq(Object.keys(branches.read(CASE_DIR)).length, 0, '文件不存在 → 空表');
fs.writeFileSync(path.join(CASE_DIR, 'data', 'session-branches.json'), '{不是 json', 'utf-8');
eq(Object.keys(branches.read(CASE_DIR)).length, 0, '坏 json → 空表不抛');
fs.writeFileSync(path.join(CASE_DIR, 'data', 'session-branches.json'), '[1,2,3]', 'utf-8');
eq(Object.keys(branches.read(CASE_DIR)).length, 0, '数组格式 → 空表不抛');
branches.register(CASE_DIR, 's_from_broken', { fromSession: 's_p', fromIndex: 0 });
eq(JSON.parse(fs.readFileSync(path.join(CASE_DIR, 'data', 'session-branches.json'), 'utf-8')).s_from_broken.fromSession, 's_p', '坏文件后 register 能重建正常文件');

/* ================= 2. lib/trace-notes（FILE 改写到临时目录后 require） ================= */
console.log('[2] trace-notes 会话维度');
const TN_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'trace-notes.js'), 'utf-8');
const TMP_TN_FILE = path.join(TMP, 'trace_notes_ut.json');
const patched = TN_SRC.replace(/const FILE = [^\n]*;/, 'const FILE = ' + JSON.stringify(TMP_TN_FILE) + ';');
ok(patched !== TN_SRC, '源码里的 FILE 行已改写成临时路径（改不动就说明模块结构变了，测试必须停）');
if (patched === TN_SRC) { console.error('无法把 trace-notes 的 FILE 指向临时目录，停止（避免污染线上库）'); process.exit(1); }
const TMP_TN_MOD = path.join(TMP, 'trace-notes-under-test.js');
fs.writeFileSync(TMP_TN_MOD, patched, 'utf-8');
const tn = require(TMP_TN_MOD);
eq(tn.FILE, TMP_TN_FILE, '被测模块指向临时文件');
ok(tn.FILE.indexOf(os.tmpdir()) === 0, '被测模块的文件路径在 tmpdir 里');

// 同一 msg_id 落在两个会话里（分支复制的真实场景）
const a1 = tn.add({ content: '父会话的味道', session_id: 's_parent', msg_id: 'm_dup' });
const b1 = tn.add({ content: '分支会话的味道', session_id: 's_child', msg_id: 'm_dup' });
ok(a1 && a1.id, '父会话那条写入成功');
ok(b1 && b1.id, '同 msg_id 不同会话也写入成功（互不影响）');
eq(tn.list().length, 2, '两条都在库里');
eq(tn.add({ content: '再来一条', session_id: 's_child', msg_id: 'm_dup' }), null, '同会话同 msg_id 重复 add → 幂等忽略');
eq(tn.list().length, 2, '幂等后仍是两条');

// upsert 只动本会话那条
const up1 = tn.upsertByMsgId({ content: '分支里改过的味道', session_id: 's_child', msg_id: 'm_dup', at: '2026-11-10T00:00:00Z' });
eq(up1 && up1.id, b1.id, 'upsert 命中的是分支会话那条');
eq(up1.content, '分支里改过的味道', '内容已更新');
const parentItem = tn.list().find((x) => x.id === a1.id);
eq(parentItem.content, '父会话的味道', '父会话那条内容没被改');
eq(tn.list().length, 2, 'upsert 没新增条目');

// remove 只删本会话那条
eq(tn.removeByMsgId('m_dup', 's_child'), 1, 'removeByMsgId(带 sessionId) 只删 1 条');
eq(tn.list().length, 1, '父会话那条还在');
eq(tn.list()[0].id, a1.id, '剩下的是父会话那条');
eq(tn.removeByMsgId('m_dup', 's_child'), 0, '重复删 → 0');
eq(tn.removeByMsgId('m_dup', 's_parent'), 1, '父会话那条也能按会话删');
eq(tn.list().length, 0, '删干净');

// 旧数据兼容：session_id 为空/缺失
const legacy1 = tn.add({ content: '10 月的老记录', msg_id: 'm_legacy' });   // 没有 session_id
ok(legacy1 && legacy1.session_id === null, '旧式记录 session_id 落成 null');
eq(tn.add({ content: '另一个会话又写同一 msg_id', session_id: 's_any', msg_id: 'm_legacy' }), null, '旧数据任一边为空 → 仍按 msg_id 去重（旧口径不丢）');
const upLegacy = tn.upsertByMsgId({ content: '编辑后', session_id: 's_any', msg_id: 'm_legacy' });
eq(upLegacy && upLegacy.id, legacy1.id, '旧数据（session_id 空）能被 upsert 命中');
eq(upLegacy.session_id, 's_any', '命中后顺手补上会话 id');
eq(tn.list().length, 1, '旧数据路径没有多出条目');
// 补上会话后：别的会话再 upsert 同 msg_id → 不覆盖原来那条（会话维度生效）
const otherSess = tn.upsertByMsgId({ content: '别的会话的同一 msg_id', session_id: 's_other', msg_id: 'm_legacy' });
ok(otherSess && otherSess.id !== legacy1.id, '会话不同的 upsert 不覆盖原记录');
eq(tn.list().length, 2, '会话不同的 upsert 建了新条目');
// 空 sessionId（旧调用方）仍按旧口径命中已有条目，不新增
const emptySess = tn.upsertByMsgId({ content: '旧口径改一次', msg_id: 'm_legacy' });
ok(emptySess && (emptySess.id === legacy1.id || emptySess.id === otherSess.id), '不传 sessionId → 按旧口径命中已有条目');
eq(tn.list().length, 2, '空会话 upsert 没新增条目');

// 不带 sessionId 的 remove 保持旧行为（按 msg_id 全删）
const beforeAll = tn.list().length;
tn.add({ content: 'x', session_id: 's_a', msg_id: 'm_all' });
tn.add({ content: 'y', session_id: 's_b', msg_id: 'm_all' });
eq(tn.list().length, beforeAll + 2, '两个会话各写一条同 msg_id 都在库里');
eq(tn.removeByMsgId('m_all'), 2, '不带 sessionId → 按 msg_id 全删（旧调用方行为不变）');
eq(tn.list().length, beforeAll, '删完回到原条目数');
eq(tn.removeByMsgId(''), 0, '空 msg_id → 0');

// 编辑到另一个会话不该误伤：s_a 有 m_x，编辑 s_b 的 m_x → 不命中 s_a，新增一条
tn.add({ content: '甲的这句话', session_id: 's_a2', msg_id: 'm_x' });
const crossUp = tn.upsertByMsgId({ content: '乙的这句话', session_id: 's_b2', msg_id: 'm_x' });
ok(crossUp && crossUp.session_id === 's_b2', '跨会话 upsert 新建了乙的条目');
eq(tn.list().filter((x) => x.msg_id === 'm_x').length, 2, '两条 m_x 各自独立');

finish();
