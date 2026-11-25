"use strict";
/* [位置:lib/tag-actions.js] [新标签 → 调工具集里同名工具（属性名 = 工具参数名）] [10-28 第6项：纯写入、不要返回值的动作做成标签，和工具二选一——lovediary(letter)/notebook/todo/mood/period/reply(碎碎念回复)/album(改批注)/star(msg_ids)/wake(time…) 。标签不自己再写一遍业务：直接转调 8771 工具集里的同一个工具（鉴权/校验/落库/推送/重挂定时器全走工具那条，口径只有一份），属性名就是工具的参数名，正文是该工具的主文本参数。成功静默，失败收集成一行说明（ctx.notes），由调用方在回复落盘后追加一条 developer 消息，下一轮 AI 看得到、前端不显示。代码块/表格/反引号里的标签不解析（用 PHTags 掩码）。旧写法（<memory>{kind:}、<paper>、<star/> 标本条、<wake>30 keep=true</wake>、[DIARY]、[push]、[NO_ACTION]）不在这里，照旧走原来的解析] 11-09 产品确定：带 msg_ids 的 <star> 转调 context star 的分支删除（context 工具的 star/list 动作下线，只剩 search/get）；<star/> 标本条回复是 tag-parser 里的独立实现，不受影响] [注释时间 2026-11-09] */
const fs = require("fs");
const path = require("path");
const T = require("../workspace/phone-tags.js");

const SCOPED = new Set(["lovediary", "notebook", "album", "context", "wake", "memory"]);   // 网关对这些工具强制注入 session_id（同 mcp-tool-loop SESSION_SCOPED_TOOLS）

// ---- 属性解析：name="v" / name='v' / name=v ----
function parseAttrs(str) {
  const out = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>\/]+))/g;
  let m;
  while ((m = re.exec(String(str || "")))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
  return out;
}

// ---- 在掩码文本里按出现顺序找某个标签（自闭合 / 成对），属性值和正文还原后返回 ----
function findTags(cm, name) {
  const n = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("<\\s*" + n + "\\b([^>]*?)\\/\\s*>|<\\s*" + n + "\\b([^>]*)>([\\s\\S]*?)<\\s*\\/" + n + "\\s*>", "gi");
  const out = [];
  let m;
  while ((m = re.exec(cm.text))) {
    const attrStr = m[1] !== undefined ? m[1] : m[2];
    const attrs = parseAttrs(attrStr);
    Object.keys(attrs).forEach(function (k) { attrs[k] = cm.restore(attrs[k]); });
    out.push({ name: name, attrs: attrs, body: m[1] !== undefined ? "" : cm.restore(m[3] || "").trim(), index: m.index });
  }
  return out;
}

function toBool(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (["true", "1", "yes", "on"].indexOf(s) >= 0) return true;
  if (["false", "0", "no", "off"].indexOf(s) >= 0) return false;
  return null;
}
function toInt(v) { const n = parseInt(String(v == null ? "" : v).trim(), 10); return Number.isFinite(n) ? n : null; }
function clean(o) { const r = {}; Object.keys(o).forEach(function (k) { if (o[k] !== undefined && o[k] !== null && o[k] !== "") r[k] = o[k]; }); return r; }

// ---- 每种标签 → { tool, args } 或 { error }（参数检查在这里，调用与结果判定统一在 run） ----
const BUILDERS = {
  lovediary(t) {   // 只管信封；日记（不写 kind 或 kind=diary）走原来的日记通道（lib/diary.js），不在这里
    if (!/^(letter|envelope|信封)$/i.test(String(t.attrs.kind || ""))) return null;
    if (!t.body) return { error: "信封没有正文" };
    return { tool: "lovediary", args: clean({ action: "add", kind: "letter", title: t.attrs.title, content: t.body }) };
  },
  notebook(t) {
    const a = t.attrs;
    if (a.id !== undefined && a.id !== "") {
      const id = toInt(a.id);
      if (id === null) return { error: "id 不是数字：" + a.id };
      if (!t.body && !a.title && !a.summary && !a.reason) return { error: "没写要改什么（正文/title/summary/reason 至少一个）" };
      return { tool: "notebook", args: clean({ action: "edit", id: id, content: t.body, mode: a.mode, title: a.title, summary: a.summary, reason: a.reason }) };
    }
    if (!t.body) return { error: "笔记没有正文" };
    return { tool: "notebook", args: clean({ action: "add", content: t.body, title: a.title, summary: a.summary, reason: a.reason }) };
  },
  todo(t) {
    if (!t.body) return { error: "待办没有正文" };
    return { tool: "todo", args: clean({ action: "add", text: t.body, remind_at: t.attrs.remind_at }) };
  },
  mood(t) {
    const a = t.attrs;
    const ids = a.ids ? String(a.ids).split(/[,，\s]+/).filter(Boolean).map(function (x) { const n = toInt(x); return n === null ? x : n; }) : [];
    const custom = t.body || a.custom || "";
    if (!ids.length && !custom) return { error: "没写心情（ids 或正文至少一个）" };
    return { tool: "mood", args: clean({ action: "set", date: a.date, ids: ids.length ? ids : undefined, custom: custom }) };
  },
  period(t) {
    const on = toBool(t.attrs.on);
    if (!t.attrs.date) return { error: "没写 date" };
    if (on === null) return { error: "on 要写 true 或 false" };
    return { tool: "period", args: { action: "set", date: t.attrs.date, on: on } };
  },
  reply(t) {
    const id = toInt(t.attrs.id);
    if (id === null) return { error: "没写碎碎念 id" };
    if (!t.body) return { error: "回复没有正文" };
    return { tool: "her_murmurs", args: { action: "reply", id: id, text: t.body } };
  },
  album(t) {   // 存图（img/id=img-…）仍走 tag-parser 里原来的入册；这里只管给相册条目改批注：id 是 al_ 开头
    const id = String(t.attrs.id || "");
    if (!/^al_/.test(id)) return null;
    const note = t.body || t.attrs.note || "";
    if (!note) return { error: "批注为空" };
    return { tool: "album", args: { action: "note", id: id, note: note } };
  },
  nowplaying(t) {   // 网易云推歌：在她手机上放一首（10-28：<np> 的英文打全）。songid 写属性或正文都行
    const id = String(t.attrs.songid || t.body || "").trim();
    if (!/^\d+$/.test(id)) return { error: "songid 要写数字歌曲 id" };
    return { tool: "netease", args: { action: "push", songid: id } };
  },
  addplaylist(t) {   // 网易云加歌单：逗号分隔的歌曲 id，写正文（或 songids 属性），1-100 个
    const ids = String(t.body || t.attrs.songids || "").split(/[,，\s]+/).filter(Boolean);
    if (!ids.length) return { error: "没写歌曲 id" };
    if (ids.length > 100) return { error: "一次最多 100 首" };
    if (ids.some(function (x) { return !/^\d+$/.test(x); })) return { error: "歌曲 id 要是数字，逗号分隔" };
    return { tool: "netease", args: { action: "add_to_playlist", songIds: ids } };
  },
  wake(t) {   // 新写法：带 time / action 属性；旧写法 <wake>30 keep=true</wake>（不带属性）不在这里
    const a = t.attrs;
    const act = String(a.action || "").toLowerCase();
    if (act === "delete") return a.alarm_id ? { tool: "wake", args: { action: "delete", alarm_id: a.alarm_id } } : { error: "删闹钟要写 alarm_id" };
    if (act === "clear") return { tool: "wake", args: { action: "clear" } };
    if (a.time === undefined) return null;
    return { tool: "wake", args: clean({ action: "set", time: a.time, repeat: a.repeat, label: a.label || t.body }) };
  }
};
const NAMES = Object.keys(BUILDERS);

// ---- 转调 8771 工具集（地址与鉴权读 config/mcp-servers.json 里「工具集合」那一条，和聊天用同一份） ----
function toolsServer() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "mcp-servers.json"), "utf-8"));
    const list = Array.isArray(cfg) ? cfg : (cfg.servers || Object.values(cfg));
    const s = list.filter(function (x) { return x && /:8771\b/.test(String(x.url || "")); })[0];
    /* [位置:lib/tag-actions.js·toolsServer 解析密钥占位符] [标签转调工具集一直 401 的根因] [11-03 让查「标签解析好像有问题、AI 用过一些标签都失败了」：时间线里 developer 的「没写成」回执全是「工具集 HTTP 401」（wake/todo/nowplaying 等）。原因：mcp-servers.json 里密钥已迁成占位符 `Bearer ${secret:…}`（mcp-client.js 起 MCP 连接时会 resolveSecrets 还原），这里却把 headers 原样当请求头发，工具集收到的是字面占位符→401。改成同样 resolveSecrets 还原后再发。影响面：所有新写法标签（lovediary/notebook/todo/mood/period/reply/album/star/wake/nowplaying/netease…）从密钥迁移起一直失败] [注释时间 2026-11-03] */
    let hdr = s.headers || {};
    try { hdr = require("../mcp/mcp-client").resolveSecrets(hdr); } catch (e) { /* 取不到就按原样（旧行为） */ }
    return { url: process.env.TAG_TOOLS_URL || s.url, headers: hdr };   // TAG_TOOLS_URL 只给测试（指向影子实例）
  } catch (e) { /* 退回环境变量 */ }
  return { url: "http://127.0.0.1:8771/", headers: process.env.MCP_TOOLS_API_TOKEN ? { Authorization: "Bearer " + process.env.MCP_TOOLS_API_TOKEN } : {} };
}
async function callTool(name, args, timeoutMs) {
  const s = toolsServer();
  const res = await fetch(s.url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, s.headers),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs || 8000)
  });
  const raw = await res.text();
  if (!res.ok) throw new Error("工具集 HTTP " + res.status);
  const line = raw.split("\n").filter(function (l) { return l.indexOf("data:") === 0; })[0];
  const rpc = JSON.parse(line ? line.slice(5).trim() : raw);
  if (rpc.error) throw new Error(rpc.error.message || "工具集报错");
  const txt = rpc.result && rpc.result.content && rpc.result.content[0] && rpc.result.content[0].text;
  if (rpc.result && rpc.result.isError) throw new Error(String(txt || "工具返回错误").slice(0, 120));   // 代理工具（netease）透传上游 result，失败标在 isError 上
  let data = null;
  try { data = JSON.parse(txt); } catch (e) { data = { text: txt }; }
  return data;
}
function failReason(data) {
  if (!data || typeof data !== "object") return "";
  if (data.error) return String(data.error);
  if (data._error) return String(data._error);   // 工具集代理上游（8777 等）失败时用的键（实测过期的 remind_at 回 {"_error":"HTTP Error 400"}）
  if (data.ok === false) return String(data.error || data.message || "失败");
  if (data.success === false) return String(data.error || data.message || "失败");
  return "";
}

// 收集一条回复里的新写法标签 → 任务数组 [{tag, run:async()=>{ok,error}}]
function collect(cm, ctx) {
  const tasks = [];
  NAMES.forEach(function (name) {
    findTags(cm, name).forEach(function (t) {
      const b = BUILDERS[name](t);
      if (!b) return;
      tasks.push({
        tag: name, index: t.index,
        run: async function () {
          if (b.error) return { tag: name, ok: false, error: b.error };
          const args = Object.assign({}, b.args);
          if (SCOPED.has(b.tool) && ctx && ctx.sessionId) args.session_id = String(ctx.sessionId);
          try {
            const data = await (ctx && ctx.callTool ? ctx.callTool(b.tool, args) : callTool(b.tool, args));
            const why = failReason(data);
            return why ? { tag: name, ok: false, error: why } : { tag: name, ok: true, data: data };
          } catch (e) {
            return { tag: name, ok: false, error: String(e && e.message || e).slice(0, 120) };
          }
        }
      });
    });
  });
  tasks.sort(function (a, b) { return a.index - b.index; });
  return tasks;
}

// 失败说明（进 developer 消息，AI 下一轮看得到）：一条一行
function failureNote(fails) {
  return fails.map(function (f) { return "上一条 `<" + f.tag + ">` 没写成：" + f.error; }).join("\n");
}

// 唤醒输出里的新写法 push/noaction → 旧的方括号记号，后面的推送/静默判定沿用原逻辑（代码块/表格里的不转）
function normalizeWakeTags(text) {
  const cm = T.mask(text);
  const s = cm.text
    .replace(/<\s*push\b[^>]*>([\s\S]*?)<\s*\/push\s*>/gi, function (_, c) { return "[push]" + c + "[/push]"; })
    .replace(/<\s*noaction\b[^>]*>([\s\S]*?)<\s*\/noaction\s*>/gi, function (_, c) { return "[NO_ACTION] " + String(c).trim(); })
    .replace(/<\s*noaction\b[^>]*\/\s*>/gi, "[NO_ACTION]");
  return cm.restore(s);
}

/* [位置:lib/tag-actions.js·speakIsNoaction] [唤醒正文是否静默] [2026-11-19：先写 <trace> 再写 <noaction> 时，只认开头打不上 kind，活动卡没有原因。剥掉开头一个 <wake> 后，开头是 [NO_ACTION]，或掩码后任意位置有 <noaction>（代码块/反引号/表格里的讲解不算）] [注释时间 2026-11-19] */
function speakIsNoaction(text) {
  const raw = String(text || "").replace(/^\s*<wake\b[^>]*>[\s\S]*?<\/wake>\s*/i, "");
  if (/^\s*\[NO_ACTION\]/i.test(raw)) return true;
  return /<\s*noaction\b/i.test(T.mask(raw).text);
}

module.exports = { parseAttrs, findTags, collect, failureNote, normalizeWakeTags, speakIsNoaction, callTool, NAMES, BUILDERS };
