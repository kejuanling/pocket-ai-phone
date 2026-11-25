"use strict";
// 置顶笔记块不重复标题（11-03）：分隔行 id｜标题·已置顶｜日期，系统头（# 标题 + （日期））去掉，正文开头同名「# 标题」去掉
const assert = require("assert");
const os = require("os"), fs = require("fs"), path = require("path");
process.env.PAPERS_BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pinned-dup-"));
const papers = require("../../lib/papers");
const a = papers.savePaper({ title: "和涵相处的禁忌", content: "# 和涵相处的禁忌\n\n（2026-10-26 凌晨）\n\n第一条：不许说闹够了没。" });
papers.pinPaper(a.id, true);
const txt = papers.pinnedNotesLines().join("\n");
const n = (txt.match(/和涵相处的禁忌/g) || []).length;
assert.strictEqual(n, 1, "标题只出现一次（分隔行），实际 " + n + "\n" + txt);
assert.ok(/── \d+｜和涵相处的禁忌·已置顶｜\d{4}-\d{2}-\d{2} ──/.test(txt), "分隔行带 id、标题、日期");
assert.ok(txt.indexOf("第一条：不许说闹够了没。") >= 0, "正文保留");
console.log("PASS pinned no dup title");
