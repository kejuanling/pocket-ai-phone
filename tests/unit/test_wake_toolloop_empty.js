'use strict';
// 唤醒工具循环结果口径（2026-11-15，产品确定：带了工具却没拿到正文本来也算成功——AI 返回了就算成功，
// 真正的失败是调用失败）。这里守三件事：
//   1) 带工具 + 空正文 → 不判失败、不抛错，只留一条明确日志（返回 null，调用方跳过「有正文」分支）；
//   2) 无论带不带工具，都不许因此补发无工具请求（直连分支的条件由调用方的 clients.length 把住）；
//   3) 有正文（含「（模型调用了工具，但没有给出最终回复，请重试）」这类上游兜底文案）一律照常透出。
// 跑法：node --test tests/unit/test_wake_toolloop_empty.js
const test = require('node:test');
const assert = require('node:assert/strict');
const wc = require('../../routes/wake-chat');

const adopt = wc._adoptToolLoopResult;
const deps = { normalizeContentToText: c => (typeof c === 'string' ? c : String(c == null ? '' : c)) };
const CLIENTS = [{ name: 'yun' }, { name: 'ds' }];

test('带工具 + 空正文：按静默成功处理（不抛错，返回 null）', () => {
  const warns = [];
  const old = console.warn;
  console.warn = m => warns.push(String(m));
  try {
    for (const r of [{ text: '' }, { text: '   \n ' }, null, { text: undefined }, { text: 0 }, undefined]) {
      assert.equal(adopt(CLIENTS, r, deps), null, '空正文不该被当成正文: ' + JSON.stringify(r));
    }
  } finally { console.warn = old; }
  assert.ok(warns.some(w => /静默成功/.test(w) && /不再补发无工具请求/.test(w)), '要留明确日志: ' + warns.join(' | '));
});

test('无工具 + 空正文：同样返回 null（直连与否由调用方的 clients 长度决定）', () => {
  for (const r of [{ text: '' }, null, undefined]) {
    assert.equal(adopt([], r, deps), null);
  }
});

test('有正文：字段逐项透出（带工具/不带工具都一样用）', () => {
  const r = { text: '在呢', toolHistory: [{ name: 't' }], reasoning: '想过', streamTimeline: [{ a: 1 }], usage: { in: 1, out: 2 } };
  const a = adopt(CLIENTS, r, deps);
  assert.equal(a.text, '在呢');
  assert.deepEqual(a.toolHistory, [{ name: 't' }]);
  assert.equal(a.reasoning, '想过');
  assert.deepEqual(a.streamTimeline, [{ a: 1 }]);
  assert.deepEqual(a.usage, { in: 1, out: 2 });
  assert.deepEqual(adopt([], r, deps), a, '无工具但有正文，同样照用');
});

test('上游兜底文案（工具跑了没说话）算有正文，唤醒照常成功', () => {
  const notice = { text: '（模型调用了工具，但没有给出最终回复，请重试）', toolHistory: [{ name: 'diary_add' }] };
  const a = adopt(CLIENTS, notice, deps);
  assert.ok(a, '兜底文案要当正文透出（成功口径）');
  assert.equal(a.text, notice.text);
  assert.equal(a.toolHistory.length, 1);
});

test('有正文：缺省字段按原口径补默认值', () => {
  const a = adopt(CLIENTS, { text: '嗨' }, deps);
  assert.deepEqual(a.toolHistory, []);
  assert.equal(a.reasoning, '');
  assert.equal(a.streamTimeline, null);
  assert.equal(a.usage, null);
});
