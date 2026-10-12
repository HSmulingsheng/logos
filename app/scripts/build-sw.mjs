/**
 * 构建后处理：
 *   1. 生成 dist/precache-manifest.json（应用外壳 + 字体 + 元数据 + 前 6 课词表）
 *   2. 把 dist/sw.js 里的 __BUILD__ 替换成时间戳
 *   3. 往 dist/index.html 注入 service worker 注册脚本
 *
 * 用法: node scripts/build-sw.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(APP, 'dist')

if (!existsSync(DIST)) {
  console.error('找不到 dist/，请先运行 vite build')
  process.exit(1)
}

const list = (dir, filter) =>
  readdirSync(dir)
    .filter(filter ?? (() => true))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())

const files = []

// 构建产物（带哈希）
for (const f of list(join(DIST, 'assets'))) files.push('./assets/' + f.split('/').pop())
// 字体：离线时也要能正确渲染 polytonic 希腊语
for (const f of list(join(DIST, 'fonts'))) files.push('./fonts/' + f.split('/').pop())
// 元数据与检索索引
for (const name of ['data/manifest.json', 'data/index.json', 'data/formindex.json', 'data/affix.json', 'data/grammar.json', 'data/smyth.json']) {
  if (existsSync(join(DIST, name))) files.push('./' + name)
}
// 前 6 课词表（A2/B1 起步阶段，离线即可学）
for (let i = 1; i <= 6; i++) {
  const name = `data/lesson-${String(i).padStart(2, '0')}.json`
  if (existsSync(join(DIST, name))) files.push('./' + name)
}
// 新约第一卷，方便离线开始阅读
if (existsSync(join(DIST, 'data/corpus/nt-01.json'))) files.push('./data/corpus/nt-01.json')

// 独立的 SW 注册脚本（写成文件而不是内联，否则会被 script-src 'self' 拦下）
// 必须在写预缓存清单之前生成，否则它自己不在清单里，离线重载会 504
const REGISTER_JS = `/* 由 build-sw.mjs 生成 */
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
`
writeFileSync(join(DIST, 'register-sw.js'), REGISTER_JS)
files.push('./register-sw.js')

const version = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)

writeFileSync(
  join(DIST, 'precache-manifest.json'),
  JSON.stringify({ version, files }, null, 0),
)

// 替换 SW 里的构建标记
const swPath = join(DIST, 'sw.js')
let sw = readFileSync(swPath, 'utf8')
const before = (sw.match(/__BUILD__/g) || []).length
sw = sw.replaceAll('__BUILD__', version)
writeFileSync(swPath, sw)
if (before === 0) {
  console.warn('⚠️ dist/sw.js 中没有占位符，缓存名不会随构建更新')
} else if (sw.includes('__BUILD__')) {
  console.error('❌ 仍有未替换的占位符')
  process.exit(1)
}

// 注入 CSP 与 SW 注册脚本
const htmlPath = join(DIST, 'index.html')
let html = readFileSync(htmlPath, 'utf8')

  // 全部资源都是同源的；外链词典在系统浏览器里打开。
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' 是 WebAssembly 编译所必需的：只写 'self' 会把
  // WebAssembly.instantiate 拦掉，神经语音（onnxruntime-web）就无法加载。
  // 注意它只放行 WASM，不等于放行 eval。
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
    // 「AI 翻译（自带 Key）」要让浏览器**直接**访问服务商接口——
    // 这是纯静态站，没有后端能中转。所以这里放行外部 https。
    //
    // 权衡：比 'self' 宽松，但脚本仍受 script-src 'self' 约束、
    // 表单被 form-action 'none' 锁死，XSS 面很小；而 connect-src 服务于
    // **用户自己**指定的端点，写成白名单会让「自定义服务商」直接不可用。
    // 实测支持浏览器直连（CORS）：api.deepseek.com / open.bigmodel.cn /
    // dashscope.aliyuncs.com。
    "connect-src 'self' https:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')
if (!html.includes('Content-Security-Policy')) {
  html = html.replace('<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
}
const snippet = '<script src="./register-sw.js" defer></script>'
if (!html.includes('register-sw.js')) {
  html = html.replace('</body>', '  ' + snippet + '\n  </body>')
}
writeFileSync(htmlPath, html)   // CSP 与 SW 注册脚本都要落盘（幂等，可重复运行）

const bytes = files.reduce((a, f) => a + statSync(join(DIST, f.slice(2))).size, 0)
console.log(`PWA 构建完成  version=${version}`)
console.log(`  预缓存 ${files.length} 个文件，共 ${(bytes / 1e6).toFixed(1)} MB`)
console.log(`  含: assets/* · fonts/* · register-sw.js · data 元数据 · lesson-01~06 · corpus/nt-01`)
