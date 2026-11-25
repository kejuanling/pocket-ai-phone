/* Service Worker：iOS 桌面 PWA 系统通知（Web Push）。
   职责只有两件事：收 push 显示系统通知；点通知把用户带回目标会话现场。
   不缓存页面资源（聊天页自身带 no-cache 头，恢复靠页面 re-fetch server truth）。 */
'use strict';

// 无页面缓存逻辑（见文件尾 ph-static 段：只缓存 js/css 等静态资源，html 永不缓存），新版本可直接接管（配合 PWA 重开触发更新检查）
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim().then(function () {
    /* [位置:sw.js·activate] [清掉旧版静态缓存] [C4：缓存 key 升版时删旧目录，防 orphan 堆积；caches 不可用（极端环境）不能拖死激活，整段兜住] [注释时间 2026-11-19] */
    return caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf('ph-') === 0 && k !== PHC; }).map(function (k) { return caches.delete(k); }));
    }).catch(function () {});
  }));
});

self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  // 标题留空 = 通知只显示 App 名 + 正文（2026-09-26 用户拍板）
  const title = (data && typeof data.title === 'string') ? data.title : '';
  event.waitUntil(self.registration.showNotification(title, {
    body: (data && data.body) || '',
    icon: '/push-icon-192.png',
    badge: '/push-icon-192.png',
    tag: 'dylan-chat',
    vibrate: [80, 40, 80],
    data: { url: (data && data.url) || '/chat' }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/chat';
  event.waitUntil((async function () {
    // 已有本 PWA 窗口 → 原地 navigate 到目标现场并聚焦；没有 → 冷启动打开目标 URL。
    // URL 本身就是恢复线索（/chat?from_push=1&session_id=xxx），页面起来后自己 re-fetch 服务器状态。
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('navigate' in client) {
        try { await client.navigate(target); } catch (e) { /* navigate 失败则退回 openWindow */ }
        try { await client.focus(); } catch (e) {}
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

/* ===================== C4 静态资源缓存（加载提速批第二批，2026-11-19 产品确定） =====================
   [位置:sw.js·ph-static 段] [静态资源 cache-first + 统一对齐] [需求：热启动（杀掉重开/切回 PWA）时 49 个 js/css 不再逐个发 304 协商请求——弱网下这一轮要占 1-2 个 RTT；现在首屏零网络请求，由 SW 缓存直接秒回。html 与全部接口永不缓存（html 本身 no-store，改完直接生效的口径不变）。更新收敛闭环：① 打开页面（navigate）时后台把缓存条目协商对齐一轮（2 分钟节流）；② phone-kit frontUpdate 的 15s ETag 检查发现资产变了要自动 reload 时，先发 ph-sync 等 SW 把缓存同步换新（回执 ph-synced）再刷——保证「刷新出来的就是新版」，不会出现「刷了还是旧的」。只收根目录 js/css/png/svg/ico/webmanifest/jpg/webp + /anim/ /vendor/ /stickers/ 前缀；API 都带路径前缀天然不匹配；fonts/uploads 是 immutable 长缓存交给浏览器 HTTP 缓存，不进这里。白名单外一切放行（网络原样）。注释时间 2026-11-19] */
var PHC = 'ph-static-v1';
var PH_TLD = /\.(js|css|png|svg|ico|webmanifest|jpe?g|webp)$/;
var PH_PRE = ['/anim/', '/vendor/', '/stickers/'];
var phLastSync = 0;

function phStatic(u) {
  if (u.origin !== self.location.origin) return false;
  var p = u.pathname, i;
  for (i = 0; i < PH_PRE.length; i++) if (p.indexOf(PH_PRE[i]) === 0) return true;
  return p.lastIndexOf('/') === 0 && PH_TLD.test(p);   /* 仅根目录文件；带路径前缀的（API、world、diary…）一概不管 */
}

/* 缓存条目全量协商对齐：304 不动（浏览器会把 304 合成 200，put 同内容无害），200 换新；任何一条失败不挡其余 */
function phRevalidate(force) {
  var now = Date.now();
  if (!force && now - phLastSync < 120000) return Promise.resolve();
  phLastSync = now;
  return caches.open(PHC).then(function (c) {
    return c.keys().then(function (ks) {
      return Promise.all(ks.map(function (req) {
        return fetch(req).then(function (r) { if (r && r.ok) return c.put(req, r); }).catch(function () {});
      }));
    });
  }).catch(function () {});
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') { phRevalidate(false); return; }   /* 打开页面：顺手后台对齐（节流），不阻塞导航本身 */
  var u; try { u = new URL(req.url); } catch (e) { return; }
  if (!phStatic(u)) return;
  ev.respondWith(
    caches.open(PHC).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;   /* cache-first：秒回零网络；更新统一走 phRevalidate，不做逐请求后台拉 */
        return fetch(req).then(function (r) {
          if (r && r.ok) c.put(req, r.clone());
          return r;
        });
      });
    }).catch(function () { return fetch(req); })
  );
});

/* 页面 reload 前的同步对齐：frontUpdate 发 ph-sync，等 ph-synced 再刷（页面侧有 15s 超时兜底，SW 卡死也不会卡住刷新） */
self.addEventListener('message', function (ev) {
  var d = ev.data || {};
  if (d.type === 'ph-sync') {
    phRevalidate(true).then(function () {
      try { if (ev.source) ev.source.postMessage({ type: 'ph-synced' }); } catch (e) {}
    });
  }
});
