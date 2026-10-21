import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui'
import { onTtsStatus, speakText, stopSpeaking, ttsStatus, warmupTts, prepareSpeech, wordTimingsOf } from '../lib/tts'
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
  /**
   * 当前句下标；-1 表示还没开始。
   *
   * ⚠️ 这里原名叫 `at`，且在**每句读完就复位成 -1**。后果是「逐句」模式下
   * 读完第 1 句后 at 变回 -1，而 ‹ / › 按钮的 disabled 条件都依赖 at，
   * 于是两个按钮同时变灰 —— 用户只能点主按钮，而主按钮又从**第 0 句**重来。
   * 所以现在读完**保留 at**，另用 `playing` 表示是否正在出声。
   */
  const [at, setAt] = useState(-1)
  const [playing, setPlaying] = useState(false)
  /** 当前正在念的词在句子里的下标；-1 表示没有 */
  const [wordAt, setWordAt] = useState(-1)
  const [engine, setEngine] = useState(ttsStatus())
  /** 连播时用来中断 */
  const token = useRef(0)

  useEffect(() => onTtsStatus(setEngine), [])
  // 换了段落就复位
  useEffect(() => { token.current++; setAt(-1); setPlaying(false); setWordAt(-1); stopSpeaking() }, [text])

  /**
   * 把「播放到第几毫秒」换算成「正在念第几个词」。
   *
   * 优先用 eSpeak 事件里的**真实**词时间戳（`wordTimingsOf`）；
   * 神经语音不产生事件，退回**按字数比例估算**——对高亮来说够用了。
   */
  const wordIndexAt = (si: number, ms: number, totalMs: number): number => {
    const toks = sentences[si]?.split(/\s+/).filter(Boolean) ?? []
    if (!toks.length) return -1
    const real = wordTimingsOf(sentences[si])
    if (real && real.length === toks.length) {
      for (let i = 0; i < real.length; i++) {
        if (ms >= real[i].startMs && ms < real[i].endMs) return i
      }
      return ms >= real[real.length - 1].endMs ? -1 : 0
    }
    if (!totalMs) return -1
    // 按字符数分时间：长词占的时间确实更长，比均分准得多
    const lens = toks.map((t) => t.length + 1)      // +1 近似词间停顿
    const sum = lens.reduce((a, b) => a + b, 0)
    let acc = 0
    const frac = ms / totalMs
    for (let i = 0; i < lens.length; i++) {
      acc += lens[i] / sum
      if (frac < acc) return i
    }
    return -1
  }

  const play = async (i: number, chain: boolean) => {
    if (i < 0 || i >= sentences.length) return
    const mine = ++token.current
    setAt(i)
    setPlaying(true)
    setWordAt(-1)
    try {
      const ok = await speakText(
        sentences[i],
        () => {
          if (mine !== token.current) return
          setWordAt(-1)
          if (chain && i + 1 < sentences.length) void play(i + 1, true)
          else { setPlaying(false); setAt(i) }   // ← 保留 at，让 › 能接着走
        },
        (ms, totalMs) => {
          if (mine !== token.current) return
          setWordAt(wordIndexAt(i, ms, totalMs))
        },
      )
      if (!ok) {
        // 引擎不可用：退回系统语音，读完也推进
        speak(sentences[i])
        setPlaying(false)
        setAt(i)
        if (chain && i + 1 < sentences.length) {
          setTimeout(() => { if (mine === token.current) void play(i + 1, true) }, 600)
        }
      }
    } finally {
      setEngine(ttsStatus())
    }
  }

  const stop = () => {
    token.current++; stopSpeaking()
    setPlaying(false); setWordAt(-1)
    // 保留 at：停下来之后仍能按 › 从下一句继续
  }

  const onClick = () => {
    if (!sentences.length) return
    if (playing) { stop(); return }
    if (mode === 'paragraph') {
      setPlaying(true)
      const mine = ++token.current
      void speakText(text, () => { if (mine === token.current) setPlaying(false) })
        .then((ok) => { if (!ok) { speak(text); setPlaying(false) } })
      return
    }
    // 逐句 / 连播：从「上次停留的下一句」继续；读到头就从头
    const next = at + 1 >= sentences.length ? 0 : at + 1
    void play(next, mode === 'continuous')
  }

  const title = playing ? '停止' : (engine === 'ready' ? '朗读' : '朗读（首次需加载语音引擎）')
  const canPrev = at > 0
  const canNext = at + 1 < sentences.length

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        {/* 一句一句的精听控制：只在逐句/连播模式出现 */}
        {mode !== 'paragraph' && sentences.length > 1 && (
          <span className="flex items-center gap-1 text-[10px] tabular-nums text-ink-400">
            <button
              className="btn-ghost !px-1.5 !py-0.5"
              disabled={!canPrev}
              title="上一句"
              onClick={() => { token.current++; stopSpeaking(); void play(at - 1, mode === 'continuous') }}
            >‹</button>
            <span className="min-w-[3.5em] text-center">
              {at >= 0 ? `${at + 1} / ${sentences.length}` : `共 ${sentences.length} 句`}
            </span>
            <button
              className="btn-ghost !px-1.5 !py-0.5"
              disabled={!canNext}
              title="下一句"
              onClick={() => { token.current++; stopSpeaking(); void play(at + 1, mode === 'continuous') }}
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
          {playing
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
                ? 'rounded bg-aegean-100/70 box-decoration-clone transition-colors dark:bg-aegean-900/40'
                : 'transition-colors'}
            >
              {toks.map((t, i) => {
                // 正在念的那个词：加底纹 + 环，像被圈画出来
                const speaking = active && playing && i === wordAt
                return (
                  <span key={i}>
                    <button
                      type="button"
                      onClick={() => onWord(t)}
                      className={`rounded px-0.5 transition-colors ${speaking
                        ? 'bg-laurel-200 font-semibold text-laurel-900 ring-2 ring-laurel-400/70 dark:bg-laurel-500/40 dark:text-laurel-50 dark:ring-laurel-300/60'
                        : 'hover:bg-aegean-100 hover:text-aegean-900 dark:hover:bg-aegean-900/50'
                      }`}
                    >
                      {t}
                    </button>
                    {i < toks.length - 1 ? ' ' : ''}
                  </span>
                )
              })}
              {si < sentences.length - 1 ? ' ' : ''}
            </span>
          )
        })}
      </p>
    </div>
  )
}
