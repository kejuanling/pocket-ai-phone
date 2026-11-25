'use strict';
// 出站图片统一加工的单测：装饰（图片id/表情包转图）+ 补全 + 内联 + 断点诊断。
// 跑法：node tests/outbound-images/test_outbound_images.js
const assert = require('assert');
const path = require('path');
const img = require('../../lib/outbound-images');
const adapter = require('../../lib/anthropic-adapter');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + (e && e.message)); }
}
function okAsync(name, fn) {
  return fn().then(function () { pass++; console.log('  ok  ' + name); },
    function (e) { fail++; console.log('  FAIL ' + name + ' -> ' + (e && e.message)); });
}

function mkMsgs() {
  return [
    { role: 'system', content: '人设' },
    { role: 'user', content: '嘻嘻\n<sticker id="dog-excited"/>\n<current_time>2026-11-06</current_time>' },
    { role: 'assistant', content: '两只傻狗\n<sticker id="dog-excited"/>' },
    { role: 'user', content: '<sticker id="不存在的编号"/>' },
    { role: 'user', content: [
      { type: 'text', text: '看这个' },
      { type: 'image_url', image_url: { url: '/uploads/img-mw4v9011-20b30bb0.jpg' } },
    ] },
    { role: 'user', content: [
      { type: 'text', text: '老图' },
      { type: 'image_url', image_url: { url: '/uploads/img-1-abcdef.jpg' } },
    ] },
  ];
}

function imageUrls(m) {
  const out = [];
  for (const msg of m) {
    if (!Array.isArray(msg.content)) continue;
    for (const p of msg.content) {
      if (p && p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string') out.push(p.image_url.url);
    }
  }
  return out;
}

(async function () {
  console.log('[decorateOutboundMessages]');
  ok('user 表情包转真图，assistant 不转', function () {
    const m = mkMsgs();
    const st = img.decorateOutboundMessages(m);
    assert.strictEqual(st.stickers, 1, '只该给 user 转 1 张，实际 ' + st.stickers);
    const urls = imageUrls(m);
    assert.deepStrictEqual(urls.filter(u => u.indexOf('/stickers/t/') === 0), ['/stickers/t/dog-excited.jpg']);
    // assistant 那条仍是纯文本
    assert.ok(typeof m[2].content === 'string');
  });
  ok('无效表情包编号不转（不给上游塞 404 图）', function () {
    const m = mkMsgs();
    img.decorateOutboundMessages(m);
    assert.strictEqual(imageUrls(m).filter(u => u.indexOf('不存在') >= 0).length, 0);
    assert.strictEqual(typeof m[3].content, 'string');
  });
  /* [位置:tests/outbound-images·vision表情包用例] [vision 模型表情包只发标签] [11-12 拍板：能看图的模型不发表情包图，编号清单在永久上下文里，图没有信息增量；上传照片的图片 id 注入不受影响] [注释时间 2026-11-12] */
  ok('vision=true：表情包不转图只留标签，上传图 id 照注', function () {
    const m = mkMsgs();
    const st = img.decorateOutboundMessages(m, { vision: true });
    assert.strictEqual(st.stickers, 0, 'vision 不该转表情包图');
    assert.strictEqual(imageUrls(m).filter(u => u.indexOf('/stickers/') >= 0).length, 0);
    assert.ok(String(m[1].content).indexOf('<sticker id="dog-excited"/>') >= 0, '标签文字要原样保留');
    assert.strictEqual(st.imageIds, 2, '上传图 id 注入不受影响，实际 ' + st.imageIds);
  });
  /* [位置:tests/outbound-images·图片id用例] [id 一律注入] [11-07 文件名缩短后第一段不再是时间戳，旧「上线后新图才注入」门槛把新图全拦了（AI 看不到图片 id 的根因）；11-08 删门槛，新旧格式都注入] [注释时间 2026-11-08] */
  ok('图片 id 一律注入（11-07 短文件名与老时间戳格式都认）', function () {
    const m = mkMsgs();
    const st = img.decorateOutboundMessages(m);
    assert.strictEqual(st.imageIds, 2, '实际 ' + st.imageIds);
    const parts = m[4].content;
    // id 文本插在该图 part 的前一位，原来的文字原样在前
    assert.strictEqual(parts[0].text, '看这个');
    assert.strictEqual(parts[1].type, 'text');
    assert.strictEqual(parts[1].text, '[图片 id:img-mw4v9011-20b30bb0]');
    assert.strictEqual(parts[2].type, 'image_url');
    // 短格式图同样注入
    assert.strictEqual(m[5].content.length, 3);
    assert.strictEqual(m[5].content[0].text, '老图');
    assert.strictEqual(m[5].content[1].text, '[图片 id:img-1-abcdef]');
  });
  ok('imgIdOfUrl：短/老格式都解析，非 uploads 图返回空', function () {
    assert.strictEqual(img.imgIdOfUrl('/uploads/img-cyfa-rh4o.jpg'), 'img-cyfa-rh4o');
    assert.strictEqual(img.imgIdOfUrl('http://127.0.0.1/uploads/img-mvl739lt-82b57b42.jpg'), 'img-mvl739lt-82b57b42');
    assert.strictEqual(img.imgIdOfUrl('/stickers/t/dog-excited.jpg'), '');
    assert.strictEqual(img.imgIdOfUrl('https://cdn.example.com/pic.jpg'), '');
  });
  ok('幂等：同一份消息跑两次不会重复加图', function () {
    const m = mkMsgs();
    img.decorateOutboundMessages(m);
    const first = imageUrls(m).length;
    img.decorateOutboundMessages(m);
    assert.strictEqual(imageUrls(m).length, first);
  });

  console.log('[shapeHistoryImagesForModel]');
  const chatCtx = require('../../routes/chat-context');
  function shapeMsgs() {
    return [
      { role: 'system', content: '人设' },
      { role: 'user', id: 'm1', content: [
          { type: 'text', text: '带转写的历史图' },
          { type: 'image_url', image_url: { url: '/uploads/img-mvl739lt-82b57b42.jpg' } },
        ], image_desc: [{ source: '/uploads/img-mvl739lt-82b57b42.jpg', text: '一朵四瓣小花' }] },
      { role: 'assistant', id: 'm2', content: '真好看' },
      { role: 'user', id: 'm3', content: [
          { type: 'text', text: '无转写的历史图' },
          { type: 'image_url', image_url: { url: 'http://127.0.0.1/uploads/img-cyfa-rh4o.jpg' } },
        ] },
      { role: 'assistant', id: 'm3b', content: '这张也好看' },
      { role: 'user', id: 'm4', content: [
          { type: 'text', text: '当轮第一张' },
          { type: 'image_url', image_url: { url: '/uploads/img-bpbi-0s6r.jpg' } },
        ] },
    ];
  }
  ok('vision=true：原样透传（引用不变）', function () {
    const m = shapeMsgs();
    const out = chatCtx.shapeHistoryImagesForModel(m, { vision: true });
    assert.strictEqual(out, m);
  });
  ok('vision=false：历史图降级带id占位，有转写附转写，当轮保真', function () {
    const m = shapeMsgs();
    const out = chatCtx.shapeHistoryImagesForModel(m, { vision: false });
    // m1 历史有转写
    assert.strictEqual(out[1].content[1].type, 'text');
    assert.strictEqual(out[1].content[1].text, '[图片 id:img-mvl739lt-82b57b42][图片转写] 一朵四瓣小花');
    // m3 历史无转写（含绝对 URL 也能解析 id）
    assert.strictEqual(out[3].content[1].text, '（图片 id:img-cyfa-rh4o）');
    // m4 当轮（末尾连续 user）保真；m3b assistant 原样
    assert.strictEqual(out[5].content[1].type, 'image_url');
    assert.strictEqual(out[4].content, '这张也好看');
    // 原数组不动
    assert.strictEqual(m[1].content[1].type, 'image_url');
    assert.strictEqual(m[3].content[1].type, 'image_url');
  });
  ok('vision=false：外链图退回（图片）占位', function () {
    const m = [
      { role: 'assistant', content: '前面一句' },
      { role: 'user', content: [
        { type: 'text', text: '外链' },
        { type: 'image_url', image_url: { url: 'https://cdn.example.com/pic.jpg' } },
      ] },
      { role: 'assistant', content: '回一句' },
    ];
    const out = chatCtx.shapeHistoryImagesForModel(m, { vision: false });
    assert.strictEqual(out[1].content[1].text, '（图片）');
  });
  ok('vision=false：分流后 decorate 只给当轮真图注入 id（组合口径）', function () {
    const m = shapeMsgs();
    const shaped = chatCtx.shapeHistoryImagesForModel(m, { vision: false });
    img.decorateOutboundMessages(shaped);
    const texts = [];
    for (const msg of shaped) {
      if (!Array.isArray(msg.content)) continue;
      for (const p of msg.content) if (p.type === 'text' && /^\[图片 id:/.test(p.text)) texts.push(p.text);
    }
    // [开头的 id 文本：m1 占位（带转写）+ m4 当轮真图注入；m3 占位是（开头）不匹配
    assert.deepStrictEqual(texts, [
      '[图片 id:img-mvl739lt-82b57b42][图片转写] 一朵四瓣小花',
      '[图片 id:img-bpbi-0s6r]',
    ]);
  });

  console.log('[fillAndInlineImages]');
  await okAsync('相对路径补全为绝对 URL（无 req 用 PUBLIC_BASE_URL）', async function () {
    const m = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: '/uploads/a.jpg' } }] }];
    const r = await img.fillAndInlineImages(m, { resolveUrl: img.makeUrlResolver('https://example.com'), isAnthropicProxy: false });
    assert.strictEqual(m[0].content[0].image_url.url, 'https://example.com/uploads/a.jpg');
    assert.strictEqual(r.urlFilled, 1);
    assert.strictEqual(r.inlined, 0);
  });
  await okAsync('非 Claude 上游不内联（deepseek 收 base64 会整包拒）', async function () {
    const m = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: '/stickers/t/dog-excited.jpg' } }] }];
    await img.fillAndInlineImages(m, { resolveUrl: img.makeUrlResolver('https://example.com'), isAnthropicProxy: false });
    assert.strictEqual(m[0].content[0].image_url.url, 'https://example.com/stickers/t/dog-excited.jpg');
  });
  await okAsync('Claude 上游把本站表情包内联成 base64', async function () {
    const m = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: '/stickers/t/dog-excited.jpg' } }] }];
    const r = await img.fillAndInlineImages(m, { resolveUrl: img.makeUrlResolver('https://example.com'), isAnthropicProxy: true });
    assert.strictEqual(r.inlined, 1);
    assert.ok(/^data:image\//.test(m[0].content[0].image_url.url));
    assert.ok(r.inlineBytes > 1000);
  });
  await okAsync('data: 的图不会被重复处理', async function () {
    const m = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }];
    const r = await img.fillAndInlineImages(m, { resolveUrl: img.makeUrlResolver('https://example.com'), isAnthropicProxy: true });
    assert.strictEqual(r.urlFilled, 0);
    assert.strictEqual(m[0].content[0].image_url.url, 'data:image/jpeg;base64,AAAA');
  });

  console.log('[两侧一致性]');
  await okAsync('同一份历史按聊天/唤醒两条参数跑，出站图块数与 URL 逐字相同', async function () {
    const a = mkMsgs(), b = mkMsgs();
    img.decorateOutboundMessages(a);
    img.decorateOutboundMessages(b);
    // 聊天侧：有 req（PUBLIC_BASE_URL 同源）；唤醒侧：只有 env。两侧 base 相同 → 结果必须一致
    const base = 'http://127.0.0.1';
    const ra = await img.fillAndInlineImages(a, { resolveUrl: img.makeUrlResolver(base), isAnthropicProxy: true });
    const rb = await img.fillAndInlineImages(b, { resolveUrl: img.makeUrlResolver(base), isAnthropicProxy: true });
    assert.strictEqual(ra.imageBlocks, rb.imageBlocks);
    assert.strictEqual(ra.inlined, rb.inlined);
    assert.deepStrictEqual(imageUrls(a), imageUrls(b));
  });

  console.log('[describeCacheBreakpoints]');
  ok('Claude 请求能定位四层断点（人设/注入/状态/尾巴）', function () {
    const body = {
      model: 'claude-opus-4-6',
      messages: [
        { role: 'system', content: '人设正文\n\n## System Instructions\n永久上下文\n\n## Conversation State\n状态正文' },
        { role: 'user', content: '第一轮' },
        { role: 'assistant', content: '回一句' },
        { role: 'user', content: '第二轮 <sticker id="dog-excited"/>' },
      ],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } }],
    };
    const req = adapter.toAnthropicRequest(body, { oauthIdentity: 'ID', cacheTtl: '1h' });
    const bps = adapter.describeCacheBreakpoints(req);
    const wh = bps.map(b => b.where.split('(')[0]);
    assert.ok(wh.indexOf('sys1') >= 0, '缺人设断点: ' + wh.join(','));
    assert.ok(wh.indexOf('sys2') >= 0, '缺注入/状态断点: ' + wh.join(','));
    assert.ok(bps.some(b => b.where.indexOf('msg') === 0), '缺消息尾巴断点: ' + wh.join(','));
    bps.forEach(function (b) {
      assert.strictEqual(b.ttl, '1h');
      assert.strictEqual(b.hash.length, 8);
      assert.ok(b.chars > 0);
    });
  });

  console.log('\n通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
