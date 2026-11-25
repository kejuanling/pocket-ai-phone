"use strict";

// ========================
// 重跑清洗器（memory-backfill 11-08 重构）输入输出测试
// 覆盖：行式输入打包 / 数组式输出解析（六动作+丢弃记账+id正文反转兜底）/ 工具回合（上限+回灌）/
//       落处（sink 待审卡、没改不进待审、tag 补词）/ sink 卡 approve=旧条归档（state-executor 分支）/
//       inheritDone（替换新条继承已跑标记）/ message-lookup（uuid 直捞）/ distill snapshotted 抓拍
// 运行：node tests/backfill-io/test_backfill_io.js
// ========================

const assert = require("assert");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const createMemoryBackfill = require("../../lib/memory-backfill");
const createMemoryDistill = require("../../lib/memory-distill");
const { createMessageLookup } = require("../../lib/message-lookup");
const { createStore } = require("../../memory/memory-v2");
const { createStateExecutor } = require("../../context/state-executor");

function tmpDir(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bf-io-" + tag + "-"));
  fs.ensureDirSync(path.join(d, "data"));
  return d;
}

function makeMockAdmission() {
  const cards = [];
  return {
    cards,
    submitPromotion: async (body) => { cards.push(body); return { action: "review", queue_id: "q" + cards.length }; },
  };
}

function makePool(dir, rows) {
  fs.writeJsonSync(path.join(dir, "data", "memory_v2.json"), rows, { spaces: 2 });
}

const POOL = [
  { id: "mv2_a", kind: "fact", text: "涵不吃香菜", status: "active", created_at: "2026-10-01T00:00:00Z", triggers: [], provenance: { quote: "我是完全不吃香菜的人" } },
  { id: "mv2_b", kind: "event", text: "一起去了西湖音乐节", status: "active", created_at: "2026-10-02T00:00:00Z", triggers: ["音乐节"], provenance: {} },
  { id: "mv2_c", kind: "event", text: "试了新开的咖啡店", status: "active", created_at: "2026-10-03T00:00:00Z", triggers: [], provenance: {} },
];

const cases = [
  ["packRows：行格式 id｜kind｜se｜词｜正文 + 出处行", async () => {
    const d = tmpDir("pack");
    makePool(d, POOL);
    const bf = createMemoryBackfill({ baseDir: d });
    const rows = bf.selectRows(10);
    const s = bf.packRows(rows);
    assert.ok(s.includes("mv2_a｜fact｜0｜｜涵不吃香菜"), "fact se=0 无词:\n" + s);
    assert.ok(s.includes("mv2_b｜event｜1｜音乐节｜一起去了西湖音乐节"), "event se=1 带词:\n" + s);
    assert.ok(s.includes("mv2_c｜event｜1｜｜试了新开的咖啡店"), "event se=1 空词:\n" + s);
    assert.ok(s.includes("└ 当时原文：「我是完全不吃香菜的人」"), "带 quote 的出处行:\n" + s);
    fs.removeSync(d);
  }],

  ["parseResponse：六动作解析 + 丢弃记账 + 编 id 拒收", async () => {
    const d = tmpDir("parse");
    const bf = createMemoryBackfill({ baseDir: d });
    const valid = { mv2_a: true, mv2_b: true, mv2_c: true };
    const raw = JSON.stringify({
      actions: [
        ["keep", "mv2_a"],
        ["tag", "咖啡店、探店", "mv2_c"],
        ["update", "涵不吃香菜，闻到就难受", "mv2_a", "过敏细节"],
        ["supplement", "涵不吃香菜，吃火锅也不放", "mv2_a", "补充"],
        ["merge", "合成后的完整正文", "mv2_a", "mv2_b"],
        ["sink", "mv2_c", "一次性琐事"],
      ],
    });
    const pr = bf.parseResponse(raw, valid);
    assert.strictEqual(pr.error, null);
    assert.strictEqual(pr.actions.length, 5, "keep 不落库");
    assert.deepStrictEqual(pr.actions[0], { action: "tag", id: "mv2_c", triggers: ["咖啡店", "探店"], reason: "" });
    assert.strictEqual(pr.actions[1].text, "涵不吃香菜，闻到就难受");
    assert.strictEqual(pr.actions[3].ids.length, 2);
    assert.strictEqual(pr.actions[4].reason, "一次性琐事");
    // 编 id / 坏形状 → 丢弃且记账
    const pr2 = bf.parseResponse(JSON.stringify({ actions: [["update", "x", "mv2_zzz"], ["tag"], ["merge", "正文", "mv2_a"], ["frobnicate", "mv2_a"], "oops", ["sink", "mv2_b"], ["sink", "mv2_b"]] }), valid);
    assert.strictEqual(pr2.actions.length, 1, "只剩合法 sink");
    assert.strictEqual(pr2.dropped.length, 5, "丢弃记账: " + JSON.stringify(pr2.dropped));
    fs.removeSync(d);
  }],

  ["parseResponse：id/正文写反兜底 + think 剥离 + tools 请求 + actions 优先", async () => {
    const d = tmpDir("parse2");
    const bf = createMemoryBackfill({ baseDir: d });
    const valid = { mv2_a: true };
    // update 元素顺序写反（id 在前、正文在后）→ 对调成功
    const pr = bf.parseResponse('{"actions":[["update","mv2_a","涵不吃香菜（过敏体质）","补充原因"]]}', valid);
    assert.strictEqual(pr.actions[0].id, "mv2_a");
    assert.strictEqual(pr.actions[0].text, "涵不吃香菜（过敏体质）");
    assert.strictEqual(pr.actions[0].reason, "补充原因");
    // think 块 + 围栏 + 尾部多余文字
    const pr2 = bf.parseResponse('<think>想想…{"actions":[]}</think>```json\n{"actions":[["keep"]]}\n``` 好的。', valid);
    assert.strictEqual(pr2.actions.length, 0);
    assert.strictEqual(pr2.error, null);
    // tools 请求
    const pr3 = bf.parseResponse('{"tools":[{"name":"memory_search","query":"香菜"},{"name":"context_search","query":"咖啡店"}]}', valid);
    assert.strictEqual(pr3.tools.length, 2);
    assert.strictEqual(pr3.actions.length, 0);
    // tag 的 id/词写反兜底（不把 id 混进词里）
    const pr5 = bf.parseResponse('{"actions":[["tag","mv2_a","香菜"]]}', valid);
    assert.strictEqual(pr5.actions[0].id, "mv2_a");
    assert.deepStrictEqual(pr5.actions[0].triggers, ["香菜"], JSON.stringify(pr5.actions[0]));
    // actions 与 tools 同时给 → actions 优先（出结论了就不再要工具）
    const pr4 = bf.parseResponse('{"tools":[{"name":"memory_search","query":"x"}],"actions":[["keep"]]}', valid);
    assert.strictEqual(pr4.actions.length, 0);
    assert.strictEqual(pr4.tools.length, 0);
    assert.strictEqual(pr4.error, null);
    fs.removeSync(d);
  }],

  ["applyActions：sink 生成待审卡 + 没改的不进待审 + tag 词相同跳过", async () => {
    const d = tmpDir("apply");
    makePool(d, POOL);
    const adm = makeMockAdmission();
    const bf = createMemoryBackfill({ baseDir: d, admission: adm });
    const rows = bf.selectRows(10);
    const res = await bf.applyActions([
      { action: "sink", id: "mv2_c", reason: "一次性琐事" },
      { action: "update", id: "mv2_a", text: "涵不吃香菜", reason: "原样" },          // 归一化相同 → unchanged
      { action: "tag", id: "mv2_b", triggers: ["音乐节"], reason: "" },              // 与现有词集合相同 → unchanged
      { action: "tag", id: "mv2_c", triggers: ["咖啡店"], reason: "补词" },          // 空词 → 正常入队
      { action: "merge", ids: ["mv2_a", "mv2_b"], text: "合成正文", reason: "" },
    ], rows, "batch-ref");
    assert.strictEqual(res.unchanged, 2, "没改的跳过: " + JSON.stringify(res));
    assert.strictEqual(res.queued, 3, "sink/tag/merge 三卡");
    const actions = adm.cards.map((c) => c.backfill.action);
    assert.deepStrictEqual(actions, ["sink", "tag", "merge"]);
    assert.strictEqual(adm.cards[0].content, "试了新开的咖啡店", "sink 卡内容=旧条原文");
    assert.strictEqual(adm.cards[0].backfill.target_id, "mv2_c");
    assert.deepStrictEqual(adm.cards[1].triggers, ["咖啡店"]);
    assert.strictEqual(adm.cards[2].backfill.merge_ids.length, 2);
    fs.removeSync(d);
  }],

  ["runOnce：工具回合（tools→回灌→actions）+ done 全标 + 回执字段", async () => {
    const d = tmpDir("runonce");
    makePool(d, POOL);
    const adm = makeMockAdmission();
    const seq = [
      { text: JSON.stringify({ tools: [{ name: "memory_search", query: "香菜" }] }), model: "mock" },
      { text: JSON.stringify({ actions: [["update", "涵不吃香菜，对香菜过敏", "mv2_a", "过敏细节"], ["tag", "咖啡店、探店", "mv2_c"]] }), model: "mock" },
    ];
    let turn = 0;
    const memQueries = [];
    const bf = createMemoryBackfill({
      baseDir: d,
      admission: adm,
      callLLM: async () => seq[turn++],
      memorySearch: async (q) => { memQueries.push(q); return []; },
      searchContext: async () => ({ ok: true, matches: [] }),
    });
    const out = await bf.runNow("test");
    assert.strictEqual(out.ok, true, JSON.stringify(out));
    assert.strictEqual(out.tool_rounds, 1, "查证 1 轮");
    assert.strictEqual(out.queued, 2);
    assert.deepStrictEqual(memQueries, ["香菜"], "工具真被执行");
    const st = JSON.parse(fs.readFileSync(path.join(d, "data", "memory_backfill_state.json"), "utf8"));
    assert.ok(st.done.mv2_a && st.done.mv2_b && st.done.mv2_c, "三条全标 done");
    assert.strictEqual(out.unchanged, 0);
    fs.removeSync(d);
  }],

  ["runOnce：工具到 10 轮上限强制收结论", async () => {
    const d = tmpDir("cap");
    makePool(d, POOL);
    const adm = makeMockAdmission();
    let t = 0;
    const bf = createMemoryBackfill({
      baseDir: d,
      admission: adm,
      callLLM: async () => {
        t++;
        if (t <= 10) return { text: JSON.stringify({ tools: [{ name: "memory_search", query: "q" + t }] }), model: "mock" };
        return { text: JSON.stringify({ actions: [["keep"]] }), model: "mock" };
      },
      memorySearch: async () => [],
      searchContext: async () => ({ ok: true, matches: [] }),
    });
    const out = await bf.runNow("test-cap");
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.tool_rounds, 10, "正好 10 轮封顶");
    assert.strictEqual(out.queued, 0, "keep 无卡");
    fs.removeSync(d);
  }],

  ["resolveQueue sink 分支：approve=旧条归档、不建新条", async () => {
    const d = tmpDir("sink");
    const store = createStore({ rootDir: d, config: { paths: { collection: "memory_v2.json", review_queue: "memory_review_queue.json" } } });
    const r0 = store.create({ text: "旧约定：周六开会", kind: "rule", origin: "manual", provenance: { method: "admin_form" } });
    assert.ok(r0.ok, "造旧条: " + JSON.stringify(r0));
    const queuePath = path.join(d, "memory_review_queue.json");
    fs.writeJsonSync(queuePath, [{
      id: "qx1", status: "pending_review", created_at: "2026-11-08T00:00:00Z",
      draft: { text: "旧约定：周六开会", kind: "rule", backfill: { action: "sink", target_id: r0.entry.id, reason: "早已取消的旧规矩" } },
    }]);
    const exec = createStateExecutor({ store, queuePath });
    const r = exec.resolveQueue("qx1", "approve");
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.action, "sink_done");
    assert.strictEqual(r.entry, null, "不建新条");
    assert.strictEqual(r.backfill.old[0].archived, true);
    assert.strictEqual(store.get(r0.entry.id).status, "archived", "旧条归档");
    fs.removeSync(d);
  }],

  ["resolveQueue sink 分支：旧条已非 active 时如实记录不报错", async () => {
    const d = tmpDir("sink2");
    const store = createStore({ rootDir: d, config: { paths: { collection: "memory_v2.json", review_queue: "memory_review_queue.json" } } });
    const r0 = store.create({ text: "已被替换的旧条", kind: "fact", origin: "manual", provenance: { method: "admin_form" } });
    store.updateStatus(r0.entry.id, "superseded", { reason: "updated" });
    const queuePath = path.join(d, "memory_review_queue.json");
    fs.writeJsonSync(queuePath, [{
      id: "qx2", status: "pending_review", created_at: "2026-11-08T00:00:00Z",
      draft: { text: "x", kind: "fact", backfill: { action: "sink", target_id: r0.entry.id } },
    }]);
    const exec = createStateExecutor({ store, queuePath });
    const r = exec.resolveQueue("qx2", "approve");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.backfill.old[0].archived, false);
    assert.strictEqual(r.backfill.old[0].reason, "not_active:superseded");
    fs.removeSync(d);
  }],

  ["inheritDone：替换出的新条继承旧条最早的 done 时间", async () => {
    const d = tmpDir("inherit");
    makePool(d, []);
    fs.writeJsonSync(path.join(d, "data", "memory_backfill_state.json"), { done: { mv2_old1: "2026-11-01T00:00:00Z", mv2_old2: "2026-11-02T00:00:00Z" } });
    const bf = createMemoryBackfill({ baseDir: d });
    const r = bf.inheritDone(["mv2_old1", "mv2_old2"], "mv2_new");
    assert.strictEqual(r.ok, true);
    const st = JSON.parse(fs.readFileSync(path.join(d, "data", "memory_backfill_state.json"), "utf8"));
    assert.strictEqual(st.done.mv2_new, "2026-11-01T00:00:00Z", "取最早: " + JSON.stringify(st.done));
    assert.strictEqual(bf.inheritDone([], "x").ok, false);
    fs.removeSync(d);
  }],

  ["message-lookup：uuid 命中/死链/session 提取/新文件缓存失效", async () => {
    const d = tmpDir("lookup");
    const tl = path.join(d, "timeline_data");
    fs.ensureDirSync(tl);
    fs.writeJsonSync(path.join(tl, "enhanced_messages_s_mtnce1g9_cy6au1.json"), [
      { id: "u1", content: "当时的原文一", role: "user" },
      { id: "u2", content: "当时的原文二", role: "assistant" },
    ]);
    fs.writeJsonSync(path.join(tl, "enhanced_messages.json"), { k: [{ id: "u3", content: "字典式存储" }] });
    const lk = createMessageLookup({ baseDir: d });
    const h1 = lk.lookup("u1");
    assert.strictEqual(h1.content, "当时的原文一");
    assert.strictEqual(h1.session, "s_mtnce1g9_cy6au1", "session 从文件名提取");
    assert.strictEqual(lk.lookup("u3").content, "字典式存储");
    assert.strictEqual(lk.lookup("dead-uuid"), null, "死链返回 null");
    assert.strictEqual(lk.lookup(""), null);
    // 新文件落盘 → 指纹变化 → 重建索引可见
    fs.writeJsonSync(path.join(tl, "enhanced_messages_s_other.json"), [{ id: "u4", content: "新会话的消息" }]);
    assert.strictEqual(lk.lookup("u4").content, "新会话的消息");
    fs.removeSync(d);
  }],

  ["distill verifyCandidates：evidence 未命中时按 uuid 直捞抓拍（snapshotted）", async () => {
    const d = tmpDir("snap");
    const md = createMemoryDistill({
      baseDir: d,
      lookupMessage: (id) => (id === "u9" ? { msg_id: "u9", content: "当时聊天里说的原话内容", session: "s_x" } : null),
      searchContext: null,
      admission: null,
    });
    const out = await md.verifyCandidates(
      [{ text: "候选记忆正文", kind: "fact", evidence: ["u9"], confidence: "low" }],
      {}   // 证据索引为空 → 走 uuid 直捞
    );
    assert.strictEqual(out[0].verified, "snapshotted", JSON.stringify(out[0]));
    assert.strictEqual(out[0].quote, "当时聊天里说的原话内容");
    assert.strictEqual(out[0].session, "s_x");
    assert.strictEqual(out[0].msg_id, "u9");
    assert.strictEqual(out[0].confidence, "mid", "low→mid（有原文在手但没过语义核验，保守一档）");
    // 死链：lookup 不到 → 仍 unconfirmed
    const out2 = await md.verifyCandidates([{ text: "另一条", kind: "event", evidence: ["dead"], confidence: "mid" }], {});
    assert.strictEqual(out2[0].verified, "unconfirmed");
    assert.strictEqual(out2[0].quote, "");
    fs.removeSync(d);
  }],
  ["parseResponse：对象式动作（1110 主格式）+ 字段校验记账", async () => {
    const d = tmpDir("objparse");
    const bf = createMemoryBackfill({ baseDir: d });
    const valid = { mv2_a: true, mv2_b: true, mv2_c: true };
    const raw = JSON.stringify({ actions: [
      { do: "tag", id: "mv2_c", words: ["咖啡店", "探店"], why: "补词" },
      { do: "update", id: "mv2_a", text: "涵不吃香菜，闻到就难受", words: ["香菜", "过敏"], kind: "fact", why: "补过敏细节" },
      { do: "merge", ids: ["mv2_b", "mv2_c"], text: "合成后的完整正文", kind: "event", why: "同一件事拆两条" },
      { do: "sink", id: "mv2_b", why: "一次性琐事" },
      { do: "keep" },
    ] });
    const pr = bf.parseResponse(raw, valid);
    assert.strictEqual(pr.error, null);
    assert.strictEqual(pr.actions.length, 4, "keep 不落库");
    assert.deepStrictEqual(pr.actions[0], { action: "tag", id: "mv2_c", text: "", triggers: ["咖啡店", "探店"], kind: null, reason: "补词" });
    assert.deepStrictEqual(pr.actions[1], { action: "update", id: "mv2_a", text: "涵不吃香菜，闻到就难受", triggers: ["香菜", "过敏"], kind: "fact", reason: "补过敏细节" });
    assert.deepStrictEqual(pr.actions[2], { action: "merge", ids: ["mv2_b", "mv2_c"], text: "合成后的完整正文", triggers: [], kind: "event", reason: "同一件事拆两条" });
    assert.deepStrictEqual(pr.actions[3], { action: "sink", id: "mv2_b", text: "", triggers: [], kind: null, reason: "一次性琐事" });
    const pr2 = bf.parseResponse(JSON.stringify({ actions: [
      { do: "frobnicate", id: "mv2_a" },
      { do: "merge", ids: ["mv2_a"], text: "x" },
      { do: "tag", id: "mv2_a" },
      { do: "update", id: "mv2_zzz", text: "x", why: "y" },
      { do: "tag", id: "mv2_c", words: "咖啡店、探店", why: "字符串词也收" },
    ] }), valid);
    assert.strictEqual(pr2.actions.length, 1, "只剩合法 tag");
    assert.deepStrictEqual(pr2.actions[0].triggers, ["咖啡店", "探店"]);
    assert.strictEqual(pr2.dropped.length, 4, JSON.stringify(pr2.dropped));
    fs.removeSync(d);
  }],

  ["applyActions：update/merge 继承关键词/分类/开关并排队评分（无 skip_judge），tag 不评且继承 worth", async () => {
    const d = tmpDir("apply2");
    makePool(d, POOL);
    const adm = makeMockAdmission();
    const bf = createMemoryBackfill({ baseDir: d, admission: adm });
    const rows = bf.selectRows(10);
    const pr = bf.parseResponse(JSON.stringify({ actions: [
      { do: "update", id: "mv2_a", text: "涵不吃香菜，闻到就难受", words: ["香菜", "过敏"], why: "补细节" },
      { do: "merge", ids: ["mv2_b", "mv2_c"], text: "合成后的完整正文", why: "同一件事" },
      { do: "tag", id: "mv2_c", words: ["咖啡店"], why: "补词" },
    ] }), { mv2_a: true, mv2_b: true, mv2_c: true });
    const res = await bf.applyActions(pr.actions, rows, "batch-1");
    assert.strictEqual(res.queued, 3, JSON.stringify(res));
    const upd = adm.cards[0];
    assert.strictEqual(upd.skip_judge, undefined, "update 排队门卫评分");
    assert.deepStrictEqual(upd.triggers, ["香菜", "过敏"], "模型写的词直接用");
    assert.strictEqual(upd.kind, "fact", "分类没写沿用旧条");
    assert.strictEqual(upd.search_enabled, false, "开关沿用旧条（fact 默认关）");
    const mrg = adm.cards[1];
    assert.strictEqual(mrg.skip_judge, undefined, "merge 排队门卫评分");
    assert.deepStrictEqual(mrg.triggers, ["音乐节"], "merge 没写词取旧词并集（只有 b 有词）");
    assert.strictEqual(mrg.kind, "event", "merge 分类沿用第一条旧条");
    assert.strictEqual(mrg.search_enabled, true, "任一旧条开着就开");
    const tag = adm.cards[2];
    assert.strictEqual(tag.skip_judge, true, "tag 只补词不重评分");
    assert.deepStrictEqual(tag.triggers, ["咖啡店"]);
    assert.strictEqual(tag.worth, undefined, "旧条无 worth 不硬塞");
    const d2 = tmpDir("apply2-worth");
    makePool(d2, [Object.assign({}, POOL[2], { worth: 0.7, worth_reason: "值得记", volatility: "stable", volatility_reason: "稳定" })]);
    const adm2 = makeMockAdmission();
    const bf2 = createMemoryBackfill({ baseDir: d2, admission: adm2 });
    const rows2 = bf2.selectRows(10);
    const pr2 = bf2.parseResponse('{"actions":[{"do":"tag","id":"mv2_c","words":["咖啡店"],"why":"补词"}]}', { mv2_c: true });
    await bf2.applyActions(pr2.actions, rows2, "batch-2");
    assert.strictEqual(adm2.cards[0].worth, 0.7, "tag 卡继承旧条 worth");
    assert.strictEqual(adm2.cards[0].volatility, "stable", "tag 卡继承旧条 volatility");
    fs.removeSync(d);
    fs.removeSync(d2);
  }],

  ["selectRows：字数预算截断（条数没用完先到字数顶，保底 1 条）", async () => {
    const d = tmpDir("budget");
    const big = { id: "mv2_big", kind: "event", text: "很长的正文".repeat(400), status: "active", created_at: "2026-10-01T00:00:00Z", triggers: [], provenance: {} };
    makePool(d, [big, POOL[1]]);
    const bf = createMemoryBackfill({ baseDir: d });
    const rows = bf.selectRows(10, 2000);
    assert.strictEqual(rows.length, 1, "大条后超预算，只收保底 1 条: " + rows.length);
    assert.strictEqual(rows[0].id, "mv2_big");
    const rows2 = bf.selectRows(10, 100000);
    assert.strictEqual(rows2.length, 2, "预算够就都收");
    fs.removeSync(d);
  }],

  ["runOnce：单条动作异常只留该条不记 done，失败条下一批还能重跑（11-15 健壮性）", async () => {
    const d = tmpDir("failone");
    makePool(d, POOL);
    const adm = makeMockAdmission();
    const realSubmit = adm.submitPromotion;
    adm.submitPromotion = async (body) => {
      if (body.backfill && body.backfill.target_id === "mv2_a") throw new Error("模拟入队异常");
      return realSubmit(body);
    };
    const bf = createMemoryBackfill({
      baseDir: d,
      admission: adm,
      callLLM: async () => ({ text: JSON.stringify({ actions: [["update", "涵对香菜过敏", "mv2_a", "改细节"], ["tag", "咖啡店、探店", "mv2_c"]] }), model: "mock" }),
      memorySearch: async () => [],
      searchContext: async () => ({ ok: true, matches: [] }),
    });
    const out = await bf.runNow("test-failone");
    assert.strictEqual(out.ok, false, "有失败就不能算整批成功：" + JSON.stringify(out));
    assert.strictEqual(out.queued, 1, "成功那条照常进待审");
    assert.strictEqual(out.apply_errors.length, 1, "失败要记账：" + JSON.stringify(out.apply_errors));
    assert.deepStrictEqual(out.retry_next, ["mv2_a"], "失败条要明说留待下批：" + JSON.stringify(out.retry_next));
    const st = JSON.parse(fs.readFileSync(path.join(d, "data", "memory_backfill_state.json"), "utf8"));
    assert.ok(st.done.mv2_b, "本批没有动作的行照常 done");
    assert.ok(st.done.mv2_c, "成功动作的行 done");
    assert.ok(!st.done.mv2_a, "失败那条绝不能标 done，否则永远不再重试");
    const again = bf.selectRows(10);
    assert.ok(again.some((r) => r.id === "mv2_a"), "失败条下一批还能被选中");
    fs.removeSync(d);
  }],

  ["runOnce：门卫拒收（未入队）同样不把该条标 done", async () => {
    const d = tmpDir("notqueued");
    makePool(d, POOL);
    const adm = makeMockAdmission();
    const realSubmit = adm.submitPromotion;
    adm.submitPromotion = async (body) => {
      if (body.backfill && body.backfill.target_id === "mv2_c") return { action: "duplicate" };
      return realSubmit(body);
    };
    const bf = createMemoryBackfill({
      baseDir: d,
      admission: adm,
      callLLM: async () => ({ text: JSON.stringify({ actions: [["tag", "咖啡店、探店", "mv2_c"]] }), model: "mock" }),
    });
    const out = await bf.runNow("test-notqueued");
    assert.strictEqual(out.ok, false, JSON.stringify(out));
    assert.strictEqual(out.skipped, 1);
    assert.deepStrictEqual(out.retry_next, ["mv2_c"]);
    const st = JSON.parse(fs.readFileSync(path.join(d, "data", "memory_backfill_state.json"), "utf8"));
    assert.ok(!st.done.mv2_c, "被拒收的那条不标 done");
    assert.ok(st.done.mv2_a && st.done.mv2_b, "同批其他行照常 done");
    fs.removeSync(d);
  }],
];

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of cases) {
    try { await fn(); pass++; console.log("PASS " + name); }
    catch (e) { fail++; console.log("FAIL " + name + "\n  " + (e && e.message || e)); }
  }
  console.log("\ntest_backfill_io: " + pass + " passed, " + fail + " failed（共 " + cases.length + " 例）");
  process.exit(fail ? 1 : 0);
})();
