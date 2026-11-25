'use strict';
// 1018 跨窗口注入定稿：上一个会话（聊天请求记录）/ 建好即固定的块 / 快照删除前补登记
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createChatRequestLog } = require('../../lib/chat-request-log');
const frozen = require('../../lib/frozen-blocks');
const sv2 = require('../../context/context-snapshot-v2');

function tmpBase(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  fs.mkdirSync(path.join(dir, 'data'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('chat request log: newest first, excludes self and missing sessions, keeps 20', (t) => {
  const dir = tmpBase(t, 'reqlog-');
  fs.writeFileSync(path.join(dir, 'data', 'conversation_state.json'), JSON.stringify({ s_a: { version: 3, record_id: 'r', text: 'x' } }));
  const log = createChatRequestLog(dir);
  log.record('s_a', 10);
  log.record('s_gone', 2);
  log.record('s_new', 0);
  assert.equal(log.read()[0].session, 's_new');
  assert.equal(log.read()[2].state_version, 3);
  // 新会话自己排除；时间线已不存在的排除
  const c = log.latestExcept('s_new', (sid) => sid !== 's_gone');
  assert.equal(c.session, 's_a');
  for (let i = 0; i < 30; i++) log.record('s_' + i, i);
  assert.equal(log.read().length, 20);
});

// 1018 修订：冻结的是「哪几篇/哪几条」（成员），不是文字
function writeJson(dir, rel, obj) { fs.writeFileSync(path.join(dir, rel), JSON.stringify(obj)); }

test('frozen members: diaries — new ones never enter, edits show up, hidden ones drop out', (t) => {
  const dir = tmpBase(t, 'frozen-diary-');
  writeJson(dir, 'data/diary.json', { version: 1, next_id: 3, entries: [
    { id: 1, content: '日记一', created_at: '2026-10-01T00:00:00Z' },
    { id: 2, content: '日记二', created_at: '2026-10-02T00:00:00Z' }] });
  const want = new Set(['conversation_continuity']);
  const { buildContextBlocks } = require('../../context/context-v2-builder');
  const inputOf = () => ({ diaryEntries: require('../../lib/diary-store').listEntries(dir).filter(e => !e.hidden), config: { diaryCount: 5 } });
  let input = inputOf();
  let cap = frozen.prepareInput(dir, 's', input, want, {});
  let built = buildContextBlocks(input);
  cap.diaryIds = built.members.conversation_continuity;
  frozen.finalize(dir, 's', built.blocks, want, cap, false);
  assert.deepEqual(frozen.load(dir, 's').members.conversation_continuity, [1, 2]);
  // 之后：改了日记二、隐藏日记一、又写了日记三
  writeJson(dir, 'data/diary.json', { version: 1, next_id: 4, entries: [
    { id: 1, content: '日记一', hidden: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 2, content: '日记二（改过）', created_at: '2026-10-02T00:00:00Z' },
    { id: 3, content: '日记三', created_at: '2026-10-03T00:00:00Z' }] });
  input = inputOf();
  cap = frozen.prepareInput(dir, 's', input, want, {});
  built = buildContextBlocks(input);
  const blk = frozen.finalize(dir, 's', built.blocks, want, cap, false).find(b => b.key === 'conversation_continuity');
  assert.equal(blk.content, '## Earlier Days\n' + require('../../context/context-v2-builder').BLOCK_DESCS.conversation_continuity + '\n日记二（改过）');   // 11-03 起大标题下带一句英文说明
});

test('frozen members: starred — edited text used, unstarred removed, new stars excluded', (t) => {
  const dir = tmpBase(t, 'frozen-star-');
  writeJson(dir, 'data/context_compaction_marks.json', { marks: {
    a: { content: '第一句', role: 'user', time: '2026-10-01T00:00:00Z' },
    b: { content: '第二句', role: 'assistant', time: '2026-10-02T00:00:00Z' } } });
  const want = new Set(['starred_dialog']);
  let input = {};
  let cap = frozen.prepareInput(dir, 's', input, want, {});
  assert.deepEqual(cap.starredKeys, ['a', 'b']);
  frozen.finalize(dir, 's', [{ key: 'starred_dialog', content: 'x', empty: false }], want, cap, false);
  writeJson(dir, 'data/context_compaction_marks.json', { marks: {
    a: { content: '第一句（改过）', role: 'user', time: '2026-10-01T00:00:00Z' },
    c: { content: '新标星', role: 'user', time: '2026-10-03T00:00:00Z' } } });
  input = {};
  frozen.prepareInput(dir, 's', input, want, {});
  assert.equal(input.starredLines.length, 1);
  assert.match(input.starredLines[0], /第一句（改过）/);
});

test('frozen members: seed derives members from frozen text; branches copy members', (t) => {
  const dir = tmpBase(t, 'frozen-seed-');
  writeJson(dir, 'data/context_compaction_marks.json', { marks: { k1: { content: '保留的话', role: 'user' }, k2: { content: '别的', role: 'user' } } });
  frozen.seedFromSnapshot(dir, 'p', { fixed_blocks: [
    { key: 'starred_dialog', content: '## Starred Dialog\n保留的话' },
    { key: 'notebook_index', content: '## Notebook Index\n分类：随笔 2 篇\n2 篇（id｜标题｜分类｜更新日期）：\n7｜标题甲｜随笔｜2026-10-01\n9｜标题乙｜随笔｜2026-10-02' },
    { key: 'core_identity', content: 'c' }] });
  const st = frozen.load(dir, 'p');
  assert.deepEqual(st.members.starred_dialog, ['k1']);
  // 1022 笔记本目录不再冻结（FROZEN_KEYS 只剩日记/标星）：目录块不登记成员（原断言 10-18 旧行为，1022 起必挂）
  assert.equal(st.members.notebook_index, undefined);
  assert.equal(frozen.copy(dir, 'p', 'child'), true);
  assert.deepEqual(frozen.load(dir, 'child').members.starred_dialog, ['k1']);
});

test('deleting or overwriting a snapshot seeds frozen blocks first', (t) => {
  const dir = tmpBase(t, 'frozen-snap-');
  sv2.mergeInjectBlocks(dir, 's2', [{ key: 'conversation_continuity', content: '日记旧' }], { selected: ['conversation_continuity'] });
  assert.deepEqual(sv2.loadSnapshot(dir, 's2').inject_meta.selected, ['conversation_continuity']);
  // 状态机重建：不含注入块的新内容覆盖快照 → 之前的日记块已登记
  sv2.saveSnapshot(dir, 's2', { v: 3, content: [], snap_point: 0 });
  // 推不出成员（没有日记库）→ 文字兜底登记
  assert.equal(frozen.load(dir, 's2').legacy.conversation_continuity, '日记旧');
  sv2.mergeInjectBlocks(dir, 's3', [{ key: 'starred_dialog', content: '星' }], {});
  sv2.deleteSnapshot(dir, 's3');
  assert.equal(frozen.load(dir, 's3').legacy.starred_dialog, '星');
});
