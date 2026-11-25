"use strict";
/* [位置:lib/keyword-window.js] [多关键词「最优窗口」片段 + 多词覆盖打分——召回里所有「在长文本里找命中位置」的地方共用这一份]
   [需求] 11-09：AI 搜「蓝鲸 饲养」这类多词，原先拿整句（含空格）找子串，永远找不到→每条都退化成开头 62 字；手机搜索、日记、笔记、后台材料截断也有同款毛病。产品确定：所有跟召回有关的都聪明点，算法只写一份。
   [出处] Lucene FastVectorHighlighter（记每个查询词的全部位置→相邻命中合并成候选片段→按覆盖查询词数打分选最优）；Google snippet 专利 US20110066611A1（按 query term coverage 与 proximity 给 span 打分）；Tao & Zhai 2007（2~5 词短查询用「覆盖最多不同查询词的窗口」）。
   [做法]
   1. 候选词 = 整句 q（多词时当短语，权重 2）+ 按空白/标点切出的原词（权重 1，**无条件保留**：不走 grams 过滤，「我的猫」「猫」这类含虚词/单字的词也能命中）。
   2. 原词一个都没在文本里找到（描述型长句、语义命中）→ 退到 lib/recall-sources.js 的 grams（2-4 字滑窗+停用词，11-07 定稿的切词）找锚点；grams 只用来选片段位置，不决定哪些消息被返回。
   3. 以每个命中位置为起点，往后把「首尾跨度 ≤ GROUP_SPAN」的命中并成一个窗口，前后各补 SIDE 字；评分 = 覆盖的不同候选词（短语加倍）> 窗内命中次数 > 窗更窄 > 位置更早。
   4. 一个窗口盖不住所有命中词（词离得远）→ 再从「没被盖到的词」里选第二个窗口，两段按原文顺序用「……」连起来（11-09 拍板）；最多两段。
   5. 一个词面都锚不上 → 开头 HEAD 字+省略号（产品确定维持）。
   [排序腿] makeScorer：单词与旧公式 min(1,n/3) 完全一致；多词 = max(整句子串分, 覆盖比×(0.5+0.5×平均深度))——盖得词多的排前面，旧行为是下限，不会比以前差。
   [使用方] routes/chat.js（/v1/search、/internal/search 的排序与 snip=1）、server.js（日记检索）、lib/papers.js（笔记检索）、context/context-replacements.js（后台材料截断）
   [注释时间 2026-11-09] */
const recallSources = require("./recall-sources");

const SIDE = 30;          // 窗口前后各补的字数（11-09 拍板，与笔记一致）
const GROUP_SPAN = 100;   // 同一窗口里命中词首尾最大跨度
const HEAD = 62;          // 完全锚不上时取开头的字数
const MAX_TERMS = 8;      // 一次查询最多认多少个词
const MAX_OCC = 2000;     // 每次最多处理的命中位置（极长文本里单字词重复几千次时封顶）
const SPLIT = /[\s,，。；;：！!？?、"“”‘’（）()\[\]【】《》<>…]+/;   // 不拆 . - : /（日期、版本号、路径要整体留着）

function norm(text) { return String(text == null ? "" : text).replace(/\s+/g, " ").trim(); }

/* 查询词（原词）：按空白/标点切，小写，去重；q 也可以直接给词数组 */
function terms(q) {
  const arr = Array.isArray(q) ? q.map(function (x) { return String(x == null ? "" : x).toLowerCase().trim(); })
    : String(q == null ? "" : q).toLowerCase().split(SPLIT);
  const out = [];
  for (const t of arr) { if (t && out.indexOf(t) < 0) out.push(t); if (out.length >= MAX_TERMS) break; }
  return out;
}

/* 非重叠出现次数（与 routes/chat.js 原关键词腿口径一致） */
function count(low, s) {
  if (!s) return 0;
  let n = 0, p = low.indexOf(s);
  while (p !== -1) { n++; p = low.indexOf(s, p + s.length); }
  return n;
}

function occurrences(low, cands) {
  const occ = [];
  for (let ci = 0; ci < cands.length; ci++) {
    const s = cands[ci].s;
    if (!s) continue;
    let p = low.indexOf(s), k = 0;
    while (p !== -1 && k < MAX_OCC) { occ.push({ s: p, e: p + s.length, c: ci }); k++; p = low.indexOf(s, p + 1); }
  }
  occ.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
  return occ.length > MAX_OCC ? occ.slice(0, MAX_OCC) : occ;
}

/* 在命中位置里选最优窗口：返回 { start,end(命中词首尾), cov(Set of cand idx), score[] } 或 null */
function bestGroup(occ, cands) {
  let best = null;
  for (let i = 0; i < occ.length; i++) {
    const cov = new Set();
    let covW = 0, hits = 0, endMax = occ[i].e;
    for (let j = i; j < occ.length && occ[j].e - occ[i].s <= GROUP_SPAN; j++) {
      hits++;
      if (!cov.has(occ[j].c)) { cov.add(occ[j].c); covW += cands[occ[j].c].w; }
      if (occ[j].e > endMax) endMax = occ[j].e;
    }
    const sc = [covW, hits, -(endMax - occ[i].s), -occ[i].s];
    if (!best || cmp(sc, best.score) > 0) best = { start: occ[i].s, end: endMax, cov: cov, score: sc };
  }
  return best;
}
function cmp(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; }

/* 定位：返回 { mode:'term'|'gram'|'head', ranges:[{start,end}]（按原文顺序，含前后各 SIDE 的补边）, best:最优窗口在 ranges 里的下标 } */
function locate(text, q, opts) {
  const o = opts || {};
  const side = o.side == null ? SIDE : o.side;
  const t = String(text == null ? "" : text);
  const low = t.toLowerCase();
  const ts = terms(q);
  if (!ts.length || !t) return { mode: "head", ranges: [], best: -1 };
  const clip = function (g) { return { start: Math.max(0, g.start - side), end: Math.min(t.length, g.end + side) }; };

  // 第一层：原词 + 整句短语
  const cands = ts.map(function (s) { return { s: s, w: 1 }; });
  if (!Array.isArray(q) && ts.length > 1) {
    const phrase = norm(q).toLowerCase();
    if (phrase && cands.every(function (c) { return c.s !== phrase; })) cands.push({ s: phrase, w: 2 });
  }
  let occ = occurrences(low, cands);
  let mode = "term";
  let useCands = cands;
  if (!occ.length) {
    // 第二层：grams 锚点（只用来选位置）
    const gs = Array.from(recallSources.grams(Array.isArray(q) ? q.join(" ") : q)).slice(0, 60);
    useCands = gs.map(function (s) { return { s: s, w: 1 }; });
    occ = occurrences(low, useCands);
    mode = "gram";
    if (!occ.length) return { mode: "head", ranges: [], best: -1 };
  }
  const first = bestGroup(occ, useCands);
  const ranges = [clip(first)];
  // 词离得远：再给没被盖到的词选第二个窗口（只在原词层做，grams 层是重叠碎片，不拆两段）
  if (mode === "term" && o.second !== false) {
    const rest = occ.filter(function (x) { return !first.cov.has(x.c); });
    if (rest.length) {
      const r2 = clip(bestGroup(rest, useCands));
      const r1 = ranges[0];
      if (r2.start <= r1.end && r2.end >= r1.start) ranges[0] = { start: Math.min(r1.start, r2.start), end: Math.max(r1.end, r2.end) };
      else ranges.push(r2);
    }
  }
  ranges.sort(function (a, b) { return a.start - b.start; });
  return { mode: mode, ranges: ranges, best: ranges.findIndex(function (r) { return r.start <= first.start && r.end >= first.end; }) };
}

/* 片段：命中处前后各 side 字；多段用「……」连；没有命中取开头 head 字。text 会先压空白（和旧 _ctx_snip 一致） */
function snippet(text, q, opts) {
  const o = opts || {};
  const head = o.head == null ? HEAD : o.head;
  const t = norm(text);
  const loc = locate(t, q, o);
  if (!loc.ranges.length) return t.length > head ? t.slice(0, head) + "…" : t;
  const first = loc.ranges[0], last = loc.ranges[loc.ranges.length - 1];
  return (first.start > 0 ? "…" : "") + loc.ranges.map(function (r) { return t.slice(r.start, r.end); }).join("……") + (last.end < t.length ? "…" : "");
}

/* 后台材料截断：文本不超过 cap 原样给；超过时以最优窗口为中心取 cap 字（窗口前留 100 字上文），没有命中取开头。保留原文换行。 */
function clipAround(text, q, cap) {
  const t = String(text == null ? "" : text);
  if (t.length <= cap) return t;
  const loc = locate(t, q, { second: false });
  let s = 0;
  /* 上文留量 = 窗口放得下的前提下最多 100 字，且让最优窗口大致居中（11-09 修：原来固定留 100 字，cap 小（如 120）时命中词被挤出截取范围；线上 cap=500/6000 碰不到，但 cap 最小允许 100） */
  if (loc.ranges.length) {
    const r = loc.ranges[loc.best >= 0 ? loc.best : 0];
    const lead = Math.max(0, Math.min(100, Math.floor((cap - (r.end - r.start)) / 2)));
    s = Math.max(0, Math.min(r.start - lead, t.length - cap));
  }
  return (s > 0 ? "…" : "") + t.slice(s, s + cap) + (s + cap < t.length ? "…" : "");
}

/* 排序腿的关键词分（0..1）：返回对「小写化文本」打分的函数，q 的切词只做一次 */
function makeScorer(q) {
  const ql = String(q == null ? "" : q).trim().toLowerCase();
  const ts = terms(ql);
  return function (low) {
    const whole = Math.min(1, count(low, ql) / 3);
    if (!ts.length) return whole;
    if (ts.length === 1) return ts[0] === ql ? whole : Math.max(whole, Math.min(1, count(low, ts[0]) / 3));
    let present = 0, depth = 0;
    for (const t of ts) { const n = count(low, t); if (n) { present++; depth += Math.min(1, n / 3); } }
    if (!present) return whole;
    return Math.max(whole, (present / ts.length) * (0.5 + 0.5 * depth / present));
  };
}

module.exports = { terms, count, locate, snippet, clipAround, makeScorer, SIDE, GROUP_SPAN, HEAD };
