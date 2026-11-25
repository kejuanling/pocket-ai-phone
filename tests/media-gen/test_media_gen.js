'use strict';
const PROJECT_ROOT = require('../../lib/project-root').projectRoot();
// 2026-11-17 生图/生视频链路验收：跑在临时目录，不碰真相册、不污染 data/uploads
//   node tests/media-gen/test_media_gen.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = PROJECT_ROOT;
process.chdir(PROJECT);
const Fastify = require(path.join(PROJECT, 'node_modules', 'fastify'));

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-test-'));
fs.mkdirSync(path.join(BASE, 'data', 'uploads'), { recursive: true });

const album = require(path.join(PROJECT, 'lib', 'album'));
album.init({ baseDir: BASE, loadTimeline: function () { return []; } });
const register = require(path.join(PROJECT, 'routes', 'media-gen'));

let failed = 0;
function ok(cond, name, extra) {
  if (cond) { console.log('ok ' + name); return; }
  failed++; process.exitCode = 1;
  console.error('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra).slice(0, 500)));
}
function exists(u) { return fs.existsSync(path.join(BASE, 'data', 'uploads', String(u).replace(/^\/uploads\//, ''))); }

(async function () {
  const app = Fastify({ logger: false });
  const mg = register(app, { baseDir: BASE });
  await app.ready();

  // 1. 生图（真上游）
  const t0 = Date.now();
  const r1 = await app.inject({ method: 'POST', url: '/v1/media/gen', payload: { kind: 'image', prompt: '一只白瓷杯放在木桌上，晨光，写实' } });
  ok(r1.statusCode === 200, '生图 HTTP 200', r1.body);
  const j1 = (JSON.parse(r1.body) || {}).job || {};
  ok(j1.status === 'done' && /^\/uploads\/img-gen/.test(String(j1.url)), '生图落地到 uploads', { url: j1.url, status: j1.status });
  ok(exists(j1.url), '生图文件真实存在');
  ok(Number(j1.bytes) > 1000, '生图字节数合理', { bytes: j1.bytes });
  console.log('  生图耗时 ' + (Date.now() - t0) + 'ms，' + Math.round(j1.bytes / 1024) + 'KB，cost_ticks=' + j1.cost_ticks);

  // 2. 任务回查
  const r2 = await app.inject({ method: 'GET', url: '/v1/media/gen/' + j1.id });
  ok(r2.statusCode === 200 && (JSON.parse(r2.body) || {}).job.status === 'done', '回查任务 done', r2.body.slice(0, 200));

  // 3. 清单
  const r3 = await app.inject({ method: 'GET', url: '/v1/media/items' });
  const b3 = JSON.parse(r3.body);
  ok(r3.statusCode === 200 && b3.items.length === 1 && b3.items[0].collected === false, '清单 1 条且未收藏', b3);

  // 4. 收藏进相册（临时 baseDir）
  const r4 = await app.inject({ method: 'POST', url: '/v1/media/collect', payload: { id: j1.id } });
  const b4 = JSON.parse(r4.body);
  ok(r4.statusCode === 200 && b4.ok === true && b4.item && b4.item.source === 'upload', '收藏进相册', b4);
  const a = album.get().list();
  ok(a.items.length === 1 && a.items[0].file === j1.file, '相册里确实有这张', a.items.map(function (x) { return x.file; }));

  // 5. 视频：拿之前真跑过的那单（上游已 done），验证轮询 + 下载 + 转存
  const RID = process.argv[2] || '441a404a-0948-9b7d-95cc-8080c94b760e';
  const job = { id: 'mg_vtest', kind: 'video', status: 'pending', request_id: RID, at_ts: Date.now() };
  try {
    await mg.pollVideo(job);
    ok(job.status === 'done' && /^\/uploads\/img-gen.*\.mp4$/.test(String(job.url)), '视频轮询 done 并转存 mp4', { status: job.status, url: job.url });
    ok(exists(job.url), '视频文件真实存在');
    ok(Number(job.bytes) > 100000, '视频字节数合理', { bytes: job.bytes, cost: job.cost_ticks });
    console.log('  视频 ' + Math.round(job.bytes / 1024) + 'KB，cost_ticks=' + job.cost_ticks);
  } catch (e) { ok(false, '视频链路：' + ((e && e.message) || e)); }

  // 6. 清理：收藏过的留下，其它按上限砍
  const p1 = mg.prune();
  ok(exists(j1.url), '收藏过的图不被清理');
  ok(typeof p1.deleted === 'number' && typeof p1.bytes === 'number', 'prune 返回统计', p1);

  console.log('临时目录：' + BASE);
  await app.close();
  console.log(failed ? ('\nFAILED: ' + failed) : '\nALL PASS');
})().catch(function (e) { console.error('ERR', (e && e.stack) || e); process.exitCode = 1; });
