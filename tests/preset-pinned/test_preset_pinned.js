"use strict";

const assert = require("assert");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const presetPinned = require("../../lib/preset-pinned");
const { createSessionCfg } = require("../../lib/session-cfg");
const shadow = require("../../context/context-v2-shadow");
const runtime = require("../../context/context-v2-runtime");

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "preset-pinned-test-"));
  const dataDir = path.join(base, "data");
  fs.ensureDirSync(dataDir);

  // Seed global pinned.json + map
  fs.writeJsonSync(path.join(dataDir, "pinned.json"), [
    { id: "g1", title: "全局规则", content: "GLOBAL_ONLY_CONTENT", order: 0 },
  ]);
  fs.writeJsonSync(path.join(dataDir, "context_v2_pinned_map.json"), {
    version: 1,
    entries: [{ pinnedId: "g1", target: "instructions" }],
  });

  // 1. Preset CRUD + dedup + reorder + clone + removeScope
  assert.deepStrictEqual(presetPinned.list(base, "sp_work"), []);
  const m1 = await presetPinned.add(base, "sp_work", { title: "代码规范", content: "WORK_RULE_1" });
  const m2 = await presetPinned.add(base, "sp_work", { title: "测试规范", content: "WORK_RULE_2" });
  const dup = await presetPinned.add(base, "sp_work", { title: "重复", content: "WORK_RULE_1" });
  assert.ok(m1 && m1.id);
  assert.ok(m2 && m2.id);
  assert.strictEqual(dup, null, "duplicate content should be rejected");
  assert.strictEqual(presetPinned.list(base, "sp_work").length, 2);

  await presetPinned.update(base, "sp_work", m1.id, { title: "代码规范v2", content: "WORK_RULE_1_V2" });
  assert.strictEqual(presetPinned.list(base, "sp_work")[0].title, "代码规范v2");

  await presetPinned.reorder(base, "sp_work", [m2.id, m1.id]);
  assert.strictEqual(presetPinned.list(base, "sp_work")[0].id, m2.id);

  // Clone into another preset
  const cloned = await presetPinned.clone(base, "sp_work", "sp_work_copy");
  assert.strictEqual(cloned.length, 2);
  assert.notStrictEqual(cloned[0].id, m2.id, "cloned entries must get fresh UUIDs");
  assert.strictEqual(presetPinned.counts(base).sp_work, 2);
  assert.strictEqual(presetPinned.counts(base).sp_work_copy, 2);

  // Remove entry from copy does not affect original
  await presetPinned.remove(base, "sp_work_copy", cloned[0].id);
  assert.strictEqual(presetPinned.list(base, "sp_work_copy").length, 1);
  assert.strictEqual(presetPinned.list(base, "sp_work").length, 2);

  // Remove scope
  assert.strictEqual(await presetPinned.removeScope(base, "sp_work_copy"), true);
  assert.deepStrictEqual(presetPinned.list(base, "sp_work_copy"), []);

  // 2. Session-cfg & shadow.readPinnedEntries isolation
  const scfg = createSessionCfg(base);
  scfg.savePinnedScope("s_global", { scope: "", enabled: null });
  scfg.savePinnedScope("s_work_on", { scope: "preset:sp_work", enabled: true });
  scfg.savePinnedScope("s_work_off", { scope: "preset:sp_work", enabled: false });
  scfg.savePinnedScope("s_empty_on", { scope: "preset:sp_empty", enabled: true });

  const rGlobal = shadow.readPinnedEntries(dataDir, { baseDir: base, sessionId: "s_global" });
  assert.strictEqual(rGlobal.pinnedEntries.length, 1);
  assert.strictEqual(rGlobal.pinnedEntries[0].content, "GLOBAL_ONLY_CONTENT");

  const rWorkOn = shadow.readPinnedEntries(dataDir, { baseDir: base, sessionId: "s_work_on" });
  assert.strictEqual(rWorkOn.pinnedEntries.length, 2);
  assert.strictEqual(rWorkOn.pinnedEntries[0].content, "WORK_RULE_2");

  const rWorkOff = shadow.readPinnedEntries(dataDir, { baseDir: base, sessionId: "s_work_off" });
  assert.strictEqual(rWorkOff.pinnedEntries.length, 0, "disabled switch must return empty");

  const rEmptyOn = shadow.readPinnedEntries(dataDir, { baseDir: base, sessionId: "s_empty_on" });
  assert.strictEqual(rEmptyOn.pinnedEntries.length, 0, "empty preset must NOT fall back to global");

  // 3. Runtime crossOff decoupling
  scfg.saveSessionCrossInjectOverride("s_work_on", false);
  scfg.saveSessionCrossInjectOverride("s_work_off", false);
  scfg.saveSessionCrossInjectOverride("s_global", false);

  const baseMsgs = [
    { role: "system", content: "SYS_PROMPT" },
    { role: "user", content: "hello" },
  ];

  const outWorkOn = await runtime.assembleAndApply({
    baseDir: base,
    sessionId: "s_work_on",
    messages: baseMsgs.map(m => Object.assign({}, m)),
    loadTimeline: () => [],
    normalizeContentToText: s => String(s || ""),
  });
  const textWorkOn = outWorkOn.messages.map(m => String(m.content || "")).join("\n");
  assert.ok(textWorkOn.includes("WORK_RULE_2"), "crossOff=true + preset perm_on=true MUST inject preset pinned");
  assert.ok(!textWorkOn.includes("GLOBAL_ONLY_CONTENT"), "must NEVER leak global pinned");

  const outWorkOff = await runtime.assembleAndApply({
    baseDir: base,
    sessionId: "s_work_off",
    messages: baseMsgs.map(m => Object.assign({}, m)),
    loadTimeline: () => [],
    normalizeContentToText: s => String(s || ""),
  });
  const textWorkOff = outWorkOff.messages.map(m => String(m.content || "")).join("\n");
  assert.ok(!textWorkOff.includes("WORK_RULE_2"), "perm_on=false must NOT inject preset pinned");

  const outGlobalOff = await runtime.assembleAndApply({
    baseDir: base,
    sessionId: "s_global",
    messages: baseMsgs.map(m => Object.assign({}, m)),
    loadTimeline: () => [],
    normalizeContentToText: s => String(s || ""),
  });
  const textGlobalOff = outGlobalOff.messages.map(m => String(m.content || "")).join("\n");
  assert.ok(!textGlobalOff.includes("GLOBAL_ONLY_CONTENT"), "global session with crossOff=true preserves legacy behavior");

  fs.removeSync(base);
  console.log("ALL PRESET PINNED TESTS PASSED");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
