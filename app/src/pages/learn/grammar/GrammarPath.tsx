import { useMemo } from 'react'
import { Icon } from '../../../components/ui'
import { COURSE, ALL_LEVELS, TOTAL_LEVELS, levelIndex } from '../../../lib/grammar/course'
import type { LevelSpec, UnitSpec } from '../../../lib/grammar/course'
import type { ProgressMap } from '../../../lib/grammar/progress'

interface Props {
  progress: ProgressMap
  onStart: (unit: UnitSpec, level: LevelSpec) => void
}

/** 节点直径（px）与行高，两者一起决定路径的疏密 */
const NODE = 86
const ROW = 132
/** 关卡节点左右摆动的幅度，形成蛇形路径；按 4 关一个循环，任何关数都好看 */
const OFFSETS = [0, 64, 0, -64]

/** 关卡地图：分章节的路径，逐关解锁 */
export function GrammarPath({ progress, onStart }: Props) {
  const done = useMemo(
    () => ALL_LEVELS.filter((x) => progress[x.level.id]).length,
    [progress],
  )
  const unlocked = (levelId: string) => {
    const i = levelIndex(levelId)
    if (i <= 0) return true
    return !!progress[ALL_LEVELS[i - 1].level.id]
  }
  const currentId = ALL_LEVELS.find((x) => !progress[x.level.id])?.level.id
  const pct = Math.round((done / TOTAL_LEVELS) * 100)

  return (
    <div className="space-y-5">
      {/* 总览：与全站一致的信息卡 */}
      <div className="card-surface flex items-center gap-4 p-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-aegean-400 to-laurel-500 text-white shadow-sm">
          <Icon.Spark className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">语法闯关</div>
          <p className="mt-0.5 text-xs tabular-nums text-ink-500">
            {COURSE.length} 章 · {TOTAL_LEVELS} 关 · 已过 {done} 关
          </p>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-aegean-400 to-laurel-400 transition-[width] duration-500"
              style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold tabular-nums leading-none">{pct}%</div>
          <div className="mt-1 text-[10px] text-ink-400">完成度</div>
        </div>
      </div>

      {COURSE.map((unit, ui) => {
        const unitDone = unit.levels.filter((l) => progress[l.id]).length
        const unitPct = Math.round((unitDone / unit.levels.length) * 100)

        return (
          <section key={unit.id} className="card-surface overflow-hidden">
            {/* 单元栏 */}
            <header className={`bg-gradient-to-r ${unit.tint} px-5 pb-4 pt-5 text-white`}>
              <div className="flex items-center gap-3.5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/25 text-xl font-semibold backdrop-blur-sm">
                  {ui + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] font-semibold leading-tight">{unit.title}</h3>
                  <p className="mt-1 text-xs leading-snug opacity-90">{unit.subtitle}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold tabular-nums leading-none">
                    {unitDone}<span className="text-sm opacity-80">/{unit.levels.length}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-white transition-[width] duration-500"
                  style={{ width: `${unitPct}%` }} />
              </div>
            </header>

            {/* 关卡路径 */}
            <div className="px-4 py-2">
              {unit.levels.map((level, i) => {
                const rec = progress[level.id]
                const isDone = !!rec
                const isOpen = unlocked(level.id)
                const isCurrent = level.id === currentId
                const offset = OFFSETS[i % OFFSETS.length]

                return (
                  <div key={level.id} className="relative flex items-center justify-center"
                    style={{ height: ROW }}>
                    <button
                      onClick={() => isOpen && onStart(unit, level)}
                      disabled={!isOpen}
                      style={{ transform: `translateX(${offset}px)` }}
                      className={`relative flex flex-col items-center transition ${
                        isOpen ? 'cursor-pointer active:scale-[.96]' : 'cursor-not-allowed'}`}
                    >
                      <span
                        className={`relative flex items-center justify-center rounded-full border-[5px] shadow-sm transition ${
                          isDone
                            ? `border-white bg-gradient-to-br ${unit.tint} text-white dark:border-ink-900`
                            : isOpen
                              ? `border-white bg-gradient-to-br ${unit.tint} text-white dark:border-ink-900 ${
                                  isCurrent ? 'ring-4 ring-aegean-200 dark:ring-aegean-900/60' : 'opacity-95'}`
                              : 'border-ink-100 bg-ink-100 text-ink-400 dark:border-white/10 dark:bg-white/[.07]'
                        }`}
                        style={{ height: NODE, width: NODE }}
                      >
                        {isDone
                          ? <Icon.Check className="h-8 w-8" />
                          : isOpen
                            ? <span className="text-2xl font-semibold">{i + 1}</span>
                            : <Icon.Lock className="h-6 w-6" />}
                        {isCurrent && !isDone && (
                          <span className="absolute -inset-1.5 animate-ping rounded-full border-2 border-aegean-300/60" />
                        )}
                      </span>

                      <span className={`mt-2.5 max-w-[132px] text-center text-xs leading-snug ${
                        isOpen ? 'font-medium text-ink-600 dark:text-ink-300' : 'text-ink-400'}`}>
                        {level.title}
                      </span>
                      {/* 已通过只标「已过」，不再显示星级 */}
                      <span className="mt-1 h-4 text-[11px] leading-none">
                        {isDone
                          ? <span className="font-medium text-laurel-600 dark:text-laurel-400">已通过</span>
                          : <span className="text-ink-300 dark:text-ink-500">
                              {isOpen ? `${level.n} 题` : '未解锁'}
                            </span>}
                      </span>
                    </button>
                  </div>
                )
              })}

              {unitDone === unit.levels.length && (
                <div className="flex justify-center pb-5 pt-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-laurel-50 px-3.5 py-1.5 text-xs font-medium text-laurel-700 dark:bg-laurel-950/40 dark:text-laurel-300">
                    🏅 本章已完成
                  </span>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
