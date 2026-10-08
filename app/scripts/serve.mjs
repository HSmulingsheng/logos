/**
 * 极简静态服务器：托管已构建的 dist/，不依赖 vite / rollup。
 *
 * 默认监听 0.0.0.0，这样同一局域网里的手机 / 平板也能打开；
 * 终端会打印本机地址、局域网地址，以及一个可直接扫码的二维码。
 *
 * 用法: node scripts/serve.mjs [port] [--open] [--local] [--host 192.168.x.x]
 *   --local   只监听 127.0.0.1（不暴露到局域网）
 */
import { createServer } from 'node:http'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { extname, join, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const qrcode = require('qrcode-terminal')

// --root 可指定要托管的目录（默认 dist/，验证部署包时用得上）
const rootIdx = process.argv.indexOf('--root')
const ROOT = rootIdx >= 0 && process.argv[rootIdx + 1]
  ? resolve(process.argv[rootIdx + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

// ---- 参数
const argv = process.argv.slice(2)
const portArg = argv.find((a) => /^\d+$/.test(a))
const PORT = Number(portArg) || 4178
const OPEN = argv.includes('--open')
const LOCAL_ONLY = argv.includes('--local')
const hostIdx = argv.indexOf('--host')
const HOST = hostIdx >= 0 && argv[hostIdx + 1] ? argv[hostIdx + 1] : (LOCAL_ONLY ? '127.0.0.1' : '0.0.0.0')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.3gp': 'audio/3gpp',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

if (!existsSync(ROOT)) {
  console.error(`找不到构建产物 ${ROOT}\n请先运行: node node_modules/vite/bin/vite.js build`)
  process.exit(1)
}

/** 取所有非回环的 IPv4 地址（手机要连的就是它） */
function lanAddresses() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

const server = createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  const target = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''))
  if (!target.startsWith(ROOT) || !existsSync(target) || statSync(target).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 ' + p)
    return
  }
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': type,
    'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
  })
  createReadStream(target).pipe(res)
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换一个端口，例如：node scripts/serve.mjs ${PORT + 1}`)
  } else {
    console.error('启动失败：', e.message)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  const localUrl = `http://127.0.0.1:${PORT}/`
  const lans = lanAddresses()

  console.log('')
  console.log('  逻各斯')
  console.log('  ─────────────────────────────')
  console.log(`  本机：    ${localUrl}`)

  if (!LOCAL_ONLY && lans.length) {
    console.log('')
    console.log('  同一 Wi-Fi 下的手机 / 平板可以打开：')
    for (const ip of lans) console.log(`    http://${ip}:${PORT}/`)
    console.log('')
    console.log('  扫码直达（手机相机扫一下）：')
    qrcode.generate(`http://${lans[0]}:${PORT}/`, { small: true }, (code) => console.log(code))
    console.log('  提示：macOS 若弹出「是否允许接受传入网络连接」，选「允许」。')
    console.log('  第一次打开会慢一些（要下载音频），之后走浏览器缓存。')
    console.log('')
    console.log('  注意：局域网内任何人都能访问这个页面（只读；学习进度存在各自设备的浏览器里）。')
    console.log('        不想暴露就加 --local 参数。')
  } else if (LOCAL_ONLY) {
    console.log('  （--local 模式：仅本机可访问）')
  } else {
    console.log('  未检测到局域网地址，其他设备暂时无法访问。')
  }
  console.log('')
  console.log('  按 Ctrl+C 停止')
  console.log('')

  if (OPEN) execFile('open', [localUrl], () => {})
})
