import { Icon } from './ui'
import { playAudio } from '../lib/audio'

/**
 * 通用发音按钮：优先播放指定音频文件，没有文件时回退到系统朗读。
 * 用于语法板块的字母名、词形等没有独立录音的内容。
 */
export function PlayButton({
  file, text, size = 'md', className = '',
}: {
  file?: string
  text?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const cls = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  return (
    <button
      className={`${cls} inline-flex shrink-0 items-center justify-center rounded-full bg-aegean-50 text-aegean-600 transition hover:bg-aegean-100 active:scale-95 dark:bg-aegean-900/40 dark:text-aegean-300 ${className}`}
      onClick={(e) => { e.stopPropagation(); playAudio(file, text) }}
      title="播放发音"
      aria-label="播放发音"
    >
      <Icon.Volume className={icon} />
    </button>
  )
}
