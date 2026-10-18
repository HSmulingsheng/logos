/**
 * 重新生成全部单词发音 —— 走**与句子完全相同**的管线。
 *
 * 为什么要重做
 * ------------
 * 旧的一批单词音频是离线单独生成的，当时只有「eSpeak 出 WAV → afconvert 转 m4a」，
 * **没有**应用里后来加的韵律与音值修正，所以同一个词，单词发音比句子差一截：
 *
 *   词        旧单词音频        句子（新管线）
 *   φωνή     f_ɔːn_ˈɛː_       p_h_ɔːn_ˈɛː_
 *   θυμιάω   θ_ˌymi_ˈaɔː_     t_h_ˌymi_ˈaɔː_
 *   χείρ     x_ˈeːr_          k_h_ˈeːr_
 *
 * 三处缺失：① φ θ χ 仍读擦音（28.2% 的词受影响）② 完全没有音高重音
 * ③ ᾱ/ῑ/ῡ 长音没补。另外编码只有 ~29 kbps，而句子是未压缩 WAV。
 *
 * 做法
 * ----
 * 这个脚本**直接 import 应用里的 prosody.ts / psola.ts**，
 * 所以单词与句子走的是同一份代码，不会再次跑偏。
 * 用 esbuild 打包后运行（见同目录的 gen_word_audio_prosody.sh）。
 *
 * 用法：
 *   node tools/gen_word_audio_prosody.mjs            # 全量
 *   node tools/gen_word_audio_prosody.mjs --limit 30 # 试跑
 *   node tools/gen_word_audio_prosody.mjs --report   # 只统计不写文件
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { planAccent, restoreAncientPhonetics } from '../app/src/lib/prosody'
import { pitchMarks, pitchTrack, tdPsola } from '../app/src/lib/psola'
import { applyProsody as applyProsodyShared } from '../app/src/lib/prosodyPipeline'

// 打包后 import.meta.url 指向打包产物所在的目录（可能在 /tmp），
// 所以不能只靠它推根目录：优先认「当前目录下有没有 data/greek.json」。
const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [process.cwd(), join(HERE, '..'), join(HERE, '../..')]
const ROOT = CANDIDATES.find((d) => existsSync(join(d, 'data/greek.json'))) ?? process.cwd()
const OUT = join(ROOT, 'app/public/audio-tts')
const TMP = '/tmp/gwa-prosody'

/** 与句子一致：应用里 speakText 用的就是 eSpeak 默认语速 168 */
const SPEAK_RATE = 168
/** 编码码率。旧的约 29 kbps，这里提到 48 —— 单词是单字发音，清晰度优先 */
const BITRATE = 48000

const argv = process.argv.slice(2)
const LIMIT = Number(argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0)
const REPORT = argv.includes('--report')

mkdirSync(TMP, { recursive: true })
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- 数据
const greek = JSON.parse(readFileSync(join(ROOT, 'data/greek.json'), 'utf8'))
const index = JSON.parse(readFileSync(join(ROOT, 'data/tts-index.json'), 'utf8'))
const textOf = new Map(greek.map((r) => [String(r.id), (r._raw || {}).Greek || '']))

// ---------------------------------------------------------------- eSpeak
const Mod = (await import(join(ROOT, 'app/public/espeak/espeak-ng.js'))).default
const M = await (typeof Mod === 'function' ? Mod() : Mod)
const worker = new M.eSpeakNGWorker()
const SR = worker.get_samplerate()
worker.set_rate(SPEAK_RATE)
worker.set_range(60)
worker.set_pitch(50)
worker.set_voice('grc')
console.log(`eSpeak grc 就绪 · ${SR}Hz · 语速 ${SPEAK_RATE} · 编码 ${BITRATE / 1000}kbps`)

/** 合成并同时取回 PCM 与事件（事件里带每个音素的起止毫秒） */
function synth(text) {
  const parts = []
  const events = []
  worker.synthesize(text, (d, e) => {
    if (d && d.length) parts.push(d)
    if (e) events.push(...(Array.isArray(e) ? e : [e]))
    return false
  })
  let n = 0
  for (const p of parts) n += p.length
  const i16 = new Int16Array(n)
  let off = 0
  for (const p of parts) { i16.set(p, off); off += p.length }
  return { pcm: i16, events }
}

function writeWav(pcm, path) {
  const n = pcm.length
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(pcm[i], 44 + i * 2)
  writeFileSync(path, b)
}

/** 与 tts.ts 的 applyProsody 同一套逻辑（保持一致，勿各自演化） */

// ---------------------------------------------------------------- 主循环
let targets = Object.entries(index).filter(([id]) => {
  const w = textOf.get(id)
  return w && /[\u0370-\u03ff\u1f00-\u1fff]/.test(w)
})
if (LIMIT) targets = targets.slice(0, LIMIT)

console.log(`待生成 ${targets.length} 个词条${REPORT ? '（--report，不写文件）' : ''}`)
let ok = 0, skipped = 0, failed = 0, restored = 0
const durations = []
const t0 = Date.now()

for (let n = 0; n < targets.length; n++) {
  const [id, fname] = targets[n]
  // 词条里 `ἐπί [+acc]` 这类方括号是语法注解，不是词的一部分
  const raw = textOf.get(id).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  if (!raw) { skipped++; continue }
  // 与句子完全一致：先做古音还原，再合成；事件与文本必须同源
  const speak = restoreAncientPhonetics(raw)
  if (speak !== raw) restored++
  try {
    const { pcm, events } = synth(speak)
    if (pcm.length < SR * 0.05) { skipped++; continue }
    const shaped = applyProsodyShared(pcm, SR, events, speak, { amp: 1 })
    durations.push(shaped.length / SR)
    if (!REPORT) {
      const wav = join(TMP, 'a.wav')
      writeWav(shaped, wav)
      execFileSync('afconvert',
        ['-f', 'm4af', '-d', 'aac@22050', '-b', String(BITRATE), wav, join(OUT, fname)],
        { stdio: 'ignore' })
    }
    ok++
  } catch (e) {
    failed++
    if (failed <= 5) console.error(`  ⚠️ ${raw} 失败: ${String(e).slice(0, 70)}`)
  }
  if ((n + 1) % 500 === 0 || n === targets.length - 1) {
    const rate = (n + 1) / ((Date.now() - t0) / 1000)
    const left = (targets.length - n - 1) / rate / 60
    console.log(`  ${n + 1}/${targets.length}  成功 ${ok} 跳过 ${skipped} 失败 ${failed}`
      + `  ${rate.toFixed(1)} 词/秒  剩余 ${left.toFixed(1)} 分钟`)
  }
}

try { rmSync(TMP, { recursive: true, force: true }) } catch { /* 忽略 */ }
if (durations.length) {
  const s = [...durations].sort((a, b) => a - b)
  console.log(`\n发声时长：中位 ${s[s.length >> 1].toFixed(2)}s · 最短 ${s[0].toFixed(2)}s · 最长 ${s[s.length - 1].toFixed(2)}s`)
}
console.log(`完成：成功 ${ok} · 跳过 ${skipped} · 失败 ${failed}`)
console.log(`其中经过古音还原（含 φθχ/ζ）的：${restored} 个（${(restored / Math.max(ok, 1) * 100).toFixed(1)}%）`)
