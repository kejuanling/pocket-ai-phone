"use strict";

// <paper title="标题">内容</paper>：只存包住的内容；标题一样追加、不一样新增。
// 全程使用临时目录（PAPERS_BASE_DIR），不碰线上 data/papers.json。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paper-tag-"));
process.env.PAPERS_BASE_DIR = tmp;
const { extractAndStore, stripTags, parsePaperTitle } = require("../../lib/tag-parser");
const papers = require("../../lib/papers");
const paperStore = require("../../lib/paper-store");

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const all = () => paperStore.listEntries(tmp).filter(e => !e.is_index);   // 10-29 起每次保存会自动生成一张目录笔记，计数测试要排除它（2026-11-01 对齐）

test("parsePaperTitle：双引号/单引号/无引号，没写返回空", () => {
  assert.equal(parsePaperTitle(' title="连载"'), "连载");
  assert.equal(parsePaperTitle(" title='a b' "), "a b");
  assert.equal(parsePaperTitle(" title=单词"), "单词");
  assert.equal(parsePaperTitle(""), "");
});

test("stripTags：成对 <paper> 去掉标记保留正文；自闭合/孤立标记去掉", () => {
  assert.equal(stripTags('前<paper title="连载">第一章。</paper>后'), "前第一章。后");
  assert.equal(stripTags('正文<paper title="x"/>继续<paper/>末'), "正文继续末");
  assert.equal(stripTags("孤立</paper>和<paper>内容"), "孤立和内容");
});

test("包起来：只有包住的内容进纸，气泡正文完整保留", async () => {
  const reply = '今天的闲聊不入纸。<paper title="小说">只存这一段。</paper>这句也不入纸。';
  const clean = await extractAndStore(reply, {});
  assert.equal(all().length, 1);
  const e = papers.findByTitle("小说");
  assert.match(e.content, /只存这一段/);
  assert.doesNotMatch(e.content, /闲聊|这句也不入纸/);
  assert.equal(clean, "今天的闲聊不入纸。只存这一段。这句也不入纸。");
});

test("标题一样：追加到同一张，不新增，标题不变", async () => {
  await extractAndStore('<paper title="小说">第二段。</paper>', {});
  assert.equal(all().length, 1);
  const e = papers.findByTitle("小说");
  assert.match(e.content, /只存这一段[\s\S]*第二段/);
  assert.equal(e.title, "小说");
});

test("标题不一样：新增一张", async () => {
  await extractAndStore('<paper title="散文">另一篇。</paper>', {});
  assert.equal(all().length, 2);
  assert.match(papers.findByTitle("散文").content, /另一篇/);
  assert.doesNotMatch(papers.findByTitle("小说").content, /另一篇/);
});

test("一条回复包多段：各存各的；同回复里同标题的接着追加", async () => {
  await extractAndStore('<paper title="甲">甲一</paper>中间<paper title="乙">乙一</paper><paper title="甲">甲二</paper>', {});
  assert.equal(all().length, 4);
  assert.match(papers.findByTitle("甲").content, /甲一[\s\S]*甲二/);
  assert.match(papers.findByTitle("乙").content, /乙一/);
});

test("没写标题：照存为无标题新纸，不会被追加", async () => {
  const before = all().length;
  await extractAndStore("<paper>没标题的内容</paper>", {});
  await extractAndStore("<paper>另一段没标题的内容</paper>", {});
  assert.equal(all().length, before + 2);
});

test("自闭合 <paper/> 或包空内容：不存纸", async () => {
  const before = all().length;
  await extractAndStore('整条回复。<paper title="空"/>', {});
  await extractAndStore('整条回复。<paper title="空2"></paper>', {});
  assert.equal(all().length, before);
});

test("标题含首尾空格也能匹配；findByTitle 重名按创建时间取最新", async () => {
  await extractAndStore('<paper title=" 小说 ">空格标题追加</paper>', {});
  assert.match(papers.findByTitle("小说").content, /空格标题追加/);
  assert.equal(papers.findByTitle("不存在的标题"), null);
});
