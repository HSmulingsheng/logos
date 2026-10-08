import { useEffect, useMemo, useState } from 'react'
import type { NtBook, NtVerse, Word } from '../types'
import { useStore } from '../store/useStore'
import { getWord, loadBook, loadManifest } from '../lib/data'
import { foldGreek } from '../lib/greek'
import { playAudio } from '../lib/audio'
import { SpeakSentence } from '../components/SpeakSentence'
import { loadPos, savePos } from '../lib/readerPos'
import { Icon, Sheet, LevelTag } from '../components/ui'
import { SpeakButton, WordDetail } from '../components/WordDetail'

interface LookupHit { wordId: number; lesson: number; word: string }

export function Reader({
  onExit, initialBookIdx, initialChapter,
}: {
  onExit: () => void
  initialBookIdx?: number
  initialChapter?: number
}) {
  const { manifest, cards, toggleFav } = useStore()
  const start = loadPos()
  const [bookIdx, setBookIdx] = useState(initialBookIdx ?? start.bookIdx)
  const [chapter, setChapter] = useState(initialChapter ?? start.chapter)
  const [book, setBook] = useState<NtBook | null>(null)
  const [showZh, setShowZh] = useState(true)
  const [detail, setDetail] = useState<Word | null>(null)
  const [loading, setLoading] = useState(false)
  const [formIndex, setFormIndex] = useState<Record<string, [number, number]>>({})
  const [manifestLocal, setManifestLocal] = useState(manifest)
  const [cursorWord, setCursorWord] = useState<string | null>(null)

  useEffect(() => {
    if (!manifestLocal) void loadManifest().then(setManifestLocal)
  }, [manifestLocal])

  // 词形 -> 词条 反查索引（由 data/formindex.json 提供）
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL || './'}data/formindex.json`)
        if (res.ok) setFormIndex(await res.json())
      } catch { /* 忽略：没有索引时退化为整词匹配 */ }
    })()
  }, [])

  const books = manifestLocal?.books ?? []

  useEffect(() => {
    if (!books.length) return
    setLoading(true)
    void loadBook(books[bookIdx].file)
      .then((b) => {
        setBook(b)
        // 首次进入沿用上次读到的章；切换书卷时回到第 1 章
        setChapter((c) => Math.max(1, c))
      })
      .finally(() => setLoading(false))
  }, [bookIdx, books.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const chapters = useMemo(() => {
    if (!book) return []
    return [...new Set(book.verses.map((v) => v.c))].sort((a, b) => a - b)
  }, [book])

  const verses = useMemo(
    () => (book?.verses ?? []).filter((v) => v.c === chapter),
    [book, chapter],
  )

  useEffect(() => { savePos({ bookIdx, chapter }) }, [bookIdx, chapter])

  const lookup = async (token: string) => {
    const clean = token.replace(/[^\p{Script=Greek}]/gu, '')
    if (!clean) return
    setCursorWord(clean)
    const key = foldGreek(clean)
    const hit = formIndex[key]
    if (hit) {
      const [id, lesson] = hit
      const w = await getWord(id, lesson)
      if (w) { setDetail(w); playAudio(w.au, w.w); return }   // 打开即朗读，之后按 R 重放
    }
    // 退化为「首几个字母相同」的候选（取前 4 个字母）
    const stem = key.slice(0, Math.max(3, Math.floor(key.length * 0.6)))
    const cand = Object.entries(formIndex).find(([k]) => k.startsWith(stem))
    if (cand) {
      const [id, lesson] = cand[1]
      const w = await getWord(id, lesson)
      if (w) { setDetail(w); playAudio(w.au, w.w); return }   // 打开即朗读，之后按 R 重放
    }
    setDetail(null)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink-50/95 backdrop-blur-xl dark:bg-ink-950/95">
      <header className="mx-auto w-full max-w-2xl px-4 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <button className="btn-ghost !px-2.5 !py-1.5" onClick={onExit}><Icon.Back className="h-4 w-4" /></button>
          <h1 className="text-lg font-semibold">读新约</h1>
          <span className="chip ml-auto">SBLGNT · 和合本</span>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 ${showZh ? '!bg-aegean-50 !text-aegean-700' : ''}`}
            onClick={() => setShowZh((v) => !v)}
            title="切换中文译文"
          >
            中
          </button>
        </div>

        {/* 书卷选择 */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {books.map((b, i) => (
            <button key={b.en}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs transition ${
                i === bookIdx ? 'bg-aegean-500 font-medium text-white' : 'bg-white/70 text-ink-600 hover:bg-white dark:bg-white/5 dark:text-ink-300'
              }`}
              onClick={() => { setBookIdx(i); setChapter(1) }}>
              {b.zh}
            </button>
          ))}
          {!books.length && <div className="skeleton h-7 w-40" />}
        </div>

        {/* 章选择 */}
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {chapters.map((c) => (
            <button key={c}
              className={`h-7 min-w-7 rounded-md px-1.5 text-xs transition ${
                c === chapter ? 'bg-ink-900 font-medium text-white dark:bg-white dark:text-ink-900' : 'bg-white/70 text-ink-500 hover:bg-white dark:bg-white/5 dark:text-ink-300'
              }`}
              onClick={() => setChapter(c)}>
              {c}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-8">
        {loading && <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-16 w-full" />)}</div>}
        {!loading && verses.map((v) => (
          <VerseBlock key={`${v.c}:${v.v}`} verse={v} showZh={showZh} onWord={lookup} />
        ))}
        {!loading && verses.length === 0 && (
          <p className="py-16 text-center text-sm text-ink-400">该章暂无数据</p>
        )}
      </main>

      <Sheet open={!!detail} onClose={() => setDetail(null)} onReplay={() => detail && playAudio(detail.au, detail.w)}>
        {detail ? (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="greek text-3xl">{detail.e || detail.w}</h2>
              <SpeakButton word={detail} />
              <button className="btn-ghost ml-auto !px-2 !py-1.5" onClick={() => void toggleFav(detail.i)}>
                {cards.get(detail.i)?.fav ? <Icon.StarFill className="h-4 w-4 text-amber-400" /> : <Icon.Star className="h-4 w-4" />}
              </button>
            </div>
            <WordDetail word={detail} compact />
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-ink-400">
            词典中没有「{cursorWord}」这个词形
            <p className="mt-1 text-xs">可能是不规则形式，或尚未收录；可到 Logeion 查询。</p>
            {cursorWord && (
              <a className="btn-ghost mt-3 inline-flex"
                href={`https://logeion.uchicago.edu/${encodeURIComponent(cursorWord)}`}
                target="_blank" rel="noreferrer">到 Logeion 查</a>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function VerseBlock({ verse, showZh, onWord }: { verse: NtVerse; showZh: boolean; onWord: (w: string) => void }) {
  const toks = verse.g.split(/\s+/)
  return (
    <div className="mb-4 border-b border-ink-100 pb-4 last:border-0 dark:border-white/10">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-medium text-aegean-600 dark:text-aegean-400">
          {verse.b} {verse.c}:{verse.v}
        </span>
        <SpeakSentence text={verse.g} className="ml-auto !h-6 !w-6" />
      </div>
      <p className="greek text-[19px] leading-loose">
        {toks.map((t, i) => (
          <span key={i}>
            <button
              className="rounded px-0.5 transition hover:bg-aegean-100 hover:text-aegean-900 dark:hover:bg-aegean-900/50"
              onClick={() => void onWord(t)}
            >
              {t}
            </button>
            {i < toks.length - 1 ? ' ' : ''}
          </span>
        ))}
      </p>
      {showZh && <p className="mt-1.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{verse.z}</p>}
    </div>
  )
}
