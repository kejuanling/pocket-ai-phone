// 位置变了叫醒（2026-11-10 新规则）：只认连续的实时上报
//   冷启动/旧状态不叫；同一份快照不重复处理；与上一份相隔 > maxGapMin(5) 不比较不叫；连续上报里位置 ≠ 上次叫他时的位置 且冷却(30)满才叫；
//   冷却内的变化被吞掉（firedLoc 更新、不叫），冷却过后不补叫，再变才叫；读不到/没时间/没位置不叫并给出小字；配置只改冷却、保留其它键。
const assert = require("assert"), http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-")); fs.mkdirSync(path.join(dir, "data"));
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };
const M = 60000, T = new Date(2026, 10, 10, 12, 0, 0).getTime();
let snap = { location: "A地", created_at: fmt(T) }, status = 200;
const srv = http.createServer((req, res) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ state: snap })); });
const STATE = path.join(dir, "data", "location-detect-state.json");
(async () => {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const fired = [];
  const ld = require("../../lib/location-detect")({ baseDir: dir, notify: (k) => fired.push(k), apiBase: "http://127.0.0.1:" + srv.address().port, log: () => {} });
  const at = async (min, loc) => { snap = { location: loc, created_at: fmt(T + min * M) }; return ld.tick(T + min * M); };
  const problem = () => require("../../lib/location-detect").readProblem(dir);

  await at(0, "A地"); assert.deepStrictEqual(fired, [], "冷启动只记不叫");
  assert.ok(JSON.parse(fs.readFileSync(STATE, "utf8")).lastSnapAt, "冷启动记下快照时间");
  assert.deepStrictEqual(await ld.tick(T + 3 * M), { same: "snapshot" }, "同一份快照（没有新上报）不处理");
  await at(1, "A地"); assert.deepStrictEqual(fired, [], "连续、位置没变不叫");
  await at(2, "B地"); assert.deepStrictEqual(fired, ["location"], "连续上报且位置变了 → 叫一次");
  await at(3, "C地"); assert.deepStrictEqual(fired, ["location"], "冷却内不叫");
  assert.strictEqual(problem(), null, "冷却内不算问题，不出小字");

  // 隔太久：不比较、不叫，给小字
  const g = await at(20, "C地"); assert.strictEqual(g.gap, 17); assert.deepStrictEqual(fired, ["location"]);
  assert.match(problem().msg, /隔了 17 分钟/);
  await at(21, "C地"); assert.deepStrictEqual(fired, ["location"], "冷却还没满（距上次叫 19 分钟 < 30）");
  assert.strictEqual(problem(), null, "连续上报恢复后小字消失");
  await at(33, "C地"); assert.deepStrictEqual(fired, ["location"], "又隔了 12 分钟：不连续，不比较");
  await at(34, "C地"); assert.deepStrictEqual(fired, ["location"], "冷却满后第一份连续快照：C 是冷却内被吞掉的变化，不补叫");
  await at(35, "C地"); assert.deepStrictEqual(fired, ["location"], "之后没变不叫");

  // 回到上次叫他时的位置：不叫
  await at(70, "C地"); await at(71, "D地"); assert.deepStrictEqual(fired, ["location", "location"], "D 与 C 不同、冷却满 → 叫（冷却后再变才叫）");
  await at(72, "D地"); await at(110, "A地"); await at(111, "D地"); assert.deepStrictEqual(fired.length, 2, "绕一圈回到 D，位置同上次叫时 → 不叫");

  // 读不到 / 没时间 / 没位置：不叫，有小字，恢复后清
  status = 500; await ld.tick(T + 200 * M); assert.match(problem().msg, /读不到查岗数据/); status = 200;
  snap = { location: "Z地" }; await ld.tick(T + 201 * M); assert.match(problem().msg, /没有上报时间/);
  snap = { location: "", created_at: fmt(T + 202 * M) }; await ld.tick(T + 202 * M); assert.match(problem().msg, /没有位置/);
  assert.strictEqual(fired.length, 2);
  await at(203, "D地"); assert.match(problem().msg, /隔了/, "数据恢复后第一份与上一份隔太久：仍提示不连续，但「读不到」的提示已换掉");
  await at(204, "D地"); assert.strictEqual(problem(), null, "再来一份连续快照，问题清掉");

  // 旧状态文件（只有 firedLoc/firedAt，没有 lastSnapAt）：当冷启动，不叫
  fs.writeFileSync(STATE, JSON.stringify({ firedLoc: "老地方", firedAt: 1 }));
  const n0 = fired.length; await at(300, "新地方"); assert.strictEqual(fired.length, n0, "旧状态文件：先记下，不叫");
  await at(301, "新地方"); assert.strictEqual(fired.length, n0 + 1, "下一份连续快照位置仍 ≠ 老地方 → 叫");

  // 配置：默认 30/5；只改冷却，保留文件里其他键；越界收敛
  const L = require("../../lib/location-detect");
  fs.writeFileSync(path.join(dir, "data", "location-detect-config.json"), JSON.stringify({ enabled: true, maxGapMin: 8, extra: 1 }));
  assert.deepStrictEqual(L.readConfig(dir), { enabled: true, cooldownMin: 30, maxGapMin: 8 });
  assert.strictEqual(L.writeConfig(dir, { cooldownMin: 45 }).cooldownMin, 45);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "data", "location-detect-config.json"), "utf8"));
  assert.strictEqual(raw.maxGapMin, 8); assert.strictEqual(raw.extra, 1);
  assert.strictEqual(L.writeConfig(dir, { cooldownMin: 99999 }).cooldownMin, 30, "越界回默认");

  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  // 订阅项：sleep/wakeup 已删；位置仍在；「状态」改名「经期」
  const ws = require("../../lib/wake-subs");
  assert.ok(ws.KEYS.includes("location"));
  assert.ok(!ws.KEYS.includes("sleep") && !ws.KEYS.includes("wakeup"), "sleep/wakeup 已删");
  assert.ok(ws.settings().some((x) => x.key === "location" && x.name === "位置"));
  assert.ok(ws.settings().some((x) => x.key === "period" && x.name === "经期"));
  console.log("全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
