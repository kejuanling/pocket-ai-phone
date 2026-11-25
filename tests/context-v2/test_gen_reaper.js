"use strict";
// 生成快照回收者（1021）测试：续租补全 + 回收模式 + 不误杀深度思考
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
let pass = 0, fail = 0;
function ok(name, fn) { try { fn(); console.log("PASS " + name); pass++; } catch (e) { console.log("FAIL " + name + "\n  " + e.message); fail++; } }

// 从真实源码里抽出 sweepStaleGenerations，在隔离环境里执行（不启动整个 server）
function loadSweep(activeGenMap, env) {
  const m = SRC.match(/function sweepStaleGenerations\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, "server.js 里找得到 sweepStaleGenerations");
  const logs = [];
  const fn = new Function("activeGenMap", "process", "console", "ACTIVE_GEN_TTL_MS", m[0] + "\nreturn sweepStaleGenerations;")(   // 11-04：sweep 里已用 ACTIVE_GEN_TTL_MS 清过旧快照，沙箱要补这个常量
    activeGenMap, { env }, { warn: (x) => logs.push(x), log: () => {} }, 10 * 60 * 1000);
  return { fn, logs };
}
const NOW = Date.now();
const gen = (idleSec, extra) => Object.assign({ text: "", reasoning: "", tools: [], ts: NOW - idleSec * 1000, startedAt: NOW - 200000, done: false }, extra || {});

ok("源码：四类事件都续租（reasoning/tool_start/tool_args_delta/tool_end）", () => {
  const seg = SRC.slice(SRC.indexOf("const onEvent = (evt) =>"), SRC.indexOf("let r;\n    // 2026-09-09"));
  for (const t of ["reasoning", "tool_start", "tool_args_delta", "tool_end", "text"]) {
    const i = seg.indexOf('evt.type === "' + t + '"');
    assert.ok(i >= 0, t + " 分支存在");
    const next = seg.indexOf("} else if (evt.type", i + 10);
    const body = seg.slice(i, next > 0 ? next : seg.length);
    assert.ok(/_ag\.ts = Date\.now\(\)/.test(body), t + " 分支刷新 ts");
  }
});

ok("源码：四处快照创建点都带 startedAt", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "..", "routes", "chat.js"), "utf8");
  assert.strictEqual((SRC.match(/startedAt: Date\.now\(\)/g) || []).length, 3, "server.js 三处");
  assert.strictEqual((chat.match(/startedAt: Date\.now\(\)/g) || []).length, 1, "chat.js 一处");
});

ok("源码：状态接口回传 started_at 与 aborted", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "..", "routes", "chat.js"), "utf8");
  // 1021：started_at 改走 _startedAt 局部量（同一个值，同时供 elapsed_ms 用）
  assert.ok(/aborted: !!ag\.aborted/.test(chat) && /started_at: _startedAt/.test(chat));
});

ok("源码：状态接口带显式 phase 枚举（客户端不再从副作用反推）", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "..", "routes", "chat.js"), "utf8");
  assert.ok(/phase: _phase/.test(chat), "主返回带 phase");
  assert.ok(/_phase = ag\.done \? \(ag\.error \? "failed" : ag\.aborted \? "aborted" : "done"\)/.test(chat), "done/aborted/failed 读时推导，不依赖各收尾路径回写");
  assert.strictEqual((chat.match(/phase: "idle"/g) || []).length, 4, "四条空快照返回都带 idle");
  assert.ok(/tool: \(_running\[0\] && _running\[0\]\.name\)/.test(chat), "回传正在跑的工具名");
  assert.ok((SRC.match(/markGenFailed\(/g) || []).length >= 2, "上抛点都要标失败（11-04：随着空闲中断/failover 分支增加，调用点从 2 个变成 5 个，只要求至少覆盖原来两处）");
  assert.ok(/elapsed_ms: Math\.max\(0, Date\.now\(\) - _startedAt\)/.test(chat), "回传已耗时");
});

ok("源码：两条生成路径都推进 phase", () => {
  const chat = fs.readFileSync(path.join(__dirname, "..", "..", "routes", "chat.js"), "utf8");
  assert.ok(/_ag\.text \+= clean;[\s\S]{0,900}_ag\.phase = "writing"/.test(SRC), "server.js 正文分支");
  assert.ok(/_ag\.phase = "tool"; _ag\.phaseAt/.test(SRC), "server.js 工具分支");
  assert.ok(/_ag\.phase !== "writing" && _ag\.phase !== "tool"[\s\S]{0,60}_ag\.phase = "reasoning"/.test(SRC), "server.js 思考分支不降级");
  assert.ok(/_partialGen\.text \+= cleanText;[\s\S]{0,80}_partialGen\.phase = "writing"/.test(chat), "chat.js 正文分支");
  assert.ok(/if \(!_partialGen\.text\) \{ _partialGen\.phase = "reasoning"/.test(chat), "chat.js 思考分支只在无正文时生效");
});

ok("reap 模式：过期(>45s)的被标 done+aborted+stale，新鲜的不动", () => {
  const m = new Map([["old", gen(90)], ["fresh", gen(10)]]);
  const { fn } = loadSweep(m, { GEN_REAPER_MODE: "reap" });
  assert.strictEqual(fn(), 1);
  assert.strictEqual(m.get("old").done, true); assert.strictEqual(m.get("old").aborted, true); assert.strictEqual(m.get("old").abortReason, "stale");
  assert.strictEqual(m.get("fresh").done, false); assert.ok(!m.get("fresh").aborted);
});

ok("dry 模式（默认）：只记日志、不改任何状态，同一快照只记一次", () => {
  const m = new Map([["old", gen(90)]]);
  const { fn, logs } = loadSweep(m, {});
  fn(); fn(); fn();
  assert.strictEqual(m.get("old").done, false); assert.ok(!m.get("old").aborted);
  assert.strictEqual(logs.length, 1);
  assert.ok(/gen-reaper:dry/.test(logs[0]));
});

ok("off 模式：什么都不做", () => {
  const m = new Map([["old", gen(999)]]);
  const { fn, logs } = loadSweep(m, { GEN_REAPER_MODE: "off" });
  assert.strictEqual(fn(), 0); assert.strictEqual(m.get("old").done, false); assert.strictEqual(logs.length, 0);
});

ok("已完成的快照不被碰（done=true 即使很旧）", () => {
  const m = new Map([["d", gen(300, { done: true })]]);   // 300s：远超 45s 过期阈值但没到 10 分钟 TTL（再老的已完成快照 sweep 会直接清掉，见 ACTIVE_GEN_TTL_MS）
  const { fn } = loadSweep(m, { GEN_REAPER_MODE: "reap" });
  assert.strictEqual(fn(), 0); assert.ok(!m.get("d").aborted);
});

ok("深度思考不被误杀：思考中每 20s 续租一次，整个过程不会过期", () => {
  // 模拟：思考 120 秒，期间每 20 秒有 reasoning 事件续租；回收者每 10 秒扫一次
  const g = gen(0); const m = new Map([["s", g]]);
  const { fn } = loadSweep(m, { GEN_REAPER_MODE: "reap" });
  let t = NOW, reaped = false;
  const realNow = Date.now; 
  try {
    for (let sec = 0; sec <= 120; sec += 10) {
      Date.now = () => NOW + sec * 1000;
      if (sec % 20 === 0) g.ts = Date.now(); // reasoning 事件续租
      fn(); if (g.aborted) reaped = true;
    }
  } finally { Date.now = realNow; }
  assert.strictEqual(reaped, false);
});

ok("真死的会被回收：最后一次续租后 60s 没动静", () => {
  const g = gen(0); const m = new Map([["s", g]]);
  const { fn } = loadSweep(m, { GEN_REAPER_MODE: "reap" });
  const realNow = Date.now;
  try { Date.now = () => NOW + 60000; fn(); } finally { Date.now = realNow; }
  assert.strictEqual(g.aborted, true);
});

ok("GEN_REAPER_STALE_MS 可调", () => {
  const m = new Map([["x", gen(20)]]);
  const { fn } = loadSweep(m, { GEN_REAPER_MODE: "reap", GEN_REAPER_STALE_MS: "15000" });
  assert.strictEqual(fn(), 1);
});

console.log("\n" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
