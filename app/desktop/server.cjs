/** 内置静态服务器（Electron 主进程与自检脚本共用） */
const { createServer } = require('node:http')
const { existsSync, statSync, createReadStream } = require('node:fs')
const { extname, join, normalize, resolve } = require('node:path')

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
}

/**
 * 在 127.0.0.1 的随机端口上托管 rootDir。
 * @returns {Promise<{origin: string, close: () => void}>}
 */
function startServer(rootDir) {
  const ROOT = resolve(rootDir)
  return new Promise((res, rej) => {
    const server = createServer((req, rep) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0])
      if (p === '/') p = '/index.html'
      const target = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''))
      if (!target.startsWith(ROOT) || !existsSync(target) || statSync(target).isDirectory()) {
        rep.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        rep.end('404')
        return
      }
      rep.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'cache-control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
      })
      createReadStream(target).pipe(rep)
    })
    server.on('error', rej)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      res({ origin: `http://127.0.0.1:${port}/`, close: () => server.close() })
    })
  })
}

module.exports = { startServer, MIME }
