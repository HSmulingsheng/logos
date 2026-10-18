#!/usr/bin/env node
/**
 * 桌面版端到端验收：启动打包好的 `.app`，确认它真的把应用跑起来了。
 *
 * ## 为什么不用 desktop/selftest.cjs
 *
 * `selftest.cjs` 是直接执行 Electron 二进制（`Electron selftest.cjs`）。
 * 在这台机器上它会 **SIGTRAP 崩在 Electron Framework 的 V8 内部**：
 *
 *     EXC_BREAKPOINT / SIGTRAP
 *     Electron Framework  node::sea::SeaResource::use_code_cache()
 *     Electron Framework  v8::Isolate::RequestInterrupt(...)
 *
 * 这是**继承的 shell 环境**导致的（DSH 运行时会给子进程设 `ELECTRON_RUN_AS_NODE=1`
 * 等变量），不是应用的问题——同一个 `.app` 用 `open` 启动就完全正常。
 *
 * `open` 走 launchd，环境是干净的，也更接近用户双击图标的真实路径。
 * 所以这里改用 `open`，然后用**副作用**判断成功：应用初始化过 IndexedDB、
 * 写过窗口状态，就说明渲染进程真的跑起来了。
 *
 * ## 用法
 *
 *     node desktop/verify-app.mjs
 *     node desktop/verify-app.mjs --keep     # 验完不退出，方便自己点两下
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(APP, 'release', '逻各斯.app')
const NAME = '逻各斯'
const USER_DATA = join(homedir(), 'Library', 'Application Support', NAME)
const keep = process.argv.includes('--keep')

let pass = 0, fail = 0
const check = (n, ok, d = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function pids() {
  const r = spawnSync('pgrep', ['-f', `${BUNDLE}/Contents/MacOS/Electron`], { encoding: 'utf8' })
  return (r.stdout || '').split('\n').filter(Boolean).map(Number)
}

function quit() {
  for (const p of pids()) { try { process.kill(p, 'SIGTERM') } catch { /* 已退出 */ } }
}

// ── 1. 包本身
console.log('▶ 包结构')
check('存在 release/逻各斯.app', existsSync(BUNDLE), BUNDLE)
const bin = join(BUNDLE, 'Contents/MacOS/Electron')
check('可执行文件存在', existsSync(bin))
const resApp = join(BUNDLE, 'Contents/Resources/app')
check('Resources/app 已打包', existsSync(resApp))
check('前端 dist 已打进包', existsSync(join(resApp, 'dist/index.html')))
const sig = spawnSync('codesign', ['-dv', BUNDLE], { encoding: 'utf8' })
check('已签名（adhoc 即可）', /Signature=adhoc|Authority=/.test((sig.stderr || '') + (sig.stdout || '')))

// ── 2. 启动
console.log('\n▶ 启动')
quit()
await sleep(1500)
// 清掉旧的库目录，这样"有没有建库"才是本次启动的证据
try { rmSync(join(USER_DATA, 'IndexedDB'), { recursive: true, force: true }) } catch { /* 可能不存在 */ }
const opened = spawnSync('open', [BUNDLE], { encoding: 'utf8' })
check('open 返回成功', opened.status === 0, (opened.stderr || '').trim() || `exit ${opened.status}`)

let alive = false
for (let i = 0; i < 30; i++) {
  await sleep(500)
  if (pids().length) { alive = true; break }
}
check('Electron 主进程存活', alive, alive ? `${pids().length} 个进程` : '10 秒内未起来')

// ── 3. 渲染进程真的跑起来了（看副作用）
console.log('\n▶ 应用是否真的初始化')
let idb = null
for (let i = 0; i < 40; i++) {
  await sleep(500)
  const dir = join(USER_DATA, 'IndexedDB')
  if (existsSync(dir)) {
    const libs = readdirSync(dir).filter((n) => n.endsWith('.leveldb'))
    if (libs.length) { idb = libs; break }
  }
}
check('IndexedDB 已建立（说明应用 JS 跑起来了）', !!idb,
  idb ? idb.join(', ') : '40 次轮询内未出现 —— 可能停在加载/错误页')

const ls = join(USER_DATA, 'Local Storage')
check('Local Storage 已建立', existsSync(ls))

// 窗口状态是应用退出/移动窗口时写的，启动后不一定立刻有；只做提示不算失败
const ws = join(USER_DATA, 'window-state.json')
console.log(`${existsSync(ws) ? 'ℹ️ ' : 'ℹ️ '} window-state.json ${existsSync(ws) ? '存在' : '尚未写出（正常，退出时才写）'}`)

// 崩溃日志
const diag = join(homedir(), 'Library', 'Logs', 'DiagnosticReports')
let crashes = 0
try {
  crashes = readdirSync(diag).filter((n) => n.startsWith(NAME) && statSync(join(diag, n)).mtimeMs > Date.now() - 120_000).length
} catch { /* 目录可能不存在 */ }
check('本次启动没有产生崩溃报告', crashes === 0, crashes ? `${crashes} 个` : '')

// ── 4. 收尾
if (!keep) {
  // 退出要等：Electron 收到 SIGTERM 后要先关窗口、落盘窗口状态，1 秒不够。
  quit()
  let gone = false
  for (let i = 0; i < 24; i++) {          // 最多等 12 秒
    await sleep(500)
    if (pids().length === 0) { gone = true; break }
  }
  if (!gone) { for (const p of pids()) { try { process.kill(p, 'SIGKILL') } catch { /* 已退 */ } } }
  check('可正常退出', gone, gone ? '' : '12 秒内未退出，已强制结束')
}
else console.log('\n（--keep：应用保持运行）')

console.log('\n=== 结果 ===')
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
