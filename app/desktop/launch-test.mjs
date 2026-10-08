/**
 * 启动自检：验证打包出来的 .app 真的能跑起来。
 *   1. 检查 bundle 结构（可执行文件、Info.plist、内嵌 dist、图标）
 *   2. 启动里面的 Electron 二进制，等待主进程打印 [ready]，确认渲染进程加载完成
 *   3. 关闭进程
 *
 * 用法: node desktop/launch-test.mjs [appPath]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = process.argv[2] || join(APP_DIR, 'release', '逻各斯.app')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

const BIN = join(APP, 'Contents/MacOS/Electron')
const PLIST = join(APP, 'Contents/Info.plist')
const RES_APP = join(APP, 'Contents/Resources/app')

check('.app 存在', existsSync(APP), APP)
check('可执行文件存在', existsSync(BIN))
check('Info.plist 存在', existsSync(PLIST))
check('内嵌 dist/index.html', existsSync(join(RES_APP, 'dist/index.html')))
check('内嵌主进程', existsSync(join(RES_APP, 'desktop/main.cjs')))
check('内嵌静态服务器模块', existsSync(join(RES_APP, 'desktop/server.cjs')))
check('应用图标', existsSync(join(APP, 'Contents/Resources/icon.icns')))
const assets = existsSync(join(RES_APP, 'dist/assets'))
  ? readdirSync(join(RES_APP, 'dist/assets')) : []
check('前端资源已打包', assets.some((f) => f.endsWith('.js')) && assets.some((f) => f.endsWith('.css')), assets.join(', '))
check('音频目录已打包', existsSync(join(RES_APP, 'dist/audio')))

// ---- 真正启动
// 先清掉可能残留的实例：Electron 的单实例锁会让新进程直接退出
spawnSync('pkill', ['-f', `${APP}/Contents/MacOS/Electron`], { encoding: 'utf8' })
console.log('\n▶ 启动打包后的应用…')
const child = spawn(BIN, ['--no-sandbox', '--disable-gpu', `--user-data-dir=${join(APP_DIR, '.electron-userdata')}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
})

let out = ''
let ready = false
const timer = setTimeout(() => {
  if (!ready) {
    console.log('   （10 秒内未看到 [ready]，输出如下）')
    console.log(out.split('\n').filter(Boolean).slice(-8).join('\n'))
    child.kill('SIGKILL')
  }
}, 25000)

child.stdout.on('data', (d) => {
  out += d.toString()
  if (!ready && out.includes('[ready]')) {
    ready = true
    const origin = out.match(/\[ready\] (\S+)/)?.[1] ?? ''
    check('应用启动并完成页面加载', true, origin)
    setTimeout(() => child.kill('SIGTERM'), 800)
  }
})
child.stderr.on('data', (d) => { out += d.toString() })

await new Promise((res) => child.on('exit', res))
clearTimeout(timer)
if (!ready) check('应用启动并完成页面加载', false, '未打印 [ready]')

const fatal = out.split('\n').filter((l) => /Cannot find module|ERR_DLOPEN|UnhandledPromiseRejection|Failed to load/i.test(l))
check('无致命错误', fatal.length === 0, fatal.slice(0, 2).join(' | '))

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `全部 ${results.length} 项通过` : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
process.exit(failed.length === 0 ? 0 : 1)
