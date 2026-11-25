/* [位置:workspace/phone-tags.js] [标签注册表 + 「不解析」掩码 + 剥离（前端与服务端共用同一份）] [10-28 第6项：标签清单原来散在 5 处各写一份（服务端 stripTags、流式过滤、前端 stripTags、HIDE_RE、提示词），加一个标签要改 5 处，漏一处标签就在气泡里漏出来；代码块保护也有两份拷贝（tag-parser / diary）且不认表格。现在清单与掩码只在这一个文件：浏览器里是 window.PHTags，服务端 require('../workspace/phone-tags.js')。加标签只改下面 TAGS 一行] [注释时间 2026-10-28] */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PHTags = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 注册表 ----------
     n    标签名
     srv  服务端剥离（下发/回放给客户端的正文）：'drop' 整段去掉 / 'keep' 只去标记留里面的字 / 0 不剥（时间线原样保留）
     fe   前端显示剥离，口径同上
     unclosed 前端：开标签没写完整段（到结尾）也去掉（title/status 流式时半截标签）
     point    前端：带属性的开标签=自闭合指令（<claim clear>），只删标记本身、保住后面正文；必须在 unclosed 之前跑，
              否则 unclosed 会把后面正文吞到结尾（10-31 用户发现的吞字 bug）
     act  服务端解析后有副作用（文档用途，见 lib/tag-parser.js / lib/tag-actions.js）
     旧标签（pin/quiet/phone/result/call_id）只剩剥离；card 由前端 cardsOf 摘出来画卡片，card_reply 是前端写的回执，不在这里剥。 */
  var TAGS = [
    { n: 'memory',    srv: 'drop', fe: 'drop', act: 1 },
    { n: 'paper',     srv: 'keep', fe: 'keep', act: 1 },     // 旧写法；新写法 notebook
    { n: 'notebook',  srv: 'drop', fe: 'drop', act: 1 },
    { n: 'lovediary', srv: 'drop', fe: 'drop', act: 1 },
    { n: 'todo',      srv: 'drop', fe: 'drop', act: 1 },
    { n: 'mood',      srv: 'drop', fe: 'drop', act: 1 },
    { n: 'period',    srv: 'drop', fe: 'drop', act: 1 },
    { n: 'reply',     srv: 'drop', fe: 'drop', act: 1 },
    { n: 'album',     srv: 'drop', fe: 'drop', act: 1 },
    { n: 'star',      srv: 'drop', fe: 'drop', act: 1, open: 1 },   // <star> / <star/>：开标签 + 可选紧跟的 </star>（<star msg_ids=…/> 标别条原文的功能 11-09 下线，AI 旧写法仍要从显示里剥掉，所以这条注册保留）
    { n: 'wake',      srv: 'drop', fe: 'drop', act: 1 },
    { n: 'nowplaying', srv: 'drop', fe: 'drop', act: 1 },    // 网易云推歌 <nowplaying songid="…"/> → netease push（10-28）
    { n: 'addplaylist', srv: 'drop', fe: 'drop', act: 1 },   // 网易云加歌单 <addplaylist>id1,id2</addplaylist> → netease add_to_playlist（10-28）
    { n: 'active',    srv: 'drop', fe: 'drop', act: 1 },
    { n: 'push',      srv: 0,      fe: 'keep', act: 1 },     // 时间线流水账原样保留，前端显示层去标记留内容（同 [push]）
    { n: 'noaction',  srv: 0,      fe: 'drop', act: 1 },
    { n: 'title',     srv: 0,      fe: 'drop', act: 1, unclosed: 1 },   // 服务端保留原文，前端自己隐藏（session-meta.js）
    { n: 'status',    srv: 0,      fe: 'drop', act: 1, unclosed: 1 },
    { n: 'suggest',   srv: 'drop', fe: 'drop', tight: 1, hold: 500 },   // 随手记第21条：AI推荐回复标签，正文不显示，提取到用户输入框
    { n: 'claim',     srv: 0,      fe: 'drop', act: 1, unclosed: 1, point: 1 },   // [10-31] 文件占用登记：tag-parser 解析（lib/claim-locks.js），时间线保留原文，前端隐藏；<claim clear> 是自闭合指令（point），不能按 unclosed 删到结尾——10-31 用户发现：那样会把后面整段正文吞光
    { n: 'trace',     srv: 'drop', fe: 'drop', tight: 1, hold: 1500 },   // 11-04 事故（气泡主题此刻背景会话）：AI 在叙述里提到 <trace> 没写闭合，被当成「写了一半的 trace」把后面整段吞了。改：tight=成对只配最近的开标签；hold=流式最多扣 1500 字；去掉 unclosed（前端不再吞到结尾）   // 11-04 此刻 <trace>：落盘处剥成消息 trace 字段；前端不显示标签（流式半截也藏）。11-07：整句存（lib/trace-notes.js），lock 功能删除，<trace lock> 照常按 trace 剥。11-08：落盘保留原文回灌 AI（产品确定，keepBody），前端照旧剥显示（fe:drop），气泡靠 msg.trace
    { n: 'compacted', srv: 'drop', fe: 'drop' },
    { n: 'pin',       srv: 'drop', fe: 'drop' },
    { n: 'quiet',     srv: 'drop', fe: 'drop' },
    { n: 'phone',     srv: 0,      fe: 'drop' },
    { n: 'result',    srv: 0,      fe: 'drop' },
    { n: 'call_id',   srv: 0,      fe: 'drop' }
  ];
  var BY = {};
  TAGS.forEach(function (t) { BY[t.n] = t; });

  function names(side, modes) {   // side='srv'|'fe'；modes 缺省=所有非 0 的
    return TAGS.filter(function (t) { return t[side] && (!modes || modes.indexOf(t[side]) >= 0); }).map(function (t) { return t.n; });
  }

  /* ---------- 「不解析」掩码 ----------
     被掩住的片段里的标签一律不解析、不剥离、不渲染（AI 讲解标签是合法用法）：
       围栏代码块 ```…``` / ~~~…~~~（未闭合吞到结尾）、HTML <code>…</code> / <pre>…</pre>（成对才算）、
       Markdown 表格（连续 ≥2 行、以 | 开头、含 |---| 分隔行）、行内反引号 `…`（同一行内成对）。
     不处理缩进式代码块（4 空格）：AI 正文里缩进很常见，误伤面太大。 */
  var PH = '\u0000CB';
  var SEP_RE = /^\s*\|[\s:|-]*-{3,}[\s:|-]*$/;
  function maskTables(s, put) {
    if (s.indexOf('|') < 0) return s;
    var lines = s.split('\n'), out = [], i = 0, k;
    while (i < lines.length) {
      if (/^\s*\|/.test(lines[i])) {
        var j = i;
        while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
        var run = lines.slice(i, j);
        if (run.length >= 2 && run.some(function (l) { return SEP_RE.test(l); })) out.push(put(run.join('\n')));
        else for (k = 0; k < run.length; k++) out.push(run[k]);
        i = j;
      } else { out.push(lines[i]); i++; }
    }
    return out.join('\n');
  }
  function mask(text) {
    var slots = [], s = String(text == null ? '' : text);
    function put(m) { slots.push(m); return PH + (slots.length - 1) + '\u0000'; }
    s = s.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, put);
    s = s.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, put);
    s = maskTables(s, put);
    s = s.replace(/`[^`\n]*`/g, put);
    function restore(t) {
      var x = String(t == null ? '' : t), prev;
      do { prev = x; x = x.replace(/\u0000CB(\d+)\u0000/g, function (_, i) { return slots[+i] != null ? slots[+i] : ''; }); }
      while (x !== prev && x.indexOf('\u0000CB') >= 0);
      return x;
    }
    function fullLen(i) { return restore(PH + i + '\u0000').length; }
    // 掩码文本下标 → 原文下标（流式过滤算「保留到哪」用）
    function toRaw(idx) {
      var re = /\u0000CB(\d+)\u0000/g, m, shift = 0;
      while ((m = re.exec(s)) && m.index < idx) shift += fullLen(+m[1]) - m[0].length;
      return idx + shift;
    }
    return { text: s, restore: restore, toRaw: toRaw };
  }
  // 在掩码文本上做事，再还原（前端渲染用：标签摘取/拆分只看掩码外）
  function withMask(text, fn) {
    var cm = mask(text), r = fn(cm.text);
    if (typeof r === 'string') return cm.restore(r);
    return r;
  }

  /* ---------- 剥离 ---------- */
  function reEsc(n) { return String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* [位置:phone-tags.js·strip] [剥离顺序：成对先于 point] [2026-11-01 审查修复：point（带属性开标签）先行会把 <claim clear>正文</claim> 的开标签删掉，成对规则失配后正文被保留，与 fe:'drop' 语义不符；把成对规则提到 point 之前，纯自闭合指令不受影响] [注释时间 2026-11-01] */
  var Z = '\u0001';   /* 被剥掉的标签先留占位，最后按前后换行统一收拾，避免剥完留空行把正文拆成两段 */
  function strip(text, side) {
    var cm = mask(text), s = cm.text;
    var list = TAGS.filter(function (t) { return t[side]; });
    list.forEach(function (t) {
      var n = reEsc(t.n);
      if (t.open) { s = s.replace(new RegExp('<\\s*' + n + '\\b[^>]*>(?:\\s*<\\s*\\/' + n + '\\s*>)?', 'gi'), Z); return; }
      s = s.replace(new RegExp('<\\s*' + n + '\\b[^>]*>(' + (t.tight ? '(?:(?!<\\s*' + n + '\\b)[\\s\\S])*?' : '[\\s\\S]*?') + ')<\\s*\\/' + n + '\\s*>', 'gi'), t[side] === 'keep' ? '$1' : Z);   // 成对（11-01 提到 point 之前：带属性又成对的标签仍按 fe 语义整段处理）
      if (t.point) s = s.replace(new RegExp('<\\s*' + n + '\\b(?=\\s)[^>]*>', 'gi'), Z);                      // [10-31] 自闭合指令式（<claim clear>）：带属性的开标签只删标记、保住后面正文；必须在下面的 unclosed 之前跑
      s = s.replace(new RegExp('<\\s*' + n + '\\b[^>]*\\/\\s*>', 'gi'), Z);                                   // 自闭合
      if (t.unclosed && side === 'fe') s = s.replace(new RegExp(t.point ? ('<\\s*' + n + '\\s*>[\\s\\S]*$') : ('<\\s*' + n + '\\b[^>]*>[\\s\\S]*$'), 'i'), Z);   // 开标签没闭合：到结尾整段（point 标签只认裸开标签——带属性的已在上面按指令删掉）
    });
    if (list.length) {
      var alt = list.map(function (t) { return reEsc(t.n); }).join('|');
      s = s.replace(new RegExp('<\\s*\\/?\\s*(?:' + alt + ')\\b[^>]*>', 'gi'), Z);     // 孤立的开/收尾标记
      s = s.replace(new RegExp('<\\s*\\/?\\s*(?:' + alt + ')\\b[^>]*$', 'gi'), Z);     // 结尾写了一半的标记
    }
    if (side === 'fe') {   // 方括号旧写法：[push] 去标记留内容，[DIARY] 整段去掉（含没闭合的）
      s = s.replace(/\[push\]\s*([\s\S]*?)\s*\[\/push\]/gi, '$1')
        .replace(/\[DIARY\][\s\S]*?\[\/DIARY\]/gi, '').replace(/\[DIARY\][\s\S]*$/i, '').replace(/\[DIARY\]|\[\/DIARY\]/gi, '');
    }
    if (s.indexOf(Z) >= 0) {
      /* [位置:phone-tags.js·strip 换行收拾] [剥标签不拆正文] [11-02 bug：<status> 独占一行夹在两句正文之间，原来剥成 '' 后「前\n标签\n后」变「前\n\n后」，单换行变成空行，一段话被拆成两块；头尾独占行也会留空行。改法：剥掉的标签先落占位 Z；只在前端一侧（side==='fe'）且标签挨着换行时收拾——独占一行时前后换行合并成较大的那一个（前\n标签\n后=前\n后；前\n\n标签\n\n后=前\n\n后），开头/结尾的独占行连同换行一并去掉，连在一起的多个标签合成一个；行内标签（前后都不是换行）原样只去标签、两侧空格保留。服务端一侧（流式过滤要求「已流出去的是最终结果的前缀」）不动，只去 Z] [注释时间 2026-11-02] */
      if (side === 'fe') {
        s = s.replace(/\u0001(?:\s*\u0001)+/g, Z);
        s = s.replace(/^(?:[ \t]*\u0001[ \t]*\n+)+/, '').replace(/(?:\n+[ \t]*\u0001[ \t]*)+\s*$/, '');
        s = s.replace(/(\n*)([ \t]*)\u0001([ \t]*)(\n*)/g, function (_, b, sp1, sp2, a) { return (b || a) ? '\n'.repeat(Math.max(b.length, a.length)) : sp1 + sp2; });
      }
      s = s.replace(/\u0001/g, '');
    }
    return cm.restore(s);
  }

  /* ---------- 卡片 <card> 里的 JSON（容错修复：前端渲染与服务端落库共用这一份） ----------
     [位置:phone-tags.js·fixCardJSON/normCard/parseCard/fixCardTags] [卡片 JSON 的容错解析与落库前修复]
     [11-06：「这个标签怎么不显示卡片了」——AI 写卡片偶发漏最外层 }，前端 JSON.parse 失败后整块静默消失（连 JSON 一起没了）。
      查全量历史 195 张卡：17 张 JSON 语法错（16 张漏最外层 }、1 张 block 里少写字段名 t）、1 张老格式没 type。
      修复只在字符串外动手（不猜字符串内容）：补未闭合的 }/]、去掉 }/] 前的多余逗号、对象键位上的裸字符串补 "t":；
      长度上限 20k；没有任何改动就返回 null（说明是另一类语法错，交给调用方兜底提示，不瞎猜）。
      前端 phone-talk.js·cardFrom 用它画卡；服务端 server.js·appendMessages·card 用 fixCardTags 落库前修一遍]
     [注释时间 2026-11-06] */
  var CARD_JSON_MAX = 20000;
  function fixCardJSON(s) {
    if (!s || s.length > CARD_JSON_MAX) return null;
    var out = [], st = [], ins = false, esc = false, i = 0, ch, k, j, e2, nx, prev, pc, c2;
    while (i < s.length) {
      ch = s.charAt(i);
      if (ins) { out.push(ch); if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') ins = false; i++; continue; }
      if (ch === '"') {
        prev = -1; for (k = out.length - 1; k >= 0; k--) { if (!/\s/.test(out[k])) { prev = k; break; } }
        pc = prev >= 0 ? out[prev] : '';
        if (st.length && st[st.length - 1] === '{' && (pc === '{' || pc === ',')) {   /* 对象里、正处键位：这个字符串后面不是冒号，就是 AI 少写了字段名（block 里通常是 t） */
          j = i + 1; e2 = false;
          while (j < s.length) { c2 = s.charAt(j); if (e2) e2 = false; else if (c2 === '\\') e2 = true; else if (c2 === '"') break; j++; }
          nx = j + 1; while (nx < s.length && /\s/.test(s.charAt(nx))) nx++;
          if (s.charAt(nx) !== ':') out.push('"t":');
        }
        ins = true; out.push(ch); i++; continue;
      }
      if (ch === '{' || ch === '[') { st.push(ch); out.push(ch); i++; continue; }
      if (ch === '}' || ch === ']') {
        for (k = out.length - 1; k >= 0 && /\s/.test(out[k]); k--);
        if (k >= 0 && out[k] === ',') out.splice(k, 1);
        if (st.length) st.pop();
        out.push(ch); i++; continue;
      }
      out.push(ch); i++;
    }
    if (ins) return null;                              /* 字符串都没闭合（写了一半），别猜 */
    for (k = st.length - 1; k >= 0; k--) out.push(st[k] === '{' ? '}' : ']');
    var r = out.join('');
    return r === s ? null : r;                          /* 什么都没改 = 另一类语法错 */
  }
  /* 老格式补类型：10-27 那张 {"id":"lunch-1027","q":…,"opts":[…]} 没有 type，原来被当无效卡丢掉 */
  function normCard(c) {
    if (!c || typeof c !== 'object') return null;
    if (!c.type) { if (Array.isArray(c.blocks)) c.type = 'blocks'; else if (Array.isArray(c.opts)) c.type = 'choice'; else if (Array.isArray(c.items)) c.type = 'checklist'; }
    return (typeof c.type === 'string' && c.type) ? c : null;
  }
  /* 解析一段 <card> 里的 JSON：裸 parse 不通就修一次；返回 {card, fixed}；修不好返回 null */
  function parseCard(s) {
    var t = String(s == null ? '' : s).trim(), c = null, fixed = false;
    if (!t) return null;
    try { c = JSON.parse(t); }
    catch (e) {
      var f = fixCardJSON(t);
      if (f) { try { c = JSON.parse(f); fixed = true; } catch (e2) { c = null; } }
      if (!c) return null;
    }
    c = normCard(c);
    return c ? { card: c, fixed: fixed } : null;
  }
  /* 修正文里所有 <card>{…}</card> 段的 JSON（掩码里的不动：讲解用的示例原样保留）。
     返回 {text, fixed, bad}；一段都不用动时返回 null（调用方原样用，零成本） */
  function fixCardTags(text) {
    if (typeof text !== 'string' || text.indexOf('<card') < 0) return null;
    var cm = mask(text), fixed = 0, bad = 0;
    var out = cm.text.replace(/<card>\s*(\{[\s\S]*?)<\/card>/gi, function (all, j) {
      var raw = cm.restore(j), ok = true;
      try { JSON.parse(raw.trim()); } catch (e) { ok = false; }
      if (ok) return all;
      var f = fixCardJSON(raw.trim());
      if (f) { try { JSON.parse(f); fixed++; return '<card>' + f + '</card>'; } catch (e2) {} }
      bad++; return all;
    });
    if (!fixed && !bad) return null;
    return { text: cm.restore(out), fixed: fixed, bad: bad };
  }

  /* ---------- 用户回执 <card_reply>（显示层：气泡/复制朗读/列表预览共用这一份） ----------
     [位置:phone-tags.js·cardReplyView] [回执标签在显示层怎么处理]
     [11-06：回执改成「答案装在标签里」——<card_reply id="…">q1：…；q2：…</card_reply>，标签外不再有正文。
      显示层不能再像以前那样整段删掉（那样气泡会是空的），要保留标签里的内容。
      三种形态一起认：①新格式（内容是文字）→ 保留内容；②老格式（内容是内嵌 JSON，以 { 或 [ 开头）→ 整段丢掉，
      它的正文本来在标签前面；③自闭合 <card_reply id="…"/>（曾经短暂用过）→ 丢掉。
      单遍交替匹配：先从左到右咬最外层的标签，答案文字里若本身写着 <card_reply id=…/> 也不会被二次处理]
     [注释时间 2026-11-06] */
  function cardReplyView(text) {
    var t = String(text == null ? '' : text);
    /* 真回执的 id 一定带引号（我们自己生成的都是 id="form-…"）；讲解里写的 <card_reply id=…> 是示例，
       按回执咬合会把示例当起点、跨过真回执咬错段落（11-06 全量回放发现 2 条历史因此显示错位） */
    t = t.replace(/\n?<card_reply\b[^>]*\bid\s*=\s*["'][^"']*["'][^>]*\/>|\n?<card_reply\b[^>]*\bid\s*=\s*["'][^"']*["'][^>]*>([\s\S]*?)<\/card_reply\s*>/gi,
      function (all, inner) {
        if (inner == null) return '';                      /* 自闭合：没有内容可留 */
        return /^\s*[\[{]/.test(inner) ? '' : inner;       /* 老格式内嵌 JSON 丢掉；新格式保留答案 */
      });
    return t.replace(/<\/?card_reply\b[^>]*>/gi, '');      /* 剩下的孤儿标记（有尾没头、半截、讲解示例）清掉，别露在气泡里 */
  }

  return { TAGS: TAGS, BY: BY, names: names, mask: mask, withMask: withMask, strip: strip,
    parseCard: parseCard, fixCardJSON: fixCardJSON, fixCardTags: fixCardTags,
    cardReplyView: cardReplyView,
    stripSrv: function (t) { return strip(t, 'srv'); }, stripFe: function (t) { return strip(t, 'fe'); } };
});
