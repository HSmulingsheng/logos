/** FSRS 调度封装（基于 ts-fsrs 5.x / FSRS-6） */
import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type FSRSParameters,
  type Grade,
  type RecordLogItem,
} from 'ts-fsrs'
import type { CardRecord, Settings } from '../types'

export { Rating, State }
export type { Grade }

export function makeParams(s: Settings): FSRSParameters {
  return generatorParameters({
    request_retention: s.requestRetention,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: s.learningSteps as never,
  })
}

export function makeScheduler(s: Settings) {
  return fsrs(makeParams(s))
}

export function newCardRecord(id: number, lesson: number, now = new Date()): CardRecord {
  const c = createEmptyCard(now)
  return {
    id,
    lesson,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: 0,
    lapses: 0,
    state: c.state,
    introduced: now.getTime(),
    ms: 0,
  }
}

export function toFsrsCard(r: CardRecord): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  }
}

export function fromFsrsCard(r: CardRecord, c: Card, now: Date): CardRecord {
  return {
    ...r,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: now.getTime(),
  }
}

export interface ReviewOutcome {
  card: CardRecord
  log: RecordLogItem['log']
  retrievability: number
}

export function applyRating(
  rec: CardRecord,
  grade: Grade,
  settings: Settings,
  now = new Date(),
): ReviewOutcome {
  const f = makeScheduler(settings)
  const prev = toFsrsCard(rec)
  const rv = f.get_retrievability(prev, now, false)
  const out = f.next(prev, now, grade)
  const next: CardRecord = fromFsrsCard(rec, out.card, now)
  if (grade === Rating.Again) next.wrong = (next.wrong ?? 0) + 1
  return { card: next, log: out.log, retrievability: rv }
}

/** 预览四档间隔，用于按钮上的「1分钟 / 3天」提示 */
export function previewIntervals(
  rec: CardRecord,
  settings: Settings,
  now = new Date(),
): Record<number, { label: string; due: number }> {
  const f = makeScheduler(settings)
  const rec2 = f.repeat(toFsrsCard(rec), now)
  const out: Record<number, { label: string; due: number }> = {}
  for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    const item = rec2[grade]
    out[grade] = { label: humanInterval(item.card.due, now), due: item.card.due.getTime() }
  }
  return out
}

export function humanInterval(due: Date, now: Date): string {
  const ms = due.getTime() - now.getTime()
  const min = ms / 60000
  if (min < 1) return '<1 分钟'
  if (min < 60) return `${Math.round(min)} 分钟`
  const h = min / 60
  if (h < 24) return `${Math.round(h)} 小时`
  const d = h / 24
  if (d < 31) return `${Math.round(d)} 天`
  const mo = d / 30.44
  if (mo < 12) return `${mo.toFixed(1)} 个月`
  return `${(d / 365).toFixed(1)} 年`
}




