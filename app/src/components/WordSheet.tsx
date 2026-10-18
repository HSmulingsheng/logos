/**
 * 词条详情抽屉。**这是全项目原来复制得最彻底的一处**。
 *
 * 三个页面各自写了一遍完全相同的结构：
 *
 *   <Sheet open={!!detail} onClose onReplay={() => playAudio(detail.au, detail.w)}>
 *     标题行（detail.e || detail.w + SpeakButton + 收藏星标）
 *     <WordDetail word={detail} compact />
 *
 * 分别在 `Reader.tsx`、`learn/reading/ClassicalReading.tsx`、`Browse.tsx`。
 * 差别只有两点：`compact` 与收藏按钮的间距；`Browse` 多一个「重播」按钮。
 * 后果是改一处排版（比如加个「加入词书」）要改三遍，而且很容易漏。
 *
 * 现在收敛到这里。收藏状态与动作从 store 自取，调用方不用再传。
 */
import type { Word } from '../types'
import { useStore } from '../store/useStore'
import { playAudio } from '../lib/audio'
import { Icon, Sheet } from './ui'
import { SpeakButton, WordDetail } from './WordDetail'

export interface WordSheetProps {
  /** 要展示的词条；为 null 时抽屉关闭 */
  word: Word | null
  onClose: () => void
  /**
   * 紧凑排版。阅读器里用（屏幕窄、且下面还有正文），词典页用完整排版。
   */
  compact?: boolean
  /**
   * 除收藏外再给一个「重播」按钮。
   * 词典页有，因为它没有阅读器那种「点词即读」的上下文。
   */
  showReplay?: boolean
}

export function WordSheet({ word, onClose, compact = true, showReplay = false }: WordSheetProps) {
  const { cards, toggleFav } = useStore()
  const fav = word ? cards.get(word.i)?.fav : false

  return (
    <Sheet
      open={!!word}
      onClose={onClose}
      onReplay={() => word && playAudio(word.au, word.w)}
    >
      {word && (
        <div>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="greek text-3xl">{word.e || word.w}</h2>
            <SpeakButton word={word} />
            <div className={showReplay ? 'ml-auto flex gap-1.5' : 'ml-auto'}>
              <button
                className="btn-ghost !px-2 !py-1.5"
                onClick={() => void toggleFav(word.i)}
                aria-label={fav ? '取消收藏' : '收藏'}
              >
                {fav
                  ? <Icon.StarFill className="h-4 w-4 text-amber-400" />
                  : <Icon.Star className="h-4 w-4" />}
              </button>
              {showReplay && (
                <button
                  className="btn-ghost !px-2 !py-1.5"
                  onClick={() => playAudio(word.au, word.w)}
                  aria-label="重播"
                >
                  <Icon.Volume className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <WordDetail word={word} compact={compact} />
        </div>
      )}
    </Sheet>
  )
}
