/* 管家：PWA 方案已下线（改为 Windows / Android 安装包）。
   此文件保留为“自毁脚本”：已装过旧版 PWA 的浏览器会照常请求它，
   这里主动清空缓存、注销自身，避免旧外壳继续返回过期的 app.js / styles.css。 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (e) { /* 忽略 */ }
    try { await self.registration.unregister(); } catch (e) { /* 忽略 */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function (c) { if (c.navigate) c.navigate(c.url); });
    } catch (e) { /* 忽略 */ }
  })());
});

/* 不拦截任何请求，一律走网络 */
self.addEventListener('fetch', function () { /* no-op */ });
