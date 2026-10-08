/** 数据分片加载与缓存 */
import type { IndexEntry, LessonData, Manifest, NtBook, Word } from '../types'

export type { IndexEntry }

const BASE = import.meta.env.BASE_URL || './'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}data/${path}`)
  if (!res.ok) throw new Error(`加载失败: ${path} (${res.status})`)
  return (await res.json()) as T
}

let manifestPromise: Promise<Manifest> | null = null
export function loadManifest(): Promise<Manifest> {
  if (!manifestPromise) manifestPromise = getJson<Manifest>('manifest.json')
  return manifestPromise
}

const lessonCache = new Map<number, Promise<LessonData>>()
export function loadLesson(order: number): Promise<LessonData> {
  let p = lessonCache.get(order)
  if (!p) {
    p = getJson<LessonData>(`lesson-${String(order).padStart(2, '0')}.json`)
    lessonCache.set(order, p)
  }
  return p
}

const wordCache = new Map<number, Word>()
/** 已加载课程 -> 词表 */
const lessonWords = new Map<number, Map<number, Word>>()

export async function loadLessonWords(order: number): Promise<Map<number, Word>> {
  const hit = lessonWords.get(order)
  if (hit) return hit
  const data = await loadLesson(order)
  const m = new Map<number, Word>()
  for (const w of data.words) {
    w.ls = order
    m.set(w.i, w)
    wordCache.set(w.i, w)
  }
  lessonWords.set(order, m)
  return m
}

/** 取得词条：优先命中缓存，否则按课加载 */
export async function getWord(id: number, lesson?: number): Promise<Word | undefined> {
  if (wordCache.has(id)) return wordCache.get(id)
  if (lesson != null) {
    const m = await loadLessonWords(lesson)
    if (m.has(id)) return m.get(id)
  }
  return wordCache.get(id)
}

export function cachedWord(id: number): Word | undefined {
  return wordCache.get(id)
}

let indexPromise: Promise<IndexEntry[]> | null = null
export function loadIndex(): Promise<IndexEntry[]> {
  if (!indexPromise) indexPromise = getJson<IndexEntry[]>('index.json')
  return indexPromise
}

const bookCache = new Map<string, Promise<NtBook>>()
export function loadBook(file: string): Promise<NtBook> {
  let p = bookCache.get(file)
  if (!p) {
    p = getJson<NtBook>(`corpus/${file}`)
    bookCache.set(file, p)
  }
  return p
}

let audioIndexPromise: Promise<Set<string>> | null = null
/** 载入「实际存在音频」的文件清单，用于听力练习等场景筛掉没声音的词 */
export function loadAudioIndex(): Promise<Set<string>> {
  if (!audioIndexPromise) {
    audioIndexPromise = getJson<string[]>('audio-index.json')
      .then((list) => new Set(list))
      .catch(() => new Set<string>())
  }
  return audioIndexPromise
}

export function audioUrl(file?: string): string | undefined {
  if (!file) return undefined
  // file 可能是 audio/xxx.mp3（原牌组录音）或 audio-tts/xxx.m4a（TTS 生成）
  const path = file.includes('/') ? file : `audio/${file}`
  return BASE + path.split('/').map(encodeURIComponent).join('/')
}

/** 预加载某课音频清单（用 <link rel=prefetch> 意义不大，这里只做存在性登记） */
export function primeLesson(order: number): void {
  void loadLessonWords(order)
}

export interface SearchHit {
  word: Word
  lesson: number
}

/** 本地检索：支持希腊语（忽略变音符号）与中文/英文释义 */
export async function search(query: string, limit = 40): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const idx = await loadIndex()
  const folded = q
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
  const lower = q.toLowerCase()
  const out: SearchHit[] = []
  const seen = new Set<number>()
  for (const [id, word, key, lesson, gloss] of idx) {
    if (
      key.includes(folded) ||
      word.toLowerCase().includes(lower) ||
      gloss.toLowerCase().includes(lower)
    ) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ word: { i: id, w: word, s: [], z: gloss ? [gloss] : [] }, lesson })
      if (out.length >= limit) break
    }
  }
  return out
}
