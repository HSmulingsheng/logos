import { useEffect, useState } from 'react'
import type { BookRef } from '../../types'
import { Segmented, Section } from '../../components/ui'
import { loadManifest } from '../../lib/data'
import { loadPos, savePos } from '../../lib/readerPos'
import { GenreWorks, WorkReader, type ReadingGenre, type WorkMeta } from './reading/ClassicalReading'

/**
 * 分区顺序：文史哲在前，宗教殿后。
 *
 * 用户明确要求「宗教往后排，文史哲放前面」——古典文本是学古希腊语的主线，
 * 新约属于特定语域（通用希腊语），放在最后作为延伸阅读更合理。
 * 默认选中的分区也随之改成「文学」。
 */
const GENRES: { value: ReadingGenre; label: string }[] = [
  { value: '文学', label: '文学' },
  { value: '历史', label: '历史' },
  { value: '哲学', label: '哲学' },
  { value: '宗教', label: '宗教' },
]

/**
 * 「阅读」板块：按体裁分为文学 / 历史 / 哲学 / 宗教（文史哲在前，宗教殿后）。
 *   文史哲 —— 古典文本（Perseus，希腊语原文 + 英译对照）
 *   宗教   —— 新约 27 卷（SBLGNT 原文 + 和合本对照，可点词查义）
 */
export function Reading({ onOpen }: { onOpen: (bookIdx?: number, chapter?: number) => void }) {
  const [genre, setGenre] = useState<ReadingGenre>('文学')
  const [work, setWork] = useState<WorkMeta | null>(null)

  if (work) {
    return <div className="animate-fade-up"><WorkReader work={work} onBack={() => setWork(null)} /></div>
  }

  return (
    <div>
      <Segmented<ReadingGenre>
        value={genre}
        onChange={(g) => { setGenre(g); setWork(null) }}
        options={GENRES}
      />
      {genre === '宗教'
        ? <NewTestament onOpen={onOpen} />
        : <GenreWorks genre={genre} onOpen={setWork} />}
    </div>
  )
}

function NewTestament({ onOpen }: { onOpen: (bookIdx?: number, chapter?: number) => void }) {
  const [books, setBooks] = useState<BookRef[]>([])
  const [pos, setPos] = useState(loadPos())

  useEffect(() => {
    void loadManifest().then((m) => setBooks(m.books))
    setPos(loadPos())
  }, [])

  const current = books[pos.bookIdx]

  const jump = (bookIdx: number, chapter = 1) => {
    savePos({ bookIdx, chapter })
    setPos({ bookIdx, chapter })
    onOpen(bookIdx, chapter)
  }

  return (
    <div>
      <Section title="继续阅读">
        <button onClick={() => onOpen(pos.bookIdx, pos.chapter)}
          className="card-surface flex w-full items-center gap-4 p-4 text-left transition hover:bg-white dark:hover:bg-white/[.07]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-aegean-50 text-aegean-600 dark:bg-aegean-900/40 dark:text-aegean-300">
            <span className="greek text-lg">Α</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {current ? `${current.zh} 第 ${pos.chapter} 章` : '开始读新约'}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-400">
              SBLGNT 希腊语原文 + 和合本对照 · 点任一词可查义
            </p>
          </div>
          <span className="text-xs text-aegean-600">继续 →</span>
        </button>
      </Section>

      <Section title="按卷选读" hint="27 卷新约，点书卷名直接跳到第 1 章">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {books.map((b, i) => (
            <button key={b.en} onClick={() => jump(i)}
              className={`card-surface px-2 py-2.5 text-center text-sm transition hover:bg-white dark:hover:bg-white/[.07] ${
                i === pos.bookIdx ? 'ring-2 ring-aegean-300 dark:ring-aegean-800' : ''
              }`}>
              {b.zh}
            </button>
          ))}
          {books.length === 0 && [...Array(15)].map((_, i) => <div key={i} className="skeleton h-10" />)}
        </div>
      </Section>

      <Section title="读法建议">
        <div className="card-surface space-y-2 p-4 text-xs leading-relaxed text-ink-500">
          <p>· <b className="text-ink-700 dark:text-ink-200">先通读中文</b>，再看希腊语原文，遇到眼熟的词停下来确认。</p>
          <p>· <b className="text-ink-700 dark:text-ink-200">点你不认识的词</b>，会跳出该词的释义与全部屈折形式——这比查词典快得多。</p>
          <p>· 想收藏某个词，在弹出面板右上角点星标，之后可在「单词 → 词典 → 收藏」里集中复习。</p>
          <p>· 读物里的词形变化很多，认不出是正常的：先用「学习 → 单词」把 A2 的 400 多个核心词过一遍，再回来读会顺畅很多。</p>
        </div>
      </Section>
    </div>
  )
}
