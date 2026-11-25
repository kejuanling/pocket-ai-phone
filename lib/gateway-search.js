"use strict";
/* [位置:lib/gateway-search.js] [后台按关键词检索聊天原文：调网关自己的 /internal/search] [11-09：AI 的 context 工具、手机搜索、后台（记忆蒸馏、状态机检索回合、记忆回填）三类调用方原来各有一套找原文的办法；后台那套（向量语义）对生僻词、专有名词、多个词很不准，实测 16 个样本找回 2 个，网关这套（字面相似 + 关键词）14 个全在第一。收拢成只有网关一份，后台用 HTTP 调它——状态机在 state-worker 独立进程里，没法直接用网关里的函数（它依赖 server.js 的一大串东西），所以统一走 HTTP；鉴权同 /internal/ 其他接口（x-internal-key），网关地址沿用 state-worker 回调网关的 GATEWAY_CALLBACK_URL，没配就是本机网关端口] [注释时间 2026-11-09] */
const http = require("http");
const https = require("https");

const TIMEOUT_MS = 20000;

function baseUrl(opts) {
  const o = opts || {};
  return String(o.baseUrl || process.env.GATEWAY_CALLBACK_URL || ("http://127.0.0.1:" + (Number(process.env.PORT) || 3000))).replace(/\/+$/, "");
}

/* 参数：{ q, limit, timePrefix }；opts（仅测试用）：{ baseUrl, key, timeoutMs }
   成功返回网关的响应体 { ok, total, results:[{sid,sidx,text,score,time(毫秒),msg_id,role}] }；失败（网络、超时、非 2xx、响应不是 JSON、ok 不是 true）一律抛 Error，由调用方决定怎么记 */
function search(params, opts) {
  const o = opts || {};
  const p = params || {};
  const key = String(o.key || process.env.INTERNAL_API_KEY || "").trim();
  if (!key) return Promise.reject(new Error("INTERNAL_API_KEY 未配置，后台检索调不了网关"));
  const q = String(p.q || "").trim();
  if (!q) return Promise.reject(new Error("检索词为空"));
  let u;
  try {
    u = new URL(baseUrl(o) + "/internal/search");
  } catch (e) {
    return Promise.reject(new Error("网关地址不合法：" + e.message));
  }
  u.searchParams.set("q", q);
  u.searchParams.set("with_id", "1");
  u.searchParams.set("limit", String(Math.max(1, Math.min(500, Math.floor(Number(p.limit) || 10)))));
  if (p.timePrefix) u.searchParams.set("time_prefix", String(p.timePrefix));
  const mod = u.protocol === "https:" ? https : http;
  const timeoutMs = Number(o.timeoutMs) || TIMEOUT_MS;
  return new Promise(function (resolve, reject) {
    const req = mod.get(u, { headers: { "x-internal-key": key } }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try { body = JSON.parse(text); } catch (e) { /* 下面统一报错 */ }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error("网关 HTTP " + res.statusCode + (body && body.error ? "：" + body.error : "")));
        }
        if (!body || body.ok !== true) return reject(new Error("网关返回不是预期的 JSON"));
        resolve(body);
      });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, function () { req.destroy(new Error("网关检索超时（" + timeoutMs + "ms）")); });
    req.on("error", reject);
  });
}

module.exports = { search, baseUrl };
