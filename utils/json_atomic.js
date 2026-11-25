// 原子写 JSON（2026-09-30 V10 收敛：7 份重复实现的唯一来源）
// 此前 server.js×2 内联（atomicWriteJsonSync/writeJsonFileAtomic）、context-compactor×3 内联、
// model-router 与 context-replacements 各一份模块版并存，细节漂移（tmp 命名、mkdir、残留清理不一）。
// 语义=各版并集（最强）：目录递归创建 + 唯一 tmp 名（pid+时间戳，防并发串写）+ rename 原子替换
// + finally 清残留。模块私有副作用（如读缓存失效）由调用方自行包一层处理。
// 注：带 fsync 的文本版（server.js atomicWriteFileSync）与带文件权限的版本（netease session）
// 是有理由的变体，不在收敛范围。
const fs = require("fs");
const path = require("path");

/* [位置:utils/json_atomic.js·writeJsonAtomic] [可指定缩进] [11-14 审查 B 批 b：memory-distill 的笔记快照 173KB、原本用 spaces:0 紧凑写，直接换成默认 2 格会把文件撑大；这里加一个可选第三参，不传仍是原来的 2 格，已有一切调用方行为不变] [注释时间 2026-11-14] */
function writeJsonAtomic(file, data, spaces) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, spaces == null ? 2 : spaces), "utf-8");
    fs.renameSync(tmp, file);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { writeJsonAtomic };
