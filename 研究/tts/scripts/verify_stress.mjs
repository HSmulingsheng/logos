/**
 * 验证 eSpeak grc 的重音行为（修正版：用 Unicode NFD 分解来处理多音调正字法）
 *
 * 问题 1：eSpeak 的 ˈ 标记位置是否 = 正字法重音所在音节？
 * 问题 2：acute / circumflex 是否产生不同的音素串（即 eSpeak 是否区分两者）？
 * 问题 3：无重音的词（如 ἐστί 的附着词形、προκλιτικόν）是否被强行加重音？
 *
 * 多音调希腊语的字形把「字母 + 呼吸符 + 重音」预合成了单个码位
 * （如 ἄ = U+1F04），所以必须先 NFD 分解才能可靠地定位重音符号。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from './espeak_ctrl.mjs'

const ROOT = '/Users/chenyuhui/Desktop/Deepseek workplace/逻各斯'
const HERE = fileURLToPath(new URL('../', import.meta.url))
const es = await load()

const ACUTE = '\u0301', GRAVE = '\u0300', PERISP = '\u0342'
const BREATHING = /[\u0313\u0314\u0345]/
const ADD = /[\u0300-\u0345]/
const VOWELS = 'αεηιουωΑΕΗΙΟΥΩ'

function nfd(w) { return w.normalize('NFD') }

/** 音节核（NFD 下：一个元音基字母 + 后续组合符号） */
function nuclei(w) {
  const s = nfd(w)
  const out = []
  for (let i = 0; i < s.length; i++) {
    if (VOWELS.includes(s[i])) {
      let j = i + 1
      while (j < s.length && ADD.test(s[j])) j++
      out.push({ i, j, text: s.slice(i, j) })
      i = j - 1
    }
  }
  return out
}

/** 数正字法音节：合并二合元音（αι ει οι υι αυ ευ ου ηυ ωυ） */
function syllables(w) {
  const ns = nuclei(w)
  const bare = (t) => t[0]                       // 基字母
  const merged = []
  for (let k = 0; k < ns.length; k++) {
    const a = ns[k], b = ns[k + 1]
    if (b) {
      const pair = bare(a.text) + bare(b.text)
      const pairL = pair.toLowerCase()
      // 二合元音判定规则（关键）：
      //   希腊语二合元音的重音符号写在**第二个**字母上（αί, οί, ού…）；
      //   若重音符号落在第一个字母上（πό-λις, ὅ-τι, οὐ-κέ-τι 的 -εἰ-），
      //   则两者分属不同音节，不是二合元音。
      const firstAccented = new RegExp(`[${ACUTE}${GRAVE}${PERISP}]`).test(a.text)
      // 两个元音字母必须**相邻**才是二合元音（δύ-να-μις 的 α…ι 之间隔着 μ）
      const adjacent = (a.j === b.i)
      if (!firstAccented && adjacent &&
          ['αι', 'ει', 'οι', 'υι', 'αυ', 'ευ', 'ου', 'ηυ', 'ωυ'].includes(pairL)) {
        merged.push({ start: a.i, end: b.j, text: a.text + b.text })
        k++
        continue
      }
    }
    merged.push({ start: a.i, end: a.j, text: a.text })
  }
  return merged
}

function accentOf(w) {
  const s = nfd(w)
  const syls = syllables(w)
  for (let k = 0; k < syls.length; k++) {
    const t = syls[k].text
    if (t.includes(PERISP)) return { type: 'circumflex', syl: k, total: syls.length, syls }
    if (t.includes(ACUTE)) return { type: 'acute', syl: k, total: syls.length, syls }
    if (t.includes(GRAVE)) return { type: 'grave', syl: k, total: syls.length, syls }
  }
  return { type: 'none', syl: -1, total: syls.length, syls }
}

/** eSpeak IPA 里音节核（元音音素），以及 ˈ 落在第几个核 */
function espeakNuclei(ipa) {
  const segs = ipa.split('_').filter(Boolean)
  const isV = (s) => /[aeiouyɛɔɑ]/.test(s.replace(/[ˈˌ]/g, ''))
  const nuc = segs.filter(isV)
  const i = segs.findIndex((s) => s.startsWith('ˈ'))
  if (i < 0) return { syl: -1, total: nuc.length, segs }
  const want = segs[i]
  // 双元音在 eSpeak 里是单音素（aɪ, eʊ, oɪ...），正字法里也算一个音节 → 一致
  return { syl: nuc.indexOf(want), total: nuc.length, segs }
}

const greek = JSON.parse(readFileSync(ROOT + '/data/greek.json', 'utf8'))
const words = greek.map((r) => (r._raw || {}).Greek || '')
  .map((w) => w.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim())
  .filter((w) => /^[\u0370-\u03ff\u1f00-\u1fff]+$/.test(w))
console.log('候选词', words.length)

const stat = { tot: 0, rel_match: 0, rel_mismatch: 0, noStress: 0, sylCountDiff: 0 }
const byType = {}, byTypeMatch = {}
const mismatch = []

for (const w of words.slice(0, 6000)) {
  let ipa
  try { ipa = es.phonemes(w) } catch { continue }
  if (!ipa) continue
  const o = accentOf(w)
  const e = espeakNuclei(ipa)
  byType[o.type] = (byType[o.type] || 0) + 1
  if (e.syl < 0) { stat.noStress++; continue }
  if (o.syl < 0) continue          // 无重音词，另计
  stat.tot++
  if (o.total !== e.total) stat.sylCountDiff++
  // 从词尾往前的相对位置最稳健（前缀/附着词造成的核数差异不影响尾部对齐）
  const relO = o.total - 1 - o.syl, relE = e.total - 1 - e.syl
  if (relO === relE) { stat.rel_match++; byTypeMatch[o.type] = (byTypeMatch[o.type] || 0) + 1 }
  else {
    stat.rel_mismatch++
    if (mismatch.length < 30) mismatch.push({ w, ipa, type: o.type, relO, relE, o: o.total, e: e.total })
  }
}
console.log('\n【问题 1】重音位置（从词尾算起的相对位置）')
console.log('  可比较词数', stat.tot, ' 一致', stat.rel_match,
  `(${(100 * stat.rel_match / stat.tot).toFixed(1)}%)`,
  ' 不一致', stat.rel_mismatch, ' eSpeak 未标 ˈ 的', stat.noStress)
console.log('  正字法/eSpeak 音节核数不同的词', stat.sylCountDiff,
  `(${(100 * stat.sylCountDiff / stat.tot).toFixed(1)}%)`)
console.log('  按重音类型：', JSON.stringify(byType), ' 其中位置一致：', JSON.stringify(byTypeMatch))
console.log('  不一致样例：')
for (const m of mismatch.slice(0, 12))
  console.log(`    ${m.w} (${m.type}) → ${m.ipa}   正字法 rel=${m.relO}/${m.o}  eSpeak rel=${m.relE}/${m.e}`)

// ── 问题 2：acute vs circumflex 是否产生不同 IPA
const byStem = new Map()
for (const w of words.slice(0, 6000)) {
  const bare = nfd(w).replace(/[\u0300-\u0345]/g, '').normalize('NFC')
  if (!byStem.has(bare)) byStem.set(bare, [])
  byStem.get(bare).push(w)
}
const pairs = []
for (const [, ws] of byStem) {
  const t = new Map()
  for (const w of ws) t.set(accentOf(w).type, w)
  if (t.has('acute') && t.has('circumflex')) pairs.push([t.get('acute'), t.get('circumflex')])
}
let identical = 0, compared = 0
const pairRows = []
for (const [a, c] of pairs) {
  let ia, ic
  try { ia = es.phonemes(a); ic = es.phonemes(c) } catch { continue }
  compared++
  const same = ia.replace(/[ˈˌ]/g, '') === ic.replace(/[ˈˌ]/g, '')
  if (same) identical++
  pairRows.push({ acute: a, circumflex: c, ipa_acute: ia, ipa_circumflex: ic, identical_segments: same })
}
console.log('\n【问题 2】acute vs circumflex 最小对立体')
console.log(`  词对数 ${compared}；去掉重音标记后音素串**完全相同**的 ${identical} `
  + `(${(100 * identical / Math.max(1, compared)).toFixed(1)}%)`)
for (const r of pairRows.slice(0, 12))
  console.log(`    ${r.acute} / ${r.circumflex}   →   ${r.ipa_acute}   |   ${r.ipa_circumflex}   ${r.identical_segments ? '相同 ✗' : '不同'}`)

// ── 问题 3：无重音词被强行加重音？
const noneWords = words.slice(0, 6000).filter((w) => accentOf(w).type === 'none')
let forced = 0, n3 = 0
const forcedSamples = []
for (const w of noneWords.slice(0, 800)) {
  let ipa
  try { ipa = es.phonemes(w) } catch { continue }
  n3++
  if (ipa.includes('ˈ')) { forced++; if (forcedSamples.length < 12) forcedSamples.push(`${w} → ${ipa}`) }
}
console.log('\n【问题 3】正字法上无重音符号的词')
console.log(`  抽样 ${n3} 个，其中 eSpeak 仍标了主重音 ˈ 的有 ${forced} `
  + `(${(100 * forced / Math.max(1, n3)).toFixed(1)}%)`)
console.log('  样例: ' + forcedSamples.join(' | '))

writeFileSync(HERE + 'out/stress_verification.json', JSON.stringify({
  stat, byType, byTypeMatch, mismatch,
  pairs_compared: compared, pairs_identical: identical, pairs: pairRows.slice(0, 200),
  no_accent_forced: { n: n3, forced, samples: forcedSamples },
}, null, 1))
console.log('\n→ out/stress_verification.json')
