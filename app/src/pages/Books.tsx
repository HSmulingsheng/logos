import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { Icon, LevelTag, Ring, Section } from '../components/ui'
import { State } from '../lib/srs'

export function Books({ onStudy, embedded = false }: { onStudy: () => void; embedded?: boolean }) {
  const { lessons, cards, settings, saveSettings, lessonWords, ensureLesson, startSession } = useStore()
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    for (const o of settings.activeLessons) void ensureLesson(o)
  }, [settings.activeLessons, ensureLesson])

  const grouped = useMemo(() => {
    const g: Record<string, typeof lessons> = {}
    for (const l of lessons) (g[l.level] ??= []).push(l)
    return g
  }, [lessons])

  const progressOf = (order: number) => {
    const ws = lessonWords.get(order)
    if (!ws) return null
    let introduced = 0, due = 0, mastered = 0
    const now = Date.now()
    for (const w of ws) {
      const c = cards.get(w.i)
      if (!c || c.state === State.New) continue
      introduced++
      if (c.due <= now) due++
      if (c.state === State.Review && c.stability >= 30) mastered++
    }
    return { total: ws.length, introduced, due, mastered }
  }

  const toggle = async (order: number) => {
    const cur = settings.activeLessons
    const next = cur.includes(order) ? cur.filter((x) => x !== order) : [...cur, order].sort((a, b) => a - b)
    await saveSettings({ activeLessons: next.length ? next : [order], activeLesson: next[0] ?? order })
    if (!cur.includes(order)) await ensureLesson(order)
  }

  const activeTotal = useMemo(
    () => settings.activeLessons.reduce((a, o) => a + (lessons.find((l) => l.order === o)?.count ?? 0), 0),
    [settings.activeLessons, lessons],
  )

  return (
    <div className="animate-fade-up">
      {!embedded && (
        <header className="mb-4">
          <h1 className="text-2xl font-semibold">词书</h1>
          <p className="mt-1 text-sm text-ink-400">
            按 CEFR 分级，30 本词书从新约核心词一路读到古典原典。可同时选多本，进度共享。
          </p>
        </header>
      )}
      {embedded && (
        <p className="mb-4 text-xs leading-relaxed text-ink-400">
          按 CEFR 分级，30 本词书从新约核心词一路读到古典原典。可同时选多本，进度共享。
        </p>
      )}

      <div className="card-surface mb-5 flex items-center gap-4 p-4">
        <div className="text-sm">
          <div className="text-ink-500">已选 {settings.activeLessons.length} 本 · 共 {activeTotal} 词</div>
          <div className="mt-1 text-[11px] text-ink-400">
            {settings.activeLessons
              .map((o) => { const l = lessons.find((x) => x.order === o); return String(l?.seq ?? o).padStart(2, '0') })
              .join('、')}
          </div>
        </div>
        <button className="btn-primary ml-auto" disabled={!activeTotal}
          onClick={() => { void startSession().then(onStudy) }}>
          开始学习
        </button>
      </div>

      {Object.entries(grouped).map(([level, list]) => (
        <Section key={level} title={<span className="flex items-center gap-2"><LevelTag level={level} />{level} 阶段</span>}>
          <div className="space-y-2.5">
            {list.map((l) => {
              const p = progressOf(l.order)
              const active = settings.activeLessons.includes(l.order)
              const ratio = p && p.total ? p.introduced / p.total : 0
              return (
                <div key={l.order}
                  className={`card-surface overflow-hidden transition ${active ? 'ring-2 ring-aegean-300 dark:ring-aegean-800' : ''}`}>
                  <div className="flex items-center gap-3.5 p-4">
                    <Ring value={ratio} size={58} thickness={6}
                      barClass={active ? 'text-aegean-500' : 'text-ink-300'}>
                      <span className="text-[11px] font-semibold">{(ratio * 100).toFixed(0)}%</span>
                    </Ring>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {String(l.seq ?? l.order).padStart(2, '0')} · {l.titleZh || l.title}
                      </div>
                      {/* 原牌组名单独一行，便于对照 Anki 里的课次，也不挤占标题 */}
                      {l.titleZh && <div className="mt-0.5 truncate text-[11px] text-ink-300">{l.title}</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-400">
                        {/* 「学习中」放在这一行，避免把标题挤到截断 */}
                        {active && <span className="chip shrink-0 !border-aegean-200 !bg-aegean-50 !text-aegean-700">学习中</span>}
                        <span>{l.count} 词</span>
                        <span>例句 {l.withExamples}</span>
                        <span>音频 {l.withAudio}</span>
                        {p && <span>已学 {p.introduced}</span>}
                        {p && p.due > 0 && <span className="text-aegean-600">待复习 {p.due}</span>}
                      </div>
                    </div>
                    <button className="btn-ghost !px-2.5 !py-1.5" onClick={() => setExpanded(expanded === l.order ? null : l.order)}>
                      {expanded === l.order ? '收起' : '预览'}
                    </button>
                    <button
                      className={active ? 'btn !bg-ink-100 !px-3 !py-1.5 !text-ink-600 hover:!bg-ink-200' : 'btn-primary !px-3 !py-1.5'}
                      onClick={() => void toggle(l.order)}
                    >
                      {active ? '移出' : '加入'}
                    </button>
                  </div>
                  {expanded === l.order && (
                    <div className="border-t border-ink-100 px-4 py-3 dark:border-white/10">
                      <div className="greek flex flex-wrap gap-2 text-sm">
                        {(lessonWords.get(l.order) ?? []).slice(0, 60).map((w) => (
                          <span key={w.i} className="rounded-md bg-ink-50 px-1.5 py-0.5 dark:bg-white/5" title={(w.z[0] ?? w.s[0]) || ''}>
                            {w.w}
                          </span>
                        ))}
                        {(lessonWords.get(l.order) ?? []).length > 60 && (
                          <span className="text-xs text-ink-400">…等 {l.count} 词</span>
                        )}
                      </div>
                      {!lessonWords.get(l.order) && <div className="skeleton h-12 w-full" />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      ))}
    </div>
  )
}
