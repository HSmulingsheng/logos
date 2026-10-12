import { prepareSpeech } from '../lib/tts'
import { useEffect, useState } from 'react'
import { loadLsj, lsjOf } from '../lib/lsj'
import type { Example, Word } from '../types'
import { Icon } from './ui'
import { playAudio } from '../lib/audio'
import { SpeakSentence } from './SpeakSentence'

/** 把希腊语句子按命中词渲染成带高亮的片段 */
export function GreekSentence({ text, hits }: { text: string; hits: number[] }) {
  const toks = text.split(/\s+/)
  const set = new Set(hits)
  return (
    <p className="greek text-[17px] leading-relaxed">
      {toks.map((t, i) => (
        <span key={i}>
          {set.has(i) ? <mark className="hit">{t}</mark> : t}
          {i < toks.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  )
}

export function ExampleBlock({ ex, warm }: { ex: Example; warm?: boolean }) {
  const [greek, ref, refZh, cuv, source, hits, gram] = ex
  // 面板一打开就把第一条例句的**首个分段**合成好：多数人打开面板后会马上点喇叭，
  // 不该让他们再等 2–3 秒。只预热第一条，避免多条并发抢同一条 WASM 单线程。
  useEffect(() => { if (warm) prepareSpeech(greek) }, [warm, greek])
  const toks = greek.split(/\s+/)
  // 同一形式多次出现（如冠词在长句里反复出现）只列一次。
  // 注意：分词结果常带标点（"λόγος," / "λόγος."），比较前要先剥掉，
  // 否则同一个词形会因为标点不同被当成好几个。
  const bare = (t: string) => t.replace(/[^\p{Script=Greek}]/gu, '')
  const uniqueForms = gram
    .map((g, i) => ({ form: bare(toks[hits[i]] ?? ''), g }))
    .filter((x, i, arr) => x.form && arr.findIndex((y) => y.form === x.form && y.g === x.g) === i)
    .slice(0, 4)
  return (
    <div className="rounded-xl border border-ink-100 bg-white/60 p-3.5 dark:border-white/10 dark:bg-white/[.03]">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`chip ${source === 2
          ? '!border-amber-200 !bg-amber-50 !text-amber-700'
          : '!border-aegean-200 !bg-aegean-50 !text-aegean-700'}`}>
          {source === 0 ? '卡片精选' : source === 2 ? '古典语料' : '新约语料'}
        </span>
        <span className="text-xs font-medium text-ink-500">{refZh || ref}</span>
        {refZh && refZh !== ref && <span className="text-[11px] text-ink-400">{ref}</span>}
        <SpeakSentence text={greek} className="ml-auto" />
      </div>
      <GreekSentence text={greek} hits={hits} />
      {cuv && <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{cuv}</p>}
      {gram.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-400">
          <span>此处词形：</span>
          {uniqueForms.map(({ form, g }, i) => (
            <span key={i}>
              <span className="greek text-aegean-700 dark:text-aegean-300">{form}</span>
              <span className="ml-1">{g}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

/** 「不背单词」式的词条详情面板：释义 / 例句 / 词形变化 / 词根词缀 */
export function WordDetail({ word, compact = false }: { word: Word; compact?: boolean }) {
  // LSJ 释义按需加载（整表 2.7MB，只在真的看词条时才拉），加载完触发一次重渲染
  const [, setLsjReady] = useState(false)
  useEffect(() => {
    if (lsjOf(word.i)) return
    let alive = true
    void loadLsj().then(() => { if (alive) setLsjReady(true) })
    return () => { alive = false }
  }, [word.i])
  const lsj = lsjOf(word.i)
  const sensesZh = word.z ?? []
  const sensesEn = word.s ?? []
  const parts = sensesZh.length ? sensesZh : sensesEn

  return (
    <div className="space-y-4 text-left">
      {/* 国际音标（古典阿提卡重建，Probert 2010）：音节用 . 分隔，声调符号标高调位置 */}
      {word.ipa && (
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-xs font-semibold text-ink-400">发音</span>
          <span className="ipa text-[17px] leading-relaxed text-aegean-700 dark:text-aegean-300">
            [{word.ipa}]
          </span>
        </div>
      )}

      {/* 释义：中文为主，英文并列保留 */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {word.pz && <span className="chip">{word.pz}</span>}
          {word.g && <span className="chip">{word.g}</span>}
          {word.fq && <span className="chip">新约出现 {word.fq} 次{word.fr ? ` · 第 ${word.fr} 位` : ''}</span>}
          {word.st && <span className="chip">Strong {word.st}</span>}
        </div>
        <div className="mb-2">
          <div className="mb-1 text-xs font-semibold text-ink-400">中文释义</div>
          <ol className="space-y-1">
            {parts.map((s, i) => (
              <li key={i} className="flex gap-2 text-[15px] leading-relaxed">
                {parts.length > 1 && <span className="mt-[3px] text-xs text-ink-400">{i + 1}</span>}
                <span className={i === 0 ? 'font-medium' : 'text-ink-600 dark:text-ink-300'}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        {(lsj || sensesEn.length > 0) && (
          <div>
            <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold text-ink-400">
                {lsj ? '英文释义 · LSJ' : '英文释义'}
              </span>
              {lsj && (
                <span className="text-[10px] text-ink-300">
                  Liddell-Scott-Jones《希腊语英语词典》· Perseus · CC BY-SA 4.0
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-300">
              {lsj || sensesEn.join('；')}
            </p>
          </div>
        )}
      </div>

      {/* 词根词缀 */}
      {word.af && (word.af[0].length > 0 || word.af[1].length > 0) && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-400">构词 / 词根词缀</div>
          <div className="flex flex-wrap gap-1.5">
            {word.af[0].map((p) => (
              <span key={p} className="chip !border-laurel-200 !bg-laurel-50 !text-laurel-800">
                前缀 <b className="greek ml-0.5">{p}</b>
              </span>
            ))}
            {word.af[1].map((s) => (
              <span key={s} className="chip !border-amber-200 !bg-amber-50 !text-amber-800">
                后缀 <b className="greek ml-0.5">{s}</b>
              </span>
            ))}
          </div>
          {word.cp && word.cp.length > 1 && (
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              主要形式：{word.cp.map((c, i) => <span key={i} className="greek mr-2">{c}</span>)}
            </p>
          )}
        </div>
      )}

      {/* 例句 */}
      {word.ex && word.ex.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-400">真实语料例句</span>
            <span className="text-[11px] text-ink-400">SBLGNT · 和合本 · GLAUx</span>
          </div>
          <div className="space-y-2">
            {word.ex.slice(0, compact ? 1 : 3).map((e, i) => <ExampleBlock key={i} ex={e} warm={i === 0 && !compact} />)}
          </div>
        </div>
      )}

      {/* 词形变化：以表格呈现。数据来自语料统计，词形 + 语法标签 + 出现次数 */}
      {word.fm && word.fm.length > 1 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-400">词形变化</span>
            <span className="text-[11px] text-ink-400">
              共 {word.fm.length} 种形式 · 语料中出现 {word.fm.reduce((a, f) => a + f[1], 0)} 次
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-ink-100 dark:border-white/10">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-ink-50 text-[11px] font-medium text-ink-500 dark:bg-white/5 dark:text-ink-400">
                  <th className="px-3 py-2 text-left">词形</th>
                  <th className="px-3 py-2 text-left">语法</th>
                  <th className="px-3 py-2 text-right">出现</th>
                </tr>
              </thead>
              <tbody>
                {word.fm.map(([form, count, gram]) => (
                  <tr key={form} className="border-t border-ink-100 dark:border-white/10">
                    <td className="greek px-3 py-1.5 align-top whitespace-nowrap">{form}</td>
                    <td className="px-3 py-1.5 align-top text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                      {gram || '—'}
                    </td>
                    <td className="px-3 py-1.5 align-top text-right text-xs tabular-nums text-ink-400">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 同源 / 备注 / 外链 */}
      {(word.rl?.length || word.nt || word.lg || word.bh) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 text-xs dark:border-white/10">
          {word.rl?.length ? (
            <span className="text-ink-500">同源英语词：{word.rl.join('、')}</span>
          ) : null}
          <div className="ml-auto flex gap-2">
            {word.lg && (
              <a className="btn-ghost !px-2.5 !py-1 !text-xs" href={word.lg} target="_blank" rel="noreferrer">
                Logeion / LSJ
              </a>
            )}
            {word.bh && (
              <a className="btn-ghost !px-2.5 !py-1 !text-xs" href={word.bh} target="_blank" rel="noreferrer">
                BibleHub
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 发音按钮（带音波动画） */
export function SpeakButton({ word, size = 'md', auto }: { word: Word; size?: 'sm' | 'md' | 'lg'; auto?: boolean }) {
  const cls = size === 'lg'
    ? 'h-12 w-12'
    : size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  return (
    <button
      className={`${cls} inline-flex items-center justify-center rounded-full bg-aegean-50 text-aegean-600 transition hover:bg-aegean-100 active:scale-95 dark:bg-aegean-900/40 dark:text-aegean-300`}
      onClick={() => playAudio(word.au, word.w)}
      title={word.au ? '播放发音' : '无录音，使用系统朗读'}
      aria-label="播放发音"
      data-autoplay={auto ? '1' : undefined}
    >
      <Icon.Volume className={size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'} />
    </button>
  )
}
