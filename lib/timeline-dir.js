'use strict';
// 时间线目录（1018-12）：所有会话时间线 enhanced_messages*.json 统一放 <项目根>/timeline_data/，
// 不再散在项目根。baseDir 版本给测试/模块注入用（真实运行时 baseDir 即项目根，两者等价）。
const path = require('path');

const DIR_NAME = 'timeline_data';
const TIMELINE_DIR = path.join(__dirname, '..', DIR_NAME);

function timelineDirOf(baseDir) {
  return baseDir ? path.join(baseDir, DIR_NAME) : TIMELINE_DIR;
}

module.exports = { DIR_NAME, TIMELINE_DIR, timelineDirOf };
