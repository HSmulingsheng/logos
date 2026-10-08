/** 语法闯关进度：存在本机 localStorage（和单词进度一样，不上传） */

const KEY = 'greek-grammar-progress'

export interface LevelRecord {
  /** 最好成绩（答对题数） */
  best: number
  /** 总题数 */
  total: number
  /** 完成时间戳 */
  at: number
}

export type ProgressMap = Record<string, LevelRecord>

export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProgressMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveLevel(levelId: string, best: number, total: number): ProgressMap {
  const map = loadProgress()
  const prev = map[levelId]
  map[levelId] = {
    best: Math.max(prev?.best ?? 0, best),
    total,
    at: Date.now(),
  }
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* 忽略配额错误 */ }
  return map
}

export function resetProgress(): ProgressMap {
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
  return {}
}

/**
 * 是否已通过这一关。
 *
 * 不再记星级：答错可以当场重答，人人都能拿满分，星级没有区分度，
 * 反而让「答错」变成惩罚。现在只记通过与未通过。
 */
export function isDone(rec: LevelRecord | undefined): boolean {
  return !!rec
}
