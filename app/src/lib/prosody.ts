/**
 * 古希腊语音高重音（阿提卡重建）。
 *
 * 为什么需要这个
 * --------------
 * eSpeak 的 `grc` 语音**完全没有实现音高重音**。实测：
 *
 *     φῶς（circumflex）→ f_ˈɔː_s_
 *     φώς（acute）     → f_ˈɔː_s_      ← 逐字符完全相同
 *
 * 15 组 acute/circumflex 最小对立体里 14 组的音素串一模一样，整词 F0 差 0.1 Hz。
 * 也就是说它**只标了重音落在哪个音节，没有给出任何调型**。
 * 而界面是标注重音符号的——标了却不发音，对学习者是最实质的缺陷。
 *
 * 好消息：`ˈ` 的**位置**在 5,985 个词上与正字法 100% 一致，
 * 所以「重音在第几音节」不用自己算，可以直接用 eSpeak 的输出定位，
 * 缺的只是「acute 升、circumflex 降」这个调型。
 *
 * 语言学依据（本文件实现的是通俗化版本）
 * --------------------------------------
 * Allen (1973) / Devine & Stephens (1994)：阿提卡的重音是**音高**重音，
 * acute 的高调落在重音音节的**第二个 mora**，circumflex 落在**第一个 mora**
 * 并在第二个 mora 下降。所以：
 *
 *   - acute 单 mora：到音节末平滑升到峰（峰在音节末尾）
 *   - acute 双 mora：前半缓升、后半升到音节末
 *   - circumflex：峰在音节约 45% 处，之后平滑下降
 *   - 正字法上无重音的附着词（ἐν / εἰς / οὐ / τις…）：不带调，走基准线
 *
 * ⚠️ 形状必须是**平滑函数**，不能用折线：折线的尖角会让 PSOLA 的基音周期增量
 * 突变，实测谐噪比（HNR）会掉 6–8 dB。改用高斯峰 + 22ms Hann 平滑后降到 0.6 dB。
 *
 * 实现移植自研究原型 `研究/tts/scripts/prosody_fix.py`（Python + numpy），
 * 这里是零依赖的 TypeScript 版，供浏览器直接调用。
 */

// ---------------------------------------------------------------- 正字法
/** 组合用尖音符（acute） */
const ACUTE = '\u0301'
/** 组合用抑音符（grave） */
const GRAVE = '\u0300'
/** 组合用曲折号（perispomeni，即 circumflex） */
const PERISP = '\u0342'
/** 全部组合用变音符号（用于跳过元音上附着的记号） */
const COMBINING = /[\u0300-\u0345]/
const BASIC_VOWELS = 'αεηιουω'
/** 二合元音 */
const DIPHTHONGS = new Set(['αι', 'ει', 'οι', 'υι', 'αυ', 'ευ', 'ου', 'ηυ', 'ωυ'])
/**
 * 韵尾 -αι / -οι 在阿提卡重音规则里算**短**，
 * 所以 ἄνθρωποι 的重音才能落到 antepenult（倒数第三音节）。
 */
const SHORT_FINAL_DIPH = new Set(['αι', 'οι'])

export type AccentType = 'acute' | 'grave' | 'circumflex' | 'none' | 'secondary'

export interface Syllable {
  text: string
  accent: AccentType
  /** 音节重量：长元音或正常二合元音 = 2，韵尾 -αι/-οι = 1 */
  morae: number
  /** 应为长音（mora=2）但 eSpeak 不标 `ː` 的单体元音 α/ι/υ */
  hiddenLong: boolean
}

export interface AccentInfo {
  type: AccentType
  /** 重音距词尾第几音节（0 = 末音节） */
  fromEnd: number
  total: number
  accentedMorae: number
  hiddenLong: boolean
  syllables: Syllable[]
}

/**
 * 切分音节并判定重音。
 *
 * 规则：相邻元音字母只有能组成二合元音时才并成一个音节；
 * 若重音符号落在簇的第一个字母上，则该簇**不是**二合元音（πό-λις）。
 */
export function syllabify(word: string): Syllable[] {
  // 必须先 NFD：预组合字符（如 ῶ = U+1FF6）拆开后才看得到重音符号
  const s = word.normalize('NFD').toLowerCase()

  // 找出所有元音核
  const nuclei: { i: number; j: number; text: string }[] = []
  let i = 0
  while (i < s.length) {
    if (BASIC_VOWELS.includes(s[i])) {
      let j = i + 1
      while (j < s.length && COMBINING.test(s[j])) j++
      nuclei.push({ i, j, text: s.slice(i, j) })
      i = j
    } else {
      i++
    }
  }

  const syls: Syllable[] = []
  let k = 0
  while (k < nuclei.length) {
    const a = nuclei[k]
    const b = k + 1 < nuclei.length ? nuclei[k + 1] : null
    const joined = b !== null && a.j === b.i
      && DIPHTHONGS.has(a.text[0] + b.text[0])
      && !a.text.includes(ACUTE) && !a.text.includes(GRAVE) && !a.text.includes(PERISP)
    if (joined && b) {
      syls.push({ text: a.text + b.text, accent: 'none', morae: 1, hiddenLong: false })
      k += 2
    } else {
      syls.push({ text: a.text, accent: 'none', morae: 1, hiddenLong: false })
      k += 1
    }
  }

  syls.forEach((sy, idx) => {
    const t = sy.text
    sy.accent = t.includes(PERISP) ? 'circumflex'
      : t.includes(ACUTE) ? 'acute'
        : t.includes(GRAVE) ? 'grave' : 'none'

    const bare = [...t].filter((c) => BASIC_VOWELS.includes(c)).join('')
    const isDiph = bare.length === 2 && DIPHTHONGS.has(bare)
    const isLast = idx === syls.length - 1
    if (isDiph) {
      sy.morae = isLast && SHORT_FINAL_DIPH.has(bare) ? 1 : 2
    } else {
      const ch = t[0]
      // η / ω 恒长；circumflex 只能落在长音节上，所以带 ῶ/ῖ/ῦ 的 α/ι/υ 也是长音
      sy.morae = ch === 'η' || ch === 'ω' ? 2
        : sy.accent === 'circumflex' && 'αιυ'.includes(ch) ? 2 : 1
    }
    // eSpeak 只在 η→ɛː / ω→ɔː 上显式标长音，α/ι/υ 的长音不标
    sy.hiddenLong = sy.morae === 2 && !isDiph && 'αιυ'.includes(t[0])
  })

  return syls
}

/** 汇总一个词的重音信息 */
export function accentSummary(word: string): AccentInfo {
  const syllables = syllabify(word)
  for (let idx = 0; idx < syllables.length; idx++) {
    const sy = syllables[idx]
    if (sy.accent !== 'none') {
      return {
        type: sy.accent,
        fromEnd: syllables.length - 1 - idx,
        total: syllables.length,
        accentedMorae: sy.morae,
        hiddenLong: sy.hiddenLong,
        syllables,
      }
    }
  }
  return {
    type: 'none', fromEnd: -1, total: syllables.length,
    accentedMorae: 1, hiddenLong: false, syllables,
  }
}

// ---------------------------------------------------------------- F0 目标模型
/**
 * 音高重音的幅度（相对基准线的比例）。
 *
 * 取「半音」尺度：0.45 ≈ +6.4 半音。**这是保守值**——幅度越大，PSOLA 需要搬动的
 * 基音周期越多、相邻窗相位越容易错开，实测谐噪比（HNR）会随之下降。
 * 所以宁可小一点，并优先保证曲线平滑。用户可在设置里调 amp。
 */
export const ACUTE_A = 0.45
export const CIRC_A = 0.45
const FALL = 0.14
/** 平滑窗长（秒）。22ms 是实测 HNR 损失与调型清晰度的折中 */
const SMOOTH_WIN = 0.022

/** eSpeak 的 IPA 里，二合元音写作带 ɪ/ʊ 滑音的序列 */
export function isDiphthongIpa(ipa: string): boolean {
  return ipa.includes('ɪ') || ipa.includes('ʊ')
}

export type Point = [number, number]

/** 在一个音节核上生成目标 F0 曲线 */
export function targetContour(
  baseF0: number, t0: number, t1: number,
  accent: AccentType, morae: number, isDiph: boolean, amp = 1,
): Point[] {
  const T = Math.max(t1 - t0, 0.02)
  const n = 12
  const pts: Point[] = []
  const long = morae >= 2 || isDiph
  for (let i = 0; i <= n; i++) {
    const u = i / n
    let v: number
    if (accent === 'none') v = 0.96 - 0.04 * u
    else if (accent === 'grave') v = 1.05 - 0.05 * u
    else if (accent === 'acute') {
      const A = ACUTE_A * amp
      v = long
        ? (u > 0.5 ? 1 + A * (0.30 + 0.70 * u) : 1 + A * 0.60 * u)
        : 1 + A * Math.pow(u, 1.5)
    } else if (accent === 'circumflex') {
      const A = CIRC_A * amp
      v = 1 + A * Math.exp(-Math.pow((u - 0.45) / 0.34, 2)) - FALL * Math.max(0, (u - 0.45) / 0.55)
    } else { // secondary
      v = 1 + 0.12 * amp * Math.sin(Math.PI * u)
    }
    pts.push([t0 + T * u, baseF0 * v])
  }
  return pts
}

/** 对 F0 控制点做 Hann 平滑，抑制 PSOLA 的周期抖动 */
export function smoothContour(pts: Point[], win = SMOOTH_WIN): Point[] {
  if (pts.length < 5) return pts
  const a = [...pts].sort((x, y) => x[0] - y[0])
  const half = win / 2
  const out: Point[] = []
  for (let i = 0; i < a.length; i++) {
    let sw = 0, sv = 0
    for (let j = 0; j < a.length; j++) {
      if (Math.abs(a[j][0] - a[i][0]) > half) continue
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (a[j][0] - a[i][0] + half) / (2 * half))
      sw += w; sv += a[j][1] * w
    }
    out.push([a[i][0], sw > 0 ? sv / sw : a[i][1]])
  }
  return out
}

/** 线性插值取值；端点外取最近值 */
export function interp(pts: Point[], t: number): number {
  if (!pts.length) return 0
  if (t <= pts[0][0]) return pts[0][1]
  const last = pts[pts.length - 1]
  if (t >= last[0]) return last[1]
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid][0] <= t) lo = mid; else hi = mid
  }
  const [t0, v0] = pts[lo], [t1, v1] = pts[hi]
  const d = t1 - t0
  return d <= 0 ? v1 : v0 + (v1 - v0) * (t - t0) / d
}

// ---------------------------------------------------------------- 与 eSpeak 对接
/** eSpeak `synthesize()` 回调第二参数里的事件 */
export interface EspeakEvent {
  type: string
  text_position: number
  word_length: number
  audio_position: number
  id?: string | number
}

/** eSpeak 输出里带重音标记的元音字符 */
const VOWEL_RE = /[aeiouyɛɔɑ]/

/**
 * 把 eSpeak 的事件流整理成「词」与「音素」。
 *
 * 关键点（实测）：
 * - `phoneme` 事件的 `audio_position` 是该音素的**起点**（ms），终点取下一个事件的起点
 * - 事件里混有 `id` 为空串的伪事件（音节分隔标记），**必须按 id 是否为空来推进标签指针**，
 *   按下标硬对齐在多词输入下会累积偏移
 * - `word` 事件的 `text_position` 是 1 基，配合 `word_length` 从原文切出词形
 */
export function parseEvents(events: EspeakEvent[], text: string, totalSec: number) {
  const words: { t0: number; t1: number; text: string }[] = []
  for (const e of events) {
    if (e.type !== 'word') continue
    const pos = e.text_position - 1
    words.push({
      t0: e.audio_position / 1000,
      t1: totalSec,
      text: text.slice(pos, pos + e.word_length),
    })
  }
  // 每个词的终点 = 下一个词的起点
  for (let i = 0; i + 1 < words.length; i++) words[i].t1 = words[i + 1].t0

  const ph = events.filter((e) => e.type === 'phoneme' && e.id !== '' && e.id !== undefined)
  const phones = ph.map((e, i) => ({
    t0: e.audio_position / 1000,
    t1: i + 1 < ph.length ? ph[i + 1].audio_position / 1000 : totalSec,
    ipa: String(e.id),
  }))
  // 最后一个词若没有后续词事件，用最后一个音素收尾
  if (words.length && phones.length) words[words.length - 1].t1 = phones[phones.length - 1].t1
  return { words, phones }
}

export interface AccentPlan {
  /** 目标 F0 曲线 [[时刻秒, Hz], ...] */
  points: Point[]
  /** 每个音素的重音归属，便于验收与调试 */
  roles: { ipa: string; t0: number; t1: number; accent: AccentType; morae: number }[]
}

/**
 * 设计整句的目标 F0 曲线。
 *
 * @param baseF0 说话人的基准基频（一般取该句 F0 的中位数）
 */
export function planAccent(
  events: EspeakEvent[], text: string, totalSec: number, baseF0: number, amp = 1,
): AccentPlan {
  const { words, phones } = parseEvents(events, text, totalSec)
  const decl = (t: number) => {
    const u = Math.min(Math.max(totalSec > 0 ? t / totalSec : 0, 0), 1)
    return baseF0 * (1.06 - 0.16 * u)
  }

  const points: Point[] = [[0, decl(0)]]
  const roles: AccentPlan['roles'] = []

  for (const p of phones) {
    const bare = p.ipa.replace(/^[ˈˌ]/, '')
    if (!VOWEL_RE.test(bare)) continue

    // 该音素属于哪个词
    const wi = words.findIndex((w) => p.t0 + 1e-6 >= w.t0 && p.t0 < w.t1 + 1e-6)
    const w = wi >= 0 ? words[wi] : null
    const info = w ? accentSummary(w.text) : null
    const isLong = bare.includes('ː') || isDiphthongIpa(bare)

    let accent: AccentType
    let morae = isLong ? 2 : 1
    if (p.ipa.startsWith('ˈ') && info && info.type !== 'none') {
      // eSpeak 给**所有**词都标主重音，包括正字法上无重音的附着词
      // （实测 ἐν/εἰς/οὐ/τις 等 92% 被强行加了 ˈ）。以正字法为准。
      accent = info.type
      morae = Math.max(morae, info.accentedMorae)
    } else if (p.ipa.startsWith('ˈ')) {
      accent = 'none'
    } else if (p.ipa.startsWith('ˌ')) {
      accent = 'secondary'
    } else {
      accent = 'none'
    }

    points.push(...targetContour(decl(p.t0), p.t0, p.t1, accent, morae, isDiphthongIpa(bare), amp))
    roles.push({ ipa: p.ipa, t0: p.t0, t1: p.t1, accent, morae })
  }

  points.push([totalSec, decl(totalSec)])
  points.sort((a, b) => a[0] - b[0])
  return { points: smoothContour(points), roles }
}
