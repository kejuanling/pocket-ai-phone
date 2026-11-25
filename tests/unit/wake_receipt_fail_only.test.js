'use strict';
// 唤醒回执只报失败（2026-11-11 拍板：回执没用，整条删掉，除非失败说一句）
// 被测：
//   lib/wake-scheduler.js·buildWakeReceipt      —— 回执拼装：成功不写，失败才写
//   utils/push.js·pushEchoMeta + routes/push-events.js·extractPushItems —— 推送管理改读 assistant 消息的 push 对象
//   lib/phone-activity.js·receiptsOfTimeline    —— 首页活动卡改从 assistant 消息取「没动作 · 原因」
// 运行：node --test tests/unit/wake_receipt_fail_only.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWakeReceipt } = require('../../lib/wake-scheduler');
const { pushEchoMeta } = require('../../utils/push');
const { extractPushItems } = require('../../routes/push-events');
const { receiptsOfTimeline } = require('../../lib/phone-activity');

const WAKE = '这是一次系统唤醒，当前时间：2026-11-11 06:46。';
const iso = function (s) { return new Date(Date.parse('2026-11-11T00:00:00.000Z') + s * 1000).toISOString(); };
const PUSH = { at: '2026-11-11 08:00', user: '涵', channel: 'WebPush', title: '', body: '醒了吗', session: 's1', session_name: '主会话' };

test('回执：成功的事一律不写', () => {
  assert.equal(buildWakeReceipt({}), '');
  assert.equal(buildWakeReceipt(), '');
  assert.equal(buildWakeReceipt({ pushFail: '', diaryTagError: false, wakeSetFail: '' }), '');
});

test('回执：三种失败各一句，多项用句号连接', () => {
  assert.equal(buildWakeReceipt({ pushFail: 'WebPush：订阅已失效' }), '发送失败：WebPush：订阅已失效');
  assert.equal(buildWakeReceipt({ diaryTagError: true }), '日记写入失败：标签解析错误');
  assert.equal(buildWakeReceipt({ wakeSetFail: '时间已过' }), '唤醒设置失败：时间已过');
  assert.equal(buildWakeReceipt({ wakeSetFail: '时间格式无效' }), '唤醒设置失败：时间格式无效');
  assert.equal(buildWakeReceipt({ pushFail: 'WebPush：x', diaryTagError: true, wakeSetFail: '时间已过' }),
    '发送失败：WebPush：x。日记写入失败：标签解析错误。唤醒设置失败：时间已过');
});

test('推送记录：新推送（没有回执）由 assistant 的 push 对象出条目，不带 AI 原话', () => {
  const tl = [
    { role: 'developer', content: WAKE, time: iso(0), position: 1 },
    { role: 'assistant', content: '<push>醒了吗</push>\n（我把窗帘拉开一点）', push: PUSH, time: iso(5), position: 2 },
  ];
  const items = extractPushItems(tl, 's1');
  assert.equal(items.length, 1);
  assert.equal(items[0].position, 2);
  assert.equal(items[0].body, '醒了吗');
  assert.equal(items[0].at, '2026-11-11 08:00');
  assert.equal(items[0].channel, 'webpush', '渠道名统一小写，前端按 webpush 认');
  assert.equal(items[0].sent, true);
  assert.equal(items[0].content, '', '不把 AI 的整条回复带出去');
  assert.equal(items[0].session_id, 's1');
});

test('推送记录：旧数据（回执 + push 对象两份）只出回执那一条，位置不变', () => {
  const tl = [
    { role: 'assistant', content: '[push]醒了吗[/push]', push: PUSH, time: iso(5), position: 2 },
    { role: 'developer', content: '发送成功，时间：2026-11-11 08:00', time: iso(5), position: 3 },
  ];
  const items = extractPushItems(tl, 's1');
  assert.equal(items.length, 1);
  assert.equal(items[0].position, 3, '仍是回执那条');
  assert.equal(items[0].body, '醒了吗', '正文照旧从同刻 assistant 的 push 标签补');
});

test('推送记录：旧回执被删过，push 对象不能让它复活', () => {
  const tl = [
    { role: 'assistant', content: '[push]醒了吗[/push]', push: PUSH, time: iso(5), position: 2 },
    { role: 'developer', content: '发送成功，时间：2026-11-11 08:00', time: iso(5), position: 3, deleted: true },
  ];
  assert.equal(extractPushItems(tl, 's1').length, 0);
});

test('推送记录：在推送管理里删过（push.deleted）不再列出；AI 那条消息本身没被删', () => {
  const msg = { role: 'assistant', content: '<push>醒了吗</push>', push: Object.assign({}, PUSH, { deleted: true }), time: iso(5), position: 2 };
  assert.equal(pushEchoMeta(msg), null);
  assert.equal(extractPushItems([msg], 's1').length, 0);
  assert.ok(!msg.deleted);
});

test('推送记录：user 消息带 push 字段不认；旧结构化字段优先', () => {
  assert.equal(pushEchoMeta({ role: 'user', content: '在吗', push: PUSH }), null);
  const m = pushEchoMeta({ role: 'assistant', content: 'x', push: PUSH, push_title: '旧', push_body: '旧正文', position: 9 });
  assert.equal(m.body, '旧正文');
  assert.notEqual(m.source, 'push');
});

test('活动卡：没有回执也能拿到「没动作」的原因（取到第一个句号）', () => {
  const tl = [
    { role: 'user', content: '晚安', time: iso(0) },
    { role: 'developer', content: WAKE, time: iso(100) },
    { role: 'assistant', kind: 'noaction', content: '<active her_murmurs="yes"/>\n<noaction>她睡着了，晚安是她先说的。别的不吵她。</noaction>\n\n<trace>盒子里是什么我不猜。</trace>', time: iso(160) },
    { role: 'user', content: '下午好呀', time: iso(9000) },
    { role: 'assistant', content: '（蹭到你手边）', time: iso(9010) },
  ];
  const r = receiptsOfTimeline(tl, 's1');
  assert.equal(r.length, 1, '聊天里的普通回复不算唤醒结果');
  assert.equal(r[0].noaction, '她睡着了，晚安是她先说的');
  assert.equal(r[0].time, iso(160), '时间取唤醒产出那条（前端按完成时刻对号）');
  assert.equal(r[0].session, 's1');
});

test('活动卡：旧写法 [NO_ACTION]、日记、推送都能从 assistant 消息派生', () => {
  const tl = [
    { role: 'developer', content: WAKE, time: iso(0) },
    { role: 'assistant', kind: 'noaction', content: '<wake>60</wake>\n[NO_ACTION] 原因：她在上课。等下课。', time: iso(10) },
    { role: 'developer', content: WAKE, time: iso(1000) },
    { role: 'assistant', kind: 'diary', diary_id: 141, content: '[DIARY]今天……[/DIARY]', time: iso(1050) },
    { role: 'assistant', content: '<push>醒了吗</push>', push: PUSH, time: iso(1050) },
    { role: 'developer', content: WAKE, time: iso(2000) },
    { role: 'assistant', content: '（看了一眼，没什么要说的）', time: iso(2010) },
  ];
  const r = receiptsOfTimeline(tl, 's1');
  assert.equal(r.length, 2, '什么信息都没有的那一轮不出条目');
  assert.equal(r[0].noaction, '她在上课');
  assert.deepEqual([r[1].diary, r[1].diaryId, r[1].pushS], [true, '141', '2026-11-11 08:00']);
});

test('活动卡：旧数据（同一轮既有 assistant 又有回执）合成一条，失败回执照认', () => {
  const tl = [
    { role: 'developer', content: WAKE, time: iso(0) },
    { role: 'assistant', kind: 'noaction', content: '<noaction>她睡着了。我把今天的日记写好了，不吵她。</noaction>', time: iso(10) },
    { role: 'developer', content: '未发送推送：她睡着了。我把今天的日记写好了，不吵她，。日记写入成功，id：140', time: iso(10) },
    { role: 'developer', content: WAKE, time: iso(1000) },
    { role: 'assistant', content: '<push>醒了吗</push>', time: iso(1010) },
    { role: 'developer', content: '发送失败：WebPush：订阅已失效。唤醒设置失败：时间已过', time: iso(1010) },
  ];
  const r = receiptsOfTimeline(tl, 's1');
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].noaction, r[0].diary, r[0].diaryId], ['她睡着了', true, '140']);
  assert.equal(r[1].pushU, 'WebPush：订阅已失效');
});

test('活动卡：trace 在前、没打 kind 的旧唤醒也能取到原因；代码块里的不算', () => {
  const tl = [
    { role: 'developer', content: WAKE, time: iso(0) },
    { role: 'assistant', content: '<trace>她 01:54 之后手机静了。</trace>\n\n<noaction>她睡着了，日记和心情已记好，等闹钟再来结算。</noaction>', time: iso(20) },
    { role: 'developer', content: WAKE, time: iso(100) },
    { role: 'assistant', content: '写法：\n```\n<noaction>讲解用</noaction>\n```\n她醒了，这句话要说。', time: iso(110) },
  ];
  const r = receiptsOfTimeline(tl, 's1');
  assert.equal(r.length, 1, '代码块里的讲解字样不算静默，这一轮不出条目');
  assert.equal(r[0].noaction, '她睡着了，日记和心情已记好，等闹钟再来结算');
});

test('活动卡：不在任何唤醒轮里的旧回执单独成条（更早的数据）', () => {
  const r = receiptsOfTimeline([{ role: 'developer', content: '本次未推送。日记写入成功，id：7', time: iso(3) }], 's1');
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].diary, r[0].diaryId, r[0].pushNo], [true, '7', true]);
});
