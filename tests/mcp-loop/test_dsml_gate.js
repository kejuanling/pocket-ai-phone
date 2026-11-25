"use strict";
// DSML 泄漏闸（2026-11-04）：最后一轮 tool_choice=none 时模型把工具调用写成 <｜｜DSML｜｜calls> 文本，不能当正文。
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDsmlGate, stripDsml } = require("../../mcp/mcp-tool-loop");

function run(parts) { const g = makeDsmlGate(); let out = ""; parts.forEach((p) => { out += g.push(p); }); out += g.flush(); return { out, leaked: g.leaked }; }

test("正常文字原样通过", () => {
  const r = run(["先看一下", "现场。", "好了"]);
  assert.equal(r.out, "先看一下现场。好了"); assert.equal(r.leaked, false);
});
test("整段标记：标记及之后丢掉，前面保留", () => {
  const r = run(["按测试规矩搭会话：\n\n<｜｜DSML｜｜calls>\n<｜｜DSML｜｜invoke name=\"run_command\">xx"]);
  assert.equal(r.out, "按测试规矩搭会话："); assert.equal(r.leaked, true);
});
test("标记被切在两帧中间也认得出", () => {
  const r = run(["先探一下：<", "｜", "｜DS", "ML｜｜calls>", "后面的全丢"]);
  assert.equal(r.out, "先探一下："); assert.equal(r.leaked, true);
});
test("普通的 < 号不误伤，尾部扣住的在 flush 放出", () => {
  const r = run(["比较 a <", " b 的大小，写成 <div>"]);
  assert.equal(r.out, "比较 a < b 的大小，写成 <div>"); assert.equal(r.leaked, false);
});
test("半角竖线写法也认", () => {
  assert.equal(run(["好的<|DSML|calls>x"]).out, "好的");
  assert.equal(run(["好的<｜invoke name=\"run_cmd\">"]).out, "好的");
  assert.equal(run(["好的<|parameter name=\"arg\">"]).out, "好的");
});
test("普通轮关闸：正文里引用标记是讲解，不腰斩（2026-11-14 复盘新增）", () => {
  const g = makeDsmlGate(); g.setActive(false);
  let out = "";
  out += g.push("讲解格式：`<｜DSML｜tool_calls>` 就长这样");
  out += g.push("孤立标签 `<｜invoke name=\"x\">` 也是讲解");
  out += g.flush();
  assert.equal(out, "讲解格式：`<｜DSML｜tool_calls>` 就长这样孤立标签 `<｜invoke name=\"x\">` 也是讲解");
  assert.equal(g.leaked, false);
});
test("闸开着时孤立 invoke 与闭合标记也砍", () => {
  assert.equal(run(["结论：<｜invoke name=\"run\">x"]).out, "结论：");
  assert.equal(run(["结论：</｜DSML｜invoke>尾巴"]).out, "结论：");
});
test("stripDsml：非流式整段处理", () => {
  assert.equal(stripDsml("汇报如下。<｜｜DSML｜｜calls>…"), "汇报如下。");
  assert.equal(stripDsml("没有标记"), "没有标记");
  assert.equal(stripDsml(null), "");
});
