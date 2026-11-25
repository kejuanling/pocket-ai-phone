"use strict";

// 2026-10-16：reason 字段 + Notebook Index 注入块（目录行、builder、会话多选 key）。
// 全程临时目录（PAPERS_BASE_DIR），不碰线上 data/papers.json。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "papers-idx-"));
process.env.PAPERS_BASE_DIR = tmp;
const papers = require("../../lib/papers");
const paperStore = require("../../lib/paper-store");
const { buildContextBlocks, BLOCK_DEFS } = require("../../context/context-v2-builder");
const { createSessionCfg } = require("../../lib/session-cfg");

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test("空本子：indexLines 返回 []，builder 不产出 notebook_index", () => {
  assert.deepEqual(papers.indexLines(10), []);
  const r = buildContextBlocks({ notebookLines: papers.indexLines(10) });
  assert.equal(r.blocks.some(b => b.key === "notebook_index"), false);
});

test("reason：保存、单行化、截 200 字、可单独 edit、可被 q 搜到", () => {
  const long = "x".repeat(300);
  const a = papers.savePaper({ title: "排查记录", category: "技术笔记", reason: "  上次\n踩过  \n  这个坑 ", content: "nginx 502 是 upstream 超时" });
  assert.equal(a.ok, true);
  assert.equal(a.reason, "上次 踩过 这个坑");
  assert.equal(paperStore.getEntry(tmp, a.id).reason, "上次 踩过 这个坑");
  const b = papers.savePaper({ title: "长原因", reason: long, content: "正文" });
  assert.equal(paperStore.getEntry(tmp, b.id).reason.length, 200);
  // 只改 reason，不动正文
  const before = paperStore.getEntry(tmp, a.id).content;
  const e = papers.editPaper({ id: a.id, reason: "改个原因" });
  assert.equal(e.ok, true);
  assert.equal(e.reason, "改个原因");
  assert.equal(paperStore.getEntry(tmp, a.id).content, before);
  // 历史里留了旧 reason
  const hist = paperStore.listHistory(tmp, a.id);
  assert.equal(hist[hist.length - 1].paper_reason, "上次 踩过 这个坑");
  assert.equal(hist[hist.length - 1].reason, "meta");
  // q 能搜到 reason
  const q = papers.queryPapers({ q: "改个原因" });
  assert.equal(q.total, 1);
  assert.equal(q.items[0].reason, "改个原因");
  // 什么都不给仍报错，且提示里有 reason
  const none = papers.editPaper({ id: a.id });
  assert.equal(none.ok, false);
  assert.match(none.error, /reason/);
});

test("没有 reason 的老条目：不报错，返回空串", () => {
  const id = paperStore.addEntry(tmp, { title: "旧纸", tags: [], content: "旧纸正文" });
  assert.equal(papers.queryPapers({ q: "旧纸正文" }).items[0].reason, "");
  assert.equal(paperStore.getEntry(tmp, id).reason, "");
});

test("indexLines：树形目录——文件夹段 fid 行 + 根目录文件段（新到旧），行不带更新时间", () => {
  for (let i = 0; i < 9; i++) {
    papers.savePaper({ title: "岛志" + i, category: "岛志", summary: "摘要" + i, content: "内容" + i });
  }
  assert.ok(papers.portalFolderAdd("故事").ok);
  assert.ok(papers.portalFolderSummary("故事", "给涵写的小说").ok);
  const lines = papers.indexLines(10);
  assert.equal(lines[0], "这是你的笔记本目录（文件夹+根目录文件）。");   // 2026-11-03：快照/重建说法与格式解释已删
  assert.match(lines[1], /^1 个文件夹、共 \d+ 篇。$/);
  const fi = lines.indexOf("文件夹：");
  assert.ok(fi > 0, "有文件夹段");
  assert.equal(lines[fi + 1], "f1｜故事｜给涵写的小说");   // 2026-11-21：文件夹默认折叠，行带摘要 fid｜路径｜摘要
  const ri = lines.findIndex(l => /^根目录文件（\d+ 篇）：$/.test(l));
  assert.ok(ri > fi, "文件段在文件夹段后面");
  const items = lines.slice(ri + 1, ri + 11);
  assert.equal(items.length, 10);
  assert.match(items[0], /^\d+｜岛志8｜摘要8$/, "行= id｜标题｜摘要，没有时间列");
  const idsDesc = items.map(l => Number(l.split("｜")[0]));
  assert.deepEqual(idsDesc, idsDesc.slice().sort((x, y) => y - x));
  assert.match(lines[lines.length - 1], /notebook action=list/);
});

test("indexLines：文件夹默认折叠；单篇开启 show_in_index 后缩进显示 id｜标题｜摘要；syncIndexNote 同款", () => {
  assert.ok(papers.portalFolderAddDeep("故事/第一卷").ok);
  const n1 = papers.portalAdd({ title: "卷内稿", folder: "故事", summary: "卷内摘要", content: "x" });
  const n2 = papers.portalAdd({ title: "卷内隐藏稿", folder: "故事", summary: "不显示", content: "y" });
  assert.ok(n1.ok && n2.ok);
  // 默认折叠：文件夹内两篇都不进目录
  let lines = papers.indexLines(10);
  const fi0 = lines.indexOf("文件夹：");
  assert.equal(lines[fi0 + 1], "f1｜故事｜给涵写的小说");
  assert.equal(lines[fi0 + 2], "　f2｜故事/第一卷｜无");
  assert.ok(!lines.some(l => l.includes("卷内稿")), "默认关闭目录显示，不出现在文件夹下");
  assert.ok(!lines.some(l => l.includes("卷内隐藏稿")));
  // 单独开启 n1 的目录显示
  assert.equal(papers.setShowInIndex(n1.id, true).ok, true);
  lines = papers.indexLines(10);
  const f1i = lines.indexOf("f1｜故事｜给涵写的小说");
  assert.equal(lines[f1i + 1], "　" + n1.id + "｜卷内稿｜卷内摘要", "开启目录显示后缩进列在文件夹下且带摘要");
  assert.ok(!lines.some(l => l.includes("卷内隐藏稿")), "未开启的仍隐藏");
  const f2i = lines.indexOf("　f2｜故事/第一卷｜无");
  assert.ok(f2i > f1i + 1, "子文件夹行在其后");
  // 目录笔记（真实笔记）内容同款
  const idx = paperStore.listEntries(tmp).find(e => e.is_index);
  assert.ok(idx.content.includes("文件夹（2 个）："));
  assert.ok(idx.content.includes("f1｜故事｜给涵写的小说"));
  assert.ok(idx.content.includes("　" + n1.id + "｜卷内稿｜卷内摘要"));
  assert.ok(!idx.content.includes("卷内隐藏稿"));
  assert.ok(idx.content.includes("　f2｜故事/第一卷｜无"));
  assert.ok(idx.content.includes("根目录文件（"));
});

test("editPaper：支持 old+new 局部替换、唯一性校验与 replace_all", () => {
  const r = papers.savePaper({ title: "局部替换测试", content: "第一行 foo\n第二行 bar\n第三行 foo" });
  assert.ok(r.ok);
  // 命中多处且未传 replace_all → 报错
  const multi = papers.editPaper({ id: r.id, old: "foo", new: "baz" });
  assert.equal(multi.ok, false);
  assert.match(multi.error, /2 处/);
  // 未命中 → 报错
  const miss = papers.editPaper({ id: r.id, old: "不存在的句子", new: "x" });
  assert.equal(miss.ok, false);
  assert.match(miss.error, /找不到/);
  // 精确唯一命中替换
  const one = papers.editPaper({ id: r.id, old: "第二行 bar", new: "第二行 BAR" });
  assert.equal(one.ok, true);
  assert.equal(one.mode, "patch");
  assert.ok(paperStore.getEntry(tmp, r.id).content.includes("第二行 BAR"));
  // replace_all=true 全部替换
  const all = papers.editPaper({ id: r.id, old: "foo", new: "FOO", replace_all: true });
  assert.equal(all.ok, true);
  const txt = paperStore.getEntry(tmp, r.id).content;
  assert.ok(txt.includes("第一行 FOO") && txt.includes("第三行 FOO") && !txt.includes("foo"));
  // 历史记录已留存
  const hist = paperStore.listHistory(tmp, r.id);
  assert.ok(hist.some(h => h.reason === "patch"));
});

test("notebook-meta：JSON 解析与改动说明拼装", () => {
  const nm = require("../../lib/notebook-meta");
  const p = nm.parseMetaJSON('```json\n{"summary": "聊到旅行计划时翻看，记录了京都行程要点。", "tags": ["京都", "旅行", "京都"]}\n```');
  assert.equal(p.summary, "聊到旅行计划时翻看，记录了京都行程要点。");
  assert.deepEqual(p.tags, ["京都", "旅行"]);
  const msg = nm.buildUserMessage({
    title: "测试笔记",
    folder: "旅行",
    body: "正文",
    change: { type: "patch", old: "旧句", new: "新句" },
    hintSummary: "参考摘要",
    prevSummary: "原摘要",
    prevTags: ["旧词"],
  });
  assert.ok(msg.includes("局部替换") && msg.includes("旧句") && msg.includes("新句") && msg.includes("参考摘要"));
});

test("indexLines：无标题显示「无」，标题超长截 60 字", () => {
  papers.savePaper({ content: "没有标题的一篇" });
  papers.savePaper({ title: "长".repeat(100), content: "长标题" });
  const lines = papers.indexLines(3);
  const items = lines.filter(l => /^\d+｜/.test(l));
  assert.ok(items.some(l => /｜无｜/.test(l)), "无标题显示「无」");
  assert.ok(items.some(l => l.includes("｜" + "长".repeat(60) + "｜")));
  assert.ok(items.every(l => !l.includes("长".repeat(61))));
});

test("builder：notebook_index 产出带标题的块，排在 starred_dialog 之后、relevant_memories 之前", () => {
  const keys = BLOCK_DEFS.map(d => d.key);
  assert.ok(keys.indexOf("notebook_index") === keys.indexOf("starred_dialog") + 1);
  assert.ok(keys.indexOf("notebook_index") < keys.indexOf("relevant_memories"));
  const r = buildContextBlocks({ starredLines: ["一条标星"], notebookLines: papers.indexLines(10) });
  const order = r.blocks.map(b => b.key);
  assert.ok(order.indexOf("notebook_index") > order.indexOf("starred_dialog"));
  const nb = r.blocks.find(b => b.key === "notebook_index");
  assert.ok(nb.content.startsWith("## Notebook Index\n这是你的笔记本目录"));
  assert.equal(nb.empty, false);
});

test("会话多选：notebook_index 是合法 key，默认不勾", () => {
  const cfg = createSessionCfg(tmp);
  assert.ok(cfg.ALL_INJECT_BLOCKS.includes("notebook_index"));
  assert.ok(!cfg.DEFAULT_INJECT_BLOCKS.includes("notebook_index"));
  const norm = cfg.normalizeInjectBlocks(["core_identity", "notebook_index", "bogus"]);
  assert.ok(norm.includes("notebook_index"));
  assert.ok(!norm.includes("bogus"));
  assert.ok(norm.includes("system_instructions") && norm.includes("state_machine"));
});

test("只改分类/标签/原因不动 updated_at；改正文或标题才更新", async () => {
  const r = papers.savePaper({ title: "日期测试", content: "原文" });
  const t0 = paperStore.getEntry(tmp, r.id).updated_at;
  await new Promise(res => setTimeout(res, 15));
  assert.equal(papers.editPaper({ id: r.id, category: "岛志", reason: "补", tags: ["a"] }).ok, true);
  assert.equal(paperStore.getEntry(tmp, r.id).updated_at, t0);
  await new Promise(res => setTimeout(res, 15));
  assert.equal(papers.editPaper({ id: r.id, content: "补一句" }).ok, true);
  const t1 = paperStore.getEntry(tmp, r.id).updated_at;
  assert.ok(t1 > t0);
  await new Promise(res => setTimeout(res, 15));
  assert.equal(papers.editPaper({ id: r.id, title: "新标题" }).ok, true);
  assert.ok(paperStore.getEntry(tmp, r.id).updated_at > t1);
});

test("「最近」按更新时间排：带旧日期的迁入纸不会因为 id 大就排到最前", () => {
  const old = paperStore.addEntry(tmp, { title: "迁入的旧纸", category: "晨午报", content: "旧", created_at: "2026-07-22T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z" });
  const fresh = papers.savePaper({ title: "刚写的新纸", content: "新" });
  assert.ok(old < fresh.id);
  const newerId = paperStore.addEntry(tmp, { title: "更大id但更旧", content: "x", created_at: "2026-07-23T00:00:00.000Z", updated_at: "2026-07-23T00:00:00.000Z" });
  assert.ok(newerId > fresh.id);
  const o = papers.categoryOverview();
  assert.equal(o.recent[0].id, fresh.id);
  const q = papers.queryPapers({ limit: 50 }).items.map(i => i.id);
  assert.ok(q.indexOf(fresh.id) < q.indexOf(newerId));
  assert.ok(q.indexOf(newerId) < q.indexOf(old));
  const lines = papers.indexLines(50);
  const idx = lines.map(l => l.split("｜")[0]);
  assert.ok(idx.indexOf(String(fresh.id)) < idx.indexOf(String(newerId)));
  assert.ok(papers.listPapers().map(p => p.id).indexOf(fresh.id) < papers.listPapers().map(p => p.id).indexOf(old));
});

test("portalIndexRefresh：目录被动过后刷新修正、再刷 unchanged，id 指向目录笔记（涵 10-29 刷新按钮）", () => {
  // 写操作本来就自动重写目录，所以刷新的真实用途=目录被动过/格式没跟上时的兜底：手动弄脏再刷
  const idx = paperStore.listEntries(tmp).find(e => e.is_index);
  paperStore.updateEntry(tmp, idx.id, { content: idx.content + "某行旧格式的残留\n" }, { reason: "meta" });
  const r1 = papers.portalIndexRefresh();
  assert.ok(r1.ok && r1.changed === true && r1.id === idx.id);
  assert.ok(!paperStore.getEntry(tmp, idx.id).content.includes("某行旧格式的残留"), "刷新把目录修正回系统生成的样子");
  const r2 = papers.portalIndexRefresh();
  assert.ok(r2.ok && r2.changed === false && r2.id === idx.id, "内容没变不算改");
});
