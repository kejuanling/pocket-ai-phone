/* [位置:lib/trace.js] [此刻 <trace>：把 AI 回复里自己写的「心里的地方」提取出来，存成消息的 trace 字段] [11-04 引入（思路来自开源项目 lucienkeke-jj/cike-trace，MIT）；11-07 已确定：整句存——不再拆气味名/情绪/想要选了忍住字段（旧解析对单行短句格式丢损 12/14，根因废除），也不再区分 <trace lock>（lock 功能整个去掉，万一 AI 还写 lock 属性，标签照样剥、内容按普通 trace 存）；
   存储规则：① 消息上存 trace:{content,at}；② 11-08 产品确定「trace 落盘保留、显示给 AI」：正文原样落时间线（keepBody=true），AI 后续上下文看得到自己写过的此刻（防模板化的隔离取消是拍板内容）；前端显示不变——流式 srv:drop 与历史渲染 fe:drop 照剥，气泡靠 msg.trace。旧行为（正文剥掉、不回灌）保留为默认参数，回滚=server.js 去掉第三参。
   写入点只有一个：extractFromMessage(msg, sessionId, keepBody)，appendMessages 调；逐条记录库在 lib/trace-notes.js。] [注释时间 2026-11-08（11-07 重写；11-08 keepBody）] */
"use strict";
const PHTags = require("../workspace/phone-tags.js");

/* 11-04 事故加固（保留，防吞字与字段无关）：AI 在叙述里提到 <trace> 却没闭合，旧规则把它当「忘了闭合的 trace」，后面整段正文都被吞进 trace，气泡只剩 184 字。
   现在：① 成对只配最近的开标签（body 里不能再出现 <trace）且正文 ≤1500 字，否则当普通文字不动；② 没闭合的只认「句末/行首之后、且后面 ≤600 字」的（真实的 trace 都很短、写在回复末尾），其余当提到标签，不吞字。
   lock 属性仍留在正则里只为「标签能剥干净」，不再有私密分支。 */
const TRACE_RE = /<trace(\s+lock(?:ed)?)?\s*>((?:(?!<trace\b)[\s\S])*?)<\/trace\s*>/gi;
const TRACE_OPEN_RE = /<trace(\s+lock(?:ed)?)?\s*>((?:(?!<trace\b)[\s\S])*)$/i;   // 忘了闭合：算到结尾（但见 take 里的限制）
const MAX_BODY = 1500, MAX_OPEN_BODY = 600;
const SENT_END = /(?:^|[\n。！？!?.…~～）)」』”"])\s*$/;

/* 11-07 整句化：trace 内容就是一句话，不拆字段。上限 600 字与 trace-notes 库一致。 */
function parseTrace(body) {
  const c = String(body == null ? "" : body).trim().slice(0, 600);
  return c ? { content: c } : null;   // 剥出来是空的返回 null，不挂空 trace（2026-11-07）
}

/* 从一段文本里剥出 trace。返回 { text, trace }：trace=null | {content}；多个 <trace> 取最后一个有内容的。 */
function stripTrace(input) {
  const raw = String(input == null ? "" : input);
  if (raw.toLowerCase().indexOf("<trace") < 0) return { text: raw, trace: null };
  const cm = PHTags.mask(raw);
  let trace = null;
  const take = (_m, _lock, body, offset, whole) => {
    const b = cm.restore(body || "").trim();
    const closed = /<\/trace\s*>$/i.test(_m);
    if (closed ? b.length > MAX_BODY : (b.length > MAX_OPEN_BODY || !SENT_END.test(String(whole).slice(0, offset)))) return _m;   // 不像真 trace：原样留着
    if (!b) return "";
    trace = parseTrace(b);
    return "";
  };
  let s = cm.text.replace(TRACE_RE, take).replace(TRACE_OPEN_RE, take).replace(/<\/?trace[^>]*>/gi, "");
  s = cm.restore(s).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: s, trace };
}

/* appendMessages 调：就地处理一条待落盘消息，trace 挂在 msg.trace。
   keepBody=false（默认=11-07 旧行为）：content / segments / stream_timeline 里的 <trace> 全剥掉。
   keepBody=true（11-08 产品确定）：只提取不回写——正文原样落时间线（AI 后续上下文看得到自己写过的此刻；前端显示不变：流式 srv:drop 与历史渲染 fe:drop 照剥，气泡靠 msg.trace）；segments/stream_timeline 不动。回滚=server.js 去掉第三参。
   返回 true=这条有 trace。只处理 assistant 且 content 为字符串的消息。 */
function extractFromMessage(msg, sessionId, keepBody) {
  if (!msg || msg.role !== "assistant") return false;
  const scrub = (v) => (typeof v === "string" && v.toLowerCase().indexOf("<trace") >= 0) ? stripTrace(v) : null;
  let found = null;
  const c = scrub(msg.content);
  if (c && c.trace) found = c.trace;
  if (keepBody) { if (found) msg.trace = Object.assign({}, found, { at: new Date().toISOString() }); return !!found; }
  let changed = false;
  if (c) { msg.content = c.text; changed = true; }
  if (Array.isArray(msg.segments)) {
    msg.segments = msg.segments.map((sg) => {
      if (typeof sg === "string") { const r = scrub(sg); if (r) { changed = true; if (!found && r.trace) found = r.trace; return r.text; } return sg; }
      if (sg && typeof sg === "object" && typeof sg.text === "string") { const r = scrub(sg.text); if (r) { changed = true; if (!found && r.trace) found = r.trace; return Object.assign({}, sg, { text: r.text }); } }
      return sg;
    }).filter((sg) => !(typeof sg === "string" && !sg.trim()));
  }
  if (Array.isArray(msg.stream_timeline)) {
    msg.stream_timeline = msg.stream_timeline.map((n) => {
      if (n && n.type === "text" && typeof n.text === "string") { const r = scrub(n.text); if (r) { changed = true; if (!found && r.trace) found = r.trace; return Object.assign({}, n, { text: r.text }); } }
      return n;
    });
  }
  if (!changed) return false;
  if (found) msg.trace = Object.assign({}, found, { at: new Date().toISOString() });
  return !!found;
}

module.exports = { parseTrace, stripTrace, extractFromMessage };
