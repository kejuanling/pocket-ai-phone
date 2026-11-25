"use strict";
// 记忆池关键词块（Memory Keywords，2026-11-02）逐项测试——零依赖 node assert
// 跑法：node tests/context-v2/test_memory_keywords.js（exit 0 = 全过）
//
// 覆盖：只收 active / 全类型收（fact/rule 存量迁移词）/ 精确去重 /
//       入库先后排列（同条记忆词相邻）/ 空池整块省略 / 块文案格式（块头+说明行+「、」词串）

const assert = require("assert");
const { buildContextBlocks, BLOCK_DEFS, HEADERS } = require("../../context/context-v2-builder");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { console.error("FAIL " + name + "\n  " + (e && e.message)); process.exitCode = 1; }
}

function blockOf(res, key) {
  return res.blocks.find(b => b.key === key);
}

const GUIDE = "Keyword map of event memories (format: memory id | keywords). When she mentions something that may be related, search with these words; a memory can also be opened directly by its id.";   // 2026-11-03：汇总只收 event，说明行同步

ok("块定义顺序：memory_keywords 在 pinned_notes 之后、relevant_memories 之前", () => {
  const keys = BLOCK_DEFS.map(d => d.key);
  assert.ok(keys.indexOf("memory_keywords") > keys.indexOf("pinned_notes"), "应在 pinned_notes 之后");
  assert.ok(keys.indexOf("memory_keywords") < keys.indexOf("relevant_memories"), "应在 relevant_memories 之前");
  assert.strictEqual(HEADERS.memory_keywords, "## Memory Keywords");
});

ok("只收 active：superseded / archived 的词不出现", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "a1", text: "活着的", kind: "event", status: "active", triggers: ["词甲"] },
      { id: "a2", text: "被替代的", kind: "event", status: "superseded", triggers: ["词乙"] },
      { id: "a3", text: "归档的", kind: "fact", status: "archived", triggers: ["词丙"] },
    ],
  });
  const b = blockOf(res, "memory_keywords");
  assert.ok(b, "块应存在");
  assert.ok(b.content.indexOf("词甲") >= 0, "active 的词要出现");
  assert.ok(b.content.indexOf("词乙") < 0, "superseded 的词不出现");
  assert.ok(b.content.indexOf("词丙") < 0, "archived 的词不出现");
});

ok("只收 event（2026-11-03）：fact/rule 的词不进块（存量迁移词也不进）", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "f1", text: "事实", kind: "fact", status: "active", triggers: ["谢意行"] },
      { id: "r1", text: "规则", kind: "rule", status: "active", triggers: ["先亲一口"] },
      { id: "e1", text: "事件", kind: "event", status: "active", triggers: ["第一次对话"] },
    ],
  });
  const b = blockOf(res, "memory_keywords");
  assert.ok(b.content.indexOf("第一次对话") >= 0, "event 的词应出现");
  for (const w of ["谢意行", "先亲一口"]) {
    assert.ok(b.content.indexOf(w) < 0, w + " 是 fact/rule 的词，不应出现");
  }
});

ok("每条 event 一行「id｜词」：同条内去重（trim 后），跨条不去重（2026-11-03）", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "a1", text: "一", kind: "event", status: "active", triggers: ["爱你", "谢意行", " 爱你 "] },
      { id: "a2", text: "二", kind: "event", status: "active", triggers: ["爱你"] },
    ],
  });
  const b = blockOf(res, "memory_keywords");
  const rows = b.content.split("\n").slice(-2);
  assert.deepStrictEqual(rows, ["a1｜爱你、谢意行", "a2｜爱你"]);
});

ok("排列：按记忆入库先后（数组序），一条记忆一行", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "old", text: "旧", kind: "event", status: "active", triggers: ["旧词"] },
      { id: "new", text: "新", kind: "event", status: "active", triggers: ["新词一", "新词二"] },
    ],
  });
  const b = blockOf(res, "memory_keywords");
  assert.deepStrictEqual(b.content.split("\n").slice(-2), ["old｜旧词", "new｜新词一、新词二"]);
});

ok("空池省略：无任何关键词时不产出块", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "a1", text: "没词的", kind: "fact", status: "active", triggers: [] },
      { id: "a2", text: "没词的2", kind: "event", status: "active" },
    ],
  });
  assert.ok(!blockOf(res, "memory_keywords"), "不应产出 memory_keywords 块");
  // includeEmpty 时产出 empty 标记
  const res2 = buildContextBlocks({ memoriesV2: [{ id: "a1", text: "没词的", kind: "fact", status: "active", triggers: [] }] }, { includeEmpty: true });
  const b2 = blockOf(res2, "memory_keywords");
  assert.ok(b2 && b2.empty === true, "includeEmpty 时空块带 empty:true");
});

ok("文案格式：块头 + 空行 + 说明行 + 空行 + 「、」词串", () => {
  const res = buildContextBlocks({
    memoriesV2: [{ id: "a1", text: "事件", kind: "event", status: "active", triggers: ["词一", "词二"] }],
  });
  const b = blockOf(res, "memory_keywords");
  assert.ok(b.content.startsWith("## Memory Keywords\n\n"), "块头一行式 + 空行");
  assert.ok(b.content.indexOf(GUIDE) >= 0, "说明行照用户拍板文案原样出现");
  const lines = b.content.split("\n");
  assert.strictEqual(lines.length, 5, "共 5 行：头/空/说明/空/词串，实际 " + JSON.stringify(lines));
  assert.strictEqual(lines[4], "a1｜词一、词二");
  assert.ok(b.tokens > 0, "tokens 有估算");
});

ok("锚定/summary 等其他块不受影响：memoriesV2 同输入各块照常", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "r1", text: "睡前不许催她", kind: "rule", status: "active", anchor: true, triggers: ["晚安"], created_at: "2026-09-02T10:00:00+08:00" },
      { id: "f1", text: "她喜欢草莓", kind: "fact", status: "active", anchor: true, triggers: ["草莓"], created_at: "2026-09-03T10:00:00+08:00" },
      { id: "e1", text: "那次聊天", kind: "event", status: "active", triggers: ["第一次对话"], created_at: "2026-09-04T10:00:00+08:00" },
    ],
  });
  assert.ok(blockOf(res, "core_identity").content.indexOf("睡前不许催她") >= 0, "Core Identity 照常");
  assert.ok(blockOf(res, "long_term_understanding").content.indexOf("她喜欢草莓") >= 0, "Long-term Understanding 照常");
  const kwc = blockOf(res, "memory_keywords").content;
  assert.ok(kwc.indexOf("第一次对话") >= 0, "关键词块照常（event 的词在）");
  assert.ok(kwc.indexOf("晚安") < 0 && kwc.indexOf("草莓") < 0, "fact/rule 的词不进关键词块（2026-11-03 只收 event）");
});


ok("大标题下一句英文说明 + Long-term 在 Core 前面（2026-11-03）", () => {
  const res = buildContextBlocks({
    memoriesV2: [
      { id: "r1", text: "睡前不许催她", kind: "rule", status: "active", anchor: true, created_at: "2026-09-02T10:00:00+08:00" },
      { id: "f1", text: "她喜欢草莓", kind: "fact", status: "active", anchor: true, created_at: "2026-09-03T10:00:00+08:00" },
    ],
  });
  const keys = res.blocks.map(b => b.key);
  assert.ok(keys.indexOf("long_term_understanding") < keys.indexOf("core_identity"), "Long-term 在 Core 前");
  const core = blockOf(res, "core_identity").content, lt = blockOf(res, "long_term_understanding").content;
  assert.ok(core.startsWith("## Core Identity\n\nSummarized by a model from the rule memories"), "Core 标题下是来源/局限说明: " + JSON.stringify(core.slice(0, 90)));
  assert.ok(lt.startsWith("## Long-term Understanding\nSummarized by a model from the fact memories"), "Long-term 标题下是来源/局限说明: " + JSON.stringify(lt.slice(0, 90)));
});
console.log("\n" + passed + " passed");
