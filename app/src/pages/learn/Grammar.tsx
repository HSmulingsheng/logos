import { useEffect, useMemo, useState } from 'react'
import { Section, Sheet, Empty, Icon } from '../../components/ui'
import { PlayButton } from '../../components/PlayButton'
import { SpeakSentence } from '../../components/SpeakSentence'
import { loadGrammar, loadSmyth } from '../../lib/grammar/data'
import type { GrammarData, Paradigm, EndingGroup, SmythData } from '../../lib/grammar/types'
import type { GenContext } from '../../lib/grammar/exercises'
import type { LevelSpec, UnitSpec } from '../../lib/grammar/course'
import { loadProgress, saveLevel, type ProgressMap } from '../../lib/grammar/progress'
import { GrammarPath } from './grammar/GrammarPath'
import { LevelRunner } from './grammar/LevelRunner'

const MARKS: { mark: string; name: string; note: string }[] = [
  { mark: 'ά / ὰ / ᾶ', name: '重音（acute / grave / circumflex）', note: '标示重读位置；grave 只出现在词末，circumflex 落在长音上。背单词时可以忽略，认词要靠它。' },
  { mark: 'ἁ / ἀ', name: '气号（rough / smooth breathing）', note: '词首元音上的「̔」表示送气 h，「̓」表示不送气。ἁ- 读 ha-，ἀ- 读 a-。' },
  { mark: 'ᾳ / ῃ / ῳ', name: '下加字母（iota subscript）', note: '与格单数的标志，实际不发音，但影响变格判断。' },
  { mark: '῾', name: 'ρ 的送气', note: '词首 ρ 常写作 ῥ，读作 hr。' },
]

/** 词尾的 σ 在词末实际写作 ς，显示时还原，免得看着别扭 */
function displayEnding(end: string): string {
  return end.endsWith('σ') ? end.slice(0, -1) + 'ς' : end
}

export function Grammar() {
  const [data, setData] = useState<GrammarData | null>(null)
  const [smyth, setSmyth] = useState<SmythData | null>(null)
  const [tab, setTab] = useState<'path' | 'reference'>('path')
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress())
  const [running, setRunning] = useState<{ unit: UnitSpec; level: LevelSpec } | null>(null)

  useEffect(() => {
    void loadGrammar().then(setData)
    void loadSmyth().then(setSmyth)
  }, [])

  // 取某一关要用到的题目素材
  const ctxFor = useMemo(() => (unit: UnitSpec): GenContext => {
    const all = data?.paradigms ?? []
    const paradigms = unit.dataUnits.length
      ? all.filter((p) => unit.dataUnits.includes(p.unit))
      : all
    const groups = (data?.endings ?? []).filter(
      (g) => !unit.endingsPos || unit.endingsPos.includes(g.pos),
    )
    return {
      paradigms: paradigms.length ? paradigms : all,
      endings: groups.length ? groups : (data?.endings ?? []),
      letters: data?.letters ?? [],
      // bad 例句的原始 XML 有讹误，不进题库
      smyth: (smyth?.examples ?? []).filter((e) => e.u === unit.id && !e.bad),
    }
  }, [data, smyth])

  if (running) {
    return (
      <LevelRunner
        unit={running.unit}
        spec={running.level}
        ctx={ctxFor(running.unit)}
        onExit={() => setRunning(null)}
        onFinish={(correct, total) => setProgress(saveLevel(running.level.id, correct, total))}
      />
    )
  }

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-ink-200/70 bg-white/70 p-0.5 dark:border-white/10 dark:bg-white/5">
        {([['path', '闯关'], ['reference', '速查']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-[10px] px-4 py-1.5 text-sm transition ${
              tab === k ? 'bg-aegean-500 font-medium text-white shadow-sm'
                : 'text-ink-500 hover:text-ink-700 dark:text-ink-400'}`}>
            {k === 'path' && <Icon.Spark className="h-3.5 w-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {tab === 'path' && (
        data
          ? <>
              <GrammarPath progress={progress} onStart={(unit, level) => setRunning({ unit, level })} />
              {smyth && <Textbook data={smyth} />}
            </>
          : <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 w-full" />)}</div>
      )}

      {tab === 'reference' && (
        data ? <Reference data={data} /> : <div className="skeleton h-64 w-full" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 速查

function Reference({ data }: { data: GrammarData }) {
  const [sub, setSub] = useState<'letters' | 'endings' | 'paradigms'>('letters')
  const [posFilter, setPosFilter] = useState('名词')
  const [detail, setDetail] = useState<Paradigm | null>(null)

  const posList = useMemo(() => [...new Set(data.endings.map((e) => e.pos))], [data])
  const groups = useMemo(
    () => data.endings.filter((e: EndingGroup) => e.pos === posFilter),
    [data, posFilter],
  )

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl border border-ink-200/70 bg-white/70 p-0.5 dark:border-white/10 dark:bg-white/5">
        {([['letters', '字母与读音'], ['endings', '词尾速查'], ['paradigms', '变格变位']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-[10px] px-3 py-1.5 text-sm transition ${
              sub === k ? 'bg-aegean-500 font-medium text-white shadow-sm'
                : 'text-ink-500 hover:text-ink-700 dark:text-ink-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'letters' && (
        <>
          <Section title="24 个字母">
            <div className="card-surface divide-y divide-ink-100 dark:divide-white/10">
              {data.letters.map((l) => (
                <div key={l.up} className="flex items-center gap-3 px-3.5 py-2">
                  <span className="w-16 shrink-0 text-center">
                    <span className="greek text-xl">{l.up}</span>
                    <span className="greek ml-1.5 text-base text-ink-500">{l.low}</span>
                  </span>
                  <span className="greek w-24 shrink-0 text-sm text-ink-600 dark:text-ink-300">{l.name}</span>
                  <span className="text-xs text-ink-500">{l.sound}</span>
                  <span className="ml-auto"><PlayButton file={l.audio} text={l.name} size="sm" /></span>
                </div>
              ))}
            </div>
          </Section>
          <Section title="变音符号">
            <div className="card-surface divide-y divide-ink-100 dark:divide-white/10">
              {MARKS.map((m) => (
                <div key={m.name} className="px-3.5 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="greek text-lg">{m.mark}</span>
                    <span className="text-sm font-medium">{m.name}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">{m.note}</p>
                </div>
              ))}
            </div>
          </Section>
          <p className="text-[11px] leading-relaxed text-ink-400">
            读音按重构音系（reconstructed pronunciation）给出，与配套的发音音频一致。
            若你学的是拜占庭／现代希腊语读法，η、υ、αι 等的读法会不同。
          </p>
        </>
      )}

      {sub === 'endings' && (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-400">
            下面每一组都来自语料里<b>实际出现过</b>的词形统计（不是抄来的表），
            所以能直接看出「这个格位最常见的词尾长什么样」。
          </p>
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
            {posList.map((p) => (
              <button key={p} onClick={() => setPosFilter(p)}
                className={`chip whitespace-nowrap ${posFilter === p ? '!border-aegean-300 !bg-aegean-50 !text-aegean-700' : ''}`}>
                {p}
              </button>
            ))}
          </div>
          {groups.length === 0 ? <Empty text="该词性暂无足够统计样本" /> : (
            <div className="space-y-2.5">
              {groups.map((g) => (
                <div key={g.gram} className="card-surface p-3.5">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm font-medium">{g.gram}</span>
                    <span className="text-[11px] text-ink-400">样本 {g.total} 次</span>
                  </div>
                  <div className="space-y-1.5">
                    {g.endings.map((e) => (
                      <div key={e.end} className="flex items-center gap-2.5">
                        <span className="greek w-14 shrink-0 text-lg text-aegean-700 dark:text-aegean-300">-{displayEnding(e.end)}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                          <div className="h-full rounded-full bg-aegean-400" style={{ width: `${Math.round(e.share * 100)}%` }} />
                        </div>
                        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-400">
                          {Math.round(e.share * 100)}%
                        </span>
                        <span className="hidden shrink-0 gap-1.5 sm:flex">
                          {e.words.slice(0, 2).map((w) => (
                            <span key={w} className="greek text-xs text-ink-500">{w}</span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {sub === 'paradigms' && (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-400">
            {data.paradigms.length} 个高频词的完整词形表，全部来自新约语料的实际出现统计。
            词形后面的数字是它在语料里出现的次数。
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.paradigms.map((p) => (
              <button key={p.word} onClick={() => setDetail(p)}
                className="card-surface p-3.5 text-left transition hover:bg-white dark:hover:bg-white/[.07]">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="greek text-lg font-medium">{p.word}</span>
                  <span className="chip">{p.bucket}</span>
                </div>
                <p className="mb-2 truncate text-xs text-ink-500">{p.senses.join('；')}</p>
                <div className="greek flex flex-wrap gap-1 text-sm text-ink-600 dark:text-ink-300">
                  {p.forms.slice(0, 6).map(([f]) => (
                    <span key={f} className="rounded bg-ink-50 px-1.5 py-0.5 dark:bg-white/5">{f}</span>
                  ))}
                  {p.forms.length > 6 && <span className="text-xs text-ink-400">…</span>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.word} · ${detail.bucket}` : ''}>
        {detail && (
          <div>
            <p className="mb-3 text-sm text-ink-500">
              {detail.senses.join('；')}
              {detail.freq ? ` · 新约出现 ${detail.freq} 次` : ''}
            </p>
            <div className="card-surface divide-y divide-ink-100 dark:divide-white/10">
              {detail.forms.map(([f, c, g]) => (
                <div key={f + g} className="flex items-center gap-3 px-3.5 py-2">
                  <span className="greek w-24 shrink-0 text-base">{f}</span>
                  <span className="flex-1 text-xs text-ink-500">{g}</span>
                  <span className="text-[11px] tabular-nums text-ink-400">×{c}</span>
                  <PlayButton text={f} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------- 教材（Smyth）

/** 教材对照：每个课程单元对应 Smyth 的哪些小节，以及该书里的例句 */
function Textbook({ data }: { data: SmythData }) {
  const [open, setOpen] = useState<string | null>(null)
  const byUnit = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of data.examples) m.set(e.u, (m.get(e.u) ?? 0) + 1)
    return m
  }, [data])

  const sectionsOf = (id: string) => {
    const ranges = data.units[id]?.ranges ?? []
    return data.sections.filter((s) => ranges.some((r) => s.n >= r.a && s.n <= r.b))
  }

  return (
    <Section title="教材对照 · Smyth《A Greek Grammar for Colleges》(1920)">
      <p className="mb-3 text-xs leading-relaxed text-ink-400">
        Smyth 是英语世界最权威的古希腊语参考语法，1920 年出版，已进入<b>公有领域</b>。
        下面把课程单元和它的编号小节对应起来——想深挖某个语法点，直接按 § 号查阅。
        闯关里的「教材例句」题全部取自这本书引用的真实古典希腊语例句（色诺芬、柏拉图、修昔底德等）。
      </p>
      <div className="space-y-2">
        {Object.entries(data.units).map(([id, u]) => {
          const secs = sectionsOf(id)
          const n = byUnit.get(id) ?? 0
          const isOpen = open === id
          return (
            <div key={id} className="card-surface overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : id)}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
                <span className="w-[92px] shrink-0 text-sm font-medium leading-tight">{u.zh}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
                  {u.ranges.map((r) => (r.a === r.b ? `§${r.a}` : `§${r.a}–${r.b}`)).join(' · ')}
                </span>
                {n > 0 && (
                  <span className="chip shrink-0 whitespace-nowrap !text-[10px]">{n} 条例句</span>
                )}
                <Icon.Next className={`h-4 w-4 shrink-0 text-ink-400 transition ${isOpen ? 'rotate-90' : ''}`} />
              </button>
              {isOpen && (
                <div className="border-t border-ink-100 dark:border-white/10">
                  {u.ranges.map((r) => (
                    <div key={`${r.a}-${r.b}`} className="px-3.5 py-2 text-xs">
                      <span className="font-medium">§{r.a}{r.a !== r.b ? `–${r.b}` : ''}</span>
                      <span className="ml-2 text-ink-500">{r.zh}</span>
                    </div>
                  ))}
                  {secs.filter((s) => s.title).slice(0, 12).map((s) => (
                    <div key={s.n} className="border-t border-ink-50 px-3.5 py-2 dark:border-white/5">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 text-[11px] tabular-nums text-aegean-600 dark:text-aegean-300">§{s.n}</span>
                        <span className="text-xs font-medium">{s.title}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-400">{s.en}</p>
                    </div>
                  ))}
                  {data.examples.filter((e) => e.u === id).slice(0, 3).map((e) => (
                    <div key={`${e.n}-${e.greek}`} className="border-t border-ink-50 px-3.5 py-2.5 dark:border-white/5">
                      <div className="flex items-start gap-2">
                        <p className="greek min-w-0 flex-1 text-sm leading-relaxed">{e.greek}</p>
                        <SpeakSentence text={e.greek} />
                      </div>
                      {e.zh && <p className="mt-0.5 text-[11px] text-ink-600 dark:text-ink-300">{e.zh}</p>}
                      {e.en && <p className="mt-0.5 text-[11px] text-ink-400">{e.en}</p>}
                      <p className="mt-0.5 text-[10px] text-ink-400">Smyth §{e.n}{e.src ? `　${e.src}` : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
