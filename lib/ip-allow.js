'use strict';
// ip-allow.js —— 发送前的来源 IP 白名单。
// 目的：即使 gateway key 或会话 cookie 泄露，请求也会在「翻译成上游请求之前」被拒，
// 不消耗额度、不落消息。白名单为空 = 不限制（默认，保持现状）。
//
// 支持的写法：
//   1.2.3.4          单 IP
//   1.2.3.0/24       CIDR
//   1.2.3            前缀（等价 1.2.3.*）
//   10.              网段前缀

function normalize(ip) {
  let s = String(ip || '').trim();
  if (!s) return '';
  s = s.replace(/^::ffff:/i, '');
  if (s === '::1') s = '127.0.0.1';
  return s;
}

function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const p = parts[i];
    if (!/^\d+$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function matchEntry(ip, entry) {
  const e = String(entry || '').trim();
  if (!e) return false;
  if (e.indexOf('/') >= 0) {
    const seg = e.split('/');
    const bits = Number(seg[1]);
    const base = ipToInt(normalize(seg[0]));
    const target = ipToInt(ip);
    if (base === null || target === null) return false;
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return ((target & mask) >>> 0) === ((base & mask) >>> 0);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(e)) return ip === normalize(e);
  if (/^\d+(\.\d+){0,2}\.?$/.test(e)) {
    const prefix = e.endsWith('.') ? e : e + '.';
    return ip.indexOf(prefix) === 0;
  }
  return ip === normalize(e);
}

function isAllowed(ip, list) {
  const target = normalize(ip);
  if (!target) return false;
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return true;
  for (let i = 0; i < arr.length; i++) {
    if (matchEntry(target, arr[i])) return true;
  }
  return false;
}

module.exports = { isAllowed: isAllowed, normalize: normalize, matchEntry: matchEntry };
