import { useEffect, useState } from 'react'
import { Icon, Section } from '../../../components/ui'
import { WordSheet } from '../../../components/WordSheet'
import { READ_MODE_HINT, READ_MODE_LABEL, SentenceReader, type ReadMode } from '../../../components/SentencePlayer'

import { useWordLookup } from '../../../lib/wordLookup'
import { useStore } from '../../../store/useStore'
import type { Settings } from '../../../types'
import { AiError, aiReady, cachedTranslations, translateGreek } from '../../../lib/aiTranslate'

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

interface Para { g: string; e: string; zh?: string }
interface Chapter { n: string; label: string; paras: Para[] }

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
  /** 译文语言：中 / 英 */
  const [lang, setLang] = useState<'zh' | 'en'>('zh')
  const [showTr, setShowTr] = useState(true)
  const { lookup, detail, setDetail, missing, clearMissing } = useWordLookup()
  const { settings, saveSettings } = useStore()
  const set = (patch: Partial<typeof settings>) => void saveSettings(patch)
  /** 本机 AI 翻出来的译文（按段落下标），与内置译文合并显示 */
  /** 已渲染的段落数（分段渲染，见下方 PAGE 的说明） */
  const [shown, setShown] = useState(25)
  const [aiZh, setAiZh] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)

  useEffect(() => { setAt(null); void loadWork(work.id).then(setChapters) }, [work.id])
  // 换章、换翻译语言都要从头开始分段
  useEffect(() => { setShown(25) }, [at, work.id, lang])

  // 换章时把本机已缓存的 AI 译文读回来，避免重复花额度。
  //
  // ⚠️ 这里修过两个性能问题：
  //   1. 原来是**逐段 await** `cachedTranslation` —— 一章最多 714 段就是 714 次
  //      IndexedDB 往返，换章会卡住一两秒。现在用 `cachedTranslations` 一次事务读完。
  //   2. 依赖原来是整个 `settings` **对象引用**，而 `saveSettings` 每次都会换新引用，
  //      所以切朗读模式、改重音幅度、填 AI Key 都会让这个循环整套重跑。
  //      而缓存 key 只受 aiModel 影响，依赖收窄到它。
  const aiModel = settings.aiModel
  useEffect(() => {
    setAiZh({}); setAiErr(null)
    if (at === null || !chapters) return
    const c = chapters[at]
    if (!c) return
    let alive = true
    void (async () => {
      const idx: number[] = []
      const texts: string[] = []
      for (let i = 0; i < c.paras.length; i++) {
        if ((c.paras[i].zh || '').trim()) continue
        idx.push(i); texts.push(c.paras[i].g)
      }
      if (!texts.length) return
      const hits = await cachedTranslations({ aiModel } as Settings, texts)
      const found: Record<number, string> = {}
      hits.forEach((h, k) => { if (h) found[idx[k]] = h })
      if (alive && Object.keys(found).length) setAiZh(found)
    })()
    return () => { alive = false }
  }, [at, chapters, aiModel])

  // ── 分段渲染
  //
  // 之前是 `c.paras.map` 把整卷一次挂上去：希罗多德卷 1 有 714 段 / 29,066 词，
  // 每个词是 span>button，**约 6 万个 DOM 节点**，首屏必卡、滚动掉帧。
  // 现在先渲染 25 段，底部「继续加载」每次再加 25 段。
  // 刻意没用虚拟列表：段落高度不定、还要支持全文选中与 Ctrl+F 查找，
  // 虚拟化在这里收益抵不过复杂度（审查报告 E1 的结论）。
  const PAGE = 25

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
  const zhAt = (i: number) => (c.paras[i].zh || '').trim() || aiZh[i] || ''
  const hasZh = c.paras.some((_, i) => zhAt(i))
  /** 还没有任何译文的段落下标 */
  const pending = c.paras.map((_, i) => i).filter((i) => !zhAt(i))

  /** 用用户的 Key 把本章缺译文的段落翻出来 */
  const runTranslate = async () => {
    const idx = pending
    if (!idx.length) return
    setAiErr(null); setBusy({ done: 0, total: idx.length })
    try {
      const r = await translateGreek(settings, idx.map((i) => c.paras[i].g), undefined,
        (done, total) => setBusy({ done, total }))
      const got: Record<number, string> = {}
      r.zh.forEach((v, k) => { if (v) got[idx[k]] = v })
      setAiZh((prev) => ({ ...prev, ...got }))
      if (r.error) setAiErr(`${r.error.message}${r.error.hint ? '（' + r.error.hint + '）' : ''}`)
    } catch (e) {
      const err = e as AiError
      setAiErr(`${err.message}${err.hint ? '（' + err.hint + '）' : ''}`)
    } finally { setBusy(null) }
  }
  return (
    <div>
      <WorkHeader work={work} onBack={() => setAt(null)} backLabel="返回章节" />

      {/* 章节导航 + 译文语言开关，与宗教版式一致 */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{c.label}</span>
        <span className="flex items-center gap-2">
          <span className="flex gap-0.5 rounded-lg bg-ink-100 p-0.5 dark:bg-white/10" title="朗读方式">
            {(['sentence', 'continuous', 'paragraph'] as ReadMode[]).map((m) => (
              <button
                key={m}
                className={`rounded-md px-2 py-1 text-[11px] transition ${settings.readMode === m ? 'bg-white font-medium shadow-sm dark:bg-white/15' : 'text-ink-500'}`}
                title={READ_MODE_HINT[m]}
                onClick={() => set({ readMode: m })}
              >
                {READ_MODE_LABEL[m]}
              </button>
            ))}
          </span>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 ${showTr && lang === 'zh' ? '!bg-aegean-50 !text-aegean-700' : ''}`}
            disabled={!hasZh}
            title={hasZh ? '显示中文译文' : '这部作品尚无中文译文'}
            onClick={() => { setLang('zh'); setShowTr(true) }}
          >
            中
          </button>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 ${showTr && lang === 'en' ? '!bg-aegean-50 !text-aegean-700' : ''}`}
            onClick={() => { setLang('en'); setShowTr(true) }}
          >
            英
          </button>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 ${!showTr ? '!bg-ink-100 dark:!bg-white/10' : ''}`}
            onClick={() => setShowTr((v) => !v)}
            title="隐藏译文，只看原文"
          >
            {showTr ? '隐藏' : '译文'}
          </button>
          {/* 这里原来还有一组「上一章 / 下一章」文字按钮，与页面底部的按钮重复。
              而且它只 setAt()、**没有 window.scrollTo(0, 0)** ——
              切章后会停在新章的中间位置，看起来像「点错了」。
              底部那组是对的（切章 + 回到顶部），所以删掉这组。 */}
        </span>
      </div>

      {!hasZh && !aiReady(settings) && (
        <p className="mb-3 text-[11px] text-ink-400">
          这部作品的中文译文正在陆续补齐；点「英」可先看英译。
        </p>
      )}

      {/* AI 翻译入口：只在还有段落缺译文、且用户已配好 Key 时出现 */}
      {!!pending.length && aiReady(settings) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={!!busy} onClick={() => void runTranslate()}>
            {busy ? `翻译中… ${busy.done}/${busy.total}` : `AI 翻译本章（${pending.length} 段）`}
          </button>
          <span className="text-[11px] text-ink-400">用你自己的 Key，译文缓存在本机</span>
        </div>
      )}
      {aiErr && (
        <p className="mb-3 rounded-xl bg-wine-50 px-3 py-2 text-[11px] leading-relaxed text-wine-700 dark:bg-wine-900/25 dark:text-wine-300">
          {aiErr}
        </p>
      )}

      <div className="space-y-4">
        {c.paras.slice(0, shown).map((p, i) => (
          <div key={i} className="card-surface p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-ink-300">{i + 1}</span>
            </div>
            {/* 按句切分后逐句朗读：整段一次读完会有「莫名停顿」，也没法精听 */}
            <SentenceReader
              text={p.g}
              mode={settings.readMode as ReadMode}
              onWord={lookup}
              className="text-[19px] leading-loose"
            />
            {showTr && lang === 'zh' && zhAt(i) && (
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                {zhAt(i)}
                {!(c.paras[i].zh || '').trim() && (
                  <span className="ml-1.5 align-middle text-[10px] text-aegean-500">AI</span>
                )}
              </p>
            )}
            {showTr && lang === 'en' && p.e && (
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{p.e}</p>
            )}
          </div>
        ))}
      </div>

      {/* 分段加载：长卷（希罗多德卷 1 = 714 段 / 2.9 万词）一次全挂会卡死 */}
      {shown < c.paras.length && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <button className="btn-ghost" onClick={() => setShown((n) => n + PAGE)}>
            继续加载（还有 {c.paras.length - shown} 段）
          </button>
          <button className="text-[11px] text-ink-400 underline" onClick={() => setShown(c.paras.length)}>
            一次显示全部 {c.paras.length} 段
          </button>
        </div>
      )}

      {/* 查词面板：与宗教完全一致 */}
      <WordSheet word={detail} onClose={() => setDetail(null)} compact />

      {missing && (
        <div className="mt-3 card-surface p-3 text-xs text-ink-500">
          <div className="flex items-center gap-2">
            <span className="greek text-base text-ink-700 dark:text-ink-200">{missing}</span>
            <span>词表未收录（以新约词汇为主）</span>
            <button className="btn-ghost ml-auto !px-2 !py-1" onClick={clearMissing}>知道了</button>
          </div>
          {/* 词表外的词形给个出口，比"查不到"就结束有用 */}
          <a className="btn-ghost mt-2 inline-flex"
            href={`https://logeion.uchicago.edu/${encodeURIComponent(missing)}`}
            target="_blank" rel="noreferrer">到 Logeion 查这个词 →</a>
        </div>
      )}

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
