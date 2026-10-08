/** 阅读进度：记住上次读到哪一卷哪一章（存 localStorage） */

export interface ReaderPos {
  bookIdx: number
  chapter: number
}

const KEY = 'greek-reader-pos'

export function loadPos(): ReaderPos {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as ReaderPos
      if (typeof p.bookIdx === 'number' && typeof p.chapter === 'number') return p
    }
  } catch { /* 忽略损坏数据 */ }
  return { bookIdx: 0, chapter: 1 }
}

export function savePos(p: ReaderPos): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* 忽略配额错误 */ }
}
