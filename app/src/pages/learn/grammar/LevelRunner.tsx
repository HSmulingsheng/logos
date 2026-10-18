import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../components/ui'
import { GreekInput, GreekInputHint } from '../../../components/GreekInput'
import { useStore } from '../../../store/useStore'
import type { InputScheme } from '../../../lib/greekInput'
import { SpeakSentence } from '../../../components/SpeakSentence'
import { foldGreek } from '../../../lib/greek'
import { buildLevel, isCorrect } from '../../../lib/grammar/exercises'
import type { GenContext } from '../../../lib/grammar/exercises'
import type { Exercise } from '../../../lib/grammar/types'
import type { LevelSpec, UnitSpec } from '../../../lib/grammar/course'

interface Props {
  unit: UnitSpec
  spec: LevelSpec
  ctx: GenContext
  onExit: () => void
  onFinish: (correct: number, total: number) => void
}

/** 一关：逐题作答；答错可当场重答，全部答对即通过（不计星级） */
export function LevelRunner({ unit, spec, ctx, onExit, onFinish }: Props) {
  // 本关题目只在进入时生成一次，避免重渲染换题
  const [seed] = useState(() => Math.random())
  const exercises = useMemo(
    () => buildLevel(spec.kinds, spec.n, ctx, mulberry(seed)),
    [spec, ctx, seed],
  )

  const [idx, setIdx] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [result, setResult] = useState<null | { ok: boolean; explain: string }>(null)
  /** 答错的瞬时提示：不推进题目，让用户当场重答 */
  const [wrong, setWrong] = useState(false)
  const [finished, setFinished] = useState(false)

  // 各题型的作答状态
  const [picked, setPicked] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [placed, setPlaced] = useState<string[]>([])
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null)

  const scheme = useStore((st) => st.settings.inputScheme) as InputScheme
  const ex = exercises[idx]
  const advanced = useRef(false)

  const resetAnswer = useCallback(() => {
    setPicked(null); setTyped(''); setPlaced([]); setAssign({}); setSelectedLeft(null)
    setResult(null); advanced.current = false
  }, [])

  const finish = useCallback((finalCorrect: number) => {
    setFinished(true)
    onFinish(finalCorrect, exercises.length)
  }, [exercises.length, onFinish])

  const next = useCallback(() => {
    if (advanced.current) return
    advanced.current = true
    if (idx + 1 >= exercises.length) { finish(correct); return }
    setIdx((i) => i + 1)
    resetAnswer()
  }, [idx, exercises.length, correct, finish, resetAnswer])

  /** 判定当前作答 */
  const check = useCallback(() => {
    if (!ex || result) return
    setWrong(false)
    let ok = false
    // 判题统一走 `isCorrect`：这四种题型的比较逻辑原来在这里又写了一遍，
    // 与 exercises.ts 里的版本逐字相同。完整性检查（没答完就 return）留在本地，
    // 因为那是 UI 关注点，不是对错判断。
    if (ex.mode === 'choice') {
      if (!picked) return
      ok = isCorrect(ex, picked)
    } else if (ex.mode === 'type') {
      if (!typed.trim()) return
      ok = isCorrect(ex, typed)
    } else if (ex.mode === 'order') {
      if (placed.length !== ex.correct.length) return
      ok = isCorrect(ex, placed)
    } else if (ex.mode === 'match') {
      if (Object.keys(assign).length !== ex.pairs.length) return
      ok = isCorrect(ex, assign)
    }
    if (!ok) {
      // 答错：只给提示，不进下一题、不记分，改一下再点「判定」即可重答。
      setWrong(true)
      // 「构造类」题型（排序、配对）答错后必须清空，否则左右槽位已占满、
      // 左边按钮又是禁用的，用户根本改不动，等于卡死在这一题。
      if (ex.mode === 'order') setPlaced([])
      if (ex.mode === 'match') { setAssign({}); setSelectedLeft(null) }
      return
    }
    setResult({ ok: true, explain: ex.explain })
    setCorrect((c) => c + 1)
  }, [ex, result, picked, typed, placed, assign])

  // 键盘：1-4 选择 · Enter 判定/继续 · Esc 退出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished) return
      if (e.key === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (result) next()
        else check()
        return
      }
      if (!ex || ex.mode !== 'choice' || result) return
      const n = Number(e.key)
      if (n >= 1 && n <= ex.options.length) {
        e.preventDefault()
        setWrong(false); setPicked(ex.options[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ex, result, finished, next, check, onExit])

  // ---------------------------------------------------------------- 结束页
  if (finished) {
    return (
      <div className="card-surface mx-auto max-w-md p-7 text-center">
        <div className="mb-3 text-5xl">🏆</div>
        <h2 className="mb-1 text-xl font-semibold">{spec.title} · 通过</h2>
        <p className="mb-5 text-sm text-ink-500">
          本关 {exercises.length} 题全部答对
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={onExit}>返回地图</button>
          <button className="btn-primary" onClick={() => {
            // 重来一关：换一批题
            onExit()
          }}>继续</button>
        </div>
        <p className="mt-4 text-xs text-ink-400">答错可以当场重答，所以不计星级——同一关每次出的题都不一样，多练几遍更稳。</p>
      </div>
    )
  }

  if (!ex) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card-surface p-6 text-center">
          <p className="mb-3 text-sm text-ink-500">这个单元的题目数据不足，换一关试试。</p>
          <button className="btn-ghost" onClick={onExit}>返回地图</button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- 答题页
  return (
    <div className="mx-auto max-w-xl">
      {/* 顶部进度 */}
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onExit} className="text-ink-400 transition hover:text-ink-600" aria-label="退出">
          <Icon.Close className="h-5 w-5" />
        </button>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-200/70 dark:bg-white/10">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${unit.tint} transition-[width] duration-300`}
            style={{ width: `${((idx + (result ? 1 : 0)) / exercises.length) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-ink-400">{idx + 1}/{exercises.length}</span>
      </div>

      <div className="card-surface p-5">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-400">{unit.title}</p>
        <h2 className="mb-4 text-lg font-semibold leading-snug">{ex.prompt}</h2>
        {'sub' in ex && ex.sub && <p className="-mt-3 mb-4 text-xs text-ink-400">{ex.sub}</p>}

        {ex.mode === 'choice' && (
          <>
            {ex.sentence && (
              <div className="mb-4 rounded-xl bg-ink-50/80 p-3.5 dark:bg-white/5">
                <p className="greek text-lg leading-relaxed">{ex.sentence}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {ex.source && <p className="text-[11px] text-ink-400">{ex.source}</p>}
                  <SpeakSentence text={sentenceForSpeech(ex.sentence)} className="ml-auto" />
                </div>
              </div>
            )}
            <div className="grid gap-2">
              {ex.options.map((o, i) => {
                const show = !!result
                const isAnswer = o.id === ex.answerId
                const isPicked = picked === o.id
                const cls = !show
                  ? isPicked
                    ? wrong
                      ? 'border-wine-400 bg-wine-50 dark:border-wine-800 dark:bg-wine-950/40'
                      : 'border-aegean-400 bg-aegean-50 dark:border-aegean-600 dark:bg-aegean-950/40'
                    : 'border-ink-200 bg-white/70 hover:border-aegean-300 hover:bg-aegean-50/60 dark:border-white/10 dark:bg-white/5'
                  : isAnswer
                    ? 'border-laurel-400 bg-laurel-50 dark:border-laurel-700 dark:bg-laurel-950/40'
                    : isPicked
                      ? 'border-wine-400 bg-wine-50 dark:border-wine-800 dark:bg-wine-950/40'
                      : 'border-ink-200 bg-white/50 opacity-50 dark:border-white/10 dark:bg-white/5'
                return (
                  <button key={o.id} disabled={show} onClick={() => { setWrong(false); setPicked(o.id) }}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${cls}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                      show && isAnswer ? 'bg-laurel-500 text-white'
                        : (show || wrong) && isPicked ? 'bg-wine-500 text-white'
                          : 'bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300'}`}>{i + 1}</span>
                    <span className="greek text-lg">{o.text}</span>
                    {show && isAnswer && <Icon.Check className="ml-auto h-4 w-4 shrink-0 text-laurel-600" />}
                    {show && isPicked && !isAnswer && <Icon.Close className="ml-auto h-4 w-4 shrink-0 text-wine-500" />}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {ex.mode === 'type' && (
          <>
            <GreekInput
              value={typed}
              onChange={(g) => { setWrong(false); setTyped(g) }}
              scheme={scheme}
              onEnter={check}
              autoFocus
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              placeholder="在此输入…（可直接用拉丁键盘）"
              className="greek w-full rounded-xl border border-ink-200 bg-white/80 px-4 py-3 text-center text-2xl outline-none transition focus:border-aegean-400 focus:ring-4 focus:ring-aegean-100 disabled:opacity-60 dark:border-white/10 dark:bg-white/5"
            />
            <GreekInputHint scheme={scheme} />
          </>
        )}

        {ex.mode === 'order' && (
          <>
            <div className="mb-3 min-h-[52px] rounded-xl border border-ink-200/70 bg-ink-50/40 p-2 dark:border-white/10 dark:bg-white/[.03]">
              {placed.length === 0
                ? <p className="py-2 text-center text-xs text-ink-400">按顺序点下面的词形</p>
                : (
                  <div className="flex flex-wrap gap-2">
                    {placed.map((t, i) => (
                      <button key={`${t}-${i}`} disabled={!!result}
                        onClick={() => { setWrong(false); setPlaced((p) => p.filter((_, j) => j !== i)) }}
                        className="greek rounded-lg border border-aegean-300 bg-aegean-50 px-3 py-1.5 text-base dark:border-aegean-700 dark:bg-aegean-950/40">
                        <span className="mr-1 text-[10px] text-aegean-500">{i + 1}</span>{t}
                      </button>
                    ))}
                  </div>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
              {ex.items.filter((t) => !placed.includes(t)).map((t) => (
                <button key={t} disabled={!!result}
                  onClick={() => { setWrong(false); setPlaced((p) => [...p, t]) }}
                  className="greek rounded-lg border border-ink-200 bg-white/70 px-3 py-1.5 text-base transition hover:border-aegean-300 hover:bg-aegean-50/60 dark:border-white/10 dark:bg-white/5">
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        {ex.mode === 'match' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              {ex.pairs.map((p) => p.left).map((left) => {
                const done = !!assign[left]
                const okPair = result && ex.pairs.find((p) => p.left === left)?.right === assign[left]
                return (
                  <button key={left} disabled={!!result || done}
                    onClick={() => { setWrong(false); setSelectedLeft(left) }}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                      selectedLeft === left
                        ? 'border-aegean-400 bg-aegean-50 dark:border-aegean-600 dark:bg-aegean-950/40'
                        : done
                          ? result
                            ? okPair
                              ? 'border-laurel-400 bg-laurel-50 dark:border-laurel-700 dark:bg-laurel-950/40'
                              : 'border-wine-400 bg-wine-50 dark:border-wine-800 dark:bg-wine-950/40'
                            : 'border-ink-300 bg-ink-50 opacity-70 dark:border-white/20 dark:bg-white/5'
                          : 'border-ink-200 bg-white/70 hover:border-aegean-300 dark:border-white/10 dark:bg-white/5'}`}>
                    <span className="greek text-base">{left}</span>
                    {done && <span className="greek ml-auto truncate text-xs text-ink-400">→ {assign[left]}</span>}
                  </button>
                )
              })}
            </div>
            <div className="space-y-2">
              {ex.pairs.map((p) => p.right).map((right) => {
                const usedBy = Object.entries(assign).find(([, v]) => v === right)?.[0]
                return (
                  <button key={right} disabled={!!result}
                    onClick={() => {
                      if (!selectedLeft) return
                      setWrong(false)
                      setAssign((a) => {
                        const next = { ...a }
                        for (const k of Object.keys(next)) if (next[k] === right) delete next[k]
                        next[selectedLeft] = right
                        return next
                      })
                      setSelectedLeft(null)
                    }}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      usedBy
                        ? 'border-ink-300 bg-ink-50 opacity-70 dark:border-white/20 dark:bg-white/5'
                        : 'border-ink-200 bg-white/70 hover:border-aegean-300 dark:border-white/10 dark:bg-white/5'}`}>
                    {right}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 反馈 + 操作 */}
      <div className="mt-3">
        {wrong && !result && (
          <div className="mb-3 rounded-xl bg-wine-50 px-3.5 py-3 text-sm text-wine-800 dark:bg-wine-950/40 dark:text-wine-200">
            <div className="font-semibold">✗ 还不对，再想想</div>
            <p className="mt-0.5 text-xs leading-relaxed opacity-90">
              改一下再点「判定」就行，答错不影响进度。
            </p>
          </div>
        )}
        {result && (
          <div className={`mb-3 rounded-xl px-3.5 py-3 text-sm ${
            result.ok
              ? 'bg-laurel-50 text-laurel-800 dark:bg-laurel-950/40 dark:text-laurel-200'
              : 'bg-wine-50 text-wine-800 dark:bg-wine-950/40 dark:text-wine-200'}`}>
            <div className="mb-0.5 font-semibold">{result.ok ? '✓ 答对了' : '✗ 再记一下'}</div>
            <p className="text-xs leading-relaxed opacity-90">{result.explain}</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-x-3 text-[11px] text-ink-400">
            {ex.mode === 'choice' && !result && <span>按 1–{ex.options.length} 选择</span>}
            <span><Kbd>Enter</Kbd> {result ? '继续' : wrong ? '再判定一次' : '判定'}</span>
            <span><Kbd>Esc</Kbd> 退出</span>
          </div>
          <button className="btn-primary min-w-[104px]" onClick={result ? next : check}
            disabled={!result && (
              (ex.mode === 'choice' && !picked)
              || (ex.mode === 'type' && !typed.trim())
              || (ex.mode === 'order' && placed.length !== ex.correct.length)
              || (ex.mode === 'match' && Object.keys(assign).length !== ex.pairs.length)
            )}>
            {result ? (idx + 1 >= exercises.length ? '完成' : '继续') : '判定'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 填空句里有 _____，朗读时要还原成原句（存在 explain 里） */
function sentenceForSpeech(sentence: string): string {
  return sentence.replace(/_____+/g, ' ')
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ink-200 bg-white/70 px-1 text-[10px] text-ink-500 dark:border-white/15 dark:bg-white/10">
      {children}
    </kbd>
  )
}

/** 可复现的伪随机数（同一关重进时题目一致，除非换 seed） */
function mulberry(seed: number): () => number {
  let a = Math.floor(seed * 4294967296)
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
