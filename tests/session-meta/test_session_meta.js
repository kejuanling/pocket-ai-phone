"use strict";
// 会话标题/状态（lib/session-meta.js + tag-parser 挂点）测试。隔离：数据目录指到临时目录。
// 运行：node --test tests/session-meta/  （或直接 node 本文件）
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const meta = require("../../lib/session-meta");
const { codeMask } = require("../../lib/tag-parser");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smeta-"));
meta._setDataDir(dir);
const rd = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), "utf-8")); } catch (e) { return {}; } };
const run = (sid, text) => meta.applyFromText(sid, codeMask(text).text);

test("首次起名写入，并记下是 AI 起的", () => {
  run("s1", "好的。<title>修复页面卡顿</title>");
  assert.strictEqual(rd("session-names.json").s1, "修复页面卡顿");
  assert.strictEqual(rd("session_title_ai.json").s1, "修复页面卡顿");
});
test("第二次可以覆盖（用户没动过）", () => {
  run("s1", "<title>页面卡顿已修好</title>");
  assert.strictEqual(rd("session-names.json").s1, "页面卡顿已修好");
});
test("用户手动改过名就不覆盖", () => {
  const n = rd("session-names.json"); n.s1 = "我自己起的名"; fs.writeFileSync(path.join(dir, "session-names.json"), JSON.stringify(n));
  const r = run("s1", "<title>AI 又想改</title>");
  assert.strictEqual(r.title.reason, "manual");
  assert.strictEqual(rd("session-names.json").s1, "我自己起的名");
});
test("没有 AI 记录但已有名字（老会话手动命名）也不覆盖", () => {
  const n = rd("session-names.json"); n.s2 = "老会话"; fs.writeFileSync(path.join(dir, "session-names.json"), JSON.stringify(n));
  assert.strictEqual(run("s2", "<title>新名</title>").title.reason, "manual");
});
test("标题清洗：去标签/折叠空白/截 30 字；空标题忽略", () => {
  assert.strictEqual(meta.cleanName("  a <b>b</b>\n c  "), "a b c");
  assert.strictEqual(meta.cleanName("x".repeat(50)).length, 30);
  assert.strictEqual(run("s3", "<title>   </title>").title.reason, "empty");
});
test("状态：四个合法值写入，宽松匹配，非法忽略", () => {
  run("s4", "<status>进行中</status>");
  assert.strictEqual(meta.readStatusMap().s4, "进行中");
  run("s4", "<status> 已完成 </status>");
  assert.strictEqual(meta.readStatusMap().s4, "已完成");
  run("s4", "<status>做完啦</status>");
  assert.strictEqual(meta.readStatusMap().s4, "已完成");
  assert.strictEqual(meta.normStatus("现在待反馈"), "待反馈");
});
test("一条回复多个标签取最后一个；标题和状态同时处理", () => {
  run("s5", "<title>甲</title> 中间 <title>乙</title><status>待回复</status>");
  assert.strictEqual(rd("session-names.json").s5, "乙");
  assert.strictEqual(meta.readStatusMap().s5, "待回复");
});
test("代码块/反引号里的标签不触发", () => {
  run("s6", "讲解一下：`<title>别改</title>` 和\n```\n<status>已完成</status>\n```");
  assert.strictEqual(rd("session-names.json").s6, undefined);
  assert.strictEqual(meta.readStatusMap().s6, undefined);
});
test("patchStatus：手动设置与清除", () => {
  meta.patchStatus({ s7: "待反馈", s8: "乱写" }, []);
  assert.strictEqual(meta.readStatusMap().s7, "待反馈");
  assert.strictEqual(meta.readStatusMap().s8, undefined);
  meta.patchStatus({}, ["s7"]);
  assert.strictEqual(meta.readStatusMap().s7, undefined);
});
