"use strict";
// 工作流 raw 接口的无后缀嗅探（wfSniffHtml）不能泄漏 fd（11-15 健壮性）：
// readSync 抛错时原来不会 closeSync，每刷一次漏一个句柄，进程迟早 EMFILE。
// 真起路由 + 临时 baseDir/工作流 目录，只 patch 我们那个文件的 readSync，不碰线上任何目录。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Fastify = require("fastify");
const register = require("../../routes/workflow-files");

const d = fs.mkdtempSync(path.join(os.tmpdir(), "wf-sniff-"));
fs.mkdirSync(path.join(d, "工作流"), { recursive: true });
const target = path.join(d, "工作流", "捏捏");
fs.writeFileSync(target, "<!doctype html><html><body>hi</body></html>", "utf-8");

const app = Fastify({ logger: false });
register(app, { basicAuth: async () => {}, atomicWriteFileSync: (p, c) => fs.writeFileSync(p, c), baseDir: d });
const url = "/admin/workflow/raw/" + encodeURIComponent("捏捏");

const fdCount = () => fs.readdirSync("/proc/self/fd").length;

(async () => {
  const ok = [];
  const bad = [];
  const check = (name, fn) => { try { fn(); ok.push(name); console.log("PASS " + name); } catch (e) { bad.push(name); console.log("FAIL " + name + "\n  " + (e && e.message || e)); } };

  // 1) 正常路径不受影响：无后缀 HTML 仍按 text/html 渲染
  const r0 = await app.inject({ url });
  check("无后缀 HTML 正常嗅探成 text/html", () => {
    assert.strictEqual(r0.statusCode, 200, r0.body);
    assert.match(String(r0.headers["content-type"]), /text\/html/);
  });

  // 2) readSync 抛错：每次请求都不能漏 fd
  const realOpen = fs.openSync, realRead = fs.readSync;
  const watched = new Set();
  fs.openSync = function (p, ...a) { const fd = realOpen(p, ...a); if (String(p) === target) watched.add(fd); return fd; };
  fs.readSync = function (fd, ...a) { if (watched.has(fd)) throw new Error("模拟 readSync 失败"); return realRead(fd, ...a); };
  let statuses = [];
  try {
    const before = fdCount();
    for (let i = 0; i < 40; i++) {
      const r = await app.inject({ url });
      statuses.push(r.statusCode);
    }
    const after = fdCount();
    check("readSync 抛错 40 次：每次仍回 415，且不泄漏 fd", () => {
      assert.deepStrictEqual(Array.from(new Set(statuses)), [415], "嗅探失败按不支持预览处理: " + JSON.stringify(statuses));
      assert.ok(after - before <= 2, "40 次请求漏了 " + (after - before) + " 个 fd（>2 就算泄漏）");
    });
  } finally {
    fs.openSync = realOpen; fs.readSync = realRead;
  }

  // 3) 恢复后还能正常嗅探（关闭 fd 后状态没被带坏）
  const r1 = await app.inject({ url });
  check("异常恢复后仍正常嗅探", () => {
    assert.strictEqual(r1.statusCode, 200, r1.body);
    assert.match(String(r1.headers["content-type"]), /text\/html/);
  });

  await app.close();
  fs.rmSync(d, { recursive: true, force: true });
  console.log("\ntest_workflow_files: " + ok.length + " passed, " + bad.length + " failed（共 " + (ok.length + bad.length) + " 例）");
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log("ERR " + (e && e.stack || e)); process.exit(1); });
