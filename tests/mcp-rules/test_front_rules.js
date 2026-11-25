"use strict";
// 前端规则模块 workspace/phone-mcprules.js 与后端 lib/mcp-rules.js 的对照：同一份规则、同一批工具，显示状态必须与服务端实际开关一致；
// 以及「改一个开关只改例外、不动别的」「整组开关」「新建/旧预设换算」。运行：node tests/mcp-rules/test_front_rules.js
const test = require("node:test");
const assert = require("assert");
global.window = global;
global.PH = {};
const MR = require("../../workspace/phone-mcprules.js");
const R = require("../../lib/mcp-rules");

function rnd(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function mk(rand) {
  const servers = [], back = [];
  const nS = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < nS; i++) {
    const en = rand() > 0.3, block = rand() > 0.6 ? ["t1"] : [];
    const names = ["t0", "t1", "t2", "t3", "t4"].slice(0, 2 + Math.floor(rand() * 4));
    servers.push({ id: "s" + i, enabled_global: en, probed: true, tools: names.map((n, k) => ({ key: "s" + i + "::" + n, name: n, dis: rand() > 0.9 && k === 0, blocked: block.indexOf(n) >= 0 })) });
    back.push({ id: "s" + i, enabled: en, blockTools: block });
  }
  return { servers, back };
}
function randRules(rand, servers) {
  const r = { v: 1, rest: rand() > 0.5 ? "global" : "off", servers: {} };
  servers.forEach(s => { if (rand() > 0.25) r.servers[s.id] = { def: rand() > 0.5 ? "on" : "off", except: s.tools.filter(() => rand() > 0.6).map(t => t.name) }; });
  return r;
}

test("前端 toolOn 与后端 toolVisible 逐工具一致（随机 500 组）", () => {
  const rand = rnd(5);
  for (let it = 0; it < 500; it++) {
    const { servers, back } = mk(rand), rules = R.normalizeRules(randRules(rand, servers));
    servers.forEach((s, i) => s.tools.forEach(t => {
      if (t.dis) return;
      assert.strictEqual(MR.toolOn(rules, s, t), R.toolVisible(rules, back[i], t.name), `${s.id}::${t.name}`);
    }));
  }
});

test("setTool：改一个只动例外，其它工具状态不变；结果与后端一致（随机 500 组）", () => {
  const rand = rnd(9);
  for (let it = 0; it < 500; it++) {
    const { servers, back } = mk(rand), rules = R.normalizeRules(randRules(rand, servers));
    const si = Math.floor(rand() * servers.length), s = servers[si], live = s.tools.filter(t => !t.dis);
    if (!live.length) continue;
    const t = live[Math.floor(rand() * live.length)], want = rand() > 0.5;
    // 被全局禁用、且服务器是「默认开」时点名开，会改成默认关 + 点名；这是设计内的表示变化，开关状态仍要对
    const next = R.normalizeRules(MR.setTool(rules, s, t, want));
    live.forEach(x => {
      const before = MR.toolOn(rules, s, x), after = MR.toolOn(next, s, x);
      if (x.name === t.name) assert.strictEqual(after, !!want && !(x.blocked && false), `target ${x.name}`);
      else assert.strictEqual(after, before, `other ${x.name} should not change`);
      assert.strictEqual(after, R.toolVisible(next, back[si], x.name), `front/back agree ${x.name}`);
    });
    servers.forEach((o, i) => { if (i !== si) o.tools.forEach(x => { if (!x.dis) assert.strictEqual(MR.toolOn(next, o, x), MR.toolOn(rules, o, x), "other server untouched"); }); });
  }
});

test("setServer / count / fromGlobal / prune", () => {
  const servers = [{ id: "a", enabled_global: true, probed: true, tools: [{ name: "x", key: "a::x" }, { name: "y", key: "a::y", dis: true }] }, { id: "b", enabled_global: false, probed: true, tools: [{ name: "z", key: "b::z" }] }];
  let r = MR.fromGlobal(servers);
  assert.deepStrictEqual(MR.count(r, servers[0]), { n: 1, tot: 2 });
  assert.deepStrictEqual(MR.count(r, servers[1]), { n: 0, tot: 1 });
  r = MR.setServer(r, servers[1], true);
  assert.strictEqual(r.servers.b.def, "on");
  assert.deepStrictEqual(MR.count(r, servers[1]), { n: 1, tot: 1 });
  r = MR.setTool(r, servers[0], servers[0].tools[0], false);
  assert.deepStrictEqual(r.servers.a, { def: "on", except: ["x"] });
  r.servers.a.except.push("ghost");
  assert.deepStrictEqual(MR.prune(r, servers).servers.a.except, ["x"]);
});

test("fromPreset 与后端 deriveFromPreset 同口径", () => {
  const frontSv = [{ id: "tool", enabled_global: true }, { id: "gar", enabled_global: true }, { id: "mail", enabled_global: false }];
  const p = { mcps: ["tool::a", "tool::b", "gar::x"], mcp_seen: ["tool::a", "tool::b", "gar::x", "gar::y", "mail::m"] };
  const f = MR.fromPreset(p, frontSv);
  const b = R.deriveFromPreset(p, frontSv.map(s => ({ id: s.id, enabled: s.enabled_global, blockTools: [] })));
  assert.deepStrictEqual(f.servers, b.servers);
});
