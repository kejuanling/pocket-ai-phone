'use strict';
// 重启保护（1019）：收到 SIGINT/SIGTERM（pm2 restart / 内存超限自动重启 / 管理台重启 都走这条）时，
// 若还有回复在生成，先「排空」——等它们收尾再退出，避免把正在生成的回复掐掉。
// - 排空期间新请求由调用方拒绝（isShuttingDown()），避免越等越长；
// - 最长等 drainMs（要小于 pm2 的 kill_timeout，否则 pm2 会先 SIGKILL）；
// - 第二次信号 = 立即退出（手动 `pm2 restart` 连按两次、或 kill -9 前的最后一道口子）。
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function createGracefulShutdown(opts) {
  const getBusy = opts.getBusy;                       // () => string[]  进行中的工作描述
  const drainMs = opts.drainMs != null ? opts.drainMs : 110000;
  const pollMs = opts.pollMs != null ? opts.pollMs : 500;
  const exit = opts.exit || ((code) => process.exit(code));
  const flushPending = opts.flushPending;            //  => number 强杀前把生成中的部分回复落盘（1025 产品确定：重启可以，字不能丢）
  const log = opts.log || console;
  const sleep = opts.sleep || sleepMs;
  let shuttingDown = false;

  async function handle(sig) {
    if (shuttingDown) {
      log.warn('[shutdown] 收到第二次信号 ' + sig + '，立即退出');
      exit(0);
      return;
    }
    shuttingDown = true;
    global.__GATEWAY_SHUTTING_DOWN = true;
    const t0 = Date.now();
    let items = [];
    try { items = getBusy() || []; } catch (e) { items = []; }
    if (items.length) {
      log.warn('[shutdown] 收到 ' + sig + '，有 ' + items.length + ' 项进行中，等待收尾（最长 ' + Math.round(drainMs / 1000) + 's）：' + items.slice(0, 5).join('、'));
    }
    while (items.length && Date.now() - t0 < drainMs) {
      await sleep(pollMs);
      try { items = getBusy() || []; } catch (e) { items = []; }
    }
    if (items.length) {
      if (flushPending) { try { const n = flushPending(); if (n) log.warn('[shutdown] 强制退出前已落盘 ' + n + ' 条部分回复'); } catch (e) { log.warn('[shutdown] 落盘兜底失败: ' + (e && e.message)); } }
      log.warn('[shutdown] 等待超时，仍有 ' + items.length + ' 项未收尾，强制退出');
    }
    else if (Date.now() - t0 >= pollMs) log.log('[shutdown] 已全部收尾（等待 ' + Math.round((Date.now() - t0) / 1000) + 's），退出');
    exit(0);
  }

  return { handle, isShuttingDown: () => shuttingDown };
}

module.exports = { createGracefulShutdown };
