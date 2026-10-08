/**
 * 把 eSpeak-NG 的 WASM 数据文件同步到 public/espeak/。
 *
 * 为什么要拷出来：emscripten 模块用 import.meta.url 定位 espeak-ng.data，
 * 但 Vite 打包后这个 URL 指向 /assets/ 下的 chunk，那里没有 .data 文件。
 * 所以我们把它放到固定路径，并在初始化时用 locateFile 指过去。
 *
 * 用法: node scripts/sync-espeak.mjs
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(APP, 'public', 'espeak')

/** 在 pnpm 的 .pnpm 目录里找到这个包（版本号会变，不写死） */
function findPackage() {
  const pnpm = join(APP, 'node_modules', '.pnpm')
  if (!existsSync(pnpm)) return null
  const dir = readdirSync(pnpm).find((d) => d.startsWith('@echogarden+espeak-ng-emscripten@'))
  if (!dir) return null
  return join(pnpm, dir, 'node_modules', '@echogarden', 'espeak-ng-emscripten')
}

const pkg = findPackage()
if (!pkg) {
  console.error('❌ 找不到 @echogarden/espeak-ng-emscripten，请先 pnpm install')
  process.exit(1)
}

mkdirSync(DEST, { recursive: true })
// js 也要拷：让它以「静态文件」身份被加载，内部的 import.meta.url 就指向
// /espeak/ 目录，能自然找到同目录的 espeak-ng.data —— 不依赖 locateFile
// （那个钩子会被 Vite 的打包改写掉）。
const files = ['espeak-ng.js', 'espeak-ng.data', 'COPYING']
let copied = 0
for (const f of files) {
  const src = join(pkg, f)
  if (!existsSync(src)) {
    console.error(`⚠️  缺少 ${f}`)
    continue
  }
  const dst = join(DEST, f)
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue
  copyFileSync(src, dst)
  copied++
}

const data = join(DEST, 'espeak-ng.data')
console.log(`eSpeak 数据已同步：${(statSync(data).size / 1e6).toFixed(1)} MB` +
  (copied ? `（本次复制 ${copied} 个文件）` : '（已是最新）'))
console.log('注意：eSpeak-NG 是 GPL-3.0，随应用分发会把整体置于 GPL-3.0。')
