#!/usr/bin/env node
/**
 * 跑完整的测试套件。
 *
 * ## 为什么需要它
 *
 * 项目里有 16 个测试文件，但没有统一入口。结果是**每次只跑自己记得的那几个**——
 * 复盘时发现有 6 个（`input` / `reading` / `sentence-audio` / `offline` /
 * `neural` / `smoke`）已经很久没人跑过了。它们本身是好的，只是没人记得。
 *
 * 这个脚本按「快 → 慢」顺序跑全部，任一失败就汇总报出来，退出码非零。
 *
 * ## 用法
 *
 *     node scripts/test-all.mjs                          # 默认打 http://127.0.0.1:4178/
 *     node scripts/test-all.mjs http://127.0.0.1:4179/   # 打部署包
 *     node scripts/test-all.mjs --only detail,browse     # 只跑指定的
 *     node scripts/test-all.mjs --skip neural            # 跳过指定的
 *
 * ⚠️ 需要先起一个静态服务（`node scripts/serve.mjs [port] --local [--root ../deploy]`）。
 * ⚠️ **不要用 `timeout` 包这些命令**：macOS 不自带 coreutils 的 `timeout`，
 *    会静默失败成"命令找不到"，看起来像测试没输出。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** 按耗时从短到长排，先跑快的能更早发现问题 */
const SUITES = [
  { name: 'font',          file: 'font-test.mjs',          slow: 1 },
  { name: 'ipa',           file: 'ipa-test.mjs',           slow: 1 },
  { name: 'input',         file: 'input-test.mjs',         slow: 1 },
  { name: 'browse',        file: 'browse-test.mjs',        slow: 2 },
  { name: 'detail',        file: 'detail-test.mjs',        slow: 2 },
  { name: 'home',          file: 'home-test.mjs',          slow: 2 },
  { name: 'reading',       file: 'reading-test.mjs',       slow: 2 },
  { name: 'ai-translate',  file: 'ai-translate-test.mjs',  slow: 2 },
  { name: 'audio',         file: 'audio-test.mjs',         slow: 2 },
  { name: 'offline',       file: 'offline-test.mjs',       slow: 3 },
  { name: 'sentence',      file: 'sentence-test.mjs',      slow: 3 },
  { name: 'sentence-audio', file: 'sentence-audio-test.mjs', slow: 3 },
  { name: 'phonetic',      file: 'phonetic-test.mjs',      slow: 3 },
  { name: 'prosody',       file: 'prosody-test.mjs',       slow: 3 },
  { name: 'neural',        file: 'neural-test.mjs',        slow: 4 },
  { name: 'smoke',         file: 'smoke.mjs',              slow: 5 },
]

const args = process.argv.slice(2)
let url = 'http://127.0.0.1:4178/'
let only = null
let skip = new Set()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only') only = new Set(args[++i].split(',').map((s) => s.trim()))
  else if (args[i] === '--skip') for (const s of args[++i].split(',')) skip.add(s.trim())
  else if (!args[i].startsWith('--')) url = args[i]
}

/** 每条测试输出一句「全部 N 项通过」或「M/N 项失败」，抓这一行 */
function summaryOf(out) {
  const lines = out.split('\n').filter((l) => /项通过|项失败|项可播放/.test(l))
  return lines.length ? lines[lines.length - 1].trim() : ''
}

function run(file, outDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, file), url, outDir], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => resolve({ code, out }))
  })
}

const picked = SUITES.filter((s) => (!only || only.has(s.name)) && !skip.has(s.name))
console.log(`目标 ${url}`)
console.log(`将跑 ${picked.length} 个套件:${picked.map((s) => ' ' + s.name).join('')}\n`)

const results = []
const t0 = Date.now()
for (const s of picked) {
  const outDir = mkdtempSync(join(tmpdir(), `greek-${s.name}-`))
  const t = Date.now()
  const { code, out } = await run(s.file, outDir)
  const ms = Date.now() - t
  const sum = summaryOf(out)
  const ok = code === 0 && !!sum && !/项失败/.test(sum)
  results.push({ name: s.name, ok, sum: sum || `退出码 ${code}`, ms })
  console.log(`  ${ok ? '✅' : '❌'} ${s.name.padEnd(14)} ${String(ms).padStart(6)}ms  ${sum || `退出码 ${code}`}`)
}

const bad = results.filter((r) => !r.ok)
const totalMs = Date.now() - t0
console.log(`\n=== 汇总 ===`)
console.log(`  ${results.length - bad.length}/${results.length} 个套件通过 · 总耗时 ${(totalMs / 1000).toFixed(0)}s`)
if (bad.length) {
  console.log(`  失败: ${bad.map((b) => b.name).join(', ')}`)
  process.exit(1)
}
