"use strict";
// MCP 工具规则模型测试（lib/mcp-rules.js）。核心：旧三件套 → 规则的等价换算，随机数据下逐工具与旧算法一致。
// 运行：node tests/mcp-rules/test_mcp_rules.js
const test = require("node:test");
const assert = require("assert");
const R = require("../../lib/mcp-rules");

const S = (id, enabled, block) => ({ id, enabled, blockTools: block || [] });

test("normalizeRules：清洗 / 非法返回 null", () => {
  assert.strictEqual(R.normalizeRules(null), null);
  assert.strictEqual(R.normalizeRules([]), null);
  const r = R.normalizeRules({ rest: "xx", servers: { a: { def: "on", except: ["t", "t", "", 5] }, b: { def: "zz" }, "": { def: "on" }, c: 3 } });
  assert.deepStrictEqual(r, { v: 1, rest: "global", servers: { a: { def: "on", except: ["t", "5"] }, b: { def: "off", except: [] } } });
  assert.strictEqual(R.normalizeRules({ rest: "off" }).rest, "off");
});

test("toolVisible：默认开 / 默认关 / 例外 / 新服务器 rest", () => {
  const rules = R.normalizeRules({ rest: "global", servers: { on1: { def: "on", except: ["bad"] }, off1: { def: "off", except: ["pick"] } } });
  assert.ok(R.toolVisible(rules, S("on1", true), "any"));
  assert.ok(!R.toolVisible(rules, S("on1", true), "bad"));
  assert.ok(!R.toolVisible(rules, S("off1", true), "any"));
  assert.ok(R.toolVisible(rules, S("off1", true), "pick"));
  assert.ok(R.toolVisible(rules, S("fresh", true), "x"), "新服务器 rest=global 且全局开着 -> 开");
  assert.ok(!R.toolVisible(rules, S("fresh", false), "x"), "新服务器全局停用 -> 关");
  assert.ok(!R.toolVisible(Object.assign({}, rules, { rest: "off" }), S("fresh", true), "x"), "rest=off 一律关");
});

test("全局 blockTools：默认开挡住，点名开（默认关 + except）放行", () => {
  const rules = R.normalizeRules({ servers: { a: { def: "on", except: [] }, b: { def: "off", except: ["blocked"] } } });
  assert.ok(!R.toolVisible(rules, S("a", true, ["blocked"]), "blocked"));
  assert.ok(R.toolVisible(rules, S("a", true, ["blocked"]), "ok"));
  assert.ok(R.toolVisible(rules, S("b", true, ["blocked"]), "blocked"));
});

test("serverNeeded：默认关且无例外不必连；默认开要连；全局停用但规则要开也要连", () => {
  const rules = R.normalizeRules({ rest: "global", servers: { a: { def: "off", except: [] }, b: { def: "off", except: ["x"] }, c: { def: "on", except: [] } } });
  assert.ok(!R.serverNeeded(rules, S("a", true)));
  assert.ok(R.serverNeeded(rules, S("b", false)));
  assert.ok(R.serverNeeded(rules, S("c", false)));
  assert.ok(R.serverNeeded(rules, S("zz", true)) && !R.serverNeeded(rules, S("zz", false)));
});

// ---- 随机等价性：upgradeFull=false 时，旧三件套换算出的规则在「已知工具」上与旧算法逐个一致，
//      而且对「以后新增的工具」的行为也一致（用一批当时不存在的新工具名验证）----
function rnd(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }
test("deriveFromLegacy(upgradeFull=false)：随机 400 组，旧新逐工具一致（含新增工具）", () => {
  const rand = rnd(7);
  for (let iter = 0; iter < 400; iter++) {
    const servers = [];
    const nS = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < nS; i++) servers.push(S("s" + i, rand() > 0.3, rand() > 0.6 ? ["t0"] : []));
    const toolsOf = (s, extra) => { const a = []; for (let k = 0; k < 6 + (extra ? 3 : 0); k++) a.push("t" + k); return a; };
    const known = {}; servers.forEach(s => known[s.id] = toolsOf(s, false));
    const exact = rand() > 0.5;
    const hasSeen = rand() > 0.3;
    const on = [], seen = [];
    servers.forEach(s => known[s.id].forEach(n => {
      const seenIt = rand() > 0.15;
      if (seenIt) seen.push(s.id + "::" + n);
      if (rand() > 0.5) on.push(s.id + "::" + n);
    }));
    const legacy = { on, seen: hasSeen ? seen : null, exact };
    const rules = R.deriveFromLegacy(legacy, servers, { upgradeFull: false, live: known });
    servers.forEach(s => toolsOf(s, true).forEach((n, idx) => {     // 前 6 个是已知，后 3 个是「以后新增」
      // 已知限制：点名开了被全局禁用的工具 + 新工具默认开 的服务器，「以后新增」的工具不再自动开（见 deriveFromLegacy）
      const conflict = !exact && hasSeen && s.enabled !== false && s.blockTools.some(b => on.indexOf(s.id + "::" + b) >= 0);
      if (conflict && idx >= 6) return;
      const a = R.legacyVisible(legacy, s, n), b = R.toolVisible(rules, s, n);
      assert.strictEqual(b, a, `iter ${iter} ${s.id}::${n} legacy=${a} rules=${b} exact=${exact} seen=${hasSeen} enabled=${s.enabled} block=${s.blockTools}`);
    }));
  }
});

test("deriveFromLegacy(upgradeFull=true)：已知工具开关不变，只多出「全开服务器的新工具自动进」", () => {
  const rand = rnd(11);
  for (let iter = 0; iter < 300; iter++) {
    const servers = [S("a", true, []), S("b", rand() > 0.5, []), S("c", true, rand() > 0.5 ? ["t1"] : [])];
    const known = {}; servers.forEach(s => known[s.id] = ["t0", "t1", "t2", "t3"]);
    const on = [], seen = [];
    servers.forEach(s => known[s.id].forEach(n => { seen.push(s.id + "::" + n); if (rand() > 0.4) on.push(s.id + "::" + n); }));
    const legacy = { on, seen, exact: true };
    const rules = R.deriveFromLegacy(legacy, servers, { upgradeFull: true });
    servers.forEach(s => known[s.id].forEach(n => assert.strictEqual(R.toolVisible(rules, s, n), R.legacyVisible(legacy, s, n), `known ${s.id}::${n}`)));
    servers.forEach(s => {
      const allOn = known[s.id].every(n => on.indexOf(s.id + "::" + n) >= 0);
      const blockedOn = known[s.id].some(n => s.blockTools.indexOf(n) >= 0 && on.indexOf(s.id + "::" + n) >= 0);
      const fresh = R.toolVisible(rules, s, "brand_new");
      assert.strictEqual(fresh, allOn && !blockedOn, `fresh ${s.id} allOn=${allOn} blockedOn=${blockedOn}`);
    });
  }
});

test("deriveFromPreset：整组全选 -> 默认开（新工具自动进、死 key 消失）；部分勾选 -> 默认关 + 点名；新服务器 rest=global", () => {
  const servers = [S("tool", true), S("gar", true), S("mail", false)];
  const p = { mcps: ["tool::a", "tool::b", "tool::dead", "gar::x"], mcp_seen: ["tool::a", "tool::b", "tool::dead", "gar::x", "gar::y", "gar::z", "mail::m1"] };
  const r = R.deriveFromPreset(p, servers, { live: { tool: ["a", "b", "c_new"], gar: ["x", "y", "z"] } });
  assert.deepStrictEqual(r.servers.tool, { def: "on", except: [] });
  assert.deepStrictEqual(r.servers.gar, { def: "off", except: ["x"] });
  assert.deepStrictEqual(r.servers.mail, { def: "off", except: [] });
  assert.strictEqual(r.rest, "global");
  assert.ok(R.toolVisible(r, servers[0], "c_new"), "工具集合新增的工具自动进");
  assert.ok(!R.toolVisible(r, servers[1], "newgar"), "花园是点名开的，新工具不进");
  assert.ok(R.toolVisible(r, S("brandnew", true), "t"), "新服务器跟全局");
});

test("deriveFromGlobal / resolveKeys", () => {
  const servers = [S("a", true), S("b", false)];
  const r = R.deriveFromGlobal(servers);
  const keys = R.resolveKeys(r, servers, { a: ["x", "y"], b: ["z"] });
  assert.deepStrictEqual(Array.from(keys).sort(), ["a::x", "a::y"]);
});
