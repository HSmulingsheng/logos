/**
 * eSpeak-NG grc 可控性 & 音高重音实测探针
 * 输出 out/probe_espeak.json（供 Python 分析）与 out/_probe/*.wav
 *
 * 回答三个问题：
 *   Q1 能否拿到音素序列 + 每音素时长？      → phonemes/phonemeTrace/align
 *   Q2 eSpeak 是否实现音高重音（acute/circumflex）？ → 最小对立体 F0 对比
 *   Q3 长短元音时长在 eSpeak 里是否区分、倍数多少？
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load, synth, wav } from './espeak_ctrl.mjs'

const HERE = fileURLToPath(new URL('../', import.meta.url))
const OUT = `${HERE}out`
mkdirSync(`${OUT}/_probe`, { recursive: true })

const es = await load()
console.log(`samplerate=${es.sr}`)

// ───────────────────────────── 0. API 能力确认
const caps = {}
caps.samplerate = es.sr
caps.has_convert_to_phonemes = typeof es.worker.convert_to_phonemes === 'function'
caps.has_synthesize_and_get_phonemes = typeof es.worker.synthesize_and_get_phonemes === 'function'
caps.has_synthesize_ipa = typeof es.worker.synthesize_ipa === 'function'
caps.worker_methods = Object.getOwnPropertyNames(Object.getPrototypeOf(es.worker))
caps.module_exports_heap = ['HEAP8', 'HEAPU8', 'HEAP16', 'HEAP32', 'HEAPF32', 'HEAPF64']
  .filter((k) => k in es.M)
caps.module_has_UTF8ToString = typeof es.M.UTF8ToString === 'function'
caps.voices = es.worker.list_voices().map((v) => v.identifier).filter((x) => /grc|gre|ell/i.test(x))

// ───────────────────────────── 1. 音素序列 + 时长对齐
const demoText = 'ἄνθρωπος'
const demo = synth(es, demoText)
writeFileSync(`${OUT}/_probe/demo_raw.wav`, wav(demo.pcm, demo.sr))
const align = {
  text: demoText,
  trace: demo.trace,
  phonemes_ipa_raw: es.phonemes(demoText),
  phonemes_espeak_raw: es.phonemesRaw(demoText),
  phonemes: demo.phonemes,
  total_ms: demo.durMs,
}
console.log('音素对齐：', demo.phonemes.map((p) => `${p.ipa}:${(p.t1 - p.t0).toFixed(0)}ms`).join(' '))

// ───────────────────────────── 2. 音高重音最小对立体
// 每组：音段完全相同（或几乎相同），只差重音类型/位置
const PAIRS = [
  // 只差重音符号：φῶς(光,circumflex) vs φώς(男子,acute)
  { name: 'circ_vs_acute_1', a: 'φῶς', b: 'φώς', note: 'circumflex vs acute，音段相同' },
  // πῶς(怎么?,circ) vs πώς(不知怎的,acute)
  { name: 'circ_vs_acute_2', a: 'πῶς', b: 'πώς', note: 'circumflex vs acute' },
  // 重音位置对立
  { name: 'pos_1', a: 'πότε', b: 'ποτέ', note: 'acute 在前 vs 在后' },
  { name: 'pos_2', a: 'τίς', b: 'τις', note: '疑问词(acute) vs 不定代词(无重音)' },
  { name: 'pos_3', a: 'τόμος', b: 'τομός', note: 'acute 首音节 vs 末音节' },
  { name: 'pos_4', a: 'εἶμι', b: 'εἰμί', note: 'circumflex 首 vs acute 末' },
  { name: 'pos_5', a: 'ἄνθρωπος', b: 'ἀνθρώπου', note: 'acute  antepenult vs penult' },
  { name: 'pos_6', a: 'δῆμος', b: 'δημός', note: 'circ penult vs acute final' },
  { name: 'pos_7', a: 'ὄρος', b: 'ὁρός', note: 'acute first vs acute final' },
]

// 全局 pitch 参数扫描（看 set_pitch 能否线性改变 F0）
const PITCH_SCAN = [30, 50, 70]

const rows = []
for (const p of PAIRS) {
  for (const [k, text] of [['a', p.a], ['b', p.b]]) {
    const r = synth(es, text)
    writeFileSync(`${OUT}/_probe/${p.name}_${k}.wav`, wav(r.pcm, r.sr))
    rows.push({
      group: p.name, side: k, text, note: p.note,
      trace: r.trace, phonemes_ipa: es.phonemes(text),
      durMs: r.durMs, phonemes: r.phonemes,
      wav: `_probe/${p.name}_${k}.wav`,
    })
  }
}

const pitchRows = []
for (const pv of PITCH_SCAN) {
  es.set_pitch(pv)
  const r = synth(es, 'ἄνθρωπος')
  writeFileSync(`${OUT}/_probe/pitch${pv}.wav`, wav(r.pcm, r.sr))
  pitchRows.push({ pitch: pv, durMs: r.durMs, wav: `_probe/pitch${pv}.wav`, phonemes: r.phonemes })
}
es.set_pitch(50)

// ───────────────────────────── 3. 长短元音时长
// 用最小对立体/同词不同格来观察长音标记 ː 的时长
const LENGTH = [
  { long: 'ὥρα', short: 'ὅρα', note: 'ω vs ο（不稳妥，仅观察）' },
  { long: 'λόγῳ', short: 'λόγο', note: 'ω vs ο' },
  { long: 'τιμή', short: 'τιμε', note: 'η vs ε' },
  { long: 'δῆμος', short: 'δεμος', note: 'η vs ε' },
  { long: 'ποίησις', short: 'ποιεσις', note: 'η vs ε' },
  { long: 'μῦθος', short: 'μυθος', note: 'υ vs υ' },
  { long: 'σοφία', short: 'σοφιᾱ', note: 'ι vs α' },
  { long: 'ἄγω', short: 'ἀγο', note: 'ω vs ο' },
]
const lengthRows = []
for (const L of LENGTH) {
  for (const [k, text] of [['long', L.long], ['short', L.short]]) {
    const r = synth(es, text)
    lengthRows.push({
      group: L.note, side: k, text, trace: r.trace,
      phonemes_ipa: es.phonemes(text), durMs: r.durMs,
      phonemes: r.phonemes.map((x) => ({ ipa: x.ipa, ms: +(x.t1 - x.t0).toFixed(1) })),
    })
  }
}

// ───────────────────────────── 4. 多个词的批量（给 Python 做统计）
const WORDS = readWords()
const batch = []
for (const w of WORDS) {
  try {
    const r = synth(es, w, { withTrace: true })
    batch.push({
      text: w, trace: r.trace, durMs: r.durMs,
      phonemes: r.phonemes.map((x) => ({ ipa: x.ipa, t0: x.t0, t1: x.t1 })),
    })
  } catch (e) { batch.push({ text: w, error: e.message }) }
}
writeFileSync(`${OUT}/_probe/batch_wav_skipped.json`, '[]')

function readWords() {
  return []
}
function _unused_readWords() {
  // 从 stub 读取常用词，避免依赖项目文件
  try {
    const fs = require('node:fs')
    return fs.readFileSync(`${HERE}scripts/wordlist.txt`, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

writeFileSync(`${OUT}/probe_espeak.json`, JSON.stringify({
  caps, align, pairs: rows, pitchScan: pitchRows, length: lengthRows, batch,
}, null, 1))
console.log(`\n写好了 ${OUT}/probe_espeak.json`)
console.log('能力:', JSON.stringify(caps.worker_methods))
