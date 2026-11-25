// 此刻 <trace>：整句解析/剥离/代码块保护 + 万物召回短词匹配（不写数据：commit:false）
// 11-07 整句化重写：trace 内容就是一句话 {content}，不再拆气味名/情绪/想要选了忍住字段；lock 功能删除（<trace lock> 按普通 trace 剥）。trace-notes.add 的落盘与幂等由迁移脚本 scripts/migrate_trace_notes_20261107.js 真数据实测覆盖，测试不写真数据文件。
const assert = require("assert");
const { stripTrace, parseTrace, extractFromMessage } = require("../../lib/trace");
const fs = require("fs");
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

ok("整句存：不再拆字段", () => {
  const r = stripTrace("好，那你先去睡，明天再说。\n<trace>\n气味：烤栗子\n想念 ↑轻微\n想要：多聊一会\n</trace>");
  assert.strictEqual(r.text, "好，那你先去睡，明天再说。");
  assert.strictEqual(r.trace.content.indexOf("烤栗子") >= 0, true);
  assert.strictEqual(r.trace.want, undefined, "不再产出拆分字段");
});
ok("单行短句 / 忘了闭合：整句都留得住（旧解析会丢气味名的场景）", () => {
  assert.strictEqual(stripTrace("嗯。<trace>发烫的蜂蜜</trace>").trace.content, "发烫的蜂蜜");
  assert.strictEqual(stripTrace("嗯。<trace>薄荷\n她今天好像累了，先不问。</trace>").trace.content, "薄荷\n她今天好像累了，先不问。");
  const r = stripTrace("晚安。<trace>柠檬皮 · 开心 ↑");
  assert.strictEqual(r.text, "晚安。"); assert.strictEqual(r.trace.content, "柠檬皮 · 开心 ↑");
});
ok("lock 属性：标签剥干净，内容按普通 trace 存（lock 功能已删）", () => {
  const r = stripTrace("好。<trace lock>其实我很想她</trace>");
  assert.strictEqual(r.text, "好。");
  assert.strictEqual(r.trace.content, "其实我很想她");
  assert.strictEqual(r.trace.locked, undefined);
  assert.strictEqual(r.privateBody, undefined, "不再有私密通道");
});
ok("代码块/行内反引号里的 <trace> 不解析", () => {
  const t = "讲解：写 `<trace>薄荷</trace>` 就行\n```\n<trace>柠檬</trace>\n```";
  const r = stripTrace(t); assert.strictEqual(r.trace, null); assert.strictEqual(r.text, t);
});
ok("extractFromMessage：content/segments/stream_timeline 都剥成 {content,at}", () => {
  const m = { id: "t1", role: "assistant", content: "a<trace>被她记住了</trace>", segments: ["a<trace>被她记住了</trace>"], stream_timeline: [{ type: "text", text: "a<trace>被她记住了</trace>" }] };
  assert.strictEqual(extractFromMessage(m, "s_test_trace"), true);
  assert.ok(JSON.stringify(m).indexOf("<trace") < 0, "正文里不能有标签");
  assert.strictEqual(m.trace.content, "被她记住了");
  assert.ok(m.trace.at, "要有时间");
});
ok("非 assistant / 无 trace 不动", () => {
  const m = { role: "user", content: "<trace>x</trace>" }; assert.strictEqual(extractFromMessage(m, "s"), false); assert.strictEqual(m.content, "<trace>x</trace>");
});
ok("召回：candidates 带 msg_id 文案、pick 短词命中（真数据只读，commit:false）", () => {
  const rs = require("../../lib/recall-sources");
  const cs = rs.candidates({ enabled: true, trace: true, album: true }, null);
  const tr = cs.filter((c) => c.id.indexOf("trace:") === 0);
  assert.ok(tr.length > 0, "迁移后应有此刻记录");
  assert.ok(tr.every((c) => /msg_id：/.test(c.text)), "文案要带 msg_id");
  assert.ok(cs.filter((c) => c.id.indexOf("album:") === 0).length > 0);
  const g = rs.grams("出发前的月亮：两栋楼夹出一角天");
  assert.ok(g.has("月亮")); assert.ok(!g.has("的月"));
  const r1 = rs.pick({ query: "今天的月亮好大啊", sessionId: "s_other", excludeIds: [], commit: false, now: Date.parse("2030-01-01T00:00:00Z") });
  assert.ok(r1.hits.length <= 1);
  const r2 = rs.pick({ query: "我们今天吃什么", sessionId: "s_other", excludeIds: [], commit: false, now: Date.parse("2030-01-01T00:00:00Z") });
  assert.strictEqual(r2.hits.length, 0, "常见词不该命中");
});
ok("召回限流 11-08 涵定：无天上限（days 账本作废）、同条冷却 48h 且按会话隔离（state 备份还原法，测完还原）", () => {
  const rs2 = require("../../lib/recall-sources");
  const sf = rs2.STATE_FILE;
  const bak = fs.existsSync(sf) ? fs.readFileSync(sf, "utf8") : null;
  try {
    const first = require("../../lib/trace-notes").list().sort((a, b) => String(b.content || "").length - String(a.content || "").length)[0];
    assert.ok(first && first.content, "库里要有 trace");
    const q = String(first.content).slice(0, 30);
    const now = Date.now();
    const key = (sid, id) => (sid || "_") + ":" + id;
    const has = (r, id) => r.hits.some((h) => h.id === id);
    // 基线：无冷却时这个 query 的真实第一名（不预设是谁，围绕它做断言）
    const base = rs2.pick({ query: q, sessionId: "sA", excludeIds: [], commit: false, now });
    assert.ok(base.hits.length >= 1, "基线要能命中");
    const X = base.hits[0].id;
    // 1) 旧 days 账本记满 99 也不拦：天上限整个作废（旧代码在此返回空）
    fs.writeFileSync(sf, JSON.stringify({ days: { "2030-01-01": 99 }, last: {} }));
    assert.ok(rs2.pick({ query: q, sessionId: "sA", excludeIds: [], commit: false, now }).hits.length >= 1, "无天上限");
    // 2) 会话 A 30h 前想起过 X → 48h 冷却内，X 不再出（别的条可替补）
    fs.writeFileSync(sf, JSON.stringify({ last: { [key("sA", X)]: now - 30 * 3600 * 1000 } }));
    assert.ok(!has(rs2.pick({ query: q, sessionId: "sA", excludeIds: [], commit: false, now }), X), "30h < 48h，A 内 X 不召回");
    // 3) 会话 B 没想起过 → X 照样能出（隔离）
    assert.ok(has(rs2.pick({ query: q, sessionId: "sB", excludeIds: [], commit: false, now }), X), "B 会话不受 A 影响");
    // 4) 49h 后 A 也能再想起
    fs.writeFileSync(sf, JSON.stringify({ last: { [key("sA", X)]: now - 49 * 3600 * 1000 } }));
    assert.ok(has(rs2.pick({ query: q, sessionId: "sA", excludeIds: [], commit: false, now }), X), "过 48h 可再想起");
    // 5) commit 记账：不再写 days，last 按会话+条目记
    fs.writeFileSync(sf, JSON.stringify({ days: { "2030-01-01": 5 }, last: {} }));
    rs2.pick({ query: q, sessionId: "sC", excludeIds: [], now });
    const st = JSON.parse(fs.readFileSync(sf, "utf8"));
    assert.ok(!("days" in st), "days 账本不再写");
    assert.ok(st.last && st.last[key("sC", X)], "last 按会话+条目记账");
  } finally {
    if (bak === null) { try { fs.unlinkSync(sf); } catch (_) {} } else fs.writeFileSync(sf, bak);
  }
});
ok("事故：叙述里提到 <trace>（没闭合）不能吞后面整段", () => {
  const prose = "找到了：「此刻<trace>」是消息下面那个小条。" + "后面还有很长的一段话，说明样式怎么改。".repeat(60);
  const r = stripTrace(prose);
  assert.strictEqual(r.trace, null);
  assert.ok(r.text.length > 1000 && r.text.indexOf("后面还有很长") > 0, "后面的正文要在");
});
ok("事故：叙述里提到 <trace> + 末尾真 trace：只取真的，中间正文不丢", () => {
  const t = "先说一下：这个<trace>标签是写在末尾的。" + "中间一大段说明。".repeat(50) + "\n晚安。<trace>柠檬皮 · 开心 ↑</trace>";
  const r = stripTrace(t);
  assert.strictEqual(r.trace && r.trace.content, "柠檬皮 · 开心 ↑");
  assert.ok(r.text.indexOf("中间一大段说明") > 0 && r.text.indexOf("晚安。") > 0);
});
ok("没闭合但很短、在句末：仍当 trace", () => {
  const r = stripTrace("好。<trace>薄荷 · 安心 ↑"); assert.strictEqual(r.trace.content, "薄荷 · 安心 ↑"); assert.strictEqual(r.text, "好。");
});
ok("流式过滤：叙述里的 <trace> 不能把后面一直扣住", () => {
  const { createTagStreamFilter } = require("../../lib/tag-stream");
  const f = createTagStreamFilter(); let out = "";
  const text = "找到了：「此刻<trace>」是小条。" + "后面的话。".repeat(400);
  for (let i = 0; i < text.length; i += 50) f.push(text.slice(i, i + 50), (a) => { out += a; });
  assert.ok(out.indexOf("后面的话") > 0 && out.length > 1000, "流式中后面的字要出来 " + out.length);
  const g = createTagStreamFilter(); let o2 = "";
  g.push("晚安。<trace>柠檬皮 · 开", (a) => { o2 += a; });
  assert.strictEqual(o2, "晚安。", "真 trace 写到一半仍然扣住");
});
ok("parseTrace 空值防御", () => {
  assert.strictEqual(parseTrace(""), null);
  assert.strictEqual(parseTrace(null), null);
  assert.deepStrictEqual(parseTrace("  温的  "), { content: "温的" });
});
console.log("全部通过", n);
