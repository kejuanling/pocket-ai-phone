'use strict';
// routes/netease-admin.js —— 网易云管理接口：/admin/netease（环境+账号状态）、/admin/netease/save（手填 MUSIC_U）、
//   /admin/netease/qr/create + /admin/netease/qr/check（扫码登录，直调网易 eapi）
// 2026-11-03 从 server.js 拆出（server.js 拆分批 3；原位置 3823-3942 行，逻辑一字未改；eapi 加密辅助函数 NETEASE_EAPI_KEY/neteaseEapiParams/
//   neteaseEapiHeader/neteaseEapiPost 只在本文件使用，一并搬来；fs/crypto 就地 require）。
// 依赖注入：basicAuth、readNetEaseEnv/readNeteaseSession/writeNeteaseSession/fetchNeteaseAccount/NETEASE_SESSION_FILE（来自 lib/netease-session.js，
//   server.js 的告警扫描也用）、TIME_ZONE、formatDateTimeInTimeZone。
const fs = require('fs');
const crypto = require('crypto');

module.exports = function (app, deps) {
const { basicAuth, readNetEaseEnv, readNeteaseSession, writeNeteaseSession, fetchNeteaseAccount, NETEASE_SESSION_FILE, TIME_ZONE, formatDateTimeInTimeZone } = deps;

// ========================
// 网易云环境
// ========================
app.get("/admin/netease", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const session = readNeteaseSession();
    let sessionUpdatedAt = null;
    try {
      sessionUpdatedAt = formatDateTimeInTimeZone(new Date(fs.statSync(NETEASE_SESSION_FILE).mtime), TIME_ZONE);
    } catch (e) { console.error('[server.js:3314]', e.message || e); }
    const cookieHeader = session.musicU
      ? `MUSIC_U=${session.musicU}` + (session.csrf ? `; __csrf=${session.csrf}` : "")
      : "";
    const account = await fetchNeteaseAccount(cookieHeader);
    reply.send({
      success: true,
      netease: {
        host: readNetEaseEnv("NETEASE_MCP_HOST") || process.env.LISTEN_HOST || "127.0.0.1",
        port: readNetEaseEnv("NETEASE_MCP_PORT") || "3303",
        cookieFile: readNetEaseEnv("NETEASE_MCP_COOKIE_FILE") || NETEASE_SESSION_FILE,
        accountWriteEnabled: readNetEaseEnv("NETEASE_MCP_ACCOUNT_WRITE_ENABLED") === "1",
        sessionSet: Boolean(session.musicU),
        sessionUpdatedAt,
        account
      }
    });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

app.post("/admin/netease/save", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const musicU = String(req.body?.music_u ?? "").trim();
    const csrf = String(req.body?.csrf ?? "").trim();
    if (!musicU && !csrf) {
      return reply.code(400).send({ error: "请至少填写 MUSIC_U" });
    }
    if (musicU && !/^[^\s;=]+$/.test(musicU)) {
      return reply.code(400).send({ error: "MUSIC_U 格式无效" });
    }
    if (csrf && !/^[^\s;=]+$/.test(csrf)) {
      return reply.code(400).send({ error: "__csrf 格式无效" });
    }
    const existing = readNeteaseSession();
    const finalMusicU = musicU || existing.musicU;
    const finalCsrf = csrf || existing.csrf;
    if (!finalMusicU) {
      return reply.code(400).send({ error: "缺少 MUSIC_U，无法保存会话" });
    }
    writeNeteaseSession(finalMusicU, finalCsrf);
    const account = await fetchNeteaseAccount(`MUSIC_U=${finalMusicU}` + (finalCsrf ? `; __csrf=${finalCsrf}` : ""));
    reply.send({ success: true, account });
  } catch (err) {
    reply.code(500).send({ error: err.message });
  }
});

// ========================
// 网易云扫码登录（2026-10-25）：后台页出二维码，手机网易云 App 扫码确认，cookie 自动写进 netease.session，不用再开电脑复制 MUSIC_U
// ========================
/* [位置:server.js·admin/netease/qr] [网易云扫码登录] [10-25：cookie 过期只能开网页登录再手动复制 MUSIC_U。两个接口照 NeteaseCloudMusicApi 4.32 的姿势直调网易：eapi 加密（key=e82ckenh8dichen8，md5 校验格式 nobody{url}use{text}md5forencrypt，data 里带 header 对象，URL 是 /eapi/...），unikey=/api/login/qrcode/unikey，轮询=/api/login/qrcode/client/login（801=待扫 802=已扫待确认 803=成功 800=过期）。803 从 set-cookie 提取 MUSIC_U/__csrf 复用 writeNeteaseSession 落盘（3303 每次调用都重读该文件，不用重启）。二维码 SVG 由 qrcode-generator（MIT，npm 纯 JS 零依赖）在服务端生成] [注释时间 2026-10-25] */
const NETEASE_EAPI_KEY = "e82ckenh8dichen8";
function neteaseEapiParams(uri, data) {
  const text = JSON.stringify(data);
  const digest = require("crypto").createHash("md5").update(`nobody${uri}use${text}md5forencrypt`).digest("hex");
  const raw = `${uri}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = require("crypto").createCipheriv("aes-128-ecb", Buffer.from(NETEASE_EAPI_KEY, "utf8"), null);
  return Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]).toString("hex").toUpperCase();
}
function neteaseEapiHeader() {
  return { os: "pc", appver: "3.1.17.204416", osver: "Microsoft-Windows-10-Professional-build-19045-64bit", channel: "netease", versioncode: "140", buildver: new Date().toISOString().slice(0, 10).replace(/-/g, ""), resolution: "1920x1080", mobilename: "", requestId: String(Date.now()) + String(Math.floor(Math.random() * 900) + 100), __csrf: "" };
}
async function neteaseEapiPost(uri, data) {
  const body = new URLSearchParams({ params: neteaseEapiParams(uri, data) }).toString();
  const r = await fetch("https://interface.music.163.com/eapi/" + uri.slice(5), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) NeteaseMusic_9.0.90",
      "Cookie": "os=pc; appver=3.1.17.204416; osver=Microsoft-Windows-10-Professional-build-19045-64bit; channel=netease",
    },
    body,
  });
  return { json: await r.json().catch(() => null), setCookie: typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [] };
}

app.post("/admin/netease/qr/create", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const res = await neteaseEapiPost("/api/login/qrcode/unikey", { type: 3, header: neteaseEapiHeader() });
    const unikey = res.json && res.json.unikey;
    if (!unikey) return reply.code(502).send({ error: "网易云没下发二维码 key：" + JSON.stringify(res.json || {}).slice(0, 120) });
    const qr = require("qrcode-generator")(0, "M");
    qr.addData("https://music.163.com/login?codekey=" + unikey);
    qr.make();
    reply.send({ success: true, unikey, qrSvg: qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});

app.post("/admin/netease/qr/check", { preHandler: basicAuth }, async (req, reply) => {
  try {
    const unikey = String(req.body && req.body.unikey || "").trim();
    if (!unikey) return reply.code(400).send({ error: "缺 unikey" });
    const res = await neteaseEapiPost("/api/login/qrcode/client/login", { key: unikey, type: 3, header: neteaseEapiHeader() });
    const code = res.json && res.json.code;
    if (code === 803) {
      const pick = (name) => {
        for (const c of res.setCookie) { const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;\\s]+)")); if (m) return m[1]; }
        return "";
      };
      const musicU = pick("MUSIC_U");
      if (!musicU) return reply.send({ code: 803, error: "扫码成功但响应里没拿到 MUSIC_U" });
      const csrf = pick("__csrf") || readNeteaseSession().csrf;
      writeNeteaseSession(musicU, csrf);
      const account = await fetchNeteaseAccount(`MUSIC_U=${musicU}` + (csrf ? `; __csrf=${csrf}` : ""));
      return reply.send({ code: 803, success: true, account });
    }
    reply.send({ code, message: (res.json && res.json.message) || "" });
  } catch (err) { reply.code(500).send({ error: err.message }); }
});
};
