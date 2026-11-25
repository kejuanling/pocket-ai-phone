'use strict';
// http_stream.js（2026-10-18）：后台 LLM 调用用的「流式 + 网络错误自动重试」基础件。
//
// 为什么：非流式长请求（上游思考/生成一两百秒）在中转站/网络路径上会被掐断，表现为
//   「read ETIMEDOUT」（状态机并入 2026-10-17 00:36、10-18 14:43 两次实测都是等到 ~158s 断线，
//   成功的最长 139s）。改成流式后数据一直有往来，连接不再空闲；再配合网络错误自动重试。
//
// postChatStream(url, bodyStr, headers, idleTimeoutMs)
//   bodyStr 由调用方构造（含 stream:true）。返回与非流式同形的对象：
//   { id, model, choices:[{ message:{ role, content, reasoning_content }, finish_reason }], usage }
//   —— 调用方原来读 data.choices[0].message.content / finish_reason / usage 的代码不用改。
//   上游若忽略 stream 直接回整份 JSON（content-type: application/json），也照样解析返回。
//   idleTimeoutMs 是「连接空闲」超时（有数据往来就不算），不是总时长。
// withRetry(fn, opts)：只重试「连接层」错误与 502/503/504/429；业务错误（4xx、空正文等）不重试。
// friendlyNetError(err, tries)：把 read ETIMEDOUT 这类原始报错说成人话。

const http = require('http');
const https = require('https');
const { URL } = require('url');

const RETRY_DELAYS_MS = [3000, 8000];   // 最多重试 2 次

function _wrapErr(err) {
  const e = new Error((err && err.message ? err.message : String(err)) + (err && err.code ? ' [' + err.code + ']' : ''));
  if (err && err.code) e.code = err.code;
  return e;
}

function postChatStream(url, bodyStr, headers, idleTimeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(String(url)); } catch (e) { return reject(new Error('URL 非法: ' + url)); }
    const mod = u.protocol === 'http:' ? http : https;
    const buf = Buffer.from(String(bodyStr), 'utf8');
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: (u.pathname || '/') + (u.search || ''),
      method: 'POST',
      headers: Object.assign({ 'Content-Length': buf.length, Accept: 'text/event-stream' }, headers || {}),
    }, function (res) {
      const ctype = String(res.headers['content-type'] || '').toLowerCase();
      const status = res.statusCode || 0;
      res.setEncoding('utf8');
      // 非 2xx：收完正文报错（带 httpStatus，供上层判断是否「不支持 stream」「可重试」）
      if (status < 200 || status >= 300) {
        let raw = '';
        res.on('data', function (c) { raw += c; });
        res.on('end', function () { const e = new Error('HTTP ' + status + ': ' + raw.slice(0, 400)); e.httpStatus = status; reject(e); });
        res.on('error', function (err) { reject(_wrapErr(err)); });
        return;
      }
      // 上游忽略 stream、直接回整份 JSON：按非流式解析
      if (ctype.indexOf('text/event-stream') === -1) {
        let raw = '';
        res.on('data', function (c) { raw += c; });
        res.on('end', function () {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('上游返回非 JSON/非流式（HTTP ' + status + '）：' + raw.slice(0, 400))); }
        });
        res.on('error', function (err) { reject(_wrapErr(err)); });
        return;
      }
      let pending = '';
      let content = '', reasoning = '', finish = null, usage = null, id = '', model = '', done = false, streamErr = null;
      function onLine(line) {
        line = line.replace(/\r$/, '');
        if (!line || line.charAt(0) === ':') return;            // 空行 / SSE 注释（心跳）
        if (line.slice(0, 5) !== 'data:') return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') { done = true; return; }
        let evt; try { evt = JSON.parse(payload); } catch (e) { return; }
        if (evt && evt.error) { streamErr = new Error('上游流式报错：' + (evt.error.message || JSON.stringify(evt.error)).slice(0, 300)); return; }
        if (evt.id && !id) id = evt.id;
        if (evt.model && !model) model = evt.model;
        if (evt.usage) usage = evt.usage;
        const ch = evt.choices && evt.choices[0];
        if (!ch) return;
        const d = ch.delta || {};
        if (typeof d.content === 'string') content += d.content;
        if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
        if (ch.finish_reason) finish = ch.finish_reason;
      }
      res.on('data', function (chunk) {
        pending += chunk;
        let i;
        while ((i = pending.indexOf('\n')) !== -1) { onLine(pending.slice(0, i)); pending = pending.slice(i + 1); }
      });
      res.on('end', function () {
        if (pending) onLine(pending);
        if (streamErr) return reject(streamErr);
        // 没收到 [DONE] 也没有 finish_reason：流被中途截断，按网络错误处理（可重试）
        if (!done && !finish) { const e = new Error('上游流在中途断开（未收到结束标记） [ECONNRESET]'); e.code = 'ECONNRESET'; return reject(e); }
        resolve({
          id: id, model: model, object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: content, reasoning_content: reasoning || undefined }, finish_reason: finish }],
          usage: usage,
        });
      });
      res.on('error', function (err) { reject(_wrapErr(err)); });
      res.on('aborted', function () { const e = new Error('上游连接被中途关闭 [ECONNRESET]'); e.code = 'ECONNRESET'; reject(e); });
    });
    req.setTimeout(idleTimeoutMs || 600000, function () {
      const e = new Error('LLM 连接空闲超时（' + Math.round((idleTimeoutMs || 600000) / 1000) + 's 内上游没有任何数据） [ETIMEDOUT]');
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    });
    req.on('error', function (err) { reject(_wrapErr(err)); });
    req.write(buf);
    req.end();
  });
}

const NET_RE = /ETIMEDOUT|ECONNRESET|ECONNABORTED|EPIPE|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|socket hang up|UND_ERR|被中途关闭|在中途断开|空闲超时/i;
function isRetryable(err) {
  if (!err) return false;
  if (err.httpStatus) return [429, 502, 503, 504].indexOf(err.httpStatus) !== -1;
  const m = String(err.message || err);
  if (/^HTTP (429|502|503|504)\b/.test(m)) return true;
  return NET_RE.test(m) || !!(err.code && NET_RE.test(String(err.code)));
}

// 上游不认 stream 参数（4xx 且报错里提到 stream）→ 调用方改走非流式
function isStreamUnsupported(err) {
  if (!err) return false;
  const m = String(err.message || err);
  const st = err.httpStatus || ((m.match(/^HTTP (\d{3})/) || [])[1] | 0);
  return [400, 404, 405, 415, 422].indexOf(st) !== -1 && /stream/i.test(m);
}

async function withRetry(fn, opts) {
  const o = opts || {};
  const delays = Array.isArray(o.delays) ? o.delays : RETRY_DELAYS_MS;
  const label = o.label || 'LLM';
  let lastErr = null;
  for (let i = 0; i <= delays.length; i++) {
    try { return await fn(i); }
    catch (e) {
      lastErr = e;
      if (!isRetryable(e) || i === delays.length) {
        if (isRetryable(e)) e.retriedTimes = i;
        throw e;
      }
      console.warn('[' + label + '] 网络错误，' + Math.round(delays[i] / 1000) + 's 后自动重试（第 ' + (i + 1) + '/' + delays.length + ' 次）：' + (e.message || e));
      if (delays[i] > 0) await new Promise(function (r) { setTimeout(r, delays[i]); });
    }
  }
  throw lastErr;
}

// 把原始网络报错说成人话（保留原始信息在括号里，方便排查）
function friendlyNetError(err) {
  if (!err || !isRetryable(err)) return err;
  const n = err.retriedTimes || 0;
  const e = new Error('上游连接中途断开' + (n ? '（已自动重试 ' + n + ' 次仍失败）' : '') +
    '，可稍后再试，或把并入区间选小一点；原始报错：' + String(err.message || err).slice(0, 160));
  e.cause = err;
  return e;
}

module.exports = { postChatStream, withRetry, isRetryable, isStreamUnsupported, friendlyNetError, RETRY_DELAYS_MS };
