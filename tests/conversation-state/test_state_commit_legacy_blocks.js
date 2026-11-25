'use strict';
// tests/conversation-state/test_state_commit_legacy_blocks.js（2026-11-05 新增）
//
// 为什么要这个测试
//   2026-11-04 的清理提交 acf1666 把 context/context-replacements.js 里 24 个「无人调用」的
//   函数删了，其中 findOverlappingLegacyBlocks 其实还有调用方——retireOverlappingLegacyBlocks
//   里那一行。于是 POST /admin/conversation-state/commit 每次都抛
//   ReferenceError: findOverlappingLegacyBlocks is not defined，路由 catch 直接回 400，
//   所有会话的「确认并入」全挂，前端只显示「没并进去」。
//   旧测试 tests/conversation-state/test_state_machine.js 把 context-replacements 整体桩掉
//   （retireOverlappingLegacyBlocks 用的是测试自己写的替身），真实实现从来没被执行过 →
//   这类「真实文件里少一个函数」的错，测试永远发现不了。
//
// 这个测试的做法
//   不用桩。把 context/ lib/ utils/ 拷进临时目录，node_modules 软链，data/ 与 timeline_data/
//   全部现造，然后加载**真实的** retireOverlappingLegacyBlocks 走一次「首次并入撞存量旧块」。
//   生产 data/ 与 timeline_data/ 全程不读不写（路径全在临时目录里）。
//
// 断言三件事
//   1. 撞存量旧块的首次并入能成功（这正是 400 的那条路径）；
//   2. 相交的旧块被停用、状态记录写入（退役语义没被改坏）；
//   3. 撞到另一条 source=state 的记录时仍然拒绝（不能在「修回来」时丢掉这条保护）。

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-legacy-commit-'));

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed++; return; }
  failures.push(name + (extra ? ' :: ' + extra : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, '期望 ' + JSON.stringify(expected) + '，实得 ' + JSON.stringify(actual));
}

let cleaned = false;
function cleanupDir() {
  if (cleaned) return;
  cleaned = true;
  try { fs.rmSync(SB, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
}
process.on('exit', cleanupDir);

// ---- 沙箱：只拷代码，不拷任何数据 ----
function cpCodeDir(name) {
  fs.cpSync(path.join(ROOT, name), path.join(SB, name), {
    recursive: true,
    filter: function (src) {
      const b = path.basename(src);
      return b.indexOf('.bak') < 0;
    },
  });
}
['context', 'lib', 'utils'].forEach(cpCodeDir);
// require 从沙箱里的模块往上找 node_modules
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(SB, 'node_modules'), 'dir');
fs.mkdirSync(path.join(SB, 'data'), { recursive: true });
fs.mkdirSync(path.join(SB, 'timeline_data'), { recursive: true });

// ---- 造时间线 ----
const SID = 'test-legacy-commit-A';
const SID2 = 'test-legacy-commit-B';
const token = require(path.join(SB, 'lib', 'session-token.js')).safeSessionToken(SID);
const token2 = require(path.join(SB, 'lib', 'session-token.js')).safeSessionToken(SID2);

function mkMsgs(n, prefix) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: prefix + i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: (i % 2 === 0 ? '她：' : '我：') + ' 第' + i + '句',
      time: new Date(1767225600000 + i * 60000).toISOString(),
    });
  }
  return out;
}
const msgs = mkMsgs(20, 'L');
const msgs2 = mkMsgs(20, 'S');
function writeTimeline(tk, list) {
  fs.writeFileSync(path.join(SB, 'timeline_data', 'enhanced_messages_' + tk + '.json'), JSON.stringify(list), 'utf8');
}
writeTimeline(token, msgs);
writeTimeline(token2, msgs2);

// ---- 造存量旧块（9.8MB 那张表在真实环境里；这里只放两条测试记录） ----
const items = [
  {
    id: 'legacy-block-L',
    created_at: '2026-10-01T00:00:00.000Z',
    source: 'manual',
    session: SID,
    matched: [msgs[3], msgs[8]],
    range: { start_index: 3, end_index: 8 },
    range_label: '2026-10-01 00:03 ~ 2026-10-01 00:08',
    count: 6,
    enabled: true,
    removed: false,
    text: '存量旧摘要',
    memory: '存量旧摘要',
  },
  {
    // 另一条状态记录：撞上它必须拒绝（一个会话只该有一条状态链）
    id: 'state-block-S',
    created_at: '2026-10-01T00:00:00.000Z',
    source: 'state',
    session: SID2,
    matched: [msgs2[0], msgs2[3]],
    range: { start_index: 0, end_index: 3 },
    range_label: '2026-10-01 00:00 ~ 2026-10-01 00:03',
    count: 4,
    enabled: true,
    removed: false,
    text: '另一条状态链',
    memory: '另一条状态链',
  },
];
const itemsFile = path.join(SB, 'data', 'context_replacements.json');
fs.writeFileSync(itemsFile, JSON.stringify(items), 'utf8');
fs.writeFileSync(path.join(SB, 'data', 'conversation_state.json'), '{}', 'utf8');
fs.writeFileSync(path.join(SB, 'data', 'conversation_state_versions.json'), '{}', 'utf8');
fs.writeFileSync(path.join(SB, 'data', 'conversation_state_candidate.json'), '{}', 'utf8');

// ---- 加载真实模块 ----
process.env.CONVERSATION_STATE_DIR = path.join(SB, 'data');
const cr = require(path.join(SB, 'context', 'context-replacements.js'));
const cs = require(path.join(SB, 'lib', 'conversation-state.js'));
// 生产里是 server.js 的 onRequest 钩子设活跃会话，这里手工摆成同样的状态
cr.setActiveSession(SID);

function readItemsFromDisk() {
  return JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
}

// ================= 1. 首次并入，区间撞上存量旧块 =================
// 这就是 23:37 / 23:44 那五次 400 的路径：没有它，commitMerge 在校验阶段就 ReferenceError。
let r = null;
let threw = null;
try {
  r = cs.commitMerge({
    session: SID,
    state: '第一版工作状态：在排查状态并入报 400。',
    ops: [{ type: 'add', desc: '新增一条' }],
    start_msg: msgs[0],
    end_msg: msgs[11],
    range_label: '2026-10-01 00:00 ~ 2026-10-01 00:11',
    label_start: '2026-10-01 00:00',
    label_end: '2026-10-01 00:11',
    count: 12,
    source: 'manual',
  });
} catch (e) {
  threw = e;
}
check('撞存量旧块的首次并入不抛异常', !threw, threw && threw.message);
check('撞存量旧块的首次并入成功', r && r.ok === true, r && JSON.stringify({ ok: r.ok, error: r.error }));
eq('并入后 version=1', r && r.version, 1);
eq('覆盖起点=第0条', r && r.cover && r.cover.start_id, 'L0');
eq('覆盖终点=第11条', r && r.cover && r.cover.end_id, 'L11');

// 退役语义：相交的旧块停用（数据不删），状态记录写进同一张表
const after = readItemsFromDisk();
const legacy = after.find(function (x) { return x && x.id === 'legacy-block-L'; });
check('相交的存量旧块已停用', legacy && legacy.enabled === false, legacy && String(legacy.enabled));
check('旧块正文没被删', legacy && legacy.text === '存量旧摘要', legacy && legacy.text);
const stateRec = after.find(function (x) { return x && x.id === 'ctxrep_state_' + SID; });
check('状态记录已写入', !!stateRec);
check('状态记录来源=state', stateRec && stateRec.source === 'state', stateRec && stateRec.source);

// ================= 2. 撞另一条状态记录：必须拒绝，且不替它停用 =================
cr.setActiveSession(SID2);
let r2 = null;
try {
  r2 = cs.commitMerge({
    session: SID2,
    state: '不该成功的一版',
    ops: [],
    start_msg: msgs2[0],
    end_msg: msgs2[10],
  });
} catch (e) {
  r2 = { ok: false, error: 'throws: ' + e.message };
}
check('与另一条状态记录相交时被拒', r2 && r2.ok === false, r2 && JSON.stringify({ ok: r2.ok, error: r2.error }));
check('拒绝理由点明状态链分叉', /状态记录重叠|分叉/.test((r2 && r2.error) || ''), r2 && r2.error);
const after2 = readItemsFromDisk();
const other = after2.find(function (x) { return x && x.id === 'state-block-S'; });
check('另一条状态记录未被替它停用', other && other.enabled === true, other && String(other.enabled));
eq('被拒的会话没有产生状态', cs.getState(SID2).exists, false);

cleanupDir();

console.log('\n通过 ' + passed + ' 项');
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项：');
  failures.forEach(function (f) { console.log('  ✗ ' + f); });
  process.exit(1);
}
console.log('全部通过');
