'use strict';
// 重启保护单测：排空等待 / 超时强退 / 空闲立即退 / 第二次信号立即退
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGracefulShutdown } = require('../../lib/graceful-shutdown');

const quiet = { log() {}, warn() {} };

test('空闲时立即退出，不等待', async () => {
  const exits = [];
  const g = createGracefulShutdown({ getBusy: () => [], exit: (c) => exits.push(c), log: quiet, sleep: async () => {} });
  await g.handle('SIGINT');
  assert.deepEqual(exits, [0]);
  assert.equal(g.isShuttingDown(), true);
});

test('有进行中的回复：等它收尾后才退出', async () => {
  let polls = 0; const exits = [];
  const g = createGracefulShutdown({
    getBusy: () => (polls++ < 3 ? ['生成中:s_a'] : []),
    exit: (c) => exits.push({ c, polls }), log: quiet, sleep: async () => {}, pollMs: 1,
  });
  await g.handle('SIGTERM');
  assert.equal(exits.length, 1);
  assert.ok(exits[0].polls >= 4, '至少轮询到忙→闲再退出，实际 polls=' + exits[0].polls);
});

test('一直忙：到 drainMs 强制退出', async () => {
  const exits = []; let slept = 0;
  const g = createGracefulShutdown({
    getBusy: () => ['生成中:s_a'], drainMs: 30, pollMs: 5,
    exit: (c) => exits.push(c), log: quiet, sleep: (ms) => new Promise((r) => { slept += ms; setTimeout(r, ms); }),
  });
  const t0 = Date.now();
  await g.handle('SIGINT');
  assert.deepEqual(exits, [0]);
  assert.ok(Date.now() - t0 >= 25, '应等到超时才退出');
  assert.ok(slept > 0);
});

test('第二次信号：立即退出，不再等待', async () => {
  const exits = [];
  let release;
  const g = createGracefulShutdown({
    getBusy: () => ['生成中:s_a'], drainMs: 5000, pollMs: 1000,
    exit: (c) => exits.push(c), log: quiet, sleep: () => new Promise((r) => { release = r; setTimeout(r, 1000); }),
  });
  const first = g.handle('SIGINT');           // 进入排空等待
  await new Promise((r) => setTimeout(r, 10));
  await g.handle('SIGINT');                    // 第二次信号
  assert.deepEqual(exits, [0], '第二次信号应立刻退出');
  if (release) release();
  first.catch(() => {});
});
