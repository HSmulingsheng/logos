/** 全局状态（zustand） */
import { create } from 'zustand'
import type {
  CardRecord, DayStat, Lesson, Manifest, ReviewLogRecord, Settings, Word,
} from '../types'
import * as db from '../lib/db'
import { loadLessonWords, loadManifest } from '../lib/data'
import { applyRating, newCardRecord, type Grade } from '../lib/srs'
import {
  buildQueue, emptyDay, planRequeue, todayKey, RECOGNIZE_KINDS, type QueueResult,
} from '../lib/session'
import type { SessionStep } from '../types'

interface State {
  ready: boolean
  error: string | null
  manifest: Manifest | null
  settings: Settings
  cards: Map<number, CardRecord>
  days: DayStat[]
  today: DayStat
  lessonWords: Map<number, Word[]>
  lessons: Lesson[]
  /** 当前会话 */
  queue: SessionStep[]
  cursor: number
  /** 会话内每个词的「连续答对」次数（辨识阶段）；达到 RECOGNIZE_TARGET 即出队 */
  recognize: Record<number, number>
  sessionStats: { new: number; review: number; right: number; wrong: number; startedAt: number }

  init: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  ensureLesson: (order: number) => Promise<void>
  /**
   * 开始一次学习。
   * `mode` 决定只出新词、只出复习还是两者都出；`only` 进一步限定到具体词条。
   */
  startSession: (opts?: { only?: number[]; mode?: 'all' | 'new' | 'review' }) => Promise<void>
  advance: () => void
  submit: (step: SessionStep, grade: Grade, ms: number, correct?: boolean) => Promise<void>
  toggleFav: (id: number) => Promise<void>
  suspend: (id: number, on: boolean) => Promise<void>
  resetWord: (id: number) => Promise<void>
  refreshToday: () => Promise<void>
}

function mapOf(cards: CardRecord[]): Map<number, CardRecord> {
  return new Map(cards.map((c) => [c.id, c]))
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  manifest: null,
  settings: db.DEFAULT_SETTINGS,
  cards: new Map(),
  days: [],
  today: emptyDay(),
  lessonWords: new Map(),
  lessons: [],
  queue: [],
  cursor: 0,
  recognize: {},
  sessionStats: { new: 0, review: 0, right: 0, wrong: 0, startedAt: Date.now() },

  async init() {
    try {
      const [manifest, settings, cards, days] = await Promise.all([
        loadManifest(),
        db.loadSettings(),
        db.allCards(),
        db.allDays(),
      ])
      const key = todayKey()
      let today = days.find((d) => d.day === key)
      if (!today) {
        today = emptyDay(key)
        await db.putDay(today)
      }
      const lessonWords = new Map<number, Word[]>()
      for (const order of settings.activeLessons.length ? settings.activeLessons : [1]) {
        const m = await loadLessonWords(order)
        lessonWords.set(order, [...m.values()])
      }
      set({
        ready: true, manifest, settings, cards: mapOf(cards),
        days: days.some((d) => d.day === key) ? days : [...days, today],
        today, lessonWords, lessons: manifest.lessons,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  async saveSettings(patch) {
    const settings = { ...get().settings, ...patch }
    await db.saveSettings(settings)
    set({ settings })
    if (patch.activeLessons) {
      const lw = new Map(get().lessonWords)
      for (const order of settings.activeLessons) {
        if (!lw.has(order)) {
          const m = await loadLessonWords(order)
          lw.set(order, [...m.values()])
        }
      }
      set({ lessonWords: lw })
    }
  },

  async ensureLesson(order) {
    const lw = get().lessonWords
    if (lw.has(order)) return
    const m = await loadLessonWords(order)
    const next = new Map(lw)
    next.set(order, [...m.values()])
    set({ lessonWords: next })
  },

  async startSession(opts) {
    const { settings, cards, lessonWords, today } = get()
    const q: QueueResult = buildQueue({
      cards, lessonWords, settings, today, only: opts?.only, mode: opts?.mode,
    })
    set({
      queue: q.steps,
      cursor: 0,
      recognize: {},
      sessionStats: {
        new: q.newCount, review: q.reviewCount, right: 0, wrong: 0, startedAt: Date.now(),
      },
    })
  },

  advance() {
    set({ cursor: get().cursor + 1 })
  },

  async submit(step, grade, ms, correct) {
    const { settings, cards, today } = get()
    const existing = cards.get(step.wordId) ?? newCardRecord(step.wordId, step.lesson)
    const out = applyRating(existing, grade, settings)
    out.card.ms = (out.card.ms ?? 0) + ms
    const key = todayKey()
    const day: DayStat = { ...today, ms: today.ms + ms }
    const isNewIntro = !cards.has(step.wordId) || cards.get(step.wordId)!.state === 0
    if (step.kind === 'learn') {
      day.newCount += 1
      day.words += 1
    } else if (step.phase === 'review') {
      day.reviewCount += 1
    }
    if (grade === 1) day.again += 1
    else if (grade === 2) day.hard += 1
    else if (grade === 3) day.good += 1
    else if (grade === 4) day.easy += 1

    const log: ReviewLogRecord = {
      cardId: step.wordId,
      lesson: step.lesson,
      rating: grade,
      state: existing.state,
      day: key,
      ts: Date.now(),
      mode: step.kind,
      ms,
      scheduled_days: out.card.scheduled_days,
      stability: out.card.stability,
      difficulty: out.card.difficulty,
      retrievability: out.retrievability,
    }

    const nextCards = new Map(cards)
    nextCards.set(step.wordId, out.card)
    const nextDays = get().days.map((d) => (d.day === key ? day : d))
    if (!nextDays.some((d) => d.day === key)) nextDays.push(day)

    set({
      cards: nextCards, today: day, days: nextDays,
      sessionStats: {
        ...get().sessionStats,
        right: get().sessionStats.right + (correct === false ? 0 : 1),
        wrong: get().sessionStats.wrong + (correct === false ? 1 : 0),
      },
    })

    // 「连续答对 N 次才算学会」：答错清零、答对累加，未达标就重新排队。
    // 新排的题目插在拼写区之前，保证「全部辨识通过后才拼写」。
    if (RECOGNIZE_KINDS.includes(step.kind)) {
      const { recognize, queue, cursor } = get()
      const prev = recognize[step.wordId] ?? 0
      const streak = correct === false ? 0 : prev + 1
      const nextRec = { ...recognize }
      const plan = planRequeue(step, streak, queue.slice(cursor + 1))
      if (plan) {
        nextRec[step.wordId] = streak
        const at = cursor + 1 + plan.offset
        set({ recognize: nextRec, queue: [...queue.slice(0, at), plan.step, ...queue.slice(at)] })
      } else {
        delete nextRec[step.wordId]          // 已连对达标，出队
        set({ recognize: nextRec })
      }
    }
    void isNewIntro
    await Promise.all([db.putCard(out.card), db.addLog(log), db.putDay(day)])
  },

  async toggleFav(id) {
    const c = get().cards.get(id) ?? newCardRecord(id, 0)
    const next = { ...c, fav: (c.fav ? 0 : 1) as 0 | 1 }
    const cards = new Map(get().cards)
    cards.set(id, next)
    set({ cards })
    await db.putCard(next)
  },

  async suspend(id, on) {
    const c = get().cards.get(id) ?? newCardRecord(id, 0)
    const next = { ...c, suspended: (on ? 1 : 0) as 0 | 1 }
    const cards = new Map(get().cards)
    cards.set(id, next)
    set({ cards })
    await db.putCard(next)
  },

  async resetWord(id) {
    const c = get().cards.get(id)
    if (!c) return
    const next = newCardRecord(id, c.lesson)
    next.fav = c.fav
    const cards = new Map(get().cards)
    cards.set(id, next)
    set({ cards })
    await db.putCard(next)
  },

  async refreshToday() {
    const days = await db.allDays()
    const key = todayKey()
    let today = days.find((d) => d.day === key)
    if (!today) { today = emptyDay(key); await db.putDay(today) }
    set({ days, today })
  },
}))
