import { foldGreek } from '../greek'
import type {
  ChoiceExercise, Exercise, Kind, Letter, Paradigm, EndingGroup, SmythExample,
} from './types'

// ---------------------------------------------------------------- 随机工具

type Rng = () => number

function shuffleWith<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]
}

function sampleN<T>(arr: T[], n: number, rng: Rng): T[] {
  return shuffleWith(arr, rng).slice(0, n)
}

const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f']

/** 选项顺序打乱，同时保证「正确答案的位置」也是随机的 */
function makeOptions(
  correct: string, distractors: string[], rng: Rng,
): { options: { id: string; text: string }[]; answerId: string } {
  const texts = shuffleWith([correct, ...distractors], rng)
  const options = texts.map((t, i) => ({ id: OPTION_IDS[i], text: t }))
  const answerId = options.find((o) => o.text === correct)!.id
  return { options, answerId }
}

// ---------------------------------------------------------------- 词形工具

interface FormEntry { form: string; count: number; gram: string }

/** 去掉同一个词形重复的语法标签，只保留歧义消除后的条目 */
function uniqueFormEntries(p: Paradigm): FormEntry[] {
  const byForm = new Map<string, Set<string>>()
  for (const [form, count, gram] of p.forms) {
    if (!form || !gram) continue
    if (!byForm.has(form)) byForm.set(form, new Set())
    byForm.get(form)!.add(gram)
  }
  const out: FormEntry[] = []
  for (const [form, grams] of byForm) {
    // 只保留语法标签唯一的词形 —— 否则「这个词形是什么格」会有多个正确答案
    if (grams.size !== 1) continue
    const gram = [...grams][0]
    const count = p.forms.find((f) => f[0] === form)?.[1] ?? 0
    out.push({ form, count, gram })
  }
  return out
}

const CASE_ORDER = ['主格', '属格', '与格', '宾格', '呼格']
const TENSE_LABEL: Record<string, string> = {
  现在: '现在时', 未完成: '未完成时', 不定过去: '不定过去时', 将来: '将来时', 完成: '完成时', 过去完成: '过去完成时',
}

function gramParts(gram: string): string[] {
  return gram.split('·').filter(Boolean)
}

function caseOf(gram: string): string | undefined {
  return gramParts(gram).find((g) => CASE_ORDER.includes(g))
}

function numberOf(gram: string): string | undefined {
  return gramParts(gram).find((g) => g === '单数' || g === '复数' || g === '双数')
}

function genderOf(gram: string): string | undefined {
  return gramParts(gram).find((g) => g === '阳性' || g === '阴性' || g === '中性')
}

/** 挑「像但不对」的干扰项：优先同数不同格、同格不同数，最后才用其它 */
function distractorsFor(entries: FormEntry[], correct: FormEntry, n: number, rng: Rng): string[] {
  const cCase = caseOf(correct.gram)
  const cNum = numberOf(correct.gram)
  const cGen = genderOf(correct.gram)
  const others = entries.filter((e) => e.form !== correct.form)
  const score = (e: FormEntry) => {
    let s = 0
    if (numberOf(e.gram) === cNum) s += 4
    if (caseOf(e.gram) === cCase) s += 3
    if (genderOf(e.gram) === cGen) s += 2
    return s
  }
  const ranked = shuffleWith(others, rng).sort((a, b) => score(b) - score(a))
  const out: string[] = []
  for (const e of ranked) {
    if (out.includes(e.form)) continue
    out.push(e.form)
    if (out.length >= n) break
  }
  return out
}

// ---------------------------------------------------------------- 题型生成器

/** 给语法标签 → 选词形 */
function genChooseForm(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  if (entries.length < 4) return null
  const answer = pick(entries, rng)
  const ds = distractorsFor(entries, answer, 3, rng)
  if (ds.length < 3) return null
  const { options, answerId } = makeOptions(answer.form, ds, rng)
  return {
    kind: 'chooseForm', mode: 'choice',
    prompt: `${p.word} 的「${answer.gram}」是哪一个？`,
    sub: p.senses.join('；'),
    options, answerId,
    explain: `${p.word} 的 ${answer.gram} 是 ${answer.form}。`,
  }
}

/** 给词形 → 判断语法标签 */
function genParseForm(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  if (entries.length < 4) return null
  const target = pick(entries, rng)
  const grams = [...new Set(entries.map((e) => e.gram))].filter((g) => g !== target.gram)
  if (grams.length < 3) return null
  const ds = sampleN(grams, 3, rng)
  const { options, answerId } = makeOptions(target.gram, ds, rng)
  return {
    kind: 'parseForm', mode: 'choice',
    prompt: `「${target.form}」（${p.word}）是什么形式？`,
    sub: `这个词形在语料里出现 ${target.count} 次`,
    options, answerId,
    explain: `${target.form} 是 ${p.word} 的 ${target.gram}。`,
  }
}

/** 给标签 → 拼写词形（忽略重音） */
function genTypeForm(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  if (entries.length < 3) return null
  const target = pick(entries, rng)
  if (target.form.length < 2) return null
  return {
    kind: 'typeForm', mode: 'type',
    prompt: `写出 ${p.word}（${p.senses[0] ?? ''}）的「${target.gram}」`,
    sub: '重音符号可以省略',
    answer: target.form,
    explain: `${target.gram} → ${target.form}`,
  }
}

/** 词形 ↔ 标签 配对 */
function genMatchForms(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  if (entries.length < 4) return null
  // 语法标签必须互不相同 —— 同一个标签可能对应多个词形，那样配对会有歧义
  const byGram = new Map<string, FormEntry>()
  for (const e of shuffleWith(entries, rng)) {
    if (!byGram.has(e.gram)) byGram.set(e.gram, e)
  }
  if (byGram.size < 4) return null
  const four = sampleN([...byGram.values()], 4, rng)
  return {
    kind: 'matchForms', mode: 'match',
    prompt: `把 ${p.word} 的词形和它的语法标签配对`,
    pairs: four.map((e) => ({ left: e.form, right: e.gram })),
    explain: four.map((e) => `${e.form} = ${e.gram}`).join('；'),
  }
}

/** 按格序排列（同一个数与性） */
function genOrderCases(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  // 找出「同一个数 + 同一个性」下 4 个格的词形
  const groups = new Map<string, FormEntry[]>()
  for (const e of entries) {
    const c = caseOf(e.gram); const n = numberOf(e.gram); const g = genderOf(e.gram)
    if (!c || !n) continue
    const key = `${n}|${g ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }
  const usable = [...groups.values()].filter((g) => g.length >= 4)
  if (!usable.length) return null
  const g = pick(usable, rng)
  const four = sampleN(g, 4, rng)
  const correct = [...four].sort((a, b) => CASE_ORDER.indexOf(caseOf(a.gram)!) - CASE_ORDER.indexOf(caseOf(b.gram)!))
  return {
    kind: 'orderCases', mode: 'order',
    prompt: `按「主格 → 属格 → 与格 → 宾格」的顺序排列 ${p.word} 的词形`,
    sub: four[0].gram.split('·').slice(1).join('·') || undefined,
    items: shuffleWith(correct.map((e) => e.form), rng),
    correct: correct.map((e) => e.form),
    explain: correct.map((e) => `${caseOf(e.gram)}：${e.form}`).join('　'),
  }
}

/** 找出不属于某一格的词形 */
function genOddOneOut(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  const byCase = new Map<string, FormEntry[]>()
  for (const e of entries) {
    const c = caseOf(e.gram)
    if (!c) continue
    if (!byCase.has(c)) byCase.set(c, [])
    byCase.get(c)!.push(e)
  }
  const three = [...byCase.entries()].filter(([, v]) => v.length >= 3)
  if (three.length < 2) return null
  const [sameCase, sameList] = pick(three, rng)
  const target = sampleN(sameList, 3, rng).map((e) => e.form)
  const otherCases = [...byCase.entries()].filter(([c, v]) => c !== sameCase && v.length >= 1)
  if (!otherCases.length) return null
  const [, otherList] = pick(otherCases, rng)
  const odd = pick(otherList, rng)
  if (target.includes(odd.form)) return null
  const { options, answerId } = makeOptions(odd.form, target, rng)
  return {
    kind: 'oddOneOut', mode: 'choice',
    prompt: `下面哪一个不是 ${p.word} 的「${sameCase}」？`,
    options, answerId,
    explain: `${odd.form} 是 ${odd.gram}，其余三个都是 ${sameCase}。`,
  }
}

/** 真实语料填空：把经句里这个词的真实词形挖掉 */
function genCloze(p: Paradigm, rng: Rng): Exercise | null {
  const entries = uniqueFormEntries(p)
  if (entries.length < 3 || !p.examples.length) return null
  const ex = pick(p.examples, rng)
  const toks = ex.greek.split(/\s+/)
  if (ex.idx >= toks.length) return null
  // 原句里的词形可能带标点，去掉后再比对
  const raw = toks[ex.idx].replace(/[.,·;:!?·()«»\[\]⸀⸁⸂⸃]/g, '')
  if (foldGreek(raw) !== foldGreek(ex.form)) return null
  const ds = distractorsFor(entries, { form: ex.form, count: 0, gram: ex.gram }, 3, rng)
  if (ds.length < 3) return null
  const sentence = toks.map((t, i) => (i === ex.idx ? '_____' : t)).join(' ')
  const { options, answerId } = makeOptions(ex.form, ds, rng)
  return {
    kind: 'cloze', mode: 'choice',
    prompt: `选出原句中被挖掉的词形（${p.word}）`,
    sub: ex.gram ? `提示：这里应当是「${ex.gram}」` : undefined,
    sentence,
    source: ex.ref,
    options, answerId,
    explain: `${ex.ref}：${ex.form}（${ex.gram}）${ex.zh ? `　和合本：${ex.zh}` : ''}`,
  }
}

/**
 * 词尾题，两种问法交替：
 *   A 统计题 —— 这个语法位置最常见的词尾是哪个
 *   B 归属题 —— 下面哪个词尾属于这个语法位置
 * 只出 A 的话，样本够多的组合本来就没几组，一关会被去重压到两三题。
 */
function genChooseEnding(g: EndingGroup, all: EndingGroup[], rng: Rng): Exercise | null {
  if (g.endings.length < 3) return null

  if (rng() < 0.5) {
    // A：最常见的词尾
    const answer = g.endings[0]
    const ds = sampleN(g.endings.slice(1), 3, rng)
    if (ds.length < 3) return null
    const { options, answerId } = makeOptions(`-${answer.end}`, ds.map((d) => `-${d.end}`), rng)
    return {
      kind: 'chooseEnding', mode: 'choice',
      prompt: `在新约语料里，「${g.pos}·${g.gram}」最常见的词尾是？`,
      sub: `样本 ${g.total} 次　例词：${answer.words.slice(0, 3).join('、')}`,
      options, answerId,
      explain: `-${answer.end} 占 ${Math.round(answer.share * 100)}%（${answer.words.slice(0, 2).join('、')}）。`,
    }
  }

  // B：这个语法位置用的是哪个词尾（干扰项取自别处，干扰项不能也属于本组）
  const answer = pick(g.endings, rng)
  const mine = new Set(g.endings.map((e) => e.end))
  const foreign = [...new Set(all.flatMap((x) => x.endings.map((e) => e.end)))]
    .filter((e) => !mine.has(e))
  const ds = sampleN(foreign, 3, rng)
  if (ds.length < 3) return null
  const { options, answerId } = makeOptions(`-${answer.end}`, ds.map((d) => `-${d}`), rng)
  return {
    kind: 'chooseEnding', mode: 'choice',
    prompt: `在新约语料里，「${g.pos}·${g.gram}」用下面哪个词尾？`,
    sub: `这一组有 ${g.endings.length} 种常见词尾　样本 ${g.total} 次`,
    options, answerId,
    explain: `-${answer.end} 属于「${g.pos}·${g.gram}」，占该组 ${Math.round(answer.share * 100)}%（${answer.words.slice(0, 2).join('、')}）。`,
  }
}

/** 词尾 → 语法标签 */
function genEndingToGram(groups: EndingGroup[], rng: Rng): Exercise | null {
  const pool = groups.filter((g) => g.endings.length >= 2)
  if (pool.length < 4) return null
  const g = pick(pool, rng)
  const e = pick(g.endings, rng)
  const others = pool.filter((x) => !(x.pos === g.pos && x.gram === g.gram))
  const ds = sampleN(others, 3, rng).map((x) => `${x.pos}·${x.gram}`)
  if (ds.length < 3) return null
  const correct = `${g.pos}·${g.gram}`
  const { options, answerId } = makeOptions(correct, ds, rng)
  return {
    kind: 'endingToGram', mode: 'choice',
    prompt: `词尾 -${e.end} 最常出现在哪种形式里？`,
    sub: `例词：${e.words.slice(0, 3).join('、')}`,
    options, answerId,
    explain: `-${e.end} 出现在「${correct}」（占该组 ${Math.round(e.share * 100)}%）。`,
  }
}

// ---------------------------------------------------------------- 字母题型

/** 大小写配对 */
function genLetterCase(letters: Letter[], rng: Rng): Exercise | null {
  const four = sampleN(letters, 4, rng)
  if (four.length < 4) return null
  return {
    kind: 'letterCase', mode: 'match',
    prompt: '把大写字母和它的小写形式配对',
    pairs: four.map((l) => ({ left: l.up, right: l.low })),
    explain: four.map((l) => `${l.up} ${l.low}　${l.name}`).join('；'),
  }
}

/** 字母顺序：某个字母后面是哪个 */
function genLetterNeighbor(letters: Letter[], rng: Rng): Exercise | null {
  if (letters.length < 8) return null
  const i = Math.floor(rng() * (letters.length - 4))
  const target = letters[i]
  const nextCorrect = letters[i + 1]
  const ds = sampleN(
    letters.filter((l) => l.up !== nextCorrect.up), 3, rng,
  ).map((l) => `${l.up} ${l.low}`)
  if (ds.length < 3) return null
  const correct = `${nextCorrect.up} ${nextCorrect.low}`
  const { options, answerId } = makeOptions(correct, ds, rng)
  return {
    kind: 'letterNeighbor', mode: 'choice',
    prompt: `字母表里，${target.up} ${target.low}（${target.name}）后面是哪个字母？`,
    options, answerId,
    explain: `顺序是 … ${target.up} ${target.low} → ${nextCorrect.up} ${nextCorrect.low} …`,
  }
}

/** 词尾 ς / σ 的书写 */
function genFinalSigma(paradigms: Paradigm[], rng: Rng): Exercise | null {
  const words = [...new Set(paradigms.map((p) => p.word))]
    .filter((w) => w.length >= 4 && w.endsWith('ς') && !w.includes(' '))
  if (words.length < 3) return null
  const w = pick(words, rng)
  const correct = w
  const wrongSigma = w.slice(0, -1) + 'σ'                       // 词尾该用 ς 却用了 σ
  const other = pick(words.filter((x) => x !== w), rng)
  const otherWrong = other.slice(0, -1) + 'σ'
  const { options, answerId } = makeOptions(correct, [wrongSigma, otherWrong, other], rng)
  return {
    kind: 'finalSigma', mode: 'choice',
    prompt: '下面哪一个拼写是正确的？',
    sub: '注意词尾的 s 该怎么写',
    options, answerId,
    explain: `词尾的 s 写作 ς（sigma 的词尾形）：${correct} 正确。${other} 也是正确拼写，但本题要选的是…`,
  }
}

// ---------------------------------------------------------------- 教材例句题型（Smyth）

/** 在句子里定位目标词，返回挖空后的句子；找不到则返回 null */
function blankTarget(greek: string, form: string): string | null {
  const toks = greek.split(/\s+/)
  const key = foldGreek(form)
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i].replace(/[.,;·:!?()«»\[\]⸀⸁⸂⸃—–]/g, '')
    if (foldGreek(raw) === key) {
      const clone = [...toks]
      clone[i] = '_____'
      return clone.join(' ')
    }
  }
  return null
}

/** 教材例句填空：把 Smyth 引文里的真实词形挖掉，让学习者填回来 */
function genTextbookCloze(ex: SmythExample, rng: Rng): Exercise | null {
  const sentence = blankTarget(ex.greek, ex.t.form)
  if (!sentence) return null
  const others = ex.t.tf.filter(([f]) => f !== ex.t.form)
  if (others.length < 3) return null
  const cCase = caseOf(ex.t.gram); const cNum = numberOf(ex.t.gram)
  const ranked = shuffleWith(others, rng).sort((a, b) => {
    const sa = (numberOf(b[1]) === cNum ? 4 : 0) + (caseOf(b[1]) === cCase ? 3 : 0)
    const sb = (numberOf(a[1]) === cNum ? 4 : 0) + (caseOf(a[1]) === cCase ? 3 : 0)
    return sa - sb
  })
  const ds = ranked.slice(0, 3).map(([f]) => f)
  if (ds.length < 3) return null
  const { options, answerId } = makeOptions(ex.t.form, ds, rng)
  return {
    kind: 'textbookCloze', mode: 'choice',
    prompt: '下面这句古典希腊语出自教材例句，选出被挖掉的词形',
    sub: `Smyth §${ex.n}${ex.src ? `　${ex.src}` : ''}`,
    sentence,
    // 注意：这里不能带出语法标签，否则等于直接把答案写在题干上
    source: ex.src || `Smyth §${ex.n}`,
    options, answerId,
    explain: `原句：${ex.greek}\n${ex.t.form} 是 ${ex.t.gram}。\n${ex.zh || ''}${ex.zh && ex.en ? `\nSmyth 英译：${ex.en}` : (ex.en ? `\n译文：${ex.en}` : '')}`,
  }
}

/** 教材例句辨形：给出句中某个词形，判断它的语法形式 */
function genTextbookForm(ex: SmythExample, rng: Rng): Exercise | null {
  const grams = [...new Set(ex.t.tf.map(([, g]) => g))].filter((g) => g && g !== ex.t.gram)
  if (grams.length < 3) return null
  const ds = sampleN(grams, 3, rng)
  const { options, answerId } = makeOptions(ex.t.gram, ds, rng)
  return {
    kind: 'textbookForm', mode: 'choice',
    prompt: `句中的「${ex.t.form}」是什么形式？`,
    sub: `Smyth §${ex.n}${ex.src ? `　${ex.src}` : ''}`,
    sentence: ex.greek,
    options, answerId,
    explain: `${ex.t.form} 是 ${ex.t.gram}。${ex.zh ? `\n${ex.zh}` : (ex.en ? `\n译文：${ex.en}` : '')}`,
  }
}

/** 教材例句译义：选出与这句希腊语对应的译文 */
function genTextbookMeaning(
  ex: SmythExample, pool: SmythExample[], rng: Rng,
): Exercise | null {
  // 选项用中文（面向中文读者）；Smyth 的英文译文放在解析里一并给出
  const correct = ex.zh
  if (!correct) return null
  const others = pool.filter((e) => e.zh && e.zh !== correct)
  const ds = [...new Set(sampleN(others, 16, rng).map((e) => e.zh!))].slice(0, 3)
  if (ds.length < 3) return null
  const { options, answerId } = makeOptions(correct, ds, rng)
  return {
    kind: 'textbookMeaning', mode: 'choice',
    prompt: '这句古典希腊语的意思是？',
    sub: `Smyth §${ex.n}${ex.src ? `　${ex.src}` : ''}`,
    sentence: ex.greek,
    options, answerId,
    explain: `${correct}${ex.en ? `
Smyth 英译：${ex.en}` : ''}`,
  }
}

// ---------------------------------------------------------------- 调度

export interface GenContext {
  paradigms: Paradigm[]
  endings: EndingGroup[]
  letters: Letter[]
  /** 教材例句（Smyth），按单元取用 */
  smyth: SmythExample[]
}

/** 按题型生成一道题；数据不够时返回 null（调用方跳过并换题型） */
export function generate(kind: Kind, ctx: GenContext, rng: Rng = Math.random): Exercise | null {
  const { paradigms, endings, letters, smyth } = ctx
  try {
    switch (kind) {
      case 'chooseForm': {
        const p = pick(paradigms, rng); return p ? genChooseForm(p, rng) : null
      }
      case 'parseForm': {
        const p = pick(paradigms, rng); return p ? genParseForm(p, rng) : null
      }
      case 'typeForm': {
        const p = pick(paradigms, rng); return p ? genTypeForm(p, rng) : null
      }
      case 'matchForms': {
        const p = pick(paradigms, rng); return p ? genMatchForms(p, rng) : null
      }
      case 'orderCases': {
        const p = pick(paradigms, rng); return p ? genOrderCases(p, rng) : null
      }
      case 'oddOneOut': {
        const p = pick(paradigms, rng); return p ? genOddOneOut(p, rng) : null
      }
      case 'cloze': {
        const p = pick(paradigms, rng); return p ? genCloze(p, rng) : null
      }
      case 'chooseEnding': {
        const g = pick(endings, rng); return g ? genChooseEnding(g, endings, rng) : null
      }
      case 'endingToGram':
        return genEndingToGram(endings, rng)
      case 'letterCase':
        return genLetterCase(letters, rng)
      case 'letterNeighbor':
        return genLetterNeighbor(letters, rng)
      case 'finalSigma':
        return genFinalSigma(paradigms, rng)
      case 'textbookCloze': {
        const e = pick(smyth, rng); return e ? genTextbookCloze(e, rng) : null
      }
      case 'textbookForm': {
        const e = pick(smyth, rng); return e ? genTextbookForm(e, rng) : null
      }
      case 'textbookMeaning': {
        const e = pick(smyth, rng); return e ? genTextbookMeaning(e, smyth, rng) : null
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

/** 连出 n 道题，保证同一关内不重复（题干相同视为重复） */
export function buildLevel(
  kinds: Kind[], n: number, ctx: GenContext, rng: Rng = Math.random,
): Exercise[] {
  const out: Exercise[] = []
  const seen = new Set<string>()
  // 某个题型连续出不了题（比如依赖的数据这一关没有）就把它剔除，
  // 否则会一直重试它直到耗尽上限，把关卡静默截断成两三题。
  const active = [...kinds]
  const fails = new Map<Kind, number>()
  let guard = 0
  while (out.length < n && active.length > 0 && guard < n * 60) {
    guard++
    const kind = active[out.length % active.length]
    const ex = generate(kind, ctx, rng)
    if (!ex) {
      const f = (fails.get(kind) ?? 0) + 1
      fails.set(kind, f)
      if (f >= 12) {
        fails.delete(kind)
        active.splice(active.indexOf(kind), 1)
      }
      continue
    }
    fails.set(kind, 0)
    const key = contentKey(ex)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ex)
  }
  return out
}

/** 题目内容指纹：同一种题型的题干可能相同（如配对题），必须把实际内容也算进去 */
function contentKey(ex: Exercise): string {
  switch (ex.mode) {
    case 'choice': return `${ex.prompt}|${ex.options.map((o) => o.text).join(',')}`
    case 'match': return `${ex.prompt}|${ex.pairs.map((p) => `${p.left}:${p.right}`).join(',')}`
    case 'order': return `${ex.prompt}|${ex.correct.join(',')}`
    case 'type': return `${ex.prompt}|${ex.answer}`
  }
}

/** 判定用户答案 */
export function isCorrect(ex: Exercise, answer: unknown): boolean {
  if (ex.mode === 'choice') return answer === ex.answerId
  if (ex.mode === 'type') return foldGreek(String(answer).trim()) === foldGreek(ex.answer)
  if (ex.mode === 'order') return JSON.stringify(answer) === JSON.stringify(ex.correct)
  if (ex.mode === 'match') {
    const a = answer as Record<string, string>
    return ex.pairs.every((p) => a[p.left] === p.right)
  }
  return false
}

/** 选择题：返回某个选项文本是否是正确答案（渲染对错用） */
export function optionIsRight(ex: ChoiceExercise, text: string): boolean {
  return ex.options.find((o) => o.id === ex.answerId)?.text === text
}
