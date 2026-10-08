/** 学习会话：队列编排、选项生成、今日任务统计 */
import type {
  CardRecord, DayStat, Lesson, SessionStep, SessionStepKind, Settings, Word,
} from '../types'
import { State } from './srs'

export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function emptyDay(day = todayKey()): DayStat {
  return { day, newCount: 0, reviewCount: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, words: 0 }
}

export interface QueueContext {
  cards: Map<number, CardRecord>
  /** 每课的词条（用于新词挑选与选项生成） */
  lessonWords: Map<number, Word[]>
  settings: Settings
  today: DayStat
  now?: Date
  /** 若指定，则只学这些词的 id（用于「专项复习」） */
  only?: number[]
}

export interface QueueResult {
  steps: SessionStep[]
  newCount: number
  reviewCount: number
}

/**
 * 新词学完后的测验题型。
 * 注意：新词学习本身已经是「四选一」，所以后续测验优先用拼写/听音，
 * 只有在两者都关掉时才退回选义，避免连着做两次同型题。
 */
function pickKind(w: Word, settings: Settings): SessionStepKind {
  const modes: SessionStepKind[] = []
  if (settings.quizSpell) modes.push('spell')
  if (settings.quizAudio && w.au) modes.push('audio')
  if (!modes.length && settings.quizChoice) modes.push('choice')
  if (!modes.length) return 'choice'
  return modes[w.i % modes.length]
}

/**
 * 组卷：
 *  - 复习队列：已到期的旧卡（优先）
 *  - 新词队列：尚未建卡的词，按所选词书的课次顺序（或词频）
 *  - 编排：新词每 5 个一组「先学后测」，复习穿插其间（不背单词式的节奏）
 */
export function buildQueue(ctx: QueueContext): QueueResult {
  const now = ctx.now ?? new Date()
  const { cards, lessonWords, settings, today } = ctx

  const activeLessons = settings.activeLessons.length ? settings.activeLessons : [1]

  // ---- 新词
  const newBudget = Math.max(0, settings.dailyNew - today.newCount)
  const candidates: Word[] = []
  for (const order of activeLessons) {
    for (const w of lessonWords.get(order) ?? []) {
      const rec = cards.get(w.i)
      if (!rec || rec.state === State.New) {
        if (rec?.suspended) continue
        candidates.push(w)
      }
    }
  }
  if (settings.orderMode === 'frequency') {
    candidates.sort((a, b) => (b.fq ?? 0) - (a.fq ?? 0))  // 出现次数越多越靠前
  }
  let newWords = candidates.slice(0, newBudget)

  // ---- 复习
  const reviewBudget = Math.max(0, settings.dailyReviewLimit - today.reviewCount)
  let reviewCards = [...cards.values()]
    .filter((c) => c.state !== State.New && !c.suspended && c.due <= now.getTime())
    .sort((a, b) => a.due - b.due)

  if (ctx.only) {
    const set = new Set(ctx.only)
    newWords = newWords.filter((w) => set.has(w.i))
    reviewCards = reviewCards.filter((c) => set.has(c.id))
  }
  reviewCards = reviewCards.slice(0, reviewBudget)

  // ---- 编排
  const steps: SessionStep[] = []
  const reviewsPerGap = Math.ceil(reviewCards.length / Math.max(1, Math.ceil(newWords.length / 5) + 1))
  let ri = 0
  const CHUNK = 5
  for (let i = 0; i < newWords.length; i += CHUNK) {
    const chunk = newWords.slice(i, i + CHUNK)
    for (const w of chunk) {
      steps.push({ kind: 'learn', wordId: w.i, lesson: w.ls ?? activeLessons[0], phase: 'new', groupId: w.i })
    }
    // 一组学完先给一次选择：要不要把这一组拼写一遍（拼写是最能巩固词形的题型）
    if (settings.spellPrompt && settings.quizSpell) {
      steps.push({
        kind: 'offer',
        wordId: chunk[0].i,
        lesson: chunk[0].ls ?? activeLessons[0],
        phase: 'new',
        groupId: chunk[0].i,
        batch: chunk.map((w) => w.i),
      })
    }
    for (const w of chunk) {
      steps.push({ kind: pickKind(w, settings), wordId: w.i, lesson: w.ls ?? activeLessons[0], phase: 'new', groupId: w.i })
    }
    for (let k = 0; k < reviewsPerGap && ri < reviewCards.length; k++, ri++) {
      const c = reviewCards[ri]
      steps.push({ kind: 'review', wordId: c.id, lesson: c.lesson, phase: 'review', groupId: c.id })
    }
  }
  for (; ri < reviewCards.length; ri++) {
    const c = reviewCards[ri]
    steps.push({ kind: 'review', wordId: c.id, lesson: c.lesson, phase: 'review', groupId: c.id })
  }

  return { steps, newCount: newWords.length, reviewCount: reviewCards.length }
}

/** 计算某课的到期/新词统计（首页与词书页用） */
export interface LessonProgress {
  order: number
  total: number
  introduced: number
  due: number
  mastered: number
  learning: number
}

export function lessonProgress(
  lesson: Lesson,
  words: Word[],
  cards: Map<number, CardRecord>,
  now = new Date(),
): LessonProgress {
  let introduced = 0, due = 0, mastered = 0, learning = 0
  for (const w of words) {
    const c = cards.get(w.i)
    if (!c || c.state === State.New) continue
    introduced++
    if (c.due <= now.getTime()) due++
    if (c.state === State.Review && c.stability >= 30) mastered++
    else learning++
  }
  return { order: lesson.order, total: words.length, introduced, due, mastered, learning }
}

/** 生成选项（默认用释义；听音题传入 render 以显示希腊语词形） */
export function makeChoices(
  target: Word,
  pool: Word[],
  n = 4,
  render?: (w: Word) => string,
): { id: number; text: string; correct: boolean }[] {
  const gloss = render ?? ((w: Word) => (w.z.length ? w.z[0] : w.s[0] ?? ''))
  const base = gloss(target)

  // 归一化后比较，滤掉「看起来几乎一样」的干扰项
  // （牌组里有 ὁ / ἡ 这种同义条目，不作过滤的话题目会失去意义）
  const norm = (t: string) => t.replace(/[\s，、；：·,;:.!?（）()《》「」【】\-—]/g, '').toLowerCase()
  const tooSimilar = (a: string, b: string) => {
    const x = norm(a), y = norm(b)
    if (!x || !y) return true
    if (x === y || x.includes(y) || y.includes(x)) return true
    let i = 0
    while (i < x.length && i < y.length && x[i] === y[i]) i++
    return i >= 4 || (i >= 3 && Math.min(x.length, y.length) <= 4)
  }

  const others: { id: number; text: string }[] = []
  const taken = [base]
  const sorted = [...pool]
    .filter((w) => w.i !== target.i && gloss(w))
    .sort((a, b) => {
      const sa = (a.p === target.p ? 0 : 1) + Math.abs(gloss(a).length - base.length) * 0.02
      const sb = (b.p === target.p ? 0 : 1) + Math.abs(gloss(b).length - base.length) * 0.02
      return sa - sb
    })
  for (const w of sorted) {
    const g = gloss(w)
    if (taken.some((t) => tooSimilar(t, g))) continue
    taken.push(g)
    others.push({ id: w.i, text: g })
    if (others.length >= n * 6) break
  }

  const rnd = mulberry32(target.i)
  const picked: typeof others = []
  const bag = [...others]
  while (picked.length < n - 1 && bag.length) {
    const idx = Math.floor(rnd() * bag.length)
    picked.push(bag.splice(idx, 1)[0])
  }

  const all = [{ id: target.i, text: base, correct: true },
               ...picked.map((p) => ({ ...p, correct: false }))]
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 连续打卡天数 */
export function streakOf(days: DayStat[]): number {
  const set = new Set(days.filter((d) => d.newCount + d.reviewCount > 0).map((d) => d.day))
  let streak = 0
  const cur = new Date()
  // 今天没学不算断（可能还没开始）
  if (!set.has(todayKey(cur))) cur.setDate(cur.getDate() - 1)
  for (;;) {
    if (!set.has(todayKey(cur))) break
    streak++
    cur.setDate(cur.getDate() - 1)
  }
  return streak
}
