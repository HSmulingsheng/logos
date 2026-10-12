/** IndexedDB 持久化（idb 封装） */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CardRecord, DayStat, ReviewLogRecord, Settings } from '../types'

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

export async function setKV(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key)
}

export async function allCards(): Promise<CardRecord[]> {
  return (await db()).getAll('cards')
}

export async function cardsByLesson(lesson: number): Promise<CardRecord[]> {
  return (await db()).getAllFromIndex('cards', 'by_lesson', lesson)
}

export async function putCards(cards: CardRecord[]): Promise<void> {
  const d = await db()
  const tx = d.transaction('cards', 'readwrite')
  await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done])
}

export async function putCard(card: CardRecord): Promise<void> {
  await (await db()).put('cards', card)
}

export async function cardCount(): Promise<number> {
  return (await db()).count('cards')
}

export async function addLog(log: ReviewLogRecord): Promise<void> {
  await (await db()).add('logs', log)
}

export async function logsByDay(day: string): Promise<ReviewLogRecord[]> {
  return (await db()).getAllFromIndex('logs', 'by_day', day)
}

export async function allLogs(): Promise<ReviewLogRecord[]> {
  return (await db()).getAll('logs')
}

export async function getDay(day: string): Promise<DayStat | undefined> {
  return (await db()).get('days', day)
}

export async function putDay(stat: DayStat): Promise<void> {
  await (await db()).put('days', stat)
}

export async function allDays(): Promise<DayStat[]> {
  return (await db()).getAll('days')
}

export async function clearProgress(): Promise<void> {
  const d = await db()
  const tx = d.transaction(['cards', 'logs', 'days'], 'readwrite')
  await Promise.all([
    tx.objectStore('cards').clear(),
    tx.objectStore('logs').clear(),
    tx.objectStore('days').clear(),
    tx.done,
  ])
}

export const DEFAULT_SETTINGS: Settings = {
  dailyNew: 20,
  dailyReviewLimit: 200,
  requestRetention: 0.9,
  learningSteps: ['1m', '10m'],
  audioTone: 'greek',
  autoPlay: true,
  showForms: true,
  showExamples: true,
  quizChoice: true,
  quizSpell: true,
  speechRate: 168,
  speechVoice: 'grc',
  speechEngine: 'neural',
  neuralRate: 0.82,
  inputScheme: 'ios',
  quizAudio: true,
  orderMode: 'lesson',
  theme: 'light',
  activeLesson: 1,
  activeLessons: [1],
  prosodyAccent: true,
  prosodyAmp: 1,
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
