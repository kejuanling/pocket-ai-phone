"use strict";

// [位置:tests/papers/test_paper_split.js] [笔记本单篇 20000 上限 + 自动拆篇] [11-16：原 30000 上限且新增静默截断，改成 20000 上限、超出自动拆成多篇；摘要 120→500；目录行摘要显示 80→200] [注释时间 2026-11-16]
// 全程临时目录（PAPERS_BASE_DIR），不碰线上 data/papers.json。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "papers-split-"));
process.env.PAPERS_BASE_DIR = tmp;
const papers = require("../../lib/papers");
const paperStore = require("../../lib/paper-store");

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const MAX = papers.MAX_PAPER_CHARS;

// 取一条笔记的正文（去掉自动加的「# 标题」行与「（日期 时间）」行）
function bodyOf(id) {
  const e = paperStore.getEntry(tmp, id);
  return String(e.content || "").replace(/^#[^\n]*\n\n/, "").replace(/^（[^）]*）\n\n/, "").replace(/\s+$/, "");
}

test("上限常量是 20000", () => {
  assert.equal(MAX, 20000);
});

test("边界：19999 / 20000 不拆，20001 拆两篇且标题带·1·2", () => {
  const a = papers.savePaper({ title: "边界一", content: "a".repeat(19999) });
  assert.equal(a.ok, true);
  assert.equal(a.parts, 1);
  assert.equal(a.ids.length, 1);
  assert.equal(a.title, "边界一");
  assert.equal(bodyOf(a.id).length, 19999);

  const b = papers.savePaper({ title: "边界二", content: "b".repeat(20000) });
  assert.equal(b.parts, 1);

  const c = papers.savePaper({ title: "边界三", content: "c".repeat(20001) });
  assert.equal(c.ok, true);
  assert.equal(c.parts, 2);
  assert.deepEqual(c.ids.length, 2);
  assert.deepEqual(c.titles, ["边界三·1", "边界三·2"]);
  assert.equal(c.id, c.ids[0]);
  assert.equal(bodyOf(c.ids[0]).length, 20000);
  assert.equal(bodyOf(c.ids[1]).length, 1);
});

test("45000 字拆三篇、每篇不超上限；摘要分配：首篇原文，后续「标题 第N/M部分」", () => {
  const r = papers.savePaper({ title: "长连载", summary: "总摘要", content: "d".repeat(45000) });
  assert.equal(r.parts, 3);
  assert.equal(r.ids.length, 3);
  assert.deepEqual(r.titles, ["长连载·1", "长连载·2", "长连载·3"]);
  const chunks = r.ids.map(bodyOf);
  assert.deepEqual(chunks.map(s => s.length), [20000, 20000, 5000]);
  assert.equal(paperStore.getEntry(tmp, r.ids[0]).summary, "总摘要");
  assert.equal(paperStore.getEntry(tmp, r.ids[1]).summary, "长连载 第2/3部分");
  assert.equal(paperStore.getEntry(tmp, r.ids[2]).summary, "长连载 第3/3部分");
  // 标题行也真的写进去了
  assert.match(paperStore.getEntry(tmp, r.ids[1]).content, /^# 长连载·2\n\n（/);
});

test("folder / reason / tags 每篇各复制一份（portalAdd 入口）", () => {
  const r = papers.portalAdd({ title: "带文件夹的长篇", content: "e".repeat(41000), reason: "拆篇测试", folder: "拆篇/验证", tags: ["标签甲"] });
  assert.equal(r.ok, true);
  assert.equal(r.parts, 3);
  for (const id of r.ids) {
    const e = paperStore.getEntry(tmp, id);
    assert.equal(e.reason, "拆篇测试");
    assert.deepEqual(e.tags, ["标签甲"]);
    assert.equal(e.folder, "拆篇/验证");
  }
});

test("切点不在 ``` 代码块内部（每篇代码块都闭合）", () => {
  const head = "字".repeat(19000);
  const fence = "\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\n";
  const tail = "文".repeat(3000);
  const r = papers.savePaper({ title: "代码块", content: head + fence + tail });
  assert.equal(r.parts, 2);
  for (const id of r.ids) {
    const b = bodyOf(id);
    assert.equal((b.match(/```/g) || []).length % 2, 0);   // 没有半截代码块
  }
  // 一段跨过 20000 边界的巨型代码块：切点退到块起点，块完整留在后一篇
  const big = "甲".repeat(12000) + "\n\n```\n" + "乙".repeat(16000) + "\n```\n\n" + "丙".repeat(2000);
  const r2 = papers.savePaper({ title: "巨型代码块", content: big });
  const b1 = bodyOf(r2.ids[0]);
  assert.equal((b1.match(/```/g) || []).length, 0);
  assert.equal(b1.length, 12000);
});

test("追加超上限：整篇重拆，第一篇沿用原 id，续篇标题·2", () => {
  const first = papers.portalAdd({ title: "连载追加", content: "f".repeat(15000), folder: "连载", reason: "追加" });
  assert.equal(first.parts, 1);
  const e = papers.editPaper({ id: first.id, content: "g".repeat(6000), mode: "append" });
  assert.equal(e.ok, true);
  assert.equal(e.parts, 2);
  assert.equal(e.id, first.id);                            // 第一篇 id 不变
  assert.equal(e.ids[0], first.id);
  assert.equal(bodyOf(first.id).length <= MAX, true);
  assert.equal(bodyOf(e.ids[1]).length <= MAX, true);
  const second = paperStore.getEntry(tmp, e.ids[1]);
  assert.equal(second.title, "连载追加·2");
  assert.equal(second.folder, "连载");
  assert.equal(second.reason, "追加");
  assert.match(second.summary, /第2部分/);
  // 内容没丢：两篇正文长度加起来 ≈ 21000
  const total = bodyOf(first.id).length + bodyOf(e.ids[1]).length;
  assert.equal(total >= 21000 - 20, true);
});

test("整篇覆盖超上限：保持报错，不写入", () => {
  const a = papers.savePaper({ title: "覆盖", content: "原有正文" });
  const r = papers.editPaper({ id: a.id, content: "h".repeat(20001), mode: "replace" });
  assert.equal(r.ok, false);
  assert.match(r.error, /20000/);
  assert.equal(bodyOf(a.id), "原有正文");
});

test("摘要上限 500：501 字被截到 500", () => {
  const r = papers.savePaper({ title: "摘要边界", summary: "s".repeat(501), content: "正文" });
  assert.equal(paperStore.getEntry(tmp, r.id).summary.length, 500);
});

test("目录行摘要显示 200 字（原来是 80）", () => {
  const r = papers.savePaper({ title: "目录宽度", summary: Array.from({ length: 300 }, (_, i) => String(i % 10)).join(""), content: "正文" });
  const row = papers.indexLines(80).find(x => String(x).startsWith(r.id + "｜"));
  assert.equal(!!row, true);
  const sum = String(row).split("｜")[2];
  assert.equal(sum.length, 200);
});

test("splitBody 是纯函数，单篇输入原样返回", () => {
  const t = "短正文";
  assert.deepEqual(papers.splitBody(t, MAX), [t]);
});
