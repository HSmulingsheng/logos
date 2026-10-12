/* 古希腊语 · 不背单词 —— Service Worker
 * 策略：
 *   - 应用外壳（index.html / assets / fonts / 元数据 / 前几课词表）安装时预缓存
 *   - data/ audio/ 等大文件按需缓存（cache-first），离线后仍可访问
 *   - 导航请求 network-first，保证更新能落地；离线时回退缓存的 index.html
 * 构建脚本 build-sw.mjs 会把下面的 BUILD 常量替换成构建时间戳，从而使本文件内容变化、
 * 触发浏览器安装新的 SW 并重建缓存。
 */
const BUILD = '20261012071600'
const CACHE = `greek-vocab-${BUILD}`
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(CORE).catch(() => {})
    // 预缓存清单由构建脚本生成；失败不阻塞安装
    try {
      const res = await fetch('./precache-manifest.json', { cache: 'no-cache' })
      if (res.ok) {
        const { files } = await res.json()
        await Promise.all((files || []).map((f) => cache.add(f).catch(() => {})))
      }
    } catch { /* 离线安装，跳过 */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('greek-vocab-') && k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

const CACHE_FIRST = /\.(?:js|css|ttf|woff2?|png|jpe?g|webp|svg|mp3|m4a|aac|3gp|json|data|wasm)$/i
/** 体积大且内容不变的资源：只读取缓存，不做后台刷新（否则每次打开都要重下上百 MB） */
const IMMUTABLE = /\/(?:espeak|ort|mms-grc)\/.*\.(?:data|js|mjs|wasm|onnx|json|part-\d+)$/i

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return  // 外链（Logeion / BibleHub）不拦

  // 导航：network-first，离线回退 index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req)
        const cache = await caches.open(CACHE)
        cache.put('./index.html', fresh.clone())
        return fresh
      } catch {
        const cache = await caches.open(CACHE)
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error()
      }
    })())
    return
  }

  // eSpeak 引擎是 24MB 的不可变资源：命中缓存就直接用，不做后台刷新，
  // 否则每次打开都会重新下载 24MB。
  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      try {
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      } catch {
        return new Response('', { status: 504, statusText: 'offline' })
      }
    })())
    return
  }

  if (!CACHE_FIRST.test(url.pathname)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(req)
    if (hit) {
      // 后台静默更新，下次生效
      fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()) }).catch(() => {})
      return hit
    }
    try {
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    } catch (e) {
      return new Response('', { status: 504, statusText: 'offline' })
    }
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting()
})
