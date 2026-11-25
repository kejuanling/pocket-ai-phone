'use strict';
// lib/tag-parser.js·stripForDisplay（2026-11-15）：展示口径纯文本，列表预览与搜索索引共用。
//   要求：<suggest>/<title>/<status>/思考/日记这类标签内容不进索引与摘要；人话保留，卡片/文件/图片落占位。
// 跑法：node --test tests/tag-parser/test_strip_for_display.js
const test = require('node:test');
const assert = require('node:assert/strict');
const tagParser = require('../../lib/tag-parser');

const S = t => tagParser.stripForDisplay(t);

test('标题/状态标签整段不进索引（此前会残留「已完成」这类字）', () => {
  assert.equal(S('<title>已完成</title>今天去跑步了'), '今天去跑步了');
  assert.equal(S('<status>进行中</status>下午两点开始'), '下午两点开始');
  assert.equal(S('<title>只有标题</title>'), '', '纯标题消息剥完为空，应当被索引跳过');
});

test('<suggest> 推荐回复不进索引', () => {
  assert.equal(S('<suggest>1. 好的\n2. 不用了</suggest>那就这样'), '那就这样');
  assert.equal(S('<suggest>1. 好的</suggest>'), '');
});

test('思考链与日记块不进索引', () => {
  assert.equal(S('<thinking>先想一下</thinking>答案在这'), '答案在这');
  assert.equal(S('<think>内心戏</think>正文'), '正文');
  assert.equal(S('[DIARY]\n今天的事\n[/DIARY]睡前想起你'), '睡前想起你');
});

test('卡片/文件/图片/语音：人话保留，内容落占位', () => {
  assert.equal(S('<card>{"title":"天气","items":[1]}</card>看这个'), '[卡片] 看这个');
  assert.equal(S('<file name="a.txt">整份文件内容</file>发你了'), '[文件] 发你了');
  assert.equal(S('<voice>语音说的是这句</voice>'), '语音说的是这句');
  assert.equal(S('![截图](http://x/y.png)你看'), '[图片] 你看');
});

test('card_reply：新格式保留人话，内嵌 JSON 与自闭合丢掉（口径同 phone-tags.js·cardReplyView）', () => {
  assert.equal(S('<card_reply>答案是四十二</card_reply>'), '答案是四十二');
  assert.equal(S('<card_reply>{"answer":"四十二"}</card_reply>'), '');
  assert.equal(S('<card_reply/>'), '');
});

test('markdown 装饰与多余空白压平（索引/摘要都用得上的纯文本）', () => {
  assert.equal(S('**重点**\n\n  两句话  \n 说完'), '重点 两句话 说完');
  assert.equal(S(''), '');
  assert.equal(S(null), '');
  assert.equal(S(undefined), '');
});
