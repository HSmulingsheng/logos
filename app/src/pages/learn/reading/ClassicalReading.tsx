import { useEffect, useState } from 'react'
import { Icon, Section } from '../../../components/ui'
import { SpeakSentence } from '../../../components/SpeakSentence'

/**
 * 古典文本阅读（哲学 / 文学 / 历史）。
 *
 * 文本来自 Perseus Digital Library（`PerseusDL/canonical-greekLit`，CC BY-SA 4.0），
 * 由 `tools/fetch_perseus.py` 下载、`tools/build_reading.py` 解析为分级 JSON。
 * 希腊语原文与英译本按章对齐；英译本切分与原文不同时按累计长度比例对齐。
 */

const BASE = import.meta.env.BASE_URL || './'

export type ReadingGenre = '宗教' | '哲学' | '文学' | '历史'

export interface WorkMeta {
  id: string
  genre: ReadingGenre
  author: string
  authorZh: string
  title: string
  titleZh: string
  verse: boolean
  chapters: number
  paras: number
  /** 只在作品文件里出现，索引里没有 */
  source?: string
  license?: string
}

interface Chapter { n: string; label: string; paras: { g: string; e: string }[] }

let indexCache: WorkMeta[] | null = null
export async function loadReadingIndex(): Promise<WorkMeta[]> {
  if (indexCache) return indexCache
  const res = await fetch(`${BASE}data/reading/index.json`)
  if (!res.ok) return []
  indexCache = (await res.json()) as WorkMeta[]
  return indexCache
}

const workCache = new Map<string, Chapter[]>()
async function loadWork(id: string): Promise<Chapter[]> {
  const hit = workCache.get(id)
  if (hit) return hit
  const res = await fetch(`${BASE}data/reading/${id.replace('/', '.')}.json`)
  if (!res.ok) return []
  const data = (await res.json()) as { chapters: Chapter[] }
  workCache.set(id, data.chapters)
  return data.chapters
}

/** 按体裁列出作品 */
export function GenreWorks({ genre, onOpen }: { genre: ReadingGenre; onOpen: (w: WorkMeta) => void }) {
  const [works, setWorks] = useState<WorkMeta[] | null>(null)
  useEffect(() => { void loadReadingIndex().then((all) => setWorks(all.filter((w) => w.genre === genre))) }, [genre])

  if (!works) return <div className="skeleton h-24" />
  if (!works.length) return <p className="p-4 text-sm text-ink-400">这个分类还没有文本。</p>

  return (
    <div className="space-y-2">
      {works.map((w) => (
        <button key={w.id} onClick={() => onOpen(w)}
          className="card-surface flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-white dark:hover:bg-white/[.07]">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-aegean-50 text-lg text-aegean-600 dark:bg-aegean-900/40 dark:text-aegean-300">
            <span className="greek">{w.author.slice(0, 1)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{w.authorZh}《{w.titleZh}》</div>
            <p className="greek mt-0.5 truncate text-[11px] text-ink-400">{w.author} · {w.title}</p>
          </div>
          <span className="shrink-0 text-[11px] text-ink-400">
            {w.verse ? '韵文' : '散文'} · {w.chapters} 章
          </span>
        </button>
      ))}
    </div>
  )
}

/** 打开一部作品：先选章，再逐段对照阅读 */
export function WorkReader({ work, onBack }: { work: WorkMeta; onBack: () => void }) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [at, setAt] = useState<number | null>(null)

  useEffect(() => { setAt(null); void loadWork(work.id).then(setChapters) }, [work.id])

  if (!chapters) return <div className="skeleton h-40" />

  if (at === null) {
    return (
      <div>
        <WorkHeader work={work} onBack={onBack} />
        <Section title="选择章节" hint={`共 ${chapters.length} 章 · 希腊语原文与英译对照`}>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {chapters.map((c, i) => (
              <button key={i} onClick={() => setAt(i)}
                className="card-surface px-2 py-2.5 text-center text-xs transition hover:bg-white dark:hover:bg-white/[.07]">
                {c.label}
              </button>
            ))}
          </div>
        </Section>
      </div>
    )
  }

  const c = chapters[at]
  return (
    <div>
      <WorkHeader work={work} onBack={() => setAt(null)} backLabel="返回章节" />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">{c.label}</span>
        <span className="flex gap-2">
          <button disabled={at === 0} onClick={() => setAt(at - 1)}
            className="rounded-lg px-2.5 py-1 text-xs text-aegean-600 disabled:opacity-30 hover:underline">上一章</button>
          <button disabled={at >= chapters.length - 1} onClick={() => setAt(at + 1)}
            className="rounded-lg px-2.5 py-1 text-xs text-aegean-600 disabled:opacity-30 hover:underline">下一章</button>
        </span>
      </div>

      <div className="space-y-4">
        {c.paras.map((p, i) => (
          <div key={i} className="card-surface p-4">
            <div className="mb-1.5 flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-ink-300">{i + 1}</span>
              <p className="greek flex-1 text-[15px] leading-[1.9] text-ink-800 dark:text-ink-100">{p.g}</p>
              <SpeakSentence text={p.g} className="!h-7 !w-7" />
            </div>
            {p.e && (
              <p className="mt-2 border-l-2 border-ink-100 pl-3 text-[13px] leading-relaxed text-ink-500 dark:border-white/10 dark:text-ink-400">
                {p.e}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-between">
        <button disabled={at === 0} onClick={() => { setAt(at - 1); window.scrollTo(0, 0) }}
          className="rounded-xl bg-ink-100 px-4 py-2 text-xs disabled:opacity-30 dark:bg-white/10">← 上一章</button>
        <button disabled={at >= chapters.length - 1} onClick={() => { setAt(at + 1); window.scrollTo(0, 0) }}
          className="rounded-xl bg-ink-100 px-4 py-2 text-xs disabled:opacity-30 dark:bg-white/10">下一章 →</button>
      </div>

      <p className="mt-6 text-center text-[10px] leading-relaxed text-ink-300">
        文本来源：{work.source || 'Perseus Digital Library'} · {work.license || 'CC BY-SA 4.0'}
      </p>
    </div>
  )
}

function WorkHeader({ work, onBack, backLabel = '返回' }: { work: WorkMeta; onBack: () => void; backLabel?: string }) {
  return (
    <div className="mb-4">
      <button onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-sm text-aegean-600 hover:underline dark:text-aegean-300">
        <Icon.Back className="h-4 w-4" /> {backLabel}
      </button>
      <h2 className="text-lg font-semibold">{work.authorZh}《{work.titleZh}》</h2>
      <p className="greek mt-0.5 text-xs text-ink-400">{work.author} · {work.title}</p>
    </div>
  )
}
