'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readStarredDialogLines: _read } = require('../../context/context-v2-runtime');
// 1018：条目带「时间 · 说话人」头与 --- 分隔；去重/排序断言只看正文
const body = (s) => s.split('\n').slice(1).join('\n').replace(/\n\n---$/, '');
const readStarredDialogLines = (...a) => _read(...a).map(body);

test('starred dialog deduplicates identical content across copied session files with different message ids', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starred-dialog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'timeline_data'));
  const msg = (id) => ({ id, role: 'assistant', time: '2026-10-01T10:00:00.000Z', content: '同一句标星内容' });
  const key = crypto.createHash('sha256').update('assistant\0同一句标星内容').digest('hex').slice(0, 32);
  fs.writeFileSync(path.join(dir, 'data', 'context_compaction_marks.json'), JSON.stringify({ marks: { [key]: { markedAt: '2026-10-01T10:00:00.000Z' } } }));
  fs.writeFileSync(path.join(dir, 'timeline_data', 'enhanced_messages_s_one.json'), JSON.stringify([msg('id-a')]));
  fs.writeFileSync(path.join(dir, 'timeline_data', 'enhanced_messages_s_two.json'), JSON.stringify([msg('id-b')]));
  const lines = readStarredDialogLines(dir, () => [], 0);
  assert.deepEqual(lines, ['同一句标星内容']);
});

test('prefers saved marked content, supports message-id keys, and falls back for legacy marks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starred-dialog-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'timeline_data'));
  const legacyText = '旧版标星内容';
  const legacyKey = crypto.createHash('sha256').update('user\0' + legacyText).digest('hex').slice(0, 32);
  const marks = {
    'message-id-new': { content: '从标星文件直接读取', role: 'assistant', time: '2026-10-02T10:00:00.000Z' },
    'message-id-copy': { content: '从标星文件直接读取', role: 'assistant', time: '2026-10-02T10:00:00.000Z' },
    [legacyKey]: { markedAt: '2026-10-01T10:00:00.000Z' }
  };
  fs.writeFileSync(path.join(dir, 'data', 'context_compaction_marks.json'), JSON.stringify({ marks }));
  fs.writeFileSync(path.join(dir, 'timeline_data', 'enhanced_messages_s_old.json'), JSON.stringify([
    { id: 'old-id', role: 'user', time: '2026-10-01T10:00:00.000Z', content: legacyText }
  ]));
  const lines = readStarredDialogLines(dir, () => [], 0);
  assert.deepEqual(lines, [legacyText, '从标星文件直接读取']);
});

test('starred entries carry time · speaker header and --- separator', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starred-dialog-fmt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'timeline_data'));
  const marks = { a: { content: '她说的话', role: 'user', time: '2026-10-18T09:18:51.000Z' }, b: { content: '我说的话', role: 'assistant', time: '2026-10-18T09:19:00.000Z' } };
  fs.writeFileSync(path.join(dir, 'data', 'context_compaction_marks.json'), JSON.stringify({ marks }));
  const old = { u: process.env.USER_DISPLAY_NAME, a: process.env.AI_DISPLAY_NAME, tz: process.env.TIME_ZONE };
  process.env.USER_DISPLAY_NAME = '涵'; process.env.AI_DISPLAY_NAME = '谢';
  t.after(() => { process.env.USER_DISPLAY_NAME = old.u; process.env.AI_DISPLAY_NAME = old.a; });
  const raw = _read(dir, () => [], 0);
  assert.match(raw[0], /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2} · 涵\n她说的话\n\n---$/);
  assert.match(raw[1], / · 我\n我说的话\n\n---$/);
});

test('excludes starred lines already present in the current window messages (branch/import copies)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starred-dialog-exclude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'timeline_data'));
  const marks = {
    'id-in-window': { content: '本窗口里已有的标星', role: 'assistant', time: '2026-10-01T10:00:00.000Z' },
    'id-other': { content: '别的窗口的标星', role: 'user', time: '2026-10-02T10:00:00.000Z' },
  };
  fs.writeFileSync(path.join(dir, 'data', 'context_compaction_marks.json'), JSON.stringify({ marks }));
  const exclude = [{ role: 'assistant', text: '本窗口里已有的标星' }, { role: 'user', text: '无关消息' }];
  assert.deepEqual(readStarredDialogLines(dir, () => [], 0, exclude), ['别的窗口的标星']);
  // role 不同则不算同一条
  assert.deepEqual(readStarredDialogLines(dir, () => [], 0, [{ role: 'user', text: '本窗口里已有的标星' }]), ['本窗口里已有的标星', '别的窗口的标星']);
  // 不传 exclude 行为不变
  assert.deepEqual(readStarredDialogLines(dir, () => [], 0), ['本窗口里已有的标星', '别的窗口的标星']);
});

test('marks are cleaned and time-sorted on write; injection only adds the header', (t) => {
  const { cleanDialogText, sortMarks } = require('../../lib/dialog-clean');
  assert.equal(cleanDialogText('<voice>早先的话</voice>\n\n---\n\n结尾\n\n\n\n<current_time>Tue 26-08-25 19:13:29</current_time>'), '早先的话\n\n结尾');
  const sorted = sortMarks({
    late: { content: 'b', time: '2026-08-25T11:13:29.000Z' },
    early: { content: 'a', time: '2026-07-15T15:38:00.000Z' },
    none: { content: 'c', markedAt: '2026-08-01T00:00:00.000Z' },
  });
  assert.deepEqual(Object.keys(sorted), ['early', 'none', 'late']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starred-dialog-hdr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'timeline_data'));
  fs.writeFileSync(path.join(dir, 'data', 'context_compaction_marks.json'), JSON.stringify({ marks: sorted }));
  const lines = _read(dir, () => [], 0);
  assert.match(lines[0], /^2026年7月15日 23:38 · 我\na\n\n---$/);
  assert.equal(lines.length, 3);
});
