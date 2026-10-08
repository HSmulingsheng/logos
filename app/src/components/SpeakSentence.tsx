import { useEffect, useState } from 'react'
import { Icon } from './ui'
import { onTtsStatus, speakText, ttsStatus, warmupTts, prepareSpeech, getSpeechEngine, neuralStatus, neuralProgress, onNeuralStatus } from '../lib/tts'
import { speak } from '../lib/audio'

/**
 * 朗读一整句古希腊语。
 * 首次点击需要下载语音引擎（24MB），期间显示转圈；加载完成后是瞬时响应。
 */
export function SpeakSentence({
  text, className = '', size = 'sm',
}: {
  text: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const [engine, setEngine] = useState(ttsStatus())
  const [busy, setBusy] = useState(false)
  const [nStatus, setNStatus] = useState(neuralStatus())
  const [nPct, setNPct] = useState(neuralProgress())
  const neural = getSpeechEngine() === 'neural'

  useEffect(() => onTtsStatus(setEngine), [])
  useEffect(() => onNeuralStatus((st, p) => { setNStatus(st); setNPct(p) }), [])

  const dim = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      const ok = await speakText(text)
      if (!ok) speak(text)          // 引擎不可用时退回系统语音
      setEngine(ttsStatus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      // 悬停就先把这句合成好：神经推理要 1–3 秒，等点下去时音频往往已经就绪
      onMouseEnter={() => { prepareSpeech(text); if (engine === 'idle') warmupTts() }}
      title={
        neural && nStatus === 'downloading' ? `正在下载高清语音模型 ${Math.round(nPct)}%`
          : neural && nStatus === 'loading' ? '正在加载高清语音引擎…'
            : neural ? '朗读这句（高清语音）'
              : engine === 'ready' ? '朗读这句' : '朗读这句（首次需加载语音引擎）'
      }
      aria-label="朗读例句"
      className={`${dim} relative inline-flex shrink-0 items-center justify-center rounded-full bg-ink-100/80 text-ink-500 transition hover:bg-aegean-50 hover:text-aegean-600 active:scale-95 dark:bg-white/10 dark:text-ink-300 dark:hover:bg-aegean-900/40 ${className}`}
    >
      {busy || (neural && (nStatus === 'downloading' || nStatus === 'loading'))
        ? <span className={`${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} animate-spin rounded-full border-2 border-current border-t-transparent`} />
        : <Icon.Volume className={icon} />}
      {neural && nStatus === 'downloading' && (
        <span className="absolute -bottom-0.5 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-ink-200/70 dark:bg-white/15">
          <span className="block h-full rounded-full bg-aegean-500 transition-[width]" style={{ width: `${nPct}%` }} />
        </span>
      )}
    </button>
  )
}
