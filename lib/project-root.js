'use strict';

/* [位置:lib/project-root.js] [发布树项目根目录] [发布副本不再写死现网绝对路径，统一从环境变量或仓库根解析] [注释时间 2026-11-25] */

const fs = require('fs');
const path = require('path');

function projectRoot() {
  const env = String(process.env.PROJECT_ROOT || '').trim();
  if (env) return path.resolve(env);
  let cur = path.resolve(__dirname, '..');
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(__dirname, '..');
}

module.exports = { projectRoot };
