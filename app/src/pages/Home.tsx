import { useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { Icon, LevelTag, Ring, Section } from '../components/ui'
import { streakOf, todayKey } from '../lib/session'
import { State } from '../lib/srs'

export function Home({
  onStudy, onReader, onGoBooks, onGoStats, embedded = false,
}: {
  onStudy: () => void
  onReader: () => void
  onGoBooks: (sub: 'books' | 'browse') => void
  onGoStats: () => void
  embedded?: boolean
}) {
  const { cards, today, settings, days, lessons, lessonWords, ensureLesson, startSession } = useStore()

  useEffect(() => {
    for (const o of settings.activeLessons) void ensureLesson(o)
  }, [settings.activeLessons, ensureLesson])

  const overview = useMemo(() => {
    const now = Date.now()
    let due = 0, totalIntroduced = 0, mastered = 0, learning = 0, leech = 0
    for (const c of cards.values()) {
      if (c.suspended) continue
      if (c.state !== State.New) {
        totalIntroduced++
        if (c.due <= now) due++
        if (c.state === State.Review && c.stability >= 30) mastered++
        else learning++
        if ((c.lapses ?? 0) >= 4) leech++
      }
    }
    let newAvail = 0
    for (const o of settings.activeLessons) {
      for (const w of lessonWords.get(o) ?? []) {
        const c = cards.get(w.i)
        if (!c || c.state === State.New) newAvail++
      }
    }
    const newTarget = Math.max(0, Math.min(settings.dailyNew - today.newCount, newAvail))
    const reviewTarget = Math.max(0, Math.min(due, settings.dailyReviewLimit - today.reviewCount))
    return { due, newAvail, newTarget, reviewTarget, totalIntroduced, mastered, learning, leech }
  }, [cards, settings, today, lessonWords])

  const streak = useMemo(() => streakOf(days), [days])
  const totalDoneToday = today.newCount + today.reviewCount
  const goal = Math.max(1, overview.newTarget + overview.reviewTarget + totalDoneToday)
  const doneRatio = totalDoneToday / goal

  const activeBookProgress = useMemo(() => {
    const orders = settings.activeLessons
    let total = 0, introduced = 0
    for (const o of orders) {
      const ws = lessonWords.get(o) ?? []
      total += ws.length
      for (const w of ws) {
        const c = cards.get(w.i)
        if (c && c.state !== State.New) introduced++
      }
    }
    return { total, introduced, ratio: total ? introduced / total : 0 }
  }, [settings.activeLessons, lessonWords, cards])

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 6) return '夜深了'
    if (h < 11) return '早上好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  })()

  return (
    <div className="animate-fade-up">
      <header className={`flex items-start justify-between ${embedded ? 'mb-4' : 'mb-5'}`}>
        <div>
          {!embedded && <p className="text-xs text-ink-400">{todayKey()} · 古希腊语</p>}
          <h1 className={`${embedded ? 'text-lg' : 'mt-0.5 text-2xl'} font-semibold`}>
            {greeting}，<span className="text-aegean-600 dark:text-aegean-300">Ἑλληνιστί</span> 学习者
          </h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <Icon.Fire className="h-4 w-4" />
          <span className="text-sm font-semibold">{streak}</span>
          <span className="text-xs">天</span>
        </div>
      </header>

      {/* 今日任务 */}
      <div className="card-surface mb-5 overflow-hidden">
        <div className="flex items-center gap-5 p-5">
          <Ring value={doneRatio} size={104} thickness={9}>
            <span className="text-2xl font-semibold">{totalDoneToday}</span>
            <span className="text-[11px] text-ink-400">今日已学</span>
          </Ring>
          <div className="flex-1">
            <h2 className="mb-3 text-sm font-semibold text-ink-600">今日任务</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink-500">
                  <span className="h-2 w-2 rounded-full bg-laurel-500" />新词
                </span>
                <span className="font-medium">{overview.newTarget} 个</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink-500">
                  <span className="h-2 w-2 rounded-full bg-aegean-500" />复习
                </span>
                <span className="font-medium">{overview.reviewTarget} 个</span>
              </div>
              {overview.due > overview.reviewTarget && (
                <p className="text-[11px] text-amber-600">
                  还有 {overview.due - overview.reviewTarget} 个到期词超出今日上限
                </p>
              )}
            </div>
            <button
              className="btn-primary mt-4 w-full !py-3"
              disabled={overview.newTarget + overview.reviewTarget === 0}
              onClick={() => { void startSession().then(onStudy) }}
            >
              {overview.newTarget + overview.reviewTarget === 0 ? '今日任务已完成' : '开始学习'}
            </button>
          </div>
        </div>
      </div>

      {/* 数据速览（点进「我的 → 学习统计」） */}
      <Section title="数据速览" action={
        <button className="text-xs text-aegean-600 hover:underline" onClick={onGoStats}>全部统计</button>
      }>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '已学词', value: overview.totalIntroduced, tone: 'text-aegean-600' },
            { label: '已掌握', value: overview.mastered, tone: 'text-laurel-600' },
            { label: '难词', value: overview.leech, tone: 'text-wine-500' },
          ].map((s) => (
            <button key={s.label} onClick={onGoStats} className="card-surface p-3.5 text-center transition hover:bg-white dark:hover:bg-white/[.07]">
              <div className={`text-2xl font-semibold ${s.tone}`}>{s.value}</div>
              <div className="text-[11px] text-ink-400">{s.label}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* 当前词书 */}
      <Section
        title="当前词书"
        action={
          <span className="flex gap-3">
            <button className="text-xs text-aegean-600 hover:underline" onClick={() => onGoBooks('browse')}>词典</button>
            <button className="text-xs text-aegean-600 hover:underline" onClick={() => onGoBooks('books')}>更换词书</button>
          </span>
        }
      >
        <div className="card-surface p-4">
          {settings.activeLessons.length === 0 ? (
            <p className="text-sm text-ink-400">尚未选择词书</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {settings.activeLessons.map((o) => {
                  const l = lessons.find((x) => x.order === o)
                  if (!l) return null
                  return (
                    <span key={o} className="flex items-center gap-1.5 text-sm">
                      <LevelTag level={l.level} />
                      <span className="font-medium">{String(o).padStart(2, '0')} {l.title}</span>
                    </span>
                  )
                })}
              </div>
              <div className="mb-1.5 flex justify-between text-xs text-ink-400">
                <span>已学 {activeBookProgress.introduced} / {activeBookProgress.total}</span>
                <span>{(activeBookProgress.ratio * 100).toFixed(1)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-200/60">
                <div className="h-full rounded-full bg-gradient-to-r from-aegean-400 to-laurel-400"
                  style={{ width: `${activeBookProgress.ratio * 100}%` }} />
              </div>
            </>
          )}
        </div>
      </Section>

      {/* 快捷入口 */}
      <Section title="继续">
        <div className="grid grid-cols-2 gap-3">
          <button className="card-surface flex items-center gap-3 p-4 text-left transition hover:bg-white" onClick={onReader}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-aegean-50 text-aegean-600 dark:bg-aegean-900/40 dark:text-aegean-300">
              <Icon.Book className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">读新约</div>
              <div className="text-[11px] text-ink-400">中希对照 · 逐节点查</div>
            </div>
          </button>
          <button className="card-surface flex items-center gap-3 p-4 text-left transition hover:bg-white" onClick={() => { void useStore.getState().startSession([...cards.keys()].slice(0, 20)).then(onStudy) }}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-laurel-50 text-laurel-600 dark:bg-laurel-950/40 dark:text-laurel-300">
              <Icon.Cards className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">专项复习</div>
              <div className="text-[11px] text-ink-400">只练已学过的词</div>
            </div>
          </button>
        </div>
      </Section>
    </div>
  )
}
