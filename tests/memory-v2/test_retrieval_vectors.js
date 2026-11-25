"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const vectors = require("../../memory/memory-v2-vectors");
const memoryV2 = require("../../memory/memory-v2");
const embedClient = require("../../utils/memory-embed-client");

test("memory_search is keyword-only, cross-kind, and ignores triggers/vibe", async () => {
  const rows = [
    { id: "f1", kind: "fact", text: "她喜欢红心木瓜，不要太甜", triggers: ["完全不相关的暗号"], vibe: "海边" },
    { id: "r1", kind: "rule", text: "回答不要在末尾附推荐回复", created_at: "2026-10-01" },
    { id: "e1", kind: "event", text: "标星对话跨窗口注入重复问题", triggers: ["收藏星星"], vibe: "调试线上缓存" },
    { id: "f2", kind: "fact", text: "喜欢纯牛奶味冰淇淋" }
  ];
  const oldFetch = global.fetch;
  let networkCalls = 0;
  global.fetch = async () => { networkCalls++; throw new Error("memory_search must not call embeddings"); };
  try {
    const fruit = await vectors.retrieveHybrid(rows, "红心木瓜", { topK: 5 });
    assert.equal(fruit.length, 1);
    assert.equal(fruit[0].id, "f1");
    const factOnly = await vectors.retrieveHybrid(rows, "红心木瓜", { topK: 5, kind: "fact" });
    assert.deepEqual(factOnly.map(x => x.id), ["f1"]);

    /* [2026-11-15] 原样例拿「学校…好服务器」对「服务器重启」——两者共享 bigram「服务」，纯词面检索必然入围，
       这条断言从一开始就与实现口径不一致（不是 bug）。保留本意（不相关的记忆不入围），换成没有共同词元的样例。
       半词元重叠被词面召回是已知口径，别再当 bug 报。 */
    const noOverlap = await vectors.retrieveHybrid([
      { id: "moon-night", kind: "event", text: "今天月亮很圆，她心情不错。" }
    ], "服务器重启", { topK: 5 });
    assert.equal(noOverlap.length, 0, "没有任何共同词元的记忆不得入围");

    const rule = await vectors.retrieveHybrid(rows, "末尾推荐回复", { topK: 5 });
    assert.equal(rule.some(x => x.id === "r1"), true);

    const event = await vectors.retrieveHybrid(rows, "跨窗口注入重复", { topK: 5 });
    assert.equal(event.some(x => x.id === "e1"), true);

    /* [2026-11-15] 11-02 起口径变了：triggers 全类型放开，且 event 类记忆默认参与检索
       （memory/memory-v2.js·searchEnabled：search_enabled 缺省时 kind==="event" 即为 true）。
       原断言「命中 trigger 也不得入围」与现行口径相反，改成正反两面锁住开关语义。 */
    const triggerOn = await vectors.retrieveHybrid(rows, "收藏星星", { topK: 5 });
    assert.deepEqual(triggerOn.map(x => x.id), ["e1"], "event 的触发词默认参与检索，命中即入围");
    const offRows = rows.map(r => r.id === "e1" ? Object.assign({}, r, { search_enabled: false }) : r);
    const triggerOff = await vectors.retrieveHybrid(offRows, "收藏星星", { topK: 5 });
    assert.equal(triggerOff.length, 0, "关掉「参与检索」后触发词不再入围");
    assert.equal(networkCalls, 0);
  } finally {
    global.fetch = oldFetch;
  }
});

// 1102 产品确定：triggers 放开全类型（fact/rule 存量迁移词保留、手工可补，供记忆池关键词目录块汇总）；vibe 仍仅 event
test("new fact/rule entries persist triggers but not vibe", () => {
  for (const kind of ["fact", "rule"]) {
    const result = memoryV2.validateEntry({
      text: "测试记忆",
      kind,
      origin: "manual",
      provenance: { method: "admin_form" },
      triggers: ["测试关键词"],
      vibe: "测试情景"
    });
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(result.entry.triggers, ["测试关键词"]);
    assert.equal(Object.hasOwn(result.entry, "vibe"), false);
  }
  const event = memoryV2.validateEntry({
    text: "测试事件",
    kind: "event",
    origin: "manual",
    provenance: { method: "admin_form" },
    triggers: ["测试关键词"],
    vibe: "测试情景"
  });
  assert.equal(event.ok, true, event.error);
  assert.deepEqual(event.entry.triggers, ["测试关键词"]);
  assert.equal(event.entry.vibe, "测试情景");
});

test("SiliconFlow embedding client returns normalized 1024-d vectors without exposing provider secrets", async t => {
  const oldFetch = global.fetch;
  const oldModel = process.env.EMBEDDING_MODEL;
  delete process.env.EMBEDDING_MODEL;
  embedClient.resetCircuitForTests();
  /* [2026-11-15] resolveConfig 只认 config/ai-providers.json 里 enabled!==false 且有 api_key 的供应商；
     现网「硅基流动体验」是 enabled=false，于是这条用例拿到的 out 是 null、直接 TypeError——测的是线上配置不是代码。
     本用例只关心请求形状与归一化，这里把那份配置读成一份可用的固定供应商，退出时还原。 */
  const fs = require("fs");
  const oldReadFileSync = fs.readFileSync;
  fs.readFileSync = function (p) {
    if (String(p).indexOf("ai-providers.json") >= 0) {
      return JSON.stringify([{ name: "硅基流动体验", enabled: true, api_key: "test-key", api_url: "https://api.siliconflow.cn/v1/chat/completions" }]);
    }
    return oldReadFileSync.apply(fs, arguments);
  };
  let seen = null;
  global.fetch = async (url, init) => {
    seen = { url: String(url), model: JSON.parse(init.body).model, input: JSON.parse(init.body).input, hasAuth: /^Bearer .+/.test(init.headers.Authorization || "") };
    const embedding = Array.from({ length: 1024 }, (_, i) => i === 0 ? 3 : 4);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ index: 0, embedding }] })
    };
  };
  t.after(() => {
    global.fetch = oldFetch;
    fs.readFileSync = oldReadFileSync;
    if (oldModel === undefined) delete process.env.EMBEDDING_MODEL;
    else process.env.EMBEDDING_MODEL = oldModel;
    embedClient.resetCircuitForTests();
  });
  const out = await embedClient.embedBatch(["test"], false, 5000);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 1024);
  assert.equal(seen.model, "BAAI/bge-m3");
  assert.match(seen.url, /api\.siliconflow\.cn\/v1\/embeddings$/);
  assert.equal(seen.hasAuth, true);
  const norm = Math.sqrt(out[0].reduce((sum, n) => sum + n * n, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
});
