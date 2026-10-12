import { useEffect, useState } from 'react'
import type { Word } from '../types'
import { getWord } from './data'
import { foldGreek } from './greek'
import { playAudio } from './audio'

/**
 * 词形 → 词条 的反查索引（`data/formindex.json`）。
 * 全局只取一次，两个阅读器共用，避免各自重复拉取。
 */
let cached: Record<string, [number, number]> | null = null
let inflight: Promise<Record<string, [number, number]>> | null = null

export function loadFormIndex(): Promise<Record<string, [number, number]>> {
  if (cached) return Promise.resolve(cached)
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL || './'}data/formindex.json`)
      if (res.ok) cached = (await res.json()) as Record<string, [number, number]>
    } catch { /* 忽略：没有索引时退化为查不到 */ }
    inflight = null
    return cached ?? {}
  })()
  return inflight
}

export interface WordLookup {
  /** 点一个词形，查到就打开释义面板并朗读 */
  lookup: (token: string) => Promise<void>
  detail: Word | null
  setDetail: (w: Word | null) => void
  /** 查不到时保留原词形，供界面给出提示（而不是静默失败） */
  missing: string | null
  clearMissing: () => void
}

/**
 * 点词查义。宗教（新约）与哲学/文学/历史两边共用同一套。
 *
 * ⚠️ 索引建立在**新约词表**（15,686 个词的屈折形式）之上，所以古典文本里
 * 会有一部分词形查不到——实测覆盖率：哲学 74~77%、历史 60~72%、
 * 文学（荷马）46~59%，总体约 65%。查不到时返回 `missing`，
 * 由调用方显示词形提示，不要让点击毫无反应。
 */
export function useWordLookup(): WordLookup {
  const [formIndex, setFormIndex] = useState<Record<string, [number, number]>>({})
  const [detail, setDetail] = useState<Word | null>(null)
  const [missing, setMissing] = useState<string | null>(null)

  useEffect(() => { void loadFormIndex().then(setFormIndex) }, [])

  const open = async (id: number, lesson: number) => {
    const w = await getWord(id, lesson)
    if (!w) return false
    setDetail(w)
    setMissing(null)
    playAudio(w.au, w.w)      // 打开即朗读
    return true
  }

  const lookup = async (token: string) => {
    const clean = token.replace(/[^\p{Script=Greek}]/gu, '')
    if (!clean) return
    const key = foldGreek(clean)
    const hit = formIndex[key]
    if (hit && (await open(hit[0], hit[1]))) return

    // 退化为「首几个字母相同」的候选（应对索引里没有的屈折形式）
    const stem = key.slice(0, Math.max(3, Math.floor(key.length * 0.6)))
    const cand = Object.entries(formIndex).find(([k]) => k.startsWith(stem))
    if (cand && (await open(cand[1][0], cand[1][1]))) return

    setMissing(clean)
  }

  return { lookup, detail, setDetail, missing, clearMissing: () => setMissing(null) }
}
