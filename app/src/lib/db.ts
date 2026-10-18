/** IndexedDB 持久化（idb 封装） */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CardRecord, DayStat, ReviewLogRecord, Settings } from '../types'
import { resetProgress } from './grammar/progress'
import { clearPos } from './readerPos'

interface GreekVocabDB extends DBSchema {
  cards: { key: number; value: CardRecord; indexes: { by_lesson: number; by_due: number } }
  logs: { key: number; value: ReviewLogRecord; indexes: { by_day: string; by_card: number } }
  days: { key: string; value: DayStat }
  kv: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<GreekVocabDB>> | null = null

export function db(): Promise<IDBPDatabase<GreekVocabDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GreekVocabDB>('greek-vocab', 1, {
      upgrade(d) {
        const cards = d.createObjectStore('cards', { keyPath: 'id' })
        cards.createIndex('by_lesson', 'lesson')
        cards.createIndex('by_due', 'due')
        const logs = d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true })
        logs.createIndex('by_day', 'day')
        logs.createIndex('by_card', 'cardId')
        d.createObjectStore('days', { keyPath: 'day' })
        d.createObjectStore('kv')
      },
    })
  }
  return dbPromise
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined
}

/**
 * 批量读。**一个事务里发 N 个请求**，而不是 N 次独立事务。
 *
 * 为什么需要：古典阅读器换章时要把本机已缓存的 AI 译文读回来，
 * 一章最多 714 段 —— 用 `getKV` 逐段 await 就是 714 次 IndexedDB 往返，
 * 实测会让换章卡住一两秒。一个事务里并发 714 个 get 则只付一次往返开销。
 */
export async function getKVMany<T>(keys: string[]): Promise<(T | undefined)[]> {
  if (!keys.length) return []
  const d = await db()
  const tx = d.transaction('kv')
  const store = tx.objectStore('kv')
  const out = await Promise.all(keys.map((k) => store.get(k) as Promise<T | undefined>))
  await tx.done
  return out
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key)
}

export async function allCards(): Promise<CardRecord[]> {
  return (await db()).getAll('cards')
}



export async function putCard(card: CardRecord): Promise<void> {
  await (await db()).put('cards', card)
}


export async function addLog(log: ReviewLogRecord): Promise<void> {
  await (await db()).add('logs', log)
}


export async function allLogs(): Promise<ReviewLogRecord[]> {
  return (await db()).getAll('logs')
}


export async function putDay(stat: DayStat): Promise<void> {
  await (await db()).put('days', stat)
}

export async function allDays(): Promise<DayStat[]> {
  return (await db()).getAll('days')
}

/**
 * 清空学习进度。
 *
 * ⚠️ 原来只清了 IndexedDB 的三张表，**漏掉了存在 localStorage 里的两处进度**：
 *   · 语法闯关进度（`grammar/progress.ts`，有现成的 `resetProgress()` 却从没被调用过）
 *   · 阅读位置（`readerPos.ts`）
 * 于是用户点「清空学习进度」、确认「不可撤销」之后，语法关卡星星和上次读到的
 * 章节还在——这与按钮的承诺不符。
 */
export async function clearProgress(): Promise<void> {
  const d = await db()
  const tx = d.transaction(['cards', 'logs', 'days'], 'readwrite')
  await Promise.all([
    tx.objectStore('cards').clear(),
    tx.objectStore('logs').clear(),
    tx.objectStore('days').clear(),
    tx.done,
  ])
  // localStorage 里的两处进度。放在 IndexedDB 事务之后，避免半途抛错时只清了一半。
  resetProgress()
  clearPos()
}

export const DEFAULT_SETTINGS: Settings = {
  dailyNew: 20,
  dailyReviewLimit: 200,
  requestRetention: 0.9,
  learningSteps: ['1m', '10m'],

  autoPlay: true,
  showForms: true,

  quizSpell: true,
  speechRate: 168,
  speechVoice: 'grc',
  speechEngine: 'neural',
  neuralRate: 0.82,
  inputScheme: 'ios',
  quizAudio: true,
  orderMode: 'lesson',
  theme: 'light',

  activeLessons: [1],
  prosodyAccent: true,
  prosodyAmp: 1,
  restoreAncient: true,
  readMode: 'sentence',
  aiProvider: 'deepseek',
  aiBaseUrl: '',
  aiModel: '',
  aiKey: '',
}

export async function loadSettings(): Promise<Settings> {
  const saved = await getKV<Partial<Settings>>('settings')
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
}

export async function saveSettings(s: Settings): Promise<void> {
  await setKV('settings', s)
}

export async function exportAll(): Promise<string> {
  const [cards, logs, days, settings] = await Promise.all([
    allCards(), allLogs(), allDays(), loadSettings(),
  ])
  return JSON.stringify({ version: 1, exportedAt: Date.now(), cards, logs, days, settings })
}

export async function importAll(json: string, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const data = JSON.parse(json) as {
    cards?: CardRecord[]; logs?: ReviewLogRecord[]; days?: DayStat[]; settings?: Settings
  }
  const d = await db()
  const stores = ['cards', 'logs', 'days'] as const
  const tx = d.transaction(stores, 'readwrite')
  if (mode === 'replace') {
    await Promise.all(stores.map((s) => tx.objectStore(s).clear()))
  }
  const jobs: Promise<unknown>[] = []
  for (const c of data.cards ?? []) jobs.push(tx.objectStore('cards').put(c))
  for (const day of data.days ?? []) jobs.push(tx.objectStore('days').put(day))
  for (const l of data.logs ?? []) {
    const { id: _drop, ...rest } = l
    jobs.push(tx.objectStore('logs').add(rest as ReviewLogRecord))
  }
  jobs.push(tx.done)
  await Promise.all(jobs)
  if (data.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...data.settings })
}
