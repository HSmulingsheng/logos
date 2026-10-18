import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionStep, Word } from '../types'
import { useStore } from '../store/useStore'

import { Rating, previewIntervals, type Grade } from '../lib/srs'
import { makeChoices } from '../lib/session'
import { checkSpelling, hintOf } from '../lib/greek'
import { playAudio } from '../lib/audio'
import { Icon, LevelTag } from '../components/ui'
import { GreekInput, GreekInputHint } from '../components/GreekInput'
import { ChoiceList } from '../components/ChoiceList'
import { Kbd } from '../components/Kbd'
import { ResultBanner } from '../components/ResultBanner'
import { useWord } from '../lib/useWord'
import type { InputScheme } from '../lib/greekInput'
import { SpeakButton, WordDetail } from '../components/WordDetail'

/**
 * 取词条（带缓存与按课回退）。
 * 注意：useState 的初始值只算一次，换词时必须主动清空/替换，
 * 否则会短暂停留在上一个词 —— 自动发音正是因此被「用旧词排的定时器」坑掉。
 */

const KIND_LABEL: Record<SessionStep['kind'], string> = {
  learn: '新词学习',
  review: '复习',
  choice: '选义',
  spell: '拼写',
  audio: '听音辨词',
  recall: '回想',
}

const RATING_KEY: Record<number, string> = { 1: '忘记', 2: '模糊', 3: '记得', 4: '熟练' }
const RATING_CLS: Record<number, string> = {
  1: 'bg-wine-500 hover:bg-wine-600',
  2: 'bg-amber-500 hover:bg-amber-600',
  3: 'bg-laurel-500 hover:bg-laurel-600',
  4: 'bg-aegean-500 hover:bg-aegean-600',
}

/** 自动发音的调试日志：只在 window.__autoDebug 为真时输出，供自动化测试核对 */
function dbg(tag: string, msg: string) {
  if ((window as unknown as { __autoDebug?: boolean }).__autoDebug) {
    console.log(`[auto] ${tag} ${msg}`)
  }
}


export function Study({ onExit }: { onExit: () => void }) {
  const { queue, cursor, startSession, submit, advance, settings, lessonWords, ensureLesson, suspend } = useStore()
  const [revealed, setRevealed] = useState(false)
  const [answered, setAnswered] = useState<null | { picked: number | null; ok: boolean }>(null)
  const [typed, setTyped] = useState('')
  const [spellResult, setSpellResult] = useState<null | { ok: boolean; note?: string; answer: string }>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const startedAt = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const advancing = useRef(false)
  const submitting = useRef(false)   // 拼写的 Enter 会被输入框和全局快捷键各接一次

  const step = queue[cursor] as SessionStep | undefined
  const word = useWord(step?.wordId ?? 0, step?.lesson ?? 1)
  const lessons = useStore.getState().lessons

  const stepKey = step ? `${step.wordId}:${step.kind}:${cursor}` : ''

  // ---------------------------------------------------------------- 每一步开始时重置状态
  useEffect(() => {
    setRevealed(false)
    setAnswered(null)
    setTyped('')
    setSpellResult(null)
    advancing.current = false
    submitting.current = false
    startedAt.current = Date.now()
    if (step) void ensureLesson(step.lesson)
  }, [stepKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 单词一出现就自动发音。
  // 注意：词条是异步取到的，所以要等 word 就绪后再播，并用 ref 保证每个步骤只播一次。
  const playedFor = useRef('')
  useEffect(() => {
    dbg('effect', JSON.stringify({ stepKey, wi: word?.i, sw: step?.wordId, auto: settings.autoPlay, done: playedFor.current === stepKey }))
    if (!settings.autoPlay || !word || !step || !stepKey) return
    if (word.i !== step.wordId) return
    if (playedFor.current === stepKey) return
    playedFor.current = stepKey
    dbg('schedule', stepKey)
    const t = setTimeout(() => { dbg('FIRE', `${stepKey}#${word.i}`); playAudio(word.au, word.w) }, 180)
    return () => { dbg('cleanup', stepKey); clearTimeout(t) }
  }, [stepKey, word, step, settings.autoPlay])

  useEffect(() => {
    if (step?.kind === 'spell') setTimeout(() => inputRef.current?.focus(), 140)
  }, [stepKey, step?.kind])

  useEffect(() => {
    if (!step) void startSession()
  }, [step, startSession])

  // ---------------------------------------------------------------- 评分 / 推进
  const record = useCallback(
    async (grade: Grade, correct?: boolean) => {
      if (!step) return
      await submit(step, grade, Date.now() - startedAt.current, correct)
    },
    [step, submit],
  )

  const next = useCallback(() => {
    if (advancing.current) return
    advancing.current = true
    advance()
  }, [advance])

  // 翻卡类（复习）自评后直接进下一步
  const gradeAndNext = useCallback(
    async (grade: Grade) => { await record(grade); next() },
    [record, next],
  )

  // 选择题作答：记分 + 展示详情，等用户「继续」
  const answerChoice = useCallback(
    async (optId: number, ok: boolean) => {
      if (answered || !step) return
      setAnswered({ picked: optId, ok })
      setRevealed(true)
      if (settings.autoPlay && word) playAudio(word.au, word.w)   // 出现释义时再念一次
      await record(ok ? Rating.Good : Rating.Again, ok)
    },
    [answered, step, record, settings.autoPlay, word],
  )

  const submitSpell = useCallback(async () => {
    if (spellResult || submitting.current || !word || !step) return
    submitting.current = true
    const r = checkSpelling(typed, word.w)
    setSpellResult({
      ok: r.ok,
      note: r.ok && r.accentOnly ? `拼写正确，注意重音：${word.w}` : undefined,
      answer: word.w,
    })
    setRevealed(true)
    if (settings.autoPlay) playAudio(word.au, word.w)
    await record(r.ok ? Rating.Good : Rating.Again, r.ok)
  }, [spellResult, word, step, typed, record, settings.autoPlay])

  const replay = useCallback(() => {
    if (word) playAudio(word.au, word.w)
  }, [word])

  // ---------------------------------------------------------------- 键盘
  const isChoiceStep = step?.kind === 'learn' || step?.kind === 'choice' || step?.kind === 'audio'
  const isFlipStep = step?.kind === 'review'

  const options = useMemo(() => {
    if (!step || !word || !isChoiceStep) return []
    const pool = lessonWords.get(step.lesson) ?? []
    const render = step.kind === 'audio' ? (w: Word) => w.w : (w: Word) => (w.z.length ? w.z[0] : w.s[0] ?? '')
    return makeChoices(word, pool, 4, render)
  }, [stepKey, word, isChoiceStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // 复习按钮上显示的 FSRS 预测间隔
  const intervalLabels = useMemo(() => {
    const rec = step ? useStore.getState().cards.get(step.wordId) : undefined
    if (!rec) return {} as Record<number, string>
    try {
      const p = previewIntervals(rec, settings)
      return Object.fromEntries(Object.entries(p).map(([k, v]) => [Number(k), v.label])) as Record<number, string>
    } catch {
      return {} as Record<number, string>
    }
  }, [stepKey, revealed, step, settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!step) return
      // 岔路口：1 = 拼写这一组，2 / Enter = 跳过
      const tag = (e.target as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'

      // R：重放发音。
      // ⚠️ **在输入框里必须放行**：现在支持拉丁键盘转写，`r` 正是 ρ 的输入键，
      // 拦下来用户就永远打不出 ρ（实测 anthropos 会变成 ἀνθοπος）。
      if (!inInput && (e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        replay()
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setConfirmExit(true); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const n = Number(e.key)
      const hasNumber = Number.isInteger(n) && n >= 1 && n <= 4

      // 选择题：1-4 选答案
      if (isChoiceStep && hasNumber && !answered) {
        const opt = options[n - 1]
        if (opt) { e.preventDefault(); void answerChoice(opt.id, opt.correct) }
        return
      }

      // 复习翻卡：未翻面时空格/回车翻面，翻面后 1-4 评分
      if (isFlipStep) {
        if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setRevealed(true); replay(); return }
        if (revealed && hasNumber) {
          e.preventDefault()
          const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]
          void gradeAndNext(grades[n - 1])
          return
        }
        return
      }

      // 拼写：回车提交；提交后回车/空格继续
      if (step.kind === 'spell') {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (spellResult) next()
          else void submitSpell()
        }
        return
      }

      // 其余：空格 / 回车 —— 未揭示则翻面，已揭示则继续
      if (e.key === ' ' || e.key === 'Enter') {
        if (inInput && e.key === ' ') return
        e.preventDefault()
        if (!revealed) setRevealed(true)
        else if (answered || revealed) next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, stepKey, isChoiceStep, isFlipStep, revealed, answered, options, lessonWords, advance,
      spellResult, answerChoice, gradeAndNext, submitSpell, next, replay]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- 结束页
  if (!step) {
    const st = useStore.getState().sessionStats
    return (
      <div data-testid="study" className="fixed inset-0 z-40 flex items-center justify-center bg-ink-50/95 p-6 backdrop-blur dark:bg-ink-950/95">
        <div className="card-surface w-full max-w-sm animate-pop p-7 text-center">
          <div className="mb-3 text-5xl">🎉</div>
          <h2 className="mb-1 text-xl font-semibold">本轮完成</h2>
          <p className="mb-5 text-sm text-ink-500">{st.new} 个新词 · {st.review} 个复习</p>
          <div className="mb-6 flex justify-center gap-6 text-sm">
            <div>
              <div className="text-2xl font-semibold text-laurel-600">{st.right}</div>
              <div className="text-xs text-ink-400">答对</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-wine-500">{st.wrong}</div>
              <div className="text-xs text-ink-400">答错</div>
            </div>
          </div>
          <button className="btn-primary w-full" onClick={onExit}>返回首页（Esc）</button>
        </div>
      </div>
    )
  }

  if (!word) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-50/95 dark:bg-ink-950/95">
        <div className="skeleton h-40 w-72" />
      </div>
    )
  }

  const total = queue.length
  const pct = total ? cursor / total : 0
  const level = lessons.find((l) => l.order === step.lesson)?.level ?? ''
  const gloss = (w: Word) => (w.z.length ? w.z[0] : w.s[0] ?? '')
  const sensesZh = word.z ?? []
  const sensesEn = word.s ?? []

  return (
    <div data-testid="study" className="fixed inset-0 z-40 flex flex-col bg-ink-50/95 backdrop-blur-xl dark:bg-ink-950/95">
      {/* 顶栏 */}
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
        <button className="btn-ghost !px-2.5 !py-1.5" onClick={() => setConfirmExit(true)} aria-label="退出">
          <Icon.Close className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-400">
            <span className="flex items-center gap-1.5">
              {(step.kind === 'learn' || step.kind === 'review') && <LevelTag level={level} />}
              {KIND_LABEL[step.kind]}
              {step.phase === 'review' && <span>· 到期复习</span>}
            </span>
            <span>{cursor + 1} / {total}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200/70">
            <div className="h-full rounded-full bg-gradient-to-r from-aegean-400 to-laurel-400 transition-[width] duration-300"
              style={{ width: `${pct * 100}%` }} />
          </div>
        </div>
      </header>

      {/* 主体 */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-4 pb-3">
        {/* ---------------- 新词：四选一 ---------------- */}
        {step.kind === 'learn' && (
          <div className="flex flex-1 flex-col justify-center">
            <div className="card-surface p-6 text-center">
              <p className="mb-3 text-xs font-medium text-ink-400">这是新词，选出正确的释义</p>
              <button
                onClick={() => { if (!revealed) { setRevealed(true); replay() } }}
                title="点击查看释义"
                className="greek text-[52px] leading-tight transition hover:text-aegean-600 dark:hover:text-aegean-300 sm:text-[62px]"
              >
                {word.e || word.w}
              </button>
              <div className="mt-3 flex items-center justify-center gap-3">
                <SpeakButton word={word} size="lg" />
                {word.pz && <span className="chip">{word.pz}</span>}
                {word.g && <span className="chip">{word.g}</span>}
              </div>
              {/* 音标放在词头下。这里是 `learn` 区，拼写步骤另有渲染分支，不会走到这 */}
              {word.ipa && (
                <div className="ipa mt-2 text-sm text-aegean-600 dark:text-aegean-400">[{word.ipa}]</div>
              )}

              <div className="mt-5">
                <ChoiceList options={options} picked={answered?.picked ?? null}
                  onPick={(id, ok) => void answerChoice(id, ok)} greek={false} />
              </div>

              {revealed && (
                <div className="mt-5 animate-fade-up border-t border-ink-100 pt-4 text-left dark:border-white/10">
                  <ResultBanner ok={!!answered?.ok} text={answered?.ok ? '答对了' : `正确答案：${sensesZh[0] ?? sensesEn[0] ?? ''}`} />
                  <div className="mt-3">
                    <WordDetail word={word} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------- 复习：翻卡四档 ---------------- */}
        {step.kind === 'review' && (
          <div className="flex flex-1 flex-col justify-center">
            <div className="card-surface p-7 text-center">
              <button
                onClick={() => { if (!revealed) { setRevealed(true); replay() } }}
                title="点击查看释义"
                className="greek text-[52px] leading-tight transition hover:text-aegean-600 dark:hover:text-aegean-300 sm:text-[62px]"
              >
                {word.e || word.w}
              </button>
              <div className="mt-3 flex items-center justify-center gap-3">
                <SpeakButton word={word} size="lg" />
                {word.pz && <span className="chip">{word.pz}</span>}
              </div>
              {word.ipa && (
                <div className="ipa mt-2 text-sm text-aegean-600 dark:text-aegean-400">[{word.ipa}]</div>
              )}
              {revealed ? (
                <div className="mt-5 animate-fade-up border-t border-ink-100 pt-4 text-left dark:border-white/10">
                  <WordDetail word={word} />
                </div>
              ) : (
                <p className="mt-4 text-xs text-ink-400">先回忆词义 · 点词形或按 空格 显示答案</p>
              )}
            </div>
          </div>
        )}

        {/* ---------------- 选义 / 听音 ---------------- */}
        {(step.kind === 'choice' || step.kind === 'audio') && (
          <div className="flex flex-1 flex-col justify-center">
            <div className="card-surface p-6 text-center">
              <p className="mb-3 text-xs font-medium text-ink-400">
                {step.kind === 'audio' ? '听发音，选出对应的词' : '选出正确释义'}
              </p>
              {step.kind === 'choice' ? (
                <>
                  <button onClick={replay} title="点击重放发音"
                    className="greek text-[46px] leading-tight transition hover:text-aegean-600 dark:hover:text-aegean-300 sm:text-[54px]">
                    {word.e || word.w}
                  </button>
                  <div className="mt-3 flex justify-center"><SpeakButton word={word} size="lg" /></div>
                </>
              ) : (
                <button
                  className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-aegean-50 text-aegean-600 transition hover:bg-aegean-100 active:scale-95 dark:bg-aegean-900/40 dark:text-aegean-300"
                  onClick={replay} aria-label="重放发音">
                  <Icon.Volume className="h-10 w-10" />
                </button>
              )}
              <div className="mt-5">
                <ChoiceList options={options} picked={answered?.picked ?? null}
                  onPick={(id, ok) => void answerChoice(id, ok)} greek={step.kind === 'audio'} />
              </div>
              {revealed && (
                <div className="mt-5 animate-fade-up border-t border-ink-100 pt-4 text-left dark:border-white/10">
                  <ResultBanner ok={!!answered?.ok} text={answered?.ok ? '答对了' : `正确答案：${gloss(word)}`} />
                  <div className="mt-3"><WordDetail word={word} compact /></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------- 拼写 ---------------- */}
        {step.kind === 'spell' && (
          <div className="flex flex-1 flex-col justify-center">
            <div className="card-surface p-6 text-center">
              <p className="mb-3 text-xs font-medium text-ink-400">根据释义拼写希腊语单词</p>
              <div className="mb-3 space-y-1">
                {sensesZh.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                    {sensesZh.map((s, i) => (
                      <span key={i} className="text-lg font-medium">{s}</span>
                    ))}
                  </div>
                )}
                {sensesEn.length > 0 && (
                  <p className="text-xs text-ink-400">{sensesEn.join('；')}</p>
                )}
              </div>
              <div className="mb-3 flex items-center justify-center gap-3">
                <SpeakButton word={word} />
                <span className="greek text-sm tracking-[.3em] text-ink-300">{hintOf(word.w)}</span>
              </div>
              {/* 拉丁键盘可直接输入并转写成希腊语；不在这里处理 Enter——
                  全局快捷键已覆盖，两处都处理会让同一个 Enter 既提交又跳过。 */}
              <GreekInput
                value={typed}
                onChange={setTyped}
                scheme={settings.inputScheme as InputScheme}
                placeholder="在此输入…（可直接用拉丁键盘）"
                autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                className="greek w-full rounded-xl border border-ink-200 bg-white/80 px-4 py-3 text-center text-2xl outline-none transition focus:border-aegean-400 focus:ring-4 focus:ring-aegean-100 dark:border-white/10 dark:bg-white/5 dark:focus:ring-aegean-900/40"
              />
              <GreekInputHint scheme={settings.inputScheme as InputScheme} />
              <p className="mt-2 text-[11px] text-ink-400">按 Enter 提交（或提交后继续）· 忽略变音符号也算对 · R 重放发音</p>
              {spellResult && (
                <div className="mt-4 animate-fade-up border-t border-ink-100 pt-4 text-left dark:border-white/10">
                  <ResultBanner ok={spellResult.ok}
                    text={spellResult.ok ? (spellResult.note ?? '拼写正确') : `正确答案：${spellResult.answer}`} />
                  <div className="mt-3"><WordDetail word={word} compact /></div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 底部操作区 */}
      <footer className="mx-auto w-full max-w-2xl px-4 pb-4">
        {/* 复习：四档 */}
        {isFlipStep && revealed && (
          <div className="grid grid-cols-4 gap-2">
            {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((g) => (
              <button key={g} className={`btn flex-col !gap-0.5 !py-2.5 text-white ${RATING_CLS[g]}`}
                onClick={() => void gradeAndNext(g)}>
                <span className="text-sm font-semibold">
                  <kbd className="mr-1 rounded bg-black/20 px-1 text-[10px]">{g}</kbd>
                  {RATING_KEY[g]}
                </span>
                <span className="text-[10px] opacity-80">{intervalLabels[g] ?? ''}</span>
              </button>
            ))}
          </div>
        )}

        {/* 复习未翻面 / 选择题未作答 的提示 */}
        {((isFlipStep && !revealed)) && (
          <button className="btn-primary w-full !py-3.5 text-base" onClick={() => { setRevealed(true); replay() }}>
            显示答案 <kbd className="ml-1 rounded bg-black/15 px-1.5 text-[11px]">空格</kbd>
          </button>
        )}

        {/* 已作答：继续 */}
        {(answered || spellResult) && step.kind !== 'review' && (
          <button className="btn-primary w-full !py-3.5 text-base" onClick={next}>
            继续 <kbd className="ml-1 rounded bg-black/15 px-1.5 text-[11px]">Enter</kbd>
          </button>
        )}

        {/* 键盘提示 */}
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
          {isChoiceStep && !answered && <span><Kbd>1</Kbd>–<Kbd>4</Kbd> 选择</span>}
          {isFlipStep && revealed && <span><Kbd>1</Kbd>–<Kbd>4</Kbd> 评分</span>}
          <span><Kbd>R</Kbd> 重放发音</span>
          <span><Kbd>Esc</Kbd> 退出</span>
          {step.kind !== 'review' && (answered || spellResult) && <span><Kbd>Enter</Kbd> 继续</span>}
          {step.kind === 'review' && !revealed && <span><Kbd>空格</Kbd> 显示答案</span>}
        </div>

        {step.kind === 'review' && revealed && (
          <div className="mt-2 flex justify-center">
            <button className="text-xs text-ink-400 underline-offset-2 hover:underline"
              onClick={() => { void suspend(step.wordId, true); next() }}>
              不再出现这个词
            </button>
          </div>
        )}
      </footer>

      {confirmExit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setConfirmExit(false)} />
          <div className="card-surface relative z-10 w-full max-w-xs p-5 text-center">
            <p className="mb-4 text-sm">退出后本次进度已保存，下次可继续。</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setConfirmExit(false)}>继续学习</button>
              <button className="btn-primary" onClick={onExit}>退出</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 子组件 */



