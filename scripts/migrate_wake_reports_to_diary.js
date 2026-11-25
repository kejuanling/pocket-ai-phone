#!/usr/bin/env node
"use strict";
// 唤醒报搬回日记（2026-10-22 批 B / 需求追加 #22）。
// 10-16 把 37 篇「唤醒报 · 月-日 时:分」从日记搬进了笔记本（reason=「由日记迁入（原日记 #N）」，原日记已从 diary.json 删除，next_id 没动）；
// 这里反着搬回：按原 id 重新放回 data/diary.json（id 空着，顺序不乱），从 data/papers.json 删掉（整篇先进 papers-history.json，可找回），
// 最后重写「笔记本目录」笔记。
//
// 用法：  node scripts/migrate_wake_reports_to_diary.js          # 预演：只打印清单，不写盘
//         node scripts/migrate_wake_reports_to_diary.js --apply  # 执行（先把 papers.json / diary.json / papers-history.json 备份到 data/backups/）
//
// 搬回的日记：session=null（共享层）、hidden=false、pin=false——原来的会话归属 / 隐藏状态 10-16 迁出时没留，只能取默认；
// created_at 取笔记里的创建时间（10-16 迁出时按正文首行「## 日期 时:分」校正过的真实时间）；
// content 取笔记正文里「# 标题 / （日期）」两个头之后的部分，即原日记正文（从「## …」开头）。
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const paperStore = require(path.join(ROOT, "lib", "paper-store"));
const diaryStore = require(path.join(ROOT, "lib", "diary-store"));

const TITLE_RE = /^唤醒报 · \d{2}-\d{2} \d{2}:\d{2}$/;
const HEAD_RE = /^# [^\n]*\n\n（\d{4}-\d{2}-\d{2} \d{2}:\d{2}）\n\n/;

function plan() {
  const papers = paperStore.load(ROOT).entries;
  const diary = diaryStore.loadStore(ROOT);
  const have = new Set(diary.entries.map((e) => Number(e.id)));
  const out = [];
  const problems = [];
  for (const p of papers) {
    if (!TITLE_RE.test(String(p.title || "").trim())) continue;
    const m = /原日记 #(\d+)/.exec(p.reason || "");
    if (!m) { problems.push("笔记 #" + p.id + " 标题像唤醒报但 reason 里没有原日记 id，跳过"); continue; }
    const did = Number(m[1]);
    if (have.has(did)) { problems.push("笔记 #" + p.id + " → 日记 #" + did + " 已存在，跳过（防覆盖）"); continue; }
    const hm = HEAD_RE.exec(p.content || "");
    if (!hm) { problems.push("笔记 #" + p.id + " 头部格式不对，跳过"); continue; }
    const body = String(p.content).slice(hm[0].length);
    if (!/^## \d{4}-\d{2}-\d{2}/.test(body)) { problems.push("笔记 #" + p.id + " 去头后不是「## 日期」开头，跳过"); continue; }
    out.push({ paper_id: p.id, diary_id: did, title: p.title, created_at: p.created_at, content: body });
  }
  return { out, problems, diaryCount: diary.entries.length, nextId: diary.next_id };
}

function main() {
  const { out, problems, diaryCount, nextId } = plan();
  console.log((APPLY ? "【执行】" : "【预演，未写盘】") + " 可搬回 " + out.length + " 篇；日记现有 " + diaryCount + " 篇，next_id=" + nextId);
  problems.forEach((x) => console.log("  ! " + x));
  out.slice(0, 3).concat(out.slice(-2)).forEach((x) => console.log("  样例 笔记#" + x.paper_id + " → 日记#" + x.diary_id + " " + x.title + " | " + x.created_at + " | " + JSON.stringify(x.content.slice(0, 40))));
  if (!APPLY) return;
  if (problems.length) { console.log("有无法搬回的条目，先处理再 --apply"); process.exit(2); }

  const bdir = path.join(ROOT, "data", "backups", "batchB-20261022-migrate");
  fs.mkdirSync(bdir, { recursive: true });
  for (const f of ["papers.json", "diary.json", "papers-history.json"]) {
    const src = path.join(ROOT, "data", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bdir, f));
  }

  // 1) 写日记（一次读改写）
  const store = diaryStore.loadStore(ROOT);
  const ids = new Set(store.entries.map((e) => Number(e.id)));
  for (const x of out) {
    if (ids.has(x.diary_id)) throw new Error("日记 #" + x.diary_id + " 已存在");
    store.entries.push({ id: x.diary_id, session: null, hidden: false, pin: false, created_at: x.created_at, content: x.content });
  }
  store.entries.sort((a, b) => Number(a.id) - Number(b.id));
  if (!(store.next_id > Math.max(...store.entries.map((e) => Number(e.id))))) throw new Error("next_id 异常");
  diaryStore.saveStore(ROOT, store);
  // 2) 从笔记本删（整篇先进 papers-history，可找回）
  let removed = 0;
  for (const x of out) { if (paperStore.removeEntry(ROOT, x.paper_id)) removed++; }
  // 3) 重写笔记本目录
  const papers = require(path.join(ROOT, "lib", "papers"));
  papers.syncIndexNote();
  // 4) 核对
  const d2 = diaryStore.loadStore(ROOT).entries;
  const left = paperStore.load(ROOT).entries.filter((p) => TITLE_RE.test(String(p.title || "").trim())).length;
  const back = out.every((x) => d2.some((e) => Number(e.id) === x.diary_id && e.content === x.content));
  console.log("搬回 " + out.length + " 篇日记，从笔记删除 " + removed + " 篇；笔记里剩唤醒报 " + left + " 篇；日记现 " + d2.length + " 篇；逐篇内容核对：" + (back ? "一致" : "有差异！"));
}
main();
