/**
 * 用 eSpeak-NG 的 grc（古希腊语）语音生成单词发音。
 *
 * 为什么不用神经模型（facebook/mms-tts-grc）
 * ----------------------------------------
 * 做了共振峰实测，结论明确：**MMS 用的是现代希腊语发音**，与界面显示的
 * 阿提卡重建 IPA 对不上。同一引擎内部的对比度最能说明问题：
 *
 *   词对          eSpeak（F2 差）        MMS（F2 差）
 *   σύ/τί  υ vs ι   1797 / 2242 → 445Hz ✅   1975 / 1939 → 36Hz ❌
 *   μή/τί  η vs ι   F1 688 / 290 → 398Hz ✅  F1 365 / 311 → 54Hz ❌
 *
 * 也就是说 MMS 把 υ、η 一律念成 [i]（现代五元音体系），
 * 而界面标的是 [y]、[ɛː]。**显示的音标与实际发音不一致**，对学习工具是硬伤。
 * eSpeak 的 grc 语音则实现了重建的元音系统，音色虽是合成音但音值正确。
 *
 * 做法：直接在 Node 里驱动项目已内置的 eSpeak WASM（无需联网），
 * 合成后写成 WAV，再用 macOS 自带的 afconvert 转成与原文件一致的 m4a。
 *
 * 用法：
 *   node tools/gen_word_audio_espeak.mjs            # 全量
 *   node tools/gen_word_audio_espeak.mjs --limit 20 # 试跑
 *   node tools/gen_word_audio_espeak.mjs --report   # 只统计不写文件
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'app/public/audio-tts')
const TMP = '/tmp/gwa-espeak'
const SPEAK_RATE = 158          // 略慢于应用默认 168，单词语速更从容

const argv = process.argv.slice(2)
const LIMIT = Number(argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0)
const REPORT = argv.includes('--report')

mkdirSync(TMP, { recursive: true })
mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- 载入数据
const greek = JSON.parse(readFileSync(join(ROOT, 'data/greek.json'), 'utf8'))
const index = JSON.parse(readFileSync(join(ROOT, 'data/tts-index.json'), 'utf8'))
const textOf = new Map(greek.map((r) => [String(r.id), (r._raw || {}).Greek || '']))

// ---------------------------------------------------------------- 载入 eSpeak
const Mod = (await import(join(ROOT, 'app/public/espeak/espeak-ng.js'))).default
const M = await (typeof Mod === 'function' ? Mod() : Mod)
const worker = new M.eSpeakNGWorker()
const SR = worker.get_samplerate()
worker.set_rate(SPEAK_RATE)
worker.set_range(60)
worker.set_pitch(50)
worker.set_voice('grc')
console.log(`eSpeak grc 就绪 · 采样率 ${SR} · 语速 ${SPEAK_RATE}`)

/** 把 Int16Array 写成 16-bit 单声道 WAV */
function writeWav(pcm, path) {
  const buf = Buffer.alloc(44 + pcm.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2)
  writeFileSync(path, buf)
}

// ---------------------------------------------------------------- 主循环
let targets = Object.entries(index).filter(([id]) => {
  const w = textOf.get(id)
  return w && /[\u0370-\u03ff\u1f00-\u1fff]/.test(w)
})
if (LIMIT) targets = targets.slice(0, LIMIT)

console.log(`待生成 ${targets.length} 个词条${REPORT ? '（--report，不写文件）' : ''}`)
let ok = 0, skipped = 0, failed = 0
const durations = []
const t0 = Date.now()

for (let n = 0; n < targets.length; n++) {
  const [id, fname] = targets[n]
  // 词条里 `ἐπί [+acc]` 这类方括号是语法标注，不是词的一部分
  const word = textOf.get(id).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  if (!word) { skipped++; continue }
  try {
    const chunks = []
    worker.synthesize(word, (data) => { chunks.push(data); return false })
    let len = 0
    for (const c of chunks) len += c.length
    if (len < SR * 0.05) { skipped++; continue }
    const pcm = new Int16Array(len)
    let off = 0
    for (const c of chunks) { pcm.set(c, off); off += c.length }
    durations.push(len / SR)
    if (!REPORT) {
      const wav = join(TMP, 'a.wav')
      writeWav(pcm, wav)
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac@22050', '-b', '32000', wav, join(OUT, fname)],
        { stdio: 'ignore' })
    }
    ok++
  } catch (e) {
    failed++
    if (failed <= 5) console.error(`  ⚠️ ${word} 失败: ${e.message.slice(0, 70)}`)
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
  const med = s[Math.floor(s.length / 2)]
  console.log(`\n发声时长：中位 ${med.toFixed(2)}s · 最短 ${s[0].toFixed(2)}s · 最长 ${s[s.length - 1].toFixed(2)}s`)
}
console.log(`完成：成功 ${ok} · 跳过 ${skipped} · 失败 ${failed}`)
