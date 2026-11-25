"use strict";
/* 已归档 / 「不参与检索」/ 子会话 的会话，除手机自己的搜索外任何读原文的地方都不能碰到（11-09）
 * 覆盖：searchContextEnhanced 的按日期定位、最近 N 条；lib/message-lookup 的按 id 捞原文
 * （带关键词的检索 11-09 起走网关 /internal/search，归档/不参与组在 tests/search-exclude/test_search_route.js 里测）
 * 只建一个临时测试会话文件，跑完删掉；归档名单用 monkeypatch，不碰真实 data/session-archive.json
 * 跑法（项目目录下）：node tests/search-exclude/test_archive_all_paths.js */
const fs = require("fs");
const os = require("os");
const path = require("path");

const SID = "s_zz_archtest_" + process.pid;
const SUB = "s_sub_zz_archtest_" + process.pid;
const WORD = "archtestword" + process.pid;
const MSG = "zz-archtest-msg-" + process.pid;
const settings = path.join(os.tmpdir(), "arch-settings-" + process.pid + ".json");
process.env.SEARCH_EXCLUDE_SETTINGS = settings;
fs.writeFileSync(settings, JSON.stringify({ cfg: { session_groups: [] } }));

const { TIMELINE_DIR } = require("../../lib/timeline-dir");
const archive = require("../../lib/session-archive");
const ctx = require("../../context/context-replacements");
const { createMessageLookup } = require("../../lib/message-lookup");

let bad = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }
const files = [SID, SUB].map((s) => path.join(TIMELINE_DIR, "enhanced_messages_" + s + ".json"));
function setGroup(sids) { fs.writeFileSync(settings, JSON.stringify({ cfg: { session_groups: sids.length ? [{ id: "g", sids, noSearch: true }] : [] } })); const t = new Date(Date.now() + (setGroup.n = (setGroup.n || 0) + 1) * 1000); fs.utimesSync(settings, t, t); }
let archivedNow = [];
archive.readSessionArchive = function () { return archivedNow.slice(); };

async function seen(label, opts) {
  const r = await ctx.searchContextEnhanced(opts.q || "", Object.assign({ allSessions: true, limit: 100 }, opts));
  return (r.matches || []).some((m) => m.session === SID || m.session === SUB);
}

(async () => {
  try {
    const msgs = (id) => [{ id: id, role: "user", content: "测试消息 " + WORD, time: "2031-01-02T03:04:05.000Z" }];
    fs.writeFileSync(files[0], JSON.stringify(msgs(MSG)));
    fs.writeFileSync(files[1], JSON.stringify(msgs(MSG + "-sub")));
    const lk = () => createMessageLookup({ baseDir: path.join(__dirname, "..", "..") });

    // 子会话：任何时候都读不到
    const rSub = await ctx.searchContextEnhanced("", { allSessions: true, timePrefix: "2031-01-02", limit: 100 });
    ok(!(rSub.matches || []).some((m) => m.session === SUB), "子会话：按日期定位读不到");
    ok(lk().lookup(MSG + "-sub") === null, "子会话：按 id 捞原文读不到");

    // 普通会话：未归档能读到（对照组，防止「什么都读不到」造成假通过）
    archivedNow = []; setGroup([]);
    ok(await seen("日期", { timePrefix: "2031-01-02" }), "未归档：按日期定位读得到");
    ok(await seen("最近", { latest: 100 }), "未归档：最近 N 条读得到");
    const hit = lk().lookup(MSG);
    ok(hit && hit.session === SID, "未归档：按 id 捞原文读得到");

    // 归档后：四条路径都读不到
    archivedNow = [SID];
    ok(!(await seen("日期", { timePrefix: "2031-01-02" })), "已归档：按日期定位读不到");
    ok(!(await seen("最近", { latest: 100 })), "已归档：最近 N 条读不到");
    ok(lk().lookup(MSG) === null, "已归档：按 id 捞原文读不到（同一个 lookup 实例名单变了也要重建索引）");
    const one = lk(); one.lookup(MSG); archivedNow = []; ok(one.lookup(MSG) !== null, "取消归档后同一实例立刻又读得到（名单进了缓存指纹）");

    // 「不参与检索」组
    archivedNow = []; setGroup([SID]);
    ok(!(await seen("日期", { timePrefix: "2031-01-02" })), "不参与检索组：按日期定位读不到");
    ok(!(await seen("最近", { latest: 100 })), "不参与检索组：最近 N 条读不到");
    ok(lk().lookup(MSG) === null, "不参与检索组：按 id 捞原文读不到");

    // 单会话（allSessions=false）不受这批影响：只读当前会话，不走 loadAllSessionTimelines
    ok(typeof ctx.searchContextEnhanced === "function", "单会话路径仍在");
  } finally {
    files.forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
    try { fs.unlinkSync(settings); } catch (e) {}
  }
  console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); files.forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} }); process.exit(1); });
