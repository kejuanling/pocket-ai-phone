'use strict';
// 日记共享模块（2026-09-16）：日常聊天（routes/chat.js）与唤醒（lib/wake-scheduler.js）共用，
// 保证 [DIARY] 块提取与日记写入口径一致，杜绝两处漂移。
// 2026-10-03：日记存储从「一个日记一个文件」改为 data/diary.json（lib/diary-store 统一管理，
// id 按创建顺序自增、hidden 为字段）；本模块的写入口 appendDiaryEntry 改为 JSON 追加。
// 依赖注入：baseDir（项目根目录）、readEnvValue（gateway cachedEnv 读取，管理台保存即刷新）。

const { getDatePartsInTimeZone, resolveTimeZone } = require("../utils/time_utils");
const { safeSessionToken } = require("./session-token"); // 2026-09-21 审查 R20：与 gateway 同口径
const diaryStore = require("./diary-store");

module.exports = function createDiaryLib(deps) {
  const { baseDir, readEnvValue } = deps;
  const TIME_ZONE = resolveTimeZone();

  // 布尔环境读取："1/true/yes/on"（不分大小写）视为真，未设置用 fallback
  function readBooleanEnv(key, fallback = false) {
    const raw = String(readEnvValue(key) ?? "").trim().toLowerCase();
    if (!raw) return fallback;
    return ["1", "true", "yes", "on"].includes(raw);
  }

  // 当前时间（时区化）的「YYYY-MM-DD HH:mm」串，用作日记条目标题
  function getDiaryTimeString(date = new Date()) {
    const p = getDatePartsInTimeZone(date, TIME_ZONE);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  }

  function appendDiaryEntry(content, sessionId, opts) {
    if (!readBooleanEnv("DIARY_ENABLED", true)) {
      console.log("[diary] DIARY_ENABLED=false，跳过保存。请在管理台设置 DIARY_ENABLED=true");
      return false;
    }
    const cleanContent = String(content || "").trim();
    if (!cleanContent) {
      console.log("[diary] 日记内容为空，跳过保存");
      return false;
    }
    try {
      // 日记按会话归属（2026-09-12）：会话标识与 gateway safeSessionToken 同规则；
      // 「default」（无有效会话）归共享层 = session null。
      const token = safeSessionToken(sessionId);
      const session = token === "default" ? null : token;
      // 2026-10-03：写入 data/diary.json（id 由 diary-store 按创建顺序自增）
      const now = new Date();
      const entry = `## ${getDiaryTimeString(now)}\n\n${cleanContent}\n`;
      const saved = diaryStore.addEntry(baseDir, {
        session: session,
        hidden: false,
        created_at: now.toISOString(),
        content: entry,
        kind: opts && opts.kind,
        title: opts && opts.title,
      });
      console.log(`[diary] 已保存日记（id=${saved.id}，会话 ${session || "共享"}，${cleanContent.length} 字符）`);
      // 2026-10-19：返回完整条目（含 id）——时间线 kind=diary 消息要靠 diary_id 外键与库内条目关联
      // （页面编辑/恢复按 id 同步时间线）。失败仍返回 false，调用方真值判断不受影响。
      return saved;
    } catch (err) {
      console.error("[diary] 保存日记失败:", err.message);
      return false;
    }
  }

  // ---- [DIARY] 块提取（严格模式 2026-09-21：只认成对 [DIARY]…[/DIARY]，漏闭合/残缺标签一律不算日记，
  // 置 tagError=true 由调用方在 developer 判定行回传「标签解析错误，记忆写入失败」——写错标签不纵容）----
  // 代码块掩码（2026-10-25）：与 lib/tag-parser.js 的 codeMask 同语义——反引号/围栏代码块内的
  //   [DIARY] 只算展示不算日记（讲解标签是合法用法）；两处判定同源，改动要同步。
  // 2026-10-28 第6项：掩码收拢到 workspace/phone-tags.js（围栏/~~~/code·pre/表格/行内反引号），与 tag-parser 同源，不再各存一份
  const codeMask = require("../workspace/phone-tags.js").mask;
  function extractDiaryFromResponse(text) {
    const diaryBlocks = [];
    const cm = codeMask(text);
    let remainingText = String(cm.text || "")
      .replace(/\[DIARY\]([\s\S]*?)\[\/DIARY\]/gi, (_, content) => {
        const diary = cm.restore(String(content || "")).trim();
        if (diary) diaryBlocks.push(diary);
        return "";
      })
      // 2026-10-28 第6项：新写法 <lovediary>正文</lovediary>（不写 kind 或 kind=diary 就是日记，同 [DIARY]）；kind=letter 的信封不在这里，由 lib/tag-actions.js 转调 lovediary 工具
      .replace(/<\s*lovediary\b([^>]*)>([\s\S]*?)<\s*\/lovediary\s*>/gi, (all, attrs, content) => {
        if (/\bkind\s*=\s*["']?(?:letter|envelope|信封)/i.test(cm.restore(String(attrs || "")))) return all;
        const diary = cm.restore(String(content || "")).trim();
        if (diary) diaryBlocks.push(diary);
        return "";
      })
      .trim();
    // 严格校验：成对块之外仍残留 [DIARY] 或 [/DIARY] = 标签残缺（漏闭合/孤开标/多尾标）；代码块内的残留不算
    const tagError = /\[DIARY\]|\[\/DIARY\]/i.test(remainingText);
    // 残缺标签不进日记，但也不许泄漏进推送/展示文本：先在掩码文本上剥（代码块是占位符碰不到），再还原
    remainingText = cm.restore(remainingText.replace(/\[DIARY\]|\[\/DIARY\]/gi, "")).trim();
    return { diaryContent: diaryBlocks.join("\n\n").trim(), remainingText, tagError };
  }

  // 给日记原文包 [DIARY] 标签（用于时间线 kind=diary 消息存储，完整上下文统一带标签）
  /* [位置:diary.js·wrapDiaryTag] [落库格式：（YYYY-MM-DD HH:MM diary）换行 [DIARY]正文[/DIARY]] [模型要靠时间行判断日记先后；时间行放标签外，标签仍是唯一的提取边界；入参已带时间行时沿用其时间（编辑/重包裹不改日记发生时间）；when 不传取当前，时区同日记标题] [注释时间 2026-10-22] */
  const DIARY_HEAD_RE = /^\s*（(?:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+)?diary(?:\s*·\s*id:\s*\d+)?）[ \t]*\n?/i;
  function wrapDiaryTag(content, when) {
    let raw = String(content || "");
    let stamp = "";
    const hm = raw.match(DIARY_HEAD_RE);
    if (hm) { stamp = hm[1]; raw = raw.slice(hm[0].length); }
    const clean = raw.replace(/\[DIARY\]|\[\/DIARY\]/gi, "").trim();
    if (!clean) return "";
    if (!stamp) {
      const d = when ? new Date(when) : new Date();
      stamp = getDiaryTimeString(isNaN(d.getTime()) ? new Date() : d);
    }
    return "（" + stamp + " diary）\n[DIARY]" + clean + "[/DIARY]";
  }

  return { appendDiaryEntry, extractDiaryFromResponse, wrapDiaryTag };
};
