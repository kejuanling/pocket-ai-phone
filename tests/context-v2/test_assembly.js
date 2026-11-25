"use strict";
// Context V2 Builder 组装行为测试（C10 S3-C 校准批后）——顺序/空块/V2 空仓降级/只读/config
// 跑法：node tests/context-v2/test_assembly.js（exit 0 = 全过）

const assert = require("assert");
const { buildContextBlocks, DEFAULT_CONFIG, BLOCK_DEFS } = require("../../context/context-v2-builder");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("PASS " + name); }
  catch (e) { console.error("FAIL " + name + "\n  " + (e && e.message)); process.exitCode = 1; }
}

const EXPECTED_ORDER = [
  "system_instructions", "long_term_understanding", "core_identity",   // 2026-11-03：用户画像在前、交互偏好在后
  "conversation_continuity", "starred_dialog", "notebook_index", "pinned_notes", "memory_keywords", "relevant_memories",
];

// 满配 fixture（七类块全非空；含标星对话与笔记本目录）
function fullInput() {
  return {
    pinnedEntries: [
      { id: "pin0", title: "Context Assembly", content: "## Memory Handling Rule\nher present intent 优先。", target: "instructions", order: 0 },
      { id: "pin1", title: "记忆标签", content: "如果想存记忆，用记忆内联标签。", target: "instructions" },
      { id: "pin2", content: "回复她要简短有温度", target: "identity" },
      { id: "pin3", content: "你是我的锚", target: "retire" }, // 1002-14：moments_anchor target 随块一并删除
    ],
    diaryEntries: [
      { date: "2026-09-10", content: "聊了很多。" },
      { date: "2026-09-13", content: "她说最近在准备考试。" },
    ],
    memoriesV2: [
      // 0920 删重要级后注入判定只认 anchor（priority 遗留字段已清）
      { id: "mv2_r1", text: "睡前不许催她", kind: "rule", status: "active", anchor: true, created_at: "2026-09-02T00:00:00+08:00" },
      { id: "mv2_f1", text: "她膝盖受过伤", kind: "fact", status: "active", anchor: true, created_at: "2026-09-03T00:00:00+08:00" },
      { id: "mv2_q1", text: "无论你怎么样我都选择接你", kind: "fact", status: "active", anchor: true, established_at: "2026-07-14T00:00:00+08:00", created_at: "2026-09-04T00:00:00+08:00" }, // 1002-14：原 quote，随分类删除并入 fact
      { id: "mv2_q2", text: "她对薄荷过敏", kind: "fact", status: "active", created_at: "2026-09-05T00:00:00+08:00" },
      { id: "mv2_e1", text: "她对薄荷过敏", kind: "event", status: "active", triggers: ["薄荷"], created_at: "2026-09-06T00:00:00+08:00" },
    ],
    starredLines: ["她标星保存的原话"],
    notebookLines: ["这是你的笔记本目录，会话建立时的快照，之后新增的可能不在里面。", "分类：岛志 2 篇", "2｜岛志·第二页｜岛志｜2026-10-04"],
    // 1102 笔记置顶：置顶笔记全文行（pinnedNotesLines 由 papers.pinnedNotesLines 算好传入）
    pinnedNotesLines: ["以下是置顶的笔记（完整原文）。", "── 7｜岛志·设定集·已置顶 ──\n\n她最喜欢的设定都记在这里。"],
    query: "她对薄荷过敏吗",
  };
}

ok("块顺序 = 当前九类块的冻结顺序（含 starred_dialog、notebook_index、pinned_notes、memory_keywords）", () => {
  const res = buildContextBlocks(fullInput());
  const keys = res.blocks.map(b => b.key);
  assert.deepStrictEqual(keys, EXPECTED_ORDER, "实际输出顺序");
  assert.deepStrictEqual(BLOCK_DEFS.map(d => d.key), EXPECTED_ORDER, "定义表顺序");
});

ok("pinned_notes：全文进块、篇间空行、标题带·已置顶", () => {
  const res = buildContextBlocks(fullInput());
  const blk = res.blocks.find(b => b.key === "pinned_notes");
  assert.ok(blk && !blk.empty, "有置顶笔记时应产出非空块");
  assert.ok(blk.content.startsWith("## Pinned Notes"), "块头");
  assert.ok(blk.content.includes("岛志·设定集·已置顶"), "标题带置顶标记");
  assert.ok(blk.content.includes("她最喜欢的设定都记在这里。"), "全文进块");
});

ok("pinned_notes：没有置顶笔记时不注入", () => {
  const input = fullInput();
  delete input.pinnedNotesLines;
  const keys = buildContextBlocks(input).blocks.map(b => b.key);
  assert.ok(!keys.includes("pinned_notes"), "空块不产出");
});

ok("schema：九类块各五键，非空块 tokens>0；current_state/recent_experience 已不存在", () => {
  const res = buildContextBlocks(fullInput(), { includeEmpty: true });
  const keys = res.blocks.map(b => b.key);
  assert.ok(!keys.includes("current_state"), "0918 砍除");
  assert.ok(!keys.includes("recent_experience"), "0918 剔除");
  for (const b of res.blocks) {
    assert.deepStrictEqual(Object.keys(b).sort(), ["content", "empty", "key", "title", "tokens"]);
    assert.strictEqual(b.empty, false);
    assert.ok(Number.isInteger(b.tokens) && b.tokens > 0);
  }
});

ok("V2 空仓降级：Understanding/Relevant 省略；System Instructions/Identity/Continuity 由 pinned+diary 支撑", () => {
  const input = fullInput();
  input.memoriesV2 = [];
  input.query = "";
  const res = buildContextBlocks(input);
  const keys = res.blocks.map(b => b.key);
  assert.ok(keys.includes("system_instructions"), "pinned 工具文档仍提供");
  assert.ok(keys.includes("core_identity"), "pinned 规训仍提供");
  assert.ok(keys.includes("conversation_continuity"));
  assert.ok(!keys.includes("long_term_understanding"), "V2 空仓省略");
  assert.ok(!keys.includes("relevant_memories"), "V2 空仓省略");
  assert.ok(!keys.includes("meaningful_moments"), "1002-14：块已删除");
});

ok("空块省略（无条目时无块注入）+ includeEmpty=true 时九类块全在", () => {
  const empty = { pinnedEntries: [], diaryEntries: [], memoriesV2: [], starredLines: [], query: "" };
  const def = buildContextBlocks(empty).blocks;
  assert.strictEqual(def.length, 0, "没有任何条目时，所有空块都省略");
  const res = buildContextBlocks(empty, { includeEmpty: true });
  assert.strictEqual(res.blocks.length, 9);   // 1102 起含 pinned_notes、memory_keywords
  for (const b of res.blocks) {
    assert.strictEqual(b.empty, true, b.key + " 应为空");
    assert.strictEqual(b.content, "");
    assert.strictEqual(b.tokens, 0);
  }
});

ok("只读性：调用前后输入对象深度不变", () => {
  const input = fullInput();
  const before = JSON.stringify(input);
  buildContextBlocks(input);
  buildContextBlocks(input, { includeEmpty: true });
  assert.strictEqual(JSON.stringify(input), before, "输入未被修改");
});

ok("config 覆盖：门槛提高→核心层省略；diaryCount=1→只最新一篇；不污染 DEFAULT_CONFIG", () => {
  const input = fullInput();
  input.config = { understandingCoreMinPriority: 0.95, diaryCount: 1 };
  const res = buildContextBlocks(input);
  // 0920 核心层 priority 门槛已删（仅 anchor），传入的 understandingCoreMinPriority 被忽略
  assert.strictEqual(DEFAULT_CONFIG.understandingCoreMinPriority, undefined, "核心层 priority 门槛配置已删");
  const cont = res.blocks.find(b => b.key === "conversation_continuity");
  assert.ok(cont.content.includes("她说最近在准备考试") && !cont.content.includes("聊了很多"), "diaryCount=1 只最新一篇");
  assert.strictEqual(DEFAULT_CONFIG.diaryCount, 3, "默认篇数未被改");
});

ok("内容块标题仅一行；Context Assembly 与其他永久上下文条目一致", () => {
  const res = buildContextBlocks(fullInput());
  const id = res.blocks.find(b => b.key === "core_identity");
  const lines = id.content.split("\n");
  assert.strictEqual(lines[0], "## Core Identity", "标题恰一行");
  assert.strictEqual(lines[1], "", "块头后空一行（1021：条目标题 ### 前后空行）");
  assert.ok(lines.slice(2).some(l => l.length > 0), "空行之后即内容");
  assert.ok(!id.content.includes("standing agreements"), "说明段不再重复（已上移）");
  assert.ok(!res.blocks.find(b => b.key === "context_assembly"), "1021：不再有 assembly 专属块");
  const sys = res.blocks.find(b => b.key === "system_instructions");
  assert.ok(sys.content.includes("### Context Assembly\n\n## Memory Handling Rule"), "Context Assembly 作为普通条目，### 标题格式");
  assert.ok(sys.content.includes("her present intent"), "优先级总纲在");
});

ok("条目标题 ### 格式（1021：[xxx]→### 标题，前后空行）", () => {
  const res = buildContextBlocks(fullInput());
  const sys = res.blocks.find(b => b.key === "system_instructions");
  assert.ok(sys.content.includes("### 记忆标签\n\n如果想存记忆"), "### 标题格式");
  assert.ok(!sys.content.includes("[记忆标签]"), "旧 [标题] 格式已废");
  assert.ok(!sys.content.includes("【记忆标签】"), "旧【】格式已废");
});

ok("去重集成：anchor/rule/工具文档均不入 Relevant，event 检索命中", () => {
  const input = fullInput();
  input.query = "无论你怎么样 我都选择接你 睡前不许催她 薄荷 如果想存记忆";
  const res = buildContextBlocks(input);
  const rel = res.blocks.find(b => b.key === "relevant_memories");
  assert.ok(rel, "检索块存在（薄荷条目应命中）");
  assert.ok(!rel.content.includes("无论你怎么样我都选择接你"), "Understanding anchor 去重（原 Moments）");
  assert.ok(!rel.content.includes("睡前不许催她"), "Identity rule 去重");
  assert.ok(!rel.content.includes("如果想存记忆"), "Instructions 去重");
  assert.ok(rel.content.includes("她对薄荷过敏"), "检索池条目正常");
});

console.log("\n" + passed + " 组断言全过" + (process.exitCode ? "（有 FAIL）" : ""));
