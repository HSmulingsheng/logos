/**
 * 一键把本机的应用分享到公网 —— 不需要任何账号。
 *
 *   node scripts/share.mjs [port]
 *
 * 做的事：
 *   1. 若本机服务没起，先起一个（只监听 127.0.0.1，不暴露局域网）
 *   2. 用 cloudflared 快速隧道开一个临时的 https 网址（trycloudflare.com，无需登录）
 *   3. 打印网址 + 二维码
 *
 * 关掉这个窗口，网址就失效了。别人不需要注册，打开即用。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const qrcode = require('qrcode-terminal')

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(APP, '..')
const BIN_DIR = join(ROOT, '.tools', 'bin')
const CF = join(BIN_DIR, 'cloudflared')

const PORT = Number(process.argv[2]) || 4178
const LOCAL = `http://127.0.0.1:${PORT}`

const childProcs = []
const cleanup = () => {
  for (const p of childProcs) { try { p.kill('SIGTERM') } catch { /* 已退出 */ } }
}
process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })

async function portAlive() {
  try {
    const r = await fetch(`${LOCAL}/data/manifest.json`, { signal: AbortSignal.timeout(2500) })
    return r.ok
  } catch { return false }
}

// ---------------------------------------------------------------- 1. 本机服务
if (!(await portAlive())) {
  console.log(`▶ 本机 ${PORT} 端口没有服务，先起一个…`)
  const srv = spawn(process.execPath, [join(APP, 'scripts', 'serve.mjs'), String(PORT), '--local'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  childProcs.push(srv)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await portAlive()) break
  }
  if (!(await portAlive())) {
    console.error('❌ 本机服务没起来，先手动跑一下：node scripts/serve.mjs')
    process.exit(1)
  }
} else {
  console.log(`▶ 本机服务已在 ${LOCAL} 运行`)
}

// ---------------------------------------------------------------- 2. cloudflared
if (!existsSync(CF)) {
  console.error(`
❌ 还没装 cloudflared（Cloudflare 的隧道客户端，免费且无需注册）。

   我已经尝试自动下载过；如果没成功，手动跑这一条（约 20MB，可能有点慢）：

     cd "${ROOT}"
     curl -L -C - --retry 8 -o .tools/cloudflared.tgz \\
       "https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-darwin-arm64.tgz"
     mkdir -p .tools/bin && tar xzf .tools/cloudflared.tgz -C .tools/bin
     chmod +x .tools/bin/cloudflared

   装好后重新执行：node scripts/share.mjs
`)
  process.exit(1)
}
try { chmodSync(CF, 0o755) } catch { /* 忽略 */ }
mkdirSync(BIN_DIR, { recursive: true })

console.log('▶ 正在开一条临时公网隧道（不需要登录）…')
const tunnel = spawn(CF, ['tunnel', '--no-autoupdate', '--url', LOCAL], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
childProcs.push(tunnel)

let printed = false
const onData = (buf) => {
  const text = buf.toString()
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
  if (m && !printed) {
    printed = true
    const url = m[0]
    console.log('')
    console.log('  ═══════════════════════════════════════════')
    console.log('   把这个网址发给别人，打开就能用：')
    console.log('')
    console.log(`     ${url}`)
    console.log('')
    console.log('   对方不需要注册、不需要装任何东西。')
    console.log('  ═══════════════════════════════════════════')
    console.log('')
    qrcode.generate(url, { small: true }, (code) => console.log(code))
    console.log('  手机扫码即可打开；因为走的是 HTTPS，还能「添加到主屏幕」离线用。')
    console.log('')
    console.log('  注意：')
    console.log('   · 关掉这个窗口，网址就失效了')
    console.log('   · 网址是随机生成的，但**不等于保密**，别往外公开贴')
    console.log('   · 用的人越多、看的人越多，流量都走你这台电脑')
  }
  if (/ERR |failed to|error/i.test(text) && !printed) process.stderr.write(text)
}
tunnel.stdout.on('data', onData)
tunnel.stderr.on('data', onData)   // cloudflared 把横幅打在 stderr

tunnel.on('exit', (code) => {
  if (!printed) {
    console.error(`\n❌ 隧道启动失败（退出码 ${code}）`)
    console.error('   检查网络是否能访问 cloudflare.com，或稍后重试。')
  } else {
    console.log('\n隧道已关闭。')
  }
  cleanup()
  process.exit(code ?? 0)
})

setTimeout(() => {
  if (!printed) console.log('  （还在等隧道地址，通常 5–20 秒…）')
}, 8000)
