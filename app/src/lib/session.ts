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
 * 「连续答对」的目标次数。
 *
 * 照搬「不背单词」的核心机制（其依据是《学习这回事》里的「单人纸牌游戏法」）：
 * 一个词必须**连续答对 4 次**才算学会；中间错一次，「连对」清零重新累计；
 * 而且每次重新出现的间隔逐次拉长（瞬间记忆 → 短期 → 长期）。
 */
export const RECOGNIZE_TARGET = 4

/** 参与「连对计数」的题型。拼写不参与——拼写是辨识全部通过之后的收尾环节。 */
export const RECOGNIZE_KINDS: SessionStepKind[] = ['learn', 'review', 'choice', 'audio', 'recall']

/**
 * 重新排队时出什么题：四选一与翻卡自评交替。
 * 「不背单词」用的正是这两种题型。
 */
function requeueKind(streak: number): SessionStepKind {
  return streak % 2 === 0 ? 'review' : 'choice'
}

/**
 * 一次辨识作答后，决定这个词的下一个题目插到哪儿。
 *
 * 返回 null 表示已经连对够了，不必再排。
 * `rest` 是当前步骤**之后**的队列，用来定位拼写区的位置——
 * 所有重排的题目都必须插在拼写区**之前**，这样「全部辨识通过后才拼写」才成立。
 */
export function planRequeue(
  step: SessionStep,
  streak: number,
  rest: SessionStep[],
): { step: SessionStep; offset: number } | null {
  if (streak >= RECOGNIZE_TARGET) return null
  const spellAt = rest.findIndex((s) => s.kind === 'spell')
  const limit = spellAt < 0 ? rest.length : spellAt
  // 间隔逐次拉长：连对越多，下次出现得越晚
  const gap = Math.max(1, (streak + 1) * 3)
  return {
    step: { ...step, kind: requeueKind(streak) },
    offset: Math.min(limit, gap),
  }
}

/**
 * 组卷。
 *
 * 编排照「不背单词」的流程：
 *   1. 新词首次：给词选义（`learn`）
 *   2. 复习首次：翻卡自评（`review`）
 *   3. **全部辨识通过后**才进入拼写
 *
 * 但每个词要连对 4 次才算通过，答错还要重来——这没法在组卷时算出来，
 * 所以第 2 轮之后由 `planRequeue` 在作答时**动态插入**，并始终插在拼写区之前。
 * 因此这里只需铺好「首次」和「拼写」两段，中间留空给动态插入。
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
    candidates.sort((a, b) => (b.fq ?? 0) - (a.fq ?? 0))
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

  const steps: SessionStep[] = []
  const lessonOf = (w: Word) => w.ls ?? activeLessons[0]

  // 1) 新词首次曝光：给词选义
  for (const w of newWords) {
    steps.push({ kind: 'learn', wordId: w.i, lesson: lessonOf(w), phase: 'new', groupId: w.i })
  }
  // 2) 复习首次曝光：翻卡自评
  for (const c of reviewCards) {
    steps.push({ kind: 'review', wordId: c.id, lesson: c.lesson, phase: 'review', groupId: c.id })
  }
  // 3) 拼写收尾：只有全部辨识通过（队列走到这里）才会轮到
  if (settings.quizSpell) {
    for (const w of newWords) {
      steps.push({ kind: 'spell', wordId: w.i, lesson: lessonOf(w), phase: 'new', groupId: w.i })
    }
    for (const c of reviewCards) {
      steps.push({ kind: 'spell', wordId: c.id, lesson: c.lesson, phase: 'review', groupId: c.id })
    }
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
