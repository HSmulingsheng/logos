import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from './espeak_ctrl.mjs'
const es = await load()
// 用来验证「借德语语音」管线的德语对照词：覆盖 ü/i/ä/e/o/u/a
const WORDS = {
  'Bühne': 'ü=[yː]', 'viel': 'ie=[iː]', 'spät': 'ä=[ɛː]', 'Beet': 'ee=[eː]',
  'Sonne': 'o=[ɔ]', 'Boot': 'oo=[oː]', 'gut': 'u=[uː]', 'Vater': 'a=[a]',
  'hübsch': 'ü=[y]', 'bitte': 'i=[ɪ]',
}
const out = {}
es.set_voice('de')
for (const [w, note] of Object.entries(WORDS)) out[w] = { note, ipa: es.phonemes(w) }
writeFileSync(fileURLToPath(new URL('../out/xling/de_espeak_ipa.json', import.meta.url)),
  JSON.stringify(out, null, 1))
for (const [w, v] of Object.entries(out)) console.log(`${w.padEnd(9)} ${v.note.padEnd(10)} ${v.ipa}`)
