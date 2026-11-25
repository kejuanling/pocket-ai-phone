'use strict';
// egress-keeper.js —— Claude 出口线路的看护进程（每 5 分钟一次）。
//
// 做的事：探测出口 → 不通且已配置容器/节点时重连可选供应商集成 → 仍然不通就记一次失败。
// 未配置 EGRESS_KEEPER_CONTAINER / EGRESS_KEEPER_NODE 时不自动 docker exec，也不使用现网节点默认值。
// 连续 3 次失败后停止自动重试并发一条 Bark，把状态交回给人，避免无限重连刷日志。
// 只影响 Claude 订阅那条供应商（出口守卫会继续拦截），不影响其它供应商和正常聊天。

const { execFile } = require('child_process');
const egress = require('./egress-guard');

const INTERVAL_MS = Number(process.env.EGRESS_KEEPER_INTERVAL_MS) || 5 * 60 * 1000;
const NODE_ID = String(process.env.EGRESS_KEEPER_NODE || '').trim();
const CONTAINER = String(process.env.EGRESS_KEEPER_CONTAINER || '').trim();
const MAX_FAILS = 3;

let timer = null;
let fails = 0;
let stopped = false;
let lastAttemptAt = 0;
let lastResult = 'idle';
let pushFn = null;

function setPushFn(fn) { pushFn = fn; }

function run(cmd, args, timeout) {
  return new Promise(function (resolve) {
    execFile(cmd, args, { timeout: timeout || 45000 }, function (err, stdout, stderr) {
      resolve({
        ok: !err,
        out: String(stdout || '').slice(-600),
        err: err ? String(err.message || err) + ' ' + String(stderr || '').slice(0, 200) : '',
      });
    });
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* [位置:lib/egress-keeper.js·sweepZombies] [清僵尸 xray] [2026-10-31 产品确定：/hzvpn connect 每次重连都新起一个 xray 不杀旧的，多个进程共用 1088，连接随机落到死隧道就是 socket disconnected → 守卫拦 503（01:07/01:09 两条 503 实证）。现在每次 tick 顺手清：ps 找 /tmp 下 xray run 进程，>1 个时只留最新（最新=最近一次 connect 起的活隧道），kill 其余；清完复测出口，失败只告警不重连（下一轮 tick 自会处理）。导出供手动调用] [注释时间 2026-10-31] */
function sweepZombies() {
  return run('sh', ['-c', "ps -eo pid,etimes,args --no-headers -ww | grep '/tmp/.*xray.* run' | grep -v grep"], 20000).then(function (ps) {
    const procs = [];
    String(ps.out || '').split('\n').forEach(function (ln) {
      const m = ln.trim().match(/^(\d+)\s+(\d+)\s+(\/tmp\/[^ ]*xray[^ ]*\s+run\b.*xray_config.*)$/);
      if (m) procs.push({ pid: Number(m[1]), age: Number(m[2]), cmd: m[3].slice(0, 120) });
    });
    if (procs.length <= 1) return { ok: true, count: procs.length, killed: [] };
    procs.sort(function (a, b) { return a.age - b.age; });  /* 升序：保留最新（最近一次 connect 起的活隧道），kill 旧的；原降序实际保的是最老核 */
    const doomed = procs.slice(1);
    return run('kill', doomed.map(function (x) { return String(x.pid); }), 15000).then(function (k) {
      const killed = doomed.map(function (x) { return x.pid + '(' + Math.round(x.age / 3600) + 'h)'; });
      console.log('[egress-keeper] 清僵尸 xray：保留 ' + procs[0].pid + '，kill ' + killed.join(', ') + (k.ok ? '' : ' | kill 报错: ' + k.err));
      return sleep(400).then(function () {
        return egress.ensure().then(function (g) {
          if (!g.ok) console.warn('[egress-keeper] 清僵尸后出口探测失败：' + g.reason + '（下一轮 tick 会自动重连）');
          return { ok: true, count: 1, killed: killed, egress_ok: g.ok };
        });
      });
    });
  }, function () { return { ok: false, count: -1, killed: [] }; });
}

async function reconnect() {
  // 容器没跑先拉起来（restart 策略通常已经管了，这是兜底）
  const ps = await run('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], 15000);
  if (!ps.ok || String(ps.out).trim() !== 'true') {
    const st = await run('docker', ['start', CONTAINER], 60000);
    if (!st.ok) return { ok: false, step: 'docker_start', detail: st.err };
    await sleep(8000);
  }
  // 容器重启后 DBus 地址会变，每次重连前现读
  const dbus = await run('docker', ['exec', CONTAINER, 'cat', '/tmp/dbus.addr'], 15000);
  const addr = dbus.ok ? String(dbus.out).trim() : '';
  const args = ['exec'];
  if (addr) args.push('-e', 'DBUS_SESSION_BUS_ADDRESS=' + addr);
  args.push(CONTAINER, '/hzvpn', 'connect', NODE_ID);
  const c = await run('docker', args, 70000);
  const ok = !!c.ok && /Connected to/i.test(c.out);
  return { ok: ok, step: 'connect', detail: ok ? '' : (c.out || c.err) };
}

async function tick() {
  if (stopped) return { skipped: true };
  const before = await egress.ensure();
  if (before.ok) { fails = 0; lastResult = 'healthy'; return sweepZombies().then(function () { return { ok: true }; }); }

  lastAttemptAt = Date.now();
  const r = await reconnect();
  egress.invalidate();
  const after = await egress.ensure();

  if (after.ok) {
    fails = 0;
    lastResult = 'recovered';
    console.log('[egress-keeper] 线路已恢复，出口 ' + after.ip);
    return sweepZombies().then(function () { return { ok: true, recovered: true }; });
  }

  fails += 1;
  lastResult = 'fail#' + fails + '(' + r.step + ')';
  console.warn('[egress-keeper] 重连失败 ' + fails + '/' + MAX_FAILS + '：' + r.step + ' ' + (r.detail || ''));

  if (fails >= MAX_FAILS) {
    stopped = true;
    if (pushFn) {
      try {
        await pushFn({
          title: 'Claude 线路断了',
          body: '火种连续 3 次重连失败，已停止自动重试。Claude 订阅供应商会保持拦截，其它聊天不受影响。',
          channel: 'bark',
        });
      } catch (e) { /* 推送失败不影响状态机 */ }
    }
  }
  return { ok: false, fails: fails };
}

function start() {
  if (!CONTAINER || !NODE_ID) {
    console.log('[egress-keeper] 未配置 EGRESS_KEEPER_CONTAINER / EGRESS_KEEPER_NODE，跳过自动重连');
    return;
  }
  if (timer) return;
  timer = setInterval(function () { tick().catch(function (e) { console.warn('[egress-keeper] tick error:', e.message); }); }, INTERVAL_MS);
  if (timer.unref) timer.unref();
  lastResult = 'started';
  console.log('[egress-keeper] 已启动：每 ' + Math.round(INTERVAL_MS / 60000) + ' 分钟检查一次，节点 ' + NODE_ID);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function status() {
  return {
    running: !!timer,
    stopped: stopped,
    fails: fails,
    max_fails: MAX_FAILS,
    node: NODE_ID,
    last_attempt_at: lastAttemptAt || null,
    last_result: lastResult,
    interval_ms: INTERVAL_MS,
  };
}

/* [位置:lib/egress-keeper.js·resume] [恢复自动重试] [连续失败 3 次后 stopped 会一直停着；设置页登录成功后要能解除，不用重启网关] [注释时间 2026-10-21] */
function resume() {
  stopped = false;
  fails = 0;
  lastResult = 'resumed';
}

module.exports = { sweepZombies: sweepZombies, start: start, stop: stop, status: status, setPushFn: setPushFn, tick: tick, resume: resume, reconnect: reconnect };
