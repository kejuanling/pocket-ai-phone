'use strict';
// [elapsed:45s] 时间差标签——纯函数回归（10-29 #49 三改：动态注入方案；2026-10-31 改算法）。
// 演进：初版动态注入 + 前 120 字内容匹配 → 匹配因落盘版带 <current_time>、发模型版被剥必失败
// → 恒显示 1s；二改落盘标注（污染消息数据：前端要藏、编辑框可见、检索命中）→ 产品确定回退动态注入。
// 现版：发送出口注入 '\n[elapsed:2h]' 独立一行；按位置跳本轮（注入时本轮已落盘，末尾第一条
// 真实 user 就是本轮，重新生成=触发消息本身），复合单位 45s/1min30s/2h5min/3d2h。
// 2026-10-31：间隔改成「本轮她这条消息」与「它之前那条真实消息（通常是 AI 回复）」两条的
// time 相减——原来用 Date.now() 减上一条 user 消息，会把 AI 自己回话的耗时也算进间隔。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const chatRoutes = require('../../routes/chat.js');
const { elapsedFmt, findPrevMsgTime, injectElapsed } = chatRoutes._elapsed;

const HOUR = 3600e3;
const MIN = 60e3;
const now = Date.now();
const iso = function (ms) { return new Date(ms).toISOString(); };
const real = function () { return true; };
// 生产口径 = isRealMessageForTimeline：只认 user/assistant（developer 唤醒块/回执、system、特殊事件都不算）
const onlyReal = function (m) { return m && (m.role === 'user' || m.role === 'assistant'); };

// ---- findPrevMsgTime：取本轮 user 与它前一条真实消息两条的 time ----

test('上一条是 AI 回复：间隔=本轮消息与 AI 回复的时间差（不再含 AI 回话耗时）', function () {
  const tl = [
    { role: 'system', content: '人设' },
    { role: 'user', content: '早上在干嘛 <current_time>…</current_time>', time: iso(now - 3 * HOUR) },
    { role: 'assistant', content: '在浇花呀', time: iso(now - 3 * HOUR + 40e3) },   // AI 隔了 40s 才回
    { role: 'user', content: '吃饭了吗 <current_time>…</current_time>\n<session>…</session>', time: iso(now) }
  ];
  const r = findPrevMsgTime(tl, onlyReal);
  assert.equal(r.curMs, now);
  assert.equal(r.prevMs, now - 3 * HOUR + 40e3);
});

test('连发两条 user（中间 AI 没回）：照实取前一条 user', function () {
  const tl = [
    { role: 'user', content: '在吗', time: iso(now - 30e3) },
    { role: 'user', content: '看这个', time: iso(now) }
  ];
  assert.deepEqual(findPrevMsgTime(tl, onlyReal), { curMs: now, prevMs: now - 30e3 });
});

test('重新生成：本轮=触发消息，前一条真实消息是它的上一轮 AI 回复（尾部旧回复不参与）', function () {
  const tl = [
    { role: 'user', content: '第一条', time: iso(now - 5 * HOUR) },
    { role: 'assistant', content: '回复一', time: iso(now - 5 * HOUR + 20e3) },
    { role: 'user', content: '触发消息', time: iso(now - HOUR) },
    { role: 'assistant', content: '旧回复', time: iso(now - HOUR + 15e3) }
  ];
  assert.deepEqual(findPrevMsgTime(tl, onlyReal), { curMs: now - HOUR, prevMs: now - 5 * HOUR + 20e3 });
});

test('AI 主动唤醒发的消息也算「上一条」；developer 唤醒块/回执跳过', function () {
  const tl = [
    { role: 'user', content: '睡了吗', time: iso(now - 2 * HOUR) },
    { role: 'assistant', content: '还没', time: iso(now - 2 * HOUR + 10e3) },
    { role: 'developer', content: '系统自动唤醒…', time: iso(now - 40 * MIN) },
    { role: 'assistant', content: '醒着，突然想到你', time: iso(now - 39 * MIN) },
    { role: 'developer', content: '发送成功，时间：…', time: iso(now - 39 * MIN) },
    { role: 'user', content: '我在', time: iso(now) }
  ];
  assert.deepEqual(findPrevMsgTime(tl, onlyReal), { curMs: now, prevMs: now - 39 * MIN });
});

test('会话第一条：往前没了 → prevMs null（不加标签）', function () {
  const r = findPrevMsgTime([{ role: 'user', content: '你好', time: iso(now) }], onlyReal);
  assert.equal(r.curMs, now);
  assert.equal(r.prevMs, null);
});

test('特殊事件（isReal 过滤）不算「上一条」；老数据无 time → null', function () {
  const tl = [
    { role: 'user', content: '真消息', time: iso(now - 2 * HOUR) },
    { role: 'assistant', content: '真回复', time: iso(now - 2 * HOUR + 5e3) },
    { role: 'user', content: '记忆浮现块', hidden: true, time: iso(now - HOUR) },
    { role: 'user', content: '本轮', time: iso(now) }
  ];
  const isReal = function (m) { return !m.hidden; };
  assert.deepEqual(findPrevMsgTime(tl, isReal), { curMs: now, prevMs: now - 2 * HOUR + 5e3 });
  assert.equal(findPrevMsgTime([{ role: 'user', content: '无时间' }], real).prevMs, null);
  // 本轮无 time：curMs null，交给 injectElapsed 用当前时间兜底
  assert.equal(findPrevMsgTime([{ role: 'assistant', content: 'R', time: iso(now - MIN) }, { role: 'user', content: '本轮' }], real).curMs, null);
});

// ---- injectElapsed：开关/边界/形态 ----

function envOf(on, tl) {
  return { resolve: function () { return on; }, loadTimeline: function () { return tl; }, isReal: onlyReal };
}

test('正常注入：string 独立一行复合单位 tag，不改时间线原对象', function () {
  const tl = [
    { role: 'user', content: '上一轮', time: iso(now - 4 * MIN) },
    { role: 'assistant', content: '回复', time: iso(now - 90e3) },
    { role: 'user', content: '本轮 <current_time>…</current_time>', time: iso(now) }
  ];
  const msgs = [{ role: 'user', content: '本轮 <current_time>…</current_time>' }];
  injectElapsed('s1', msgs, envOf(true, tl));
  assert.equal(msgs[0].content, '本轮 <current_time>…</current_time>\n[elapsed:1min30s]');
  assert.equal(tl[2].content.indexOf('[elapsed'), -1);   // 时间线原文不污染
});

test('开关关 / 首条消息 / 空 msgs：都不注入', function () {
  const tlOnlyCur = [{ role: 'user', content: '本轮', time: iso(now) }];
  const m1 = [{ role: 'user', content: 'x' }];
  injectElapsed('s1', m1, envOf(false, tlOnlyCur));
  assert.equal(m1[0].content, 'x');
  const m2 = [{ role: 'user', content: 'x' }];
  injectElapsed('s1', m2, envOf(true, tlOnlyCur));
  assert.equal(m2[0].content, 'x');
  injectElapsed('s1', [], envOf(true, tlOnlyCur));   // 不抛错
});

test('parts 形态：tag 加到最后一个 text part，原对象不动', function () {
  const tl = [
    { role: 'assistant', content: '上一轮的回复', time: iso(now - MIN) },
    { role: 'user', content: '本轮', time: iso(now) }
  ];
  const msgs = [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: '/uploads/x.jpg' } }] }];
  injectElapsed('s1', msgs, envOf(true, tl));
  assert.equal(msgs[0].content[0].text, '看图\n[elapsed:1min]');
  assert.equal(msgs[0].content[1].type, 'image_url');
});

test('gap<=0 / 负间隔不注入', function () {
  const tl = [
    { role: 'assistant', content: '回复时间在未来（时钟偏差）', time: iso(now + 5000) },
    { role: 'user', content: '本轮', time: iso(now) }
  ];
  const msgs = [{ role: 'user', content: '本轮' }];
  injectElapsed('s1', msgs, envOf(true, tl));
  assert.equal(msgs[0].content, '本轮');
});

// ---- elapsedFmt：复合单位 ----

test('elapsedFmt 复合单位边界', function () {
  assert.equal(elapsedFmt(999), '1s');
  assert.equal(elapsedFmt(59 * 1000), '59s');
  assert.equal(elapsedFmt(60 * 1000), '1min');
  assert.equal(elapsedFmt(90 * 1000), '1min30s');
  assert.equal(elapsedFmt(59 * MIN + 30 * 1000), '59min30s');
  assert.equal(elapsedFmt(60 * MIN), '1h');
  assert.equal(elapsedFmt(2 * HOUR + 3 * MIN), '2h3min');
  assert.equal(elapsedFmt(24 * HOUR), '1d');
  assert.equal(elapsedFmt(3 * 24 * HOUR + 2 * HOUR), '3d2h');
});
