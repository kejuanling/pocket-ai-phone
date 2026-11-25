// [位置:tests/conversation-state/test_parse_response_repair.js] [模型 JSON 标点容错回归] [2026-11-06：deepseek-flash 连出两类坏 JSON（多 ] / 多 "），整次生成作废白烧 20 多万 token；这里锁住 parseResponse 的容错边界——坏标点能救、内容截断不许假装成功、正常输出不许被动] [注释时间 2026-11-06]
// 跑法：node tests/conversation-state/test_parse_response_repair.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cs = require("../../lib/conversation-state");

const parse = cs.parseResponse;
let pass = 0;
function t(name, fn) { fn(); pass++; console.log("  ok  " + name); }

console.log("parseResponse 标点容错");

t("正常 JSON 原样通过，不标 _repaired", function () {
  const o = parse('{"state":"正常内容","ops":[{"type":"add","desc":"x"}]}');
  assert.strictEqual(o.state, "正常内容");
  assert.strictEqual(o.ops.length, 1);
  assert.ok(!o._repaired);
});

t("```json 围栏 + 前后废话", function () {
  const o = parse('好的，这里是结果：\n```json\n{"state":"a","ops":[]}\n```\n以上。');
  assert.strictEqual(o.state, "a");
  assert.ok(!o._repaired);
});

t("括号提前闭合（真实 0007 那类：desc 后多一个 ]）", function () {
  const bad = '{"state":"正文","lu_add":["a","b"],"ops":[{"type":"add","desc":"小猫按钮高度"],"reason":""}],"search":[]}';
  const o = parse(bad);
  assert.ok(o._repaired, "应走修复");
  assert.strictEqual(o.state, "正文");
  assert.strictEqual(o.ops.length, 1);
  assert.strictEqual(o.ops[0].desc, "小猫按钮高度");
  assert.strictEqual(o.ops[0].reason, "");
  assert.deepStrictEqual(o.search, []);
});

t("结构处多余引号（真实 0014 那类：数组闭合后多一个引号）", function () {
  const bad = '{"state":"正文","lu_add":["a","b"]","ops":[{"type":"update","desc":"主线"}]}';
  const o = parse(bad);
  assert.ok(o._repaired, "应走修复");
  assert.strictEqual(o.state, "正文");
  assert.deepStrictEqual(o.lu_add, ["a", "b"]);
  assert.strictEqual(o.ops[0].desc, "主线");
});

t("末尾少一个 }", function () {
  const o = parse('{"state":"正文","ops":[{"type":"add","desc":"x"}]');
  assert.ok(o._repaired);
  assert.strictEqual(o.state, "正文");
  assert.strictEqual(o.ops.length, 1);
});

t("字符串里的裸换行被转义", function () {
  const o = parse('{"state":"第一行\n第二行","ops":[]}');
  assert.ok(o._repaired);
  assert.strictEqual(o.state, "第一行\n第二行");
});

t("内容截断在字符串中 → 拒绝，不把半截正文当完整", function () {
  const raw = '{"state":"截至今天主线是给气泡页找 bug，还没有写';
  const o = parse(raw);
  assert.ok(o.error, "应报错而不是给半截状态");
  assert.ok(!o.state);
});

t("结构缺尾巴但内容完整 → 可修（只补标点）", function () {
  const o = parse('{"state":"半截}","ops":[{"type":"add","desc":"x"');
  assert.ok(o._repaired);
  assert.strictEqual(o.state, "半截}");
  assert.strictEqual(o.ops[0].desc, "x");
});

t("快照在字符串中间断掉 → 仍然拒绝", function () {
  const raw = '{"state":"正文","ops":[{"type":"add","desc":"写到一半就被掐';
  const o = parse(raw);
  assert.ok(o.error, "应报错而不是补出一个半截 desc");
  assert.ok(!o.ops);
});

t("纯文本没有 JSON 对象", function () {
  const o = parse("模型这次什么都没输出");
  assert.ok(/没找到 JSON 对象/.test(o.error || ""));
});

t("数组/标量不算结果（必须是对象）", function () {
  const o = parse("[1,2,3]");
  assert.ok(o.error);
});

// 真实失败样本（存在就验，避免历史日志被清理后测试挂）
const REAL = [
  { f: "2026-11-05T17-39-21-970Z_1485841_0007.json", minState: 3000, minOps: 1 },
  { f: "2026-11-05T19-10-11-352Z_1485841_0014.json", minState: 3000, minOps: 1 },
];
const dir = path.join(__dirname, "../../data/llm_logs/state_machine");
REAL.forEach(function (r) {
  const p = path.join(dir, r.f);
  if (!fs.existsSync(p)) { console.log("  --  跳过（样本不在）" + r.f); return; }
  t("真实坏输出修复：" + r.f.slice(0, 32), function () {
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    const raw = d.response.choices[0].message.content;
    assert.throws(function () { JSON.parse(raw); }, "样本本身应解析失败，否则样本失去意义");
    const o = parse(raw);
    assert.ok(!o.error, "应能救回：" + o.error);
    assert.ok(o._repaired, "应标 _repaired");
    assert.ok(String(o.state || "").length >= r.minState, "state 正文应完整");
    assert.ok(Array.isArray(o.ops) && o.ops.length >= r.minOps, "ops 应有内容");
    assert.ok(String(o.state).indexOf("截至") === 0, "state 开头应是正文");
  });
});

console.log("\n全部通过：" + pass + " 项");
