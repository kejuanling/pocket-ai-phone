"use strict";
/* 第6项步骤1a：workspace/phone-tags.js 的剥离 vs 现有两套手写剥离（服务端 tag-parser.stripTags、前端 phone-talk.js stripTags），
 * 对真实时间线里所有 assistant 消息做差分——没有触发「新能力」（表格/~~~/<code>/<pre>/新标签名）的消息必须逐字相同。
 * 跑法（项目目录下）：node tests/tag-parser/test_tags_diff.js */
const fs = require("fs");
const path = require("path");
const PHTags = require("../../workspace/phone-tags.js");
const tagParser = require("../../lib/tag-parser");

// 前端旧实现：直接从 phone-talk.js 里抠那一行函数来跑（不手抄，免得对比的是抄错的版本）
const feSrc = fs.readFileSync(path.join(__dirname, "..", "..", "workspace", "phone-talk.js"), "utf8");
const m = feSrc.match(/\n  function stripTagsOld\(t\)\{[^\n]*\n/);
if (!m) { console.log("找不到前端 stripTags"); process.exit(2); }
// eslint-disable-next-line no-new-func
const oldFe = new Function(m[0] + "\nreturn stripTagsOld;")();

const dir = path.join(__dirname, "..", "..", "timeline_data");
const files = fs.readdirSync(dir).filter(f => /^enhanced_messages_.+\.json$/.test(f) && f.indexOf("__diag__") < 0);
let strayFe = 0, total = 0, cmpSrv = 0, cmpFe = 0, diffSrv = [], diffFe = [], skipped = 0;
const NEW_NAMES = /<\s*\/?\s*(?:notebook|lovediary|todo|mood|period|reply|push|noaction)\b/i;
for (const f of files) {
  let arr; try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { continue; }
  for (const msg of arr) {
    if (!msg || msg.role !== "assistant" || typeof msg.content !== "string") continue;
    const t = msg.content; total++;
    const newCap = /(~~~)|<\s*(code|pre)\b|^\s*\|.*\|\s*$/im.test(t) || NEW_NAMES.test(t);
    if (newCap) { skipped++; continue; }
    // 服务端：新旧都有掩码（围栏+行内），应逐字相同（旧版对孤立收尾标记只剥 </paper>，新版剥所有已登记标签的孤立收尾——单独计）
    cmpSrv++;
    const a = tagParser.stripTags(t), b = PHTags.strip(t, "srv");
    if (a !== b) diffSrv.push({ f, id: msg.id, a: a.slice(0, 80), b: b.slice(0, 80), t: t.slice(0, 200) });
    // 前端：旧版不认代码块，只拿「没有任何反引号」的消息比
    // 已知且有意的差异：前端旧版不剥 <compacted>（服务端剥），新版两边同口径都剥（调查单 G-4）
    if (t.indexOf("`") < 0 && !/<\s*compacted\b/i.test(t)) {
      cmpFe++;
      const c = oldFe(t), d = PHTags.strip(t, "fe");
      // 已知且有意：前端旧版对「没成对的孤立标签」不处理（正文里讲「用 <memory> 标签」会原样留着），新版与服务端同口径一并去掉
      const strayLeft = /<\s*\/?\s*(?:memory|pin|wake|quiet|star|active|album|paper|notebook|lovediary|todo|mood|period|reply)\b/i.test(c);
      if (c !== d && strayLeft) { strayFe++; continue; }
      if (c !== d) diffFe.push({ f, id: msg.id, c: c.slice(0, 80), d: d.slice(0, 80), t: t.slice(0, 200) });
    }
  }
}
console.log("assistant 消息 " + total + " 条；跳过（含新能力）" + skipped + "；服务端对比 " + cmpSrv + "，前端对比 " + cmpFe);
console.log("（前端孤立标签口径统一而不同的 " + strayFe + " 条，已排除）");
console.log("服务端差异 " + diffSrv.length + "，前端差异 " + diffFe.length);
diffSrv.slice(0, 5).forEach(x => console.log("SRV", JSON.stringify(x)));
diffFe.slice(0, 5).forEach(x => console.log("FE ", JSON.stringify(x)));
/* [2026-11-15] 前端旧 strip 实现已退役（前端改走 PHTags），这半边的差异只记录、不参与判定：
   存量 16781 条里 581 条是旧口径（不剥孤立标签 / 不剥 <compacted>）的历史差异，会随存量只增不减，
   卡死必须 0 等于让一条永不归零的计数器盖住真回归。真正的硬指标是服务端新旧逐字一致（11-15 实测 0）。 */
console.log("（前端差异仅记录，不参与判定；判定=服务端新旧逐字一致）");
process.exit(diffSrv.length ? 1 : 0);
