'use strict';
// Antigravity 模型 id 选型（2026-11-04）：
//   账号目录里的 id 带档位后缀（-low/-medium/-high）或只有一个 -tiered；
//   配置写的是逻辑名（gemini-3.8-flash / gemini-3.5-flash-lite…），发请求前要解析。
// 运行：node tests/oauth-proxy/test_antigravity_pick.js
const assert = require('assert');
// 只加载纯函数，不启动服务：oauth-proxy 的 register 不会被调用
const proxy = require('../../routes/oauth-proxy');
const pickAgModel = proxy._internal.pickAgModel;

let failed = 0;
function ok(cond, name, extra) {
  if (cond) { console.log('ok ' + name); return; }
  failed++; process.exitCode = 1;
  console.error('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra)));
}

const CATALOG = [
  'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high',
  'gemini-3.7-flash-tiered', 'gemini-3.1-pro-low', 'gemini-3.1-pro-high',
  'claude-sonnet-4-6', 'gpt-oss-120b-medium',
];

// 1. 目录里有原名：照发
{
  const r = pickAgModel('gemini-3.8-flash-medium', CATALOG);
  ok(r.model === 'gemini-3.8-flash-medium' && !r.thinkingLevel, '目录有原名：照发', r);
}

// 2. 逻辑名 → 无后缀默认 medium
{
  const r = pickAgModel('gemini-3.8-flash', CATALOG);
  ok(r.model === 'gemini-3.8-flash-medium' && !r.thinkingLevel, '无后缀：默认 medium', r);
}

// 3. lite/low 偏好 → low
{
  const r = pickAgModel('gemini-3.5-flash-lite', CATALOG);
  ok(r.model === 'gemini-3.8-flash-low', 'lite 偏好：降级到 low 档', r);
}

// 4. pro 偏好 → high
{
  const r = pickAgModel('gemini-3.1-pro', CATALOG);
  ok(r.model === 'gemini-3.1-pro-high', 'pro 偏好：high 档', r);
}

// 5. 只有 -tiered：返回 tiered + 把档位放到请求里
{
  const r = pickAgModel('gemini-3.7-flash', CATALOG);
  ok(r.model === 'gemini-3.7-flash-tiered' && r.thinkingLevel === 'medium', 'tiered：带 thinkingLevel', r);
  const low = pickAgModel('gemini-3.7-flash-lite', CATALOG);
  ok(low.model === 'gemini-3.7-flash-tiered' && low.thinkingLevel === 'low', 'tiered + lite：带 low 档位', low);
}

// 6. 同族一个都不在：兜底目录里第一个 gemini
{
  const r = pickAgModel('gemini-9.9-flash', CATALOG);
  ok(/^gemini-/.test(r.model), '同族缺失：兜底到某个 gemini', r);
}

// 7. 目录为空：原样发（让上游报错，别吞掉配置）
{
  const r = pickAgModel('gemini-3.8-flash', []);
  ok(r.model === 'gemini-3.8-flash' && !r.thinkingLevel, '目录为空：原样发', r);
}

// 8. 非 gemini 模型（claude/gpt-oss 目录里有）照发
{
  const r = pickAgModel('claude-sonnet-4-6', CATALOG);
  ok(r.model === 'claude-sonnet-4-6', '非 gemini 模型：照发', r);
}

// 9. 空配置
{
  const r = pickAgModel('', CATALOG);
  ok(r.model === 'gemini-3.8-flash-medium', '空配置：落到目录第一个同族/兜底', r);
}


const CATALOG4 = [
  'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high',
  'gemini-4-hydrogen-sonar', 'gemini-3.7-flash-tiered',
];

// 10. 代号族：目录有原名（4 系 sonar）照发
{
  const r = pickAgModel('gemini-4-hydrogen-sonar', CATALOG4);
  ok(r.model === 'gemini-4-hydrogen-sonar' && !r.thinkingLevel, '代号族：目录有原名照发', r);
}

// 11. 代号族：目录只有带档位/带变体的 id 时按代号挑，不掉到 3.8
{
  const r = pickAgModel('gemini-4-hydrogen-sonar', ['gemini-3.8-flash-high', 'gemini-4-hydrogen-sonar-high', 'gemini-4-hydrogen-low']);
  ok(r.model === 'gemini-4-hydrogen-sonar-high', '代号族：同代号优先，且不退到 3.8', r);
}

// 12. 代号族：要 sonar，目录只有普通 hydrogen，也留在 4 系
{
  const r = pickAgModel('gemini-4-hydrogen-sonar', ['gemini-3.8-flash-medium', 'gemini-4-hydrogen']);
  ok(r.model === 'gemini-4-hydrogen', '代号族：变体缺了就留同代号', r);
}

// 13. 代号族：目录里根本没这个代号，原样发（不跨代号、不跨代降级）
{
  const r = pickAgModel('gemini-4-argon', CATALOG4);
  ok(r.model === 'gemini-4-argon', '代号缺失：原样发不降级', r);
}

// 14. 代号族：要 carbon、目录只有 hydrogen，绝不换成别的代号
{
  const r = pickAgModel('gemini-4-carbon', CATALOG4);
  ok(r.model === 'gemini-4-carbon', '跨代号：原样发', r);
}

// 14b. 代号族：neon 简写与 xhigh 档位
{
  const catNeon = ['gemini-3.8-flash-high', 'gemini-4-neon-low', 'gemini-4-neon-medium', 'gemini-4-neon-high', 'gemini-4-neon-xhigh'];
  ok(pickAgModel('gemini-4-neon', catNeon).model === 'gemini-4-neon-medium', 'neon 简写：默认 medium');
  ok(pickAgModel('gemini-4-neon-xhigh', catNeon).model === 'gemini-4-neon-xhigh', 'neon xhigh：精确命中');
  ok(pickAgModel('gemini-4-neon-xhigh', ['gemini-4-neon-high', 'gemini-4-neon-medium']).model === 'gemini-4-neon-high', 'neon xhigh 缺失时回落 high');
  ok(pickAgModel('gemini-4-neon', CATALOG4).model === 'gemini-4-neon', '目录无 neon：原样发不降级');
}

// 15-17. 订阅目录过滤：内部 id / 出图出片模型不进聊天列表
{
  const filt = proxy._internal.filterSubscriptionModels;
  ok(typeof filt === 'function', 'filterSubscriptionModels 已导出');
  const ag = filt('antigravity', ['chat_23310', 'tab_flash_lite_preview', 'gemini-4-hydrogen-sonar', 'gemini-3.1-flash-image', 'claude-opus-5-5-high', 'gpt-oss-120b-medium']);
  ok(ag.length === 4 && ag.indexOf('chat_23310') < 0 && ag.indexOf('tab_flash_lite_preview') < 0, 'antigravity：滤掉内部 id', ag);
  const grok = filt('grok', ['grok-4.7', 'grok-imagine-image-2.0', 'grok-imagine-video-1.5-lite', 'grok-4.20-0309-reasoning']);
  ok(grok.length === 2 && grok.indexOf('grok-imagine-video-1.5-lite') < 0, 'grok：滤掉出图出片模型', grok);
}
console.log(failed ? ('\nFAILED: ' + failed) : '\nALL PASS');
