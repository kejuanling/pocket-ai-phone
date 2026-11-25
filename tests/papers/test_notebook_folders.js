"use strict";
// [位置:tests/papers/test_notebook_folders.js] [笔记本文件夹：新建/嵌套/重命名/删除（只能删空）/移动笔记/新建时放进文件夹/目录笔记不能动/搜索与列表带 folder；移动不刷新更新时间] [10-28] [注释时间 2026-10-28]
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), os = require("os"), path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "papers-folders-"));
process.env.PAPERS_BASE_DIR = tmp;
const papers = require("../../lib/papers");
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const note = (t, folder) => { const r = papers.portalAdd({ content: "正文 " + t, title: t, folder }); assert.ok(r.ok, JSON.stringify(r)); return r.id; };

test("文件夹：新建、嵌套、重名/上级不存在/非法名字", () => {
  assert.deepEqual(papers.portalFolders(), []);
  assert.ok(papers.portalFolderAdd("故事").ok);
  assert.ok(papers.portalFolderAdd("故事/第一卷").ok);
  assert.equal(papers.portalFolderAdd("故事").ok, false);
  assert.equal(papers.portalFolderAdd("没有上级/子").ok, false);
  for (const bad of ["", "  ", "a/../b", "..", "x".repeat(31), "a\\b", "1/2/3/4/5/6"]) assert.equal(papers.portalFolderAdd(bad).ok, false, "应拒绝：" + bad);
  assert.deepEqual(papers.portalFolders(), ["故事", "故事/第一卷"]);
});

test("新建笔记放进文件夹；列表带 folder；不存在的文件夹也能放（自动出现）", () => {
  const a = note("A", "故事/第一卷"), b = note("B");
  const list = papers.portalList();
  assert.equal(list.find(n => n.id === a).folder, "故事/第一卷");
  assert.equal(list.find(n => n.id === b).folder, "");
  assert.equal(papers.portalAdd({ content: "x", title: "坏", folder: "../x" }).ok, false);
  assert.equal(papers.portalRead(a).folder, "故事/第一卷");
  const c = note("C", "新来的/子");
  assert.ok(papers.portalFolders().includes("新来的") && papers.portalFolders().includes("新来的/子"), "笔记所在文件夹及其上级自动算文件夹");
  assert.ok(c);
});

test("移动笔记：不刷新更新时间；目标不存在/目录笔记拒绝", () => {
  const id = note("要搬的", "");
  const before = papers.portalRead(id).updated_at;
  const r = papers.portalMove(id, "故事");
  assert.ok(r.ok && papers.portalRead(id).folder === "故事");
  assert.equal(papers.portalRead(id).updated_at, before);
  assert.ok(papers.portalMove(id, "").ok && papers.portalRead(id).folder === "");
  assert.equal(papers.portalMove(id, "不存在").ok, false);
  assert.equal(papers.portalMove(99999, "故事").ok, false);
  const idx = papers.portalList().find(n => n.is_index);
  assert.ok(idx && idx.folder === "");
  assert.equal(papers.portalMove(idx.id, "故事").ok, false);
});

test("编辑时顺带改文件夹；只改文件夹视为未改内容", () => {
  const id = note("编辑", "故事");
  const r = papers.portalUpdate({ id, folder: "故事/第一卷" });
  assert.ok(r.ok && r.unchanged);
  assert.equal(papers.portalRead(id).folder, "故事/第一卷");
  const r2 = papers.portalUpdate({ id, title: "编辑后", folder: "" });
  assert.ok(r2.ok && papers.portalRead(id).folder === "" && papers.portalRead(id).title === "编辑后");
  assert.equal(papers.portalUpdate({ id, folder: "不存在" }).ok, false);
});

test("重命名：笔记和子文件夹跟着走；重名/不存在拒绝", () => {
  const id = note("里面的", "故事/第一卷");
  const r = papers.portalFolderRename("故事", "小说");
  assert.ok(r.ok && r.path === "小说");
  assert.equal(papers.portalRead(id).folder, "小说/第一卷");
  assert.ok(papers.portalFolders().includes("小说/第一卷") && !papers.portalFolders().includes("故事"));
  assert.equal(papers.portalFolderRename("小说", "新来的").ok, false, "重名");
  assert.equal(papers.portalFolderRename("没有", "x").ok, false);
  assert.equal(papers.portalFolderRename("小说", "a/b").ok, false);
  assert.ok(papers.portalFolderRename("小说", "小说").unchanged);
});

test("删除文件夹：只能删空的", () => {
  assert.ok(papers.portalFolderAdd("空的").ok);
  assert.equal(papers.portalFolderDelete("小说").ok, false, "有子文件夹/笔记");
  assert.equal(papers.portalFolderDelete("小说/第一卷").ok, false, "里面有笔记");
  assert.ok(papers.portalFolderDelete("空的").ok);
  assert.ok(!papers.portalFolders().includes("空的"));
  assert.equal(papers.portalFolderDelete("空的").ok, false);
});

test("搜索结果带 folder；删除笔记后文件夹仍在（显式建的）", () => {
  const hits = papers.portalSearch("里面的");
  assert.ok(hits.length && hits[0].folder === "小说/第一卷");
  assert.ok(papers.portalFolderAdd("留着").ok);
  const id = note("临时", "留着");
  papers.portalDelete(id);
  assert.ok(papers.portalFolders().includes("留着"));
});

/* ── 2026-10-29 文件夹摘要 + fid + AI 工具的文件夹支持（产品确定）── */

test("文件夹摘要：设置/更新/清空；fid 与 count；重命名跟随、删除清掉", () => {
  assert.ok(papers.portalFolderAdd("杂记").ok);
  const r = papers.portalFolderSummary("杂记", "  零碎的\n东西 ");
  assert.ok(r.ok && r.summary === "零碎的 东西", "摘要折成一行");
  const b1 = papers.portalFoldersBrief().find(f => f.path === "杂记");
  assert.equal(b1.summary, "零碎的 东西");
  assert.match(b1.fid, /^f\d+$/, "fid 编号");
  note("树里的", "杂记");
  assert.equal(papers.portalFoldersBrief().find(f => f.path === "杂记").count, 1, "count 含子文件夹");
  assert.equal(papers.portalFolderSummary("没有的", "x").ok, false, "不存在的文件夹拒绝");
  assert.ok(papers.portalFolderSummary("杂记", "").ok, "空串=清掉");
  assert.equal(papers.portalFoldersBrief().find(f => f.path === "杂记").summary, "");
  papers.portalFolderSummary("杂记", "又有了");
  assert.ok(papers.portalFolderRename("杂记", "随笔").ok);
  assert.equal(papers.portalFoldersBrief().find(f => f.path === "随笔").summary, "又有了", "重命名后摘要跟着路径走");
  assert.ok(!papers.portalFoldersBrief().some(f => f.path === "杂记"));
});

test("逐级建文件夹：一条建两层，已存在不报错", () => {
  assert.ok(papers.portalFolderAddDeep("深处/第二层").ok);
  assert.ok(papers.portalFolders().includes("深处") && papers.portalFolders().includes("深处/第二层"));
  assert.ok(papers.portalFolderAddDeep("深处/第二层").ok, "已存在的层跳过不报错");
  assert.equal(papers.portalFolderAddDeep("a\\b").ok, false);
});

test("queryPapers 按 folder 过滤（直属）；brief 带 folder；不存在报错；概览带文件夹清单", () => {
  const a = note("深处笔记", "深处/第二层");
  const q = papers.queryPapers({ folder: "深处/第二层" });
  assert.equal(q.total, 1);
  assert.equal(q.items[0].id, a);
  assert.equal(q.items[0].folder, "深处/第二层");
  assert.equal(papers.queryPapers({ folder: "深处" }).total, 0, "直属不含子文件夹里的");
  assert.ok(papers.queryPapers({ folder: "不存在的" }).error, "不存在的文件夹报错");
  const ov = papers.categoryOverview();
  assert.ok(Array.isArray(ov.folders) && ov.folders.length > 0 && ov.folders.every(f => /^f\d+$/.test(f.fid) && f.path), "概览带 fid 清单");
});
