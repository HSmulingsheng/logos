import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Word } from '../../types'
import { useStore } from '../../store/useStore'
import { makeChoices } from '../../lib/session'
import { checkSpelling } from '../../lib/greek'
import { playAudio } from '../../lib/audio'
import { loadAudioIndex } from '../../lib/data'
import { Icon, Section } from '../../components/ui'
import { State } from '../../lib/srs'

type Mode = 'audio' | 'spell'
type Source = 'active' | 'learned'
type Phase = 'setup' | 'quiz' | 'done'

const ROUND = 20

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 听力专项练习：复用词条与发音，不进 FSRS 调度，纯练习 */
export function Listening() {
  const { lessonWords, cards, settings } = useStore()
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<Mode>('audio')
  const [source, setSource] = useState<Source>('active')
  const [queue, setQueue] = useState<Word[]>([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<null | { ok: boolean; answer: string }>(null)
  const [stats, setStats] = useState({ right: 0, wrong: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const advanced = useRef(false)

  const [audioSet, setAudioSet] = useState<Set<string> | null>(null)
  useEffect(() => { void loadAudioIndex().then(setAudioSet) }, [])

  const pool = useMemo(() => {
    const all: Word[] = []
    for (const order of settings.activeLessons) all.push(...(lessonWords.get(order) ?? []))
    const withAudio = audioSet ? all.filter((w) => w.au && audioSet.has(w.au)) : []
    if (source === 'learned') {
      return withAudio.filter((w) => {
        const c = cards.get(w.i)
        return c && c.state !== State.New
      })
    }
    return withAudio
  }, [lessonWords, settings.activeLessons, source, cards, audioSet])

  const word = queue[idx]
  const options = useMemo(() => {
    if (!word || mode !== 'audio') return []
    return makeChoices(word, pool.length >= 4 ? pool : queue, 4, (w) => w.w)
  }, [word, pool, queue, mode])

  const start = () => {
    const n = Math.min(ROUND, pool.length)
    if (n === 0) return
    const q = shuffle(pool).slice(0, n)
    setQueue(q)
    setIdx(0)
    setPicked(null)
    setTyped('')
    setResult(null)
    setStats({ right: 0, wrong: 0 })
    setPhase('quiz')
  }

  const next = useCallback(() => {
    if (advanced.current) return
    advanced.current = true
    if (idx + 1 >= queue.length) setPhase('done')
    else setIdx(idx + 1)
  }, [idx, queue.length])

  const replay = useCallback(() => { if (word) playAudio(word.au, word.w) }, [word])

  // 每题出现即自动发音；题号变了才重播，避免重渲染时重复播
  const playedFor = useRef(-1)
  useEffect(() => {
    if (phase !== 'quiz' || !word) return
    if (playedFor.current === idx) return
    playedFor.current = idx
    setPicked(null)
    setTyped('')
    setResult(null)
    advanced.current = false
    const t = setTimeout(() => playAudio(word.au, word.w), 200)
    return () => clearTimeout(t)
  }, [phase, idx, word])

  useEffect(() => {
    if (phase === 'quiz' && mode === 'spell') setTimeout(() => inputRef.current?.focus(), 200)
  }, [phase, idx, mode])

  const answerChoice = (optId: number, ok: boolean) => {
    if (result) return
    setPicked(optId)
    setResult({ ok, answer: word?.w ?? '' })
    setStats((s) => (ok ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }))
    if (word) playAudio(word.au, word.w)
  }

  const submitSpell = () => {
    if (result || !word) return
    const r = checkSpelling(typed, word.w)
    setResult({ ok: r.ok, answer: word.w })
    setStats((s) => (r.ok ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }))
    playAudio(word.au, word.w)
  }

  // 键盘：1-4 选择 · Enter 提交/继续 · R 重放 · Esc 返回设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'quiz') return
      // ⚠️ 输入框里放行：支持拉丁转写后 `r` 是 ρ 的输入键（听写题要打字）
      const tag = (e.target as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'
      if (!inInput && (e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); replay(); return
      }
      if (e.key === 'Escape') { e.preventDefault(); setPhase('setup'); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (mode === 'spell' && !result) submitSpell()
        else if (result) next()
        return
      }
      const n = Number(e.key)
      if (mode === 'audio' && n >= 1 && n <= 4 && !result) {
        const o = options[n - 1]
        if (o) { e.preventDefault(); answerChoice(o.id, o.correct) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------------------------------------------------------------- 设置
  if (phase === 'setup') {
    const learnedCount = pool.length
    return (
      <div>
        <p className="mb-4 text-xs leading-relaxed text-ink-400">
          用已有的发音音频做<b>听力专项训练</b>——先听声音，再判断是哪个词。
          这里只练听力、不进记忆曲线，次数随便刷。
        </p>

        <Section title="练习模式">
          <div className="grid grid-cols-2 gap-2.5">
            {([
              ['audio', '听音辨词', '播放发音，从四个词形里选出正确的一个'],
              ['spell', '听写', '播放发音，凭听感把希腊语拼出来'],
            ] as [Mode, string, string][]).map(([k, title, desc]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`card-surface p-3.5 text-left transition ${
                  mode === k ? 'ring-2 ring-aegean-400 dark:ring-aegean-700' : 'hover:bg-white dark:hover:bg-white/[.07]'}`}>
                <div className="mb-1 flex items-center gap-2">
                  <Icon.Ear className="h-4 w-4 text-aegean-600 dark:text-aegean-300" />
                  <span className="text-sm font-medium">{title}</span>
                </div>
                <p className="text-[11px] leading-snug text-ink-400">{desc}</p>
              </button>
            ))}
          </div>
        </Section>

        <Section title="取材范围">
          <div className="grid grid-cols-2 gap-2.5">
            {([
              ['active', '当前词书', '已选的全部课次'],
              ['learned', '已学过的词', '只练已经进过记忆曲线的词'],
            ] as [Source, string, string][]).map(([k, title, desc]) => (
              <button key={k} onClick={() => setSource(k)}
                className={`card-surface p-3.5 text-left transition ${
                  source === k ? 'ring-2 ring-aegean-400 dark:ring-aegean-700' : 'hover:bg-white dark:hover:bg-white/[.07]'}`}>
                <div className="text-sm font-medium">{title}</div>
                <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{desc}</p>
              </button>
            ))}
          </div>
        </Section>

        <div className="card-surface flex items-center gap-4 p-4">
          <div className="flex-1 text-sm">
            <div className="text-ink-600 dark:text-ink-300">
              可用词条 <b className="text-aegean-600 dark:text-aegean-300">{learnedCount}</b> 个
            </div>
            <p className="mt-0.5 text-[11px] text-ink-400">
              {learnedCount === 0
                ? (source === 'learned' ? '还没有学过的词，先去「单词」学几个' : '先到「单词 → 词书」里选一本')
                : `本轮出 ${Math.min(ROUND, learnedCount)} 题`}
            </p>
          </div>
          <button className="btn-primary" disabled={learnedCount < 4} onClick={start}>开始练习</button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- 结束
  if (phase === 'done') {
    const total = stats.right + stats.wrong
    const rate = total ? Math.round((stats.right / total) * 100) : 0
    return (
      <div className="card-surface mx-auto max-w-sm p-6 text-center">
        <div className="mb-3 text-4xl">{rate >= 80 ? '🎧' : '💪'}</div>
        <h2 className="mb-1 text-lg font-semibold">本轮听力练习完成</h2>
        <p className="mb-4 text-sm text-ink-500">{total} 题 · 正确率 {rate}%</p>
        <div className="mb-5 flex justify-center gap-6 text-sm">
          <div><div className="text-2xl font-semibold text-laurel-600">{stats.right}</div><div className="text-xs text-ink-400">答对</div></div>
          <div><div className="text-2xl font-semibold text-wine-500">{stats.wrong}</div><div className="text-xs text-ink-400">答错</div></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => setPhase('setup')}>换模式</button>
          <button className="btn-primary" onClick={start}>再来一轮</button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- 答题
  if (!word) {
    return <div className="mx-auto max-w-sm"><div className="skeleton h-48 w-full" /></div>
  }
  const senses = word.z.length ? word.z : word.s

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-400">
        <span>{idx + 1} / {queue.length}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200/70">
          <div className="h-full rounded-full bg-gradient-to-r from-aegean-400 to-laurel-400 transition-[width]"
            style={{ width: `${((idx + (result ? 1 : 0)) / queue.length) * 100}%` }} />
        </div>
        <span className="text-laurel-600">✓ {stats.right}</span>
        <span className="text-wine-500">✗ {stats.wrong}</span>
        <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => setPhase('setup')}>退出</button>
      </div>

      <div className="card-surface p-6 text-center">
        <p className="mb-4 text-xs font-medium text-ink-400">
          {mode === 'audio' ? '听发音，选出对应的词' : '听发音，把它拼出来'}
        </p>

        <button
          onClick={replay}
          className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-aegean-50 text-aegean-600 transition hover:bg-aegean-100 active:scale-95 dark:bg-aegean-900/40 dark:text-aegean-300"
          aria-label="重放发音"
        >
          <Icon.Volume className="h-10 w-10" />
        </button>

        {mode === 'audio' ? (
          <div className="mt-5 grid gap-2">
            {options.map((o, i) => {
              const isPicked = picked === o.id
              const show = picked !== null
              const cls = !show
                ? 'border-ink-200 bg-white/70 hover:border-aegean-300 hover:bg-aegean-50/60 dark:border-white/10 dark:bg-white/5'
                : o.correct
                  ? 'border-laurel-400 bg-laurel-50 dark:border-laurel-700 dark:bg-laurel-950/40'
                  : isPicked
                    ? 'border-wine-400 bg-wine-50 dark:border-wine-800 dark:bg-wine-950/40'
                    : 'border-ink-200 bg-white/50 opacity-50 dark:border-white/10 dark:bg-white/5'
              return (
                <button key={o.id} disabled={show} onClick={() => answerChoice(o.id, o.correct)}
                  className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${cls}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                    show && o.correct ? 'bg-laurel-500 text-white'
                      : show && isPicked ? 'bg-wine-500 text-white'
                        : 'bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300'}`}>{i + 1}</span>
                  <span className="greek text-xl">{o.text}</span>
                  {show && o.correct && <Icon.Check className="ml-auto h-4 w-4 text-laurel-600" />}
                  {show && isPicked && !o.correct && <Icon.Close className="ml-auto h-4 w-4 text-wine-500" />}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="space-y-1">
              {senses.map((s, i) => <div key={i} className="text-lg font-medium">{s}</div>)}
            </div>
            <input
              ref={inputRef}
              className="greek w-full rounded-xl border border-ink-200 bg-white/80 px-4 py-3 text-center text-2xl outline-none transition focus:border-aegean-400 focus:ring-4 focus:ring-aegean-100 dark:border-white/10 dark:bg-white/5"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="在此输入…"
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              // Enter 交给全局快捷键处理，避免同一个按键被提交和推进各接一次
            />
          </div>
        )}

        {result && (
          <div className={`mt-4 rounded-xl px-3 py-2 text-sm font-medium ${
            result.ok ? 'bg-laurel-50 text-laurel-700 dark:bg-laurel-950/40 dark:text-laurel-300'
              : 'bg-wine-50 text-wine-700 dark:bg-wine-950/40 dark:text-wine-300'}`}>
            {result.ok ? '✓ 答对了' : `✗ 正确答案：${result.answer}`}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-400">
          {mode === 'audio' && !result && <span><Kbd>1</Kbd>–<Kbd>4</Kbd> 选择</span>}
          {mode === 'spell' && !result && <span><Kbd>Enter</Kbd> 提交</span>}
          {result && <span><Kbd>Enter</Kbd> 下一题</span>}
          <span><Kbd>R</Kbd> 重放</span>
          <span><Kbd>Esc</Kbd> 退出</span>
        </div>
        {result && <button className="btn-primary" onClick={next}>下一题</button>}
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-ink-200 bg-white/70 px-1 text-[10px] text-ink-500 dark:border-white/15 dark:bg-white/10">{children}</kbd>
}
