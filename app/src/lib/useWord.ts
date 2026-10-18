import { useEffect, useState } from 'react'
import type { Word } from '../types'
import { cachedWord, getWord, loadLessonWords } from './data'

/**
 * 异步取词条（带缓存与按课回退）。
 *
 * 注意：`useState` 的初始值只算一次，换词时必须主动清空/替换，
 * 否则会短暂停留在上一个词 —— 自动发音正是因此被「用旧词排的定时器」坑掉。
 *
 * 原来这是 `Study.tsx` 里的局部 hook。抽出来是因为它跟 Study 的 UI 无关，
 * 纯数据获取，其他地方要「按 id 取词」时可以直接复用。
 */
export function useWord(id: number, lesson: number): Word | undefined {
  const [w, setW] = useState<Word | undefined>(() => cachedWord(id))
  useEffect(() => {
    let alive = true
    const cached = cachedWord(id)
    if (cached) { setW(cached); return }
    setW(undefined)
    void (async () => {
      const got = (await getWord(id, lesson)) ?? (await loadLessonWords(lesson)).get(id)
      if (alive) setW(got)
    })()
    return () => { alive = false }
  }, [id, lesson])
  return w
}
