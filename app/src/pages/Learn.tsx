import { useEffect, useState } from 'react'
import { Icon, Segmented } from '../components/ui'
import { Library, type LibraryView } from './Library'
import { Home } from './Home'
import { Grammar } from './learn/Grammar'
import { Reading } from './learn/Reading'
import { Listening } from './learn/Listening'

export type LearnView = 'vocab' | 'grammar' | 'reading' | 'listening'

/** 「学习」页：单词 / 语法 / 阅读 / 听力 四个板块 */
export function Learn({
  view, setView, onStudy, onReader, resetAt,
}: {
  view: LearnView
  setView: (v: LearnView) => void
  onStudy: () => void
  onReader: (bookIdx?: number, chapter?: number) => void
  resetAt: number
}) {
  // 「词书 / 词典」原本是底部一个独立菜单，现在并入「单词」板块。
  // 进入后以子页形式呈现，带返回按钮，返回时仍停在原来的分栏。
  const [sub, setSub] = useState<LibraryView | null>(null)
  // 点底部「学习」时回到顶层，而不是停在词典子页里
  useEffect(() => { setSub(null) }, [resetAt])

  if (sub) {
    return (
      <div className="animate-fade-up">
        <button onClick={() => setSub(null)}
          className="mb-3 inline-flex items-center gap-1 text-sm text-aegean-600 hover:underline dark:text-aegean-300">
          <Icon.Back className="h-4 w-4" /> 返回单词
        </button>
        <Library view={sub} setView={setSub} onStudy={onStudy} />
      </div>
    )
  }

  return (
    <div className="animate-fade-up">
      <Segmented<LearnView>
        value={view}
        onChange={setView}
        className="!mb-5"
        options={[
          { value: 'vocab', label: '单词' },
          { value: 'grammar', label: '语法' },
          { value: 'reading', label: '阅读' },
          { value: 'listening', label: '听力' },
        ]}
      />
      {view === 'vocab' && (
        <Home onStudy={onStudy} onGoBooks={setSub} embedded />
      )}
      {view === 'grammar' && <Grammar />}
      {view === 'reading' && <Reading onOpen={(b, c) => onReader(b, c)} />}
      {view === 'listening' && <Listening />}
    </div>
  )
}
