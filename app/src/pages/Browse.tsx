import { useEffect, useMemo, useState } from 'react'
import type { Word } from '../types'
import { useStore } from '../store/useStore'
import { getWord, loadIndex, type IndexEntry } from '../lib/data'
import { GreekInput } from '../components/GreekInput'
import type { InputScheme } from '../lib/greekInput'
import { Icon, Sheet, LevelTag, Empty } from '../components/ui'
import { SpeakButton, WordDetail } from '../components/WordDetail'
import { playAudio } from '../lib/audio'

type Filter = 'all' | 'fav' | 'leech' | 'due' | 'new'

/** 与数据侧 fold_key 保持一致：NFC → 去变音符号 → 小写 → ς→σ */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ς/g, 'σ')
}

export function Browse({ embedded = false }: { embedded?: boolean } = {}) {
  const { cards, toggleFav, lessons, lessonWords, ensureLesson, settings } = useStore()
  const scheme = settings.inputScheme as InputScheme
  const [index, setIndex] = useState<IndexEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [detail, setDetail] = useState<Word | null>(null)

  useEffect(() => {
    void loadIndex().then((raw) => {
      // 数据侧的键已折叠过；这里再折一次作为保险，避免两边规范化不一致导致搜索落空
      setIndex(raw.map((e) => [e[0], e[1], fold(e[1]), e[3], e[4], e[5] ?? ''] as IndexEntry))
    })
  }, [])

  const results = useMemo(() => {
    if (filter !== 'all') {
      const now = Date.now()
      const out: { id: number; word: string; lesson: number; gloss: string; ipa: string }[] = []
      for (const c of cards.values()) {
        let hit = false
        if (filter === 'fav') hit = !!c.fav
        else if (filter === 'leech') hit = (c.lapses ?? 0) >= 4
        else if (filter === 'due') hit = c.state !== 0 && c.due <= now && !c.suspended
        else if (filter === 'new') hit = c.state === 0
        if (!hit) continue
        const found = index?.find((e) => e[0] === c.id)
        out.push({ id: c.id, word: found?.[1] ?? `#${c.id}`, lesson: c.lesson, gloss: found?.[4] ?? '', ipa: found?.[5] ?? '' })
        if (out.length > 300) break
      }
      return out
    }
    if (!index) return []
    const s = q.trim()
    if (!s) return index.slice(0, 120).map((e) => ({ id: e[0], word: e[1], lesson: e[3], gloss: e[4], ipa: e[5] }))
    const folded = fold(s)
    const lower = s.toLowerCase()
    const out = []
    for (const [id, word, key, lesson, gloss, ipa] of index) {
      if (key.includes(folded) || gloss.toLowerCase().includes(lower)) {
        out.push({ id, word, lesson, gloss, ipa })
        if (out.length >= 120) break
      }
    }
    return out
  }, [index, q, filter, cards])

  const open = async (id: number, lesson: number) => {
    const w = (await getWord(id, lesson)) ?? (await (async () => { await ensureLesson(lesson); return (await getWord(id, lesson)) })())
    if (w) { setDetail(w); playAudio(w.au, w.w) }   // 打开即朗读一次，之后按 R 可重放
  }

  const levelOf = (order: number) => lessons.find((l) => l.order === order)?.level ?? ''

  return (
    <div className="animate-fade-up">
      {!embedded && <h1 className="mb-4 text-2xl font-semibold">词典</h1>}

      <div className="relative mb-3">
        <Icon.Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        {/* 支持拉丁键盘转写：打 logos 出 λογος；中文直接输入不受影响 */}
        <GreekInput
          className="w-full rounded-xl border border-ink-200 bg-white/80 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-aegean-400 focus:ring-4 focus:ring-aegean-100 dark:border-white/10 dark:bg-white/5"
          placeholder="搜索希腊语（可直接打拉丁字母）或中文释义…"
          value={q}
          onChange={(g) => { setQ(g); setFilter('all') }}
          scheme={scheme}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        />
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {([
          ['all', '全部'], ['fav', '收藏'], ['leech', '难词'], ['due', '待复习'], ['new', '未学'],
        ] as [Filter, string][]).map(([k, label]) => (
          <button key={k}
            className={`chip whitespace-nowrap ${filter === k ? '!border-aegean-300 !bg-aegean-50 !text-aegean-700' : ''}`}
            onClick={() => setFilter(k)}>
            {label}
            {k === 'fav' && ` ${[...cards.values()].filter((c) => c.fav).length}`}
            {k === 'leech' && ` ${[...cards.values()].filter((c) => (c.lapses ?? 0) >= 4).length}`}
          </button>
        ))}
      </div>

      {!index ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="skeleton h-14 w-full" />)}</div>
      ) : results.length === 0 ? (
        <Empty text="没有匹配的词条" hint={q ? `试试只输入词干，例如 "${q.slice(0, 3)}"` : '换个筛选条件看看'} />
      ) : (
        <div className="space-y-1.5">
          {results.map((r) => {
            const c = cards.get(r.id)
            return (
              <button key={r.id} onClick={() => void open(r.id, r.lesson)}
                className="card-surface flex w-full items-center gap-3 p-3 text-left transition hover:bg-white dark:hover:bg-white/[.07]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="greek text-lg">{r.word}</span>
                    <LevelTag level={levelOf(r.lesson)} />
                  </div>
                  {/* 国际音标（古典阿提卡重建）：音节用 . 分隔 */}
                  {r.ipa && <div className="ipa truncate text-[11px] text-aegean-600 dark:text-aegean-400">[{r.ipa}]</div>}
                  <p className="truncate text-xs text-ink-500">{r.gloss}</p>
                </div>
                {c?.fav ? <Icon.StarFill className="h-4 w-4 text-amber-400" /> : null}
                {c && c.state !== 0 && (
                  <span className="text-[10px] text-ink-400">
                    {c.state === 2 && c.stability >= 30 ? '已掌握' : `S=${c.stability.toFixed(1)}`}
                  </span>
                )}
                <Icon.Next className="h-4 w-4 text-ink-300" />
              </button>
            )
          })}
        </div>
      )}

      <Sheet open={!!detail} onClose={() => setDetail(null)} onReplay={() => detail && playAudio(detail.au, detail.w)}>
        {detail && (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="greek text-3xl">{detail.e || detail.w}</h2>
              <SpeakButton word={detail} />
              <div className="ml-auto flex gap-1.5">
                <button className="btn-ghost !px-2 !py-1.5" onClick={() => void toggleFav(detail.i)}>
                  {cards.get(detail.i)?.fav ? <Icon.StarFill className="h-4 w-4 text-amber-400" /> : <Icon.Star className="h-4 w-4" />}
                </button>
                <button className="btn-ghost !px-2 !py-1.5" onClick={() => playAudio(detail.au, detail.w)}>
                  <Icon.Volume className="h-4 w-4" />
                </button>
              </div>
            </div>
            <WordDetail word={detail} />
          </div>
        )}
      </Sheet>
    </div>
  )
}
