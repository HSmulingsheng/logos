import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui'
import { onTtsStatus, speakText, stopSpeaking, ttsStatus, warmupTts, prepareSpeech } from '../lib/tts'
import { speak } from '../lib/audio'
import { splitSentences } from '../lib/prosody'

/**
 * 分段朗读模式。
 *
 * 为什么需要：原来朗读按钮把**整段**丢给 eSpeak，于是一段里多个句子之间的
 * 停顿听起来像「奇怪的停顿」，而且没法一句一句听。按句切分后：
 *   · 每次合成的音频短了 → 点下去到出声明显更快
 *   · 句子之间的停顿由界面控制 → 不再出现莫名停顿
 *   · 可以逐句精听
 */
export type ReadMode = 'sentence' | 'continuous' | 'paragraph'

export const READ_MODE_LABEL: Record<ReadMode, string> = {
  sentence: '逐句',
  continuous: '连播',
  paragraph: '整段',
}

export const READ_MODE_HINT: Record<ReadMode, string> = {
  sentence: '点一次读一句，再点读下一句',
  continuous: '从当前句开始，一句接一句自动读完',
  paragraph: '一次读完整段（句子之间的停顿按原文）',
}

/**
 * 逐句朗读器：把一段文本按句切分，高亮当前句并逐句播放。
 *
 * 文本仍然**逐词可点**（点词查义），与之前一致。
 */
export function SentenceReader({
  text, mode, onWord, className = '',
}: {
  text: string
  mode: ReadMode
  onWord: (t: string) => void
  className?: string
}) {
  const sentences = useMemo(() => splitSentences(text), [text])
  /** 当前句下标；-1 表示没有在播 */
  const [at, setAt] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState(ttsStatus())
  /** 连播时用来中断 */
  const token = useRef(0)

  useEffect(() => onTtsStatus(setEngine), [])
  // 换了段落就复位
  useEffect(() => { token.current++; setAt(-1); stopSpeaking() }, [text])

  const play = async (i: number, chain: boolean) => {
    const mine = ++token.current
    setAt(i)
    setBusy(true)
    try {
      const ok = await speakText(sentences[i], () => {
        if (mine !== token.current) return
        setBusy(false)
        if (chain && i + 1 < sentences.length) void play(i + 1, true)
        else setAt(-1)
      })
      if (!ok) {
        // 引擎不可用：退回系统语音，读完也推进
        speak(sentences[i])
        setBusy(false)
        if (chain && i + 1 < sentences.length) setTimeout(() => { if (mine === token.current) void play(i + 1, true) }, 600)
        else setAt(-1)
      }
    } finally {
      setEngine(ttsStatus())
    }
  }

  const stop = () => { token.current++; stopSpeaking(); setAt(-1); setBusy(false) }

  const onClick = () => {
    if (!sentences.length) return
    if (busy || at >= 0) { stop(); return }
    if (mode === 'paragraph') {
      setBusy(true)
      const mine = ++token.current
      void speakText(text, () => { if (mine === token.current) setBusy(false) })
        .then((ok) => { if (!ok) { speak(text); setBusy(false) } })
      return
    }
    // 逐句 / 连播：接着上次往下；读完了就从头
    const next = at + 1 >= sentences.length ? 0 : Math.max(0, at + 1)
    void play(mode === 'sentence' ? next : next, mode === 'continuous')
  }

  const title = busy || at >= 0 ? '停止' : (engine === 'ready' ? '朗读' : '朗读（首次需加载语音引擎）')

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        {/* 一句一句的精听控制：只在逐句/连播模式出现 */}
        {mode !== 'paragraph' && sentences.length > 1 && (
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-ink-400">
            <button
              className="btn-ghost !px-1.5 !py-0.5"
              disabled={at <= 0}
              title="上一句"
              onClick={() => { stop(); void play(at - 1, mode === 'continuous') }}
            >‹</button>
            <span className="min-w-[3.5em] text-center">
              {at >= 0 ? `${at + 1} / ${sentences.length}` : `共 ${sentences.length} 句`}
            </span>
            <button
              className="btn-ghost !px-1.5 !py-0.5"
              disabled={at < 0 || at + 1 >= sentences.length}
              title="下一句"
              onClick={() => { stop(); void play(at + 1, mode === 'continuous') }}
            >›</button>
          </span>
        )}
        <button
          type="button"
          onClick={onClick}
          onMouseEnter={() => {
            // 悬停就把下一句备好：合成是耗时的那一步
            if (engine === 'idle') warmupTts()
            if (mode !== 'paragraph' && sentences.length) prepareSpeech(sentences[0])
          }}
          title={title}
          aria-label="朗读"
          className="relative ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100/80 text-ink-500 transition hover:bg-aegean-50 hover:text-aegean-600 active:scale-95 dark:bg-white/10 dark:text-ink-300 dark:hover:bg-aegean-900/40"
        >
          {busy
            ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : at >= 0
              ? <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              : <Icon.Volume className="h-3.5 w-3.5" />}
        </button>
      </div>

      <p className={`greek ${className}`}>
        {sentences.map((s, si) => {
          const toks = s.split(/\s+/).filter(Boolean)
          const active = si === at
          return (
            <span
              key={si}
              className={active
                ? 'rounded bg-aegean-100/70 box-decoration-clone dark:bg-aegean-900/40'
                : ''}
            >
              {toks.map((t, i) => (
                <span key={i}>
                  <button
                    type="button"
                    className="rounded px-0.5 transition hover:bg-aegean-100 hover:text-aegean-900 dark:hover:bg-aegean-900/50"
                    onClick={() => onWord(t)}
                  >
                    {t}
                  </button>
                  {i < toks.length - 1 ? ' ' : ''}
                </span>
              ))}
              {si < sentences.length - 1 ? ' ' : ''}
            </span>
          )
        })}
      </p>
    </div>
  )
}
