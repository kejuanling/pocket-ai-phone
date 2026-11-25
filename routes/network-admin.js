'use strict';
// network-admin.js —— 小手机设置页「网络」分组的后端：火种 VPN 登录 + 机场订阅导入。
//
// 凭证只在服务端流动：火种登录 token 直接写进容器里 hzvpn 的 stdin，机场订阅地址只落在 600 权限的
// 文件里；状态接口永远只返回打码后的信息（订阅只给域名），不回显任何 token / 完整地址。
//
// 出海代理必须由环境变量显式配置，发布树不包含现网节点或出口默认。火种 VPN 登录/订阅能力保留为可选集成。
// 机场线（mihomo）功能保留：路径与二进制均需配置，未配置则视为未启用。

const fs = require('fs');
const net = require('net');
const https = require('https');
const { spawn, execFile } = require('child_process');
const { HttpsProxyAgent } = require('https-proxy-agent');
const egress = require('../lib/egress-guard');
const keeper = require('../lib/egress-keeper');

const HZ = String(process.env.EGRESS_KEEPER_CONTAINER || '').trim();
const AIRPORT_YAML = String(process.env.AIRPORT_YAML || '').trim();
const AIRPORT_URL_FILE = String(process.env.AIRPORT_URL_FILE || '').trim();
const MIHOMO_BIN = String(process.env.MIHOMO_BIN || '').trim();
const MIHOMO_HOME = String(process.env.MIHOMO_HOME || '').trim();
const MIHOMO_NAME = 'mihomo';
const MIHOMO_PORT = 7890;
const PROBE_URL_HOST = 'www.gstatic.com';
const LOGIN_TTL_MS = 10 * 60 * 1000;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function clean(s) { return String(s || '').replace(ANSI, ''); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function run(cmd, args, timeout) {
  return new Promise(function (resolve) {
    execFile(cmd, args, { timeout: timeout || 20000, maxBuffer: 1 << 20 }, function (err, so, se) {
      resolve({ ok: !err, out: clean(so), err: clean(se) + (err && !se ? String(err.message || err) : '') });
    });
  });
}

/* ───────────── 火种 VPN ───────────── */

/* [位置:routes/network-admin.js·hzStatus] [火种状态] [容器在不在 / 登录态 / 是否已连接，给设置页状态行用] [注释时间 2026-10-21] */
async function hzStatus() {
  if (!HZ) return { container: false, logged_in: false, connected: false, configured: false };
  const ps = await run('docker', ['inspect', '-f', '{{.State.Running}}', HZ], 10000);
  if (!(ps.ok && ps.out.trim() === 'true')) return { container: false, logged_in: false, connected: false };
  const both = await Promise.all([
    run('docker', ['exec', HZ, '/hzvpn', 'status'], 15000),
    run('docker', ['exec', HZ, '/hzvpn', 'profile'], 15000),
  ]);
  const stText = both[0].out + both[0].err;
  const pfText = both[1].out + both[1].err;
  return {
    container: true,
    // hzvpn 未登录时退出码也是 0，只能看文本
    logged_in: !/must be logged in/i.test(pfText) && pfText.trim().length > 0,
    connected: /Connected/i.test(stText) && !/Disconnected/i.test(stText),
  };
}

// 一次只允许一个进行中的登录：{ child, url, buf, startedAt, timer }
let pendingLogin = null;

function killPending() {
  if (!pendingLogin) return;
  try { clearTimeout(pendingLogin.timer); } catch (e) { /* ignore */ }
  try { pendingLogin.child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  pendingLogin = null;
}

/* [位置:routes/network-admin.js·startLogin] [发起火种登录] [在容器里起 hzvpn login，拿到浏览器登录链接；进程留着等 token 从 stdin 进来] [注释时间 2026-10-21] */
function startLogin() {
  killPending();
  return new Promise(function (resolve) {
    let child;
    try {
      child = spawn('docker', ['exec', '-i', HZ, '/hzvpn', 'login'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: '起不来登录进程：' + e.message }); }
    const st = { child: child, url: '', buf: '', startedAt: Date.now(), timer: null, exited: false, code: null };
    let settled = false;
    function onData(d) {
      st.buf += clean(d.toString('utf8'));
      if (st.buf.length > 20000) st.buf = st.buf.slice(-10000);
      if (!st.url) {
        const m = st.buf.match(/https:\/\/[^\s]+requestId=[A-Za-z0-9-]+/);
        if (m && !settled) { st.url = m[0]; settled = true; resolve({ ok: true, url: st.url }); }
      }
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', function (code) {
      st.exited = true; st.code = code;
      if (!settled) { settled = true; resolve({ ok: false, error: '没拿到登录链接：' + st.buf.trim().slice(-200) }); }
    });
    child.on('error', function (e) { if (!settled) { settled = true; resolve({ ok: false, error: e.message }); } });
    st.timer = setTimeout(function () { if (pendingLogin === st) killPending(); }, LOGIN_TTL_MS);
    if (st.timer.unref) st.timer.unref();
    pendingLogin = st;
    setTimeout(function () { if (!settled) { settled = true; killPending(); resolve({ ok: false, error: '等了 20 秒还没拿到登录链接' }); } }, 20000);
  });
}

/* [位置:routes/network-admin.js·submitLoginToken] [提交登录 token] [把浏览器页面给的 token 写进等着的 hzvpn login，成功后解除守护停机并连接线路] [注释时间 2026-10-21] */
async function submitLoginToken(token) {
  const st = pendingLogin;
  if (!st || st.exited) return { ok: false, error: '登录已经过期，先重新点一次登录' };
  const before = st.buf.length;
  try { st.child.stdin.write(String(token).trim() + '\n'); st.child.stdin.end(); } catch (e) { return { ok: false, error: '写不进登录进程：' + e.message }; }
  const t0 = Date.now();
  while (!st.exited && Date.now() - t0 < 45000) await sleep(300);
  const out = st.buf.slice(before);
  const exited = st.exited;
  killPending();
  if (!exited) return { ok: false, error: '登录超时，没有响应' };
  if (/ERROR|invalid|expired|fail/i.test(out)) return { ok: false, error: '登录没成功：' + out.trim().slice(-160) };
  const s1 = await hzStatus();
  if (!s1.logged_in) return { ok: false, error: '提交后仍显示未登录：' + out.trim().slice(-160) };
  return connectAndVerify();
}

/* [位置:routes/network-admin.js·connectAndVerify] [连接火种线路并验证出口] [解除守护停机 → 重连节点 → 重新探测出口 IP；与守护用同一套 reconnect] [注释时间 2026-10-21] */
async function connectAndVerify() {
  keeper.resume();
  const r = await keeper.reconnect();
  egress.invalidate();
  const g = await egress.ensure();
  if (g.ok) return { ok: true, logged_in: true, connected: true, egress: g.ip };
  return { ok: !!r.ok, logged_in: true, connected: !!r.ok, egress_ok: false, error: r.ok ? ('已连接，但出口不是预期线路：' + (g.reason || '')) : ('登录成功，连接线路失败：' + String(r.detail || '').slice(-160)) };
}

/* ───────────── 机场订阅（mihomo） ───────────── */

function validSubUrl(u) {
  const s = String(u || '').trim();
  if (!s || s.length > 2048) return '';
  if (!/^[^\s"'\\`]+$/.test(s)) return '';
  let p;
  try { p = new URL(s); } catch (e) { return ''; }
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return '';
  return s;
}

function airportYaml(subUrl) {
  return [
    '# managed-by: routes/network-admin.js（设置页「机场订阅」导入生成；手改会被下次导入覆盖）',
    'mixed-port: ' + MIHOMO_PORT,
    'allow-lan: false',
    'mode: rule',
    'log-level: info',
    'ipv6: false',
    '',
    'proxy-providers:',
    '  sub:',
    '    type: http',
    '    url: "' + subUrl + '"',
    '    path: ./sub.yaml',
    '    interval: 86400',
    '    health-check:',
    '      enable: true',
    '      url: https://' + PROBE_URL_HOST + '/generate_204',
    '      interval: 300',
    '',
    'proxy-groups:',
    '  - name: "JMS"',
    '    type: select',
    '    use: [sub]',
    '    proxies: ["JMS Auto", DIRECT]',
    '  - name: "JMS Auto"',
    '    type: url-test',
    '    use: [sub]',
    '    url: https://' + PROBE_URL_HOST + '/generate_204',
    '    interval: 300',
    '    tolerance: 50',
    '',
    'rules:',
    '  - "MATCH,JMS"',
    '',
  ].join('\n');
}

function portOpen(port) {
  return new Promise(function (resolve) {
    const s = net.connect({ host: '127.0.0.1', port: port });
    const done = function (v) { try { s.destroy(); } catch (e) { /* ignore */ } resolve(v); };
    s.setTimeout(800, function () { done(false); });
    s.on('connect', function () { done(true); });
    s.on('error', function () { done(false); });
  });
}

function probeViaAirport() {
  return new Promise(function (resolve) {
    let req;
    try {
      req = https.request({ hostname: PROBE_URL_HOST, path: '/generate_204', method: 'GET', agent: new HttpsProxyAgent('http://127.0.0.1:' + MIHOMO_PORT), timeout: 10000 },
        function (res) { res.resume(); resolve(res.statusCode === 204 || res.statusCode === 200); });
    } catch (e) { return resolve(false); }
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function () { resolve(false); });
    req.end();
  });
}

// 订阅缓存里的节点数：Clash yaml 数 name；否则当 base64 / 链接列表数 scheme://。读不出来返回 null（不影响导入结果）
function countNodes() {
  let t;
  try { t = fs.readFileSync(MIHOMO_HOME + '/sub.yaml', 'utf8'); } catch (e) { return null; }
  if (/^\s*proxies\s*:/m.test(t)) { const m = t.match(/^\s*-\s*(\{\s*)?name\s*:/mg); return m ? m.length : 0; }
  let dec = t;
  try { dec = Buffer.from(t.trim(), 'base64').toString('utf8'); } catch (e) { /* keep raw */ }
  const m2 = dec.match(/^(ss|ssr|vmess|vless|trojan|hysteria2?|hy2|tuic):\/\//mg);
  return m2 ? m2.length : null;
}

function subHost() {
  try { return new URL(fs.readFileSync(AIRPORT_URL_FILE, 'utf8').trim()).hostname; } catch (e) { return ''; }
}

async function mihomoPm2Exists() {
  const r = await run('pm2', ['jlist'], 15000);
  try { return JSON.parse(r.out.slice(r.out.indexOf('['))).some(function (p) { return p.name === MIHOMO_NAME; }); } catch (e) { return false; }
}

async function mihomoReload() {
  if (!MIHOMO_BIN || !AIRPORT_YAML || !MIHOMO_HOME) return { ok: false, err: 'mihomo 未配置' };
  if (await mihomoPm2Exists()) return run('pm2', ['restart', MIHOMO_NAME], 30000);
  return run('pm2', ['start', MIHOMO_BIN, '--name', MIHOMO_NAME, '--cwd', (MIHOMO_HOME || require('path').dirname(MIHOMO_BIN || '.')), '--', '-d', MIHOMO_HOME, '-f', AIRPORT_YAML], 30000);
}

async function airportStatus() {
  if (!AIRPORT_URL_FILE || !MIHOMO_HOME) return { configured: false, host: '', running: false, nodes: null, updated_at: null };
  const configured = fs.existsSync(AIRPORT_URL_FILE);
  let updatedAt = null;
  try { updatedAt = fs.statSync(MIHOMO_HOME + '/sub.yaml').mtime.toISOString(); } catch (e) { /* 还没下载过 */ }
  return { configured: configured, host: configured ? subHost() : '', running: await portOpen(MIHOMO_PORT), nodes: configured ? countNodes() : null, updated_at: updatedAt };
}

/* [位置:routes/network-admin.js·importAirport] [机场订阅导入] [写 mihomo 订阅配置 → 重载（pm2）→ 等节点下载 → 经 7890 探测；不通就还原旧配置] [注释时间 2026-10-21] */
let importing = false;
async function importAirport(rawUrl) {
  if (!AIRPORT_YAML || !AIRPORT_URL_FILE || !MIHOMO_BIN || !MIHOMO_HOME) return { ok: false, error: '机场集成未配置（AIRPORT_YAML / AIRPORT_URL_FILE / MIHOMO_BIN / MIHOMO_HOME）' };
  const url = validSubUrl(rawUrl);
  if (!url) return { ok: false, error: '订阅链接格式不对（要 http(s):// 开头，不能含空格和引号）' };
  if (importing) return { ok: false, error: '上一次导入还没做完' };
  importing = true;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const bakYaml = AIRPORT_YAML + '.bak-' + stamp;
  const hadYaml = fs.existsSync(AIRPORT_YAML);
  const hadUrl = fs.existsSync(AIRPORT_URL_FILE);
  const oldUrl = hadUrl ? fs.readFileSync(AIRPORT_URL_FILE, 'utf8') : null;
  try {
    if (hadYaml) fs.copyFileSync(AIRPORT_YAML, bakYaml);
    fs.mkdirSync(MIHOMO_HOME, { recursive: true });
    try { fs.unlinkSync(MIHOMO_HOME + '/sub.yaml'); } catch (e) { /* 没有就算了 */ }
    fs.writeFileSync(AIRPORT_YAML, airportYaml(url), { mode: 0o600 });
    fs.writeFileSync(AIRPORT_URL_FILE, url + '\n', { mode: 0o600 });
    const rl = await mihomoReload();
    if (!rl.ok) throw new Error('重载 mihomo 失败：' + (rl.err || rl.out).slice(-160));
    // 等订阅下载 + 端口就绪（最多 30 秒）
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (fs.existsSync(MIHOMO_HOME + '/sub.yaml') && await portOpen(MIHOMO_PORT)) { ready = true; break; }
    }
    if (!ready) throw new Error('订阅没下载下来（链接失效，或这台服务器连不上订阅站）');
    if (!(await probeViaAirport())) throw new Error('节点下载下来了，但经节点连不出去');
    return { ok: true, host: subHost(), nodes: countNodes() };
  } catch (e) {
    // 还原旧配置，避免导入失败把原来能用的机场弄坏
    try {
      if (hadYaml) fs.copyFileSync(bakYaml, AIRPORT_YAML);
      if (hadUrl) fs.writeFileSync(AIRPORT_URL_FILE, oldUrl, { mode: 0o600 }); else try { fs.unlinkSync(AIRPORT_URL_FILE); } catch (e2) { /* ignore */ }
      if (hadYaml) await mihomoReload();
    } catch (e3) { /* 还原失败也只能如实报告 */ }
    return { ok: false, error: String(e.message || e) + (hadYaml ? '（已还原原来的配置）' : '') };
  } finally {
    importing = false;
  }
}

/* ───────────── 路由 ───────────── */

module.exports = function (app, deps) {
  const basicAuth = deps.basicAuth;

  // 状态（只读，不含任何凭证）
  app.get('/admin/network/status', { preHandler: basicAuth }, async function (req, reply) {
    try {
      const out = await Promise.all([hzStatus(), airportStatus()]);
      /* [位置:routes/network-admin.js·GET /admin/network/status] [状态先探测再读] [守卫缓存只在有 Claude 请求时才刷新，网关重启后一直是 not_probed，设置页就把已连通的线路显示成「线路异常」；已登录且线路在连时先 ensure() 探一次（守卫自带 30 秒缓存、并发合并），再读状态] [注释时间 2026-10-21] */
      if (out[0] && out[0].container && out[0].logged_in && out[0].connected) { try { await egress.ensure(); } catch (e) { /* 探测失败就按缓存里的原因显示 */ } }
      const g = egress.status();
      reply.send({
        ok: true,
        hz: Object.assign({}, out[0], { egress_ok: !!g.ok, egress_ip: g.ip || null, egress_reason: g.reason || '', keeper_stopped: !!keeper.status().stopped, login_pending: !!(pendingLogin && !pendingLogin.exited) }),
        airport: out[1],
      });
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  app.post('/admin/network/hz/login/start', { preHandler: basicAuth }, async function (req, reply) {
    try { reply.send(await startLogin()); } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  app.post('/admin/network/hz/login/token', { preHandler: basicAuth }, async function (req, reply) {
    try {
      const token = String((req.body && req.body.token) || '').trim();
      if (!/^[A-Za-z0-9._\-+=\/]{6,4000}$/.test(token)) return reply.send({ ok: false, error: 'token 格式不对，原样粘贴浏览器页面里给的那一串' });
      reply.send(await submitLoginToken(token));
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  app.post('/admin/network/hz/login/cancel', { preHandler: basicAuth }, async function (req, reply) {
    killPending(); reply.send({ ok: true });
  });

  // 已登录但线路断了：手动重连一次（同时解除守护的停机）
  app.post('/admin/network/hz/reconnect', { preHandler: basicAuth }, async function (req, reply) {
    try {
      const s = await hzStatus();
      if (!s.logged_in) return reply.send({ ok: false, error: '还没登录，先登录' });
      reply.send(await connectAndVerify());
    } catch (err) { reply.code(500).send({ error: err.message }); }
  });

  app.post('/admin/network/airport/import', { preHandler: basicAuth }, async function (req, reply) {
    try { reply.send(await importAirport(req.body && req.body.url)); } catch (err) { reply.code(500).send({ error: err.message }); }
  });
};

module.exports._test = { validSubUrl: validSubUrl, airportYaml: airportYaml, countNodes: countNodes };
