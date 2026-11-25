'use strict';
// http_json.js（2026-10-03 新增，2026-10-16 扩展为统一工具模块）
// 所有记忆系统（distill / backfill / summary）和 conversation-state 共用的基础函数。
//
// 为什么不直接用全局 fetch：它的底层 undici 有 300s 的 headersTimeout，
// 上游处理几万字 prompt 常常超过 300s 才吐第一个字节 —— 那种情况下不是我们 abort，
// 是 undici 先抛 UND_ERR_HEADERS_TIMEOUT（memory-distill.js:545-548 实跑踩过）。

const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs-extra");

// ──────────────────────────────────────────────
//  httpPostJson — 记忆系统用的「原始响应」版本
//  返回 { status, text }，调用者自行处理状态码和 JSON 解析
// ──────────────────────────────────────────────
function httpPostJson(url, bodyStr, headers, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(String(url)); } catch (e) { return reject(new Error("非法 URL: " + url)); }
    const lib = u.protocol === "https:" ? https : http;
    const buf = Buffer.from(bodyStr, "utf-8");
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: (u.pathname || "/") + (u.search || ""),
      method: "POST",
      headers: Object.assign({ "Content-Length": buf.length }, headers || {}),
    }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf-8") });
      });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs || 600000, function () {
      req.destroy(new Error("LLM 请求超时（" + Math.round((timeoutMs || 600000) / 1000) + "s 内上游未响应）"));
    });
    req.on("error", function (err) {
      reject(new Error((err && err.message ? err.message : String(err)) +
        (err && err.code ? " [" + err.code + "]" : "")));
    });
    req.write(buf);
    req.end();
  });
}

// ──────────────────────────────────────────────
//  httpPostJsonParsed — conversation-state 用的「自动解析」版本
//  自动解析 JSON 并在非 2xx 时 reject
// ──────────────────────────────────────────────
function httpPostJsonParsed(url, bodyStr, headers, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try {
      u = new URL(String(url));
    } catch (e) {
      return reject(new Error("URL 非法: " + url));
    }
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: Object.assign({ "Content-Length": Buffer.byteLength(bodyStr) }, headers || {}),
      },
      function (res) {
        const chunks = [];
        res.on("data", function (c) { chunks.push(c); });
        res.on("end", function () {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error("HTTP " + res.statusCode + ": " + raw.slice(0, 400)));
          }
          let json;
          try {
            json = JSON.parse(raw);
          } catch (e) {
            return reject(new Error("上游返回非 JSON（HTTP " + res.statusCode + "）：" + raw.slice(0, 400)));
          }
          resolve(json);
        });
      }
    );
    req.setTimeout(timeoutMs || 600000, function () {
      req.destroy(new Error("请求超时（" + (timeoutMs || 600000) / 1000 + "s）"));
    });
    req.on("error", function (err) {
      reject(new Error((err && err.message ? err.message : String(err)) +
        (err && err.code ? " [" + err.code + "]" : "")));
    });
    req.end(bodyStr);
  });
}

// ──────────────────────────────────────────────
//  readJsonSafe — 安全读取 JSON 文件
// ──────────────────────────────────────────────
function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const j = fs.readJsonSync(file);
    return (j && typeof j === "object") ? j : fallback;
  } catch (e) { return fallback; }
}

// ──────────────────────────────────────────────
//  pad2 / normalizeTime — 时间格式化
//  注意：normalizeTime 依赖各模块自己的 DEFAULT_CONFIG.time 作为 fallback，
//  所以导出为高阶函数，由调用者传入默认值。
// ──────────────────────────────────────────────
function pad2(n) { return String(n).padStart ? String(n).padStart(2, "0") : (Number(n) < 10 ? "0" + n : String(n)); }

function makeNormalizeTime(defaultTime) {
  return function normalizeTime(raw) {
    const s = String(raw == null ? "" : raw).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return defaultTime;
    const h = Math.min(23, Math.max(0, Number(m[1])));
    const mi = Math.min(59, Math.max(0, Number(m[2])));
    return pad2(h) + ":" + pad2(mi);
  };
}

// ──────────────────────────────────────────────
//  EVIDENCE_SKIP_PATTERNS — 证据跳过模式
//  合并了 distill（基础5条）和 backfill（+Bark推送噪声）的完整集合。
//  所有消费者共用同一份，避免漏改。
// ──────────────────────────────────────────────
const EVIDENCE_SKIP_PATTERNS = [
  // 基础：记忆池/注入产物混进时间线的痕迹
  /\[此刻想起\]/,
  /\[记忆\]/,
  /\[长期记忆\]/,
  /\[Earlier Days\]/,
  /^\s*【记忆/,
  // Bark 推送日志噪声（1002-20 实跑暴露，backfill 先加的，现在统一到所有消费者）
  /刚刚给.{0,8}发了.{0,20}推送/, /Bark推送/, /下次唤醒时间/, /undefined推送/,
  // 2026-10-08 回执简化后新格式
  /发送成功，时间：/, /本次未推送/, /未发送推送/, /唤醒设置成功/, /下一次系统自动唤醒时间/, /日记写入成功/,
];

module.exports = {
  httpPostJson,
  httpPostJsonParsed,
  readJsonSafe,
  pad2,
  makeNormalizeTime,
  EVIDENCE_SKIP_PATTERNS,
};
