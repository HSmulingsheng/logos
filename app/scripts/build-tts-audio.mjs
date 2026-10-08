/**
 * 用 eSpeak-NG（WASM，语音 grk/grc = 古希腊语）为缺发音的词条批量生成音频。
 *
 * 关键坑：eSpeak 的回调约定是「返回 0 继续、1 中止」，而这个 JS 包装写成
 * `userCallback(...) ? 1 : 0` —— 所以回调必须返回 **false** 才会拿到完整音频，
 * 返回 true 只会得到前 100ms。
 *
 * 产出: public/audio-tts/<noteId>.m4a  +  data/tts-index.json
 * 用法: node scripts/build-tts-audio.mjs [--limit N] [--force] [--all] [--rate 120]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(APP, '..')
const OUT_DIR = join(APP, 'public', 'audio-tts')
const TMP_DIR = join(APP, '.tts-tmp')
const DATA = join(ROOT, 'data')

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true)
}
const LIMIT = Number(opt('limit', 0)) || 0
const FORCE = argv.includes('--force')
const ALL = argv.includes('--all')
const REPAIR = argv.includes('--repair')
const RATE = Number(opt('rate', 120))

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(TMP_DIR, { recursive: true })

/**
 * 语法板块用：24 个希腊字母的名称。
 * 顺序必须与 tools/build_app_data.py 里的 LETTERS 一致 —— 文件名按下标生成。
 */
const GRAMMAR_CLIPS = [
  'ἄλφα', 'βῆτα', 'γάμμα', 'δέλτα', 'ἔψιλόν', 'ζῆτα', 'ἦτα', 'θῆτα',
  'ἰῶτα', 'κάππα', 'λάμβδα', 'μῦ', 'νῦ', 'ξῖ', 'ὄμικρόν', 'πῖ',
  'ῥῶ', 'σῖγμα', 'ταῦ', 'ὖ ψιλόν', 'φῖ', 'χῖ', 'ψῖ', 'ὦ μέγα',
]

// ---------------------------------------------------------------- 选词
const words = JSON.parse(readFileSync(join(DATA, 'greek.json'), 'utf8'))
const audioExists = (f) => {
  if (!f) return false
  const p = f.includes('/') ? join(APP, 'public', f) : join(APP, 'public', 'audio', f)
  return existsSync(p) && statSync(p).size > 400
}
const todo = words.filter((w) => {
  const word = (w.word || '').trim()
  if (!word) return false
  // 只补「原录音文件不存在、且 TTS 也还没生成」的漏
  if (REPAIR) return !audioExists(w.audio) && !existsSync(join(OUT_DIR, `${w.id}.m4a`))
  if (ALL || FORCE) return true
  return !w.audio   // 已有原牌组录音的保持不动
})
const list = LIMIT ? todo.slice(0, LIMIT) : todo
console.log(`词条 ${words.length}，需生成 ${todo.length}，本次处理 ${list.length}`)

// ---------------------------------------------------------------- eSpeak
const mod = await import('@echogarden/espeak-ng-emscripten')
const Module = await (typeof mod.default === 'function' ? mod.default() : mod.default)
const worker = new Module.eSpeakNGWorker()
const RATE_HZ = worker.get_samplerate()
worker.set_rate(RATE)
worker.set_pitch(50)
worker.set_voice('grc')
console.log(`eSpeak 就绪：voice=grc rate=${RATE} samplerate=${RATE_HZ}`)

/** 合成一个词的完整 PCM（Int16） */
function synth(text) {
  const parts = []
  worker.synthesize(text, (data) => {
    if (data && data.length) parts.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    return false    // 必须返回 false，否则只得到 100ms
  })
  return Buffer.concat(parts)
}

function wavFrom(raw) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + raw.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE_HZ, 24); h.writeUInt32LE(RATE_HZ * 2, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(raw.length, 40)
  return Buffer.concat([h, raw])
}

// ---- 先补齐语法板块的字母发音（文件名固定，可重复运行）
let grammarMade = 0
for (let i = 0; i < GRAMMAR_CLIPS.length; i++) {
  const dest = join(OUT_DIR, `grammar-${i}.m4a`)
  if (!FORCE && existsSync(dest) && statSync(dest).size > 400) continue
  try {
    const raw = synth(GRAMMAR_CLIPS[i])
    if (raw.length < 1200) continue
    const wavPath = join(TMP_DIR, `grammar-${i}.wav`)
    writeFileSync(wavPath, wavFrom(raw))
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', wavPath, dest], { stdio: 'ignore' })
    rmSync(wavPath, { force: true })
    grammarMade++
  } catch { /* 单个失败不影响整体 */ }
}
if (grammarMade) console.log(`语法字母发音生成 ${grammarMade} 个`)

let done = 0, skipped = 0, failed = 0, bytes = 0
const index = {}
if (existsSync(join(DATA, 'tts-index.json'))) {
  Object.assign(index, JSON.parse(readFileSync(join(DATA, 'tts-index.json'), 'utf8')))
}

const t0 = Date.now()
for (const w of list) {
  const id = String(w.id)
  const dest = join(OUT_DIR, `${id}.m4a`)
  const clean = (w.word || '').replace(/[⟦⟧\[\]]/g, '').trim()

  if (!FORCE && existsSync(dest) && statSync(dest).size > 500) {
    index[id] = `${id}.m4a`
    skipped++
    continue
  }

  try {
    const raw = synth(clean)
    if (raw.length < 1200) {           // 太短，多半没合成出东西
      failed++
      continue
    }
    const wavPath = join(TMP_DIR, `${id}.wav`)
    writeFileSync(wavPath, wavFrom(raw))
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', wavPath, dest], { stdio: 'ignore' })
    rmSync(wavPath, { force: true })
    if (!existsSync(dest) || statSync(dest).size < 400) { failed++; continue }
    bytes += statSync(dest).size
    index[id] = `${id}.m4a`
    done++
  } catch (e) {
    failed++
    if (failed <= 5) console.warn(`  ⚠️ ${clean}: ${e.message?.slice(0, 90)}`)
  }

  if (done % 200 === 0 && done > 0) {
    const rate = done / ((Date.now() - t0) / 1000)
    const left = (list.length - done - skipped) / rate
    console.log(`  ${done} 生成 / ${skipped} 跳过 / ${failed} 失败 · ${rate.toFixed(1)} 个/秒 · 预计剩余 ${(left / 60).toFixed(1)} 分钟`)
    writeFileSync(join(DATA, 'tts-index.json'), JSON.stringify(index))
  }
}

writeFileSync(join(DATA, 'tts-index.json'), JSON.stringify(index))
rmSync(TMP_DIR, { recursive: true, force: true })

console.log('')
console.log(`完成：本次生成 ${done}，跳过 ${skipped}，失败 ${failed}`)
console.log(`本次新增 ${(bytes / 1e6).toFixed(1)} MB，索引共 ${Object.keys(index).length} 条`)
console.log(`输出目录 ${OUT_DIR}`)
