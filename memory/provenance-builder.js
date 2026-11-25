"use strict";

// ========================
// Provenance Builder（C3）——只生成系统可信 provenance
// 铁律（14.txt 第五节）：LLM 禁止猜测来源；禁止从文本推断 msg_id——本模块根本不接收
// 正文，只透传调用方（入口适配器）从请求上下文捕获的 id；缺就是 null，绝不伪造。
// 字段名说明：session_id / msg_id 即 Schema v1.0（13.txt）冻结字段
// （对应任务书里的 conversation_id / message_id 语义）。
// origin × method 合法映射与 admission-validator ORIGIN_METHOD_BASE 保持同源语义：
//   memory_tag→tag_inline · tool→mcp_tool · manual→admin_form ·
//   promotion→summary_promotion/diary_promotion · import→migration_batch
//   [2026-11-06] 新增 channel（细分通道，可选字段，不升 schema）：origin 太粗，
//   promotion 一个值兜住了压缩块解析 / 蒸馏对话 / 蒸馏笔记 / 老数据重跑四类完全不同的来路，
//   前端只能靠 block_id、msg_id 形态和时间窗猜，猜错就会显示成"从总结里提上来的"。
//   以后新数据写入时由各入口如实标注，前端优先读 channel，没有才回落到旧判据。
// ========================

const { nowIso } = require("../utils/time_utils");

const ORIGIN_METHOD = {
  memory_tag: "tag_inline",
  tool: "mcp_tool",
  manual: "admin_form",
  promotion: "summary_promotion",
  import: "migration_batch",
};
const LEGAL_METHODS = new Set([
  "tag_inline", "mcp_tool", "admin_form",
  "summary_promotion", "diary_promotion", "migration_batch", "review_admit",
]);
/* [位置:memory/provenance-builder.js·CHANNELS] [来源细分通道白名单] [需求:origin 粒度太粗分不清来路，新写入按通道如实标注；非法值置 null 不硬造] [注释时间 2026-11-06] */
const CHANNELS = new Set([
  "manual_form",       // 手机 / 管理台表单手动新增
  "manual_pick",       // 聊天里长按挑一句入池
  "chat_tag",          // 聊天时由记忆标签 inline 写入
  "mcp_memory_add",    // AI 通过 memory 工具写的
  "dialog_distill",    // 蒸馏对话（按天的对话原文）
  "note_distill",      // 蒸馏笔记
  "compress_reparse",  // 压缩块解析（2026-09-28 那一轮；压缩块功能已下线）
  "backfill",          // 老数据重跑（含补标签 label）
]);

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

// 输入：{ origin, method?, sessionId?, msgId?, channel? }（quote/block_id 不在此生成——quote 是
// 唯一允许 AI 提供的字段，由入口适配器附带；block_id 只在压缩/提炼通道出现）
// 输出：Schema v1.0 provenance 五字段 + channel + created_at（生成时刻，仅供日志；
// 入库时间以 storage.create 打的 created_at 为准，本字段入库时被丢弃）。
function buildProvenance(input = {}) {
  const origin = strOrNull(input.origin);
  let method;
  if (input.method != null) {
    // 显式传入：合法则用，非法置 null——绝不静默回退默认（调用方错误必须裸露）
    const m = strOrNull(input.method);
    method = m && LEGAL_METHODS.has(m) ? m : null;
  } else {
    method = origin ? ORIGIN_METHOD[origin] || null : null; // 未知 origin → null，不硬造
  }
  const ch = strOrNull(input.channel);
  return {
    origin,
    method,
    session_id: strOrNull(input.sessionId),
    msg_id: strOrNull(input.msgId),
    quote: null,
    block_id: null,
    channel: ch && CHANNELS.has(ch) ? ch : null,
    created_at: nowIso(),
  };
}

module.exports = { buildProvenance, CHANNELS };
