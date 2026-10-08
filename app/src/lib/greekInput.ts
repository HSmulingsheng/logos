/**
 * 拉丁字母 → 古希腊语的**输入转写**。
 *
 * 目的：用户不必安装希腊语输入法，直接用拉丁键盘打，实时变成希腊语；
 * 变音符号用数字补在元音后面。
 *
 * 默认方案刻意对齐 **iOS / macOS 系统自带的转写**（`kCFStringTransformLatinGreek`，
 * 即 CoreFoundation 的 `Latin-Greek`）。规则不是凭印象写的：我在本机直接调用
 * CoreFoundation 把它的真实输出逐字母跑了一遍，据此实现并写了对照测试
 * （`scripts/input-test.mjs` 会拿 Apple 的实际输出逐词比对）。
 *
 * Apple 方案要点：
 *   * `h` + 元音 → 粗气号（`ha` → `ἁ`）；元音开头的词自动加柔气号（`anthropos` → `ἀνθροπος`）
 *   * `ē`/`ō` → η/ω；`u`/`y` → υ；`ch`/`ph`/`th`/`ps` → χ/φ/θ/ψ
 *   * 词尾 `s` → ς，词中 → σ
 *   * **数字原样透传**，所以「数字打变音符号」是这一层加上去的
 *
 * 变音符号的实现用 Unicode **组合符号 + NFC 合成**（如 `α` + U+0314 + U+0301 → `ἅ`），
 * 这样多音调字符由 Unicode 自己组合，不需要手工维护一张几百项的映射表。
 */

export type InputScheme = 'ios' | 'betacode' | 'modern'

export const SCHEME_LABEL: Record<InputScheme, string> = {
  ios: 'iOS 转写',
  betacode: 'Beta Code',
  modern: '现代罗马化',
}

export const SCHEME_HINT: Record<InputScheme, string> = {
  ios: 'a→α · ē→η · ō→ω · ch/ph/th/ps→χ/φ/θ/ψ · h 起头为粗气号',
  betacode: 'h→η · w→ω · q→θ · f→φ · c→ξ · y→ψ · 大写前加 *',
  modern: 'v→β · th→θ · ch→χ · i→ι · o→ο（不区分长短与气号）',
}

/** 数字 → Unicode 组合符号。打在元音后面即可，可叠加（如 `a41` → ἅ）。 */
export const DIGIT_MARKS: Record<string, string> = {
  '1': '\u0301', // 重音 ´
  '2': '\u0300', // 抑音 `
  '3': '\u0342', // 扬抑音 ῀
  '4': '\u0314', // 粗气号
  '5': '\u0313', // 柔气号
  '6': '\u0345', // 下加字母
  '0': '\u0308', // 分音符
}

export const DIGIT_LEGEND = [
  ['1', '重音 ά'],
  ['2', '抑音 ὰ'],
  ['3', '扬抑音 ᾶ'],
  ['4', '粗气号'],
  ['5', '柔气号'],
  ['6', '下加字母'],
  ['0', '分音符'],
] as const

const ACUTE = '\u0301'
const GRAVE = '\u0300'
const CIRC = '\u0342'
const ROUGH = '\u0314'
const SMOOTH = '\u0313'
const IOTA = '\u0345'

const isVowel = (c: string) => 'aeiouyēōáàâéèêíìîóòôúùûýỳŷ'.includes(c)
/**
 * 查单字母的希腊对应。
 * **先按原字符查**：`stripAccent('ō')` 会变成 'o'，那样 ē/ō 永远匹配不到 η/ω。
 */
const singleOf = (c: string): string | undefined =>
  IOS_SINGLE[c.toLowerCase()] ?? IOS_SINGLE[stripAccent(c).toLowerCase()]
const stripAccent = (c: string) =>
  c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')

// ---------------------------------------------------------------- iOS 方案

/** 单字母（含带长音符的元音） */
const IOS_SINGLE: Record<string, string> = {
  a: 'α', e: 'ε', i: 'ι', o: 'ο', u: 'υ', y: 'υ',
  ē: 'η', ō: 'ω',
  b: 'β', g: 'γ', d: 'δ', z: 'ζ', k: 'κ', l: 'λ', m: 'μ',
  n: 'ν', x: 'ξ', p: 'π', r: 'ρ', s: 'σ', t: 'τ',
  f: 'φ', c: 'κ', j: 'ι', q: 'κ', v: 'υ', w: 'υ',
}
/** 双字母优先匹配 */
const IOS_DOUBLE: Record<string, string> = {
  th: 'θ', ph: 'φ', ch: 'χ', ps: 'ψ',
  ng: 'γγ',                                   // Apple 把 ng 转成 γγ（ἄγγελος）
  ai: 'αι', ei: 'ει', oi: 'οι', ui: 'υι', au: 'αυ', eu: 'ευ', ou: 'ου',
  // 长元音 + i → 下加字母（Apple：tōi→τῳ、tēi→τῃ、tāi→τᾳ）；
  // 短元音 + i 才是普通双元音（ai→αι）
  āi: 'ᾳ', ēi: 'ῃ', ōi: 'ῳ',
}
/** 只有**元音**双字母在词首才加柔气号，θ/φ/χ/ψ 这些辅音双字母不能加 */
const VOWEL_DIGRAPHS = new Set(['ai', 'ei', 'oi', 'ui', 'au', 'eu', 'ou', 'āi', 'ēi', 'ōi'])
/** 拉丁重音 → 组合符号（Apple 用带重音的拉丁字母表示重音） */
const LATIN_ACCENT: Record<string, string> = {
  '\u0301': ACUTE, '\u0300': GRAVE, '\u0342': CIRC, '\u0302': CIRC,
}

// ---------------------------------------------------------------- Beta Code

const BETA_SINGLE: Record<string, string> = {
  a: 'α', b: 'β', g: 'γ', d: 'δ', e: 'ε', z: 'ζ', h: 'η', q: 'θ',
  i: 'ι', k: 'κ', l: 'λ', m: 'μ', n: 'ν', c: 'ξ', o: 'ο', p: 'π',
  r: 'ρ', s: 'σ', t: 'τ', u: 'υ', f: 'φ', x: 'χ', y: 'ψ', w: 'ω',
}
const BETA_MARKS: Record<string, string> = {
  '/': ACUTE, '\\': GRAVE, '=': CIRC, '(': ROUGH, ')': SMOOTH, '|': IOTA, '+': '\u0308',
}

// ---------------------------------------------------------------- 现代罗马化

const MODERN_PAIRS: Record<string, string> = {
  th: 'θ', ch: 'χ', ps: 'ψ', ng: 'γγ', nt: 'ντ', mp: 'μπ', gk: 'γκ',
}
const MODERN_SINGLE: Record<string, string> = {
  a: 'α', v: 'β', g: 'γ', d: 'δ', e: 'ε', z: 'ζ', i: 'ι', k: 'κ',
  l: 'λ', m: 'μ', n: 'ν', x: 'ξ', o: 'ο', p: 'π', r: 'ρ', s: 'σ',
  t: 'τ', y: 'υ', f: 'φ', u: 'ου',
}

// ---------------------------------------------------------------- 主流程

/**
 * 把拉丁输入转成希腊语（边打边转）。
 *
 * 单遍扫描而不是按正则分段：分段会把「希腊语 + 数字」切成两段，
 * 数字那一段看不到前面的元音，变音符号就贴不上去
 * （`λογος` 再打 `1` 会变成孤零零的组合符号）。
 *
 * 已经是希腊字母的字符原样保留，所以可以中英混排、也可以先打希腊语再补数字。
 */
export function transliterate(input: string, scheme: InputScheme = 'ios'): string {
  if (!input) return ''
  const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/
  const LATIN = /[A-Za-z\u0100-\u017F*()/\\=|+]/
  let out = ''
  let wordStart = true
  let i = 0
  while (i < input.length) {
    const c = input[i]

    // 希腊字母：原样保留
    if (GREEK.test(c)) { out += c; wordStart = false; i++; continue }

    // 数字：贴到前面最后一个元音上（可跨过已转换的希腊语）
    if (DIGIT_MARKS[c]) { out = attachMarks(out, DIGIT_MARKS[c]); i++; continue }

    // 拉丁字母：整词取出来一并转换，才能正确处理词首气号与词尾 ς
    if (LATIN.test(c)) {
      let j = i
      while (j < input.length && LATIN.test(input[j])) j++
      out += convertWord(input.slice(i, j), scheme, wordStart)
      wordStart = false
      i = j
      continue
    }

    out += c
    wordStart = true      // 空格与标点都算词边界
    i++
  }
  return out.normalize('NFC')
}

function convertWord(word: string, scheme: InputScheme, atWordStart = true): string {
  if (scheme === 'betacode') return betaCode(word)
  if (scheme === 'modern') return modern(word)
  return ios(word, atWordStart)
}

/** 组合符号的类别：气号与重音各自只能有一个 */
const BREATHING = [SMOOTH, ROUGH]
const ACCENTS = [ACUTE, GRAVE, CIRC]
/** 书写顺序：气号 → 重音 → 下加字母/分音符（希腊语正字法的规范次序） */
const MARK_ORDER = [SMOOTH, ROUGH, ACUTE, GRAVE, CIRC, IOTA, '\u0308']

const isMark = (c: string) => /[\u0300-\u036f]/.test(c)

/**
 * 把新符号合并到已有字符上。
 *
 * 不能简单拼接：`a5` 会先因「词首元音」自动带柔气号，再被数字加一次，
 * 两个 U+0313 叠在一起就合成不出字符了。这里先把字符分解成
 * 「基字母 + 组合符号」，同类符号互相替换（气号换气号、重音换重音），
 * 再按规范次序重组。
 */
function mergeMarks(ch: string, marks: string): string {
  const dec = ch.normalize('NFD')
  const base = dec[0]
  let existing = [...dec.slice(1)].filter(isMark)
  for (const m of marks.normalize('NFD')) {
    if (!isMark(m)) continue
    if (BREATHING.includes(m)) existing = existing.filter((x) => !BREATHING.includes(x))
    if (ACCENTS.includes(m)) existing = existing.filter((x) => !ACCENTS.includes(x))
    if (!existing.includes(m)) existing.push(m)
  }
  const sorted = MARK_ORDER.filter((m) => existing.includes(m))
  return (base + sorted.join('')).normalize('NFC')
}

/** 把符号贴到输出里「最后一个希腊元音」上 */
function attachMarks(out: string, marks: string): string {
  if (!marks) return out
  // 必须先合成：否则 `α` 和它的组合符号是两个码点，会取到符号而不是元音
  const chars = [...out.normalize('NFC')]
  for (let i = chars.length - 1; i >= 0; i--) {
    const base = chars[i].normalize('NFD')[0]
    if (/[αεηιουωΑΕΗΙΟΥΩ]/.test(base)) {
      chars[i] = mergeMarks(chars[i], marks)
      return chars.join('')
    }
  }
  return out
}

function ios(word: string, startsWord = true): string {
  word = word.normalize('NFC')     // 让 ā/ē/ō 成为单码点，双字母表才匹配得上
  let out = ''
  let i = 0
  let atWordStart = startsWord
  // Beta Code 之外的方案里，`*` 表示大写（这里保留给统一处理）
  let forceUpper = false
  if (word.startsWith('*')) { forceUpper = true; word = word.slice(1) }

  while (i < word.length) {
    const c = word[i]

    // 数字 → 变音符号，贴在前面那个元音上
    if (DIGIT_MARKS[c]) { out = attachMarks(out, DIGIT_MARKS[c]); i++; continue }

    // h + 元音 → 粗气号（Apple 的规则）
    if ((c === 'h' || c === 'H') && i + 1 < word.length && isVowel(word[i + 1])) {
      const nxt = word[i + 1]
      const upperH = c === 'H'
      // h + **双元音**时，气号写在第二个元音上：οὑτος、αἱμα（不是 ὅυτος、ἁιμα）
      const twoAfter = word.slice(i + 1, i + 3).toLowerCase()
      if (VOWEL_DIGRAPHS.has(twoAfter)) {
        // 双元音的气号写在第二个元音上（οὑτος、αἱμα）；
        // 但「长元音+i」的下加字母是一个**预组合单字符**（ῳ/ῃ/ᾳ），
        // 这时直接把这个符号并到该字符上，不能再按两位取下标。
        const dg = IOS_DOUBLE[twoAfter]
        out += dg.length === 1 ? mergeMarks(dg, ROUGH) : dg[0] + dg[1] + ROUGH
        i += 3
        atWordStart = false
        continue
      }
      const base = singleOf(nxt) ?? ''
      const accent = LATIN_ACCENT[nxt.normalize('NFD').replace(/[^\u0300-\u036f]/g, '')] ?? ''
      out += (upperH ? base.toUpperCase() : base) + ROUGH + accent
      i += 2
      atWordStart = false
      continue
    }

    // 双字母
    const two = word.slice(i, i + 2).toLowerCase()
    if (IOS_DOUBLE[two]) {
      let g = IOS_DOUBLE[two]
      const upper = c === c.toUpperCase() && /[A-Z]/.test(c)
      if (atWordStart && VOWEL_DIGRAPHS.has(two)) g += SMOOTH   // 仅元音双元音加柔气号
      if (upper) g = g[0].toUpperCase() + g.slice(1)
      out += g
      i += 2
      atWordStart = false
      continue
    }

    const lower = stripAccent(c).toLowerCase()
    const base = singleOf(c)
    if (base) {
      const accent = LATIN_ACCENT[c.normalize('NFD').replace(/[^\u0300-\u036f]/g, '')] ?? ''
      let g = base + accent
      if (atWordStart && isVowel(lower)) g += SMOOTH
      // 词尾的 s 写 ς（后面只允许跟数字，数字是变音符号不是字母）
      if (lower === 's' && /^[0-9]*$/.test(word.slice(i + 1))) g = 'ς'
      if (c === c.toUpperCase() && /[A-Z]/.test(c)) g = g[0].toUpperCase() + g.slice(1)
      out += g
      i++
      atWordStart = false
      continue
    }

    out += c
    i++
  }
  return (forceUpper ? out.toUpperCase() : out).normalize('NFC')
}

function betaCode(word: string): string {
  let out = ''
  const upperAll = word.includes('*')
  const w = word.replace(/\*/g, '')
  let marks = ''
  for (let i = 0; i < w.length; i++) {
    const c = w[i].toLowerCase()
    if (BETA_MARKS[c]) { marks += BETA_MARKS[c]; continue }
    let g = BETA_SINGLE[c]
    if (!g) { out += w[i]; continue }
    if (c === 's' && i === w.length - 1) g = 'ς'
    const upper = /[A-Z]/.test(w[i]) || upperAll
    out += (upper ? g.toUpperCase() : g) + marks
    marks = ''
  }
  return (out + marks).normalize('NFC')
}

function modern(word: string): string {
  let out = ''
  let i = 0
  while (i < word.length) {
    const c = word[i]
    if (DIGIT_MARKS[c]) { out = attachMarks(out, DIGIT_MARKS[c]); i++; continue }
    const two = word.slice(i, i + 2).toLowerCase()
    let g = MODERN_PAIRS[two]
    if (g) { out += g; i += 2; continue }
    const lower = stripAccent(c).toLowerCase()
    g = MODERN_SINGLE[lower]
    if (g) {
      if (lower === 's' && i === word.length - 1) g = 'ς'
      if (/[A-Z]/.test(c)) g = g[0].toUpperCase() + g.slice(1)
      out += g; i++; continue
    }
    out += c; i++
  }
  return out.normalize('NFC')
}
