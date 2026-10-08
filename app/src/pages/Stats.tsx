import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { Icon, LevelTag, Ring, Section } from '../components/ui'
import { streakOf, todayKey } from '../lib/session'
import { State } from '../lib/srs'
import { allLogs } from '../lib/db'

export function Stats({ embedded = false }: { embedded?: boolean } = {}) {
  const { cards, days, lessons, lessonWords, settings } = useStore()

  const overview = useMemo(() => {
    const now = Date.now()
    let introduced = 0, mastered = 0, due = 0, leech = 0, fav = 0
    let totalStability = 0
    for (const c of cards.values()) {
      if (c.state !== State.New) {
        introduced++
        totalStability += c.stability
        if (c.state === State.Review && c.stability >= 30) mastered++
        if (c.due <= now && !c.suspended) due++
        if ((c.lapses ?? 0) >= 4) leech++
      }
      if (c.fav) fav++
    }
    return {
      introduced, mastered, due, leech, fav,
      avgStability: introduced ? totalStability / introduced : 0,
    }
  }, [cards])

  const totals = useMemo(() => {
    let reviews = 0, newCount = 0, ms = 0, again = 0, good = 0, hard = 0, easy = 0
    for (const d of days) {
      reviews += d.reviewCount
      newCount += d.newCount
      ms += d.ms
      again += d.again; good += d.good; hard += d.hard; easy += d.easy
    }
    const graded = again + good + hard + easy
    return { reviews, newCount, ms, retained: graded ? (good + easy + hard * 0.5) / graded : 0, graded }
  }, [days])

  const streak = useMemo(() => streakOf(days), [days])

  /** 最近 28 天活动 */
  const heat = useMemo(() => {
    const map = new Map(days.map((d) => [d.day, d]))
    const out: { day: string; count: number; isToday: boolean }[] = []
    const cur = new Date()
    cur.setDate(cur.getDate() - 27)
    for (let i = 0; i < 28; i++) {
      const key = todayKey(cur)
      const d = map.get(key)
      out.push({ day: key, count: d ? d.newCount + d.reviewCount : 0, isToday: key === todayKey() })
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [days])

  const maxHeat = Math.max(1, ...heat.map((h) => h.count))
  const perLesson = useMemo(() => {
    return settings.activeLessons.map((o) => {
      const l = lessons.find((x) => x.order === o)
      const ws = lessonWords.get(o) ?? []
      let intro = 0, done = 0
      const now = Date.now()
      for (const w of ws) {
        const c = cards.get(w.i)
        if (!c || c.state === State.New) continue
        intro++
        if (c.state === State.Review && c.stability >= 30) done++
      }
      return { order: o, level: l?.level ?? '', title: l?.title ?? '', total: ws.length || l?.count || 0, intro, done, due: 0, now }
    })
  }, [settings.activeLessons, lessons, lessonWords, cards])

  const dailyAvg = days.filter((d) => d.newCount + d.reviewCount > 0).length
    ? (totals.newCount + totals.reviews) / days.filter((d) => d.newCount + d.reviewCount > 0).length
    : 0

  return (
    <div className="animate-fade-up">
      {!embedded && <h1 className="mb-4 text-2xl font-semibold">学习统计</h1>}

      <div className="card-surface mb-5 flex items-center gap-6 p-5">
        <Ring value={overview.introduced ? overview.mastered / overview.introduced : 0} size={110} thickness={9}
          barClass="text-laurel-500">
          <span className="text-2xl font-semibold">{overview.mastered}</span>
          <span className="text-[11px] text-ink-400">已掌握</span>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-y-3 text-sm">
          <Stat label="连续打卡" value={`${streak} 天`} icon={<Icon.Fire className="h-3.5 w-3.5" />} />
          <Stat label="累计复习" value={`${totals.reviews}`} />
          <Stat label="累计新词" value={`${totals.newCount}`} />
          <Stat label="日均" value={`${dailyAvg.toFixed(1)} 词`} />
          <Stat label="平均记忆强度" value={`${overview.avgStability.toFixed(1)} 天`} />
          <Stat label="待复习" value={`${overview.due}`} />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <MiniCard label="记忆保持率" value={`${(totals.retained * 100).toFixed(0)}%`} tone="text-laurel-600" hint={`${totals.graded} 次评分`} />
        <MiniCard label="难词" value={`${overview.leech}`} tone="text-wine-500" hint="遗忘 ≥4 次" />
        <MiniCard label="收藏" value={`${overview.fav}`} tone="text-amber-500" hint="生词本" />
      </div>

      <Section title="最近 28 天">
        <div className="card-surface p-4">
          <div className="flex items-end gap-1" style={{ height: 96 }}>
            {heat.map((h) => (
              <div key={h.day} className="group relative flex-1" title={`${h.day}：${h.count} 个`}>
                <div
                  className={`w-full rounded-sm transition-all ${
                    h.count === 0 ? 'bg-ink-100 dark:bg-white/5'
                      : h.isToday ? 'bg-aegean-500' : 'bg-aegean-300'
                  }`}
                  style={{ height: h.count === 0 ? 4 : Math.max(6, (h.count / maxHeat) * 88) }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-ink-400">
            <span>{heat[0].day.slice(5)}</span>
            <span>峰值 {maxHeat} 个/天</span>
            <span>今天</span>
          </div>
        </div>
      </Section>

      <Section title="所选词书进度">
        <div className="card-surface divide-y divide-ink-100 dark:divide-white/10">
          {perLesson.map((p) => (
            <div key={p.order} className="flex items-center gap-3 p-3.5">
              <LevelTag level={p.level} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {String(p.order).padStart(2, '0')} · {p.title}
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">{p.intro}/{p.total}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-200/60">
                  <div className="h-full rounded-full bg-aegean-400" style={{ width: `${p.total ? (p.intro / p.total) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="记忆强度分布">
        <Distribution cards={[...cards.values()]} />
      </Section>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-ink-400">{icon}{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}

function MiniCard({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <div className="card-surface p-3.5 text-center">
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
      <div className="text-[11px] text-ink-400">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-300">{hint}</div>}
    </div>
  )
}

function Distribution({ cards }: { cards: import('../types').CardRecord[] }) {
  const buckets = useMemo(() => {
    const b = [
      { label: '未学', n: 0, cls: 'bg-ink-200' },
      { label: '初学 <1天', n: 0, cls: 'bg-wine-300' },
      { label: '1–7 天', n: 0, cls: 'bg-amber-400' },
      { label: '7–30 天', n: 0, cls: 'bg-laurel-400' },
      { label: '>30 天', n: 0, cls: 'bg-aegean-500' },
    ]
    for (const c of cards) {
      if (c.state === State.New) b[0].n++
      else if (c.state === State.Learning || c.state === State.Relearning || c.stability < 1) b[1].n++
      else if (c.stability < 7) b[2].n++
      else if (c.stability < 30) b[3].n++
      else b[4].n++
    }
    return b
  }, [cards])
  const total = Math.max(1, buckets.reduce((a, x) => a + x.n, 0))
  return (
    <div className="card-surface p-4">
      <div className="mb-3 flex h-3 overflow-hidden rounded-full">
        {buckets.map((b) => (
          <div key={b.label} className={b.cls} style={{ width: `${(b.n / total) * 100}%` }} title={`${b.label}: ${b.n}`} />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1 text-center text-[10px] text-ink-500">
        {buckets.map((b) => (
          <div key={b.label}>
            <div className="font-semibold text-ink-700 dark:text-ink-200">{b.n}</div>
            <div>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
