// [位置:tests/conversation-state/test_compaction_log_clear.js] [清空本会话日志的归属判定与过滤] [2026-11-06：状态机页底部「清空日志」只清本会话，不能碰别的会话和后台任务；判定规则是「带 session 精确匹配，旧条目回退 label 尾号」，边界多（同尾号、旧格式、pending、后台任务）——用真实日志跑一遍锁住] [注释时间 2026-11-06]
// 跑法：node tests/conversation-state/test_compaction_log_clear.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const m = require("../../lib/compaction-log-match");

let pass = 0;
const SKIP = Symbol("skip");
/* [2026-11-15] 支持「依赖线上数据、拿不到就跳过」的用例：返回 SKIP 的记 -- 不记 ok、不计数，
   否则会出现「先打印跳过、再打一条 ok」的矛盾输出。 */
function t(name, fn) {
  if (fn() === SKIP) { console.log("  --  " + name + "（跳过）"); return; }
  pass++; console.log("  ok  " + name);
}

console.log("清空本会话日志");

t("新条目：session 精确匹配", function () {
  const l = { session: "s_mw3ogxdn_w6mkza", label: "状态并入 · 别人的", status: "success" };
  assert.strictEqual(m.belongsTo(l, "s_mw3ogxdn_w6mkza"), true);
  assert.strictEqual(m.belongsTo(l, "s_mw3ogxdn_xxxxxx"), false);
});

t("旧条目（无 session）：按 label 尾号匹配", function () {
  const l = { label: "状态并入 · ogxdn_w6mkza", status: "success" };
  assert.strictEqual(m.belongsTo(l, "s_mw3ogxdn_w6mkza"), true);
  assert.strictEqual(m.belongsTo(l, "s_mw3other_6mkza"), false);
});

t("旧条目：label 里写全 id 也认", function () {
  const l = { label: "状态并入 · s_mw3ogxdn_w6mkza", status: "success" };
  assert.strictEqual(m.belongsTo(l, "s_mw3ogxdn_w6mkza"), true);
});

t("后台任务不归任何会话", function () {
  const l = { label: "后台任务", action: "system", status: "success", message: "[memory-summary] 调度已启动" };
  assert.strictEqual(m.belongsTo(l, "s_mw3ogxdn_w6mkza"), false);
  assert.strictEqual(m.belongsTo(l, "s_mw3hoonm_1cczbp"), false);
});

t("session 为空不做任何匹配", function () {
  assert.strictEqual(m.belongsTo({ session: "s_x" }, ""), false);
  assert.strictEqual(m.belongsTo(null, "s_x"), false);
});

t("pending 判定", function () {
  assert.strictEqual(m.isRunning({ status: "pending" }), true);
  assert.strictEqual(m.isRunning({ status: "running" }), true);
  assert.strictEqual(m.isRunning({ status: "success" }), false);
  assert.strictEqual(m.isRunning({ status: "error" }), false);
});

t("只清本会话：别的会话、后台任务、正在算的都留着", function () {
  const logs = [
    { id: "a1", session: "s_A", label: "状态并入 · A", status: "success" },
    { id: "a2", label: "状态并入 · s_A_tail", status: "success" },           // 旧格式同会话
    { id: "a3", session: "s_A", label: "状态并入 · A", status: "pending" },  // 正在算，留着
    { id: "b1", session: "s_B", label: "状态并入 · B", status: "error" },
    { id: "b2", label: "状态并入 · s_B_tail", status: "success" },
    { id: "sys1", label: "后台任务", action: "system", status: "success" },
  ];
  const r = m.clearSession(logs, "s_A");
  assert.strictEqual(r.removed, 2, "应删 2 条（a1、a2）");
  assert.strictEqual(r.kept, 1, "pending 的 a3 留着");
  assert.deepStrictEqual(r.logs.map(function (x) { return x.id; }), ["a3", "b1", "b2", "sys1"]);
});

t("不改入参", function () {
  const logs = [{ id: "x", session: "s_A", status: "success" }];
  const before = JSON.stringify(logs);
  m.clearSession(logs, "s_A");
  assert.strictEqual(JSON.stringify(logs), before);
});

t("空数组 / 非数组不炸", function () {
  assert.deepStrictEqual(m.clearSession([], "s_A").removed, 0);
  assert.strictEqual(m.clearSession(null, "s_A").removed, 0);
});

// 真实日志：对每个会话算一遍，确保只命中自己的
const f = path.join(__dirname, "../../data/compaction_log.json");
if (fs.existsSync(f)) {
  t("真实日志：按会话分别清，互不串", function () {
    const all = JSON.parse(fs.readFileSync(f, "utf8"));
    const sids = Array.from(new Set(all.filter(function (l) { return l.action === "state"; })
      .map(function (l) { return l.session || String(l.label || "").replace(/^.*·\s*/, ""); })));
    /* [2026-11-15] 原来这里断言「真实日志里应有状态机条目」，日志被轮转/清理一轮就必红，属于拿线上数据当判据。
       改为：没有条目就打印跳过，有则照旧逐会话核对。 */
    if (!sids.length) return SKIP;   // 真实日志里没有 action:state 条目（可能已轮转/清理）：跳过，不拿线上数据当判据
    sids.forEach(function (raw) {
      const sid = String(raw).indexOf("s_") === 0 ? raw : "s_" + raw;
      const r = m.clearSession(all, sid);
      const hit = all.length - r.logs.length;
      // 命中数应等于该会话自己的条目数（不做 pending 保留时）
      const own = all.filter(function (l) { return m.belongsTo(l, sid); }).length;
      assert.strictEqual(hit, own, sid + " 命中数应等于自身条目数");
      // 别的会话与后台任务必须都还在
      all.filter(function (l) { return l.action === "system"; }).forEach(function (sys) {
        assert.ok(r.logs.indexOf(sys) !== -1, "后台任务不能被清掉");
      });
    });
    console.log("     （真实日志会话：" + sids.join(" / ") + "）");
  });
} else {
  console.log("  --  跳过真实日志（文件不在）");
}

console.log("\n全部通过：" + pass + " 项");
