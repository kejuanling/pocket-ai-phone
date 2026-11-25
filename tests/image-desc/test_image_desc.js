'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const imageDesc = require(path.join(root, 'lib', 'image-desc'));
const modelRouter = require(path.join(root, 'lib', 'model-router'));

test('图片转写是已注册的用途模型', () => {
  assert.equal(modelRouter.KNOWN_MODEL_ROLES.image_desc, '图片转写');
});

test('按图片地址读写转写并渲染历史占位', () => {
  const msg = {
    role: 'user',
    content: [
      { type: 'text', text: '看这个' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } }
    ],
    image_desc: [{ source: 'https://example.com/a.jpg', text: '一只橘猫趴在沙发上，旁边有蓝色抱枕。' }]
  };
  assert.equal(imageDesc.descriptionFor(msg, 'https://example.com/a.jpg'), '一只橘猫趴在沙发上，旁边有蓝色抱枕。');
  assert.equal(imageDesc.historyText(msg, 'https://example.com/a.jpg'), '[图片转写] 一只橘猫趴在沙发上，旁边有蓝色抱枕。');
  assert.equal(imageDesc.historyText(msg, 'https://example.com/missing.jpg'), '（图片）');
});

test('本轮图片后追加转写文本，未转写图不追加', () => {
  const msg = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: '/uploads/has.jpg' } },
      { type: 'image_url', image_url: { url: '/uploads/none.jpg' } }
    ],
    image_desc: [{ source: '/uploads/has.jpg', text: '傍晚的桌面，有一杯茶。' }]
  };
  const out = imageDesc.annotateCurrentImages([msg]);
  assert.deepEqual(out[0].content.map(p => p.type), ['image_url', 'text', 'image_url']);
  assert.equal(out[0].content[1].text, '[图片转写] 傍晚的桌面，有一杯茶。');
  const supplemented = imageDesc.annotateCurrentImages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: '/uploads/new.jpg' } }] }], new Map([['/uploads/new.jpg', '刚转写的结果']]));
  assert.equal(supplemented[0].content[1].text, '[图片转写] 刚转写的结果');
});

test('压缩摘要能读到图片转写而不是只剩图片占位', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(root, 'context', 'context-compactor.js'), 'utf8');
  const match = source.match(/function contentToText\(msg\) \{[\s\S]*?\n\}/);
  assert.ok(match, '应能定位 context-compactor.contentToText');
  const context = { require, module: { exports: {} }, __dirname: path.join(root, 'context'), imageDesc };
  vm.runInNewContext(match[0], context);
  const msg = {
    content: [{ type: 'image_url', image_url: { url: '/uploads/x.jpg' } }],
    image_desc: [{ source: '/uploads/x.jpg', text: '一张蓝色便利贴，上面写着“记得喝水”。' }]
  };
  assert.equal(context.contentToText(msg), '[图片转写] 一张蓝色便利贴，上面写着“记得喝水”。');
});

test('状态机摘要读转写，但压缩/标星 key 不被转写改变', () => {
  const fs2 = require('node:fs');
  const stateSrc = fs2.readFileSync(path.join(root, 'lib', 'conversation-state.js'), 'utf8');
  const fn = stateSrc.match(/\/\* \[位置:lib\/conversation-state\.js·contentToText\][\s\S]*?\nfunction contentToText\(msg\) \{[\s\S]*?\n\}/);
  assert.ok(fn, '应能定位 conversation-state.contentToText');
  const context = { require, imageDesc };
  vm.runInNewContext(fn[0].replace(/\/\*[\s\S]*?\*\//g, ''), context);
  const msg = {
    content: [{ type: 'text', text: '看这张' }, { type: 'image_url', image_url: { url: '/x.jpg' } }],
    image_desc: [{ source: '/x.jpg', text: '一张蓝色便利贴。' }]
  };
  assert.equal(context.contentToText(msg), '看这张\n[图片转写] 一张蓝色便利贴。');

  const cr = require(path.join(root, 'context', 'context-replacements'));
  const withoutDesc = { role: 'user', content: msg.content };
  const withDesc = Object.assign({}, withoutDesc, { image_desc: msg.image_desc });
  assert.equal(cr.contentKey(withoutDesc), cr.contentKey(withDesc), 'image_desc 不能改变压缩/标星 key');
});

test('图片转写提示词接口源码与前端配置一一对应', () => {
  const fs = require('node:fs');
  const route = fs.readFileSync(path.join(root, 'routes', 'image-desc.js'), 'utf8');
  assert.match(route, /\/admin\/image-desc\/prompt/);
  const pages = fs.readFileSync(path.join(root, 'workspace', 'phone-pages.js'), 'utf8');
  assert.match(pages, /image-desc\/prompt/);
});
