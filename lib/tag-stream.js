"use strict";
/* [位置:lib/tag-stream.js·createTagStreamFilter] [流式正文的标签过滤（注册表驱动，认代码块/表格）] [10-28 第6项：原来 server.js 里的 createContentTagFilter 是手写前缀状态机——标签名写死一份、不认代码块（AI 在代码块里讲解标签，流式气泡里标签先被吞掉、最终文本里又在，两边不一致）、加一个标签要改好几处正则。现在：每来一段增量，就在「到目前为止的全文」上用与最终收尾完全相同的 strip（workspace/phone-tags.js）算出该显示的文字，只发新增的那一截；末尾「可能还没写完」的部分先扣着——①写了一半的标签头（<to、<todo remi…）；②开标签写全了但还没收尾的整段标签（正文还在写，不能先流出去）；③当前行没配对的反引号；④末尾还没出现分隔行的疑似表格。保证：流出去的文字一定等于最终 strip 后的前缀（逐字相同），中途不会先露出标签再缩回去] [注释时间 2026-10-28] */
const T = require("../workspace/phone-tags.js");

const MASK_TAGS = ["pre", "code"];   // HTML 代码块：成对才算「不解析」，没收尾前先扣住，免得里面的标签被提前当真剥掉
const SRV = T.names("srv").concat(MASK_TAGS);
const DROP = T.names("srv", ["drop"]).concat(MASK_TAGS);
const SEP_RE = /^\s*\|[\s:|-]*-{3,}[\s:|-]*$/;
const OPEN_RES = DROP.filter(function (n) { return n !== "star"; }).map(function (n) {
  const tg = T.TAGS ? T.TAGS.filter(function (x) { return x.n === n; })[0] : null;
  return { n: n, hold: (tg && tg.hold) || Infinity, re: new RegExp("<\\s*" + n + "\\b[^>]*>", "gi"), close: new RegExp("<\\s*\\/\\s*" + n + "\\s*>", "i") };
});

// 掩码文本里「从哪个下标起先扣住不发」；返回 s.length 表示都能发
function holdIndex(s) {
  let hold = s.length;
  // ① 末尾写了一半的标签头：从最早一个「后面再没有 >」的 < 起，只要它像登记过的标签（或名字的前缀）就扣
  for (let lt = s.indexOf("<"); lt >= 0 && lt < s.length; lt = s.indexOf("<", lt + 1)) {
    if (s.indexOf(">", lt) >= 0) continue;
    const tail = s.slice(lt + 1).replace(/^\s*\/?\s*/, "").toLowerCase();
    const word = (tail.match(/^[a-z_]*/) || [""])[0];
    const tagish = tail === "" || SRV.some(function (n) { return n.indexOf(tail) === 0; }) ||
      (word && SRV.indexOf(word) >= 0 && (tail.length === word.length || /^\W/.test(tail.slice(word.length))));
    if (tagish) { hold = Math.min(hold, lt); break; }
  }
  // ② 开标签已写全、收尾标签还没来的整段标签（只管 drop 型；paper 这类 keep 型正文照常流出）
  for (let i = 0; i < OPEN_RES.length; i++) {
    const o = OPEN_RES[i];
    o.re.lastIndex = 0;
    let m;
    while ((m = o.re.exec(s))) {
      if (/\/\s*>$/.test(m[0])) continue;                       // 自闭合
      if (!o.close.test(s.slice(m.index + m[0].length))) { if (s.length - m.index <= o.hold) hold = Math.min(hold, m.index); break; }   // hold：这种标签最多扣这么多字，超了当正文放行（11-04 trace 被叙述里的 <trace> 字样一直扣住后面整段）
    }
  }
  // ③ 当前行里没配对的反引号（行内代码等配对或换行，但最多扣 60 字，超了当正文放行，防止单引号/孤立反引号卡死整行）
  const nl = s.lastIndexOf("\n");
  const line = s.slice(nl + 1);
  const bt = line.split("`").length - 1;
  if (bt % 2 === 1) {
    const lastBt = line.lastIndexOf("`");
    if (line.length - lastBt <= 60) {
      hold = Math.min(hold, nl + 1 + lastBt);
    }
  }
  // ④ 末尾一串以 | 开头、还没出现分隔行的行：可能是正在写的表格
  const lines = s.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  let k = lines.length - 1;
  while (k >= 0 && /^\s*\|/.test(lines[k])) k--;
  if (k < lines.length - 1) {
    const run = lines.slice(k + 1);
    if (!run.some(function (l) { return SEP_RE.test(l); })) {
      let off = 0;
      for (let q = 0; q <= k; q++) off += lines[q].length + 1;
      hold = Math.min(hold, off);
    }
  }
  return hold;
}

function createTagStreamFilter() {
  let raw = "", sent = "";
  function visibleNow() {
    const cm = T.mask(raw);
    const h = holdIndex(cm.text);
    const end = h >= cm.text.length ? raw.length : cm.toRaw(h);
    return T.strip(raw.slice(0, end), "srv");
  }
  return {
    push(delta, emit) {
      if (!delta) return;
      raw += delta;
      const vis = visibleNow();
      if (vis.length >= sent.length && vis.indexOf(sent) === 0) {   // 只发新增的一截；若前缀变了（极少见）就先不发，等收尾 final_content 校正
        const add = vis.slice(sent.length);
        sent = vis;
        if (add) emit(add);
      }
    },
    // 收尾：扣着的半截标签丢弃；传了 emit 就把「最终 strip 后」还没发的补发出去
    flush(emit) {
      if (typeof emit === "function") {
        const fin = T.strip(raw, "srv");
        if (fin.indexOf(sent) === 0 && fin.length > sent.length) { const add = fin.slice(sent.length); sent = fin; emit(add); }
      }
      raw = ""; sent = "";
    },
    _state() { return { raw: raw, sent: sent }; }
  };
}

module.exports = { createTagStreamFilter, holdIndex };
