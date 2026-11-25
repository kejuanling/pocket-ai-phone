'use strict';
// lib/netease-session.js —— 网易云会话/账号辅助：读 netease-music-mcp 的 .env、读写 netease.session（MUSIC_U/__csrf）、用 Cookie 查账号资料
// 2026-11-03 从 server.js 拆出（server.js 拆分批 3；原位置 1959-2020 行，函数体一字未改）。
// 为什么单独成库：/admin/netease 路由（routes/netease-admin.js）与 server.js 的告警扫描（Cookie 失效提醒）都要用。
const fs = require('fs');
const path = require('path');

const NETEASE_DIR = "/opt/netease-music-mcp";
const NETEASE_ENV_FILE = path.join(NETEASE_DIR, ".env");
const NETEASE_SESSION_FILE = path.join(NETEASE_DIR, "data", "netease.session");
const NETEASE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function readNetEaseEnv(key) {
  try {
    const envContent = fs.readFileSync(NETEASE_ENV_FILE, "utf-8");
    const lines = envContent.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(key + "=")) return trimmed.substring(key.length + 1).trim();
    }
  } catch (e) { console.error('[server.js:1788]', e.message || e); }
  return "";
}

function readNeteaseSession() {
  try {
    const raw = fs.readFileSync(NETEASE_SESSION_FILE, "utf-8").trim();
    const musicU = raw.match(/(?:^|;\s*)MUSIC_U=([^;\s]+)/)?.[1] || "";
    const csrf = raw.match(/(?:^|;\s*)__csrf=([^;\s]+)/)?.[1] || "";
    return { musicU, csrf, raw };
  } catch {
    return { musicU: "", csrf: "", raw: "" };
  }
}

function writeNeteaseSession(musicU, csrf) {
  const header = `MUSIC_U=${musicU}` + (csrf ? `; __csrf=${csrf}` : "") + "\n";
  const tmp = NETEASE_SESSION_FILE + ".tmp";
  fs.writeFileSync(tmp, header, { mode: 0o600 });
  fs.renameSync(tmp, NETEASE_SESSION_FILE);
}

// 用 Cookie 调网易云官方接口查账号资料（昵称/userId/VIP 等级），登录状态校验用
async function fetchNeteaseAccount(cookieHeader) {
  if (!cookieHeader) return null;
  try {
    const response = await fetch("https://music.163.com/api/nuser/account/get", {
      headers: {
        Cookie: cookieHeader,
        Referer: "https://music.163.com/",
        "User-Agent": NETEASE_UA
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const profile = data?.profile;
    if (profile && profile.userId) {
      return {
        nickname: String(profile.nickname || ""),
        userId: String(profile.userId),
        vipType: Number(profile.vipType ?? 0)
      };
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { NETEASE_SESSION_FILE, readNetEaseEnv, readNeteaseSession, writeNeteaseSession, fetchNeteaseAccount };
