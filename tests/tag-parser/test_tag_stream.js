"use strict";
/* 第6项步骤1b：流式标签过滤（lib/tag-stream.js）——性质测试：
 *   任意切块方式喂进去，①每一刻流出去的文字都是最终 strip 结果的前缀（不会先露出标签再缩回）；②全部喂完后 flush(emit) 补齐，等于最终 strip 结果。
 * 语料 = 手写用例（含代码块/表格/各种新旧标签/半截标签）+ 真实时间线里随机抽的 assistant 消息。
 * 跑法（项目目录下）：node tests/tag-parser/test_tag_stream.js */
const fs = require("fs");
const path = require("path");
const T = require("../../workspace/phone-tags.js");
const { createTagStreamFilter } = require("../../lib/tag-stream");

let bad = 0, runs = 0, prefixBreaks = 0;
function ok(c, m) { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) bad++; }

function feed(text, chunks) {
  const f = createTagStreamFilter(); let out = "", i = 0, broke = false;
  const fin = T.strip(text, "srv");
  while (i < text.length) {
    const n = chunks(); const piece = text.slice(i, i + n); i += n;
    f.push(piece, (a) => { out += a; });
    if (fin.indexOf(out) !== 0) broke = true;
  }
  f.flush((a) => { out += a; });
  return { out, fin, broke };
}
function rnd(max) { return () => 1 + Math.floor(Math.random() * max); }

const CASES = [
  "好的<todo remind_at=\"2026-10-29 09:00\">买牛奶</todo>已经记下了。",
  "先说一句\n\n<lovediary kind=\"letter\" title=\"给你\">第一段\n\n第二段</lovediary>\n\n再说一句",
  "讲解：\n```\n<todo>买牛奶</todo>\n```\n写法是 `<mood>开心</mood>` 这样。",
  "| 标签 | 例子 |\n|---|---|\n| todo | <todo>买牛奶</todo> |\n\n表格后正文<star/>结束",
  "<notebook title=\"t\" summary=\"s\">正文<wake time=\"30\"/>里面还有</notebook>尾巴",
  "a<paper title=\"x\">留下的正文</paper>b<active her_murmurs=\"yes\"/>c",
  "孤立 <memory> 开标签和 </todo> 收尾",
  "结尾半截<todo remind_",
  "1 < 2 且 3 > 2，还有 <b>粗体</b>",
  "含 `一个没配对的反引号 然后<todo>x</todo> 换行\n下一行<todo>y</todo>",
  "<pre>\n<notebook>在 pre 里</notebook>\n</pre>和<code><wake time=\"1\"/></code>",
  "~~~\n<reply id=\"1\">围栏里</reply>\n~~~\n之后 <reply id=\"2\">真回复</reply>"
];
for (const t of CASES) {
  for (const mk of [() => 1, rnd(3), rnd(7), rnd(25)]) {
    const r = feed(t, mk); runs++;
    if (r.out !== r.fin || r.broke) { bad++; if (r.broke) prefixBreaks++; console.log("  FAIL case: " + JSON.stringify(t.slice(0, 60)) + " out=" + JSON.stringify(r.out.slice(0, 80)) + " fin=" + JSON.stringify(r.fin.slice(0, 80))); }
  }
}
ok(bad === 0, "手写用例 " + runs + " 次（逐字符/随机切块）：每一刻都是最终结果的前缀，收尾补齐等于最终结果");

// 真实消息抽样
const dir = path.join(__dirname, "..", "..", "timeline_data");
const files = fs.readdirSync(dir).filter(f => /^enhanced_messages_.+\.json$/.test(f) && f.indexOf("__diag__") < 0);
let n = 0, fail = 0, breaks = 0;
const pool = [];
for (const f of files) {
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { continue; }
  for (const m of arr) if (m && m.role === "assistant" && typeof m.content === "string" && m.content.length > 30 && m.content.length < 8000 && /[<`|~]/.test(m.content)) pool.push(m.content);
}
for (let i = 0; i < 1500 && pool.length; i++) {
  const t = pool[Math.floor(Math.random() * pool.length)];
  const r = feed(t, rnd(1 + Math.floor(Math.random() * 30))); n++;
  if (r.broke) breaks++;
  if (r.out !== r.fin) { fail++; if (fail <= 3) console.log("  FAIL real: " + JSON.stringify(t.slice(0, 100)) + "\n    out=" + JSON.stringify(r.out.slice(0, 100)) + "\n    fin=" + JSON.stringify(r.fin.slice(0, 100))); }
}
ok(fail === 0, "真实消息抽样 " + n + " 条（池 " + pool.length + "，含 < ` | ~ 的）：收尾结果与最终 strip 一致");
ok(breaks === 0, "真实消息中途「流出去的不是最终结果前缀」的次数 = " + breaks);
console.log(bad ? "RESULT FAIL" : "RESULT ALL PASS"); process.exit(bad ? 1 : 0);
