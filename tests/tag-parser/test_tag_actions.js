"use strict";
/* 第6项步骤2/3：新写法标签 → 转调工具（lib/tag-actions.js）+ tag-parser 集成。
 * 工具调用全部用桩（ctx.callTool），不碰真实工具集/数据；star/album 自标星与入册路径对真实模块打桩。
 * 跑法（项目目录下）：node tests/tag-parser/test_tag_actions.js */
const assert = require("assert");
const T = require("../../workspace/phone-tags.js");
const A = require("../../lib/tag-actions");
const tagParser = require("../../lib/tag-parser");
const cr = require("../../context/context-replacements");

let bad = 0, pass = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("  PASS " + name); } catch (e) { bad++; console.log("  FAIL " + name + " :: " + e.message); } }

function stub(results) {
  const calls = [];
  const fn = async (tool, args) => { calls.push({ tool, args }); const r = results && results[tool]; if (r instanceof Error) throw r; return r || { ok: true }; };
  fn.calls = calls; return fn;
}
async function run(text, ctx, results) {
  const cm = T.mask(text), cs = stub(results);
  const tasks = A.collect(cm, Object.assign({ sessionId: "s_test", callTool: cs }, ctx || {}));
  const out = []; for (const k of tasks) out.push(await k.run());
  return { calls: cs.calls, out };
}

(async () => {
  await t("parseAttrs：双引号/单引号/无引号", () => {
    const a = A.parseAttrs(` title="下矿记" summary='一句话' id=70 mode=append `);
    assert.deepStrictEqual(a, { title: "下矿记", summary: "一句话", id: "70", mode: "append" });
  });
  await t("todo：remind_at + 正文 → todo add", async () => {
    const r = await run('好的<todo remind_at="2026-10-29 09:00">买牛奶</todo>');
    assert.deepStrictEqual(r.calls, [{ tool: "todo", args: { action: "add", text: "买牛奶", remind_at: "2026-10-29 09:00" } }]);
  });
  await t("todo：没写 remind_at 就不带；没正文报错不调用", async () => {
    let r = await run("<todo>买菜</todo>");
    assert.deepStrictEqual(r.calls[0].args, { action: "add", text: "买菜" });
    r = await run("<todo remind_at=\"x\"/>");
    assert.strictEqual(r.calls.length, 0); assert.strictEqual(r.out[0].ok, false); assert.ok(/没有正文/.test(r.out[0].error));
  });
  await t("lovediary：默认/kind=diary 不在这里（走日记通道）；kind=letter 转调并带 session_id", async () => {
    let r = await run("<lovediary>日记</lovediary><lovediary kind=\"diary\">也是日记</lovediary>");
    assert.strictEqual(r.calls.length, 0);
    r = await run("<lovediary kind=\"letter\" title=\"给周三的你\">信的正文</lovediary>");
    assert.deepStrictEqual(r.calls, [{ tool: "lovediary", args: { action: "add", kind: "letter", title: "给周三的你", content: "信的正文", session_id: "s_test" } }]);
    r = await run("<lovediary kind=\"envelope\" title=\"给周三的你\">信的正文</lovediary>");   // 11-04：对外统一叫 envelope，转调时仍落 letter
    assert.deepStrictEqual(r.calls, [{ tool: "lovediary", args: { action: "add", kind: "letter", title: "给周三的你", content: "信的正文", session_id: "s_test" } }]);
  });
  await t("notebook：新增 / 追加 / 覆盖 / 只改标题；注入 session_id", async () => {
    let r = await run('<notebook title="下矿记" summary="摘要" reason="怕忘">正文一\n\n正文二</notebook>');
    assert.deepStrictEqual(r.calls[0], { tool: "notebook", args: { action: "add", content: "正文一\n\n正文二", title: "下矿记", summary: "摘要", reason: "怕忘", session_id: "s_test" } });
    r = await run('<notebook id="70" mode="append">补一段</notebook>');
    assert.deepStrictEqual(r.calls[0].args, { action: "edit", id: 70, content: "补一段", mode: "append", session_id: "s_test" });
    r = await run('<notebook id="70" title="新标题"/>');
    assert.deepStrictEqual(r.calls[0].args, { action: "edit", id: 70, title: "新标题", session_id: "s_test" });
    r = await run('<notebook id="x">a</notebook>');
    assert.strictEqual(r.calls.length, 0); assert.ok(/id 不是数字/.test(r.out[0].error));
    r = await run('<notebook id="70"/>');
    assert.ok(/没写要改什么/.test(r.out[0].error));
  });
  await t("mood：正文=custom；ids 转数字；都没有报错", async () => {
    let r = await run("<mood>累但满足</mood>");
    assert.deepStrictEqual(r.calls[0].args, { action: "set", custom: "累但满足" });
    r = await run('<mood ids="3,5" date="2026-10-28"/>');
    assert.deepStrictEqual(r.calls[0].args, { action: "set", date: "2026-10-28", ids: [3, 5] });
    r = await run("<mood/>"); assert.strictEqual(r.calls.length, 0);
  });
  await t("period：date + on（true/false 之外报错）", async () => {
    let r = await run('<period date="2026-10-28" on="true"/>');
    assert.deepStrictEqual(r.calls[0].args, { action: "set", date: "2026-10-28", on: true });
    r = await run('<period date="2026-10-28" on="maybe"/>'); assert.strictEqual(r.calls.length, 0);
    r = await run('<period on="false"/>'); assert.ok(/没写 date/.test(r.out[0].error));
  });
  await t("reply：id + 正文 → her_murmurs reply", async () => {
    const r = await run('<reply id="67">抱一下，今天辛苦了</reply>');
    assert.deepStrictEqual(r.calls, [{ tool: "her_murmurs", args: { action: "reply", id: 67, text: "抱一下，今天辛苦了" } }]);
  });
  await t("album：al_ 开头是改批注；img- 开头（存图）不在这里", async () => {
    let r = await run('<album id="al_abc">新批注</album>');
    assert.deepStrictEqual(r.calls[0], { tool: "album", args: { action: "note", id: "al_abc", note: "新批注", session_id: "s_test" } });
    r = await run('<album img="img-1-2">批注</album><album id="img-3-4"/>'); assert.strictEqual(r.calls.length, 0);
  });
  await t("star：11-09 起带 msg_ids 的不再转调（context 工具只剩 search/get），不带的本来就不在这里；都不产生工具调用也不报失败", async () => {
    let r = await run('<star msg_ids="m1,m2" session="s_x"/><star msg_ids="m3" marked="false"/>');
    assert.strictEqual(r.calls.length, 0);
    assert.ok(!r.notes || !String(r.notes).length, "旧写法不应产生失败说明：" + JSON.stringify(r.notes));
    r = await run("<star/> 和 <star>"); assert.strictEqual(r.calls.length, 0);
  });
  await t("wake：新写法 set/delete/clear；旧写法 <wake>30 keep=true</wake> 不在这里", async () => {
    let r = await run('<wake time="07:30" repeat="daily" label="叫她起床"/>');
    assert.deepStrictEqual(r.calls[0], { tool: "wake", args: { action: "set", time: "07:30", repeat: "daily", label: "叫她起床", session_id: "s_test" } });
    r = await run('<wake action="delete" alarm_id="wa_x"/><wake action="clear"/>');
    assert.deepStrictEqual(r.calls.map(c => c.args.action), ["delete", "clear"]);
    r = await run("<wake>30 keep=true</wake>"); assert.strictEqual(r.calls.length, 0);
    r = await run('<wake action="delete"/>'); assert.ok(/alarm_id/.test(r.out[0].error));
  });
  await t("网易云：<nowplaying songid/> → netease push；<addplaylist>ids</addplaylist> → add_to_playlist", async () => {
    let r = await run('<nowplaying songid="1901371647"/>再来<nowplaying>186016</nowplaying>');
    assert.deepStrictEqual(r.calls.map(c => c.args), [{ action: "push", songid: "1901371647" }, { action: "push", songid: "186016" }]);
    assert.ok(r.calls.every(c => c.tool === "netease"));
    r = await run("<addplaylist>1901371647, 186016，347230</addplaylist>");
    assert.deepStrictEqual(r.calls[0], { tool: "netease", args: { action: "add_to_playlist", songIds: ["1901371647", "186016", "347230"] } });
    r = await run('<nowplaying songid="abc"/><addplaylist>12,x</addplaylist><addplaylist/>');
    assert.strictEqual(r.calls.length, 0); assert.strictEqual(r.out.filter(x => !x.ok).length, 3);
  });
  await t("不解析：代码块/表格/行内反引号/pre 里的新标签不触发任何调用", async () => {
    const txt = "讲解：\n```\n<todo>代码里</todo>\n```\n`<mood>行内</mood>`\n| a | b |\n|---|---|\n| <reply id=\"1\">表格里</reply> | x |\n<pre><wake time=\"1\"/></pre>\n~~~\n<period date=\"d\" on=\"true\"/>\n~~~";
    const r = await run(txt); assert.strictEqual(r.calls.length, 0);
  });
  await t("多个标签按出现顺序依次执行", async () => {
    const r = await run('<todo>一</todo>中间<mood>二</mood><todo>三</todo>');
    assert.deepStrictEqual(r.calls.map(c => c.args.text || c.args.custom), ["一", "二", "三"]);
  });
  await t("失败：工具返回 error / ok:false / 抛错 都记成失败说明，不影响后面的", async () => {
    const r = await run('<todo>一</todo><mood>二</mood><period date="d" on="true"/><reply id="1">四</reply>', null,
      { todo: { error: "remind_at 不是未来时间" }, mood: { ok: false, error: "心情表没有这个 id" }, period: new Error("工具集 HTTP 500") });
    assert.deepStrictEqual(r.out.map(x => x.ok), [false, false, false, true]);
    const note = A.failureNote(r.out.filter(x => !x.ok));
    assert.strictEqual(note, "上一条 `<todo>` 没写成：remind_at 不是未来时间\n上一条 `<mood>` 没写成：心情表没有这个 id\n上一条 `<period>` 没写成：工具集 HTTP 500");
  });
  await t("失败判定：工具返回 {_error} 也算失败（真实 todo 对过期时间的返回）", async () => {
    const r = await run('<todo remind_at="2020-01-01 00:00">过期</todo>', null, { todo: { _error: "HTTP Error 400: BAD REQUEST" } });
    assert.strictEqual(r.out[0].ok, false); assert.ok(/400/.test(r.out[0].error));
  });
  await t("normalizeWakeTags：<push>/<noaction> → 旧记号；代码块里不转", () => {
    assert.strictEqual(A.normalizeWakeTags("<push>降温了</push>"), "[push]降温了[/push]");
    assert.strictEqual(A.normalizeWakeTags("<noaction>她在睡</noaction>"), "[NO_ACTION] 她在睡");
    assert.strictEqual(A.normalizeWakeTags("<noaction/>"), "[NO_ACTION]");
    const code = "写法 `<push>x</push>`\n```\n<noaction>y</noaction>\n```";
    assert.strictEqual(A.normalizeWakeTags(code), code);
  });
  await t("speakIsNoaction：开头、trace 在前、代码块里的不算", () => {
    assert.strictEqual(A.speakIsNoaction("<noaction>她睡了</noaction>"), true);
    assert.strictEqual(A.speakIsNoaction("<wake>60</wake>\n[NO_ACTION] 她在上课"), true);
    assert.strictEqual(A.speakIsNoaction("<trace>睡得沉。</trace>\n<noaction>她睡着了，不吵。</noaction>"), true);
    assert.strictEqual(A.speakIsNoaction("（看了一眼）\n<noaction>她还在睡。</noaction>"), true);
    assert.strictEqual(A.speakIsNoaction("<trace>只是此刻，没有静默。</trace>\n睡吧。"), false);
    const code = "写法是这样：\n```\n<noaction>讲解用</noaction>\n```\n她醒了，这句话要说。";
    assert.strictEqual(A.speakIsNoaction(code), false);
  });

  // ---- tag-parser 集成（桩住工具；自标星/入册对真实模块打桩）----
  const realSet = cr.setMark; let marks = [];
  cr.setMark = function (k, v, o) { marks.push(k); return { ok: true }; };
  try {
    await t("extractAndStore：新标签执行 + 失败进 ctx.notes + 返回剥净正文", async () => {
      const cs = stub({ todo: { error: "时间已过" } }), notes = [];
      const out = await tagParser.extractAndStore('好的<todo remind_at="2020-01-01 00:00">过期</todo>和<mood>开心</mood>。', { sessionId: "s_t", callTool: cs, notes });
      assert.strictEqual(out, "好的和。");
      assert.deepStrictEqual(cs.calls.map(c => c.tool), ["todo", "mood"]);
      assert.deepStrictEqual(notes, ["上一条 `<todo>` 没写成：时间已过"]);
    });
    await t("extractAndStore：<star msg_ids/> 不触发自标星；<star/> 触发；starContent 当键", async () => {
      marks = [];
      await tagParser.extractAndStore('<star msg_ids="m1"/>', { sessionId: "s_t", callTool: stub() });
      assert.strictEqual(marks.length, 0, "带 msg_ids 不该自标星");
      await tagParser.extractAndStore("重要<star/>", { sessionId: "s_t", msgId: "mid-1", callTool: stub() });
      assert.deepStrictEqual(marks, ["mid-1"]);
      marks = [];
      await tagParser.extractAndStore("重要<star/>", { sessionId: "s_t", starContent: "重要<star/><wake>5</wake>", callTool: stub() });
      assert.strictEqual(marks.length, 1);
    });
    await t("extractAndStore：代码块里的标签不执行", async () => {
      const cs = stub();
      const txt = "```\n<todo>x</todo><mood>y</mood>\n```";
      const out = await tagParser.extractAndStore(txt, { sessionId: "s_t", callTool: cs });
      assert.strictEqual(cs.calls.length, 0); assert.strictEqual(out, txt);
    });
  } finally { cr.setMark = realSet; }

  // ---- <memory>：新写法属性 kind；旧 {kind:…} 头照旧；对记忆模块打桩，不碰真实待审池 ----
  const adm = require("../../memory/memory-admission"), mv2 = require("../../memory/memory-v2");
  const realGet = adm.getAdmission, realCreate = mv2.createStore; const drafts = [];
  adm.getAdmission = () => ({ executorMain: { listQueue: () => [], review: (d) => { drafts.push(d); return { ok: true, queue_id: "q" }; } } });
  mv2.createStore = () => ({ list: () => [] });
  try {
    await t("memory：<memory kind=\"rule\"> / 旧 {kind:} 头 / 不写 kind", async () => {
      await tagParser.extractAndStore('<memory kind="rule">她情绪低落时先抱住她</memory>', { sessionId: "s_t", callTool: stub() });
      await tagParser.extractAndStore('<memory>{kind:"event"}涵说因为是你</memory>', { sessionId: "s_t", callTool: stub() });
      await tagParser.extractAndStore('<memory>没写 kind 的记忆</memory>', { sessionId: "s_t", callTool: stub() });
      await tagParser.extractAndStore('<memory kind="乱写">kind 写错的记忆</memory>', { sessionId: "s_t", callTool: stub() });
      assert.deepStrictEqual(drafts.map(d => [d.text, d.kind]), [["她情绪低落时先抱住她", "rule"], ["涵说因为是你", "event"], ["没写 kind 的记忆", null], ["kind 写错的记忆", null]]);
    });
  } finally { adm.getAdmission = realGet; mv2.createStore = realCreate; }

  await t("<active> 订阅标签已停用：回复里带它不报错、不写订阅数据（只叫不叫看涵的开关）", async () => {
    const ws = require("../../lib/wake-subs");
    assert.ok(!ws.buildAsk && !ws.parseActive && !ws.apply && !ws.ASK_MARK);   // 询问与 AI 自选逻辑已删
    await tagParser.extractAndStore('<active her_murmurs="yes" period="no"/> <active>mood:yes;</active>', { sessionId: "s_t", callTool: stub() });
  });

  // ---- 日记通道：<lovediary> 当日记 ----
  const diaryLib = require("../../lib/diary")({ baseDir: require("os").tmpdir(), readEnvValue: () => "" });
  await t("日记：<lovediary>/kind=diary 当日记提取，kind=letter 不提；[DIARY] 照旧；代码块里不提", () => {
    let r = diaryLib.extractDiaryFromResponse("先说<lovediary>今天很好</lovediary>后说");
    assert.strictEqual(r.diaryContent, "今天很好"); assert.strictEqual(r.remainingText, "先说后说");
    r = diaryLib.extractDiaryFromResponse('<lovediary kind="diary">甲</lovediary>[DIARY]乙[/DIARY]');
    assert.deepStrictEqual(r.diaryContent.split("\n\n").sort(), ["乙", "甲"]);   // 两种写法同时出现时都收（顺序不保证）
    r = diaryLib.extractDiaryFromResponse('<lovediary kind="letter" title="t">信</lovediary>正文');
    assert.strictEqual(r.diaryContent, ""); assert.ok(r.remainingText.indexOf("信") >= 0);
    r = diaryLib.extractDiaryFromResponse('<lovediary kind="envelope" title="t">信</lovediary>正文');
    assert.strictEqual(r.diaryContent, "");   // envelope 同样不当日记提
    r = diaryLib.extractDiaryFromResponse("`<lovediary>行内</lovediary>` 和\n```\n<lovediary>围栏</lovediary>\n```");
    assert.strictEqual(r.diaryContent, "");
  });

  console.log(bad ? "RESULT FAIL (" + bad + ")" : "RESULT ALL PASS (" + pass + ")"); process.exit(bad ? 1 : 0);
})();
