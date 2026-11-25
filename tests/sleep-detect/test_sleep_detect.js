// 睡着/醒来检测：假 8080 服务 + 临时 baseDir，不碰真数据
const assert = require("assert"), http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-")); fs.mkdirSync(path.join(dir, "data"));
let recs = [];   // 本地时间字符串（东八区）
const srv = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url.startsWith("/summary")) return res.end(JSON.stringify({ records: recs.map((t) => ({ created_at: t, content: "打开 App：x" })) }));
  if (req.url.startsWith("/state/latest")) return res.end(JSON.stringify({ state: null }));
  res.statusCode = 404; res.end("{}");
});
function cn(ms) { const d = new Date(ms + 8 * 3600e3); const z = (n) => String(n).padStart(2, "0"); return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate()) + " " + z(d.getUTCHours()) + ":" + z(d.getUTCMinutes()) + ":" + z(d.getUTCSeconds()); }
(async () => {
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const fired = [];
  const sd = require("../../lib/sleep-detect")({ baseDir: dir, notify: (k) => fired.push(k), apiBase: "http://127.0.0.1:" + srv.address().port, log: () => {} });
  const T0 = Date.parse("2026-11-04T22:00:00+08:00"), M = 60000;
  recs = [cn(T0)];
  let r = await sd.tick(T0 + 10 * M); assert.ok(r.cold, "冷启动不补发"); assert.deepStrictEqual(fired, []);
  r = await sd.tick(T0 + 60 * M); assert.deepStrictEqual(fired, [], "静 60 分不算");
  r = await sd.tick(T0 + 121 * M); assert.deepStrictEqual(fired, ["sleep"], "静 121 分=睡着");
  r = await sd.tick(T0 + 150 * M); assert.deepStrictEqual(fired, ["sleep"], "睡着只发一次");
  recs.push(cn(T0 + 8 * 3600e3)); r = await sd.tick(T0 + 8 * 3600e3 + 2 * M);
  assert.deepStrictEqual(fired, ["sleep", "wakeup"], "静 8 小时后有动静=醒了");
  r = await sd.tick(T0 + 8 * 3600e3 + 30 * M); assert.deepStrictEqual(fired, ["sleep", "wakeup"], "醒着不重复发");
  // 午休：静 90 分钟又有动静——发 sleep，但回来时不到 5 小时，不叫醒
  const T1 = T0 + 9 * 3600e3;
  r = await sd.tick(T1 + 125 * M); assert.deepStrictEqual(fired, ["sleep", "wakeup", "sleep"]);
  recs.push(cn(T1 + 200 * M)); r = await sd.tick(T1 + 201 * M);
  assert.deepStrictEqual(fired, ["sleep", "wakeup", "sleep"], "歇不到 5 小时回来不叫 wakeup"); assert.ok(r.short);
  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log("全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
