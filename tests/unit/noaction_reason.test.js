'use strict';
// NO_ACTION 原因提取（2026-11-11 产品确定：取消 20 字截断，原因完整保留）
// 被测：lib/phone-activity.js·noActionReasonOf（首页活动卡「没动作 · 原因」的来源）
// 2026-11-11 下午：产品确定回执整条删掉、只报失败，原因不再进回执；函数自 lib/wake-scheduler.js 原样搬到 lib/phone-activity.js，用例不变。
// 背景：原实现 `.match(/^\[NO_ACTION\]\s*(.{0,20})?/)` 只取标签后 20 字、且只到第一个换行，
//   原因被腰斩后接在用户下一条真实消息前面，看着像用户话的一部分（真实事故见下面前两条用例）。
// 运行：node --test tests/unit/noaction_reason.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { noActionReasonOf } = require('../../lib/phone-activity');
const { normalizeWakeTags } = require('../../lib/tag-actions');

// 新写法 <noaction> 经 normalizeWakeTags 转成旧写法后与原文一起传入（与搬家前的调用口径一致）
function reasonFromRawAi(rawAi) {
  return noActionReasonOf(normalizeWakeTags(rawAi), rawAi);
}

test('真实事故1：不再截 20 字，原因整句保留', () => {
  const ai = '<noaction>她睡着了。我把今天的日记写好了，不吵她，两点的闹钟还在。</noaction>';
  const r = reasonFromRawAi(ai);
  assert.equal(r, '她睡着了。我把今天的日记写好了，不吵她，两点的闹钟还在。');
  assert.ok(r.indexOf('…') < 0, '正常长度不加省略号');
  assert.ok(r.length > 20);
});

test('真实事故2：不再截 20 字，冒号后的内容也在', () => {
  const ai = '<noaction>她选了惬意和放空，正在上课。我写了开心和调皮：今天被击毙、被粘胡子又扔进海里。不打扰，等她下课。</noaction>';
  const r = reasonFromRawAi(ai);
  assert.equal(r, '她选了惬意和放空，正在上课。我写了开心和调皮：今天被击毙、被粘胡子又扔进海里。不打扰，等她下课。');
  assert.ok(r.indexOf('不打扰，等她下课') > 0, '句尾不被砍');
});

test('多行原因合并成一行（换行 → 空格，连续空白压一个）', () => {
  const r = reasonFromRawAi('<noaction>她在上课。\n\n   我先把日记写了，\n等她下课再说。</noaction>');
  assert.equal(r, '她在上课。 我先把日记写了， 等她下课再说。');
  assert.equal(r.split('\n').length, 1, '结果必须是单行（下游 phone-activity/utils/push 都是单行解析）');
});

test('标签外还写了别的东西：只取 <noaction> 标签内，旁白不算原因', () => {
  const ai = '<noaction>她睡了，不吵。</noaction>\n\n（我把手机翻过来扣在枕边，等她醒）';
  assert.equal(reasonFromRawAi(ai), '她睡了，不吵。');
  // 标签外的 push 块同样不会被卷进原因
  assert.equal(reasonFromRawAi('<noaction>她睡了。</noaction>[push]别推这个[/push]'), '她睡了。');
});

test('旧写法（AI 直接写 [NO_ACTION]，没有 <noaction> 标签）取标签后全文', () => {
  assert.equal(noActionReasonOf('[NO_ACTION] 她刚睡下，三点的闹钟还没响。', ''), '她刚睡下，三点的闹钟还没响。');
  assert.equal(noActionReasonOf('[NO_ACTION] 第一行\n第二行', null), '第一行 第二行');
});

test('CRLF 换行同样并成一行', () => {
  assert.equal(noActionReasonOf('[NO_ACTION] 第一行\r\n第二行'), '第一行 第二行');
});

test('空原因：只有标签本身返回空串（回执退化为「未发送推送」）', () => {
  assert.equal(noActionReasonOf('[NO_ACTION]'), '');
  assert.equal(noActionReasonOf('[NO_ACTION]   \n  '), '');
  assert.equal(reasonFromRawAi('<noaction>   </noaction>'), '');
  assert.equal(noActionReasonOf(''), '');
});

test('保险上限 300 字：正好 300 不截，301 才截并加省略号', () => {
  const s300 = '字'.repeat(300);
  const s301 = '字'.repeat(301);
  assert.equal(noActionReasonOf('[NO_ACTION] ' + s300), s300);
  const r301 = noActionReasonOf('[NO_ACTION] ' + s301);
  assert.equal(r301.length, 301, '300 字正文 + 省略号');
  assert.ok(r301.endsWith('…'));
  assert.equal(r301.slice(0, 300), s300);
});
