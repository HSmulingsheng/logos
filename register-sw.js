/* 由 build-sw.mjs 生成 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;
  // 桌面版（Electron）由进程内服务器提供文件，离线缓存没有意义，
  // 且 Chromium 的 CacheStorage 在 Electron 里曾触发 Mojo 校验崩溃 —— 直接跳过。
  if (navigator.userAgent.indexOf('Electron') !== -1) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
  });
})();
