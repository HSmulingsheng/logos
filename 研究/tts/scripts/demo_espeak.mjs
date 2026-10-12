/**
 * 原型第 1 阶段：用 eSpeak 合成一组演示词，导出
 *   out/demo/<key>_base.wav     原始 eSpeak 音频
 *   out/demo/align.json         每个词的音素序列 + 每音素起止时间 + 正字法重音信息
 * 供 Python 端做韵律改造（音高重音 + 时长）。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load, synth, wav } from './espeak_ctrl.mjs'

const ROOT = '/Users/chenyuhui/Desktop/Deepseek workplace/逻各斯'
const HERE = fileURLToPath(new URL('../', import.meta.url))
const OUT = `${HERE}out/demo`
mkdirSync(OUT, { recursive: true })

export const DEMO = [
  // ── 最小对立体：只差重音类型/位置（用于验证「acute vs circumflex」是否被区分）
  { key: 'min01_phos_circ', text: 'φῶς', gloss: '光（circumflex）' },
  { key: 'min02_phos_acute', text: 'φώς', gloss: '男子（acute）' },
  { key: 'min03_pos_circ', text: 'πῶς', gloss: '怎么？（circumflex）' },
  { key: 'min04_pos_acute', text: 'πώς', gloss: '不知怎的（acute）' },
  { key: 'min05_pote_acute1', text: 'πότε', gloss: '何时（acute 在前）' },
  { key: 'min06_pote_acute2', text: 'ποτέ', gloss: '曾经（acute 在后）' },
  { key: 'min07_tis_acute', text: 'τίς', gloss: '谁？（acute）' },
  { key: 'min08_tis_none', text: 'τις', gloss: '某人（无重音）' },
  { key: 'min09_eimi_acute', text: 'εἰμί', gloss: '我是（acute 末）' },
  { key: 'min10_eimi_circ', text: 'εἶμι', gloss: '我将去（circumflex 首）' },
  { key: 'min11_demos_circ', text: 'δῆμος', gloss: '人民（circumflex penult）' },
  { key: 'min12_demos_acute', text: 'δημός', gloss: '脂肪（acute 末）' },
  { key: 'min13_anthropos', text: 'ἄνθρωπος', gloss: '人（acute antepenult）' },
  { key: 'min14_anthropou', text: 'ἀνθρώπου', gloss: '人的（acute penult）' },
  // ── 长短元音（mora）：eSpeak 未标记长音的隐藏长元音
  { key: 'len01_mythos', text: 'μῦθος', gloss: '神话（ῡ 长）' },
  { key: 'len02_lyo', text: 'λύω', gloss: '我解开（ῠ 短）' },
  { key: 'len03_men', text: 'μήν', gloss: '月份（η 长）' },
  { key: 'len04_kakos', text: 'κακός', gloss: '坏的（ᾰ 短）' },
  // ── 多音节长句，看整体韵律
  { key: 'sent01', text: 'ἐν ἀρχῇ ἦν ὁ λόγος', gloss: '太初有道（约1:1）' },
  { key: 'sent02', text: 'ἄνθρωπός τις κατέβαινεν ἀπὸ Ἰερουσαλὴμ εἰς Ἰεριχώ', gloss: '好撒玛利亚人开头' },
  { key: 'sent03', text: 'σοφία ἀρχὴ εὐδαιμονίας', gloss: '智慧是幸福之始' },
]

const es = await load()
const align = []
for (const d of DEMO) {
  const r = synth(es, d.text)
  writeFileSync(`${OUT}/${d.key}_base.wav`, wav(r.pcm, r.sr))
  align.push({
    key: d.key, text: d.text, gloss: d.gloss,
    trace: r.trace, phonemes_ipa_raw: es.phonemes(d.text),
    sr: r.sr, durMs: r.durMs,
    phonemes: r.phonemes.map((p) => ({ ipa: p.ipa, t0: p.t0, t1: p.t1 })),
    words: r.words,
    events: r.events,
  })
  console.log(`${d.key.padEnd(20)} ${d.text.padEnd(24)} ${r.durMs.toFixed(0).padStart(5)}ms  ${r.trace}`)
}
writeFileSync(`${OUT}/align.json`, JSON.stringify({
  samplerate: es.sr, rate: 168, pitch: 50, range: 60, voice: 'grc', items: align,
}, null, 1))
console.log(`\n→ ${OUT}/align.json`)
